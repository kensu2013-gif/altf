import type { Product } from '../types';

export interface DaekyungHistorySnapshot {
    date: string;
    diff: { id: string; change: number }[];
}

export interface DaekyungCoverageStats {
    confirmedDaysLast30: number;
    confirmedDaysLast90: number;
    lastConfirmedDate: string | null;
    daysSinceLastConfirm: number | null;
}

export type DaekyungAnomalyType = 'SURGE' | 'DROP' | 'NONE';
export type DaekyungAnomalySeverity = 'HIGH' | 'MEDIUM';

export interface DaekyungAnalysisItem {
    id: string;
    name: string;
    material: string;
    size: string;
    thickness: string;
    currentStock: number;
    avg1m: number;
    avg3m: number;
    avg6m: number;
    min1m: number;
    max1m: number;
    share1m: number;
    share3m: number;
    share6m: number;
    trend: number;
    prev1mAvg: number;
    changePct1m: number;
    changeQty1m: number;
    anomalyType: DaekyungAnomalyType;
    anomalySeverity?: DaekyungAnomalySeverity;
}

export interface DaekyungStockAnalysisResult {
    items: DaekyungAnalysisItem[];
    coverage: DaekyungCoverageStats;
}

// 급감/급증 판정 임계값 — 최근 30일 평균 vs 직전 30일 평균 비교 (확정 불규칙성으로 인한 노이즈에 강함)
const DROP_PCT_THRESHOLD = -30;
const DROP_SEVERE_PCT_THRESHOLD = -60;
const DROP_MIN_PREV_AVG = 5; // 소량 품목(5개 미만) 노이즈 제외
const SURGE_PCT_THRESHOLD = 50;
const SURGE_SEVERE_PCT_THRESHOLD = 150;
const SURGE_MIN_QTY_CHANGE = 10; // 절대 수량 최소치(0→소량 급등 노이즈 제외)

/**
 * 대경재고(양산) 1/3/6개월 평균 보유수량 및 급감/급증 이상치를 계산한다.
 * SihwaInventory.tsx / BusanInventory.tsx의 대경재고 평균 분석 탭 공용 로직.
 */
export function computeDaekyungStockAnalysis(
    targetProducts: Product[],
    daekyungHistory: DaekyungHistorySnapshot[] | undefined
): DaekyungStockAnalysisResult {
    const history = daekyungHistory || [];

    const dates: string[] = [];
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    for (let i = 0; i < 180; i++) {
        const d = new Date(kstNow.getTime() - i * 24 * 60 * 60 * 1000);
        dates.push(d.toISOString().slice(0, 10));
    }

    const historyMapByDate: Record<string, Record<string, number>> = {};
    history.forEach(h => {
        const dateStr = h.date.split('T')[0];
        const dateMap: Record<string, number> = {};
        (h.diff || []).forEach(d => {
            dateMap[d.id] = d.change;
        });
        historyMapByDate[dateStr] = dateMap;
    });

    // ── 데이터 확정 커버리지(불규칙 confirm 실태) ──
    const confirmedDateSet = new Set(history.map(h => h.date.split('T')[0]));
    let confirmedDaysLast30 = 0;
    let confirmedDaysLast90 = 0;
    for (let i = 0; i < 90; i++) {
        if (confirmedDateSet.has(dates[i])) {
            confirmedDaysLast90++;
            if (i < 30) confirmedDaysLast30++;
        }
    }
    const sortedConfirmedDates = Array.from(confirmedDateSet).sort();
    const lastConfirmedDate = sortedConfirmedDates.length > 0 ? sortedConfirmedDates[sortedConfirmedDates.length - 1] : null;
    let daysSinceLastConfirm: number | null = null;
    if (lastConfirmedDate) {
        const lastDate = new Date(`${lastConfirmedDate}T00:00:00`);
        const todayDate = new Date(`${dates[0]}T00:00:00`);
        daysSinceLastConfirm = Math.round((todayDate.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
    }

    // ── 품목별 180일 일별 재고 역산 + 기간별 평균 ──
    const rawResults = targetProducts.map((item) => {
        let ysQty = 0;
        if (item.locationStock) {
            if (item.locationStock['양산'] !== undefined) ysQty += Number(item.locationStock['양산']);
            if (item.locationStock['대경'] !== undefined) ysQty += Number(item.locationStock['대경']);
        } else {
            if ((item.location || '').includes('양산') || (item.location || '').includes('대경')) {
                ysQty = item.currentStock;
            }
        }

        const dailyStocks: number[] = new Array(180).fill(0);
        let currentStock = ysQty;

        for (let i = 0; i < 180; i++) {
            const date = dates[i];
            dailyStocks[i] = currentStock;

            const diffs = historyMapByDate[date] || {};
            const change = diffs[item.id];
            if (change !== undefined) {
                currentStock = Math.max(0, currentStock - change);
            }
        }

        const stocks1m = dailyStocks.slice(0, 30);
        const sum1m = stocks1m.reduce((s, val) => s + val, 0);
        const avg1m = stocks1m.length > 0 ? parseFloat((sum1m / stocks1m.length).toFixed(1)) : ysQty;
        const min1m = stocks1m.length > 0 ? Math.min(...stocks1m) : ysQty;
        const max1m = stocks1m.length > 0 ? Math.max(...stocks1m) : ysQty;

        const stocks3m = dailyStocks.slice(0, 90);
        const sum3m = stocks3m.reduce((s, val) => s + val, 0);
        const avg3m = stocks3m.length > 0 ? parseFloat((sum3m / stocks3m.length).toFixed(1)) : ysQty;

        const stocks6m = dailyStocks;
        const sum6m = stocks6m.reduce((s, val) => s + val, 0);
        const avg6m = stocks6m.length > 0 ? parseFloat((sum6m / stocks6m.length).toFixed(1)) : ysQty;

        const stocksPrev1m = dailyStocks.slice(30, 60);
        const sumPrev1m = stocksPrev1m.reduce((s, val) => s + val, 0);
        const prev1mAvg = stocksPrev1m.length > 0 ? parseFloat((sumPrev1m / stocksPrev1m.length).toFixed(1)) : avg1m;

        const changeQty1m = parseFloat((avg1m - prev1mAvg).toFixed(1));
        const changePct1m = prev1mAvg > 0
            ? parseFloat(((changeQty1m / prev1mAvg) * 100).toFixed(1))
            : (avg1m > 0 ? 100 : 0);

        return {
            id: item.id,
            name: item.name || '미등록 상품',
            material: item.material || '',
            size: item.size || '',
            thickness: item.thickness || '',
            currentStock: ysQty,
            avg1m,
            avg3m,
            avg6m,
            min1m,
            max1m,
            prev1mAvg,
            changePct1m,
            changeQty1m,
        };
    });

    const total1m = rawResults.reduce((s, r) => s + r.avg1m, 0);
    const total3m = rawResults.reduce((s, r) => s + r.avg3m, 0);
    const total6m = rawResults.reduce((s, r) => s + r.avg6m, 0);

    const items: DaekyungAnalysisItem[] = rawResults.map(r => {
        const share1m = total1m > 0 ? parseFloat(((r.avg1m / total1m) * 100).toFixed(2)) : 0;
        const share3m = total3m > 0 ? parseFloat(((r.avg3m / total3m) * 100).toFixed(2)) : 0;
        const share6m = total6m > 0 ? parseFloat(((r.avg6m / total6m) * 100).toFixed(2)) : 0;
        const trend = r.avg6m > 0 ? parseFloat((((r.avg3m - r.avg6m) / r.avg6m) * 100).toFixed(1)) : (r.avg3m > 0 ? 100 : 0);

        let anomalyType: DaekyungAnomalyType = 'NONE';
        let anomalySeverity: DaekyungAnomalySeverity | undefined;

        if (r.changePct1m <= DROP_PCT_THRESHOLD && r.prev1mAvg >= DROP_MIN_PREV_AVG) {
            anomalyType = 'DROP';
            anomalySeverity = r.changePct1m <= DROP_SEVERE_PCT_THRESHOLD ? 'HIGH' : 'MEDIUM';
        } else if (r.changePct1m >= SURGE_PCT_THRESHOLD && Math.abs(r.changeQty1m) >= SURGE_MIN_QTY_CHANGE) {
            anomalyType = 'SURGE';
            anomalySeverity = r.changePct1m >= SURGE_SEVERE_PCT_THRESHOLD ? 'HIGH' : 'MEDIUM';
        }

        return {
            ...r,
            share1m,
            share3m,
            share6m,
            trend,
            anomalyType,
            anomalySeverity,
        };
    });

    return {
        items,
        coverage: { confirmedDaysLast30, confirmedDaysLast90, lastConfirmedDate, daysSinceLastConfirm },
    };
}
