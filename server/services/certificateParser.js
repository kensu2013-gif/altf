/**
 * QC-01 : 성적서 PDF 파싱 & 26개 컬럼 장부 자동 매핑 및 이상치 검출 서비스
 * - PDF 텍스트 추출 (PDFParse)
 * - 대경벤드 성적서 규격 및 화학/기계 성분 자동 분석
 * - 한국산업표준(KS B 1543, KS D 3576) 및 ASTM(A312 TP304/TP316L) 공차 규격 기반 이상치(Outlier) 자동 검출
 * - storage/certificates/대경벤드 성적서.xlsx 및 server/data/certificates.json 실시간 동기화
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const CERTIFICATES_STORAGE_DIR = path.join(ROOT_DIR, 'storage/certificates');
const CERT_JSON_PATH = path.join(ROOT_DIR, 'server/data/certificates.json');
const CERT_EXCEL_PATH = path.join(ROOT_DIR, 'storage/certificates/대경벤드 성적서.xlsx');

// 26개 컬럼 공식 헤더 (대경벤드 성적서.xlsx 및 Google Sheets 100% 호환)
export const CERTIFICATE_SHEET_HEADERS = [
    '일 자',
    'Customer',
    '공급처',
    'P.O No',
    'CERT-No',
    'Spec MATERIAL',
    'Spec INSPECTION',
    'HEAT No',
    'LOT No',
    'ITEM No',
    'DESCRIPTION',
    "Q'TY",
    'MATERIAL',
    'C',
    'Si',
    'Mn',
    'P',
    'S',
    'Ni',
    'Cr',
    'Mo',
    'Y.S',
    'T.S',
    'E.L',
    '외관/치수',
    'PDF 원본링크'
];

// 강종별 표준 규격 스펙 테이블 (이상치 검출 룰 엔진)
export const MATERIAL_SPECS = {
    'STS304': {
        name: 'STS304 / TP304',
        chem: {
            C: { min: 0, max: 0.08 },
            Si: { min: 0, max: 1.00 },
            Mn: { min: 0, max: 2.00 },
            P: { min: 0, max: 0.045 },
            S: { min: 0, max: 0.030 },
            Ni: { min: 8.00, max: 11.00 },
            Cr: { min: 18.00, max: 20.00 },
            Mo: { min: 0, max: 0.50 }
        },
        mech: {
            Ys: { min: 205 }, // 항복강도 (MPa)
            Ts: { min: 520 }, // 인장강도 (MPa)
            El: { min: 35 }   // 연신율 (%)
        }
    },
    'STS316L': {
        name: 'STS316L / TP316L',
        chem: {
            C: { min: 0, max: 0.035 },
            Si: { min: 0, max: 1.00 },
            Mn: { min: 0, max: 2.00 },
            P: { min: 0, max: 0.045 },
            S: { min: 0, max: 0.030 },
            Ni: { min: 10.00, max: 14.00 },
            Cr: { min: 16.00, max: 18.00 },
            Mo: { min: 2.00, max: 3.00 }
        },
        mech: {
            Ys: { min: 175 }, // 항복강도 (MPa)
            Ts: { min: 480 }, // 인장강도 (MPa)
            El: { min: 35 }   // 연신율 (%)
        }
    }
};

/**
 * 성적서 행의 화학/기계적 성분 이상치(Outlier) 검출
 */
export function evaluateRowQuality(row) {
    const is316 = (row.specMaterial && row.specMaterial.includes('316')) || 
                  (row.specInspection && row.specInspection.includes('316')) || 
                  (row.chemMo > 1.5);
    
    const specKey = is316 ? 'STS316L' : 'STS304';
    const spec = MATERIAL_SPECS[specKey];

    const outliers = [];

    // 화학 성분 검사
    if (spec.chem.C && (row.chemC > spec.chem.C.max)) {
        outliers.push(`C 함량 초과: ${row.chemC} (기준치 max ${spec.chem.C.max})`);
    }
    if (spec.chem.Si && (row.chemSi > spec.chem.Si.max)) {
        outliers.push(`Si 함량 초과: ${row.chemSi} (기준치 max ${spec.chem.Si.max})`);
    }
    if (spec.chem.Mn && (row.chemMn > spec.chem.Mn.max)) {
        outliers.push(`Mn 함량 초과: ${row.chemMn} (기준치 max ${spec.chem.Mn.max})`);
    }
    if (spec.chem.P && (row.chemP > spec.chem.P.max)) {
        outliers.push(`P 함량 초과: ${row.chemP} (기준치 max ${spec.chem.P.max})`);
    }
    if (spec.chem.S && (row.chemS > spec.chem.S.max)) {
        outliers.push(`S 함량 초과: ${row.chemS} (기준치 max ${spec.chem.S.max})`);
    }
    if (spec.chem.Ni && (row.chemNi < spec.chem.Ni.min || row.chemNi > spec.chem.Ni.max)) {
        outliers.push(`Ni 함량 규격 외: ${row.chemNi} (기준치 ${spec.chem.Ni.min}~${spec.chem.Ni.max})`);
    }
    if (spec.chem.Cr && (row.chemCr < spec.chem.Cr.min || row.chemCr > spec.chem.Cr.max)) {
        outliers.push(`Cr 함량 규격 외: ${row.chemCr} (기준치 ${spec.chem.Cr.min}~${spec.chem.Cr.max})`);
    }
    if (is316 && spec.chem.Mo && (row.chemMo < spec.chem.Mo.min || row.chemMo > spec.chem.Mo.max)) {
        outliers.push(`Mo 함량 규격 외: ${row.chemMo} (기준치 ${spec.chem.Mo.min}~${spec.chem.Mo.max})`);
    }

    // 기계적 성질 검사 (강도 미달 체크)
    if (spec.mech.Ys && row.mechYs > 0 && row.mechYs < spec.mech.Ys.min) {
        outliers.push(`항복강도(Y.S) 미달: ${row.mechYs} MPa (기준치 min ${spec.mech.Ys.min})`);
    }
    if (spec.mech.Ts && row.mechTs > 0 && row.mechTs < spec.mech.Ts.min) {
        outliers.push(`인장강도(T.S) 미달: ${row.mechTs} MPa (기준치 min ${spec.mech.Ts.min})`);
    }
    if (spec.mech.El && row.mechEl > 0 && row.mechEl < spec.mech.El.min) {
        outliers.push(`연신율(E.L) 미달: ${row.mechEl} % (기준치 min ${spec.mech.El.min})`);
    }

    const status = outliers.length === 0 ? 'PASS' : (outliers.length <= 1 ? 'WARN' : 'FAIL');
    return {
        grade: specKey,
        status,
        hasOutliers: outliers.length > 0,
        outlierCount: outliers.length,
        outliers,
        specName: spec.name
    };
}

/**
 * 단일 페이지 텍스트에서 성적서 품목 데이터 추출
 */
function parseCertificatePage(pageText, fileName) {
    const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 5) return [];

    let customer = '';
    let certNo = '';
    let poNo = '';
    let issueDate = '';
    let specMaterial = '';
    let specInspection = '';
    let dimensionVi = 'GOOD';

    // 1. 헤더 파싱
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
        const line = lines[i];
        if (line.includes('YR-') || line.includes('ALTF-')) {
            const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
            if (parts.length >= 2) {
                customer = parts[0].replace(/\(\s*\)/g, '').trim();
                certNo = parts[parts.length - 1];
            } else {
                const m = line.match(/(.*?)(YR-\d+-\d+|ALTF-\d+-\d+)/);
                if (m) {
                    customer = m[1].replace(/\(\s*\)/g, '').trim();
                    certNo = m[2].trim();
                }
            }
        }
        if (line.match(/(ES\d+-\d+|\d{6}-\d{4})/)) {
            const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
            poNo = parts[0] || '';
            issueDate = parts[1] || '';
        }
        if (line.includes('KS B') || line.includes('ASTM') || line.includes('JIS') || line.includes('DIN')) {
            const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
            specMaterial = parts[0] || '';
            specInspection = parts[1] || '';
        }
        if (line.includes('GOOD')) {
            dimensionVi = 'GOOD';
        }
    }

    if (!certNo) return [];

    // 2. 아이템 라인 파싱 (LOT No, ITEM No, HEAT No, DESCRIPTION, Q'TY, MATERIAL)
    const items = [];
    const itemRegex = /^([A-Z0-9]{4,10})\s+(\d+)\s+([A-Z0-9]{4,10})\s+(.+?)\s+(\d+)\s+(WELDED PIPE|SMLS PIPE|PIPE|PLATE|BAR)(.*)$/;

    for (const line of lines) {
        const tabParts = line.split('\t').map(p => p.trim()).filter(Boolean);
        if (tabParts.length >= 4) {
            const joined = tabParts.join(' ');
            const m = joined.match(itemRegex);
            if (m) {
                items.push({
                    lotNo: m[1],
                    itemNo: parseInt(m[2], 10),
                    heatNo: m[3],
                    description: m[4].trim(),
                    qty: parseInt(m[5], 10),
                    material: m[6].trim()
                });
            }
        }
    }

    // 3. 화학 성분 파싱 (HEAT No별)
    const chemMap = {};
    for (const line of lines) {
        const m = line.match(/^([A-Z0-9]{4,10})\s+L\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+([\d.]+))?/);
        if (m) {
            chemMap[m[1]] = {
                chemC: parseFloat(m[2]),
                chemSi: parseFloat(m[3]),
                chemMn: parseFloat(m[4]),
                chemP: parseFloat(m[5]),
                chemS: parseFloat(m[6]),
                chemNi: parseFloat(m[7]),
                chemCr: parseFloat(m[8]),
                chemMo: m[9] ? parseFloat(m[9]) : 0
            };
        }
    }

    // 4. 기계적 성질 파싱 (HEAT No별)
    const mechMap = {};
    for (const line of lines) {
        const m = line.match(/^([A-Z0-9]{4,10})\s+(?:L,B|L|B)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        if (m) {
            mechMap[m[1]] = {
                mechYs: parseFloat(m[2]),
                mechTs: parseFloat(m[3]),
                mechEl: parseFloat(m[4])
            };
        }
    }

    // 날짜 포맷 정리 (예: '2026.10.14' -> '26/10/14')
    let formattedDate = issueDate;
    if (issueDate.includes('.')) {
        const p = issueDate.split('.');
        if (p.length === 3) {
            formattedDate = `${p[0].slice(-2)}/${p[1]}/${p[2]}`;
        }
    }

    // 5. 26개 컬럼 행 조립 및 품질 검사 평가
    return items.map(it => {
        const chem = chemMap[it.heatNo] || {};
        const mech = mechMap[it.heatNo] || {};
        const baseRow = {
            issueDate: formattedDate || '26/10/15',
            customer: customer || '알트에프(ALT.F)',
            supplier: '(주)대경벤드',
            poNo,
            certNo,
            specMaterial,
            specInspection,
            heatNo: it.heatNo,
            lotNo: it.lotNo,
            itemNo: it.itemNo,
            description: it.description,
            qty: it.qty,
            material: it.material,
            chemC: chem.chemC ?? 0,
            chemSi: chem.chemSi ?? 0,
            chemMn: chem.chemMn ?? 0,
            chemP: chem.chemP ?? 0,
            chemS: chem.chemS ?? 0,
            chemNi: chem.chemNi ?? 0,
            chemCr: chem.chemCr ?? 0,
            chemMo: chem.chemMo ?? 0,
            mechYs: mech.mechYs ?? 0,
            mechTs: mech.mechTs ?? 0,
            mechEl: mech.mechEl ?? 0,
            dimensionVi,
            pdfUrl: fileName
        };

        const quality = evaluateRowQuality(baseRow);
        return {
            ...baseRow,
            quality
        };
    });
}

export class CertificateParserService {
    /**
     * 특정 PDF 파일 1건 파싱
     */
    async parsePdfFile(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileName = path.basename(filePath);
        const dataBuffer = fs.readFileSync(filePath);
        const parser = new PDFParse({ data: dataBuffer });
        const res = await parser.getText();

        const pages = res.text.split(/-- \d+ of \d+ --/);
        const allRows = [];

        for (const page of pages) {
            const rows = parseCertificatePage(page, fileName);
            allRows.push(...rows);
        }

        return {
            fileName,
            totalRows: allRows.length,
            rows: allRows
        };
    }

    /**
     * storage/certificates 내의 모든 PDF를 스캔하여 26개 컬럼 엑셀 및 JSON 장부 전체 동기화
     */
    async parseAndSyncAll() {
        if (!fs.existsSync(CERTIFICATES_STORAGE_DIR)) {
            fs.mkdirSync(CERTIFICATES_STORAGE_DIR, { recursive: true });
        }

        const files = fs.readdirSync(CERTIFICATES_STORAGE_DIR).filter(f => f.endsWith('.pdf'));
        console.log(`[QC-01 Parser] 전체 성적서 파싱 시작: 총 ${files.length}개 PDF 대상`);

        const allExtractedRows = [];
        let parsedFilesCount = 0;

        for (const f of files) {
            try {
                const fullPath = path.join(CERTIFICATES_STORAGE_DIR, f);
                const result = await this.parsePdfFile(fullPath);
                if (result.rows && result.rows.length > 0) {
                    allExtractedRows.push(...result.rows);
                    parsedFilesCount++;
                }
            } catch (err) {
                console.error(`[QC-01 Parser] ${f} 파싱 중 오류 발생:`, err.message);
            }
        }

        // 중복 제거 (poNo + certNo + itemNo + heatNo 복합키)
        const uniqueMap = new Map();
        for (const r of allExtractedRows) {
            const key = `${r.poNo}_${r.certNo}_${r.itemNo}_${r.heatNo}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, r);
            }
        }
        const consolidatedRows = Array.from(uniqueMap.values());

        // 1. server/data/certificates.json 영구 저장
        fs.mkdirSync(path.dirname(CERT_JSON_PATH), { recursive: true });
        fs.writeFileSync(CERT_JSON_PATH, JSON.stringify(consolidatedRows, null, 2), 'utf8');

        // 2. storage/certificates/대경벤드 성적서.xlsx 엑셀 생성 및 동기화
        const excelData = [
            CERTIFICATE_SHEET_HEADERS,
            ...consolidatedRows.map(r => [
                r.issueDate, r.customer, r.supplier, r.poNo, r.certNo,
                r.specMaterial, r.specInspection, r.heatNo, r.lotNo, r.itemNo,
                r.description, r.qty, r.material, r.chemC, r.chemSi, r.chemMn,
                r.chemP, r.chemS, r.chemNi, r.chemCr, r.chemMo, r.mechYs,
                r.mechTs, r.mechEl, r.dimensionVi, r.pdfUrl
            ])
        ];

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(excelData);
        xlsx.utils.book_append_sheet(wb, ws, '대경벤드성적서');
        xlsx.writeFile(wb, CERT_EXCEL_PATH);

        console.log(`[QC-01 Parser] 파싱 완료! 총 ${parsedFilesCount}개 PDF에서 ${consolidatedRows.length}개 품목 장부(Excel/JSON) 동기화 완료.`);

        // 품질 통계 계산
        const stats = this.calculateQualityStats(consolidatedRows);

        return {
            success: true,
            totalPdfFiles: files.length,
            parsedFilesCount,
            totalRowsCount: consolidatedRows.length,
            stats,
            rows: consolidatedRows
        };
    }

    /**
     * 현재 보관된 장부 행 목록 및 통계 반환
     */
    getLedgerData() {
        let rows = [];
        if (fs.existsSync(CERT_JSON_PATH)) {
            try {
                rows = JSON.parse(fs.readFileSync(CERT_JSON_PATH, 'utf8'));
            } catch {}
        }

        // 품질 검사 메타데이터 보강
        const enrichedRows = rows.map(r => ({
            ...r,
            quality: r.quality || evaluateRowQuality(r)
        }));

        const stats = this.calculateQualityStats(enrichedRows);

        return {
            count: enrichedRows.length,
            stats,
            rows: enrichedRows
        };
    }

    /**
     * 품질 통계 및 이상치 집계
     */
    calculateQualityStats(rows) {
        let passCount = 0;
        let warnCount = 0;
        let failCount = 0;
        const outliersList = [];

        for (const r of rows) {
            const q = r.quality || evaluateRowQuality(r);
            if (q.status === 'PASS') passCount++;
            else if (q.status === 'WARN') warnCount++;
            else if (q.status === 'FAIL') failCount++;

            if (q.hasOutliers) {
                outliersList.push({
                    certNo: r.certNo,
                    poNo: r.poNo,
                    itemNo: r.itemNo,
                    description: r.description,
                    heatNo: r.heatNo,
                    grade: q.grade,
                    status: q.status,
                    outliers: q.outliers
                });
            }
        }

        const passRate = rows.length > 0 ? ((passCount / rows.length) * 100).toFixed(1) : 100;

        return {
            totalItems: rows.length,
            passCount,
            warnCount,
            failCount,
            passRate: `${passRate}%`,
            outliersCount: outliersList.length,
            recentOutliers: outliersList.slice(0, 10)
        };
    }
}

export const certificateParserService = new CertificateParserService();
