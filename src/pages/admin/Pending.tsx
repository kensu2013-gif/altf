import { useMemo, useState, useEffect, Fragment } from 'react';
import { useStore } from '../../store/useStore';
import { FileText, PackageX, Calendar, Search, Filter, MessageSquare, Send, X, Trash2, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { CalmPageShell } from '../../components/ui/CalmPageShell';
import { PageTransition } from '../../components/ui/PageTransition';

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
}

interface PendingOrderGroup {
    orderId: string;
    poNumber: string;
    poDate: string;
    deliveryDate: string;
    customerName: string;
    targetCustomerName: string;
    items: PendingItem[];
}

export default function PendingOrders() {
    const { orders, setOrders, updateOrder } = useStore((state) => state);
    const user = useStore((state) => state.auth.user);

    // Filters
    const [searchCustomer, setSearchCustomer] = useState('');
    const [searchPo, setSearchPo] = useState('');
    const [dateFilter, setDateFilter] = useState<'ALL' | 'URGENT' | 'URGENT_NO_COMMENT'>('URGENT'); // URGENT = <= 7 days
    const [tagFilter, setTagFilter] = useState<string>('ALL'); // [NEW] Tag FILTER

    // Comment State
    const [activeCommentItemId, setActiveCommentItemId] = useState<string | null>(null);
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
        if (user.id) headers['x-requester-id'] = user.id;
        if (user.role) headers['x-requester-role'] = user.role;

        const endpoint = `${import.meta.env.VITE_API_URL || ''}/api/my/orders`;

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
        window.addEventListener('focus', fetchOrders);
        return () => window.removeEventListener('focus', fetchOrders);
    }, [setOrders, user]);

    // Flatten and Filter Items
    const pendingOrderGroups: PendingOrderGroup[] = useMemo(() => {
        const itemsList: PendingItem[] = [];

        orders.forEach(order => {
            if (order.isDeleted || order.status === 'CANCELLED') return;
            if (!order.po_items || order.po_items.length === 0) return;

            const poDateRaw = order.createdAt;
            const poDateFormatted = new Date(poDateRaw).toLocaleDateString();

            // Extract delivery date. Order adminResponse or order memo might hold it, fallback to createdAt + 7 for demo if nothing
            const deliveryDateStr = order.adminResponse?.deliveryDate || poDateRaw;

            const targetCustomer = order.poEndCustomer || order.payload?.customer?.company_name || order.payload?.customer?.contact_name || order.customerName;

            order.po_items.forEach(poItem => {
                if (poItem.poSent && !poItem.transactionIssued) {
                    itemsList.push({
                        orderId: order.id,
                        poNumber: order.poNumber || 'N/A',
                        poDate: poDateFormatted,
                        customerName: order.customerName,
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
                        tags: poItem.tags || []
                    });
                }
            });
        });

        // Apply Filters
        const filtered = itemsList.filter(item => {
            const matchCust = item.targetCustomerName.toLowerCase().includes(searchCustomer.toLowerCase()) ||
                item.customerName.toLowerCase().includes(searchCustomer.toLowerCase());
            const matchPo = item.poNumber.toLowerCase().includes(searchPo.toLowerCase());

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

            return matchCust && matchPo && matchDate && matchTag;
        });

        const groupedMap = new Map<string, PendingOrderGroup>();
        filtered.forEach(item => {
            if (!groupedMap.has(item.orderId)) {
                groupedMap.set(item.orderId, {
                    orderId: item.orderId,
                    poNumber: item.poNumber,
                    poDate: item.poDate,
                    deliveryDate: item.deliveryDate,
                    customerName: item.customerName,
                    targetCustomerName: item.targetCustomerName,
                    items: []
                });
            }
            groupedMap.get(item.orderId)!.items.push(item);
        });

        // Sort by 납기 임박순 (Delivery Date ascending)
        return Array.from(groupedMap.values()).sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime());
    }, [orders, searchCustomer, searchPo, dateFilter, tagFilter]);

    // Handlers
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
        if (pendingOrderGroups.length === 0) {
            alert("다운로드할 데이터가 없습니다.");
            return;
        }

        const headers = ['고객명', '발주번호', '발주일자', '납기일자', '납기상태', '상태(태그)', '품목명', '규격', '수량', '메모(특이사항)', '코멘트'];
        const csvRows = [headers.join(',')];

        pendingOrderGroups.forEach(group => {
            group.items.forEach(item => {
                const spec = `${item.thickness || ''} ${item.size || ''} ${item.material || ''}`.trim();
                const statusInfo = getDeliveryStatus(item.deliveryDate);
                const statusText = statusInfo.type === 'DELAYED' ? statusInfo.text : (statusInfo.type === 'IMMINENT' ? '임박' : '정상');

                const commentsString = item.comments && item.comments.length > 0
                    ? item.comments.map(c => `[${c.author}] ${c.content}`).join(' | ')
                    : '';

                const tagsString = item.tags && item.tags.length > 0
                    ? item.tags.join(', ')
                    : '';

                const row = [
                    `"${item.targetCustomerName || item.customerName}"`,
                    `"${item.poNumber}"`,
                    `"${item.poDate}"`,
                    `"${item.deliveryDate}"`,
                    `"${statusText}"`,
                    `"${tagsString}"`,
                    `"${item.itemName}"`,
                    `"${spec}"`,
                    item.quantity,
                    `"${item.memo.replace(/"/g, '""')}"`,
                    `"${commentsString.replace(/"/g, '""')}"`
                ];
                csvRows.push(row.join(','));
            });
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `미결관리록_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <CalmPageShell>
            <div className="mb-6 flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-6 h-6 text-teal-600" />
                    미결 관리 (Pending Orders)
                </h1>
                <p className="text-sm text-slate-500">
                    매입발주서는 발송 완료되었으나 아직 거래명세서가 발행되지 않은 품목(납기 대기) 목록입니다. 납기 임박순으로 표시됩니다.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-400 mr-2" />
                    <input
                        type="text"
                        placeholder="고객명 검색..."
                        value={searchCustomer}
                        onChange={(e) => setSearchCustomer(e.target.value)}
                        className="bg-transparent border-none outline-none text-sm w-full placeholder:text-slate-400 font-medium"
                    />
                </div>
                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-400 mr-2" />
                    <input
                        type="text"
                        placeholder="발주번호 검색 (ex: 456)"
                        value={searchPo}
                        onChange={(e) => setSearchPo(e.target.value)}
                        className="bg-transparent border-none outline-none text-sm w-full placeholder:text-slate-400 font-medium"
                    />
                </div>
                <div className="flex items-center gap-2">
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
                <div className="ml-auto">
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
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar">
                        <table className="w-full min-w-[1000px] text-sm text-left">
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
                                                                    <div className="font-bold text-slate-800">
                                                                        {group.targetCustomerName}
                                                                    </div>
                                                                    {group.customerName !== group.targetCustomerName && (
                                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                                            원주문: {group.customerName}
                                                                        </div>
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

                                                                        {/* Tags Display */}
                                                                        {item.tags && item.tags.length > 0 && item.tags.map(tag => (
                                                                            <span key={tag} className={`text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm border ${tag === '관리' ? 'bg-red-50 text-red-700 border-red-200' : tag === '재고품' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : tag === '사급' ? 'bg-amber-50 text-amber-700 border-amber-200' : tag === '생산중' ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' : tag === '출고대기' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                                                {tag}
                                                                            </span>
                                                                        ))}

                                                                        <span className="text-slate-900 bg-teal-50 px-1.5 py-0.5 rounded mr-1 leading-tight">{item.itemName}</span>
                                                                        {(item.thickness || item.size || item.material) && (
                                                                            <span className="text-slate-600 font-medium whitespace-nowrap">
                                                                                - {[item.thickness, item.size, item.material].filter(Boolean).join(' - ')}
                                                                            </span>
                                                                        )}
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
                                                                {item.quantity.toLocaleString()}
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
                                                                                    <p className="text-slate-600 leading-snug break-words whitespace-pre-wrap">{comment.content}</p>
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
                    </div>
                </div>
            </PageTransition >
        </CalmPageShell >
    );
}

