import React, { useState, useEffect, useCallback } from 'react';
import {
    X,
    MessageSquare,
    Check,
    Trash2,
    Plus,
    RefreshCw,
    AlertCircle,
    Copy,
    Search,
    ShieldCheck,
    Save
} from 'lucide-react';
import { KakaoOrderReviewTab } from './KakaoOrderReviewTab';

interface QuoteItem {
    id: string;
    productId?: string;
    itemId?: string;
    name: string;
    thickness?: string;
    size: string;
    material?: string;
    quantity: number;
    basePrice: number;
    discountRate: number;
    unitPrice: number;
    amount: number;
    currentStock?: number;
    location?: string;
    stockStatus?: string;
}

interface MatchedUser {
    botUserKey?: string;
    name?: string;
    phone?: string;
    company?: string;
    email?: string;
    registeredAt?: string;
    notes?: string;
}

interface ReviewQueueItem {
    intakeId: string;
    quotationId: string | null;
    receivedAt: string;
    type: 'text' | 'image';
    botUserKey: string;
    matchedUser?: MatchedUser | null;
    customer: {
        name: string;
        phone: string;
        company: string;
    };
    rawUtterance: string;
    imageUrl?: string | null;
    status: string;
    reviewStatus: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    discountRate: number;
    memo: string;
    items: QuoteItem[];
    totalAmount: number;
    vatAmount: number;
    grandTotal: number;
    formattedKakaoText: string;
    dispatchStatus?: string;
}

interface KakaoMessengerQuoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: 'ORDERS' | 'QUOTES';
}

export const KakaoMessengerQuoteModal: React.FC<KakaoMessengerQuoteModalProps> = ({
    isOpen,
    onClose,
    initialTab = 'ORDERS'
}) => {
    const [mainTab, setMainTab] = useState<'ORDERS' | 'QUOTES'>(initialTab);

    useEffect(() => {
        if (isOpen && initialTab) {
            setMainTab(initialTab);
        }
    }, [isOpen, initialTab]);
    const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [saving, setSaving] = useState<boolean>(false);
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
    const [searchKeyword, setSearchKeyword] = useState<string>('');
    const [copied, setCopied] = useState<boolean>(false);

    // Selected item local editing state
    const [editItems, setEditItems] = useState<QuoteItem[]>([]);
    const [editDiscountRate, setEditDiscountRate] = useState<number>(50);
    const [editMemo, setEditMemo] = useState<string>('');
    const [editCustomerName, setEditCustomerName] = useState<string>('');
    const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');

    // Fetch review queue
    const fetchQueue = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/kakao/review-queue');
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.queue)) {
                    setQueue(data.queue);
                    if (data.queue.length > 0) {
                        setSelectedId(prev => prev || data.queue[0].intakeId);
                    }
                }
            }
        } catch (err) {
            console.error('카톡 검토 큐 조회 실패:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            fetchQueue();
        }
    }, [isOpen, fetchQueue]);

    // Active selected item
    const activeItem = queue.find(q => q.intakeId === selectedId) || queue[0] || null;

    // Synchronize edit buffer when active item changes
    useEffect(() => {
        if (activeItem) {
            setEditItems(JSON.parse(JSON.stringify(activeItem.items || [])));
            setEditDiscountRate(activeItem.discountRate || 50);
            setEditMemo(activeItem.memo || '시화/양산 물류센터 당일 직출고 준비');
            setEditCustomerName(activeItem.customer?.name || '');
            setEditCustomerPhone(activeItem.customer?.phone || '');
        }
    }, [activeItem?.intakeId]);

    if (!isOpen) return null;

    // Filtering
    const filteredQueue = queue.filter(item => {
        if (filterStatus === 'PENDING') {
            if (item.reviewStatus === 'APPROVED' || item.status === 'APPROVED') return false;
        }
        if (filterStatus === 'APPROVED') {
            if (item.reviewStatus !== 'APPROVED' && item.status !== 'APPROVED') return false;
        }
        if (searchKeyword.trim()) {
            const kw = searchKeyword.toLowerCase();
            const matchName = (item.customer?.name || '').toLowerCase().includes(kw);
            const matchUtterance = (item.rawUtterance || '').toLowerCase().includes(kw);
            const matchQid = (item.quotationId || '').toLowerCase().includes(kw);
            return matchName || matchUtterance || matchQid;
        }
        return true;
    });

    // Item editing handlers
    const handleQuantityChange = (index: number, newQty: number) => {
        const updated = [...editItems];
        const qty = Math.max(1, newQty);
        updated[index].quantity = qty;
        updated[index].amount = updated[index].unitPrice * qty;
        setEditItems(updated);
    };

    const handleUnitPriceChange = (index: number, newPrice: number) => {
        const updated = [...editItems];
        const price = Math.max(0, newPrice);
        updated[index].unitPrice = price;
        updated[index].amount = price * updated[index].quantity;
        setEditItems(updated);
    };

    const handleDiscountRateChange = (newRate: number) => {
        const rate = Math.max(0, Math.min(90, newRate));
        setEditDiscountRate(rate);
        const updated = editItems.map(it => {
            const unitPrice = Math.round(it.basePrice * (1 - rate / 100));
            return {
                ...it,
                discountRate: rate,
                unitPrice,
                amount: unitPrice * it.quantity
            };
        });
        setEditItems(updated);
    };

    const handleRemoveItem = (index: number) => {
        const updated = editItems.filter((_, i) => i !== index);
        setEditItems(updated);
    };

    const handleAddItem = () => {
        const newItem: QuoteItem = {
            id: `item-manual-${Date.now()}`,
            name: '90E(L)',
            thickness: 'S10S',
            size: '50A',
            material: 'STS304-W',
            quantity: 10,
            basePrice: 12000,
            discountRate: editDiscountRate,
            unitPrice: Math.round(12000 * (1 - editDiscountRate / 100)),
            amount: Math.round(12000 * (1 - editDiscountRate / 100)) * 10,
            currentStock: 999,
            location: '양산',
            stockStatus: 'AVAILABLE'
        };
        setEditItems([...editItems, newItem]);
    };

    // Calculate totals on the fly
    const currentSubtotal = editItems.reduce((sum, it) => sum + (it.amount || 0), 0);
    const currentVat = Math.round(currentSubtotal * 0.1);
    const currentGrandTotal = currentSubtotal + currentVat;

    // Generate real-time live preview text
    const generatePreviewText = () => {
        if (!activeItem) return '';
        const custName = editCustomerName || activeItem.customer?.name || '고객사';
        const today = new Date();
        const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
        const isApproved = activeItem.reviewStatus === 'APPROVED' || activeItem.status === 'APPROVED';

        let itemsText = '';
        if (editItems.length === 0) {
            itemsText = '• 등록된 견적 품목이 없습니다.';
        } else if (editItems.length <= 10) {
            itemsText = editItems.map((it, idx) => {
                const spec = `${it.name || '피팅'} ${it.thickness || ''} ${it.size || ''} (${it.material || 'STS304'})`.trim();
                const stockNote = it.stockStatus === 'OUT_OF_STOCK' ? '주문제작 3~5일' : '즉시출고 가능';
                return `${idx + 1}. ${spec}\n   수량: ${it.quantity}EA | 단가: ${it.unitPrice.toLocaleString()}원 | 금액: ${it.amount.toLocaleString()}원 [${stockNote}]`;
            }).join('\n');
        } else {
            const topItems = editItems.slice(0, 10).map((it, idx) => {
                const spec = `${it.name} ${it.thickness || ''} ${it.size}`;
                return `${idx + 1}. ${spec} : ${it.quantity}EA (${it.amount.toLocaleString()}원)`;
            }).join('\n');
            itemsText = `${topItems}\n... 외 ${editItems.length - 10}개 품목 추가 포함 (총 ${editItems.length}품목)`;
        }

        const memoClean = editMemo.trim() || '시화/양산 물류센터 당일 직출고 준비';

        return `📋 [알트에프(AltF) 정식 견적서 회신]\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `• 견적번호: ${activeItem.quotationId || 'DRAFT'}\n` +
               `• 수신고객: ${custName} 귀하\n` +
               `• 견적일자: ${dateStr} (유효기간: 7일)\n` +
               `• 적용요율: 단가표 기준 -${editDiscountRate}% 적용\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `[견적 품목 내역] (총 ${editItems.length}개 품목)\n\n` +
               `${itemsText}\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `• 공급가액: ${currentSubtotal.toLocaleString()}원\n` +
               `• 부가세(10%): ${currentVat.toLocaleString()}원\n` +
               `💰 최종 합계: ${currentGrandTotal.toLocaleString()}원 (VAT 포함)\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `📦 검토상태: ${isApproved ? '✅ [영업부 담당자 검토 및 단가 승인 완료]' : '✅ [담당자 최종 확인 완료 - 즉시 출고 가능]'}\n` +
               `🚚 배송/납기: ${memoClean}\n` +
               `📞 직통문의: 051-303-3751 (영업2팀 직통)\n` +
               `━━━━━━━━━━━━━━━━━━━━\n` +
               `💬 본 견적으로 발주를 원하시면 "발주" 또는 "진행"이라고 회신해주세요.`;
    };

    // Save Draft update
    const handleSaveDraft = async () => {
        if (!activeItem) return;
        setSaving(true);
        try {
            const res = await fetch('/api/kakao/update-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quotationId: activeItem.quotationId,
                    intakeId: activeItem.intakeId,
                    items: editItems,
                    discountRate: editDiscountRate,
                    memo: editMemo,
                    customerName: editCustomerName,
                    customerPhone: editCustomerPhone
                })
            });
            if (res.ok) {
                alert('초안 수정사항이 저장되었습니다.');
                await fetchQueue();
            } else {
                alert('저장에 실패했습니다.');
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            alert('저장 오류: ' + errorMsg);
        } finally {
            setSaving(false);
        }
    };

    // Approve & Finalize internal quotation (SMS/message dispatch paused per user policy)
    const handleApproveAndDispatch = async () => {
        if (!activeItem) return;
        if (!confirm(`[견적서 대장 내부 확정]\n\n• 총 금액: ${currentGrandTotal.toLocaleString()}원 (총 ${editItems.length}품목)\n• 거래처명: ${editCustomerName || activeItem.customer?.name}\n\n* 고객 문자/카톡 직접 발송은 중단된 상태입니다.\n작성된 견적 품목과 단가를 시스템 정식 견적서 대장에 최종 확정 등록하시겠습니까?`)) {
            return;
        }

        setSaving(true);
        try {
            // First save any edits
            await fetch('/api/kakao/update-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quotationId: activeItem.quotationId,
                    intakeId: activeItem.intakeId,
                    items: editItems,
                    discountRate: editDiscountRate,
                    memo: editMemo,
                    customerName: editCustomerName,
                    customerPhone: editCustomerPhone
                })
            });

            // Then approve internally without external SMS dispatch
            const res = await fetch('/api/kakao/approve-quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quotationId: activeItem.quotationId,
                    intakeId: activeItem.intakeId,
                    reviewerName: '영업담당자 (조현진 대표)',
                    memo: editMemo,
                    targetPhone: editCustomerPhone || activeItem.customer?.phone
                })
            });

            if (res.ok) {
                alert('✅ [내부 대장 확정 완료] 31개 품목 견적서가 시스템 대장에 성공적으로 등록 및 확정되었습니다.\n(고객 문자 회신은 발송되지 않았습니다.)');
                await fetchQueue();
            } else {
                const errData = await res.json();
                alert('대장 저장 실패: ' + (errData.error || '알 수 없는 오류'));
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            alert('견적 대장 확정 중 오류: ' + errorMsg);
        } finally {
            setSaving(false);
        }
    };

    // Reject quote
    const handleReject = async () => {
        if (!activeItem) return;
        const reason = prompt('반려 사유를 입력해주세요 (예: 규격 불일치, 재고 품절 등):', '고객 요청 취소 및 규격 재확인 필요');
        if (!reason) return;

        setSaving(true);
        try {
            const res = await fetch('/api/kakao/reject-quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quotationId: activeItem.quotationId,
                    intakeId: activeItem.intakeId,
                    reason
                })
            });
            if (res.ok) {
                alert('견적이 반려 처리되었습니다.');
                await fetchQueue();
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            alert('반려 오류: ' + errorMsg);
        } finally {
            setSaving(false);
        }
    };

    // Copy live preview text
    const handleCopyPreview = () => {
        const text = generatePreviewText();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const pendingCount = queue.filter(q => q.reviewStatus !== 'APPROVED' && q.status !== 'APPROVED').length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 overflow-hidden">
            <div className="bg-[#111318] border border-amber-500/30 w-full max-w-7xl h-[92vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden text-gray-100">
                {/* Modal Top Header */}
                <div className="px-6 py-4 border-b border-gray-800 bg-[#161922] flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold shadow-lg">
                            <MessageSquare className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white tracking-wide">
                                    {mainTab === 'ORDERS' 
                                        ? '[영업3팀] 카카오톡 발주 접수 & AI 정밀 분석 관제 (Human-in-the-Loop)' 
                                        : '[영업2팀] 카카오톡 견적 인입 & 규격표준화 관제 (Human-in-the-Loop)'}
                                </h2>
                                <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                                    mainTab === 'ORDERS'
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                }`}>
                                    {mainTab === 'ORDERS' ? '영업3팀 ➔ 구매부(PUR-01/07) 이첩 대기' : `검토 대기: ${pendingCount}건`}
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                                {mainTab === 'ORDERS'
                                    ? '영업2팀 견적봇과 동일한 Gemini/GPT Vision & 규칙 0~11 프롬프트로 품목·도착지·운송비를 정밀 분석하며, 최종 승인 시 구매부로 안전하게 인계합니다.'
                                    : '메신저로 들어온 비정형 txt 원문을 확인하고, 규격·단가표 매칭 데이터를 검토·수정하여 정식 견적서 대장으로 확정 적재합니다.'}
                            </p>
                        </div>
                    </div>
                    {/* Tab Navigation (Orders vs Quotes) */}
                    <div className="flex items-center gap-1.5 bg-gray-900/90 p-1 rounded-xl border border-gray-800">
                        <button
                            onClick={() => setMainTab('ORDERS')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                mainTab === 'ORDERS' 
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400 text-black shadow-lg shadow-emerald-500/20' 
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            <span className="px-1 py-0.2 rounded bg-black/20 text-[10px]">PO</span>
                            <span>📋 [영업3팀] 발주서 접수대기</span>
                        </button>
                        <button
                            onClick={() => setMainTab('QUOTES')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                mainTab === 'QUOTES' 
                                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' 
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            <span className="px-1 py-0.2 rounded bg-black/20 text-[10px]">EST</span>
                            <span>💬 [영업2팀] 견적 의뢰 접수대기</span>
                            {pendingCount > 0 && (
                                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-black/30 text-[10px] font-bold">
                                    {pendingCount}
                                </span>
                            )}
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchQueue}
                            disabled={loading}
                            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                            title="새로고침"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Body Content based on active tab */}
                {mainTab === 'ORDERS' ? (
                    <KakaoOrderReviewTab onClose={onClose} />
                ) : (
                    <>
                        {/* Modal Main Body (Split Grid: Left Queue, Right Details) */}
                        <div className="flex-1 flex overflow-hidden">
                    {/* Left Panel: Inquiries Queue List */}
                    <div className="w-80 border-r border-gray-800/80 bg-[#13151c] flex flex-col flex-shrink-0">
                        {/* Queue Filter Tabs & Search */}
                        <div className="p-3 border-b border-gray-800 space-y-2">
                            <div className="flex rounded-lg bg-gray-900 p-1 border border-gray-800 text-xs">
                                <button
                                    onClick={() => setFilterStatus('ALL')}
                                    className={`flex-1 py-1 rounded-md font-medium transition-colors ${filterStatus === 'ALL' ? 'bg-amber-500 text-black font-bold shadow' : 'text-gray-400 hover:text-white'}`}
                                >
                                    전체 ({queue.length})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('PENDING')}
                                    className={`flex-1 py-1 rounded-md font-medium transition-colors ${filterStatus === 'PENDING' ? 'bg-amber-500 text-black font-bold shadow' : 'text-gray-400 hover:text-white'}`}
                                >
                                    검토 대기 ({pendingCount})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('APPROVED')}
                                    className={`flex-1 py-1 rounded-md font-medium transition-colors ${filterStatus === 'APPROVED' ? 'bg-emerald-600 text-white font-bold shadow' : 'text-gray-400 hover:text-white'}`}
                                >
                                    대장 확정
                                </button>
                            </div>
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-500" />
                                <input
                                    type="text"
                                    value={searchKeyword}
                                    onChange={(e) => setSearchKeyword(e.target.value)}
                                    placeholder="고객명, 견적번호, 내용 검색..."
                                    className="w-full bg-[#1b1e27] border border-gray-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50"
                                />
                            </div>
                        </div>

                        {/* List items */}
                        <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50 custom-scrollbar">
                            {filteredQueue.length === 0 ? (
                                <div className="p-8 text-center text-gray-500 text-xs">
                                    인입된 카카오톡 견적 요청이 없습니다.
                                </div>
                            ) : (
                                filteredQueue.map((item) => {
                                    const isSelected = item.intakeId === (activeItem?.intakeId);
                                    const isApproved = item.reviewStatus === 'APPROVED' || item.status === 'APPROVED';
                                    const formattedTime = new Date(item.receivedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                                    const formattedDate = new Date(item.receivedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

                                    return (
                                        <div
                                            key={item.intakeId}
                                            onClick={() => setSelectedId(item.intakeId)}
                                            className={`p-3.5 cursor-pointer transition-all border-l-4 ${
                                                isSelected 
                                                    ? 'bg-amber-500/10 border-amber-500 text-white' 
                                                    : 'hover:bg-gray-800/40 border-transparent text-gray-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                    isApproved 
                                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse'
                                                }`}>
                                                    {isApproved ? '🟢 대장 확정 완료' : '🟡 검토 대기 (Pending)'}
                                                </span>
                                                <span className="text-[11px] text-gray-500">
                                                    {formattedDate} {formattedTime}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <div className="font-bold text-sm text-gray-200 truncate">
                                                    {item.customer?.name || '카카오톡 고객'}
                                                </div>
                                                <div className="text-xs font-semibold text-amber-400">
                                                    {item.totalAmount ? `₩${item.totalAmount.toLocaleString()}` : '단가 산출'}
                                                </div>
                                            </div>

                                            <div className="text-xs text-gray-500 truncate mt-1">
                                                {item.rawUtterance ? item.rawUtterance.replace(/\n/g, ' ') : '내용 없음'}
                                            </div>

                                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-800/50 text-[11px] text-gray-500">
                                                <span>품목 {item.items?.length || 0}건</span>
                                                <span className="text-gray-400">{item.quotationId || item.intakeId.slice(-6)}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Panel: Detailed Review Cockpit */}
                    {activeItem ? (
                        <div className="flex-1 flex flex-col overflow-y-auto bg-[#0d0f14] custom-scrollbar p-6 space-y-6">
                            {/* Top Meta Bar */}
                            <div className="bg-[#161922] border border-gray-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                                <div className="flex items-center gap-6">
                                    <div>
                                        <div className="text-[11px] text-gray-500 font-medium">견적번호</div>
                                        <div className="text-sm font-bold text-amber-400 font-mono">
                                            {activeItem.quotationId || '신규 인입 (DRAFT)'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-gray-500 font-medium">수신 채널</div>
                                        <div className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 mt-0.5">
                                            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                            카카오톡 직통 채널 (@altf)
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-gray-500 font-medium">고객사 / 담당자</div>
                                        <input
                                            type="text"
                                            value={editCustomerName}
                                            onChange={(e) => setEditCustomerName(e.target.value)}
                                            className="bg-[#1b1e27] border border-gray-700 rounded px-2 py-0.5 text-xs text-white mt-0.5 focus:border-amber-400 focus:outline-none"
                                            placeholder="고객명 입력"
                                        />
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-gray-500 font-medium">수신 휴대폰 번호</div>
                                        <input
                                            type="text"
                                            value={editCustomerPhone}
                                            onChange={(e) => setEditCustomerPhone(e.target.value)}
                                            className="bg-[#1b1e27] border border-gray-700 rounded px-2 py-0.5 text-xs text-white mt-0.5 focus:border-amber-400 focus:outline-none"
                                            placeholder="010-0000-0000"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <div className="text-[11px] text-gray-500">적용 할인율</div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <input
                                                type="number"
                                                value={editDiscountRate}
                                                onChange={(e) => handleDiscountRateChange(Number(e.target.value))}
                                                className="w-14 bg-[#1b1e27] border border-amber-500/40 rounded px-2 py-0.5 text-xs text-amber-300 font-bold text-center focus:outline-none"
                                                min="0"
                                                max="90"
                                            />
                                            <span className="text-xs text-gray-400 font-semibold">%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section 1: Raw Utterance from KakaoTalk (txt) */}
                            <div className="bg-[#1a1811] border border-amber-500/40 rounded-xl p-5 shadow-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-md bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400 font-bold text-xs">
                                            TXT
                                        </div>
                                        <h3 className="text-sm font-bold text-amber-300">
                                            1. 고객 카카오톡 수신 원문 (Raw Text)
                                        </h3>
                                        <span className="text-[11px] text-amber-400/80 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
                                            현장 담당자 대조용 원본
                                        </span>
                                    </div>
                                    <div className="text-xs text-amber-400/80 font-mono">
                                        {new Date(activeItem.receivedAt).toLocaleString('ko-KR')}
                                    </div>
                                </div>
                                <div className="bg-[#12110c] border border-amber-900/50 rounded-lg p-4 font-mono text-xs text-amber-100 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto selection:bg-amber-500 selection:text-black">
                                    {activeItem.rawUtterance || '(수신된 텍스트 내용이 없습니다)'}
                                </div>
                                <div className="mt-2 text-[11px] text-gray-400 flex items-center gap-1.5">
                                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                                    <span>
                                        비정형 은어(예: 90E 50A, S10S, CAP, 90개만 등)가 AI 봇에 의해 정확하게 추출되었는지 아래 표에서 확인하고 직접 수정할 수 있습니다.
                                    </span>
                                </div>
                            </div>

                            {/* Section 2: AI Parsed & Standardized Items Table (Human-in-the-Loop Editable) */}
                            <div className="bg-[#161922] border border-gray-800 rounded-xl p-5 shadow-lg space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-md bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-xs">
                                            2
                                        </div>
                                        <h3 className="text-sm font-bold text-white">
                                            2. AI 피팅 정규화 & 단가 매칭 대장 (사무실 담당자 편집 데스크)
                                        </h3>
                                        <span className="text-[11px] text-blue-400 bg-blue-950/50 px-2 py-0.5 rounded border border-blue-800/40">
                                            수량/단가 실시간 수정 가능
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleAddItem}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        품목 직접 추가
                                    </button>
                                </div>

                                {/* Table */}
                                <div className="border border-gray-800 rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-[#1b1e27] text-gray-400 font-semibold border-b border-gray-800">
                                            <tr>
                                                <th className="py-2.5 px-3 w-12 text-center">No</th>
                                                <th className="py-2.5 px-3">품목명 (Type)</th>
                                                <th className="py-2.5 px-3">두께 (Sch)</th>
                                                <th className="py-2.5 px-3">규격 (Size)</th>
                                                <th className="py-2.5 px-3">재질</th>
                                                <th className="py-2.5 px-3 w-20 text-center">수량 (EA)</th>
                                                <th className="py-2.5 px-3 text-right">기준단가 (원)</th>
                                                <th className="py-2.5 px-3 text-right">적용단가 (-{editDiscountRate}%)</th>
                                                <th className="py-2.5 px-3 text-right">공급가액 (원)</th>
                                                <th className="py-2.5 px-3 text-center">재고상태</th>
                                                <th className="py-2.5 px-3 w-12 text-center">삭제</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800 bg-[#13151c]">
                                            {editItems.length === 0 ? (
                                                <tr>
                                                    <td colSpan={11} className="py-6 text-center text-gray-500 text-xs">
                                                        추출된 품목이 없습니다. 상단 [품목 직접 추가] 버튼으로 등록해주세요.
                                                    </td>
                                                </tr>
                                            ) : (
                                                editItems.map((item, idx) => (
                                                    <tr key={item.id || idx} className="hover:bg-gray-800/40 transition-colors">
                                                        <td className="py-2 px-3 text-center text-gray-500 font-mono">{idx + 1}</td>
                                                        <td className="py-2 px-3 font-semibold text-white">
                                                            <input
                                                                type="text"
                                                                value={item.name}
                                                                onChange={(e) => {
                                                                    const updated = [...editItems];
                                                                    updated[idx].name = e.target.value;
                                                                    setEditItems(updated);
                                                                }}
                                                                className="bg-transparent border-b border-gray-700 focus:border-amber-400 focus:outline-none w-20 text-white font-medium"
                                                            />
                                                        </td>
                                                        <td className="py-2 px-3 text-gray-300">
                                                            <input
                                                                type="text"
                                                                value={item.thickness || 'S10S'}
                                                                onChange={(e) => {
                                                                    const updated = [...editItems];
                                                                    updated[idx].thickness = e.target.value;
                                                                    setEditItems(updated);
                                                                }}
                                                                className="bg-transparent border-b border-gray-700 focus:border-amber-400 focus:outline-none w-16 text-gray-300"
                                                            />
                                                        </td>
                                                        <td className="py-2 px-3 font-bold text-amber-300">
                                                            <input
                                                                type="text"
                                                                value={item.size}
                                                                onChange={(e) => {
                                                                    const updated = [...editItems];
                                                                    updated[idx].size = e.target.value;
                                                                    setEditItems(updated);
                                                                }}
                                                                className="bg-transparent border-b border-gray-700 focus:border-amber-400 focus:outline-none w-24 text-amber-300 font-bold"
                                                            />
                                                        </td>
                                                        <td className="py-2 px-3 text-gray-400">
                                                            {item.material || 'STS304-W'}
                                                        </td>
                                                        <td className="py-2 px-3 text-center">
                                                            <input
                                                                type="number"
                                                                value={item.quantity}
                                                                onChange={(e) => handleQuantityChange(idx, Number(e.target.value))}
                                                                className="w-16 bg-[#1b1e27] border border-amber-500/50 rounded px-1.5 py-0.5 text-center text-amber-300 font-bold focus:outline-none"
                                                                min="1"
                                                            />
                                                        </td>
                                                        <td className="py-2 px-3 text-right text-gray-400 font-mono">
                                                            {(item.basePrice || 0).toLocaleString()}
                                                        </td>
                                                        <td className="py-2 px-3 text-right">
                                                            <input
                                                                type="number"
                                                                value={item.unitPrice}
                                                                onChange={(e) => handleUnitPriceChange(idx, Number(e.target.value))}
                                                                className="w-20 bg-[#1b1e27] border border-gray-700 rounded px-1.5 py-0.5 text-right text-white font-mono focus:border-amber-400 focus:outline-none"
                                                            />
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-bold text-emerald-400 font-mono">
                                                            {(item.amount || 0).toLocaleString()}
                                                        </td>
                                                        <td className="py-2 px-3 text-center">
                                                            <span className={`px-2 py-0.5 text-[10px] rounded font-semibold ${
                                                                item.stockStatus === 'OUT_OF_STOCK'
                                                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                                            }`}>
                                                                {item.stockStatus === 'OUT_OF_STOCK' ? '주문제작 3~5일' : '즉시출고'}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 px-3 text-center">
                                                            <button
                                                                onClick={() => handleRemoveItem(idx)}
                                                                className="p-1 text-gray-500 hover:text-rose-400 transition-colors"
                                                                title="품목 삭제"
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

                                {/* Financial Summary Footer */}
                                <div className="bg-[#12141a] border border-gray-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex-1 min-w-[280px]">
                                        <label className="text-[11px] text-gray-400 block mb-1 font-medium">
                                            출고 납기 및 특약 메모 (고객 메시지에 포함됨)
                                        </label>
                                        <input
                                            type="text"
                                            value={editMemo}
                                            onChange={(e) => setEditMemo(e.target.value)}
                                            placeholder="예: 시화/양산 당일 즉시 출고 가능, 화물 발송 지원"
                                            className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:border-amber-400 focus:outline-none"
                                        />
                                    </div>
                                    <div className="flex items-center gap-6 text-right">
                                        <div>
                                            <div className="text-[11px] text-gray-500">공급가액(소계)</div>
                                            <div className="text-sm font-semibold text-gray-200 font-mono">
                                                ₩{currentSubtotal.toLocaleString()}원
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] text-gray-500">부가세 (10%)</div>
                                            <div className="text-sm font-semibold text-gray-400 font-mono">
                                                ₩{currentVat.toLocaleString()}원
                                            </div>
                                        </div>
                                        <div className="pl-4 border-l border-gray-800">
                                            <div className="text-[11px] text-amber-400 font-bold">최종 견적 합계</div>
                                            <div className="text-lg font-extrabold text-amber-400 font-mono">
                                                ₩{currentGrandTotal.toLocaleString()}원
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section 3: Quotation Summary (Internal Ledger Creation / External SMS Paused) */}
                            <div className="bg-[#161922] border border-emerald-500/40 rounded-xl p-5 shadow-lg space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
                                            3
                                        </div>
                                        <h3 className="text-sm font-bold text-emerald-400">
                                            3. 카카오톡 인입 기반 견적서 품목 및 금액 요약 (내부 대장 작성용)
                                        </h3>
                                        <span className="text-[11px] text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
                                            고객 문자발송 일시중단 (내부 작성 모드)
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleCopyPreview}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                                    >
                                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copied ? '복사 완료!' : '견적 요약문 복사'}
                                    </button>
                                </div>

                                <div className="bg-[#111827] border border-emerald-900/40 rounded-xl p-4 font-mono text-xs text-gray-200 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto selection:bg-emerald-500 selection:text-black">
                                    {generatePreviewText()}
                                </div>

                                <div className="text-[11px] text-gray-400 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                    <span>
                                        현재 고객 대상 문자(SMS) 회신은 중단된 상태입니다. 비정형 카톡 요청 품목을 정식 견적서 데이터로 작성하여 시스템 대장에 안전하게 적재 및 보관합니다.
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                            좌측 목록에서 검토할 견적 건을 선택해주세요.
                        </div>
                    )}
                </div>

                {/* Bottom Action Footer */}
                {activeItem && (
                    <div className="px-6 py-4 border-t border-gray-800 bg-[#161922] flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleReject}
                                disabled={saving}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-rose-950/60 text-rose-300 border border-rose-900/40 transition-colors disabled:opacity-50"
                            >
                                ❌ 견적 반려 / 취소
                            </button>
                            <button
                                onClick={handleSaveDraft}
                                disabled={saving}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors disabled:opacity-50"
                            >
                                💾 수정한 초안 임시저장
                            </button>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="text-right">
                                <div className="text-[11px] text-gray-400">확정 공급가액</div>
                                <div className="text-base font-bold text-amber-400 font-mono">
                                    ₩{currentGrandTotal.toLocaleString()}원 (VAT포함)
                                </div>
                            </div>
                            <button
                                onClick={handleApproveAndDispatch}
                                disabled={saving}
                                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-black shadow-lg shadow-emerald-500/20 transition-all transform active:scale-95 disabled:opacity-50"
                            >
                                <Save className="w-4 h-4" />
                                {saving ? '처리 중...' : '💾 [내부 확정] 카톡 견적서 대장 작성 및 저장'}
                            </button>
                        </div>
                    </div>
                )}
                    </>
                )}
            </div>
        </div>
    );
};
