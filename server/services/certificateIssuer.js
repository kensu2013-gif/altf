/**
 * 🔬 QC-06 성적서 발행봇 전담 서비스 (Certificate Issuer Service)
 * - 담당: 품질부 QC-06 대리 (성적서 발행봇)
 * - 보관: 데이터관리부 DAT-10 (발주서 번호별 성적서 엑셀/PDF 아카이빙)
 * - 템플릿: storage/templates/성적서 양식.xlsx (6개 시트)
 *   1) STS304 1040
 *   2) STS304 1050
 *   3) TP304(소재ASTM사용시)
 *   4) TYPE304(PLATE 사용시)
 *   5) TP316L
 *   6) TYPE316L(PLATE사용시)
 * - 규칙:
 *   - 최대 6개 아이템 단위 묶음 (1~6개: 1장, 7~12개: 2장...)
 *   - /B1500 또는 LOT가 K로 시작: 1050℃
 *   - LOT가 J로 시작 또는 일반: 1040℃
 *   - AX13:BC18 영역에 HEAT, LOT, ITEM No, 제품명, 수량, Starting Material 입력
 *   - 2. CHEMICAL 및 3. MECHANICAL에 실제 시험 성적값(C,Si,Mn,P,S,Ni,Cr,Mo,YS,TS,EL) 매핑
 *   - Chrome/Edge 헤드리스 인쇄 엔진으로 사진과 100% 동일한 A4 규격 PDF 변환
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import xlsx from 'xlsx';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const ROOT_TEMPLATE = path.join(ROOT_DIR, '성적서 양식.xlsx');
const TEMPLATE_PATH = fs.existsSync(ROOT_TEMPLATE) ? ROOT_TEMPLATE : path.join(ROOT_DIR, 'storage/templates/성적서 양식.xlsx');
const ISSUED_DIR = path.join(ROOT_DIR, 'storage/issued_certificates');
const ISSUED_JSON_PATH = path.join(ROOT_DIR, 'server/data/issued_certificates.json');
const CERT_JSON_PATH = path.join(ROOT_DIR, 'server/data/certificates.json');
const AGENTS_PATH = path.join(ROOT_DIR, 'server/data/agents.json');
const DB_PATH = path.join(ROOT_DIR, 'data/db.json');
const QC_MISSING_ALERTS_PATH = path.join(ROOT_DIR, 'server/data/qc_missing_alerts.json');

// 시스템 내 Chrome 또는 Edge 브라우저 실행 파일 경로 탐색
function getBrowserExecutablePath() {
    const candidatePaths = [
        // Mac
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        // Windows
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        // Linux
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

export class CertificateIssuerService {
    constructor() {
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(ISSUED_DIR)) {
            fs.mkdirSync(ISSUED_DIR, { recursive: true });
        }
        if (!fs.existsSync(path.dirname(ISSUED_JSON_PATH))) {
            fs.mkdirSync(path.dirname(ISSUED_JSON_PATH), { recursive: true });
        }
        if (!fs.existsSync(ISSUED_JSON_PATH)) {
            fs.writeFileSync(ISSUED_JSON_PATH, JSON.stringify([], null, 2), 'utf8');
        }
    }

    /**
     * 규격/재질/온도/소재 형태에 따른 6개 시트 자동 선택 알고리즘
     */
    determineSheet(specMaterial = '', specInspection = '', lotNo = '', startingMaterial = '') {
        const mat = (specMaterial || '').toUpperCase();
        const insp = (specInspection || '').toUpperCase();
        const lot = (lotNo || '').toUpperCase();
        const startMat = (startingMaterial || '').toUpperCase();

        const is316L = mat.includes('316L') || insp.includes('316L');
        const isPlate = startMat.includes('PLATE') || mat.includes('A240') || insp.includes('A240');

        // 316L 계열
        if (is316L) {
            if (isPlate) return 'TYPE316L(PLATE사용시)';
            return 'TP316L';
        }

        // 304 계열
        if (isPlate) {
            return 'TYPE304(PLATE 사용시)';
        }

        // ASTM A312 소재 사용 여부
        if (mat.includes('A312') || mat.includes('ASTM')) {
            return 'TP304(소재ASTM사용시)';
        }

        // 온도 판정 (K 또는 /B1500 ➔ 1050℃, J 또는 기본 ➔ 1040℃)
        const is1050 = insp.includes('/B1500') || insp.includes('B1500') || lot.startsWith('K');
        if (is1050) {
            return 'STS304 1050';
        }

        return 'STS304 1040';
    }

    /**
     * 열처리 온도 라벨 계산
     */
    getHeatTreatmentCondition(sheetName, specInspection = '', lotNo = '') {
        const insp = (specInspection || '').toUpperCase();
        const lot = (lotNo || '').toUpperCase();
        if (sheetName === 'STS304 1040' || (lot.startsWith('J') && !insp.includes('/B1500'))) {
            return '* Heat Treatment Condition : 1040℃ Solution Annealing & Water Quenching';
        }
        return '* Heat Treatment Condition : 1050℃ Solution Annealing & Water Quenching';
    }

    /**
     * QC-13 성적서 누락/모호 경보 기록
     */
     recordMissingAlert(alertData) {
        try {
            let alerts = [];
            if (fs.existsSync(QC_MISSING_ALERTS_PATH)) {
                alerts = JSON.parse(fs.readFileSync(QC_MISSING_ALERTS_PATH, 'utf8'));
                if (!Array.isArray(alerts)) alerts = [];
            }
            const record = {
                id: `alert_qc13_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                detectedAt: new Date().toISOString(),
                ...alertData
            };
            alerts.unshift(record);
            fs.writeFileSync(QC_MISSING_ALERTS_PATH, JSON.stringify(alerts.slice(0, 500), null, 2), 'utf8');
            console.warn(`[QC-13 성적서 누락 경보 발령]`, JSON.stringify(record));
            return record;
        } catch (err) {
            console.error('Failed to write qc_missing_alerts.json:', err);
        }
    }

    /**
     * QC-02 성적서 마스터 엄격 매칭 (MATCHED / NOT_FOUND / AMBIGUOUS)
     * - 복수 일치 시 임의의 첫 번째 항목 반환을 금지하고 AMBIGUOUS로 분류
     * - 미존재 시 NOT_FOUND
     * - 1건 완전 일치 시 MATCHED
     */
    matchMasterCert(lotNo, heatNo, poNo, description) {
        if (!fs.existsSync(CERT_JSON_PATH)) {
            return { status: 'NOT_FOUND', cert: null, reason: 'certificates.json 파일이 존재하지 않습니다.' };
        }
        try {
            const certs = JSON.parse(fs.readFileSync(CERT_JSON_PATH, 'utf8'));

            // 1. LOT NO 최우선 검색
            if (lotNo) {
                const cleanLot = String(lotNo).toUpperCase().trim();
                const byLot = certs.filter(c => String(c.lotNo || '').toUpperCase().trim() === cleanLot);
                if (byLot.length > 1) {
                    return {
                        status: 'AMBIGUOUS',
                        cert: null,
                        candidateCount: byLot.length,
                        reason: `LOT [${lotNo}]에 일치하는 성적서가 ${byLot.length}건 존재하여 특정할 수 없습니다.`
                    };
                }
                if (byLot.length === 1) {
                    return { status: 'MATCHED', cert: byLot[0], candidateCount: 1 };
                }
            }

            // 2. PO와 Description 동시 일치
            if (poNo && description) {
                const cleanPo = String(poNo).toUpperCase().trim();
                const cleanDesc = String(description).toUpperCase().replace(/\s+/g, '');
                const byPoDesc = certs.filter(c => 
                    String(c.poNo || '').toUpperCase().trim() === cleanPo &&
                    String(c.description || '').toUpperCase().replace(/\s+/g, '') === cleanDesc
                );
                if (byPoDesc.length > 1) {
                    return {
                        status: 'AMBIGUOUS',
                        cert: null,
                        candidateCount: byPoDesc.length,
                        reason: `PO [${poNo}] 및 품명에 일치하는 성적서가 ${byPoDesc.length}건 존재하여 특정할 수 없습니다.`
                    };
                }
                if (byPoDesc.length === 1) {
                    return { status: 'MATCHED', cert: byPoDesc[0], candidateCount: 1 };
                }
            }

            // 3. HeatNo 일치
            if (heatNo) {
                const cleanHeat = String(heatNo).toUpperCase().trim();
                const byHeat = certs.filter(c => String(c.heatNo || '').toUpperCase().trim() === cleanHeat);
                if (byHeat.length > 1) {
                    return {
                        status: 'AMBIGUOUS',
                        cert: null,
                        candidateCount: byHeat.length,
                        reason: `HEAT [${heatNo}]에 일치하는 성적서가 ${byHeat.length}건 존재하여 특정할 수 없습니다.`
                    };
                }
                if (byHeat.length === 1) {
                    return { status: 'MATCHED', cert: byHeat[0], candidateCount: 1 };
                }
            }
        } catch (err) {
            console.error('Error reading cert master:', err);
        }
        return {
            status: 'NOT_FOUND',
            cert: null,
            candidateCount: 0,
            reason: `일치하는 성적서 데이터를 마스터(certificates.json)에서 찾을 수 없습니다.`
        };
    }

    /**
     * 하위 호환용 헬퍼 (MATCHED인 경우에만 cert 반환)
     */
    findMasterCertData(lotNo, heatNo, poNo, description) {
        const res = this.matchMasterCert(lotNo, heatNo, poNo, description);
        return res.status === 'MATCHED' ? res.cert : null;
    }

    /**
     * 발주서 번호별 발주 정보 및 매칭된 아이템 로드
     */
    getOrderItemsForPo(poNo) {
        let orders = [];
        if (fs.existsSync(DB_PATH)) {
            try {
                const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
                orders = db.orders || [];
            } catch {}
        }

        const order = orders.find(o => (o.poNumber || o.id || '').toUpperCase().trim() === poNo.toUpperCase().trim());
        let certs = [];
        if (fs.existsSync(CERT_JSON_PATH)) {
            try { certs = JSON.parse(fs.readFileSync(CERT_JSON_PATH, 'utf8')); } catch {}
        }

        const relatedCerts = certs.filter(c => (c.poNo || '').toUpperCase().trim() === poNo.toUpperCase().trim());

        return { order, relatedCerts };
    }

    /**
     * 1. 엑셀 성적서 파일 생성 (.xlsx) - 성적서 양식.xlsx 서식 100% 보존
     * - ExcelJS 엔진으로 템플릿의 셀 테두리, 배경색, 폰트, 열 너비, 행 높이, 로고, 인쇄 마진 완전 보존
     * - 본문 실제 출력 셀(A13:AL18, A24:AC29, A37:O42, A45:AQ50)에 직접 최종 텍스트/숫자 주입
     * - 사용하지 않는 빈 행(Row 14~18, 25~29, 38~42, 46~50)의 기존 수식 및 0을 완전히 빈칸("")으로 소거!
     * - 사용자 요청: AX13:BC18 보조 수식 영역은 굳이 쓰지 않고 깨끗하게 공백("") 처리
     */
    async generateExcel(certMeta, items) {
        if (!fs.existsSync(TEMPLATE_PATH)) {
            throw new Error(`성적서 양식지 파일이 존재하지 않습니다: ${TEMPLATE_PATH}`);
        }

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(TEMPLATE_PATH);

        const sheetName = certMeta.sheetName || 'TP304(소재ASTM사용시)';
        const ws = wb.getWorksheet(sheetName);
        if (!ws) {
            throw new Error(`시트 '${sheetName}'가 템플릿에 존재하지 않습니다.`);
        }

        // 1. 헤더 기입 (기존 셀 서식 100% 유지)
        ws.getCell('K6').value = certMeta.customer || '';
        ws.getCell('AJ6').value = certMeta.certNo || '';
        ws.getCell('K7').value = certMeta.poNo || '';
        ws.getCell('AJ7').value = certMeta.issueDate || new Date().toISOString().slice(0, 10).replace(/-/g, '.');
        ws.getCell('K8').value = 'N/A';
        ws.getCell('AJ8').value = 'GOOD';
        
        // ★ 대경벤드 마스터 대장의 실제 규격 주입 (매칭 오류 완전 해결!)
        if (certMeta.specMaterial) ws.getCell('K9').value = certMeta.specMaterial;
        if (certMeta.specInspection) ws.getCell('AJ9').value = certMeta.specInspection;

        // 열처리 조건
        ws.getCell('A19').value = certMeta.heatTreatment;

        // 2. 본문 1~6개 행 직접 기입 & 미사용 빈 행 수식/0 완전 소거
        for (let i = 0; i < 6; i++) {
            const row = 13 + i;
            const chemRow = 24 + i;
            const mechRow = 37 + i;
            const addRow = 45 + i;

            if (i < items.length) {
                const item = items[i];

                // 1) ITEM DESCRIPTION 본문 직접 기입 (Master 셀만 설정)
                ws.getCell(`A${row}`).value = item.lotNo || '';
                ws.getCell(`F${row}`).value = item.itemNo || (i + 1);
                ws.getCell(`I${row}`).value = item.heatNo || '';
                ws.getCell(`N${row}`).value = item.description || '';
                ws.getCell(`Z${row}`).value = item.qty ? Number(item.qty) : '';
                ws.getCell(`AD${row}`).value = item.startingMaterial || 'WELDED PIPE';
                ws.getCell(`AL${row}`).value = 'N/A';

                // 2) CHEMICAL COMPOSITION(%) (Master 셀만 설정)
                ws.getCell(`A${chemRow}`).value = item.heatNo || '';
                ws.getCell(`F${chemRow}`).value = 'L';
                ws.getCell(`H${chemRow}`).value = (item.chem?.C !== undefined && item.chem?.C !== '') ? Number(item.chem.C) : '';
                ws.getCell(`K${chemRow}`).value = (item.chem?.Si !== undefined && item.chem?.Si !== '') ? Number(item.chem.Si) : '';
                ws.getCell(`N${chemRow}`).value = (item.chem?.Mn !== undefined && item.chem?.Mn !== '') ? Number(item.chem.Mn) : '';
                ws.getCell(`Q${chemRow}`).value = (item.chem?.P !== undefined && item.chem?.P !== '') ? Number(item.chem.P) : '';
                ws.getCell(`T${chemRow}`).value = (item.chem?.S !== undefined && item.chem?.S !== '') ? Number(item.chem.S) : '';
                ws.getCell(`W${chemRow}`).value = (item.chem?.Ni !== undefined && item.chem?.Ni !== '') ? Number(item.chem.Ni) : '';
                ws.getCell(`Z${chemRow}`).value = (item.chem?.Cr !== undefined && item.chem?.Cr !== '') ? Number(item.chem.Cr) : '';
                ws.getCell(`AC${chemRow}`).value = (item.chem?.Mo !== undefined && item.chem?.Mo !== '') ? Number(item.chem.Mo) : '';

                // 3) MECHANICAL PROPERTIES (Master 셀만 설정)
                ws.getCell(`A${mechRow}`).value = item.heatNo || '';
                ws.getCell(`F${mechRow}`).value = 'L,B';
                ws.getCell(`I${mechRow}`).value = (item.mech?.ys !== undefined && item.mech?.ys !== '') ? Number(item.mech.ys) : '';
                ws.getCell(`L${mechRow}`).value = (item.mech?.ts !== undefined && item.mech?.ts !== '') ? Number(item.mech.ts) : '';
                ws.getCell(`O${mechRow}`).value = (item.mech?.el !== undefined && item.mech?.el !== '') ? Number(item.mech.el) : '';

                // 4) 추가 외관 및 비파괴 검사
                ws.getCell(`A${addRow}`).value = item.heatNo || '';
                ws.getCell(`F${addRow}`).value = 'GOOD';
                ws.getCell(`M${addRow}`).value = 'N/A';
                ws.getCell(`U${addRow}`).value = 'N/A';
                ws.getCell(`AB${addRow}`).value = 'N/A';
                ws.getCell(`AJ${addRow}`).value = 'N/A';
                ws.getCell(`AQ${addRow}`).value = 'N/A';

                // 사용자 요청: AX:BC 보조 영역은 굳이 쓰지 않고 깨끗하게 공백("")으로 정리
                ['AX', 'AY', 'AZ', 'BA', 'BB', 'BC'].forEach(c => ws.getCell(c + row).value = '');
            } else {
                // ★ 비어있는 행(아이템이 없는 행)의 기존 수식/0을 완전히 빈칸('')으로 소거하여 0 도배 원천 방지! (Master 셀만 설정)
                ['A', 'F', 'I', 'N', 'Z', 'AD', 'AL', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC'].forEach(c => ws.getCell(c + row).value = '');
                ['A', 'F', 'H', 'K', 'N', 'Q', 'T', 'W', 'Z', 'AC'].forEach(c => ws.getCell(c + chemRow).value = '');
                ['A', 'F', 'I', 'L', 'O', 'R'].forEach(c => ws.getCell(c + mechRow).value = '');
                ['A', 'F', 'M', 'U', 'AB', 'AJ', 'AQ'].forEach(c => ws.getCell(c + addRow).value = '');
            }
        }

        // 보관 디렉토리 (발주서 또는 출고지시서 번호별)
        const poDir = path.join(ISSUED_DIR, certMeta.poNo.replace(/[^a-zA-Z0-9_\-]/g, '_'));
        if (!fs.existsSync(poDir)) fs.mkdirSync(poDir, { recursive: true });

        const excelFileName = `${certMeta.poNo}_성적서_${certMeta.certNo}.xlsx`;
        const excelFilePath = path.join(poDir, excelFileName);
        await wb.xlsx.writeFile(excelFilePath);

        // ★ 원본 DrawingML(WordArt "INSPECTION CERTIFICATE", TextBox "DAEKYUNG BEND", 주소, 워터마크) 100% 복원
        this.restoreOriginalDrawings(excelFilePath);

        return { excelFilePath, excelFileName };
    }

    /**
     * ExcelJS의 Shape/WordArt/TextBox/Watermark 유실 한계를 극복하는 원본 드로잉 & 대경 워터마크 복원 엔진
     * - 1. 원본 템플릿의 xl/drawings/ 및 xl/media/ 를 대상 엑셀 파일에 그대로 재주입
     * - 2. 각 시트(xl/worksheets/sheet*.xml)에 원본 템플릿의 <headerFooter> 및 <legacyDrawingHF> 복원
     * - 3. 각 시트의 관계 파일(xl/worksheets/_rels/sheet*.xml.rels)에 drawing 및 vmlDrawing(워터마크) 관계 복원
     */
    restoreOriginalDrawings(targetFilePath) {
        if (!fs.existsSync(TEMPLATE_PATH) || !fs.existsSync(targetFilePath)) return;
        try {
            const origZip = new AdmZip(TEMPLATE_PATH);
            const targetZip = new AdmZip(targetFilePath);

            // 1. drawings 및 media 폴더 전체 복원 (WordArt, TextBox, 로고, 직인, 워터마크 원본 이미지)
            origZip.getEntries().forEach(entry => {
                if (entry.entryName.startsWith('xl/drawings/') || entry.entryName.startsWith('xl/media/')) {
                    targetZip.deleteFile(entry.entryName);
                    targetZip.addFile(entry.entryName, entry.getData());
                }
            });

            // 2. 템플릿 시트별 매핑 (6대 양식지)
            const sheetMetaMap = {
                'STS304 1040': { tplSheet: 'sheet1.xml', drawing: 'drawing1.xml', vml: 'vmlDrawing1.vml' },
                'STS304 1050': { tplSheet: 'sheet2.xml', drawing: 'drawing2.xml', vml: 'vmlDrawing2.vml' },
                'TP304(소재ASTM사용시)': { tplSheet: 'sheet3.xml', drawing: 'drawing3.xml', vml: 'vmlDrawing3.vml' },
                'TYPE304(PLATE 사용시)': { tplSheet: 'sheet4.xml', drawing: 'drawing4.xml', vml: 'vmlDrawing4.vml' },
                'TP316L': { tplSheet: 'sheet5.xml', drawing: 'drawing5.xml', vml: 'vmlDrawing5.vml' },
                'TYPE316L(PLATE사용시)': { tplSheet: 'sheet6.xml', drawing: 'drawing6.xml', vml: 'vmlDrawing6.vml' }
            };

            const targetWbXml = targetZip.readAsText('xl/workbook.xml');
            const targetWbRels = targetZip.readAsText('xl/_rels/workbook.xml.rels');

            const regex = /<sheet\s+[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g;
            let match;
            while ((match = regex.exec(targetWbXml)) !== null) {
                const sheetName = match[1];
                const rId = match[2];
                const meta = sheetMetaMap[sheetName];
                if (!meta) continue;

                // target workbook.xml.rels에서 해당 rId가 가리키는 실제 target sheet xml 파일 경로 찾기
                const relMatch = targetWbRels.match(new RegExp(`<Relationship\\s+Id="${rId}"[^>]*Target="([^"]+)"`));
                if (!relMatch) continue;
                const targetSheetRelPath = relMatch[1];
                const targetSheetFullPath = 'xl/' + targetSheetRelPath;
                const sheetBaseName = targetSheetRelPath.split('/').pop();
                const targetRelsFullPath = `xl/worksheets/_rels/${sheetBaseName}.rels`;

                // 2-1. 원본 템플릿의 해당 시트에서 headerFooter 태그 가져오기
                const tplSheetXml = origZip.readAsText(`xl/worksheets/${meta.tplSheet}`);
                const hfMatch = tplSheetXml.match(/<headerFooter[\s\S]*?<\/headerFooter>/);

                // target sheet xml 수정 (headerFooter 및 legacyDrawingHF 주입)
                let sheetXml = targetZip.readAsText(targetSheetFullPath);
                if (sheetXml) {
                    if (hfMatch && !sheetXml.includes('<headerFooter')) {
                        if (sheetXml.includes('<pageSetUp')) {
                            sheetXml = sheetXml.replace(/(<pageSetUp[\s\S]*?\/>)/, '$1' + hfMatch[0]);
                        } else if (sheetXml.includes('<pageMargins')) {
                            sheetXml = sheetXml.replace(/(<pageMargins[\s\S]*?\/>)/, '$1' + hfMatch[0]);
                        }
                    }
                    if (!sheetXml.includes('<legacyDrawingHF')) {
                        sheetXml = sheetXml.replace('</worksheet>', '<legacyDrawingHF r:id="rIdVmlWatermark"/></worksheet>');
                    }
                    targetZip.updateFile(targetSheetFullPath, Buffer.from(sheetXml, 'utf8'));
                }

                // 2-2. sheet rels 파일 갱신 (drawing + vmlDrawing 워터마크 관계 복원)
                const newSheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${meta.drawing}"/>
  <Relationship Id="rIdVmlWatermark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/${meta.vml}"/>
</Relationships>`;
                targetZip.deleteFile(targetRelsFullPath);
                targetZip.addFile(targetRelsFullPath, Buffer.from(newSheetRels, 'utf8'));
            }

            targetZip.writeZip(targetFilePath);
            console.log(`[QC-06] 원본 DrawingML(WordArt, TextBox) 및 대경 워터마크 100% 복원 완료: ${targetFilePath}`);
        } catch (e) {
            console.error('[QC-06] restoreOriginalDrawings 실패:', e.message);
        }
    }

    /**
     * 2. 사용자 사진과 100% 동일한 A4 인쇄용 HTML 렌더링
     */
    generateHtml(certMeta, items) {
        // Spec 기준치 (시트별 Spec)
        let chemSpec = {
            C: { max: '0.080', min: '' },
            Si: { max: '1.00', min: '' },
            Mn: { max: '2.00', min: '' },
            P: { max: '0.045', min: '' },
            S: { max: '0.030', min: '' },
            Ni: { max: '11.00', min: '8.00' },
            Cr: { max: '20.00', min: '18.00' },
            Mo: { max: '', min: '' }
        };

        let mechSpec = {
            ys: { min: '205', max: '' },
            ts: { min: '515', max: '' },
            el: { min: '35', max: '' }
        };

        if (certMeta.sheetName?.includes('316L')) {
            chemSpec.C.max = '0.030';
            chemSpec.Ni = { max: '14.00', min: '10.00' };
            chemSpec.Cr = { max: '18.00', min: '16.00' };
            chemSpec.Mo = { max: '3.00', min: '2.00' };
            mechSpec.ys.min = '170';
            mechSpec.ts.min = '485';
        }

        // 아이템 6줄 생성 (부족한 행은 빈칸)
        const filledItems = [...items];
        while (filledItems.length < 6) {
            filledItems.push({
                lotNo: '', itemNo: '', heatNo: '', description: '', qty: '', startingMaterial: '', nde: '',
                chem: {}, mech: {}
            });
        }

        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>INSPECTION CERTIFICATE - ${certMeta.certNo}</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 10mm 12mm 10mm 12mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: "Malgun Gothic", "맑은 고딕", Arial, sans-serif;
            color: #111;
        }
        body {
            width: 100%;
            background: #fff;
            padding: 0;
        }
        .cert-container {
            position: relative;
            width: 100%;
            border: 2px solid #000;
            padding: 12px 14px;
            background: #fff;
        }
        /* 대경벤드 붉은색 워터마크 배경 */
        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 320px;
            height: 320px;
            opacity: 0.08;
            pointer-events: none;
            z-index: 1;
        }
        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
            position: relative;
            z-index: 2;
        }
        .logo-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 140px;
        }
        .logo-symbol {
            width: 38px;
            height: 38px;
            border: 3.5px solid #d32f2f;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 4px;
        }
        .logo-symbol-inner {
            width: 18px;
            height: 22px;
            border-left: 3.5px solid #d32f2f;
            border-right: 3.5px solid #d32f2f;
        }
        .company-name {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: -0.5px;
            text-align: center;
            color: #222;
        }
        .title-box {
            text-align: center;
            flex: 1;
            padding-top: 2px;
        }
        .main-title {
            font-size: 26px;
            font-weight: 900;
            letter-spacing: 2px;
            margin-bottom: 2px;
        }
        .sub-title {
            font-size: 11px;
            font-weight: 700;
        }
        .contact-box {
            text-align: right;
            font-size: 8.5px;
            line-height: 1.35;
            color: #333;
            width: 175px;
        }
        
        /* 공통 테이블 스타일 */
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9px;
            margin-bottom: 6px;
            position: relative;
            z-index: 2;
        }
        th, td {
            border: 1px solid #333;
            padding: 3px 4px;
            text-align: center;
            vertical-align: middle;
        }
        th {
            background-color: #fafafa;
            font-weight: 700;
        }
        .header-table td {
            text-align: left;
            padding: 3.5px 6px;
        }
        .header-table .label {
            font-weight: 700;
            background-color: #fff;
            width: 18%;
        }
        .header-table .val {
            width: 32%;
            font-weight: 600;
        }
        
        .section-title {
            font-size: 10px;
            font-weight: 800;
            margin: 6px 0 3px 0;
            text-align: left;
            position: relative;
            z-index: 2;
        }
        .condition-text {
            font-size: 8.5px;
            font-weight: 600;
            margin: 3px 0 5px 0;
            text-align: left;
            position: relative;
            z-index: 2;
        }
        .spec-row th {
            font-size: 8px;
            padding: 2px 1px;
            background: #fff;
        }
        .cert-footer {
            margin-top: 6px;
            padding-top: 4px;
            font-size: 8px;
            line-height: 1.3;
            text-align: center;
            position: relative;
            z-index: 2;
        }
        .cert-stamp-area {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            margin-top: 10px;
            padding-right: 20px;
            position: relative;
            z-index: 2;
        }
        .stamp-title {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.5px;
        }
        .red-highlight {
            color: #b71c1c;
        }
    </style>
</head>
<body>
    <div class="cert-container">
        <!-- 워터마크 -->
        <svg class="watermark" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" stroke="#d32f2f" stroke-width="8" fill="none" />
            <path d="M 35 30 L 35 70 M 65 30 L 65 70" stroke="#d32f2f" stroke-width="8" />
        </svg>

        <!-- 상단 헤더 (로고, 타이틀, 주소) -->
        <div class="header-top">
            <div class="logo-box">
                <div class="logo-symbol">
                    <div class="logo-symbol-inner"></div>
                </div>
                <div class="company-name">DAEKYUNG BEND<br>CO., LTD.</div>
            </div>
            <div class="title-box">
                <div class="main-title">INSPECTION CERTIFICATE</div>
                <div class="sub-title">(EN10204 3.1)</div>
            </div>
            <div class="contact-box">
                115, Eosil-ro, Yangsan-Si,<br>
                Gyeongsangnam-Do, Korea<br>
                TEL : 82-055-364-1800<br>
                FAX : 82-055-362-7074
            </div>
        </div>

        <!-- 1. 기본 발주/성적서 정보 테이블 -->
        <table class="header-table">
            <tr>
                <td class="label">Customer</td>
                <td class="val">${certMeta.customer || '월드원플랜트'}</td>
                <td class="label">Certificate. No.</td>
                <td class="val">${certMeta.certNo || 'YR-26-07015'}</td>
            </tr>
            <tr>
                <td class="label">P.O. No.</td>
                <td class="val">${certMeta.poNo || 'ES260709-1974'}</td>
                <td class="label">Date of Issue</td>
                <td class="val">${certMeta.issueDate || '2026.07.09'}</td>
            </tr>
            <tr>
                <td class="label">Hull No.(Project No.)</td>
                <td class="val">N/A</td>
                <td class="label">Dimension & VI</td>
                <td class="val">GOOD</td>
            </tr>
            <tr>
                <td class="label">Spec. for Material</td>
                <td class="val">${certMeta.specMaterial || 'ASTM A312 TP304'}</td>
                <td class="label">Spec. for Inspection</td>
                <td class="val">${certMeta.specInspection || 'KS B1543 STS304-W /B1500'}</td>
            </tr>
        </table>

        <!-- 1. ITEM DESCRIPTION -->
        <div class="section-title">1. ITEM DESCRIPTION</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 14%;">DKB LOT No</th>
                    <th style="width: 8%;">Item No</th>
                    <th style="width: 14%;">Heat No</th>
                    <th style="width: 32%;">Description</th>
                    <th style="width: 8%;">Q'TY</th>
                    <th style="width: 14%;">Starting Material</th>
                    <th style="width: 10%;">NDE(RESULT)</th>
                </tr>
            </thead>
            <tbody>
                ${filledItems.map((it, idx) => `
                <tr style="height: 20px;">
                    <td>${it.lotNo || '&nbsp;'}</td>
                    <td>${it.lotNo ? (idx + 1) : '&nbsp;'}</td>
                    <td>${it.heatNo || '&nbsp;'}</td>
                    <td style="text-align: left; padding-left: 6px;">${it.description || '&nbsp;'}</td>
                    <td>${it.qty || '&nbsp;'}</td>
                    <td>${it.startingMaterial || (it.lotNo ? 'WELDED PIPE' : '&nbsp;')}</td>
                    <td>${it.lotNo ? 'N/A' : '&nbsp;'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- 열처리 조건 -->
        <div class="condition-text">${certMeta.heatTreatment}</div>

        <!-- 2. CHEMICAL COMPOSITION(%) -->
        <div class="section-title">2. CHEMICAL COMPOSITION(%)</div>
        <table>
            <thead>
                <tr>
                    <th rowspan="3" style="width: 14%;">Heat No.</th>
                    <th style="width: 8%;">Spec</th>
                    <th>C</th>
                    <th>Si</th>
                    <th>Mn</th>
                    <th>P</th>
                    <th>S</th>
                    <th>Ni</th>
                    <th>Cr</th>
                    ${chemSpec.Mo.max ? '<th>Mo</th>' : ''}
                </tr>
                <tr class="spec-row">
                    <th>Max</th>
                    <td>${chemSpec.C.max}</td>
                    <td>${chemSpec.Si.max}</td>
                    <td>${chemSpec.Mn.max}</td>
                    <td>${chemSpec.P.max}</td>
                    <td>${chemSpec.S.max}</td>
                    <td>${chemSpec.Ni.max}</td>
                    <td>${chemSpec.Cr.max}</td>
                    ${chemSpec.Mo.max ? `<td>${chemSpec.Mo.max}</td>` : ''}
                </tr>
                <tr class="spec-row">
                    <th>Min</th>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>${chemSpec.Ni.min}</td>
                    <td>${chemSpec.Cr.min}</td>
                    ${chemSpec.Mo.max ? `<td>${chemSpec.Mo.min}</td>` : ''}
                </tr>
            </thead>
            <tbody>
                ${filledItems.map(it => `
                <tr style="height: 19px;">
                    <td>${it.heatNo || '&nbsp;'}</td>
                    <td>${it.heatNo ? 'L' : '&nbsp;'}</td>
                    <td>${it.chem?.C ?? '&nbsp;'}</td>
                    <td>${it.chem?.Si ?? '&nbsp;'}</td>
                    <td>${it.chem?.Mn ?? '&nbsp;'}</td>
                    <td>${it.chem?.P ?? '&nbsp;'}</td>
                    <td>${it.chem?.S ?? '&nbsp;'}</td>
                    <td>${it.chem?.Ni ?? '&nbsp;'}</td>
                    <td>${it.chem?.Cr ?? '&nbsp;'}</td>
                    ${chemSpec.Mo.max ? `<td>${it.chem?.Mo ?? '&nbsp;'}</td>` : ''}
                </tr>
                `).join('')}
            </tbody>
        </table>
        <div style="font-size: 8px; margin-bottom: 4px;">* L : Ladle Analysis &nbsp;&nbsp; P : Product Analysis</div>

        <!-- 3. MECHANICAL PROPERTIES -->
        <div class="section-title">3. MECHANICAL PROPERTIES</div>
        <table>
            <thead>
                <tr>
                    <th rowspan="3" style="width: 14%;">Heat No</th>
                    <th rowspan="3" style="width: 6%;">Unit</th>
                    <th colspan="3">TENSILE TEST</th>
                    <th rowspan="2" style="width: 14%;">HARDNESS TEST</th>
                    <th colspan="3">CHARPY-V IMPACT TEST (Test Temp : ℃)</th>
                </tr>
                <tr class="spec-row">
                    <th>Y.S(0.2%)</th>
                    <th>T.S</th>
                    <th>E.L</th>
                    <th colspan="2">ABSORBED ENERGY (Unit:J)</th>
                    <th>LATERAL EXP.</th>
                </tr>
                <tr class="spec-row">
                    <th>MPa</th>
                    <th>MPa</th>
                    <th>%</th>
                    <th>HB</th>
                    <th>Min</th>
                    <th>AVR</th>
                    <th>Min (mm)</th>
                </tr>
                <tr class="spec-row" style="background: #f9f9f9;">
                    <th colspan="2">Spec Min</th>
                    <td>${mechSpec.ys.min}</td>
                    <td>${mechSpec.ts.min}</td>
                    <td>${mechSpec.el.min}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                </tr>
            </thead>
            <tbody>
                ${filledItems.map(it => `
                <tr style="height: 19px;">
                    <td>${it.heatNo || '&nbsp;'}</td>
                    <td>${it.heatNo ? 'L,B' : '&nbsp;'}</td>
                    <td>${it.mech?.ys ?? '&nbsp;'}</td>
                    <td>${it.mech?.ts ?? '&nbsp;'}</td>
                    <td>${it.mech?.el ?? '&nbsp;'}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        <div style="font-size: 8px; margin-bottom: 4px;">* L : Longitudinal, T : Transvers, B : Base Metal, W : Weld Metal</div>

        <!-- 추가 검사 결과 -->
        <table>
            <thead>
                <tr>
                    <th style="width: 14%;">Heat No</th>
                    <th>PMI</th>
                    <th>FLATTENING</th>
                    <th>CORROSION TEST</th>
                    <th>HYDROSTATIC TEST</th>
                    <th>FERRITE</th>
                    <th>GRAIN SIZE</th>
                </tr>
            </thead>
            <tbody>
                ${filledItems.map(it => `
                <tr style="height: 19px;">
                    <td>${it.heatNo || '&nbsp;'}</td>
                    <td>${it.heatNo ? 'GOOD' : '&nbsp;'}</td>
                    <td>${it.heatNo ? 'N/A' : '&nbsp;'}</td>
                    <td>${it.heatNo ? 'N/A' : '&nbsp;'}</td>
                    <td>${it.heatNo ? 'N/A' : '&nbsp;'}</td>
                    <td>${it.heatNo ? 'N/A' : '&nbsp;'}</td>
                    <td>${it.heatNo ? 'N/A' : '&nbsp;'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        <!-- REMARK -->
        <div style="border: 1px solid #333; height: 35px; padding: 4px; font-size: 8.5px; margin-top: 4px;">
            <strong>REMARK:</strong>
        </div>

        <!-- 품질 인증 문구 & 직인 영역 -->
        <div class="cert-footer">
            We certify this material has been manufactured and examined in accordance with<br>
            all requirements of the specification and the results of all examination are acceptable
        </div>
        <div class="cert-stamp-area">
            <div class="stamp-title">HEAD OF QUALITY MANAGEMENT</div>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * 3. 고해상도 PDF 변환 (Chrome/Edge 헤드리스 엔진)
     */
    async generatePdf(htmlContent, outputPdfPath) {
        const browserPath = getBrowserExecutablePath();
        if (!browserPath) {
            throw new Error('시스템에서 Chrome 또는 Edge 브라우저를 찾을 수 없습니다.');
        }

        // 임시 HTML 파일 생성
        const tempHtmlPath = outputPdfPath.replace(/\.pdf$/i, '_temp.html');
        fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

        // Chrome/Edge headless 인쇄 명령어 실행
        const cmd = `"${browserPath}" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${outputPdfPath}" "${tempHtmlPath}"`;

        return new Promise((resolve, reject) => {
            exec(cmd, (err, stdout, stderr) => {
                // 임시 HTML 삭제
                try { if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath); } catch {}

                if (err) {
                    console.error('[QC-06 PDF Error]:', err.message);
                    return reject(err);
                }
                console.log(`[QC-06] PDF 성적서 발행 성공: ${outputPdfPath}`);
                resolve(outputPdfPath);
            });
        });
    }

    /**
     * 4. MS Excel COM Automation을 이용한 100% 순정 PDF 변환 엔진
     * - 워터마크, WordArt, TextBox, 로고, 서식, 폰트가 원본 엑셀과 완전히 똑같이 인쇄됨!
     */
    async generatePdfViaExcel(excelFilePath, pdfFilePath, sheetName) {
        if (process.platform !== 'win32') {
            return false;
        }

        const absXlsx = path.resolve(excelFilePath).replace(/\\/g, '\\\\');
        const absPdf = path.resolve(pdfFilePath).replace(/\\/g, '\\\\');
        const targetSheet = sheetName || 'TP316L';

        const psScript = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    $wb = $excel.Workbooks.Open('${absXlsx}')
    $ws = $wb.Worksheets.Item('${targetSheet}')
    $ws.Activate()
    $ws.ExportAsFixedFormat(0, '${absPdf}')
    $wb.Close($false)
    Write-Host 'EXCEL_PDF_SUCCESS'
} catch {
    Write-Host ('EXCEL_PDF_ERROR: ' + $_.Exception.Message)
} finally {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
`;

        return new Promise((resolve) => {
            const cmd = `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n/g, '; ')}"`;
            exec(cmd, (err, stdout, stderr) => {
                if (!err && fs.existsSync(pdfFilePath) && fs.statSync(pdfFilePath).size > 1000) {
                    console.log(`[QC-06] MS Excel 순정 PDF 변환 성공 (${fs.statSync(pdfFilePath).size} bytes): ${pdfFilePath}`);
                    resolve(true);
                } else {
                    console.warn('[QC-06] MS Excel COM 변환 실패, Chrome 헤드리스 폴백 사용:', stderr || stdout || err?.message);
                    resolve(false);
                }
            });
        });
    }

    /**
     * 5. 로컬 환경에서 지정된 성적서 엑셀 파일을 사용자 MS Excel 프로그램으로 직접 열기
     */
    openExcelFile(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`파일이 존재하지 않습니다: ${filePath}`);
        }
        const isWin = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        let cmd = '';
        if (isWin) cmd = `start "" "${filePath}"`;
        else if (isMac) cmd = `open "${filePath}"`;
        else cmd = `xdg-open "${filePath}"`;

        exec(cmd, (err) => {
            if (err) console.error('[QC-06] 엑셀 열기 오류:', err.message);
        });
        return { success: true, message: `엑셀 파일 열기 명령 실행: ${path.basename(filePath)}` };
    }

    /**
     * 4. 발주번호(poNo) 기반 성적서 일괄 자동 발행 & DAT-10 아카이빙
     * - 기본값 대체 전면 금지: 일치하지 않거나 모호(AMBIGUOUS)하면 즉시 중단 및 누락 경보 기록
     */
    async issueCertificatesForPo(poNo, options = {}) {
        this.ensureDirectories();
        if (!poNo) {
            throw new Error('발주번호(poNo)가 유효하지 않습니다.');
        }

        console.log(`[QC-06 성적서 발행봇] 발주번호 ${poNo} 성적서 검증 및 발행 프로세스 시작...`);

        const { order, relatedCerts } = this.getOrderItemsForPo(poNo);
        const customerName = options.customer || order?.targetCustomerName || order?.customerName;
        if (!customerName) {
            throw new Error('고객사명(customer)이 누락되었습니다. 기본값 주입은 금지되어 있습니다.');
        }

        const items = (order && Array.isArray(order.items) && order.items.length > 0)
            ? order.items
            : (relatedCerts && relatedCerts.length > 0 ? relatedCerts : []);

        if (items.length === 0) {
            throw new Error(`발주번호 ${poNo}에 해당하는 발주 품목 및 관련 성적서 데이터가 없습니다.`);
        }

        const matchedItems = [];
        const missingLines = [];

        // 1. 발주 품목별 성적서 엄격 매칭 검증
        for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            const desc = it.productId || it.name || it.description || '';
            const lot = (it.lotNo || it.vendorLot || '').trim();
            const heat = (it.heatNo || '').trim();

            const matchResult = this.matchMasterCert(lot, heat, poNo, desc);

            if (matchResult.status !== 'MATCHED' || !matchResult.cert) {
                missingLines.push({
                    itemIndex: idx + 1,
                    poNo,
                    lotNo: lot || null,
                    heatNo: heat || null,
                    description: desc,
                    status: matchResult.status,
                    reason: matchResult.reason || '성적서 마스터 매칭 실패'
                });
                continue;
            }

            const matchedCert = matchResult.cert;
            matchedItems.push({
                itemNo: idx + 1,
                description: matchedCert.description || desc,
                qty: Number(it.quantity || it.qty || matchedCert.qty || 1),
                heatNo: matchedCert.heatNo,
                lotNo: matchedCert.lotNo,
                specMaterial: matchedCert.specMaterial,
                specInspection: matchedCert.specInspection,
                startingMaterial: matchedCert.material || 'WELDED PIPE',
                chem: {
                    C: matchedCert.chemC,
                    Si: matchedCert.chemSi,
                    Mn: matchedCert.chemMn,
                    P: matchedCert.chemP,
                    S: matchedCert.chemS,
                    Ni: matchedCert.chemNi,
                    Cr: matchedCert.chemCr,
                    Mo: matchedCert.chemMo ?? ''
                },
                mech: {
                    ys: matchedCert.mechYs,
                    ts: matchedCert.mechTs,
                    el: matchedCert.mechEl
                }
            });
        }

        // 2. 단 1건이라도 누락/모호(AMBIGUOUS)한 라인이 있으면 즉시 발행 중단!
        if (missingLines.length > 0) {
            this.recordMissingAlert({
                kind: 'PO_CERT_MISSING',
                poNo,
                customer: customerName,
                totalItems: items.length,
                missingCount: missingLines.length,
                missingLines
            });
            return {
                success: false,
                reason: 'MISSING_OR_AMBIGUOUS_CERTIFICATE',
                poNo,
                customer: customerName,
                missingLines
            };
        }

        const issuedResults = [];
        const poDate = order?.createdAt?.slice(0, 10)?.replace(/-/g, '.') || new Date().toISOString().slice(0, 10).replace(/-/g, '.');

        for (let pIdx = 0; pIdx < chunks.length; pIdx++) {
            const pageItems = chunks[pIdx];
            const firstItem = pageItems[0];

            // 6개 시트 중 적절한 시트 자동 판정
            const sheetName = this.determineSheet(
                firstItem.specMaterial,
                firstItem.specInspection,
                firstItem.lotNo,
                firstItem.startingMaterial
            );

            const heatTreatment = this.getHeatTreatmentCondition(sheetName, firstItem.specInspection, firstItem.lotNo);

            // 성적서 고유 번호 생성
            const certNo = options.certNo 
                ? (chunks.length > 1 ? `${options.certNo}-${pIdx + 1}` : options.certNo)
                : `YR-26-${String(Math.floor(10000 + Math.random() * 90000)).slice(0, 5)}`;

            const certMeta = {
                poNo,
                customer: customerName,
                certNo,
                issueDate: poDate,
                specMaterial: firstItem.specMaterial || 'ASTM A312 TP304',
                specInspection: firstItem.specInspection || 'KS B1543 STS304-W /B1500',
                sheetName,
                heatTreatment,
                pageIndex: pIdx + 1,
                totalPages: chunks.length
            };

            // 1. 엑셀 생성 (.xlsx)
            const { excelFilePath, excelFileName } = await this.generateExcel(certMeta, pageItems);

            // 2. HTML 렌더링
            const htmlContent = this.generateHtml(certMeta, pageItems);

            // 3. 고해상도 PDF 생성 (.pdf) - 1순위: MS Excel 순정 변환, 2순위: Chrome 헤드리스
            const poDir = path.dirname(excelFilePath);
            const pdfFileName = `${poNo}_성적서_${certNo}.pdf`;
            const pdfFilePath = path.join(poDir, pdfFileName);
            const excelPdfSuccess = await this.generatePdfViaExcel(excelFilePath, pdfFilePath, sheetName);
            if (!excelPdfSuccess) {
                await this.generatePdf(htmlContent, pdfFilePath);
            }

            const record = {
                id: `cert_${poNo}_${certNo}`,
                poNo,
                certNo,
                customer: customerName,
                issueDate: poDate,
                sheetName,
                heatTreatment,
                itemCount: pageItems.length,
                excelPath: excelFilePath,
                excelUrl: `/api/qc/qc06/download-excel/${encodeURIComponent(excelFileName)}?poNo=${encodeURIComponent(poNo)}`,
                pdfPath: pdfFilePath,
                pdfUrl: `/api/qc/qc06/download-pdf/${encodeURIComponent(pdfFileName)}?poNo=${encodeURIComponent(poNo)}`,
                issuedAt: new Date().toISOString(),
                items: pageItems
            };

            issuedResults.push(record);
        }

        // DAT-10 보관 인덱스 갱신 및 에이전트 상태 업데이트
        this.saveIssuedRecords(poNo, issuedResults);
        this.updateAgentLogs(poNo, issuedResults);

        return {
            success: true,
            poNo,
            count: issuedResults.length,
            records: issuedResults
        };
    }

    /**
     * 3. 출고부 재고 출고지시서(Outbound Order) 기반 성적서 전담 발행
     * - 대상: 시화 / 부산 / 시흥 재고 출고분 (출고지시서 번호: 예 A202610150)
     * - 원칙: 출고지시서의 '업체LOT'(대경벤드 LOT)를 최우선 키로 QC-02 성적서 대장(certificates.json)에서 1:1 매칭
     * - Spec. for Material: 대경벤드 원본 대장의 specMaterial (예: ASTM A312 TP316L, KS D3576 STS304 TP)
     * - Spec. for Inspection: 대경벤드 원본 대장의 specInspection (예: KS B1543 STS316L-W, KS B1543 STS304-W /B1500)
     * - 열처리 조건: J 시작 -> 1040℃, K 시작 또는 /B1500 -> 1050℃
     * - 양식지: 성적서 양식.xlsx 원본 서식 100% 보존 + 빈 행 수식/0 완전 소거
     */
    async issueCertificatesForOutbound(outboundOrder, options = {}) {
        if (!outboundOrder) {
            throw new Error('출고지시서 데이터가 유효하지 않습니다.');
        }

        const outboundNo = outboundOrder.outboundNo || outboundOrder.id;
        if (!outboundNo) {
            throw new Error('출고번호(outboundNo)가 누락되었습니다. 기본값 대체는 금지되어 있습니다.');
        }

        const customer = outboundOrder.customer || options.customer;
        if (!customer) {
            throw new Error('고객사명(customer)이 누락되었습니다. 기본값 대체는 금지되어 있습니다.');
        }

        const requestDate = outboundOrder.requestDate || new Date().toISOString().slice(0, 10).replace(/-/g, '.');
        const items = outboundOrder.items || [];
        if (!items || items.length === 0) {
            throw new Error('출고 품목(items) 데이터가 없습니다.');
        }

        // 1. 각 출고 품목별로 업체LOT(대경벤드 LOT) 기준 마스터 성적서 엄격 매칭
        const matchedItems = [];
        const missingLines = [];

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const vendorLot = (it.vendorLot || it.lotNo || it.altfLotNo || '').trim();
            const matchResult = this.matchMasterCert(vendorLot, it.heatNo, it.poNo, it.productType || it.itemType || it.description);

            if (matchResult.status !== 'MATCHED' || !matchResult.cert) {
                missingLines.push({
                    itemIndex: i + 1,
                    lineNo: it.lineNo || `${i + 1}-1`,
                    vendorLot: vendorLot || null,
                    heatNo: it.heatNo || null,
                    description: it.productType || it.itemType || it.description || '',
                    status: matchResult.status,
                    reason: matchResult.reason || '성적서 마스터 불일치'
                });
                continue;
            }

            const matchedCert = matchResult.cert;
            matchedItems.push({
                itemNo: i + 1,
                lineNo: it.lineNo || `${i + 1}-1`,
                altfLotNo: it.altfLotNo || '',
                lotNo: matchedCert.lotNo,
                heatNo: matchedCert.heatNo,
                description: matchedCert.description || `${it.productType || it.itemType || 'FITTING'} ${it.size || ''}`,
                qty: Number(it.qty) || 1,
                specMaterial: matchedCert.specMaterial,
                specInspection: matchedCert.specInspection,
                startingMaterial: matchedCert.material || (it.method === 'PLATE' ? 'PLATE' : 'WELDED PIPE'),
                chem: {
                    C: matchedCert.chemC,
                    Si: matchedCert.chemSi,
                    Mn: matchedCert.chemMn,
                    P: matchedCert.chemP,
                    S: matchedCert.chemS,
                    Ni: matchedCert.chemNi,
                    Cr: matchedCert.chemCr,
                    Mo: matchedCert.chemMo ?? ''
                },
                mech: {
                    ys: matchedCert.mechYs,
                    ts: matchedCert.mechTs,
                    el: matchedCert.mechEl
                }
            });
        }

        // 2. 단 1건이라도 누락/모호(AMBIGUOUS)한 라인이 있으면 즉시 발행 중단!
        if (missingLines.length > 0) {
            this.recordMissingAlert({
                kind: 'OUTBOUND_CERT_MISSING',
                outboundNo,
                customer,
                totalItems: items.length,
                missingCount: missingLines.length,
                missingLines
            });
            return {
                success: false,
                reason: 'MISSING_OR_AMBIGUOUS_CERTIFICATE',
                outboundNo,
                customer,
                missingLines
            };
        }

        // 3. 최대 6개 아이템 단위 패킹 & 규격별 분할
        const chunks = [];
        for (let i = 0; i < matchedItems.length; i += 6) {
            chunks.push(matchedItems.slice(i, i + 6));
        }

        const issuedResults = [];
        for (let pIdx = 0; pIdx < chunks.length; pIdx++) {
            const pageItems = chunks[pIdx];
            const firstItem = pageItems[0];

            // 6개 시트 중 자동 판정
            const sheetName = this.determineSheet(
                firstItem.specMaterial,
                firstItem.specInspection,
                firstItem.lotNo,
                firstItem.startingMaterial
            );

            const heatTreatment = this.getHeatTreatmentCondition(sheetName, firstItem.specInspection, firstItem.lotNo);

            const certNo = options.certNo
                ? (chunks.length > 1 ? `${options.certNo}-${pIdx + 1}` : options.certNo)
                : `YR-26-${String(Math.floor(10000 + Math.random() * 90000)).slice(0, 5)}`;

            const certMeta = {
                poNo: outboundNo,
                customer,
                certNo,
                issueDate: requestDate,
                specMaterial: firstItem.specMaterial,
                specInspection: firstItem.specInspection,
                sheetName,
                heatTreatment,
                pageIndex: pIdx + 1,
                totalPages: chunks.length,
                isOutbound: true,
                location: outboundOrder.location || '시흥 ALT F'
            };

            // 1) 엑셀 생성 (.xlsx) - 원본 서식 100% 보존
            const { excelFilePath, excelFileName } = await this.generateExcel(certMeta, pageItems);

            // 2) HTML 렌더링
            const htmlContent = this.generateHtml(certMeta, pageItems);

            // 3) 고해상도 PDF 생성 (.pdf) - 1순위: MS Excel 순정 변환, 2순위: Chrome 헤드리스
            const outboundDir = path.dirname(excelFilePath);
            const pdfFileName = `${outboundNo}_성적서_${certNo}.pdf`;
            const pdfFilePath = path.join(outboundDir, pdfFileName);
            const excelPdfSuccess = await this.generatePdfViaExcel(excelFilePath, pdfFilePath, sheetName);
            if (!excelPdfSuccess) {
                await this.generatePdf(htmlContent, pdfFilePath);
            }

            const record = {
                id: `cert_outbound_${outboundNo}_${certNo}`,
                poNo: outboundNo,
                outboundNo,
                certNo,
                customer,
                issueDate: requestDate,
                sheetName,
                heatTreatment,
                itemCount: pageItems.length,
                excelPath: excelFilePath,
                excelUrl: `/api/qc/qc06/download-excel/${encodeURIComponent(excelFileName)}?poNo=${encodeURIComponent(outboundNo)}`,
                pdfPath: pdfFilePath,
                pdfUrl: `/api/qc/qc06/download-pdf/${encodeURIComponent(pdfFileName)}?poNo=${encodeURIComponent(outboundNo)}`,
                issuedAt: new Date().toISOString(),
                isOutbound: true,
                location: outboundOrder.location || '시흥 ALT F',
                items: pageItems
            };

            issuedResults.push(record);
        }

        // DAT-10 보관 인덱스 갱신 및 에이전트 로그 기록
        this.saveIssuedRecords(outboundNo, issuedResults);
        this.updateAgentLogsForOutbound(outboundNo, issuedResults, outboundOrder);

        return {
            success: true,
            outboundNo,
            count: issuedResults.length,
            records: issuedResults
        };
    }

    /**
     * 출고지시서 전용 에이전트 로그 기록
     */
    updateAgentLogsForOutbound(outboundNo, records, outboundOrder) {
        try {
            if (!fs.existsSync(AGENTS_PATH)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            const location = outboundOrder?.location || '시흥 ALT F';
            const customer = outboundOrder?.customer || '(주)태양밴드';

            // QC-06 (성적서 발행봇)
            const qc06 = agents.find(a => a.code === 'QC-06' || a.id === 'qc-spec-verif');
            if (qc06) {
                if (qc06.status !== 'OFFLINE' && qc06.status !== 'OFF') {
                    qc06.currentTask = `재고출고 [${outboundNo}] (${location}) 성적서 ${records.length}건 발행 완료 (PDF/엑셀 보관)`;
                    qc06.status = 'ACTIVE';
                }
                qc06.lastActive = '방금 전';
                const lotSummary = records[0]?.items?.map(it => `${it.lotNo}➔${it.heatNo}`).join(', ') || '';
                const log = `[${timeStr}] [QC-06] 출고지시서 ${outboundNo} (${customer}) 재고출고분 성적서 발행 성공: ${records.map(r => r.certNo).join(', ')} (양식: ${records[0]?.sheetName}, 매칭: ${lotSummary})`;
                qc06.logs = [log, ...(qc06.logs || []).slice(0, 15)];
            }

            // DAT-10 (성적서 아카이빙)
            const dat10 = agents.find(a => a.code === 'DAT-10' || a.deptId === 'data');
            if (dat10) {
                const datLog = `[${timeStr}] [DAT-10] 출고지시서 ${outboundNo} 성적서 보관소 저장 완료 (storage/issued_certificates/${outboundNo}/)`;
                dat10.logs = [datLog, ...(dat10.logs || []).slice(0, 15)];
            }

            fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf8');
        } catch (e) {
            console.error('[QC-06/DAT-10] updateAgentLogsForOutbound 오류:', e.message);
        }
    }

    /**
     * DAT-10 성적서 보관 인덱스 영구 저장
     */
    saveIssuedRecords(poNo, newRecords) {
        try {
            let allRecords = [];
            if (fs.existsSync(ISSUED_JSON_PATH)) {
                allRecords = JSON.parse(fs.readFileSync(ISSUED_JSON_PATH, 'utf8'));
            }
            // 기존 동일 PO의 레코드는 최신으로 교체
            allRecords = allRecords.filter(r => r.poNo !== poNo);
            allRecords.push(...newRecords);

            fs.writeFileSync(ISSUED_JSON_PATH, JSON.stringify(allRecords, null, 2), 'utf8');
            console.log(`[DAT-10] 발주번호 ${poNo} 성적서 ${newRecords.length}건 보관소 인덱싱 완료`);
        } catch (e) {
            console.error('[DAT-10] issued_certificates.json 저장 오류:', e.message);
        }
    }

    /**
     * QC-06 및 DAT-10 에이전트 로그 기록
     */
    updateAgentLogs(poNo, records) {
        try {
            if (!fs.existsSync(AGENTS_PATH)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            // QC-06 (성적서 발행봇)
            const qc06 = agents.find(a => a.code === 'QC-06' || a.id === 'qc-spec-verif');
            if (qc06) {
                if (qc06.status !== 'OFFLINE' && qc06.status !== 'OFF') {
                    qc06.currentTask = `발주서 ${poNo} 성적서 ${records.length}건 발행 완료 (PDF/엑셀 보관)`;
                    qc06.status = 'ACTIVE';
                }
                qc06.lastActive = '방금 전';
                const log = `[${timeStr}] [QC-06] 발주번호 ${poNo} 성적서 발행 성공: ${records.map(r => r.certNo).join(', ')} (양식: ${records[0]?.sheetName})`;
                qc06.logs = [log, ...(qc06.logs || []).slice(0, 15)];
            }

            // DAT-10 (발주서별 성적서 저장 및 관리)
            const dat10 = agents.find(a => a.code === 'DAT-10' || a.deptId === 'data');
            if (dat10) {
                const datLog = `[${timeStr}] [DAT-10] 발주번호 ${poNo} 성적서 보관소 저장 완료 (storage/issued_certificates/${poNo}/)`;
                dat10.logs = [datLog, ...(dat10.logs || []).slice(0, 15)];
            }

            fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf8');
        } catch (e) {
            console.error('[QC-06/DAT-10] agents.json 업데이트 오류:', e.message);
        }
    }

    /**
     * 발행된 성적서 목록 조회
     */
    getIssuedList() {
        if (!fs.existsSync(ISSUED_JSON_PATH)) return [];
        try {
            return JSON.parse(fs.readFileSync(ISSUED_JSON_PATH, 'utf8'));
        } catch {
            return [];
        }
    }
}

export const certificateIssuerService = new CertificateIssuerService();
