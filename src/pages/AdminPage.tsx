import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { CalmPageShell } from '../components/ui/CalmPageShell';
import { PageTransition } from '../components/ui/PageTransition';
import {
    LayoutDashboard, ChevronDown, Building2, Trash2, ArchiveRestore
} from 'lucide-react';
import { AdminOrderDetail } from './admin/components/AdminOrderDetail';
import type { Order } from '../types';
import { useInventoryIndex } from '../hooks/useInventoryIndex';


export default function AdminPage() {
    const { orders, updateOrder, trashOrder, restoreOrder, permanentDeleteOrder, setOrders, inventory } = useStore((state) => state);
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

        // [MOD] If Admin/Manager, fetch ALL orders. Else fetch MY orders.
        const endpoint = (user.role === 'MASTER' || user.role === 'MANAGER' || user.role === 'admin')
            ? '/api/orders'
            : '/api/my/orders';

        fetch(endpoint, { headers, cache: 'no-store' })
            .then(res => {
                if (res.ok) return res.json();
                throw new Error('Failed to fetch');
            })
            .then(data => {
                if (Array.isArray(data)) setOrders(data);
            })
            .catch(console.error);
    }, [setOrders, user]);

    // UI State
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [detailInitialMode, setDetailInitialMode] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER'); // [MOD] Added Initial Mode State

    // Derived Data
    const filteredOrders = orders.filter(order => {
        if (filterStatus === 'TRASH') return order.isDeleted; // Show only deleted items in Trash
        if (order.isDeleted) return false; // Hide deleted items from other views
        if (filterStatus === 'all') return true;
        return order.status === filterStatus;
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

    return (
        <CalmPageShell>
            <div className="mb-6 flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-slate-900">관리자 대시보드</h1>
                <p className="text-sm text-slate-500">전체 주문 내역 및 상태 관리</p>
            </div>
            <PageTransition>
                <div className="space-y-6">
                    {/* Status Filters */}
                    <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm w-fit">
                        <FilterButton active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} label="전체" />
                        <FilterButton active={filterStatus === 'SUBMITTED'} onClick={() => setFilterStatus('SUBMITTED')} label="주문접수" />
                        <FilterButton active={filterStatus === 'PROCESSING'} onClick={() => setFilterStatus('PROCESSING')} label="처리중" />
                        <FilterButton active={filterStatus === 'ON_HOLD'} onClick={() => setFilterStatus('ON_HOLD')} label="보류" />
                        <FilterButton active={filterStatus === 'WITHDRAWN'} onClick={() => setFilterStatus('WITHDRAWN')} label="회수" />
                        <FilterButton active={filterStatus === 'SHIPPED'} onClick={() => setFilterStatus('SHIPPED')} label="배송중" />
                        <FilterButton active={filterStatus === 'COMPLETED'} onClick={() => setFilterStatus('COMPLETED')} label="완료" />
                        <FilterButton active={filterStatus === 'CANCELLED'} onClick={() => setFilterStatus('CANCELLED')} label="취소" />
                        <div className="w-[1px] h-4 bg-slate-200 mx-1" />
                        <button
                            onClick={() => setFilterStatus('TRASH')}
                            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filterStatus === 'TRASH' ? 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-red-500'}`}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            휴지통
                        </button>
                    </div>

                    {/* Orders Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 font-bold w-[5%] text-center">No.</th>
                                        <th scope="col" className="px-6 py-3 font-bold w-[20%]">주문 품목 (Items)</th>
                                        <th scope="col" className="px-6 py-3 font-bold w-[20%]">고객 / 주문일시 (Customer)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-right w-[15%] whitespace-nowrap">주문금액 (Sales)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-right w-[15%] whitespace-nowrap">매입금액 (Buying)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-center w-[12%]">상태 (Status)</th>
                                        <th scope="col" className="px-6 py-3 font-bold text-center w-[13%]">관리 (Manage)</th>
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
                                                const basePrice = item.base_price ?? product?.base_price ?? product?.unitPrice ?? 0;

                                                // If we have logic for supplier rate in PO items:
                                                if (item.supplierRate !== undefined) {
                                                    // Cost = Base - (Base * Rate)
                                                    cost = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                                                } else {
                                                    // Fallback: Use base price (assuming 0 margin or standard margin?)
                                                    // Actually, if simply estimating cost, base_price is the cost? 
                                                    // Wait, in AdminOrderDetail: "Supplier Price" is the buying cost.
                                                    // supplierPrice = basePrice * (100 - rate) / 100.
                                                    // If no rate is set, default rate is used.
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
                                                            <div className="flex items-center gap-1.5 font-bold text-slate-700">
                                                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                                                {order.customerName}
                                                            </div>
                                                            <span className="text-xs text-slate-400 mt-0.5 pl-5">
                                                                {new Date(order.createdAt).toLocaleDateString()} {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
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

                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDetailInitialMode('CUSTOMER'); // Set to Customer Mode
                                                                    setSelectedOrder(order);
                                                                }}
                                                                className="text-xs font-bold text-teal-600 border border-teal-200 rounded px-3 py-1.5 hover:bg-teal-50 transition-colors whitespace-nowrap"
                                                            >
                                                                매출{/* [MOD] Added whitespace-nowrap */}
                                                            </button>

                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDetailInitialMode('SUPPLIER'); // Set to Supplier Mode
                                                                    setSelectedOrder(order);
                                                                }}
                                                                className="text-xs font-bold text-indigo-600 border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition-colors whitespace-nowrap"
                                                            >
                                                                매입{/* [MOD] Added whitespace-nowrap */}
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

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${active ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
        >
            {label}
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
