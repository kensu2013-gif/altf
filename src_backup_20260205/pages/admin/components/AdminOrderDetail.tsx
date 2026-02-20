import { useState } from 'react';
import type { Order } from '../../../types';
import { useStore } from '../../../store/useStore';
import { X, AlertTriangle, Check, Calendar, DollarSign, Package, User } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

interface AdminOrderDetailProps {
    order: Order;
    onClose: () => void;
    onUpdate: (orderId: string, updates: Partial<Order>) => void;
}

export function AdminOrderDetail({ order, onClose, onUpdate }: AdminOrderDetailProps) {
    const inventory = useStore((state) => state.inventory);

    // Local state for response form
    const [response, setResponse] = useState({
        confirmedPrice: order.adminResponse?.confirmedPrice || order.totalAmount,
        deliveryDate: order.adminResponse?.deliveryDate || '',
        note: order.adminResponse?.note || ''
    });

    const handleSave = () => {
        onUpdate(order.id, {
            adminResponse: response,
            status: 'PROCESSING' // Move to processing when admin responds
        });
        onClose();
    };

    // Helper to find stock
    const getProductStock = (productId: string | null) => {
        if (!productId) return null;
        return inventory.find(p => p.id === productId);
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm pointer-events-auto transition-opacity"
                onClick={onClose}
            />

            {/* Slide-over Panel */}
            <div className="w-full max-w-2xl h-full bg-white shadow-2xl pointer-events-auto flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">Order ID</span>
                            <span className="text-xs font-mono font-bold text-slate-600">{order.id}</span>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900">주문 상세 내역</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                        aria-label="닫기"
                    >
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">

                    {/* Customer Info */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3 flex items-center gap-2">
                            <User className="w-4 h-4 text-teal-600" />
                            고객사 정보
                        </h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">업체명</span>
                                <span className="font-bold text-slate-800">{order.customerName}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">사업자번호</span>
                                <span className="font-mono text-slate-600">{order.customerBizNo}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">주문일시</span>
                                <span className="text-slate-600">{new Date(order.createdAt).toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">현재 상태</span>
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${order.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-700' :
                                    order.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                    }`}>
                                    {order.status}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Order Items Table */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                            <Package className="w-4 h-4 text-teal-600" />
                            주문 품목 및 재고 확인
                        </h3>
                        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase">
                                    <tr>
                                        <th className="px-4 py-3">품목명 / 규격</th>
                                        <th className="px-4 py-3 text-right">주문수량</th>
                                        <th className="px-4 py-3 text-right">현재재고</th>
                                        <th className="px-4 py-3 text-center">상태</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {order.items.map((item, idx) => {
                                        const product = getProductStock(item.productId);
                                        const currentStock = product ? product.currentStock : 0;
                                        const isStockInsufficient = item.quantity > currentStock;
                                        const isUnlinked = !item.productId;

                                        return (
                                            <tr key={idx} className={isStockInsufficient ? 'bg-red-50/50' : 'bg-white'}>
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-slate-800">{item.name}</div>
                                                    <div className="text-slate-500 text-xs">
                                                        {item.thickness} | {item.size} | {item.material}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono font-bold">
                                                    {item.quantity.toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                    {isUnlinked ? '-' : currentStock.toLocaleString()}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isUnlinked ? (
                                                        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">미연동</span>
                                                    ) : isStockInsufficient ? (
                                                        <div className="flex items-center justify-center gap-1 text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded">
                                                            <AlertTriangle className="w-3 h-3" /> 재고부족
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-center gap-1 text-teal-600 font-bold text-xs bg-teal-50 px-2 py-1 rounded">
                                                            <Check className="w-3 h-3" /> 가능
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Admin Response Form */}
                    <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <Check className="w-4 h-4 text-teal-600" />
                            관리자 응답 작성 (견적 확정)
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label htmlFor="confirmedPrice" className="block text-xs font-bold text-slate-500 mb-1">총 견적 금액 (확정)</label>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        id="confirmedPrice"
                                        type="number"
                                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none font-mono font-bold text-slate-800"
                                        value={response.confirmedPrice}
                                        onChange={(e) => setResponse({ ...response, confirmedPrice: Number(e.target.value) })}
                                        placeholder="0"
                                    />
                                </div>
                                <p className="text-xs text-slate-400 mt-1 pl-1">
                                    기존 예상 견적: <span className="line-through">{order.totalAmount.toLocaleString()}원</span>
                                </p>
                            </div>

                            <div>
                                <label htmlFor="deliveryDate" className="block text-xs font-bold text-slate-500 mb-1">예상 납품일 (납기)</label>
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        id="deliveryDate"
                                        type="date"
                                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                        value={response.deliveryDate}
                                        onChange={(e) => setResponse({ ...response, deliveryDate: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="adminNote" className="block text-xs font-bold text-slate-500 mb-1">관리자 메모 (고객에게 전달됨)</label>
                                <textarea
                                    id="adminNote"
                                    className="w-full p-3 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none text-sm resize-none h-24"
                                    placeholder="특이사항이나 전달할 내용을 입력하세요."
                                    value={response.note}
                                    onChange={(e) => setResponse({ ...response, note: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>

                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-200 bg-white flex items-center justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>
                        닫기
                    </Button>
                    <Button
                        onClick={handleSave}
                        className="bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20 px-6"
                    >
                        견적 확정 및 답변 전송
                    </Button>
                </div>

            </div>
        </div>
    );
}
