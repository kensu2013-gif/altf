import type { Product } from '../types';

export interface DaekyungHistorySnapshot {
    date: string;
    diff: { id: string; change: number; from?: number; to?: number }[];
}

export interface DaekyungCoverageStats {
    confirmedDaysLast30: number;
    confirmedDaysLast90: number;
    lastConfirmedDate: string | null;
    daysSinceLastConfirm: number | null;
    analysisAnchorDate?: string;
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
    min3m: number;
    max3m: number;
    min6m: number;
    max6m: number;
    share1m: number;
    share3m: number;
    share6m: number;
    trend: number;
    prev1mAvg: number;
    changePct1m: number;
    changeQty1m: number;
    anomalyType: DaekyungAnomalyType;
    anomalySeverity?: DaekyungAnomalySeverity;
    hasHistory: boolean;
    sampleCount3m: number;
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
 * 대경재고(양산) 1/3/6개월 평균 보유수량 및 최대/최소 변동폭(min/max), 급감/급증 이상치를 계산한다.
 * SihwaInventory.tsx / BusanInventory.tsx의 대경재고 평균 분석 탭 공용 로직.
 */
export function computeDaekyungStockAnalysis(
    targetProducts: Product[],
    daekyungHistory: DaekyungHistorySnapshot[] | undefined
): DaekyungStockAnalysisResult {
    const history = daekyungHistory || [];

    // ── 데이터 확정 커버리지 및 기준일(Smart Anchor) 결정 ──
    const confirmedDateSet = new Set(history.map(h => h.date.split('T')[0]));
    const sortedConfirmedDates = Array.from(confirmedDateSet).sort();
    const lastConfirmedDate = sortedConfirmedDates.length > 0 ? sortedConfirmedDates[sortedConfirmedDates.length - 1] : null;

    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let daysSinceLastConfirm: number | null = null;

    if (lastConfirmedDate) {
        const lastDate = new Date(`${lastConfirmedDate}T00:00:00`);
        const todayDate = new Date(`${todayKst}T00:00:00`);
        daysSinceLastConfirm = Math.round((todayDate.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
    }

    // 최신 확정일이 오늘로부터 30일 이상 경과한 경우, 최신 확정일을 앵커로 잡아야 최근 90일 구간 내 실제 변동 데이터가 유실되지 않음
    const analysisAnchorDate = (lastConfirmedDate && daysSinceLastConfirm !== null && daysSinceLastConfirm > 30)
        ? lastConfirmedDate
        : todayKst;

    const anchorDateObj = new Date(`${analysisAnchorDate}T00:00:00`);
    const dates: string[] = [];
    for (let i = 0; i < 180; i++) {
        const d = new Date(anchorDateObj.getTime() - i * 24 * 60 * 60 * 1000);
        dates.push(d.toISOString().slice(0, 10));
    }

    let confirmedDaysLast30 = 0;
    let confirmedDaysLast90 = 0;
    for (let i = 0; i < 90; i++) {
        if (confirmedDateSet.has(dates[i])) {
            confirmedDaysLast90++;
            if (i < 30) confirmedDaysLast30++;
        }
    }

    // 날짜별 diff 매핑
    const historyMapByDate: Record<string, Record<string, { change: number; from?: number; to?: number }>> = {};
    history.forEach(h => {
        const dateStr = h.date.split('T')[0];
        const dateMap: Record<string, { change: number; from?: number; to?: number }> = {};
        (h.diff || []).forEach(d => {
            dateMap[d.id] = { change: d.change, from: d.from, to: d.to };
        });
        historyMapByDate[dateStr] = dateMap;
    });

    // ── 품목별 180일 일별 재고 역산 + 기간별 평균/최대/최소 ──
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
        const observedStocks1m: number[] = [ysQty];
        const observedStocks3m: number[] = [ysQty];
        const observedStocks6m: number[] = [ysQty];
        let diffCount3m = 0;

        // 최신 확정일 시점의 스냅샷 to 값이 존재하면 기준 재고로 활용
        let currentStock = ysQty;
        for (let j = 0; j < dates.length; j++) {
            const dSnap = historyMapByDate[dates[j]]?.[item.id];
            if (dSnap && dSnap.to !== undefined) {
                currentStock = dSnap.to;
                break;
            }
        }

        for (let i = 0; i < 180; i++) {
            const date = dates[i];
            const diffInfo = historyMapByDate[date]?.[item.id];

            if (diffInfo) {
                if (diffInfo.to !== undefined) currentStock = diffInfo.to;
                dailyStocks[i] = currentStock;

                if (i < 30) {
                    if (diffInfo.from !== undefined) observedStocks1m.push(diffInfo.from);
                    if (diffInfo.to !== undefined) observedStocks1m.push(diffInfo.to);
                }
                if (i < 90) {
                    diffCount3m++;
                    if (diffInfo.from !== undefined) observedStocks3m.push(diffInfo.from);
                    if (diffInfo.to !== undefined) observedStocks3m.push(diffInfo.to);
                }
                if (diffInfo.from !== undefined) observedStocks6m.push(diffInfo.from);
                if (diffInfo.to !== undefined) observedStocks6m.push(diffInfo.to);

                // 과거로 거슬러 올라가기: 해당 일자의 이전 재고는 (to - change) 또는 from
                if (diffInfo.from !== undefined) {
                    currentStock = diffInfo.from;
                } else if (diffInfo.change !== undefined) {
                    currentStock = Math.max(0, currentStock - diffInfo.change);
                }
            } else {
                dailyStocks[i] = currentStock;
            }
        }

        const stocks1m = dailyStocks.slice(0, 30);
        const sum1m = stocks1m.reduce((s, val) => s + val, 0);
        const avg1m = stocks1m.length > 0 ? parseFloat((sum1m / stocks1m.length).toFixed(1)) : ysQty;
        const min1m = Math.min(...stocks1m, ...observedStocks1m);
        const max1m = Math.max(...stocks1m, ...observedStocks1m);

        const stocks3m = dailyStocks.slice(0, 90);
        const sum3m = stocks3m.reduce((s, val) => s + val, 0);
        const avg3m = stocks3m.length > 0 ? parseFloat((sum3m / stocks3m.length).toFixed(1)) : ysQty;
        const min3m = Math.min(...stocks3m, ...observedStocks3m);
        const max3m = Math.max(...stocks3m, ...observedStocks3m);

        const stocks6m = dailyStocks;
        const sum6m = stocks6m.reduce((s, val) => s + val, 0);
        const avg6m = stocks6m.length > 0 ? parseFloat((sum6m / stocks6m.length).toFixed(1)) : ysQty;
        const min6m = Math.min(...stocks6m, ...observedStocks6m);
        const max6m = Math.max(...stocks6m, ...observedStocks6m);

        const stocksPrev1m = dailyStocks.slice(30, 60);
        const sumPrev1m = stocksPrev1m.reduce((s, val) => s + val, 0);
        const prev1mAvg = stocksPrev1m.length > 0 ? parseFloat((sumPrev1m / stocksPrev1m.length).toFixed(1)) : avg1m;

        const changeQty1m = parseFloat((avg1m - prev1mAvg).toFixed(1));
        const changePct1m = prev1mAvg > 0
            ? parseFloat(((changeQty1m / prev1mAvg) * 100).toFixed(1))
            : (avg1m > 0 ? 100 : 0);

        const hasHistory = diffCount3m > 0 || min3m !== max3m || avg3m !== ysQty;

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
            min3m,
            max3m,
            min6m,
            max6m,
            prev1mAvg,
            changePct1m,
            changeQty1m,
            hasHistory,
            sampleCount3m: diffCount3m,
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
        coverage: { confirmedDaysLast30, confirmedDaysLast90, lastConfirmedDate, daysSinceLastConfirm, analysisAnchorDate },
    };
}
