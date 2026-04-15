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
    Download
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import type { Product } from '../../types';
import salesHistoryRaw from '../../data/sales_history.json';

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

// Helper: Calculate Fallback Purchase Price based on item rules
const calculateFallbackPurchasePrice = (id: string, basePrice: number): number => {
    const upperId = id.toUpperCase();
    if (upperId.endsWith('-S') && !upperId.startsWith('CAP')) {
        return Math.round((basePrice * 55 / 100) / 10) * 10;
    } else {
        return Math.round((basePrice * 28 / 100) / 10) * 10;
    }
};

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
    const { orders, user, addItem } = useStore(useShallow(state => ({ 
        orders: state.orders, 
        user: state.auth.user,
        addItem: state.addItem
    })));
    const navigate = useNavigate();
    const { inventory, isLoading: invLoading } = useInventory();
    
    const [historyData, setHistoryData] = useState<InventoryHistorySnapshot[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'AI_SUMMARY' | 'TOTAL_DASHBOARD' | 'ALL_TABLE'>('AI_SUMMARY');
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        'CRITICAL': true,
        'WARNING': true,
        'REGULAR': true
    });

    const [selectedCriticalIds, setSelectedCriticalIds] = useState<Set<string>>(new Set());
    const [selectedWarningIds, setSelectedWarningIds] = useState<Set<string>>(new Set());
    const [selectedRegularIds, setSelectedRegularIds] = useState<Set<string>>(new Set());
    
    const [expandedTrendItems, setExpandedTrendItems] = useState<Record<string, boolean>>({});
    const [expandedDailyGroups, setExpandedDailyGroups] = useState<Record<string, boolean>>({});

    const [sortConfig, setSortConfig] = useState<{ 
        key: 'id' | 'salesFreq' | 'salesVolume' | 'deficit' | 'shQty' | 'ysQty' | 'pendingOrderQty' | 'recentPurchasePrice', 
        direction: 'asc' | 'desc' 
    }>({ key: 'deficit', direction: 'desc' });

    const handleSort = (key: 'id' | 'salesFreq' | 'salesVolume' | 'deficit' | 'shQty' | 'ysQty' | 'pendingOrderQty' | 'recentPurchasePrice') => {
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
    }

    const analyzedInventory = useMemo(() => {
        const comparisonMap: Record<string, AnalyzedItem> = {};

        const nowTime = Date.now();
        const thirtyDaysAgo = nowTime - (30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = nowTime - (7 * 24 * 60 * 60 * 1000);
        
        const recentSalesMap: Record<string, { recent7d: number, recent30d: number }> = {};
        historyData.forEach(snap => {
            const snapDate = new Date(snap.date).getTime();
            if (isNaN(snapDate)) return;
            const isWithin7d = snapDate >= sevenDaysAgo;
            const isWithin30d = snapDate >= thirtyDaysAgo;

            if (isWithin30d && snap.diff) {
                snap.diff.forEach(d => {
                    if (d.change < 0) {
                        const absChg = Math.abs(d.change);
                        if (!recentSalesMap[d.id]) recentSalesMap[d.id] = { recent7d: 0, recent30d: 0 };
                        recentSalesMap[d.id].recent30d += absChg;
                        if (isWithin7d) {
                            recentSalesMap[d.id].recent7d += absChg;
                        }
                    }
                });
            }
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

            const salesData = salesHistory[item.id] || { salesVolume: 0, salesFreq: 0 };
            const basePrice = item.base_price ?? item.unitPrice ?? 0;
            const recentInfo = recentSeoulPurchaseInfoMap[item.id];
            const recentSales = recentSalesMap[item.id] || { recent7d: 0, recent30d: 0 };
            
            // Populate items (if it has stock or sales data, we analyze it)
            if (shQty > 0 || ysQty > 0 || salesData.salesVolume > 0 || recentSales.recent30d > 0) {
                comparisonMap[item.id] = {
                    product: item,
                    shQty,
                    ysQty,
                    pendingOrderQty: 0,
                    recentPurchasePrice: recentInfo ? recentInfo.price : calculateFallbackPurchasePrice(item.id, basePrice),
                    recentPurchaseDate: recentInfo ? recentInfo.date : null,
                    sellingPrice: calculateSellingPrice(item.id, basePrice),
                    salesVolume: salesData.salesVolume,
                    salesFreq: salesData.salesFreq,
                    recent7dSales: recentSales.recent7d,
                    recent30dSales: recentSales.recent30d
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
                    
                    comparisonMap[id] = {
                        product: product || { id, name: item.name || item.item_name || '미등록 상품', stockStatus: 'OUT_OF_STOCK' },
                        shQty: 0,
                        ysQty: 0,
                        pendingOrderQty: addQty,
                        recentPurchasePrice: recentInfo ? recentInfo.price : calculateFallbackPurchasePrice(id, rawBasePrice),
                        recentPurchaseDate: recentInfo ? recentInfo.date : null,
                        sellingPrice: finalSellingPrice,
                        salesVolume: 0,
                        salesFreq: 0,
                        recent7dSales: 0,
                        recent30dSales: 0
                    };
                } else {
                    comparisonMap[id].pendingOrderQty += addQty;
                }
            });
        });

        // Step 3: Run AI Rules for status computation
        const processedList = Object.values(comparisonMap).map(row => {
            const rawSafeStock = Math.ceil((row.salesVolume / 12) * 1.5);
            let safeStock = rawSafeStock > 0 ? Math.max(10, Math.round(rawSafeStock / 10) * 10) : 0;
            
            // AI Filter Rules
            const mat = (row.product.material || '').toUpperCase();
            if (mat.startsWith('WP') || mat.includes('CARBON')) {
                safeStock = 0; // WP/Carbon items don't need Sihwa stock
            }
            if (row.salesFreq < 10) {
                safeStock = 0; // Low frequency (<10) items excluded from re-order needs
            }

            // REQUIREMENT 3: INCLUDE PENDING ORDERS as effective stock
            const effectiveStock = row.shQty + row.pendingOrderQty; 
            const deficit = safeStock - effectiveStock;

            let statusCategory = 'IDLE'; 
            let statusLabel = '대기/데이터없음';

            if (row.salesVolume > 0 && safeStock > 0) {
                if (effectiveStock <= 0) {
                    if (row.ysQty <= 0) {
                        if (row.salesVolume >= 50) {
                            statusCategory = 'CRITICAL';
                            statusLabel = '🚨 선발주 (매입결품)';
                        } else {
                            // Exclude from urgent pre-order if volume < 50, demote to normal order
                            statusCategory = 'WARNING';
                            statusLabel = '⚠️ 일반 결품 (소량)';
                        }
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 결품 (단기조달요망)';
                    }
                } else if (effectiveStock < safeStock) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 안전재고 미달';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                 statusCategory = 'SAFE';
                 statusLabel = '✅ 미활동 보유품';
            }

            return {
                ...row,
                safeStock,
                deficit: deficit > 0 ? deficit : 0,
                effectiveStock,
                statusCategory,
                statusLabel
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
                default: return 0; // Fallback
            }
        });
    }, [inventory, sihwaOrders, inventoryMap, recentSeoulPurchaseInfoMap, searchTerm, sortConfig, historyData]);

    // Aggregate stats and Asset Valuation totals
    const stats = useMemo(() => {
        const regular = analyzedInventory
            .filter(r => r.statusCategory === 'SAFE' && r.salesFreq >= 20)
            .map(r => {
                const rawRecommended = (r.salesVolume / 6) - r.shQty;
                const recommendedQty = rawRecommended > 0 ? Math.max(10, Math.ceil(rawRecommended / 10) * 10) : 0;
                return { ...r, recommendedQty };
            })
            .filter(r => r.recommendedQty > 0);

        return {
            critical: analyzedInventory.filter(r => r.statusCategory === 'CRITICAL'),
            warning: analyzedInventory.filter(r => r.statusCategory === 'WARNING'),
            safeActive: analyzedInventory.filter(r => r.statusCategory === 'SAFE' && r.salesFreq > 10),
            regular
        };
    }, [analyzedInventory]);

    const handleCreateOrder = (selectedSet: Set<string>, listType: 'CRITICAL' | 'WARNING' | 'REGULAR') => {
        if (selectedSet.size === 0) return;
        
        let listItems: any[] = [];
        if (listType === 'CRITICAL') listItems = stats.critical;
        else if (listType === 'WARNING') listItems = stats.warning;
        else listItems = stats.regular;

        const itemsToAdd = listItems.filter(item => selectedSet.has(item.product.id));

        itemsToAdd.forEach(row => {
            let qty = 0;
            if (listType === 'REGULAR') {
                qty = row.recommendedQty || 0;
            } else {
                qty = row.deficit > 0 ? row.deficit : 0;
                qty = Math.max(10, Math.ceil(qty / 10) * 10);
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

    if (user?.role === 'MANAGER') {
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
                        <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-teal-400">76%</div>
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
                <div className="flex flex-col gap-2 bg-black/20 p-3 rounded-xl border border-white/10 md:w-64">
                    <div className="flex justify-between text-xs font-bold text-slate-300">
                        <span>현재 데이터 연동률</span>
                        <span className="text-white">76% / 100%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-400 w-[76%] rounded-full shadow-[0_0_10px_rgba(45,212,191,0.5)]"></div>
                    </div>
                    <span className="text-[10px] text-right text-slate-400">CRM 연동 + 웹 주문 활성화 대기중</span>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 xl:gap-6">
                <div className="bg-linear-to-br from-rose-500 to-red-600 rounded-2xl p-5 shadow-lg shadow-rose-200 text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-6 -mt-6 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <AlertTriangle className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><AlertTriangle className="w-5 h-5"/>매입처 동반 결품 (선발주 요망)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.critical.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10 break-keep">시화 실효재고가 부족하고, 대경 재고도 바닥나 특별 관리가 필요한 초긴급 품목입니다.</p>
                </div>
                
                <div className="bg-linear-to-br from-amber-400 to-orange-500 rounded-2xl p-5 shadow-lg shadow-amber-200 text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-20 transform group-hover:rotate-12 transition-transform duration-500">
                        <Box className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><Factory className="w-5 h-5"/>일반 보충 (안전재고 미달)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.warning.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10">대경 재고는 보유 중이나, 예정된 입고(Pending)를 합쳐도 안전 목표치에 미달된 품목입니다.</p>
                </div>

                <div className="bg-linear-to-br from-slate-700 to-slate-900 rounded-2xl p-5 shadow-lg shadow-slate-300 text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:-translate-y-2 transition-transform duration-500">
                        <Activity className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><TrendingUp className="w-5 h-5"/>매입 실적가 기준 기초 자산</h3>
                    <p className="text-3xl font-black mb-1 z-10">{formatCur(totalsMap.totalCurrentStockCost)} <span className="text-[16px] font-bold opacity-80 tracking-normal">원</span></p>
                    <p className="text-sm font-medium opacity-80 z-10">현재 보유 중인 시화재고 전체의 실매입 추정 자산가치입니다 (Stubend 제외)</p>
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
                            AI 요약보기 (Action Items)
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
                                <div className="space-y-4 max-w-6xl mx-auto pb-8 p-4 md:p-0">
                                    <div className="border border-rose-200 rounded-xl overflow-hidden shadow-sm">
                                        <button onClick={() => toggleGroup('CRITICAL')} className="w-full flex items-center justify-between px-5 py-4 bg-rose-50 hover:bg-rose-100 transition-colors">
                                            <div className="flex items-center gap-3">
                                                {expandedGroups['CRITICAL'] ? <ChevronDown className="w-5 h-5 text-rose-500"/> : <ChevronRight className="w-5 h-5 text-rose-500"/>}
                                                <h3 className="font-bold text-rose-800 text-lg">🚨 선발주 요망 리스트 <span className="text-sm font-medium text-rose-500 ml-2">(대경매입처 동반 결품 위험)</span></h3>
                                            </div>
                                            <span className="bg-rose-200 text-rose-800 font-black px-3 py-1 rounded-full text-sm">{stats.critical.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['CRITICAL'] && (
                                            <div className="bg-white border-t border-rose-100 overflow-x-auto">
                                                {stats.critical.length > 0 ? (
                                                <table className="w-full text-sm text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none">
                                                        <tr>
                                                            <th className="px-5 py-3 w-12 text-center">
                                                                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-600" 
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
                                                            <th className="px-5 py-3">🚨 분석 근거 (명확성)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.critical.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50">
                                                                <td className="px-5 py-4 text-center">
                                                                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-600"
                                                                        checked={selectedCriticalIds.has(row.product.id)}
                                                                        onChange={(e) => {
                                                                            const newSet = new Set(selectedCriticalIds);
                                                                            if (e.target.checked) newSet.add(row.product.id);
                                                                            else newSet.delete(row.product.id);
                                                                            setSelectedCriticalIds(newSet);
                                                                        }}
                                                                    />
                                                                </td>
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-800">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-rose-600 bg-rose-50/30">0</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-slate-400">0</td>
                                                                <td className="px-5 py-4 text-center font-bold text-slate-400">
                                                                    {row.pendingOrderQty > 0 ? <span className="text-indigo-600">+{row.pendingOrderQty} 대기중</span> : '없음'}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                <td className="px-5 py-4 text-right font-black text-rose-600 bg-rose-50/10">{formatCur(row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1))}</td>
                                                                <td className="px-5 py-4 text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                                                    <Info className="w-3.5 h-3.5 text-rose-500"/>
                                                                    실효재고 <span className="font-bold text-rose-600">{row.effectiveStock}</span> &lt; 목표재고 <span className="font-bold text-indigo-600">{row.safeStock}</span> (연 {row.salesVolume}개 판매됨)
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
                                                            <td colSpan={4} className="px-5 py-4 text-right font-bold text-slate-700">
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
                                                <h3 className="font-bold text-amber-800 text-lg">⚠️ 일반 발주 필요 <span className="text-sm font-medium text-amber-600 ml-2">(입고 대기물량을 고려해도 부족함)</span></h3>
                                            </div>
                                            <span className="bg-amber-200 text-amber-800 font-black px-3 py-1 rounded-full text-sm">{stats.warning.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['WARNING'] && (
                                            <div className="bg-white border-t border-amber-100 overflow-x-auto">
                                                {stats.warning.length > 0 ? (
                                                <table className="w-full text-sm text-left">
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
                                                            <th className="px-5 py-3 text-right">안전재고(목표)</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('pendingOrderQty')}>입고 대기중 {sortConfig.key==='pendingOrderQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('ysQty')}>대경재고 {sortConfig.key==='ysQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right">매입단가</th>
                                                            <th className="px-5 py-3 text-right">필요예산 (단가×결핍수량)</th>
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
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-800">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-slate-600 bg-amber-50/10">
                                                                    {row.shQty}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-indigo-600">
                                                                    {row.safeStock}
                                                                    <div className="text-[10px] font-normal text-slate-400 mt-1">/ 총판매:{row.salesVolume}</div>
                                                                </td>
                                                                <td className="px-5 py-4 text-center font-bold text-slate-500">
                                                                    {row.pendingOrderQty > 0 ? <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">+{row.pendingOrderQty}</span> : '-'}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-teal-600">
                                                                    {row.ysQty}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                <td className="px-5 py-4 text-right font-black text-amber-700 bg-amber-50/30">{formatCur(row.recentPurchasePrice * (row.deficit > 0 ? row.deficit : 1))}</td>
                                                                <td className="px-5 py-4 text-xs font-medium text-slate-600 flex items-center gap-1.5 whitespace-nowrap">
                                                                    <Info className="w-3.5 h-3.5 text-amber-500"/>
                                                                    실효재고 결핍: <span className="font-bold text-rose-500">-{row.deficit}개</span> (연 판매 {row.salesFreq}회)
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
                                                            <td colSpan={4} className="px-5 py-4 text-right font-bold text-slate-700">
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
                                                <h3 className="font-bold text-indigo-800 text-lg">♻️ 정기 발주 예측 <span className="text-sm font-medium text-indigo-500 ml-2">(우량 품목 2개월분 선주문 권장)</span></h3>
                                            </div>
                                            <span className="bg-indigo-200 text-indigo-800 font-black px-3 py-1 rounded-full text-sm">{stats.regular.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['REGULAR'] && (
                                            <div className="bg-white border-t border-indigo-100 overflow-x-auto">
                                                {stats.regular.length > 0 ? (
                                                <table className="w-full text-sm text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100 select-none">
                                                        <tr>
                                                            <th className="px-5 py-3 w-12 text-center">
                                                                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600" 
                                                                    checked={stats.regular.length > 0 && selectedRegularIds.size === stats.regular.length}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) setSelectedRegularIds(new Set(stats.regular.map(r => r.product.id)));
                                                                        else setSelectedRegularIds(new Set());
                                                                    }}
                                                                />
                                                            </th>
                                                            <th className="px-5 py-3 cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('id')}>품목 코드 {sortConfig.key==='id' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-right cursor-pointer hover:bg-slate-200 transition" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key==='shQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                                            <th className="px-5 py-3 text-center">판매/보충 이력</th>
                                                            <th className="px-5 py-3 text-right">매입단가</th>
                                                            <th className="px-5 py-3 text-right w-40">추천 발주량</th>
                                                            <th className="px-5 py-3">💡 분석 근거</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.regular.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50">
                                                                <td className="px-5 py-4 text-center">
                                                                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                                                                        checked={selectedRegularIds.has(row.product.id)}
                                                                        onChange={(e) => {
                                                                            const newSet = new Set(selectedRegularIds);
                                                                            if (e.target.checked) newSet.add(row.product.id);
                                                                            else newSet.delete(row.product.id);
                                                                            setSelectedRegularIds(newSet);
                                                                        }}
                                                                    />
                                                                </td>
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-800">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-slate-600 bg-indigo-50/10">{row.shQty}</td>
                                                                <td className="px-5 py-4 text-center text-xs font-medium text-slate-500">
                                                                    연 {row.salesFreq}회 판매 / 누적 {row.salesVolume}개
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-bold text-slate-600">{formatCur(row.recentPurchasePrice)}</td>
                                                                <td className="px-5 py-4 text-right font-black text-indigo-600 bg-indigo-50/30">
                                                                    {row.recommendedQty}
                                                                </td>
                                                                <td className="px-5 py-4 text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                                                    <Activity className="w-3.5 h-3.5 text-indigo-500"/>
                                                                    월평균 <span className="font-bold">{Math.round(row.salesVolume / 12)}개</span> 소요 / <span className="text-indigo-600 font-bold">2개월분</span> 권장
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="bg-indigo-50/50 border-t-2 border-indigo-200">
                                                        <tr>
                                                            <td colSpan={3} className="px-5 py-4">
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
                                <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-0">
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
                                                ) : historyData.length === 0 ? (
                                                    <div className="p-8 text-center text-slate-400">최근 변동 이력이 없습니다.</div>
                                                ) : (
                                                    <div className="p-0">
                                                        {historyData.slice(-10).reverse().map((snap, idx) => {
                                                            let dailyRevenue = 0;
                                                            let dailyCost = 0;
                                                            
                                                            if (snap.diff) {
                                                                snap.diff.forEach(d => {
                                                                    const analysis = d.id ? analyzedInventory.find(ai => ai.product.id === d.id) : null;
                                                                    
                                                                    // Use cumulative sales if available, otherwise fallback to pure negative net change
                                                                    const effectiveSales = d.sales !== undefined ? d.sales : (d.change < 0 ? Math.abs(d.change) : 0);
                                                                    if (effectiveSales > 0) {
                                                                        dailyRevenue += effectiveSales * (analysis ? analysis.sellingPrice : 0);
                                                                    }
                                                                    
                                                                    // Compute true net restocking (overcoming sales deficits)
                                                                    const effectiveRestock = d.change + effectiveSales;
                                                                    if (effectiveRestock > 0) {
                                                                        dailyCost += effectiveRestock * (analysis ? analysis.recentPurchasePrice : 0);
                                                                    }
                                                                });
                                                            }

                                                            const isGroupExpanded = expandedDailyGroups[snap.date] ?? (idx === 0);

                                                            return (
                                                                <div key={idx} className="border-b border-slate-100 last:border-0 p-4">
                                                                    <div className="flex flex-col gap-2 mb-3">
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-mono font-bold hover:bg-slate-300 cursor-pointer transition-colors" onClick={() => toggleDailyGroup(snap.date)}>{snap.date}</span>
                                                                            <span className="text-slate-500 font-medium text-xs">변동 {snap.diff?.length || 0}건</span>
                                                                        </div>
                                                                        
                                                                        {(dailyRevenue > 0 || dailyCost > 0) && (
                                                                            <div 
                                                                                className="flex items-center gap-3 mt-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:bg-slate-100 transition-colors"
                                                                                onClick={() => toggleDailyGroup(snap.date)}
                                                                            >
                                                                                <div className="flex flex-col flex-1 pl-2 border-l-4 border-indigo-400">
                                                                                    <span className="text-[10px] text-slate-500 font-bold tracking-tight">총 일일매출(출고)</span>
                                                                                    <span className="text-sm font-black text-indigo-700">₩{formatCur(dailyRevenue)}</span>
                                                                                </div>
                                                                                <div className="w-px h-8 bg-slate-200"></div>
                                                                                <div className="flex flex-col flex-1 pl-2 border-l-4 border-emerald-400">
                                                                                    <span className="text-[10px] text-slate-500 font-bold tracking-tight">총 매입가치(입고)</span>
                                                                                    <span className="text-sm font-black text-emerald-700">₩{formatCur(dailyCost)}</span>
                                                                                </div>
                                                                                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`} />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    {isGroupExpanded && (
                                                                        snap.diff && snap.diff.length > 0 ? (
                                                                            <div className="grid grid-cols-1 gap-2 mt-2">
                                                                                {[...snap.diff].sort((a, b) => {
                                                                                    const aiA = a.id ? analyzedInventory.find(ai => ai.product.id === a.id) : null;
                                                                                    const aiB = b.id ? analyzedInventory.find(ai => ai.product.id === b.id) : null;
                                                                                    return (aiB ? aiB.deficit : 0) - (aiA ? aiA.deficit : 0);
                                                                                }).map((d, dIdx) => {
                                                                                    const rowKey = `${snap.date}-${d.id || d.name}-${dIdx}`;
                                                                                    const isExpanded = !!expandedTrendItems[rowKey];
                                                                                    const analysis = d.id ? analyzedInventory.find(ai => ai.product.id === d.id) : null;
                                                                                    const sellingPrice = analysis ? analysis.sellingPrice : 0;
                                                                                    const purchasePrice = analysis ? analysis.recentPurchasePrice : 0;
                                                                                    
                                                                                    const effectiveSales = d.sales !== undefined ? d.sales : (d.change < 0 ? Math.abs(d.change) : 0);
                                                                                    const effectiveRestock = d.change + effectiveSales;
                                                                                    
                                                                                    const valueChips = [];
                                                                                    if (effectiveSales > 0) {
                                                                                        valueChips.push({
                                                                                            label: `출고/판매 ${effectiveSales}개`,
                                                                                            amt: `매출 ${formatCur(effectiveSales * sellingPrice)}원`,
                                                                                            style: 'text-indigo-600 bg-indigo-50 border border-indigo-200'
                                                                                        });
                                                                                    }
                                                                                    if (effectiveRestock > 0) {
                                                                                        valueChips.push({
                                                                                            label: `입고 ${effectiveRestock}개`,
                                                                                            amt: `가치 ${formatCur(effectiveRestock * purchasePrice)}원`,
                                                                                            style: 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                                                                        });
                                                                                    }

                                                                                    const finalId = d.id || d.name || '알수없음';

                                                                                    return (
                                                                                        <div key={dIdx} className={`flex flex-col text-xs bg-white rounded border border-slate-100 border-l-4 ${d.change > 0 ? 'border-l-emerald-500' : 'border-l-indigo-500'}`}>
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
                                                                                                                    현재고 <span className="font-bold text-slate-700">{analysis.shQty}</span> / 안전재고 <span className="font-bold text-slate-700">{analysis.safeStock}</span>
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
                                                                                                            {valueChips.length === 0 && d.change === 0 && (
                                                                                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">임시 변동 (0)</span>
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
                                                                                                        <span className="text-[10px] text-slate-400 font-bold">안전재고(목표)</span>
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
                                                                        ) : <p className="text-xs text-slate-400 mt-2 px-1">상세 변동 내역이 없습니다.</p>
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
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-amber-700" onClick={() => handleSort('salesVolume')}>1년 누적 출고 {sortConfig.key==='salesVolume' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-indigo-700" onClick={() => handleSort('shQty')}>시화재고 {sortConfig.key==='shQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-rose-600" onClick={() => handleSort('pendingOrderQty')}>입고 대기(+Pending) {sortConfig.key==='pendingOrderQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-rose-500 font-black" onClick={() => handleSort('deficit')}>보충 필요분(Deficit) {sortConfig.key==='deficit' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 transition text-teal-700" onClick={() => handleSort('recentPurchasePrice')}>최근 매입단가 {sortConfig.key==='recentPurchasePrice' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                            <th className="px-4 py-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('ysQty')}>대경 재고 {sortConfig.key==='ysQty' && (sortConfig.direction==='asc'?'↑':'↓')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {/* Show Summary row first */}
                                        <tr className="bg-indigo-50/50 font-bold border-b-2 border-indigo-200">
                                            <td className="px-4 py-3 text-slate-700">총 자산 합계(STUBEND제외)</td>
                                            <td className="px-4 py-3 text-right"></td>
                                            <td className="px-4 py-3 text-right text-indigo-700">{formatCur(totalsMap.totalCurrentStockCost)} 원</td>
                                            <td className="px-4 py-3 text-right text-rose-600">추가예정 (+{formatCur(totalsMap.totalPendingPurchaseValue)}원)</td>
                                            <td colSpan={3}></td>
                                        </tr>
                                        {analyzedInventory.slice(0, 500).map(row => (
                                            <tr key={row.product.id} className="hover:bg-slate-50 group">
                                                <td className="px-4 py-2 font-mono font-bold text-slate-700">{row.product.id}</td>
                                                <td className="px-4 py-2 text-right text-slate-600">
                                                    {row.salesVolume > 0 ? (
                                                        <span><span className="font-bold text-slate-800">{row.salesVolume}</span> <span className="text-[10px] text-slate-500">({row.salesFreq}회)</span></span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-right font-black font-mono text-indigo-600 bg-indigo-50/20">
                                                    {row.shQty}
                                                </td>
                                                <td className="px-4 py-2 text-right font-bold font-mono text-rose-500 bg-rose-50/10">
                                                    {row.pendingOrderQty > 0 ? `+${row.pendingOrderQty}` : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-right font-black text-rose-600 bg-rose-50/30">
                                                    {row.deficit > 0 ? `-${row.deficit}개` : <span className="text-slate-300 font-normal">충분</span>}
                                                </td>
                                                <td className="px-4 py-2 text-right font-bold text-teal-700">
                                                    {formatCur(row.recentPurchasePrice)}<span className="text-xs font-normal text-slate-400 ml-1">원</span>
                                                </td>
                                                <td className="px-4 py-2 text-center font-bold font-mono text-slate-500">
                                                    {row.ysQty > 0 ? <span className="text-teal-600">{row.ysQty}</span> : <span className="text-rose-400">0</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>
            </div>
            
        </div>
    );
}
