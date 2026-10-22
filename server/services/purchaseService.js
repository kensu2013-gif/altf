/**
 * 🛒 PUR-01 : 알트에프 재고 발주 List Up 에이전트 서비스
 * - altf.kr 웹에서 '알트에프 재고'로 구매한 모든 발주 신호 실시간 감지 및 List Up
 * - 발주번호별(P.O No), 아이템별(ITEM No)로 완벽히 구분 정리
 * - QC-01 성적서 List와 1:1 교차 매칭 (일자, Customer, P.O No, CERT-No, HEAT No, LOT No, DESCRIPTION, 발주수량, 입고수량, 미결수량 등)
 * - storage/purchases/알트에프 재고 발주 대장.xlsx 및 server/data/purchase_stock_orders.json 자동 동기화
 * - 사원 에이전트(PUR-01) 24시간 자율 실행 (AUTO_RUNNING)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { agentControlManager } from './agentControlManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const STORAGE_PURCHASE_DIR = path.join(ROOT_DIR, 'storage/purchases');
const STOCK_ORDERS_EXCEL_PATH = path.join(STORAGE_PURCHASE_DIR, '알트에프 재고 발주 대장.xlsx');
const STOCK_ORDERS_JSON_PATH = path.join(ROOT_DIR, 'server/data/purchase_stock_orders.json');
const SCHEDULER_INFO_PATH = path.join(ROOT_DIR, 'server/data/purchase_scheduler.json');
const AGENTS_PATH = path.join(ROOT_DIR, 'server/data/agents.json');
const CERT_JSON_PATH = path.join(ROOT_DIR, 'server/data/certificates.json');
const DB_PATH = path.join(ROOT_DIR, 'data/db.json');
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 하루 1회 (24시간 주기)

// QC-01 성적서와 100% 호환되는 구매부 공식 대장 26개 컬럼 헤더
export const PURCHASE_STOCK_SHEET_HEADERS = [
    '발주일자',        // 1
    '입고일자',        // 2
    'Customer',        // 3 (알트에프 재고/시화/부산)
    '공급처',          // 4 (대경벤드 등)
    'P.O No',          // 5 (발주번호)
    'CERT-No',         // 6 (성적서 번호)
    'Spec MATERIAL',   // 7
    'Spec INSPECTION', // 8
    'HEAT No',         // 9
    'LOT No',          // 10
    'ITEM No',         // 11
    'DESCRIPTION',     // 12 (품목 규격)
    '발주수량',        // 13
    '입고수량',        // 14
    '미결수량',        // 15
    '입고상태',        // 16 (입고완료 / 부분입고 / 미결)
    'C',               // 17
    'Si',              // 18
    'Mn',              // 19
    'P',               // 20
    'S',               // 21
    'Ni',              // 22
    'Cr',              // 23
    'Mo',              // 24
    '기계적성질(YS/TS/EL)', // 25
    'PDF 원본링크'     // 26
];

/**
 * 피팅 규격 정규화 헬퍼
 */
export function normalizeFittingSpec(rawStr) {
    if (!rawStr) return { itemType: '', sched: '', size: '', altSize: '', mat: '' };
    const str = String(rawStr).toUpperCase().replace(/[\s\-_/]/g, '');

    let itemType = '';
    if (str.includes('90E(L)') || str.includes('90EL')) itemType = '90E(L)';
    else if (str.includes('90E(S)') || str.includes('90ES')) itemType = '90E(S)';
    else if (str.includes('45E(L)') || str.includes('45EL')) itemType = '45E(L)';
    else if (str.includes('T(S)') || str.includes('TS')) itemType = 'T(S)';
    else if (str.includes('T(R)') || str.includes('TR')) itemType = 'T(R)';
    else if (str.includes('R(C)') || str.includes('RC')) itemType = 'R(C)';
    else if (str.includes('R(E)') || str.includes('RE')) itemType = 'R(E)';
    else if (str.includes('CAP')) itemType = 'CAP';

    let sched = '';
    if (str.includes('S10S') || str.includes('10S') || str.includes('SCH10S')) sched = '10S';
    else if (str.includes('S20S') || str.includes('20S') || str.includes('SCH20S')) sched = '20S';
    else if (str.includes('S40S') || str.includes('40S') || str.includes('SCH40S')) sched = '40S';
    else if (str.includes('S80S') || str.includes('80S') || str.includes('SCH80S')) sched = '80S';

    let size = '';
    const sizeMatches = str.match(/(\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?)?(?:A|\"|인치))/);
    if (sizeMatches) size = sizeMatches[1].replace('인치', '"');
    else {
        const altMatch = str.match(/(\d+A|\d+\")/);
        if (altMatch) size = altMatch[1];
    }

    let altSize = '';
    if (size === '50A' || size === '2"') { size = '50A'; altSize = '2"'; }
    else if (size === '25A' || size === '1"') { size = '25A'; altSize = '1"'; }
    else if (size === '15A' || size === '1/2"') { size = '15A'; altSize = '1/2"'; }
    else if (size === '20A' || size === '3/4"') { size = '20A'; altSize = '3/4"'; }
    else if (size === '32A' || size === '1-1/4"') { size = '32A'; altSize = '1-1/4"'; }
    else if (size === '40A' || size === '1-1/2"') { size = '40A'; altSize = '1-1/2"'; }
    else if (size === '65A' || size === '2-1/2"') { size = '65A'; altSize = '2-1/2"'; }
    else if (size === '80A' || size === '3"') { size = '80A'; altSize = '3"'; }
    else if (size === '100A' || size === '4"') { size = '100A'; altSize = '4"'; }
    else if (size === '125A' || size === '5"') { size = '125A'; altSize = '5"'; }
    else if (size === '150A' || size === '6"') { size = '150A'; altSize = '6"'; }
    else if (size === '200A' || size === '8"') { size = '200A'; altSize = '8"'; }
    else if (size === '250A' || size === '10"') { size = '250A'; altSize = '10"'; }
    else if (size === '300A' || size === '12"') { size = '300A'; altSize = '12"'; }

    let mat = '';
    if (str.includes('316L')) mat = '316L';
    else if (str.includes('304L')) mat = '304L';
    else if (str.includes('304')) mat = '304';
    else if (str.includes('316')) mat = '316';

    return { itemType, sched, size, altSize, mat };
}

export class PurchaseStockOrderService {
    constructor() {
        this.cache = {
            stockOrders: null,
            lastSynced: null,
            summary: null
        };
        this.watcherTimer = null;
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(STORAGE_PURCHASE_DIR)) {
            fs.mkdirSync(STORAGE_PURCHASE_DIR, { recursive: true });
        }
    }

    /**
     * 알트에프 재고 구매 발주 여부 정밀 판정
     */
    isStockOrder(order) {
        if (!order) return false;
        const target = (order.targetCustomerName || '').toLowerCase().replace(/\s+/g, '');
        const cust = (order.customerName || order.customer?.companyName || '').toLowerCase().replace(/\s+/g, '');
        const memo = (order.memo || '').toLowerCase().replace(/\s+/g, '');

        if (target.includes('시화재고') || target.includes('부산재고') || target.includes('알트에프재고') || target.includes('알트에프') || target.includes('altf')) return true;
        if (cust.includes('시화재고') || cust.includes('부산재고') || cust.includes('알트에프재고') || cust.includes('알트에프') || cust.includes('altf')) return true;
        if (memo.includes('알트에프재고') || memo.includes('동시화') || memo.includes('시화재고') || memo.includes('부산재고') || memo.includes('알트에프')) return true;

        if (Array.isArray(order.items)) {
            const hasStockItem = order.items.some(it => it.isStockItem || it.stockTargetLocation === 'SIHWA' || it.stockTargetLocation === 'BUSAN');
            if (hasStockItem) return true;
        }
        return false;
    }

    /**
     * PUR-01 핵심: altf.kr 웹에서 재고 발주 목록을 가져와 발주번호별/아이템별 List Up & QC 성적서 매칭
     */
    listUpStockOrders(rawOrders = null) {
        this.ensureDirectories();

        let orders = rawOrders;
        if (!orders && fs.existsSync(DB_PATH)) {
            try {
                const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
                orders = db.orders || [];
            } catch (e) {
                console.error('[PUR-01] Error reading db.json:', e.message);
                orders = [];
            }
        }

        // 1. QC-01 성적서 로드 및 PO별 인덱싱
        let certs = [];
        if (fs.existsSync(CERT_JSON_PATH)) {
            try {
                certs = JSON.parse(fs.readFileSync(CERT_JSON_PATH, 'utf8'));
            } catch {}
        }

        const certsByPo = new Map();
        certs.forEach(c => {
            if (!c.poNo) return;
            const poKey = c.poNo.toUpperCase().trim();
            if (!certsByPo.has(poKey)) certsByPo.set(poKey, []);
            certsByPo.get(poKey).push(c);
        });

        // 2. 알트에프 재고 구매 발주분만 필터링하여 발주번호별 / 아이템별 List Up
        const stockItemsList = [];
        let fulfilledCount = 0;
        let partialCount = 0;
        let pendingCount = 0;

        (orders || []).forEach(order => {
            // 알트에프 재고 발주분 판정
            if (!this.isStockOrder(order)) return;

            const poNo = (order.poNumber || order.id || '').trim();
            const orderDate = (order.createdAt || '').slice(0, 10);
            const targetCustomer = order.targetCustomerName || order.customerName || '알트에프 재고';
            const supplier = '대경벤드';
            const memo = order.memo || '';

            // 발주 내 아이템별 순회
            (order.items || []).forEach((item, itemIdx) => {
                const itemNo = itemIdx + 1;
                const description = item.productId || item.name || '';
                const orderQty = Number(item.quantity) || 0;
                const spec = normalizeFittingSpec(description);

                // QC-01 성적서와 1:1 규격 대조
                const relatedCerts = certsByPo.get(poNo.toUpperCase().trim()) || [];
                const matchedCerts = relatedCerts.filter(c => {
                    const cSpec = normalizeFittingSpec(c.description);
                    if (spec.itemType && cSpec.itemType && spec.itemType !== cSpec.itemType) return false;
                    if (spec.sched && cSpec.sched && spec.sched !== cSpec.sched) return false;
                    if (spec.size && cSpec.size) {
                        const sizeMatch = (spec.size === cSpec.size) || (spec.altSize === cSpec.size) || (spec.size === cSpec.altSize);
                        if (!sizeMatch) return false;
                    }
                    return true;
                });

                // 성적서로부터 집계된 입고 수량 및 품질 정보
                let receivedQty = 0;
                const heatNos = new Set();
                const lotNos = new Set();
                const certNos = new Set();
                const pdfUrls = new Set();
                let latestIssueDate = '';
                let chemSummary = { C: '', Si: '', Mn: '', P: '', S: '', Ni: '', Cr: '', Mo: '' };
                let mechSummary = '';
                let specMat = '';
                let specInsp = '';

                matchedCerts.forEach(c => {
                    receivedQty += (Number(c.qty) || 0);
                    if (c.heatNo) heatNos.add(c.heatNo);
                    if (c.lotNo) lotNos.add(c.lotNo);
                    if (c.certNo) certNos.add(c.certNo);
                    if (c.pdfUrl) pdfUrls.add(c.pdfUrl);
                    if (c.issueDate && (!latestIssueDate || c.issueDate > latestIssueDate)) {
                        latestIssueDate = c.issueDate;
                    }
                    if (c.specMaterial && !specMat) specMat = c.specMaterial;
                    if (c.specInspection && !specInsp) specInsp = c.specInspection;

                    if (c.chemC && !chemSummary.C) {
                        chemSummary = {
                            C: c.chemC, Si: c.chemSi, Mn: c.chemMn, P: c.chemP,
                            S: c.chemS, Ni: c.chemNi, Cr: c.chemCr, Mo: c.chemMo
                        };
                    }
                    if (c.mechYs && !mechSummary) {
                        mechSummary = `YS:${c.mechYs} TS:${c.mechTs} EL:${c.mechEl}`;
                    }
                });

                const pendingQty = Math.max(0, orderQty - receivedQty);

                // 입고 상태 판정
                let status = '미결';
                if (receivedQty >= orderQty && orderQty > 0) {
                    status = '입고완료';
                    fulfilledCount++;
                } else if (receivedQty > 0) {
                    status = '부분입고';
                    partialCount++;
                } else {
                    status = '미결';
                    pendingCount++;
                }

                stockItemsList.push({
                    id: `${order.id}_item_${itemIdx}`,
                    orderId: order.id,
                    orderDate,
                    receivedDate: latestIssueDate || '-',
                    customer: targetCustomer,
                    supplier,
                    poNo,
                    certNo: Array.from(certNos).join(', ') || '-',
                    specMaterial: specMat || (item.material || 'STS304'),
                    specInspection: specInsp || (item.thickness || 'S10S'),
                    heatNo: Array.from(heatNos).join(', ') || '-',
                    lotNo: Array.from(lotNos).join(', ') || '-',
                    itemNo,
                    description,
                    orderQty,
                    receivedQty,
                    pendingQty,
                    status,
                    chem: chemSummary,
                    mech: mechSummary || '-',
                    pdfUrls: Array.from(pdfUrls),
                    memo
                });
            });
        });

        // 3. JSON 파일 저장
        fs.writeFileSync(STOCK_ORDERS_JSON_PATH, JSON.stringify(stockItemsList, null, 2), 'utf8');

        // 4. QC-01과 완전히 일치하는 26개 컬럼 Excel 생성 ('storage/purchases/알트에프 재고 발주 대장.xlsx')
        this.exportToExcel(stockItemsList);

        const summary = {
            totalItems: stockItemsList.length,
            fulfilledCount,
            partialCount,
            pendingCount,
            fulfillmentRate: stockItemsList.length > 0 ? Math.round((fulfilledCount / stockItemsList.length) * 100) : 0,
            lastSyncTime: new Date().toISOString()
        };

        this.cache.stockOrders = stockItemsList;
        this.cache.summary = summary;
        this.cache.lastSynced = new Date().toISOString();

        console.log(`[PUR-01] 알트에프 재고 발주 List Up 완료: 총 ${stockItemsList.length}개 품목 (입고완료: ${fulfilledCount}, 부분입고: ${partialCount}, 미결: ${pendingCount})`);
        return { items: stockItemsList, summary };
    }

    /**
     * 26개 컬럼 엑셀 파일 저장
     */
    exportToExcel(items) {
        try {
            const excelRows = items.map(r => [
                r.orderDate,
                r.receivedDate,
                r.customer,
                r.supplier,
                r.poNo,
                r.certNo,
                r.specMaterial,
                r.specInspection,
                r.heatNo,
                r.lotNo,
                r.itemNo,
                r.description,
                r.orderQty,
                r.receivedQty,
                r.pendingQty,
                r.status,
                r.chem?.C || '',
                r.chem?.Si || '',
                r.chem?.Mn || '',
                r.chem?.P || '',
                r.chem?.S || '',
                r.chem?.Ni || '',
                r.chem?.Cr || '',
                r.chem?.Mo || '',
                r.mech || '',
                r.pdfUrls?.join(', ') || ''
            ]);

            const sheetData = [PURCHASE_STOCK_SHEET_HEADERS, ...excelRows];
            const wb = xlsx.utils.book_new();
            const ws = xlsx.utils.aoa_to_sheet(sheetData);

            // 열 너비 지정
            ws['!cols'] = [
                { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
                { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
                { wch: 8 },  { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
                { wch: 12 }, { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 8 },
                { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 20 },
                { wch: 30 }
            ];

            xlsx.utils.book_append_sheet(wb, ws, '알트에프_재고발주_성적서매칭');
            xlsx.writeFile(wb, STOCK_ORDERS_EXCEL_PATH);
            console.log(`[PUR-01] 엑셀 대장 파일 생성 완료: ${STOCK_ORDERS_EXCEL_PATH}`);
        } catch (e) {
            console.error('[PUR-01] 엑셀 대장 파일 생성 오류:', e.message);
        }
    }

    /**
     * 알트에프 재고 발주 목록 조회 (필터링 지원)
     */
    getStockOrders(filters = {}) {
        let items = this.cache.stockOrders;
        if (!items && fs.existsSync(STOCK_ORDERS_JSON_PATH)) {
            try {
                items = JSON.parse(fs.readFileSync(STOCK_ORDERS_JSON_PATH, 'utf8'));
                this.cache.stockOrders = items;
            } catch {}
        }
        if (!items) {
            const res = this.listUpStockOrders();
            items = res.items;
        }

        let result = items;
        if (filters.status && filters.status !== 'ALL') {
            result = result.filter(it => it.status === filters.status);
        }
        if (filters.search) {
            const q = filters.search.toLowerCase().trim();
            result = result.filter(it => 
                it.poNo.toLowerCase().includes(q) ||
                it.description.toLowerCase().includes(q) ||
                it.heatNo.toLowerCase().includes(q) ||
                it.lotNo.toLowerCase().includes(q) ||
                it.certNo.toLowerCase().includes(q) ||
                it.customer.toLowerCase().includes(q)
            );
        }

        return result;
    }

    getSummary() {
        if (!this.cache.summary) {
            const res = this.listUpStockOrders();
            return res.summary;
        }
        return this.cache.summary;
    }

    /**
     * 다음 정기 감지 시각 계산 (오전 10:00, 오후 17:00)
     */
    getNextScheduledTime(now = new Date()) {
        const t10 = new Date(now);
        t10.setHours(10, 0, 0, 0);

        const t17 = new Date(now);
        t17.setHours(17, 0, 0, 0);

        if (now.getTime() < t10.getTime()) {
            return { nextTime: t10, label: `오늘 오전 10:00` };
        } else if (now.getTime() < t17.getTime()) {
            return { nextTime: t17, label: `오늘 오후 17:00` };
        } else {
            const nextDay10 = new Date(now);
            nextDay10.setDate(nextDay10.getDate() + 1);
            nextDay10.setHours(10, 0, 0, 0);
            return { nextTime: nextDay10, label: `내일 오전 10:00` };
        }
    }

    /**
     * PUR-01: agents.json 내 에이전트 상태 및 로그 갱신 (평상시 STANDBY 대기 상태)
     */
    updateAgentState(summary, isRunning = false) {
        try {
            if (!fs.existsSync(AGENTS_PATH)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
            const purAgent = agents.find(a => a.id === 'pur-stock-reorder' || a.code === 'PUR-01');
            if (purAgent) {
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                const { label } = this.getNextScheduledTime(now);

                // 사용자가 대시보드에서 명시적으로 OFFLINE(OFF) 또는 IDLE로 설정한 경우 덮어쓰지 않고 절대 우선 유지
                if (purAgent.status !== 'OFFLINE' && purAgent.status !== 'OFF' && purAgent.status !== 'IDLE') {
                    purAgent.status = isRunning ? 'ACTIVE' : 'STANDBY';
                }
                purAgent.currentTask = isRunning 
                    ? `altf.kr API 재고 발주 동기화 실행 중...` 
                    : (purAgent.status === 'OFFLINE' ? '대시보드에서 가동 중지됨 (OFF)' : `업무시간 1일 2회 정기 감시 대기 중 (다음: ${label}, 미결 ${summary.pendingCount}건 관리)`);
                purAgent.lastActive = '방금 전';

                const newLog = `[${timeStr}] [PUR-01] altf.kr API 재고 발주 동기화 완료: 총 ${summary.totalItems}건 (입고: ${summary.fulfilledCount}건, 미결: ${summary.pendingCount}건)`;
                purAgent.logs = [newLog, ...(purAgent.logs || []).slice(0, 15)];
                fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf8');
            }
        } catch (e) {
            console.error('[PUR-01] agents.json 업데이트 오류:', e.message);
        }
    }

    /**
     * 스케줄러 실행 기록 영구 저장 (purchase_scheduler.json)
     */
    updateSchedulerRecord(summary, isManual = false) {
        const now = new Date();
        const { nextTime, label } = this.getNextScheduledTime(now);

        const record = {
            manager: 'PUR-01 (구매부 사원 에이전트)',
            managerName: '알트에프 재고 발주 List Up 봇',
            cycle: '1일 2회 (오전 10:00, 오후 17:00 정기 감지)',
            scheduleHours: [10, 17],
            targetUrl: 'https://altf.kr/api/orders (재고 발주 API 감지)',
            status: 'STANDBY',
            statusLabel: '대기 중 (STANDBY)',
            lastSyncTime: now.toISOString(),
            nextSyncTime: nextTime.toISOString(),
            nextSyncLabel: label,
            lastSyncType: isManual ? 'MANUAL_TRIGGER' : 'SCHEDULED_TRIGGER',
            summary: {
                totalItems: summary.totalItems,
                fulfilledCount: summary.fulfilledCount,
                partialCount: summary.partialCount,
                pendingCount: summary.pendingCount,
                fulfillmentRate: summary.fulfillmentRate
            }
        };

        try {
            fs.writeFileSync(SCHEDULER_INFO_PATH, JSON.stringify(record, null, 2), 'utf8');
        } catch (e) {
            console.error('[PUR-01] purchase_scheduler.json 저장 오류:', e.message);
        }
        return record;
    }

    /**
     * 스케줄러 상태 조회
     */
    getSchedulerStatus() {
        let record = null;
        if (fs.existsSync(SCHEDULER_INFO_PATH)) {
            try {
                record = JSON.parse(fs.readFileSync(SCHEDULER_INFO_PATH, 'utf8'));
            } catch {}
        }

        if (!record) {
            const summary = this.getSummary();
            record = this.updateSchedulerRecord(summary, false);
        }

        const now = new Date();
        const { nextTime, label } = this.getNextScheduledTime(now);
        const remainingMs = Math.max(0, nextTime.getTime() - now.getTime());
        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

        return {
            ...record,
            status: 'STANDBY',
            statusLabel: '대기 중 (STANDBY)',
            cycle: '1일 2회 (오전 10:00 / 오후 17:00)',
            nextSyncTime: nextTime.toISOString(),
            nextSyncLabel: label,
            remainingMs,
            remainingFormatted: `${label} (${remainingHours > 0 ? `${remainingHours}시간 ` : ''}${remainingMinutes}분 후)`
        };
    }

    /**
     * 🛒 altf.kr API 호출 감지 & 재고 발주 List Up 및 미결 동기화
     */
    async syncFromAltfApi(isManual = false) {
        if (!isManual && !agentControlManager.isAgentActive('PUR-01')) {
            console.log(`[PUR-01] 🛑 대시보드 통제: PUR-01이 OFF 또는 비활성화 상태이므로 자동 동기화를 즉시 스킵합니다.`);
            return { success: false, skipped: true, reason: 'PUR-01 agent is OFFLINE in dashboard' };
        }

        console.log(`[PUR-01] altf.kr API 호출 감지 실행 (수동여부: ${isManual})...`);
        let remoteOrders = null;

        // 원격 altf.kr API 호출 시도
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch('https://altf.kr/api/orders', {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            }).catch(() => null);
            clearTimeout(timeoutId);

            if (res && res.ok) {
                const data = await res.json();
                if (Array.isArray(data.orders)) remoteOrders = data.orders;
                else if (Array.isArray(data)) remoteOrders = data;
                console.log(`[PUR-01] altf.kr 원격 API 응답 수신 성공: ${remoteOrders?.length || 0}건`);
            }
        } catch (e) {
            console.log('[PUR-01] 원격 API 통신 폴백 (로컬 DB 기반 자동 동기화 유지)');
        }

        // 재고 발주 List Up & QC 성적서 1:1 매칭 대장 생성
        const { items, summary } = this.listUpStockOrders(remoteOrders);

        // 스케줄러 정보 및 에이전트 상태 갱신 (완료 후 STANDBY 복귀)
        this.updateSchedulerRecord(summary, isManual);
        this.updateAgentState(summary, false);

        console.log(`[PUR-01] altf.kr 재고 발주 동기화 완료: 총 ${items.length}건 (미결 ${summary.pendingCount}건 관리 중) ➔ 대기 상태 전환`);
        return { success: true, summary, itemsCount: items.length };
    }

    /**
     * 하루 2번 (오전 10:00, 오후 17:00) 정기 감시 스케줄러 가동 (대시보드 통제 준수)
     */
    startTwiceDailyWatcher() {
        if (this.watcherTimer) clearTimeout(this.watcherTimer);
        
        // 대시보드 변경 리스너 초기 1회 바인딩
        if (!this._listenerBound) {
            this._listenerBound = true;
            agentControlManager.on('change', () => this.startTwiceDailyWatcher());
        }

        const isActive = agentControlManager.isAgentActive('PUR-01');
        const sched = agentControlManager.getAgentSchedule('PUR-01', '12h');

        if (!isActive || sched.isManual) {
            console.log('[PUR-01 Agent] 🛑 대시보드 통제: PUR-01이 OFF 또는 수동 모드로 설정되어 자동 스케줄러가 중단되었습니다.');
            return;
        }

        console.log('[PUR-01 Agent] 알트에프 재고 발주 정기 감시 스케줄러 가동 (대시보드 활성)');

        // 최초 기동 시 데이터가 없으면 대장 1회 초기화
        if (!this.cache.stockOrders) {
            this.listUpStockOrders();
        }

        const planNextRun = () => {
            if (!agentControlManager.isAgentActive('PUR-01')) {
                console.log('[PUR-01 Agent] 🛑 실행 시점 대시보드 OFF 감지 ➔ 스케줄 예약 해제');
                return;
            }

            const now = new Date();
            let waitMs = 0;
            let label = '';

            // 사용자 지정 간격이 있는 경우 (예: 10m, 30m, 1h)
            if (sched.intervalMs > 0 && sched.intervalId !== '12h' && sched.intervalId !== '24h') {
                waitMs = sched.intervalMs;
                label = `${Math.round(sched.intervalMs / 60000)}분 후`;
            } else {
                const nextInfo = this.getNextScheduledTime(now);
                waitMs = Math.max(1000, nextInfo.nextTime.getTime() - now.getTime());
                label = nextInfo.label;
            }

            console.log(`[PUR-01 Agent] 대기 상태. 다음 정기 감지: ${label} (${Math.round(waitMs / 60000)}분 후)`);

            this.watcherTimer = setTimeout(async () => {
                if (!agentControlManager.isAgentActive('PUR-01')) {
                    console.log(`[PUR-01 Agent] 🛑 대시보드에서 OFF/IDLE 설정되어 실행 스킵`);
                    return;
                }
                console.log(`[PUR-01 Agent] ⏰ 정기 감지 시각 도래 (${label}) ➔ altf.kr API 감지 실행 시작!`);
                try {
                    await this.syncFromAltfApi(false);
                } catch (e) {
                    console.error('[PUR-01] 정기 동기화 에러:', e.message);
                }
                planNextRun();
            }, waitMs);
        };

        planNextRun();
    }
}

export const purchaseStockOrderService = new PurchaseStockOrderService();
purchaseStockOrderService.startTwiceDailyWatcher();

