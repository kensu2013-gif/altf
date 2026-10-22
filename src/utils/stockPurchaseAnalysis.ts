import type { Product, Order, LineItem } from '../types';

export interface PendingMatch {
    poNumber: string;
    poDate: string;
    quantity: number;
    customerName: string;
}

export type PurchaseSuitabilityType = 
    | 'DOUBLE_STOCKOUT'     // 자사/공급처 동시결품 (최우선 긴급구매)
    | 'URGENT_UNMET'        // 시화 안전재고 미달 & 회전율 양호 (선발주 권장)
    | 'SURGING_DEMAND'      // 최근 수요 급증 (선발주 권장)
    | 'DAEKYUNG_TRANSFER'   // 대경재고 충분 (신규 매입 대신 공장이송/직송 권장)
    | 'EXCESS_CAUTION'      // 시화 과잉재고 보유 (추가 구매 비권장)
    | 'DEAD_STOCK_CAUTION'  // 장기 무수요 악성재고 위험 (구매 비권장)
    | 'NORMAL'              // 정상/안정 유지
    | 'UNKNOWN';

export interface StockPurchaseAnalysisResult {
    productId: string;
    productName: string;
    spec: string;
    healthGrade: 'A' | 'B' | 'C' | 'D' | 'E' | 'N';
    daekyungStock: number;   // 대경 현재고
    sihwaStock: number;      // 시화 현재고
    busanStock: number;      // 부산 현재고
    safeStock: number;       // 시화 적정 안전재고
    recommendedQty: number;  // 1~3개월 권장구매량
    recent30dSales: number;  // 최근 30일 출고량
    recent90dSales: number;  // 최근 90일 출고량
    recent90dOrders: number; // 최근 90일 출고 횟수
    suitabilityType: PurchaseSuitabilityType;
    recommendation: PurchaseSuitabilityType; // suitabilityType의 alias/호환 속성
    suitabilityBadge: {
        text: string;
        bgClass: string;
        textClass: string;
        borderClass: string;
    };
    suitabilityReason: string;
    pendingDuplicateCount: number;
    pendingDuplicateQty: number;
    pendingMatches: PendingMatch[];
    hasOpenDuplicateOrder: boolean; // pendingDuplicateCount > 0 여부
}

/**
 * 규격 키 정규화 (품목명 + 두께 + 사이즈 + 재질)
 */
export function normalizeSpecKey(name?: string, thickness?: string, size?: string, material?: string): string {
    return [name, thickness, size, material]
        .map(v => (v || '').trim().toLowerCase().replace(/\s+/g, ''))
        .filter(Boolean)
        .join('::');
}

/**
 * 특정 품목에 대한 재고 구매(가견적/발주) 의사결정 분석 실행
 */
export function analyzeStockPurchaseItem(
    item: Partial<LineItem> & { name?: string; thickness?: string; size?: string; material?: string; quantity?: number },
    inventory: Product[],
    orders: Order[],
    currentOrderId?: string
): StockPurchaseAnalysisResult {
    const rawName = item.name || '';
    const rawThick = item.thickness || '';
    const rawSize = item.size || '';
    const rawMat = item.material || '';
    const itemSpecKey = normalizeSpecKey(rawName, rawThick, rawSize, rawMat);
    const orderQty = Number(item.quantity || 0);

    // 1. 인벤토리에서 매칭되는 품목 찾기 (ID 우선, 규격 차선)
    let matchedProduct: Product | undefined;
    if (item.productId) {
        matchedProduct = inventory.find(p => p.id === item.productId);
    }
    if (!matchedProduct && itemSpecKey) {
        matchedProduct = inventory.find(p => {
            const pKey = normalizeSpecKey(p.name, p.thickness, p.size, p.material);
            return pKey === itemSpecKey;
        });
    }

    // 2. 대경 / 시화 / 부산 재고 정확한 실시간 현재고 집계
    let daekyungStock = 0;
    let sihwaStock = 0;
    let busanStock = 0;

    if (matchedProduct) {
        // 동일 ID가 나뉘어 있을 수 있으므로 inventory 전체에서 집계
        const targetId = matchedProduct.id;
        inventory.forEach(p => {
            if (p.id === targetId) {
                if (p.locationStock && Object.keys(p.locationStock).length > 0) {
                    if (p.locationStock['양산'] !== undefined) daekyungStock += Number(p.locationStock['양산']);
                    if (p.locationStock['대경'] !== undefined) daekyungStock += Number(p.locationStock['대경']);
                    if (p.locationStock['시화'] !== undefined) sihwaStock += Number(p.locationStock['시화']);
                    if (p.locationStock['서울'] !== undefined) sihwaStock += Number(p.locationStock['서울']);
                    if (p.locationStock['부산'] !== undefined) busanStock += Number(p.locationStock['부산']);
                } else {
                    const loc = (p.location || '').toLowerCase();
                    const loc1 = (p.location1 || '').toLowerCase();
                    const cur = Number(p.currentStock || 0);
                    const sh = Number(p.shQty ?? p.sh_qty ?? 0);
                    const ys = Number(p.ready_qty ?? 0);

                    if (loc.includes('양산') || loc.includes('대경')) daekyungStock += cur;
                    else if (ys > 0) daekyungStock += ys;

                    if (loc.includes('시화') || loc.includes('서울') || loc1.includes('시화')) sihwaStock += (sh > 0 ? sh : cur);
                    else if (sh > 0) sihwaStock += sh;

                    if (loc.includes('부산') || loc1.includes('부산')) busanStock += cur;
                }
            }
        });
    }

    // 3. 최근 판매 실적 집계 (orders 기반)
    const nowTime = Date.now();
    const thirtyDaysAgo = nowTime - (30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = nowTime - (90 * 24 * 60 * 60 * 1000);

    let recent30dSales = 0;
    let recent90dSales = 0;
    let recent90dOrders = 0;
    let totalSales = 0;

    const matchedOrders = new Set<string>();

    orders.forEach(order => {
        if (order.status === 'CANCELLED' || order.status === 'WITHDRAWN' || order.isDeleted) return;
        const cust = (order.poEndCustomer || order.supplierInfo?.company_name || order.customerName || '').toLowerCase().replace(/\s+/g, '');
        // 알트에프, (주)알트에프, 알트에프(서울영업소) 등 자사 내부 건은 고객사 판매 실적에서 제외
        if (cust.includes('알트에프') || cust.includes('altf') || cust.includes('서울영업소') || cust.includes('시화재고') || cust.includes('서울재고') || cust.includes('부산재고')) return;

        const oDate = new Date(order.createdAt).getTime();
        const oItems = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
        if (!oItems) return;

        oItems.forEach(oi => {
            const oiSpecKey = normalizeSpecKey(oi.name, oi.thickness, oi.size, oi.material);
            const isMatch = (item.productId && (oi.productId === item.productId || oi.item_id === item.productId)) ||
                            (itemSpecKey && oiSpecKey === itemSpecKey);

            if (isMatch) {
                const qty = Number(oi.quantity ?? oi.qty ?? 0);
                totalSales += qty;
                if (!isNaN(oDate)) {
                    if (oDate >= thirtyDaysAgo) recent30dSales += qty;
                    if (oDate >= ninetyDaysAgo) {
                        recent90dSales += qty;
                        if (!matchedOrders.has(order.id)) {
                            matchedOrders.add(order.id);
                            recent90dOrders++;
                        }
                    }
                }
            }
        });
    });

    // 4. 건전성 등급 산출 (A/B/C/D/E/N)
    let healthGrade: 'A' | 'B' | 'C' | 'D' | 'E' | 'N' = 'C';
    if (recent90dSales >= 40 || (recent90dSales >= 15 && totalSales >= 80)) {
        healthGrade = 'A';
    } else if (recent90dSales >= 15 || totalSales >= 30) {
        healthGrade = 'B';
    } else if (recent90dSales > 0 || totalSales > 0) {
        healthGrade = 'C';
    } else if (sihwaStock > 0 || daekyungStock > 0) {
        healthGrade = 'D'; // 재고는 있으나 최근 무실적
    } else {
        healthGrade = 'N'; // 무실적 & 무재고
    }

    // 5. 안전재고 산출
    let safeStock = 0;
    if (healthGrade === 'A') {
        safeStock = Math.max(15, Math.ceil(recent90dSales / 3 * 1.5));
    } else if (healthGrade === 'B') {
        safeStock = Math.max(5, Math.ceil(recent90dSales / 3));
    } else if (healthGrade === 'C') {
        safeStock = Math.max(0, Math.ceil(recent90dSales / 3 * 0.5));
    }

/**
 * 해당 주문이 '재고 발주분'인지 여부 판별
 * (미결관리 /admin/pending의 [재고 발주분 미결] 탭 분류 기준과 일치)
 */
export function isStockPurchaseOrder(order: Order, item?: any): boolean {
    if (order.isStockOrder) return true;
    if (item?.isStockItem || item?.stockTargetLocation === 'SIHWA' || item?.stockTargetLocation === 'BUSAN') {
        return true;
    }
    const targetCust = (order.poEndCustomer || (order as any).payload?.customer?.company_name || order.customerName || (order as any).buyerInfo?.company_name || '').toLowerCase().replace(/\s+/g, '');
    return targetCust.includes('시화재고') ||
        targetCust.includes('부산재고') ||
        targetCust.includes('알트에프재고') ||
        targetCust.includes('알트에프') ||
        targetCust.includes('altf');
}

    // 6. 미결 중복 발주건 체크
    // ★ 사용자 요청: 일반 고객사 납품용 주문은 중복 대상이 아니며,
    // 오직 미결관리(Pending)의 '재고 발주분'에 이미 등록되어 대기 중인 발주건만 중복으로 체크!
    const pendingMatches: PendingMatch[] = [];
    orders.forEach(otherOrder => {
        if (currentOrderId && otherOrder.id === currentOrderId) return;
        if (otherOrder.isDeleted || otherOrder.status === 'CANCELLED' || otherOrder.status === 'COMPLETED') return;
        if (!otherOrder.po_items || otherOrder.po_items.length === 0) return;

        otherOrder.po_items.forEach(pi => {
            if (pi.transactionIssued || (pi as any).isCompleted) return; // 이미 마감된 건 제외
            // ★ 오직 '재고 발주분' 미결 주문만 중복 검사 대상 (한국스텐레스, 카리스테크원 등 타 거래처 제외)
            if (!isStockPurchaseOrder(otherOrder, pi)) return;

            const piNameLower = (pi.name || '').toLowerCase().trim();
            const isDcOrFreight = piNameLower === 'd/c' || piNameLower === 'dc' || piNameLower.includes('운임') || piNameLower.includes('배송') || piNameLower.includes('freight') || piNameLower.includes('shipping') || piNameLower.includes('discount') || piNameLower.includes('할인');
            if (isDcOrFreight) return;

            const piSpecKey = normalizeSpecKey(pi.name, pi.thickness, pi.size, pi.material);
            const isMatch = (item.productId && (pi.productId === item.productId || pi.item_id === item.productId)) ||
                            (itemSpecKey && piSpecKey === itemSpecKey);

            if (isMatch) {
                pendingMatches.push({
                    poNumber: otherOrder.poNumber || otherOrder.id.slice(-6),
                    poDate: new Date(otherOrder.createdAt).toLocaleDateString(),
                    quantity: Number(pi.quantity || 0),
                    customerName: otherOrder.poEndCustomer || otherOrder.customerName || '알트에프 재고'
                });
            }
        });
    });

    const pendingDuplicateCount = pendingMatches.length;
    const pendingDuplicateQty = pendingMatches.reduce((acc, m) => acc + m.quantity, 0);

    // 7. 구매 적정성(Suitability) 평가
    let suitabilityType: PurchaseSuitabilityType = 'NORMAL';
    let suitabilityReason = '';
    let badgeText = '안정적';
    let bgClass = 'bg-slate-100';
    let textClass = 'text-slate-700';
    let borderClass = 'border-slate-200';

    const effectiveStock = sihwaStock + pendingDuplicateQty;
    const isDoubleStockout = sihwaStock === 0 && daekyungStock === 0 && (recent90dSales > 0 || totalSales > 0);

    if (isDoubleStockout) {
        suitabilityType = 'DOUBLE_STOCKOUT';
        badgeText = '🚨 동시결품 긴급수급';
        bgClass = 'bg-rose-50';
        textClass = 'text-rose-700';
        borderClass = 'border-rose-200';
        suitabilityReason = '시화 및 대경(공장) 모두 재고 0개입니다. 최근 실수요가 있으므로 기회손실 방지를 위해 즉시 선발주가 요구됩니다.';
    } else if (healthGrade === 'D' && sihwaStock > 0 && orderQty > 0) {
        suitabilityType = 'EXCESS_CAUTION';
        badgeText = '📉 과잉/부진 주의';
        bgClass = 'bg-amber-50';
        textClass = 'text-amber-800';
        borderClass = 'border-amber-200';
        suitabilityReason = `최근 90일 무판매 품목이며 시화에 ${sihwaStock}개가 이미 보유되어 있어 신규 추가 매입을 비권장합니다.`;
    } else if (effectiveStock < safeStock && daekyungStock >= (safeStock - effectiveStock) && daekyungStock > 20) {
        suitabilityType = 'DAEKYUNG_TRANSFER';
        badgeText = '🏭 대경공장 발주 권장';
        bgClass = 'bg-sky-50';
        textClass = 'text-sky-700';
        borderClass = 'border-sky-200';
        suitabilityReason = `대경공장에 ${daekyungStock}개 재고가 넉넉히 있으므로, 타 매입처 신규 구매 대신 대경 매입 발주를 권장합니다.`;
    } else if (effectiveStock < safeStock) {
        suitabilityType = 'URGENT_UNMET';
        badgeText = '✅ 적정 선발주 권장';
        bgClass = 'bg-emerald-50';
        textClass = 'text-emerald-700';
        borderClass = 'border-emerald-200';
        suitabilityReason = `현재고(${sihwaStock}개)가 안전재고(${safeStock}개)에 미달하며 최근 90일 ${recent90dSales}개 출고로 안정적 소진이 예상됩니다.`;
    } else if (recent30dSales >= Math.max(5, safeStock)) {
        suitabilityType = 'SURGING_DEMAND';
        badgeText = '🔥 출고급증 보충';
        bgClass = 'bg-indigo-50';
        textClass = 'text-indigo-700';
        borderClass = 'border-indigo-200';
        suitabilityReason = `최근 30일 출고량(${recent30dSales}개)이 급증하고 있어 재고 소진 전 사전 확보를 권장합니다.`;
    } else {
        suitabilityType = 'NORMAL';
        badgeText = '⚖️ 정상 보유중';
        bgClass = 'bg-slate-100';
        textClass = 'text-slate-600';
        borderClass = 'border-slate-200';
        suitabilityReason = `시화 현재고(${sihwaStock}개)가 적정 수준을 유지하고 있어 긴급 추가 구매가 필수는 아닙니다.`;
    }

    if (pendingDuplicateCount > 0) {
        suitabilityReason += ` (⚠️ 미결 발주대기 ${pendingDuplicateQty}개 존재)`;
    }

    const recommendedQty = Math.max(0, safeStock - effectiveStock);

    return {
        productId: matchedProduct?.id || item.productId || itemSpecKey,
        productName: rawName || matchedProduct?.name || '품목',
        spec: [rawThick, rawSize, rawMat].filter(Boolean).join(' '),
        healthGrade,
        daekyungStock,
        sihwaStock,
        busanStock,
        safeStock,
        recommendedQty,
        recent30dSales,
        recent90dSales,
        recent90dOrders,
        suitabilityType,
        recommendation: suitabilityType,
        suitabilityBadge: {
            text: badgeText,
            bgClass,
            textClass,
            borderClass
        },
        suitabilityReason,
        pendingDuplicateCount,
        pendingDuplicateQty,
        pendingMatches,
        hasOpenDuplicateOrder: pendingDuplicateCount > 0
    };
}
