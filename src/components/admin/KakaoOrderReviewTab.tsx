import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    ExternalLink,
    Sparkles,
    BookOpen,
    Tag,
    X,
    ChevronLeft,
    ChevronRight,
    ArrowRight,
    Layers,
    CheckCircle2
} from 'lucide-react';

export interface CorrectionDiff {
    field: string;
    from: string | number;
    to: string | number;
}

export interface CorrectionItemChange {
    itemIndex: number;
    itemName: string;
    fieldDiffs: CorrectionDiff[];
    ruleInferred?: string;
}

export interface CorrectionRecord {
    id: string;
    orderId: string;
    orderNo?: string;
    timestamp: string;
    modifiedBy?: string;
    customerName?: string;
    channelTag?: string;
    itemChangesCount: number;
    conditionChangesCount: number;
    itemChanges?: CorrectionItemChange[];
    conditionChanges?: CorrectionDiff[];
}

export interface CorrectionSummaryReport {
    success?: boolean;
    totalCorrections: number;
    materialCorrectionsCount: number;
    thicknessCorrectionsCount: number;
    sizeCorrectionsCount: number;
    recentCorrections: CorrectionRecord[];
}

export interface KakaoOrderProductItem {
    id?: string;
    name: string;
    spec?: string;
    size?: string;
    thickness?: string;
    material?: string;
    quantity: number;
    unitPrice: number;
    amount: number;
}

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
    remarks?: string;
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
    assignedTeam?: string;
    assignedAgents: string[];
    utterance: string;
    imageUrl?: string | null;
    images?: string[];
    items: KakaoOrderProductItem[];
    itemCount: number;
    totalAmount: number;
    relatedQuotationId?: string | null;
    convertedOrderId?: string;
    approvedBy?: string;
    approvedAt?: string;
    rejectReason?: string;
}

export interface CustomerLearnedRule {
    customerName?: string;
    destination?: string;
    freightTerms?: string;
    recipient?: string;
    phone?: string;
    ruleNotes?: string;
    updatedAt?: string;
    sampleCount?: number;
}

export interface LearnedRulesData {
    customers: Record<string, CustomerLearnedRule>;
    itemPatterns?: Record<string, unknown>;
    lastUpdated?: string;
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
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
    const [analyzing, setAnalyzing] = useState<boolean>(false);
    const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
    const [correctionModalTab, setCorrectionModalTab] = useState<'RULES' | 'DIFFS'>('RULES');
    const [correctionReport, setCorrectionReport] = useState<CorrectionSummaryReport | null>(null);
    const [learnedRules, setLearnedRules] = useState<LearnedRulesData | null>(null);

    // Selected order editing state (Directly editable by staff)
    const [editCustomer, setEditCustomer] = useState<string>('');
    const [editDestination, setEditDestination] = useState<string>('');
    const [editFreight, setEditFreight] = useState<string>('');
    const [editRecipient, setEditRecipient] = useState<string>('');
    const [editPhone, setEditPhone] = useState<string>('');
    const [editRemarks, setEditRemarks] = useState<string>('');
    const [editAssignedTeam, setEditAssignedTeam] = useState<string>('');
    const [editItems, setEditItems] = useState<KakaoOrderProductItem[]>([]);

    const showToast = useCallback((msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 3200);
    }, []);

    const fetchLearnedRules = useCallback(async () => {
        try {
            const res = await fetch('/api/kakao/orders/learned-rules');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.rules) {
                    setLearnedRules(data.rules);
                }
            }
        } catch (err) {
            console.warn('[KakaoOrderReviewTab] 학습 규칙 조회 실패:', err);
        }
    }, []);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/kakao/orders');
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.orders)) {
                    setOrders(data.orders);
                    if (data.orders.length > 0) {
                        setSelectedOrderId(prev => prev || data.orders[0].id);
                    }
                }
            }
        } catch (err) {
            console.error('카톡 발주서 목록 조회 실패:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
        fetchLearnedRules();
    }, [fetchOrders, fetchLearnedRules]);

    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
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
    }, [orders, filterStatus, searchKeyword]);

    const activeOrder = useMemo(() => {
        return filteredOrders.find(o => o.id === selectedOrderId) || filteredOrders[0] || orders.find(o => o.id === selectedOrderId) || orders[0] || null;
    }, [filteredOrders, orders, selectedOrderId]);

    // Synchronize form fields whenever activeOrder changes
    useEffect(() => {
        if (activeOrder) {
            const cust = activeOrder.customerName || '';
            const learned = learnedRules?.customers?.[cust];

            setEditCustomer(cust);
            setEditDestination(activeOrder.destination || learned?.destination || '');
            setEditFreight(activeOrder.freightTerms || learned?.freightTerms || '');
            setEditRecipient(activeOrder.recipient || learned?.recipient || '');
            setEditPhone(activeOrder.phone || learned?.phone || '');
            setEditRemarks(activeOrder.remarks || '');
            setEditAssignedTeam(activeOrder.assignedTeam || '영업3팀');
            setEditItems(JSON.parse(JSON.stringify(activeOrder.items || [])));
            setCurrentImageIndex(0);
        }
    }, [activeOrder, learnedRules]);

    // Pager Calculation for easy order switching
    const currentOrderIndex = useMemo(() => {
        if (!activeOrder) return -1;
        return filteredOrders.findIndex(o => o.id === activeOrder.id);
    }, [filteredOrders, activeOrder]);

    const totalOrdersCount = filteredOrders.length;

    const handlePrevOrder = useCallback(() => {
        if (currentOrderIndex > 0) {
            setSelectedOrderId(filteredOrders[currentOrderIndex - 1].id);
        }
    }, [currentOrderIndex, filteredOrders]);

    const handleNextOrder = useCallback(() => {
        if (currentOrderIndex < filteredOrders.length - 1) {
            setSelectedOrderId(filteredOrders[currentOrderIndex + 1].id);
        }
    }, [currentOrderIndex, filteredOrders]);

    // Keyboard shortcut for flipping orders (Alt + Left/Right arrow)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = (document.activeElement?.tagName || '').toLowerCase();
            const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                handlePrevOrder();
            } else if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                handleNextOrder();
            } else if (!isTyping) {
                if (e.key === 'ArrowLeft') {
                    handlePrevOrder();
                } else if (e.key === 'ArrowRight') {
                    handleNextOrder();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlePrevOrder, handleNextOrder]);

    // Check if required fields are present
    const isDestinationEmpty = !editDestination.trim();
    const isFreightEmpty = !editFreight.trim();
    const canApprove = !isDestinationEmpty && !isFreightEmpty && activeOrder?.status !== 'APPROVED';

    // 🚚 Destination suggestions dynamically derived from remarks, utterance, and learned rules
    const destinationSuggestions = useMemo(() => {
        if (!activeOrder) return [];
        const list: string[] = [];
        const remarks = editRemarks || activeOrder.remarks || '';
        const utter = activeOrder.utterance || '';
        const combined = `${remarks} ${utter}`;

        // 1. Learned rule for this customer
        const learned = learnedRules?.customers?.[activeOrder.customerName];
        if (learned?.destination && !list.includes(learned.destination)) {
            list.push(learned.destination);
        }

        // 2. Extracted from remarks (e.g., 금성밴드 본사, 경동/대신 화물 지점)
        if (/금성밴드/i.test(combined)) {
            list.push('금성밴드 본사 (화물 지점: 경동 구로608A / 대신 신도림지점)');
            list.push('금성밴드 본사 납품');
        }
        if (/경동/i.test(combined)) {
            const m = combined.match(/경동[:\s]*([^\s,;]+)/);
            if (m) list.push(`경동화물 (${m[1]} 지점)`);
        }
        if (/대신/i.test(combined)) {
            const m = combined.match(/대신[:\s]*([^\s,;]+)/);
            if (m) list.push(`대신화물 (${m[1]} 지점)`);
        }
        if (!list.includes('본사 직송')) list.push('본사 직송');
        if (!list.includes('시화공단 물류센터')) list.push('시화공단 물류센터');

        return Array.from(new Set(list));
    }, [activeOrder, learnedRules, editRemarks]);

    const FREIGHT_CHIPS = [
        { label: '선불 화물 발송', hint: '당사 선불' },
        { label: '착불화물', hint: '고객 착불' },
        { label: '현불화물 후 화물비청구', hint: '현불 후 청구' },
        { label: '본사 직송 (무운임)', hint: '직송' },
        { label: '용차(독차)', hint: '용차' },
        { label: '시화창고 방문수령', hint: '방문수령' }
    ];

    // Image list for activeOrder
    const orderImages = useMemo(() => {
        if (!activeOrder) return [];
        if (Array.isArray(activeOrder.images) && activeOrder.images.length > 0) {
            return activeOrder.images;
        }
        if (activeOrder.imageUrl) {
            return [activeOrder.imageUrl];
        }
        return [];
    }, [activeOrder]);

    // Item handlers
    const handleItemChange = (index: number, field: keyof KakaoOrderProductItem, value: string | number) => {
        const updated = [...editItems];
        updated[index] = {
            ...updated[index],
            [field]: value
        };
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
                quantity: 1,
                unitPrice: 0,
                amount: 0
            }
        ]);
    };

    const handleRemoveItem = (index: number) => {
        setEditItems(editItems.filter((_, i) => i !== index));
    };

    // Save changes immediately and reflect on the screen
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
                    remarks: editRemarks,
                    assignedTeam: editAssignedTeam,
                    items: editItems
                })
            });
            if (res.ok) {
                showToast('✅ 수정사항이 즉시 저장되어 화면에 반영되었습니다!');
                await fetchOrders();
            } else {
                const data = await res.json();
                showToast('❌ 저장 실패: ' + (data.error || '오류 발생'));
            }
        } catch (e) {
            showToast('❌ 저장 오류: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setSaving(false);
        }
    };

    // 🧠 SLE-15 발주서 수정관찰 누적 학습 리포트 조회
    const fetchCorrectionReport = async () => {
        try {
            const res = await fetch('/api/kakao/orders/corrections');
            if (res.ok) {
                const data = await res.json();
                setCorrectionReport(data);
                setShowCorrectionModal(true);
            }
        } catch (e) {
            showToast('수정 리포트 조회 실패: ' + (e instanceof Error ? e.message : String(e)));
        }
    };

    // Approve order into official db.orders
    const handleApproveOrder = async () => {
        if (!activeOrder) return;
        if (isDestinationEmpty || isFreightEmpty) {
            showToast('🚨 도착지 정보와 운송비 조건이 필수 입력되어야 승인 가능합니다.');
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
                    remarks: editRemarks,
                    assignedTeam: editAssignedTeam,
                    items: editItems
                })
            });

            // Then approve
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approvedBy: '사무실 관리자' })
            });

            if (res.ok) {
                const data = await res.json();
                const poNo = data.order?.orderNo || data.order?.poNumber || '순차 번호 발급';
                showToast(`🎉 정식 발주 승인 완료! 발주번호: ${poNo}`);
                await fetchOrders();
            } else {
                const data = await res.json();
                showToast('승인 실패: ' + (data.error || '오류 발생'));
            }
        } catch (e) {
            showToast('승인 오류: ' + (e instanceof Error ? e.message : String(e)));
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
                showToast('발주서가 반려 처리되었습니다.');
                await fetchOrders();
            }
        } catch (e) {
            showToast('반려 오류: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setSaving(false);
        }
    };

    // Permanent deletion from dashboard and altf.kr
    const handleDeleteOrder = async () => {
        if (!activeOrder) return;
        if (!confirm(`[카카오톡 발주서 영구 삭제]\n\n• 발송업체: ${activeOrder.customerName}\n\n정말로 이 발주서를 영구 삭제하시겠습니까?`)) {
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast('🗑️ 발주서가 영구 삭제되었습니다.');
                setSelectedOrderId(null);
                await fetchOrders();
            } else {
                showToast('삭제 실패');
            }
        } catch (e) {
            showToast('삭제 오류: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setSaving(false);
        }
    };

    // 🤖 영업3팀 AI 정밀 분석
    const handleAiAnalyze = async () => {
        if (!activeOrder) return;
        setAnalyzing(true);
        try {
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl: activeOrder.imageUrl,
                    utterance: activeOrder.utterance,
                    customerName: editCustomer
                })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success && data.result) {
                    if (data.result.customerName && (!editCustomer || editCustomer === '카카오톡 고객사')) {
                        setEditCustomer(data.result.customerName);
                    }
                    if (data.result.destination && !editDestination) {
                        setEditDestination(data.result.destination);
                    }
                    if (data.result.freightTerms && !editFreight) {
                        setEditFreight(data.result.freightTerms);
                    }
                    if (Array.isArray(data.result.items) && data.result.items.length > 0) {
                        setEditItems(data.result.items);
                    }
                    showToast(`🤖 AI 분석 완료: ${data.result.items?.length || 0}개 품목이 자동 보정되었습니다.`);
                }
            } else {
                showToast('AI 분석 실패');
            }
        } catch (e) {
            showToast('AI 분석 오류: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setAnalyzing(false);
        }
    };

    const pendingCount = orders.filter(o => o.status !== 'APPROVED').length;
    const currentTotal = editItems.reduce((s, it) => s + (it.amount || ((it.unitPrice || 0) * (it.quantity || 1))), 0);

    return (
        <div className="flex-1 flex overflow-hidden relative font-pretendard">
            {/* Top Floating Toast Notification */}
            {toastMessage && (
                <div className="fixed top-4 right-8 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#1b2333] border border-emerald-500/80 text-white text-xs font-bold shadow-2xl animate-in fade-in slide-in-from-top-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>{toastMessage}</span>
                </div>
            )}

            {/* Left Orders Queue Sidebar */}
            <div className="w-72 border-r border-gray-800/80 bg-[#12141c] flex flex-col flex-shrink-0">
                {/* Search & Filter Header */}
                <div className="p-3 border-b border-gray-800 space-y-2">
                    <div className="flex rounded-lg bg-gray-900/90 p-1 border border-gray-800 text-[11px]">
                        <button
                            onClick={() => setFilterStatus('ALL')}
                            className={`flex-1 py-1 rounded font-bold transition-all ${filterStatus === 'ALL' ? 'bg-emerald-500 text-black shadow' : 'text-gray-400 hover:text-white'}`}
                        >
                            전체 ({orders.length})
                        </button>
                        <button
                            onClick={() => setFilterStatus('PENDING')}
                            className={`flex-1 py-1 rounded font-bold transition-all ${filterStatus === 'PENDING' ? 'bg-amber-500 text-black shadow' : 'text-gray-400 hover:text-white'}`}
                        >
                            대기 ({pendingCount})
                        </button>
                        <button
                            onClick={() => setFilterStatus('APPROVED')}
                            className={`flex-1 py-1 rounded font-bold transition-all ${filterStatus === 'APPROVED' ? 'bg-cyan-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                        >
                            승인됨
                        </button>
                    </div>

                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-500" />
                        <input
                            type="text"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            placeholder="업체, 도착지, 발주번호 검색..."
                            className="w-full bg-[#181b24] border border-gray-700/80 rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/60"
                        />
                    </div>
                </div>

                {/* Orders List */}
                <div className="flex-1 overflow-y-auto divide-y divide-gray-800/40 custom-scrollbar">
                    {filteredOrders.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 text-xs">
                            해당하는 카카오톡 발주서가 없습니다.
                        </div>
                    ) : (
                        filteredOrders.map((item, idx) => {
                            const isSelected = item.id === (activeOrder?.id);
                            const isApproved = item.status === 'APPROVED';
                            const isIncomplete = item.validationStatus === 'INCOMPLETE';
                            const formattedTime = new Date(item.receivedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                            const formattedDate = new Date(item.receivedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

                            return (
                                <div
                                    key={item.id}
                                    onClick={() => setSelectedOrderId(item.id)}
                                    className={`p-3 cursor-pointer transition-all border-l-4 ${
                                        isSelected 
                                            ? 'bg-emerald-500/10 border-emerald-500 text-white' 
                                            : 'hover:bg-gray-800/40 border-transparent text-gray-400'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-mono text-gray-500">#{idx + 1}</span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                                                isApproved 
                                                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' 
                                                    : isIncomplete
                                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                            }`}>
                                                {isApproved ? '승인완료' : isIncomplete ? '보완 필요' : '승인 대기'}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-gray-500">
                                            {formattedDate} {formattedTime}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="font-bold text-xs text-gray-200 truncate">
                                            {item.customerName || '발송업체 미기재'}
                                        </div>
                                        <div className="text-[11px] font-semibold text-emerald-400">
                                            {item.items?.length ? `${item.items.length}품목` : `${item.itemCount || 0}품목`}
                                        </div>
                                    </div>

                                    <div className="text-[11px] text-gray-400 truncate mt-0.5 flex items-center gap-1">
                                        <MapPin className="w-3 h-3 text-gray-500 flex-shrink-0" />
                                        <span className="truncate">{item.destination || '도착지 미기재'}</span>
                                    </div>

                                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-800/40 text-[10px] text-gray-500">
                                        <span className="text-gray-400">
                                            {item.type === 'image_and_text' ? '📷 사진+텍스트' : item.type === 'image' ? '📷 사진' : '💬 텍스트'}
                                        </span>
                                        {item.orderNo ? (
                                            <span className="font-mono text-cyan-400 font-bold">{item.orderNo}</span>
                                        ) : (
                                            <span className="text-amber-400/80">대기 번호 미부여</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right Main Workstation Pane */}
            {activeOrder ? (
                <div className="flex-1 flex flex-col bg-[#0b0d13] overflow-hidden">
                    {/* 1. Fast Pager & Carousel Bar (여러 건 쉽게 넘겨보기) */}
                    <div className="h-10 px-5 bg-[#141722] border-b border-gray-800 flex items-center justify-between flex-shrink-0 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-medium flex items-center gap-1">
                                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                                <span>발주서 넘겨보기:</span>
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handlePrevOrder}
                                    disabled={currentOrderIndex <= 0}
                                    className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-0.5 border border-gray-700"
                                    title="이전 발주서 (Alt + ←)"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                    <span>이전</span>
                                </button>
                                <span className="px-2 py-0.5 rounded bg-gray-900 font-mono font-bold text-amber-300 border border-gray-800">
                                    {currentOrderIndex >= 0 ? currentOrderIndex + 1 : 0} / {totalOrdersCount}
                                </span>
                                <button
                                    onClick={handleNextOrder}
                                    disabled={currentOrderIndex >= totalOrdersCount - 1}
                                    className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-0.5 border border-gray-700"
                                    title="다음 발주서 (Alt + →)"
                                >
                                    <span>다음</span>
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Quick Jump Number Pills (3개, 4개 이상일 때 즉시 넘기기) */}
                            {totalOrdersCount > 1 && (
                                <div className="hidden sm:flex items-center gap-1 ml-2">
                                    {filteredOrders.map((ord, idx) => {
                                        const isActive = ord.id === activeOrder.id;
                                        return (
                                            <button
                                                key={ord.id}
                                                onClick={() => setSelectedOrderId(ord.id)}
                                                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all border ${
                                                    isActive
                                                        ? 'bg-emerald-500 text-black border-emerald-400 shadow-sm'
                                                        : 'bg-gray-800/80 hover:bg-gray-700 text-gray-300 border-gray-700'
                                                }`}
                                                title={`#${idx + 1}: ${ord.customerName || '고객사'} (${ord.items?.length || 0}품목)`}
                                            >
                                                #{idx + 1} {ord.customerName ? ord.customerName.slice(0, 4) : ''}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="text-[11px] text-gray-400 hidden lg:block">
                            키보드 <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono text-[10px] text-gray-300">Alt + ← / →</kbd> 로 신속하게 넘겨볼 수 있습니다
                        </div>
                    </div>

                    {/* 2. Top Header (중복 칸 문제 해소 & 직관적 정돈) */}
                    <div className="px-6 py-3 border-b border-gray-800 bg-[#161924] flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
                        {/* Left Title & Status */}
                        <div className="flex items-center gap-3 flex-wrap">
                            <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-400 text-black flex items-center gap-1 shadow-sm">
                                <Tag className="w-3 h-3" />
                                카톡 접수
                            </span>

                            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                                <span>{activeOrder.customerName || '고객사 미기재'}</span>
                                {activeOrder.orderNo ? (
                                    <span className="text-cyan-400 font-mono text-xs px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60">
                                        {activeOrder.orderNo}
                                    </span>
                                ) : (
                                    <span className="text-amber-300 font-sans text-xs px-2 py-0.5 rounded bg-amber-950/60 border border-amber-600/50 font-bold">
                                        접수대기 (승인 시 순차번호 발급)
                                    </span>
                                )}
                            </h3>

                            <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                                activeOrder.status === 'APPROVED'
                                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                    : (isDestinationEmpty || isFreightEmpty)
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            }`}>
                                {activeOrder.status === 'APPROVED' ? '🎉 정식 승인 완료' : (isDestinationEmpty || isFreightEmpty) ? '⚠️ 필수정보 보완 필요' : '✅ 승인 준비 완료'}
                            </span>

                            <span className="text-xs text-gray-400 font-mono">
                                접수: {new Date(activeOrder.receivedAt).toLocaleString('ko-KR')}
                            </span>
                        </div>

                        {/* Right Quick Action Buttons */}
                        <div className="flex items-center gap-2">
                            {/* Instant Apply Button */}
                            <button
                                onClick={handleSaveOrder}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                                title="수정한 발주서 내용을 즉시 저장 및 화면에 반영합니다"
                            >
                                <Save className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
                                <span>{saving ? '저장 중...' : '⚡ 수정사항 즉시 적용'}</span>
                            </button>

                            {/* AI Vision OCR Button */}
                            <button
                                onClick={handleAiAnalyze}
                                disabled={analyzing}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/70 border border-indigo-500/50 hover:bg-indigo-900/70 text-indigo-300 text-xs font-bold transition-all shadow-sm cursor-pointer"
                                title="Gemini/GPT Vision & Rules 0~11 AI 정밀 품목 분석 실행"
                            >
                                <Sparkles className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin text-indigo-400' : 'text-indigo-400'}`} />
                                <span>{analyzing ? '분석 중...' : '🤖 AI 비전 분석'}</span>
                            </button>

                            {/* SLE-15 Learning Report */}
                            <button
                                onClick={fetchCorrectionReport}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium border border-gray-700 transition-all cursor-pointer"
                                title="SLE-15 수정 학습 리포트 확인"
                            >
                                <BookOpen className="w-3.5 h-3.5 text-gray-400" />
                                <span>학습 리포트</span>
                            </button>

                            {/* Refresh */}
                            <button
                                onClick={fetchOrders}
                                disabled={loading}
                                className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 cursor-pointer"
                                title="새로고침"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Workstation Body */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                        {/* 3. Intuitive 3-Step Stepper (직관적 처리 단계) */}
                        <div className="bg-[#12151f] border border-gray-800 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 font-bold text-gray-200">
                                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[10px]">1</span>
                                <span>카카오톡 접수 완료</span>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="h-px flex-1 bg-gray-800 mx-4" />
                            <div className={`flex items-center gap-2 font-bold ${(!isDestinationEmpty && !isFreightEmpty) ? 'text-emerald-400' : 'text-amber-400'}`}>
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${(!isDestinationEmpty && !isFreightEmpty) ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-amber-500/20 border-amber-500/40 text-amber-300'}`}>2</span>
                                <span>운송조건 & 품목 확정</span>
                                {(!isDestinationEmpty && !isFreightEmpty) ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
                            </div>
                            <div className="h-px flex-1 bg-gray-800 mx-4" />
                            <div className={`flex items-center gap-2 font-bold ${activeOrder.status === 'APPROVED' ? 'text-cyan-400' : canApprove ? 'text-emerald-400' : 'text-gray-500'}`}>
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${activeOrder.status === 'APPROVED' ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : canApprove ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>3</span>
                                <span>{activeOrder.status === 'APPROVED' ? '정식 승인 완료 (구매부 이첩)' : '정식 발주 승인'}</span>
                            </div>
                        </div>

                        {/* 4. Split Workstation: Left (Evidence & Photo) / Right (Directly Editable ERP Form) */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            {/* Left Pane (5 Cols): Customer Photo & Raw Utterance */}
                            <div className="lg:col-span-5 space-y-4">
                                {/* Photo Preview with Multi-Image Navigation */}
                                <div className="bg-[#141722] border border-gray-800 rounded-xl p-3.5 space-y-2">
                                    <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                                        <div className="flex items-center gap-1.5">
                                            <ImageIcon className="w-4 h-4 text-cyan-400" />
                                            <span>수신 사진 / 발주서 증빙</span>
                                            {orderImages.length > 1 && (
                                                <span className="text-[10px] text-cyan-300 bg-cyan-950/70 border border-cyan-800 px-1.5 py-0.2 rounded font-mono">
                                                    {currentImageIndex + 1} / {orderImages.length}
                                                </span>
                                            )}
                                        </div>

                                        {orderImages.length > 1 && (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => setCurrentImageIndex(prev => Math.max(0, prev - 1))}
                                                    disabled={currentImageIndex === 0}
                                                    className="p-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-200"
                                                    title="이전 사진"
                                                >
                                                    <ChevronLeft className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={() => setCurrentImageIndex(prev => Math.min(orderImages.length - 1, prev + 1))}
                                                    disabled={currentImageIndex >= orderImages.length - 1}
                                                    className="p-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-200"
                                                    title="다음 사진"
                                                >
                                                    <ChevronRight className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {orderImages.length > 0 ? (
                                        <div className="relative group bg-[#0e1017] border border-gray-800 rounded-lg h-56 flex items-center justify-center overflow-hidden">
                                            <img
                                                src={orderImages[currentImageIndex]}
                                                alt={`Order Photo ${currentImageIndex + 1}`}
                                                className="max-h-full max-w-full object-contain cursor-pointer transition-transform hover:scale-105"
                                                onClick={() => setPreviewImage(orderImages[currentImageIndex])}
                                            />
                                            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setPreviewImage(orderImages[currentImageIndex])}
                                                    className="px-2 py-1 bg-black/80 hover:bg-black text-[10px] text-gray-200 rounded border border-gray-700 flex items-center gap-1"
                                                >
                                                    확대보기
                                                </button>
                                                <a
                                                    href={orderImages[currentImageIndex]}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="px-2 py-1 bg-black/80 hover:bg-black text-[10px] text-gray-200 rounded border border-gray-700 flex items-center gap-1"
                                                >
                                                    <ExternalLink className="w-3 h-3" /> 새창
                                                </a>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-[#0e1017] border border-gray-800 rounded-lg h-56 flex items-center justify-center text-xs text-gray-600">
                                            첨부된 사진 또는 이미지가 없습니다.
                                        </div>
                                    )}

                                    {/* Thumbnail strip if multiple photos */}
                                    {orderImages.length > 1 && (
                                        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                                            {orderImages.map((img, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => setCurrentImageIndex(i)}
                                                    className={`w-12 h-10 rounded border overflow-hidden flex-shrink-0 transition-all ${
                                                        currentImageIndex === i ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-gray-700 opacity-60 hover:opacity-100'
                                                    }`}
                                                >
                                                    <img src={img} alt={`thumb ${i}`} className="w-full h-full object-cover" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Customer Raw Utterance & Editable Remarks */}
                                <div className="bg-[#141722] border border-gray-800 rounded-xl p-3.5 space-y-2.5">
                                    <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                                        <div className="flex items-center gap-1.5">
                                            <FileText className="w-4 h-4 text-amber-400" />
                                            <span>고객 카카오톡 원문</span>
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
                                            <span>{copied ? '복사됨' : '원문 복사'}</span>
                                        </button>
                                    </div>
                                    <div className="bg-[#0e1017] border border-gray-800/80 rounded-lg p-2.5 text-xs text-gray-200 font-mono whitespace-pre-wrap max-h-28 overflow-y-auto custom-scrollbar">
                                        {activeOrder.utterance || '(텍스트 내용 없음)'}
                                    </div>

                                    {/* Editable Remarks / Office Memo */}
                                    <div className="space-y-1 pt-1">
                                        <label className="text-[11px] font-bold text-amber-300 flex items-center justify-between">
                                            <span>📝 수신 비고 메모 & 특이사항 (사무실 즉시 수정 가능)</span>
                                            <span className="text-[10px] text-gray-500 font-normal">수정 시 즉시 저장에 포함</span>
                                        </label>
                                        <textarea
                                            value={editRemarks}
                                            onChange={(e) => setEditRemarks(e.target.value)}
                                            rows={2}
                                            placeholder="화물 지점 요청, 납기일, 포장 방법 등 메모 입력..."
                                            className="w-full bg-[#181b25] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-100 placeholder-gray-500 focus:outline-none focus:border-amber-400"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Right Pane (7 Cols): Directly Editable ERP Order Form */}
                            <div className="lg:col-span-7 bg-[#141722] border border-gray-800 rounded-xl p-4 space-y-4">
                                <div className="flex items-center justify-between border-b border-gray-800 pb-2.5">
                                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                        <span>1. 발송 및 운송 필수 정보 확인 & 수정</span>
                                    </h4>
                                    <span className="text-[11px] text-gray-400">
                                        모든 항목 수정 후 [⚡ 수정사항 즉시 적용]을 누르면 즉시 반영됩니다.
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
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
                                            className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white font-semibold focus:outline-none focus:border-emerald-500"
                                        />
                                    </div>

                                    {/* Assigned Team */}
                                    <div className="space-y-1">
                                        <label className="text-gray-300 font-bold flex items-center gap-1">
                                            <User className="w-3.5 h-3.5 text-gray-400" />
                                            배정 담당부서 / 팀
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={editAssignedTeam}
                                                onChange={(e) => setEditAssignedTeam(e.target.value)}
                                                placeholder="예: 영업3팀, 구매부"
                                                className="flex-1 bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                                            />
                                            <span className="px-2.5 py-2 rounded-lg bg-gray-800 text-[11px] text-gray-400 flex items-center font-mono">
                                                ➔ 구매부
                                            </span>
                                        </div>
                                    </div>

                                    {/* Destination */}
                                    <div className="sm:col-span-2 space-y-1">
                                        <label className="text-gray-300 font-bold flex items-center justify-between">
                                            <span className="flex items-center gap-1">
                                                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                                도착지 정보 (화물지점 / 배송지 주소) <span className="text-rose-400">*</span>
                                            </span>
                                        </label>
                                        <input
                                            type="text"
                                            value={editDestination}
                                            onChange={(e) => setEditDestination(e.target.value)}
                                            placeholder="예: 대신화물/평택고덕 지점, 경동/구로608A 지점, 금성밴드 본사"
                                            className={`w-full bg-[#1b1e27] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none ${
                                                isDestinationEmpty 
                                                    ? 'border border-rose-500/80 bg-rose-950/20' 
                                                    : 'border border-gray-700 focus:border-emerald-500'
                                            }`}
                                        />

                                        {/* Smart Destination Recommendation Chips */}
                                        {destinationSuggestions.length > 0 && (
                                            <div className="pt-1 space-y-1">
                                                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                                    💡 추천 도착지 (1클릭 자동 입력):
                                                </span>
                                                <div className="flex flex-wrap gap-1">
                                                    {destinationSuggestions.map((sug, i) => (
                                                        <button
                                                            key={i}
                                                            type="button"
                                                            onClick={() => setEditDestination(sug)}
                                                            className={`px-2 py-0.5 text-[11px] rounded border transition-all ${
                                                                editDestination === sug
                                                                    ? 'bg-emerald-600 text-white border-emerald-400 font-bold shadow'
                                                                    : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
                                                            }`}
                                                        >
                                                            📍 {sug}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Freight Terms */}
                                    <div className="sm:col-span-2 space-y-1">
                                        <label className="text-gray-300 font-bold flex items-center justify-between">
                                            <span className="flex items-center gap-1">
                                                <Truck className="w-3.5 h-3.5 text-gray-400" />
                                                운송비 조건 <span className="text-rose-400">*</span>
                                            </span>
                                            {learnedRules?.customers?.[activeOrder.customerName]?.freightTerms && (
                                                <span className="text-[10px] text-indigo-300 bg-indigo-950/60 px-1.5 py-0.2 rounded font-normal">
                                                    ⭐ 단골 조건: {learnedRules.customers[activeOrder.customerName].freightTerms}
                                                </span>
                                            )}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={editFreight}
                                                onChange={(e) => setEditFreight(e.target.value)}
                                                placeholder="예: 선불 화물 발송, 현불화물 후 화물비청구, 착불화물"
                                                className={`flex-1 bg-[#1b1e27] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none ${
                                                    isFreightEmpty 
                                                        ? 'border border-rose-500/80 bg-rose-950/20' 
                                                        : 'border border-gray-700 focus:border-emerald-500'
                                                }`}
                                            />
                                            <select
                                                onChange={(e) => e.target.value && setEditFreight(e.target.value)}
                                                className="bg-gray-800 border border-gray-700 rounded-lg px-2 text-gray-300 text-xs focus:outline-none"
                                                defaultValue=""
                                            >
                                                <option value="" disabled>직접선택</option>
                                                <option value="선불 화물 발송">선불 화물 발송</option>
                                                <option value="현불화물 후 화물비청구">현불화물 후 화물비청구</option>
                                                <option value="현불화물">현불화물</option>
                                                <option value="착불화물">착불화물</option>
                                                <option value="본사 직송 (무운임)">본사 직송 (무운임)</option>
                                                <option value="용차(독차)">용차(독차)</option>
                                                <option value="시화창고 방문수령">시화창고 방문수령</option>
                                            </select>
                                        </div>

                                        {/* Quick Selection Chips for Freight */}
                                        <div className="pt-1 space-y-1">
                                            <span className="text-[10px] text-gray-400">⚡ 1클릭 운송비 선택:</span>
                                            <div className="flex flex-wrap gap-1">
                                                {FREIGHT_CHIPS.map(chip => {
                                                    const isSelected = editFreight === chip.label;
                                                    const isLearned = learnedRules?.customers?.[activeOrder.customerName]?.freightTerms === chip.label;
                                                    return (
                                                        <button
                                                            key={chip.label}
                                                            type="button"
                                                            onClick={() => setEditFreight(chip.label)}
                                                            className={`px-2 py-0.5 text-[11px] rounded border font-medium transition-all ${
                                                                isSelected
                                                                    ? 'bg-emerald-600 text-white border-emerald-400 font-bold shadow'
                                                                    : isLearned
                                                                        ? 'bg-indigo-950/60 text-indigo-300 border-indigo-600/70 hover:bg-indigo-900/80'
                                                                        : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
                                                            }`}
                                                        >
                                                            {isLearned && '⭐ '}
                                                            {chip.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
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
                                            placeholder="예: 김지용 대리님, 조현진"
                                            className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
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
                                            className="w-full bg-[#1b1e27] border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 5. Items Table (품목이 3~4개 이상일 때도 한눈에 쉽게 확인) */}
                        <div className="bg-[#141722] border border-gray-800 rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between border-b border-gray-800 pb-2.5">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                                        2. 발주 품목 및 규격 대장
                                    </h4>
                                    <span className="text-xs font-bold text-amber-300 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded-full font-mono">
                                        총 {editItems.length}개 품목
                                    </span>
                                </div>
                                <button
                                    onClick={handleAddItem}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 transition-colors cursor-pointer"
                                >
                                    <Plus className="w-3.5 h-3.5" /> 품목 추가
                                </button>
                            </div>

                            <div className="overflow-x-auto border border-gray-800 rounded-lg">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[#191d29] text-gray-400 font-semibold">
                                        <tr>
                                            <th className="p-2.5 text-center w-10">No</th>
                                            <th className="p-2.5">품명</th>
                                            <th className="p-2.5">두께(Sch)</th>
                                            <th className="p-2.5">규격(Size)</th>
                                            <th className="p-2.5">재질</th>
                                            <th className="p-2.5 text-right w-24">수량</th>
                                            <th className="p-2.5 text-center">품목코드 (자동 연동)</th>
                                            <th className="p-2.5 text-right w-28">단가(원)</th>
                                            <th className="p-2.5 text-right w-32">합계(원)</th>
                                            <th className="p-2.5 text-center w-12">삭제</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800/60 text-gray-200">
                                        {editItems.length === 0 ? (
                                            <tr>
                                                <td colSpan={10} className="p-6 text-center text-gray-500">
                                                    등록된 품목이 없습니다. [+ 품목 추가]를 눌러 입력해주세요.
                                                </td>
                                            </tr>
                                        ) : (
                                            editItems.map((item, idx) => {
                                                const itemCode = `${item.name || ''}-${item.thickness || ''}-${item.size || ''}-${item.material || ''}`;
                                                const lineTotal = (item.amount || (item.unitPrice || 0) * (item.quantity || 1));
                                                return (
                                                    <tr key={idx} className="hover:bg-gray-800/30 transition-colors">
                                                        <td className="p-2 text-center text-gray-500 font-mono text-[11px]">
                                                            {idx + 1}
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.name || ''}
                                                                onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                                                className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-bold text-xs"
                                                                placeholder="예: CAP, 90E(L)"
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.thickness || ''}
                                                                onChange={(e) => handleItemChange(idx, 'thickness', e.target.value)}
                                                                className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs"
                                                                placeholder="예: S40S"
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.size || ''}
                                                                onChange={(e) => handleItemChange(idx, 'size', e.target.value)}
                                                                className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs"
                                                                placeholder={'예: 1-1/2", 4"'}
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.material || ''}
                                                                onChange={(e) => handleItemChange(idx, 'material', e.target.value)}
                                                                className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs"
                                                                placeholder="예: STS304-S"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-right">
                                                            <input
                                                                type="number"
                                                                value={item.quantity || 1}
                                                                onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                                                                className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-right text-emerald-400 font-bold text-xs"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <span className="font-mono text-[11px] text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded">
                                                                {itemCode}
                                                            </span>
                                                        </td>
                                                        <td className="p-2 text-right font-mono text-xs text-gray-300">
                                                            {item.unitPrice ? `₩${item.unitPrice.toLocaleString('ko-KR')}` : '-'}
                                                        </td>
                                                        <td className="p-2 text-right font-mono text-xs font-bold text-emerald-300">
                                                            {lineTotal > 0 ? `₩${lineTotal.toLocaleString('ko-KR')}` : '-'}
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <button
                                                                onClick={() => handleRemoveItem(idx)}
                                                                className="p-1 hover:bg-rose-900/40 rounded text-rose-400 transition-colors"
                                                                title="품목 삭제"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* 6. Bottom Action Footer (즉시 적용 & 승인) */}
                    <div className="px-6 py-3.5 border-t border-gray-800 bg-[#161924] flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleDeleteOrder}
                                disabled={saving}
                                className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-rose-950/80 text-rose-400 border border-rose-900/60 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                title="발주서 영구 삭제"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                                <span className="hidden sm:inline">발주서 영구 삭제</span>
                            </button>
                            {activeOrder.status !== 'APPROVED' && (
                                <button
                                    onClick={handleReject}
                                    disabled={saving}
                                    className="px-3 py-2 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-rose-950/40 text-rose-300 border border-gray-700 transition-colors disabled:opacity-50"
                                >
                                    ❌ 반려
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Summary Counter */}
                            <div className="text-right">
                                <div className="text-[11px] text-gray-400">총 {editItems.length}개 품목</div>
                                <div className="text-xs font-bold text-cyan-300 font-mono">
                                    {currentTotal > 0 ? `₩${currentTotal.toLocaleString('ko-KR')}` : '금액 웹 주문관리 자동산정'}
                                </div>
                            </div>

                            {/* Prominent Instant Apply Button */}
                            <button
                                onClick={handleSaveOrder}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-gray-800 hover:bg-gray-700 text-emerald-300 border border-emerald-500/50 transition-all active:scale-95 shadow cursor-pointer"
                            >
                                <Save className="w-3.5 h-3.5 text-emerald-400" />
                                <span>{saving ? '저장 중...' : '⚡ 수정사항 즉시 적용'}</span>
                            </button>

                            {/* Approve Button */}
                            {activeOrder.status === 'APPROVED' ? (
                                <div className="px-4 py-2 rounded-xl bg-cyan-950/60 border border-cyan-700 text-cyan-300 text-xs font-bold flex items-center gap-2">
                                    <Check className="w-4 h-4 text-cyan-400" />
                                    순차 발주번호: {activeOrder.orderNo || activeOrder.convertedOrderId}
                                </div>
                            ) : (
                                <button
                                    onClick={handleApproveOrder}
                                    disabled={saving || !canApprove}
                                    className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl shadow-lg transition-all transform active:scale-95 ${
                                        canApprove
                                            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black shadow-emerald-500/20 cursor-pointer'
                                            : 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed opacity-60'
                                    }`}
                                    title={!canApprove ? '도착지 정보와 운송비 조건이 필수 입력되어야 합니다.' : '정식 순차 발주번호 부여 후 구매부로 이첩'}
                                >
                                    <span>🎉 정식 발주서 승인 및 구매부 이첩</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center bg-[#0b0d13] text-gray-500 text-sm">
                    좌측 목록에서 카카오톡 발주서를 선택해주세요.
                </div>
            )}

            {/* Image Preview Modal with Prev/Next Controls */}
            {previewImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
                    onClick={() => setPreviewImage(null)}
                >
                    <div
                        className="relative max-w-5xl max-h-[90vh] bg-gray-900 border border-gray-700 rounded-xl overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-3 bg-gray-950 border-b border-gray-800 flex items-center justify-between text-xs text-gray-300">
                            <span className="font-bold flex items-center gap-1.5">
                                <ImageIcon className="w-4 h-4 text-cyan-400" />
                                카카오톡 수신 원본 사진
                            </span>
                            <div className="flex items-center gap-2">
                                <a
                                    href={previewImage}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded text-xs flex items-center gap-1"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" /> 새창으로 열기
                                </a>
                                <button
                                    onClick={() => setPreviewImage(null)}
                                    className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/60">
                            <img src={previewImage} alt="Expanded Attachment" className="max-h-[75vh] max-w-full object-contain" />
                        </div>
                    </div>
                </div>
            )}

            {/* SLE-15 Learning Report Modal */}
            {showCorrectionModal && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
                    onClick={() => setShowCorrectionModal(false)}
                >
                    <div
                        className="relative w-full max-w-4xl max-h-[85vh] bg-[#141724] border border-gray-700 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="p-4 bg-gradient-to-r from-indigo-950/80 via-gray-900 to-indigo-950/80 border-b border-gray-800 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                                    <BookOpen className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        <span>[SLE-15] 발주서 수정관찰봇 누적 학습 리포트</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                                            ACTIVE LEARNING
                                        </span>
                                    </h3>
                                    <p className="text-[11px] text-gray-400">
                                        사무실 직원의 규격/재질/운송조건 수정 이력을 자동 학습하여 다음 발주 인입 시 우선 적용합니다.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCorrectionModal(false)}
                                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-gray-800 bg-gray-900/40 px-4 pt-3 text-xs">
                            <button
                                onClick={() => setCorrectionModalTab('RULES')}
                                className={`pb-2.5 px-3 font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                    correctionModalTab === 'RULES'
                                        ? 'border-indigo-400 text-indigo-300'
                                        : 'border-transparent text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                <Building2 className="w-3.5 h-3.5" />
                                <span>📚 1. 거래처별 정립된 배송·운송 규칙 대장 ({Object.keys(learnedRules?.customers || {}).length}개사)</span>
                            </button>
                            <button
                                onClick={() => setCorrectionModalTab('DIFFS')}
                                className={`pb-2.5 px-3 font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                                    correctionModalTab === 'DIFFS'
                                        ? 'border-indigo-400 text-indigo-300'
                                        : 'border-transparent text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                <BookOpen className="w-3.5 h-3.5" />
                                <span>🧠 2. 실시간 수정 Diff 감지 내역 ({correctionReport?.recentCorrections?.length || 0}건)</span>
                            </button>
                        </div>

                        {/* Metrics Bar */}
                        <div className="grid grid-cols-4 gap-3 p-4 bg-gray-900/60 border-b border-gray-800/80 text-xs">
                            <div className="p-3 rounded-xl bg-gray-850/80 border border-gray-800">
                                <div className="text-gray-400 text-[11px] mb-1">총 관찰 누적</div>
                                <div className="text-lg font-bold text-white font-mono">
                                    {correctionReport?.totalCorrections ?? 0} <span className="text-xs font-normal text-gray-400">건</span>
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30">
                                <div className="text-indigo-300 text-[11px] mb-1">재질(Material) 보정</div>
                                <div className="text-lg font-bold text-indigo-400 font-mono">
                                    {correctionReport?.materialCorrectionsCount ?? 0} <span className="text-xs font-normal text-gray-400">건</span>
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30">
                                <div className="text-cyan-300 text-[11px] mb-1">두께(Thickness) 보정</div>
                                <div className="text-lg font-bold text-cyan-400 font-mono">
                                    {correctionReport?.thicknessCorrectionsCount ?? 0} <span className="text-xs font-normal text-gray-400">건</span>
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-teal-950/30 border border-teal-500/30">
                                <div className="text-teal-300 text-[11px] mb-1">규격(Size) 보정</div>
                                <div className="text-lg font-bold text-teal-400 font-mono">
                                    {correctionReport?.sizeCorrectionsCount ?? 0} <span className="text-xs font-normal text-gray-400">건</span>
                                </div>
                            </div>
                        </div>

                        {/* Modal Tab Content */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar">
                            {correctionModalTab === 'RULES' ? (
                                <div className="space-y-3">
                                    <div className="text-xs font-bold text-gray-300 flex items-center justify-between">
                                        <span>고객사별 자동 학습된 기본 도착지 및 운송비 룰 (다음 발주 인입 시 자동 적용)</span>
                                        <span className="text-[11px] text-gray-500 font-mono">server/data/kakao_learned_rules.json</span>
                                    </div>

                                    {(!learnedRules?.customers || Object.keys(learnedRules.customers).length === 0) ? (
                                        <div className="p-8 text-center rounded-xl bg-gray-900/40 border border-gray-800 text-gray-400 text-xs">
                                            아직 정립된 거래처별 규칙이 없습니다.
                                        </div>
                                    ) : (
                                        Object.entries(learnedRules.customers).map(([cName, rule]: [string, CustomerLearnedRule]) => (
                                            <div key={cName} className="p-4 rounded-xl bg-gray-900/80 border border-indigo-500/30 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                                                            <Building2 className="w-4 h-4 text-emerald-400" />
                                                            {cName}
                                                        </span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                                            누적 학습 {rule.sampleCount || 1}회
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-gray-400 font-mono">
                                                        {rule.updatedAt ? new Date(rule.updatedAt).toLocaleString('ko-KR') : ''}
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs pt-1">
                                                    <div className="p-2.5 rounded-lg bg-gray-850 border border-gray-800 space-y-0.5">
                                                        <span className="text-[10px] text-gray-400 font-semibold block">📍 기본 도착지 / 화물지점:</span>
                                                        <span className="text-white font-medium">{rule.destination || '(미지정)'}</span>
                                                    </div>
                                                    <div className="p-2.5 rounded-lg bg-gray-850 border border-gray-800 space-y-0.5">
                                                        <span className="text-[10px] text-gray-400 font-semibold block">🚚 기본 운송비 조건:</span>
                                                        <span className="text-amber-300 font-bold">{rule.freightTerms || '(미지정)'}</span>
                                                    </div>
                                                </div>

                                                {rule.ruleNotes && (
                                                    <div className="text-[11px] text-gray-400 bg-gray-950/60 p-2 rounded border border-gray-800">
                                                        💡 <span className="font-semibold text-gray-300">규칙 요약:</span> {rule.ruleNotes}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="text-xs font-bold text-gray-300 flex items-center justify-between">
                                        <span>최근 감지 및 학습 이력 (최근 {correctionReport?.recentCorrections?.length || 0}건)</span>
                                        <span className="text-[11px] text-gray-500 font-mono">server/data/order_rule_corrections.json</span>
                                    </div>

                                    {(!correctionReport?.recentCorrections || correctionReport.recentCorrections.length === 0) ? (
                                        <div className="p-8 text-center rounded-xl bg-gray-900/40 border border-gray-800 text-gray-400 text-xs">
                                            <AlertCircle className="w-8 h-8 text-gray-500 mx-auto mb-2 opacity-50" />
                                            아직 기록된 수정 학습 내역이 없습니다.
                                        </div>
                                    ) : (
                                        correctionReport.recentCorrections.map((rec) => (
                                            <div key={rec.id} className="p-3.5 rounded-xl bg-gray-900/80 border border-gray-800 space-y-2.5">
                                                <div className="flex items-center justify-between text-xs">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-indigo-300">{rec.customerName || '고객사'}</span>
                                                        <span className="text-[10px] text-gray-400 font-mono">#{rec.orderNo || rec.orderId}</span>
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                                                            {rec.channelTag || '카카오톡'}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] text-gray-400">
                                                        {new Date(rec.timestamp).toLocaleString('ko-KR')}
                                                    </span>
                                                </div>

                                                {/* Item Changes */}
                                                {rec.itemChanges && rec.itemChanges.length > 0 && (
                                                    <div className="space-y-1.5 pl-2 border-l-2 border-indigo-500/40">
                                                        {rec.itemChanges.map((ic, idx) => (
                                                            <div key={idx} className="text-xs space-y-1">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="font-semibold text-gray-300">{ic.itemName || `품목 #${ic.itemIndex + 1}`}</span>
                                                                    {ic.fieldDiffs?.map((fd, fIdx) => (
                                                                        <span key={fIdx} className="px-2 py-0.5 rounded bg-gray-800 text-[11px] font-mono text-gray-200">
                                                                            <span className="text-gray-400">{fd.field}: </span>
                                                                            <span className="text-rose-400 line-through mr-1">{String(fd.from)}</span>
                                                                            <span className="text-emerald-400 font-bold">➔ {String(fd.to)}</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                                {ic.ruleInferred && (
                                                                    <div className="text-[11px] text-indigo-300/90 bg-indigo-950/40 px-2 py-0.5 rounded inline-block">
                                                                        💡 추론 규칙: {ic.ruleInferred}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Condition Changes */}
                                                {rec.conditionChanges && rec.conditionChanges.length > 0 && (
                                                    <div className="flex items-center gap-2 flex-wrap text-xs pl-2 border-l-2 border-amber-500/40">
                                                        <span className="text-[11px] text-amber-400 font-medium">조건 보정:</span>
                                                        {rec.conditionChanges.map((cc, cIdx) => (
                                                            <span key={cIdx} className="px-2 py-0.5 rounded bg-gray-800 text-[11px] font-mono text-gray-200">
                                                                <span className="text-gray-400">{cc.field}: </span>
                                                                <span className="text-rose-400 line-through mr-1">{String(cc.from)}</span>
                                                                <span className="text-emerald-400 font-bold">➔ {String(cc.to)}</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-3.5 border-t border-gray-800 bg-gray-900/60 flex justify-end">
                            <button
                                onClick={() => setShowCorrectionModal(false)}
                                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition-colors"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
