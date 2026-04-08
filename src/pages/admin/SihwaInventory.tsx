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
    History
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Product } from '../../types';

// Helper: Format currency
const formatCur = (num: number) => new Intl.NumberFormat('ko-KR').format(num);

// Helper: Calculate Selling Price based on item rules
const calculateSellingPrice = (id: string, basePrice: number): number => {
    const upperId = id.toUpperCase();
    if (upperId.startsWith('CAP') || upperId.endsWith('-W')) {
        // 요율 65% 적용: 100% - 65% = 35%
        return Math.round((basePrice * 35 / 100) / 10) * 10;
    } else if (upperId.endsWith('-S')) {
        // 요율 35% 적용: 100% - 35% = 65%
        return Math.round((basePrice * 65 / 100) / 10) * 10;
    }
    return basePrice;
};

// Helper: Calculate Fallback Purchase Price based on item rules
const calculateFallbackPurchasePrice = (id: string, basePrice: number): number => {
    const upperId = id.toUpperCase();
    if (upperId.endsWith('-S') && !upperId.startsWith('CAP')) {
        // 요율 45% 적용: 100% - 45% = 55%
        return Math.round((basePrice * 55 / 100) / 10) * 10;
    } else {
        // 기본 요율 72% 적용: 100% - 72% = 28%
        return Math.round((basePrice * 28 / 100) / 10) * 10;
    }
};

interface InventoryDiffItem {
    name: string;
    from: number;
    to: number;
    change: number;
}

interface InventoryHistorySnapshot {
    date: string;
    diff: InventoryDiffItem[];
    stock?: Record<string, { name: string; stock: number }>;
}

export default function SihwaInventory() {
    const { orders, user } = useStore(useShallow(state => ({ orders: state.orders, user: state.auth.user })));
    const { inventory, isLoading: invLoading } = useInventory();
    
    const [historyData, setHistoryData] = useState<InventoryHistorySnapshot[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [showPendingOnly, setShowPendingOnly] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: 'id' | 'currentStock' | 'pendingOrderQty', direction: 'asc' | 'desc' }>({ key: 'currentStock', direction: 'desc' });

    const handleSort = (key: 'id' | 'currentStock' | 'pendingOrderQty') => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };
    
    // 1. Fetch History Data from the local-api-server
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/admin/inventory-history', {
                    headers: { 'x-requester-role': 'admin' }
                });
                if (res.ok) {
                    const data = await res.json();
                    setHistoryData(data);
                }
            } catch (err) {
                console.error('Failed to fetch inventory history:', err);
            } finally {
                setHistoryLoading(false);
            }
        };
        fetchHistory();
    }, []);

    // 1.5 Fetch Orders to sync with inventory
    const setOrders = useStore(state => state.setOrders);
    useEffect(() => {
        if (!user) return;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
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

    // Define internal stock orders for the top dashboard
    const sihwaOrders = useMemo(() => {
        return activeOrders.filter(order => {
            const displayCustomer = (order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '').toLowerCase();
            const normalizedCustomer = displayCustomer.replace(/\s+/g, '');
            const isInternalStock = 
                normalizedCustomer.includes('재고') || 
                normalizedCustomer.includes('서울') || 
                normalizedCustomer.includes('시화') || 
                normalizedCustomer.includes('에스제이엔브이') || 
                normalizedCustomer.includes('sjnv') || 
                normalizedCustomer.includes('알트에프') || 
                normalizedCustomer.includes('altf');
            
            // matches '서울' or '시화' as per new policy, or just general internal ALTF restock
            return isInternalStock;
        });
    }, [activeOrders]);

    // Split into Monthly Buckets
    const currentMonthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    const [selectedMonth, setSelectedMonth] = useState(currentMonthPrefix);

    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        sihwaOrders.forEach(o => {
            const m = new Date(o.createdAt).toISOString().slice(0, 7);
            months.add(m);
        });
        months.add(currentMonthPrefix); // Ensure current month is always an option
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

    // 3. Extract actual Purchase History for "서울재고" from all orders
    const recentSeoulPurchaseInfoMap = useMemo(() => {
        const pMap: Record<string, { price: number; date: string }> = {};
        
        // Sort orders by date ascending so that the latest (newest) order overwrites older ones
        // or sort descending and take the first one. Let's sort descending and break/continue isn't easy here,
        // so we'll just process ascending (oldest to newest) to let the newest win!
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
                        // Apply deduction logic (like rate 72 -> unitPrice * 28%) if the order actually used it
                        cost = Math.round((rawBasePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                    } else if (typeof itemRec.purchasePrice === 'number' && itemRec.purchasePrice > 0) {
                        cost = itemRec.purchasePrice;
                    } else {
                        cost = calculateFallbackPurchasePrice(id, rawBasePrice);
                    }

                    if (cost > 0) {
                        pMap[id] = {
                            price: cost,
                            date: new Date(order.createdAt).toISOString().split('T')[0]
                        };
                    }
                }
            }
        }
        return pMap;
    }, [orders]);

    // 4. Stock vs Pending Items Mapper
    const inventoryComparison = useMemo(() => {
        // Collect all items in inventory currently marked as Sihwa
        const comparisonMap: Record<string, { product: Partial<Product> & { id: string }, currentStock: number, pendingOrderQty: number, recentPurchasePrice: number, recentPurchaseDate: string | null, sellingPrice: number }> = {};

        inventory.forEach((item: Product) => {
            // Check if Sihwa
            let isSihwa = false;
            let qty = 0;

            if (item.locationStock) {
                for (const [key, q] of Object.entries(item.locationStock)) {
                    if (key.includes('서울') || key.includes('시화')) {
                        isSihwa = true;
                        qty += Number(q);
                    }
                }
            } else if ((item.location || '').includes('시화') || (item.location || '').includes('서울')) {
                isSihwa = true;
                qty = item.currentStock;
            }

            if (isSihwa && qty > 0) {
                const basePrice = item.base_price ?? item.unitPrice ?? 0;
                const recentInfo = recentSeoulPurchaseInfoMap[item.id];
                comparisonMap[item.id] = {
                    product: item,
                    currentStock: qty,
                    pendingOrderQty: 0,
                    recentPurchasePrice: recentInfo ? recentInfo.price : calculateFallbackPurchasePrice(item.id, basePrice),
                    recentPurchaseDate: recentInfo ? recentInfo.date : null,
                    sellingPrice: calculateSellingPrice(item.id, basePrice)
                };
            }
        });

        // Add Pending Order Qty
        sihwaOrders.filter(o => o.status !== 'COMPLETED').forEach(order => {
            const items = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            items.forEach(item => {
                if (item.transactionIssued) return; // 미결에서 처리 완료(입고 완료)된 항목은 대기 수량에서 제외

                const id = item.productId || (item as { item_id?: string }).item_id || 'UNKNOWN';
                
                let rawBasePrice = item.base_price ?? item.unitPrice ?? 0;
                const product = inventoryMap.get(id);
                if (product) {
                    rawBasePrice = item.base_price ?? product.base_price ?? product.unitPrice ?? 0;
                }

                const finalSellingPrice = calculateSellingPrice(id, rawBasePrice);
                const recentInfo = recentSeoulPurchaseInfoMap[id];
                const actualCost = recentInfo ? recentInfo.price : calculateFallbackPurchasePrice(id, rawBasePrice);
                const actualDate = recentInfo ? recentInfo.date : null;

                const addQty = Number(item.quantity ?? item.qty ?? 0);

                if (!comparisonMap[id]) {
                    comparisonMap[id] = {
                        product: product || { id, name: item.name || item.item_name || '미등록 상품', stockStatus: 'OUT_OF_STOCK' },
                        currentStock: 0,
                        pendingOrderQty: addQty,
                        recentPurchasePrice: actualCost,
                        recentPurchaseDate: actualDate,
                        sellingPrice: finalSellingPrice
                    };
                } else {
                    comparisonMap[id].pendingOrderQty += addQty;
                    comparisonMap[id].recentPurchasePrice = actualCost; // Overwrite with latest cost
                    comparisonMap[id].recentPurchaseDate = actualDate;
                    comparisonMap[id].sellingPrice = finalSellingPrice;
                }
            });
        });

        let result = Object.values(comparisonMap);
        
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            result = result.filter(r => r.product.id.toLowerCase().includes(lowerSearch));
        }

        if (showPendingOnly) {
            result = result.filter(r => r.pendingOrderQty > 0 || r.currentStock <= 0);
        }

        return result.sort((a, b) => {
            const isStubA = a.product.id.toLowerCase().includes('stubend');
            const isStubB = b.product.id.toLowerCase().includes('stubend');
            
            if (isStubA && !isStubB) return 1;
            if (!isStubA && isStubB) return -1;

            const dir = sortConfig.direction === 'asc' ? 1 : -1;
            if (sortConfig.key === 'id') {
                return a.product.id.localeCompare(b.product.id) * dir;
            }
            if (sortConfig.key === 'currentStock') {
                return (a.currentStock - b.currentStock) * dir;
            }
            if (sortConfig.key === 'pendingOrderQty') {
                return (a.pendingOrderQty - b.pendingOrderQty) * dir;
            }
            return 0;
        });
    }, [inventory, inventoryMap, sihwaOrders, searchTerm, sortConfig, showPendingOnly, recentSeoulPurchaseInfoMap]);

    // Calculate totals (excluding STUBEND)
    const totalsMap = useMemo(() => {
        let totalCurrentStockValue = 0;
        let totalCurrentStockCost = 0;
        let totalPendingPurchaseValue = 0;

        inventoryComparison.forEach(row => {
            if (row.product.id.toLowerCase().includes('stubend')) return;
            totalCurrentStockValue += (row.currentStock * row.sellingPrice);
            totalCurrentStockCost += (row.currentStock * row.recentPurchasePrice);
            totalPendingPurchaseValue += (row.pendingOrderQty * row.recentPurchasePrice);
        });

        return {
            totalCurrentStockValue,
            totalCurrentStockCost,
            totalPendingPurchaseValue
        };
    }, [inventoryComparison]);

    if (user?.role === 'MANAGER') {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-center pb-40">
                <AlertTriangle className="w-16 h-16 text-rose-300 mb-4" />
                <h2 className="text-xl font-bold text-slate-700">접근 권한이 제한되었습니다</h2>
                <p className="text-slate-500 mt-2">이 페이지는 최고 관리자(MASTER) 전용입니다.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <Factory className="w-6 h-6 text-indigo-600" />
                        시화재고 통합 관리
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        월별 구매 현황, 보유량 대조 및 재고 증감 일일 트렌드를 파악합니다.
                    </p>
                </div>
            </div>

            {/* A. Monthly Purchase Dashboard */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-800 text-white px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-indigo-400" />
                        <h2 className="font-bold">월별 시화재고 보충(매입) 현황</h2>
                    </div>
                    <select
                        title="월 선택"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="bg-slate-700 border-none rounded text-sm py-1.5 px-3 text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder-white appearance-none"
                    >
                        {availableMonths.map(m => (
                            <option key={m} value={m}>{m} 월</option>
                        ))}
                    </select>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 bg-indigo-50/30">
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Box className="w-24 h-24 text-teal-600" />
                        </div>
                        <div className="flex items-center gap-2 mb-2 text-slate-500">
                            <PackageSearch className="w-4 h-4 text-teal-500" />
                            <span className="font-bold text-sm">입고 완료 (COMPLETED)</span>
                        </div>
                        <div className="text-3xl font-black text-slate-800 mb-1">
                            {formatCur(monthData.completedCost)} <span className="text-lg text-slate-400 font-bold tracking-normal">원</span>
                        </div>
                        <div className="text-sm font-bold text-teal-600">
                            총 {monthData.completedCount}건 매입 완료
                        </div>
                    </div>

                    <div className="bg-white p-5 rounded-xl border border-rose-100 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                            <AlertTriangle className="w-24 h-24 text-rose-600" />
                        </div>
                        <div className="flex items-center gap-2 mb-2 text-rose-500">
                            <TrendingUp className="w-4 h-4" />
                            <span className="font-bold text-sm">미결 / 대기건 (PENDING)</span>
                        </div>
                        <div className="text-3xl font-black text-rose-600 mb-1">
                            {formatCur(monthData.pendingCost)} <span className="text-lg text-rose-300 font-bold tracking-normal">원</span>
                        </div>
                        <div className="text-sm font-bold text-rose-500">
                            발주 진행 (잔여) {monthData.pendingCount}건 대기 중
                        </div>
                    </div>
                </div>
            </div>

            {/* B. Daily Trend Analyzer */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
                    <History className="w-5 h-5 text-amber-500" />
                    <h2 className="font-bold text-slate-800">최근 일간 재고 변동 트렌드 (10일 이내)</h2>
                </div>
                <div className="p-0 max-h-[300px] overflow-y-auto">
                    {historyLoading ? (
                        <div className="p-8 text-center text-slate-400">데이터를 불러오는 중입니다...</div>
                    ) : historyData.length === 0 ? (
                        <div className="p-8 text-center text-slate-400">최근 기록된 변동 이력이 없습니다. (내일 첫 구동 시 생성됩니다)</div>
                    ) : (
                        <div className="p-0">
                            {historyData.slice(-10).reverse().map((snap, idx) => {
                                const isFirstEver = historyData.length > 0 && snap.date === historyData[0].date;
                                return (
                                <div key={idx} className="border-b border-slate-100 last:border-0 p-4">
                                    <h3 className="font-bold text-slate-800 mb-3 flex flex-wrap items-center gap-2">
                                        <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-mono shrink-0">{snap.date}</span>
                                        {isFirstEver ? (
                                            <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-[11px] font-bold border border-indigo-100">
                                                초기 기준점 수립 (총 {Object.keys(snap.stock || {}).length}개 품목)
                                            </span>
                                        ) : (
                                            <span className="text-slate-600 font-medium text-sm">변동 항목 {snap.diff?.length || 0}건</span>
                                        )}
                                    </h3>
                                    
                                    {snap.diff && snap.diff.length > 0 ? (
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                            {snap.diff.map((d, dIdx) => (
                                                <div key={dIdx} className={`flex items-center justify-between text-sm bg-slate-50 p-2.5 rounded-lg border border-slate-100 border-l-4 ${d.change > 0 ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
                                                    <span className="font-bold text-slate-700 truncate mr-2" title={d.name}>{d.name}</span>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        <span className="text-slate-400 font-mono text-xs">{d.from} → {d.to}</span>
                                                        <span className={`font-black font-mono w-16 text-right ${d.change > 0 ? 'text-teal-600' : 'text-rose-500'}`}>
                                                            {d.change > 0 ? '+' : ''}{d.change} 
                                                        </span>
                                                        {d.change < 0 ? (
                                                            <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold">출고</span>
                                                        ) : (
                                                            <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-bold">입고</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : isFirstEver ? (
                                        <div className="flex items-center gap-3 pl-2 bg-indigo-50/40 p-4 rounded-xl border border-indigo-100/60 mt-1">
                                            <span className="animate-pulse bg-indigo-500 w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.7)] shrink-0"></span>
                                            <p className="text-sm font-bold text-indigo-800 leading-snug">
                                                시화재고 통합관리가 시작된 <span className="underline decoration-indigo-300 underline-offset-4">첫 운영일</span>입니다! <br/>
                                                <span className="font-medium text-indigo-600 text-[13px] mt-1 inline-block">오늘 시스템이 기록한 재고 세팅값이 내일부터 발생하는 모든 출·입고 변동의 정확한 기준점으로 활용됩니다.</span>
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-500 font-medium pl-2 bg-slate-50/50 py-2 px-3 rounded-lg border border-slate-100">
                                            전날 대비 수량 변동이 발생한 품목이 없습니다.
                                            <span className="text-xs text-slate-400 ml-2 font-normal">(현재 {Object.keys(snap.stock || {}).length}종류의 재고 품목 추적 유지중)</span>
                                        </p>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* C. Stock vs Pending Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50">
                    <div className="flex items-center gap-2">
                        <Box className="w-5 h-5 text-teal-600" />
                        <h2 className="font-bold text-slate-800">
                            품목별 현재고 vs 입고 대기 (발주) 수량
                        </h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={showPendingOnly}
                                onChange={e => setShowPendingOnly(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span className="font-bold">입고 대기 및 결품/보충 필요 품목만 보기</span>
                        </label>
                        <input
                            type="text"
                            placeholder="ID 검색..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="bg-white border border-slate-300 rounded text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
                        />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100/50 border-y border-slate-200 text-slate-500 uppercase text-xs whitespace-nowrap">
                            <tr>
                                <th 
                                    className="px-5 py-3 font-bold cursor-pointer hover:bg-slate-200 transition-colors"
                                    onClick={() => handleSort('id')}
                                >
                                    품목 ID {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="px-5 py-3 font-bold text-right text-teal-600">실제 판매 단가</th>
                                <th className="px-5 py-3 font-bold text-right">매입 실적가</th>
                                <th 
                                    className="px-5 py-3 font-bold text-right text-indigo-600 cursor-pointer hover:bg-slate-200 transition-colors"
                                    onClick={() => handleSort('currentStock')}
                                >
                                    현재 보유고 {sortConfig.key === 'currentStock' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="px-5 py-3 font-bold text-center">잔량 비교</th>
                                <th 
                                    className="px-5 py-3 font-bold text-right text-rose-500 cursor-pointer hover:bg-slate-200 transition-colors"
                                    onClick={() => handleSort('pendingOrderQty')}
                                >
                                    입고 대기 (발주진행) {sortConfig.key === 'pendingOrderQty' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="px-5 py-3 font-bold text-center">긴급성</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {invLoading ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">데이터를 불러오는 중입니다...</td>
                                </tr>
                            ) : inventoryComparison.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">비교할 시화재고 품목이 없습니다.</td>
                                </tr>
                            ) : (
                                inventoryComparison.map((row) => (
                                    <tr key={row.product.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-3 font-bold font-mono text-xs text-slate-700 whitespace-nowrap">{row.product.id}</td>
                                        <td className="px-5 py-3 text-right font-mono text-teal-700 bg-teal-50/20">
                                            {formatCur(row.sellingPrice)}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <div className="font-mono text-slate-600 font-bold">
                                                {formatCur(row.recentPurchasePrice)}
                                            </div>
                                            {row.recentPurchaseDate && (
                                                <div className="text-[10px] text-slate-400 mt-0.5" title="최근 서울재고 매입 기준">
                                                    {row.recentPurchaseDate}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono font-black text-indigo-700 bg-indigo-50/30">
                                            {row.currentStock.toLocaleString()}
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            {row.pendingOrderQty > 0 ? (
                                                <span className="text-rose-400 mx-2">←</span>
                                            ) : (
                                                <span className="text-slate-300 mx-2">-</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono font-black text-rose-600 bg-rose-50/30">
                                            {row.pendingOrderQty > 0 ? row.pendingOrderQty.toLocaleString() : '-'}
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            {row.currentStock <= 0 && row.pendingOrderQty > 0 ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 animate-pulse">긴급 보충!</span>
                                            ) : row.pendingOrderQty > 0 ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">보충중</span>
                                            ) : row.currentStock <= 0 && row.pendingOrderQty === 0 ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">결품</span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-700">보유중</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        {inventoryComparison.length > 0 && (
                            <tfoot className="bg-slate-100/80 border-t-2 border-slate-300 font-bold">
                                <tr>
                                    <td className="px-5 py-4 text-slate-800 text-sm">
                                        총계 (STUBEND 제외)
                                    </td>
                                    <td className="px-5 py-4 text-right text-teal-700 text-sm border-l border-slate-200">
                                        판매가 기준 보유재고 총액:<br/>
                                        <span className="text-lg">{formatCur(totalsMap.totalCurrentStockValue)}</span> 원
                                    </td>
                                    <td className="px-5 py-4 text-right text-indigo-700 text-sm border-l border-slate-200">
                                        매입 실적가 기준 보유재고 총액:<br/>
                                        <span className="text-lg">{formatCur(totalsMap.totalCurrentStockCost)}</span> 원
                                    </td>
                                    <td colSpan={2} className="px-5 py-4 border-l border-slate-200"></td>
                                    <td className="px-5 py-4 text-right text-rose-600 text-sm border-l border-slate-200">
                                        실적가 기준 입고 대기(발주) 총액:<br/>
                                        <span className="text-lg">{formatCur(totalsMap.totalPendingPurchaseValue)}</span> 원
                                    </td>
                                    <td className="px-5 py-4 border-l border-slate-200"></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
            
        </div>
    );
}
