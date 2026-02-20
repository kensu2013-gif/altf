import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { CalmPageShell } from '../components/ui/CalmPageShell';
import { PageTransition } from '../components/ui/PageTransition';
import {
    LayoutDashboard, ChevronDown, Building2
} from 'lucide-react';
import { AdminOrderDetail } from './admin/components/AdminOrderDetail';
import type { Order } from '../types';

export default function AdminPage() {
    const { orders, updateOrder } = useStore((state) => state);

    // UI State
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [selectedCompany, setSelectedCompany] = useState<string>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    // Derived Data: Unique Companies
    const companies = useMemo(() => {
        const unique = new Set(orders.map(o => o.customerName));
        return Array.from(unique);
    }, [orders]);

    // Derived Data: Filtered Orders
    const filteredOrders = useMemo(() => {
        return orders.filter(o => {
            const matchStatus = filterStatus === 'all' || o.status === filterStatus;
            const matchCompany = selectedCompany === 'all' || o.customerName === selectedCompany;
            return matchStatus && matchCompany;
        });
    }, [orders, filterStatus, selectedCompany]);

    const handleStatusUpdate = (orderId: string, newStatus: Order['status']) => {
        updateOrder(orderId, { status: newStatus });
    };

    return (
        <CalmPageShell>
            <PageTransition>
                <div className="max-w-7xl mx-auto min-h-[600px] mb-20 relative">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                                <LayoutDashboard className="w-8 h-8 text-teal-600" />
                                주문 관리 (Orders)
                            </h1>
                            <p className="text-slate-500 mt-1">접수된 주문을 확인하고 재고 및 견적을 확정합니다.</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            {/* Company Filter */}
                            <div className="relative group">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                    <Building2 className="w-4 h-4" />
                                </div>
                                <select
                                    aria-label="협력사 필터"
                                    className="pl-9 pr-8 py-2 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white shadow-sm appearance-none cursor-pointer"
                                    value={selectedCompany}
                                    onChange={(e) => setSelectedCompany(e.target.value)}
                                >
                                    <option value="all">전체 협력사</option>
                                    {companies.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                                <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>

                            {/* Status Filters */}
                            <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                                <FilterButton active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} label="All" />
                                <FilterButton active={filterStatus === 'SUBMITTED'} onClick={() => setFilterStatus('SUBMITTED')} label="접수" />
                                <FilterButton active={filterStatus === 'PROCESSING'} onClick={() => setFilterStatus('PROCESSING')} label="처리중" />
                                <FilterButton active={filterStatus === 'SHIPPED'} onClick={() => setFilterStatus('SHIPPED')} label="배송" />
                            </div>
                        </div>
                    </div>

                    {/* Orders Table */}
                    <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider">Order ID / Date</th>
                                        <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider">Customer</th>
                                        <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-right">Items</th>
                                        <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-right">Total Amount</th>
                                        <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                                        <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredOrders.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                                주문 내역이 없습니다.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredOrders.map(order => (
                                            <tr
                                                key={order.id}
                                                className="hover:bg-teal-50/30 transition-colors cursor-pointer group"
                                                onClick={() => setSelectedOrder(order)}
                                            >
                                                <td className="px-6 py-4">
                                                    <div className="font-mono text-slate-500 text-xs group-hover:text-teal-600 transition-colors">{order.id}</div>
                                                    <div className="text-slate-800 font-medium">{new Date(order.createdAt).toLocaleDateString()}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="text-slate-800 font-bold">{order.customerName}</div>
                                                    <div className="text-slate-400 text-xs">{order.customerBizNo}</div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold text-slate-600">
                                                        {order.items.length} ea
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div>
                                                        <span className="font-bold text-slate-800">
                                                            {new Intl.NumberFormat('ko-KR').format(order.adminResponse?.confirmedPrice || order.totalAmount)}원
                                                        </span>
                                                    </div>
                                                    {order.adminResponse?.confirmedPrice && (
                                                        <span className="text-[10px] text-teal-600 font-bold">(확정됨)</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                                                        <StatusSelect
                                                            status={order.status}
                                                            onChange={(val) => handleStatusUpdate(order.id, val as Order['status'])}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button className="text-xs font-bold text-teal-600 border border-teal-200 rounded px-3 py-1.5 hover:bg-teal-50 transition-colors">
                                                        상세보기
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Detail Modal/Panel */}
                    {selectedOrder && (
                        <AdminOrderDetail
                            order={selectedOrder}
                            onClose={() => setSelectedOrder(null)}
                            onUpdate={updateOrder}
                        />
                    )}

                </div>
            </PageTransition>
        </CalmPageShell>
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
                <option value="SHIPPED">배송중</option>
                <option value="COMPLETED">완료됨</option>
                <option value="CANCELLED">취소됨</option>
            </select>
            <ChevronDown className="w-3 h-3 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
        </div>
    );
}
