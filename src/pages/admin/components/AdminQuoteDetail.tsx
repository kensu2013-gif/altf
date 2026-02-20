
import type { Quotation, LineItem } from '../../../types';
import { FileText, Package, Download, Send, Calendar, MessageSquare, Trash2, Plus, User } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { formatCurrency } from '../../../lib/utils';
import { useState, useCallback } from 'react';
import { useStore } from '../../../store/useStore';
import { renderDocumentHTML } from '../../../lib/documentTemplate';

import type { DocumentPayload } from '../../../types/document';


interface AdminQuoteDetailProps {
    quote: Quotation;
    onClose: () => void;
    onSuccess?: () => void;
}


import { QuoteItemRow } from './QuoteItemRow';
import { findMatchingProduct } from '../../../lib/productUtils';

// Helper: Get Stock Status Text

// Helper: Get Stock Status Text
const getStockStatusText = (status: string | undefined) => {
    switch (status) {
        case 'AVAILABLE': return '출고가능';
        case 'CHECK_LEAD_TIME': return '일부출고'; // Or '문의' depending on business logic, but '일부출고' matches 'Partial'
        case 'OUT_OF_STOCK': return '재고없음';
        default: return '-';
    }
};

export function AdminQuoteDetail({ quote, onClose: _onClose, onSuccess }: AdminQuoteDetailProps) {
    const inventory = useStore((state) => state.inventory);
    const user = useStore((state) => state.auth.user); // Get Admin User
    const updateQuotation = useStore((state) => state.updateQuotation);
    const updateUser = useStore((state) => state.updateUser);
    const customerUser = useStore((state) => state.users.find(u => u.id === quote.userId));

    // Local state for customer info

    const [customerInfo, setCustomerInfo] = useState(() => ({
        companyName: customerUser?.companyName || quote.customerNumber,
        contactName: customerUser?.contactName || '',
        email: customerUser?.email || '',
        phone: customerUser?.phone || customerUser?.contactInfo?.phone || '',
        bizNo: customerUser?.bizNo || '',
        address: customerUser?.address || '',
        fax: customerUser?.fax || ''
    }));

    // Pattern: Adjust state during render to avoid useEffect cascade
    const [prevCustomerUser, setPrevCustomerUser] = useState(customerUser);

    if (customerUser !== prevCustomerUser) {
        setPrevCustomerUser(customerUser);
        if (customerUser) {
            setCustomerInfo({
                companyName: customerUser.companyName || quote.customerNumber,
                contactName: customerUser.contactName || '',
                email: customerUser.email || '',
                phone: customerUser.phone || customerUser.contactInfo?.phone || '',
                bizNo: customerUser.bizNo || '',
                address: customerUser.address || '',
                fax: customerUser.fax || ''
            });
        }
    }





    // Local state for editing
    const [response, setResponse] = useState({
        deliveryDate: quote.adminResponse?.deliveryDate || '',
        note: quote.adminResponse?.note || ''
    });

    const [charges, setCharges] = useState<{ name: string; amount: number; }[]>(
        quote.adminResponse?.additionalCharges || []
    );

    // We need to allow editing of Unit Prices.
    // Initialize with quote items, enhanced with local discountRate state
    const [items, setItems] = useState<(LineItem & { userUnitPrice?: number })[]>(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        quote.items.map((rawItem: any) => {
            const item: LineItem = {
                ...rawItem,
                name: rawItem.name || rawItem.item_name || '',
                thickness: rawItem.thickness || rawItem['item_thickness'] || '', // Fallback to item_thickness
                size: rawItem.size || rawItem['item_size'] || '', // Fallback to item_size
                material: rawItem.material || rawItem['item_material'] || '', // Fallback to item_material
                quantity: rawItem.quantity ?? rawItem.qty ?? 0,
                unitPrice: rawItem.unitPrice ?? rawItem.unit_price ?? 0,
                amount: rawItem.amount ?? 0,
                itemId: rawItem.itemId || rawItem.item_id || '',
                productId: rawItem.productId || null,
                // Legacy Field Mapping
                supplierRate: rawItem.supplierRate ?? rawItem.supplier_rate ?? undefined,
                discountRate: rawItem.discountRate ?? rawItem.discount_rate ?? undefined
            };

            // 1. Try to find product using unified helper
            const product = findMatchingProduct(item, inventory);

            // Try to infer discount rate if standard price exists
            let initialRate = item.discountRate; // Undefined if not in DB
            const standardPrice = product?.base_price ?? product?.unitPrice ?? 0;

            // Only apply defaults/calculations if discountRate is missing (undefined)
            // If it is 0, we respect it.
            if (initialRate === undefined) {
                // [Modified] Default Logic: Use rate_pct if available, otherwise calculate or default to 0
                if (product && product.rate_pct !== undefined) {
                    initialRate = product.rate_pct;
                } else if (standardPrice > 0 && item.unitPrice > 0) {
                    // Fallback: Calculate from Standard (Base) Price
                    initialRate = Math.round((1 - item.unitPrice / standardPrice) * 100);
                } else if (standardPrice > 0 && (item.unitPrice === 0 || item.unitPrice === undefined)) {
                    // Auto-fill price if 0 (and no explicit rate set)
                    item.unitPrice = standardPrice;
                    item.amount = standardPrice * item.quantity;
                    initialRate = 0;
                } else {
                    initialRate = 0;
                }
            }


            // Initialize supplierRate from item or inventory default
            // Priority: Item (saved) > Inventory (current) > 0
            const defaultSupplierRate = product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
            const supplierRate = item.supplierRate ?? defaultSupplierRate;

            return {
                ...item,
                productId: product ? product.id : (item.productId || null),
                base_price: product?.base_price ?? 0,
                isVerified: !!product, // Initialize verification status
                stockStatus: product?.stockStatus, // Initialize stock status
                currentStock: product?.currentStock, // Initialize stock count
                discountRate: initialRate,
                supplierRate: supplierRate,
                userUnitPrice: Number(item.unitPrice) || 0, // [NEW] Store User's Original Price
                quantity: Number(item.quantity) || 0,
                // Recalculate Unit Price if we applied a default rate (35/65) and we want to overwrite user's price with Admin Default
                // "Default to 35/65" usually means the admin *starts* with this offer.
                unitPrice: (initialRate > 0 && product)
                    ? Math.round(Math.round(standardPrice * (1 - initialRate / 100)) / 10) * 10
                    : (Number(item.unitPrice) || 0),

                amount: (initialRate > 0 && product)
                    ? (Math.round(Math.round(standardPrice * (1 - initialRate / 100)) / 10) * 10) * (Number(item.quantity) || 0)
                    : (Number(item.amount) || 0),

                marking_wait_qty: product?.marking_wait_qty || 0
            };
        })
    );

    // ... (keep helper functions)

    const getProductInfo = (productId: string | null) => {
        if (!productId) return null;
        return inventory.find(p => p.id === productId);
    };

    // Stable Handlers for React.memo optimization
    const handlePriceChange = useCallback((index: number, newPrice: number) => {
        setItems(prev => {
            const newItems = [...prev];
            const item = newItems[index];
            // Use inventory from closure (stable enough) or pass in if needed, but inventory changes are rare
            const product = inventory.find(p => p.id === item.productId);

            const standardPrice = product?.base_price ?? product?.unitPrice ?? 0;
            let newRate = 0;
            if (standardPrice > 0) {
                newRate = Math.round((1 - newPrice / standardPrice) * 100);
            }

            newItems[index] = {
                ...item,
                unitPrice: newPrice,
                discountRate: newRate,
                amount: newPrice * item.quantity
            };
            return newItems;
        });
    }, [inventory]);

    // Sync items with inventory (Render Phase Adjustment)
    const [prevInventory, setPrevInventory] = useState(inventory);

    if (inventory !== prevInventory && inventory.length > 0) {
        setPrevInventory(inventory);
        setItems(prevItems => {
            let hasChanges = false;
            const newItems = prevItems.map(item => {
                const product = findMatchingProduct(item, inventory);
                if (product) {
                    const isDifferent = item.productId !== product.id ||
                        !item.isVerified ||
                        item.base_price !== product.base_price;

                    if (isDifferent) {
                        hasChanges = true;
                        return {
                            ...item,
                            productId: product.id,
                            isVerified: true,
                            stockStatus: product.stockStatus,
                            currentStock: product.currentStock,
                            base_price: product.base_price,
                        };
                    }
                }
                return item;
            });

            return hasChanges ? newItems : prevItems;
        });
    }

    const handleItemChange = useCallback((index: number, field: keyof LineItem | 'spec', value: string | number) => {
        setItems(prevItems => {
            if (field === 'spec') return prevItems;

            const newItems = [...prevItems];
            const updatedItem = { ...newItems[index], [field]: value };

            // Dynamic SKU Lookup
            const matchedProduct = findMatchingProduct(updatedItem, inventory);

            if (matchedProduct) {
                // 1. Set IDs and Status
                updatedItem.productId = matchedProduct.id;
                updatedItem.currentStock = matchedProduct.currentStock;
                updatedItem.stockStatus = matchedProduct.stockStatus;
                updatedItem.marking_wait_qty = matchedProduct.marking_wait_qty || 0;

                // 2. Set Prices
                updatedItem.unitPrice = matchedProduct.unitPrice;
                updatedItem.amount = updatedItem.unitPrice * updatedItem.quantity;

                // 3. Set Base Price & Discount
                const basePrice = matchedProduct.base_price ?? matchedProduct.unitPrice ?? 0;
                updatedItem.base_price = basePrice;

                if (basePrice > 0 && updatedItem.unitPrice < basePrice) {
                    updatedItem.discountRate = Math.round((1 - updatedItem.unitPrice / basePrice) * 100);
                } else {
                    updatedItem.discountRate = 0;
                }

                // 4. Supplier Logic
                updatedItem.supplierRate = matchedProduct.rate_act2 ?? matchedProduct.rate_act ?? matchedProduct.rate_pct ?? 0;

            } else {
                // No Match: Unlink
                updatedItem.productId = null;
                updatedItem.base_price = 0;
                updatedItem.stockStatus = undefined;
                updatedItem.marking_wait_qty = 0;
                updatedItem.supplierRate = 0;
                updatedItem.amount = updatedItem.unitPrice * updatedItem.quantity;
            }

            newItems[index] = updatedItem;
            return newItems;
        });
    }, [inventory]);

    const handleSupplierRateChange = useCallback((index: number, value: number) => {
        setItems(prev => {
            const newItems = [...prev];
            newItems[index] = { ...newItems[index], supplierRate: value };
            return newItems;
        });
    }, []);

    const handleDiscountRateChange = useCallback((index: number, value: number) => {
        setItems(prev => {
            const newItems = [...prev];
            const item = newItems[index];
            const product = inventory.find(p => p.id === item.productId);
            // logic matches original inline logic
            const base = product?.base_price || item.unitPrice;
            const newPrice = Math.round(Math.round(base * (1 - value / 100)) / 10) * 10;

            newItems[index] = {
                ...item,
                discountRate: value,
                unitPrice: newPrice,
                amount: newPrice * item.quantity
            };
            return newItems;
        });
    }, [inventory]);



    const handleDownload = () => {
        const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);
        const totalWithCharges = calculatedTotal + charges.reduce((sum, c) => sum + c.amount, 0);

        const payload: DocumentPayload = {
            document_type: 'QUOTATION',
            meta: {
                doc_no: quote.id,
                created_at: new Date().toLocaleDateString(),
                channel: 'WEB',
                title: '견 적 서 (QUOTATION)',
                delivery_date: response.deliveryDate
            },
            supplier: {
                company_name: '(주)알트에프',
                contact_name: user?.contactName || '조현진 대표',
                tel: user?.phone || '051-303-3751',
                email: user?.email || 'altf@altf.kr',
                address: user?.address || '부산시 사상구 낙동대로1330번길 67'
            },
            customer: {
                company_name: customerInfo.companyName,
                contact_name: customerInfo.contactName,
                tel: customerInfo.phone,
                email: customerInfo.email,
                address: customerInfo.address,
                business_no: customerInfo.bizNo,
                fax: customerInfo.fax
            },
            items: items.map((item, idx) => {
                const product = inventory.find(p => p.id === item.productId);
                return {
                    no: idx + 1,
                    item_name: item.name,
                    spec: `${item.thickness || ''} ${item.size || ''} ${item.material || ''} `.trim(),
                    thickness: item.thickness,
                    size: item.size,
                    material: item.material,
                    qty: item.quantity,
                    unit_price: item.unitPrice,
                    amount: item.amount,
                    note: '',
                    stock_qty: product?.currentStock || 0,
                    stock_status: getStockStatusText(product?.stockStatus),
                    location_maker: product?.location || '-'
                };
            }),
            totals: {
                total_amount: calculatedTotal,
                currency: 'KRW',
                vat_rate: 0.1,
                final_amount: totalWithCharges,
                additional_charges: charges
            },
            footer: {
                message: response.note
            }
        };

        const html = renderDocumentHTML(payload);
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
            // Printing is now handled by the template's window.onload script
        }
    };

    // Calculate totals for display
    const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);
    const totalWithCharges = calculatedTotal + charges.reduce((sum, c) => sum + c.amount, 0);

    const handleProcessing = async () => {
        if (!confirm('견적서를 회수(수정모드)하시겠습니까? 고객은 더 이상 답변서를 볼 수 없습니다.\n(상태가 답변작성중으로 변경됩니다)')) return;

        // 1. Prepare Payload (Revert to PROCESSING)
        const updatePayload = {
            status: 'PROCESSING' as const
        };

        // 2. Update Local Store
        updateQuotation(quote.id, updatePayload);

        // 3. API Call
        try {
            await fetch(`/api/my/quotations/${quote.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
            alert('견적서가 회수되었습니다. (수정 모드)');
            onSuccess?.();
            _onClose();
        } catch (error) {
            console.error(error);
            alert('회수에 실패했습니다.');
        }
    };

    const handleSend = async () => {
        if (!confirm('견적서를 전송하시겠습니까? (상태가 답변완료로 변경됩니다)')) return;

        // 1. Update User Info
        if (customerUser) {
            updateUser(customerUser.id, {
                companyName: customerInfo.companyName,
                contactName: customerInfo.contactName,
                phone: customerInfo.phone,
                email: customerInfo.email,
                bizNo: customerInfo.bizNo,
                address: customerInfo.address,
                fax: customerInfo.fax,
                contactInfo: {
                    phone: customerInfo.phone,
                    email: customerInfo.email
                }
            });
        }

        // 2. Prepare Payload
        const updatePayload = {
            items: items,
            totalAmount: totalWithCharges,
            adminResponse: {
                confirmedPrice: totalWithCharges,
                deliveryDate: response.deliveryDate,
                note: response.note,
                additionalCharges: charges
            },
            status: 'PROCESSED' as const // Mark as Processed (Answered)
        };

        // 3. Update Local Store
        updateQuotation(quote.id, updatePayload);

        // 4. API Call
        try {
            await fetch(`/api/my/quotations/${quote.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
            alert('견적서가 전송되었습니다.');
            onSuccess?.(); // Notify parent to update view
            _onClose();
        } catch (error) {
            console.error(error);
            alert('전송에 실패했습니다.');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
            <div className="w-full max-w-[95%] h-full bg-white shadow-2xl pointer-events-auto flex flex-col animate-in slide-in-from-right duration-300">
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="space-y-6">
                        {/* Customer Info Edit Section */}
                        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2">
                                <User className="w-4 h-4 text-teal-600" />
                                고객 정보 (Customer Info)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">회사명 (Company)</label>
                                    <input
                                        type="text"
                                        title="Company Name"
                                        placeholder="Company Name"
                                        value={customerInfo.companyName}
                                        onChange={(e) => setCustomerInfo({ ...customerInfo, companyName: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">담당자 (Contact Name)</label>
                                    <input
                                        type="text"
                                        title="Contact Name"
                                        placeholder="Contact Name"
                                        value={customerInfo.contactName}
                                        onChange={(e) => setCustomerInfo({ ...customerInfo, contactName: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">연락처 (Phone)</label>
                                    <input
                                        type="text"
                                        title="Phone"
                                        placeholder="Phone"
                                        value={customerInfo.phone}
                                        onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">이메일 (Email)</label>
                                    <input
                                        type="email"
                                        title="Email"
                                        placeholder="Email"
                                        value={customerInfo.email}
                                        onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 mb-1">주소 (Address)</label>
                                    <input
                                        type="text"
                                        title="Address"
                                        placeholder="Address"
                                        value={customerInfo.address}
                                        onChange={(e) => setCustomerInfo({ ...customerInfo, address: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Customer Memo Section */}
                        <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-4 shadow-sm">
                            <h3 className="text-sm font-bold text-yellow-800 mb-2 flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                고객 요청 메모 (Customer Memo)
                            </h3>
                            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {quote.memo || <span className="text-slate-400 italic">고객이 작성한 메모가 없습니다. (No customer memo)</span>}
                            </div>
                        </div>

                        {/* Quote Items Table (Negotiation) */}
                        <div className="bg-white rounded-xl border border-slate-200">
                            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                                <Package className="w-4 h-4 text-teal-600" />
                                견적 품목 및 단가 조정 (Negotiation)
                            </h3>
                            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-sm font-bold uppercase">
                                        <tr>
                                            <th className="px-2 py-3 w-[3%] text-center text-slate-400 font-normal">No.</th>
                                            <th className="px-4 py-3 w-[25%] text-left">품목명 / 규격 (Item/Spec)</th>
                                            <th className="px-2 py-3 text-center w-[4%]">현재고</th>
                                            <th className="px-2 py-3 text-center w-[4%]">수량</th>

                                            {/* Reference / Base Price Column */}
                                            <th className="px-2 py-3 text-right text-slate-500 w-[7%]">
                                                기준단가 (Base)
                                            </th>

                                            {/* Supplier Rate (Cost Factor) */}
                                            <th className="px-1 py-3 text-center w-[5%]">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-xs font-bold text-indigo-700">매입율 (%)</span>
                                                    <div className="flex items-center justify-center gap-1 w-full">
                                                        <input
                                                            type="number"
                                                            placeholder="일괄"
                                                            className="w-16 px-1 py-0.5 text-center text-xs border border-indigo-200 rounded focus:border-indigo-500 outline-none text-indigo-700 bg-indigo-50/50"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    const val = Number(e.currentTarget.value);
                                                                    if (!isNaN(val)) {
                                                                        const newItems = items.map(item => ({
                                                                            ...item,
                                                                            supplierRate: val
                                                                        }));
                                                                        setItems(newItems);
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </th>

                                            {/* Cost Price */}
                                            <th className="px-2 py-3 text-right text-xs font-bold w-[7%]">
                                                매입단가 (Cost)
                                            </th>

                                            {/* Rate (Previously Discount Rate) */}
                                            <th className="px-2 py-3 text-center w-[5%]">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-xs font-bold text-slate-600">요율 (%)</span>
                                                    <div className="flex items-center gap-1 w-full max-w-[80px] mx-auto">
                                                        <input
                                                            type="number"
                                                            placeholder="일괄"
                                                            className="w-full px-1 py-0.5 text-center text-xs border border-slate-300 rounded focus:border-teal-500 outline-none"
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    const val = Number(e.currentTarget.value);
                                                                    if (!isNaN(val)) {
                                                                        const newItems = items.map(item => {
                                                                            const product = getProductInfo(item.productId);
                                                                            const standardPrice = product?.base_price ?? item.unitPrice ?? 0; // Use Base Price, fallback to UnitPrice, then 0
                                                                            if (standardPrice === 0) return item;

                                                                            // Calculate Sales Price based on Base Price * (1 - Rate/100)
                                                                            const newPrice = Math.round(Math.round(standardPrice * (1 - val / 100)) / 10) * 10;

                                                                            return {
                                                                                ...item,
                                                                                unitPrice: newPrice,
                                                                                discountRate: val,
                                                                                amount: newPrice * item.quantity
                                                                            };
                                                                        });
                                                                        setItems(newItems);
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </th>

                                            <th className="px-2 py-3 text-right text-slate-400 w-[7%]">견적금액 (User)</th>
                                            <th className="px-2 py-3 text-right w-[9%]">수정 견적단가</th>
                                            <th className="px-2 py-3 text-right w-[9%]">합계 (VAT별도)</th>

                                            {/* Profit - Moved to End */}
                                            <th className="px-2 py-3 text-right text-green-600 whitespace-nowrap w-[7%]">
                                                이익 (Profit)
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {items.map((item, idx) => (
                                            <QuoteItemRow
                                                key={idx}
                                                index={idx}
                                                item={item}
                                                inventory={inventory}
                                                onItemChange={handleItemChange}
                                                onPriceChange={handlePriceChange}
                                                onSupplierRateChange={handleSupplierRateChange}
                                                onDiscountRateChange={handleDiscountRateChange}
                                            />
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t border-slate-200">
                                        <tr>
                                            <td colSpan={6} className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">
                                                Total Summary (VAT 별도)
                                            </td>
                                            <td colSpan={4} className="px-4 py-3 text-right font-mono text-sm">
                                                <div className="flex items-center justify-end gap-4">
                                                    <div className="text-slate-500">
                                                        <span className="text-xs mr-2">매출 합계:</span>
                                                        <span className="font-bold text-xl">{formatCurrency(calculatedTotal)}</span>
                                                    </div>
                                                    <div className="text-slate-400">-</div>
                                                    <div className="text-indigo-600">
                                                        <span className="text-xs mr-2">매입 합계 (Cost):</span>
                                                        <span className="font-bold">
                                                            {formatCurrency(
                                                                items.reduce((sum, item) => {
                                                                    const product = getProductInfo(item.productId);
                                                                    const basePrice = product?.base_price || 0;
                                                                    const supplierRate = item.supplierRate ?? 0;
                                                                    const costPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
                                                                    return sum + (costPrice * item.quantity);
                                                                }, 0)
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="text-slate-400">=</div>
                                                    <div className={`${(calculatedTotal - items.reduce((sum, item) => {
                                                        const product = getProductInfo(item.productId);
                                                        const basePrice = product?.base_price || 0;
                                                        const supplierRate = item.supplierRate ?? 0;
                                                        const costPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
                                                        return sum + (costPrice * item.quantity);
                                                    }, 0)) >= 0 ? 'text-green-600' : 'text-red-500'
                                                        } font - bold text - lg`}>
                                                        <span className="text-xs mr-2">이익 (Profit):</span>
                                                        {formatCurrency(
                                                            calculatedTotal - items.reduce((sum, item) => {
                                                                const product = getProductInfo(item.productId);
                                                                const basePrice = product?.base_price || 0;
                                                                const supplierRate = item.supplierRate ?? 0;
                                                                const costPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
                                                                return sum + (costPrice * item.quantity);
                                                            }, 0)
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div >

                        {/* Additional Charges Section */}
                        < div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm" >
                            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3 flex items-center gap-2">
                                <Plus className="w-4 h-4 text-teal-600" />
                                추가 비용 및 할인 (Additional Charges)
                            </h3>
                            <div className="space-y-3">
                                {charges.map((charge, idx) => {
                                    const isNegative = charge.amount < 0;
                                    const absValue = Math.abs(charge.amount);

                                    return (
                                        <div key={idx} className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                placeholder="항목명 (예: 운송비, 네고 할인)"
                                                value={charge.name}
                                                onChange={(e) => {
                                                    const newCharges = [...charges];
                                                    newCharges[idx].name = e.target.value;
                                                    setCharges(newCharges);
                                                }}
                                                className="flex-1 px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500"
                                            />
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newCharges = [...charges];
                                                        // Toggle sign
                                                        newCharges[idx].amount = newCharges[idx].amount * -1;
                                                        setCharges(newCharges);
                                                    }}
                                                    className={`px - 2 py - 2 rounded text - xs font - bold border transition - colors ${isNegative
                                                        ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                        : 'bg-teal-50 text-teal-600 border-teal-200 hover:bg-teal-100'
                                                        } `}
                                                >
                                                    {isNegative ? '(-)' : '(+)'}
                                                </button>
                                                <input
                                                    type="text"
                                                    placeholder="0"
                                                    value={absValue === 0 ? '' : absValue.toLocaleString()}
                                                    onChange={(e) => {
                                                        const valStr = e.target.value.replace(/[^0-9]/g, '');
                                                        const val = Number(valStr);
                                                        const newCharges = [...charges];
                                                        // Preserve current sign
                                                        newCharges[idx].amount = isNegative ? -val : val;
                                                        setCharges(newCharges);
                                                    }}
                                                    className={`w - 32 px - 3 py - 2 border border - slate - 200 rounded text - sm outline - none focus: border - teal - 500 text - right font - mono font - bold ${isNegative ? 'text-red-500' : 'text-slate-700'} `}
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const newCharges = charges.filter((_, i) => i !== idx);
                                                    setCharges(newCharges);
                                                }}
                                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                                                aria-label="항목 삭제"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    );
                                })}
                                <button
                                    onClick={() => setCharges([...charges, { name: '', amount: 0 }])}
                                    className="text-sm text-teal-600 font-bold hover:text-teal-700 flex items-center gap-1"
                                >
                                    <Plus className="w-4 h-4" /> 항목 추가
                                </button>
                            </div>
                        </div >

                        {/* Admin Response Form */}
                        < div className="bg-slate-50 rounded-xl p-6 border border-slate-200" >
                            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-teal-600" />
                                답변 정보 입력 (Response)
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">총 견적 금액 (확정)</label>
                                    <div className="text-2xl font-bold text-teal-700 font-mono flex items-center gap-2 bg-white px-4 py-2.5 rounded-lg border border-slate-200">
                                        {formatCurrency(totalWithCharges)} (VAT 별도)
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1 space-y-1">
                                        <div className="flex justify-between">
                                            <span>품목 합계:</span>
                                            <span>{formatCurrency(calculatedTotal)}</span>
                                        </div>
                                        {charges.length > 0 && (
                                            <div className="space-y-1 pt-2 border-t border-dashed border-slate-200">
                                                {charges.map((charge, idx) => (
                                                    <div key={idx} className="flex justify-between text-slate-500 text-xs">
                                                        <span>{charge.name}</span>
                                                        <span className={charge.amount < 0 ? 'text-red-500' : 'text-slate-700'}>
                                                            {formatCurrency(charge.amount)}
                                                        </span>
                                                    </div>
                                                ))}
                                                <div className="flex justify-between font-bold text-slate-600 pt-1">
                                                    <span>추가 비용/할인 합계:</span>
                                                    <span>{formatCurrency(charges.reduce((acc, c) => acc + c.amount, 0))}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>


                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">납품 가능일 (Delivery Date)</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input
                                            type="date"
                                            title="Delivery Date"
                                            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                            value={response.deliveryDate}
                                            onChange={(e) => setResponse({ ...response, deliveryDate: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 mb-1">관리자 메모 (Admin Note)</label>
                                    <textarea
                                        className="w-full p-4 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none text-sm resize-none h-24"
                                        placeholder="고객에게 전달할 전달사항이나 특이사항을 입력하세요."
                                        value={response.note}
                                        onChange={(e) => setResponse({ ...response, note: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div >

                    </div >

                    {/* Footer Actions */}
                    < div className="p-6 border-t border-slate-200 bg-white flex items-center justify-between gap-3" >
                        <Button
                            variant="ghost"
                            onClick={handleDownload}
                            className="text-slate-400 hover:text-teal-600"
                        >
                            <Download className="w-4 h-4 mr-2" /> PDF 다운로드
                        </Button>

                        <div className="flex gap-3">
                            {/* Start Processing (Only if SUBMITTED) */}
                            {quote.status === 'SUBMITTED' && (
                                <Button variant="outline" onClick={async () => {
                                    // Switch to IN_REVIEW
                                    updateQuotation(quote.id, { status: 'IN_REVIEW' });
                                    try {
                                        await fetch(`/api/my/quotations/${quote.id}`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ status: 'IN_REVIEW' })
                                        });
                                        // alert('견적 확인 상태로 변경되었습니다.'); 
                                        // No alert needed, just UI update
                                    } catch (e) {
                                        console.error(e);
                                    }
                                }} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                                    견적 확인 (응답대기 전환)
                                </Button>
                            )}

                            {/* Recall (Only if PROCESSED or COMPLETED) - Renamed from 응답대기로 변경 */}
                            {(quote.status === 'PROCESSED' || quote.status === 'COMPLETED') && (
                                <Button variant="outline" onClick={handleProcessing} className="text-amber-600 border-amber-200 hover:bg-amber-50 gap-2">
                                    <FileText className="w-4 h-4" />
                                    회수 (Recall / 수정모드)
                                </Button>
                            )}

                            <Button variant="outline" onClick={_onClose}>
                                닫기
                            </Button>

                            {/* Save Changes (Only if PROCESSED) - New Feature */}
                            {quote.status === 'PROCESSED' && (
                                <Button
                                    onClick={async () => {
                                        // Update User Info First
                                        if (customerUser) {
                                            updateUser(customerUser.id, {
                                                companyName: customerInfo.companyName,
                                                contactName: customerInfo.contactName,
                                                phone: customerInfo.phone,
                                                email: customerInfo.email,
                                                bizNo: customerInfo.bizNo,
                                                address: customerInfo.address,
                                                fax: customerInfo.fax,
                                                contactInfo: {
                                                    phone: customerInfo.phone,
                                                    email: customerInfo.email
                                                }
                                            });
                                        }

                                        // Same logic as send but keep status as PROCESSED and just update details
                                        const updatePayload = {
                                            items: items,
                                            totalAmount: totalWithCharges,
                                            adminResponse: {
                                                confirmedPrice: totalWithCharges,
                                                deliveryDate: response.deliveryDate,
                                                note: response.note,
                                                additionalCharges: charges
                                            },
                                            // status: 'PROCESSED' // Keep as processed (or update if needed, but usually redundant if already processed)
                                        };

                                        updateQuotation(quote.id, updatePayload); // Local Update

                                        try {
                                            await fetch(`/ api / my / quotations / ${quote.id} `, {
                                                method: 'PATCH',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(updatePayload)
                                            });
                                            alert('수정사항이 저장되었습니다.');
                                        } catch (error) {
                                            console.error(error);
                                            alert('저장에 실패했습니다.');
                                        }
                                    }}
                                    className="bg-slate-800 hover:bg-slate-900 text-white gap-2"
                                >
                                    <FileText className="w-4 h-4" />
                                    수정 저장 (Save)
                                </Button>
                            )}

                            <Button
                                onClick={handleSend}
                                className="bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20 px-6 gap-2"
                            >
                                <Send className="w-4 h-4" />
                                {quote.status === 'PROCESSED' ? '재전송 (Resend)' : '견적서 전송 (답변완료)'}
                            </Button>
                        </div>
                    </div >
                </div >

            </div >
        </div >

    );
}
