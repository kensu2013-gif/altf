import React, { useState, useEffect } from 'react';
import {
    Check,
    Trash2,
    Plus,
    RefreshCw,
    AlertCircle,
    Copy,
    Search,
    ShieldCheck,
    Save,
    Truck,
    MapPin,
    Building2,
    Phone,
    User,
    FileText,
    Image as ImageIcon,
    ExternalLink
} from 'lucide-react';

export interface KakaoOrderItem {
    id: string;
    orderNo: string;
    channel: string;
    source: string;
    orderChannel: string;
    type: 'text' | 'image' | 'image_and_text';
    botUserKey: string;
    customerName: string;
    destination: string;
    freightTerms: string;
    recipient: string;
    phone: string;
    quoteAdj?: {
        seamless?: number;
        erwUnder100?: number;
        erwOver100?: number;
        targetVendor?: string;
    };
    status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
    validationStatus: 'VALID' | 'INCOMPLETE';
    missingFields: string[];
    reviewStatus: string;
    receivedAt: string;
    assignedDept: string;
    assignedAgents: string[];
    utterance: string;
    imageUrl?: string | null;
    items: Array<{
        id?: string;
        name: string;
        spec?: string;
        size?: string;
        thickness?: string;
        material?: string;
        quantity: number;
        unitPrice: number;
        amount: number;
    }>;
    itemCount: number;
    totalAmount: number;
    relatedQuotationId?: string | null;
    convertedOrderId?: string;
    approvedBy?: string;
    approvedAt?: string;
    rejectReason?: string;
}

interface KakaoOrderReviewTabProps {
    onClose?: () => void;
}

export const KakaoOrderReviewTab: React.FC<KakaoOrderReviewTabProps> = () => {
    const [orders, setOrders] = useState<KakaoOrderItem[]>([]);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [saving, setSaving] = useState<boolean>(false);
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
    const [searchKeyword, setSearchKeyword] = useState<string>('');
    const [copied, setCopied] = useState<boolean>(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Selected order editing state
    const [editCustomer, setEditCustomer] = useState<string>('');
    const [editDestination, setEditDestination] = useState<string>('');
    const [editFreight, setEditFreight] = useState<string>('');
    const [editRecipient, setEditRecipient] = useState<string>('');
    const [editPhone, setEditPhone] = useState<string>('');
    const [editItems, setEditItems] = useState<any[]>([]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/kakao/orders');
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.orders)) {
                    setOrders(data.orders);
                    if (data.orders.length > 0 && !selectedOrderId) {
                        setSelectedOrderId(data.orders[0].id);
                    }
                }
            }
        } catch (err) {
            console.error('카톡 발주서 목록 조회 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, []);

    const activeOrder = orders.find(o => o.id === selectedOrderId) || orders[0] || null;

    useEffect(() => {
        if (activeOrder) {
            setEditCustomer(activeOrder.customerName || '');
            setEditDestination(activeOrder.destination || '');
            setEditFreight(activeOrder.freightTerms || '');
            setEditRecipient(activeOrder.recipient || '');
            setEditPhone(activeOrder.phone || '');
            setEditItems(JSON.parse(JSON.stringify(activeOrder.items || [])));
        }
    }, [activeOrder?.id]);

    // Filtering
    const filteredOrders = orders.filter(order => {
        if (filterStatus === 'PENDING') {
            if (order.status === 'APPROVED') return false;
        }
        if (filterStatus === 'APPROVED') {
            if (order.status !== 'APPROVED') return false;
        }
        if (searchKeyword.trim()) {
            const kw = searchKeyword.toLowerCase();
            const matchCust = (order.customerName || '').toLowerCase().includes(kw);
            const matchDest = (order.destination || '').toLowerCase().includes(kw);
            const matchNo = (order.orderNo || '').toLowerCase().includes(kw);
            const matchUtter = (order.utterance || '').toLowerCase().includes(kw);
            return matchCust || matchDest || matchNo || matchUtter;
        }
        return true;
    });

    // Check if required fields are present
    const isDestinationEmpty = !editDestination.trim();
    const isFreightEmpty = !editFreight.trim();
    const canApprove = !isDestinationEmpty && !isFreightEmpty && activeOrder?.status !== 'APPROVED';

    // Item handlers
    const handleItemChange = (index: number, field: string, value: any) => {
        const updated = [...editItems];
        updated[index][field] = value;
        if (field === 'quantity' || field === 'unitPrice') {
            const qty = Number(updated[index].quantity) || 0;
            const price = Number(updated[index].unitPrice) || 0;
            updated[index].amount = qty * price;
        }
        setEditItems(updated);
    };

    const handleAddItem = () => {
        setEditItems([
            ...editItems,
            {
                id: `ORD-ITEM-${Date.now()}`,
                name: '90E(L)',
                size: '50A',
                thickness: 'S10S',
                material: 'STS304-W',
                quantity: 10,
                unitPrice: 12000,
                amount: 120000
            }
        ]);
    };

    const handleRemoveItem = (index: number) => {
        setEditItems(editItems.filter((_, i) => i !== index));
    };

    // Save changes
    const handleSaveOrder = async () => {
        if (!activeOrder) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerName: editCustomer,
                    destination: editDestination,
                    freightTerms: editFreight,
                    recipient: editRecipient,
                    phone: editPhone,
                    items: editItems
                })
            });
            if (res.ok) {
                alert('✅ 수정사항이 저장되었습니다.');
                await fetchOrders();
            } else {
                const data = await res.json();
                alert('저장 실패: ' + (data.error || '오류 발생'));
            }
        } catch (e: any) {
            alert('저장 오류: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    // Approve order into official db.orders
    const handleApproveOrder = async () => {
        if (!activeOrder) return;
        if (isDestinationEmpty || isFreightEmpty) {
            alert('🚨 도착지 정보와 운송비 조건이 필수 입력되어야 정식 발주서로 등록됩니다.');
            return;
        }

        if (!confirm(`[카카오톡 발주서 정식 승인 및 db.orders 등록]\n\n• 발송업체: ${editCustomer}\n• 도착지: ${editDestination}\n• 운송조건: ${editFreight}\n• 품목: 총 ${editItems.length}개 품목\n\n해당 발주서를 정식 시스템 원장(db.orders)으로 안전하게 이관 등록하시겠습니까?`)) {
            return;
        }

        setSaving(true);
        try {
            // First update edits
            await fetch(`/api/kakao/orders/${activeOrder.id}/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerName: editCustomer,
                    destination: editDestination,
                    freightTerms: editFreight,
                    recipient: editRecipient,
                    phone: editPhone,
                    items: editItems
                })
            });

            // Then approve
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approvedBy: '사무실 관리자 (조현진 대표)' })
            });

            if (res.ok) {
                const data = await res.json();
                alert(`🎉 [정식 발주 승인 완료]\n\n• 공식 발주번호: ${data.order?.convertedOrderId || '발급 완료'}\n• 상태: db.orders 원장 및 구매부(PUR-01/07) 대장 등록 완료`);
                await fetchOrders();
            } else {
                const data = await res.json();
                alert('승인 실패: ' + (data.error || '오류 발생'));
            }
        } catch (e: any) {
            alert('승인 오류: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleReject = async () => {
        if (!activeOrder) return;
        const reason = prompt('반려 사유를 입력해주세요:', '도착지 및 품목 규격 불명확');
        if (!reason) return;

        setSaving(true);
        try {
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            if (res.ok) {
                alert('발주서가 반려 처리되었습니다.');
                await fetchOrders();
            }
        } catch (e: any) {
            alert('반려 오류: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    // 🗑️ Permanent deletion from dashboard and altf.kr
    const handleDeleteOrder = async () => {
        if (!activeOrder) return;
        if (!confirm(`[카카오톡 발주서 영구 삭제]\n\n• 발주번호: ${activeOrder.orderNo}\n• 발송업체: ${activeOrder.customerName}\n\n정말로 이 발주서를 영구 삭제하시겠습니까?\n\n* 삭제 시 대시보드 및 altf.kr 정식 주문 대장에서 완전히 제거되어 다시는 표시되지 않습니다.`)) {
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                alert(`🗑️ [삭제 완료] ${activeOrder.orderNo} 건이 영구 삭제되었습니다.\n(대시보드 및 altf.kr에서 완전히 제거되었습니다.)`);
                setSelectedOrderId(null);
                await fetchOrders();
            } else {
                alert('삭제 실패');
            }
        } catch (e: any) {
            alert('삭제 오류: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const pendingCount = orders.filter(o => o.status !== 'APPROVED').length;
    const currentTotal = editItems.reduce((s, it) => s + (it.amount || ((it.unitPrice || 0) * (it.quantity || 1))), 0);

    return (
        <div className="flex-1 flex overflow-hidden">
            {/* Left Queue Panel */}
            <div className="w-80 border-r border-gray-800/80 bg-[#13151c] flex flex-col flex-shrink-0">
                <div className="p-3 border-b border-gray-800 space-y-2">
                    <div className="flex rounded-lg bg-gray-900 p-1 border border-gray-800 text-xs">
                        <button
                            onClick={() => setFilterStatus('ALL')}
                            className={`flex-1 py-1 rounded-md font-medium transition-colors ${filterStatus === 'ALL' ? 'bg-emerald-500 text-black font-bold shadow' : 'text-gray-400 hover:text-white'}`}
                        >
                            전체 ({orders.length})
                        </button>
                        <button
                            onClick={() => setFilterStatus('PENDING')}
                            className={`flex-1 py-1 rounded-md font-medium transition-colors ${filterStatus === 'PENDING' ? 'bg-amber-500 text-black font-bold shadow' : 'text-gray-400 hover:text-white'}`}
                        >
                            접수대기 ({pendingCount})
                        </button>
                        <button
                            onClick={() => setFilterStatus('APPROVED')}
                            className={`flex-1 py-1 rounded-md font-medium transition-colors ${filterStatus === 'APPROVED' ? 'bg-cyan-600 text-white font-bold shadow' : 'text-gray-400 hover:text-white'}`}
                        >
                            원장 승인됨
                        </button>
                    </div>
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-500" />
                        <input
                            type="text"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            placeholder="발송업체, 도착지, 발주번호 검색..."
                            className="w-full bg-[#1b1e27] border border-gray-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                        />
                    </div>
                </div>

                {/* List Items */}
                <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50 custom-scrollbar">
                    {filteredOrders.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 text-xs">
                            인입된 카카오톡 발주서가 없습니다.
                        </div>
                    ) : (
                        filteredOrders.map((item) => {
                            const isSelected = item.id === (activeOrder?.id);
                            const isApproved = item.status === 'APPROVED';
                            const isIncomplete = item.validationStatus === 'INCOMPLETE';
                            const formattedTime = new Date(item.receivedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                            const formattedDate = new Date(item.receivedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

                            return (
                                <div
                                    key={item.id}
                                    onClick={() => setSelectedOrderId(item.id)}
                                    className={`p-3.5 cursor-pointer transition-all border-l-4 ${
                                        isSelected 
                                            ? 'bg-emerald-500/10 border-emerald-500 text-white' 
                                            : 'hover:bg-gray-800/40 border-transparent text-gray-400'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-400 text-black">
                                                카카오톡
                                            </span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                isApproved 
                                                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' 
                                                    : isIncomplete
                                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                            }`}>
                                                {isApproved ? '🎉 정식 원장 승인완료' : isIncomplete ? '⚠️ 도착지/운송비 확인 필요' : '✅ 필수항목 완비'}
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-gray-500">
                                            {formattedDate} {formattedTime}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="font-bold text-sm text-gray-200 truncate">
                                            {item.customerName || '발송업체 미기재'}
                                        </div>
                                        <div className="text-xs font-semibold text-emerald-400">
                                            {item.itemCount > 0 ? `${item.itemCount}개 품목` : '품목 파싱 중'}
                                        </div>
                                    </div>

                                    <div className="text-xs text-gray-400 truncate mt-1 flex items-center gap-1">
                                        <MapPin className="w-3 h-3 text-gray-500 flex-shrink-0" />
                                        <span>{item.destination || '도착지 미기재'}</span>
                                        <span className="text-gray-600">|</span>
                                        <span>{item.freightTerms || '운송조건 미기재'}</span>
                                    </div>

                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-800/50 text-[11px] text-gray-500">
                                        <span>{item.orderNo}</span>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-gray-400">{item.type === 'image_and_text' ? '📷 사진+텍스트' : item.type === 'image' ? '📷 사진' : '💬 텍스트'}</span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm(`[카카오톡 발주서 영구 삭제]\n\n${item.orderNo} (${item.customerName}) 건을 영구 삭제하시겠습니까?\n대시보드 및 altf.kr 정식 주문 대장에서 완전히 제거됩니다.`)) {
                                                        fetch(`/api/kakao/orders/${item.id}`, { method: 'DELETE' }).then(() => {
                                                            if (selectedOrderId === item.id) setSelectedOrderId(null);
                                                            fetchOrders();
                                                        });
                                                    }
                                                }}
                                                className="p-1 hover:bg-rose-950/60 rounded text-gray-500 hover:text-rose-400 transition-colors"
                                                title="영구 삭제"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right Detail Pane: Office Staff Verification & Completion Form */}
            {activeOrder ? (
                <div className="flex-1 flex flex-col bg-[#0d0f14] overflow-hidden">
                    {/* Detail Top Header */}
                    <div className="px-6 py-4 border-b border-gray-800 bg-[#161922] flex items-center justify-between flex-shrink-0">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-400 text-black">
                                    [카카오톡 접수]
                                </span>
                                <h3 className="text-base font-bold text-white font-mono">
                                    {activeOrder.orderNo}
                                </h3>
                                <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                                    activeOrder.status === 'APPROVED'
                                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                        : activeOrder.validationStatus === 'INCOMPLETE'
                                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                }`}>
                                    {activeOrder.status === 'APPROVED' ? '🎉 정식 원장 승인 완료' : activeOrder.validationStatus === 'INCOMPLETE' ? '⚠️ 사무실 확인/보완 필요' : '✅ 검증 완료 (승인 대기)'}
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                                접수일시: {new Date(activeOrder.receivedAt).toLocaleString('ko-KR')} | 담당: 관제 게이트(EXE-02) ➔ 구매부(PUR-01/07)
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchOrders}
                                disabled={loading}
                                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
                                title="새로고침"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Form Body */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                        {/* ⚠️ Incomplete Validation Banner */}
                        {activeOrder.status !== 'APPROVED' && (isDestinationEmpty || isFreightEmpty) && (
                            <div className="bg-rose-950/40 border border-rose-800/80 rounded-xl p-4 flex items-start gap-3 text-rose-200">
                                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                                <div className="text-xs space-y-1">
                                    <div className="font-bold text-sm text-rose-300">
                                        🚨 [도착지 정보 및 운송비 조건 확인 필수]
                                    </div>
                                    <p className="leading-relaxed">
                                        알트에프 발주 원칙상 <b>도착지 정보(화물 지점 또는 주소)</b>와 <b>운송비 조건(선불/현불청구/착불)</b>이 명확하지 않으면 정식 발주서로 접수되지 않습니다.
                                        아래 입력란에서 사무실 직원이 직접 확인 및 보완 후 <b>[정식 발주서 등록 승인]</b>을 진행해주세요.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Customer Raw Utterance & Photo Preview */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-[#151821] border border-gray-800 rounded-xl p-4 space-y-2">
                                <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-amber-400" />
                                        <span>고객 카카오톡 원문 (Utterance)</span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(activeOrder.utterance || '');
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        }}
                                        className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1"
                                    >
                                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        {copied ? '복사됨' : '원문 복사'}
                                    </button>
                                </div>
                                <div className="bg-[#0f1117] border border-gray-800/80 rounded-lg p-3 text-xs text-gray-200 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto selection:bg-amber-500 selection:text-black">
                                    {activeOrder.utterance || '(텍스트 내용 없음)'}
                                </div>
                            </div>

                            {/* Image Preview Box */}
                            <div className="bg-[#151821] border border-gray-800 rounded-xl p-4 space-y-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-gray-300">
                                    <ImageIcon className="w-4 h-4 text-cyan-400" />
                                    <span>수신 사진/발주서 문서</span>
                                </div>
                                {activeOrder.imageUrl ? (
                                    <div className="relative group bg-[#0f1117] border border-gray-800/80 rounded-lg h-48 flex items-center justify-center overflow-hidden">
                                        <img
                                            src={activeOrder.imageUrl}
                                            alt="Kakao Order Attachment"
                                            className="max-h-full max-w-full object-contain cursor-pointer hover:scale-105 transition-transform"
                                            onClick={() => setPreviewImage(activeOrder.imageUrl || null)}
                                        />
                                        <a
                                            href={activeOrder.imageUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-[10px] text-gray-200 rounded flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <ExternalLink className="w-3 h-3" /> 크게보기
                                        </a>
                                    </div>
                                ) : (
                                    <div className="bg-[#0f1117] border border-gray-800/80 rounded-lg h-48 flex items-center justify-center text-xs text-gray-600">
                                        첨부된 사진 또는 이미지가 없습니다.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Office Staff Verification Inputs */}
                        <div className="bg-[#151821] border border-gray-800 rounded-xl p-5 space-y-4">
                            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                1. 발송 및 운송 필수 항목 검증 (Human-in-the-Loop)
                            </h4>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                                {/* Company Name */}
                                <div className="space-y-1">
                                    <label className="text-gray-300 font-bold flex items-center gap-1">
                                        <Building2 className="w-3.5 h-3.5 text-gray-400" />
                                        발송업체명 (상호) <span className="text-rose-400">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={editCustomer}
                                        onChange={(e) => setEditCustomer(e.target.value)}
                                        placeholder="예: 원진철강, 에스와이금속"
                                        className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                                    />
                                </div>

                                {/* Destination */}
                                <div className="space-y-1">
                                    <label className="text-gray-300 font-bold flex items-center gap-1">
                                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                        도착지 정보 (화물지점/주소) <span className="text-rose-400">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={editDestination}
                                        onChange={(e) => setEditDestination(e.target.value)}
                                        placeholder="예: 대신화물/평택고덕 지점, 동시화"
                                        className={`w-full bg-[#1b1e27] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none ${
                                            isDestinationEmpty 
                                                ? 'border-2 border-rose-500/80 bg-rose-950/20' 
                                                : 'border border-gray-700 focus:border-emerald-500'
                                        }`}
                                    />
                                    {isDestinationEmpty && (
                                        <span className="text-[10px] text-rose-400 font-semibold">⚠️ 필수 항목: 도착지 정보를 입력해주세요.</span>
                                    )}
                                </div>

                                {/* Freight Terms */}
                                <div className="space-y-1">
                                    <label className="text-gray-300 font-bold flex items-center gap-1">
                                        <Truck className="w-3.5 h-3.5 text-gray-400" />
                                        운송비 조건 <span className="text-rose-400">*</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={editFreight}
                                            onChange={(e) => setEditFreight(e.target.value)}
                                            placeholder="예: 선불 화물 발송, 현불화물 후 화물비청구"
                                            className={`flex-1 bg-[#1b1e27] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none ${
                                                isFreightEmpty 
                                                    ? 'border-2 border-rose-500/80 bg-rose-950/20' 
                                                    : 'border border-gray-700 focus:border-emerald-500'
                                            }`}
                                        />
                                        <select
                                            onChange={(e) => e.target.value && setEditFreight(e.target.value)}
                                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 text-gray-300 text-xs focus:outline-none"
                                            defaultValue=""
                                        >
                                            <option value="" disabled>선택</option>
                                            <option value="선불 화물 발송">선불 화물 발송</option>
                                            <option value="현불화물 후 화물비청구">현불화물 후 화물비청구</option>
                                            <option value="현불화물">현불화물</option>
                                            <option value="착불화물">착불화물</option>
                                            <option value="직송">직송</option>
                                            <option value="용차">용차</option>
                                        </select>
                                    </div>
                                    {isFreightEmpty && (
                                        <span className="text-[10px] text-rose-400 font-semibold">⚠️ 필수 항목: 운송비 조건을 입력해주세요.</span>
                                    )}
                                </div>

                                {/* Recipient */}
                                <div className="space-y-1">
                                    <label className="text-gray-300 font-bold flex items-center gap-1">
                                        <User className="w-3.5 h-3.5 text-gray-400" />
                                        수령인 (담당자)
                                    </label>
                                    <input
                                        type="text"
                                        value={editRecipient}
                                        onChange={(e) => setEditRecipient(e.target.value)}
                                        placeholder="예: 김지용 대리님"
                                        className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                                    />
                                </div>

                                {/* Phone */}
                                <div className="space-y-1">
                                    <label className="text-gray-300 font-bold flex items-center gap-1">
                                        <Phone className="w-3.5 h-3.5 text-gray-400" />
                                        수령인 연락처
                                    </label>
                                    <input
                                        type="text"
                                        value={editPhone}
                                        onChange={(e) => setEditPhone(e.target.value)}
                                        placeholder="예: 010-2241-4856"
                                        className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                                    />
                                </div>

                                {/* Quotation Adjustment Info */}
                                {activeOrder.quoteAdj && Object.keys(activeOrder.quoteAdj).length > 0 && (
                                    <div className="space-y-1 bg-amber-950/20 border border-amber-800/40 rounded-lg p-2.5">
                                        <label className="text-amber-300 font-bold">
                                            🎯 견적/요율 연계 특이사항
                                        </label>
                                        <div className="text-[11px] text-amber-200">
                                            {activeOrder.quoteAdj.seamless && <span>심레스: {activeOrder.quoteAdj.seamless}% </span>}
                                            {activeOrder.quoteAdj.erwUnder100 && <span>ERW 100↓: {activeOrder.quoteAdj.erwUnder100}% </span>}
                                            {activeOrder.quoteAdj.erwOver100 && <span>ERW 100↑: {activeOrder.quoteAdj.erwOver100}% </span>}
                                            {activeOrder.quoteAdj.targetVendor && <span>지정: {activeOrder.quoteAdj.targetVendor}</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Items Table */}
                        <div className="bg-[#151821] border border-gray-800 rounded-xl p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                                    2. 발주 품목 및 수량 대장 (총 {editItems.length}개 품목)
                                </h4>
                                <button
                                    onClick={handleAddItem}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40"
                                >
                                    <Plus className="w-3.5 h-3.5" /> 품목 추가
                                </button>
                            </div>

                            <div className="overflow-x-auto border border-gray-800 rounded-lg">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[#1b1e27] text-gray-400 font-semibold">
                                        <tr>
                                            <th className="p-2.5">품명</th>
                                            <th className="p-2.5">규격(Size)</th>
                                            <th className="p-2.5">두께(Sch)</th>
                                            <th className="p-2.5">재질</th>
                                            <th className="p-2.5 text-right">수량</th>
                                            <th className="p-2.5 text-right">단가(원)</th>
                                            <th className="p-2.5 text-right">금액(원)</th>
                                            <th className="p-2.5 text-center">삭제</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800 text-gray-200">
                                        {editItems.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="p-4 text-center text-gray-500">
                                                    등록된 품목이 없습니다. [품목 추가]를 눌러 입력해주세요.
                                                </td>
                                            </tr>
                                        ) : (
                                            editItems.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-gray-800/30">
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={item.name || ''}
                                                            onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                                            className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={item.size || ''}
                                                            onChange={(e) => handleItemChange(idx, 'size', e.target.value)}
                                                            className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={item.thickness || ''}
                                                            onChange={(e) => handleItemChange(idx, 'thickness', e.target.value)}
                                                            className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={item.material || ''}
                                                            onChange={(e) => handleItemChange(idx, 'material', e.target.value)}
                                                            className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                                                        />
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <input
                                                            type="number"
                                                            value={item.quantity || 1}
                                                            onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                                                            className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-right text-white"
                                                        />
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <input
                                                            type="number"
                                                            value={item.unitPrice || 0}
                                                            onChange={(e) => handleItemChange(idx, 'unitPrice', parseInt(e.target.value, 10) || 0)}
                                                            className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-right text-white"
                                                        />
                                                    </td>
                                                    <td className="p-2 text-right font-mono font-semibold text-emerald-400">
                                                        {(item.amount || ((item.unitPrice || 0) * (item.quantity || 1))).toLocaleString()}원
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        <button
                                                            onClick={() => handleRemoveItem(idx)}
                                                            className="p-1 hover:bg-rose-900/40 rounded text-rose-400"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="px-6 py-4 border-t border-gray-800 bg-[#161922] flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleDeleteOrder}
                                disabled={saving}
                                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-gray-800/90 hover:bg-rose-950/80 text-rose-400 border border-rose-900/60 transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                                title="대시보드 및 altf.kr 정식 원장에서 영구 삭제"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                                <span>발주서 영구 삭제</span>
                            </button>
                            {activeOrder.status !== 'APPROVED' && (
                                <button
                                    onClick={handleReject}
                                    disabled={saving}
                                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-rose-950/40 text-rose-300 border border-gray-700 transition-colors disabled:opacity-50"
                                >
                                    ❌ 반려
                                </button>
                            )}
                            <button
                                onClick={handleSaveOrder}
                                disabled={saving}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            >
                                <Save className="w-3.5 h-3.5" />
                                {saving ? '저장 중...' : '💾 수정사항 임시저장'}
                            </button>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="text-right">
                                <div className="text-[11px] text-gray-400">발주 합계 금액</div>
                                <div className="text-base font-bold text-emerald-400 font-mono">
                                    ₩{currentTotal.toLocaleString()}원 (VAT별도)
                                </div>
                            </div>

                            {activeOrder.status === 'APPROVED' ? (
                                <div className="px-4 py-2.5 rounded-xl bg-cyan-950/60 border border-cyan-700 text-cyan-300 text-xs font-bold flex items-center gap-2">
                                    <Check className="w-4 h-4 text-cyan-400" />
                                    정식 발주 승인 완료 ({activeOrder.convertedOrderId})
                                </div>
                            ) : (
                                <button
                                    onClick={handleApproveOrder}
                                    disabled={saving || !canApprove}
                                    className={`flex items-center gap-2 px-6 py-2.5 text-xs font-bold rounded-xl shadow-lg transition-all transform active:scale-95 ${
                                        canApprove
                                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-black shadow-emerald-500/20 cursor-pointer'
                                            : 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed opacity-60'
                                    }`}
                                    title={!canApprove ? '도착지 정보와 운송비 조건이 필수 입력되어야 합니다.' : '정식 db.orders에 등록'}
                                >
                                    <Check className="w-4 h-4" />
                                    {saving ? '승인 처리 중...' : '🚀 [정식 발주서 등록 승인 (db.orders)]'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                    좌측 목록에서 검토할 발주서 건을 선택해주세요.
                </div>
            )}

            {/* Photo Zoom Modal */}
            {previewImage && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
                    onClick={() => setPreviewImage(null)}
                >
                    <img
                        src={previewImage}
                        alt="Zoomed Attachment"
                        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
                    />
                </div>
            )}
        </div>
    );
};
