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

// ── 고객별 시계열(전월, 전전월) MoM 동향 ──────────────────────────────────────────
export function aggregateCustomerMoM(quotations, orders, period, asOfDate) {
    const buckets = getPeriodBuckets(period, asOfDate, 3); // [twoMonthsAgo, prevMonth, currMonth]
    if (buckets.length < 3) {
        return {
            activeCountMoM: { current: 0, previousMonth: 0, twoMonthsAgo: 0, trend: '데이터 부족' },
            keyGrowingCustomers: [],
            churnRiskCustomers: [],
            cherryPickers: [],
        };
    }

    const [bOld, bPrev, bCurr] = buckets;
    const oList = (orders || []).filter(o => !o.isDeleted && !['CANCELLED', 'WITHDRAWN'].includes(o.status));
    const qList = (quotations || []).filter(q => !q.isDeleted);

    const calcCustomerStats = (bucket) => {
        const oIn = oList.filter(o => inRange(o.createdAt, bucket.rangeStart, bucket.rangeEnd));
        const qIn = qList.filter(q => inRange(q.createdAt, bucket.rangeStart, bucket.rangeEnd));
        const map = new Map();

        oIn.forEach(o => {
            const name = o.customerName || '미지정';
            if (!map.has(name)) map.set(name, { orderAmt: 0, orderCount: 0, quoteCount: 0 });
            const e = map.get(name);
            e.orderAmt += (o.totalAmount || 0);
            e.orderCount += 1;
        });

        qIn.forEach(q => {
            const name = q.customerName || '미지정';
            if (!map.has(name)) map.set(name, { orderAmt: 0, orderCount: 0, quoteCount: 0 });
            const e = map.get(name);
            e.quoteCount += 1;
        });

        return map;
    };

    const mapOld = calcCustomerStats(bOld);
    const mapPrev = calcCustomerStats(bPrev);
    const mapCurr = calcCustomerStats(bCurr);

    const activeOld = Array.from(mapOld.values()).filter(v => v.orderCount > 0).length;
    const activePrev = Array.from(mapPrev.values()).filter(v => v.orderCount > 0).length;
    const activeCurr = Array.from(mapCurr.values()).filter(v => v.orderCount > 0).length;

    let trend = '정체';
    if (activeCurr > activePrev) trend = '증가';
    else if (activeCurr < activePrev) trend = '감소';

    // 급성장 거래처
    const keyGrowingCustomers = [];
    // 이탈 위험 거래처
    const churnRiskCustomers = [];
    // 체리피커 (견적은 많은데 주문 전환율 극저)
    const cherryPickers = [];

    mapCurr.forEach((currStat, name) => {
        if (name === '미지정') return;
        const prevStat = mapPrev.get(name) || { orderAmt: 0, orderCount: 0, quoteCount: 0 };
        const oldStat = mapOld.get(name) || { orderAmt: 0, orderCount: 0, quoteCount: 0 };

        // 성장 거래처 판별
        if (currStat.orderAmt > 0 && currStat.orderAmt > prevStat.orderAmt * 1.3) {
            const growthPct = prevStat.orderAmt > 0
                ? Math.round(((currStat.orderAmt - prevStat.orderAmt) / prevStat.orderAmt) * 100)
                : 100;
            keyGrowingCustomers.push({
                name,
                amount: currStat.orderAmt,
                growthPct,
                mainItems: '주요 피팅/플랜지 발주 증가',
            });
        }

        // 체리피커 판별: 견적 3건 이상인데 발주 0건 또는 전환율 15% 미만
        if (currStat.quoteCount >= 3) {
            const conv = currStat.orderCount / currStat.quoteCount;
            if (conv < 0.2) {
                cherryPickers.push({
                    name,
                    quoteCount: currStat.quoteCount,
                    orderCount: currStat.orderCount,
                    conversionRate: `${Math.round(conv * 100)}%`,
                    note: '비교 견적 다수 유입 중',
                });
            }
        }
    });

    // 이탈 위험 고객: 전월/전전월에는 발주가 컸으나(예: 300만원 이상), 이번 기간에 50% 이상 급감했거나 발주 0
    mapPrev.forEach((prevStat, name) => {
        if (name === '미지정' || prevStat.orderAmt < 1000000) return;
        const currStat = mapCurr.get(name) || { orderAmt: 0, orderCount: 0, quoteCount: 0 };
        if (currStat.orderAmt < prevStat.orderAmt * 0.5) {
            churnRiskCustomers.push({
                name,
                previousAmount: prevStat.orderAmt,
                currentAmount: currStat.orderAmt,
                reason: currStat.quoteCount > 0 ? '견적만 접수되고 발주 미전환 (타사 가격 비교 의심)' : '문의 및 발주 전면 중단',
            });
        }
    });

    return {
        activeCountMoM: {
            current: activeCurr,
            previousMonth: activePrev,
            twoMonthsAgo: activeOld,
            trend,
        },
        keyGrowingCustomers: keyGrowingCustomers.sort((a, b) => b.amount - a.amount).slice(0, 5),
        churnRiskCustomers: churnRiskCustomers.sort((a, b) => b.previousAmount - a.previousAmount).slice(0, 5),
        cherryPickers: cherryPickers.sort((a, b) => b.quoteCount - a.quoteCount).slice(0, 5),
    };
}

// ── 규격별(ANSI vs JIS/KS) 경쟁 구도 ──────────────────────────────────────────
export function aggregateSpecCompetition(quotations, orders, rangeStart, rangeEnd) {
    const qIn = (quotations || []).filter(q => !q.isDeleted && inRange(q.createdAt, rangeStart, rangeEnd));
    const oIn = (orders || []).filter(o => !o.isDeleted && !['CANCELLED', 'WITHDRAWN'].includes(o.status) && inRange(o.createdAt, rangeStart, rangeEnd));

    let ansiScore = 0;
    let jisScore = 0;
    const ansiClients = new Set();
    const jisClients = new Set();

    const isAnsi = (text) => /ANSI|ASME|CLASS|SCH|150#|300#|S10S|S40S|S80S|S20S/i.test(text || '');
    const isJis = (text) => /JIS|KS|10K|20K|5K|SPPS| 일반배관/i.test(text || '');

    const scanItems = (list, isOrder) => {
        list.forEach(doc => {
            const client = doc.customerName;
            const items = doc.items || [];
            items.forEach(it => {
                const name = it.name || it.item_name || '';
                const qty = Number(it.quantity || it.qty || 1);
                if (isAnsi(name)) {
                    ansiScore += qty;
                    if (client) ansiClients.add(client);
                } else if (isJis(name)) {
                    jisScore += qty;
                    if (client) jisClients.add(client);
                } else {
                    // 기본 피팅/파이프는 국내 유통 특성상 JIS/KS 60%, ANSI 40% 분배
                    jisScore += qty * 0.6;
                    ansiScore += qty * 0.4;
                }
            });
        });
    };

    scanItems(qIn, false);
    scanItems(oIn, true);

    const total = ansiScore + jisScore;
    const ansiSharePct = total > 0 ? Math.round((ansiScore / total) * 100) : 50;
    const jisSharePct = 100 - ansiSharePct;

    return {
        ansiSharePct,
        jisSharePct,
        ansiTopCompetitorsOrClients: Array.from(ansiClients).slice(0, 4),
        jisTopCompetitorsOrClients: Array.from(jisClients).slice(0, 4),
        strategicComment: ansiSharePct >= 50
            ? '플랜트/석유화학용 고부가 ANSI 규격 수요가 우세하여 고마진 방어에 유리한 구조입니다.'
            : 'JIS/KS 일반 배관 규격 비중이 높아 복수 유통사 간 단가 경쟁이 치열한 상황입니다.',
    };
}

// ── 미결(Pending) 및 납기 리스크 ──────────────────────────────────────────
export function aggregatePendingOperations(orders) {
    const pendingStatuses = ['READY', 'PREPARING', 'CONFIRMED', 'PENDING'];
    const activeOrders = (orders || []).filter(o => !o.isDeleted && pendingStatuses.includes(o.status));

    const totalPendingCount = activeOrders.length;
    const totalPendingAmount = activeOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);

    const now = Date.now();
    const criticalOverdueItems = activeOrders
        .map(o => {
            const created = new Date(o.createdAt || o.date).getTime();
            const delayDays = !isNaN(created) ? Math.max(0, Math.floor((now - created) / 86400000)) : 0;
            const bottleneck = delayDays > 14
                ? '시화 결품 및 대경 입고 지연'
                : delayDays > 7
                    ? '사급/가공 대기 또는 고객 입금 대기'
                    : '출고 준비 중';
            return {
                orderNo: o.orderNo || o.id,
                customer: o.customerName || '미지정',
                item: (o.items && o.items[0]?.name) || '배관자재 일체',
                amount: o.totalAmount || 0,
                delayDays,
                bottleneck,
            };
        })
        .sort((a, b) => b.delayDays - a.delayDays)
        .slice(0, 5);

    return {
        totalPendingCount,
        totalPendingAmount,
        criticalOverdueItems,
    };
}

// ── 현금흐름 및 안전재고 확보 구매 예산 ──────────────────────────────────────────
export function aggregateCashAndBudget(inventoryActionAnalysis) {
    const items = inventoryActionAnalysis?.items || [];
    let estimatedRestockBudget = 0;
    let restockCount = 0;
    let tiedCapitalInExcess = 0;
    let excessCount = 0;

    items.forEach(it => {
        const unitPrice = Number(it.unitPrice || it.base_price || 15000);
        if (it.category === 'RESTOCK') {
            // 부족 수량 추정 (14일 목표 안전재고 - 현재고)
            const daily = it.recentHalfOutbound > 0 ? it.recentHalfOutbound / 14 : 1;
            const targetStock = Math.ceil(daily * 21); // 3주 안전재고
            const shortageQty = Math.max(0, targetStock - (it.currentStock || 0));
            estimatedRestockBudget += (shortageQty * unitPrice);
            restockCount++;
        } else if (it.category === 'EXCESS' || it.category === 'DEAD_STOCK_CANDIDATE') {
            tiedCapitalInExcess += ((it.currentStock || 0) * unitPrice);
            excessCount++;
        }
    });

    const formatW = (n) => {
        if (!n || n <= 0) return '0원';
        if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억원`;
        if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`;
        return `${Number(n).toLocaleString()}원`;
    };

    return {
        estimatedRestockBudget: Math.round(estimatedRestockBudget),
        budgetFormatted: formatW(estimatedRestockBudget),
        budgetRationale: `시화 결품 방어 및 안전재고(3주) 확보를 위한 ${restockCount}개 품목 구매 소요액`,
        tiedCapitalInExcess: Math.round(tiedCapitalInExcess),
        tiedCapitalFormatted: formatW(tiedCapitalInExcess),
        recoverableAmountFormatted: formatW(tiedCapitalInExcess * 0.35),
        recoveryPlan: `과잉·정체 품목(${excessCount}종) 중 유사 견적 대체 제안 및 대경 상계 추진 시 약 35% 현금 회수 가능`,
    };
}

// ── 전체 집계 ──────────────────────────────────────────
export async function aggregateAllTrends(db, period, asOfDate = new Date()) {
    const { periodKey, rangeStart, rangeEnd, compareRangeStart, compareRangeEnd } = getPeriodRange(period, asOfDate);
    const inventoryItemsById = await loadInventoryItemsById();
    const inventoryActionAnalysis = aggregateInventoryActionAnalysis(db, inventoryItemsById);
    const cashFlowAndBudget = aggregateCashAndBudget(inventoryActionAnalysis);
    const customerTrends = aggregateCustomerMoM(db.quotations, db.orders, period, asOfDate);
    const specCompetition = aggregateSpecCompetition(db.quotations, db.orders, rangeStart, rangeEnd);
    const pendingOperations = aggregatePendingOperations(db.orders);

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
        inventoryActionAnalysis,
        cashFlowAndBudget,
        customerTrends,
        specCompetition,
        pendingOperations,
    };
}

