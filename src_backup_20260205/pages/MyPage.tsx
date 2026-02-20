import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { CalmPageShell } from '../components/ui/CalmPageShell';
import { PageTransition } from '../components/ui/PageTransition';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { renderDocumentHTML } from '../lib/documentTemplate';
import { PreviewModal } from '../components/ui/PreviewModal';
import {
    User, FileText, ShoppingBag, Settings, LogOut,
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
    createdAt: string;
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
    const logout = useStore((state) => state.logout);
    const loadQuotation = useStore((state) => state.loadQuotation);

    const [activeTab, setActiveTab] = useState<'profile' | 'quotes' | 'orders'>('quotes');
    const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
    const [orders, setOrders] = useState<OrderRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [viewingRecord, setViewingRecord] = useState<QuotationRecord | OrderRecord | null>(null);

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

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        // Reset notification count
        resetNewOrderCount();

        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Fetch Quotations
                const quotesRes = await fetch(`/api/my/quotations?userId=${user.id}`);
                if (quotesRes.ok) setQuotations(await quotesRes.json());

                // Fetch Orders
                const ordersRes = await fetch(`/api/my/orders?userId=${user.id}`);
                if (ordersRes.ok) setOrders(await ordersRes.json());
            } catch (error) {
                console.error("Failed to fetch history", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [user, navigate, resetNewOrderCount]);

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
                const res = await fetch(`/api/my/quotations/${targetId}`, { method: 'DELETE' });
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
                const res = await fetch(`/api/my/orders/${targetId}`, { method: 'DELETE' });
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

    const handleLogout = () => {
        logout();
        navigate('/');
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

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            submitted: 'bg-yellow-100 text-yellow-800 border-yellow-200',
            processing: 'bg-blue-100 text-blue-800 border-blue-200',
            shipped: 'bg-indigo-100 text-indigo-800 border-indigo-200',
            completed: 'bg-green-100 text-green-800 border-green-200',
        };
        const labels: Record<string, string> = {
            submitted: '주문접수',
            processing: '처리중',
            shipped: '배송중',
            completed: '완료됨',
        };
        return (
            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${styles[status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                {labels[status] || status}
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
                        <Button
                            variant="outline"
                            onClick={handleLogout}
                            className="w-full md:w-auto border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 gap-2"
                        >
                            <LogOut className="w-4 h-4" />
                            로그아웃
                        </Button>
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
                                            <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                                                <FileText className="w-6 h-6 text-teal-600" />
                                                최근 견적서 발급 내역
                                            </h2>
                                            {quotations.length === 0 ? (
                                                <EmptyState message="발급된 견적서가 없습니다." />
                                            ) : (
                                                <div className="space-y-3">
                                                    {quotations.map(quote => (
                                                        <div key={quote.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
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
                                                                <Button size="sm" variant="outline" onClick={() => setViewingRecord(quote)} className="border-slate-200 text-slate-600 hover:bg-slate-50">
                                                                    상세보기
                                                                </Button>
                                                                <Button size="sm" onClick={() => handleReorder(quote.items)} className="gap-1 bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200">
                                                                    <RefreshCw className="w-3 h-3" />
                                                                    불러오기
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
                                                                <Button size="sm" variant="outline" onClick={() => setViewingRecord(order)} className="flex-1 sm:flex-none border-slate-200 text-slate-600 hover:bg-slate-50">
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
                                                        useStore.getState().updateUser({ companyName: newValue });
                                                    }}
                                                />

                                                <div className="pt-4 border-t border-slate-100">
                                                    <div className="text-sm text-slate-500 mb-2">비밀번호 변경 기능은 준비중입니다.</div>
                                                    <Button disabled className="w-full bg-slate-100 text-slate-400">비밀번호 변경</Button>
                                                </div>
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
                        record={viewingRecord}
                        onClose={() => setViewingRecord(null)}
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

function DetailModal({ record, onClose }: { record: QuotationRecord | OrderRecord, onClose: () => void }) {
    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewDocType, setPreviewDocType] = useState<DocumentType>('QUOTATION');

    if (!record) return null;

    const isOrder = 'status' in record; // Simple type guard
    const docType: DocumentType = isOrder ? 'ORDER' : 'QUOTATION';

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
                currency: 'KRW'
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
                                <span className="px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-500 border border-slate-200">
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
                                    <td colSpan={5} className="px-4 py-3 text-right">총계</td>
                                    <td className="px-4 py-3 text-right">{record.items.reduce((sum, i) => sum + ((i as MixedLineItem).qty || i.quantity), 0)}</td>
                                    <td className="px-4 py-3 text-right text-teal-700">{formatCurrency(record.totalAmount)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

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
                        <Button onClick={onClose} variant="outline" className="border-slate-300 text-slate-700 hover:bg-white min-w-[100px]">
                            닫기
                        </Button>
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
