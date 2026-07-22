import { useMemo, useState, useEffect, Fragment, useDeferredValue } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import type { User, Order, SplitDelivery } from '../../types';
import { FileText, PackageX, Calendar, Search, Filter, MessageSquare, Send, X, Trash2, ChevronDown, ChevronUp, Download, Check, AlertTriangle } from 'lucide-react';
import { CalmPageShell } from '../../components/ui/CalmPageShell';
import { PageTransition } from '../../components/ui/PageTransition';
import { ManagerMultiSelect } from '../../components/ui/ManagerMultiSelect';
import { AdminOrderDetail } from './components/AdminOrderDetail';

const isStockOrder = (targetCustomerName: string, customerName: string) => {
    const displayCustomer = (targetCustomerName || customerName || '').toLowerCase();
    const normalizedCustomer = displayCustomer.replace(/\s+/g, '');
    return normalizedCustomer.includes('서울재고') ||
        normalizedCustomer.includes('시화재고') ||
        normalizedCustomer.includes('알트에프재고') ||
        normalizedCustomer.includes('알트에프') ||
        normalizedCustomer.includes('altf');
};

interface PendingItem {
    orderId: string;
    poNumber: string;
    poDate: string;
    customerName: string;
    targetCustomerName: string;
    itemId: string;
    itemName: string;
    thickness: string;
    size: string;
    material: string;
    quantity: number;
    memo: string;
    createdAt: string;
    deliveryDate: string; // Used for "납기 임박" calculation
    comments?: { author: string; timestamp: string; content: string; authorId?: string }[];
    tags?: string[]; // [NEW] Sticker tags
    isCompleted?: boolean;
    supplierName?: string;
    splitDeliveries?: SplitDelivery[]; // [NEW] 실서버 분할정보 추가
}

interface PendingOrderGroup {
    orderId: string;
    poNumber: string;
    poDate: string;
    deliveryDate: string;
    customerName: string;
    targetCustomerName: string;
    managers?: { id: string; name: string }[];
    items: PendingItem[];
    splitDeliveries?: SplitDelivery[]; // [NEW] 실서버 분할정보 추가
}

interface PendingSupplierGroup {
    supplierName: string;
    items: PendingItem[];
}

export default function PendingOrders() {
    const navigate = useNavigate();
    const { orders, setOrders, updateOrder, users, fetchUsers } = useStore(useShallow((state) => ({
        orders: state.orders,
        setOrders: state.setOrders,
        updateOrder: state.updateOrder,
        users: state.users,
        fetchUsers: state.fetchUsers
    })));
    const user = useStore((state) => state.auth.user);

    // Filters
    const [searchCustomer, setSearchCustomer] = useState('');
    const deferredSearchCustomer = useDeferredValue(searchCustomer);
    const [searchPo, setSearchPo] = useState('');
    const deferredSearchPo = useDeferredValue(searchPo);
    const [dateFilter, setDateFilter] = useState<'ALL' | 'URGENT' | 'URGENT_NO_COMMENT'>('ALL'); // URGENT = <= 7 days
    const [tagFilter, setTagFilter] = useState<string>('ALL'); // [NEW] Tag FILTER
    const [searchManager, setSearchManager] = useState<string>('all');
    const [includeCompleted, setIncludeCompleted] = useState<boolean>(false);
    const [filterSupplier, setFilterSupplier] = useState<string>('all');

    // Comment State
    const [activeCommentItemId, setActiveCommentItemId] = useState<string | null>(null);

    // Tabs & New filters
    const [activeTab, setActiveTab] = useState<'ALL' | 'STOCK'>('ALL');
    const [showOnlyDuplicates, setShowOnlyDuplicates] = useState<boolean>(false);
    const [selectedOrderDetailOrder, setSelectedOrderDetailOrder] = useState<Order | null>(null);
    const [detailInitialMode, setDetailInitialMode] = useState<'CUSTOMER' | 'SUPPLIER'>('SUPPLIER');

    // Grouping Mode
    const [groupBy, setGroupBy] = useState<'ORDER' | 'SUPPLIER'>('ORDER');
    const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());

    const toggleExpandSupplier = (supplierName: string) => {
        setExpandedSuppliers(prev => {
            const newSet = new Set(prev);
            if (newSet.has(supplierName)) newSet.delete(supplierName);
            else newSet.add(supplierName);
            return newSet;
        });
    };


    const handleOpenOrder = (orderId: string, initialMode: 'CUSTOMER' | 'SUPPLIER' = 'SUPPLIER') => {
        const o = orders.find(ord => ord.id === orderId);
        if (o) {
            setSelectedOrderDetailOrder(o);
            setDetailInitialMode(initialMode);
        }
    };

    // Delete Item (MASTER only)
    const handleDeleteItem = async (orderId: string, itemId: string) => {
        if (!confirm('정말 이 품목을 미결 발주에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
        
        const order = orders.find(o => o.id === orderId);
        if (!order || !order.po_items) return;
        
        const updatedPoItems = order.po_items.filter(item => item.id !== itemId);
        
        try {
            await updateOrder(orderId, { po_items: updatedPoItems });
            alert('성공적으로 삭제되었습니다.');
        } catch (error) {
            console.error(error);
            alert(`삭제 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // ------------------------------------------------
    const [newComment, setNewComment] = useState('');

    // Expand State
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    const toggleExpand = (orderId: string) => {
        setExpandedOrders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(orderId)) newSet.delete(orderId);
            else newSet.add(orderId);
            return newSet;
        });
    };

    // Sync Orders on Mount
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
                    throw new Error('Failed to fetch');
                })
                .then(data => {
                    if (Array.isArray(data)) setOrders(data);
                })
                .catch(console.error);
        };

        fetchOrders();
        fetchUsers();
        window.addEventListener('focus', fetchOrders);
        return () => window.removeEventListener('focus', fetchOrders);
    }, [setOrders, fetchUsers, user]);

    // Helper to extract pending items from orders list
    const getPendingItems = useMemo(() => {
        return (targetOrders: Order[]): PendingItem[] => {
            const list: PendingItem[] = [];

            targetOrders.forEach(order => {
                if (order.isDeleted || order.status === 'CANCELLED') return;

                // 하위 매입 발주서는 메인 미결 목록의 독립 행으로 뜨면 꼬이므로 제외합니다.
                if (order.isSplitPoSubOrder) return;

                // 2. 일반 발주 혹은 분할로 생성된 하위 주문서(isSplitPoSubOrder)인 경우
                const targetItems = (order.po_items && order.po_items.length > 0) ? order.po_items : order.items;
                if (!targetItems || targetItems.length === 0) return;

                const poDateRaw = order.createdAt;
                const poDateFormatted = new Date(poDateRaw).toLocaleDateString();
                const deliveryDateStr = order.adminResponse?.deliveryDate || poDateRaw;
                const targetCustomer = order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName || '';

                targetItems.forEach(poItem => {
                    const cleanName = (poItem.name || '').trim();
                    if (!cleanName || cleanName === '-' || cleanName === 'N/A') return;
                    if (poItem.quantity <= 0) return;

                    const nameLower = cleanName.toLowerCase();
                    const isDcOrFreight = nameLower === 'd/c' || nameLower === 'dc' || nameLower.includes('운임') || nameLower.includes('배송') || nameLower.includes('freight') || nameLower.includes('shipping') || nameLower.includes('discount') || nameLower.includes('할인');
                    if (isDcOrFreight) return;

                    // 분할 발주가 들어간 부모 주문의 경우, 해당 품목이 어느 매입처에 배정되었는지 splitDeliveries에서 추적
                    let matchedSupplierName = order.supplierInfo?.company_name || '미정';
                    let matchedPoNumber = order.poNumber || 'N/A';
                    let matchedIsCompleted = poItem.transactionIssued || false;

                    if (order.splitDeliveries && order.splitDeliveries.length > 0) {
                        const delivery = order.splitDeliveries.find(d => 
                            d.items.some(it => it.id === poItem.id || it.parentId === poItem.id)
                        );
                        if (delivery) {
                            // 발주서가 송부(poSent) 완료되기 전에는 미결 목록에 출현하지 않도록 필터링합니다.
                            if (!delivery.poSent) {
                                return;
                            }
                            matchedSupplierName = delivery.supplier.company_name;
                            matchedPoNumber = delivery.poNumber;
                            matchedIsCompleted = poItem.transactionIssued || false;
                        } else {
                            // 분할 지정이 되지 않은 품목도 아직 발주 전이므로 미결에서 제외합니다.
                            return;
                        }
                    }

                    const isPending = includeCompleted || !matchedIsCompleted;

                    if (isPending) {
                        list.push({
                            orderId: order.id,
                            poNumber: matchedPoNumber,
                            poDate: poDateFormatted,
                            customerName: order.customerName || '',
                            targetCustomerName: targetCustomer,
                            itemId: poItem.id,
                            itemName: poItem.name,
                            thickness: poItem.thickness || '',
                            size: poItem.size || '',
                            material: poItem.material || '',
                            quantity: poItem.quantity,
                            memo: order.memo || '',
                            createdAt: order.createdAt,
                            deliveryDate: deliveryDateStr,
                            comments: poItem.comments || [],
                            tags: poItem.tags || [],
                            isCompleted: matchedIsCompleted,
                            supplierName: matchedSupplierName,
                            splitDeliveries: order.splitDeliveries
                        });
                    }
                });
            });

            return list;
        };
    }, [includeCompleted]);

    // Available Suppliers extracted from pending items for filter selection
    const availableSuppliers = useMemo(() => {
        const suppliers = new Set<string>();
        const items = getPendingItems(orders);
        items.forEach(item => {
            if (item.supplierName) {
                suppliers.add(item.supplierName);
            }
        });
        return Array.from(suppliers).sort();
    }, [orders, getPendingItems]);

    // Flatten and Filter Items
    const pendingOrderGroups: PendingOrderGroup[] = useMemo(() => {
        const itemsList = getPendingItems(orders);

        // Apply Filters
        const filtered = itemsList.filter(item => {
            const combinedSpec = [item.itemName, item.thickness, item.size, item.material].filter(Boolean).join('-').toLowerCase();
            const searchLower = deferredSearchCustomer.toLowerCase();
            const normalizedSpec = combinedSpec.replace(/[\s-]+/g, '');
            const normalizedSearch = searchLower.replace(/[\s-]+/g, '');

            const matchCustOrSpec = item.targetCustomerName.toLowerCase().includes(searchLower) ||
                item.customerName.toLowerCase().includes(searchLower) ||
                combinedSpec.includes(searchLower) ||
                normalizedSpec.includes(normalizedSearch);
            const matchPo = item.poNumber.toLowerCase().includes(deferredSearchPo.toLowerCase());

            let matchDate = true;
            if (dateFilter === 'ALL') {
                matchDate = true;
            } else if (dateFilter === 'URGENT') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dDate = new Date(item.deliveryDate);
                const diffTime = dDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                matchDate = diffDays <= 7;
            } else if (dateFilter === 'URGENT_NO_COMMENT') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dDate = new Date(item.deliveryDate);
                const diffTime = dDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const hasComments = item.comments && item.comments.length > 0;
                matchDate = diffDays < 0 && !hasComments;
            }

            let matchTag = true;
            if (tagFilter !== 'ALL') {
                matchTag = item.tags ? item.tags.includes(tagFilter) : false;
            }

            let matchSupplier = true;
            if (filterSupplier !== 'all') {
                matchSupplier = item.supplierName === filterSupplier;
            }

            return matchCustOrSpec && matchPo && matchDate && matchTag && matchSupplier;
        });

        const groupedMap = new Map<string, PendingOrderGroup>();
        filtered.forEach(item => {
            if (!groupedMap.has(item.orderId)) {
                const originalOrder = orders.find(o => o.id === item.orderId);
                groupedMap.set(item.orderId, {
                    orderId: item.orderId,
                    poNumber: item.poNumber,
                    poDate: item.poDate,
                    deliveryDate: item.deliveryDate,
                    customerName: item.customerName,
                    targetCustomerName: item.targetCustomerName,
                    managers: originalOrder?.managers || (originalOrder?.manager ? [{id: originalOrder.manager.id, name: originalOrder.manager.name}] : []),
                    items: [],
                    splitDeliveries: originalOrder?.splitDeliveries || []
                });
            }
            groupedMap.get(item.orderId)!.items.push(item);
        });

        let groups = Array.from(groupedMap.values());
        if (searchManager !== 'all') {
            groups = groups.filter(g => g.managers?.some(m => m.id === searchManager || m.name.includes(searchManager)));
        }

        // Sort by 납기 임박순 (Delivery Date ascending)
        return groups.sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime());
    }, [orders, deferredSearchCustomer, deferredSearchPo, dateFilter, tagFilter, searchManager, filterSupplier, getPendingItems]);

    const pendingSupplierGroups = useMemo(() => {
        const itemsList = getPendingItems(orders);

        const filtered = itemsList.filter(item => {
            const combinedSpec = [item.itemName, item.thickness, item.size, item.material].filter(Boolean).join('-').toLowerCase();
            const searchLower = deferredSearchCustomer.toLowerCase();
            const normalizedSpec = combinedSpec.replace(/[\s-]+/g, '');
            const normalizedSearch = searchLower.replace(/[\s-]+/g, '');

            const matchCustOrSpec = item.targetCustomerName.toLowerCase().includes(searchLower) ||
                item.customerName.toLowerCase().includes(searchLower) ||
                combinedSpec.includes(searchLower) ||
                normalizedSpec.includes(normalizedSearch);
            const matchPo = item.poNumber.toLowerCase().includes(deferredSearchPo.toLowerCase());

            let matchDate = true;
            if (dateFilter === 'ALL') {
                matchDate = true;
            } else if (dateFilter === 'URGENT') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dDate = new Date(item.deliveryDate);
                const diffTime = dDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                matchDate = diffDays <= 7;
            } else if (dateFilter === 'URGENT_NO_COMMENT') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dDate = new Date(item.deliveryDate);
                const diffTime = dDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const hasComments = item.comments && item.comments.length > 0;
                matchDate = diffDays < 0 && !hasComments;
            }

            let matchTag = true;
            if (tagFilter !== 'ALL') {
                matchTag = item.tags ? item.tags.includes(tagFilter) : false;
            }

            let matchSupplier = true;
            if (filterSupplier !== 'all') {
                matchSupplier = item.supplierName === filterSupplier;
            }

            return matchCustOrSpec && matchPo && matchDate && matchTag && matchSupplier;
        });

        const groupedMap = new Map<string, PendingSupplierGroup>();
        filtered.forEach(item => {
            const sName = item.supplierName || '미정';
            if (!groupedMap.has(sName)) {
                groupedMap.set(sName, {
                    supplierName: sName,
                    items: []
                });
            }
            groupedMap.get(sName)!.items.push(item);
        });

        const groups = Array.from(groupedMap.values());
        
        let filteredGroups = groups;
        if (searchManager !== 'all') {
            filteredGroups = groups.map(g => {
                const matchingItems = g.items.filter(item => {
                    const originalOrder = orders.find(o => o.id === item.orderId);
                    const orderManagers = originalOrder?.managers || (originalOrder?.manager ? [originalOrder.manager] : []);
                    return orderManagers.some(m => m.id === searchManager || m.name.includes(searchManager));
                });
                return {
                    ...g,
                    items: matchingItems
                };
            }).filter(g => g.items.length > 0);
        }

        // Sort by supplier name, and then within each supplier, sort items by delivery date
        return filteredGroups.map(g => ({
            ...g,
            items: [...g.items].sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime())
        })).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
    }, [orders, deferredSearchCustomer, deferredSearchPo, dateFilter, tagFilter, searchManager, filterSupplier, getPendingItems]);

    // Unfiltered counts for tab badges
    const { allPendingCount, stockPendingCount } = useMemo(() => {
        const itemsList = getPendingItems(orders);
        let allCount = 0;
        let stockCount = 0;

        itemsList.forEach(item => {
            const isStock = isStockOrder(item.targetCustomerName, item.customerName);
            allCount++;
            if (isStock) {
                stockCount++;
            }
        });

        return { allPendingCount: allCount, stockPendingCount: stockCount };
    }, [orders, getPendingItems]);

    // Flat list of all stock order items
    const allStockItems = useMemo(() => {
        const itemsList = getPendingItems(orders);
        return itemsList.filter(item => {
            return isStockOrder(item.targetCustomerName, item.customerName);
        });
    }, [orders, getPendingItems]);

    // Group stock items by specification to check duplicates
    const stockDuplicateMap = useMemo(() => {
        const map = new Map<string, { count: number; items: PendingItem[] }>();
        allStockItems.forEach(item => {
            const specKey = `${item.itemName}::${item.thickness}::${item.size}::${item.material}`.trim();
            if (!map.has(specKey)) {
                map.set(specKey, { count: 0, items: [] });
            }
            const data = map.get(specKey)!;
            data.count += 1;
            data.items.push(item);
        });
        return map;
    }, [allStockItems]);

    // Filtered stock items based on search criteria
    const filteredStockItems = useMemo(() => {
        return allStockItems.filter(item => {
            const combinedSpec = [item.itemName, item.thickness, item.size, item.material].filter(Boolean).join('-').toLowerCase();
            const searchLower = deferredSearchCustomer.toLowerCase();
            const normalizedSpec = combinedSpec.replace(/[\s-]+/g, '');
            const normalizedSearch = searchLower.replace(/[\s-]+/g, '');

            const matchCustOrSpec = item.targetCustomerName.toLowerCase().includes(searchLower) ||
                item.customerName.toLowerCase().includes(searchLower) ||
                combinedSpec.includes(searchLower) ||
                normalizedSpec.includes(normalizedSearch);
            const matchPo = item.poNumber.toLowerCase().includes(deferredSearchPo.toLowerCase());

            let matchDate = true;
            if (dateFilter === 'URGENT') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dDate = new Date(item.deliveryDate);
                const diffTime = dDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                matchDate = diffDays <= 7;
            } else if (dateFilter === 'URGENT_NO_COMMENT') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dDate = new Date(item.deliveryDate);
                const diffTime = dDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const hasComments = item.comments && item.comments.length > 0;
                matchDate = diffDays < 0 && !hasComments;
            }

            let matchTag = true;
            if (tagFilter !== 'ALL') {
                matchTag = item.tags ? item.tags.includes(tagFilter) : false;
            }

            let matchDup = true;
            if (showOnlyDuplicates) {
                const specKey = `${item.itemName}::${item.thickness}::${item.size}::${item.material}`.trim();
                const count = stockDuplicateMap.get(specKey)?.count || 0;
                matchDup = count > 1;
            }

            let matchManager = true;
            if (searchManager !== 'all') {
                const originalOrder = orders.find(o => o.id === item.orderId);
                const managers = originalOrder?.managers || (originalOrder?.manager ? [{id: originalOrder.manager.id, name: originalOrder.manager.name}] : []);
                matchManager = managers.some(m => m.id === searchManager || m.name.includes(searchManager));
            }

            return matchCustOrSpec && matchPo && matchDate && matchTag && matchDup && matchManager;
        }).sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime());
    }, [allStockItems, deferredSearchCustomer, deferredSearchPo, dateFilter, tagFilter, showOnlyDuplicates, searchManager, stockDuplicateMap, orders]);

    // Grouped stock items by specification for ledger-like view
    const stockLedgerItems = useMemo(() => {
        const map = new Map<string, {
            specKey: string;
            itemName: string;
            thickness: string;
            size: string;
            material: string;
            tags: string[];
            totalQuantity: number;
            items: PendingItem[];
        }>();

        filteredStockItems.forEach(item => {
            const specKey = `${item.itemName}::${item.thickness}::${item.size}::${item.material}`.trim();
            if (!map.has(specKey)) {
                map.set(specKey, {
                    specKey,
                    itemName: item.itemName,
                    thickness: item.thickness,
                    size: item.size,
                    material: item.material,
                    tags: [],
                    totalQuantity: 0,
                    items: []
                });
            }
            const group = map.get(specKey)!;
            group.totalQuantity += item.quantity;
            group.items.push(item);
            
            if (item.tags) {
                item.tags.forEach(t => {
                    if (!group.tags.includes(t)) {
                        group.tags.push(t);
                    }
                });
            }
        });

        return Array.from(map.values()).sort((a, b) => {
            const nameComp = a.itemName.localeCompare(b.itemName);
            if (nameComp !== 0) return nameComp;
            
            const thickComp = a.thickness.localeCompare(b.thickness);
            if (thickComp !== 0) return thickComp;

            const parseSize = (s: string) => {
                const num = parseFloat(s);
                return isNaN(num) ? 99999 : num;
            };
            const sizeA = parseSize(a.size);
            const sizeB = parseSize(b.size);
            if (sizeA !== sizeB) return sizeA - sizeB;

            return a.material.localeCompare(b.material);
        });
    }, [filteredStockItems]);

    // Handlers
    const handleUpdateManagersForCustomer = async (targetCustomerName: string, managers: { id: string; name: string }[]) => {
        const matchingGroups = pendingOrderGroups.filter(g => g.targetCustomerName === targetCustomerName);
        for (const group of matchingGroups) {
            await updateOrder(group.orderId, { managers });
        }
    };

    const handleAddComment = (orderId: string, itemId: string) => {
        if (!newComment.trim() || !user) return;

        const targetOrder = orders.find(o => o.id === orderId);
        if (!targetOrder || !targetOrder.po_items) return;

        const updatedPoItems = targetOrder.po_items.map(pi => {
            if (pi.id === itemId) {
                const existingComments = pi.comments || [];
                return {
                    ...pi,
                    comments: [
                        ...existingComments,
                        {
                            author: user.contactName || user.email.split('@')[0],
                            authorId: user.id,
                            timestamp: new Date().toISOString(),
                            content: newComment.trim()
                        }
                    ]
                };
            }
            return pi;
        });

        updateOrder(orderId, { po_items: updatedPoItems });
        setNewComment('');
    };

    const handleToggleTag = (orderId: string, itemId: string, tag: string) => {
        const targetOrder = orders.find(o => o.id === orderId);
        if (!targetOrder || !targetOrder.po_items) return;

        const updatedPoItems = targetOrder.po_items.map(pi => {
            if (pi.id === itemId) {
                const currentTags = pi.tags || [];
                const newTags = currentTags.includes(tag)
                    ? currentTags.filter(t => t !== tag)
                    : [...currentTags, tag];
                return { ...pi, tags: newTags };
            }
            return pi;
        });

        // Optimistic UI update and sync with store/backend
        updateOrder(orderId, { po_items: updatedPoItems });
    };

    const availableTags = ['관리', '재고품', '사급', '출고대기', '생산중'];

    const handleDeleteComment = (orderId: string, itemId: string, commentIndex: number) => {
        if (!user || user.role !== 'MASTER') return;

        const targetOrder = orders.find(o => o.id === orderId);
        if (!targetOrder || !targetOrder.po_items) return;

        const updatedPoItems = targetOrder.po_items.map(pi => {
            if (pi.id === itemId) {
                const existingComments = pi.comments || [];
                return {
                    ...pi,
                    comments: existingComments.filter((_, idx) => idx !== commentIndex)
                };
            }
            return pi;
        });

        // Optimistic UI update and sync with store/backend
        updateOrder(orderId, { po_items: updatedPoItems });
    };

    const getDeliveryStatus = (dateStr: string) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dDate = new Date(dateStr);
        const diffDays = Math.ceil((dDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return { type: 'DELAYED', text: `지연 +${Math.abs(diffDays)}일`, color: 'text-red-700', bg: 'bg-red-100 border border-red-200' };
        if (diffDays <= 5) return { type: 'IMMINENT', text: '임박', color: 'text-orange-700', bg: 'bg-orange-100 border border-orange-200' };
        return { type: 'NORMAL', text: '', color: 'text-slate-500', bg: '' };
    };

    const handleExportCSV = () => {
        const itemsToExport = activeTab === 'ALL'
            ? pendingOrderGroups.flatMap(g => g.items)
            : filteredStockItems;

        if (itemsToExport.length === 0) {
            alert("다운로드할 데이터가 없습니다.");
            return;
        }

        const escapeCSV = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;

        const headers = activeTab === 'ALL'
            ? ['고객명', '발주번호', '발주일자', '납기일자', '납기상태', '상태(태그)', '품목', '두께', '사이즈', '재질', '수량', '메모(특이사항)', '코멘트']
            : ['품목', '두께', '사이즈', '재질', '발주번호', '발주일자', '납기일자', '납기상태', '수량', '중복여부', '중복건수', '상태(태그)', '코멘트'];
        const csvRows = [headers.join(',')];

        itemsToExport.forEach(item => {
            const statusInfo = getDeliveryStatus(item.deliveryDate);
            const statusText = statusInfo.type === 'DELAYED' ? statusInfo.text : (statusInfo.type === 'IMMINENT' ? '임박' : '정상');

            const commentsString = item.comments && item.comments.length > 0
                ? item.comments.map(c => `[${c.author}] ${c.content}`).join(' | ')
                : '';

            const tagsString = item.tags && item.tags.length > 0
                ? item.tags.join(', ')
                : '';

            if (activeTab === 'ALL') {
                const row = [
                    escapeCSV(item.targetCustomerName || item.customerName),
                    escapeCSV(item.poNumber),
                    escapeCSV(item.poDate),
                    escapeCSV(item.deliveryDate),
                    escapeCSV(statusText),
                    escapeCSV(tagsString),
                    escapeCSV(item.itemName),
                    escapeCSV(item.thickness),
                    escapeCSV(item.size),
                    escapeCSV(item.material),
                    item.quantity,
                    escapeCSV(item.memo),
                    escapeCSV(commentsString)
                ];
                csvRows.push(row.join(','));
            } else {
                const specKey = `${item.itemName}::${item.thickness}::${item.size}::${item.material}`.trim();
                const dupData = stockDuplicateMap.get(specKey);
                const isDup = dupData && dupData.count > 1;
                const dupText = isDup ? '중복발주' : '단독발주';
                const dupCount = dupData?.count || 1;

                const row = [
                    escapeCSV(item.itemName),
                    escapeCSV(item.thickness),
                    escapeCSV(item.size),
                    escapeCSV(item.material),
                    escapeCSV(item.poNumber),
                    escapeCSV(item.poDate),
                    escapeCSV(item.deliveryDate),
                    escapeCSV(statusText),
                    item.quantity,
                    escapeCSV(dupText),
                    dupCount,
                    escapeCSV(tagsString),
                    escapeCSV(commentsString)
                ];
                csvRows.push(row.join(','));
            }
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        const filename = activeTab === 'ALL' ? `미결관리록_${dateStr}.csv` : `재고발주_미결리스트_${dateStr}.csv`;
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <CalmPageShell clean>
            <div className="mb-6 flex flex-col gap-1">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <FileText className="w-6 h-6 text-teal-600" />
                        미결 관리 (Pending Orders)
                    </h1>
                </div>
                <p className="text-sm text-slate-500">
                    매입발주서는 발송 완료되었으나 아직 거래명세서가 발행되지 않은 품목(납기 대기) 목록입니다. 납기 임박순으로 표시됩니다.
                </p>
            </div>

            {/* Tabs & Grouping Selection */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                <div className="flex border-b border-slate-200 bg-white p-1 rounded-lg shadow-sm w-fit border">
                    <button
                        onClick={() => setActiveTab('ALL')}
                        className={`px-4 py-2 text-sm font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'ALL' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        📋 전체 미결 현황 ({allPendingCount}건)
                    </button>
                    <button
                        onClick={() => setActiveTab('STOCK')}
                        className={`px-4 py-2 text-sm font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'STOCK' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        📦 재고 발주분 미결 ({stockPendingCount}건)
                    </button>
                </div>

                {activeTab === 'ALL' && (
                    <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-lg border border-slate-200/40">
                        <span className="text-[11px] font-bold text-slate-500 px-2 select-none">분류 기준:</span>
                        <button
                            onClick={() => setGroupBy('ORDER')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${groupBy === 'ORDER' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/30' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            주문 PO 기준
                        </button>
                        <button
                            onClick={() => setGroupBy('SUPPLIER')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${groupBy === 'SUPPLIER' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/30' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            매입처(공급사) 기준
                        </button>
                    </div>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-400 mr-2" />
                    <input
                        type="text"
                        placeholder="고객명 또는 품목 규격 검색..."
                        value={searchCustomer}
                        onChange={(e) => setSearchCustomer(e.target.value)}
                        className="bg-transparent border-none outline-none text-sm w-full placeholder:text-slate-400 font-medium"
                    />
                </div>
                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all w-40 shrink-0">
                    <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                    <input
                        type="text"
                        placeholder="발주번호 (PO) 검색"
                        value={searchPo}
                        onChange={(e) => setSearchPo(e.target.value)}
                        className="bg-transparent border-none outline-none text-sm w-full placeholder:text-slate-400 font-medium truncate"
                    />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={searchManager}
                        onChange={(e) => setSearchManager(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        title="담당자 필터"
                        aria-label="담당자 필터"
                    >
                        <option value="all">모든 영업담당자</option>
                        {users.filter((u: User) => ['MASTER', 'MANAGER', 'admin'].includes(u.role)).map((u: User) => (
                            <option key={u.id} value={u.id}>{u.contactName || (u as User & {name?: string}).name || u.email}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value as 'ALL' | 'URGENT' | 'URGENT_NO_COMMENT')}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        title="Filter by delivery date"
                        aria-label="Filter by delivery date"
                    >
                        <option value="ALL">전체 기간</option>
                        <option value="URGENT">🔥 납기 임박 (7일 이내)</option>
                        <option value="URGENT_NO_COMMENT">⚠️ 지연 및 코멘트 누락</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={tagFilter}
                        onChange={(e) => setTagFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        title="Filter by tag"
                        aria-label="Filter by tag"
                    >
                        <option value="ALL">모든 아이템 (필터 없음)</option>
                        {availableTags.map(tag => (
                            <option key={tag} value={tag}>{tag}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={filterSupplier}
                        onChange={(e) => setFilterSupplier(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        title="매입처 필터"
                        aria-label="매입처 필터"
                    >
                        <option value="all">모든 매입처</option>
                        {availableSuppliers.map(sup => (
                            <option key={sup} value={sup}>{sup}</option>
                        ))}
                    </select>
                </div>
                {activeTab === 'STOCK' && (
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 cursor-pointer transition-colors select-none">
                        <input
                            type="checkbox"
                            checked={showOnlyDuplicates}
                            onChange={(e) => setShowOnlyDuplicates(e.target.checked)}
                            className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
                        />
                        <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                            중복 발주 의심 품목만 보기
                        </span>
                    </label>
                )}
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <button
                        onClick={() => setIncludeCompleted(!includeCompleted)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors shadow-sm font-bold flex items-center gap-1.5 ${includeCompleted ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                        {includeCompleted ? '완료 품목 숨기기' : '완료 품목 포함 (백업조회)'}
                    </button>
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        엑셀 다운로드
                    </button>
                </div>
            </div>

            <PageTransition>
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden text-sm">
                    <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar pb-4">
                        {activeTab === 'ALL' ? (
                            groupBy === 'ORDER' ? (
                                <table className="w-full min-w-[1000px] text-left">
                                    <thead className="text-xs text-slate-500 bg-slate-50 border-b border-slate-200 whitespace-nowrap sticky top-0 z-10">
                                        <tr>
                                            <th scope="col" className="px-5 py-3 font-bold w-[13%] min-w-[120px]">고객명 (Customer)</th>
                                        <th scope="col" className="px-5 py-3 font-bold w-[12%] min-w-[160px]">발주번호 / 납기일자</th>
                                        <th scope="col" className="px-5 py-3 font-bold w-[40%] text-right pr-12">품목 정보 (Item Spec)</th>
                                        <th scope="col" className="px-5 py-3 font-bold text-center w-[10%]">수량</th>
                                        <th scope="col" className="px-5 py-3 font-bold w-[25%] text-center">코멘트 (의견/일정 공유)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {pendingOrderGroups.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-16 text-center text-slate-400">
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="bg-slate-50 p-4 rounded-full border border-slate-100 shadow-inner">
                                                        <PackageX className="w-8 h-8 text-slate-300" />
                                                    </div>
                                                    <span className="font-medium text-slate-500">
                                                        {searchCustomer || searchPo || dateFilter === 'URGENT'
                                                            ? '검색 조건에 맞는 미결 품목이 없습니다.'
                                                            : '발주 대기 중인(미결) 품목이 없습니다.'}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        pendingOrderGroups.map((group) => {
                                            const statusObj = getDeliveryStatus(group.deliveryDate);
                                            const isExpanded = expandedOrders.has(group.orderId);
                                            const displayItems = isExpanded ? group.items : [group.items[0]];

                                            return (
                                                <Fragment key={group.orderId}>
                                                    {displayItems.map((item, index) => {
                                                        const uniqueId = `${item.orderId}-${item.itemId}`;
                                                        const isCommenting = activeCommentItemId === uniqueId;
                                                        const isFirstRow = index === 0;
                                                        const isDelayedAndNoComment = statusObj.type === 'DELAYED' && (!item.comments || item.comments.length === 0);

                                                        return (
                                                            <tr key={uniqueId} className={`hover:bg-slate-50 transition-colors group align-top ${!isFirstRow ? 'bg-slate-50/30' : ''} ${isDelayedAndNoComment ? 'bg-red-50/60 shadow-inner' : ''}`}>
                                                                {/* Customer Name */}
                                                                {isFirstRow && (
                                                                    <td className={`px-5 py-4 ${displayItems.length > 1 ? 'border-b border-slate-100' : ''}`} rowSpan={displayItems.length}>
                                                                        <div className="font-bold text-slate-800 mb-1">
                                                                            {group.targetCustomerName}
                                                                        </div>
                                                                        {group.customerName !== group.targetCustomerName && (
                                                                            <div className="text-[10px] text-slate-400 mb-2">
                                                                                원주문: {group.customerName}
                                                                            </div>
                                                                        )}
                                                                        {user?.role && ['MASTER', 'MANAGER', 'admin'].includes(user.role) && (
                                                                            <ManagerMultiSelect 
                                                                                currentManagers={group.managers || []}
                                                                                users={users.filter((u: User) => ['MASTER', 'MANAGER', 'admin'].includes(u.role))}
                                                                                onUpdate={(managers) => handleUpdateManagersForCustomer(group.targetCustomerName, managers)}
                                                                            />
                                                                        )}
                                                                    </td>
                                                                )}

                                                                {/* PO Number & Date */}
                                                                {isFirstRow && (
                                                                    <td className={`px-5 py-4 ${displayItems.length > 1 ? 'border-b border-slate-100' : ''}`} rowSpan={displayItems.length}>
                                                                        <div className="flex flex-row items-center gap-2 whitespace-nowrap min-w-max">
                                                                            <span className="font-mono font-bold text-indigo-700 text-xs bg-indigo-50 px-2 py-1 rounded border border-indigo-100 shadow-sm inline-flex">
                                                                                NO.{group.poNumber.includes('-') ? group.poNumber.split('-')[1] : group.poNumber}
                                                                            </span>
                                                                            <span className={`text-xs inline-flex items-center gap-1 font-medium ${statusObj.type !== 'NORMAL' ? 'text-slate-800' : 'text-slate-500'} bg-slate-50 rounded px-1.5 py-1 border border-slate-100`}>
                                                                                <Calendar className="w-3.5 h-3.5" />
                                                                                {new Date(group.deliveryDate).toLocaleDateString()}
                                                                                {statusObj.type !== 'NORMAL' && <span className={`ml-1 px-1.5 ${statusObj.bg} ${statusObj.color} rounded text-[10px] font-bold shadow-sm inline-flex`}>{statusObj.text}</span>}
                                                                            </span>
                                                                        </div>
                                                                        {group.splitDeliveries && group.splitDeliveries.some(d => d.poSent) && (
                                                                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                                                                <button
                                                                                    onClick={() => navigate(`/admin/pilot-split-po?orderId=${group.orderId}`)}
                                                                                    className="text-[9px] font-black bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 rounded px-2 py-0.5 whitespace-nowrap shadow-sm transition-colors"
                                                                                    title="분할발주 상세 제어로 이동"
                                                                                >
                                                                                    분할발주
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                        {group.items.length > 1 && (
                                                                            <button
                                                                                onClick={() => toggleExpand(group.orderId)}
                                                                                className="relative mt-2 text-[11px] font-bold text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 py-1.5 px-3 rounded w-fit transition-colors border border-teal-100 flex items-center gap-1 shadow-sm break-keep pr-4"
                                                                            >
                                                                                {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> 닫기</> : <><ChevronDown className="w-3.5 h-3.5" /> 외 {group.items.length - 1}건 보기</>}
                                                                                {/* Comment Indicator for hidden items */}
                                                                                {!isExpanded && group.items.slice(1).some(hiddenItem => hiddenItem.comments && hiddenItem.comments.length > 0) && (
                                                                                    <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
                                                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500 shadow-sm border-2 border-white"></span>
                                                                                    </span>
                                                                                )}
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                )}

                                                                {/* Combined Item Spec */}
                                                                <td className={`px-5 py-4 ${!isFirstRow ? 'border-t border-slate-100/50 relative' : ''}`}>
                                                                    <div className="flex flex-col gap-1 items-end pr-8">
                                                                        <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5 flex-wrap justify-end w-full">
                                                                            {!isFirstRow && <span className="text-slate-300 font-normal absolute left-3 top-4">└</span>}

                                                                            {item.isCompleted && (
                                                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm border bg-slate-200 text-slate-500 border-slate-300">
                                                                                    발행 완료
                                                                                </span>
                                                                            )}
                                                                            {/* Tags Display */}
                                                                            {item.tags && item.tags.length > 0 && item.tags.map(tag => (
                                                                                <span key={tag} className={`text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm border ${tag === '관리' ? 'bg-red-50 text-red-700 border-red-200' : tag === '재고품' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : tag === '사급' ? 'bg-amber-50 text-amber-700 border-amber-200' : tag === '생산중' ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' : tag === '출고대기' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                                                    {tag}
                                                                                </span>
                                                                            ))}

                                                                            {item.supplierName && (
                                                                                <span className="text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 text-[10px] font-bold leading-none shrink-0" title="할당 매입처">
                                                                                    {item.supplierName.replace('(주)', '').trim()}
                                                                                </span>
                                                                            )}
                                                                            <span className="text-slate-900 bg-teal-50 px-1.5 py-0.5 rounded leading-tight font-mono text-xs font-bold border border-teal-200/50">
                                                                                {[item.itemName, item.thickness, item.size, item.material].filter(Boolean).join('-')}
                                                                            </span>
                                                                        </div>

                                                                        {/* Tag Editor (Master/Manager) */}
                                                                        {user?.role && ['MASTER', 'MANAGER', 'admin'].includes(user.role) && (
                                                                            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                {availableTags.map(tag => {
                                                                                    const hasTag = item.tags?.includes(tag);
                                                                                    return (
                                                                                        <button
                                                                                            key={tag}
                                                                                            onClick={() => handleToggleTag(group.orderId, item.itemId, tag)}
                                                                                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${hasTag ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-bold' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                                                                                        >
                                                                                            {hasTag ? `- ${tag}` : `+ ${tag}`}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>

                                                                {/* Quantity */}
                                                                <td className={`px-5 py-4 text-center font-bold text-slate-900 font-mono text-lg ${!isFirstRow ? 'border-t border-slate-100/50' : ''}`}>
                                                                    <div className="flex items-center justify-center gap-2">
                                                                        {item.quantity.toLocaleString()}
                                                                        {user?.role === 'MASTER' && (
                                                                            <button
                                                                                onClick={() => handleDeleteItem(group.orderId, item.itemId)}
                                                                                className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                                                title="품목 완전 삭제 (MASTER)"
                                                                            >
                                                                                <Trash2 className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </td>

                                                                {/* Comments System */}
                                                                <td className={`px-5 py-4 ${!isFirstRow ? 'border-t border-slate-100/50' : ''}`}>
                                                                    <div className="flex flex-col gap-2">
                                                                        {item.comments && item.comments.length > 0 && (
                                                                            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                                                                {item.comments.map((comment, idx) => (
                                                                                    <div key={idx} className="bg-slate-50 rounded-lg p-2 border border-slate-100 text-xs shadow-sm">
                                                                                        <div className="flex justify-between items-center mb-1">
                                                                                            <span className="font-bold text-slate-700">{comment.author}</span>
                                                                                            <div className="flex items-center gap-2">
                                                                                                <span className="text-[9px] text-slate-400">{new Date(comment.timestamp).toLocaleDateString()} {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                                                {user?.role === 'MASTER' && (
                                                                                                    <button
                                                                                                        onClick={() => handleDeleteComment(item.orderId, item.itemId, idx)}
                                                                                                        className="text-slate-300 hover:text-red-500 transition-colors p-0.5 rounded"
                                                                                                        title="코멘트 삭제 (MASTER 권한)"
                                                                                                    >
                                                                                                        <Trash2 className="w-3 h-3" />
                                                                                                    </button>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                        <p className="text-slate-600 leading-snug wrap-break-word whitespace-pre-wrap">{comment.content}</p>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}

                                                                        {!isCommenting ? (
                                                                            <button
                                                                                onClick={() => setActiveCommentItemId(uniqueId)}
                                                                                className="flex items-center justify-center gap-1.5 w-full py-1.5 mt-1 border border-dashed border-slate-300 rounded text-xs font-medium text-slate-500 hover:text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                                                                            >
                                                                                <MessageSquare className="w-3.5 h-3.5" />
                                                                                {item.comments && item.comments.length > 0 ? '코멘트 추가' : '첫 코멘트 남기기'}
                                                                            </button>
                                                                        ) : (
                                                                            <div className="flex flex-col gap-2 mt-1 bg-white p-2 rounded border border-teal-200 shadow-md">
                                                                                <textarea
                                                                                    autoFocus
                                                                                    value={newComment}
                                                                                    onChange={(e) => setNewComment(e.target.value)}
                                                                                    placeholder="담당자 의견, 배차 정보 등..."
                                                                                    className="w-full text-xs p-2 border border-slate-200 rounded outline-none focus:border-teal-400 resize-none h-[60px]"
                                                                                />
                                                                                <div className="flex justify-end gap-1">
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            setActiveCommentItemId(null);
                                                                                            setNewComment('');
                                                                                        }}
                                                                                        className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                                                                                        title="Cancel"
                                                                                        aria-label="Cancel commenting"
                                                                                    >
                                                                                        <X className="w-4 h-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => handleAddComment(item.orderId, item.itemId)}
                                                                                        disabled={!newComment.trim()}
                                                                                        className="flex items-center gap-1 px-3 py-1 bg-teal-600 disabled:bg-slate-300 text-white rounded text-xs font-bold hover:bg-teal-700 transition-colors"
                                                                                    >
                                                                                        <Send className="w-3 h-3" />
                                                                                        등록
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </Fragment>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                            ) : (
                                <table className="w-full min-w-[1000px] text-left">
                                    <thead className="text-xs text-slate-500 bg-slate-50 border-b border-slate-200 whitespace-nowrap sticky top-0 z-10">
                                        <tr>
                                            <th scope="col" className="px-5 py-3 font-bold w-[18%] min-w-[120px]">매입처 (Supplier)</th>
                                            <th scope="col" className="px-5 py-3 font-bold w-[18%] min-w-[180px]">고객사 / 발주번호</th>
                                            <th scope="col" className="px-5 py-3 font-bold w-[35%] text-right pr-12">품목 정보 (Item Spec)</th>
                                            <th scope="col" className="px-5 py-3 font-bold text-center w-[12%]">수량 / 납기</th>
                                            <th scope="col" className="px-5 py-3 font-bold w-[17%] text-center">코멘트 (의견/일정 공유)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {pendingSupplierGroups.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-16 text-center text-slate-400">
                                                    <div className="flex flex-col items-center gap-3">
                                                        <div className="bg-slate-50 p-4 rounded-full border border-slate-100 shadow-inner">
                                                            <PackageX className="w-8 h-8 text-slate-300" />
                                                        </div>
                                                        <span className="font-medium text-slate-500">
                                                            검색 조건에 맞는 매입처별 미결 품목이 없습니다.
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            pendingSupplierGroups.map((group) => {
                                                const isExpanded = expandedSuppliers.has(group.supplierName);
                                                const displayItems = isExpanded ? group.items : [group.items[0]];

                                                return (
                                                    <Fragment key={group.supplierName}>
                                                        {displayItems.map((item, index) => {
                                                            const uniqueId = `sup-${group.supplierName}-${item.orderId}-${item.itemId}`;
                                                            const isCommenting = activeCommentItemId === uniqueId;
                                                            const isFirstRow = index === 0;
                                                            const statusObj = getDeliveryStatus(item.deliveryDate);
                                                            const isDelayedAndNoComment = statusObj.type === 'DELAYED' && (!item.comments || item.comments.length === 0);

                                                            return (
                                                                <tr key={uniqueId} className={`hover:bg-slate-50 transition-colors group align-top ${!isFirstRow ? 'bg-slate-50/30' : ''} ${isDelayedAndNoComment ? 'bg-red-50/60 shadow-inner' : ''}`}>
                                                                    {/* Supplier Name */}
                                                                    {isFirstRow && (
                                                                        <td className={`px-5 py-4 ${displayItems.length > 1 ? 'border-b border-slate-100' : ''}`} rowSpan={displayItems.length}>
                                                                            <div className="font-extrabold text-indigo-700 text-sm bg-indigo-50/50 px-2 py-1.5 rounded-lg border border-indigo-200 inline-flex items-center gap-1.5 shadow-sm whitespace-nowrap">
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                                                                                {group.supplierName}
                                                                            </div>
                                                                            {group.items.length > 1 && (
                                                                                <button
                                                                                    onClick={() => toggleExpandSupplier(group.supplierName)}
                                                                                    className="relative mt-3 text-[11px] font-bold text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 py-1.5 px-3 rounded w-fit transition-colors border border-teal-100 flex items-center gap-1 shadow-sm break-keep pr-4"
                                                                                >
                                                                                    {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" /> 닫기</> : <><ChevronDown className="w-3.5 h-3.5" /> 외 {group.items.length - 1}건 보기</>}
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                    )}

                                                                    {/* Customer & PO */}
                                                                    <td className="px-5 py-4">
                                                                        <div className="font-bold text-slate-800 text-xs">
                                                                            {item.targetCustomerName}
                                                                        </div>
                                                                        {item.customerName !== item.targetCustomerName && (
                                                                            <div className="text-[9px] text-slate-400 mt-0.5">
                                                                                원주문: {item.customerName}
                                                                            </div>
                                                                        )}
                                                                        <div className="mt-2 flex flex-col gap-1.5">
                                                                            <div className="flex items-center gap-1.5">
                                                                                <span className="font-mono font-bold text-indigo-700 text-[10px] bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 shadow-sm inline-flex">
                                                                                    NO.{item.poNumber.includes('-') ? item.poNumber.split('-')[1] : item.poNumber}
                                                                                </span>
                                                                                <button
                                                                                    onClick={() => navigate(`/admin/pilot-split-po?orderId=${item.orderId}`)}
                                                                                    className="text-[9px] font-bold border border-amber-200 rounded px-1.5 py-0.5 bg-amber-50 text-amber-600 hover:bg-amber-100 hover:border-amber-300 transition-colors whitespace-nowrap"
                                                                                >
                                                                                    분할
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </td>

                                                                    {/* Item Spec */}
                                                                    <td className="px-5 py-4 relative">
                                                                        <div className="flex flex-col gap-1 items-end pr-8">
                                                                            <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5 flex-wrap justify-end w-full">
                                                                                {item.isCompleted && (
                                                                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm border bg-slate-200 text-slate-500 border-slate-300">
                                                                                        발행 완료
                                                                                    </span>
                                                                                )}
                                                                                {item.tags && item.tags.length > 0 && item.tags.map(tag => (
                                                                                    <span key={tag} className={`text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm border ${tag === '관리' ? 'bg-red-50 text-red-700 border-red-200' : tag === '재고품' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : tag === '사급' ? 'bg-amber-50 text-amber-700 border-amber-200' : tag === '생산중' ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' : tag === '출고대기' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                                                        {tag}
                                                                                    </span>
                                                                                ))}
                                                                                <span className="text-slate-900 bg-teal-50 px-1.5 py-0.5 rounded leading-tight font-mono text-xs font-bold border border-teal-200/50">
                                                                                    {[item.itemName, item.thickness, item.size, item.material].filter(Boolean).join('-')}
                                                                                </span>
                                                                            </div>
                                                                            {user?.role && ['MASTER', 'MANAGER', 'admin'].includes(user.role) && (
                                                                                <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                    {availableTags.map(tag => {
                                                                                        const hasTag = item.tags?.includes(tag);
                                                                                        return (
                                                                                            <button
                                                                                                key={tag}
                                                                                                onClick={() => handleToggleTag(item.orderId, item.itemId, tag)}
                                                                                                className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${hasTag ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-bold' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                                                                                            >
                                                                                                {hasTag ? `- ${tag}` : `+ ${tag}`}
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>

                                                                    {/* Quantity / Delivery Date */}
                                                                    <td className="px-5 py-4 text-center">
                                                                        <div className="font-mono font-bold text-slate-800 text-sm">{item.quantity}개</div>
                                                                        <div className="mt-1.5">
                                                                            <span className={`text-[10px] inline-flex items-center gap-0.5 font-medium ${statusObj.type !== 'NORMAL' ? 'text-slate-800' : 'text-slate-500'} bg-slate-50 rounded px-1.5 py-0.5 border border-slate-100 whitespace-nowrap`}>
                                                                                {new Date(item.deliveryDate).toLocaleDateString()}
                                                                                {statusObj.type !== 'NORMAL' && <span className={`ml-1 px-1 ${statusObj.bg} ${statusObj.color} rounded text-[8px] font-bold inline-flex`}>{statusObj.text}</span>}
                                                                            </span>
                                                                        </div>
                                                                        {user?.role === 'MASTER' && (
                                                                            <button
                                                                                onClick={() => handleDeleteItem(item.orderId, item.itemId)}
                                                                                className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100 mt-2 inline-flex"
                                                                                title="품목 완전 삭제 (MASTER)"
                                                                            >
                                                                                <Trash2 className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        )}
                                                                    </td>

                                                                    {/* Comments */}
                                                                    <td className="px-5 py-4">
                                                                        <div className="flex flex-col gap-2">
                                                                            {item.comments && item.comments.length > 0 && (
                                                                                <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                                                                    {item.comments.map((comment, idx) => (
                                                                                        <div key={idx} className="bg-slate-50 rounded-lg p-2 border border-slate-100 text-xs shadow-sm">
                                                                                            <div className="flex justify-between items-center mb-1">
                                                                                                <span className="font-bold text-slate-700">{comment.author}</span>
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <span className="text-[9px] text-slate-400">{new Date(comment.timestamp).toLocaleDateString()} {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                                                    {user?.role === 'MASTER' && (
                                                                                                        <button
                                                                                                            onClick={() => handleDeleteComment(item.orderId, item.itemId, idx)}
                                                                                                            className="text-slate-300 hover:text-red-500 transition-colors p-0.5 rounded"
                                                                                                            title="코멘트 삭제 (MASTER 권한)"
                                                                                                        >
                                                                                                            <Trash2 className="w-3 h-3" />
                                                                                                        </button>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                            <p className="text-slate-600 leading-snug wrap-break-word whitespace-pre-wrap">{comment.content}</p>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}

                                                                            {!isCommenting ? (
                                                                                <button
                                                                                    onClick={() => setActiveCommentItemId(uniqueId)}
                                                                                    className="flex items-center justify-center gap-1.5 w-full py-1.5 mt-1 border border-dashed border-slate-300 rounded text-xs font-medium text-slate-500 hover:text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                                                                                >
                                                                                    <MessageSquare className="w-3.5 h-3.5" />
                                                                                    {item.comments && item.comments.length > 0 ? '코멘트 추가' : '첫 코멘트 남기기'}
                                                                                </button>
                                                                            ) : (
                                                                                <div className="flex flex-col gap-2 mt-1 bg-white p-2 rounded border border-teal-200 shadow-md">
                                                                                    <textarea
                                                                                        autoFocus
                                                                                        value={newComment}
                                                                                        onChange={(e) => setNewComment(e.target.value)}
                                                                                        placeholder="담당자 의견, 배차 정보 등..."
                                                                                        className="w-full text-xs p-2 border border-slate-200 rounded outline-none focus:border-teal-400 resize-none h-[60px]"
                                                                                    />
                                                                                    <div className="flex justify-end gap-1">
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                setActiveCommentItemId(null);
                                                                                                setNewComment('');
                                                                                            }}
                                                                                            className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                                                                                            title="Cancel"
                                                                                            aria-label="Cancel commenting"
                                                                                        >
                                                                                            <X className="w-4 h-4" />
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleAddComment(item.orderId, item.itemId)}
                                                                                            disabled={!newComment.trim()}
                                                                                            className="flex items-center gap-1 px-3 py-1 bg-teal-600 disabled:bg-slate-300 text-white rounded text-xs font-bold hover:bg-teal-700 transition-colors"
                                                                                        >
                                                                                            <Send className="w-3 h-3" />
                                                                                            등록
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </Fragment>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            )
                        ) : (
                            <table className="w-full min-w-[1000px] text-left">
                                <thead className="text-xs text-slate-500 bg-slate-50 border-b border-slate-200 whitespace-nowrap sticky top-0 z-10">
                                    <tr>
                                        <th scope="col" className="px-5 py-3 font-bold w-[22%] min-w-[180px]">아이템명 / 규격 (Item Spec)</th>
                                        <th scope="col" className="px-5 py-3 font-bold w-[12%] min-w-[100px] text-center">총 미결수량</th>
                                        <th scope="col" className="px-5 py-3 font-bold w-[54%] min-w-[450px]">개별 발주 내역 (PO Breakdown)</th>
                                        <th scope="col" className="px-5 py-3 font-bold w-[12%] min-w-[110px] text-center">중복 발주 상태</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {stockLedgerItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-16 text-center text-slate-400">
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="bg-slate-50 p-4 rounded-full border border-slate-100 shadow-inner">
                                                        <PackageX className="w-8 h-8 text-slate-300" />
                                                    </div>
                                                    <span className="font-medium text-slate-500">
                                                        재고 발주분 중 검색 조건에 맞는 미결 품목이 없습니다.
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        stockLedgerItems.map((group) => {
                                            return (
                                                <tr key={group.specKey} className="hover:bg-slate-50/50 transition-colors align-top">
                                                    {/* Item Spec */}
                                                    <td className="px-5 py-4">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 flex-wrap">
                                                                <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-black border border-indigo-100 font-mono">
                                                                    {[group.itemName, group.thickness, group.size, group.material].filter(Boolean).join('-')}
                                                                </span>
                                                                {group.tags && group.tags.length > 0 && group.tags.map(tag => (
                                                                    <span key={tag} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${tag === '관리' ? 'bg-red-50 text-red-700 border-red-200' : tag === '재고품' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : tag === '사급' ? 'bg-amber-50 text-amber-700 border-amber-200' : tag === '생산중' ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' : tag === '출고대기' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                                        {tag}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* Total Quantity */}
                                                    <td className="px-5 py-4 text-center">
                                                        <div className="text-lg font-black text-slate-800 font-mono mt-1">
                                                            {group.totalQuantity.toLocaleString()}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                            총 {group.items.length}건 대기
                                                        </div>
                                                    </td>

                                                    {/* PO Breakdown */}
                                                    <td className="px-5 py-4">
                                                        <div className="space-y-3">
                                                            {group.items.map((subItem) => {
                                                                const statusObj = getDeliveryStatus(subItem.deliveryDate);
                                                                const uniqueId = `${subItem.orderId}-${subItem.itemId}`;
                                                                const isCommenting = activeCommentItemId === uniqueId;
                                                                const isDelayedAndNoComment = statusObj.type === 'DELAYED' && (!subItem.comments || subItem.comments.length === 0);

                                                                return (
                                                                    <div key={uniqueId} className={`bg-slate-50 border border-slate-200/70 hover:border-slate-300 hover:shadow-sm transition-all rounded-lg p-3 relative group/po ${isDelayedAndNoComment ? 'bg-red-50/20 border-red-200/40' : ''}`}>
                                                                        <div className="flex items-center gap-3 flex-wrap">
                                                                            {/* PO Number Button */}
                                                                            <button
                                                                                onClick={() => handleOpenOrder(subItem.orderId, 'SUPPLIER')}
                                                                                className="font-mono font-bold text-indigo-700 text-xs bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800 px-2 py-1 rounded border border-indigo-100 shadow-sm inline-flex items-center gap-1 transition-colors"
                                                                                title="발주서 상세 모달 열기"
                                                                            >
                                                                                NO.{subItem.poNumber.includes('-') ? subItem.poNumber.split('-')[1] : subItem.poNumber}
                                                                            </button>
                                                                            {subItem.splitDeliveries && subItem.splitDeliveries.some(d => d.poSent) && (
                                                                                <button
                                                                                    onClick={() => navigate(`/admin/pilot-split-po?orderId=${subItem.orderId}`)}
                                                                                    className="text-[9px] font-black bg-amber-100 text-amber-750 border border-amber-350 hover:bg-amber-200 rounded px-2 py-0.5 whitespace-nowrap shadow-sm transition-colors"
                                                                                    title="분할발주 상세 제어로 이동"
                                                                                >
                                                                                    분할발주
                                                                                </button>
                                                                            )}
                                                                            {subItem.supplierName && (
                                                                                <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded font-bold leading-none shrink-0" title="할당 매입처">
                                                                                    {subItem.supplierName.replace('(주)', '').trim()}
                                                                                </span>
                                                                            )}

                                                                            {/* PO Date & Delivery Date */}
                                                                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                                                                <span>발주: {subItem.poDate}</span>
                                                                                <span className="text-slate-300">|</span>
                                                                                <span className={`inline-flex items-center gap-1 font-semibold ${statusObj.type !== 'NORMAL' ? 'text-slate-800' : 'text-slate-500'}`}>
                                                                                    납기: {new Date(subItem.deliveryDate).toLocaleDateString()}
                                                                                    {statusObj.type !== 'NORMAL' && (
                                                                                        <span className={`ml-1 px-1.5 py-0.5 ${statusObj.bg} ${statusObj.color} rounded text-[9px] font-bold shadow-sm inline-flex`}>
                                                                                            {statusObj.text}
                                                                                        </span>
                                                                                    )}
                                                                                </span>
                                                                            </div>

                                                                            {/* Quantity */}
                                                                            <div className="flex items-center gap-1.5 font-mono font-bold text-slate-800 text-sm ml-auto">
                                                                                <span>{subItem.quantity.toLocaleString()}개</span>
                                                                                {user?.role === 'MASTER' && (
                                                                                    <button
                                                                                        onClick={() => handleDeleteItem(subItem.orderId, subItem.itemId)}
                                                                                        className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1 rounded transition-colors opacity-0 group-hover/po:opacity-100"
                                                                                        title="품목 완전 삭제 (MASTER)"
                                                                                    >
                                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        <div className="text-[10px] text-slate-400 mt-1 pl-1">
                                                                            원주문: {subItem.targetCustomerName}
                                                                        </div>

                                                                        {/* Tag Editor (Master/Manager) */}
                                                                        {user?.role && ['MASTER', 'MANAGER', 'admin'].includes(user.role) && (
                                                                            <div className="flex items-center gap-1 mt-2 pl-0.5 opacity-0 group-hover/po:opacity-100 transition-opacity">
                                                                                {availableTags.map(tag => {
                                                                                    const hasTag = subItem.tags?.includes(tag);
                                                                                    return (
                                                                                        <button
                                                                                            key={tag}
                                                                                            onClick={() => handleToggleTag(subItem.orderId, subItem.itemId, tag)}
                                                                                            className={`text-[8px] px-1 py-0.5 rounded border transition-colors ${hasTag ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-bold' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                                                                                        >
                                                                                            {hasTag ? `- ${tag}` : `+ ${tag}`}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}

                                                                        {/* Comments Section inside the PO Box */}
                                                                        <div className="mt-2.5 pt-2.5 border-t border-slate-200/50">
                                                                            {subItem.comments && subItem.comments.length > 0 && (
                                                                                <div className="space-y-1.5 max-h-[100px] overflow-y-auto pr-1 mb-2 custom-scrollbar">
                                                                                    {subItem.comments.map((comment, idx) => (
                                                                                        <div key={idx} className="bg-white rounded-lg p-2 border border-slate-100 text-[11px] shadow-sm">
                                                                                            <div className="flex justify-between items-center mb-1">
                                                                                                <span className="font-bold text-slate-700">{comment.author}</span>
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <span className="text-[8px] text-slate-400">{new Date(comment.timestamp).toLocaleDateString()} {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                                                                    {user?.role === 'MASTER' && (
                                                                                                        <button
                                                                                                            onClick={() => handleDeleteComment(subItem.orderId, subItem.itemId, idx)}
                                                                                                            className="text-slate-300 hover:text-red-500 transition-colors p-0.5 rounded"
                                                                                                            title="코멘트 삭제"
                                                                                                        >
                                                                                                            <Trash2 className="w-2.5 h-2.5" />
                                                                                                        </button>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                            <p className="text-slate-600 leading-snug wrap-break-word whitespace-pre-wrap">{comment.content}</p>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}

                                                                            {!isCommenting ? (
                                                                                <button
                                                                                    onClick={() => {
                                                                                        setActiveCommentItemId(uniqueId);
                                                                                        setNewComment('');
                                                                                    }}
                                                                                    className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-teal-600 transition-colors"
                                                                                >
                                                                                    <MessageSquare className="w-3 h-3" />
                                                                                    {subItem.comments && subItem.comments.length > 0 ? '코멘트 추가' : '첫 코멘트 남기기'}
                                                                                </button>
                                                                            ) : (
                                                                                <div className="flex flex-col gap-1.5 bg-white p-2 rounded border border-teal-200 shadow-sm mt-1">
                                                                                    <textarea
                                                                                        autoFocus
                                                                                        value={newComment}
                                                                                        onChange={(e) => setNewComment(e.target.value)}
                                                                                        placeholder="담당자 의견, 배차 정보 등..."
                                                                                        className="w-full text-[11px] p-2 border border-slate-200 rounded outline-none focus:border-teal-400 resize-none h-[45px]"
                                                                                    />
                                                                                    <div className="flex justify-end gap-1">
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                setActiveCommentItemId(null);
                                                                                                setNewComment('');
                                                                                            }}
                                                                                            className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"
                                                                                            title="취소"
                                                                                        >
                                                                                            <X className="w-3.5 h-3.5" />
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleAddComment(subItem.orderId, subItem.itemId)}
                                                                                            disabled={!newComment.trim()}
                                                                                            className="px-2.5 py-0.5 bg-teal-600 disabled:bg-slate-300 text-white rounded text-[10px] font-bold hover:bg-teal-700 transition-colors flex items-center gap-1"
                                                                                        >
                                                                                            <Send className="w-2.5 h-2.5" />
                                                                                            등록
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </td>

                                                    {/* Duplicate Status */}
                                                    <td className="px-5 py-4 text-center">
                                                        {group.items.length > 1 ? (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full shadow-sm mt-1">
                                                                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                                                                중복 발주 ({group.items.length}건)
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full shadow-sm mt-1">
                                                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                                                단독 발주
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </PageTransition>

            {selectedOrderDetailOrder && (
                <AdminOrderDetail
                    order={selectedOrderDetailOrder}
                    onClose={() => setSelectedOrderDetailOrder(null)}
                    onUpdate={updateOrder}
                    initialMode={detailInitialMode}
                />
            )}
        </CalmPageShell>
    );
}
