import React, { useState, useEffect, useCallback } from 'react';
import {
    CheckCircle2,
    XCircle,
    Clock,
    Send,
    AlertTriangle,
    FileText,
    RefreshCw,
    Search,
    ShieldCheck,
    RotateCcw
} from 'lucide-react';
import { useStore } from '../../store/useStore';

export interface DispatchItem {
    id: string;
    channel: 'EMAIL' | 'FAX' | 'KAKAO_LINK' | 'TELEGRAM_INTERNAL';
    to: string;
    replyTo?: string;
    subject: string;
    body: string;
    attachments?: Array<{ fileName: string; path?: string; storageKey?: string; size?: number; mime?: string }>;
    orderId?: string;
    shipmentId?: string;
    kind: 'QUOTE' | 'SUPPLIER_PO' | 'DOC_PACKAGE' | 'CERT_REQUEST' | 'NOTICE';
    approverRole: 'SALES' | 'OFFICE' | null;
    requiresApproval: boolean;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENDING' | 'SENT' | 'FAILED';
    enqueuedAt: string;
    enqueuedBy: string;
    approvedBy?: { name: string; role?: string; at: string };
    rejectedBy?: { name: string; at: string; reason?: string };
    sentAt?: string;
    retryCount: number;
    lastError?: string;
    dispatchResult?: {
        delivered?: boolean;
        mode?: string;
        targetTo?: string;
        telegramResponse?: unknown;
        mockPath?: string;
    };
    meta?: Record<string, unknown>;
}

export default function DispatchApprovalQueue() {
    const { auth } = useStore();
    const currentUser = auth.user;

    const [items, setItems] = useState<DispatchItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [roleFilter, setRoleFilter] = useState<string>('ALL');
    const [channelFilter, setChannelFilter] = useState<string>('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Detail Modal & Action Modal State
    const [selectedItem, setSelectedItem] = useState<DispatchItem | null>(null);
    const [rejectModalItem, setRejectModalItem] = useState<DispatchItem | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    // Fetch queue items
    const fetchQueue = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/dispatch/queue');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.success && Array.isArray(data.items)) {
                setItems(data.items);
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchQueue();
    }, [fetchQueue]);

    // Handle Approve
    const handleApprove = async (item: DispatchItem) => {
        if (!confirm(`[${item.subject}]\n해당 항목을 최종 승인하고 실제 고객/수신자에게 발송하시겠습니까?`)) return;

        setActionLoading(true);
        try {
            const res = await fetch(`/api/dispatch/queue/${encodeURIComponent(item.id)}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user: {
                        name: currentUser?.name || '관리자',
                        role: currentUser?.role || 'ADMIN'
                    }
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || '승인 처리 실패');
            }
            alert(`✅ 성공적으로 승인 및 발송되었습니다! (ID: ${item.id})`);
            await fetchQueue();
            if (selectedItem?.id === item.id) setSelectedItem(data.item);
        } catch (err: unknown) {
            alert(`❌ 승인 처리 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    };

    // Handle Reject
    const handleRejectSubmit = async () => {
        if (!rejectModalItem) return;
        if (!rejectReason.trim()) {
            alert('반려 사유를 입력해 주십시오.');
            return;
        }

        setActionLoading(true);
        try {
            const res = await fetch(`/api/dispatch/queue/${encodeURIComponent(rejectModalItem.id)}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user: { name: currentUser?.name || '관리자' },
                    reason: rejectReason.trim()
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || '반려 처리 실패');
            }
            alert(`🚫 반려 처리가 완료되었습니다.`);
            setRejectModalItem(null);
            setRejectReason('');
            await fetchQueue();
            if (selectedItem?.id === rejectModalItem.id) setSelectedItem(data.item);
        } catch (err: unknown) {
            alert(`❌ 반려 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    };

    // Handle Retry
    const handleRetry = async (item: DispatchItem) => {
        setActionLoading(true);
        try {
            const res = await fetch(`/api/dispatch/queue/${encodeURIComponent(item.id)}/retry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user: { name: currentUser?.name || '관리자' }
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || '재시도 실패');
            }
            alert(`🔄 재전송이 성공적으로 완료되었습니다.`);
            await fetchQueue();
            if (selectedItem?.id === item.id) setSelectedItem(data.item);
        } catch (err: unknown) {
            alert(`❌ 재시도 실패: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    };

    // Filter items
    const filteredItems = items.filter(item => {
        if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
        if (roleFilter !== 'ALL' && item.approverRole !== roleFilter) return false;
        if (channelFilter !== 'ALL' && item.channel !== channelFilter) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchSubject = item.subject.toLowerCase().includes(q);
            const matchTo = item.to.toLowerCase().includes(q);
            const matchId = item.id.toLowerCase().includes(q);
            const matchOrder = (item.orderId || '').toLowerCase().includes(q);
            if (!matchSubject && !matchTo && !matchId && !matchOrder) return false;
        }
        return true;
    });

    // Counts
    const pendingCount = items.filter(i => i.status === 'PENDING_APPROVAL').length;
    const sentCount = items.filter(i => i.status === 'SENT').length;
    const failedCount = items.filter(i => i.status === 'FAILED' || i.status === 'REJECTED').length;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="p-2 bg-amber-500/10 text-amber-600 rounded-lg font-bold text-xl">🚪</span>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">발송 게이트 & 승인 대기열 (Dispatch Queue)</h1>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">
                        고객·매입처로 송부되는 모든 견적서, 발주서, 성적서/명세표 패키지 발송을 단일 창구에서 감시하고 결재합니다.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchQueue}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        새로고침
                    </button>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs flex items-center gap-2 font-medium">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>데이터 로드 오류: {error}</span>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">전체 요청 건수</span>
                        <Send className="w-5 h-5 text-slate-400" />
                    </div>
                    <div className="text-2xl font-black text-slate-800 mt-2">{items.length}건</div>
                    <div className="text-xs text-slate-400 mt-1">누적 발송 트래픽</div>
                </div>

                <div
                    onClick={() => setStatusFilter('PENDING_APPROVAL')}
                    className="bg-amber-50/50 p-5 rounded-xl border border-amber-200 shadow-sm cursor-pointer hover:bg-amber-50 transition"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-700">승인 대기 (결재 필요)</span>
                        <Clock className="w-5 h-5 text-amber-500 animate-pulse" />
                    </div>
                    <div className="text-2xl font-black text-amber-700 mt-2">{pendingCount}건</div>
                    <div className="text-xs text-amber-600 mt-1">담당자 승인 즉시 자동 발송</div>
                </div>

                <div
                    onClick={() => setStatusFilter('SENT')}
                    className="bg-emerald-50/50 p-5 rounded-xl border border-emerald-200 shadow-sm cursor-pointer hover:bg-emerald-50 transition"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">발송 완료</span>
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-emerald-700 mt-2">{sentCount}건</div>
                    <div className="text-xs text-emerald-600 mt-1">원장 감사 이력 연동 완료</div>
                </div>

                <div
                    onClick={() => setStatusFilter('REJECTED')}
                    className="bg-rose-50/50 p-5 rounded-xl border border-rose-200 shadow-sm cursor-pointer hover:bg-rose-50 transition"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-rose-700">반려 / 전송 실패</span>
                        <AlertTriangle className="w-5 h-5 text-rose-500" />
                    </div>
                    <div className="text-2xl font-black text-rose-700 mt-2">{failedCount}건</div>
                    <div className="text-xs text-rose-600 mt-1">반려 사유 확인 및 재전송 가능</div>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Status Filter */}
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <span>상태:</span>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none"
                        >
                            <option value="ALL">전체 상태 ({items.length})</option>
                            <option value="PENDING_APPROVAL">승인 대기중 ({pendingCount})</option>
                            <option value="SENT">발송 완료 ({sentCount})</option>
                            <option value="REJECTED">반려됨</option>
                            <option value="FAILED">전송 실패</option>
                        </select>
                    </div>

                    {/* Role Filter */}
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <span>승인 역할:</span>
                        <select
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value)}
                            className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none"
                        >
                            <option value="ALL">전체 역할</option>
                            <option value="SALES">영업부 (SALES)</option>
                            <option value="OFFICE">사무실/총무 (OFFICE)</option>
                        </select>
                    </div>

                    {/* Channel Filter */}
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <span>채널:</span>
                        <select
                            value={channelFilter}
                            onChange={(e) => setChannelFilter(e.target.value)}
                            className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none"
                        >
                            <option value="ALL">전체 채널</option>
                            <option value="EMAIL">이메일 (EMAIL)</option>
                            <option value="TELEGRAM_INTERNAL">사내 텔레그램</option>
                            <option value="KAKAO_LINK">카카오톡</option>
                            <option value="FAX">팩스</option>
                        </select>
                    </div>
                </div>

                {/* Search Box */}
                <div className="relative min-w-[260px]">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="제목, 수신자, 주문ID 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-9 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-teal-500 outline-none"
                    />
                </div>
            </div>

            {/* Queue List Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                                <th className="py-3 px-4">식별 ID / 등록시각</th>
                                <th className="py-3 px-4">발송 유형 및 채널</th>
                                <th className="py-3 px-4">수신처 / 회신(Reply-To)</th>
                                <th className="py-3 px-4">메일/문서 제목</th>
                                <th className="py-3 px-4">첨부 서류</th>
                                <th className="py-3 px-4">결재권자 / 상태</th>
                                <th className="py-3 px-4 text-center">승인 / 조치</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                            {filteredItems.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <ShieldCheck className="w-8 h-8 text-slate-300" />
                                            <span>해당 조건에 만족하는 발송 대기열 항목이 없습니다.</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((item) => {
                                    const isPending = item.status === 'PENDING_APPROVAL';
                                    const isSent = item.status === 'SENT';
                                    const isRejected = item.status === 'REJECTED';
                                    const isFailed = item.status === 'FAILED';

                                    return (
                                        <tr key={item.id} className="hover:bg-slate-50/80 transition">
                                            {/* ID & Time */}
                                            <td className="py-3.5 px-4 font-mono">
                                                <div className="font-bold text-slate-900">{item.id}</div>
                                                <div className="text-[11px] text-slate-400 mt-0.5">
                                                    {new Date(item.enqueuedAt).toLocaleString('ko-KR', {
                                                        month: '2-digit',
                                                        day: '2-digit',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                        second: '2-digit'
                                                    })}
                                                </div>
                                            </td>

                                            {/* Kind & Channel */}
                                            <td className="py-3.5 px-4">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                        {item.kind}
                                                    </span>
                                                    <span className="text-[11px] text-slate-500 font-semibold">
                                                        {item.channel}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-1">
                                                    등록: {item.enqueuedBy}
                                                </div>
                                            </td>

                                            {/* Recipient */}
                                            <td className="py-3.5 px-4">
                                                <div className="font-semibold text-slate-800">{item.to}</div>
                                                {item.replyTo && (
                                                    <div className="text-[11px] text-slate-400">
                                                        회신: {item.replyTo}
                                                    </div>
                                                )}
                                                {item.orderId && (
                                                    <div className="text-[11px] text-teal-600 font-semibold mt-0.5">
                                                        주문: {item.orderId}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Subject */}
                                            <td className="py-3.5 px-4 max-w-xs truncate font-semibold text-slate-800" title={item.subject}>
                                                {item.subject}
                                            </td>

                                            {/* Attachments */}
                                            <td className="py-3.5 px-4">
                                                {item.attachments && item.attachments.length > 0 ? (
                                                    <div className="flex items-center gap-1 text-teal-700 bg-teal-50 px-2 py-1 rounded border border-teal-200 w-fit">
                                                        <FileText className="w-3.5 h-3.5" />
                                                        <span className="font-bold">{item.attachments.length}건</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-400 text-[11px]">첨부 없음</span>
                                                )}
                                            </td>

                                            {/* Status & Approver */}
                                            <td className="py-3.5 px-4">
                                                {isPending && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                                                        <Clock className="w-3 h-3" />
                                                        {item.approverRole === 'SALES' ? '영업자 결재대기' : '사무실 결재대기'}
                                                    </span>
                                                )}
                                                {isSent && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        발송 완료
                                                    </span>
                                                )}
                                                {isRejected && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                                                        <XCircle className="w-3 h-3" />
                                                        반려됨
                                                    </span>
                                                )}
                                                {isFailed && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-200 text-slate-800">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        전송 실패
                                                    </span>
                                                )}

                                                {item.approvedBy && (
                                                    <div className="text-[10px] text-slate-400 mt-1">
                                                        승인: {item.approvedBy.name}
                                                    </div>
                                                )}
                                                {item.rejectedBy && (
                                                    <div className="text-[10px] text-rose-500 mt-1">
                                                        반려: {item.rejectedBy.name} ({item.rejectedBy.reason})
                                                    </div>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="py-3.5 px-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    {isPending && (
                                                        <>
                                                            <button
                                                                onClick={() => handleApprove(item)}
                                                                disabled={actionLoading}
                                                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[11px] transition shadow-sm flex items-center gap-1"
                                                            >
                                                                <CheckCircle2 className="w-3 h-3" />
                                                                승인
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setRejectModalItem(item);
                                                                    setRejectReason('');
                                                                }}
                                                                disabled={actionLoading}
                                                                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-bold text-[11px] transition flex items-center gap-1"
                                                            >
                                                                <XCircle className="w-3 h-3" />
                                                                반려
                                                            </button>
                                                        </>
                                                    )}

                                                    {(isFailed || isRejected) && (
                                                        <button
                                                            onClick={() => handleRetry(item)}
                                                            disabled={actionLoading}
                                                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded font-bold text-[11px] transition flex items-center gap-1"
                                                        >
                                                            <RotateCcw className="w-3 h-3" />
                                                            재시도
                                                        </button>
                                                    )}

                                                    <button
                                                        onClick={() => setSelectedItem(item)}
                                                        className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-slate-600 text-[11px] font-semibold transition"
                                                    >
                                                        상세
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Drawer / Modal */}
            {selectedItem && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                            <div>
                                <span className="text-xs font-bold text-teal-600 font-mono">{selectedItem.id}</span>
                                <h3 className="text-lg font-black text-slate-800">{selectedItem.subject}</h3>
                            </div>
                            <button
                                onClick={() => setSelectedItem(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                            >
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Meta Details */}
                        <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <div>
                                <span className="text-slate-400">발송 채널 / 유형:</span>
                                <div className="font-bold text-slate-800 mt-0.5">{selectedItem.channel} ({selectedItem.kind})</div>
                            </div>
                            <div>
                                <span className="text-slate-400">수신처:</span>
                                <div className="font-bold text-slate-800 mt-0.5">{selectedItem.to}</div>
                            </div>
                            <div>
                                <span className="text-slate-400">회신 (Reply-To):</span>
                                <div className="font-bold text-slate-800 mt-0.5">{selectedItem.replyTo || '-'}</div>
                            </div>
                            <div>
                                <span className="text-slate-400">등록 주체:</span>
                                <div className="font-bold text-slate-800 mt-0.5">{selectedItem.enqueuedBy}</div>
                            </div>
                        </div>

                        {/* Body Preview */}
                        <div>
                            <div className="text-xs font-bold text-slate-600 mb-1.5">본문 내용 미리보기:</div>
                            <div className="bg-slate-900 text-slate-100 p-4 rounded-xl text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                                {selectedItem.body}
                            </div>
                        </div>

                        {/* Attachments */}
                        {selectedItem.attachments && selectedItem.attachments.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-slate-600 mb-1.5">첨부 파일 ({selectedItem.attachments.length}개):</div>
                                <div className="space-y-1.5">
                                    {selectedItem.attachments.map((att, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                                            <div className="flex items-center gap-2 font-medium text-slate-800">
                                                <FileText className="w-4 h-4 text-teal-600" />
                                                <span>{att.fileName}</span>
                                            </div>
                                            {att.path && (
                                                <span className="text-[11px] text-slate-400 truncate max-w-xs">{att.path}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Dispatch Result */}
                        {selectedItem.dispatchResult && (
                            <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl text-xs text-emerald-800">
                                <div className="font-bold flex items-center gap-1.5 mb-1">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                    <span>발송 완료 및 격리 가드 리포트</span>
                                </div>
                                <div className="text-[11px] font-mono whitespace-pre-wrap">
                                    {JSON.stringify(selectedItem.dispatchResult, null, 2)}
                                </div>
                            </div>
                        )}

                        {/* Modal Footer Actions */}
                        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                            {selectedItem.status === 'PENDING_APPROVAL' && (
                                <>
                                    <button
                                        onClick={() => handleApprove(selectedItem)}
                                        disabled={actionLoading}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow transition flex items-center gap-1.5"
                                    >
                                        <CheckCircle2 className="w-4 h-4" />
                                        최종 승인 및 발송
                                    </button>
                                    <button
                                        onClick={() => {
                                            setRejectModalItem(selectedItem);
                                            setRejectReason('');
                                        }}
                                        disabled={actionLoading}
                                        className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-bold text-xs transition flex items-center gap-1.5"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        반려
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setSelectedItem(null)}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs transition"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Reason Modal */}
            {rejectModalItem && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5 text-rose-600">
                                <AlertTriangle className="w-5 h-5" />
                                발송 요청 반려 (Reject)
                            </h3>
                            <button onClick={() => setRejectModalItem(null)}>
                                <XCircle className="w-5 h-5 text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>

                        <p className="text-xs text-slate-500">
                            <strong>[{rejectModalItem.subject}]</strong> 항목을 반려합니다. 
                            반려 사유는 해당 에이전트와 주문 감사 이력에 기록됩니다.
                        </p>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">반려 사유 입력:</label>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="예: 단가 재확인 필요, 첨부 서류 누락 등"
                                rows={3}
                                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs font-medium focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => setRejectModalItem(null)}
                                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleRejectSubmit}
                                disabled={actionLoading}
                                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs shadow"
                            >
                                반려 확정
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
