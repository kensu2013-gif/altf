import React, { useState, useEffect, useCallback } from 'react';
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
    X
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
    items: KakaoOrderProductItem[];
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
    const [analyzing, setAnalyzing] = useState<boolean>(false);
    const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
    const [correctionModalTab, setCorrectionModalTab] = useState<'RULES' | 'DIFFS'>('RULES');
    const [correctionReport, setCorrectionReport] = useState<CorrectionSummaryReport | null>(null);
    const [learnedRules, setLearnedRules] = useState<{ customers: Record<string, any>; lastUpdated?: string } | null>(null);

    // Selected order editing state
    const [editCustomer, setEditCustomer] = useState<string>('');
    const [editDestination, setEditDestination] = useState<string>('');
    const [editFreight, setEditFreight] = useState<string>('');
    const [editRecipient, setEditRecipient] = useState<string>('');
    const [editPhone, setEditPhone] = useState<string>('');
    const [editItems, setEditItems] = useState<KakaoOrderProductItem[]>([]);

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

    const activeOrder = orders.find(o => o.id === selectedOrderId) || orders[0] || null;

    useEffect(() => {
        if (activeOrder) {
            const cust = activeOrder.customerName || '';
            const learned = learnedRules?.customers?.[cust];

            setEditCustomer(cust);
            setEditDestination(activeOrder.destination || learned?.destination || '');
            setEditFreight(activeOrder.freightTerms || learned?.freightTerms || '');
            setEditRecipient(activeOrder.recipient || learned?.recipient || '');
            setEditPhone(activeOrder.phone || learned?.phone || '');
            setEditItems(JSON.parse(JSON.stringify(activeOrder.items || [])));
        }
    }, [activeOrder, learnedRules]);

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

    // 🚚 Destination suggestions dynamically derived from remarks, utterance, and learned rules
    const destinationSuggestions = React.useMemo(() => {
        if (!activeOrder) return [];
        const list: string[] = [];
        const remarks = activeOrder.remarks || '';
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
    }, [activeOrder, learnedRules]);

    const FREIGHT_CHIPS = [
        { label: '선불 화물 발송', hint: '당사 선불' },
        { label: '착불화물', hint: '고객 착불' },
        { label: '현불화물 후 화물비청구', hint: '현불 후 청구' },
        { label: '본사 직송 (무운임)', hint: '직송' },
        { label: '용차(독차)', hint: '용차' },
        { label: '시화창고 방문수령', hint: '방문수령' }
    ];

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
                alert('✅ 수정사항이 저장되었습니다.\n(🧠 SLE-15 발주서 수정관찰봇이 품목 규격 및 운송조건 수정 내역을 실시간 감지하여 누적 학습했습니다.)');
                await fetchOrders();
            } else {
                const data = await res.json();
                alert('저장 실패: ' + (data.error || '오류 발생'));
            }
        } catch (e) {
            alert('저장 오류: ' + (e instanceof Error ? e.message : String(e)));
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
            alert('수정 리포트 조회 실패: ' + (e instanceof Error ? e.message : String(e)));
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
                alert(`🎉 [정식 발주 승인 및 순차 발주번호 발급 완료]\n\n• 순차 발주번호: ${data.order?.orderNo || data.order?.poNumber}\n• 출처 태그: 🏷️ [카카오톡 접수] 스티커 부착\n• 상태: 번호 건너뜀 없이 웹 정식 원장(db.orders) 및 구매부(PUR-01/07) 대장에 안전하게 인계되었습니다.`);
                await fetchOrders();
            } else {
                const data = await res.json();
                alert('승인 실패: ' + (data.error || '오류 발생'));
            }
        } catch (e) {
            alert('승인 오류: ' + (e instanceof Error ? e.message : String(e)));
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
        } catch (e) {
            alert('반려 오류: ' + (e instanceof Error ? e.message : String(e)));
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
        } catch (e) {
            alert('삭제 오류: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setSaving(false);
        }
    };

    // 🤖 영업3팀 SLE-11(비전 OCR) & SLE-12(AI 품목분석) 연계 정밀 분석 실행
    const handleAiAnalyze = async () => {
        if (!activeOrder) return;
        setAnalyzing(true);
        try {
            const res = await fetch(`/api/kakao/orders/${activeOrder.id}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    utterance: activeOrder.utterance,
                    imageUrl: activeOrder.imageUrl
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.order) {
                    alert('🤖 [영업3팀 SLE-11/12] AI 비전 OCR 및 품목 정밀 분석(규칙 0~11)이 완료되어 최신 규격과 단가가 반영되었습니다!');
                    await fetchOrders();
                }
            } else {
                alert('AI 분석 실패');
            }
        } catch (e) {
            alert('AI 분석 오류: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setAnalyzing(false);
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
                                        <div className="flex items-center gap-1.5">
                                            {item.orderNo ? (
                                                <span className="font-mono text-cyan-400 font-bold">{item.orderNo}</span>
                                            ) : (
                                                <span className="text-amber-400/90 font-medium">⏳ [주문접수 대기] (번호 미부여)</span>
                                            )}
                                        </div>
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
                                <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-400 text-black flex items-center gap-1">
                                    <Tag className="w-3 h-3" />
                                    [카카오톡 접수 스티커]
                                </span>
                                <h3 className="text-base font-bold text-white font-mono">
                                    {activeOrder.orderNo ? (
                                        <span className="text-cyan-400">{activeOrder.orderNo}</span>
                                    ) : (
                                        <span className="text-amber-300 font-sans text-xs px-2.5 py-1 rounded bg-amber-950/60 border border-amber-600/50 font-bold">
                                            ⏳ [주문접수 대기] (사무실 확인 후 승인 시 순차 발주번호 자동 발급)
                                        </span>
                                    )}
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
                                접수일시: {new Date(activeOrder.receivedAt).toLocaleString('ko-KR')} | 담당: 영업부 영업3팀(SLE-11~15) ➔ [승인 시] 구매부(PUR-01/07) 정식 이첩
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchCorrectionReport}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-950/50 border border-indigo-500/40 hover:bg-indigo-900/60 text-indigo-300 text-xs font-bold transition-all shadow-sm"
                                title="발주서 수정관찰봇(SLE-15)의 품목 및 운송조건 누적 학습 내역 확인"
                            >
                                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                                <span>🧠 [SLE-15] 수정학습 리포트</span>
                            </button>
                            <button
                                onClick={handleAiAnalyze}
                                disabled={analyzing}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold transition-all shadow-sm"
                                title="영업2팀 견적봇과 동일한 Gemini/GPT Vision & 규칙 0~11 AI 정밀 품목 분석 실행"
                            >
                                <Sparkles className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin text-emerald-400' : 'text-emerald-400'}`} />
                                <span>{analyzing ? 'AI 정밀 분석 중...' : '🤖 [영업3팀] AI 비전 OCR & 품목 분석'}</span>
                            </button>
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
                        {/* 👤 Who Sent It & When HUD Card */}
                        <div className="bg-gradient-to-r from-[#161a26] via-[#1a1f2e] to-[#161a26] border border-gray-700/80 rounded-xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3.5">
                                <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0 shadow-inner">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">발신 고객사</span>
                                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                                            카카오톡 접수
                                        </span>
                                    </div>
                                    <div className="text-base font-extrabold text-white flex items-center gap-2 mt-0.5">
                                        <span>{activeOrder.customerName || '고객사 미기재'}</span>
                                        {activeOrder.recipient && (
                                            <span className="text-xs font-semibold text-gray-300 bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700">
                                                담당: {activeOrder.recipient} {activeOrder.phone ? `(${activeOrder.phone})` : ''}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-xs border-t md:border-t-0 md:border-l border-gray-700/80 pt-3 md:pt-0 md:pl-5">
                                <div>
                                    <div className="text-[11px] text-gray-400 font-medium">수신/접수 일시</div>
                                    <div className="font-bold text-amber-300 font-mono text-sm">
                                        {new Date(activeOrder.receivedAt).toLocaleString('ko-KR')}
                                    </div>
                                </div>
                                <div className="h-6 w-px bg-gray-700/60 hidden sm:block" />
                                <div>
                                    <div className="text-[11px] text-gray-400 font-medium">배정 담당부서</div>
                                    <div className="font-bold text-emerald-400 flex items-center gap-1.5 text-sm">
                                        <span>영업3팀 (발주팀)</span>
                                        <span className="text-[10px] text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">➔ 구매부</span>
                                    </div>
                                </div>
                            </div>
                        </div>

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
                                        아래 <b>원클릭 퀵 칩</b> 또는 입력란에서 확정 후 <b>[정식 발주서 등록 승인]</b>을 진행해주세요.
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
                                        <span>고객 카카오톡 원문 & 비고 메모</span>
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
                                    {activeOrder.remarks ? (
                                        <div className="mb-2 p-2 rounded bg-amber-950/30 border border-amber-800/40 text-amber-200">
                                            <span className="font-bold">📝 수신 비고 메모:</span> {activeOrder.remarks}
                                        </div>
                                    ) : null}
                                    {activeOrder.utterance || '(텍스트 내용 없음)'}
                                </div>
                            </div>

                            {/* Image Preview Box */}
                            <div className="bg-[#151821] border border-gray-800 rounded-xl p-4 space-y-2">
                                <div className="flex items-center justify-between text-xs font-bold text-gray-300">
                                    <div className="flex items-center gap-2">
                                        <ImageIcon className="w-4 h-4 text-cyan-400" />
                                        <span>수신 사진/발주서 문서 원본</span>
                                    </div>
                                    {activeOrder.imageUrl && (
                                        <span className="text-[10px] text-cyan-300 bg-cyan-950/60 border border-cyan-800/50 px-2 py-0.5 rounded">
                                            클릭 시 원본 확대
                                        </span>
                                    )}
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
                                            className="absolute bottom-2 right-2 px-2.5 py-1.5 bg-black/80 hover:bg-black text-[11px] text-gray-100 rounded-lg flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity border border-gray-700 shadow-lg"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" /> 새창 크게보기
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
                            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                    1. 발송 및 운송 필수 항목 검증 (Human-in-the-Loop)
                                </span>
                                <span className="text-[11px] text-gray-400 font-normal">
                                    * 운송비 조건과 도착지를 확정하면 하단 승인 버튼이 활성화됩니다.
                                </span>
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
                                    <label className="text-gray-300 font-bold flex items-center justify-between">
                                        <span className="flex items-center gap-1">
                                            <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                            도착지 정보 (화물지점/주소) <span className="text-rose-400">*</span>
                                        </span>
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
                                        <span className="text-[10px] text-rose-400 font-semibold block">⚠️ 필수 항목: 도착지 정보를 입력해주세요.</span>
                                    )}

                                    {/* 📍 Smart Destination Recommendation Chips */}
                                    {destinationSuggestions.length > 0 && (
                                        <div className="pt-1.5 space-y-1">
                                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                                💡 추천 도착지 (클릭 시 자동 입력):
                                            </span>
                                            <div className="flex flex-wrap gap-1">
                                                {destinationSuggestions.map((sug, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => setEditDestination(sug)}
                                                        className={`px-2 py-0.5 text-[10px] rounded border transition-all ${
                                                            editDestination === sug
                                                                ? 'bg-emerald-600 text-white border-emerald-400 font-bold shadow'
                                                                : 'bg-gray-800/80 hover:bg-gray-700 text-gray-300 border-gray-700'
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
                                <div className="space-y-1">
                                    <label className="text-gray-300 font-bold flex items-center justify-between">
                                        <span className="flex items-center gap-1">
                                            <Truck className="w-3.5 h-3.5 text-gray-400" />
                                            운송비 조건 <span className="text-rose-400">*</span>
                                        </span>
                                        {learnedRules?.customers?.[activeOrder.customerName]?.freightTerms && (
                                            <span className="text-[10px] text-indigo-300 bg-indigo-950/50 px-1.5 py-0.2 rounded font-normal">
                                                ⭐ 단골: {learnedRules.customers[activeOrder.customerName].freightTerms}
                                            </span>
                                        )}
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
                                    {isFreightEmpty && (
                                        <span className="text-[10px] text-rose-400 font-semibold block">⚠️ 필수 항목: 운송비 조건을 입력해주세요.</span>
                                    )}

                                    {/* 🚚 Quick Selection Chips for Freight */}
                                    <div className="pt-1.5 space-y-1">
                                        <span className="text-[10px] text-gray-400">⚡ 원클릭 운송비 선택:</span>
                                        <div className="flex flex-wrap gap-1">
                                            {FREIGHT_CHIPS.map(chip => {
                                                const isSelected = editFreight === chip.label;
                                                const isLearned = learnedRules?.customers?.[activeOrder.customerName]?.freightTerms === chip.label;
                                                return (
                                                    <button
                                                        key={chip.label}
                                                        type="button"
                                                        onClick={() => setEditFreight(chip.label)}
                                                        className={`px-2 py-0.5 text-[10px] rounded border font-medium transition-all ${
                                                            isSelected
                                                                ? 'bg-emerald-600 text-white border-emerald-400 font-bold shadow'
                                                                : isLearned
                                                                    ? 'bg-indigo-950/60 text-indigo-300 border-indigo-600/70 hover:bg-indigo-900/80'
                                                                    : 'bg-gray-800/80 hover:bg-gray-700 text-gray-300 border-gray-700'
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
                                <div>
                                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                                        <span>2. 발주 품목 및 수량 대장 (총 {editItems.length}개 품목)</span>
                                        <span className="text-[10px] text-amber-300 font-normal bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded">
                                            ℹ️ 봇 임의 가격 계산 금지 ➔ 웹 주문관리(db.orders)에서 품목코드로 자동 가격 작성
                                        </span>
                                    </h4>
                                </div>
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
                                            <th className="p-2.5">두께(Sch)</th>
                                            <th className="p-2.5">규격(Size)</th>
                                            <th className="p-2.5">재질</th>
                                            <th className="p-2.5 text-right">수량</th>
                                            <th className="p-2.5 text-center">품목코드 (웹 주문관리 연동)</th>
                                            <th className="p-2.5 text-center">가격 산출</th>
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
                                            editItems.map((item, idx) => {
                                                const itemCode = `${item.name || ''}-${item.thickness || ''}-${item.size || ''}-${item.material || ''}`;
                                                return (
                                                    <tr key={idx} className="hover:bg-gray-800/30">
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.name || ''}
                                                                onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                                                className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-bold"
                                                                placeholder="예: CAP, 90E(L)"
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.thickness || ''}
                                                                onChange={(e) => handleItemChange(idx, 'thickness', e.target.value)}
                                                                className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                                                                placeholder="예: S40S"
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.size || ''}
                                                                onChange={(e) => handleItemChange(idx, 'size', e.target.value)}
                                                                className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                                                                placeholder={'예: 1-1/2", 4"'}
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={item.material || ''}
                                                                onChange={(e) => handleItemChange(idx, 'material', e.target.value)}
                                                                className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono"
                                                                placeholder="예: WP304-S"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-right">
                                                            <input
                                                                type="number"
                                                                value={item.quantity || 1}
                                                                onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                                                                className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-right text-emerald-400 font-bold"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <span className="font-mono text-[11px] text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 px-2 py-1 rounded">
                                                                {itemCode}
                                                            </span>
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <span className="text-[10px] text-gray-400 bg-gray-800/80 px-2 py-1 rounded">
                                                                웹 주문관리 자동산정
                                                            </span>
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
                                                );
                                            })
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
                                <div className="text-[11px] text-gray-400">품목 {editItems.length}개 | 합계금액</div>
                                <div className="text-xs font-bold text-cyan-300 font-mono">
                                    {currentTotal > 0 ? `₩${currentTotal.toLocaleString('ko-KR')}` : `총 ${editItems.length}개 품목 완비`}
                                </div>
                            </div>

                            {activeOrder.status === 'APPROVED' ? (
                                <div className="px-4 py-2.5 rounded-xl bg-cyan-950/60 border border-cyan-700 text-cyan-300 text-xs font-bold flex items-center gap-2">
                                    <Check className="w-4 h-4 text-cyan-400" />
                                    정식 순차 발주번호: {activeOrder.orderNo || activeOrder.convertedOrderId}
                                </div>
                            ) : (
                                <button
                                    onClick={handleApproveOrder}
                                    disabled={saving || !canApprove}
                                    className={`flex items-center gap-2 px-6 py-2.5 text-xs font-bold rounded-xl shadow-lg transition-all transform active:scale-95 ${
                                        canApprove
                                            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black shadow-emerald-500/20 cursor-pointer'
                                            : 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed opacity-60'
                                    }`}
                                    title={!canApprove ? '도착지 정보와 운송비 조건이 필수 입력되어야 합니다.' : '정식 순차 발주번호 부여 후 구매부로 이첩'}
                                >
                                    <Check className="w-4 h-4" />
                                    {saving ? '발주번호 채번 및 이첩 중...' : '🚀 [정식 발주 승인 및 순차 발주번호 발급 ➔ 구매부 이첩]'}
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

            {/* 🧠 SLE-15 발주서 수정관찰 누적 학습 리포트 모달 */}
            {showCorrectionModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                    onClick={() => setShowCorrectionModal(false)}
                >
                    <div
                        className="bg-[#12151f] border border-indigo-500/40 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="p-5 border-b border-gray-800 bg-gradient-to-r from-indigo-950/60 via-gray-900 to-indigo-950/40 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-400">
                                    <BookOpen className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                                        <span>발주서 수정관찰봇(SLE-15) 누적 학습 리포트</span>
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-normal">
                                            Self-Learning Active
                                        </span>
                                    </h3>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        관리자의 발주서 수기 보정 패턴을 실시간 학습하여 AI 비전/발주 추출 규칙에 반영합니다.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCorrectionModal(false)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Tab Switcher */}
                        <div className="flex border-b border-gray-800 bg-gray-900/90 px-5 pt-2 gap-2 text-xs">
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
                                        Object.entries(learnedRules.customers).map(([cName, rule]: [string, any]) => (
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
