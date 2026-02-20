import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useStore, type DeliveryInfo } from '../store/useStore';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency } from '../lib/utils';
import { Trash2, Send, Plus, Minus, Search, RotateCcw, Printer, ArrowRight } from 'lucide-react';
import type { LineItem } from '../types';
import { PreviewModal } from '../components/ui/PreviewModal';
import type { DocumentPayload, DocumentItem, DocumentType } from '../types/document';
import { renderDocumentHTML } from '../lib/documentTemplate';
import { OrderService } from '../services/orderService';
import { CalmPageShell } from '../components/ui/CalmPageShell';
import { OrderSubmissionOverlay } from '../components/ui/OrderSubmissionOverlay';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmailPackageAnimation } from '../components/ui/EmailPackageAnimation';
import { motion, AnimatePresence } from 'framer-motion';


export default function QuotationEditor() {
    const { items, memo: quotationMemo } = useStore((state) => state.quotation);
    // Use selector for stable reference
    const user = useStore(state => state.auth.user);
    const { updateItem, removeItem, inventory, clearQuotation, incrementNewOrderCount, setQuotationMemo } = useStore((state) => state);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
    const [currentPayload, setCurrentPayload] = useState<DocumentPayload | null>(null);
    // Removed local state: const [quotationMemo, setQuotationMemo] = useState('');
    const submitButtonRef = useRef<HTMLButtonElement>(null);

    // --- Custom Confirm Dialog State ---
    const [confirmConfig, setConfirmConfig] = useState<{
        isOpen: boolean;
        type: 'CLEAR_ALL' | 'REMOVE_SELECTED' | null;
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

    // --- Success Info Dialog State ---
    const [successConfig, setSuccessConfig] = useState<{
        isOpen: boolean;
        title: string;
        description: string;
    }>({
        isOpen: false,
        title: '',
        description: ''
    });

    const handleClearAll = () => {
        if (items.length === 0) return;
        setConfirmConfig({
            isOpen: true,
            type: 'CLEAR_ALL',
            title: '견적서 초기화',
            description: '작성 중인 내용을 모두 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.',
            variant: 'danger'
        });
    };

    const executeConfirmAction = () => {
        const { type } = confirmConfig;
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        if (type === 'CLEAR_ALL') {
            clearQuotation();
            setSelectedIds([]);
        } else if (type === 'REMOVE_SELECTED') {
            selectedIds.forEach(id => removeItem(id));
            setSelectedIds([]);
        }
    };

    // Helper to calculate total
    const calculateTotal = (items: LineItem[]) => items.reduce((sum, item) => sum + item.amount, 0);

    // Sku generator helper (local use if specific needed, but better use shared)

    const totalAmount = calculateTotal(items);

    const allSelected = items.length > 0 && items.every(item => selectedIds.includes(item.id));

    const handleUpdate = <K extends keyof LineItem>(id: string, field: K, value: LineItem[K]) => {
        const updates: Partial<LineItem> = {};
        updates[field] = value;

        const item = items.find(i => i.id === id);
        if (!item) return;

        // If editing key fields (Name, Thickness, Size, Material), try to find matching product in inventory
        if (['name', 'thickness', 'size', 'material'].includes(field as string)) {
            const newItem = { ...item, [field]: value };

            const match = inventory.find(p =>
                p.name === newItem.name &&
                p.thickness === newItem.thickness &&
                p.size === newItem.size &&
                p.material === newItem.material
            );

            if (match) {
                updates.productId = match.id;
                updates.unitPrice = match.unitPrice;
                updates.currentStock = match.currentStock;
                updates.stockStatus = match.stockStatus;
                updates.location = match.location;
                updates.maker = match.maker;
                updates.locationStock = match.locationStock;
                updates.marking_wait_qty = match.marking_wait_qty;
            } else {
                updates.productId = null;
                updates.stockStatus = undefined;
                updates.currentStock = undefined;
                updates.location = undefined;
                updates.maker = undefined;
                updates.marking_wait_qty = undefined;

                // Keep unitPrice as is or reset?
                // updates.unitPrice = 0; 
            }
        }

        // Recalculate amount if needed (store handles this too, but for UI feedback loop)
        // Store updateItem handles amount recalc usually.

        updateItem(id, updates);
    };

    const handleQuantityChange = (id: string, currentQty: number, delta: number) => {
        const newQty = Math.max(1, currentQty + delta);
        handleUpdate(id, 'quantity', newQty);
    };

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const handleToggleAll = () => {
        if (allSelected) {
            setSelectedIds([]);
        } else {
            setSelectedIds(items.map(i => i.id));
        }
    };

    const handleRemoveSelected = () => {
        setConfirmConfig({
            isOpen: true,
            type: 'REMOVE_SELECTED',
            title: '선택 항목 삭제',
            description: `선택한 ${selectedIds.length}개 항목을 삭제하시겠습니까?`,
            variant: 'danger'
        });
    };

    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewDocType, setPreviewDocType] = useState<DocumentType>('QUOTATION');

    const generatePayload = (type: DocumentType): DocumentPayload => {
        const now = new Date();
        const docNo = `${type === 'QUOTATION' ? 'Q' : 'O'}-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`;

        const docItems: DocumentItem[] = items.map((item, idx) => {
            return {
                no: idx + 1,
                item_id: item.itemId, // Pass Back Data
                item_name: item.name,
                thickness: item.thickness,
                size: item.size,
                material: item.material,
                stock_qty: item.currentStock || 0,
                stock_status: (item.marking_wait_qty || 0) > 0
                    ? `마킹대기:${item.marking_wait_qty}`
                    : (item.currentStock !== undefined
                        ? (item.currentStock === 0 ? '재고없음' : (item.quantity > item.currentStock ? '일부 주문생산' : '출고가능'))
                        : '-'),
                location_maker: item.maker ? `${item.location || ''} / ${item.maker}` : (item.location || '-'),
                qty: item.quantity,
                unit_price: item.unitPrice,
                amount: item.amount,
                note: ''
            };
        });

        return {
            document_type: type,
            meta: {
                doc_no: docNo,
                created_at: now.toLocaleString(),
                channel: 'WEB'
            },
            supplier: {
                company_name: '알트에프(ALTF)',
                contact_name: '관리자',
                address: '부산광역시 사상구 낙동대로 1330번길 67',
                tel: '051-303-3751',
                fax: '0504-376-3751',
                email: 'altf@altf.kr',
                business_no: '838-05-01054'
            },
            customer: {
                company_name: user?.companyName || '고객사 (Guest)',
                contact_name: user?.contactName || (user?.email ? user.email.split('@')[0] : '-'),
                tel: user?.phone || '-',
                email: user?.email || '-',
                address: user?.address || '-',
                memo: type === 'QUOTATION' ? quotationMemo : undefined // Pass Inquiry Memo for Quotation
            },
            items: docItems,
            totals: {
                total_amount: totalAmount,
                currency: 'KRW'
            }
        };
    };

    const handleSaveQuotation = async () => {
        if (!user) return;

        try {
            // Send to Make.com Webhook for Quotation Automation
            const WEBHOOK_URL = 'https://hook.us2.make.com/YOUR_QUOTE_WEBHOOK_URL_HERE';

            try {
                const webhookResponse = await fetch(WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: user.id,
                        customerName: user.companyName || 'Guest',
                        items: items,
                        totalAmount: totalAmount,
                        memo: quotationMemo,
                        status: 'DRAFT',
                        createdAt: new Date().toISOString()
                    })
                });
                if (!webhookResponse.ok) {
                    console.error('Quote Webhook returned an error status.');
                }
            } catch (err) {
                console.error('Quote Webhook error:', err);
            }

            // Persist to Local Store for Admin Visibility
            useStore.getState().addQuotation({
                userId: user.id,
                customerNumber: user.companyName || 'Guest',
                items: items,
                status: 'DRAFT',
                totalAmount: totalAmount,
                memo: quotationMemo
            });

            setSuccessConfig({
                isOpen: true,
                title: '견적서 저장 완료',
                description: '견적서가 성공적으로 저장되었습니다.\n나의 페이지에서 확인하실 수 있습니다.'
            });
        } catch (error) {
            console.error('Failed to save quotation:', error);
        }
    };

    const handlePreviewMemoChange = (newMemo: string) => {
        setQuotationMemo(newMemo);
        if (currentPayload) {
            const newPayload = { ...currentPayload };
            if (newPayload.customer) {
                newPayload.customer.memo = newMemo;
            } else {
                newPayload.customer = {
                    company_name: user?.companyName || 'Guest',
                    contact_name: user?.contactName || '-',
                    tel: user?.phone || '-',
                    email: user?.email || '-',
                    address: user?.address || '-',
                    memo: newMemo
                };
            }
            setCurrentPayload(newPayload);
            const html = renderDocumentHTML(newPayload);
            setPreviewContent(html);
        }
    };

    const handleDocAction = (type: DocumentType) => {
        const payload = generatePayload(type);
        setCurrentPayload(payload);

        if (type === 'ORDER') {
            if (items.length === 0) return;
            setIsSubmitting(true);
        } else {
            setPreviewDocType(type);
            const html = renderDocumentHTML(payload);
            setPreviewContent(html);
        }
    };

    const handleSendOrder = async (deliveryInfo: DeliveryInfo): Promise<boolean> => {
        if (!currentPayload) return false;

        const finalPayload = { ...currentPayload };
        if (finalPayload.customer) {
            // 1. Update Customer Fields with specific Delivery Info
            finalPayload.customer.contact_name = deliveryInfo.contactName;
            finalPayload.customer.tel = deliveryInfo.contactPhone;

            // Combine Method + Address/Branch for clear visibility in single address field
            const methodPrefix = deliveryInfo.method === 'FREIGHT' ? '[화물] ' : '[택배] ';
            const addressDetail = deliveryInfo.method === 'FREIGHT' ? deliveryInfo.branchName : deliveryInfo.address;
            finalPayload.customer.address = `${methodPrefix}${addressDetail}`;

            // 2. Append to Memo (Keep existing logic for redundancy/invoice visibility)
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
            setIsSubmitting(false);
            incrementNewOrderCount();
            setShowSuccessAnimation(true);
            return true;
        } else {
            alert('발주서 전송에 실패했습니다.');
            setIsSubmitting(false);
            return false;
        }
    };

    const handleAnimationComplete = () => {
        setShowSuccessAnimation(false);
        clearQuotation();
    };

    return (
        <CalmPageShell className="pb-32">
            <AnimatePresence mode="wait">
                {items.length === 0 ? (
                    /* EMPTY STATE */
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: "spring", duration: 0.5 }}
                        className="flex flex-col items-center justify-center min-h-[60vh] text-center"
                    >
                        <div className="bg-white/60 backdrop-blur-md p-10 rounded-3xl shadow-xl border border-white/50 max-w-md w-full ring-1 ring-white/60">
                            <div className="w-20 h-20 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-teal-100">
                                <Search className="h-10 w-10 text-teal-600" />
                            </div>
                            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">견적서가 비어있습니다</h2>
                            <p className="text-slate-500 mb-8 text-base font-medium">
                                제품 검색에서 필요한 항목을 담아주세요.
                            </p>
                            <Link to="/search">
                                <Button size="lg" className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-12 shadow-md">
                                    제품 검색하러 가기 <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </Link>
                        </div>
                    </motion.div>
                ) : (
                    /* CART CONTENT */
                    <motion.div
                        key="cart"
                        exit={{ opacity: 0, y: 20, transition: { duration: 0.3 } }}
                    >
                        <OrderSubmissionOverlay
                            isOpen={isSubmitting}
                            onClose={() => setIsSubmitting(false)}
                            onConfirm={handleSendOrder}
                            basePayload={currentPayload}
                            buttonRef={submitButtonRef}
                        />

                        {/* Header */}
                        <div className="flex items-center justify-between pb-6 mb-2">
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 }}
                            >
                                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">견적서 작성 (Quotation Editor)</h1>
                                <p className="text-base text-slate-500 mt-2 font-medium">제출 전 항목을 검토하고 수정할 수 있습니다.</p>
                            </motion.div>
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 }}
                                className="flex items-center gap-3"
                            >
                                <Button variant="outline" onClick={handleClearAll} className="gap-2 bg-white/50 backdrop-blur-sm border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 hover:border-red-200 shadow-sm font-bold">
                                    <RotateCcw className="w-4 h-4" />
                                    초기화
                                </Button>
                            </motion.div>
                        </div>

                        {previewContent && (
                            <PreviewModal
                                htmlContent={previewContent}
                                onClose={() => setPreviewContent(null)}
                                docType={previewDocType}
                                onSend={undefined} // Order uses Overlay, not PreviewModal
                                onPrint={previewDocType === 'QUOTATION' ? handleSaveQuotation : undefined}
                                memo={quotationMemo}
                                onMemoChange={handlePreviewMemoChange}
                            />
                        )}

                        {/* Glassmorphic Table Container */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                            className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-3xl overflow-hidden shadow-2xl shadow-slate-200/50 ring-1 ring-white/60"
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50/80 text-slate-700 border-b-2 border-slate-300 backdrop-blur-sm whitespace-nowrap">
                                        <tr>
                                            <th className="w-10 px-0 py-3 text-center border-r border-slate-200/60">
                                                <div className="flex justify-center items-center h-full">
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                                                        checked={allSelected}
                                                        onChange={handleToggleAll}
                                                        aria-label="Select All"
                                                    />
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center w-[40px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">No.</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[130px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">품명</span>
                                                    <span className="text-[11px] font-bold text-slate-400">ITEM</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[80px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">두께</span>
                                                    <span className="text-[11px] font-bold text-slate-400">THICKNESS</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[120px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">규격</span>
                                                    <span className="text-[11px] font-bold text-slate-400">SIZE</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[120px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">재질</span>
                                                    <span className="text-[11px] font-bold text-slate-400">MATERIAL</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[90px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">재고</span>
                                                    <span className="text-[11px] font-bold text-slate-400">STOCK</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-300/60 text-center min-w-[140px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">상태</span>
                                                    <span className="text-[11px] font-bold text-slate-400">STAT</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[120px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">위치/제조사</span>
                                                    <span className="text-[11px] font-bold text-slate-400">LOC/MAKER</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[100px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">주문수량</span>
                                                    <span className="text-[11px] font-bold text-slate-400">QTY</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[120px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">출고단가</span>
                                                    <span className="text-[11px] font-bold text-slate-400">PRICE</span>
                                                </div>
                                            </th>
                                            <th className="px-1 py-3 border-r border-slate-200/60 text-center min-w-[120px]">
                                                <div className="flex flex-col items-center justify-center leading-tight">
                                                    <span className="text-sm font-extrabold text-slate-800">합계</span>
                                                    <span className="text-[11px] font-bold text-slate-400">AMOUNT</span>
                                                </div>
                                            </th>
                                        </tr >
                                    </thead >
                                    <tbody className="divide-y divide-slate-300 border-b border-slate-200">
                                        <AnimatePresence>
                                            {items.map((item, index) => {
                                                return (
                                                    <motion.tr
                                                        key={item.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, x: -20 }}
                                                        className={`group hover:bg-teal-50/30 transition-colors ${selectedIds.includes(item.id) ? 'bg-teal-50/40' : ''}`}
                                                    >
                                                        <td className="px-3 py-3 text-center border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                                                            <input
                                                                type="checkbox"
                                                                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                                                                checked={selectedIds.includes(item.id)}
                                                                onChange={() => handleToggleSelect(item.id)}
                                                                aria-label={`Select ${item.name}`}
                                                            />
                                                        </td>
                                                        <td className="px-1 py-3 text-center text-slate-500 font-bold border-r border-slate-200 text-xs">
                                                            {index + 1}
                                                        </td>
                                                        <td className="p-0 border-r border-slate-200">
                                                            <input
                                                                type="text"
                                                                aria-label="Item Name"
                                                                className="w-full h-full px-3 py-3 bg-transparent border-none outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-teal-500 text-center text-slate-900 font-bold text-sm"
                                                                value={item.name}
                                                                onChange={(e) => handleUpdate(item.id, 'name', e.target.value)}
                                                            />
                                                        </td>
                                                        <td className="p-0 border-r border-slate-200">
                                                            <input
                                                                type="text"
                                                                aria-label="Thickness"
                                                                className="w-full h-full px-3 py-3 bg-transparent border-none outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-teal-500 text-center text-slate-600 font-medium"
                                                                value={item.thickness}
                                                                onChange={(e) => handleUpdate(item.id, 'thickness', e.target.value)}
                                                            />
                                                        </td>
                                                        <td className="p-0 border-r border-slate-200">
                                                            <input
                                                                type="text"
                                                                aria-label="Size"
                                                                className="w-full h-full px-3 py-3 bg-transparent border-none outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-teal-500 text-center text-slate-700 font-bold"
                                                                value={item.size}
                                                                onChange={(e) => handleUpdate(item.id, 'size', e.target.value)}
                                                            />
                                                        </td>
                                                        <td className="p-0 border-r border-slate-200">
                                                            <input
                                                                type="text"
                                                                aria-label="Material"
                                                                className="w-full h-full px-3 py-3 bg-transparent border-none outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-teal-500 text-center text-slate-600 font-medium"
                                                                value={item.material}
                                                                onChange={(e) => handleUpdate(item.id, 'material', e.target.value)}
                                                            />
                                                        </td>
                                                        <td className="px-3 py-3 text-slate-900 text-center border-r border-slate-200 bg-slate-50/30 font-medium">
                                                            {item.currentStock !== undefined ? item.currentStock.toLocaleString() : '-'}
                                                        </td>
                                                        <td className="px-3 py-3 text-center border-r border-slate-200 bg-slate-50/30">
                                                            <div className="flex flex-col items-center gap-2">
                                                                {(item.currentStock !== undefined && item.currentStock === 0) ? (
                                                                    <Badge color="slate" className="bg-slate-100 text-slate-500 px-2 py-0.5 text-[10px] border border-slate-200 shadow-sm font-bold">재고없음</Badge>
                                                                ) : (item.currentStock !== undefined && item.quantity > item.currentStock) ? (
                                                                    <Badge color="yellow" className="bg-yellow-100 text-yellow-800 px-2 py-0.5 text-[10px] border border-yellow-200 shadow-sm font-bold">일부 주문생산</Badge>
                                                                ) : (
                                                                    <>
                                                                        {item.stockStatus === 'AVAILABLE' && <Badge color="teal" className="bg-teal-100 text-teal-700 px-2 py-0.5 text-[10px] border border-teal-200 shadow-sm font-bold">출고가능</Badge>}
                                                                        {item.stockStatus === 'CHECK_LEAD_TIME' && <Badge color="amber" className="bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] border border-amber-200 shadow-sm font-bold">납기확인</Badge>}
                                                                    </>
                                                                )}
                                                                {/* Marking Wait Indicator */}
                                                                {(item.marking_wait_qty || 0) > 0 && (
                                                                    <Badge color="purple" className="bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] border border-violet-200 shadow-sm font-bold mt-1">
                                                                        마킹 대기: {item.marking_wait_qty}
                                                                    </Badge>
                                                                )}

                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 text-center border-r border-slate-200 text-sm text-slate-600">
                                                            <div className="flex flex-col items-center justify-center">
                                                                <span className="font-bold text-slate-700 text-[13px]">
                                                                    {item.location || '-'}
                                                                    <span className="text-slate-400 font-normal mx-1">/</span>
                                                                    <span className="text-slate-500 font-medium">
                                                                        {item.maker || '-'}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="p-0 border-r border-slate-200 bg-white group-hover:bg-white/50 transition-colors">
                                                            <div className="flex flex-col justify-center h-full">
                                                                <div className="flex items-center justify-between w-full h-full px-1 py-1">
                                                                    <button
                                                                        onClick={() => handleQuantityChange(item.id, item.quantity, -1)}
                                                                        className="p-1 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                                                                        tabIndex={-1}
                                                                        title="수량 감소"
                                                                        aria-label="수량 감소"
                                                                    >
                                                                        <Minus className="w-3.5 h-3.5" />
                                                                    </button>
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        aria-label="Quantity"
                                                                        className="w-full text-center font-bold text-slate-900 bg-transparent border-none outline-none focus:ring-0 p-0 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                        value={item.quantity}
                                                                        onChange={(e) => handleUpdate(item.id, 'quantity', parseInt(e.target.value) || 1)}
                                                                    />
                                                                    <button
                                                                        onClick={() => handleQuantityChange(item.id, item.quantity, 1)}
                                                                        className="p-1 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                                                                        tabIndex={-1}
                                                                        title="수량 증가"
                                                                        aria-label="수량 증가"
                                                                    >
                                                                        <Plus className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                                {(item.currentStock !== undefined && item.quantity > (item.currentStock + (item.marking_wait_qty || 0))) && (
                                                                    <div className="text-rose-500 text-[9px] font-bold pb-0.5 pt-0.5 px-2 text-center tracking-tighter w-fit mx-auto bg-rose-50/80 rounded-full mt-1">
                                                                        재고보다 많아요
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 text-right text-slate-600 border-r border-slate-200 bg-slate-50/30 font-mono text-sm tracking-tight">
                                                            {formatCurrency(item.unitPrice)}
                                                        </td>
                                                        <td className="px-3 py-3 text-right text-slate-900 font-bold border-r border-slate-200 bg-slate-50/30 font-mono text-sm tracking-tight">
                                                            {formatCurrency(item.amount)}
                                                        </td>
                                                    </motion.tr>
                                                )
                                            })}
                                        </AnimatePresence>
                                    </tbody>
                                    <tfoot className="bg-slate-50/90 border-t border-slate-200 backdrop-blur-sm">
                                        <tr>
                                            <td colSpan={2} className="px-4 py-4">
                                                <td colSpan={2} className="px-4 py-4">
                                                    {/* Button Moved to Bottom Bar */}
                                                </td>
                                            </td>
                                            <td colSpan={8} className="px-4 py-4 text-right text-slate-500 font-extrabold text-sm uppercase tracking-wide">
                                                총 합계금액(부가세 제외)
                                            </td>
                                            <td className="px-4 py-4 text-right text-xl font-extrabold text-teal-700 font-mono border-l border-slate-200">
                                                {formatCurrency(totalAmount)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table >
                            </div >

                            {/* Quick Add Row */}
                            <div className="p-3 bg-slate-50/50 border-t border-slate-200/50 backdrop-blur-sm" >
                                <Link to="/search" state={{ returnToSearch: true }}>
                                    <Button variant="ghost" size="sm" className="w-full text-slate-500 hover:text-teal-700 hover:bg-teal-50/50 gap-2 font-bold border border-dashed border-slate-300 hover:border-teal-300 rounded-xl h-10 transition-all">
                                        <Plus className="w-4 h-4" />
                                        제품 추가하기 (Add Item)
                                    </Button>
                                </Link>
                            </div >
                        </motion.div>

                        {/* Legend / Status */}
                        < motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400 px-2"
                        >
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-teal-500 shadow-sm shadow-teal-200"></span>
                                    <span className="font-medium">출고가능 (Ready)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-200"></span>
                                    <span className="font-medium">납기확인 (Check)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
                                    <span className="font-medium">재고없음 (None)</span>
                                </div>
                            </div>
                            <div className="text-right">
                                * 상기 단가는 주문 시점과 재고 변동에 따라 달라질 수 있습니다.
                            </div>
                        </motion.div>

                        {/* Sticky Bottom Actions */}
                        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-white/50 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-[100] flex items-center justify-between">
                            <div className="max-w-[1400px] mx-auto w-full flex items-center justify-end gap-3 px-4">
                                {selectedIds.length > 0 && (
                                    <Button
                                        variant="outline"
                                        onClick={handleRemoveSelected}
                                        className="mr-auto text-red-500 hover:text-red-700 hover:bg-red-50 border-red-200 hover:border-red-300 gap-2 h-12 px-4 font-bold shadow-sm"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        선택 ({selectedIds.length}) 삭제
                                    </Button>
                                )}
                                <Button variant="outline" onClick={() => handleDocAction('QUOTATION')} className="gap-2 w-[160px] h-12 text-base justify-center font-bold bg-white border-slate-200 shadow-sm hover:bg-slate-50">
                                    <Printer className="w-5 h-5" />
                                    견적서 출력
                                </Button>
                                <Button ref={submitButtonRef} onClick={() => handleDocAction('ORDER')} className="gap-2 bg-[#000F0F] hover:bg-teal-900 text-white shadow-lg shadow-teal-900/20 w-[200px] h-12 text-base justify-center font-bold transition-all hover:scale-[1.02]">
                                    <Send className="w-5 h-5" />
                                    주문서 제출하기
                                </Button>
                            </div>
                        </div>
                    </motion.div>
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

            {/* Success Info Dialog */}
            <ConfirmDialog
                isOpen={successConfig.isOpen}
                title={successConfig.title}
                description={successConfig.description.split('\n').map((line, i) => (
                    <span key={i} className="block">{line}</span>
                ))}
                confirmText="확인"
                confirmVariant="primary"
                onConfirm={() => setSuccessConfig(prev => ({ ...prev, isOpen: false }))}
            // No onCancel provided -> Renders single OK button
            />

            <EmailPackageAnimation
                key={showSuccessAnimation ? 'open' : 'closed'}
                isOpen={showSuccessAnimation}
                onComplete={handleAnimationComplete}
            />
        </CalmPageShell>
    );

}
