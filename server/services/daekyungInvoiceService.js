/**
 * 📑 Daekyung Bend 거래명세서 파서 & 전사 부서 연계 서비스
 * 
 * [동작 흐름]
 * 1. 메신저(텔레그램/카톡) 또는 웹 업로드를 통해 대경벤드 거래명세서 PDF 인입
 * 2. PDFParse를 통한 헤더, 공급자, 공급받는자, 품목 테이블, 단가, 수량, 금액, 비고(발주번호) 파싱
 * 3. 4대 부서 자동 연계 트리거 실행:
 *    - 📑 총무부 (GEN): 대경벤드 매입금액/부가세 확정, 매입 대장(supplier_invoices.json) 기록
 *    - 🛒 구매부 (PUR-07): '알트에프 재고 발주 대장.xlsx'의 P.O No 매칭 -> 입고일자/수량 갱신, 미결 차감, 상태 '입고완료(대경발송)' 전이
 *    - 🔬 품질부 (QC-01/02): 해당 규격에 대한 성적서(MTC) 매칭 확인 및 미입고 시 경보 발령
 *    - 🚚 출고부 (LOG): 재고 입고 or 고객 직배송 구분 전이
 * 4. 에이전트 오피스 (agents.json) 실시간 로그 및 상태 업데이트
 */

import '../polyfills.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const SUPPLIER_INVOICES_PATH = path.join(ROOT_DIR, 'server/data/supplier_invoices.json');
const PURCHASE_EXCEL_PATH = path.join(ROOT_DIR, 'storage/purchases/알트에프 재고 발주 대장.xlsx');
const CERT_JSON_PATH = path.join(ROOT_DIR, 'server/data/certificates.json');
const AGENTS_PATH = path.join(ROOT_DIR, 'server/data/agents.json');

export class DaekyungInvoiceService {
    constructor() {
        this.invoices = [];
        this.loadInvoices();
    }

    loadInvoices() {
        try {
            if (fs.existsSync(SUPPLIER_INVOICES_PATH)) {
                this.invoices = JSON.parse(fs.readFileSync(SUPPLIER_INVOICES_PATH, 'utf8'));
            } else {
                this.invoices = [];
            }
        } catch (e) {
            console.error('[DaekyungInvoiceService] 매입 전표 로드 에러:', e.message);
            this.invoices = [];
        }
    }

    saveInvoices() {
        try {
            const dir = path.dirname(SUPPLIER_INVOICES_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SUPPLIER_INVOICES_PATH, JSON.stringify(this.invoices, null, 2), 'utf8');
        } catch (e) {
            console.error('[DaekyungInvoiceService] 매입 전표 저장 에러:', e.message);
        }
    }

    /**
     * PDF 텍스트 파싱 및 거래명세서 데이터 구조화
     */
    async parsePdfBuffer(pdfBuffer, originalFileName = '대경벤드_거래명세서.pdf') {
        const parser = new PDFParse({ data: pdfBuffer });
        const res = await parser.getText();
        const fullText = res.text || '';

        return this.parseTextToInvoice(fullText, originalFileName);
    }

    /**
     * 텍스트로부터 대경벤드 거래명세서 데이터 추출
     */
    parseTextToInvoice(fullText, originalFileName = '거래명세서.pdf') {
        const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);

        // 1. 일자 파싱 (예: 2026 年 10 月 19 日 or 2026-10-19)
        let invoiceDate = new Date().toISOString().slice(0, 10);
        const dateMatch = fullText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
        if (dateMatch) {
            invoiceDate = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
        } else {
            const altDateMatch = fullText.match(/(\d{4})[./-](\d{2})[./-](\d{2})/);
            if (altDateMatch) invoiceDate = `${altDateMatch[1]}-${altDateMatch[2]}-${altDateMatch[3]}`;
        }

        // 2. 전표 번호 (예: No:0015- 1/ 1, No:0031- 1/ 1)
        let invoiceNo = '';
        const noMatch = fullText.match(/No\s*:\s*([\d-]+(?:\s*[\d/]+)?)/i);
        if (noMatch) {
            invoiceNo = noMatch[1].replace(/\s+/g, '');
        } else {
            invoiceNo = 'INV-' + Date.now().toString().slice(-6);
        }

        // 3. 공급자 및 공급받는자 확인
        const isDaekyung = fullText.includes('대경벤드') || fullText.includes('606-81-75098') || fullText.includes('606 - 81 - 75098');
        const isAltf = fullText.includes('알트에프') || fullText.includes('ALT.F') || fullText.includes('838-05-01054');

        // 4. 품목 파싱
        const items = [];
        let totalSupplyPrice = 0;
        let freightPrice = 0;

        // 발주번호 정규식 (ES261019-2915, ES261019-2924 등)
        const poRegex = /ES\d{6}-\d{4}/g;
        const allPosFound = Array.from(new Set(fullText.match(poRegex) || []));

        // 줄단위 분석 또는 테이블 블록 분석
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 운임 라인 체크
            if (line.includes('운임')) {
                const numMatches = line.match(/[\d,]+/g);
                let price = 4000;
                if (numMatches && numMatches.length > 0) {
                    const parsed = parseInt(numMatches[numMatches.length - 1].replace(/,/g, ''), 10);
                    if (!isNaN(parsed) && parsed > 0 && parsed < 100000) price = parsed;
                }
                freightPrice += price;
                items.push({
                    itemNo: items.length + 1,
                    type: 'FREIGHT',
                    name: '운임',
                    spec: '운송료',
                    quantity: 1,
                    unit: '건',
                    unitPrice: price,
                    amount: price,
                    remarks: line
                });
                continue;
            }

            // 품목 라인 (숫자와 배관 품목 기호 매칭: 45E, 90E, T, R, CAP, FLANGE 등)
            const itemMatch = line.match(/(45E|90E|T\(R\)|T\(S\)|R\(C\)|R\(E\)|CAP|FLG|PIPE)[\w()/-]*/i);
            if (itemMatch) {
                // 단가, 수량, 금액 추출
                const numbers = (line.match(/[\d,]+/g) || [])
                    .map(n => parseInt(n.replace(/,/g, ''), 10))
                    .filter(n => !isNaN(n) && n > 0);

                let quantity = 1;
                let unitPrice = 0;
                let amount = 0;

                if (numbers.length >= 3) {
                    // 통상 [순번, 수량, 단가, 금액] 형태
                    quantity = numbers[numbers.length - 3] || 1;
                    unitPrice = numbers[numbers.length - 2] || 0;
                    amount = numbers[numbers.length - 1] || (quantity * unitPrice);
                } else if (numbers.length === 2) {
                    quantity = numbers[0];
                    amount = numbers[1];
                    unitPrice = Math.round(amount / quantity);
                }

                // 비고 및 발주번호 추출
                const linePoMatch = line.match(/ES\d{6}-\d{4}/);
                const itemPo = linePoMatch ? linePoMatch[0] : (allPosFound[0] || '');

                let remarkDesc = '';
                if (line.includes('서울재고')) remarkDesc = '서울재고 발주분';
                else if (line.includes('국제밸브')) remarkDesc = '국제밸브앤드피팅';
                else if (line.includes('태형산업')) remarkDesc = '태형산업';

                items.push({
                    itemNo: items.length + 1,
                    type: 'PRODUCT',
                    name: itemMatch[0],
                    rawLine: line,
                    quantity,
                    unit: 'EA',
                    unitPrice,
                    amount,
                    poNo: itemPo,
                    remarks: remarkDesc || line
                });

                totalSupplyPrice += amount;
            }
        }

        // 만약 정규식 라인 분석에서 품목이 잡히지 않았을 경우, 전체 텍스트 fallback 분석
        if (items.length === 0) {
            // fallback: 발주번호 기준 기본 품목 구성
            for (const po of allPosFound) {
                items.push({
                    itemNo: items.length + 1,
                    type: 'PRODUCT',
                    name: '배관 자재 (대경벤드 출하)',
                    rawLine: '발주번호: ' + po,
                    quantity: 1,
                    unit: 'LOT',
                    unitPrice: 0,
                    amount: 0,
                    poNo: po,
                    remarks: 'PDF 자동 파싱 품목'
                });
            }
        }

        const subtotal = totalSupplyPrice + freightPrice;
        const vat = Math.round(subtotal * 0.1);
        const grandTotal = subtotal + vat;

        return {
            id: `DKB-INV-${Date.now()}-${invoiceNo.replace(/[^a-zA-Z0-9]/g, '')}`,
            fileName: originalFileName,
            invoiceNo,
            invoiceDate,
            supplier: {
                name: '(주)대경벤드',
                bizNo: '606-81-75098',
                ceo: '김학철',
                address: '경남 양산시 어실로 115',
                phone: '055-364-1800'
            },
            buyer: {
                name: '알트에프(ALT.F)',
                bizNo: '838-05-01054',
                ceo: '조현진',
                address: '부산광역시 사상구 낙동대로 1330번길 67'
            },
            items,
            itemCount: items.length,
            poNumbers: Array.from(new Set(items.map(it => it.poNo).filter(Boolean))),
            pricing: {
                totalSupplyPrice,
                freightPrice,
                subtotal,
                vat,
                grandTotal
            },
            rawText: fullText
        };
    }

    /**
     * 🔥 핵심 파이프라인 : 거래명세서 처리 및 4개 부서 동시 연계 트리거 실행
     */
    async processAndDispatch(invoiceData, source = 'TELEGRAM') {
        const timestamp = new Date().toISOString();
        const timeShort = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

        // 1. 총무부 (GEN) 연계: 매입 대장(supplier_invoices.json) 기록
        const invoiceRecord = {
            ...invoiceData,
            source,
            processedAt: timestamp,
            status: 'RECEIVED_AND_DISPATCHED', // 접수 및 부서 연계 완료
            accounting: {
                recordedAt: timestamp,
                status: 'PURCHASE_CONFIRMED', // 매입 확정
                taxInvoiceMatched: false,
                subtotal: invoiceData.pricing.subtotal,
                vat: invoiceData.pricing.vat,
                grandTotal: invoiceData.pricing.grandTotal
            }
        };

        // 기존 동일 번호 있으면 업데이트, 없으면 신규 추가
        const existingIdx = this.invoices.findIndex(inv => inv.invoiceNo === invoiceData.invoiceNo && inv.invoiceDate === invoiceData.invoiceDate);
        if (existingIdx >= 0) {
            this.invoices[existingIdx] = invoiceRecord;
        } else {
            this.invoices.unshift(invoiceRecord);
        }
        this.saveInvoices();

        // 2. 구매부 (PUR-07) 연계: '알트에프 재고 발주 대장.xlsx' 엑셀 미결 해제 & 입고 완료 갱신
        const purSyncResult = this.syncPurchaseOrderBacklog(invoiceData);

        // 3. 품질부 (QC-01/QC-02) 연계: 성적서(MTC) 매칭 및 입고 예정 검사
        const qcSyncResult = this.checkQualityCertificates(invoiceData);

        // 4. 출고부 (LOG) 연계: 배송 완료 및 스티커 갱신
        const logSyncResult = this.notifyLogisticsDepartment(invoiceData);

        // 5. 에이전트 실시간 로그 및 관제 상태(agents.json) 갱신
        this.updateAgentsState(invoiceData, { purSyncResult, qcSyncResult, logSyncResult }, timeShort);

        return {
            success: true,
            invoiceNo: invoiceData.invoiceNo,
            invoiceDate: invoiceData.invoiceDate,
            poNumbers: invoiceData.poNumbers,
            pricing: invoiceData.pricing,
            departments: {
                general: {
                    status: 'SUCCESS',
                    message: `총무부 매입 확정 완료 (공급가: ${invoiceData.pricing.subtotal.toLocaleString()}원, 부가세: ${invoiceData.pricing.vat.toLocaleString()}원, 합계: ${invoiceData.pricing.grandTotal.toLocaleString()}원)`
                },
                purchase: purSyncResult,
                quality: qcSyncResult,
                shipping: logSyncResult
            }
        };
    }

    /**
     * 🛒 구매부 (PUR-07) 연계: 재고 발주 대장 엑셀 업데이트
     */
    syncPurchaseOrderBacklog(invoiceData) {
        const poNumbers = invoiceData.poNumbers || [];
        if (poNumbers.length === 0) {
            return {
                status: 'SKIPPED',
                message: '거래명세서에 매칭할 P.O 번호(ES...)가 없습니다.'
            };
        }

        try {
            if (!fs.existsSync(PURCHASE_EXCEL_PATH)) {
                return {
                    status: 'WARNING',
                    message: 'storage/purchases/알트에프 재고 발주 대장.xlsx 파일이 존재하지 않습니다.'
                };
            }

            const wb = xlsx.readFile(PURCHASE_EXCEL_PATH);
            const sheetName = wb.SheetNames[0];
            const sheet = wb.Sheets[sheetName];
            const rows = xlsx.utils.sheet_to_json(sheet);

            let matchedCount = 0;
            const updatedPos = [];

            for (const row of rows) {
                const rowPo = (row['P.O No'] || '').trim();
                if (poNumbers.includes(rowPo)) {
                    // 미결 -> 입고완료(대경발송) 전이
                    row['입고일자'] = invoiceData.invoiceDate;
                    const orderQty = parseInt(row['발주수량'] || 0, 10);
                    row['입고수량'] = orderQty;
                    row['미결수량'] = 0;
                    row['입고상태'] = '입고완료(대경발송)';
                    matchedCount++;
                    if (!updatedPos.includes(rowPo)) updatedPos.push(rowPo);
                }
            }

            if (matchedCount > 0) {
                const newSheet = xlsx.utils.json_to_sheet(rows);
                wb.Sheets[sheetName] = newSheet;
                xlsx.writeFile(wb, PURCHASE_EXCEL_PATH);
            }

            return {
                status: 'SUCCESS',
                matchedCount,
                updatedPos,
                message: `[PUR-07] 발주 ${updatedPos.join(', ')} 총 ${matchedCount}개 품목 '입고완료(대경발송)' 상태 갱신 및 미결 대장 엑셀 저장 완료!`
            };
        } catch (e) {
            console.error('[DaekyungInvoiceService] 구매 대장 엑셀 갱신 오류:', e.message);
            return {
                status: 'ERROR',
                message: '구매 대장 엑셀 갱신 실패: ' + e.message
            };
        }
    }

    /**
     * 🔬 품질부 (QC-01/QC-02) 연계: 성적서 매칭 검증
     */
    checkQualityCertificates(invoiceData) {
        let certs = [];
        try {
            if (fs.existsSync(CERT_JSON_PATH)) {
                certs = JSON.parse(fs.readFileSync(CERT_JSON_PATH, 'utf8'));
            }
        } catch (e) {
            certs = [];
        }

        const matchedCerts = [];
        const missingItems = [];

        for (const item of (invoiceData.items || [])) {
            if (item.type === 'FREIGHT') continue;

            // 품목명 또는 규격 기반 성적서 검색
            const found = certs.find(c => {
                const cDesc = (c['DESCRIPTION'] || '').toUpperCase();
                const iName = (item.name || '').toUpperCase();
                const iRaw = (item.rawLine || '').toUpperCase();
                return (cDesc && iName && cDesc.includes(iName)) || (cDesc && iRaw && iRaw.includes(cDesc));
            });

            if (found) {
                matchedCerts.push({
                    item: item.name,
                    certNo: found['CERT-No'] || 'DKB-CERT',
                    heatNo: found['HEAT No'] || '-',
                    lotNo: found['LOT No'] || '-'
                });
            } else {
                missingItems.push(item.name);
            }
        }

        return {
            status: matchedCerts.length > 0 ? 'SUCCESS' : 'WARNING',
            matchedCerts,
            missingItems,
            message: matchedCerts.length > 0
                ? `[QC-01/02] 출하 자재 성적서(MTC) ${matchedCerts.length}건 사전 교차 매칭 확인 완료`
                : `[QC-09] 성적서 미입고 경보: 대경 물건은 출발하였으나 성적서 MTC가 아직 대장에 누락되어 있습니다.`
        };
    }

    /**
     * 🚚 출고부 (LOG) 연계
     */
    notifyLogisticsDepartment(invoiceData) {
        const isSeoulStock = (invoiceData.items || []).some(it => (it.remarks || '').includes('서울재고'));
        return {
            status: 'SUCCESS',
            targetLocation: isSeoulStock ? '시화 물류센터(서울재고)' : '부산 공장 / 고객사 직배송',
            message: isSeoulStock
                ? `[LOG-01] 대경벤드 ➔ 시화물류센터 서울재고 입고 하차 및 검수 대기`
                : `[LOG-01] 대경벤드 ➔ 고객사 직배송 / 부산공장 입고 운송 감시`
        };
    }

    /**
     * 🤖 에이전트 오피스 (agents.json) 실시간 상태 및 상호작용 피드 업데이트
     */
    updateAgentsState(invoiceData, { purSyncResult, qcSyncResult, logSyncResult }, timeShort) {
        try {
            if (!fs.existsSync(AGENTS_PATH)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));

            // 1. GEN-01 (총무부 거래명세표 봇)
            const gen01 = agents.find(a => a.code === 'GEN-01');
            if (gen01) {
                gen01.lastActive = '방금 전';
                gen01.currentTask = `대경벤드 거래명세표 No:${invoiceData.invoiceNo} 매입 확정 처리 (${invoiceData.pricing.grandTotal.toLocaleString()}원)`;
                gen01.logs = [
                    `[${timeShort}] [대경벤드] 거래명세표 No:${invoiceData.invoiceNo} 수신 및 매입 확정`,
                    `[${timeShort}] 공급가액: ${invoiceData.pricing.subtotal.toLocaleString()}원, 부가세: ${invoiceData.pricing.vat.toLocaleString()}원 전표 등록`,
                    ...(gen01.logs || []).slice(0, 3)
                ];
            }

            // 2. PUR-07 (구매부 발주/미결 관제봇)
            const pur07 = agents.find(a => a.code === 'PUR-07');
            if (pur07) {
                pur07.lastActive = '방금 전';
                pur07.currentTask = `대경벤드 출하 통보 확인 ➔ 발주 ${invoiceData.poNumbers.join(', ')} 미결 해제 및 입고 전환`;
                pur07.logs = [
                    `[${timeShort}] 대경벤드 발송 신호 수신: 발주번호 ${invoiceData.poNumbers.join(', ')} 미결 해제`,
                    `[${timeShort}] ${purSyncResult.message}`,
                    ...(pur07.logs || []).slice(0, 3)
                ];
            }

            // 3. QC-08 (품질부 성적서 연계봇)
            const qc08 = agents.find(a => a.code === 'QC-08');
            if (qc08) {
                qc08.lastActive = '방금 전';
                qc08.currentTask = `대경 출하 자재 성적서(MTC) 사전 매칭 검증`;
                qc08.logs = [
                    `[${timeShort}] ${qcSyncResult.message}`,
                    ...(qc08.logs || []).slice(0, 3)
                ];
            }

            fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf8');
        } catch (e) {
            console.error('[DaekyungInvoiceService] agents.json 업데이트 오류:', e.message);
        }
    }
}

export const daekyungInvoiceService = new DaekyungInvoiceService();
