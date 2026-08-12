import { useState, useMemo, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import {
    CalendarDays,
    TrendingUp,
    AlertTriangle,
    PackageSearch,
    History,
    BrainCircuit,
    ChevronDown,
    ChevronRight,
    Activity,
    Info,
    Download,
    ShoppingCart,
    Filter,
    X,
    RefreshCw,
    Pin
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import type { Product, LineItem } from '../../types';
import salesHistoryRaw from '../../data/sales_history.json';
import { COMPETITOR_DATA, getStrategicGrade, type StrategicGrade } from '../../../competitorData';
import { ItemIntelligenceCard } from './components/ItemIntelligenceCard';
import { SearchableMultiSelect } from '../../components/ui/SearchableMultiSelect';

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

export type DkProcurementFilterType = 'ALL' | 'ORDER_NEEDED' | 'RECOMMENDED' | 'DOUBLE_STOCKOUT' | 'SURGING_DEMAND' | 'SIHWA_UNMET' | 'EXCESS' | 'STABLE';

interface DaekyungStockAnalysisItem {
    id: string;
    name: string;
    material: string;
    size?: string;
    thickness?: string;
    currentStock: number;
    avg1m: number;
    avg3m: number;
    avg6m: number;
    share1m: number;
    share3m: number;
    share6m: number;
    trend: number;
    shQty: number;
    safeStock: number;
    recommendedQty: number;
    procurementCategory?: 'DOUBLE_STOCKOUT' | 'SURGING_DEMAND' | 'SIHWA_UNMET' | 'EXCESS' | 'STABLE';
    procurementReason: string;
    isDoubleStockoutWithDemand: boolean;
    isSurgingDemand: boolean;
    isExcessStock?: boolean;
    isDeadStock?: boolean;
}

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
            row.salesFreq >= 10 ? 70 :
                row.salesFreq >= 5 ? 40 :
                    row.salesFreq >= 1 ? 15 : 0;

    const monthlyExpected = row.salesVolume / 12;
    const trendRatio = monthlyExpected > 0 ? (row.recent30dSales / monthlyExpected) : 0;
    const recentTrendScore = Math.min(100,
        trendRatio >= 1.0 ? 100 :
            trendRatio >= 0.5 ? 80 :
                trendRatio >= 0.2 ? 50 :
                    row.recent60dSales > 0 ? 30 : 0
    );

    const quoteDemandScore =
        row.quoteCount >= 3 ? 100 :
            row.quoteCount >= 1 ? 60 : 0;

    const salesVolumeScore =
        row.salesVolume >= 500 ? 100 :
            row.salesVolume >= 200 ? 75 :
                row.salesVolume >= 50 ? 50 :
                    row.salesVolume >= 10 ? 25 : 0;

    const profitScore =
        row.profitMarginRate >= 30 ? 100 :
            row.profitMarginRate >= 20 ? 75 :
                row.profitMarginRate >= 10 ? 50 :
                    row.profitMarginRate >= 0 ? 25 : 0;

    let bonusScore = 0;
    if (row.recent30dSales >= Math.max(10, row.salesVolume / 12 * 1.5)) bonusScore += 15; // 최근 30일 단기 급등
    else if (row.recent60dSales > 0) bonusScore += 5; // 소량이라도 판매 유지 중

    if (row.quoteCount >= 5) bonusScore += 10; // 최근 견적 급증

    const finalScore = Math.round(
        salesFreqScore * 0.25 +
        recentTrendScore * 0.25 +
        quoteDemandScore * 0.20 +
        salesVolumeScore * 0.15 +
        profitScore * 0.15 +
        bonusScore
    );

    return Math.min(100, finalScore);
}

/**
 * 복합 점수 → 건전성 등급 변환
 * A(핵심) ≥65 | B(안정) 45~64 | C(관망) 25~44 | D(부진) 10~24 | E(처분) <10 & 재고있음 | N(평가불가)
 */
function getHealthGradeFromScore(
    score: number,
    effectiveStock: number,
    salesVolume: number,
    quoteCount: number,
    productId: string
): 'A' | 'B' | 'C' | 'D' | 'E' | 'N' {
    if (salesVolume === 0 && quoteCount === 0 && effectiveStock === 0) return 'N';
    if (score >= 70) return 'A';
    if (score >= 50) return 'B';
    if (score >= 30) return 'C';
    if (score >= 15) return 'D';
    if (score < 15 && effectiveStock > 0) {
        const idLower = productId.toLowerCase();
        if (idLower.includes('composite') || idLower.includes('lateral') || idLower.includes('stubend') ||
            idLower.includes('32205') || idLower.includes('stsb-s') || idLower.includes('310-s') || idLower.includes('904l')) {
            return 'D'; // 예외 품목은 악성재고(E)에서 제외
        }
        return 'E';
    }
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

// Helper: Calculate Purchase Price prioritizing actual rates from product if available
const getPurchasePriceForProduct = (product: Product | undefined, id: string, basePrice: number): number => {
    if (product) {
        const rate = product.rate_act2 ?? product.rate_act ?? product.rate_pct ?? 0;
        if (rate > 0) {
            return Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
        }
    }
    return calculateFallbackPurchasePrice(id, basePrice);
};

// ── 재고 건전성 진단 기준 (쿠팡·다이소 물류 기준 참고) ──────────
// Removed unused DEAD_STOCK_DAYS etc.
const HEALTHY_DEAD_RATIO = 0.05;  // 허용 악성재고 비중 (5%)
const HEALTHY_EXCESS_RATIO = 0.10;  // 허용 과잉재고 비중 (10%)
const HEALTHY_ITS_MAX = 0.12;  // 허용 ITS (재고/매출) 상한 12%

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

interface InventoryDiffSubmitItem {
    id: string;
    name: string;
    from: number;
    to: number;
    change: number;
    location: string;
    maker: string;
}

interface PendingDiffItem extends InventoryDiffSubmitItem {
    selected: boolean;
    editedChange: number | '';
}

export default function SihwaInventory() {
    const { orders, quotes, users, user, addItem } = useStore(useShallow(state => ({
        orders: state.orders,
        quotes: state.quotes,
        users: state.users,
        user: state.auth.user,
        addItem: state.addItem
    })));
    const navigate = useNavigate();
    const { inventory, isLoading: invLoading, refresh: refreshInventory } = useInventory();

    const [targetRegion] = useState('시화');
    const [targetMaker] = useState('대경');

    const [historyData, setHistoryData] = useState<{
        inventoryHistory: InventoryHistorySnapshot[];
        daekyungHistory: InventoryHistorySnapshot[];
    }>({ inventoryHistory: [], daekyungHistory: [] });
    const [historyLoading, setHistoryLoading] = useState(true);

    const [searchTerm, setSearchTerm] = useState('');
    const [showGuide, setShowGuide] = useState(false);
    const [sihwaFilterItem, setSihwaFilterItem] = useState<string[]>([]);
    const [sihwaFilterMaterial, setSihwaFilterMaterial] = useState<string[]>([]);
    const [sihwaFilterSize, setSihwaFilterSize] = useState<string[]>([]);
    const [sihwaFilterThickness, setSihwaFilterThickness] = useState<string[]>([]);
    const [pinnedItemIds, setPinnedItemIds] = useState<Set<string>>(new Set());
    const [topPeriod, setTopPeriod] = useState<'7D' | '30D' | '60D' | '90D' | '180D'>('30D');
    const [trendRightTab, setTrendRightTab] = useState<'TOP_SALES' | 'SURGING_DEMAND'>('TOP_SALES');
    const [selectedDkIds, setSelectedDkIds] = useState<Set<string>>(new Set());

    const [activeTab, setActiveTab] = useState<'AI_SUMMARY' | 'TOTAL_DASHBOARD' | 'ALL_TABLE' | 'HEALTH_DIAGNOSIS' | 'DAEKYUNG_STOCK'>('AI_SUMMARY');
    const [dkSortConfig, setDkSortConfig] = useState<{
        key: 'id' | 'name' | 'material' | 'size' | 'currentStock' | 'avg1m' | 'avg3m' | 'avg6m' | 'share1m' | 'share3m' | 'share6m' | 'trend' | 'shQty' | 'safeStock' | 'recommendedQty' | 'procurementReason';
        direction: 'asc' | 'desc';
    }>({ key: 'id', direction: 'asc' });
    const [dkSearchQuery, setDkSearchQuery] = useState('');
    const [dkFilterItem, setDkFilterItem] = useState('');
    const [dkFilterMaterial, setDkFilterMaterial] = useState('');
    const [dkFilterSize, setDkFilterSize] = useState('');
    const [dkFilterProcurement, setDkFilterProcurement] = useState<DkProcurementFilterType>('ORDER_NEEDED');
    const [dkViewMode, setDkViewMode] = useState<'ITEM' | 'MATERIAL'>('ITEM');
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        'CRITICAL': true,
        'SURGING': true,
        'WARNING': true,
        'REGULAR': true
    });
    const [selectedHealthCategory, setSelectedHealthCategory] = useState<'DEAD' | 'EXCESS' | 'SLOW' | 'MISSED' | 'URGENT' | null>(null);

    // 결품 기회손실 관련 상태 추가
    const [mdSearchQuery, setMdSearchQuery] = useState('');
    const [mdFilterName, setMdFilterName] = useState('');
    const [mdFilterThickness, setMdFilterThickness] = useState('');
    const [mdFilterSize, setMdFilterSize] = useState('');
    const [mdFilterMaterial, setMdFilterMaterial] = useState('');
    const [mdSortConfig, setMdSortConfig] = useState<{
        key: 'id' | 'name' | 'count' | 'estimatedRevenue' | 'material' | 'thickness' | 'size';
        direction: 'asc' | 'desc';
    }>({ key: 'count', direction: 'desc' });
    const [selectedMissedDemandIds, setSelectedMissedDemandIds] = useState<Set<string>>(new Set());
    const [mdViewLayout, setMdViewLayout] = useState<'TABLE' | 'CARD'>('TABLE');
    const [mdPeriod, setMdPeriod] = useState<'ALL' | '7D' | '30D' | '60D'>('ALL');
    const [expandedMdRowIds, setExpandedMdRowIds] = useState<Set<string>>(new Set());
    const [mdRowQtys, setMdRowQtys] = useState<Record<string, number>>({});



    const [selectedCriticalIds, setSelectedCriticalIds] = useState<Set<string>>(new Set());
    const [selectedWarningIds, setSelectedWarningIds] = useState<Set<string>>(new Set());
    const [selectedRegularIds, setSelectedRegularIds] = useState<Set<string>>(new Set());
    const [selectedAllTableIds, setSelectedAllTableIds] = useState<Set<string>>(new Set());

    const [selectedIntelligenceItem, setSelectedIntelligenceItem] = useState<{ product: { id: string, name?: string }, [key: string]: unknown } | null>(null);

    const [expandedTrendItems, setExpandedTrendItems] = useState<Record<string, boolean>>({});
    const [expandedDailyGroups, setExpandedDailyGroups] = useState<Record<string, boolean>>({});

    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [pendingDate, setPendingDate] = useState('');
    const [pendingSihwaList, setPendingSihwaList] = useState<PendingDiffItem[]>([]);
    const [submittingConfirm, setSubmittingConfirm] = useState(false);

    const [sortConfig, setSortConfig] = useState<{
        key: 'id' | 'salesFreq' | 'salesVolume' | 'deficit' | 'shQty' | 'ysQty' | 'pendingOrderQty' | 'recentPurchasePrice' | 'turnoverRate' | 'daysOnHand' | 'safeStock' | 'healthGrade' | 'statusRank' | 'quoteCount' | 'recent60dOrderCount',
        direction: 'asc' | 'desc'
    }>({ key: 'deficit', direction: 'desc' });

    const handleSort = (key: 'id' | 'salesFreq' | 'salesVolume' | 'deficit' | 'shQty' | 'ysQty' | 'pendingOrderQty' | 'recentPurchasePrice' | 'turnoverRate' | 'daysOnHand' | 'safeStock' | 'healthGrade' | 'statusRank' | 'quoteCount' | 'recent60dOrderCount') => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
    const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);

    const toggleTagFilter = (tag: string) => {
        setActiveTagFilters(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
        );
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
            setSelectedWarningIds(new Set(stats.warning.map(w => w?.product?.id).filter((id): id is string => Boolean(id))));
        }
    };

    // 1. Fetch History Data from the local-api-server (MUST WAIT FOR INVENTORY TO FINISH DIFFING)
    const fetchHistory = useCallback(async () => {
        try {
            setHistoryLoading(true);
            const token = useStore.getState().auth.token;
            const headers: Record<string, string> = { 'x-requester-role': 'admin' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/admin/inventory-history', {
                headers
            });
            if (res.ok) {
                const data = await res.json();
                const ignoreDates = [
                    '2026-04-14', '2026-04-15', '2026-04-16',
                    '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'
                ];
                if (data.inventoryHistory) {
                    const filteredHistory = data.inventoryHistory.filter((h: { date: string }) => !ignoreDates.includes(h.date));
                    const filteredDkHistory = (data.daekyungHistory || []).filter((h: { date: string }) => !ignoreDates.includes(h.date));
                    setHistoryData({ 
                        inventoryHistory: filteredHistory, 
                        daekyungHistory: filteredDkHistory 
                    });
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
    }, []);

    useEffect(() => {
        if (invLoading) return; // Wait until inventory fetch completes (which triggers backend snapshot ledger)
        fetchHistory();
    }, [invLoading, fetchHistory]);

    // 1.5 Fetch Orders to sync with inventory
    const setOrders = useStore(state => state.setOrders);
    const setQuotes = useStore(state => state.setQuotes);
    const fetchUsers = useStore(state => state.fetchUsers);
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

        const fetchQuotes = () => {
            fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/quotations?limit=2000`, { headers, cache: 'no-store' })
                .then(res => {
                    if (res.ok) return res.json();
                    throw new Error('Failed to fetch quotes');
                })
                .then(data => {
                    if (Array.isArray(data)) setQuotes(data);
                })
                .catch(console.error);
        };

        fetchOrders();
        fetchQuotes();
        fetchUsers();
    }, [setOrders, setQuotes, fetchUsers, user]);

    const handleDataRefresh = async () => {
        try {
            if (refreshInventory) await refreshInventory();
            
            // 2. Fetch pending diffs from backend
            const token = useStore.getState().auth.token;
            const headers: Record<string, string> = { 'x-requester-role': 'admin' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/admin/inventory-history/pending', {
                headers
            });
            if (res.ok) {
                const data = await res.json();
                if (data.sihwaPending && data.sihwaPending.length > 0) {
                    setPendingDate(data.date);
                    // Add selected & editedChange fields
                    setPendingSihwaList(data.sihwaPending.map((x: { id: string; name: string; from: number; to: number; change: number; location: string; maker: string }) => ({ ...x, selected: true, editedChange: x.change })));
                    setIsConfirmModalOpen(true);
                } else {
                    alert('새로운 재고 변동 사항이 감지되지 않았습니다.');
                    await fetchHistory();
                }
            } else {
                await fetchHistory();
            }
        } catch (err) {
            console.error('Failed during data refresh:', err);
            await fetchHistory();
        }
    };

    const handleSaveConfirmedHistory = async () => {
        try {
            setSubmittingConfirm(true);
            const token = useStore.getState().auth.token;
            const headers: Record<string, string> = { 
                'Content-Type': 'application/json',
                'x-requester-role': 'admin' 
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // Filter out non-selected items and map editedChange to final values
            const finalSihwaDiffs = pendingSihwaList
                .filter(x => x.selected && Number(x.editedChange) !== 0)
                .map(x => {
                    const chg = Number(x.editedChange);
                    return {
                        id: x.id,
                        name: x.name,
                        from: x.from,
                        to: x.from + chg,
                        change: chg,
                        location: x.location,
                        maker: x.maker
                    };
                });

            const finalDaekyungDiffs: InventoryDiffSubmitItem[] = [];

            const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/admin/inventory-history/confirm', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    date: pendingDate,
                    sihwaDiffs: finalSihwaDiffs,
                    daekyungDiffs: finalDaekyungDiffs
                })
            });

            if (res.ok) {
                alert('일일 변동 트렌드가 성공적으로 저장되었습니다.');
                setIsConfirmModalOpen(false);
                await fetchHistory();
            } else {
                const errData = await res.json();
                alert(`저장 실패: ${errData.error || '알 수 없는 오류'}`);
            }
        } catch (err) {
            console.error('Failed to save confirmed history:', err);
            alert('오류가 발생하여 저장하지 못했습니다.');
        } finally {
            setSubmittingConfirm(false);
        }
    };

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

    const groupedDailyTrend = useMemo(() => {
        const groups: Record<string, { date: string, items: Record<string, { product: Product, incoming: number, outgoing: number }> }> = {};

        [...historyData.inventoryHistory].forEach(snap => {
            const date = snap.date.split('T')[0]; // Ensure it's just YYYY-MM-DD
            if (!groups[date]) {
                groups[date] = { date, items: {} };
            }

            (snap.diff || []).forEach(d => {
                const product = inventoryMap.get(d.id);
                if (!product) return;

                const isMatch = (!searchTerm || product.id.toLowerCase().includes(searchTerm.toLowerCase()) || (product.name && product.name.toLowerCase().includes(searchTerm.toLowerCase())))
                    && (sihwaFilterItem.length === 0 || sihwaFilterItem.includes(product.name || ''))
                    && (sihwaFilterMaterial.length === 0 || sihwaFilterMaterial.includes(product.material || ''))
                    && (sihwaFilterSize.length === 0 || sihwaFilterSize.includes(product.size || ''))
                    && (sihwaFilterThickness.length === 0 || sihwaFilterThickness.includes(product.thickness || ''));
                if (!isMatch) return;

                const locStr = product.location || product.location1 || '';
                const locStock = product.locationStock || {};
                const isTargetLocation = locStr.includes(targetRegion) || locStock[targetRegion] !== undefined;
                const isTargetMaker = product.maker === targetMaker || product.maker1 === targetMaker;

                if (isTargetLocation && isTargetMaker) {
                    if (!groups[date].items[d.id]) {
                        groups[date].items[d.id] = { product: product as Product, incoming: 0, outgoing: 0 };
                    }
                    if (d.change > 0) {
                        groups[date].items[d.id].incoming += d.change;
                    } else if (d.change < 0) {
                        groups[date].items[d.id].outgoing += Math.abs(d.change);
                    }
                }
            });
        });

        return Object.values(groups)
            .filter(g => Object.keys(g.items).length > 0)
            .sort((a, b) => b.date.localeCompare(a.date));
    }, [historyData.inventoryHistory, inventoryMap, targetRegion, targetMaker, searchTerm, sihwaFilterItem, sihwaFilterMaterial, sihwaFilterSize, sihwaFilterThickness]);

    const monthData = useMemo(() => {
        const monthlyOrders = sihwaOrders.filter(o => new Date(o.createdAt).toISOString().slice(0, 7) === selectedMonth);

        let completedCost = 0;
        let completedCount = 0;

        monthlyOrders.forEach(o => {
            const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;

            items.forEach(item => {
                const id = item.productId || (item as { item_id?: string }).item_id || '';
                const product = inventoryMap.get(id);

                if (product) {
                    const isMatch = (!searchTerm || product.id.toLowerCase().includes(searchTerm.toLowerCase()) || (product.name && product.name.toLowerCase().includes(searchTerm.toLowerCase())))
                        && (sihwaFilterItem.length === 0 || sihwaFilterItem.includes(product.name || ''))
                        && (sihwaFilterMaterial.length === 0 || sihwaFilterMaterial.includes(product.material || ''))
                        && (sihwaFilterSize.length === 0 || sihwaFilterSize.includes(product.size || ''))
                        && (sihwaFilterThickness.length === 0 || sihwaFilterThickness.includes(product.thickness || ''));
                    if (!isMatch) return;
                } else {
                    const isMatch = !searchTerm || id.toLowerCase().includes(searchTerm.toLowerCase()) || (item.name && item.name.toLowerCase().includes(searchTerm.toLowerCase()));
                    if (!isMatch || sihwaFilterItem.length > 0 || sihwaFilterMaterial.length > 0 || sihwaFilterSize.length > 0 || sihwaFilterThickness.length > 0) return;
                }

                if (o.status === 'COMPLETED' || item.transactionIssued) {
                    const basePrice = item.base_price ?? product?.base_price ?? product?.unitPrice ?? 0;
                    let cost = 0;
                    if (item.supplierRate !== undefined) {
                        cost = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                    } else if (product) {
                        const rate = product.rate_act2 ?? product.rate_act ?? product.rate_pct ?? 0;
                        cost = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                    }
                    const itemQty = Number(item.quantity ?? item.qty ?? 0);
                    completedCost += (cost * itemQty);
                }
            });

            if (o.status === 'COMPLETED' || (items.length > 0 && items.every(i => i.transactionIssued))) {
                completedCount++;
            }
        });

        // Pending cost and count should reflect ALL outstanding orders, not just the selected month.
        let pendingCost = 0;
        let pendingCount = 0;

        sihwaOrders.forEach(o => {
            const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;
            const isOrderFullyCompleted = o.status === 'COMPLETED' || (items.length > 0 && items.every(i => i.transactionIssued));

            if (!isOrderFullyCompleted) {
                pendingCount++;
                items.forEach(item => {
                    const id = item.productId || (item as { item_id?: string }).item_id || '';
                    const product = inventoryMap.get(id);

                    if (product) {
                        const isMatch = (!searchTerm || product.id.toLowerCase().includes(searchTerm.toLowerCase()) || (product.name && product.name.toLowerCase().includes(searchTerm.toLowerCase())))
                            && (sihwaFilterItem.length === 0 || sihwaFilterItem.includes(product.name || ''))
                            && (sihwaFilterMaterial.length === 0 || sihwaFilterMaterial.includes(product.material || ''))
                            && (sihwaFilterSize.length === 0 || sihwaFilterSize.includes(product.size || ''))
                            && (sihwaFilterThickness.length === 0 || sihwaFilterThickness.includes(product.thickness || ''));
                        if (!isMatch) return;
                    } else {
                        const isMatch = !searchTerm || id.toLowerCase().includes(searchTerm.toLowerCase()) || (item.name && item.name.toLowerCase().includes(searchTerm.toLowerCase()));
                        if (!isMatch || sihwaFilterItem.length > 0 || sihwaFilterMaterial.length > 0 || sihwaFilterSize.length > 0 || sihwaFilterThickness.length > 0) return;
                    }

                    if (o.status !== 'COMPLETED' && !item.transactionIssued) {
                        const basePrice = item.base_price ?? product?.base_price ?? product?.unitPrice ?? 0;
                        let cost = 0;
                        if (item.supplierRate !== undefined) {
                            cost = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                        } else if (product) {
                            const rate = product.rate_act2 ?? product.rate_act ?? product.rate_pct ?? 0;
                            cost = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                        }
                        const itemQty = Number(item.quantity ?? item.qty ?? 0);
                        pendingCost += (cost * itemQty);
                    }
                });
            }
        });

        return { completedCost, pendingCost, completedCount, pendingCount, orders: monthlyOrders };
    }, [sihwaOrders, selectedMonth, inventoryMap, searchTerm, sihwaFilterItem, sihwaFilterMaterial, sihwaFilterSize, sihwaFilterThickness]);

    // Extract recent actual Purchase price from Seoul orders
    const recentSeoulPurchaseInfoMap = useMemo(() => {
        const pMap: Record<string, { price: number; date: string }> = {};
        const sortedOrders = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        for (const order of sortedOrders) {
            if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) continue;

            const displayCustomer = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase();
            const normalizedCustomer = displayCustomer.replace(/\s+/g, '');
            const isSeoulStock = normalizedCustomer.includes('재고') ||
                normalizedCustomer.includes('서울') ||
                normalizedCustomer.includes('시화') ||
                normalizedCustomer.includes('에스제이엔브이') ||
                normalizedCustomer.includes('sjnv') ||
                normalizedCustomer.includes('알트에프') ||
                normalizedCustomer.includes('altf');

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
                        const product = inventoryMap.get(id);
                        cost = getPurchasePriceForProduct(product as Product | undefined, id, rawBasePrice);
                    }

                    if (cost > 0) {
                        pMap[id] = { price: cost, date: new Date(order.createdAt).toISOString().split('T')[0] };
                    }
                }
            }
        }
        return pMap;
    }, [orders, inventoryMap]);

    // CORE AI MERGED STOCK ANALYZER (Includes pending orders + actual asset prices)
    interface AnalyzedItem {
        product: Partial<Product> & { id: string; name?: string; stockStatus?: string };
        shQty: number;
        ysQty: number;
        pendingOrderQty: number;
        pendingOrderDetails?: {
            poNumber: string;
            qty: number;
            deliveryDate?: string;
            createdAt: string;
        }[];
        recentPurchasePrice: number;
        recentPurchaseDate: string | null;
        sellingPrice: number;
        salesVolume: number;
        salesFreq: number;
        recent7dSales: number;
        recent30dSales: number;
        recent60dSales: number;
        recent90dSales: number;
        recent180dSales: number;
        quoteCount: number;
        recent60dOrderCount: number;
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
        deficit: number;
        suggestedCriticalQty?: number;
        effectiveStock: number;
        statusCategory: string;
        statusLabel: string;
        isDeadStock?: boolean;
        isExcessStock?: boolean;
        isSurgingDemand?: boolean;
        surgeReason?: string;
    }

    // Dynamically calculate Real-Time Sales History combining static base ERP data and real-time orders
    const liveSalesHistory = useMemo(() => {
        const base = JSON.parse(JSON.stringify(salesHistory)) as Record<string, { salesVolume: number, salesFreq: number }>;

        orders.forEach(order => {
            if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) return;
            if (order.status !== 'COMPLETED') return;

            const customerStr = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase().replace(/\s+/g, '');
            // Exclude internal stock transfers
            if (customerStr.includes('재고') || customerStr.includes('서울') || customerStr.includes('시화') || customerStr.includes('알트에프') || customerStr.includes('altf')) return;

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

    const userMap = useMemo(() => {
        const map = new Map<string, typeof users[0]>();
        users.forEach(u => map.set(u.id, u));
        return map;
    }, [users]);

    // ── 대경재고(양산) 평균 보유수량 분석 (3개월, 6개월) ──
    const daekyungBaseStockAverages = useMemo(() => {
        const dates: string[] = [];
        const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
        for (let i = 0; i < 180; i++) {
            const d = new Date(kstNow.getTime() - i * 24 * 60 * 60 * 1000);
            dates.push(d.toISOString().slice(0, 10));
        }

        const targetProductsMap = new Map<string, Product>();
        inventory.forEach(item => {
            if (!item.id) return;
            if (!targetProductsMap.has(item.id)) {
                targetProductsMap.set(item.id, { ...item });
            } else {
                const existing = targetProductsMap.get(item.id)!;
                if (item.locationStock) {
                    existing.locationStock = {
                        ...(existing.locationStock || {}),
                        ...item.locationStock
                    };
                }
            }
        });
        const targetProducts = Array.from(targetProductsMap.values());

        const historyMapByDate: Record<string, Record<string, number>> = {};
        (historyData.daekyungHistory || []).forEach(h => {
            const dateStr = h.date.split('T')[0];
            const dateMap: Record<string, number> = {};
            (h.diff || []).forEach((d: { id: string; change: number }) => {
                dateMap[d.id] = d.change;
            });
            historyMapByDate[dateStr] = dateMap;
        });

        const rawResults = targetProducts.map((item: Product) => {
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

            const stocks3m = dailyStocks.slice(0, 90);
            const sum3m = stocks3m.reduce((s, val) => s + val, 0);
            const avg3m = stocks3m.length > 0 ? parseFloat((sum3m / stocks3m.length).toFixed(1)) : ysQty;

            const stocks6m = dailyStocks;
            const sum6m = stocks6m.reduce((s, val) => s + val, 0);
            const avg6m = stocks6m.length > 0 ? parseFloat((sum6m / stocks6m.length).toFixed(1)) : ysQty;

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
            };
        });

        const total1m = rawResults.reduce((s, r) => s + r.avg1m, 0);
        const total3m = rawResults.reduce((s, r) => s + r.avg3m, 0);
        const total6m = rawResults.reduce((s, r) => s + r.avg6m, 0);

        return rawResults.map(r => {
            const share1m = total1m > 0 ? parseFloat(((r.avg1m / total1m) * 100).toFixed(2)) : 0;
            const share3m = total3m > 0 ? parseFloat(((r.avg3m / total3m) * 100).toFixed(2)) : 0;
            const share6m = total6m > 0 ? parseFloat(((r.avg6m / total6m) * 100).toFixed(2)) : 0;
            const trend = r.avg6m > 0 ? parseFloat((((r.avg3m - r.avg6m) / r.avg6m) * 100).toFixed(1)) : (r.avg3m > 0 ? 100 : 0);

            return {
                ...r,
                share1m,
                share3m,
                share6m,
                trend,
            };
        });
    }, [inventory, historyData.daekyungHistory]);

    const daekyungStockMap = useMemo(() => {
        const map = new Map<string, { currentStock: number; avg1m: number; avg3m: number; avg6m: number }>();
        daekyungBaseStockAverages.forEach(item => {
            map.set(item.id, { currentStock: item.currentStock, avg1m: item.avg1m, avg3m: item.avg3m, avg6m: item.avg6m });
        });
        return map;
    }, [daekyungBaseStockAverages]);

    const baseAnalyzedInventory = useMemo(() => {
        const comparisonMap: Record<string, AnalyzedItem> = {};

        const nowTime = Date.now();
        const thirtyDaysAgo = nowTime - (30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = nowTime - (60 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = nowTime - (7 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = nowTime - (90 * 24 * 60 * 60 * 1000);
        const oneEightyDaysAgo = nowTime - (180 * 24 * 60 * 60 * 1000);

        const recentSalesMap: Record<string, { recent7d: number, recent30d: number, recent60d: number, recent90d: number, recent180d: number }> = {};
        historyData.inventoryHistory.forEach((snap: InventoryHistorySnapshot) => {
            const snapDate = new Date(snap.date).getTime();
            if (isNaN(snapDate)) return;
            const isWithin7d = snapDate >= sevenDaysAgo;
            const isWithin30d = snapDate >= thirtyDaysAgo;
            const isWithin60d = snapDate >= sixtyDaysAgo;
            const isWithin90d = snapDate >= ninetyDaysAgo;
            const isWithin180d = snapDate >= oneEightyDaysAgo;

            if (isWithin180d && snap.diff) {
                snap.diff.forEach((d: InventoryDiffItem) => {
                    if (d.change < 0) {
                        const absChg = Math.abs(d.change);
                        if (!recentSalesMap[d.id]) recentSalesMap[d.id] = { recent7d: 0, recent30d: 0, recent60d: 0, recent90d: 0, recent180d: 0 };
                        recentSalesMap[d.id].recent180d += absChg;
                        if (isWithin90d) {
                            recentSalesMap[d.id].recent90d += absChg;
                        }
                        if (isWithin60d) {
                            recentSalesMap[d.id].recent60d += absChg;
                        }
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

            const quoteUser = userMap.get(quote.userId);
            const customerStr = (quote.customerName || quote.customerInfo?.companyName || quote.customerInfo?.contactName || quoteUser?.companyName || '').toLowerCase().replace(/\s+/g, '');
            if (customerStr.includes('재고') || customerStr.includes('서울') || customerStr.includes('시화') || customerStr.includes('알트에프') || customerStr.includes('altf')) return;

            quote.items.forEach(item => {
                const id = item.productId || (item as { item_id?: string }).item_id;
                if (!id) return;
                quoteCountMap[id] = (quoteCountMap[id] || 0) + 1;
            });
        });

        const recent60dOrderCountMap: Record<string, number> = {};
        orders.forEach(order => {
            if (['CANCELLED', 'WITHDRAWN'].includes(order.status) || order.isDeleted) return;
            if (order.status !== 'COMPLETED') return;

            const orderDate = new Date(order.createdAt).getTime();
            if (isNaN(orderDate) || orderDate < sixtyDaysAgo) return;

            const customerStr = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase().replace(/\s+/g, '');
            if (customerStr.includes('재고') || customerStr.includes('서울') || customerStr.includes('시화') || customerStr.includes('알트에프') || customerStr.includes('altf')) return;

            const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            if (!items) return;

            items.forEach((item: Partial<LineItem> & { item_id?: string; qty?: number }) => {
                const id = item.productId || item.item_id;
                if (!id) return;
                const qty = Number(item.quantity ?? item.qty ?? 0);
                if (qty <= 0) return;
                recent60dOrderCountMap[id] = (recent60dOrderCountMap[id] || 0) + 1;
            });
        });

        inventory.forEach((item: Product) => {
            let shQty = 0;
            let ysQty = 0;

            if (item.locationStock) {
                if (item.locationStock['시화'] !== undefined) shQty += Number(item.locationStock['시화']);
                if (item.locationStock['서울'] !== undefined) shQty += Number(item.locationStock['서울']);
                // Restore Yangsan inventory into ysQty to ensure "대경재고" column accurately reflects factory stock
                // and matches Quote/Order system numbers.
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
            const recentSales = recentSalesMap[item.id] || { recent7d: 0, recent30d: 0, recent60d: 0, recent90d: 0, recent180d: 0 };

            // Calculate Profit Margin
            const sellingPrice = calculateSellingPrice(item.id, basePrice);
            const purchasePrice = recentInfo ? recentInfo.price : getPurchasePriceForProduct(item, item.id, basePrice);
            const profitMarginRate = sellingPrice > 0 ? parseFloat((((sellingPrice - purchasePrice) / sellingPrice) * 100).toFixed(1)) : 0;

            // Calculate Daekyung Direct Ratio (estimated from total sales vs sihwa drops)
            // If total sales is 100, but Sihwa dropped by 20, 80 were direct dropped (80%).
            const total60dSales = salesData.salesVolume; // Actually, salesVolume is all-time from orders. We'll approximate.
            const daekyungDirectRatio = (total60dSales > 0 && total60dSales > recentSales.recent60d)
                ? parseFloat((((total60dSales - recentSales.recent60d) / total60dSales) * 100).toFixed(1))
                : 0;

            // Populate items (if it has stock or sales data, we analyze it)
            if (shQty > 0 || ysQty > 0 || salesData.salesVolume > 0 || recentSales.recent30d > 0 || compData.compSales > 0) {
                if (comparisonMap[item.id]) {
                    comparisonMap[item.id].shQty += shQty;
                    comparisonMap[item.id].ysQty += ysQty;
                } else {
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
                    recent90dSales: recentSales.recent90d,
                    recent180dSales: recentSales.recent180d,
                    quoteCount: quoteCountMap[item.id] || 0,
                    recent60dOrderCount: recent60dOrderCountMap[item.id] || 0,
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
                    deficit: 0,
                    effectiveStock: 0,
                    statusCategory: 'IDLE',
                    statusLabel: '대기/데이터없음'
                };
            }
        }
    });

        // Add Pending Order quantities bounded for Sihwa
        sihwaOrders.filter(o => o.status !== 'COMPLETED').forEach(order => {
            const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            items.forEach(item => {
                if (item.transactionIssued) return;

                const nameLower = (item.name || (item as { item_name?: string }).item_name || '').toLowerCase().trim();
                const isDcOrFreight = nameLower === 'd/c' || nameLower === 'dc' || nameLower.includes('운임') || nameLower.includes('배송') || nameLower.includes('freight') || nameLower.includes('shipping') || nameLower.includes('discount') || nameLower.includes('할인');
                if (isDcOrFreight) return;

                const id = item.productId || (item as { item_id?: string }).item_id || 'UNKNOWN';
                const addQty = Number(item.quantity ?? item.qty ?? 0);

                let rawBasePrice = item.base_price ?? item.unitPrice ?? 0;
                const product = inventoryMap.get(id);
                if (product) rawBasePrice = item.base_price ?? product.base_price ?? product.unitPrice ?? 0;

                const detail = {
                    poNumber: order.poNumber || order.id || '번호없음',
                    qty: addQty,
                    deliveryDate: order.adminResponse?.deliveryDate,
                    createdAt: order.createdAt
                };

                if (!comparisonMap[id]) {
                    const finalSellingPrice = calculateSellingPrice(id, rawBasePrice);
                    const recentInfo = recentSeoulPurchaseInfoMap[id];

                    const salesData = liveSalesHistory[id] || { salesVolume: 0, salesFreq: 0 };
                    const compData = COMPETITOR_DATA[id] || { compSales: 0, compFreq: 0 };
                    const marketTotal = salesData.salesVolume + compData.compSales;
                    const marketShare = marketTotal > 0 ? parseFloat(((salesData.salesVolume / marketTotal) * 100).toFixed(1)) : 0;

                    const recentSales = recentSalesMap[id] || { recent7d: 0, recent30d: 0, recent60d: 0, recent90d: 0, recent180d: 0 };
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
                        pendingOrderDetails: [detail],
                        recentPurchasePrice: purchasePrice,
                        recentPurchaseDate: recentInfo ? recentInfo.date : null,
                        sellingPrice: finalSellingPrice,
                        salesVolume: salesData.salesVolume,
                        salesFreq: salesData.salesFreq,
                        recent7dSales: recentSales.recent7d,
                        recent30dSales: recentSales.recent30d,
                        recent60dSales: recentSales.recent60d,
                        recent90dSales: recentSales.recent90d,
                        recent180dSales: recentSales.recent180d,
                        quoteCount: quoteCountMap[id] || 0,
                        recent60dOrderCount: recent60dOrderCountMap[id] || 0,
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
                        deficit: 0,
                        effectiveStock: 0,
                        statusCategory: 'IDLE',
                        statusLabel: '대기/데이터없음'
                    };
                } else {
                    comparisonMap[id].pendingOrderQty += addQty;
                    if (!comparisonMap[id].pendingOrderDetails) {
                        comparisonMap[id].pendingOrderDetails = [];
                    }
                    comparisonMap[id].pendingOrderDetails!.push(detail);
                }
            });
        });

        // Step 3: Run AI Rules for status computation
        const processedList = Object.values(comparisonMap).map(row => {
            // REQUIREMENT 3: INCLUDE PENDING ORDERS as effective stock
            const effectiveStock = row.shQty + row.pendingOrderQty;

            // === 신규 건전성 등급 평가 로직 (100점 만점 복합 점수제) ===
            const compositeScore = calcCompositeScore({
                salesFreq: row.salesFreq,
                salesVolume: row.salesVolume,
                recent30dSales: row.recent30dSales,
                recent60dSales: row.recent60dSales,
                quoteCount: row.quoteCount,
                profitMarginRate: row.profitMarginRate,
            });

            const healthGrade = getHealthGradeFromScore(
                compositeScore,
                effectiveStock,
                row.salesVolume,
                row.quoteCount,
                row.product.id
            );

            // 통계 기반 기초 계산 (σ)
            const dailyAvgSales = row.salesVolume / WORKING_DAYS;

            // 시화의 실제 평균 출고량 추정 (최근 60일 시화 출고량 기준)
            const sihwaDailySales = row.recent60dSales > 0 ? (row.recent60dSales / 40) : (dailyAvgSales * 0.2); // 출고 없으면 연간의 20%만 잡음

            const cvEstimate = row.salesFreq >= 100 ? 0.20 : row.salesFreq >= 50 ? 0.30 : row.salesFreq >= 20 ? 0.40 : 0.50;
            // 안전재고(버퍼)는 시화 실판매량 기준으로 계산
            const sigma = sihwaDailySales * cvEstimate;
            const safetyStockSigma = Math.ceil(Z_VALUE * sigma * Math.sqrt(LEAD_TIME));
            const reorderPoint = Math.ceil(sihwaDailySales * LEAD_TIME + safetyStockSigma);

            // 1. 기초 안전재고 축소: 안전재고 + 20일치 평균 (약 1개월)
            let safeStock = safetyStockSigma + Math.ceil(sihwaDailySales * 20);

            // 2. 최대 발주 상한선 캡 (시화에서 한 번에 나가는 물량은 보통 200~300개를 넘지 않으므로 최대 500개 캡, 단, 월판매량이 아주 큰 경우는 2개월치 허용)
            const absoluteMax = Math.max(500, Math.ceil(sihwaDailySales * 40));
            safeStock = Math.min(safeStock, absoluteMax);

            // 3. 주문 횟수(Freq) 및 견적(Quote) 기반 제한
            if (row.salesFreq < 12 && row.quoteCount < 2) {
                safeStock = Math.min(safeStock, Math.ceil(sihwaDailySales * 10)); // 최대 2주 치
            }
            if (row.salesVolume < 50 && row.salesFreq < 5) {
                safeStock = 0; // 극소량, 극저빈도 품목은 재고 미보유
            }

            // 3.5. 대경 직발주 비중이 압도적으로 높고 시화 출고가 없는 경우, 기초 재고 10개 강제 보류 해제
            const isMostlyDropShipped = row.recent60dOrderCount > 0 && row.recent60dSales === 0;

            if (isMostlyDropShipped) {
                safeStock = safeStock > 0 ? Math.round(safeStock / 10) * 10 : 0;
            } else {
                safeStock = safeStock > 0 ? Math.max(10, Math.round(safeStock / 10) * 10) : 0;
            }

            // 4. 대경 재고(ysQty) 기반 페널티는 여기서 제외합니다. 
            // 목표재고(safeStock) 자체를 깎아버리면 정상적인 재고가 '과잉'으로 오탐지되므로,
            // 대경 재고가 많을 때 발주를 막는 로직은 하단의 '정기발주' 계산에서만 처리합니다.

            // 4.5. 최근 60일 실적(트렌드) 기반 동적 페널티
            // 수요 급감 시 적정재고 삭감. 단, 연간 판매빈도/수량이 높거나 대경재고가 넉넉할 때는 덜 삭감함.
            if (row.salesVolume > 0 && row.recent60dSales === 0 && row.quoteCount === 0 && row.recent60dOrderCount === 0) {
                if ((row.salesFreq >= 30 && row.salesVolume >= 100) || row.ysQty >= 500) {
                    safeStock = Math.round((safeStock * 0.4) / 10) * 10; // 60% 삭감
                } else {
                    safeStock = Math.round((safeStock * 0.2) / 10) * 10; // 80% 삭감
                }
            } else if (row.salesVolume > 0 && row.recent60dSales <= Math.ceil((row.salesVolume / 12) * 0.5) && row.quoteCount === 0) {
                safeStock = Math.round((safeStock * 0.5) / 10) * 10; // 50% 삭감
            }

            // 4.6 최근 견적/발주 집중 시 적정재고 상향 (결품 예방)
            // 단, 실제 판매량(salesFreq)이 아예 없거나(0), 300A 이상의 대형 사이즈(주문제작 위주)인 경우 무조건 10개로 올리지 않음
            const sizeStr = row.product.size || '';
            const sizeNum = parseInt(sizeStr.replace(/[^0-9]/g, ''), 10);
            const isLargeSize = !isNaN(sizeNum) && sizeNum >= 300;

            if (!isMostlyDropShipped && row.salesFreq > 0 && !isLargeSize && (row.quoteCount >= 2 || row.recent60dOrderCount >= 3)) {
                const trendDemand = Math.max(10, Math.ceil((row.recent60dSales > 0 ? row.recent60dSales : (row.salesVolume / 6)) * 1.2));
                safeStock = Math.max(safeStock, Math.round(trendDemand / 10) * 10);
            }

            // 5. WP 및 Material Filter Rules
            const mat = (row.product.material || '').toUpperCase();
            if (mat.startsWith('WP') || mat.includes('CARBON')) {
                // WP/CARBON은 기본적으로 시화재고에서 제외 (0개)
                // 단, 월 3회 이상(연 36회) 초고빈도 필수 품목은 최대 20개까지만 예외 허용
                if (row.salesFreq >= 36 && row.salesVolume >= 500) {
                    safeStock = Math.min(safeStock, 20);
                } else {
                    safeStock = 0;
                }
            }

            // 6. 건전성 등급(Health Grade) 가중치에 따른 목표재고 증감 (A/B급 상향, D/E급 하향)
            if (healthGrade === 'A') safeStock = Math.ceil(safeStock * 1.5);
            else if (healthGrade === 'B') safeStock = Math.ceil(safeStock * 1.2);
            else if (healthGrade === 'D') {
                safeStock = Math.ceil(safeStock * 0.5);
                if (row.salesFreq > 0) {
                    const avgOrderSize = row.salesVolume / row.salesFreq;
                    safeStock = Math.max(safeStock, Math.ceil(avgOrderSize)); // D등급이라도 최소 1회 평균 출고량은 보장
                }
            }
            else if (healthGrade === 'E') safeStock = 0;

            // 부피 제약 다단화
            if (!isNaN(sizeNum)) {
                if (sizeNum >= 400) { if (safeStock > 30) safeStock = 30; }
                else if (sizeNum >= 300) { if (safeStock > 50) safeStock = 50; }
                else if (sizeNum >= 200) { if (safeStock > 80) safeStock = 80; }
                else if (sizeNum >= 150) { if (safeStock > 150) safeStock = 150; }
                else if (sizeNum >= 100) { if (safeStock > 300) safeStock = 300; }
            }

            // 악성재고: E급만
            const isDeadStock = healthGrade === 'E';

            // 과잉재고: E급 제외, 시화 현재고 > 안전재고 및 최근 1~3개월 판매량/수요 대비 재고가 과잉인 품목
            const isExcessStock = !isDeadStock
                && safeStock > 0
                && row.shQty > safeStock
                && (
                    row.recent60dSales === 0 ||
                    row.recent30dSales === 0 ||
                    row.shQty > Math.max(safeStock * 1.5, safeStock + Math.ceil(sihwaDailySales * 90))
                )
                && row.recentPurchasePrice > 0;

            let excessCategory: string | null = null;
            if (isExcessStock) {
                excessCategory =
                    healthGrade === 'A' ? 'EXCESS_A' :
                        healthGrade === 'B' ? 'EXCESS_B' :
                            healthGrade === 'C' ? 'EXCESS_C' :
                                healthGrade === 'D' ? 'EXCESS_D' : null;
            }

            // 발주 상태 라벨링
            let statusCategory = 'IDLE';
            let statusLabel = '대기/데이터없음';

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
                const isLowDemandCGrade = healthGrade === 'C' && row.quoteCount === 0 && row.recent60dOrderCount === 0 && row.salesFreq < 10;
                const isRecentZeroSales = row.recent60dSales === 0 && healthGrade !== 'A' && healthGrade !== 'B';
                const shouldSkipWarning = isLowDemandCGrade || isRecentZeroSales;

                if (effectiveStock <= 0) {
                    // 선발주 요망(CRITICAL) 조건: 대경 재고가 없으면서, A/B급 핵심 품목이거나 일정 수준 이상 팔리는 품목
                    if (row.ysQty <= 0 && (healthGrade === 'A' || healthGrade === 'B' || (row.salesVolume >= 30 && row.salesFreq >= 5))) {
                        statusCategory = 'CRITICAL';
                        statusLabel = '🚨 선발주 요망 (매입결품)';
                    } else if (shouldSkipWarning) {
                        statusCategory = 'SAFE';
                        statusLabel = isRecentZeroSales ? '🟡 관망 (최근판매없음)' : '🟡 관망 (C등급/최근수요없음)';
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 일반 발주 필요 (재고부족)';
                    }
                } else if (effectiveStock < safeStock) {
                    if (shouldSkipWarning) {
                        statusCategory = 'SAFE';
                        statusLabel = isRecentZeroSales ? '🟡 관망 (최근판매없음)' : '🟡 관망 (C등급/최근수요없음)';
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 적정재고 미달 (재고부족)';
                    }
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                statusCategory = 'SAFE';
                statusLabel = '✅ 미활동 보유품';
            }

            const daysOnHand = dailyAvgSales > 0 && row.shQty > 0 ? parseFloat((row.shQty / dailyAvgSales).toFixed(1)) : (row.shQty > 0 ? 9999 : 0);
            const finalDeficit = Math.max(0, safeStock - effectiveStock);

            // 신규: 예측 기반 권장 발주량(recommendedQty) 통합 산출 로직
            let recommendedQty = 0;
            const sihwaDailySalesCurrent = row.recent60dSales > 0 ? (row.recent60dSales / 40) : (row.salesVolume / 250 * 0.2);
            let twoMonthDemand = Math.ceil(sihwaDailySalesCurrent * 40);
            if (twoMonthDemand < 10 && row.salesVolume > 0) twoMonthDemand = Math.ceil(row.salesVolume / 6);

            let rawQty = 0;
            if (statusCategory === 'WARNING' || statusCategory === 'CRITICAL') {
                rawQty = finalDeficit + twoMonthDemand;
            } else if (statusCategory === 'SAFE' && row.salesFreq >= 20 && !isExcessStock && !(row.product.material || '').toUpperCase().startsWith('WP')) {
                let baseDemand = Math.round(twoMonthDemand / 10) * 10;
                if (twoMonthDemand < 10) baseDemand = twoMonthDemand;
                rawQty = baseDemand - effectiveStock;
            }

            // ── 대경재고 평균 분석을 통한 발주 필요성 평가 ──
            const dkStock = daekyungStockMap.get(row.product.id) || { currentStock: row.ysQty, avg3m: row.ysQty, avg6m: row.ysQty };
            const requiredAmount = rawQty > 0 ? rawQty : finalDeficit;
            
            // 대경 평균재고(3M)가 필요량 이상일 경우 이송(Transfer) 가능으로 판단
            const canTransfer = requiredAmount > 0 && dkStock.avg3m >= requiredAmount;

            if (rawQty > 0 && !isExcessStock && row.ysQty < rawQty * 2 && !canTransfer) {
                const sizeStr = row.product.size || '';
                const sizeNum = parseInt(sizeStr.replace(/[^0-9]/g, ''), 10);
                const isLargeSize = !isNaN(sizeNum) && sizeNum >= 300;

                if (isLargeSize) {
                    recommendedQty = rawQty; // 대형은 단위 올림 없음
                } else if (!isNaN(sizeNum) && sizeNum >= 100) {
                    recommendedQty = Math.max(5, Math.ceil(rawQty / 5) * 5); // 중대형은 5단위 (최소 5)
                } else {
                    recommendedQty = Math.max(10, Math.ceil(rawQty / 10) * 10); // 소형은 10단위 (최소 10)
                }

                // Max capping
                if (!isNaN(sizeNum) && sizeNum >= 100) {
                    const dynamicCap = Math.max(100, Math.ceil(row.salesVolume / 4));
                    recommendedQty = Math.min(dynamicCap, recommendedQty);
                } else if (recommendedQty > 500) {
                    recommendedQty = 500;
                }
            }

            // ★ 3개월 수요 지표 및 특수 수급 위험 판단
            const avgDemand3m = Math.round(row.salesVolume / 12);
            const minDemand3m = Math.max(0, Math.round(avgDemand3m * 0.5));
            const maxDemand3m = Math.round(Math.max(row.recent30dSales, avgDemand3m * 1.6));

            // 자사·공급처 동시결품: 최근 주문/판매 이력이 있는 경우만 인정 (주문건수 필수)
            const hasRecentOrderDemand = (row.recent60dSales > 0 || row.recent60dOrderCount > 0 || row.recent30dSales > 0);
            const isDoubleStockoutWithDemand = row.shQty === 0 && row.ysQty === 0 && hasRecentOrderDemand;

            // 출고 급상승: 시화 현재고가 안전재고보다 작은 경우 (shQty < safeStock) 필수 전제 + 최근 1달/60일 수요 급증 품목
            const isSurgingDemand = !isDoubleStockoutWithDemand && (row.shQty < safeStock) && (
                (row.recent30dSales > 0 && row.recent30dSales >= Math.max(1, Math.round((row.salesVolume / 12) * 1.2))) ||
                (row.recent60dOrderCount >= 3 && row.recent60dSales >= 5) ||
                (row.recent60dSales > Math.ceil(row.salesVolume / 6))
            );

            // 시화 재고가 안전재고 이상이거나, 과잉/악성 재고인 경우 recommendedQty를 0으로 초기화하여 오탐지 방지
            if (isExcessStock || isDeadStock || (!isDoubleStockoutWithDemand && !isSurgingDemand && row.shQty >= safeStock)) {
                recommendedQty = 0;
            }

            let procurementCategory: 'DOUBLE_STOCKOUT' | 'SURGING_DEMAND' | 'SIHWA_UNMET' | 'EXCESS' | 'STABLE' = 'STABLE';
            let procurementReason = "";
            if (isDoubleStockoutWithDemand) {
                procurementCategory = 'DOUBLE_STOCKOUT';
                procurementReason = "🚨 자사·공급처 동시 결품 (최근 주문/견적 수요 존재) - 기회손실 방지 최우선 긴급 수급 필요";
            } else if (isSurgingDemand) {
                procurementCategory = 'SURGING_DEMAND';
                const surgingQty = row.recent30dSales || row.recent60dSales || 0;
                procurementReason = `🔥 최근 주문/출고 급상승 (${surgingQty}개) - ${recommendedQty > 0 ? `${recommendedQty}개 선발주 권장` : '결품 예방 모니터링'}`;
            } else if (row.shQty < safeStock && recommendedQty > 0) {
                procurementCategory = 'SIHWA_UNMET';
                procurementReason = `⚠️ 시화재고(${row.shQty}개)가 적정 안전재고(${safeStock}개) 미달 - ${recommendedQty}개 선발주 권장`;
            } else if (isExcessStock) {
                procurementCategory = 'EXCESS';
                procurementReason = `📉 직전 수요 대비 과잉재고 (${row.shQty}개 보유) - 추가 발주 보류 및 소진/할인 검토`;
            } else if (isDeadStock) {
                procurementCategory = 'EXCESS';
                procurementReason = `❌ 최근 6개월 수요 없음 (${row.shQty}개 보유) - 불필요 재고 처분 권장`;
            } else {
                procurementCategory = 'STABLE';
                procurementReason = "✅ 수급 및 재고 상태 안정적";
            }

            return {
                ...row,
                compositeScore,
                healthGrade,
                excessCategory,
                safeStock,
                deficit: finalDeficit,
                recommendedQty,
                suggestedCriticalQty: finalDeficit,
                effectiveStock,
                statusCategory,
                statusLabel,
                daysOnHand,
                dailyAvgSales,
                reorderPoint,
                isDeadStock,
                isExcessStock,
                canTransfer,
                minDemand3m,
                maxDemand3m,
                avgDemand3m,
                isDoubleStockoutWithDemand,
                isSurgingDemand,
                procurementCategory,
                procurementReason,
            };
            });

            return processedList;
    }, [inventory, sihwaOrders, inventoryMap, recentSeoulPurchaseInfoMap, historyData, liveSalesHistory, quotes, orders, userMap, daekyungStockMap]);

    const baseAnalyzedInventoryMap = useMemo(() => {
        const map = new Map<string, typeof baseAnalyzedInventory[0]>();
        baseAnalyzedInventory.forEach(item => {
            map.set(item.product.id, item);
        });
        return map;
    }, [baseAnalyzedInventory]);

    const analyzedInventory = useMemo(() => {
        let filtered = baseAnalyzedInventory;
        if (searchTerm) {
            const lowerQuery = searchTerm.toLowerCase();
            filtered = baseAnalyzedInventory.filter(row =>
                row.product.id.toLowerCase().includes(lowerQuery) ||
                (row.product.name && row.product.name.toLowerCase().includes(lowerQuery))
            );
        }
        if (sihwaFilterItem.length > 0) {
            filtered = filtered.filter(row => sihwaFilterItem.includes(row.product.name || ''));
        }
        if (sihwaFilterMaterial.length > 0) {
            filtered = filtered.filter(row => sihwaFilterMaterial.includes(row.product.material || ''));
        }
        if (sihwaFilterSize.length > 0) {
            filtered = filtered.filter(row => sihwaFilterSize.includes(row.product.size || ''));
        }
        if (sihwaFilterThickness.length > 0) {
            filtered = filtered.filter(row => sihwaFilterThickness.includes(row.product.thickness || ''));
        }

        return filtered.sort((a, b) => {
            const pinA = pinnedItemIds.has(a.product.id) ? 1 : 0;
            const pinB = pinnedItemIds.has(b.product.id) ? 1 : 0;
            if (pinA !== pinB) {
                return pinB - pinA; // 핀 고정된 항목이 무조건 위로
            }

            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            switch (sortConfig.key) {
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
                case 'quoteCount': return (a.quoteCount - b.quoteCount) * dir;
                case 'recent60dOrderCount': return (a.recent60dOrderCount - b.recent60dOrderCount) * dir;
                default: return 0; // Fallback
            }
        });
    }, [baseAnalyzedInventory, searchTerm, sihwaFilterItem, sihwaFilterMaterial, sihwaFilterSize, sihwaFilterThickness, pinnedItemIds, sortConfig]);

    // ── 시화재고 필터링 옵션 추출 ──
    const sihwaFilterOptions = useMemo(() => {
        const names = Array.from(new Set(inventory.map(p => p.name).filter(Boolean))).sort();
        const materials = Array.from(new Set(inventory.map(p => p.material).filter(Boolean))).sort();
        const sizes = Array.from(new Set(inventory.map(p => p.size).filter(Boolean))).sort();
        const thicknesses = Array.from(new Set(inventory.map(p => p.thickness).filter(Boolean))).sort();
        return { names, materials, sizes, thicknesses };
    }, [inventory]);

    // ── 대경재고(양산) 필터링 옵션 추출 ──
    const daekyungFilterOptions = useMemo(() => {
        const names = Array.from(new Set(inventory.map(p => p.name).filter(Boolean))).sort();
        const materials = Array.from(new Set(inventory.map(p => p.material).filter(Boolean))).sort();
        const sizes = Array.from(new Set(inventory.map(p => p.size).filter(Boolean))).sort();

        return { names, materials, sizes };
    }, [inventory]);



    const daekyungStockAverages = useMemo(() => {
        let items: DaekyungStockAnalysisItem[] = daekyungBaseStockAverages.map(r => {
            const sihwaRow = baseAnalyzedInventoryMap.get(r.id);
            const shQty = sihwaRow?.shQty ?? 0;
            const safeStock = sihwaRow?.safeStock ?? 0;
            const recommendedQty = sihwaRow?.recommendedQty ?? 0;
            const isDoubleStockoutWithDemand = sihwaRow?.isDoubleStockoutWithDemand ?? false;
            const isSurgingDemand = sihwaRow?.isSurgingDemand ?? false;
            const isExcessStock = sihwaRow?.isExcessStock ?? false;
            const isDeadStock = sihwaRow?.isDeadStock ?? false;
            const procurementCategory = sihwaRow?.procurementCategory ?? 'STABLE';
            const procurementReason = sihwaRow?.procurementReason || (
                r.currentStock === 0 
                    ? "🚨 대경 본사 재고 0개 (장기 수급 차질 우려)" 
                    : "✅ 수급 및 재고 상태 안정적"
            );

            return {
                ...r,
                shQty,
                safeStock,
                recommendedQty,
                procurementCategory,
                procurementReason,
                isDoubleStockoutWithDemand,
                isSurgingDemand,
                isExcessStock,
                isDeadStock,
            };
        });

        // 전체 품목 분석 대상 유지

        if (dkSearchQuery) {
            const query = dkSearchQuery.trim().toLowerCase();
            items = items.filter(r =>
                r.id.toLowerCase().includes(query) ||
                r.name.toLowerCase().includes(query)
            );
        }
        if (dkFilterItem) {
            items = items.filter(r => (r.name || '').trim() === dkFilterItem.trim());
        }
        if (dkFilterMaterial) {
            items = items.filter(r => (r.material || '').trim() === dkFilterMaterial.trim());
        }
        if (dkFilterSize) {
            items = items.filter(r => (r.size || '').trim() === dkFilterSize.trim());
        }

        if (dkFilterProcurement === 'ALL') {
            const hasAnyFilter = !!(dkSearchQuery.trim() || dkFilterItem || dkFilterMaterial || dkFilterSize);
            if (!hasAnyFilter) {
                items = [];
            } else {
                // 수급 및 재고 상태 안정적(STABLE) 품목은 확인 불필요하므로 기본 거름 처리
                items = items.filter(r => r.procurementCategory !== 'STABLE');
            }
        } else {
            items = items.filter(r => {
                const cat = r.procurementCategory;
                const recQty = r.recommendedQty || 0;

                if (dkFilterProcurement === 'ORDER_NEEDED') {
                    return recQty > 0 || cat === 'DOUBLE_STOCKOUT' || cat === 'SURGING_DEMAND' || cat === 'SIHWA_UNMET';
                }
                if (dkFilterProcurement === 'RECOMMENDED') {
                    return recQty > 0;
                }
                if (dkFilterProcurement === 'DOUBLE_STOCKOUT') {
                    return r.isDoubleStockoutWithDemand === true;
                }
                if (dkFilterProcurement === 'SURGING_DEMAND') {
                    return cat === 'SURGING_DEMAND' && r.shQty < r.safeStock;
                }
                if (dkFilterProcurement === 'SIHWA_UNMET') {
                    return cat === 'SIHWA_UNMET';
                }
                if (dkFilterProcurement === 'EXCESS') {
                    return cat === 'EXCESS' || r.isExcessStock;
                }
                if (dkFilterProcurement === 'STABLE') {
                    return cat === 'STABLE';
                }
                return true;
            });
        }

        let finalResults: DaekyungStockAnalysisItem[] = [];
        if (dkViewMode === 'ITEM') {
            finalResults = items;
        } else {
            // Group by Material
            const materialGroups: Record<string, {
                material: string;
                currentStock: number;
                avg1m: number;
                avg3m: number;
                avg6m: number;
                share1m: number;
                share3m: number;
                share6m: number;
                shQty: number;
                safeStock: number;
                recommendedQty: number;
            }> = {};

            items.forEach(r => {
                const mat = (r.material || '').trim() || '미지정';
                if (!materialGroups[mat]) {
                    materialGroups[mat] = {
                        material: mat,
                        currentStock: 0,
                        avg1m: 0,
                        avg3m: 0,
                        avg6m: 0,
                        share1m: 0,
                        share3m: 0,
                        share6m: 0,
                        shQty: 0,
                        safeStock: 0,
                        recommendedQty: 0,
                    };
                }
                materialGroups[mat].currentStock += r.currentStock;
                materialGroups[mat].avg1m += r.avg1m;
                materialGroups[mat].avg3m += r.avg3m;
                materialGroups[mat].avg6m += r.avg6m;
                materialGroups[mat].share1m += r.share1m;
                materialGroups[mat].share3m += r.share3m;
                materialGroups[mat].share6m += r.share6m;
                materialGroups[mat].shQty += r.shQty;
                materialGroups[mat].safeStock += r.safeStock;
                materialGroups[mat].recommendedQty += r.recommendedQty;
            });

            finalResults = Object.values(materialGroups).map(g => {
                const trend = g.avg6m > 0 ? parseFloat((((g.avg3m - g.avg6m) / g.avg6m) * 100).toFixed(1)) : (g.avg3m > 0 ? 100 : 0);
                return {
                    id: g.material,
                    name: g.material,
                    material: g.material,
                    currentStock: g.currentStock,
                    avg1m: parseFloat(g.avg1m.toFixed(1)),
                    avg3m: parseFloat(g.avg3m.toFixed(1)),
                    avg6m: parseFloat(g.avg6m.toFixed(1)),
                    share1m: parseFloat(g.share1m.toFixed(2)),
                    share3m: parseFloat(g.share3m.toFixed(2)),
                    share6m: parseFloat(g.share6m.toFixed(2)),
                    trend,
                    shQty: g.shQty,
                    safeStock: g.safeStock,
                    recommendedQty: g.recommendedQty,
                    procurementReason: g.recommendedQty > 0 ? `발주 필요 (${g.recommendedQty}개)` : '정상 수급',
                    isDoubleStockoutWithDemand: false,
                    isSurgingDemand: false,
                };
            });
        }

        // Return new shallow copy to prevent in-place mutation of memoized daekyungBaseStockAverages
        return [...finalResults].sort((a, b) => {
            const dir = dkSortConfig.direction === 'asc' ? 1 : -1;
            switch (dkSortConfig.key) {
                case 'id': return a.id.localeCompare(b.id) * dir;
                case 'name': return a.name.localeCompare(b.name) * dir;
                case 'material': return (a.material || '').localeCompare(b.material || '') * dir;
                case 'size': return (a.size || '').localeCompare(b.size || '') * dir;
                case 'currentStock': return (a.currentStock - b.currentStock) * dir;
                case 'avg1m': return (a.avg1m - b.avg1m) * dir;
                case 'avg3m': return (a.avg3m - b.avg3m) * dir;
                case 'avg6m': return (a.avg6m - b.avg6m) * dir;
                case 'share1m': return (a.share1m - b.share1m) * dir;
                case 'share3m': return (a.share3m - b.share3m) * dir;
                case 'share6m': return (a.share6m - b.share6m) * dir;
                case 'trend': return (a.trend - b.trend) * dir;
                case 'shQty': return (a.shQty - b.shQty) * dir;
                case 'safeStock': return (a.safeStock - b.safeStock) * dir;
                case 'recommendedQty': return (a.recommendedQty - b.recommendedQty) * dir;
                case 'procurementReason': {
                    const getReasonRank = (item: DaekyungStockAnalysisItem) => {
                        const sihwaRow = baseAnalyzedInventoryMap.get(item.id);
                        const isDoubleStockout = item.isDoubleStockoutWithDemand || item.procurementReason.includes('동시 결품');
                        const isSurging = item.isSurgingDemand || item.procurementReason.includes('급상승');
                        const isUnmet = (item.shQty < item.safeStock && item.recommendedQty > 0) || item.procurementReason.includes('적정 안전재고') || item.procurementReason.includes('미달');
                        const isExcess = item.isExcessStock || sihwaRow?.isExcessStock || item.procurementReason.includes('과잉재고');
                        const isDead = item.isDeadStock || sihwaRow?.isDeadStock || item.procurementReason.includes('수요 없음');

                        if (isDoubleStockout) return 1;
                        if (isSurging) return 2;
                        if (isUnmet) return 3;
                        if (isExcess) return 4;
                        if (isDead) return 5;
                        if (item.recommendedQty > 0) return 6;
                        return 7; // 안정적
                    };
                    const rankA = getReasonRank(a);
                    const rankB = getReasonRank(b);
                    if (rankA !== rankB) {
                        return (rankA - rankB) * dir;
                    }
                    return (b.recommendedQty - a.recommendedQty) * dir || a.id.localeCompare(b.id) * dir;
                }
                default: return 0;
            }
        });
    }, [daekyungBaseStockAverages, baseAnalyzedInventoryMap, dkSearchQuery, dkFilterItem, dkFilterMaterial, dkFilterSize, dkFilterProcurement, dkViewMode, dkSortConfig]);


    const daekyungStats = useMemo(() => {
        const totalCurrentStock = daekyungStockAverages.reduce((sum, item) => sum + item.currentStock, 0);
        const totalAvg1m = daekyungStockAverages.reduce((sum, item) => sum + item.avg1m, 0);
        const totalAvg3m = daekyungStockAverages.reduce((sum, item) => sum + item.avg3m, 0);
        const totalAvg6m = daekyungStockAverages.reduce((sum, item) => sum + item.avg6m, 0);

        return {
            totalItems: daekyungStockAverages.length,
            totalCurrentStock,
            totalAvg1m: parseFloat(totalAvg1m.toFixed(1)),
            totalAvg3m: parseFloat(totalAvg3m.toFixed(1)),
            totalAvg6m: parseFloat(totalAvg6m.toFixed(1)),
        };
    }, [daekyungStockAverages]);

    // Aggregate stats and Asset Valuation totals
    const stats = useMemo(() => {
        const regular = analyzedInventory
            .filter(r => 
                (r.statusCategory === 'SAFE' && r.salesFreq >= 20 && r.recommendedQty > 0) ||
                ((r.statusCategory === 'CRITICAL' || r.statusCategory === 'WARNING') && r.canTransfer)
            )
            .filter(r => !(r.product.material || '').toLowerCase().startsWith('wp'));

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
            critical: analyzedInventory.filter(r => r.statusCategory === 'CRITICAL' && !r.isExcessStock && !r.canTransfer),
            warning: analyzedInventory.filter(r => r.statusCategory === 'WARNING' && !r.isExcessStock && !r.canTransfer),
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
            const qty = 'recommendedQty' in row ? row.recommendedQty || 0 : 0;

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

    const handleCreateSelectedDaekyungOrders = () => {
        if (selectedDkIds.size === 0) return;
        let addedCount = 0;
        selectedDkIds.forEach(id => {
            const sihwaRow = baseAnalyzedInventoryMap.get(id);
            const dkRow = daekyungStockAverages.find(r => r.id === id);
            const qty = sihwaRow?.recommendedQty && sihwaRow.recommendedQty > 0 ? sihwaRow.recommendedQty : 1;
            const price = sihwaRow?.recentPurchasePrice ?? 0;
            const name = dkRow?.name || sihwaRow?.product.name || id;

            addItem({
                id: crypto.randomUUID(),
                productId: id,
                name: name,
                thickness: sihwaRow?.product.thickness || '',
                size: dkRow?.size || sihwaRow?.product.size || '',
                material: dkRow?.material || sihwaRow?.product.material || '',
                quantity: qty,
                unitPrice: price,
                amount: price * qty,
                note: '[대경재고 분석] 일괄 발주',
                isVerified: false
            });
            addedCount++;
        });

        alert(`선택한 ${addedCount}개 품목이 발주 장바구니에 추가되었습니다. 매입/발주 페이지로 이동합니다.`);
        setSelectedDkIds(new Set());
        navigate('/admin/purchases');
    };

    const handleCreateOrder = (selectedSet: Set<string>, listType: 'CRITICAL' | 'WARNING' | 'REGULAR') => {
        const listItems = listType === 'CRITICAL' ? stats.critical : listType === 'WARNING' ? stats.warning : stats.regular;
        const selectedItemsWithPending = listItems.filter(item => selectedSet.has(item.product.id) && item.pendingOrderQty > 0);
        
        if (selectedItemsWithPending.length > 0) {
            const warningLines = selectedItemsWithPending.map(item => {
                const poDetails = item.pendingOrderDetails?.map(d => `NO.${d.poNumber.slice(-8)} (${d.qty}개)`).join(', ') || '';
                return `• ${item.product.id} (${item.product.name}): 현재 +${item.pendingOrderQty}개 대기 중 [발주내역: ${poDetails}]`;
            });
            
            const proceed = window.confirm(
                `⚠️ 중복 발주 경고\n\n선택하신 품목 중 이미 미결 입고대기(발주 완료) 중인 품목이 존재합니다:\n\n${warningLines.join('\n')}\n\n그래도 발주서 작성을 진행하시겠습니까?`
            );
            if (!proceed) return;
        }

        processOrderSet(selectedSet, listType);
        navigate('/cart');
    };

    const handleCreateGlobalOrder = () => {
        const allSelectedItems: AnalyzedItem[] = [];
        stats.critical.forEach(row => {
            if (selectedCriticalIds.has(row.product.id) && row.pendingOrderQty > 0) {
                allSelectedItems.push(row);
            }
        });
        stats.warning.forEach(row => {
            if (selectedWarningIds.has(row.product.id) && row.pendingOrderQty > 0) {
                allSelectedItems.push(row);
            }
        });
        stats.regular.forEach(row => {
            if (selectedRegularIds.has(row.product.id) && row.pendingOrderQty > 0) {
                allSelectedItems.push(row);
            }
        });
        
        if (allSelectedItems.length > 0) {
            const warningLines = allSelectedItems.map(item => {
                const poDetails = item.pendingOrderDetails?.map(d => `NO.${d.poNumber.slice(-8)} (${d.qty}개)`).join(', ') || '';
                return `• ${item.product.id} (${item.product.name}): 현재 +${item.pendingOrderQty}개 대기 중 [발주내역: ${poDetails}]`;
            });
            
            const proceed = window.confirm(
                `⚠️ 중복 발주 경고\n\n선택하신 품목 중 이미 미결 입고대기(발주 완료) 중인 품목이 존재합니다:\n\n${warningLines.join('\n')}\n\n그래도 발주서 작성을 진행하시겠습니까?`
            );
            if (!proceed) return;
        }

        if (selectedCriticalIds.size > 0) processOrderSet(selectedCriticalIds, 'CRITICAL');
        if (selectedWarningIds.size > 0) processOrderSet(selectedWarningIds, 'WARNING');
        if (selectedRegularIds.size > 0) processOrderSet(selectedRegularIds, 'REGULAR');
        navigate('/cart');
    };

    const handleCreateManualOrder = () => {
        if (selectedAllTableIds.size === 0) return;

        const selectedItemsWithPending = analyzedInventory.filter(row => selectedAllTableIds.has(row.product.id) && row.pendingOrderQty > 0);
        
        if (selectedItemsWithPending.length > 0) {
            const warningLines = selectedItemsWithPending.map(item => {
                const poDetails = item.pendingOrderDetails?.map(d => `NO.${d.poNumber.slice(-8)} (${d.qty}개)`).join(', ') || '';
                return `• ${item.product.id} (${item.product.name}): 현재 +${item.pendingOrderQty}개 대기 중 [발주내역: ${poDetails}]`;
            });
            
            const proceed = window.confirm(
                `⚠️ 중복 발주 경고\n\n선택하신 품목 중 이미 미결 입고대기(발주 완료) 중인 품목이 존재합니다:\n\n${warningLines.join('\n')}\n\n그래도 발주서 작성을 진행하시겠습니까?`
            );
            if (!proceed) return;
        }

        analyzedInventory.forEach(row => {
            if (selectedAllTableIds.has(row.product.id)) {
                let qty = row.safeStock - (row.shQty + row.pendingOrderQty);
                if (qty <= 0) qty = 10;
                else qty = Math.ceil(qty / 10) * 10;

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
                    note: `[수동 추가]`,
                    isVerified: false
                });
            }
        });

        setSelectedAllTableIds(new Set());
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
        // ── 결품 기회손실: 취소/철회, 미결 지연(5일↑), 견적 미전환 ────
        const missedDemandMap: Record<string, { 
            count: number; 
            estimatedRevenue: number; 
            history: { 
                date: string; 
                type: 'ORDER' | 'QUOTE'; 
                qty: number; 
                price: number; 
                customer: string; 
                refNo: string; 
                status: string; 
            }[] 
        }> = {};

        // 1. 주문 건 (취소/철회 및 5일 이상 장기 미결품)
        orders.forEach(o => {
            if (o.isDeleted) return;

            const isCancelled = ['CANCELLED', 'WITHDRAWN'].includes(o.status);
            const isDelayedPending = o.status === 'PROCESSING' && Math.floor((now - new Date(o.createdAt).getTime()) / 86400000) >= 5;

            if (!isCancelled && !isDelayedPending) return;

            // 내부 재고 이동 주문 제외
            const custStr = (o.poEndCustomer || o.customerName || '').toLowerCase().replace(/\s+/g, '');
            if (custStr.includes('재고') || custStr.includes('시화') || custStr.includes('서울') || custStr.includes('알트에프') || custStr.includes('altf')) return;

            const items = o.po_items?.length ? o.po_items : o.items;
            items?.forEach(item => {
                if (isDelayedPending && item.transactionIssued) return; // 미결품이 아닌 것은 제외

                const id = item.productId || (item as { item_id?: string }).item_id || '';
                if (!id) return;
                const row = baseAnalyzedInventoryMap.get(id);
                if (!row) return;

                const qty = Number(item.quantity ?? (item as { qty?: number }).qty ?? 0);
                // 전체 혹은 일부 수량 부족 판정 (재고 < 주문수량)
                if (row.shQty + row.ysQty < qty || (isCancelled && row.shQty <= 0 && row.ysQty <= 0)) {
                    if (!missedDemandMap[id]) {
                        missedDemandMap[id] = { count: 0, estimatedRevenue: 0, history: [] };
                    }
                    missedDemandMap[id].count += 1;
                    missedDemandMap[id].estimatedRevenue += qty * row.sellingPrice;
                    missedDemandMap[id].history.push({
                        date: o.createdAt,
                        type: 'ORDER',
                        qty: qty,
                        price: row.sellingPrice,
                        customer: o.customerName || '일반고객',
                        refNo: o.poNumber || o.id || '',
                        status: o.status === 'PROCESSING' ? '장기 미결' : o.status === 'CANCELLED' ? '주문 취소' : o.status === 'WITHDRAWN' ? '주문 철회' : o.status
                    });
                }
            });
        });

        // 2. 견적(Quotes) 건 (답변완료 후 발주 미전환, 재고 부족)
        quotes?.forEach(q => {
            if (q.isDeleted) return;
            if (!['PROCESSED', 'COMPLETED'].includes(q.status)) return;

            // 발주 전환 여부 체크
            const isConverted = orders.some(o => o.linkedQuoteId === q.id && !['CANCELLED', 'WITHDRAWN'].includes(o.status));
            if (isConverted) return;

            q.items?.forEach(item => {
                const id = item.productId || (item as { item_id?: string }).item_id || '';
                if (!id) return;
                const row = baseAnalyzedInventoryMap.get(id);
                if (!row) return;

                const qty = Number(item.quantity ?? (item as { qty?: number }).qty ?? 0);
                if (row.shQty + row.ysQty < qty) {
                    if (!missedDemandMap[id]) {
                        missedDemandMap[id] = { count: 0, estimatedRevenue: 0, history: [] };
                    }
                    missedDemandMap[id].count += 1;
                    missedDemandMap[id].estimatedRevenue += qty * row.sellingPrice;
                    missedDemandMap[id].history.push({
                        date: q.createdAt,
                        type: 'QUOTE',
                        qty: qty,
                        price: row.sellingPrice,
                        customer: q.customerName || '일반고객',
                        refNo: q.id,
                        status: '견적 미전환'
                    });
                }
            });
        });

        // ── 품목별 분류 ────────────────────────────────────────────
        const deadStockItems: typeof analyzedInventory = [];
        const excessStockItems: typeof analyzedInventory = [];
        const slowMoveItems: typeof analyzedInventory = [];
        const optimalItems: typeof analyzedInventory = [];

        let totalStockValue = 0;
        let deadStockValue = 0;
        let excessStockValue = 0;
        let slowMoveValue = 0;
        let optimalStockValue = 0;

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
        const deadRatio = totalStockValue > 0 ? deadStockValue / totalStockValue : 0;
        const excessRatio = totalStockValue > 0 ? excessStockValue / totalStockValue : 0;
        const slowRatio = totalStockValue > 0 ? slowMoveValue / totalStockValue : 0;

        // 항목별 감점
        const deadPenalty = Math.min(40, Math.round(deadRatio / HEALTHY_DEAD_RATIO * 20));
        const excessPenalty = Math.min(30, Math.round(excessRatio / HEALTHY_EXCESS_RATIO * 15));
        const slowPenalty = Math.min(15, Math.round(slowRatio * 30));
        const healthScore = Math.max(0, 100 - deadPenalty - excessPenalty - slowPenalty);

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
                const row = baseAnalyzedInventoryMap.get(id);
                return { id, ...v, row };
            })
            .filter(m => m.count >= 1)
            .sort((a, b) => b.count - a.count);

        // ── 즉시 처분 대상 (악성재고 중 대경 반품 가능하거나 장기(180일+) 악성인 품목) ──
        const urgentDisposalItems = deadStockItems
            .filter(row => {
                const daysSince = (row as typeof row & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0;
                return row.ysQty > 0 || daysSince > 180;
            })
            .sort((a, b) => ((b as typeof b & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0) - ((a as typeof a & { _daysSinceLastSale?: number })._daysSinceLastSale ?? 0));

        return {
            totalStockValue,
            deadStockItems, deadStockValue,
            excessStockItems, excessStockValue,
            slowMoveItems, slowMoveValue,
            optimalItems, optimalStockValue,
            deadRatio, excessRatio, slowRatio,
            healthScore, healthGrade,
            annualRevenue, its,
            missedDemandList,
            urgentDisposalItems,
            lockedCapital: deadStockValue + excessStockValue,
            totalIssueCount: analyzedInventory.filter(r => r.healthGrade === 'E' || r.excessCategory !== null).length,
        };
    }, [analyzedInventory, baseAnalyzedInventoryMap, historyData, orders, quotes]);

    const filteredMissedDemandList = useMemo(() => {
        let list = healthDiagnosis.missedDemandList.map(m => {
            const row = m.row || {
                product: inventory.find(item => item.id === m.id) || { id: m.id, name: m.id, material: '알수없음', maker: '알수없음', size: '', thickness: '' },
                sellingPrice: 0,
                recentPurchasePrice: 0,
                shQty: 0,
                ysQty: 0,
                pendingOrderQty: 0,
                safeStock: 0
            };

            // Filter history by period
            const nowTime = Date.now();
            const filteredHistory = (m.history || []).filter(h => {
                if (mdPeriod === 'ALL') return true;
                const dateVal = new Date(h.date).getTime();
                if (isNaN(dateVal)) return true;
                const diffDays = (nowTime - dateVal) / 86400000;
                if (mdPeriod === '7D') return diffDays <= 7;
                if (mdPeriod === '30D') return diffDays <= 30;
                if (mdPeriod === '60D') return diffDays <= 60;
                return true;
            });

            const count = filteredHistory.length;
            const totalQty = filteredHistory.reduce((sum, h) => sum + h.qty, 0);
            const estimatedRevenue = filteredHistory.reduce((sum, h) => sum + h.qty * h.price, 0);

            return {
                ...m,
                row,
                history: filteredHistory,
                count,
                totalQty,
                estimatedRevenue
            };
        });

        // Filter items with 0 count in the selected period
        list = list.filter(m => m.count > 0);

        if (mdSearchQuery.trim()) {
            const query = mdSearchQuery.toLowerCase();
            list = list.filter(m => 
                m.id.toLowerCase().includes(query) || 
                (m.row?.product?.name || '').toLowerCase().includes(query) ||
                (m.row?.product?.material || '').toLowerCase().includes(query)
            );
        }

        if (mdFilterName) {
            list = list.filter(m => (m.row?.product?.name || '') === mdFilterName);
        }

        if (mdFilterThickness) {
            list = list.filter(m => (m.row?.product?.thickness || '') === mdFilterThickness);
        }

        if (mdFilterSize) {
            list = list.filter(m => (m.row?.product?.size || '') === mdFilterSize);
        }

        if (mdFilterMaterial) {
            list = list.filter(m => (m.row?.product?.material || '') === mdFilterMaterial);
        }

        list.sort((a, b) => {
            let valA: string | number = '';
            let valB: string | number = '';

            if (mdSortConfig.key === 'id') {
                valA = a.id;
                valB = b.id;
            } else if (mdSortConfig.key === 'name') {
                valA = a.row?.product?.name || '';
                valB = b.row?.product?.name || '';
            } else if (mdSortConfig.key === 'count') {
                valA = a.count;
                valB = b.count;
            } else if (mdSortConfig.key === 'estimatedRevenue') {
                valA = a.estimatedRevenue;
                valB = b.estimatedRevenue;
            } else if (mdSortConfig.key === 'material') {
                valA = a.row?.product?.material || '';
                valB = b.row?.product?.material || '';
            } else if (mdSortConfig.key === 'thickness') {
                valA = a.row?.product?.thickness || '';
                valB = b.row?.product?.thickness || '';
            } else if (mdSortConfig.key === 'size') {
                valA = a.row?.product?.size || '';
                valB = b.row?.product?.size || '';
            }

            if (valA < valB) return mdSortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return mdSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        return list;
    }, [
        healthDiagnosis.missedDemandList,
        mdSearchQuery,
        mdFilterName,
        mdFilterThickness,
        mdFilterSize,
        mdFilterMaterial,
        mdSortConfig,
        mdPeriod,
        inventory
    ]);

    const mdPeriodStats = useMemo(() => {
        const totalOccurrences = filteredMissedDemandList.reduce((sum, m) => sum + m.count, 0);
        const totalQuantity = filteredMissedDemandList.reduce((sum, m) => sum + m.totalQty, 0);
        const totalLoss = filteredMissedDemandList.reduce((sum, m) => sum + m.estimatedRevenue, 0);
        return { totalOccurrences, totalQuantity, totalLoss };
    }, [filteredMissedDemandList]);

    const mdFilterOptions = useMemo(() => {
        const names = new Set<string>();
        const thicknesses = new Set<string>();
        const sizes = new Set<string>();
        const materials = new Set<string>();

        healthDiagnosis.missedDemandList.forEach(m => {
            const prod = m.row?.product || inventory.find(item => item.id === m.id);
            if (prod) {
                if (prod.name) names.add(prod.name);
                if (prod.thickness) thicknesses.add(prod.thickness);
                if (prod.size) sizes.add(prod.size);
                if (prod.material) materials.add(prod.material);
            }
        });

        return {
            names: Array.from(names).sort(),
            thicknesses: Array.from(thicknesses).sort(),
            sizes: Array.from(sizes).sort(),
            materials: Array.from(materials).sort()
        };
    }, [healthDiagnosis.missedDemandList, inventory]);

    const handleCreateMissedDemandOrder = () => {
        if (selectedMissedDemandIds.size === 0) return;

        filteredMissedDemandList.forEach(m => {
            if (selectedMissedDemandIds.has(m.id)) {
                const qty = mdRowQtys[m.id] ?? Math.max(5, m.count * 2);
                const unitPrice = m.row && m.row.recentPurchasePrice > 0 ? m.row.recentPurchasePrice : (m.row?.sellingPrice || 0);

                addItem({
                    id: crypto.randomUUID(),
                    productId: m.id,
                    name: m.row?.product?.name || m.id,
                    thickness: (m.row?.product as { thickness?: string })?.thickness || '',
                    size: m.row?.product?.size || '',
                    material: m.row?.product?.material || '',
                    quantity: qty,
                    unitPrice: unitPrice,
                    amount: qty * unitPrice,
                    note: `[결품 기회손실 긴급보충]`,
                    isVerified: false
                });
            }
        });

        setSelectedMissedDemandIds(new Set());
        navigate('/cart');
    };

    const handleCreateSingleMissedDemandOrder = (id: string, customQty?: number) => {
        const item = filteredMissedDemandList.find(m => m.id === id);
        if (!item) return;

        const qty = customQty ?? mdRowQtys[id] ?? Math.max(5, item.count * 2);
        const unitPrice = item.row && item.row.recentPurchasePrice > 0 ? item.row.recentPurchasePrice : (item.row?.sellingPrice || 0);

        addItem({
            id: crypto.randomUUID(),
            productId: id,
            name: item.row?.product?.name || id,
            thickness: (item.row?.product as { thickness?: string })?.thickness || '',
            size: item.row?.product?.size || '',
            material: item.row?.product?.material || '',
            quantity: qty,
            unitPrice: unitPrice,
            amount: qty * unitPrice,
            note: `[결품 기회손실 즉시발주]`,
            isVerified: false
        });

        navigate('/cart');
    };

    const handleCreateSingleDaekyungOrder = (row: { id: string; name?: string; material?: string; size?: string; thickness?: string }, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const sihwaRow = baseAnalyzedInventoryMap.get(row.id);
        const recQty = sihwaRow?.recommendedQty ?? 0;
        const qty = recQty > 0 ? recQty : (sihwaRow?.deficit && sihwaRow.deficit > 0 ? sihwaRow.deficit : 10);
        const unitPrice = sihwaRow?.recentPurchasePrice ?? 0;

        addItem({
            id: crypto.randomUUID(),
            productId: row.id,
            name: row.name || row.id,
            thickness: (sihwaRow?.product as { thickness?: string })?.thickness || row.thickness || '',
            size: row.size || '',
            material: row.material || '',
            quantity: qty,
            unitPrice: unitPrice,
            amount: qty * unitPrice,
            note: `[대경 수급분석 즉시발주]`,
            isVerified: false
        });

        navigate('/cart');
    };




    const handleExportSihwaSummary = () => {
        const headers = ['품목', '두께', '사이즈', '재질', '현재재고(시화)', '입고예정(미결결과)', '발주서번호(들)', '발주날짜(들)', '입고예정일'];
        const csvRows = [headers.join(',')];

        analyzedInventory.forEach(row => {
            if (!row || !row.product) return;
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
                if (order.status === 'COMPLETED') return;

                const targetCustomer = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase().replace(/\s+/g, '');
                const isSihwaIncoming = targetCustomer.includes('재고') || targetCustomer.includes('서울') || targetCustomer.includes('시화') || targetCustomer.includes('알트에프') || targetCustomer.includes('altf');

                if (isSihwaIncoming) {
                    const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
                    items?.forEach((poItem: Partial<LineItem> & { transactionIssued?: boolean; poSent?: boolean }) => {
                        if (!poItem.transactionIssued) {
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
            const escapeCSV = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
            const r = [
                escapeCSV(specName),
                escapeCSV(specThick),
                escapeCSV(specSize),
                escapeCSV(specMat),
                row.shQty, // 현재고
                row.pendingOrderQty, // 입고예정
                escapeCSV(poNumbers.join(', ')),
                escapeCSV(poDates.join(', ')),
                escapeCSV(deliveryDates.join(', '))
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

    const handleExportAiSummary = () => {
        const escapeCSV = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
        const headers = ['구분', '품목 코드', '품목', '두께', '사이즈', '재질', '현재고(시화)', '대경재고', '대기중(수량)', '발주서번호(들)', '납품예정일(들)', '매입단가', '권장/추천발주량', '필요예산', '분석근거'];
        const csvRows = [headers.join(',')];

        const appendRows = (items: typeof stats.critical, category: string) => {
            items.forEach(row => {
                const poNumbers = row.pendingOrderDetails?.map(d => d.poNumber).join('; ') || '';
                const deliveryDates = row.pendingOrderDetails?.map(d => d.deliveryDate ? new Date(d.deliveryDate).toLocaleDateString() : '').filter(Boolean).join('; ') || '';
                const deficitOrRecommended = category === '🚨 선발주 요망' ? row.deficit : (category === '⚠️ 일반 발주 필요' ? row.recommendedQty : row.recommendedQty);
                const budget = row.recentPurchasePrice * (deficitOrRecommended > 0 ? deficitOrRecommended : 1);
                
                const r = [
                    escapeCSV(category),
                    escapeCSV(row.product.id),
                    escapeCSV(row.product.name),
                    escapeCSV(row.product.thickness),
                    escapeCSV(row.product.size),
                    escapeCSV(row.product.material),
                    row.shQty,
                    row.ysQty,
                    row.pendingOrderQty,
                    escapeCSV(poNumbers),
                    escapeCSV(deliveryDates),
                    row.recentPurchasePrice,
                    deficitOrRecommended,
                    budget,
                    escapeCSV(`적정 대비 ${row.deficit}개 부족 / 연판매 ${row.salesVolume}개`)
                ];
                csvRows.push(r.join(','));
            });
        };

        appendRows(stats.critical, '🚨 선발주 요망');
        appendRows(stats.warning, '⚠️ 일반 발주 필요');
        appendRows(stats.regular, '♻️ 정기 발주 예측');

        const csvString = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `AI_재고요약_분석_${dateStr}.csv`);
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
                                : historyData.inventoryHistory.length >= 7 ? 12
                                    : historyData.inventoryHistory.length >= 1 ? 6 : 0;
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
                            현재 시화재고 출고량의 대부분을 '수도권(경기) 판매'로 간주하여 분석 중입니다.<br />
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
                        onClick={() => setShowGuide(!showGuide)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-95 border border-indigo-600"
                    >
                        <Info className="w-4 h-4" />
                        {showGuide ? '재고분석 가이드 숨기기' : '재고분석 가이드 보기'}
                    </button>
                    {user?.role === 'MASTER' && (
                        <button
                            onClick={handleDataRefresh}
                            disabled={invLoading || historyLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-95 border border-blue-600"
                        >
                            <RefreshCw className={`w-4 h-4 ${(invLoading || historyLoading) ? 'animate-spin' : ''}`} />
                            데이터 새로고침
                        </button>
                    )}
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
                    onClick={() => { setActiveTab('AI_SUMMARY'); setExpandedGroups(prev => ({ ...prev, CRITICAL: true })); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}
                    className="bg-linear-to-br from-rose-500 to-red-600 rounded-2xl p-5 shadow-lg shadow-rose-200 text-white flex flex-col relative overflow-hidden group cursor-pointer transition-transform hover:-translate-y-1 active:scale-95"
                >
                    <div className="absolute top-0 right-0 -mr-6 -mt-6 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <AlertTriangle className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><AlertTriangle className="w-5 h-5" />매입처 동반 결품 (선발주 요망)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.critical.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 break-keep mt-auto">현재고 및 대경 재고가 바닥났으며, 연 판매량(100↑)이 많아 선발주 관리가 필요한 품목입니다.</p>
                </div>

                <div
                    onClick={() => { setActiveTab('AI_SUMMARY'); setExpandedGroups(prev => ({ ...prev, WARNING: true })); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}
                    className="bg-linear-to-br from-amber-500 to-orange-500 rounded-2xl p-5 shadow-lg shadow-amber-200 text-white flex flex-col relative overflow-hidden group cursor-pointer transition-transform hover:-translate-y-1 active:scale-95"
                >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <PackageSearch className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><PackageSearch className="w-5 h-5" />일반 발주 필요 (적정재고 미달)</h3>
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
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><TrendingUp className="w-5 h-5" />매입 실적가 기준 기초 자산</h3>
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
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><TrendingUp className="w-5 h-5" />견적 유입 & 결품 (기회손실)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{healthDiagnosis.missedDemandList.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 mt-auto">최근 60일 내 견적 문의가 있었으나 시화/대경 재고가 없어 판매 기회를 잃었을 가능성이 높은 품목입니다.</p>
                </div>
                {showGuide && (
                    <>
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-2 z-10 opacity-90">
                                <Activity className="w-5 h-5 text-purple-500" />
                                재고 건전성 등급 분포 (A~E) <span className="text-xs text-slate-400 font-normal ml-1">(총 {analyzedInventory.filter(r => r.healthGrade !== 'N').length}개 품목)</span>
                            </h3>
                            <p className="text-4xl font-black text-slate-800 mb-2 invisible h-0">0</p>

                            <div className="space-y-2 mt-auto">
                                {(['A', 'B', 'C', 'D', 'E'] as const).map(grade => {
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
                                            <span className="text-[11px] font-bold text-slate-500 w-12 text-right shrink-0 whitespace-nowrap">
                                                {count}품목
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-700 flex flex-col text-white">
                            <h3 className="font-bold text-slate-100 flex items-center gap-2 mb-3 z-10 opacity-90 text-[13px] border-b border-slate-600 pb-2">
                                <Info className="w-4 h-4 text-sky-400" />
                                건전성 점수 산출 가이드 (100점 만점)
                            </h3>
                            <div className="text-[11px] text-slate-300 space-y-2.5 leading-tight mt-auto">
                                <p><strong className="text-emerald-400">A급 (65점↑)</strong>: 초고회전, 핵심 매출</p>
                                <p><strong className="text-blue-400">B급 (45점↑)</strong>: 안정적 유지, 지속 매출</p>
                                <p><strong className="text-amber-400">C급 (25점↑)</strong>: 간헐적 매출, 관망 필요</p>
                                <p><strong className="text-orange-400">D급 (10점↑)</strong>: 과잉/무발주, 정체 품목</p>
                                <p><strong className="text-rose-400">E급 (10점↓)</strong>: 장기 무매출, 악성재고</p>
                                <div className="border-t border-slate-700 pt-2.5 mt-2.5 text-slate-400 text-[10px]">
                                    <span className="block mb-1.5 font-bold text-slate-300 text-[11px]">항목별 가중치 (배점)</span>
                                    판매빈도(25) + 판매규모(15) + <br />최근트렌드(25) + 견적유입(20) + <br />이익률(15)
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-700 flex flex-col text-white">
                            <h3 className="font-bold text-slate-100 flex items-center gap-2 mb-3 z-10 opacity-90 text-[13px] border-b border-slate-600 pb-2">
                                <Activity className="w-4 h-4 text-emerald-400" />
                                세부 항목별 산출 기준표
                            </h3>
                            <div className="text-[11px] text-slate-300 space-y-2.5 leading-tight mt-auto">
                                <p><strong className="text-indigo-400">판매빈도(25)</strong>: 최근 6개월 내 판매 발생 월수. 매달 꾸준한 수요가 있는가?</p>
                                <p><strong className="text-teal-400">판매규모(15)</strong>: 연간 총 판매액 기여도. 전체 매출에 얼마나 도움이 되는가?</p>
                                <p><strong className="text-amber-400">최근트렌드(25)</strong>: 최근 60일 내 판매량이 연평균 대비 증가했는가? 최근 수요 유지 여부.</p>
                                <p><strong className="text-rose-400">견적유입(20)</strong>: 최근 60일 내 견적 문의 횟수. 실제 판매가 없어도 시장 관심도가 있는가?</p>
                                <p><strong className="text-blue-400">이익률(15)</strong>: 대경 원가 대비 시화의 추정 영업 이익률. 고수익 품목인가?</p>
                                <div className="border-t border-slate-700 pt-2.5 mt-2.5 text-slate-400 text-[10px]">
                                    <span className="block mb-1.5 font-bold text-slate-300 text-[11px]">보정 및 예외</span>
                                    재고 0인 상태는 점수 0점(N등급). 과잉재고 및 악성재고 패널티는 점수에서 차감.
                                </div>
                            </div>
                        </div>
                    </>
                )}
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
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'ALL_TABLE' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('ALL_TABLE')}
                        >
                            전체 재고 리스트(정렬지원)
                        </button>
                        <button
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'TOTAL_DASHBOARD' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('TOTAL_DASHBOARD')}
                        >
                            월간·일간 변동 트렌드
                        </button>
                        <button
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all flex items-center gap-1.5 ${activeTab === 'HEALTH_DIAGNOSIS'
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
                        <button
                            className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'DAEKYUNG_STOCK' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('DAEKYUNG_STOCK')}
                        >
                            🏭 대경재고 (평균 분석)
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

                {activeTab !== 'DAEKYUNG_STOCK' && activeTab !== 'HEALTH_DIAGNOSIS' && (
                    <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                            <SearchableMultiSelect
                                title="품목"
                                options={sihwaFilterOptions.names}
                                selectedValues={sihwaFilterItem}
                                onChange={setSihwaFilterItem}
                            />
                            <SearchableMultiSelect
                                title="재질"
                                options={sihwaFilterOptions.materials}
                                selectedValues={sihwaFilterMaterial}
                                onChange={setSihwaFilterMaterial}
                            />
                            <SearchableMultiSelect
                                title="두께"
                                options={sihwaFilterOptions.thicknesses}
                                selectedValues={sihwaFilterThickness}
                                onChange={setSihwaFilterThickness}
                            />
                            <SearchableMultiSelect
                                title="사이즈"
                                options={sihwaFilterOptions.sizes}
                                selectedValues={sihwaFilterSize}
                                onChange={setSihwaFilterSize}
                            />
                        </div>

                        <div className="shrink-0 w-full sm:w-auto flex flex-col sm:flex-row gap-2">
                            <button
                                onClick={() => {
                                    setSearchTerm('');
                                    setSihwaFilterItem([]);
                                    setSihwaFilterMaterial([]);
                                    setSihwaFilterSize([]);
                                    setSihwaFilterThickness([]);
                                }}
                                disabled={!searchTerm && sihwaFilterItem.length === 0 && sihwaFilterMaterial.length === 0 && sihwaFilterSize.length === 0 && sihwaFilterThickness.length === 0}
                                className="w-full sm:w-auto bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                            >
                                🔄 필터 초기화
                            </button>
                            {activeTab === 'AI_SUMMARY' && (
                                <button
                                    onClick={handleExportAiSummary}
                                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                >
                                    <Download className="w-4.5 h-4.5" />
                                    AI 재고 요약 다운로드 (Excel)
                                </button>
                            )}
                        </div>
                    </div>
                )}

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
                                                {expandedGroups['CRITICAL'] ? <ChevronDown className="w-5 h-5 text-rose-500" /> : <ChevronRight className="w-5 h-5 text-rose-500" />}
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
                                            <div className="bg-white border-t border-rose-100 overflow-x-auto overflow-y-auto max-h-150 custom-scrollbar">
                                                {stats.critical.length > 0 ? (
                                                    <table className="w-full text-sm text-left whitespace-nowrap">
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none sticky top-0 z-10 shadow-sm">
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
                                                                <th className="px-3 py-3 w-10 text-center">핀</th>
                                                                <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key === 'shQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('ysQty')}>대경재고 {sortConfig.key === 'ysQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('pendingOrderQty')}>대기수량 (Pending) {sortConfig.key === 'pendingOrderQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right">매입단가</th>
                                                                <th className="px-5 py-3 text-right">필요예산 (단가×결핍수량)</th>
                                                                <th className="px-5 py-3 text-right">경쟁사 연판매</th>
                                                                <th className="px-5 py-3 text-center">건전성 등급</th>

                                                                <th className="px-5 py-3">🚨 분석 근거 (명확성)</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {stats.critical.map(row => (
<tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
                                                                     <td className="px-5 py-4 text-center">
                                                                         <input type="checkbox" title="품목 선택" className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-600"
                                                                             onClick={(e) => e.stopPropagation()}
                                                                             checked={selectedCriticalIds.has(row.product.id)}
                                                                             onChange={(e) => {
                                                                                 const newSet = new Set(selectedCriticalIds);
                                                                                 if (e.target.checked) newSet.add(row.product.id);
                                                                                 else newSet.delete(row.product.id);
                                                                                 setSelectedCriticalIds(newSet);
                                                                             }}
                                                                         />
                                                                     </td>
                                                                     <td className="px-3 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                                         <button
                                                                             onClick={() => {
                                                                                 setPinnedItemIds(prev => {
                                                                                     const next = new Set(prev);
                                                                                     if (next.has(row.product.id)) next.delete(row.product.id);
                                                                                     else next.add(row.product.id);
                                                                                     return next;
                                                                                 });
                                                                             }}
                                                                             className={`p-1.5 rounded-lg hover:bg-slate-100 transition ${pinnedItemIds.has(row.product.id) ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'}`}
                                                                             title={pinnedItemIds.has(row.product.id) ? '핀 고정 해제' : '최상단 핀 고정'}
                                                                         >
                                                                             <Pin className={`w-4 h-4 ${pinnedItemIds.has(row.product.id) ? 'fill-current' : ''}`} />
                                                                         </button>
                                                                     </td>
                                                                    <td className="px-5 py-4">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-sm ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' : row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' : row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' : row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{row.healthGrade}급</span>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setSelectedIntelligenceItem(row);
                                                                                }}
                                                                                className="font-mono font-bold text-slate-900 text-sm hover:text-indigo-600 transition-colors flex items-center gap-1 group text-left"
                                                                            >
                                                                                {row.product.id}
                                                                                <Info className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-black font-mono text-rose-600 bg-rose-50/30">0</td>
                                                                    <td className="px-5 py-4 text-right font-black font-mono text-slate-400">0</td>
                                                                    <td className="px-5 py-4 text-center font-bold text-slate-400">
                                                                        {row.pendingOrderQty > 0 ? (
                                                                            <div className="flex flex-col items-center">
                                                                                <span className="text-indigo-600 font-black">+{row.pendingOrderQty} 대기중</span>
                                                                                {row.pendingOrderDetails && row.pendingOrderDetails.length > 0 && (
                                                                                    <div className="text-[10px] text-slate-500 mt-1 space-y-0.5 max-w-37.5 overflow-hidden text-ellipsis">
                                                                                        {row.pendingOrderDetails.map((d, idx) => (
                                                                                            <div key={idx} className="whitespace-nowrap" title={`${d.poNumber}${d.deliveryDate ? ` (납기: ${d.deliveryDate})` : ''}`}>
                                                                                                <span className="font-mono bg-slate-100 px-1 rounded text-slate-600 border border-slate-200">{d.poNumber.slice(-8)}</span>
                                                                                                {d.deliveryDate && (
                                                                                                    <span className="text-indigo-500 ml-1">({new Date(d.deliveryDate).toLocaleDateString('ko-KR', {month: 'numeric', day: 'numeric'})})</span>
                                                                                                )}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ) : '없음'}
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
                                                                            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                                    row.healthGrade === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                                        row.healthGrade === 'C' ? 'bg-blue-100 text-blue-600' :
                                                                                            row.healthGrade === 'D' ? 'bg-rose-100 text-rose-600' :
                                                                                                'bg-slate-100 text-slate-400'
                                                                                }`}>
                                                                                {row.healthGrade === 'A' ? 'A급' :
                                                                                    row.healthGrade === 'B' ? 'B급' :
                                                                                        row.healthGrade === 'C' ? 'C급' :
                                                                                            row.healthGrade === 'D' ? 'D급' : '—'}
                                                                            </span>
                                                                            <span className="text-xs font-mono text-slate-500">
                                                                                {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '—'}
                                                                            </span>
                                                                        </div>
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
                                                                 <td colSpan={3} className="px-5 py-4">
                                                                    <button onClick={() => handleCreateOrder(selectedCriticalIds, 'CRITICAL')} disabled={selectedCriticalIds.size === 0} className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${selectedCriticalIds.size > 0 ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                                                                        <span>선택 품목 발주서 만들기 ({selectedCriticalIds.size}건)</span>
                                                                        <ChevronRight className="w-4 h-4" />
                                                                    </button>
                                                                </td>
                                                                <td colSpan={6} className="px-5 py-4 text-right font-bold text-slate-700 relative">
                                                                    {(() => {
                                                                        const selectedItems = stats.critical.filter(item => selectedCriticalIds.has(item.product.id));
                                                                        const negoEligibleCount = selectedItems.filter(item => (item.recentPurchasePrice * (item.deficit > 0 ? item.deficit : 1)) >= 20_000_000).length;
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
                                                {expandedGroups['WARNING'] ? <ChevronDown className="w-5 h-5 text-amber-600" /> : <ChevronRight className="w-5 h-5 text-amber-600" />}
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
                                            <div className="bg-white border-t border-amber-100 overflow-x-auto overflow-y-auto max-h-150 custom-scrollbar">
                                                {stats.warning.length > 0 ? (
                                                    <table className="w-full text-sm text-left whitespace-nowrap">
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none sticky top-0 z-10 shadow-sm">
                                                            <tr>
<th className="px-4 py-3 w-10 text-center">
                                                                     <input type="checkbox" title="전체 선택" checked={stats.warning.length > 0 && selectedWarningIds.size === stats.warning.length} onChange={toggleAllWarnings} className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer" />
                                                                 </th>
                                                                <th className="px-3 py-3 w-10 text-center">핀</th>
                                                                <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right">시화재고</th>
                                                                <th className="px-5 py-3 text-right">권장발주량</th>
                                                                <th className="px-5 py-3 text-right">대기중</th>
                                                                <th className="px-5 py-3 text-right">대경재고</th>
                                                                <th className="px-5 py-3 text-right">매입단가</th>
                                                                <th className="px-5 py-3 text-right">필요예산</th>
                                                                <th className="px-5 py-3 text-center">건전성 등급</th>
                                                                <th className="px-5 py-3">💡 분석 근거</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {stats.warning.map(row => (
<tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
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
                                                                     <td className="px-3 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                                         <button
                                                                             onClick={() => {
                                                                                 setPinnedItemIds(prev => {
                                                                                     const next = new Set(prev);
                                                                                     if (next.has(row.product.id)) next.delete(row.product.id);
                                                                                     else next.add(row.product.id);
                                                                                     return next;
                                                                                 });
                                                                             }}
                                                                             className={`p-1.5 rounded-lg hover:bg-slate-100 transition ${pinnedItemIds.has(row.product.id) ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'}`}
                                                                             title={pinnedItemIds.has(row.product.id) ? '핀 고정 해제' : '최상단 핀 고정'}
                                                                         >
                                                                             <Pin className={`w-4 h-4 ${pinnedItemIds.has(row.product.id) ? 'fill-current' : ''}`} />
                                                                         </button>
                                                                     </td>
                                                                    <td className="px-5 py-4">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-sm ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' : row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' : row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' : row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{row.healthGrade}급</span>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setSelectedIntelligenceItem(row);
                                                                                }}
                                                                                className="font-mono font-bold text-slate-900 text-sm hover:text-indigo-600 transition-colors flex items-center gap-1 group text-left"
                                                                            >
                                                                                {row.product.id}
                                                                                <Info className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-black font-mono text-amber-600 bg-amber-50 text-base">
                                                                        {row.shQty}
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-black font-mono text-indigo-600">
                                                                        {row.recommendedQty}
                                                                        <div className="text-[10px] font-normal text-slate-400 mt-1">/ 총판매:{row.salesVolume}</div>
                                                                    </td>
                                                                    <td className="px-5 py-4 text-center font-bold text-slate-500">
                                                                        {row.pendingOrderQty > 0 ? (
                                                                            <div className="flex flex-col items-center">
                                                                                <span className="text-blue-600 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-md font-black shadow-sm">+{row.pendingOrderQty}</span>
                                                                                {row.pendingOrderDetails && row.pendingOrderDetails.length > 0 && (
                                                                                    <div className="text-[10px] text-slate-500 mt-1 space-y-0.5 max-w-37.5 overflow-hidden text-ellipsis">
                                                                                        {row.pendingOrderDetails.map((d, idx) => (
                                                                                            <div key={idx} className="whitespace-nowrap" title={`${d.poNumber}${d.deliveryDate ? ` (납기: ${d.deliveryDate})` : ''}`}>
                                                                                                <span className="font-mono bg-slate-100 px-1 rounded text-slate-600 border border-slate-200">{d.poNumber.slice(-8)}</span>
                                                                                                {d.deliveryDate && (
                                                                                                    <span className="text-indigo-500 ml-1">({new Date(d.deliveryDate).toLocaleDateString('ko-KR', {month: 'numeric', day: 'numeric'})})</span>
                                                                                                )}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ) : <span className="text-slate-300">-</span>}
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right">
                                                                        <span className="px-2 py-1 bg-teal-50 text-teal-700 font-extrabold font-mono rounded-lg border border-teal-200 shadow-sm">{row.ysQty}</span>
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                    <td className="px-5 py-4 text-right font-black text-amber-700 bg-amber-50/30">{formatCur(row.recentPurchasePrice * row.recommendedQty)}</td>
                                                                    <td className="px-5 py-4 text-right font-mono text-slate-400 text-xs">
                                                                        {row.compSales > 0 ? (
                                                                            <span>{row.compSales.toLocaleString()}</span>
                                                                        ) : <span className="text-slate-200">—</span>}
                                                                    </td>
                                                                    <td className="px-5 py-4 text-center border-l border-slate-100">
                                                                        <div className="flex flex-col items-center gap-1">
                                                                            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                                    row.healthGrade === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                                        row.healthGrade === 'C' ? 'bg-blue-100 text-blue-600' :
                                                                                            row.healthGrade === 'D' ? 'bg-rose-100 text-rose-600' :
                                                                                                'bg-slate-100 text-slate-400'
                                                                                }`}>
                                                                                {row.healthGrade === 'A' ? 'A급' :
                                                                                    row.healthGrade === 'B' ? 'B급' :
                                                                                        row.healthGrade === 'C' ? 'C급' :
                                                                                            row.healthGrade === 'D' ? 'D급' : '—'}
                                                                            </span>
                                                                            <span className="text-xs font-mono text-slate-500">
                                                                                {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '—'}
                                                                            </span>
                                                                        </div>
                                                                    </td>

                                                                    <td className="px-5 py-4">
                                                                        <div className="flex flex-col gap-0.5">
                                                                            <div className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                                                                                <Info className="w-4 h-4 text-amber-500" />
                                                                                <span className="text-rose-600">권장발주량 {row.recommendedQty}개</span> (결품 {row.deficit}개)
                                                                            </div>
                                                                            <div className="text-xs text-slate-500 pl-5">
                                                                                등급: <strong className={`font-black ${row.healthGrade === 'A' ? 'text-emerald-600' : row.healthGrade === 'B' ? 'text-blue-600' : row.healthGrade === 'C' ? 'text-amber-500' : 'text-rose-500'}`}>{row.healthGrade}급</strong> | 최근 판매: <strong className="text-indigo-600">{row.recent60dSales}개(60일)</strong> / 연 총 {row.salesVolume}개
                                                                            </div>
                                                                            <div className="text-[11px] text-slate-400 pl-5 mt-0.5">
                                                                                목표 재고 {row.safeStock}개 대비 현재 {row.shQty}개 보유 중 (ROP: {row.reorderPoint}개)
                                                                                {row.isExcessStock && (
                                                                                    <span className="text-amber-500 font-bold ml-1">[과잉 {row.shQty - row.safeStock > 0 ? row.shQty - row.safeStock : row.shQty}개 초과]</span>
                                                                                )}
                                                                                {row.isDeadStock && (
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
                                                                 <td colSpan={4} className="px-5 py-4">
                                                                    <button onClick={() => handleCreateOrder(selectedWarningIds, 'WARNING')} disabled={selectedWarningIds.size === 0} className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${selectedWarningIds.size > 0 ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                                                                        <span>선택 품목 발주서 만들기 ({selectedWarningIds.size}건)</span>
                                                                        <ChevronRight className="w-4 h-4" />
                                                                    </button>
                                                                </td>
                                                                <td colSpan={6} className="px-5 py-4 text-right font-bold text-slate-700 relative">
                                                                    {(() => {
                                                                        const selectedItems = stats.warning.filter(item => selectedWarningIds.has(item.product.id));
                                                                        const negoEligibleCount = selectedItems.filter(item => (item.recentPurchasePrice * (item.deficit > 0 ? item.deficit : 1)) >= 20_000_000).length;
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
                                                {expandedGroups['REGULAR'] ? <ChevronDown className="w-5 h-5 text-indigo-600" /> : <ChevronRight className="w-5 h-5 text-indigo-600" />}
                                                <h3 className="font-bold text-indigo-800 text-lg flex flex-wrap items-center gap-2">
                                                    <span>♻️ 정기 발주 예측</span>
                                                    <span className="text-sm font-medium text-indigo-500">(우량 품목 2개월분 선주문 권장)</span>
                                                    <span className="text-sm font-bold bg-indigo-100/70 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 tracking-tight">
                                                        [산출식: 2개월 예상소요량 - 현재고 | 발주단위: 50~500개 (Size≥100A는 별도캡)]
                                                    </span>
                                                </h3>
                                            </div>
                                            <span className="bg-indigo-200 text-indigo-800 font-black px-3 py-1 rounded-full text-sm">{stats.regular.length}건</span>
                                        </button>

                                        {expandedGroups['REGULAR'] && (
                                            <div className="bg-white border-t border-indigo-100 overflow-x-auto overflow-y-auto max-h-150 custom-scrollbar">
                                                {stats.regular.length > 0 ? (
                                                    <table className="w-full text-sm text-left whitespace-nowrap">
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none sticky top-0 z-10 shadow-sm">
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
                                                                <th className="px-3 py-3 w-10 text-center">핀</th>
                                                                <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('safeStock')}>적정재고(목표) {sortConfig.key === 'safeStock' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key === 'shQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-center">판매/보충 이력</th>
                                                                <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition text-center" onClick={() => handleSort('ysQty')}>대경재고 {sortConfig.key === 'ysQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right">매입단가</th>
                                                                <th className="px-5 py-3 text-center cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('healthGrade')}>건전성 등급 {sortConfig.key === 'healthGrade' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                                <th className="px-5 py-3 text-right w-40">추천 발주량</th>
                                                                <th className="px-5 py-3">💡 분석 근거</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {stats.regular.map(row => (
<tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
                                                                     <td className="px-5 py-4 text-center">
                                                                         <input type="checkbox" title="품목 선택" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                                                                             onClick={(e) => e.stopPropagation()}
                                                                             checked={selectedRegularIds.has(row.product.id)}
                                                                             onChange={(e) => {
                                                                                 const newSet = new Set(selectedRegularIds);
                                                                                 if (e.target.checked) newSet.add(row.product.id);
                                                                                 else newSet.delete(row.product.id);
                                                                                 setSelectedRegularIds(newSet);
                                                                             }}
                                                                         />
                                                                     </td>
                                                                     <td className="px-3 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                                         <button
                                                                             onClick={() => {
                                                                                 setPinnedItemIds(prev => {
                                                                                     const next = new Set(prev);
                                                                                     if (next.has(row.product.id)) next.delete(row.product.id);
                                                                                     else next.add(row.product.id);
                                                                                     return next;
                                                                                 });
                                                                             }}
                                                                             className={`p-1.5 rounded-lg hover:bg-slate-100 transition ${pinnedItemIds.has(row.product.id) ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'}`}
                                                                             title={pinnedItemIds.has(row.product.id) ? '핀 고정 해제' : '최상단 핀 고정'}
                                                                         >
                                                                             <Pin className={`w-4 h-4 ${pinnedItemIds.has(row.product.id) ? 'fill-current' : ''}`} />
                                                                         </button>
                                                                     </td>
                                                                    <td className="px-5 py-4">
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setSelectedIntelligenceItem(row);
                                                                                }}
                                                                                className="font-mono font-bold text-slate-900 text-sm hover:text-indigo-600 transition-colors flex items-center gap-1 group text-left"
                                                                            >
                                                                                {row.product.id}
                                                                                <Info className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-mono text-indigo-500 text-sm">{row.safeStock}</td>
                                                                    <td className="px-5 py-4 text-right font-black font-mono text-indigo-600 bg-indigo-50 text-base">{row.shQty}</td>
                                                                    <td className="px-5 py-4 text-center text-xs font-medium text-slate-500">
                                                                        연 {row.salesFreq}회 판매 / 누적 {row.salesVolume}개
                                                                    </td>
                                                                    <td className="px-5 py-4 text-center font-bold font-mono text-slate-500">
                                                                        {row.ysQty > 0 ? <span className="text-teal-600">{row.ysQty}</span> : <span className="text-rose-400">0</span>}
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                    <td className="px-5 py-4 text-center">
                                                                        <div className="flex flex-col items-center gap-1">
                                                                            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                                    row.healthGrade === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                                        row.healthGrade === 'C' ? 'bg-blue-100 text-blue-600' :
                                                                                            row.healthGrade === 'D' ? 'bg-rose-100 text-rose-600' :
                                                                                                'bg-slate-100 text-slate-400'
                                                                                }`}>
                                                                                {row.healthGrade === 'A' ? 'A급' :
                                                                                    row.healthGrade === 'B' ? 'B급' :
                                                                                        row.healthGrade === 'C' ? 'C급' :
                                                                                            row.healthGrade === 'D' ? 'D급' : '—'}
                                                                            </span>
                                                                            <span className="text-xs font-mono text-slate-500">
                                                                                {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '—'}
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-5 py-4 text-right font-black text-indigo-600 bg-indigo-50/30">
                                                                        {row.recommendedQty}
                                                                    </td>
                                                                    <td className="px-5 py-4">
                                                                        <div className="flex flex-col gap-0.5">
                                                                            <div className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                                                                                <Activity className="w-4 h-4 text-indigo-500" />
                                                                                {row.canTransfer ? (
                                                                                    <span className="text-emerald-600">대경이송 가능 (권장발주량 0개)</span>
                                                                                ) : (
                                                                                    <span>전략 목표치 <span className="text-indigo-600">{row.recommendedQty}</span>개 권장</span>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-xs text-slate-500 pl-5">
                                                                                월평균 {Math.round(row.salesVolume / 12)}개 소요 (회전율 기반)
                                                                            </div>
                                                                            <div className="border-t border-slate-100 pt-1.5 mt-1 pl-5">
                                                                                {row.canTransfer ? (
                                                                                    <div className="text-xs font-bold text-emerald-600 flex flex-col gap-0.5">
                                                                                        <span className="flex items-center gap-1">🟢 대경 평균재고 충분 (3개월 평균: {(daekyungStockMap.get(row.product.id)?.avg3m ?? row.ysQty)}개) → 이송 조달 추천</span>
                                                                                        <span className="text-[11px] text-slate-500 font-normal">
                                                                                            평균 재고가 시화 필요량({row.recommendedQty || Math.ceil((row.recent60dSales > 0 ? row.recent60dSales / 40 : row.salesVolume / 250 * 0.2) * 40)}개)보다 많아 발주 불필요
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="text-xs font-bold text-rose-600 flex flex-col gap-0.5">
                                                                                        <span className="flex items-center gap-1">🔴 대경 평균재고 부족 (3개월 평균: {(daekyungStockMap.get(row.product.id)?.avg3m ?? row.ysQty)}개) → 신규 발주 요망</span>
                                                                                        <span className="text-[11px] text-slate-500 font-normal">
                                                                                            대경 평균재고가 부족하여 신규 발주({row.recommendedQty}개)를 통한 보충이 필요합니다.
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
<tfoot className="bg-indigo-50/50 border-t-2 border-indigo-200">
                                                             <tr>
                                                                 <td colSpan={7} className="px-5 py-4">
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
                                                        <span className="font-bold text-sm">전체 발주 대기 (PENDING - 누적)</span>
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
                                            <div className="p-0 flex-1 h-80 overflow-y-auto">
                                                {historyLoading ? (
                                                    <div className="p-8 text-center text-slate-400">불러오는 중입니다...</div>
                                                ) : historyData.inventoryHistory.length === 0 ? (
                                                    <div className="p-8 text-center text-slate-400">최근 변동 이력이 없습니다.</div>
                                                ) : (
                                                    <div className="p-0">
                                                        {groupedDailyTrend.map((group, idx) => {
                                                             let dailyRevenue = 0;
                                                             let dailyCost = 0;
                                                             let outgoingCount = 0;
                                                             let incomingCount = 0;
                                                             let outgoingQty = 0;
                                                             let incomingQty = 0;

                                                             const itemsList = Object.values(group.items);
                                                             itemsList.forEach(({ product, incoming, outgoing }) => {
                                                                 const analysis = analyzedInventory.find(ai => ai.product.id === product.id);
                                                                 if (outgoing > 0) {
                                                                     dailyRevenue += outgoing * (analysis ? analysis.sellingPrice : 0);
                                                                     outgoingCount++;
                                                                     outgoingQty += outgoing;
                                                                 }
                                                                 if (incoming > 0) {
                                                                     dailyCost += incoming * (analysis ? analysis.recentPurchasePrice : 0);
                                                                     incomingCount++;
                                                                     incomingQty += incoming;
                                                                 }
                                                             });

                                                             const isGroupExpanded = expandedDailyGroups[group.date] ?? (idx === 0);

                                                             return (
                                                                 <div key={group.date} className="border-b border-slate-100 last:border-0 p-4">
                                                                     <div className="flex flex-col gap-2 mb-3">
                                                                         <div className="flex items-center justify-between">
                                                                             <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-mono font-bold hover:bg-slate-300 cursor-pointer transition-colors" onClick={() => toggleDailyGroup(group.date)}>{group.date}</span>
                                                                             <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                                                                                 <span>총 {itemsList.length}건</span>
                                                                                 <span className="text-slate-300">|</span>
                                                                                 <span className="text-blue-600 font-bold">출고 {outgoingCount}건 ({outgoingQty.toLocaleString()}개)</span>
                                                                                 <span className="text-slate-300">|</span>
                                                                                 <span className="text-emerald-600 font-bold">입고 {incomingCount}건 ({incomingQty.toLocaleString()}개)</span>
                                                                             </div>
                                                                         </div>

                                                                        {(dailyRevenue > 0 || dailyCost > 0) && (
                                                                            <div
                                                                                className="flex items-center gap-3 mt-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:bg-slate-100 transition-colors"
                                                                                onClick={() => toggleDailyGroup(group.date)}
                                                                            >
                                                                                <div className="flex flex-col flex-1 pl-2 border-l-4 border-blue-400">
                                                                                    <span className="text-[10px] text-slate-500 font-bold tracking-tight">출고액(추정)</span>
                                                                                    <span className="text-sm font-black text-blue-700">₩{formatCur(dailyRevenue)}</span>
                                                                                </div>
                                                                                <div className="w-px h-8 bg-slate-200"></div>
                                                                                <div className="flex flex-col flex-1 pl-2 border-l-4 border-emerald-400">
                                                                                    <span className="text-[10px] text-slate-500 font-bold tracking-tight">입고액(추정)</span>
                                                                                    <span className="text-sm font-black text-emerald-700">₩{formatCur(dailyCost)}</span>
                                                                                </div>
                                                                                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`} />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    {isGroupExpanded && (
                                                                        <div className="grid grid-cols-1 gap-2 mt-2">
                                                                            {itemsList.sort((a, b) => {
                                                                                const aiA = analyzedInventory.find(ai => ai.product.id === a.product.id);
                                                                                const aiB = analyzedInventory.find(ai => ai.product.id === b.product.id);
                                                                                return (aiB ? aiB.deficit : 0) - (aiA ? aiA.deficit : 0);
                                                                            }).map(item => {
                                                                                const rowKey = `${group.date}-${item.product.id}`;
                                                                                const isExpanded = !!expandedTrendItems[rowKey];
                                                                                const analysis = analyzedInventory.find(ai => ai.product.id === item.product.id);

                                                                                const sellingPrice = analysis ? analysis.sellingPrice : 0;
                                                                                const purchasePrice = analysis ? analysis.recentPurchasePrice : 0;

                                                                                const valueChips = [];
                                                                                if (item.outgoing > 0) {
                                                                                    valueChips.push({
                                                                                        label: `출고수량 ${item.outgoing}개`,
                                                                                        amt: `출고액 ${formatCur(item.outgoing * sellingPrice)}원`,
                                                                                        style: 'text-blue-700 bg-blue-50 border border-blue-200'
                                                                                    });
                                                                                }
                                                                                if (item.incoming > 0) {
                                                                                    valueChips.push({
                                                                                        label: `입고수량 ${item.incoming}개`,
                                                                                        amt: `입고액 ${formatCur(item.incoming * purchasePrice)}원`,
                                                                                        style: 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                                                                    });
                                                                                }

                                                                                const finalId = item.product.id || '알수없음';
                                                                                const isNetIncoming = item.incoming >= item.outgoing;

                                                                                return (
                                                                                    <div key={rowKey} className={`flex flex-col text-xs bg-white rounded border border-slate-100 border-l-4 ${isNetIncoming ? 'border-l-emerald-500' : 'border-l-blue-500'}`}>
                                                                                        <div
                                                                                            className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-50 transition-colors"
                                                                                            onClick={() => toggleTrendItem(rowKey)}
                                                                                        >
                                                                                            <div className="flex flex-col flex-1 min-w-0 pr-2">
                                                                                                <span className="font-bold text-slate-700 font-mono truncate" title={finalId}>{finalId}</span>
                                                                                                {item.product.name && item.product.name !== finalId && <span className="text-[10px] text-slate-400 truncate">{item.product.name}</span>}
                                                                                            </div>
                                                                                            <div className="flex items-center gap-2 shrink-0">
                                                                                                <div className="flex flex-col items-end gap-1">
                                                                                                    <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-50">
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
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                                            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 shrink-0">
                                                <div className="flex items-center bg-slate-200/60 p-1 rounded-lg">
                                                    <button
                                                        onClick={() => setTrendRightTab('TOP_SALES')}
                                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${trendRightTab === 'TOP_SALES' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                                                    >
                                                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                                                        판매 TOP
                                                    </button>
                                                    <button
                                                        onClick={() => setTrendRightTab('SURGING_DEMAND')}
                                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${trendRightTab === 'SURGING_DEMAND' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                                                    >
                                                        🔥 주문 급상승 ({analyzedInventory.filter(r => r.isSurgingDemand).length})
                                                    </button>
                                                </div>
                                                {trendRightTab === 'TOP_SALES' && (
                                                    <select
                                                        title="조회 기간"
                                                        aria-label="조회 기간"
                                                        value={topPeriod}
                                                        onChange={(e) => setTopPeriod(e.target.value as '7D' | '30D' | '60D' | '90D' | '180D')}
                                                        className="bg-white border border-slate-300 rounded text-xs py-1 px-2 text-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden font-bold cursor-pointer"
                                                    >
                                                        <option value="7D">최근 7일</option>
                                                        <option value="30D">최근 30일</option>
                                                        <option value="60D">최근 60일</option>
                                                        <option value="90D">최근 90일</option>
                                                        <option value="180D">최근 180일</option>
                                                    </select>
                                                )}
                                            </div>
                                            <div className="p-0 flex-1 h-80 overflow-y-auto bg-slate-50/30">
                                                {trendRightTab === 'TOP_SALES' ? (
                                                    <div className="grid grid-cols-1 divide-y divide-slate-100">
                                                        {(() => {
                                                            const field = topPeriod === '7D' ? 'recent7dSales' :
                                                                          topPeriod === '60D' ? 'recent60dSales' :
                                                                          topPeriod === '90D' ? 'recent90dSales' :
                                                                          topPeriod === '180D' ? 'recent180dSales' :
                                                                          'recent30dSales';

                                                            const topItems = [...analyzedInventory]
                                                                .filter(item => (item[field] as number) > 0 && !item.product.id.startsWith('STUBEND') && item.sellingPrice > 0)
                                                                .sort((a, b) => (b[field] as number) - (a[field] as number))
                                                                .slice(0, 50);

                                                            if (topItems.length === 0) {
                                                                return <div className="p-8 text-center text-slate-400">데이터가 없습니다.</div>;
                                                            }

                                                            return topItems.map((item, idx) => (
                                                                <div key={item.product.id} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer" onClick={() => setSelectedIntelligenceItem(item)}>
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
                                                                            <span className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-bold">{item.salesFreq.toLocaleString()}회발생</span>
                                                                            <span className="font-black text-slate-700 text-sm drop-shadow-sm">{(item[field] as number).toLocaleString()} <span className="font-normal text-[10px] text-slate-400">개</span></span>
                                                                        </div>
                                                                        <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded truncate max-w-20" title={`기간누적매출 ${formatCur((item[field] as number) * item.sellingPrice)}원`}>
                                                                            ₩{formatCur((item[field] as number) * item.sellingPrice)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ));
                                                        })()}
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 divide-y divide-slate-100">
                                                        {(() => {
                                                            const surgingItems = [...analyzedInventory]
                                                                .filter(r => r.isSurgingDemand)
                                                                .sort((a, b) => b.recent7dSales - a.recent7dSales || b.recent30dSales - a.recent30dSales);

                                                            if (surgingItems.length === 0) {
                                                                return (
                                                                    <div className="p-8 text-center text-slate-400 text-xs font-medium">
                                                                        현재 최근 주문이 급상승한 품목이 없습니다.
                                                                    </div>
                                                                );
                                                            }

                                                            return surgingItems.map((item, idx) => (
                                                                <div key={item.product.id} className="p-3 hover:bg-rose-50/40 transition-colors flex items-center justify-between cursor-pointer" onClick={() => setSelectedIntelligenceItem(item)}>
                                                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                                                        <div className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-[10px] font-black shrink-0">
                                                                            🔥{idx + 1}
                                                                        </div>
                                                                        <div className="flex flex-col min-w-0 pr-1">
                                                                            <span className="font-bold text-slate-800 text-xs font-mono truncate" title={item.product.id}>{item.product.id}</span>
                                                                            <span className="text-[10px] text-rose-600 font-medium truncate">{item.surgeReason || '소요량 폭증'}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex flex-col items-end shrink-0 pl-1">
                                                                        <span className="text-xs font-black text-rose-600">
                                                                            7일: {item.recent7dSales}개 / 30일: {item.recent30dSales}개
                                                                        </span>
                                                                        <span className="text-[10px] text-slate-500">
                                                                            시화재고: <span className="font-bold text-slate-700">{item.shQty}개</span>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ));
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* TAB 3: ALL TABLE WITH SORTING */}
                            {activeTab === 'ALL_TABLE' && (
                                <div className="space-y-4 overflow-x-auto overflow-y-auto max-h-200 custom-scrollbar pb-4 bg-white">
                                    <table className="w-full text-left text-sm whitespace-nowrap min-w-[1000px]">
                                        <thead className="text-slate-500 font-bold bg-slate-50 border-y border-slate-200 select-none sticky top-0 z-10 shadow-sm">
                                            <tr className="text-xs uppercase tracking-wider text-slate-500 font-bold border-b-2 border-slate-200">
<th className="px-3 py-3 w-10 text-center border-r border-slate-200">
                                                     <span className="text-[10px] text-slate-400">선택</span>
                                                 </th>
                                                <th className="px-3 py-3 w-10 text-center border-r border-slate-200"><span className="text-[10px] text-slate-400">핀</span></th>
                                                <th className="px-4 py-3 group relative text-left">
                                                    <div className="flex items-center gap-2">
                                                        <span className="cursor-pointer hover:text-slate-800 transition" onClick={() => handleSort('id')}>
                                                            품목 ID {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </span>
                                                        <span className="text-[10px] bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded cursor-pointer hover:bg-indigo-100 transition border border-indigo-100" onClick={() => handleSort('statusRank')} title="태그(상태) 우선순위로 정렬합니다">
                                                            태그정렬 {sortConfig.key === 'statusRank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </span>
                                                        <div className="relative">
                                                            <button
                                                                onClick={() => setIsTagFilterOpen(!isTagFilterOpen)}
                                                                className={`p-1 rounded transition ${activeTagFilters.length > 0 ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-200'}`}
                                                                title="태그로 필터링"
                                                            >
                                                                <Filter size={14} className={activeTagFilters.length > 0 ? 'fill-current' : ''} />
                                                            </button>
                                                            {isTagFilterOpen && (
                                                                <div className="absolute top-full left-0 mt-1 w-36 bg-white border border-slate-200 shadow-xl rounded-lg py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                                                                    <div className="px-3 pb-2 mb-2 border-b border-slate-100 flex justify-between items-center">
                                                                        <span className="text-[10px] font-black text-slate-500">필터 선택</span>
                                                                        {activeTagFilters.length > 0 && (
                                                                            <span className="text-[9px] text-rose-500 cursor-pointer hover:underline" onClick={() => setActiveTagFilters([])}>초기화</span>
                                                                        )}
                                                                    </div>
                                                                    {['선발주', '일반', '정기발주', '부족', '과잉', '악성'].map(tag => (
                                                                        <label key={tag} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs font-medium text-slate-700">
                                                                            <input
                                                                                type="checkbox"
                                                                                aria-label={`${tag} 필터`}
                                                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                                                checked={activeTagFilters.includes(tag)}
                                                                                onChange={() => toggleTagFilter(tag)}
                                                                            />
                                                                            {tag}
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </th>
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
                                                <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('turnoverRate')}>회전율 {sortConfig.key === 'turnoverRate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                <th className="px-4 py-3 text-center">
                                                    최근 실적(60일)
                                                    <div className="flex items-center justify-center gap-2 mt-1 text-[10px] font-bold">
                                                        <span className={`cursor-pointer transition ${sortConfig.key === 'quoteCount' ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-600'}`} onClick={() => handleSort('quoteCount')}>
                                                            견적순 {sortConfig.key === 'quoteCount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </span>
                                                        <span className="text-slate-300">|</span>
                                                        <span className={`cursor-pointer transition ${sortConfig.key === 'recent60dOrderCount' ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600'}`} onClick={() => handleSort('recent60dOrderCount')}>
                                                            발주순 {sortConfig.key === 'recent60dOrderCount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </span>
                                                    </div>
                                                </th>
                                                <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-amber-700" onClick={() => handleSort('salesVolume')}>판매이력 {sortConfig.key === 'salesVolume' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-indigo-700" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key === 'shQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-rose-600" onClick={() => handleSort('pendingOrderQty')}>입고대기 {sortConfig.key === 'pendingOrderQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('ysQty')}>대경 재고 {sortConfig.key === 'ysQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition group relative" onClick={() => handleSort('daysOnHand')}>
                                                    잔여일 {sortConfig.key === 'daysOnHand' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                                    <div className="absolute right-0 bottom-full mb-2 w-56 bg-slate-800 text-white text-[11px] p-3 rounded shadow-lg hidden group-hover:block z-50 text-left font-normal whitespace-normal cursor-auto">
                                                        <div className="font-bold mb-1 border-b border-slate-600 pb-1">잔여일 산출 로직</div>
                                                        <div className="text-slate-300 mb-1">현재 시화재고를 <span className="font-bold">일평균 판매량</span>으로 나눈 값으로, <span className="text-amber-300 font-bold">재발주 시점 산출 및 결품 예방</span>을 위해 사용됩니다.</div>
                                                        <div className="text-slate-400 text-[10px] mt-1">※ 무한대(∞)는 판매량 대비 재고가 너무 많아 소진 시점을 추정하기 어려운 상태를 의미합니다.</div>
                                                    </div>
                                                </th>
                                                <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-rose-500 font-black" onClick={() => handleSort('deficit')}>보충 {sortConfig.key === 'deficit' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                                <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-teal-700" onClick={() => handleSort('recentPurchasePrice')}>이익률(단가) {sortConfig.key === 'recentPurchasePrice' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {(() => {
                                                const criticalSet = new Set(stats.critical.map(i => i.product.id));
                                                const warningSet = new Set(stats.warning.map(i => i.product.id));
                                                const regularSet = new Set(stats.regular.map(i => i.product.id));

                                                const getStatusRank = (row: typeof analyzedInventory[0]) => {
                                                    if (criticalSet.has(row.product.id)) return 1;
                                                    if (warningSet.has(row.product.id)) return 2;
                                                    if (regularSet.has(row.product.id)) return 3;
                                                    if (row.deficit > 0) return 4;
                                                    if (row.isExcessStock) return 5;
                                                    if (row.isDeadStock) return 6;
                                                    return 99;
                                                };

                                                let displayList = [...analyzedInventory];

                                                if (activeTagFilters.length > 0) {
                                                    displayList = displayList.filter(row => {
                                                        const tags: string[] = [];
                                                        if (criticalSet.has(row.product.id)) tags.push('선발주');
                                                        if (warningSet.has(row.product.id)) tags.push('일반');
                                                        if (regularSet.has(row.product.id)) tags.push('정기발주');
                                                        if (row.deficit > 0) tags.push('부족');
                                                        if (row.isExcessStock) tags.push('과잉');
                                                        if (row.isDeadStock) tags.push('악성');

                                                        // Show row if it has AT LEAST ONE of the active filters
                                                        return activeTagFilters.some(filterTag => tags.includes(filterTag));
                                                    });
                                                }

                                                // Apply statusRank sorting if selected
                                                if (sortConfig.key === 'statusRank') {
                                                    const dir = sortConfig.direction === 'asc' ? 1 : -1;
                                                    displayList.sort((a, b) => {
                                                        const rankA = getStatusRank(a);
                                                        const rankB = getStatusRank(b);
                                                        if (rankA !== rankB) return (rankA - rankB) * dir;
                                                        return a.product.id.localeCompare(b.product.id);
                                                    });
                                                }

if (displayList.length === 0) {
                                                     return <tr><td colSpan={12} className="py-10 text-center text-slate-400 font-medium">해당 조건에 맞는 품목이 없습니다.</td></tr>;
                                                 }

                                                return displayList.slice(0, 500).map(row => {
                                                    const rowTags = [];
                                                    if (criticalSet.has(row.product.id)) rowTags.push({ label: '선발주', className: 'bg-rose-100 text-rose-700 border border-rose-200' });
                                                    if (warningSet.has(row.product.id)) rowTags.push({ label: '일반', className: 'bg-amber-100 text-amber-700 border border-amber-200' });
                                                    if (regularSet.has(row.product.id)) rowTags.push({ label: '정기발주', className: 'bg-indigo-100 text-indigo-700 border border-indigo-200' });
                                                    if (row.deficit > 0) rowTags.push({ label: '부족', className: 'bg-red-50 text-red-600 border border-red-100' });
                                                    if (row.isExcessStock) rowTags.push({ label: '과잉', className: 'bg-orange-100 text-orange-600 border border-orange-100' });
                                                    if (row.isDeadStock) rowTags.push({ label: '악성', className: 'bg-slate-100 text-slate-500 border border-slate-200' });

                                                    return (
<tr key={row.product.id} className={`hover:bg-slate-50 group cursor-pointer ${selectedAllTableIds.has(row.product.id) ? 'bg-indigo-50/50' : ''}`} onClick={() => setSelectedIntelligenceItem(row)}>
                                                             <td className="px-3 py-2 text-center border-r border-slate-100">
                                                                 <input
                                                                     type="checkbox"
                                                                     aria-label={`${row.product.id} 품목 선택`}
                                                                     className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                                     checked={selectedAllTableIds.has(row.product.id)}
                                                                     onChange={(e) => {
                                                                         setSelectedAllTableIds(prev => {
                                                                             const next = new Set(prev);
                                                                             if (e.target.checked) next.add(row.product.id);
                                                                             else next.delete(row.product.id);
                                                                             return next;
                                                                         });
                                                                     }}
                                                                     onClick={(e) => e.stopPropagation()}
                                                                 />
                                                             </td>
                                                            <td className="px-3 py-2 text-center border-r border-slate-100" onClick={(e) => e.stopPropagation()}>
                                                                <button
                                                                    onClick={() => {
                                                                        setPinnedItemIds(prev => {
                                                                            const next = new Set(prev);
                                                                            if (next.has(row.product.id)) next.delete(row.product.id);
                                                                            else next.add(row.product.id);
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className={`p-1 rounded-lg hover:bg-slate-100 transition ${pinnedItemIds.has(row.product.id) ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'}`}
                                                                    title={pinnedItemIds.has(row.product.id) ? '핀 고정 해제' : '최상단 핀 고정'}
                                                                >
                                                                    <Pin className={`w-3.5 h-3.5 ${pinnedItemIds.has(row.product.id) ? 'fill-current' : ''}`} />
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-2 font-mono font-bold text-slate-700">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setSelectedIntelligenceItem(row);
                                                                        }}
                                                                        className="font-mono font-bold text-slate-900 text-sm hover:text-indigo-600 transition-colors flex items-center gap-1 group text-left"
                                                                    >
                                                                        {row.product.id === 'UNKNOWN' && row.product.name ? `UNKNOWN (${row.product.name})` : row.product.id}
                                                                        <Info className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                    </button>
                                                                    {rowTags.map((tag, idx) => (
                                                                        <span
                                                                            key={idx}
                                                                            className={`text-[9px] px-1 py-0.5 rounded font-black tracking-tight cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-300 transition ${tag.className} ${activeTagFilters.includes(tag.label) ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                toggleTagFilter(tag.label);
                                                                            }}
                                                                            title="클릭하여 필터 토글"
                                                                        >
                                                                            {tag.label}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-black ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
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
                                                                        <span className={`text-[10px] font-black px-1.5 rounded ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
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
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className="font-black text-slate-800 text-[12px]">
                                                                        {row.recent60dSales.toLocaleString()}<span className="text-[10px] text-slate-500 font-bold ml-0.5 mr-1">개 /</span>{row.recent60dOrderCount.toLocaleString()}<span className="text-[10px] text-slate-500 font-bold ml-0.5">회출고</span>
                                                                    </span>
                                                                    <div className="flex items-center gap-1 text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 shadow-sm">
                                                                        <span className="text-slate-500 font-bold">견적</span><span className="font-black text-indigo-600">{row.quoteCount.toLocaleString()}</span><span className="text-slate-400">건</span>
                                                                        <span className="w-px h-2.5 bg-slate-300 mx-0.5"></span>
                                                                        <span className="text-slate-500 font-bold">발주</span><span className="font-black text-emerald-600">{row.recent60dOrderCount.toLocaleString()}</span><span className="text-slate-400">건</span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2 text-right text-slate-600">
                                                                {row.salesVolume > 0 ? (
                                                                    <span><span className="font-bold text-slate-800">{row.salesVolume.toLocaleString()}</span> <span className="text-[10px] text-slate-500">({row.salesFreq.toLocaleString()}회)</span></span>
                                                                ) : '-'}
                                                            </td>
                                                            <td className="px-4 py-2 text-right font-black font-mono text-indigo-600 bg-indigo-50/20">
                                                                <div className="flex flex-col items-end gap-0.5">
                                                                    <span>{row.shQty.toLocaleString()}</span>
                                                                    <span className="text-[10px] font-normal tracking-tight text-slate-500">적정: {row.safeStock.toLocaleString()}개</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2 text-right font-bold font-mono text-rose-500">
                                                                {row.pendingOrderQty > 0 ? `+${row.pendingOrderQty.toLocaleString()}` : <span className="text-slate-300">0</span>}
                                                            </td>
                                                            <td className="px-4 py-2 text-center font-bold font-mono text-slate-500">
                                                                {row.ysQty > 0 ? <span className="text-teal-600">{row.ysQty.toLocaleString()}</span> : <span className="text-rose-400">0</span>}
                                                            </td>
                                                            <td className="px-4 py-2 text-right font-mono text-xs">
                                                                <span className={
                                                                    row.daysOnHand <= 10 ? 'text-rose-600 font-bold' :
                                                                        row.daysOnHand <= 30 ? 'text-amber-500 font-bold' :
                                                                            row.daysOnHand > 365 ? 'text-slate-300' :
                                                                                'text-slate-600'
                                                                }>
                                                                    {row.shQty === 0 ? '0일' :
                                                                        row.daysOnHand === 9999 ? '∞' :
                                                                            `${Math.round(row.daysOnHand)}일`}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2 text-right font-black text-rose-600 bg-rose-50/30">
                                                                {row.deficit > 0 ? `-${row.deficit.toLocaleString()}개` : <span className="text-slate-300 font-normal">충분</span>}
                                                            </td>
                                                            <td className="px-4 py-2 text-right">
                                                                <div className="flex flex-col items-end">
                                                                    <span className={`font-black text-xs ${row.profitMarginRate <= 0 ? 'text-rose-500' : row.profitMarginRate >= 30 ? 'text-emerald-600' : 'text-slate-700'}`}>{row.profitMarginRate}%</span>
                                                                    <span className="text-[9px] text-slate-400 font-mono">단가 {formatCur(row.recentPurchasePrice)}</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                    </table>
                                    {selectedAllTableIds.size > 0 && (
                                        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] border border-slate-700 px-6 py-3 flex items-center gap-6 z-100 animate-in slide-in-from-bottom-10 fade-in duration-300">
                                            <div className="font-bold text-white">
                                                <span className="text-indigo-400 font-black text-xl">{selectedAllTableIds.size}</span>
                                                <span className="text-slate-300 ml-2">개 품목 선택됨</span>
                                            </div>
                                            <div className="w-px h-6 bg-slate-600"></div>
                                            <button
                                                onClick={handleCreateManualOrder}
                                                className="bg-indigo-500 hover:bg-indigo-400 text-white font-bold px-6 py-2.5 rounded-full transition-colors shadow-lg flex items-center gap-2 border border-indigo-400"
                                            >
                                                <PackageSearch className="w-4 h-4" />
                                                선택 품목 장바구니에 담기
                                            </button>
                                            <button
                                                onClick={() => setSelectedAllTableIds(new Set())}
                                                className="text-slate-400 hover:text-white transition-colors"
                                                title="선택 해제"
                                            >
                                                <X className="w-5 h-5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ════════════════════════════════════════════════
    🩺 악성·과잉 재고 진단 탭
════════════════════════════════════════════════ */}
                            {activeTab === 'HEALTH_DIAGNOSIS' && (
                                <div className="space-y-5 p-4 md:p-0 pb-8 animate-in fade-in duration-300">

                                    {/* ── 🎯 1~3개월 구매 수급 & 데이터 기반 종합 진단 요약 리포트 ── */}
                                    <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-indigo-800/40 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3"></div>
                                        <div className="relative z-10 space-y-4">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-indigo-800/60 pb-4">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="bg-indigo-500 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full tracking-wider">
                                                            PROCUREMENT INTELLIGENCE
                                                        </span>
                                                        <span className="text-xs text-indigo-300 font-medium">직전 3개월 실수요 분석 기반</span>
                                                    </div>
                                                    <h2 className="text-xl font-black text-white mt-1 flex items-center gap-2">
                                                        <span>📊 다음 1~3개월 준비 구매 품목 선정 & 근거 종합 분석</span>
                                                    </h2>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold text-indigo-200 bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-xs">
                                                        분석 대상 품목: {analyzedInventory.length}개
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div className="bg-white/10 p-4 rounded-xl border border-white/10 backdrop-blur-xs">
                                                    <div className="text-xs text-rose-300 font-bold mb-1 flex items-center gap-1.5">
                                                        🚨 기회손실 최우선 긴급 수급
                                                    </div>
                                                    <div className="text-2xl font-black text-rose-400 font-mono">
                                                        {analyzedInventory.filter(r => r.isDoubleStockoutWithDemand).length}개 품목
                                                    </div>
                                                    <div className="text-[10px] text-slate-300 mt-1">
                                                        자사 0개 & 대경 0개 (최근 주문/견적 수요 존재)
                                                    </div>
                                                </div>

                                                <div className="bg-white/10 p-4 rounded-xl border border-white/10 backdrop-blur-xs">
                                                    <div className="text-xs text-amber-300 font-bold mb-1 flex items-center gap-1.5">
                                                        ⚠️ 안전재고 미달 (선발주 권장)
                                                    </div>
                                                    <div className="text-2xl font-black text-amber-400 font-mono">
                                                        {analyzedInventory.filter(r => r.shQty < r.safeStock && r.recommendedQty > 0).length}개 품목
                                                    </div>
                                                    <div className="text-[10px] text-slate-300 mt-1">
                                                        시화재고가 최소유지수준(Safety Stock) 이하
                                                    </div>
                                                </div>

                                                <div className="bg-white/10 p-4 rounded-xl border border-white/10 backdrop-blur-xs">
                                                    <div className="text-xs text-indigo-300 font-bold mb-1 flex items-center gap-1.5">
                                                        📦 총 권장 수급 요구량
                                                    </div>
                                                    <div className="text-2xl font-black text-indigo-300 font-mono">
                                                        {analyzedInventory.reduce((sum, r) => sum + (r.recommendedQty || 0), 0).toLocaleString()}개
                                                    </div>
                                                    <div className="text-[10px] text-slate-300 mt-1">
                                                        직전 3개월 월수요 및 리드타임 감안
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-slate-900/60 p-4 rounded-xl border border-indigo-900/60 text-xs leading-relaxed space-y-1.5">
                                                <div className="font-bold text-indigo-200 flex items-center gap-1.5">
                                                    💡 1~3개월 수급 전략 종합 판단 요약:
                                                </div>
                                                <p className="text-slate-200 font-normal">
                                                    1. <strong className="text-rose-300">🚨 최우선 긴급 수급 품목</strong>: 시화재고와 대경 본사 재고가 모두 0개인 상태에서 최근 주문/견적 수요가 발생하고 있는 품목입니다. 고객사 이탈 및 기회손실을 막기 위해 직전 3개월 수요 기반 즉시선발주 조치가 타당합니다.<br/>
                                                    2. <strong className="text-amber-300">⚠️ 적정 유지보유 품목</strong>: 최근 3개월간 꾸준히 주문이 유입되고 있으나 시화재고가 최소 안전재고 미달인 품목으로, 최소유지수량 이상 보유를 적극 추천합니다.<br/>
                                                    3. <strong className="text-slate-400">📉 보유 비권장/처분 품목</strong>: 직전 3개월간 수요가 저조하고 대경재고가 충분하거나 자사재고가 과다한 품목은 추가 구매를 일시 중단하고 처분을 권장합니다.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

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
                                                        <circle cx="56" cy="56" r="44" fill="none" stroke="#f1f5f9" strokeWidth="11" />
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
                                                    { value: healthDiagnosis.optimalStockValue, bgClass: 'bg-green-600', label: '적정·안전' },
                                                    { value: healthDiagnosis.excessStockValue, bgClass: 'bg-orange-600', label: '과잉' },
                                                    { value: healthDiagnosis.deadStockValue, bgClass: 'bg-rose-600', label: '악성' },
                                                    { value: healthDiagnosis.slowMoveValue, bgClass: 'bg-purple-600', label: '부진' },
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
                                                    { bgClass: 'bg-green-600', label: '적정·안전', value: healthDiagnosis.optimalStockValue },
                                                    { bgClass: 'bg-orange-600', label: '과잉재고 ⚠', value: healthDiagnosis.excessStockValue },
                                                    { bgClass: 'bg-rose-600', label: '악성재고 🚨', value: healthDiagnosis.deadStockValue },
                                                    { bgClass: 'bg-purple-600', label: '부진재고', value: healthDiagnosis.slowMoveValue },
                                                ].map(l => (
                                                    <div key={l.label} className="flex items-center gap-1.5 text-xs">
                                                        <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${l.bgClass}`}></div>
                                                        <span className="font-bold text-slate-600">{l.label}</span>
                                                        <span className="text-slate-400 font-mono">₩{formatCur(Math.round(l.value / 10000))}만</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* KPI 3개 */}
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                {[
                                                    { label: '묶인 자금 (악성+과잉)', value: `₩${formatCur(Math.round(healthDiagnosis.lockedCapital / 10000))}만`, color: 'text-rose-600', note: '해소 시 발주 여력 확보' },
                                                    { label: '매출 대비 재고 비율', value: `${(healthDiagnosis.its * 100).toFixed(1)}%`, color: healthDiagnosis.its > HEALTHY_ITS_MAX ? 'text-amber-600' : 'text-green-600', note: '쿠팡 기준 8~12%' },
                                                    { label: '처분 대상 품목', value: `${healthDiagnosis.urgentDisposalItems.length}개`, color: 'text-purple-600', note: '대경 반품 or 단가인하' },
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
                                            { id: 'DEAD', emoji: '☠️', label: '악성재고 품목', value: `${healthDiagnosis.deadStockItems.length}개`, sub: '90일+ 무판매 or 0.5x미만', color: 'rose', border: 'border-rose-400', amount: healthDiagnosis.deadStockValue },
                                            { id: 'EXCESS', emoji: '📦', label: '과잉재고 품목', value: `${healthDiagnosis.excessStockItems.length}개`, sub: '목표재고 200%+ 초과', color: 'orange', border: 'border-orange-400', amount: healthDiagnosis.excessStockValue },
                                            { id: 'SLOW', emoji: '🐌', label: '부진재고 품목', value: `${healthDiagnosis.slowMoveItems.length}개`, sub: 'D등급·잔여 90~180일', color: 'purple', border: 'border-purple-400', amount: healthDiagnosis.slowMoveValue },
                                            { id: 'MISSED', emoji: '🔍', label: '결품 기회손실', value: `${healthDiagnosis.missedDemandList.filter(m => m.count >= 2).length}건↑`, sub: '2회↑ 취소·철회 감지', color: 'blue', border: 'border-blue-400' },
                                            { id: 'MISSED', emoji: '🔍', label: '결품 기회손실', value: `${healthDiagnosis.missedDemandList.length}건`, sub: '견적/미결/취소 종합', color: 'blue', border: 'border-blue-400' },
                                            { id: 'URGENT', emoji: '💡', label: '즉시 처분 권장', value: `${healthDiagnosis.urgentDisposalItems.length}개`, sub: '대경반품 or 단가인하', color: 'teal', border: 'border-teal-400' },
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
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 sticky top-0 z-10 shadow-sm">
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
                                                                    <tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
                                                                        <td className="px-4 py-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-sm ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' : row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' : row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' : row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{row.healthGrade}급</span>
                                                                                <span className="font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right">
                                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${daysSince > 180 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                                {daysSince > 900 ? '판매이력없음' : `${daysSince}일`}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right font-mono font-bold text-rose-600">
                                                                            {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '0x'}
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right font-bold">{row.shQty.toLocaleString()}개</td>
                                                                        <td className="px-4 py-2 text-right font-black text-rose-600">{formatCur(itemValue)}원</td>
                                                                        <td className="px-4 py-2 text-right text-slate-400">{row.ysQty.toLocaleString()}개</td>
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
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 sticky top-0 z-10 shadow-sm">
                                                            <tr>
                                                                <th className="px-4 py-2">품목코드 (등급)</th>
                                                                <th className="px-4 py-2">분석근거 (과잉 사유)</th>
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
                                                                    const excessQty = (row._excessQty || 0);
                                                                    const excessValue = (row._excessValue || 0);
                                                                    const action = excessQty > row.safeStock
                                                                        ? '장기 발주 중단'
                                                                        : '이번 달 발주 보류';
                                                                    const actionColor = excessQty > row.safeStock
                                                                        ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                                                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200';

                                                                    return (
                                                                        <tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
                                                                            <td className="px-4 py-2">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-sm ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' : row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' : row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' : row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{row.healthGrade}급</span>
                                                                                    <span className="font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-2">
                                                                                <div className="flex flex-col gap-0.5">
                                                                                    <div className="text-[11px] font-bold text-orange-700 flex items-center gap-1">
                                                                                        <Info className="w-3 h-3" />
                                                                                        {row.daysOnHand > 180 ? '장기 체화 (잔여 180일 초과)' : `목표재고(${row.safeStock}개) 대비 과잉`}
                                                                                    </div>
                                                                                    <div className="text-[10px] text-slate-500">
                                                                                        최근 판매: <strong className="text-indigo-600">{row.recent60dSales}개(60일)</strong> / 연 총 {row.salesVolume}개
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-4 py-2 text-right font-black text-orange-600">{row.shQty.toLocaleString()}개</td>
                                                                            <td className="px-4 py-2 text-right text-slate-400">{row.safeStock.toLocaleString()}개</td>
                                                                            <td className="px-4 py-2 text-right">
                                                                                <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[9px] font-bold">+{excessQty.toLocaleString()}개</span>
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
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 sticky top-0 z-10 shadow-sm">
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
                                                                    <tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
                                                                        <td className="px-4 py-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-sm ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' : row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' : row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' : row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{row.healthGrade}급</span>
                                                                                <span className="font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right">
                                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700`}>
                                                                                {daysSince > 900 ? '판매이력없음' : `${daysSince}일`}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right font-mono font-bold text-purple-600">
                                                                            {row.turnoverRate > 0 ? `${row.turnoverRate}x` : '0x'}
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right font-bold">{row.shQty.toLocaleString()}개</td>
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
                                                        <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 sticky top-0 z-10 shadow-sm">
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
                                                                    <tr key={row.product.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedIntelligenceItem(row)}>
                                                                        <td className="px-4 py-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-sm ${row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' : row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' : row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' : row.healthGrade === 'D' ? 'bg-orange-100 text-orange-700' : row.healthGrade === 'E' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{row.healthGrade}급</span>
                                                                                <span className="font-mono font-bold text-slate-800 text-[10px]">{row.product.id}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right">
                                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${daysSince > 180 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                                {daysSince > 900 ? '판매이력없음' : `${daysSince}일`}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-right font-bold">{row.shQty.toLocaleString()}개</td>
                                                                        <td className="px-4 py-2 text-right font-black text-rose-600">{formatCur(itemValue)}원</td>
                                                                        <td className="px-4 py-2 text-right text-slate-400">{row.ysQty.toLocaleString()}개</td>
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
                                        <div id="missed-demand-section" className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden mt-4">
                                            {/* 헤더 */}
                                            <div className="px-5 py-4 bg-linear-to-r from-violet-50 to-indigo-50 border-b border-violet-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <div>
                                                    <div className="text-sm font-black text-violet-800 flex items-center gap-1.5">
                                                        <span>🔍 결품 기회비용 분석 (재고 부족으로 놓친 수요)</span>
                                                        <span className="text-[9px] bg-violet-600 text-white px-2 py-0.5 rounded-full font-bold">데이터 분석 완료</span>
                                                    </div>
                                                    <div className="text-[10px] text-violet-500 mt-0.5">
                                                        시화 및 대경재고가 없는 상태에서 고객의 견적 문의나 주문 시도 후 취소·철회된 이력 분석
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <div className="bg-white px-3 py-1.5 rounded-lg border border-violet-100 text-center sm:text-left shadow-xs">
                                                        <div className="text-[9px] text-slate-400 font-bold">총 결품 횟수</div>
                                                        <div className="text-sm font-black text-rose-600">{mdPeriodStats.totalOccurrences}회</div>
                                                    </div>
                                                    <div className="bg-white px-3 py-1.5 rounded-lg border border-violet-100 text-center sm:text-left shadow-xs">
                                                        <div className="text-[9px] text-slate-400 font-bold">총 문의 수량</div>
                                                        <div className="text-sm font-black text-amber-600">{mdPeriodStats.totalQuantity.toLocaleString()}개</div>
                                                    </div>
                                                    <div className="bg-white px-3 py-1.5 rounded-lg border border-violet-100 text-center sm:text-left shadow-xs">
                                                        <div className="text-[9px] text-violet-500 font-bold">추정 기회손실액</div>
                                                        <div className="text-sm font-black text-indigo-700">₩{formatCur(mdPeriodStats.totalLoss)}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 검색 및 필터 컨트롤 바 */}
                                            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col gap-3">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {/* 기간 필터 */}
                                                        <select
                                                            title="기간 필터"
                                                            aria-label="기간 필터"
                                                            value={mdPeriod}
                                                            onChange={(e) => setMdPeriod(e.target.value as 'ALL' | '7D' | '30D' | '60D')}
                                                            className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-violet-500 font-bold text-slate-700"
                                                        >
                                                            <option value="ALL">전체 기간</option>
                                                            <option value="7D">최근 7일</option>
                                                            <option value="30D">최근 30일</option>
                                                            <option value="60D">최근 60일</option>
                                                        </select>

                                                        {/* 검색창 */}
                                                        <div className="relative min-w-50 flex-1 max-w-xs">
                                                            <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-slate-400 text-xs">🔍</span>
                                                            <input
                                                                type="text"
                                                                placeholder="품명 검색..."
                                                                value={mdSearchQuery}
                                                                onChange={(e) => setMdSearchQuery(e.target.value)}
                                                                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-violet-500 placeholder-slate-400 font-medium"
                                                            />
                                                            {mdSearchQuery && (
                                                                <button 
                                                                    onClick={() => setMdSearchQuery('')}
                                                                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600 text-[10px]"
                                                                >
                                                                    ✕
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* 필터 초기화 버튼 */}
                                                        {(mdSearchQuery || mdFilterName || mdFilterThickness || mdFilterSize || mdFilterMaterial || mdPeriod !== 'ALL') && (
                                                            <button
                                                                onClick={() => {
                                                                    setMdSearchQuery('');
                                                                    setMdFilterName('');
                                                                    setMdFilterThickness('');
                                                                    setMdFilterSize('');
                                                                    setMdFilterMaterial('');
                                                                    setMdPeriod('ALL');
                                                                }}
                                                                className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs transition-colors"
                                                            >
                                                                필터 초기화 🔄
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* 레이아웃 토글 */}
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            onClick={() => setMdViewLayout('TABLE')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${mdViewLayout === 'TABLE' ? 'bg-violet-600 text-white shadow-xs' : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'}`}
                                                        >
                                                            📋 테이블 뷰
                                                        </button>
                                                        <button
                                                            onClick={() => setMdViewLayout('CARD')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${mdViewLayout === 'CARD' ? 'bg-violet-600 text-white shadow-xs' : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'}`}
                                                        >
                                                            🎴 카드 뷰
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* 4단 필터 그리드 (동일한 간격) */}
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-3 rounded-lg border border-slate-200">
                                                    {/* 품목명 필터 */}
                                                    <div className="flex flex-col gap-1">
                                                        <label htmlFor="md-filter-name" className="text-[10px] font-bold text-slate-500">품목명</label>
                                                        <select
                                                            id="md-filter-name"
                                                            value={mdFilterName}
                                                            onChange={(e) => setMdFilterName(e.target.value)}
                                                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-violet-500 font-medium"
                                                        >
                                                            <option value="">품목명 전체</option>
                                                            {mdFilterOptions.names.map(name => (
                                                                <option key={name} value={name}>{name}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* 두께 필터 */}
                                                    <div className="flex flex-col gap-1">
                                                        <label htmlFor="md-filter-thickness" className="text-[10px] font-bold text-slate-500">두께</label>
                                                        <select
                                                            id="md-filter-thickness"
                                                            value={mdFilterThickness}
                                                            onChange={(e) => setMdFilterThickness(e.target.value)}
                                                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-violet-500 font-medium"
                                                        >
                                                            <option value="">두께 전체</option>
                                                            {mdFilterOptions.thicknesses.map(t => (
                                                                <option key={t} value={t}>{t}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* 사이즈 필터 */}
                                                    <div className="flex flex-col gap-1">
                                                        <label htmlFor="md-filter-size" className="text-[10px] font-bold text-slate-500">사이즈</label>
                                                        <select
                                                            id="md-filter-size"
                                                            value={mdFilterSize}
                                                            onChange={(e) => setMdFilterSize(e.target.value)}
                                                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-violet-500 font-medium"
                                                        >
                                                            <option value="">사이즈 전체</option>
                                                            {mdFilterOptions.sizes.map(s => (
                                                                <option key={s} value={s}>{s}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* 재질 필터 */}
                                                    <div className="flex flex-col gap-1">
                                                        <label htmlFor="md-filter-material" className="text-[10px] font-bold text-slate-500">재질</label>
                                                        <select
                                                            id="md-filter-material"
                                                            value={mdFilterMaterial}
                                                            onChange={(e) => setMdFilterMaterial(e.target.value)}
                                                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-violet-500 focus:border-violet-500 font-medium"
                                                        >
                                                            <option value="">재질 전체</option>
                                                            {mdFilterOptions.materials.map(mat => (
                                                                <option key={mat} value={mat}>{mat}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 본문 영역 */}
                                            {filteredMissedDemandList.length === 0 ? (
                                                <div className="p-12 text-center text-slate-400 font-bold text-xs">
                                                    검색/필터링 조건에 부합하는 결품 내역이 없습니다. 🔍
                                                </div>
                                            ) : mdViewLayout === 'TABLE' ? (
                                                /* 테이블 뷰 */
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 text-[10px] font-bold">
                                                                <th className="p-3 w-10 text-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        aria-label="전체 결품 내역 선택"
                                                                        checked={filteredMissedDemandList.length > 0 && filteredMissedDemandList.every(m => selectedMissedDemandIds.has(m.id))}
                                                                        onChange={(e) => {
                                                                            if (e.target.checked) {
                                                                                setSelectedMissedDemandIds(new Set(filteredMissedDemandList.map(m => m.id)));
                                                                            } else {
                                                                                setSelectedMissedDemandIds(new Set());
                                                                            }
                                                                        }}
                                                                        className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-3.5 h-3.5"
                                                                    />
                                                                </th>
                                                                <th className="p-3 w-10 text-center">순위</th>
                                                                <th 
                                                                    className="p-3 w-32 min-w-30 cursor-pointer hover:bg-slate-200 transition-colors text-left"
                                                                    onClick={() => setMdSortConfig(prev => ({ key: 'name', direction: prev.key === 'name' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                                                                >
                                                                    품목명 {mdSortConfig.key === 'name' ? (mdSortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                                                                </th>
                                                                <th 
                                                                    className="p-3 w-32 min-w-30 cursor-pointer hover:bg-slate-200 transition-colors text-left"
                                                                    onClick={() => setMdSortConfig(prev => ({ key: 'thickness', direction: prev.key === 'thickness' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                                                                >
                                                                    두께 {mdSortConfig.key === 'thickness' ? (mdSortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                                                                </th>
                                                                <th 
                                                                    className="p-3 w-32 min-w-30 cursor-pointer hover:bg-slate-200 transition-colors text-left"
                                                                    onClick={() => setMdSortConfig(prev => ({ key: 'size', direction: prev.key === 'size' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                                                                >
                                                                    사이즈 {mdSortConfig.key === 'size' ? (mdSortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                                                                </th>
                                                                <th 
                                                                    className="p-3 w-32 min-w-30 cursor-pointer hover:bg-slate-200 transition-colors text-left"
                                                                    onClick={() => setMdSortConfig(prev => ({ key: 'material', direction: prev.key === 'material' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                                                                >
                                                                    재질 {mdSortConfig.key === 'material' ? (mdSortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                                                                </th>
                                                                <th className="p-3 text-right">시화재고</th>
                                                                <th className="p-3 text-right">대경재고</th>
                                                                <th className="p-3 text-right">입고예정</th>
                                                                <th className="p-3 text-right">안전재고</th>
                                                                <th 
                                                                    className="p-3 text-right cursor-pointer hover:bg-slate-200 transition-colors"
                                                                    onClick={() => setMdSortConfig(prev => ({ key: 'count', direction: prev.key === 'count' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                                                                >
                                                                    결품 횟수 {mdSortConfig.key === 'count' ? (mdSortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                                                                </th>
                                                                <th className="p-3 text-right">총 문의수량</th>
                                                                <th 
                                                                    className="p-3 text-right cursor-pointer hover:bg-slate-200 transition-colors"
                                                                    onClick={() => setMdSortConfig(prev => ({ key: 'estimatedRevenue', direction: prev.key === 'estimatedRevenue' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                                                                >
                                                                    추정 기회손실 {mdSortConfig.key === 'estimatedRevenue' ? (mdSortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                                                                </th>
                                                                <th className="p-3 text-center">발주 수량</th>
                                                                <th className="p-3 text-center">작업</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {filteredMissedDemandList.map((m, i) => {
                                                                const isSelected = selectedMissedDemandIds.has(m.id);
                                                                const isExpanded = expandedMdRowIds.has(m.id);
                                                                const defaultQty = Math.max(5, m.count * 2);
                                                                const qtyValue = mdRowQtys[m.id] ?? defaultQty;

                                                                const shQty = m.row?.shQty ?? 0;
                                                                const ysQty = m.row?.ysQty ?? 0;
                                                                const pendingOrderQty = m.row?.pendingOrderQty ?? 0;
                                                                const safeStock = m.row?.safeStock ?? 0;

                                                                return (
                                                                    <>
                                                                        <tr 
                                                                            key={m.id}
                                                                            onClick={() => {
                                                                                const next = new Set(selectedMissedDemandIds);
                                                                                if (next.has(m.id)) next.delete(m.id);
                                                                                else next.add(m.id);
                                                                                setSelectedMissedDemandIds(next);
                                                                            }}
                                                                            className={`border-b border-slate-100 hover:bg-violet-50/40 transition-colors text-xs font-medium cursor-pointer ${isSelected ? 'bg-violet-50/70' : ''}`}
                                                                        >
                                                                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    aria-label="결품 항목 선택"
                                                                                    checked={isSelected}
                                                                                    onChange={(e) => {
                                                                                        const next = new Set(selectedMissedDemandIds);
                                                                                        if (e.target.checked) next.add(m.id);
                                                                                        else next.delete(m.id);
                                                                                        setSelectedMissedDemandIds(next);
                                                                                    }}
                                                                                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-3.5 h-3.5"
                                                                                />
                                                                            </td>
                                                                            <td className="p-3 text-center text-slate-500 font-mono text-[10px]">{i + 1}</td>
                                                                            <td className="p-3 w-32 min-w-30 text-slate-700 font-semibold text-left">{m.row?.product?.name || m.id}</td>
                                                                            <td className="p-3 w-32 min-w-30 text-slate-500 font-mono text-[11px] text-left">{m.row?.product?.thickness || '-'}</td>
                                                                            <td className="p-3 w-32 min-w-30 text-slate-500 font-mono text-[11px] text-left">{m.row?.product?.size || '-'}</td>
                                                                            <td className="p-3 w-32 min-w-30 text-slate-500 text-left">{m.row?.product?.material || '알수없음'}</td>
                                                                            
                                                                            {/* 재고 데이터 */}
                                                                            <td className={`p-3 text-right font-mono font-semibold ${shQty === 0 ? 'text-slate-400' : 'text-slate-800'}`}>
                                                                                {shQty.toLocaleString()}개
                                                                            </td>
                                                                            <td className={`p-3 text-right font-mono font-semibold ${ysQty === 0 ? 'text-slate-400' : 'text-slate-800'}`}>
                                                                                {ysQty.toLocaleString()}개
                                                                            </td>
                                                                            <td className={`p-3 text-right font-mono ${pendingOrderQty === 0 ? 'text-slate-400' : 'text-indigo-600 font-bold'}`}>
                                                                                {pendingOrderQty.toLocaleString()}개
                                                                            </td>
                                                                            <td className="p-3 text-right font-mono text-slate-500">
                                                                                {safeStock.toLocaleString()}개
                                                                            </td>

                                                                            <td className="p-3 text-right font-mono font-black text-rose-600">{m.count}회</td>
                                                                            <td className="p-3 text-right font-mono text-slate-700">{m.totalQty.toLocaleString()}개</td>
                                                                            <td className="p-3 text-right font-mono font-bold text-slate-800">
                                                                                ₩{formatCur(m.estimatedRevenue)}
                                                                            </td>
                                                                            
                                                                            {/* 인라인 발주 수량 입력 */}
                                                                            <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                                                                <input
                                                                                    type="number"
                                                                                    aria-label="발주 수량"
                                                                                    min={1}
                                                                                    value={qtyValue}
                                                                                    onChange={(e) => {
                                                                                        const val = parseInt(e.target.value, 10);
                                                                                        setMdRowQtys(prev => ({
                                                                                            ...prev,
                                                                                            [m.id]: isNaN(val) ? 1 : val
                                                                                        }));
                                                                                    }}
                                                                                    className="w-16 px-1.5 py-1 bg-white border border-slate-300 rounded text-center text-xs font-bold font-mono focus:outline-hidden focus:border-violet-500"
                                                                                />
                                                                            </td>

                                                                            {/* 인라인 즉시발주 및 상세 토글 */}
                                                                            <td className="p-2 text-center flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                                                <button
                                                                                    onClick={() => handleCreateSingleMissedDemandOrder(m.id, qtyValue)}
                                                                                    className="px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded text-[10px] font-bold transition-all shadow-xs"
                                                                                >
                                                                                    즉시 발주
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => {
                                                                                        const next = new Set(expandedMdRowIds);
                                                                                        if (next.has(m.id)) next.delete(m.id);
                                                                                        else next.add(m.id);
                                                                                        setExpandedMdRowIds(next);
                                                                                    }}
                                                                                    className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                                                                    title="상세 근거 내역 보기"
                                                                                >
                                                                                    {isExpanded ? <ChevronDown className="w-4 h-4 text-violet-600" /> : <ChevronRight className="w-4 h-4" />}
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                        {isExpanded && (
                                                                            <tr className="bg-slate-50/85">
                                                                                <td colSpan={15} className="px-6 py-3 border-b border-violet-100">
                                                                                    <div className="bg-white rounded-xl border border-violet-100 p-4 shadow-xs">
                                                                                        <div className="flex items-center justify-between mb-2">
                                                                                            <span className="text-xs font-bold text-violet-800 flex items-center gap-1.5">
                                                                                                <span>📝 {m.row?.product?.name || m.id} 상세 결품/기회손실 유입 근거 내역</span>
                                                                                            </span>
                                                                                            <span className="text-[10px] text-slate-400">
                                                                                                * 추정 기회손실 = 재고 부족 시기에 접수된 총 수량 × 현재 판매단가
                                                                                            </span>
                                                                                        </div>
                                                                                        <table className="w-full text-left border-collapse text-[10px]">
                                                                                            <thead>
                                                                                                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                                                                                    <th className="p-2">날짜</th>
                                                                                                    <th className="p-2">구분</th>
                                                                                                    <th className="p-2">거래처</th>
                                                                                                    <th className="p-2 text-right">문의수량</th>
                                                                                                    <th className="p-2 text-right">단가</th>
                                                                                                    <th className="p-2 text-right">예상 손실액</th>
                                                                                                    <th className="p-2">문서번호</th>
                                                                                                    <th className="p-2">상태</th>
                                                                                                </tr>
                                                                                            </thead>
                                                                                            <tbody>
                                                                                                {m.history.map((h, hi) => (
                                                                                                    <tr key={hi} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                                                                        <td className="p-2 font-mono text-slate-500">{h.date.substring(0, 10)}</td>
                                                                                                        <td className="p-2">
                                                                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${h.type === 'ORDER' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                                                                                                {h.type === 'ORDER' ? '주문' : '견적'}
                                                                                                            </span>
                                                                                                        </td>
                                                                                                        <td className="p-2 text-slate-700 font-medium">{h.customer}</td>
                                                                                                        <td className="p-2 text-right font-mono font-bold text-slate-700">{h.qty}개</td>
                                                                                                        <td className="p-2 text-right font-mono text-slate-500">₩{formatCur(h.price)}</td>
                                                                                                        <td className="p-2 text-right font-mono font-bold text-slate-800">₩{formatCur(h.qty * h.price)}</td>
                                                                                                        <td className="p-2 font-mono text-slate-400">{h.refNo}</td>
                                                                                                        <td className="p-2">
                                                                                                            <span className="text-rose-600 font-semibold">{h.status}</span>
                                                                                                        </td>
                                                                                                    </tr>
                                                                                                ))}
                                                                                            </tbody>
                                                                                        </table>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        )}
                                                                    </>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                /* 카드 뷰 */
                                                <div className="p-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
                                                        {filteredMissedDemandList.map((m, i) => {
                                                            const isSelected = selectedMissedDemandIds.has(m.id);
                                                            const isExpanded = expandedMdRowIds.has(m.id);
                                                            const defaultQty = Math.max(5, m.count * 2);
                                                            const qtyValue = mdRowQtys[m.id] ?? defaultQty;

                                                            const shQty = m.row?.shQty ?? 0;
                                                            const ysQty = m.row?.ysQty ?? 0;
                                                            const pendingOrderQty = m.row?.pendingOrderQty ?? 0;
                                                            const safeStock = m.row?.safeStock ?? 0;

                                                            return (
                                                                <div 
                                                                    key={m.id}
                                                                    onClick={() => {
                                                                        const next = new Set(selectedMissedDemandIds);
                                                                        if (next.has(m.id)) next.delete(m.id);
                                                                        else next.add(m.id);
                                                                        setSelectedMissedDemandIds(next);
                                                                    }}
                                                                    className={`rounded-xl p-3.5 border transition-all cursor-pointer select-none ${isSelected ? 'border-violet-400 bg-violet-50/80 shadow-xs' : m.count >= 3 ? 'border-rose-200 bg-rose-50/60 hover:bg-rose-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                                                                >
                                                                    <div className="flex items-center justify-between mb-2.5">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <div onClick={(e) => e.stopPropagation()}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    aria-label="결품 항목 선택"
                                                                                    checked={isSelected}
                                                                                    onChange={(e) => {
                                                                                        const next = new Set(selectedMissedDemandIds);
                                                                                        if (e.target.checked) next.add(m.id);
                                                                                        else next.delete(m.id);
                                                                                        setSelectedMissedDemandIds(next);
                                                                                    }}
                                                                                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-3.5 h-3.5"
                                                                                />
                                                                            </div>
                                                                            <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black shrink-0 ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                                                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${m.count >= 3 ? 'bg-rose-200 text-rose-700' : 'bg-violet-200 text-violet-700'}`}>
                                                                                {m.count}회 결품 ({m.totalQty}개)
                                                                            </span>
                                                                        </div>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const next = new Set(expandedMdRowIds);
                                                                                if (next.has(m.id)) next.delete(m.id);
                                                                                else next.add(m.id);
                                                                                setExpandedMdRowIds(next);
                                                                            }}
                                                                            className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                                                        >
                                                                            {isExpanded ? <ChevronDown className="w-4 h-4 text-violet-600" /> : <ChevronRight className="w-4 h-4" />}
                                                                        </button>
                                                                    </div>

                                                                    <div className="text-[12px] font-bold text-slate-900 mb-1">{m.row?.product?.name || m.id}</div>
                                                                    
                                                                    <div className="text-[10px] text-slate-500 grid grid-cols-2 gap-x-2 gap-y-1 mb-2.5 pb-2 border-b border-slate-100 font-medium">
                                                                        <span>재질: {m.row?.product?.material || '알수없음'}</span>
                                                                        <span>사이즈: {m.row?.product?.size || '-'}</span>
                                                                        <span>두께: {m.row?.product?.thickness || '-'}</span>
                                                                    </div>

                                                                    <div className="text-[10px] text-slate-600 grid grid-cols-2 gap-x-2 gap-y-1 mb-3 bg-slate-50 p-2 rounded-lg font-mono">
                                                                        <div className="flex justify-between">
                                                                            <span className="text-slate-400 font-sans">시화재고:</span>
                                                                            <span className="font-bold text-slate-700">{shQty}개</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span className="text-slate-400 font-sans">대경재고:</span>
                                                                            <span className="font-bold text-slate-700">{ysQty}개</span>
                                                                        </div>
                                                                        <div className="flex justify-between col-span-2 pt-1 border-t border-slate-200/50">
                                                                            <span className="text-slate-400 font-sans">입고예정 / 안전:</span>
                                                                            <span className="font-bold text-indigo-600">{pendingOrderQty}개 / <span className="text-slate-500">{safeStock}개</span></span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="text-[11px] text-slate-800 font-bold font-mono flex items-center justify-between">
                                                                        <span className="text-slate-400 font-normal font-sans text-[10px]">추정 기회손실:</span>
                                                                        <span>₩{formatCur(m.estimatedRevenue)}</span>
                                                                    </div>

                                                                    {/* 인라인 수량 및 즉시발주 */}
                                                                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                                        <label htmlFor={`md-card-order-qty-${m.id}`} className="text-[10px] text-slate-400">발주량:</label>
                                                                        <input
                                                                            id={`md-card-order-qty-${m.id}`}
                                                                            type="number"
                                                                            min={1}
                                                                            value={qtyValue}
                                                                            onChange={(e) => {
                                                                                const val = parseInt(e.target.value, 10);
                                                                                setMdRowQtys(prev => ({
                                                                                    ...prev,
                                                                                    [m.id]: isNaN(val) ? 1 : val
                                                                                }));
                                                                            }}
                                                                            className="w-14 px-1 py-0.5 bg-white border border-slate-300 rounded text-center text-xs font-bold font-mono focus:outline-hidden"
                                                                        />
                                                                        <button
                                                                            onClick={() => handleCreateSingleMissedDemandOrder(m.id, qtyValue)}
                                                                            className="flex-1 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded text-[10px] font-bold text-center transition-all shadow-xs"
                                                                        >
                                                                            즉시 발주 ⚡
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    {/* 카드 뷰 상세 이력 노출 */}
                                                    {filteredMissedDemandList.map((m) => {
                                                        if (!expandedMdRowIds.has(m.id)) return null;
                                                        return (
                                                            <div key={`exp-card-${m.id}`} className="mt-2 mb-4 bg-violet-50/50 rounded-xl p-3 border border-violet-100 text-[10px]">
                                                                <div className="font-bold text-violet-800 mb-2 border-b border-violet-200/50 pb-1.5 flex items-center justify-between">
                                                                    <span>📋 {m.row?.product?.name || m.id} 결품 이력 근거</span>
                                                                    <button 
                                                                        onClick={() => {
                                                                            const next = new Set(expandedMdRowIds);
                                                                            next.delete(m.id);
                                                                            setExpandedMdRowIds(next);
                                                                        }}
                                                                        className="text-slate-400 hover:text-slate-600 font-bold"
                                                                    >✕</button>
                                                                </div>
                                                                <div className="max-h-40 overflow-y-auto space-y-2">
                                                                    {m.history.map((h, hi) => (
                                                                        <div key={hi} className="flex justify-between items-start py-1 border-b border-slate-200/40">
                                                                            <div>
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${h.type === 'ORDER' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>{h.type === 'ORDER' ? '주문' : '견적'}</span>
                                                                                    <span className="font-bold text-slate-700">{h.customer}</span>
                                                                                </div>
                                                                                <div className="text-slate-400 font-mono text-[9px] mt-0.5">{h.date.substring(0, 10)} | {h.refNo}</div>
                                                                            </div>
                                                                            <div className="text-right">
                                                                                <div className="font-bold font-mono text-slate-800">{h.qty}개 (₩{formatCur(h.qty * h.price)})</div>
                                                                                <div className="text-[9px] text-rose-500 font-medium">{h.status}</div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* 하단 플로팅/스틱 바 (Bulk Action Bar) */}
                                            {selectedMissedDemandIds.size > 0 && (
                                                <div className="sticky bottom-4 left-0 right-0 mx-4 my-3 bg-slate-900/95 text-white p-3 rounded-xl shadow-xl flex items-center justify-between gap-3 border border-slate-700/80 backdrop-blur-md animate-fade-in z-50">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-violet-600/90 flex items-center justify-center text-sm font-black text-white shrink-0">🛒</div>
                                                        <div>
                                                            <div className="text-xs font-black text-violet-300">결품 기회손실 품목 일괄 긴급보충</div>
                                                            <div className="text-[10px] text-slate-300 mt-0.5">
                                                                선택 품목: <span className="font-bold text-white">{selectedMissedDemandIds.size}개</span> | 
                                                                총 권장수량: <span className="font-bold text-white">
                                                                    {Array.from(selectedMissedDemandIds).reduce((acc, id) => {
                                                                        const item = filteredMissedDemandList.find(m => m.id === id);
                                                                        const qty = mdRowQtys[id] ?? Math.max(5, (item?.count || 0) * 2);
                                                                        return acc + qty;
                                                                    }, 0)}개
                                                                </span> | 
                                                                예상금액: <span className="font-bold text-violet-400">
                                                                    ₩{formatCur(Array.from(selectedMissedDemandIds).reduce((acc, id) => {
                                                                        const item = filteredMissedDemandList.find(m => m.id === id);
                                                                        const qty = mdRowQtys[id] ?? Math.max(5, (item?.count || 0) * 2);
                                                                        const price = (item?.row && item.row.recentPurchasePrice > 0) ? item.row.recentPurchasePrice : (item?.row?.sellingPrice || 0);
                                                                        return acc + qty * price;
                                                                    }, 0))}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <button 
                                                            onClick={() => setSelectedMissedDemandIds(new Set())}
                                                            className="px-3 py-1.5 text-[11px] font-bold text-slate-400 hover:text-white transition-colors"
                                                        >
                                                            선택 취소
                                                        </button>
                                                        <button
                                                            onClick={handleCreateMissedDemandOrder}
                                                            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg text-xs transition-colors shadow-lg shadow-violet-600/30 flex items-center gap-1"
                                                        >
                                                            <span>긴급 발주 추가</span> ⚡
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
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
                                                { phase: '즉시 가능', textClass: 'text-rose-600', bgClass: 'bg-rose-600', items: ['주문 취소 시 결품 원인 필드 추가', '대경 반품 가능 여부 플래그', '최초 견적 발생일(Opportunity Date)'] },
                                                { phase: '1개월 후', textClass: 'text-orange-600', bgClass: 'bg-orange-600', items: ['일별 스냅샷 30일 누적→σ 정밀화', '품목별 무판매일 정확 계산 가능', '과잉·악성 오차 50% 감소'] },
                                                { phase: '3개월 후', textClass: 'text-amber-600', bgClass: 'bg-amber-600', items: ['권역별 수요 패턴 분리', '하치장 품목 기준 데이터화', '악성재고 사전 예측 모델'] },
                                                { phase: '6개월 후', textClass: 'text-green-600', bgClass: 'bg-green-600', items: ['계절성 보정 지수 산출', '납품 현장 유형별 수요 패턴', 'ITS 목표 8% 이하 달성 가이드'] },
                                                { phase: '12개월 후', textClass: 'text-blue-600', bgClass: 'bg-blue-600', items: ['AI 자동 처분 타이밍 추천', '신뢰도 99% 발주 시스템', 'ROI 기반 재고 운용 최적화'] },
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
                                                {['주문 취소 사유 (결품/단가/납기)', '납품 현장 분류 (플랜트/건설/조선)', '대경 반품 가능 여부 플래그', '최초 견적 일자', '거래처 업종 코드 (SIC)', '계절 수요 태그'].map(tag => (
                                                    <span key={tag} className="text-[9px] font-bold bg-white/15 px-2 py-1 rounded-full border border-white/20 text-slate-200">{tag}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            )}

                            {activeTab === 'DAEKYUNG_STOCK' && (
                                <div className="space-y-6 p-4 md:p-0 pb-8 animate-in fade-in duration-300">
                                    {/* ── 1. 대경재고 요약 카드 ── */}
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                        <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3.5 shadow-xs">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                                🏭 분석 대상 {dkViewMode === 'ITEM' ? '품목' : '재질'}
                                            </div>
                                            <div className="text-xl font-black text-slate-800">
                                                {daekyungStats.totalItems} <span className="text-xs text-slate-500 font-bold">{dkViewMode === 'ITEM' ? '개 품목' : '개 재질'}</span>
                                            </div>
                                            <div className="text-[9px] text-slate-400 mt-1 font-medium">양산 창고 & 메이커 '대경'</div>
                                        </div>
                                        <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3.5 shadow-xs">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                                📦 현재 재고 합계
                                            </div>
                                            <div className="text-xl font-black text-teal-600 font-mono">
                                                {daekyungStats.totalCurrentStock.toLocaleString()} <span className="text-xs text-slate-500 font-bold">개</span>
                                            </div>
                                            <div className="text-[9px] text-slate-400 mt-1 font-medium">양산 창고 실시간 재고량</div>
                                        </div>
                                        <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-3.5 shadow-xs">
                                            <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">
                                                ⚡ 1개월 평균 보유량
                                            </div>
                                            <div className="text-xl font-black text-blue-600 font-mono">
                                                {daekyungStats.totalAvg1m.toLocaleString()} <span className="text-xs text-slate-500 font-bold">개</span>
                                            </div>
                                            <div className="text-[9px] text-blue-400 mt-1 font-medium">최근 30일 일별 재고 산술평균</div>
                                        </div>
                                        <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-3.5 shadow-xs">
                                            <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">
                                                📈 3개월 평균 보유량
                                            </div>
                                            <div className="text-xl font-black text-indigo-600 font-mono">
                                                {daekyungStats.totalAvg3m.toLocaleString()} <span className="text-xs text-slate-500 font-bold">개</span>
                                            </div>
                                            <div className="text-[9px] text-indigo-400 mt-1 font-medium">최근 90일 일별 재고 산술평균</div>
                                        </div>
                                        <div className="bg-violet-50/50 border border-violet-100 rounded-2xl p-3.5 shadow-xs">
                                            <div className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-1">
                                                📊 6개월 평균 보유량
                                            </div>
                                            <div className="text-xl font-black text-violet-600 font-mono">
                                                {daekyungStats.totalAvg6m.toLocaleString()} <span className="text-xs text-slate-500 font-bold">개</span>
                                            </div>
                                            <div className="text-[9px] text-violet-400 mt-1 font-medium">최근 180일 일별 재고 산술평균</div>
                                        </div>
                                    </div>

                                    {/* ── 2. 안내 및 분석 멘트 ── */}
                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="space-y-1">
                                            <h4 className="text-sm font-black text-white flex items-center gap-2">
                                                💡 대경재고(양산) 평균 보유 분석 안내
                                            </h4>
                                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                                데이터 갱신은 불특정일에 진행되므로 일별 단기 변동량 파악을 위한 <strong>1개월(30일) 평균 재고</strong>와 중장기 흐름을 위한 <strong>3개월/6개월 평균 재고</strong>를 조합하여 파악하는 것이 합당합니다.
                                                각 품목이 전체 대경 재고에서 차지하는 <strong>상대적 비중(Relative Share)</strong>을 비교 분석하여 앞으로 상시 보유해야 할 품목을 관리를 진행하세요.
                                            </p>
                                        </div>
                                    </div>

                                    {/* ── 3. 검색 및 필터 컨트롤 ── */}
                                    <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-4">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                            {/* 보기 모드 토글 */}
                                            <div className="flex items-center bg-slate-200/60 p-1 rounded-lg w-fit">
                                                <button
                                                    onClick={() => setDkViewMode('ITEM')}
                                                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                                        dkViewMode === 'ITEM'
                                                            ? 'bg-white text-indigo-700 shadow-xs'
                                                            : 'text-slate-600 hover:text-slate-900'
                                                    }`}
                                                >
                                                    📋 아이템별 보기
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setDkViewMode('MATERIAL');
                                                        if (!['material', 'currentStock', 'avg1m', 'avg3m', 'avg6m', 'share1m', 'share3m', 'share6m', 'trend'].includes(dkSortConfig.key)) {
                                                            setDkSortConfig({ key: 'material', direction: 'desc' });
                                                        }
                                                    }}
                                                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                                        dkViewMode === 'MATERIAL'
                                                            ? 'bg-white text-indigo-700 shadow-xs'
                                                            : 'text-slate-600 hover:text-slate-900'
                                                    }`}
                                                >
                                                    🧪 재질별 보기
                                                </button>
                                            </div>

                                            {/* 대경 전용 검색 */}
                                            <div className="relative flex-1 max-w-md">
                                                <input
                                                    type="text"
                                                    placeholder="대경 품목코드 또는 품명 검색..."
                                                    value={dkSearchQuery}
                                                    onChange={e => setDkSearchQuery(e.target.value)}
                                                    className="w-full bg-white border border-slate-300 rounded-lg text-slate-700 font-medium text-xs px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
                                                />
                                                {dkSearchQuery && (
                                                    <button
                                                        onClick={() => setDkSearchQuery('')}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* 드롭다운 필터 */}
                                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                            <div className="flex flex-col gap-1">
                                                <label htmlFor="dk-item-filter" className="text-[10px] font-bold text-slate-500">품목 필터</label>
                                                <select
                                                    id="dk-item-filter"
                                                    value={dkFilterItem}
                                                    onChange={e => setDkFilterItem(e.target.value)}
                                                    className="bg-white border border-slate-300 rounded-lg text-xs p-2 text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                >
                                                    <option value="">전체 품목</option>
                                                    {daekyungFilterOptions.names.map(name => (
                                                        <option key={name} value={name}>{name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="flex flex-col gap-1">
                                                <label htmlFor="dk-material-filter" className="text-[10px] font-bold text-slate-500">재질 필터</label>
                                                <select
                                                    id="dk-material-filter"
                                                    value={dkFilterMaterial}
                                                    onChange={e => setDkFilterMaterial(e.target.value)}
                                                    className="bg-white border border-slate-300 rounded-lg text-xs p-2 text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                >
                                                    <option value="">전체 재질</option>
                                                    {daekyungFilterOptions.materials.map(mat => (
                                                        <option key={mat} value={mat}>{mat}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="flex flex-col gap-1">
                                                <label htmlFor="dk-size-filter" className="text-[10px] font-bold text-slate-500">사이즈 필터</label>
                                                <select
                                                    id="dk-size-filter"
                                                    value={dkFilterSize}
                                                    onChange={e => setDkFilterSize(e.target.value)}
                                                    className="bg-white border border-slate-300 rounded-lg text-xs p-2 text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                >
                                                    <option value="">전체 사이즈</option>
                                                    {daekyungFilterOptions.sizes.map(size => (
                                                        <option key={size} value={size}>{size}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="flex flex-col gap-1">
                                                <label htmlFor="dk-procurement-filter" className="text-[10px] font-bold text-slate-500">조달 상태 필터</label>
                                                <select
                                                    id="dk-procurement-filter"
                                                    value={dkFilterProcurement}
                                                    onChange={e => setDkFilterProcurement(e.target.value as DkProcurementFilterType)}
                                                    className="bg-white border border-slate-300 rounded-lg text-xs p-2 text-slate-700 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                >
                                                    <option value="ALL">전체 조달 상태</option>
                                                    <option value="ORDER_NEEDED">발주 필요 (종합)</option>
                                                    <option value="RECOMMENDED">AI 발주 추천</option>
                                                    <option value="DOUBLE_STOCKOUT">🚨 자사·공급처 동시 결품 (이중 품절)</option>
                                                    <option value="SURGING_DEMAND">🔥 최근 주문/출고 급상승</option>
                                                    <option value="SIHWA_UNMET">⚠️ 시화재고 미달 (선발주 권장)</option>
                                                    <option value="EXCESS">📉 직전수요 대비 과잉재고</option>
                                                    <option value="STABLE">✅ 수급 및 재고 상태 안정적</option>
                                                </select>
                                            </div>

                                            <div className="flex items-end">
                                                <button
                                                    onClick={() => {
                                                        setDkSearchQuery('');
                                                        setDkFilterItem('');
                                                        setDkFilterMaterial('');
                                                        setDkFilterSize('');
                                                        setDkFilterProcurement('ORDER_NEEDED');
                                                    }}
                                                    disabled={!dkSearchQuery && !dkFilterItem && !dkFilterMaterial && !dkFilterSize && dkFilterProcurement === 'ORDER_NEEDED'}
                                                    className="w-full bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                                                >
                                                    🔄 필터 초기화
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── 4. 상세 품목 분석 테이블 ── */}
                                    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden relative">
                                        <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200/60 flex items-center justify-between">
                                            <div className="text-xs font-black text-slate-600">
                                                {dkViewMode === 'ITEM' ? '품목별 평균 보유량 및 상대 비중 목록' : '재질별 집계 평균 보유량 및 상대 비중 목록'}
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-bold">
                                                검색 필터 결과: {daekyungStockAverages.length}개 {dkViewMode === 'ITEM' ? '품목' : '재질'}
                                            </span>
                                        </div>
                                        <div className="overflow-auto max-h-150">
                                            <table className="w-full text-xs text-left whitespace-nowrap">
                                                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 sticky top-0 z-10 shadow-sm">
                                                    <tr>
                                                        {dkViewMode === 'ITEM' && (
                                                            <th className="px-3 py-3 w-10 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    title="전체 품목 선택"
                                                                    checked={daekyungStockAverages.length > 0 && daekyungStockAverages.every(r => selectedDkIds.has(r.id))}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) setSelectedDkIds(new Set(daekyungStockAverages.map(r => r.id)));
                                                                        else setSelectedDkIds(new Set());
                                                                    }}
                                                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                                />
                                                            </th>
                                                        )}
                                                        <th className="px-4 py-3 text-center">순위</th>
                                                        {dkViewMode === 'ITEM' ? (
                                                            <>
                                                                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'id', direction: prev.key === 'id' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                                    품목코드 {dkSortConfig.key === 'id' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                                </th>
                                                                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'name', direction: prev.key === 'name' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                                    품목명 {dkSortConfig.key === 'name' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                                </th>
                                                                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'size', direction: prev.key === 'size' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                                    사이즈 {dkSortConfig.key === 'size' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                                </th>
                                                                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'material', direction: prev.key === 'material' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                                    재질 {dkSortConfig.key === 'material' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                                </th>
                                                            </>
                                                        ) : (
                                                            <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'material', direction: prev.key === 'material' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                                재질 {dkSortConfig.key === 'material' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                            </th>
                                                        )}
                                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'currentStock', direction: prev.key === 'currentStock' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                            대경 현재고 {dkSortConfig.key === 'currentStock' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </th>
                                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'avg3m', direction: prev.key === 'avg3m' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                            3개월 평균 보유 {dkSortConfig.key === 'avg3m' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </th>
                                                        <th className="px-4 py-3 text-right font-black text-teal-700 bg-teal-50/50 cursor-pointer hover:bg-teal-100/50 transition" onClick={() => setDkSortConfig(prev => ({ key: 'shQty', direction: prev.key === 'shQty' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                            시화 현재고 {dkSortConfig.key === 'shQty' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </th>
                                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'safeStock', direction: prev.key === 'safeStock' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                            시화 안전재고량 {dkSortConfig.key === 'safeStock' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </th>
                                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'recommendedQty', direction: prev.key === 'recommendedQty' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                            1~3개월 권장구매 {dkSortConfig.key === 'recommendedQty' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </th>
                                                        <th className="px-4 py-3 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => setDkSortConfig(prev => ({ key: 'procurementReason', direction: prev.key === 'procurementReason' && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                                                            🎯 수급 진단 & 데이터 근거 {dkSortConfig.key === 'procurementReason' && (dkSortConfig.direction === 'asc' ? '↑' : '↓')}
                                                        </th>
                                                        <th className="px-4 py-3 text-center">작업/발주</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {daekyungStockAverages.map((row, index) => {
                                                        const sihwaRow = baseAnalyzedInventoryMap.get(row.id);
                                                        const isSelected = selectedDkIds.has(row.id);
                                                        const recQtyVal = row.recommendedQty || 0;

                                                        return (
                                                            <tr key={row.id} className={`hover:bg-slate-50/80 transition cursor-pointer ${isSelected ? 'bg-indigo-50/50' : ''}`} onClick={() => sihwaRow && setSelectedIntelligenceItem(sihwaRow)}>
                                                                {dkViewMode === 'ITEM' && (
                                                                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                                        <input
                                                                            type="checkbox"
                                                                            title={`${row.id} 선택`}
                                                                            checked={isSelected}
                                                                            onChange={(e) => {
                                                                                setSelectedDkIds(prev => {
                                                                                    const next = new Set(prev);
                                                                                    if (e.target.checked) next.add(row.id);
                                                                                    else next.delete(row.id);
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                                                        />
                                                                    </td>
                                                                )}
                                                                <td className="px-4 py-2.5 text-center text-[10px] text-slate-400 font-bold">
                                                                    {index + 1}
                                                                </td>
                                                                {dkViewMode === 'ITEM' ? (
                                                                    <>
                                                                        <td className="px-4 py-2.5">
                                                                            <span className="font-mono font-bold text-slate-800 hover:text-indigo-600 transition-colors">
                                                                                {row.id}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-slate-500 font-medium">
                                                                            {row.name}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-slate-500 font-medium">
                                                                            {row.size}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-slate-500 font-medium">
                                                                            {row.material}
                                                                        </td>
                                                                    </>
                                                                ) : (
                                                                    <td className="px-4 py-2.5 font-bold text-slate-800">
                                                                        {row.material}
                                                                    </td>
                                                                )}
                                                                <td className={`px-4 py-2.5 text-right font-black font-mono ${row.currentStock === 0 ? 'text-rose-600 bg-rose-50/40' : 'text-slate-700'}`}>
                                                                    {row.currentStock.toLocaleString()}개
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right font-bold text-indigo-600 font-mono">
                                                                    {row.avg3m.toLocaleString()}개
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right font-black font-mono text-teal-700 bg-teal-50/30">
                                                                    {row.shQty.toLocaleString()}개
                                                                </td>
                                                                <td className="px-4 py-2.5 text-right font-bold text-slate-700 font-mono">
                                                                    {row.safeStock}개
                                                                </td>
                                                                <td className={`px-4 py-2.5 text-right font-black font-mono ${row.recommendedQty > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                                                                    {row.recommendedQty}개
                                                                </td>
                                                                <td className="px-4 py-2.5 text-left text-xs font-medium text-slate-700">
                                                                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${row.isDoubleStockoutWithDemand ? 'bg-rose-100 text-rose-800 font-bold border border-rose-200' : row.isSurgingDemand ? 'bg-amber-100 text-amber-900 font-extrabold border border-amber-300' : row.recommendedQty > 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-slate-100 text-slate-600'}`}>
                                                                        {row.procurementReason}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2.5 text-center">
                                                                    {dkViewMode === 'ITEM' ? (
                                                                        <button
                                                                            onClick={(e) => handleCreateSingleDaekyungOrder(row, e)}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1 mx-auto whitespace-nowrap ${
                                                                                recQtyVal > 0 || sihwaRow?.isDoubleStockoutWithDemand
                                                                                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white ring-2 ring-indigo-300'
                                                                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                                                                            }`}
                                                                            title="즉시 장바구니 담기 및 발주서 작성"
                                                                        >
                                                                            <ShoppingCart className="w-3.5 h-3.5" />
                                                                            <span>{recQtyVal > 0 ? `${recQtyVal}개 발주` : '발주 작성'}</span>
                                                                        </button>
                                                                    ) : (
                                                                        <span className="text-[10px] text-slate-400 font-medium">-</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {daekyungStockAverages.length === 0 && (
                                                        <tr>
                                                            <td colSpan={dkViewMode === 'ITEM' ? 13 : 10} className="px-4 py-16 text-center text-slate-400 font-medium">
                                                                {dkFilterProcurement === 'ALL' && !dkSearchQuery && !dkFilterItem && !dkFilterMaterial && !dkFilterSize
                                                                    ? "전체 품목 자동 로딩 방지를 위해 '조달 상태 필터'를 선택하거나 검색어를 입력하세요."
                                                                    : "조건에 부합하는 대경재고 데이터가 없거나 분석 중입니다."}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
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
                        stats.critical.filter(w => selectedCriticalIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * row.suggestedCriticalQty, 0) +
                        stats.warning.filter(w => selectedWarningIds.has(w.product.id)).reduce((sum, row) => sum + row.recentPurchasePrice * row.recommendedQty, 0) +
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
                                <ShoppingCart className="w-5 h-5" />
                                선택 항목 모두 발주서 만들기
                            </button>
                        </div>
                    );
                }
                return null;
            })()}

            {/* 대경재고 다중 선택 발주 플로팅 바 (Daekyung Order Action Bar) */}
            {selectedDkIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 border border-indigo-500 p-2 sm:px-6 sm:py-4 rounded-xl sm:rounded-full shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-8 z-50 animate-in slide-in-from-bottom">
                    <div className="flex flex-col items-center sm:items-start text-white">
                        <span className="font-extrabold text-sm sm:text-base flex items-center gap-2">
                            <span>대경재고 분석: 총 <span className="text-indigo-400 font-black text-lg">{selectedDkIds.size}</span>개 품목 선택됨</span>
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                            선택된 항목들을 일괄로 장바구니에 담고 발주 작성 페이지로 이동합니다.
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSelectedDkIds(new Set())}
                            className="text-slate-400 hover:text-white text-xs font-bold px-3 py-2 rounded-lg"
                        >
                            선택 해제
                        </button>
                        <button
                            onClick={handleCreateSelectedDaekyungOrders}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-black px-6 py-2.5 rounded-lg sm:rounded-full flex items-center gap-2 transition-all shadow-lg hover:shadow-indigo-500/50"
                        >
                            <ShoppingCart className="w-5 h-5" />
                            선택 품목 일괄 발주서 작성 ({selectedDkIds.size}건)
                        </button>
                    </div>
                </div>
            )}

            {selectedIntelligenceItem && (
                <ItemIntelligenceCard
                    productId={selectedIntelligenceItem.product.id}
                    productName={selectedIntelligenceItem.product.name}
                    inventoryData={selectedIntelligenceItem}
                    onClose={() => setSelectedIntelligenceItem(null)}
                />
            )}

            {isConfirmModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 text-slate-800">
                        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <History className="w-5 h-5 text-amber-400" />
                                <h3 className="font-extrabold text-lg">일일 변동 트렌드 데이터 검토 및 확정 ({pendingDate})</h3>
                            </div>
                            <button onClick={() => setIsConfirmModalOpen(false)} aria-label="닫기" className="text-slate-400 hover:text-white transition">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 space-y-6">
                            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl text-blue-800 text-xs font-bold leading-relaxed">
                                💡 자동 계산된 시화 창고 대경 제품의 일일 변동 데이터입니다. 
                                실제 매입/매출에 부합하는 항목들만 체크하여 남기고, 잘못 감지된 노이즈는 체크 해제하거나 변동량을 조작할 수 있습니다. 
                                저장된 항목들만 오늘 자의 변동 트렌드로 최종 보존되며, 이를 기준으로 baseline 스냅샷이 동기화됩니다.
                            </div>

                            {/* Sihwa Pending List */}
                            <div className="pb-4">
                                <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-1.5 text-sm">
                                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                                    시화재고 변동 리스트 (대경)
                                </h4>
                                {pendingSihwaList.length === 0 ? (
                                    <p className="text-xs text-slate-400 py-4 text-center font-medium">시화재고의 변동 감지 항목이 없습니다.</p>
                                ) : (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                                                    <th className="p-3 text-center w-12">선택</th>
                                                    <th className="p-3">품목 코드 / 규격</th>
                                                    <th className="p-3 text-right">이전 재고</th>
                                                    <th className="p-3 text-center w-24">변동량 조작</th>
                                                    <th className="p-3 text-right">이후 재고</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {pendingSihwaList.map((item, idx) => {
                                                    const changeVal = Number(item.editedChange) || 0;
                                                    const finalQty = item.from + changeVal;
                                                    return (
                                                        <tr key={item.id} className={`hover:bg-slate-50/50 ${!item.selected ? 'opacity-50 bg-slate-50/20' : ''}`}>
                                                            <td className="p-3 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={item.selected}
                                                                    aria-label="변동 항목 선택"
                                                                    onChange={(e) => {
                                                                        const updated = [...pendingSihwaList];
                                                                        updated[idx].selected = e.target.checked;
                                                                        if (!e.target.checked) updated[idx].editedChange = 0;
                                                                        else updated[idx].editedChange = item.change;
                                                                        setPendingSihwaList(updated);
                                                                    }}
                                                                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                                                                />
                                                            </td>
                                                            <td className="p-3 font-mono">
                                                                <div className="font-bold text-slate-700">{item.id}</div>
                                                                <div className="text-[10px] text-slate-400 font-semibold">{item.name}</div>
                                                            </td>
                                                            <td className="p-3 text-right font-medium text-slate-600">{item.from}개</td>
                                                            <td className="p-3 text-center">
                                                                <input
                                                                    type="number"
                                                                    disabled={!item.selected}
                                                                    value={item.editedChange}
                                                                    aria-label="변동 수량 조작"
                                                                    placeholder="0"
                                                                    onChange={(e) => {
                                                                        const updated = [...pendingSihwaList];
                                                                        updated[idx].editedChange = e.target.value === '' ? '' : Number(e.target.value);
                                                                        setPendingSihwaList(updated);
                                                                    }}
                                                                    className="w-20 px-2 py-1 text-center border rounded border-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                                                                />
                                                            </td>
                                                            <td className="p-3 text-right font-bold text-slate-800">{finalQty}개</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
                            <button
                                onClick={() => setIsConfirmModalOpen(false)}
                                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-700 font-bold text-sm transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleSaveConfirmedHistory}
                                disabled={submittingConfirm}
                                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg font-bold text-sm shadow-md transition"
                            >
                                {submittingConfirm ? '저장 중...' : '최종 변동 이력 저장'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}