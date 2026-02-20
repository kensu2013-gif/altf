import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useStore, type DeliveryInfo } from '../store/useStore';
import { CalmPageShell } from '../components/ui/CalmPageShell';
import { PageTransition } from '../components/ui/PageTransition';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { renderDocumentHTML } from '../lib/documentTemplate';
import { PreviewModal } from '../components/ui/PreviewModal';
import { OrderSubmissionOverlay } from '../components/ui/OrderSubmissionOverlay';
import { EmailPackageAnimation } from '../components/ui/EmailPackageAnimation';
import { OrderService } from '../services/orderService';
import {
    User, FileText, ShoppingBag, Settings,
    ChevronRight, RefreshCw, Package, Check, X as XIcon, PenLine, Printer, Trash2
} from 'lucide-react';
import type { LineItem } from '../types';
import type { DocumentPayload, DocumentItem, DocumentType } from '../types/document';

interface QuotationRecord {
    id: string;
    userId: string;
    items: LineItem[];
    totalAmount: number;
    customerName: string;
    status: 'DRAFT' | 'SUBMITTED' | 'PROCESSING' | 'PROCESSED' | 'COMPLETED';
    createdAt: string;
    adminResponse?: {
        confirmedPrice?: number;
        deliveryDate?: string;
        note?: string;
        additionalCharges?: { name: string; amount: number; }[];
    };
}

interface OrderRecord {
    id: string;
    userId: string;
    items: LineItem[];
    totalAmount: number;
    customerName: string;
    status: string;
    createdAt: string;
    payload?: DocumentPayload; // Optional full payload
    adminResponse?: {
        confirmedPrice?: number;
        deliveryDate?: string;
        note?: string;
        additionalCharges?: { name: string; amount: number; }[];
    };
    lastUpdatedBy?: {
        name: string;
        id: string;
        email: string;
        at: string;
    };
}

interface MixedLineItem extends LineItem {
    no?: number;
    item_name?: string;
    qty?: number;
    unit_price?: number;
}

export default function MyPage() {
    const navigate = useNavigate();
    const user = useStore((state) => state.auth.user);
    const loadQuotation = useStore((state) => state.loadQuotation);

    const [activeTab, setActiveTab] = useState<'profile' | 'quotes' | 'orders'>('quotes');
    const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
    const [orders, setOrders] = useState<OrderRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [viewingRecord, setViewingRecord] = useState<{ type: 'QUOTE', record: QuotationRecord } | { type: 'ORDER', record: OrderRecord } | null>(null);
    const [previewPayload, setPreviewPayload] = useState<{ html: string; type: DocumentType; onOrder?: () => void; hidePrint?: boolean; hideClose?: boolean; } | null>(null);
    const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
    const [isOrderSubmitting, setIsOrderSubmitting] = useState(false);
    const [orderPayload, setOrderPayload] = useState<DocumentPayload | null>(null);

    // --- Custom Confirm Dialog State ---
    const [confirmConfig, setConfirmConfig] = useState<{
        isOpen: boolean;
        type: 'DELETE_QUOTE' | 'DELETE_ORDER' | 'REORDER' | null;
        targetId?: string; // ID for delete
        targetItems?: LineItem[]; // Items for reorder
        title: string;
        description: string;
        variant: 'primary' | 'danger';
    }>({
        isOpen: false,
        type: null,
        title: '',
        description: '',
        variant: 'primary'
    });

    const resetNewOrderCount = useStore((state) => state.resetNewOrderCount);



    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            // Fetch Quotations
            const quotesRes = await fetch(`${import.meta.env.VITE_API_URL}/api/my/quotations?userId=${user?.id}`);
            if (quotesRes.ok) setQuotations(await quotesRes.json());

            // Fetch Orders
            const ordersRes = await fetch(`${import.meta.env.VITE_API_URL}/api/my/orders?userId=${user?.id}`);
            if (ordersRes.ok) setOrders(await ordersRes.json());
        } catch (error) {
            console.error("Failed to fetch history", error);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }
        resetNewOrderCount();
        fetchData();

        // Auto-refresh when tab comes back into focus
        const onFocus = () => {

            fetchData();
        };
        window.addEventListener('focus', onFocus);

        return () => window.removeEventListener('focus', onFocus);
    }, [user, navigate, resetNewOrderCount, fetchData]);

    const handleReorder = (items: LineItem[]) => {
        setConfirmConfig({
            isOpen: true,
            type: 'REORDER',
            targetItems: items,
            title: '장바구니 불러오기',
            description: '이전 주문 품목을 장바구니에 담으시겠습니까?\n현재 장바구니에 담긴 내용은 모두 사라지고 대체됩니다.',
            variant: 'primary'
        });
    };

    const handleDeleteQuotation = (id: string) => {
        setConfirmConfig({
            isOpen: true,
            type: 'DELETE_QUOTE',
            targetId: id,
            title: '견적 내역 삭제',
            description: '정말로 이 견적 내역을 삭제하시겠습니까?\n삭제된 내역은 복구할 수 없습니다.',
            variant: 'danger'
        });
    };

    const handleDeleteOrder = (id: string) => {
        setConfirmConfig({
            isOpen: true,
            type: 'DELETE_ORDER',
            targetId: id,
            title: '주문 내역 삭제',
            description: '정말로 이 주문 내역을 삭제하시겠습니까?\n삭제된 내역은 복구할 수 없습니다.',
            variant: 'danger'
        });
    };

    const executeConfirmAction = async () => {
        const { type, targetId, targetItems } = confirmConfig;

        // Close immediately
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));

        if (type === 'REORDER' && targetItems) {
            loadQuotation(targetItems);
            navigate('/quote');
        }
        else if (type === 'DELETE_QUOTE' && targetId) {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL}/api/my/quotations/${targetId}`, { method: 'DELETE' });
                if (res.ok) {
                    setQuotations(prev => prev.filter(q => q.id !== targetId));
                } else {
                    alert('삭제하지 못했습니다.');
                }
            } catch (error) {
                console.error(error);
                alert('삭제 중 오류가 발생했습니다.');
            }
        }
        else if (type === 'DELETE_ORDER' && targetId) {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL}/api/my/orders/${targetId}`, { method: 'DELETE' });
                if (res.ok) {
                    setOrders(prev => prev.filter(o => o.id !== targetId));
                } else {
                    alert('삭제하지 못했습니다.');
                }
            } catch (error) {
                console.error(error);
                alert('삭제 중 오류가 발생했습니다.');
            }
        }
    };



    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
    };

    const handleOrderFromQuote = (items: LineItem[]) => {
        loadQuotation(items);
        navigate('/quote');
    };

    const handleSuccessAnimationComplete = () => {
        setShowSuccessAnimation(false);
        window.location.reload();
    };


    const handleInitiateOrder = (quote: QuotationRecord) => {
        // Construct Order Payload from Quote
        const now = new Date();
        const docNo = `O-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`;

        const docItems: DocumentItem[] = quote.items.map((item, idx) => {
            const mixed = item as MixedLineItem;
            return {
                no: idx + 1,
                item_id: item.itemId || item.id, // Ensure ID is passed
                item_name: mixed.item_name || item.name,
                thickness: item.thickness,
                size: item.size,
                material: item.material,
                stock_qty: item.currentStock || 0,
                stock_status: (item.currentStock !== undefined)
                    ? (item.currentStock === 0 ? '재고없음' : ((mixed.qty || item.quantity) > item.currentStock ? '일부 주문생산' : '출고가능'))
                    : '-',
                location_maker: item.maker ? `${item.location || ''} / ${item.maker}` : (item.location || '-'),
                qty: mixed.qty || item.quantity,
                unit_price: mixed.unit_price || item.unitPrice,
                amount: (mixed.qty || item.quantity) * (mixed.unit_price || item.unitPrice),
                rate: item.discountRate // Carry over negotiated rate
            };
        });

        const payload: DocumentPayload = {
            document_type: 'ORDER',
            meta: {
                doc_no: docNo,
                created_at: now.toLocaleString(),
                channel: 'WEB',
                delivery_date: quote.adminResponse?.deliveryDate // Carry over confirmed date
            },
            supplier: {
                company_name: '알트에프(ALTF)',
                contact_name: '관리자',
                address: '부산광역시 사상구 낙동대로 1330번길 66',
                tel: '051-303-3751',
                fax: '0504-376-3751',
                email: 'altf@altf.kr',
                business_no: '838-05-01054'
            },
            customer: {
                company_name: quote.customerName || '고객사',
                contact_name: user?.contactName || '-',
                tel: user?.phone || '-',
                email: user?.email || '-',
                address: user?.address || '-',
                memo: quote.adminResponse?.note // Pass generic note if needed
            },
            items: docItems,
            totals: {
                total_amount: quote.adminResponse?.confirmedPrice || quote.totalAmount, // Use confirmed price
                currency: 'KRW',
                additional_charges: quote.adminResponse?.additionalCharges // Carry over charges
            }
        };

        setOrderPayload(payload);
        setPreviewPayload(null); // Close Preview
        setIsOrderSubmitting(true); // Open Order Overlay
    };

    const handleSubmitOrder = async (deliveryInfo: DeliveryInfo) => {
        if (!orderPayload) return;

        const finalPayload = { ...orderPayload };
        if (finalPayload.customer) {
            // Update Customer Fields with specific Delivery Info
            finalPayload.customer.contact_name = deliveryInfo.contactName;
            finalPayload.customer.tel = deliveryInfo.contactPhone;

            const methodPrefix = deliveryInfo.method === 'FREIGHT' ? '[화물] ' : '[택배] ';
            const addressDetail = deliveryInfo.method === 'FREIGHT' ? deliveryInfo.branchName : deliveryInfo.address;
            finalPayload.customer.address = `${methodPrefix}${addressDetail}`;

            const deliveryNote = `[배송: ${deliveryInfo.method === 'FREIGHT' ? '화물' : '택배'}] ` +
                `${deliveryInfo.method === 'FREIGHT' ? deliveryInfo.branchName : deliveryInfo.address} ` +
                `| 담당자: ${deliveryInfo.contactName} (${deliveryInfo.contactPhone})` +
                (deliveryInfo.additionalRequest ? ` | 요청: ${deliveryInfo.additionalRequest}` : '');

            finalPayload.customer.memo = finalPayload.customer.memo
                ? `${finalPayload.customer.memo}\n${deliveryNote}`
                : deliveryNote;
        }

        const result = await OrderService.submitOrder(finalPayload);
        if (result.success) {
            setIsOrderSubmitting(false);
            resetNewOrderCount();
            setShowSuccessAnimation(true);
            fetchData(); // Refresh list
        } else {
            alert('발주서 전송에 실패했습니다.');
        }
    };

    const handleViewAnswer = (quote: QuotationRecord) => {

        if (!['PROCESSED', 'processed', 'COMPLETED', 'completed'].includes(quote.status)) return;

        const docNo = `Q-ANS-${quote.id.slice(0, 8)}`;

        // ... (Item mapping logic remains same)

        const docItems: DocumentItem[] = quote.items.map((item, idx) => {
            const mixed = item as MixedLineItem;
            return {
                no: idx + 1,
                item_name: mixed.item_name || item.name,
                thickness: item.thickness,
                size: item.size,
                material: item.material,
                stock_qty: item.currentStock || 0,
                stock_status: (item.currentStock !== undefined)
                    ? (item.currentStock === 0 ? '재고없음' : ((mixed.qty || item.quantity) > item.currentStock ? '일부 주문생산' : '출고가능'))
                    : '-',
                location_maker: item.maker ? `${item.location || ''} / ${item.maker}` : (item.location || '-'),
                qty: mixed.qty || item.quantity,
                unit_price: mixed.unit_price || item.unitPrice,
                amount: (mixed.qty || item.quantity) * (mixed.unit_price || item.unitPrice),
            };
        });

        const payload: DocumentPayload = {
            document_type: 'QUOTATION',
            meta: {
                doc_no: docNo,
                created_at: new Date(quote.createdAt).toLocaleString(),
                channel: 'WEB',
                delivery_date: quote.adminResponse?.deliveryDate
            },
            supplier: {
                company_name: '알트에프(ALTF)',
                contact_name: '관리자',
                address: '부산광역시 사상구 낙동대로 1330번길 66',
                tel: '051-303-3751',
                fax: '0504-376-3751',
                email: 'altf@altf.kr',
                business_no: '838-05-01054',
                note: quote.adminResponse?.note
            },
            customer: {
                company_name: quote.customerName || '고객사',
                contact_name: user?.contactName || '-',
                tel: user?.phone || '-',
                email: user?.email || '-',
                address: user?.address || '-' // [FIX] Add Address
            },
            items: docItems,
            totals: {
                total_amount: quote.totalAmount, // View Quote uses original amount? Or confirmed? Usually Quote view shows what was sent.
                // Actually if Admin Confirmed Price, we should probably show it? 
                // But Quote Record has totalAmount. Let's stick to Record's totalAmount for Quote View, 
                // but Order uses Confirmed Price.
                // Wait, if Admin changed price, quote.totalAmount deals with it? 
                // AdminQuoteDetail updates state. If saved, it updates DB quote.totalAmount.
                // So quote.totalAmount SHOULD be correct.
                currency: 'KRW',
                additional_charges: quote.adminResponse?.additionalCharges
            }
        };

        const html = renderDocumentHTML(payload);

        // Pass onOrder handler if processed or completed (allow re-order)
        const onOrderHandler = ['PROCESSED', 'processed', 'COMPLETED', 'completed'].includes(quote.status)
            ? () => handleInitiateOrder(quote)
            : undefined;

        setPreviewPayload({
            html,
            type: 'QUOTATION',
            onOrder: onOrderHandler,
            hidePrint: false,
            hideClose: false
        });
    };

    const handleViewOrderReceipt = (order: OrderRecord) => {
        // Only show if there's an admin response or if it's in a state where one might exist
        if (!order.adminResponse && order.status === 'SUBMITTED') return;

        const docNo = `ORD-RCPT-${order.id.slice(0, 8)}`;

        const docItems: DocumentItem[] = order.items.map((item, idx) => {
            const mixed = item as MixedLineItem;
            // Revert Simplified View: Use full specs
            return {
                no: idx + 1,
                item_name: mixed.item_name || item.name,
                thickness: item.thickness, // Pass explicitly
                size: item.size, // Pass explicitly
                material: item.material, // Pass explicitly
                stock_qty: item.currentStock || 0,
                stock_status: '-',
                location_maker: item.maker ? `${item.location || ''} / ${item.maker}` : (item.location || '-'),
                qty: mixed.qty || item.quantity,
                unit_price: mixed.unit_price || item.unitPrice,
                amount: (mixed.qty || item.quantity) * (mixed.unit_price || item.unitPrice),
            };
        });

        const payload: DocumentPayload = {
            document_type: 'ORDER_RECEIPT', // Now uses full columns logic
            meta: {
                doc_no: docNo,
                created_at: new Date(order.createdAt).toLocaleString(),
                channel: 'WEB',
                title: '발주 접수 확인증 (Order Receipt)',
                delivery_date: order.adminResponse?.deliveryDate
            },
            supplier: {
                company_name: '알트에프(ALTF)',
                // Contact Name from Admin who last updated it, or fallback to Admin
                contact_name: order.lastUpdatedBy?.name || '관리자',
                address: '부산광역시 사상구 낙동대로 1330번길 66',
                tel: '051-303-3751',
                fax: '0504-376-3751',
                email: 'altf@altf.kr',
                business_no: '838-05-01054',
                note: order.adminResponse?.note
            },
            customer: {
                // Use Profile Info specifically as requested
                company_name: user?.companyName || order.customerName || '고객사',
                contact_name: user?.contactName || '-',
                tel: user?.phone || '-',
                email: user?.email || '-',
                address: user?.address // Use Sign-up Address
            },
            items: docItems,
            totals: {
                total_amount: order.adminResponse?.confirmedPrice || order.totalAmount, // Use confirmed if avail
                currency: 'KRW',
                additional_charges: order.adminResponse?.additionalCharges
            }
        };

        const html = renderDocumentHTML(payload);

        // Show Print and Close buttons at bottom as requested
        setPreviewPayload({
            html,
            type: 'ORDER'
            // Buttons are enabled by default in PreviewModal
        });
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            SUBMITTED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
            PROCESSED: 'bg-teal-100 text-teal-800 border-teal-200',
            COMPLETED: 'bg-green-100 text-green-800 border-green-200',
            processing: 'bg-blue-100 text-blue-800 border-blue-200',
            shipped: 'bg-indigo-100 text-indigo-800 border-indigo-200',
            completed: 'bg-green-100 text-green-800 border-green-200',
        };
        const labels: Record<string, string> = {
            SUBMITTED: '견적확인중',
            PROCESSING: '답변작성중',
            PROCESSED: '답변 완료',
            COMPLETED: '주문 접수', // Mapped to '주문 접수' as requested
            CANCELED: '취소됨',
            submitted: '주문 접수', // Mapped to '주문 접수' (Order)
            processing: '처리중',
            shipped: '배송중',
            completed: '완료됨',
        };
        const displayStatus = status || 'SUBMITTED';
        return (
            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${styles[displayStatus] || styles[status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                {labels[displayStatus] || displayStatus}
            </span>
        );
    };

    if (!user) return null;

    return (
        <CalmPageShell>
            <PageTransition>
                <div className="max-w-[1240px] mx-auto px-6 py-12 relative min-h-[800px]">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                        <div>
                            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">마이 페이지 (My Page)</h1>
                            <p className="text-slate-500 font-medium">계정 정보 및 주문 내역을 관리하세요.</p>
                        </div>

                    </div>

                    <div className="flex flex-col lg:flex-row gap-8">
                        {/* Sidebar Navigation */}
                        <div className="w-full lg:w-64 space-y-2 shrink-0">
                            <NavItem
                                active={activeTab === 'quotes'}
                                onClick={() => setActiveTab('quotes')}
                                icon={<FileText className="w-5 h-5" />}
                                label="견적서 내역 (Quotations)"
                            />
                            <NavItem
                                active={activeTab === 'orders'}
                                onClick={() => setActiveTab('orders')}
                                icon={<ShoppingBag className="w-5 h-5" />}
                                label="주문 내역 (Orders)"
                            />
                            <NavItem
                                active={activeTab === 'profile'}
                                onClick={() => setActiveTab('profile')}
                                icon={<Settings className="w-5 h-5" />}
                                label="계정 설정 (Account)"
                            />
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 bg-white/60 backdrop-blur-md rounded-2xl border border-white/40 shadow-xl p-6 min-h-[500px]">
                            {isLoading ? (
                                <div className="flex justify-center items-center h-48">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
                                </div>
                            ) : (
                                <AnimatePresence mode="wait">
                                    {activeTab === 'quotes' && (
                                        <motion.div
                                            key="quotes"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            className="space-y-4"
                                        >
                                            <div className="flex items-center justify-between mb-4">
                                                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                                    <FileText className="w-6 h-6 text-teal-600" />
                                                    최근 견적서 발급 내역
                                                </h2>
                                                <Button size="sm" variant="ghost" onClick={fetchData} className="text-slate-400 hover:text-teal-600">
                                                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                                </Button>
                                            </div>
                                            {quotations.length === 0 ? (
                                                <EmptyState message="발급된 견적서가 없습니다." />
                                            ) : (
                                                <div className="space-y-3">
                                                    {quotations.map(quote => (
                                                        <div key={quote.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    {getStatusBadge(quote.status)}
                                                                    <span className="text-slate-300">|</span>
                                                                    <span className="text-slate-400 text-xs font-mono">{quote.id.slice(0, 8)}</span>
                                                                    <span className="text-slate-300">|</span>
                                                                    <span className="text-slate-600 font-medium text-sm">{formatDate(quote.createdAt)}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="font-bold text-slate-800">{formatCurrency(quote.totalAmount)}</span>
                                                                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                                                        {quote.items.length}개 품목
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {quote.status === 'PROCESSED' || quote.status === 'COMPLETED' ? (
                                                                    <Button size="sm" onClick={() => handleViewAnswer(quote)} className="gap-1 bg-yellow-400 text-slate-900 hover:bg-yellow-500 shadow-md shadow-yellow-500/20 font-bold border border-yellow-500/50">
                                                                        <FileText className="w-3 h-3" />
                                                                        답변서 보기
                                                                    </Button>
                                                                ) : (
                                                                    <Button size="sm" disabled className="gap-1 bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed">
                                                                        <FileText className="w-3 h-3" />
                                                                        답변서 대기중
                                                                    </Button>
                                                                )}
                                                                <Button size="sm" variant="outline" onClick={() => setViewingRecord({ type: 'QUOTE', record: quote })} className="border-slate-200 text-slate-600 hover:bg-slate-50">
                                                                    상세보기
                                                                </Button>
                                                                <Button size="sm" onClick={() => handleReorder(quote.items)} className="gap-1 bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200">
                                                                    <RefreshCw className="w-3 h-3" />
                                                                    품목 불러오기
                                                                </Button>

                                                                <Button size="sm" variant="outline" onClick={() => handleDeleteQuotation(quote.id)} className="border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                                                                    <Trash2 className="w-3 h-3" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </motion.div>
                                    )}

                                    {activeTab === 'orders' && (
                                        <motion.div
                                            key="orders"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            className="space-y-4"
                                        >
                                            <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                                                <ShoppingBag className="w-6 h-6 text-teal-600" />
                                                최근 주문 내역
                                            </h2>
                                            {orders.length === 0 ? (
                                                <EmptyState message="주문 내역이 없습니다." />
                                            ) : (
                                                <div className="space-y-3">
                                                    {orders.map(order => (
                                                        <div key={order.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow">
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    {getStatusBadge(order.status)}
                                                                    <span className="text-slate-300">|</span>
                                                                    <span className="text-slate-600 font-medium text-sm">{formatDate(order.createdAt)}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3 mt-1">
                                                                    <span className="font-bold text-slate-800">{formatCurrency(order.totalAmount)}</span>
                                                                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                                                        {order.items.length}개 품목
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                                                {/* View Receipt Button - Show only if status starts processing (Admin handles it) */}
                                                                {['PROCESSING', 'PROCESSED', 'SHIPPED', 'COMPLETED', 'processing', 'shipped', 'completed'].includes(order.status) && (
                                                                    <Button size="sm" onClick={() => handleViewOrderReceipt(order)} className="gap-1 bg-yellow-400 text-slate-900 hover:bg-yellow-500 shadow-md shadow-yellow-500/20 font-bold border border-yellow-500/50 flex-1 sm:flex-none">
                                                                        <FileText className="w-3 h-3" />
                                                                        접수증 보기
                                                                    </Button>
                                                                )}
                                                                <Button size="sm" variant="outline" onClick={() => setViewingRecord({ type: 'ORDER', record: order })} className="flex-1 sm:flex-none border-slate-200 text-slate-600 hover:bg-slate-50">
                                                                    상세보기
                                                                </Button>
                                                                <Button size="sm" onClick={() => handleReorder(order.items)} className="gap-1 bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200 flex-1 sm:flex-none">
                                                                    <RefreshCw className="w-3 h-3" />
                                                                    재주문 (Cart)
                                                                </Button>
                                                                <Button size="sm" variant="outline" onClick={() => handleDeleteOrder(order.id)} className="border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                                                                    <Trash2 className="w-3 h-3" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </motion.div>
                                    )}

                                    {activeTab === 'profile' && (
                                        <motion.div
                                            key="profile"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            className="space-y-6"
                                        >
                                            <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                                                <User className="w-6 h-6 text-teal-600" />
                                                계정 정보
                                            </h2>

                                            <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-6">
                                                <div>
                                                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">이메일 (Email)</label>
                                                    <div className="text-slate-800 font-medium text-lg px-3 py-2 bg-slate-50 rounded-lg border border-transparent">
                                                        {user.email}
                                                    </div>
                                                </div>

                                                <ProfileField
                                                    label="회사명 (Company)"
                                                    value={user.companyName || ''}
                                                    onSave={(newValue) => {
                                                        if (user?.id) {
                                                            useStore.getState().updateUser(user.id, { companyName: newValue });
                                                        }
                                                    }}
                                                />

                                                <PasswordChangeField />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            )}
                        </div>
                    </div>
                </div>
            </PageTransition>

            <AnimatePresence>
                {viewingRecord && (
                    <DetailModal
                        record={viewingRecord.record}
                        isOrder={viewingRecord.type === 'ORDER'}
                        onClose={() => setViewingRecord(null)}
                        onOrder={() => {
                            if (viewingRecord.type === 'QUOTE') { // If quote
                                handleOrderFromQuote(viewingRecord.record.items);
                            }
                        }}
                    />
                )}
            </AnimatePresence>

            <ConfirmDialog
                isOpen={confirmConfig.isOpen}
                title={confirmConfig.title}
                description={confirmConfig.description.split('\n').map((line, i) => (
                    <span key={i} className="block">{line}</span>
                ))}
                confirmVariant={confirmConfig.variant}
                onConfirm={executeConfirmAction}
                onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
            />

            {
                previewPayload && (
                    <PreviewModal
                        htmlContent={previewPayload.html}
                        docType={previewPayload.type}
                        onClose={() => setPreviewPayload(null)}
                        onOrder={previewPayload.onOrder}
                        hidePrint={previewPayload.hidePrint}
                        hideClose={previewPayload.hideClose}
                    />
                )
            }
            <EmailPackageAnimation isOpen={showSuccessAnimation} onComplete={handleSuccessAnimationComplete} />

            <OrderSubmissionOverlay
                isOpen={isOrderSubmitting}
                onClose={() => setIsOrderSubmitting(false)}
                onConfirm={handleSubmitOrder}
                basePayload={orderPayload}
            />
        </CalmPageShell >
    );
}

function NavItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-all ${active
                ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/30 ring-1 ring-teal-500'
                : 'bg-white/50 text-slate-600 hover:bg-white hover:text-teal-700'
                }`}
        >
            {icon}
            {label}
            {active && <ChevronRight className="w-4 h-4 ml-auto opacity-50" />}
        </button>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Package className="w-12 h-12 mb-3 opacity-20" />
            <p>{message}</p>
        </div>
    );
}

function PasswordChangeField() {
    const [isEditing, setIsEditing] = useState(false);
    const [passwords, setPasswords] = useState({ new: '', confirm: '' });
    const user = useStore((state) => state.auth.user);
    const updateUser = useStore((state) => state.updateUser);

    const handleSave = async () => {
        if (!passwords.new || passwords.new.length < 4) {
            alert('비밀번호는 4자 이상이어야 합니다.');
            return;
        }
        if (passwords.new !== passwords.confirm) {
            alert('비밀번호가 일치하지 않습니다.');
            return;
        }

        if (user?.id) {
            if (confirm('비밀번호를 변경하시겠습니까?')) {
                await updateUser(user.id, { password: passwords.new });
                alert('비밀번호가 변경되었습니다. 다음 로그인 시 새 비밀번호를 사용해주세요.');
                setIsEditing(false);
                setPasswords({ new: '', confirm: '' });
            }
        }
    };

    const handleCancel = () => {
        setPasswords({ new: '', confirm: '' });
        setIsEditing(false);
    };

    return (
        <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-400 uppercase">비밀번호 변경 (Password)</label>
                {!isEditing && (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="text-xs flex items-center gap-1 text-teal-600 hover:text-teal-700 font-medium transition-colors"
                    >
                        <PenLine className="w-3 h-3" /> 변경하기
                    </button>
                )}
            </div>

            {isEditing ? (
                <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1">새 비밀번호</label>
                        <input
                            type="password"
                            value={passwords.new}
                            onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                            placeholder="새 비밀번호 입력"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1">비밀번호 확인</label>
                        <input
                            type="password"
                            value={passwords.confirm}
                            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                            placeholder="비밀번호 재입력"
                        />
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                        <Button size="sm" variant="outline" onClick={handleCancel} className="text-slate-500">
                            취소
                        </Button>
                        <Button size="sm" onClick={handleSave} className="bg-teal-600 text-white hover:bg-teal-700">
                            변경 저장
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="text-slate-400 text-sm">
                    ************
                </div>
            )}
        </div>
    );
}

function ProfileField({ label, value, onSave }: { label: string, value: string, onSave: (val: string) => void }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);

    const handleSave = () => {
        onSave(editValue);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(value);
        setIsEditing(false);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-400 uppercase">{label}</label>
                {!isEditing && (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="text-xs flex items-center gap-1 text-teal-600 hover:text-teal-700 font-medium transition-colors"
                    >
                        <PenLine className="w-3 h-3" /> 수정
                    </button>
                )}
            </div>

            {isEditing ? (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="flex-1 px-3 py-2 border border-teal-500 rounded-lg outline-none ring-2 ring-teal-500/20 text-slate-900"
                        autoFocus
                        title={label}
                        placeholder={label}
                    />
                    <Button size="sm" onClick={handleSave} className="bg-teal-600 hover:bg-teal-700 text-white">
                        <Check className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleCancel} className="text-slate-500 hover:text-slate-700">
                        <XIcon className="w-4 h-4" />
                    </Button>
                </div>
            ) : (
                <div className="text-slate-800 font-medium text-lg px-3 py-2 bg-slate-50 rounded-lg border border-transparent flex items-center justify-between group">
                    {value || '-'}
                </div>
            )}
        </div>
    );
}

function DetailModal({ record, isOrder, onClose, onOrder }: { record: QuotationRecord | OrderRecord, isOrder: boolean, onClose: () => void, onOrder?: () => void }) {
    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewDocType, setPreviewDocType] = useState<DocumentType>('QUOTATION');

    if (!record) return null;
    const docType: DocumentType = isOrder ? 'ORDER' : 'QUOTATION';
    const quotation = !isOrder ? (record as QuotationRecord) : null;
    const isProcessed = !isOrder && record.status === 'PROCESSED';

    const formatCurrency = (amount: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);

    const handlePrint = () => {
        if (isOrder && (record as OrderRecord).payload) {
            // Exact Reprint using stored payload
            const storedPayload = (record as OrderRecord).payload!;
            setPreviewDocType('ORDER');
            setPreviewContent(renderDocumentHTML(storedPayload));
            return;
        }

        // ... Legacy reconstruction logic ...
        const docNo = `${docType === 'QUOTATION' ? 'Q-HIST' : 'O-HIST'}-${record.id.slice(0, 8)}`; // Use ID segment

        const docItems: DocumentItem[] = record.items.map((item, idx) => {
            const mixed = item as MixedLineItem;
            return {
                no: idx + 1,
                item_id: item.itemId,
                item_name: mixed.item_name || item.name,
                thickness: item.thickness,
                size: item.size,
                material: item.material,
                stock_qty: item.currentStock || 0,
                stock_status: (item.currentStock !== undefined)
                    ? (item.currentStock === 0 ? '재고없음' : ((mixed.qty || item.quantity) > item.currentStock ? '일부 주문생산' : '출고가능'))
                    : '-',
                location_maker: item.maker ? `${item.location || ''} / ${item.maker}` : (item.location || '-'),
                qty: mixed.qty || item.quantity,
                unit_price: mixed.unit_price || item.unitPrice,
                amount: (mixed.qty || item.quantity) * (mixed.unit_price || item.unitPrice),
                note: ''
            };
        });

        const payload: DocumentPayload = {
            document_type: docType,
            meta: {
                doc_no: docNo,
                created_at: new Date(record.createdAt).toLocaleString(),
                channel: 'WEB'
            },
            supplier: {
                company_name: '알트에프(ALTF)',
                contact_name: '관리자',
                address: '부산광역시 사상구 낙동대로 1330번길 66',
                tel: '051-303-3751',
                fax: '0504-376-3751',
                email: 'altf@altf.kr',
                business_no: '838-05-01054'
            },
            customer: {
                company_name: record.customerName || '고객사',
                contact_name: '-', // History might not have full contact details if not stored.
                tel: '-',
                email: '-'
            },
            items: docItems,
            totals: {
                total_amount: record.totalAmount,
                currency: 'KRW',
                additional_charges: quotation?.adminResponse?.additionalCharges
            }
        };

        const html = renderDocumentHTML(payload);
        setPreviewDocType(docType);
        setPreviewContent(html);
    };

    // Extract Memo for display
    const requestMemo = isOrder && (record as OrderRecord).payload?.customer?.memo;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden ring-1 ring-slate-900/5 animate-in zoom-in-95 duration-200">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-mono border ${isProcessed ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                    {isOrder ? '주문서' : '견적서'} #{record.id.slice(0, 8)}
                                </span>
                                상세 내역
                            </h3>
                        </div>
                        <button onClick={onClose} aria-label="닫기" className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                            <XIcon className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="p-0 max-h-[60vh] overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-50/80 sticky top-0 backdrop-blur-sm border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3 font-bold w-12 text-center">No</th>
                                    <th className="px-4 py-3 font-bold">품명 (Item)</th>
                                    <th className="px-4 py-3 font-bold text-center">두께 (Thick)</th>
                                    <th className="px-4 py-3 font-bold text-center">규격 (Size)</th>
                                    <th className="px-4 py-3 font-bold text-center">재질 (Mat)</th>
                                    <th className="px-4 py-3 font-bold text-right">수량 (Qty)</th>
                                    <th className="px-4 py-3 font-bold text-right">단가 (Price)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {record.items.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50">
                                        <td className="px-4 py-3 text-center text-slate-400 font-mono text-xs">{(item as MixedLineItem).no || idx + 1}</td>
                                        <td className="px-4 py-3 font-bold text-slate-800">{(item as MixedLineItem).item_name || item.name}</td>
                                        <td className="px-4 py-3 text-center text-slate-600">{item.thickness}</td>
                                        <td className="px-4 py-3 text-center text-slate-600 font-medium">{item.size}</td>
                                        <td className="px-4 py-3 text-center text-slate-600">{item.material}</td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-900">{(item as MixedLineItem).qty || item.quantity}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-600">{formatCurrency((item as MixedLineItem).unit_price || item.unitPrice)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-50/80 border-t border-slate-200 font-bold text-slate-900">
                                <tr>
                                    <td colSpan={5} className="px-4 py-3 text-right text-xs font-normal text-slate-500">
                                        {quotation?.adminResponse?.additionalCharges?.map((charge, idx) => (
                                            <div key={idx} className="flex justify-end gap-4 mb-1">
                                                <span>{charge.name}</span>
                                                <span className="font-mono font-bold text-slate-700">{formatCurrency(charge.amount)}</span>
                                            </div>
                                        ))}
                                        <div className="mt-2 pt-2 border-t border-slate-200 font-bold text-sm text-slate-900">
                                            총계 (부가세 별도)
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right align-bottom">{record.items.reduce((sum, i) => sum + ((i as MixedLineItem).qty || i.quantity), 0)}</td>
                                    <td className="px-4 py-3 text-right text-teal-700 text-lg align-bottom">{formatCurrency(record.totalAmount)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {quotation?.adminResponse && (
                        <div className="mx-6 mb-4 space-y-3">
                            {/* Admin Note */}
                            {quotation.adminResponse.note && (
                                <div className="px-4 py-3 bg-teal-50 border border-teal-100 rounded-lg text-sm text-teal-900 mt-4">
                                    <h4 className="font-bold text-teal-700 text-xs uppercase mb-1 flex items-center gap-1">
                                        <div className="w-2 h-2 rounded-full bg-teal-500" /> 관리자 답변 (Admin Note)
                                    </h4>
                                    <p className="whitespace-pre-wrap">{quotation.adminResponse.note}</p>
                                </div>
                            )}

                            {/* Delivery Date */}
                            {quotation.adminResponse.deliveryDate && (
                                <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-lg border border-slate-100 text-sm">
                                    <span className="font-bold text-slate-500 text-xs uppercase">납품 가능일:</span>
                                    <span className="font-mono font-bold text-slate-800">
                                        {new Date(quotation.adminResponse.deliveryDate).toLocaleDateString()}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {requestMemo && (
                        <div className="mx-6 px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-900 mb-4">
                            <h4 className="font-bold text-amber-700 text-xs uppercase mb-1 flex items-center gap-1">
                                <FileText className="w-3 h-3" /> 요청 사항 (Request Note)
                            </h4>
                            <p className="whitespace-pre-wrap">{requestMemo}</p>
                        </div>
                    )}

                    <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                        <Button
                            onClick={handlePrint}
                            variant="outline"
                            className="bg-white border-slate-300 text-slate-700 hover:bg-slate-50 gap-2"
                        >
                            <Printer className="w-4 h-4" />
                            {isOrder ? '발주서 출력' : '견적서 출력'}
                        </Button>
                        <div className="flex gap-2">
                            <Button onClick={onClose} variant="outline" className="border-slate-300 text-slate-700 hover:bg-white min-w-[80px]">
                                닫기
                            </Button>
                            {isProcessed && onOrder && (
                                <Button onClick={onOrder} className="bg-teal-600 hover:bg-teal-700 text-white min-w-[120px] shadow-lg shadow-teal-500/20">
                                    견적대로 주문하기
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {previewContent && (
                <PreviewModal
                    htmlContent={previewContent}
                    onClose={() => setPreviewContent(null)}
                    docType={previewDocType}
                />
            )}

        </>
    );
}
