import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCustomerMatchIndex, matchCustomerToCrmFast } from './customer-matching.js';

// 모든 기간 계산은 순수 UTC 정수 연산으로 수행한다(서버 프로세스의 로컬 타임존과 무관하게 항상
// 올바른 KST 달력 기준 경계를 계산하기 위함 — date-fns의 로컬 타임존 함수나 Date의 로컬 getter를
// 섞어 쓰면 서버가 UTC가 아닌 타임존에서 구동될 때 기간 경계가 어긋날 수 있어 의도적으로 배제함).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// asOfDate(서버 "지금", 임의의 실제 UTC 시각)를 KST 달력 기준 {year, month(0-indexed), date, isoWeekday(1=월~7=일)}로 변환
function toKstCalendar(asOfDate) {
    const shifted = new Date(asOfDate.getTime() + KST_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const date = shifted.getUTCDate();
    const day = shifted.getUTCDay(); // 0=일 ... 6=토
    const isoWeekday = day === 0 ? 7 : day;
    return { year, month, date, isoWeekday };
}

// KST 달력 기준 (year, month, date)의 00:00:00 또는 23:59:59.999를 실제 UTC Date 인스턴트로 변환
function kstCalendarToUtc(year, month, date, endOfDay = false) {
    const ms = endOfDay
        ? Date.UTC(year, month, date, 23, 59, 59, 999) - KST_OFFSET_MS
        : Date.UTC(year, month, date, 0, 0, 0, 0) - KST_OFFSET_MS;
    return new Date(ms);
}

// KST 달력 (year, month, date)의 ISO 8601 주차/주년도를 계산 (표준 ISO week 알고리즘, 순수 UTC 연산)
function isoWeekInfo(year, month, date) {
    const d = new Date(Date.UTC(year, month, date));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const isoYear = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const isoWeek = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return { isoYear, isoWeek };
}

// ── 기간 구간 계산 ──────────────────────────────────────────
// asOfDate 기준으로 "가장 최근에 완료된" KST 달력 구간과, 비교용 직전 구간을 반환한다.
export function getPeriodRange(period, asOfDate = new Date()) {
    const { year, month, date, isoWeekday } = toKstCalendar(asOfDate);
    let rangeStart, rangeEnd, compareRangeStart, compareRangeEnd, periodKey;

    if (period === 'weekly') {
        // 이번 주 월요일(KST 달력) 기준으로 지난주/지지난주 월~일 구간 계산
        const thisMonday = new Date(Date.UTC(year, month, date - (isoWeekday - 1)));
        const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
        const lastSunday = new Date(lastMonday.getTime() + 6 * 86400000);
        const compareMonday = new Date(lastMonday.getTime() - 7 * 86400000);
        const compareSunday = new Date(compareMonday.getTime() + 6 * 86400000);

        rangeStart = kstCalendarToUtc(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate());
        rangeEnd = kstCalendarToUtc(lastSunday.getUTCFullYear(), lastSunday.getUTCMonth(), lastSunday.getUTCDate(), true);
        compareRangeStart = kstCalendarToUtc(compareMonday.getUTCFullYear(), compareMonday.getUTCMonth(), compareMonday.getUTCDate());
        compareRangeEnd = kstCalendarToUtc(compareSunday.getUTCFullYear(), compareSunday.getUTCMonth(), compareSunday.getUTCDate(), true);

        const { isoYear, isoWeek } = isoWeekInfo(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate());
        periodKey = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
    } else if (period === 'monthly') {
        let y = year, m = month - 1;
        if (m < 0) { m = 11; y -= 1; }
        const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        rangeStart = kstCalendarToUtc(y, m, 1);
        rangeEnd = kstCalendarToUtc(y, m, daysInMonth, true);

        let cy = y, cm = m - 1;
        if (cm < 0) { cm = 11; cy -= 1; }
        const compareDays = new Date(Date.UTC(cy, cm + 1, 0)).getUTCDate();
        compareRangeStart = kstCalendarToUtc(cy, cm, 1);
        compareRangeEnd = kstCalendarToUtc(cy, cm, compareDays, true);

        periodKey = `${y}-${String(m + 1).padStart(2, '0')}`;
    } else if (period === 'quarterly') {
        const currQuarter = Math.floor(month / 3); // 0~3
        let qy = year, qi = currQuarter - 1;
        if (qi < 0) { qi = 3; qy -= 1; }
        const qStartMonth = qi * 3;
        const qEndMonth = qStartMonth + 2;
        const qEndDays = new Date(Date.UTC(qy, qEndMonth + 1, 0)).getUTCDate();
        rangeStart = kstCalendarToUtc(qy, qStartMonth, 1);
        rangeEnd = kstCalendarToUtc(qy, qEndMonth, qEndDays, true);

        let cqy = qy, cqi = qi - 1;
        if (cqi < 0) { cqi = 3; cqy -= 1; }
        const cqStartMonth = cqi * 3;
        const cqEndMonth = cqStartMonth + 2;
        const cqEndDays = new Date(Date.UTC(cqy, cqEndMonth + 1, 0)).getUTCDate();
        compareRangeStart = kstCalendarToUtc(cqy, cqStartMonth, 1);
        compareRangeEnd = kstCalendarToUtc(cqy, cqEndMonth, cqEndDays, true);

        periodKey = `${qy}-Q${qi + 1}`;
    } else if (period === 'semiannual') {
        const currHalf = month < 6 ? 1 : 2; // 이번이 속한 반기
        let hy = year, hi = currHalf - 1;
        if (hi < 1) { hi = 2; hy -= 1; }
        const hStartMonth = hi === 1 ? 0 : 6;
        const hEndMonth = hStartMonth + 5;
        const hEndDays = new Date(Date.UTC(hy, hEndMonth + 1, 0)).getUTCDate();
        rangeStart = kstCalendarToUtc(hy, hStartMonth, 1);
        rangeEnd = kstCalendarToUtc(hy, hEndMonth, hEndDays, true);

        let chy = hy, chi = hi - 1;
        if (chi < 1) { chi = 2; chy -= 1; }
        const chStartMonth = chi === 1 ? 0 : 6;
        const chEndMonth = chStartMonth + 5;
        const chEndDays = new Date(Date.UTC(chy, chEndMonth + 1, 0)).getUTCDate();
        compareRangeStart = kstCalendarToUtc(chy, chStartMonth, 1);
        compareRangeEnd = kstCalendarToUtc(chy, chEndMonth, chEndDays, true);

        periodKey = `${hy}-H${hi}`;
    } else {
        throw new Error(`Unknown period: ${period}`);
    }

    return {
        periodKey,
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        compareRangeStart: compareRangeStart.toISOString(),
        compareRangeEnd: compareRangeEnd.toISOString(),
    };
}

// asOfDate가 속한 "가장 최근에 완료된" period부터 시작해, numBuckets개의 연속된 이전 구간을
// oldest → newest 순으로 반환한다. getPeriodRange가 이미 검증된 KST 달력 경계 계산을 담당하므로,
// 새 날짜 연산을 만들지 않고 커서를 "직전 구간의 시작 시각 그 자체"로 옮겨가며 반복 호출한다 —
// getPeriodRange(period, X)는 "X가 속한 구간의 바로 이전 구간"을 반환하므로, X를 어떤 구간의
// 정확한 시작 시각으로 두면 그 구간 자체가 "X가 속한 구간"이 되어 한 칸 이전 구간이 나온다.
// (구간 시작 - 1ms를 쓰면 그 전전 구간으로 한 칸 더 건너뛰는 버그가 생긴다 — 직접 검증해서 확인함.)
export function getPeriodBuckets(period, asOfDate = new Date(), numBuckets = 8) {
    const buckets = [];
    let cursor = asOfDate;
    for (let i = 0; i < numBuckets; i++) {
        const r = getPeriodRange(period, cursor);
        buckets.unshift({ periodKey: r.periodKey, rangeStart: r.rangeStart, rangeEnd: r.rangeEnd });
        cursor = new Date(r.rangeStart);
    }
    return buckets;
}

export const DEFAULT_TREND_BUCKETS = { weekly: 8, monthly: 6, quarterly: 4, semiannual: 4 };

const inRange = (isoStr, startIso, endIso) => {
    if (!isoStr) return false;
    const t = new Date(isoStr).getTime();
    if (isNaN(t)) return false;
    return t >= new Date(startIso).getTime() && t <= new Date(endIso).getTime();
};

const pctChange = (curr, prev) => {
    if (prev > 0) return parseFloat((((curr - prev) / prev) * 100).toFixed(1));
    return curr > 0 ? 100 : 0;
};

// ── 견적 트렌드 ──────────────────────────────────────────
export function aggregateQuotationTrend(quotations, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd) {
    const list = (quotations || []).filter(q => !q.isDeleted);
    const curr = list.filter(q => inRange(q.createdAt, rangeStart, rangeEnd));
    const prev = list.filter(q => inRange(q.createdAt, compareRangeStart, compareRangeEnd));

    const statusBreakdown = {};
    curr.forEach(q => { statusBreakdown[q.status] = (statusBreakdown[q.status] || 0) + 1; });

    const byCustomer = {};
    curr.forEach(q => {
        const name = q.customerName || q.customerInfo?.companyName || '미지정';
        byCustomer[name] = (byCustomer[name] || 0) + (q.totalAmount || 0);
    });
    const topCustomers = Object.entries(byCustomer)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, amount]) => ({ name, amount }));

    const currTotal = curr.reduce((s, q) => s + (q.totalAmount || 0), 0);
    const prevTotal = prev.reduce((s, q) => s + (q.totalAmount || 0), 0);

    return {
        count: curr.length,
        totalAmount: currTotal,
        avgAmount: curr.length > 0 ? parseFloat((currTotal / curr.length).toFixed(0)) : 0,
        statusBreakdown,
        topCustomers,
        countChangePct: pctChange(curr.length, prev.length),
        amountChangePct: pctChange(currTotal, prevTotal),
    };
}

// ── 발주 트렌드 ──────────────────────────────────────────
export function aggregateOrderTrend(orders, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd) {
    const list = (orders || []).filter(o => !o.isDeleted && !['CANCELLED', 'WITHDRAWN'].includes(o.status));
    const curr = list.filter(o => inRange(o.createdAt, rangeStart, rangeEnd));
    const prev = list.filter(o => inRange(o.createdAt, compareRangeStart, compareRangeEnd));

    const statusBreakdown = {};
    curr.forEach(o => { statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1; });

    const byCustomer = {};
    curr.forEach(o => {
        const name = o.customerName || '미지정';
        byCustomer[name] = (byCustomer[name] || 0) + (o.totalAmount || 0);
    });
    const topCustomers = Object.entries(byCustomer)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, amount]) => ({ name, amount }));

    const currTotal = curr.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const prevTotal = prev.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const currSupplierTotal = curr.reduce((s, o) => s + (o.totalSupplierAmount || 0), 0);

    return {
        count: curr.length,
        totalAmount: currTotal,
        totalSupplierAmount: currSupplierTotal,
        estimatedMargin: currTotal - currSupplierTotal,
        statusBreakdown,
        topCustomers,
        countChangePct: pctChange(curr.length, prev.length),
        amountChangePct: pctChange(currTotal, prevTotal),
    };
}

// ── 재고 트렌드 (대경재고 히스토리 diff 기반) ──────────────────────────────
export function aggregateInventoryTrend(inventoryHistory, daekyungHistory, rangeStart, rangeEnd) {
    const snaps = (daekyungHistory || []).filter(h => inRange(h.date, rangeStart, rangeEnd));

    const netChangeById = {};
    const nameById = {};
    snaps.forEach(snap => {
        (snap.diff || []).forEach(d => {
            netChangeById[d.id] = (netChangeById[d.id] || 0) + (d.change || 0);
            if (d.name && !nameById[d.id]) nameById[d.id] = d.name;
        });
    });

    const entries = Object.entries(netChangeById).map(([id, change]) => ({ id, name: nameById[id] || id, change }));
    // change > 0: 출고(감소) 누적, change < 0: 입고(증가) 누적 — daekyungHistory.diff.change는 "감소량" 기준(재고 = 이전값 - change)
    const topDropItems = entries.filter(e => e.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
    const topSurgeItems = entries.filter(e => e.change < 0).sort((a, b) => a.change - b.change).slice(0, 5)
        .map(e => ({ ...e, change: Math.abs(e.change) }));

    const totalOutbound = entries.filter(e => e.change > 0).reduce((s, e) => s + e.change, 0);
    const totalInbound = entries.filter(e => e.change < 0).reduce((s, e) => s + Math.abs(e.change), 0);

    return {
        confirmedDaysInRange: snaps.length,
        totalOutbound,
        totalInbound,
        topDropItems,
        topSurgeItems,
        _note: '대경재고는 관리자가 수동으로 확정(confirm)할 때만 기록되는 불규칙 스냅샷입니다. confirmedDaysInRange가 적으면 표본이 부족합니다.',
    };
}

// ── 업체(공급사) 트렌드 ──────────────────────────────────────────
export function aggregateSupplierTrend(orders, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd) {
    const list = (orders || []).filter(o => !o.isDeleted && !['CANCELLED', 'WITHDRAWN'].includes(o.status));

    const collectSuppliers = (o, amountAcc) => {
        const names = new Set();
        const supplierName = o.supplierInfo?.company_name;
        if (supplierName) {
            names.add(supplierName);
            amountAcc[supplierName] = (amountAcc[supplierName] || 0) + (o.totalSupplierAmount || o.totalAmount || 0);
        }
        (o.splitDeliveries || []).forEach(sd => {
            const n = sd.supplier?.company_name;
            if (n) {
                names.add(n);
                amountAcc[n] = (amountAcc[n] || 0) + (sd.totalAmount || 0);
            }
        });
        return names;
    };

    const currAmountBySupplier = {};
    const currSuppliers = new Set();
    list.filter(o => inRange(o.createdAt, rangeStart, rangeEnd)).forEach(o => {
        for (const n of collectSuppliers(o, currAmountBySupplier)) currSuppliers.add(n);
    });

    const prevAmountBySupplier = {};
    const prevSuppliers = new Set();
    list.filter(o => inRange(o.createdAt, compareRangeStart, compareRangeEnd)).forEach(o => {
        for (const n of collectSuppliers(o, prevAmountBySupplier)) prevSuppliers.add(n);
    });

    const topSuppliers = Object.entries(currAmountBySupplier)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, amount]) => ({ name, amount }));

    const newSuppliers = Array.from(currSuppliers).filter(n => !prevSuppliers.has(n));
    const droppingSuppliers = Array.from(prevSuppliers).filter(n => !currSuppliers.has(n));

    return { topSuppliers, newSuppliers, droppingSuppliers };
}

// ── 권역별 트렌드 (견적/발주를 CRM 고객사 권역으로 귀속) ──────────────────────
// Quotation/Order에는 지역 필드도 Customer FK도 없어, 이미 프로덕션에서 쓰는 퍼지 매칭
// (customer-matching.js — local-api-server.js의 enrichCustomersWithGrade와 동일 로직)으로
// customers 목록에 귀속시킨다. 매칭에 실패한 건은 실제 '기타' 권역과 구분해 별도 버킷으로 집계한다.
const UNMATCHED_REGION_LABEL = 'CRM 미등록/예외';

function bucketByRegion(list, matchIndex) {
    const acc = {}; // region -> { count, amount }
    let unmatchedAmount = 0;
    let totalAmount = 0;
    list.forEach(rec => {
        const amount = rec.totalAmount || 0;
        totalAmount += amount;
        const matched = matchCustomerToCrmFast(rec, matchIndex.bizNoMap, matchIndex.exactNameMap, matchIndex.cleanNameMap);
        const region = matched?.region || UNMATCHED_REGION_LABEL;
        if (!acc[region]) acc[region] = { count: 0, amount: 0 };
        acc[region].count += 1;
        acc[region].amount += amount;
        if (!matched) unmatchedAmount += amount;
    });
    return { acc, unmatchedShare: totalAmount > 0 ? parseFloat(((unmatchedAmount / totalAmount) * 100).toFixed(1)) : 0 };
}

function toRegionRows(currAcc, prevAcc) {
    const regions = new Set([...Object.keys(currAcc), ...Object.keys(prevAcc)]);
    return Array.from(regions).map(region => {
        const curr = currAcc[region] || { count: 0, amount: 0 };
        const prev = prevAcc[region] || { count: 0, amount: 0 };
        return {
            region,
            count: curr.count,
            amount: curr.amount,
            countChangePct: pctChange(curr.count, prev.count),
            amountChangePct: pctChange(curr.amount, prev.amount),
        };
    }).sort((a, b) => b.amount - a.amount);
}

export function aggregateRegionTrend(quotations, orders, customers, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd) {
    const matchIndex = buildCustomerMatchIndex(customers);

    const qList = (quotations || []).filter(q => !q.isDeleted);
    const oList = (orders || []).filter(o => !o.isDeleted && !['CANCELLED', 'WITHDRAWN'].includes(o.status));

    const qCurr = bucketByRegion(qList.filter(q => inRange(q.createdAt, rangeStart, rangeEnd)), matchIndex);
    const qPrev = bucketByRegion(qList.filter(q => inRange(q.createdAt, compareRangeStart, compareRangeEnd)), matchIndex);
    const oCurr = bucketByRegion(oList.filter(o => inRange(o.createdAt, rangeStart, rangeEnd)), matchIndex);
    const oPrev = bucketByRegion(oList.filter(o => inRange(o.createdAt, compareRangeStart, compareRangeEnd)), matchIndex);

    return {
        quotationByRegion: toRegionRows(qCurr.acc, qPrev.acc),
        orderByRegion: toRegionRows(oCurr.acc, oPrev.acc),
        unmatchedLabel: UNMATCHED_REGION_LABEL,
        unmatchedQuotationShare: qCurr.unmatchedShare,
        unmatchedOrderShare: oCurr.unmatchedShare,
    };
}

// ── 기간 간 추세 시계열 (모멘텀) ──────────────────────────────────────────
// 단일 전기 대비가 아니라, 최근 N개 구간에 걸친 견적/발주 추이를 oldest→newest로 제공한다.
export function aggregateTrendSeries(quotations, orders, period, asOfDate, numBuckets) {
    const buckets = getPeriodBuckets(period, asOfDate, numBuckets);
    const qList = (quotations || []).filter(q => !q.isDeleted);
    const oList = (orders || []).filter(o => !o.isDeleted && !['CANCELLED', 'WITHDRAWN'].includes(o.status));

    return {
        buckets: buckets.map(b => {
            const qIn = qList.filter(q => inRange(q.createdAt, b.rangeStart, b.rangeEnd));
            const oIn = oList.filter(o => inRange(o.createdAt, b.rangeStart, b.rangeEnd));
            return {
                periodKey: b.periodKey,
                rangeStart: b.rangeStart,
                rangeEnd: b.rangeEnd,
                quotationCount: qIn.length,
                quotationAmount: qIn.reduce((s, q) => s + (q.totalAmount || 0), 0),
                orderCount: oIn.length,
                orderAmount: oIn.reduce((s, o) => s + (o.totalAmount || 0), 0),
            };
        }),
    };
}

// ── 품목별 구매/처분 의사결정 지원 ──────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_JSON_PATH = path.resolve(__dirname, 'public/api/inventory/inventory.json');
const INVENTORY_CACHE_TTL_MS = 5 * 60 * 1000;
let inventoryItemsCache = { map: null, timestamp: 0 };
let inventoryItemsLoadPromise = null;

// inventory.json(약 14,132개 품목)을 id 기준 Map으로 읽어 5분 TTL로 캐시한다.
// 크론으로 트리거되는 리포트 생성 경로에서는 local-api-server.js의 요청 기반 inventoryCache가
// 비어있을 수 있어(최근 HTTP 요청이 없었다면) 별도로, 자체적으로 캐시한다.
export async function loadInventoryItemsById() {
    const now = Date.now();
    if (inventoryItemsCache.map && (now - inventoryItemsCache.timestamp) < INVENTORY_CACHE_TTL_MS) {
        return inventoryItemsCache.map;
    }
    if (inventoryItemsLoadPromise) return inventoryItemsLoadPromise;

    inventoryItemsLoadPromise = (async () => {
        try {
            const raw = await fs.promises.readFile(INVENTORY_JSON_PATH, 'utf-8');
            const items = JSON.parse(raw);
            const map = new Map();
            (Array.isArray(items) ? items : []).forEach(it => {
                if (!it?.id) return;
                map.set(it.id, {
                    name: it.name,
                    unitPrice: it.unitPrice,
                    base_price: it.base_price,
                    material: it.material,
                    size: it.size,
                    thickness: it.thickness,
                });
            });
            inventoryItemsCache = { map, timestamp: Date.now() };
            return map;
        } catch (e) {
            console.warn('[report-aggregation] inventory.json 읽기 실패, 품목 마스터 데이터 없이 진행:', e.message);
            const empty = new Map();
            inventoryItemsCache = { map: empty, timestamp: Date.now() };
            return empty;
        } finally {
            inventoryItemsLoadPromise = null;
        }
    })();

    return inventoryItemsLoadPromise;
}

const RESTOCK_DAYS_ON_HAND = 14;
const EXCESS_DAYS_ON_HAND = 180;
const DEAD_STOCK_DROP_PCT = -80;

function classifyInventoryAction({ currentStock, recentHalfOutbound, earlierHalfOutbound, trendPct, daysOnHand }) {
    if (earlierHalfOutbound > 0 && (recentHalfOutbound === 0 || trendPct <= DEAD_STOCK_DROP_PCT) && currentStock > 0) {
        return {
            category: 'DEAD_STOCK_CANDIDATE',
            reason: `최근 구간 출고 ${recentHalfOutbound}개, 직전 구간(${earlierHalfOutbound}개) 대비 ${trendPct}% — 재고 ${currentStock.toLocaleString()}개가 정체 중입니다.`,
        };
    }
    if (daysOnHand !== null && daysOnHand < RESTOCK_DAYS_ON_HAND && recentHalfOutbound > 0) {
        return {
            category: 'RESTOCK',
            reason: `현재 재고로 약 ${daysOnHand.toFixed(0)}일분밖에 남지 않았는데도 최근 출고가 꾸준합니다(최근 구간 ${recentHalfOutbound}개).`,
        };
    }
    if (daysOnHand !== null && daysOnHand > EXCESS_DAYS_ON_HAND && currentStock > 0) {
        return {
            category: 'EXCESS',
            reason: `현재 재고 ${currentStock.toLocaleString()}개가 최근 출고 속도 기준 약 ${daysOnHand.toFixed(0)}일분에 달해 과잉재고로 보입니다.`,
        };
    }
    return {
        category: 'STABLE',
        reason: `최근 구간 출고 ${recentHalfOutbound}개로 특이사항 없이 안정적으로 소진되고 있습니다.`,
    };
}

// db.daekyungHistory의 가장 최근 windowSize개 스냅샷(기간 탭과 무관 — 확정이 불규칙하므로
// 달력 구간이 아닌 롤링 윈도우 사용)을 앞/뒤 절반으로 나눠 품목별 출고 추세를 비교하고,
// 재구매/유지/과잉/처분검토 4개 카테고리로 분류한다.
export function aggregateInventoryActionAnalysis(db, inventoryItemsById, options = {}) {
    const { windowSize = 12, topN = 18, minSnapsForConfidence = 3 } = options;

    const history = [...(db.daekyungHistory || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const window = history.slice(-windowSize);

    if (window.length < minSnapsForConfidence) {
        return {
            windowSnapCount: window.length,
            insufficientData: true,
            items: [],
            _note: `대경재고 확정 스냅샷이 ${window.length}건뿐이라 재고 액션 분석을 신뢰성 있게 계산할 수 없습니다. 스냅샷이 ${minSnapsForConfidence}건 이상 쌓이면 자동으로 분석이 시작됩니다.`,
        };
    }

    const mid = Math.floor(window.length / 2);
    const earlierSnaps = window.slice(0, mid);
    const recentSnaps = window.slice(mid);

    const sumOutboundByItem = (snaps) => {
        const acc = new Map(); // id -> { name, outbound }
        snaps.forEach(snap => {
            (snap.diff || []).forEach(d => {
                if (!(d.change > 0)) return; // change > 0 = 출고(감소), 기존 aggregateInventoryTrend와 동일 규약
                const prev = acc.get(d.id) || { name: d.name || d.id, outbound: 0 };
                prev.outbound += d.change;
                if (d.name) prev.name = d.name;
                acc.set(d.id, prev);
            });
        });
        return acc;
    };

    const earlierOutbound = sumOutboundByItem(earlierSnaps);
    const recentOutbound = sumOutboundByItem(recentSnaps);

    const allIds = new Set([...earlierOutbound.keys(), ...recentOutbound.keys()]);
    const recentDaySpan = Math.max(
        1,
        (new Date(recentSnaps[recentSnaps.length - 1].date) - new Date(recentSnaps[0].date)) / 86400000
    );

    const ranked = Array.from(allIds).map(id => {
        const earlier = earlierOutbound.get(id);
        const recent = recentOutbound.get(id);
        const name = recent?.name || earlier?.name || id;
        const earlierHalfOutbound = earlier?.outbound || 0;
        const recentHalfOutbound = recent?.outbound || 0;
        const totalOutbound = earlierHalfOutbound + recentHalfOutbound;

        const snapStock = db.currentDaekyungSnapshot?.[id];
        const currentStock = snapStock ? Number(snapStock.stock ?? snapStock.ys_qty ?? 0) : 0;
        const meta = inventoryItemsById?.get(id);

        const trendPct = earlierHalfOutbound > 0
            ? parseFloat((((recentHalfOutbound - earlierHalfOutbound) / earlierHalfOutbound) * 100).toFixed(1))
            : (recentHalfOutbound > 0 ? 100 : 0);
        const avgDailyOutboundRecent = recentHalfOutbound / recentDaySpan;
        const daysOnHand = avgDailyOutboundRecent > 0 ? currentStock / avgDailyOutboundRecent : null;

        const { category, reason } = classifyInventoryAction({ currentStock, recentHalfOutbound, earlierHalfOutbound, trendPct, daysOnHand });

        return {
            id,
            name,
            material: meta?.material,
            size: meta?.size,
            thickness: meta?.thickness,
            unitPrice: meta?.unitPrice,
            currentStock,
            recentHalfOutbound,
            earlierHalfOutbound,
            trendPct,
            daysOnHand: daysOnHand !== null ? parseFloat(daysOnHand.toFixed(1)) : null,
            category,
            reason,
            _totalOutbound: totalOutbound,
        };
    })
        .sort((a, b) => b._totalOutbound - a._totalOutbound)
        .slice(0, topN)
        .map(({ _totalOutbound, ...rest }) => rest);

    return {
        windowSnapCount: window.length,
        insufficientData: false,
        items: ranked,
    };
}

// ── 전체 집계 ──────────────────────────────────────────
export async function aggregateAllTrends(db, period, asOfDate = new Date()) {
    const { periodKey, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd } = getPeriodRange(period, asOfDate);
    const inventoryItemsById = await loadInventoryItemsById();
    return {
        periodKey,
        rangeStart,
        rangeEnd,
        quotationTrend: aggregateQuotationTrend(db.quotations, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd),
        orderTrend: aggregateOrderTrend(db.orders, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd),
        inventoryTrend: aggregateInventoryTrend(db.inventoryHistory, db.daekyungHistory, rangeStart, rangeEnd),
        supplierTrend: aggregateSupplierTrend(db.orders, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd),
        regionTrend: aggregateRegionTrend(db.quotations, db.orders, db.customers, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd),
        trendSeries: aggregateTrendSeries(db.quotations, db.orders, period, asOfDate, DEFAULT_TREND_BUCKETS[period]),
        inventoryActionAnalysis: aggregateInventoryActionAnalysis(db, inventoryItemsById),
    };
}
