import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { CalmPageShell } from '../components/ui/CalmPageShell';
import { PageTransition } from '../components/ui/PageTransition';
import {
    LayoutDashboard, ChevronDown, Building2, Trash2, ArchiveRestore, Download, Search
} from 'lucide-react';
import { AdminOrderDetail } from './admin/components/AdminOrderDetail';
import { AnalyticsPanel } from './admin/components/AnalyticsPanel';
import type { Order, User } from '../types';
import { useInventoryIndex } from '../hooks/useInventoryIndex';


export default function AdminPage() {
    const { orders, updateOrder, trashOrder, restoreOrder, permanentDeleteOrder, setOrders, inventory, users, fetchUsers } = useStore((state) => state);
    const user = useStore((state) => state.auth.user);
    const { findProduct } = useInventoryIndex(inventory);

    // ... (rest of component)
    // We need to inject findProduct usage into the cost calculation loop deeper in the file
    // But replace_file_content is not good for "injecting variable at top" and "using it at bottom" in one go if they are far apart.
    // So I will just add the initialization here.


    // Sync Orders on Mount
    useState(() => {
        // Using useEffect inside component body effectively
        // doing this in render body is bad, but I'll use useEffect below 
    });

    useEffect(() => {
        if (!user) return;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (user.id) headers['x-requester-id'] = user.id;
        if (user.role) headers['x-requester-role'] = user.role;

        // [MOD] Ensure we use VITE_API_URL and the correct endpoint (/api/my/orders handles admin scope)
        const endpoint = `${import.meta.env.VITE_API_URL || ''}/api/my/orders?limit=2000`;

        const fetchOrders = () => {
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

    // Auto-complete orders that meet all criteria but are still in processing
    useEffect(() => {
        if (!orders || orders.length === 0) return;

        const ordersToComplete = orders.filter(order => {
            if (order.status === 'COMPLETED' || order.status === 'CANCELLED' || order.status === 'WITHDRAWN') {
                return false;
            }
            if (!order.poSent && !order.supplierPO) return false;

            const targetItems = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;
            if (!targetItems || targetItems.length === 0) return false;

            return targetItems.every(item => item.transactionIssued);
        });

        if (ordersToComplete.length > 0) {
            ordersToComplete.forEach(order => {
                updateOrder(order.id, { status: 'COMPLETED' });
            });
        }
    }, [orders, updateOrder]);

    // UI State
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterManager, setFilterManager] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [detailInitialMode, setDetailInitialMode] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER'); // [MOD] Added Initial Mode State

    // Derived Data
    const orderCounts = orders.reduce((acc, order) => {
        if (order.isDeleted) {
            acc.TRASH = (acc.TRASH || 0) + 1;
            return acc;
        }
        acc.all = (acc.all || 0) + 1;
        if (order.status) {
            acc[order.status] = (acc[order.status] || 0) + 1;
        }
        return acc;
    }, {} as Record<string, number>);

    const filteredOrders = orders.filter(order => {
        // Status Match
        let statusMatch = true;
        if (filterStatus === 'TRASH') {
            if (!order.isDeleted) statusMatch = false;
        } else {
            if (order.isDeleted) statusMatch = false;
            if (filterStatus !== 'all' && order.status !== filterStatus) statusMatch = false;
        }

        if (!statusMatch) return false;

        // Search Match
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            const customerName = order.customerName?.toLowerCase() || '';
            const poEndCustomer = order.poEndCustomer?.toLowerCase() || '';
            const poCompany = order.payload?.customer?.company_name?.toLowerCase() || '';
            const poContact = order.payload?.customer?.contact_name?.toLowerCase() || '';
            const poNumber = order.poNumber?.toLowerCase() || '';

            if (!customerName.includes(query) &&
                !poEndCustomer.includes(query) &&
                !poCompany.includes(query) &&
                !poContact.includes(query) &&
                !poNumber.includes(query)) {
                return false;
            }
        }

        if (filterManager !== 'all') {
            const hasManager = order.managers && order.managers.some(m => m.id === filterManager);
            // fallback for legacy manager if needed
            const matchesLegacy = (!order.managers || order.managers.length === 0) && order.manager?.id === filterManager;
            if (!hasManager && !matchesLegacy) return false;
        }

        return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Handlers
    const handleStatusUpdate = (orderId: string, newStatus: Order['status']) => {
        const user = useStore.getState().auth.user;
        updateOrder(orderId, {
            status: newStatus,
            lastUpdatedBy: {
                name: user?.contactName || 'Admin',
                id: user?.id || 'admin',
                email: user?.email || '',
                at: new Date().toISOString()
            }
        });
    };

    const handleDelete = async (orderId: string) => {
        if (confirm('이 주문을 휴지통으로 이동하시겠습니까?')) {
            await trashOrder(orderId);
        }
    };

    const handleRestore = async (orderId: string) => {
        if (confirm('이 주문을 복구하시겠습니까?')) {
            await restoreOrder(orderId);
        }
    };

    const handlePermanentDelete = async (orderId: string) => {
        if (confirm('정말로 영구 삭제하시겠습니까? 복구할 수 없습니다.')) {
            await permanentDeleteOrder(orderId);
        }
    };

    const handleExportCSV = () => {
        if (filteredOrders.length === 0) {
            alert("다운로드할 데이터가 없습니다.");
            return;
        }

        const headers = ['발주번호', '주문일시', '고객사', '품목명', '규격', '수량', '판매단가', '판매금액', '매입단가', '매입금액', '이익금', '상태', '담당자'];
        const csvRows = [headers.join(',')];

        filteredOrders.forEach(order => {
            const dateStr = new Date(order.createdAt).toLocaleString('ko-KR');
            const managerName = order.lastUpdatedBy?.name || '미배정';
            const statusStr = order.status;

            const targetItems = (order.po_items && order.po_items.length > 0) ? order.po_items : order.items;

            const displayCustomer = order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName;

            if (targetItems.length === 0) {
                const row = [
                    `"${order.id}"`,
                    `"${dateStr}"`,
                    `"${displayCustomer}"`,
                    `""`,
                    `""`,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    `"${statusStr}"`,
                    `"${managerName}"`
                ];
                csvRows.push(row.join(','));
                return;
            }

            targetItems.forEach(item => {
                const product = findProduct(item);
                const basePrice = item.base_price ?? product?.base_price ?? product?.unitPrice ?? 0;

                // Buying Cost
                let unitCost = 0;
                if (item.supplierPriceOverride !== undefined) {
                    unitCost = item.supplierPriceOverride;
                } else if (item.supplierRate !== undefined) {
                    unitCost = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                } else {
                    const rate = product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
                    unitCost = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                }
                const totalCost = unitCost * item.quantity;

                // Sales
                const unitSalesPrice = item.unitPrice;
                const totalSalesPrice = item.amount;

                const profit = totalSalesPrice - totalCost;

                const spec = `${item.thickness || ''} ${item.size || ''} ${item.material || ''}`.trim() || `${(item as { options?: string[] }).options?.join(' ') || ''}`;

                const row = [
                    `"${order.id}"`,
                    `"${dateStr}"`,
                    `"${displayCustomer}"`,
                    `"${item.name || ''}"`,
                    `"${spec}"`,
                    item.quantity,
                    unitSalesPrice,
                    totalSalesPrice,
                    unitCost,
                    totalCost,
                    profit,
                    `"${statusStr}"`,
                    `"${managerName}"`
                ];

                csvRows.push(row.join(','));
            });
        });

        const csvString = csvRows.join('\n');
        // Add BOM for Excel UTF-8 display
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `주문품목내역_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <CalmPageShell>
            <div className="mb-6 flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-slate-900">관리자 대시보드</h1>
                <p className="text-sm text-slate-500">전체 주문 내역 및 상태 관리</p>
            </div>

            {user?.role === 'MASTER' && (
                <AnalyticsPanel orders={filteredOrders} inventory={inventory} />
            )}

            <PageTransition>
                <div className="space-y-6">
                    {/* Status Filters & Utilities */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm w-fit overflow-x-auto">
                            <FilterButton active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} label="전체" count={orderCounts.all} />
                            <FilterButton active={filterStatus === 'SUBMITTED'} onClick={() => setFilterStatus('SUBMITTED')} label="주문접수" count={orderCounts.SUBMITTED} variant="highlight" />
                            <FilterButton active={filterStatus === 'PROCESSING'} onClick={() => setFilterStatus('PROCESSING')} label="처리중" count={orderCounts.PROCESSING} />
                            <FilterButton active={filterStatus === 'ON_HOLD'} onClick={() => setFilterStatus('ON_HOLD')} label="보류" count={orderCounts.ON_HOLD} />
                            <FilterButton active={filterStatus === 'WITHDRAWN'} onClick={() => setFilterStatus('WITHDRAWN')} label="회수" count={orderCounts.WITHDRAWN} />
                            <FilterButton active={filterStatus === 'SHIPPED'} onClick={() => setFilterStatus('SHIPPED')} label="배송중" count={orderCounts.SHIPPED} />
                            <FilterButton active={filterStatus === 'COMPLETED'} onClick={() => setFilterStatus('COMPLETED')} label="완료" count={orderCounts.COMPLETED} />
                            <FilterButton active={filterStatus === 'CANCELLED'} onClick={() => setFilterStatus('CANCELLED')} label="취소" count={orderCounts.CANCELLED} />
                            <div className="w-[1px] h-4 bg-slate-200 mx-1" />
                            <button
                                onClick={() => setFilterStatus('TRASH')}
                                className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filterStatus === 'TRASH' ? 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-red-500'}`}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                휴지통 {orderCounts.TRASH ? `(${orderCounts.TRASH})` : ''}
                            </button>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            {/* Search */}
                            <div className="relative flex-1 sm:w-64">
                                <input
                                    type="text"
                                    placeholder="고객명, 회사명, 발주번호 검색..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all font-medium placeholder-slate-400"
                                />
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            </div>

                            {(user?.role?.toUpperCase() === 'MASTER' || user?.role?.toLowerCase() === 'admin' || user?.role?.toUpperCase() === 'MANAGER') && (
                                <>
                                    <select
                                        value={filterManager}
                                        onChange={(e) => setFilterManager(e.target.value)}
                                        className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 min-w-[120px]"
                                        title="담당자 필터"
                                        aria-label="담당자 필터"
                                    >
                                        <option value="all">모든 담당자</option>
                                        {users.filter((u: User) => ['MASTER', 'MANAGER', 'admin'].includes(u.role)).map((u: User) => (
                                            <option key={u.id} value={u.id}>{u.contactName || (u as User & {name?: string}).name || u.email}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleExportCSV}
                                        className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors whitespace-nowrap"
                                    >
                                        <Download className="w-4 h-4" />
                                        엑셀 다운로드
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Orders Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar pb-4 pr-2">
                            <table className="w-full min-w-[1000px] text-sm text-left">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 font-bold w-[5%] text-center min-w-[60px]">No.</th>
                                        <th scope="col" className="px-6 py-3 font-bold w-[20%] min-w-[150px]">주문 품목 (Items)</th>
                                        <th scope="col" className="px-6 py-3 font-bold w-[20%] min-w-[180px]">고객 / 주문일시 (Customer)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-right w-[15%] min-w-[120px] whitespace-nowrap">주문금액 (Sales)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-right w-[15%] min-w-[120px] whitespace-nowrap">매입금액 (Buying)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-center w-[12%] min-w-[120px]">상태 (Status)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-center w-[13%] min-w-[150px]">관리 (Manage)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredOrders.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                                                <div className="flex flex-col items-center gap-2">
                                                    <LayoutDashboard className="w-8 h-8 opacity-20" />
                                                    <span className="font-medium">주문 내역이 없습니다.</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredOrders.map((order, index) => {
                                            // Calculate Total Buying Cost
                                            // Use PO Items if available (meaning supplier selection happened), else fallback to inventory cost estimation
                                            const targetItems = (order.po_items && order.po_items.length > 0) ? order.po_items : order.items;
                                            const totalBuyingCost = targetItems.reduce((acc, item) => {
                                                // Optimized Lookup
                                                const product = findProduct(item);

                                                // Use saved base_price if available, or current product base_price, or unitPrice fallback
                                                // If we have explicit supplier rate saved, buying cost = base * (1 - rate)
                                                // But usually `base_price` is reliable if matched.

                                                let cost = 0;
                                                // [FIX] Include item.base_price for unlinked items
                                                const basePrice = item.base_price ?? product?.base_price ?? product?.unitPrice ?? 0;

                                                // [FIX] Check for manual overrides first
                                                if (item.supplierPriceOverride !== undefined) {
                                                    cost = item.supplierPriceOverride;
                                                } else if (item.supplierRate !== undefined) {
                                                    // Cost = Base - (Base * Rate)
                                                    cost = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                                                } else {
                                                    // Fallback: Use base price and default rate
                                                    const rate = product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
                                                    cost = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                                                }

                                                return acc + (cost * item.quantity);
                                            }, 0);

                                            return (
                                                <tr
                                                    key={order.id}
                                                    className="hover:bg-slate-50/50 transition-colors cursor-pointer group"
                                                    onClick={() => {
                                                        setDetailInitialMode('CUSTOMER');
                                                        setSelectedOrder(order);
                                                    }}
                                                >
                                                    <td className="px-6 py-4 text-center text-slate-400 font-mono text-xs">
                                                        {filteredOrders.length - index}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col gap-1">
                                                            <span className="font-bold text-slate-800 line-clamp-1">
                                                                {order.items[0]?.name}
                                                                {order.items.length > 1 && <span className="text-slate-400 font-normal ml-1">외 {order.items.length - 1}건</span>}
                                                            </span>
                                                            <div className="flex gap-2 text-xs text-slate-500">
                                                                <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-mono">
                                                                    {order.id.slice(0, 8)}
                                                                </span>
                                                                {order.poNumber && (
                                                                    <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono border border-indigo-100">
                                                                        {order.poNumber}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-1.5 font-bold text-slate-700 flex-wrap">
                                                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                                                {order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName}
                                                                {(order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name) && ((order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name) !== order.customerName) && (
                                                                    <span className="text-[10px] font-normal text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">수정됨</span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5 pl-5">
                                                                <span className="text-xs text-slate-400">
                                                                    {new Date(order.createdAt).toLocaleDateString()} {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
                                                                {order.managers && order.managers.length > 0 ? (
                                                                    <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 font-bold ml-auto">
                                                                        {order.managers.map(m => m.name).join(', ')}
                                                                    </span>
                                                                ) : order.manager && (
                                                                    <span className="text-[10px] text-slate-500 ml-auto">
                                                                        {order.manager.name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right whitespace-nowrap">
                                                        <span className="font-bold text-teal-600">
                                                            {new Intl.NumberFormat('ko-KR').format(order.totalAmount)}원
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right whitespace-nowrap">
                                                        <span className="font-bold text-slate-800"> {/* [MOD] Match Total Amount Styling */}
                                                            {new Intl.NumberFormat('ko-KR').format(totalBuyingCost)}원
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {/* Status Select */}
                                                        {/* ... */}
                                                        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex flex-col items-center gap-1">
                                                                <StatusSelect
                                                                    status={order.status}
                                                                    onChange={(val) => handleStatusUpdate(order.id, val as Order['status'])}
                                                                />
                                                                {/* [MOD] Case-insensitive role check for Master/Admin visibility */}
                                                                {((user?.role?.toUpperCase() === 'MASTER' || user?.role?.toLowerCase() === 'admin')) && order.lastUpdatedBy && (
                                                                    <div className="text-[10px] text-slate-400 text-center leading-tight mt-1">
                                                                        Updated by <span className="font-bold text-slate-600">{order.lastUpdatedBy.name}</span><br />
                                                                        {new Date(order.lastUpdatedBy.at).toLocaleDateString()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            {/* [MOD] REMOVED PO BUTTON */}

                                                            {/* Sales (매출) Button */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDetailInitialMode('CUSTOMER');
                                                                    setSelectedOrder(order);
                                                                }}
                                                                className={`text-xs font-bold border rounded px-3 py-1.5 transition-colors whitespace-nowrap ${targetItems.length > 0 && targetItems.every(item => item.transactionIssued)
                                                                    ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                                                                    : 'text-teal-600 border-teal-200 hover:bg-teal-50'
                                                                    }`}
                                                            >
                                                                매출
                                                            </button>

                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDetailInitialMode('SUPPLIER'); // Set to Supplier Mode
                                                                    setSelectedOrder(order);
                                                                }}
                                                                className={`text-xs font-bold border rounded px-3 py-1.5 transition-colors whitespace-nowrap ${order.poSent || !!order.supplierPO
                                                                    ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                                                                    : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'
                                                                    }`}
                                                            >
                                                                매입
                                                            </button>

                                                            {/* Master/Admin Delete Button */}
                                                            {((user?.role?.toUpperCase() === 'MASTER' || user?.role?.toLowerCase() === 'admin')) && (
                                                                <>
                                                                    {filterStatus === 'TRASH' ? (
                                                                        <>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleRestore(order.id);
                                                                                }}
                                                                                className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                                                                                title="복구"
                                                                            >
                                                                                <ArchiveRestore className="w-4 h-4" />
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handlePermanentDelete(order.id);
                                                                                }}
                                                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                                title="영구 삭제"
                                                                            >
                                                                                <Trash2 className="w-4 h-4" />
                                                                            </button>
                                                                        </>
                                                                    ) : (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleDelete(order.id);
                                                                            }}
                                                                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                            title="휴지통으로 이동"
                                                                        >
                                                                            <Trash2 className="w-4 h-4" />
                                                                        </button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr >
                                            );
                                        })
                                    )}
                                </tbody >
                            </table >
                        </div >
                    </div >

                    {/* Detail Modal/Panel */}
                    {
                        selectedOrder && (
                            <AdminOrderDetail
                                order={selectedOrder}
                                onClose={() => setSelectedOrder(null)}
                                onUpdate={updateOrder}
                                initialMode={detailInitialMode} // [MOD] Pass Initial Mode
                            />
                        )
                    }

                </div >
            </PageTransition >
        </CalmPageShell >
    );
}

function FilterButton({ active, onClick, label, count, variant = 'default' }: { active: boolean; onClick: () => void; label: string; count?: number; variant?: 'default' | 'highlight' }) {
    let buttonStyle = active ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50';
    let badgeStyle = active ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-400';

    if (variant === 'highlight') {
        buttonStyle = active ? 'bg-slate-900 text-yellow-400 shadow-md ring-2 ring-yellow-400/50' : 'text-slate-500 hover:bg-slate-50';
        badgeStyle = active ? 'bg-yellow-400 text-slate-900' : 'bg-slate-100 text-slate-400';
    }

    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${buttonStyle}`}
        >
            {label}
            {count !== undefined && count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${badgeStyle}`}>
                    {count}
                </span>
            )}
        </button>
    );
}

function StatusSelect({ status, onChange }: { status: string; onChange: (val: string) => void }) {
    const styles: Record<string, string> = {
        SUBMITTED: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200',
        PROCESSING: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200',
        SHIPPED: 'bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200',
        COMPLETED: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200',
        CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200',
        ON_HOLD: 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200',
        WITHDRAWN: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200',
    };

    return (
        <div className="relative group">
            <select
                aria-label="주문 상태 변경"
                value={status}
                onChange={(e) => onChange(e.target.value)}
                className={`appearance-none cursor-pointer pl-3 pr-8 py-1.5 rounded-full text-xs font-bold border outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-300 transition-all ${styles[status] || styles.SUBMITTED}`}
            >
                <option value="SUBMITTED">주문접수</option>
                <option value="PROCESSING">처리중</option>
                <option value="ON_HOLD">보류 (Hold)</option>
                <option value="WITHDRAWN">회수 (Withdraw)</option>
                <option value="SHIPPED">배송중</option>
                <option value="COMPLETED">완료</option>{/* [MOD] Aligned Text */}
                <option value="CANCELLED">취소</option>{/* [MOD] Aligned Text */}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
        </div>
    );
}
