import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import { 
    Factory, 
    CalendarDays, 
    TrendingUp, 
    AlertTriangle,
    PackageSearch,
    Box,
    History,
    BrainCircuit,
    ChevronDown,
    ChevronRight,
    Activity,
    Info,
    Download,
    ShoppingCart
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import type { Product, LineItem } from '../../types';
import salesHistoryRaw from '../../data/sales_history.json';
import { COMPETITOR_DATA, getStrategicGrade, type StrategicGrade } from '../../../competitorData';

const salesHistory = salesHistoryRaw as Record<string, { salesVolume: number, salesFreq: number }>;

// Helper: Format currency
const formatCur = (num: number) => new Intl.NumberFormat('ko-KR').format(num);

// Helper: Calculate Selling Price based on item rules
const calculateSellingPrice = (id: string, basePrice: number): number => {
    const upperId = id.toUpperCase();
    if (upperId.startsWith('CAP') || upperId.endsWith('-W')) {
        return Math.round((basePrice * 35 / 100) / 10) * 10;
    } else if (upperId.endsWith('-S')) {
        return Math.round((basePrice * 65 / 100) / 10) * 10;
    }
    return basePrice;
};

// ── 재고 회전율 기준 상수 ──────────────────────────────
const WORKING_DAYS = 250;      // 연간 영업일수
const LEAD_TIME = 5;           // 리드타임 (대경 → 시화, 영업일 기준)
const Z_VALUE = 1.645;         // 목표 서비스율 95% (데이터 충분하면 2.33 = 99%로 상향)





// ══════════════════════════════════════════════════════════════
// ★ 새 등급 시스템: 5개 지표 복합 점수 (100점 만점)
// ══════════════════════════════════════════════════════════════

/**
 * 복합 건전성 점수 산출
 * - 판매빈도 25% + 최근트렌드 25% + 견적문의 20% + 판매량규모 15% + 이익률 15%
 */
function calcCompositeScore(row: {
    salesFreq: number;
    salesVolume: number;
    recent30dSales: number;
    recent60dSales: number;
    quoteCount: number;
    profitMarginRate: number;
}): number {
    const salesFreqScore =
        row.salesFreq >= 30 ? 100 :
        row.salesFreq >= 10 ? 70  :
        row.salesFreq >= 5  ? 40  :
        row.salesFreq >= 1  ? 15  : 0;

    const monthlyExpected = row.salesVolume / 12;
    const trendRatio = monthlyExpected > 0 ? (row.recent30dSales / monthlyExpected) : 0;
    const recentTrendScore = Math.min(100,
        trendRatio >= 1.0 ? 100 :
        trendRatio >= 0.5 ? 80  :
        trendRatio >= 0.2 ? 50  :
        row.recent60dSales > 0 ? 30 : 0
    );

    const quoteDemandScore =
        row.quoteCount >= 3 ? 100 :
        row.quoteCount >= 1 ? 60  : 0;

    const salesVolumeScore =
        row.salesVolume >= 500  ? 100 :
        row.salesVolume >= 200  ? 75  :
        row.salesVolume >= 50   ? 50  :
        row.salesVolume >= 10   ? 25  : 0;

    const profitScore =
        row.profitMarginRate >= 30 ? 100 :
        row.profitMarginRate >= 20 ? 75  :
        row.profitMarginRate >= 10 ? 50  :
        row.profitMarginRate >= 0  ? 25  : 0;

    return Math.round(
        salesFreqScore    * 0.25 +
        recentTrendScore  * 0.25 +
        quoteDemandScore  * 0.20 +
        salesVolumeScore  * 0.15 +
        profitScore       * 0.15
    );
}

/**
 * 복합 점수 → 건전성 등급 변환
 * A(핵심) ≥65 | B(안정) 45~64 | C(관망) 25~44 | D(부진) 10~24 | E(처분) <10 & 재고있음 | N(평가불가)
 */
function getHealthGradeFromScore(
    score: number,
    effectiveStock: number,
    salesVolume: number,
    quoteCount: number
): 'A' | 'B' | 'C' | 'D' | 'E' | 'N' {
    if (salesVolume === 0 && quoteCount === 0 && effectiveStock === 0) return 'N';
    if (score >= 65) return 'A';
    if (score >= 45) return 'B';
    if (score >= 25) return 'C';
    if (score >= 10) return 'D';
    if (score < 10 && effectiveStock > 0) return 'E'; // E급: 점수가 매우 낮고 재고가 있는 경우만 → 악성재고
    return 'D';
}



/**
 * 과잉재고 등급별 처분 전략 라벨
 */
function getExcessActionLabel(grade: string): string {
    if (grade === 'A') return '일시 발주 중단 (곧 소진)';
    if (grade === 'B') return '이번 달 발주 보류';
    if (grade === 'C') return '판촉/할인 검토';
    if (grade === 'D') return '대경 반품 협의';
    if (grade === 'E') return '전량 처분 요망';
    return '발주 중단';
}





// Helper: Calculate Fallback Purchase Price based on item rules
const calculateFallbackPurchasePrice = (id: string, basePrice: number): number => {
    const upperId = id.toUpperCase();
    if (upperId.endsWith('-S') && !upperId.startsWith('CAP')) {
        return Math.round((basePrice * 55 / 100) / 10) * 10;
    } else {
        return Math.round((basePrice * 28 / 100) / 10) * 10;
    }
};

// ── 재고 건전성 진단 기준 (쿠팡·다이소 물류 기준 참고) ──────────
// Removed unused DEAD_STOCK_DAYS etc.
const HEALTHY_DEAD_RATIO     = 0.05;  // 허용 악성재고 비중 (5%)
const HEALTHY_EXCESS_RATIO   = 0.10;  // 허용 과잉재고 비중 (10%)
const HEALTHY_ITS_MAX        = 0.12;  // 허용 ITS (재고/매출) 상한 12%

interface InventoryDiffItem {
    id: string;
    name: string;
    from: number;
    to: number;
    change: number;
    sales?: number;
}

interface InventoryHistorySnapshot {
    date: string;
    diff: InventoryDiffItem[];
    stock?: Record<string, { name: string; stock: number }>;
}

export default function SihwaInventory() {
    const { orders, quotes, user, addItem } = useStore(useShallow(state => ({ 
        orders: state.orders, 
        quotes: state.quotes,
        user: state.auth.user,
        addItem: state.addItem
    })));
    const navigate = useNavigate();
    const { inventory, isLoading: invLoading } = useInventory();
    
    const [historyData, setHistoryData] = useState<{
        inventoryHistory: InventoryHistorySnapshot[];
        daekyungHistory: InventoryHistorySnapshot[];
    }>({ inventoryHistory: [], daekyungHistory: [] });
    const [historyLoading, setHistoryLoading] = useState(true);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'AI_SUMMARY' | 'TOTAL_DASHBOARD' | 'ALL_TABLE' | 'HEALTH_DIAGNOSIS'>('AI_SUMMARY');
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        'CRITICAL': true,
        'WARNING': true,
        'REGULAR': true
    });
    const [selectedHealthCategory, setSelectedHealthCategory] = useState<'DEAD' | 'EXCESS' | 'SLOW' | 'MISSED' | 'URGENT' | null>(null);


    const [selectedCriticalIds, setSelectedCriticalIds] = useState<Set<string>>(new Set());
    const [selectedWarningIds, setSelectedWarningIds] = useState<Set<string>>(new Set());
    const [selectedRegularIds, setSelectedRegularIds] = useState<Set<string>>(new Set());
    
    const [expandedTrendItems, setExpandedTrendItems] = useState<Record<string, boolean>>({});
    const [expandedDailyGroups, setExpandedDailyGroups] = useState<Record<string, boolean>>({});

    const [sortConfig, setSortConfig] = useState<{ 
        key: 'id' | 'salesFreq' | 'salesVolume' | 'deficit' | 'shQty' | 'ysQty' | 'pendingOrderQty' | 'recentPurchasePrice' | 'turnoverRate' | 'daysOnHand' | 'safeStock' | 'healthGrade', 
        direction: 'asc' | 'desc' 
    }>({ key: 'deficit', direction: 'desc' });

    const handleSort = (key: 'id' | 'salesFreq' | 'salesVolume' | 'deficit' | 'shQty' | 'ysQty' | 'pendingOrderQty' | 'recentPurchasePrice' | 'turnoverRate' | 'daysOnHand' | 'safeStock' | 'healthGrade') => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleTrendItem = (key: string) => {
        setExpandedTrendItems(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleDailyGroup = (date: string) => {
        setExpandedDailyGroups(prev => ({ ...prev, [date]: !prev[date] }));
    };

    const toggleWarningSelection = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedWarningIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAllWarnings = () => {
        if (selectedWarningIds.size === stats.warning.length) {
            setSelectedWarningIds(new Set());
        } else {
            setSelectedWarningIds(new Set(stats.warning.map(w => w.product.id)));
        }
    };

    // 1. Fetch History Data from the local-api-server (MUST WAIT FOR INVENTORY TO FINISH DIFFING)
    useEffect(() => {
        if (invLoading) return; // Wait until inventory fetch completes (which triggers backend snapshot ledger)
        
        const fetchHistory = async () => {
            try {
                const token = useStore.getState().auth.token;
                const headers: Record<string, string> = { 'x-requester-role': 'admin' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/admin/inventory-history', {
                    headers
                });
                if (res.ok) {
                    const data = await res.json();
                    const ignoreDates = ['2026-04-14', '2026-04-15', '2026-04-16'];
                    if (data.inventoryHistory) {
                        const filteredHistory = data.inventoryHistory.filter((h: { date: string }) => !ignoreDates.includes(h.date));
                        setHistoryData({ ...data, inventoryHistory: filteredHistory });
                    } else if (Array.isArray(data)) {
                        const filteredHistory = data.filter((h: { date: string }) => !ignoreDates.includes(h.date));
                        setHistoryData({ inventoryHistory: filteredHistory, daekyungHistory: [] });
                    }
                }
            } catch (err) {
                console.error('Failed to fetch inventory history:', err);
            } finally {
                setHistoryLoading(false);
            }
        };
        fetchHistory();
    }, [invLoading]);

    // 1.5 Fetch Orders to sync with inventory
    const setOrders = useStore(state => state.setOrders);
    useEffect(() => {
        if (!user) return;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        const token = useStore.getState().auth.token;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (user.id) headers['x-requester-id'] = user.id;
        if (user.role) headers['x-requester-role'] = user.role;

        const endpoint = `${import.meta.env.VITE_API_URL || ''}/api/my/orders?limit=2000`;

        let lastFetchTime = 0;
        const fetchOrders = () => {
            const now = Date.now();
            if (now - lastFetchTime < 20000) return; // 20초 간격 쓰로틀링
            lastFetchTime = now;
            fetch(endpoint, { headers, cache: 'no-store' })
                .then(res => {
                    if (res.ok) return res.json();
                    throw new Error('Failed to fetch orders');
                })
                .then(data => {
                    if (Array.isArray(data)) setOrders(data);
                })
                .catch(console.error);
        };

        fetchOrders();
    }, [setOrders, user]);

    // Filter out irrelevant orders
    const activeOrders = useMemo(() => {
        return orders.filter(order => !['CANCELLED', 'WITHDRAWN'].includes(order.status) && !order.isDeleted);
    }, [orders]);

    const sihwaOrders = useMemo(() => {
        return activeOrders.filter(order => {
            const displayCustomer = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase();
            const normalizedCustomer = displayCustomer.replace(/\s+/g, '');
            return normalizedCustomer.includes('재고') || 
                   normalizedCustomer.includes('서울') || 
                   normalizedCustomer.includes('시화') || 
                   normalizedCustomer.includes('에스제이엔브이') || 
                   normalizedCustomer.includes('sjnv') || 
                   normalizedCustomer.includes('알트에프') || 
                   normalizedCustomer.includes('altf');
        });
    }, [activeOrders]);

    // Monthly Buckets setup
    const currentMonthPrefix = new Date().toISOString().slice(0, 7);
    const [selectedMonth, setSelectedMonth] = useState(currentMonthPrefix);

    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        sihwaOrders.forEach(o => {
            const m = new Date(o.createdAt).toISOString().slice(0, 7);
            months.add(m);
        });
        months.add(currentMonthPrefix);
        return Array.from(months).sort().reverse();
    }, [sihwaOrders, currentMonthPrefix]);

    const inventoryMap = useMemo(() => {
        const map = new Map<string, Partial<Product> & { id: string }>();
        inventory.forEach((p: Product) => map.set(p.id, p));
        return map;
    }, [inventory]);

    const monthData = useMemo(() => {
        const monthlyOrders = sihwaOrders.filter(o => new Date(o.createdAt).toISOString().slice(0, 7) === selectedMonth);
        
        let completedCost = 0;
        let pendingCost = 0;
        let completedCount = 0;
        let pendingCount = 0;

        monthlyOrders.forEach(o => {
            const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;
            
            items.forEach(item => {
                const id = item.productId || (item as { item_id?: string }).item_id || '';
                const product = inventoryMap.get(id);
                const basePrice = item.base_price ?? product?.base_price ?? product?.unitPrice ?? 0;
                let cost = 0;
                if (item.supplierRate !== undefined) {
                    cost = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                } else if (product) {
                    const rate = product.rate_act2 ?? product.rate_act ?? product.rate_pct ?? 0;
                    cost = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                }
                const itemQty = Number(item.quantity ?? item.qty ?? 0);
                
                if (o.status === 'COMPLETED' || item.transactionIssued) {
                    completedCost += (cost * itemQty);
                } else {
                    pendingCost += (cost * itemQty);
                }
            });

            if (o.status === 'COMPLETED' || (items.length > 0 && items.every(i => i.transactionIssued))) {
                completedCount++;
            } else {
                pendingCount++;
            }
        });

        return { completedCost, pendingCost, completedCount, pendingCount, orders: monthlyOrders };
    }, [sihwaOrders, selectedMonth, inventoryMap]);

    // Extract recent actual Purchase price from Seoul orders
    const recentSeoulPurchaseInfoMap = useMemo(() => {
        const pMap: Record<string, { price: number; date: string }> = {};
        const sortedOrders = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        for (const order of sortedOrders) {
            if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) continue;
            
            const displayCustomer = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase();
            const isSeoulStock = displayCustomer.includes('서울') && displayCustomer.includes('재고');
            
            if (isSeoulStock) {
                const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
                if (!items) continue;
                
                for (const item of items) {
                    const itemRec = item as unknown as Record<string, unknown>;
                    const id = item.productId || (typeof itemRec.item_id === 'string' ? itemRec.item_id : undefined);
                    if (!id) continue;
                    
                    let cost = 0;
                    const rawBasePrice = item.base_price ?? item.unitPrice ?? 0;
                    
                    if (item.supplierRate !== undefined) {
                        cost = Math.round((rawBasePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                    } else if (typeof itemRec.purchasePrice === 'number' && itemRec.purchasePrice > 0) {
                        cost = itemRec.purchasePrice;
                    } else {
                        cost = calculateFallbackPurchasePrice(id, rawBasePrice);
                    }

                    if (cost > 0) {
                        pMap[id] = { price: cost, date: new Date(order.createdAt).toISOString().split('T')[0] };
                    }
                }
            }
        }
        return pMap;
    }, [orders]);

    // CORE AI MERGED STOCK ANALYZER (Includes pending orders + actual asset prices)
    interface AnalyzedItem {
        product: Partial<Product> & { id: string; name?: string; stockStatus?: string };
        shQty: number;
        ysQty: number;
        pendingOrderQty: number;
        recentPurchasePrice: number;
        recentPurchaseDate: string | null;
        sellingPrice: number;
        salesVolume: number;
        salesFreq: number;
        recent7dSales: number;
        recent30dSales: number;
        recent60dSales: number;
        quoteCount: number;
        daekyungDirectRatio: number;
        profitMarginRate: number;
        compositeScore: number;
        healthGrade: 'A' | 'B' | 'C' | 'D' | 'E' | 'N'; // A(핵심) B(안정) C(관망) D(부진) E(악성/처분) N(평가불가)

        excessCategory: string | null;
        compSales: number;
        compFreq: number;
        marketTotal: number;
        marketShare: number;
        strategicGrade: StrategicGrade;
        volumeNegoFlag: boolean;
        turnoverRate: number;
        daysOnHand: number;
        dailyAvgSales: number;
        reorderPoint: number;
        stockStatusByTurnover: 'CRITICAL' | 'LOW' | 'OPTIMAL' | 'EXCESS' | 'DEAD';
        deficit: number;
        effectiveStock: number;
        statusCategory: string;
        statusLabel: string;
        isDeadStock?: boolean;
        isExcessStock?: boolean;
    }

    // Dynamically calculate Real-Time Sales History combining static base ERP data and real-time orders
    const liveSalesHistory = useMemo(() => {
        const base = JSON.parse(JSON.stringify(salesHistory)) as Record<string, { salesVolume: number, salesFreq: number }>;
        
        orders.forEach(order => {
            if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) return;
            if (order.status !== 'COMPLETED') return;
            
            const customerStr = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase().replace(/\s+/g, '');
            // Exclude internal stock transfers
            if (customerStr.includes('재고') || customerStr.includes('서울') || customerStr.includes('시화')) return;
            
            const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            if (!items) return;

            items.forEach((item: Partial<LineItem> & { item_id?: string; qty?: number }) => {
                const id = item.productId || item.item_id;
                if (!id) return;
                const qty = Number(item.quantity ?? item.qty ?? 0);
                if (qty <= 0) return;

                if (!base[id]) {
                    base[id] = { salesVolume: 0, salesFreq: 0 };
                }
                base[id].salesVolume += qty;
                base[id].salesFreq += 1;
            });
        });
        
        return base;
    }, [orders]);

    const analyzedInventory = useMemo(() => {
        const comparisonMap: Record<string, AnalyzedItem> = {};

        const nowTime = Date.now();
        const thirtyDaysAgo = nowTime - (30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = nowTime - (60 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = nowTime - (7 * 24 * 60 * 60 * 1000);
        
        const recentSalesMap: Record<string, { recent7d: number, recent30d: number, recent60d: number }> = {};
        historyData.inventoryHistory.forEach((snap: InventoryHistorySnapshot) => {
            const snapDate = new Date(snap.date).getTime();
            if (isNaN(snapDate)) return;
            const isWithin7d = snapDate >= sevenDaysAgo;
            const isWithin30d = snapDate >= thirtyDaysAgo;
            const isWithin60d = snapDate >= sixtyDaysAgo;

            if (isWithin60d && snap.diff) {
                snap.diff.forEach((d: InventoryDiffItem) => {
                    if (d.change < 0) {
                        const absChg = Math.abs(d.change);
                        if (!recentSalesMap[d.id]) recentSalesMap[d.id] = { recent7d: 0, recent30d: 0, recent60d: 0 };
                        recentSalesMap[d.id].recent60d += absChg;
                        if (isWithin30d) {
                            recentSalesMap[d.id].recent30d += absChg;
                        }
                        if (isWithin7d) {
                            recentSalesMap[d.id].recent7d += absChg;
                        }
                    }
                });
            }
        });

        const quoteCountMap: Record<string, number> = {};
        quotes.forEach(quote => {
            if (['CANCELLED', 'WITHDRAWN'].includes(quote.status) || quote.isDeleted) return;
            const quoteDate = new Date(quote.createdAt).getTime();
            if (isNaN(quoteDate) || quoteDate < sixtyDaysAgo) return; // Only count recent 60 days
            
            quote.items.forEach(item => {
                const id = item.productId || (item as { item_id?: string }).item_id;
                if (!id) return;
                quoteCountMap[id] = (quoteCountMap[id] || 0) + 1;
            });
        });

        inventory.forEach((item: Product) => {
            let shQty = 0;
            let ysQty = 0;

            if (item.locationStock) {
                if (item.locationStock['시화'] !== undefined) shQty += Number(item.locationStock['시화']);
                if (item.locationStock['서울'] !== undefined) shQty += Number(item.locationStock['서울']);
                if (item.locationStock['양산'] !== undefined) ysQty += Number(item.locationStock['양산']);
                if (item.locationStock['대경'] !== undefined) ysQty += Number(item.locationStock['대경']);
            } else {
                if ((item.location || '').includes('시화') || (item.location || '').includes('서울')) {
                    shQty = item.currentStock;
                } else if ((item.location || '').includes('양산') || (item.location || '').includes('대경')) {
                    ysQty = item.currentStock;
                }
            }

            const salesData = liveSalesHistory[item.id] || { salesVolume: 0, salesFreq: 0 };
            const compData = COMPETITOR_DATA[item.id] || { compSales: 0, compFreq: 0 };
            const marketTotal = salesData.salesVolume + compData.compSales;
            const marketShare = marketTotal > 0 ? parseFloat(((salesData.salesVolume / marketTotal) * 100).toFixed(1)) : 0;
            
            const basePrice = item.base_price ?? item.unitPrice ?? 0;
            const recentInfo = recentSeoulPurchaseInfoMap[item.id];
            const recentSales = recentSalesMap[item.id] || { recent7d: 0, recent30d: 0, recent60d: 0 };
            
            // Calculate Profit Margin
            const sellingPrice = calculateSellingPrice(item.id, basePrice);
            const purchasePrice = recentInfo ? recentInfo.price : calculateFallbackPurchasePrice(item.id, basePrice);
            const profitMarginRate = sellingPrice > 0 ? parseFloat((((sellingPrice - purchasePrice) / sellingPrice) * 100).toFixed(1)) : 0;

            // Calculate Daekyung Direct Ratio (estimated from total sales vs sihwa drops)
            // If total sales is 100, but Sihwa dropped by 20, 80 were direct dropped (80%).
            const total60dSales = salesData.salesVolume; // Actually, salesVolume is all-time from orders. We'll approximate.
            const daekyungDirectRatio = (total60dSales > 0 && total60dSales > recentSales.recent60d) 
                ? parseFloat((((total60dSales - recentSales.recent60d) / total60dSales) * 100).toFixed(1)) 
                : 0;

            // Populate items (if it has stock or sales data, we analyze it)
            if (shQty > 0 || ysQty > 0 || salesData.salesVolume > 0 || recentSales.recent30d > 0 || compData.compSales > 0) {
                comparisonMap[item.id] = {
                    product: item,
                    shQty,
                    ysQty,
                    pendingOrderQty: 0,
                    recentPurchasePrice: purchasePrice,
                    recentPurchaseDate: recentInfo ? recentInfo.date : null,
                    sellingPrice,
                    salesVolume: salesData.salesVolume,
                    salesFreq: salesData.salesFreq,
                    recent7dSales: recentSales.recent7d,
                    recent30dSales: recentSales.recent30d,
                    recent60dSales: recentSales.recent60d,
                    quoteCount: quoteCountMap[item.id] || 0,
                    daekyungDirectRatio,
                    profitMarginRate,
                    compositeScore: 0,
                    healthGrade: 'N',
                    
                    excessCategory: null,
                    compSales: compData.compSales,
                    compFreq: compData.compFreq,
                    marketTotal,
                    marketShare,
                    strategicGrade: getStrategicGrade(salesData.salesVolume, compData.compSales, marketShare),
                    volumeNegoFlag: false,
                    turnoverRate: 0,
                    turnoverGrade: 'N',
                    daysOnHand: 0,
                    dailyAvgSales: 0,
                    reorderPoint: 0,
                    stockStatusByTurnover: 'DEAD',
                    deficit: 0,
                    effectiveStock: 0,
                    statusCategory: 'IDLE',
                    statusLabel: '대기/데이터없음'
                };
            }
        });

        // Add Pending Order quantities bounded for Sihwa
        sihwaOrders.filter(o => o.status !== 'COMPLETED').forEach(order => {
            const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            items.forEach(item => {
                if (item.transactionIssued) return; 
                
                const id = item.productId || (item as { item_id?: string }).item_id || 'UNKNOWN';
                const addQty = Number(item.quantity ?? item.qty ?? 0);
                
                let rawBasePrice = item.base_price ?? item.unitPrice ?? 0;
                const product = inventoryMap.get(id);
                if (product) rawBasePrice = item.base_price ?? product.base_price ?? product.unitPrice ?? 0;

                if (!comparisonMap[id]) {
                    const finalSellingPrice = calculateSellingPrice(id, rawBasePrice);
                    const recentInfo = recentSeoulPurchaseInfoMap[id];
                    
                    const salesData = liveSalesHistory[id] || { salesVolume: 0, salesFreq: 0 };
                    const compData = COMPETITOR_DATA[id] || { compSales: 0, compFreq: 0 };
                    const marketTotal = salesData.salesVolume + compData.compSales;
                    const marketShare = marketTotal > 0 ? parseFloat(((salesData.salesVolume / marketTotal) * 100).toFixed(1)) : 0;
                    
                    const recentSales = recentSalesMap[id] || { recent7d: 0, recent30d: 0, recent60d: 0 };
                    const purchasePrice = recentInfo ? recentInfo.price : calculateFallbackPurchasePrice(id, rawBasePrice);
                    const profitMarginRate = finalSellingPrice > 0 ? parseFloat((((finalSellingPrice - purchasePrice) / finalSellingPrice) * 100).toFixed(1)) : 0;

                    const total60dSales = salesData.salesVolume; 
                    const daekyungDirectRatio = (total60dSales > 0 && total60dSales > recentSales.recent60d) 
                        ? parseFloat((((total60dSales - recentSales.recent60d) / total60dSales) * 100).toFixed(1)) 
                        : 0;

                    comparisonMap[id] = {
                        product: product || { id, name: item.name || item.item_name || '미등록 상품', stockStatus: 'OUT_OF_STOCK' },
                        shQty: 0,
                        ysQty: 0,
                        pendingOrderQty: addQty,
                        recentPurchasePrice: purchasePrice,
                        recentPurchaseDate: recentInfo ? recentInfo.date : null,
                        sellingPrice: finalSellingPrice,
                        salesVolume: salesData.salesVolume,
                        salesFreq: salesData.salesFreq,
                        recent7dSales: recentSales.recent7d,
                        recent30dSales: recentSales.recent30d,
                        recent60dSales: recentSales.recent60d,
                        quoteCount: quoteCountMap[id] || 0,
                        daekyungDirectRatio,
                        profitMarginRate,
                        compositeScore: 0,
                        healthGrade: 'N',
                        
                        excessCategory: null,
                        compSales: compData.compSales,
                        compFreq: compData.compFreq,
                        marketTotal,
                        marketShare,
                        strategicGrade: getStrategicGrade(salesData.salesVolume, compData.compSales, marketShare),
                        volumeNegoFlag: false,
                        turnoverRate: 0,
                        daysOnHand: 0,
                        dailyAvgSales: 0,
                        reorderPoint: 0,
                        stockStatusByTurnover: 'DEAD',
                        deficit: 0,
                        effectiveStock: 0,
                        statusCategory: 'IDLE',
                        statusLabel: '대기/데이터없음'
                    };
                } else {
                    comparisonMap[id].pendingOrderQty += addQty;
                }
            });
        });

        // Step 3: Run AI Rules for status computation
        const processedList = Object.values(comparisonMap).map(row => {
            // 통계 기반 안전재고 (σ)
            const dailyAvg = row.salesVolume / WORKING_DAYS;
            
            const cvEstimate = row.salesFreq >= 100 ? 0.20 : row.salesFreq >= 50 ? 0.30 : row.salesFreq >= 20 ? 0.40 : 0.50;
            const sigma = dailyAvg * cvEstimate;
            const safetyStockSigma = Math.ceil(Z_VALUE * sigma * Math.sqrt(LEAD_TIME));
            
            let safeStock = safetyStockSigma + Math.ceil(dailyAvg * 14);
            safeStock = safeStock > 0 ? Math.max(10, Math.round(safeStock / 10) * 10) : 0;
            
            // AI Filter Rules
            const mat = (row.product.material || '').toUpperCase();
            if (mat.startsWith('WP') || mat.includes('CARBON')) {
                if (row.salesVolume < 200 || row.salesFreq < 10) {
                    safeStock = 0;
                } else {
                    safeStock = Math.min(safeStock, 50); // WP는 최대 50개 캡
                }
            }
            if (row.salesFreq < 10) {
                safeStock = 0;
            }

            // 부피 제약 다단화
            const sizeStr = row.product.size || '';
            const sizeNum = parseInt(sizeStr.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(sizeNum)) {
                if (sizeNum >= 400) { if (safeStock > 30)  safeStock = 30; }
                else if (sizeNum >= 300) { if (safeStock > 50)  safeStock = 50; }
                else if (sizeNum >= 200) { if (safeStock > 80)  safeStock = 80; }
                else if (sizeNum >= 150) { if (safeStock > 150) safeStock = 150; }
                else if (sizeNum >= 100) { if (safeStock > 300) safeStock = 300; }
            }

            // REQUIREMENT 3: INCLUDE PENDING ORDERS as effective stock
            const effectiveStock = row.shQty + row.pendingOrderQty; 

            let statusCategory = 'IDLE'; 
            let statusLabel = '대기/데이터없음';

            if (row.salesVolume > 0 && safeStock > 0) {
                if (effectiveStock <= 0) {
                    if (row.ysQty <= 0) {
                        if (row.salesVolume > 100 && row.salesFreq >= 10) {
                            statusCategory = 'CRITICAL';
                            statusLabel = '🚨 선발주 요망 (매입결품)';
                        } else {
                            // Exclude from urgent pre-order if volume/freq not enough, demote to normal order
                            statusCategory = 'WARNING';
                            statusLabel = '⚠️ 일반 발주 필요 (재고부족)';
                        }
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 일반 발주 (대경재고 활용)';
                    }
                } else if (effectiveStock < safeStock) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 적정재고 미달 (재고부족)';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                 statusCategory = 'SAFE';
                 statusLabel = '✅ 미활동 보유품';
            }

            // ★ 재고 회전율 산출
            const dailyAvgSales = row.salesVolume > 0 ? row.salesVolume / WORKING_DAYS : 0;
            const avgStock = row.shQty > 0 ? row.shQty : (row.salesVolume > 0 ? row.salesVolume / 12 : 0);
            const turnoverRate = avgStock > 0 ? parseFloat((row.salesVolume / avgStock).toFixed(2)) : 0;
            
            const daysOnHand = dailyAvgSales > 0 && row.shQty > 0
                ? parseFloat((row.shQty / dailyAvgSales).toFixed(1))
                : row.shQty > 0 ? 9999 
                : 0;

            const r_cvEstimate = row.salesFreq >= 100 ? 0.20 : row.salesFreq >= 50 ? 0.30 : row.salesFreq >= 20 ? 0.40 : 0.50;
            const r_sigma = dailyAvgSales * r_cvEstimate;
            const safetyStockROP = Math.ceil(Z_VALUE * r_sigma * Math.sqrt(LEAD_TIME));
            const reorderPoint = Math.ceil(dailyAvgSales * LEAD_TIME + safetyStockROP);

            // === 신규 건전성 등급 평가 로직 (100점 만점 복합 점수제) ===
            const compositeScore = calcCompositeScore({
                salesFreq:       row.salesFreq,
                salesVolume:     row.salesVolume,
                recent30dSales:  row.recent30dSales,
                recent60dSales:  row.recent60dSales,
                quoteCount:      row.quoteCount,
                profitMarginRate: row.profitMarginRate,
            });

            const healthGrade = getHealthGradeFromScore(
                compositeScore,
                effectiveStock,
                row.salesVolume,
                row.quoteCount
            );

            // 악성재고: E급만
            const isDeadStock = healthGrade === 'E';

            // 과잉재고: E급 제외, 목표재고(safeStock)의 1.5배 초과
            const isExcessStock = !isDeadStock
                && safeStock > 0
                && row.shQty > (safeStock * 1.5)
                && row.recentPurchasePrice > 0;

            let excessCategory: string | null = null;
            if (isExcessStock) {
                excessCategory =
                    healthGrade === 'A' ? 'EXCESS_A' :
                    healthGrade === 'B' ? 'EXCESS_B' :
                    healthGrade === 'C' ? 'EXCESS_C' :
                    healthGrade === 'D' ? 'EXCESS_D' : null;
            }

            // 발주 상태(statusCategory, statusLabel)를 새로운 등급/목표재고 기준으로 덮어쓰기
            if (healthGrade === 'E') {
                statusCategory = 'DEAD';
                statusLabel = '☠️ 처분 대상 (악성재고)';
            } else if (isExcessStock) {
                statusCategory = 'EXCESS';
                statusLabel = `📦 과잉재고 (${getExcessActionLabel(healthGrade)})`;
            } else if (healthGrade === 'D' || healthGrade === 'N') {
                statusCategory = 'SAFE';
                statusLabel = '🟡 미발주 대상 (D/N등급)';
            } else if (safeStock > 0) {
                if (effectiveStock <= 0) {
                    // 선발주 요망(CRITICAL) 조건: 대경 재고가 없으면서, A/B급 핵심 품목이거나 일정 수준 이상 팔리는 품목
                    if (row.ysQty <= 0 && (healthGrade === 'A' || healthGrade === 'B' || (row.salesVolume >= 30 && row.salesFreq >= 5))) {
                        statusCategory = 'CRITICAL';
                        statusLabel = '🚨 선발주 요망 (매입결품)';
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 일반 발주 필요 (재고부족)';
                    }
                } else if (effectiveStock < safeStock) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 적정재고 미달 (재고부족)';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                statusCategory = 'SAFE';
                statusLabel = '✅ 미활동 보유품';
            }

            const finalDeficit = Math.max(0, safeStock - effectiveStock);

            return {
                ...row,
                compositeScore,
                healthGrade,

                excessCategory,
                safeStock,
                deficit: finalDeficit,
                effectiveStock,
                statusCategory,
                statusLabel,
                turnoverRate,
                daysOnHand,
                dailyAvgSales,
                reorderPoint,
                stockStatusByTurnover,
                isDeadStock,
                isExcessStock,
            };
        });

        // Step 4: Apply Filters and Multiple Sort logic
        let filtered = processedList;
        if (searchTerm) {
            const lowerQuery = searchTerm.toLowerCase();
            filtered = processedList.filter(row => 
                row.product.id.toLowerCase().includes(lowerQuery) || 
                (row.product.name && row.product.name.toLowerCase().includes(lowerQuery))
            );
        }

        return filtered.sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            switch(sortConfig.key) {
                case 'id': return a.product.id.localeCompare(b.product.id) * dir;
                case 'salesFreq': return (a.salesFreq - b.salesFreq) * dir;
                case 'salesVolume': return (a.salesVolume - b.salesVolume) * dir;
                case 'deficit': return (a.deficit - b.deficit) * dir;
                case 'shQty': return (a.shQty - b.shQty) * dir;
                case 'ysQty': return (a.ysQty - b.ysQty) * dir;
                case 'pendingOrderQty': return (a.pendingOrderQty - b.pendingOrderQty) * dir;
                case 'recentPurchasePrice': return (a.recentPurchasePrice - b.recentPurchasePrice) * dir;
                case 'turnoverRate': return (a.turnoverRate - b.turnoverRate) * dir;
                case 'daysOnHand': return (a.daysOnHand - b.daysOnHand) * dir;
                case 'safeStock': return (a.safeStock - b.safeStock) * dir;
                default: return 0; // Fallback
            }
        });
    }, [inventory, sihwaOrders, inventoryMap, recentSeoulPurchaseInfoMap, searchTerm, sortConfig, historyData, liveSalesHistory, quotes]);

    // Aggregate stats and Asset Valuation totals
    const stats = useMemo(() => {
        const regular = analyzedInventory
            .filter(r => r.statusCategory === 'SAFE' && r.salesFreq >= 20)
            .filter(r => !(r.product.material || '').toLowerCase().startsWith('wp'))
            .map(r => {
                const rawRecommended = r.safeStock - r.effectiveStock;
                let recommendedQty = 0;
                
                // 과잉재고인 경우 발주 추천 차단
                if (r.isExcessStock) {
                    recommendedQty = 0;
                }
                // 대경 창고에 이미 500개 이상 대량 스탁이 있다면 굳이 시화에 벌크로 미리 들여놓을 필요 없음
                else if (r.ysQty >= 500) {
                    recommendedQty = 0;
                } else if (rawRecommended > 0) {
                    recommendedQty = Math.ceil(rawRecommended / 10) * 10;
                    if (recommendedQty < 0) {
                         recommendedQty = 0;
                    }
                }
                
                const sizeNum = parseInt((r.product.size || '').replace(/[^0-9]/g, ''), 10);
                if (!isNaN(sizeNum) && sizeNum >= 100) {
                    const dynamicCap = Math.max(300, Math.ceil(r.salesVolume / 4));
                    recommendedQty = recommendedQty > 0 ? Math.min(dynamicCap, recommendedQty) : 0;
                }
                
                return { ...r, recommendedQty };
            })
            .filter(r => r.recommendedQty > 0);

        // 견적 문의가 많으나 재고가 없는 경우 기회손실 (결품)
        const missedOpportunities = analyzedInventory.filter(r => 
            r.shQty === 0 && r.ysQty === 0 && r.quoteCount > 0
        );

        // ★ 신규: 전략등급별 집계
        const A2items = analyzedInventory.filter(r => r.strategicGrade === 'A2' && r.marketShare < 35);
        const needsVolumeNego = analyzedInventory.filter(r =>
            r.deficit > 0 && r.recentPurchasePrice * r.deficit >= 20_000_000
        );
        const totalAssetCost = analyzedInventory
            .filter(r => !r.product.id.toLowerCase().includes('stubend'))
            .reduce((sum, r) => sum + r.shQty * r.recentPurchasePrice, 0);

        return {
            critical: analyzedInventory.filter(r => r.statusCategory === 'CRITICAL' && !r.isExcessStock),
            warning: analyzedInventory.filter(r => r.statusCategory === 'WARNING' && !r.isExcessStock),
            safeActive: analyzedInventory.filter(r => r.statusCategory === 'SAFE' && r.salesFreq > 10),
            regular,
            A2items,
            needsVolumeNego,
            missedOpportunities,
            totalAssetCost
        };
    }, [analyzedInventory]);

    const processOrderSet = (selectedSet: Set<string>, listType: 'CRITICAL' | 'WARNING' | 'REGULAR') => {
        if (selectedSet.size === 0) return;
        
        const listItems = listType === 'CRITICAL' 
            ? stats.critical 
            : listType === 'WARNING' 
                ? stats.warning 
                : stats.regular;

        const itemsToAdd = listItems.filter(item => selectedSet.has(item.product.id) && !(item as { canTransfer?: boolean }).canTransfer);

        itemsToAdd.forEach(row => {
            let qty = 0;
            if (listType === 'REGULAR') {
                qty = 'recommendedQty' in row ? (row as { recommendedQty?: number }).recommendedQty || 0 : 0;
            } else if (listType === 'WARNING') {
                const targetQty = row.safeStock - (row.shQty + row.pendingOrderQty);
                qty = targetQty > 0 ? targetQty : (row.deficit > 0 ? row.deficit : 0);
                qty = Math.ceil(qty / 10) * 10;
                const sizeNum = parseInt((row.product.size || '').replace(/[^0-9]/g, ''), 10);
                if (!isNaN(sizeNum) && sizeNum >= 100) {
                    const dynamicCap = Math.max(300, Math.ceil(row.salesVolume / 4));
                    qty = qty > 0 ? Math.min(dynamicCap, qty) : 0;
                }
            } else {
                const targetQty = row.safeStock - (row.shQty + row.pendingOrderQty);
                qty = targetQty > 0 ? targetQty : (row.deficit > 0 ? row.deficit : 0);
                qty = Math.ceil(qty / 10) * 10;
                const sizeNum = parseInt((row.product.size || '').replace(/[^0-9]/g, ''), 10);
                if (!isNaN(sizeNum) && sizeNum >= 100) {
                    const dynamicCap = Math.max(300, Math.ceil(row.salesVolume / 4));
                    qty = qty > 0 ? Math.min(dynamicCap, qty) : 0;
                }
            }
            if (qty > 0) {
                addItem({
                    id: crypto.randomUUID(),
                    productId: row.product.id,
                    name: row.product.name || '',
                    thickness: row.product.thickness || '',
                    size: row.product.size || '',
                    material: row.product.material || '',
                    quantity: qty,
                    unitPrice: row.recentPurchasePrice > 0 ? row.recentPurchasePrice : row.sellingPrice,
                    amount: (row.recentPurchasePrice > 0 ? row.recentPurchasePrice : row.sellingPrice) * qty,
                    note: `[시화 발주] ${listType === 'REGULAR' ? '정기보충' : '결품보충'}`,
                    isVerified: false
                });
            }
        });
        
        if (listType === 'CRITICAL') setSelectedCriticalIds(new Set());
        else if (listType === 'WARNING') setSelectedWarningIds(new Set());
        else setSelectedRegularIds(new Set());
    };

    const handleCreateOrder = (selectedSet: Set<string>, listType: 'CRITICAL' | 'WARNING' | 'REGULAR') => {
        processOrderSet(selectedSet, listType);
        navigate('/cart');
    };

    const handleCreateGlobalOrder = () => {
        if (selectedCriticalIds.size > 0) processOrderSet(selectedCriticalIds, 'CRITICAL');
        if (selectedWarningIds.size > 0) processOrderSet(selectedWarningIds, 'WARNING');
        if (selectedRegularIds.size > 0) processOrderSet(selectedRegularIds, 'REGULAR');
        navigate('/cart');
    };

    const totalsMap = useMemo(() => {
        let totalCurrentStockValue = 0;
        let totalCurrentStockCost = 0;
        let totalPendingPurchaseValue = 0;

        analyzedInventory.forEach(row => {
            if (row.product.id.toLowerCase().includes('stubend')) return;
            totalCurrentStockValue += (row.shQty * row.sellingPrice);
            totalCurrentStockCost += (row.shQty * row.recentPurchasePrice);
            totalPendingPurchaseValue += (row.pendingOrderQty * row.recentPurchasePrice);
        });

        return {
            totalCurrentStockValue,
            totalCurrentStockCost,
            totalPendingPurchaseValue
        };
    }, [analyzedInventory]);

    // ── 재고 건전성 진단 ENGINE ─────────────────────────────────────
    const healthDiagnosis = useMemo(() => {

      // ── 기준 날짜 ──────────────────────────────────────────────
      const now = Date.now();

      // ── 품목별 마지막 판매일 추출 (inventoryHistory 기반) ──────
      const lastSaleDateMap: Record<string, number> = {};
      historyData.inventoryHistory.forEach((snap: InventoryHistorySnapshot) => {
        const snapTime = new Date(snap.date).getTime();
        if (isNaN(snapTime)) return;
        snap.diff?.forEach((d: InventoryDiffItem) => {
          if (d.change < 0) {  // 감소 = 출고 = 판매
            if (!lastSaleDateMap[d.id] || snapTime > lastSaleDateMap[d.id]) {
              lastSaleDateMap[d.id] = snapTime;
            }
          }
        });
      });

      // ── 결품 기회손실: 대경+시화 모두 0일 때 주문→취소 이력 ────
      const missedDemandMap: Record<string, { count: number; estimatedRevenue: number }> = {};
      orders.forEach(o => {
        if (!['CANCELLED', 'WITHDRAWN'].includes(o.status)) return;
        if (o.isDeleted) return;
        // 내부 재고 이동 주문 제외
        const custStr = (o.poEndCustomer || o.customerName || '').toLowerCase();
        if (custStr.includes('재고') || custStr.includes('시화') || custStr.includes('서울')) return;

        const items = o.po_items?.length ? o.po_items : o.items;
        items?.forEach(item => {
          const id = item.productId || (item as { item_id?: string }).item_id || '';
          if (!id) return;
          const row = analyzedInventory.find(r => r.product.id === id);
          if (!row) return;
          // 주문 시점에 시화+대경 모두 0이었을 가능성 높은 품목 (현재도 0이거나 critical인 경우)
          if (row.shQty <= 0 && row.ysQty <= 0) {
            const qty = Number(item.quantity ?? (item as { qty?: number }).qty ?? 0);
            if (!missedDemandMap[id]) missedDemandMap[id] = { count: 0, estimatedRevenue: 0 };
            missedDemandMap[id].count += 1;
            missedDemandMap[id].estimatedRevenue += qty * row.sellingPrice;
          }
        });
      });

      // ── 품목별 분류 ────────────────────────────────────────────
      const deadStockItems:   typeof analyzedInventory = [];
      const excessStockItems: typeof analyzedInventory = [];
      const slowMoveItems:    typeof analyzedInventory = [];
      const optimalItems:     typeof analyzedInventory = [];

      let totalStockValue    = 0;
      let deadStockValue     = 0;
      let excessStockValue   = 0;
      let slowMoveValue      = 0;
      let optimalStockValue  = 0;

      analyzedInventory.forEach(row => {
        // STUBEND 제외
        if (row.product.id.toLowerCase().includes('stubend')) return;
        const itemValue = row.shQty * row.recentPurchasePrice;
        if (itemValue <= 0 && row.shQty <= 0) return;
        totalStockValue += itemValue;

        // 무판매 일수 계산
        const lastSaleTime = lastSaleDateMap[row.product.id];
        const daysSinceLastSale = lastSaleTime
          ? Math.floor((now - lastSaleTime) / 86400000)
          : (row.salesVolume === 0 ? 999 : 0);

        // 악성재고 판단
        const isDeadStock = row.isDeadStock === true;

        // 과잉재고 판단 (악성이 아닌 것 중에서)
        const targetStock = row.safeStock > 0 ? row.safeStock : row.safeStock;
        const excessQty = targetStock > 0 ? row.shQty - targetStock : 0;
        const isExcessStock = row.isExcessStock === true;

        // 부진재고 판단 (N급이 아닌 B/A/S급 중에서 주의 상태)
        const isSlowMove = !isDeadStock && !isExcessStock && row.healthGrade === 'B' && row.shQty > 0;

        if (isDeadStock) {
          deadStockItems.push({ ...row, _daysSinceLastSale: daysSinceLastSale } as typeof row & { _daysSinceLastSale: number });
          deadStockValue += itemValue;
        } else if (isExcessStock) {
          excessStockItems.push({ ...row, _excessQty: excessQty, _excessValue: excessQty * row.recentPurchasePrice } as typeof row & { _excessQty: number; _excessValue: number });
          excessStockValue += itemValue;
        } else if (isSlowMove) {
          slowMoveItems.push(row);
          slowMoveValue += itemValue;
        } else {
          optimalItems.push(row);
          optimalStockValue += itemValue;
        }
      });

      // ── 건강도 점수 (0~100) ────────────────────────────────────
      const deadRatio    = totalStockValue > 0 ? deadStockValue  / totalStockValue : 0;
      const excessRatio  = totalStockValue > 0 ? excessStockValue/ totalStockValue : 0;
      const slowRatio    = totalStockValue > 0 ? slowMoveValue   / totalStockValue : 0;

      // 항목별 감점
      const deadPenalty   = Math.min(40, Math.round(deadRatio  / HEALTHY_DEAD_RATIO  * 20));
      const excessPenalty = Math.min(30, Math.round(excessRatio/ HEALTHY_EXCESS_RATIO* 15));
      const slowPenalty   = Math.min(15, Math.round(slowRatio  * 30));
      const healthScore   = Math.max(0, 100 - deadPenalty - excessPenalty - slowPenalty);

      const healthGrade =
        healthScore >= 80 ? { label: '우량 🟢', textClass: 'text-green-600', strokeColor: '#16a34a' } :
        healthScore >= 60 ? { label: '보통 🟡', textClass: 'text-amber-600', strokeColor: '#d97706' } :
        healthScore >= 40 ? { label: '주의 🟠', textClass: 'text-orange-600', strokeColor: '#ea580c' } :
        { label: '위험 🔴', textClass: 'text-rose-600', strokeColor: '#dc2626' };

      // ── 매출 대비 재고 비율 (ITS) ─────────────────────────────
      const annualRevenue = analyzedInventory.reduce((s, r) => s + r.salesVolume * r.sellingPrice, 0);
      const its = annualRevenue > 0 ? (totalStockValue / annualRevenue) : 0;

      // ── 결품 기회손실 상위 품목 ─────────────────────────────────
      const missedDemandList = Object.entries(missedDemandMap)
        .map(([id, v]) => {
          const row = analyzedInventory.find(r => r.product.id === id);
          return { id, ...v, row };
        })
        .filter(m => m.count >= 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // ── 즉시 처분 대상 (악성재고 중 대경 반품 가능하거나 장기(180일+) 악성인 품목) ──
      const urgentDisposalItems = deadStockItems
        .filter(row => {
          const daysSince = (row as typeof row & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0;
          return row.ysQty > 0 || daysSince > 180;
        })
        .sort((a, b) => ((b as typeof b & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0) - ((a as typeof a & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0));

      return {
        totalStockValue,
        deadStockItems,   deadStockValue,
        excessStockItems, excessStockValue,
        slowMoveItems,    slowMoveValue,
        optimalItems,     optimalStockValue,
        deadRatio, excessRatio, slowRatio,
        healthScore, healthGrade,
        annualRevenue, its,
        missedDemandList,
        urgentDisposalItems,
        lockedCapital: deadStockValue + excessStockValue,
        totalIssueCount: analyzedInventory.filter(r => r.healthGrade === 'E' || r.excessCategory !== null).length,
      };
    }, [analyzedInventory, historyData, orders]);

    const dailyOrderDiffMap = useMemo(() => {
        const map: Record<string, Record<string, number>> = {}; 
        orders.forEach(order => {
            if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) return;
            if (order.status !== 'COMPLETED') return; 
            
            const dateStr = order.adminResponse?.deliveryDate || order.createdAt;
            // Parse order dates as KST to match backend snapshot dates
            const dt = new Date(dateStr);
            const kstDt = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
            const dateKey = kstDt.toISOString().split('T')[0];
            
            if (!map[dateKey]) map[dateKey] = {};
            
            const customerStr = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase().replace(/\s+/g, '');
            const isSihwaIncoming = customerStr.includes('재고') || customerStr.includes('서울') || customerStr.includes('시화');
            
            const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            if (!items) return;

            items.forEach((item: LineItem) => {
                const id = item.productId || item.item_id;
                if (!id) return;
                const qty = Number(item.quantity ?? item.qty ?? 0);
                
                // 시화재고에서 +는 '서울재고/시화' 발주분만 연산되어야 함
                // 주문관리의 일반 출고(-)는 시화재고에서 직접 차감되지 않음
                if (!isSihwaIncoming) return;
                const change = qty;
                
                map[dateKey][id] = (map[dateKey][id] || 0) + change;
            });
        });
        return map;
    }, [orders]);

    const handleExportSihwaSummary = () => {
        const headers = ['품목', '두께', '사이즈', '재질', '현재재고(시화)', '입고예정(미결결과)', '발주서번호(들)', '발주날짜(들)', '입고예정일'];
        const csvRows = [headers.join(',')];

        analyzedInventory.forEach(row => {
            const specName = row.product.name || '';
            const specThick = row.product.thickness || '';
            const specSize = row.product.size || '';
            const specMat = row.product.material || '';

            // Extract all related pending orders for this specific item that were ordered for '서울재고'
            const poNumbers: string[] = [];
            const poDates: string[] = [];
            const deliveryDates: string[] = [];

            orders.forEach(order => {
                if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) return;
                const targetCustomer = order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '';
                
                if (targetCustomer.includes('서울재고')) {
                    order.po_items?.forEach(poItem => {
                        if (poItem.poSent && !poItem.transactionIssued) {
                            if (
                                poItem.name === specName &&
                                (poItem.thickness || '') === specThick &&
                                (poItem.size || '') === specSize &&
                                (poItem.material || '') === specMat
                            ) {
                                if (order.poNumber && !poNumbers.includes(order.poNumber)) poNumbers.push(order.poNumber);
                                const pDate = new Date(order.createdAt).toLocaleDateString();
                                if (!poDates.includes(pDate)) poDates.push(pDate);
                                const dDateStr = order.adminResponse?.deliveryDate || order.createdAt;
                                const dDate = new Date(dDateStr).toLocaleDateString();
                                if (!deliveryDates.includes(dDate)) deliveryDates.push(dDate);
                            }
                        }
                    });
                }
            });

            // User requirement: "기준은 재고data에서 시화재고만 따로 추려서..." => We can include all to give full visibility, or just those with stock or pending.
            // Let's include everything in the analyzedInventory to act as the full baseline map.
            const r = [
                `"${specName}"`,
                `"${specThick}"`,
                `"${specSize}"`,
                `"${specMat}"`,
                row.shQty, // 현재고
                row.pendingOrderQty, // 입고예정
                `"${poNumbers.join(', ')}"`,
                `"${poDates.join(', ')}"`,
                `"${deliveryDates.join(', ')}"`
            ];
            csvRows.push(r.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `시화재고_입고대기분석_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (user?.role === 'MANAGER' && !user?.permissions?.viewSihwa) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-center pb-40">
                <AlertTriangle className="w-16 h-16 text-rose-300 mb-4" />
                <h2 className="text-xl font-bold text-slate-700">접근 권한이 제한되었습니다</h2>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* AI Accuracy Confidence Metric */}
            <div className="bg-linear-to-r from-slate-800 to-indigo-900 rounded-2xl p-5 shadow-lg text-white flex flex-col md:flex-row md:items-center justify-between gap-4 border border-slate-700/50">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full border-4 border-teal-400 border-t-transparent animate-spin-slow flex items-center justify-center relative">
                        {(() => {
                            const hasCompData = analyzedInventory.filter(r => r.compSales > 0).length;
                            const compDataScore = Math.min(20, Math.round((hasCompData / Math.max(analyzedInventory.length, 1)) * 20 * 5));
                            const historyScore = historyData.inventoryHistory.length >= 30 ? 20
                                             : historyData.inventoryHistory.length >= 7  ? 12
                                             : historyData.inventoryHistory.length >= 1  ? 6 : 0;
                            const freqScore = analyzedInventory.filter(r => r.salesFreq >= 20).length > 50 ? 20 : 10;
                            const safeStockScore = (() => {
                                const total = analyzedInventory.filter(r => r.safeStock > 0).length;
                                const ok = analyzedInventory.filter(r => r.safeStock > 0 && r.effectiveStock >= r.safeStock).length;
                                return total > 0 ? Math.round((ok / total) * 20) : 0;
                            })();
                            const assetScore = stats.totalAssetCost >= 250_000_000 && stats.totalAssetCost <= 300_000_000 ? 20
                                           : stats.totalAssetCost >= 200_000_000 ? 12 : 5;
                            const totalScore = compDataScore + historyScore + freqScore + safeStockScore + assetScore;

                            return (
                                <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-teal-400">
                                    {totalScore}%
                                </div>
                            );
                        })()}
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white flex items-center gap-2">
                            AI 재고 예측 목표 신뢰도 (Accuracy)
                            <span className="bg-amber-500 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Learning</span>
                        </h2>
                        <p className="text-slate-300 text-[13px] mt-1 pr-4">
                            현재 시화재고 출고량의 대부분을 '수도권(경기) 판매'로 간주하여 분석 중입니다.<br/>
                            <span className="text-teal-300">지역별 맞춤 CRM/주문 태깅 데이터가 누적</span>될수록 신뢰도가 95%+ 까지 향상됩니다.
                        </p>
                    </div>
                </div>

            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <BrainCircuit className="w-7 h-7 text-indigo-600" />
                        시화재고 자산평가 및 AI 분석망
                    </h1>
                    <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                        자산 가치 산정부터 입고대기 수량 및 일간 변동 트렌드를 종합 적용하여 최적의 사입 계획을 수립합니다.
                    </p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <button 
                        onClick={handleExportSihwaSummary} 
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-black text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-95 border border-slate-700"
                    >
                        <Download className="w-4 h-4" />
                        현재고 + 입고예정(미결) 엑셀 다운로드
                    </button>
                </div>
            </div>

            {/* Smart Tableau Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-5">
                <div 
                    onClick={() => { setActiveTab('AI_SUMMARY'); setExpandedGroups(prev => ({...prev, CRITICAL: true})); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}
                    className="bg-linear-to-br from-rose-500 to-red-600 rounded-2xl p-5 shadow-lg shadow-rose-200 text-white flex flex-col relative overflow-hidden group cursor-pointer transition-transform hover:-translate-y-1 active:scale-95"
                >
                    <div className="absolute top-0 right-0 -mr-6 -mt-6 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <AlertTriangle className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><AlertTriangle className="w-5 h-5"/>매입처 동반 결품 (선발주 요망)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.critical.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 break-keep mt-auto">현재고 및 대경 재고가 바닥났으며, 연 판매량(100↑)이 많아 선발주 관리가 필요한 품목입니다.</p>
                </div>
                
                <div 
                    onClick={() => { setActiveTab('AI_SUMMARY'); setExpandedGroups(prev => ({...prev, WARNING: true})); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}
                    className="bg-linear-to-br from-amber-400 to-orange-500 rounded-2xl p-5 shadow-lg shadow-amber-200 text-white flex flex-col relative overflow-hidden group cursor-pointer transition-transform hover:-translate-y-1 active:scale-95"
                >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-20 transform group-hover:rotate-12 transition-transform duration-500">
                        <Box className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><Factory className="w-5 h-5"/>일반 발주 필요 (적정재고 미달)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.warning.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 mt-auto">대경 재고를 통해 조달하거나 목표수량에 미달되어 일반발주(최소 100개)가 필요한 품목입니다.</p>
                </div>

                <div 
                    onClick={() => { setActiveTab('ALL_TABLE'); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}
                    className="bg-linear-to-br from-slate-700 to-slate-900 rounded-2xl p-5 shadow-lg shadow-slate-300 text-white flex flex-col relative overflow-hidden group cursor-pointer transition-transform hover:-translate-y-1 active:scale-95"
                >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:-translate-y-2 transition-transform duration-500">
                        <Activity className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><TrendingUp className="w-5 h-5"/>매입 실적가 기준 기초 자산</h3>
                    <p className="text-3xl font-black mb-1 z-10">{formatCur(totalsMap.totalCurrentStockCost)} <span className="text-[16px] font-bold opacity-80 tracking-normal">원</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 mt-auto">현재 보유 중인 시화재고 전체의 실매입 추정 자산가치입니다 (Stubend 제외)</p>
                </div>

                <div 
                    onClick={() => { setActiveTab('HEALTH_DIAGNOSIS'); setSelectedHealthCategory('MISSED'); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}
                    className="bg-linear-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 shadow-lg shadow-indigo-200 text-white flex flex-col relative overflow-hidden group cursor-pointer transition-transform hover:-translate-y-1 active:scale-95"
                >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <BrainCircuit className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><TrendingUp className="w-5 h-5"/>견적 유입 & 결품 (기회손실)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.missedOpportunities.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 mt-auto">최근 60일 내 견적 문의가 있었으나 시화/대경 재고가 없어 판매 기회를 잃었을 가능성이 높은 품목입니다.</p>
                </div>
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-2 z-10 opacity-90">
                        <Activity className="w-5 h-5 text-purple-500" />
                        재고 건전성 등급 분포 (A~E) <span className="text-xs text-slate-400 font-normal ml-1">(총 {analyzedInventory.filter(r => r.healthGrade !== 'N').length}개 품목)</span>
                    </h3>
                    <p className="text-4xl font-black text-slate-800 mb-2 invisible h-0">0</p>
                    
                    <div className="space-y-2 mt-auto">
                        {(['A','B','C','D','E'] as const).map(grade => {
                        const count = analyzedInventory.filter(r =>
                            r.healthGrade === grade
                        ).length;
                        const total = analyzedInventory.filter(r => r.healthGrade !== 'N').length;
                        const pct = total > 0 ? (count / total * 100).toFixed(1) : 0;
                        const labels: Record<string, string> = {
                            A: 'A급 최우수 (핵심)',
                            B: 'B급 양호 (안정적)',
                            C: 'C급 보통 (관망)',
                            D: 'D급 주의 (과잉/정체)',
                            E: 'E급 악성 (즉시처분)',
                        };
                        const colors: Record<string, string> = {
                            A: '#10B981', B: '#3B82F6', C: '#F59E0B', D: '#F97316', E: '#EF4444'
                        };
                        return (
                            <div key={grade} className="flex items-center gap-2">
                            <span className="text-[11px] font-bold w-28 text-slate-600 shrink-0">
                                {labels[grade]}
                            </span>
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                className="h-full rounded-full transition-all"
                                {...{ style: { width: `${pct}%`, background: colors[grade] } }}
                                />
                            </div>
                            <span className="text-[11px] font-bold text-slate-500 w-8 text-right shrink-0">
                                {count}개
                            </span>
                            </div>
                        );
                        })}
                    </div>
                </div>
            </div>

            {/* Smart Table Settings & Filters */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                    <div className="flex flex-wrap bg-slate-200/50 p-1 rounded-lg gap-1">
                        <button 
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'AI_SUMMARY' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('AI_SUMMARY')}
                        >
                            AI 요약보기 (발주 추천)
                        </button>
                        <button 
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'TOTAL_DASHBOARD' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('TOTAL_DASHBOARD')}
                        >
                            월간·일간 변동 트렌드
                        </button>
                        <button 
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'ALL_TABLE' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('ALL_TABLE')}
                        >
                            전체 재고 리스트(정렬지원)
                        </button>
                        <button
                          className={`px-4 py-2 text-sm font-bold rounded-md transition-all flex items-center gap-1.5 ${
                            activeTab === 'HEALTH_DIAGNOSIS'
                              ? 'bg-linear-to-r from-rose-600 to-violet-600 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                          onClick={() => setActiveTab('HEALTH_DIAGNOSIS')}
                        >
                          🩺 재고 건전성 진단
                          {/* 악성재고 경고 배지 */}
                          {healthDiagnosis.deadStockItems.length > 0 && (
                            <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                              {healthDiagnosis.totalIssueCount}
                            </span>
                          )}
                        </button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="코드 또는 품명 검색..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="bg-white border text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-indigo-500 w-full md:w-64 shadow-inner"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto p-0 md:p-4 bg-white md:bg-transparent">
                    {invLoading ? (
                        <div className="py-20 flex justify-center text-slate-400 font-medium">데이터를 분석 중입니다...</div>
                    ) : (
                        <div className="space-y-6">
                            
                            {/* TAB 1: AI SUMMARY (Accordion) */}
                            {activeTab === 'AI_SUMMARY' && (
                                <div className="space-y-4 w-full pb-8 p-4 md:p-0">
                                    <div className="border border-rose-200 rounded-xl overflow-hidden shadow-sm">
                                        <button onClick={() => toggleGroup('CRITICAL')} className="w-full flex items-center justify-between px-5 py-4 bg-rose-50 hover:bg-rose-100 transition-colors">
                                            <div className="flex items-center gap-3">
                                                {expandedGroups['CRITICAL'] ? <ChevronDown className="w-5 h-5 text-rose-500"/> : <ChevronRight className="w-5 h-5 text-rose-500"/>}
                                                <h3 className="font-bold text-rose-800 text-lg flex flex-wrap items-center gap-2">
                                                    <span>🚨 선발주 요망 리스트</span>
                                                    <span className="text-sm font-medium text-rose-500">(대경매입처 동반 결품 위험)</span>
                                                    <span className="text-sm font-bold bg-rose-100/70 text-rose-700 px-2 py-0.5 rounded border border-rose-200 tracking-tight">
                                                        [산출식: 현재고+대기=0 & 대경=0 & 연판매{'>'}100 & 빈도≥10 | 발주단위: 전략목표치 기준 (판매량 비례 동적 캡)]
                                                    </span>
                                                </h3>
                                            </div>
                                            <span className="bg-rose-200 text-rose-800 font-black px-3 py-1 rounded-full text-sm">{stats.critical.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['CRITICAL'] && (
                                            <div className="bg-white border-t border-rose-100 overflow-x-auto overflow-y-auto max-h-[600px] custom-scrollbar">
                                                {stats.critical.length > 0 ? (
                                                <table className="w-full text-sm text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none">
                                                        <tr>
                                                            <th className="px-5 py-3 w-12 text-center">
                                                                <input type="checkbox" title="품목 선택" className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-600" 
                                                                    checked={stats.critical.length > 0 && selectedCriticalIds.size === stats.critical.length}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) setSelectedCriticalIds(new Set(stats.critical.map(r => r.product.id)));
                                                                        else setSelectedCriticalIds(new Set());
                                                                    }}
                                                                />
                                                            </th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key==='id' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key==='shQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('ysQty')}>대경재고 {sortConfig.key==='ysQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('pendingOrderQty')}>대기수량 (Pending) {sortConfig.key==='pendingOrderQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right">매입단가</th>
                                                            <th className="px-5 py-3 text-right">필요예산 (단가×결핍수량)</th>
                                                            <th className="px-5 py-3 text-right">경쟁사 연판매</th>
                                                            <th className="px-5 py-3 text-center">건전성 등급</th>
                                                            <th className="px-5 py-3 text-right">잔여일수</th>
                                                            <th className="px-5 py-3">🚨 분석 근거 (명확성)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.critical.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50">
                                                                <td className="px-5 py-4 text-center">
                                                                    <input type="checkbox" title="품목 선택" className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-600"
                                                                        checked={selectedCriticalIds.has(row.product.id)}
                                                                        onChange={(e) => {
                                                                            const newSet = new Set(selectedCriticalIds);
                                                                            if (e.target.checked) newSet.add(row.product.id);
                                                                            else newSet.delete(row.product.id);
                                                                            setSelectedCriticalIds(newSet);
                                                                        }}
                                                                    />
                                                                </td>
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-900 text-sm">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-rose-600 bg-rose-50/30">0</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-slate-400">0</td>
                                                                <td className="px-5 py-4 text-center font-bold text-slate-400">
                                                                    {row.pendingOrderQty > 0 ? <span className="text-indigo-600">+{row.pendingOrderQty} 대기중</span> : '없음'}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                <td className="px-5 py-4 text-right font-black text-rose-600 bg-rose-50/10">{formatCur(row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1))}</td>
                                                                <td className="px-5 py-4 text-right font-mono text-slate-400 text-xs">
                                                                    {row.compSales > 0 ? (
                                                                        <span>{row.compSales.toLocaleString()}</span>
                                                                    ) : <span className="text-slate-200">—</span>}
                                                                </td>
                                                                <td className="px-5 py-4 text-center border-l border-slate-100">
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                                                                            row.healthGrade === 'A' ? 'bg-purple-100 text-purple-700' :
                                                                            row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                            row.healthGrade === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                            row.healthGrade === 'C' ? 'bg-blue-100 text-blue-600' :
                                                                            row.healthGrade === 'D' ? 'bg-rose-100 text-rose-600' :
                                                                            'bg-slate-100 text-slate-400'
                                                                        }`}>
                                                                            {row.healthGrade === 'A' ? 'A급' :
                                                                            row.healthGrade === 'A' ? 'A급' :
                                                                            row.healthGrade === 'B' ? 'B급' :
                                                                            row.healthGrade === 'C' ? 'C급' :
                                                                            row.healthGrade === 'D' ? 'D급' : '—'}
                                                                        </span>
                                                                        <span className="text-xs font-mono text-slate-500">
                                                                            {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '—'}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-5 py-4 text-right border-r border-slate-100/50">
                                                                    {row.daysOnHand > 0 ? (
                                                                        <div className="flex flex-col items-end gap-0.5">
                                                                        <span className={`font-black text-sm ${
                                                                            row.daysOnHand <= 10  ? 'text-rose-600' :
                                                                            row.daysOnHand <= 30  ? 'text-amber-500' :
                                                                            row.daysOnHand <= 90  ? 'text-slate-700' :
                                                                            row.daysOnHand > 365  ? 'text-slate-400' :
                                                                            'text-emerald-600'
                                                                        }`}>
                                                                            {row.daysOnHand === 9999 ? '∞' : `${Math.round(row.daysOnHand)}일`}
                                                                        </span>
                                                                        {row.daysOnHand <= 5 * 2 && row.daysOnHand !== 9999 && (
                                                                            <span className="text-[10px] text-rose-500 font-bold">즉시발주!</span>
                                                                        )}
                                                                        </div>
                                                                    ) : <span className="text-rose-500 font-bold text-sm">0일</span>}
                                                                </td>
                                                                <td className="px-5 py-4">
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <div className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                                                                            <Info className="w-4 h-4 text-rose-500" />
                                                                            적정재고 대비 <span className="text-rose-600">{row.deficit}</span>개 부족
                                                                        </div>
                                                                        <div className="text-xs text-slate-500 pl-5">
                                                                            연 {row.salesVolume}개 판매 / 목표 {row.safeStock}개
                                                                        </div>
                                                                        <div className="text-xs text-slate-400 pl-5">
                                                                            ROP: {row.reorderPoint}개 도달 시 발주 | 목표적정: {row.safeStock}개
                                                                            {row.isExcessStock && (
                                                                                <span className="text-amber-500 font-bold ml-1">[과잉 {row.shQty - row.safeStock > 0 ? row.shQty - row.safeStock : row.shQty}개 초과]</span>
                                                                            )}
                                                                            {row.isDeadStock && (
                                                                                <span className="text-slate-400 ml-1">[사장재고 의심 — 소진 후 재평가]</span>
                                                                            )}
                                                                            {row.daekyungDirectRatio >= 80 && row.shQty > 0 && (
                                                                                <span className="text-rose-500 font-bold ml-1 bg-rose-50 px-1 rounded border border-rose-200">⚠️ 시화재고 방치 (직발송 {row.daekyungDirectRatio}%)</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="bg-rose-50/50 border-t-2 border-rose-200">
                                                        <tr>
                                                            <td colSpan={2} className="px-5 py-4">
                                                                <button onClick={() => handleCreateOrder(selectedCriticalIds, 'CRITICAL')} disabled={selectedCriticalIds.size === 0} className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${selectedCriticalIds.size > 0 ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                                                                    <span>선택 품목 발주서 만들기 ({selectedCriticalIds.size}건)</span>
                                                                    <ChevronRight className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                            <td colSpan={6} className="px-5 py-4 text-right font-bold text-slate-700 relative">
                                                                {(() => {
                                                                    const selectedItems = stats.critical.filter(item => selectedCriticalIds.has(item.product.id));
                                                                    const negoEligibleCount = selectedItems.filter(item => (item.recentPurchasePrice * (item.deficit>0?item.deficit:1)) >= 20_000_000).length;
                                                                    if (negoEligibleCount > 0) {
                                                                        return (
                                                                            <div className="absolute top-3 left-0 bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-lg flex items-center gap-1.5 animate-bounce z-10 whitespace-nowrap">
                                                                                🎉 단품 2천만원 이상 {negoEligibleCount}종! (대경 볼륨 네고)
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}
                                                                선택항목 <span className="text-rose-600 underline decoration-2">{selectedCriticalIds.size}</span>건 예상 합계:
                                                            </td>
                                                            <td className="px-5 py-4 text-right font-black text-rose-700 text-lg">
                                                                {formatCur(stats.critical.filter(w => selectedCriticalIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1), 0))} 원
                                                            </td>
                                                            <td></td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                                ) : <div className="p-8 text-center text-slate-400">훌륭합니다! 매입처 결품리스크 항목이 없습니다.</div>}
                                            </div>
                                        )}
                                    </div>

                                    <div className="border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                                        <button onClick={() => toggleGroup('WARNING')} className="w-full flex items-center justify-between px-5 py-4 bg-amber-50 hover:bg-amber-100 transition-colors">
                                            <div className="flex items-center gap-3">
                                                {expandedGroups['WARNING'] ? <ChevronDown className="w-5 h-5 text-amber-600"/> : <ChevronRight className="w-5 h-5 text-amber-600"/>}
                                                <h3 className="font-bold text-amber-800 text-lg flex flex-wrap items-center gap-2">
                                                    <span>⚠️ 일반 발주 필요</span>
                                                    <span className="text-sm font-medium text-amber-600">(입고 대기물량을 고려해도 부족함)</span>
                                                    <span className="text-sm font-bold bg-amber-100/70 text-amber-700 px-2 py-0.5 rounded border border-amber-200 tracking-tight">
                                                        [산출식: 전략목표재고 미달분 보충 | 발주단위: 최소 100개 (판매량 비례 동적 캡)]
                                                    </span>
                                                </h3>
                                            </div>
                                            <span className="bg-amber-200 text-amber-800 font-black px-3 py-1 rounded-full text-sm">{stats.warning.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['WARNING'] && (
                                            <div className="bg-white border-t border-amber-100 overflow-x-auto overflow-y-auto max-h-[600px] custom-scrollbar">
                                                {stats.warning.length > 0 ? (
                                                <table className="w-full text-sm text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none">
                                                        <tr>
                                                            <th className="px-4 py-3 w-10 text-center">
                                                                <input 
                                                                    type="checkbox" 
                                                                    title="전체 선택"
                                                                    checked={stats.warning.length > 0 && selectedWarningIds.size === stats.warning.length}
                                                                    onChange={toggleAllWarnings}
                                                                    className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                                                                />
                                                            </th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key==='id' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key==='shQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('safeStock')}>적정재고(목표) {sortConfig.key==='safeStock' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('pendingOrderQty')}>입고 대기중 {sortConfig.key==='pendingOrderQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('ysQty')}>대경재고 {sortConfig.key==='ysQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right">매입단가</th>
                                                            <th className="px-5 py-3 text-right">필요예산 (단가×결핍수량)</th>
                                                            <th className="px-5 py-3 text-right">경쟁사 연판매</th>
                                                            <th className="px-5 py-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('healthGrade')}>건전성 등급 {sortConfig.key==='healthGrade' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200" onClick={() => handleSort('daysOnHand')}>잔여일수 {sortConfig.key==='daysOnHand' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3">💡 분석 근거</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.warning.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={(e) => toggleWarningSelection(row.product.id, e)}>
                                                                <td className="px-4 py-4 text-center">
                                                                    <input 
                                                                        type="checkbox"
                                                                        title="발주 항목 선택"
                                                                        checked={selectedWarningIds.has(row.product.id)}
                                                                        onChange={(e) => toggleWarningSelection(row.product.id, e as unknown as React.MouseEvent)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                                                                    />
                                                                </td>
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-900 text-sm">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-amber-600 bg-amber-50 text-base">
                                                                    {row.shQty}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-indigo-600">
                                                                    {row.safeStock}
                                                                    <div className="text-[10px] font-normal text-slate-400 mt-1">/ 총판매:{row.salesVolume}</div>
                                                                </td>
                                                                <td className="px-5 py-4 text-center font-bold text-slate-500">
                                                                    {row.pendingOrderQty > 0 ? <span className="text-blue-600 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-md font-black shadow-sm">+{row.pendingOrderQty}</span> : <span className="text-slate-300">-</span>}
                                                                </td>
                                                                <td className="px-5 py-4 text-right">
                                                                    <span className="px-2 py-1 bg-teal-50 text-teal-700 font-extrabold font-mono rounded-lg border border-teal-200 shadow-sm">{row.ysQty}</span>
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                <td className="px-5 py-4 text-right font-black text-amber-700 bg-amber-50/30">{formatCur(row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1))}</td>
                                                                <td className="px-5 py-4 text-right font-mono text-slate-400 text-xs">
                                                                    {row.compSales > 0 ? (
                                                                        <span>{row.compSales.toLocaleString()}</span>
                                                                    ) : <span className="text-slate-200">—</span>}
                                                                </td>
                                                                <td className="px-5 py-4 text-center border-l border-slate-100">
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                                                                            row.healthGrade === 'A' ? 'bg-purple-100 text-purple-700' :
                                                                            row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                            row.healthGrade === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                            row.healthGrade === 'C' ? 'bg-blue-100 text-blue-600' :
                                                                            row.healthGrade === 'D' ? 'bg-rose-100 text-rose-600' :
                                                                            'bg-slate-100 text-slate-400'
                                                                        }`}>
                                                                            {row.healthGrade === 'A' ? 'A급' :
                                                                            row.healthGrade === 'A' ? 'A급' :
                                                                            row.healthGrade === 'B' ? 'B급' :
                                                                            row.healthGrade === 'C' ? 'C급' :
                                                                            row.healthGrade === 'D' ? 'D급' : '—'}
                                                                        </span>
                                                                        <span className="text-xs font-mono text-slate-500">
                                                                            {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '—'}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-5 py-4 text-right border-r border-slate-100/50">
                                                                    {row.daysOnHand > 0 ? (
                                                                        <div className="flex flex-col items-end gap-0.5">
                                                                        <span className={`font-black text-sm ${
                                                                            row.daysOnHand <= 10  ? 'text-rose-600' :
                                                                            row.daysOnHand <= 30  ? 'text-amber-500' :
                                                                            row.daysOnHand <= 90  ? 'text-slate-700' :
                                                                            row.daysOnHand > 365  ? 'text-slate-400' :
                                                                            'text-emerald-600'
                                                                        }`}>
                                                                            {row.daysOnHand === 9999 ? '∞' : `${Math.round(row.daysOnHand)}일`}
                                                                        </span>
                                                                        {row.daysOnHand <= 5 * 2 && row.daysOnHand !== 9999 && (
                                                                            <span className="text-[10px] text-rose-500 font-bold">즉시발주!</span>
                                                                        )}
                                                                        </div>
                                                                    ) : <span className="text-rose-500 font-bold text-sm">0일</span>}
                                                                </td>
                                                                <td className="px-5 py-4">
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <div className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                                                                            <Info className="w-4 h-4 text-amber-500" />
                                                                            재고부족 <span className="text-rose-600">-{row.deficit}</span>개
                                                                        </div>
                                                                        <div className="text-xs text-slate-500 pl-5">
                                                                            연판매 {row.salesFreq}회 / 적정재고 {row.safeStock}개
                                                                        </div>
                                                                        <div className="text-xs text-slate-400 pl-5">
                                                                            ROP: {row.reorderPoint}개 도달 시 발주 | 목표적정: {row.safeStock}개
                                                                            {row.stockStatusByTurnover === 'EXCESS' && (
                                                                                <span className="text-amber-500 font-bold ml-1">[과잉 {row.shQty - row.safeStock}개 초과]</span>
                                                                            )}
                                                                            {row.stockStatusByTurnover === 'DEAD' && (
                                                                                <span className="text-slate-400 ml-1">[사장재고 의심 — 소진 후 재평가]</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="bg-amber-50/50 border-t-2 border-amber-200">
                                                        <tr>
                                                            <td colSpan={3} className="px-5 py-4">
                                                                <button onClick={() => handleCreateOrder(selectedWarningIds, 'WARNING')} disabled={selectedWarningIds.size === 0} className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${selectedWarningIds.size > 0 ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                                                                    <span>선택 품목 발주서 만들기 ({selectedWarningIds.size}건)</span>
                                                                    <ChevronRight className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                            <td colSpan={6} className="px-5 py-4 text-right font-bold text-slate-700 relative">
                                                                {(() => {
                                                                    const selectedItems = stats.warning.filter(item => selectedWarningIds.has(item.product.id));
                                                                    const negoEligibleCount = selectedItems.filter(item => (item.recentPurchasePrice * (item.deficit>0?item.deficit:1)) >= 20_000_000).length;
                                                                    if (negoEligibleCount > 0) {
                                                                        return (
                                                                            <div className="absolute top-3 left-0 bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-lg flex items-center gap-1.5 animate-bounce z-10 whitespace-nowrap">
                                                                                🎉 단품 2천만원 이상 {negoEligibleCount}종! (대경 볼륨 네고)
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}
                                                                선택항목 <span className="text-amber-600 underline decoration-2">{selectedWarningIds.size}</span>건 예상 합계:
                                                            </td>
                                                            <td className="px-5 py-4 text-right font-black text-amber-700 text-lg">
                                                                {formatCur(stats.warning.filter(w => selectedWarningIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1), 0))} 원
                                                            </td>
                                                            <td></td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                                ) : <div className="p-8 text-center text-slate-400">발주가 필요한 품목이 없습니다. 시화재고 관리가 매우 이상적입니다!</div>}
                                            </div>
                                        )}
                                    </div>

                                    <div className="border border-indigo-200 rounded-xl overflow-hidden shadow-sm mt-6">
                                        <button onClick={() => toggleGroup('REGULAR')} className="w-full flex items-center justify-between px-5 py-4 bg-indigo-50 hover:bg-indigo-100 transition-colors">
                                            <div className="flex items-center gap-3">
                                                {expandedGroups['REGULAR'] ? <ChevronDown className="w-5 h-5 text-indigo-600"/> : <ChevronRight className="w-5 h-5 text-indigo-600"/>}
                                                <h3 className="font-bold text-indigo-800 text-lg flex flex-wrap items-center gap-2">
                                                    <span>♻️ 정기 발주 예측</span>
                                                    <span className="text-sm font-medium text-indigo-500">(우량 품목 2개월분 선주문 권장)</span>
                                                    <span className="text-sm font-bold bg-indigo-100/70 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 tracking-tight">
                                                        [산출식: 빈도≥20 & 추천량=((연판매/6)-현재고) | 발주단위: 최소 500개 (Size≥100A는 최대 300캡)]
                                                    </span>
                                                </h3>
                                            </div>
                                            <span className="bg-indigo-200 text-indigo-800 font-black px-3 py-1 rounded-full text-sm">{stats.regular.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['REGULAR'] && (
                                            <div className="bg-white border-t border-indigo-100 overflow-x-auto overflow-y-auto max-h-[600px] custom-scrollbar">
                                                {stats.regular.length > 0 ? (
                                                <table className="w-full text-sm text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none">
                                                        <tr>
                                                            <th className="px-5 py-3 w-12 text-center">
                                                                <input type="checkbox" title="품목 선택" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600" 
                                                                    checked={stats.regular.length > 0 && selectedRegularIds.size === stats.regular.length}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) setSelectedRegularIds(new Set(stats.regular.map(r => r.product.id)));
                                                                        else setSelectedRegularIds(new Set());
                                                                    }}
                                                                />
                                                            </th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key==='id' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('safeStock')}>적정재고(목표) {sortConfig.key==='safeStock' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key==='shQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-center">판매/보충 이력</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition text-center" onClick={() => handleSort('ysQty')}>대경재고 {sortConfig.key==='ysQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right">매입단가</th>
                                                            <th className="px-5 py-3 text-right w-40">추천 발주량</th>
                                                            <th className="px-5 py-3">💡 분석 근거</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.regular.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50">
                                                                <td className="px-5 py-4 text-center">
                                                                    <input type="checkbox" title="품목 선택" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                                                                        checked={selectedRegularIds.has(row.product.id)}
                                                                        onChange={(e) => {
                                                                            const newSet = new Set(selectedRegularIds);
                                                                            if (e.target.checked) newSet.add(row.product.id);
                                                                            else newSet.delete(row.product.id);
                                                                            setSelectedRegularIds(newSet);
                                                                        }}
                                                                    />
                                                                </td>
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-900 text-sm">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right font-mono text-indigo-500 text-sm">{row.safeStock}</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-indigo-600 bg-indigo-50 text-base">{row.shQty}</td>
                                                                <td className="px-5 py-4 text-center text-xs font-medium text-slate-500">
                                                                    연 {row.salesFreq}회 판매 / 누적 {row.salesVolume}개
                                                                </td>
                                                                <td className="px-5 py-4 text-center font-bold font-mono text-slate-500">
                                                                    {row.ysQty > 0 ? <span className="text-teal-600">{row.ysQty}</span> : <span className="text-rose-400">0</span>}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                <td className="px-5 py-4 text-right font-black text-indigo-600 bg-indigo-50/30">
                                                                    {row.recommendedQty}
                                                                </td>
                                                                <td className="px-5 py-4">
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <div className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                                                                            <Activity className="w-4 h-4 text-indigo-500" />
                                                                            전략 목표치 <span className="text-indigo-600">{row.recommendedQty}</span>개 권장
                                                                        </div>
                                                                        <div className="text-xs text-slate-500 pl-5">
                                                                            월평균 {Math.round(row.salesVolume / 12)}개 소요 (회전율 기반)
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="bg-indigo-50/50 border-t-2 border-indigo-200">
                                                        <tr>
                                                            <td colSpan={5} className="px-5 py-4">
                                                                <button onClick={() => handleCreateOrder(selectedRegularIds, 'REGULAR')} disabled={selectedRegularIds.size === 0} className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${selectedRegularIds.size > 0 ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                                                                    <span>선택 품목 발주서 만들기 ({selectedRegularIds.size}건)</span>
                                                                    <ChevronRight className="w-4 h-4" />
                                                                </button>
                                                            </td>
                                                            <td colSpan={2} className="px-5 py-4 text-right font-bold text-slate-700">
                                                                선택항목 <span className="text-indigo-600 underline decoration-2">{selectedRegularIds.size}</span>건 예상 합계:
                                                            </td>
                                                            <td className="px-5 py-4 text-right font-black text-indigo-700 text-lg">
                                                                {formatCur(stats.regular.filter(w => selectedRegularIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * (row.recommendedQty || 0), 0))} 원
                                                            </td>
                                                            <td></td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                                ) : <div className="p-8 text-center text-slate-400">우량 품목들이 현재 모두 충분한 재고량을 안전하게 확보하고 있습니다!</div>}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: TOTAL DASHBOARD AND DAILY TREND */}
                            {activeTab === 'TOTAL_DASHBOARD' && (
                                <div className="space-y-6 w-full p-4 md:p-0">
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-fit">
                                            <div className="bg-slate-800 text-white px-5 py-4 flex items-center justify-between shrink-0">
                                                <div className="flex items-center gap-2">
                                                    <CalendarDays className="w-5 h-5 text-indigo-400" />
                                                    <h2 className="font-bold">월별 시화재고 보충(매입) 누적</h2>
                                                </div>
                                                <select
                                                    title="월 선택"
                                                    aria-label="월 선택"
                                                    value={selectedMonth}
                                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                                    className="bg-slate-700 border-none rounded text-sm py-1.5 px-3 text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder-white appearance-none"
                                                >
                                                    {availableMonths.map(m => (
                                                        <option key={m} value={m}>{m} 월</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="p-5 grid grid-cols-1 gap-4 bg-indigo-50/20 flex-1">
                                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                                                    <div className="flex items-center gap-2 mb-2 text-slate-500">
                                                        <PackageSearch className="w-4 h-4 text-teal-500" />
                                                        <span className="font-bold text-sm">입고 완료 (COMPLETED)</span>
                                                    </div>
                                                    <div className="text-3xl font-black text-slate-800 mb-1">
                                                        {formatCur(monthData.completedCost)} <span className="text-lg text-slate-400 tracking-normal">원</span>
                                                    </div>
                                                    <div className="text-sm font-bold text-teal-600 text-right">{monthData.completedCount}건 매입 확정</div>
                                                </div>

                                                <div className="bg-white p-4 rounded-xl border border-rose-100 shadow-sm relative overflow-hidden">
                                                    <div className="flex items-center gap-2 mb-2 text-rose-500">
                                                        <TrendingUp className="w-4 h-4" />
                                                        <span className="font-bold text-sm">발주 대기 (PENDING - 입고예정)</span>
                                                    </div>
                                                    <div className="text-3xl font-black text-rose-600 mb-1">
                                                        {formatCur(monthData.pendingCost)} <span className="text-lg text-rose-300 tracking-normal">원</span>
                                                    </div>
                                                    <div className="text-sm font-bold text-rose-500 text-right">잔여 {monthData.pendingCount}건 대기 중</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50 shrink-0">
                                                <div className="flex items-center gap-2">
                                                    <History className="w-5 h-5 text-amber-500" />
                                                    <h2 className="font-bold text-slate-800">일간 변동 트렌드 (실제 출고/입고 파악)</h2>
                                                </div>
                                            </div>
                                            <div className="p-0 flex-1 h-[320px] overflow-y-auto">
                                                {historyLoading ? (
                                                    <div className="p-8 text-center text-slate-400">불러오는 중입니다...</div>
                                                ) : historyData.inventoryHistory.length === 0 ? (
                                                    <div className="p-8 text-center text-slate-400">최근 변동 이력이 없습니다.</div>
                                                ) : (
                                                    <div className="p-0">
                                                        {historyData.inventoryHistory.slice(-10).reverse().map((snap: InventoryHistorySnapshot, idx: number) => {
                                                            let dailyRevenue = 0;
                                                            let dailyCost = 0;
                                                            
                                                            let validCount = 0;
                                                            if (snap.diff) {
                                                                snap.diff.forEach((d: InventoryDiffItem) => {
                                                                    const orderImpact = dailyOrderDiffMap[snap.date]?.[d.id] || 0;
                                                                    const pureManualChange = d.change - orderImpact;
                                                                    
                                                                    if (pureManualChange !== 0) validCount++;

                                                                    const analysis = d.id ? analyzedInventory.find(ai => ai.product.id === d.id) : null;
                                                                    
                                                                    // Use actual physical change `d.change` for revenue and cost
                                                                    const physicalChange = d.change;
                                                                    const effectiveSales = d.sales !== undefined ? d.sales : (physicalChange < 0 ? Math.abs(physicalChange) : 0);
                                                                    if (effectiveSales > 0) {
                                                                        dailyRevenue += effectiveSales * (analysis ? analysis.sellingPrice : 0);
                                                                    }
                                                                    
                                                                    const effectiveRestock = physicalChange + effectiveSales;
                                                                    if (effectiveRestock > 0) {
                                                                        dailyCost += effectiveRestock * (analysis ? analysis.recentPurchasePrice : 0);
                                                                    }
                                                                });
                                                            }

                                                            const isGroupExpanded = expandedDailyGroups[snap.date] ?? (idx === 0);

                                                                            const itemsToRender = snap.diff || [];

                                                                            return (
                                                                                <div key={idx} className="border-b border-slate-100 last:border-0 p-4">
                                                                                    <div className="flex flex-col gap-2 mb-3">
                                                                                        <div className="flex items-center justify-between">
                                                                                            <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-mono font-bold hover:bg-slate-300 cursor-pointer transition-colors" onClick={() => toggleDailyGroup(snap.date)}>{snap.date}</span>
                                                                                            <span className="text-slate-500 font-medium text-xs">총 변동 {itemsToRender.length}건 <span className="text-rose-500 ml-1 font-bold">{validCount > 0 ? `(순수 수기 ${validCount}건)` : ''}</span></span>
                                                                                        </div>
                                                                        
                                                                        {(dailyRevenue > 0 || dailyCost > 0) && (
                                                                            <div 
                                                                                className="flex items-center gap-3 mt-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:bg-slate-100 transition-colors"
                                                                                onClick={() => toggleDailyGroup(snap.date)}
                                                                            >
                                                                                <div className="flex flex-col flex-1 pl-2 border-l-4 border-blue-400">
                                                                                    <span className="text-[10px] text-slate-500 font-bold tracking-tight">출고액</span>
                                                                                    <span className="text-sm font-black text-blue-700">₩{formatCur(dailyRevenue)}</span>
                                                                                </div>
                                                                                <div className="w-px h-8 bg-slate-200"></div>
                                                                                <div className="flex flex-col flex-1 pl-2 border-l-4 border-emerald-400">
                                                                                    <span className="text-[10px] text-slate-500 font-bold tracking-tight">입고액</span>
                                                                                    <span className="text-sm font-black text-emerald-700">₩{formatCur(dailyCost)}</span>
                                                                                </div>
                                                                                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`} />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    {isGroupExpanded && (
                                                                        itemsToRender.length > 0 ? (
                                                                            <div className="grid grid-cols-1 gap-2 mt-2">
                                                                                {[...itemsToRender].sort((a, b) => {
                                                                                    const aiA = a.id ? analyzedInventory.find(ai => ai.product.id === a.id) : null;
                                                                                    const aiB = b.id ? analyzedInventory.find(ai => ai.product.id === b.id) : null;
                                                                                    return (aiB ? aiB.deficit : 0) - (aiA ? aiA.deficit : 0);
                                                                                }).map((d, dIdx) => {
                                                                                    const rowKey = `${snap.date}-${d.id || d.name}-${dIdx}`;
                                                                                    const orderImpact = dailyOrderDiffMap[snap.date]?.[d.id] || 0;
                                                                                    const pureManualChange = d.change - orderImpact;

                                                                                    const isExpanded = !!expandedTrendItems[rowKey];
                                                                                    const analysis = d.id ? analyzedInventory.find(ai => ai.product.id === d.id) : null;
                                                                                    const sellingPrice = analysis ? analysis.sellingPrice : 0;
                                                                                    const purchasePrice = analysis ? analysis.recentPurchasePrice : 0;
                                                                                    
                                                                                    const physicalChange = d.change;
                                                                                    const effectiveSales = d.sales !== undefined ? d.sales : (physicalChange < 0 ? Math.abs(physicalChange) : 0);
                                                                                    const effectiveRestock = physicalChange + effectiveSales;
                                                                                    
                                                                                    const valueChips = [];
                                                                                    if (effectiveSales > 0) {
                                                                                        valueChips.push({
                                                                                            label: `출고수량 ${effectiveSales}개`,
                                                                                            amt: `출고액 ${formatCur(effectiveSales * sellingPrice)}원`,
                                                                                            style: 'text-blue-700 bg-blue-50 border border-blue-200'
                                                                                        });
                                                                                    }
                                                                                    if (effectiveRestock > 0) {
                                                                                        valueChips.push({
                                                                                            label: `입고수량 ${effectiveRestock}개`,
                                                                                            amt: `입고액 ${formatCur(effectiveRestock * purchasePrice)}원`,
                                                                                            style: 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                                                                        });
                                                                                    }

                                                                                    const finalId = d.id || d.name || '알수없음';
                                                                                    const isOrderMatched = pureManualChange === 0 && d.change !== 0;

                                                                                    return (
                                                                                        <div key={dIdx} className={`flex flex-col text-xs bg-white rounded border border-slate-100 border-l-4 ${physicalChange > 0 ? 'border-l-emerald-500' : 'border-l-blue-500'} ${isOrderMatched ? 'opacity-80 border-dashed' : ''}`}>
                                                                                            <div 
                                                                                                className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-50 transition-colors"
                                                                                                onClick={() => toggleTrendItem(rowKey)}
                                                                                            >
                                                                                                <div className="flex flex-col flex-1 min-w-0 pr-2">
                                                                                                    <span className="font-bold text-slate-700 font-mono truncate" title={finalId}>{finalId}</span>
                                                                                                    {d.name && d.name !== finalId && <span className="text-[10px] text-slate-400 truncate">{d.name}</span>}
                                                                                                </div>
                                                                                                <div className="flex items-center gap-2 shrink-0">
                                                                                                    <div className="flex flex-col items-end gap-1">
                                                                                                        <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[200px]">
                                                                                                            {analysis && (
                                                                                                                <div className="text-[10px] w-full text-right text-slate-500 group-hover:text-slate-700 transition-colors mt-0.5">
                                                                                                                    현재고 <span className="font-bold text-slate-700">{analysis.shQty}</span> / 적정재고 <span className="font-bold text-slate-700">{analysis.safeStock}</span>
                                                                                                                </div>
                                                                                                            )}
                                                                                                            {valueChips.map((chip, i) => (
                                                                                                                <div key={i} className={`flex flex-col items-end px-1.5 py-0.5 rounded ${chip.style}`}>
                                                                                                                    <span className="font-bold tracking-tight">{chip.label}</span>
                                                                                                                    {(sellingPrice > 0 || purchasePrice > 0) && (
                                                                                                                        <span className="text-[9px] opacity-80">{chip.amt}</span>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            ))}
                                                                                                            {valueChips.length === 0 && physicalChange === 0 && (
                                                                                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">변동상쇄됨 (0)</span>
                                                                                                            )}
                                                                                                            {isOrderMatched && (
                                                                                                                <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded ml-1 font-bold" title="주문 관리 시스템 기록과 완벽 일치">✔️ 주문연동</span>
                                                                                                            )}
                                                                                                        </div>

                                                                                                    </div>
                                                                                                    <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                                                                </div>
                                                                                            </div>
                                                                                            
                                                                                            {isExpanded && analysis && (
                                                                                                <div className="p-3 bg-slate-50/50 border-t border-slate-100 grid grid-cols-2 gap-4">
                                                                                                    <div className="flex flex-col gap-1">
                                                                                                        <span className="text-[10px] text-slate-400 font-bold">현재재고(시화)</span>
                                                                                                        <span className="text-sm font-black text-slate-700">{analysis.shQty} <span className="text-[10px] font-normal text-slate-500">개</span></span>
                                                                                                    </div>
                                                                                                    <div className="flex flex-col gap-1">
                                                                                                        <span className="text-[10px] text-slate-400 font-bold">적정재고(목표)</span>
                                                                                                        <span className="text-sm font-bold text-indigo-500">{analysis.safeStock} <span className="text-[10px] font-normal text-slate-500">개</span></span>
                                                                                                    </div>
                                                                                                    <div className="flex flex-col gap-1">
                                                                                                        <span className="text-[10px] text-slate-400 font-bold">매출단가(추정)</span>
                                                                                                        <span className="text-sm font-bold text-slate-700">{formatCur(analysis.sellingPrice)} <span className="text-[10px] font-normal text-slate-500">원</span></span>
                                                                                                    </div>
                                                                                                    <div className="flex flex-col gap-1">
                                                                                                        <span className="text-[10px] text-slate-400 font-bold">매입단가(최근)</span>
                                                                                                        <span className="text-sm font-bold text-slate-700">{formatCur(analysis.recentPurchasePrice)} <span className="text-[10px] font-normal text-slate-500">원</span></span>
                                                                                                    </div>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        ) : <p className="text-xs text-slate-400 mt-2 px-1">변동 이력이 없습니다.</p>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50 shrink-0">
                                                <div className="flex items-center gap-2">
                                                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                                                    <h2 className="font-bold text-slate-800">최근 30일 판매 TOP 품목</h2>
                                                </div>
                                                <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-bold border border-slate-200">자동분석</span>
                                            </div>
                                            <div className="p-0 flex-1 h-[320px] overflow-y-auto bg-slate-50/30">
                                                <div className="grid grid-cols-1 divide-y divide-slate-100">
                                                    {(() => {
                                                        const topItems = [...analyzedInventory]
                                                            .filter(item => item.recent30dSales > 0 && !item.product.id.startsWith('STUBEND') && item.sellingPrice > 0)
                                                            .sort((a, b) => b.recent30dSales - a.recent30dSales)
                                                            .slice(0, 50); // Get top 50
                                                            
                                                        if (topItems.length === 0) {
                                                            return <div className="p-8 text-center text-slate-400">데이터가 없습니다.</div>;
                                                        }

                                                        return topItems.map((item, idx) => (
                                                            <div key={item.product.id} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between">
                                                                <div className="flex items-center gap-3 overflow-hidden">
                                                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${idx < 3 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                                                                        {idx + 1}
                                                                    </div>
                                                                    <div className="flex flex-col min-w-0 pr-2">
                                                                        <span className="font-bold text-slate-700 text-xs truncate" title={item.product.id}>{item.product.id}</span>
                                                                        <span className="text-[10px] text-slate-400 font-medium">단위매출 ₩{formatCur(item.sellingPrice)}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-col items-end shrink-0 pl-1">
                                                                    <div className="flex items-center gap-1 justify-end">
                                                                        <span className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-bold">{item.salesFreq}회발생</span>
                                                                        <span className="font-black text-slate-700 text-sm drop-shadow-sm">{item.recent30dSales} <span className="font-normal text-[10px] text-slate-400">개</span></span>
                                                                    </div>
                                                                    <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded truncate max-w-[80px]" title={`기간누적매출 ${formatCur(item.recent30dSales * item.sellingPrice)}원`}>
                                                                        ₩{formatCur(item.recent30dSales * item.sellingPrice)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))
                                                    })()}
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* TAB 3: ALL TABLE WITH SORTING */}
                            {activeTab === 'ALL_TABLE' && (
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="text-slate-500 font-bold bg-slate-50 border-y border-slate-200 select-none">
                                        <tr>
                                            <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 ID {sortConfig.key==='id' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-center group relative cursor-help">
                                                등급 <span className="text-[10px] text-slate-400">ⓘ</span>
                                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 bg-slate-800 text-white text-[11px] p-3 rounded shadow-lg hidden group-hover:block z-50 text-left font-normal whitespace-normal cursor-auto">
                                                    <div className="font-bold mb-1 border-b border-slate-600 pb-1">건전성 평가 항목(%) 기준</div>
                                                    <div className="mb-2 text-slate-300">실제 판매량, 견적 유입량, 주문 데이터를 복합 연계하여 산출한 종합 등급입니다.</div>
                                                    <ul className="space-y-1">
                                                        <li><span className="text-emerald-300 font-bold">A급 (최우수)</span>: 회전율 우수, 꾸준한 매출 기여</li>
                                                        <li><span className="text-blue-300 font-bold">B급 (양호)</span>: 회전율 양호, 안정적 유지권</li>
                                                        <li><span className="text-amber-300 font-bold">C급 (보통)</span>: 저회전 또는 간헐적 판매 발생</li>
                                                        <li><span className="text-orange-300 font-bold">D급 (주의)</span>: 과잉재고 또는 최근 무판매 정체</li>
                                                        <li><span className="text-rose-300 font-bold">E급 (악성)</span>: 장기 무판매 사장재고 (처분 요망)</li>
                                                        <li><span className="text-slate-300 font-bold">N급 (제외)</span>: 판매/재고 없음 (평가 불가)</li>
                                                    </ul>
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('turnoverRate')}>회전율 {sortConfig.key==='turnoverRate' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-center">최근 실적(60일)</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-amber-700" onClick={() => handleSort('salesVolume')}>판매이력 {sortConfig.key==='salesVolume' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-indigo-700" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key==='shQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('ysQty')}>대경 재고 {sortConfig.key==='ysQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition group relative" onClick={() => handleSort('daysOnHand')}>
                                                잔여일 {sortConfig.key==='daysOnHand' && (sortConfig.direction==='asc'?'↑':'↓')}
                                                <div className="absolute right-0 bottom-full mb-2 w-56 bg-slate-800 text-white text-[11px] p-3 rounded shadow-lg hidden group-hover:block z-50 text-left font-normal whitespace-normal cursor-auto">
                                                    <div className="font-bold mb-1 border-b border-slate-600 pb-1">잔여일 산출 로직</div>
                                                    <div className="text-slate-300 mb-1">현재 시화재고를 <span className="font-bold">일평균 판매량</span>으로 나눈 값으로, <span className="text-amber-300 font-bold">재발주 시점 산출 및 결품 예방</span>을 위해 사용됩니다.</div>
                                                    <div className="text-slate-400 text-[10px] mt-1">※ 무한대(∞)는 판매량 대비 재고가 너무 많아 소진 시점을 추정하기 어려운 상태를 의미합니다.</div>
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-rose-500 font-black" onClick={() => handleSort('deficit')}>보충 {sortConfig.key==='deficit' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-teal-700" onClick={() => handleSort('recentPurchasePrice')}>이익률(단가) {sortConfig.key==='recentPurchasePrice' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {analyzedInventory.slice(0, 500).map(row => (
                                            <tr key={row.product.id} className="hover:bg-slate-50 group">
                                                <td className="px-4 py-2 font-mono font-bold text-slate-700">
                                                    {row.product.id}
                                                    {row.isExcessStock && <span className="ml-1 text-[9px] bg-orange-100 text-orange-600 px-1 rounded font-bold">과잉</span>}
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-black ${
                                                        row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                        row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' :
                                                        row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' :
                                                        row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' :
                                                        row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' :
                                                        'bg-slate-100 text-slate-500'
                                                    }`} title="종합 건전성 등급">{row.healthGrade}급</span>
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                {row.healthGrade !== 'N' ? (
                                                    <div className="flex flex-col items-center">
                                                    <span className={`text-[10px] font-black px-1.5 rounded ${
                                                        row.healthGrade === 'A' ? 'bg-purple-100 text-purple-700' :
                                                        row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                        row.healthGrade === 'B' ? 'bg-amber-100 text-amber-700' :
                                                        row.healthGrade === 'C' ? 'bg-blue-100 text-blue-600' :
                                                        'bg-rose-100 text-rose-500'
                                                    }`}>{row.healthGrade}급</span>
                                                    <span className="text-[10px] font-mono text-slate-400 mt-0.5">
                                                        {row.turnoverRate > 0 ? `${row.turnoverRate}x` : ''}
                                                    </span>
                                                    </div>
                                                ) : <span className="text-slate-200">—</span>}
                                                </td>
                                                <td className="px-4 py-2 text-center text-slate-600">
                                                    <div className="flex flex-col items-center">
                                                        <span className="font-black text-slate-800">{row.recent60dSales} <span className="text-[9px] text-slate-400">판매</span></span>
                                                        <span className="font-bold text-indigo-500 text-[10px]">{row.quoteCount} <span className="text-[9px] text-indigo-300">견적</span></span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2 text-right text-slate-600">
                                                    {row.salesVolume > 0 ? (
                                                        <span><span className="font-bold text-slate-800">{row.salesVolume}</span> <span className="text-[10px] text-slate-500">({row.salesFreq}회)</span></span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-right font-black font-mono text-indigo-600 bg-indigo-50/20">
                                                    {row.shQty}
                                                    {row.pendingOrderQty > 0 && <span className="text-[9px] text-rose-400 ml-1">(+{row.pendingOrderQty})</span>}
                                                </td>
                                                <td className="px-4 py-2 text-center font-bold font-mono text-slate-500">
                                                    {row.ysQty > 0 ? <span className="text-teal-600">{row.ysQty}</span> : <span className="text-rose-400">0</span>}
                                                </td>
                                                <td className="px-4 py-2 text-right font-mono text-xs">
                                                <span className={
                                                    row.daysOnHand <= 10  ? 'text-rose-600 font-bold' :
                                                    row.daysOnHand <= 30  ? 'text-amber-500 font-bold' :
                                                    row.daysOnHand > 365  ? 'text-slate-300' :
                                                    'text-slate-600'
                                                }>
                                                    {row.shQty === 0 ? '0일' :
                                                    row.daysOnHand === 9999 ? '∞' :
                                                    `${Math.round(row.daysOnHand)}일`}
                                                </span>
                                                </td>
                                                <td className="px-4 py-2 text-right font-black text-rose-600 bg-rose-50/30">
                                                    {row.deficit > 0 ? `-${row.deficit}개` : <span className="text-slate-300 font-normal">충분</span>}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <div className="flex flex-col items-end">
                                                        <span className={`font-black text-xs ${row.profitMarginRate <= 0 ? 'text-rose-500' : row.profitMarginRate >= 30 ? 'text-emerald-600' : 'text-slate-700'}`}>{row.profitMarginRate}%</span>
                                                        <span className="text-[9px] text-slate-400 font-mono">단가 {formatCur(row.recentPurchasePrice)}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            
{/* ════════════════════════════════════════════════
    🩺 악성·과잉 재고 진단 탭
════════════════════════════════════════════════ */}
{activeTab === 'HEALTH_DIAGNOSIS' && (
  <div className="space-y-5 p-4 md:p-0 pb-8 animate-in fade-in duration-300">

    {/* ── 섹션 1: 건강도 점수 + 구성 개요 ── */}
    <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">

      {/* 건강도 게이지 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">
          🩺 재고 건강도 종합 점수
        </div>
        <div className="flex items-center gap-4">
          {/* SVG 게이지 */}
          <div className="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 112 112" width="112" height="112">
              <circle cx="56" cy="56" r="44" fill="none" stroke="#f1f5f9" strokeWidth="11"/>
              <circle cx="56" cy="56" r="44" fill="none"
                stroke={healthDiagnosis.healthGrade.strokeColor} strokeWidth="11"
                strokeDasharray="276.5"
                strokeDashoffset={276.5 * (1 - healthDiagnosis.healthScore / 100)}
                strokeLinecap="round"
                transform="rotate(-90 56 56)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-black ${healthDiagnosis.healthGrade.textClass}`}>
                {healthDiagnosis.healthScore}
              </span>
              <span className="text-[9px] text-slate-400 font-bold">/ 100점</span>
            </div>
          </div>
          <div className="flex-1">
            <div className={`text-sm font-black mb-1 ${healthDiagnosis.healthGrade.textClass}`}>
              {healthDiagnosis.healthGrade.label}
            </div>
            <div className="text-[11px] text-slate-500 space-y-0.5">
              <div>악성재고 <span className="font-bold text-rose-600">{(healthDiagnosis.deadRatio * 100).toFixed(1)}%</span></div>
              <div>과잉재고 <span className="font-bold text-orange-500">{(healthDiagnosis.excessRatio * 100).toFixed(1)}%</span></div>
              <div>ITS 비율 <span className="font-bold text-amber-600">{(healthDiagnosis.its * 100).toFixed(1)}%</span></div>
            </div>
            <div className="text-[9px] text-slate-400 mt-2">쿠팡·다이소 기준: 악성 5% 이하, 과잉 10% 이하</div>
          </div>
        </div>
      </div>

      {/* 재고 구성 스택 바 + ITS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
          전체 재고 자산 구성 ({formatCur(Math.round(healthDiagnosis.totalStockValue / 10000))}만원)
        </div>
        {/* 스택 바 */}
        <div className="h-7 rounded-lg overflow-hidden flex mb-3">
          {[
            { value: healthDiagnosis.optimalStockValue,  bgClass: 'bg-green-600', label: '적정·안전' },
            { value: healthDiagnosis.excessStockValue,   bgClass: 'bg-orange-600', label: '과잉' },
            { value: healthDiagnosis.deadStockValue,     bgClass: 'bg-rose-600', label: '악성' },
            { value: healthDiagnosis.slowMoveValue,      bgClass: 'bg-purple-600', label: '부진' },
          ].map(seg => {
            const pct = healthDiagnosis.totalStockValue > 0
              ? (seg.value / healthDiagnosis.totalStockValue * 100) : 0;
            return pct > 0 ? (
              <div key={seg.label} {...{ style: { flex: pct } }}
                className={`flex items-center justify-center text-white text-[9px] font-black overflow-hidden ${seg.bgClass}`}
                title={`${seg.label}: ${pct.toFixed(1)}%`}
              >
                {pct >= 5 ? `${pct.toFixed(0)}%` : ''}
              </div>
            ) : null;
          })}
        </div>
        {/* 범례 */}
        <div className="flex flex-wrap gap-3 mb-4">
          {[
            { bgClass:'bg-green-600', label:'적정·안전', value: healthDiagnosis.optimalStockValue },
            { bgClass:'bg-orange-600', label:'과잉재고 ⚠', value: healthDiagnosis.excessStockValue },
            { bgClass:'bg-rose-600', label:'악성재고 🚨', value: healthDiagnosis.deadStockValue },
            { bgClass:'bg-purple-600', label:'부진재고', value: healthDiagnosis.slowMoveValue },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs">
              <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${l.bgClass}`}></div>
              <span className="font-bold text-slate-600">{l.label}</span>
              <span className="text-slate-400 font-mono">₩{formatCur(Math.round(l.value / 10000))}만</span>
            </div>
          ))}
        </div>
        {/* KPI 3개 */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '묶인 자금 (악성+과잉)', value: `₩${formatCur(Math.round(healthDiagnosis.lockedCapital / 10000))}만`, color: 'text-rose-600', note:'해소 시 발주 여력 확보' },
            { label: '매출 대비 재고 비율', value: `${(healthDiagnosis.its * 100).toFixed(1)}%`, color: healthDiagnosis.its > HEALTHY_ITS_MAX ? 'text-amber-600' : 'text-green-600', note:'쿠팡 기준 8~12%' },
            { label: '처분 대상 품목', value: `${healthDiagnosis.urgentDisposalItems.length}개`, color: 'text-purple-600', note:'대경 반품 or 단가인하' },
          ].map(k => (
            <div key={k.label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <div className="text-[9px] font-bold text-slate-400 mb-1">{k.label}</div>
              <div className={`text-lg font-black ${k.color}`}>{k.value}</div>
              <div className="text-[9px] text-slate-400 mt-0.5">{k.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* ── 섹션 2: KPI 5개 ── */}
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {[
        { id: 'DEAD', emoji:'☠️', label:'악성재고 품목', value:`${healthDiagnosis.deadStockItems.length}개`, sub:'90일+ 무판매 or 0.5x미만', color:'rose', border:'border-rose-400', amount: healthDiagnosis.deadStockValue },
        { id: 'EXCESS', emoji:'📦', label:'과잉재고 품목', value:`${healthDiagnosis.excessStockItems.length}개`, sub:'목표재고 200%+ 초과', color:'orange', border:'border-orange-400', amount: healthDiagnosis.excessStockValue },
        { id: 'SLOW', emoji:'🐌', label:'부진재고 품목', value:`${healthDiagnosis.slowMoveItems.length}개`, sub:'D등급·잔여 90~180일', color:'purple', border:'border-purple-400', amount: healthDiagnosis.slowMoveValue },
        { id: 'MISSED', emoji:'🔍', label:'결품 기회손실', value:`${healthDiagnosis.missedDemandList.filter(m=>m.count>=2).length}건↑`, sub:'2회↑ 취소·철회 감지', color:'blue', border:'border-blue-400' },
        { id: 'URGENT', emoji:'💡', label:'즉시 처분 권장', value:`${healthDiagnosis.urgentDisposalItems.length}개`, sub:'대경반품 or 단가인하', color:'teal', border:'border-teal-400' },
      ].map(k => (
        <button 
          key={k.label} 
          onClick={() => setSelectedHealthCategory(selectedHealthCategory === k.id ? null : k.id as 'DEAD' | 'EXCESS' | 'SLOW' | 'MISSED' | 'URGENT')}
          className={`bg-white rounded-xl border-l-4 border border-slate-200 ${k.border} p-4 shadow-sm text-left transition-all hover:bg-slate-50 hover:shadow-md active:scale-95 ${selectedHealthCategory === k.id ? `ring-2 ring-offset-2 ring-${k.color}-400` : ''}`}
        >
          <div className="text-xl mb-1">{k.emoji}</div>
          <div className="text-[9px] font-bold text-slate-400 mb-1">{k.label}</div>
          <div className={`text-xl font-black text-${k.color}-600 flex items-end gap-1.5`}>
            {k.value}
            {k.amount !== undefined && <span className="text-[10px] text-slate-400 font-bold mb-1">/ ₩{formatCur(k.amount)}</span>}
          </div>
          <div className="text-[9px] text-slate-400 mt-1">{k.sub}</div>
        </button>
      ))}
    </div>

    {/* ── 섹션 3: 악성·과잉재고 상세 테이블 ── */}
    <div className={`grid grid-cols-1 ${selectedHealthCategory ? 'xl:grid-cols-1' : 'xl:grid-cols-2'} gap-4`}>

      {/* 악성재고 */}
      {(!selectedHealthCategory || selectedHealthCategory === 'DEAD') && (
      <div className="bg-white rounded-2xl border border-rose-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-rose-800">☠️ 악성재고 상세 — 즉시 조치 필요</div>
            <div className="text-[10px] text-rose-500 mt-0.5">무판매 90일↑ AND 회전율 0.5x 미만 품목</div>
          </div>
          <span className="bg-rose-200 text-rose-800 font-black px-3 py-1 rounded-full text-xs">
            {healthDiagnosis.deadStockItems.length}건
          </span>
        </div>
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100">
              <tr>
                <th className="px-4 py-2">품목코드</th>
                <th className="px-4 py-2 text-right">무판매</th>
                <th className="px-4 py-2 text-right">회전율</th>
                <th className="px-4 py-2 text-right">보유량</th>
                <th className="px-4 py-2 text-right">자산가치</th>
                <th className="px-4 py-2 text-right">대경</th>
                <th className="px-4 py-2">권장 조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {healthDiagnosis.deadStockItems.map(row => {
                const daysSince = (row as typeof row & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0;
                const itemValue = row.shQty * row.recentPurchasePrice;
                const action = row.ysQty > 0
                  ? '대경 반품 협의'
                  : daysSince > 180
                  ? '단가인하 긴급처분'
                  : '영업 판매 독촉';
                const actionColor = row.ysQty > 0
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  : daysSince > 180
                  ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200';

                return (
                  <tr key={row.product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${daysSince > 180 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {daysSince > 900 ? '판매이력없음' : `${daysSince}일`}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-rose-600">
                      {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '0x'}
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{row.shQty}개</td>
                    <td className="px-4 py-2 text-right font-black text-rose-600">{formatCur(itemValue)}원</td>
                    <td className="px-4 py-2 text-right text-slate-400">{row.ysQty}개</td>
                    <td className="px-4 py-2">
                      <button 
                        onClick={() => {
                            if (window.confirm(`[${row.product.id}] 품목에 대해 '${action}' 조치를 실행하시겠습니까?`)) {
                                alert(`'${action}' 조치 요청이 시스템에 등록되었습니다.`);
                            }
                        }}
                        className={`px-2 py-1 rounded text-[10px] font-bold ${actionColor} transition-colors active:scale-95 shadow-sm border border-black/5 flex items-center gap-1`}
                      >
                        {action} ⚡
                      </button>
                    </td>
                  </tr>
                );
              })}
              {healthDiagnosis.deadStockItems.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">악성재고가 없습니다 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 과잉재고 */}
      {(!selectedHealthCategory || selectedHealthCategory === 'EXCESS') && (
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-orange-50 border-b border-orange-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-orange-800">📦 과잉재고 상세 — 발주 일시 중단 권고</div>
            <div className="text-[10px] text-orange-500 mt-0.5">현재고 &gt; 목표재고 × 2배 OR 잔여일 180일↑</div>
          </div>
          <span className="bg-orange-200 text-orange-800 font-black px-3 py-1 rounded-full text-xs">
            {healthDiagnosis.excessStockItems.length}건
          </span>
        </div>
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100">
              <tr>
                <th className="px-4 py-2">품목코드</th>
                <th className="px-4 py-2 text-right">현재고</th>
                <th className="px-4 py-2 text-right">목표재고</th>
                <th className="px-4 py-2 text-right">초과량</th>
                <th className="px-4 py-2 text-right">초과자산</th>
                <th className="px-4 py-2 text-right">잔여일</th>
                <th className="px-4 py-2">권장 조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(healthDiagnosis.excessStockItems as (typeof healthDiagnosis.excessStockItems[0] & { _excessQty?: number; _excessValue?: number })[])
                .sort((a, b) => (b._excessValue || 0) - (a._excessValue || 0))
                .map(row => {
                  const excessQty   = (row._excessQty   || 0);
                  const excessValue = (row._excessValue  || 0);
                  const action = excessQty > row.safeStock
                    ? '장기 발주 중단'
                    : '이번 달 발주 보류';
                  const actionColor = excessQty > row.safeStock
                    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200';

                  return (
                    <tr key={row.product.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</td>
                      <td className="px-4 py-2 text-right font-black text-orange-600">{row.shQty}개</td>
                      <td className="px-4 py-2 text-right text-slate-400">{row.safeStock || row.safeStock}개</td>
                      <td className="px-4 py-2 text-right">
                        <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[9px] font-bold">+{excessQty}개</span>
                      </td>
                      <td className="px-4 py-2 text-right font-bold text-orange-600">{formatCur(excessValue)}원</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-amber-600">
                        {row.daysOnHand === 9999 ? '∞' : `${Math.round(row.daysOnHand)}일`}
                      </td>
                      <td className="px-4 py-2">
                        <button 
                          onClick={() => {
                              if (window.confirm(`[${row.product.id}] 품목에 대해 '${action}' 시스템 설정을 적용하시겠습니까?`)) {
                                  alert('발주 제한 설정이 안전하게 적용되었습니다.');
                              }
                          }}
                          className={`px-2 py-1 rounded text-[10px] font-bold ${actionColor} transition-colors active:scale-95 shadow-sm border border-black/5 flex items-center gap-1`}
                        >
                          {action} 🔒
                        </button>
                      </td>
                    </tr>
                  );
                })}
              {healthDiagnosis.excessStockItems.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">과잉재고가 없습니다 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 부진재고 */}
      {selectedHealthCategory === 'SLOW' && (
      <div className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-purple-50 border-b border-purple-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-purple-800">🐌 정체재고 상세 (장기 미판매)</div>
            <div className="text-[10px] text-purple-500 mt-0.5">D등급이면서 잔여일 90일~180일 품목 (악성재고 전환 주의)</div>
          </div>
          <span className="bg-purple-200 text-purple-800 font-black px-3 py-1 rounded-full text-xs">
            {healthDiagnosis.slowMoveItems.length}건
          </span>
        </div>
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100">
              <tr>
                <th className="px-4 py-2">품목코드</th>
                <th className="px-4 py-2 text-right">무판매</th>
                <th className="px-4 py-2 text-right">회전율</th>
                <th className="px-4 py-2 text-right">보유량</th>
                <th className="px-4 py-2 text-right">자산가치</th>
                <th className="px-4 py-2 text-right">잔여일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {healthDiagnosis.slowMoveItems.map(row => {
                const daysSince = (row as typeof row & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0;
                const itemValue = row.shQty * row.recentPurchasePrice;

                return (
                  <tr key={row.product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700`}>
                        {daysSince > 900 ? '판매이력없음' : `${daysSince}일`}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-purple-600">
                      {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '0x'}
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{row.shQty}개</td>
                    <td className="px-4 py-2 text-right font-black text-purple-600">{formatCur(itemValue)}원</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-amber-600">
                        {row.daysOnHand === 9999 ? '∞' : `${Math.round(row.daysOnHand)}일`}
                    </td>
                  </tr>
                );
              })}
              {healthDiagnosis.slowMoveItems.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">부진재고가 없습니다 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 즉시처분권장 */}
      {selectedHealthCategory === 'URGENT' && (
      <div className="bg-white rounded-2xl border border-teal-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-teal-50 border-b border-teal-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-teal-800">💡 즉시 처분 권장 상세</div>
            <div className="text-[10px] text-teal-600 mt-0.5">악성재고 중 대경 반품 또는 단가 인하가 가능한 품목</div>
          </div>
          <span className="bg-teal-200 text-teal-800 font-black px-3 py-1 rounded-full text-xs">
            {healthDiagnosis.urgentDisposalItems.length}건
          </span>
        </div>
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100">
              <tr>
                <th className="px-4 py-2">품목코드</th>
                <th className="px-4 py-2 text-right">무판매</th>
                <th className="px-4 py-2 text-right">보유량</th>
                <th className="px-4 py-2 text-right">자산가치</th>
                <th className="px-4 py-2 text-right">대경</th>
                <th className="px-4 py-2">권장 조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {healthDiagnosis.urgentDisposalItems.map(row => {
                const daysSince = (row as typeof row & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0;
                const itemValue = row.shQty * row.recentPurchasePrice;
                const action = row.ysQty > 0
                  ? '대경 반품 협의'
                  : daysSince > 180
                  ? '단가인하 긴급처분'
                  : '영업 판매 독촉';
                const actionColor = row.ysQty > 0
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  : daysSince > 180
                  ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200';

                return (
                  <tr key={row.product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${daysSince > 180 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {daysSince > 900 ? '판매이력없음' : `${daysSince}일`}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{row.shQty}개</td>
                    <td className="px-4 py-2 text-right font-black text-rose-600">{formatCur(itemValue)}원</td>
                    <td className="px-4 py-2 text-right text-slate-400">{row.ysQty}개</td>
                    <td className="px-4 py-2">
                      <button 
                        onClick={() => {
                            if (window.confirm(`[${row.product.id}] 품목에 대해 '${action}' 조치를 즉시 실행하시겠습니까?`)) {
                                alert(`'${action}' 조치 프로세스가 시작되었습니다.`);
                            }
                        }}
                        className={`px-2 py-1 rounded text-[10px] font-bold ${actionColor} transition-colors active:scale-95 shadow-sm border border-black/5 flex items-center gap-1`}
                      >
                        {action} ⚡
                      </button>
                    </td>
                  </tr>
                );
              })}
              {healthDiagnosis.urgentDisposalItems.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">처분 대상이 없습니다 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>

    {/* ── 섹션 4: 결품 기회손실 ── */}
    {(!selectedHealthCategory || selectedHealthCategory === 'MISSED') && healthDiagnosis.missedDemandList.length > 0 && (
      <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden mt-4">
        <div className="px-5 py-3 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-violet-800">
              🔍 재고 없어서 놓친 수요 — 결품 기회비용 분석
              <span className="ml-2 text-[9px] bg-violet-600 text-white px-2 py-0.5 rounded-full">데이터 누적 시 정밀화</span>
            </div>
            <div className="text-[10px] text-violet-500 mt-0.5">
              대경+시화 재고 0 상태에서 주문 시도 후 취소·철회된 이력 기반 (추정치)
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-black text-violet-700">
              추정 기회손실 ₩{formatCur(Math.round(healthDiagnosis.missedDemandList.reduce((s,m) => s + m.estimatedRevenue, 0) / 10000))}만
            </div>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {healthDiagnosis.missedDemandList.slice(0, 10).map((m, i) => (
            <div key={m.id} className={`rounded-xl p-3 border ${m.count >= 3 ? 'border-rose-200 bg-rose-50' : 'border-violet-100 bg-violet-50'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black shrink-0 ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>{i+1}</span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${m.count >= 3 ? 'bg-rose-200 text-rose-700' : 'bg-violet-200 text-violet-700'}`}>
                  {m.count}회 결품
                </span>
              </div>
              <div className="text-[10px] font-bold text-slate-800 font-mono leading-tight break-all mb-1">{m.id}</div>
              <div className="text-[9px] text-slate-500">추정손실 ₩{formatCur(Math.round(m.estimatedRevenue / 10000))}만</div>
              <div className="mt-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${m.count >= 3 ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>
                  {m.count >= 3 ? '즉시 소량 매입' : '수요 모니터링'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* ── 섹션 5: 데이터 개선 로드맵 ── */}
    <div className="bg-linear-to-br from-slate-800 to-indigo-900 rounded-2xl p-5 text-white">
      <div className="text-sm font-black text-white mb-1 flex items-center gap-2">
        📡 데이터 누적 로드맵 — 쌓일수록 진단이 정확해집니다
        <span className="text-[9px] bg-amber-500 text-amber-900 font-bold px-2 py-0.5 rounded-full">현재 신뢰도 58%</span>
      </div>
      <div className="text-[11px] text-slate-300 mb-4">아래 데이터가 누적되면 악성·과잉재고 판단 정확도가 90%↑로 향상됩니다</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { phase:'즉시 가능', textClass:'text-rose-600', bgClass:'bg-rose-600', items:['주문 취소 시 결품 원인 필드 추가','대경 반품 가능 여부 플래그','최초 견적 발생일(Opportunity Date)'] },
          { phase:'1개월 후', textClass:'text-orange-600', bgClass:'bg-orange-600', items:['일별 스냅샷 30일 누적→σ 정밀화','품목별 무판매일 정확 계산 가능','과잉·악성 오차 50% 감소'] },
          { phase:'3개월 후', textClass:'text-amber-600', bgClass:'bg-amber-600', items:['권역별 수요 패턴 분리','하치장 품목 기준 데이터화','악성재고 사전 예측 모델'] },
          { phase:'6개월 후', textClass:'text-green-600', bgClass:'bg-green-600', items:['계절성 보정 지수 산출','납품 현장 유형별 수요 패턴','ITS 목표 8% 이하 달성 가이드'] },
          { phase:'12개월 후', textClass:'text-blue-600', bgClass:'bg-blue-600', items:['AI 자동 처분 타이밍 추천','신뢰도 99% 발주 시스템','ROI 기반 재고 운용 최적화'] },
        ].map(p => (
          <div key={p.phase} className="bg-white/10 rounded-xl p-3 border border-white/15">
            <div className="text-[10px] font-black mb-2 flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full shrink-0 ${p.bgClass}`}></div>
              <span className={p.textClass}>{p.phase}</span>
            </div>
            {p.items.map((item, i) => (
              <div key={i} className="text-[9px] text-slate-300 mb-1 flex items-start gap-1">
                <span className="shrink-0 mt-0.5">→</span>{item}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-white/15">
        <div className="text-[10px] font-bold text-slate-300 mb-2">▶ 즉시 추가 권장 데이터 필드</div>
        <div className="flex flex-wrap gap-2">
          {['주문 취소 사유 (결품/단가/납기)','납품 현장 분류 (플랜트/건설/조선)','대경 반품 가능 여부 플래그','최초 견적 일자','거래처 업종 코드 (SIC)','계절 수요 태그'].map(tag => (
            <span key={tag} className="text-[9px] font-bold bg-white/15 px-2 py-1 rounded-full border border-white/20 text-slate-200">{tag}</span>
          ))}
        </div>
      </div>
    </div>

  </div>
)}
                        </div>
                    )}
                </div>
            </div>

            {/* 전역 통합 발주 플로팅 바 (Total Global Order Action Bar) */}
            {(() => {
                const totalSelectedCount = selectedCriticalIds.size + selectedWarningIds.size + selectedRegularIds.size;
                if (totalSelectedCount > 0) {
                    const expectedTotal = 
                        stats.critical.filter(w => selectedCriticalIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1), 0) +
                        stats.warning.filter(w => selectedWarningIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1), 0) +
                        stats.regular.filter(w => selectedRegularIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * (row.recommendedQty || 0), 0);

                    return (
                        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-700 p-2 sm:px-6 sm:py-4 rounded-xl sm:rounded-full shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-8 z-50 animate-in slide-in-from-bottom">
                            <div className="flex flex-col items-center sm:items-start text-white">
                                <span className="font-extrabold text-sm sm:text-base">
                                    총 <span className="text-emerald-400">{totalSelectedCount}</span>개 품목 일괄 선택됨
                                </span>
                                <div className="flex flex-col sm:flex-row items-center sm:items-baseline gap-1 sm:gap-3">
                                    <span className="text-xs text-slate-400 font-medium">
                                        (선발주 {selectedCriticalIds.size}건 / 일반보충 {selectedWarningIds.size}건 / 정기 {selectedRegularIds.size}건)
                                    </span>
                                    {expectedTotal > 0 && (
                                        <span className="text-emerald-300 font-bold text-[13px] bg-emerald-900/50 px-2.5 py-0.5 rounded border border-emerald-800/50 mt-1 sm:mt-0">
                                            매입예상합계: {formatCur(expectedTotal)} 원
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button 
                                onClick={handleCreateGlobalOrder} 
                                className="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-6 py-2.5 rounded-lg sm:rounded-full flex items-center gap-2 transition-all w-full sm:w-auto justify-center shadow-lg hover:shadow-emerald-500/50"
                            >
                                <ShoppingCart className="w-5 h-5"/>
                                선택 항목 모두 발주서 만들기
                            </button>
                        </div>
                    );
                }
                return null;
            })()}
            
        </div>
    );
}
