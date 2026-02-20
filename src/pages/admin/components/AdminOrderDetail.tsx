import { useState, memo, useMemo, useCallback } from 'react';
import type { Order, LineItem, Product } from '../../../types';
// import { generateSku } from '../../../lib/sku'; // REMOVED: Managed in useInventoryIndex
import { useStore } from '../../../store/useStore';
import { X, AlertTriangle, Check, Calendar, Package, User, Trash2, Plus, Download, FileText, Minus, Equal } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useInventoryIndex } from '../../../hooks/useInventoryIndex';


import { formatCurrency } from '../../../lib/utils';
import { renderDocumentHTML } from '../../../lib/documentTemplate';
import type { DocumentPayload } from '../../../types/document';

interface AdminOrderDetailProps {
    order: Order;
    onClose: () => void;
    onUpdate: (orderId: string, updates: Partial<Order>) => void;
    initialMode?: 'CUSTOMER' | 'SUPPLIER'; // [MOD] Added initialMode prop
}

// ... (helpers) ...

// Helper: Get Stock Status Text
const getStockStatusText = (status: string | undefined) => {
    switch (status) {
        case 'AVAILABLE': return '출고가능';
        case 'CHECK_LEAD_TIME': return '일부출고';
        case 'OUT_OF_STOCK': return '재고없음';
        default: return '-';
    }
};

export const AdminOrderDetail = memo(function AdminOrderDetail({ order, onClose, onUpdate, initialMode = 'CUSTOMER' }: AdminOrderDetailProps) {
    const inventory = useStore((state) => state.inventory);
    const user = useStore((state) => state.auth.user);
    const users = useStore((state) => state.users);

    const { findProduct } = useInventoryIndex(inventory);

    const linkedUser = useMemo(() => users.find(u => u.id === order.userId), [users, order.userId]);
    const customerInfo = useMemo(() => ({
        contactName: order.payload?.customer?.contact_name || linkedUser?.contactName || order.customerName,
        tel: order.payload?.customer?.tel || linkedUser?.phone || '-',
        bizNo: order.customerBizNo || linkedUser?.bizNo || '-'
    }), [order, linkedUser]);
    // ...

    // ... (state initialization) ...

    // Supplier Mode State
    const [isSupplierMode, setIsSupplierMode] = useState(initialMode === 'SUPPLIER');

    const [items, setItems] = useState<LineItem[]>(order.items || []);
    const [poItems, setPoItems] = useState<LineItem[]>(() => {
        // [FIX] If PO Items specific list exists, use it.
        // If not, clone the Customer Items as the starting point for the PO.
        if (order.po_items && order.po_items.length > 0) {
            return order.po_items;
        }
        return order.items ? [...order.items] : [];
    });

    // Helper: Enrich item with live inventory data (using optimized Index)
    const enrichItem = useCallback((item: LineItem): LineItem => {
        const product = findProduct(item);

        if (product) {
            return {
                ...item,
                productId: product.id,
                isVerified: true,
                currentStock: product.currentStock,
                stockStatus: product.stockStatus,
                location: product.location,
                marking_wait_qty: product.marking_wait_qty || 0,
                base_price: product.base_price ?? product.unitPrice,
            };
        }

        return {
            ...item,
            productId: null,
            isVerified: false,
            currentStock: 0,
            stockStatus: undefined,
            base_price: 0,
            marking_wait_qty: 0
        };
    }, [findProduct]);

    // [Refactor] Use Derived State for Item Enrichment instead of Syncing State
    // This prevents "setState during render" warnings and ensures items are always up-to-date with inventory.
    const enrichedItems = useMemo(() => items.map(i => enrichItem(i)), [items, enrichItem]);
    const enrichedPoItems = useMemo(() => poItems.map(i => enrichItem(i)), [poItems, enrichItem]);

    // Computed Properties for "Current View" - Use Enriched Versions
    const displayedItems = isSupplierMode ? enrichedPoItems : enrichedItems;
    const setDisplayedItems = isSupplierMode ? setPoItems : setItems;

    const [charges, setCharges] = useState<{ name: string; amount: number; }[]>(order.adminResponse?.additionalCharges || []);

    // Local state for response form
    const [response, setResponse] = useState({
        confirmedPrice: order.adminResponse?.confirmedPrice || 0,
        deliveryDate: order.adminResponse?.deliveryDate || '',
        note: order.adminResponse?.note || '',
        globalDiscountRate: order.adminResponse?.globalDiscountRate || 0 // [MOD] Add Global Discount State
    });

    // PO Specific State
    const [supplierInfo, setSupplierInfo] = useState(order.supplierInfo || {
        company_name: '(주)대경벤드',
        contact_name: '정호근 과장님',
        tel: '055 364 1800',
        email: 'dkb@daekyungbend.com',
        address: '경상남도 양산시 어실로 115',
        note: ''
    });

    const [buyerInfo, setBuyerInfo] = useState(() => {
        if (order.buyerInfo) return order.buyerInfo;
        // Default to ALTF info
        return {
            company_name: '(주)알트에프',
            contact_name: user?.contactName || '조현진 대표',
            tel: user?.phone || '051-303-3751',
            email: user?.email || 'altf@altf.kr',
            address: user?.address || '부산시 사상구 낙동대로1330번길 67'
        };
    });

    // Helper: Load My Info to Buyer Info
    const loadMyInfoToBuyer = () => {
        if (!user) return;
        setBuyerInfo(prev => ({
            ...prev,
            contact_name: user.contactName || '',
            tel: user.phone || '',
            email: user.email || ''
        }));
    };

    // Shipping Memo State (Editable)
    const [shippingMemo, setShippingMemo] = useState(() => {
        if (order.memo) return order.memo;
        const payload = order.payload;
        return payload?.customer?.memo || '';
    });

    // PO Info State
    const [poNumber, setPoNumber] = useState(order.poNumber || `PO-${order.id.slice(0, 8)}`);
    const [poTitle, setPoTitle] = useState(order.poTitle || '발주서 (PURCHASE ORDER)');

    // Calculation based on Displayed Items
    const calculatedTotal = displayedItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    // [MOD] Apply Global Discount to the Total Calculation
    // Logic: (ItemTotal + AdditionalCharges) * (1 - GlobalDiscount/100)
    const subTotalWithCharges = calculatedTotal + charges.reduce((sum, c) => sum + c.amount, 0);
    const globalDiscountAmount = Math.round(subTotalWithCharges * (response.globalDiscountRate / 100));
    const totalWithCharges = subTotalWithCharges - globalDiscountAmount;

    // Supplier Totals Calculation
    const { totalSupplierAmount, totalProfit } = displayedItems.reduce((acc, item) => {
        const product = inventory.find(p => p.id === item.productId);
        const basePrice = product?.base_price ?? product?.unitPrice ?? 0;
        const rate = item.supplierRate ?? 0;
        const supplierPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
        const supplierAmount = supplierPrice * item.quantity;
        const profit = (item.unitPrice - supplierPrice) * item.quantity;

        return {
            totalSupplierAmount: acc.totalSupplierAmount + supplierAmount,
            totalProfit: acc.totalProfit + profit
        };
    }, { totalSupplierAmount: 0, totalProfit: 0 });

    const handleAddItem = () => {
        setDisplayedItems([...displayedItems, {
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            productId: null,
            name: '',
            thickness: '',
            size: '',
            material: '',
            quantity: 0,
            unitPrice: 0,
            amount: 0,
            isVerified: false
        }]);
    };

    const handleRemoveItem = (index: number) => {
        if (confirm('품목을 삭제하시겠습니까? (저장 시 반영됩니다)')) {
            const newItems = displayedItems.filter((_, i) => i !== index);
            setDisplayedItems(newItems);
        }
    };

    const handleDownloadPO = () => {
        const payload: DocumentPayload = {
            document_type: 'PURCHASE_ORDER',
            meta: {
                doc_no: poNumber, // Custom PO Number
                created_at: new Date().toLocaleDateString(),
                channel: 'WEB',
                title: poTitle // Custom Title in meta
            },
            supplier: supplierInfo, // Vendor
            customer: {
                ...buyerInfo,
                address: buyerInfo.address, // Use Buyer Address
                memo: shippingMemo // Pass Shipping Memo explicitly
            },    // Buyer (ALTF)
            items: displayedItems.map((item, idx) => {
                const product = inventory.find(i => i.id === item.productId);
                const basePrice = product?.base_price ?? product?.unitPrice ?? 0;
                const supplierRate = item.supplierRate ?? 0;
                const supplierPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;

                return {
                    no: idx + 1,
                    item_name: item.name || '',
                    spec: `${item.thickness || ''} ${item.size || ''} ${item.material || ''}`.trim(), // Combined spec
                    thickness: item.thickness || '',
                    size: item.size || '',
                    material: item.material || '',
                    qty: item.quantity,
                    unit_price: supplierPrice,
                    amount: supplierPrice * item.quantity,
                    note: '',
                    stock_qty: product?.currentStock || 0,
                    stock_status: getStockStatusText(product?.stockStatus),
                    location_maker: product?.location || '-'
                };
            }),
            totals: {
                total_amount: totalSupplierAmount,
                currency: 'KRW',
                final_amount: totalSupplierAmount // VAT excluded in display usually, but PO total fits here
            },
            footer: {
                message: ''
            }
        };

        try {
            let html = renderDocumentHTML(payload);

            html = html.replace('</body>', '</body>');

            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(html);
                printWindow.document.close();
                // Printing is now handled by the template's window.onload script or user button
            } else {
                alert('팝업 차단을 해제해주세요.');
            }
        } catch (e) {
            console.error('Error generating PO:', e);
            alert('발주서 생성 중 오류가 발생했습니다.');
        }
    };

    const handleDownloadSalesOrder = () => {
        const payload: DocumentPayload = {
            document_type: 'TRANSACTION',
            meta: {
                doc_no: `ORD-${order.id.slice(0, 8)}`,
                created_at: new Date(order.createdAt).toLocaleDateString(),
                channel: 'WEB',
                delivery_date: order.adminResponse?.deliveryDate,
                title: '거래명세서 (Transaction Statement)'
            },
            supplier: {
                company_name: '(주)알트에프',
                contact_name: user?.contactName || '조현진 대표',
                tel: user?.phone || '051-303-3751',
                email: user?.email || 'altf@altf.kr',
                address: user?.address || '부산시 사상구 낙동대로1330번길 67'
            },
            customer: {
                // [MOD] Use Signup Info (linkedUser) specifically for Transaction Statement
                company_name: linkedUser?.companyName || order.customerName,
                contact_name: linkedUser?.contactName || customerInfo.contactName,
                tel: linkedUser?.phone || customerInfo.tel,
                email: linkedUser?.email || '',
                address: linkedUser?.address || '',
                memo: shippingMemo
            },
            items: displayedItems.map((item, idx) => ({
                no: idx + 1,
                item_name: item.name || '',
                spec: `${item.thickness || ''} ${item.size || ''} ${item.material || ''}`.trim(),
                thickness: item.thickness || '',
                size: item.size || '',
                material: item.material || '',
                qty: item.quantity,
                unit_price: item.unitPrice,
                amount: item.amount,
                note: '',
                stock_status: item.stockStatus
            })),
            totals: {
                total_amount: calculatedTotal,
                currency: 'KRW',
                // [MOD] Pass global discount info if needed, or just net absolute totals
                // For Transaction Statement, we usually show the Final Net Amount.
                // If we want to show the discount breakdown, we need to add fields to totals in documentTemplate.
                // For now, let's treat "totalWithCharges" as the Tax Base (Supply Price).

                // Calculate Pre-Discount Total
                // calculatedTotal is Item Total.
                // charges is Additional Charges.
                // baseForDiscount = calculatedTotal + charges

                // globalDiscountAmount is calculated in the component scope as:
                // const globalDiscountAmount = Math.round(subTotalWithCharges * (response.globalDiscountRate / 100));

                // Supply Price (Tax Base) = Subtotal - Discount
                // totalWithCharges is the Supply Price.

                vat_amount: Math.round(totalWithCharges * 0.1),
                final_amount: totalWithCharges + Math.round(totalWithCharges * 0.1),
                additional_charges: charges,
                global_discount_rate: response.globalDiscountRate,
                global_discount_amount: globalDiscountAmount
            },
            footer: {
                message: '감사합니다.'
            }
        };

        try {
            const html = renderDocumentHTML(payload);
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(html);
                printWindow.document.close();
            } else {
                alert('팝업 차단을 해제해주세요.');
            }
        } catch (e) {
            console.error('Error generating Sales Order:', e);
            alert('문서 생성 중 오류가 발생했습니다.');
        }
    };

    const handleItemChange = (index: number, field: keyof LineItem | 'spec', value: string | number) => {
        const newItems = [...displayedItems];
        if (field === 'spec') return;

        const updatedItem = { ...newItems[index], [field]: value };
        const matchedProduct = findProduct(updatedItem);

        if (matchedProduct) {
            // [Refactor] Align with User Cart Logic: Direct Price Application

            // 1. Set IDs and Status
            updatedItem.productId = matchedProduct.id;
            updatedItem.currentStock = matchedProduct.currentStock;
            updatedItem.stockStatus = matchedProduct.stockStatus;
            updatedItem.marking_wait_qty = matchedProduct.marking_wait_qty || 0;

            // 2. Set Prices
            // User Logic: Just use the product's unitPrice (Sales Price) directly
            updatedItem.unitPrice = matchedProduct.unitPrice;
            updatedItem.amount = updatedItem.unitPrice * updatedItem.quantity;

            // 3. Set Base Price (Reference) & Back-calculate Discount
            const basePrice = matchedProduct.base_price ?? matchedProduct.unitPrice ?? 0;
            updatedItem.base_price = basePrice;

            if (basePrice > 0 && updatedItem.unitPrice < basePrice) {
                updatedItem.discountRate = Math.round((1 - updatedItem.unitPrice / basePrice) * 100);
            } else {
                updatedItem.discountRate = 0;
            }

            // 4. Supplier Logic (Keep existing defaults)
            updatedItem.supplierRate = matchedProduct.rate_act2 ?? matchedProduct.rate_act ?? matchedProduct.rate_pct ?? 0;

        } else {
            // No Match: Unlink but keep user input
            updatedItem.productId = null;
            updatedItem.base_price = 0;
            updatedItem.stockStatus = undefined;
            updatedItem.marking_wait_qty = 0;
            updatedItem.supplierRate = 0;

            // Keep existing unitPrice/amount as typed by user
            updatedItem.amount = updatedItem.unitPrice * updatedItem.quantity;
        }

        newItems[index] = updatedItem;
        setDisplayedItems(newItems);
    };

    const handleSupplierRateChange = (index: number, rate: number) => {
        const newItems = [...displayedItems];
        newItems[index] = { ...newItems[index], supplierRate: rate };
        setDisplayedItems(newItems);
    };

    // Helper to find stock (Simple Match)
    const getProductStock = (item: LineItem) => {
        return findProduct(item);
    };

    const handlePriceChange = (index: number, newPrice: number) => {
        const newItems = [...displayedItems];
        const item = newItems[index];
        const product = getProductStock(item);
        let newRate = 0;
        const standardPrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? 0;
        if (standardPrice > 0) newRate = Math.round((1 - newPrice / standardPrice) * 100);
        newItems[index] = { ...item, unitPrice: newPrice, amount: newPrice * item.quantity, discountRate: newRate };
        setDisplayedItems(newItems);
    };

    const handleDiscountChange = (index: number, discountRate: number) => {
        const newItems = [...displayedItems];
        const item = newItems[index];
        const product = inventory.find(p => p.id === item.productId);
        const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? item.unitPrice;
        if (basePrice === 0) return;
        const newPrice = Math.round(Math.round(basePrice * (1 - discountRate / 100)) / 10) * 10;
        newItems[index] = { ...item, unitPrice: newPrice, discountRate: discountRate, amount: newPrice * item.quantity };
        setDisplayedItems(newItems);
    };

    const handleJustSave = () => {
        const updateData: Partial<Order> = {
            totalAmount: totalWithCharges,
            adminResponse: {
                ...response,
                confirmedPrice: totalWithCharges,
                additionalCharges: charges
            },
            status: 'PROCESSING',
            supplierInfo: supplierInfo,
            buyerInfo: buyerInfo,
            poNumber: poNumber,
            poTitle: poTitle,
            memo: shippingMemo,
            items: enrichedItems,
            po_items: enrichedPoItems,
            lastUpdatedBy: {
                name: user?.contactName || '관리자',
                id: user?.id || 'admin',
                email: user?.email || '',
                at: new Date().toISOString()
            }
        };

        onUpdate(order.id, updateData);
        alert('저장되었습니다.');
    };

    const handleSave = () => {
        const updateData: Partial<Order> = {
            totalAmount: totalWithCharges,
            adminResponse: {
                ...response,
                confirmedPrice: totalWithCharges,
                additionalCharges: charges
            },
            status: 'PROCESSING',
            supplierInfo: supplierInfo,
            buyerInfo: buyerInfo,
            poNumber: poNumber,
            poTitle: poTitle,
            memo: shippingMemo
        };

        // Update Separate Item Lists
        // If in Supplier Mode, we are editing PO items -> Save to po_items
        // If in Customer Mode, we are editing Customer items -> Save to items
        // HOWEVER, we should probably save BOTH states regardless of which mode we are in,
        // because we sync them constantly?
        // No, we sync only on inventory init.
        // User edits are in local state.

        // We should save the current local states.
        // Use enriched versions to ensure we persist the latest product matches/IDs
        updateData.items = enrichedItems;
        updateData.po_items = enrichedPoItems;

        // [MOD] Track Last Update (Task 19)
        updateData.lastUpdatedBy = {
            name: user?.contactName || '관리자',
            id: user?.id || 'admin',
            email: user?.email || '',
            at: new Date().toISOString()
        };

        onUpdate(order.id, updateData);
        onClose();
    };

    const handleSupplierSave = () => {
        if (user?.role !== 'MASTER' && user?.role !== 'MANAGER') {
            alert('권한이 없습니다 (Only Master/Manager allowed).');
            return;
        }
        if (!confirm('발주서를 전송하시겠습니까? (외부로 파일을 보낼 준비를 합니다)')) {
            return;
        }
        handleDownloadPO();
        handleSave();
    };


    return (
        <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
            {/* Backdrop */}


            {/* Slide-over Panel */}
            <div className="w-full max-w-7xl h-full bg-white shadow-2xl pointer-events-auto flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className={`flex items-center justify-between p-6 border-b ${isSupplierMode ? 'bg-indigo-50/50 border-indigo-100' : 'bg-slate-50/50 border-slate-100'}`}>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">Order ID</span>
                            <span className="text-xs font-mono font-bold text-slate-600">{order.id}</span>
                        </div>
                        <h2 className={`text-xl font-bold ${isSupplierMode ? 'text-indigo-900' : 'text-slate-900'}`}>
                            {isSupplierMode ? '매입 발주서 작성 (Supplier Order)' : '주문 상세 내역 (Customer Order)'}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        {isSupplierMode && (
                            <Button
                                variant="outline"
                                onClick={handleDownloadPO}
                                className="gap-2 font-bold bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            >
                                <Download className="w-4 h-4" />
                                발주서 출력
                            </Button>
                        )}
                        {!isSupplierMode && (
                            <Button
                                variant="outline"
                                onClick={handleDownloadSalesOrder}
                                className="gap-2 font-bold bg-white text-teal-600 border-teal-200 hover:bg-teal-50"
                            >
                                <Download className="w-4 h-4" />
                                거래명세서 출력
                            </Button>
                        )}
                        {!isSupplierMode && order.supplierInfo && (
                            <Button
                                variant="outline"
                                onClick={() => setIsSupplierMode(true)}
                                className="gap-2 font-bold bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            >
                                <FileText className="w-4 h-4" />
                                작성된 발주서 보기
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            onClick={() => setIsSupplierMode(!isSupplierMode)}
                            className={`gap-2 font-bold ${isSupplierMode ? 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                        >
                            {isSupplierMode ? <User className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                            {isSupplierMode ? '주문 내역으로 돌아가기' : '매입 발주서로 전환'}
                        </Button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                            aria-label="닫기"
                        >
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

                    {/* Info Block: Customer (Normal) vs PO Info (Supplier) */}
                    {isSupplierMode ? (
                        <div className="bg-white rounded-xl border border-indigo-200 p-5 shadow-sm bg-indigo-50/20">
                            <h3 className="text-sm font-bold text-indigo-900 border-b border-indigo-100 pb-3 mb-3 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-indigo-600" />
                                발주서 정보 설정 (Purchase Order Info)
                            </h3>

                            {/* PO Number & Title Inputs */}
                            <div className="grid grid-cols-2 gap-6 mb-4 pb-4 border-b border-indigo-100">
                                <div>
                                    <label className="block text-xs font-bold text-indigo-700 mb-1">발주 번호 (PO No.)</label>
                                    <input
                                        type="text"
                                        value={poNumber}
                                        onChange={(e) => setPoNumber(e.target.value)}
                                        className="w-full px-2 py-1.5 text-sm border border-indigo-200 rounded focus:border-indigo-500 outline-none font-mono font-bold text-indigo-900"
                                        placeholder="PO-..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-indigo-700 mb-1">발주서 제목 (Title)</label>
                                    <input
                                        type="text"
                                        value={poTitle}
                                        onChange={(e) => setPoTitle(e.target.value)}
                                        className="w-full px-2 py-1.5 text-sm border border-indigo-200 rounded focus:border-indigo-500 outline-none font-bold text-indigo-900"
                                        placeholder="발주서 (PURCHASE ORDER)"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                {/* Vendor Info */}
                                <div className="space-y-3">
                                    <h4 className="text-xs font-bold text-indigo-700 uppercase">공급자 (Vendor) - 매입처</h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        <input
                                            placeholder="상호 (Company)"
                                            value={supplierInfo.company_name}
                                            onChange={e => setSupplierInfo({ ...supplierInfo, company_name: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded"
                                        />
                                        <input
                                            placeholder="담당자 (Contact)"
                                            value={supplierInfo.contact_name}
                                            onChange={e => setSupplierInfo({ ...supplierInfo, contact_name: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded"
                                        />
                                        <input
                                            placeholder="연락처 (Tel)"
                                            value={supplierInfo.tel}
                                            onChange={e => setSupplierInfo({ ...supplierInfo, tel: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded"
                                        />
                                        <input
                                            placeholder="이메일 (Email)"
                                            value={supplierInfo.email}
                                            onChange={e => setSupplierInfo({ ...supplierInfo, email: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded"
                                        />
                                        <input
                                            placeholder="주소 (Address)"
                                            value={supplierInfo.address}
                                            onChange={e => setSupplierInfo({ ...supplierInfo, address: e.target.value })}
                                            className="col-span-2 px-2 py-1.5 text-sm border rounded"
                                        />
                                        <textarea
                                            placeholder="비고 (Note)"
                                            value={supplierInfo.note}
                                            onChange={e => setSupplierInfo({ ...supplierInfo, note: e.target.value })}
                                            className="col-span-2 px-2 py-1.5 text-sm border rounded h-16 resize-none"
                                        />
                                    </div>
                                </div>
                                {/* Buyer Info */}
                                <div className="space-y-3">
                                    {order.memo && (
                                        <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-xs mb-2">
                                            <span className="font-bold text-yellow-800 block mb-1">고객 요청/배송 메모 (Customer Memo):</span>
                                            <div className="whitespace-pre-wrap text-slate-700">{order.memo}</div>
                                            <button
                                                onClick={() => {
                                                    // Quick Action: Copy Memo to Note or Address?
                                                    // For now just display it so admin can see while editing
                                                }}
                                                className="text-indigo-600 underline mt-1 hidden"
                                            >
                                                복사하기
                                            </button>
                                        </div>
                                    )}
                                    <h4 className="text-xs font-bold text-indigo-700 uppercase">발주자 (Buyer) / 배송지 (Ship To)</h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        <input
                                            placeholder="상호"
                                            value={buyerInfo.company_name}
                                            onChange={e => setBuyerInfo({ ...buyerInfo, company_name: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded bg-slate-50"
                                        />
                                        <input
                                            placeholder="담당자 (Contact)"
                                            value={buyerInfo.contact_name}
                                            onChange={e => setBuyerInfo({ ...buyerInfo, contact_name: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded bg-slate-50"
                                        />
                                        <input
                                            placeholder="연락처"
                                            value={buyerInfo.tel}
                                            onChange={e => setBuyerInfo({ ...buyerInfo, tel: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded bg-slate-50"
                                        />
                                        <input
                                            placeholder="이메일"
                                            value={buyerInfo.email}
                                            onChange={e => setBuyerInfo({ ...buyerInfo, email: e.target.value })}
                                            className="px-2 py-1.5 text-sm border rounded bg-slate-50"
                                        />
                                        <input
                                            placeholder="주소"
                                            value={buyerInfo.address}
                                            onChange={e => setBuyerInfo({ ...buyerInfo, address: e.target.value })}
                                            className="col-span-2 px-2 py-1.5 text-sm border rounded bg-slate-50"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Order & Shipping Info */
                        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3 flex items-center gap-2">
                                <User className="w-4 h-4 text-teal-600" />
                                주문 및 배송 정보 (Order & Shipping Info)
                            </h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                {/* Basic Customer Details (Read-only/Link references) */}
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">업체명 (Customer)</span>
                                    <span className="font-bold text-slate-800">{order.customerName}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">사업자번호 (Biz No)</span>
                                    <span className="font-mono text-slate-600">{order.customerBizNo || customerInfo.bizNo || linkedUser?.bizNo || '-'}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">업태/종목 (Biz Type)</span>
                                    {/* Mock or Fetch if available, otherwise just placeholder or hidden */}
                                    <span className="text-slate-600">-</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">담당자명 (Contact)</span>
                                    <span className="font-bold text-slate-800">{customerInfo.contactName}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">연락처 (Phone)</span>
                                    <span className="font-mono text-slate-600">{customerInfo.tel}</span>
                                </div>

                                {/* Status & Date */}
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">주문일시 (Date)</span>
                                    <span className="text-slate-600">{new Date(order.createdAt).toLocaleString()}</span>
                                </div>
                                <div>
                                    <span className="block text-slate-400 text-xs mb-1">현재 상태 (Status)</span>
                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${order.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-700' :
                                        order.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                        }`}>
                                        {order.status}
                                    </span>
                                </div>

                                {/* Editable Shipping Info */}
                                <div className="col-span-2 pt-3 border-t border-slate-100 mt-1">
                                    <h4 className="text-xs font-bold text-teal-700 mb-2 flex items-center gap-1">
                                        <Package className="w-3 h-3" /> 발주-담당자                                     </h4>
                                    <div className="grid grid-cols-1 gap-3">
                                        <div>
                                            <div className="flex items-center gap-4">
                                                <div className="flex-1">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <label className="block text-xs text-slate-400">수취인/담당자 (Recipient)</label>
                                                        <button
                                                            onClick={loadMyInfoToBuyer}
                                                            className="text-[10px] text-teal-600 font-bold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100 hover:bg-teal-100"
                                                            title="내 정보 불러오기"
                                                        >
                                                            나 (Me)
                                                        </button>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={buyerInfo.contact_name}
                                                        onChange={(e) => setBuyerInfo({ ...buyerInfo, contact_name: e.target.value })}
                                                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none"
                                                        placeholder="이름"
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <label className="block text-xs text-slate-400 mb-1">연락처 (Tel)</label>
                                                    <input
                                                        type="text"
                                                        value={buyerInfo.tel}
                                                        onChange={(e) => setBuyerInfo({ ...buyerInfo, tel: e.target.value })}
                                                        className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none"
                                                        placeholder="연락처"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">주소(Address) </label>
                                            <input
                                                type="text"
                                                value={buyerInfo.address}
                                                onChange={(e) => setBuyerInfo({ ...buyerInfo, address: e.target.value })}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none"
                                                placeholder="배송지 주소 입력"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">배송 요청사항 (Shipping Memo)</label>
                                            <textarea
                                                value={shippingMemo}
                                                onChange={(e) => setShippingMemo(e.target.value)}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none resize-none h-16 bg-yellow-50/50"
                                                placeholder="배송 요청사항을 입력하세요."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Order Items Table */}
                    <div>
                        <h3 className={`text-sm font-bold mb-3 flex items-center gap-2 ${isSupplierMode ? 'text-indigo-900' : 'text-slate-900'}`}>
                            <Package className={`w-4 h-4 ${isSupplierMode ? 'text-indigo-600' : 'text-teal-600'}`} />
                            {isSupplierMode ? '매입 발주 품목 및 단가 설정' : '주문 품목 및 재고 확인'}
                        </h3>
                        <div className={`border rounded-xl overflow-hidden shadow-sm ${isSupplierMode ? 'border-indigo-200' : 'border-slate-200'}`}>
                            <table className="w-full text-sm text-left">
                                <thead className={`${isSupplierMode ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-600'} border-b ${isSupplierMode ? 'border-indigo-200' : 'border-slate-200'} text-sm font-bold uppercase`}>
                                    <tr>
                                        <th className="px-2 py-3 w-[3%] text-center font-normal text-slate-400">No.</th>
                                        <th className="px-4 py-3 w-[30%] text-left">품목명 / 규격 (Item/Spec)</th>
                                        <th className="px-2 py-3 text-center w-[5%]">수량</th>
                                        {isSupplierMode ? (
                                            /* Supplier Columns */
                                            <>
                                                <th className="px-2 py-3 text-right w-[8%]">
                                                    판매단가
                                                    <div className="text-[10px] font-normal opacity-70">(Sales)</div>
                                                </th>
                                                <th className="px-2 py-3 text-right w-[8%]">
                                                    기준단가
                                                    <div className="text-[10px] font-normal opacity-70">(Base)</div>
                                                </th>
                                                <th className="px-1 py-3 text-right w-[6%]">
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className="text-xs font-bold text-indigo-700">매입율 (%)</span>
                                                        <div className="flex items-center justify-end gap-1 w-full">
                                                            <input
                                                                type="number"
                                                                inputMode="numeric"
                                                                placeholder="일괄"
                                                                className="w-full px-1 py-0.5 text-center text-xs border border-indigo-200 rounded focus:border-indigo-500 outline-none text-indigo-700 bg-indigo-50/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-indigo-300"
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        const val = Number(e.currentTarget.value);
                                                                        if (!isNaN(val)) {
                                                                            const newItems = displayedItems.map(item => ({
                                                                                ...item,
                                                                                supplierRate: val
                                                                            }));
                                                                            setDisplayedItems(newItems);
                                                                        }
                                                                    }
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const newItems = displayedItems.map(item => {
                                                                        const product = inventory.find(p => p.id === item.productId);
                                                                        const productRate = product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
                                                                        return { ...item, supplierRate: productRate };
                                                                    });
                                                                    setDisplayedItems(newItems);
                                                                }}
                                                                className="px-1 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 whitespace-nowrap"
                                                                title="모두 기본 매입율 적용"
                                                            >
                                                                All
                                                            </button>
                                                        </div>
                                                    </div>
                                                </th>
                                                <th className="px-1 py-3 text-right w-[7%] text-xs font-bold">
                                                    매입단가
                                                    <div className="text-[10px] font-normal opacity-70">(Cost)</div>
                                                </th>
                                                <th className="px-2 py-3 text-right whitespace-nowrap w-[8%]">
                                                    매입금액
                                                    <div className="text-[10px] font-normal opacity-70">(Total)</div>
                                                </th>
                                                <th className="px-2 py-3 text-right text-green-600 whitespace-nowrap w-[7%]">
                                                    이익
                                                    <div className="text-[10px] font-normal opacity-70">(Profit)</div>
                                                </th>
                                                <th className="px-1 py-3 w-[2%]"></th>
                                            </>
                                        ) : (
                                            /* Customer Columns */
                                            <>
                                                <th className="px-2 py-3 text-center w-[5%]">현재재고</th>
                                                <th className="px-2 py-3 text-center w-[5%]">상태</th>
                                                <th className="px-2 py-3 text-right text-slate-500 w-[7%]">기준단가 (Base)</th>
                                                <th className="px-4 py-3 text-center w-[8%]">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-xs">Rate (요율)</span>
                                                        <div className="flex items-center gap-1 w-full max-w-[80px]">
                                                            <input
                                                                type="number"
                                                                inputMode="numeric"
                                                                placeholder="일괄"
                                                                className="w-full px-1 py-0.5 text-center text-xs border border-slate-300 rounded focus:border-teal-500 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        const val = Number(e.currentTarget.value);
                                                                        if (!isNaN(val)) {
                                                                            const newItems = displayedItems.map(item => {
                                                                                const product = inventory.find(p => p.id === item.productId);
                                                                                // Calculate new price based on base price and bulk discount
                                                                                const basePrice = product ? product.unitPrice : item.unitPrice;
                                                                                if (basePrice > 0) {
                                                                                    const newPrice = Math.round(Math.round(basePrice * (1 - val / 100)) / 10) * 10;
                                                                                    return {
                                                                                        ...item,
                                                                                        discountRate: val,
                                                                                        unitPrice: newPrice,
                                                                                        amount: newPrice * item.quantity
                                                                                    };
                                                                                }
                                                                                return { ...item, discountRate: val };
                                                                            });
                                                                            setDisplayedItems(newItems);
                                                                        }
                                                                    }
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    // Accept All: Reset discount to 0 and match base price
                                                                    const newItems = displayedItems.map(item => {
                                                                        const product = inventory.find(p => p.id === item.productId);
                                                                        const basePrice = product ? product.unitPrice : item.unitPrice;
                                                                        return {
                                                                            ...item,
                                                                            discountRate: 0,
                                                                            unitPrice: basePrice,
                                                                            amount: basePrice * item.quantity
                                                                        };
                                                                    });
                                                                    setDisplayedItems(newItems);
                                                                }}
                                                                className="px-1 py-0.5 text-[10px] bg-teal-50 text-teal-600 border border-teal-200 rounded hover:bg-teal-100 whitespace-nowrap"
                                                                title="모두 기본단가 적용 (0%)"
                                                            >
                                                                All
                                                            </button>
                                                        </div>
                                                    </div>
                                                </th>
                                                <th className="px-2 py-3 text-right w-[7%]">단가 (실구매가)</th>
                                                <th className="px-2 py-3 text-right w-[9%]">금액 (VAT별도)</th>
                                            </>
                                        )}
                                        {!isSupplierMode && <th className="px-1 py-3 w-[2%]"></th>}
                                    </tr>
                                </thead>
                                <tbody className={`divide-y ${isSupplierMode ? 'divide-indigo-100' : 'divide-slate-100'}`}>
                                    {displayedItems.map((item, idx) => {
                                        // 1. Try to find live product
                                        let product = getProductStock(item);

                                        // 2. If not found, but we have stored data, create a "Fallback Product"
                                        //    This ensures the UI shows the stored values instead of "Unlinked" / "-"
                                        if (!product && item.base_price && item.base_price > 0) {
                                            product = {
                                                id: item.productId || item.itemId || 'fallback-' + idx,
                                                name: item.name,
                                                thickness: item.thickness,
                                                size: item.size,
                                                material: item.material,
                                                unitPrice: item.unitPrice,
                                                currentStock: item.currentStock || 0,
                                                stockStatus: item.stockStatus || 'AVAILABLE',
                                                location: item.location,
                                                maker: item.maker,
                                                base_price: item.base_price,
                                                // items from order/quote might not have all fields, but we fill what controls the UI
                                            } as Product;
                                        }

                                        const currentStock = product ? product.currentStock : 0;
                                        const isStockInsufficient = item.quantity > currentStock;

                                        // It is only "Unlinked" if we strictly have NO product (live OR fallback)
                                        const isUnlinked = !product;

                                        // Standard price is the linked product's price, or item.base_price (snapshot), or unitPrice as last resort
                                        const standardPrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? 0;
                                        const isPriceModified = !isUnlinked && item.unitPrice !== standardPrice;

                                        // Supplier Logic
                                        // Use robust matching to find the product LIVE from inventory
                                        const liveProduct = getProductStock(item);
                                        // Logic: Live Base -> Stored Base -> Live Unit -> 0
                                        const basePrice = liveProduct?.base_price ?? item.base_price ?? liveProduct?.unitPrice ?? 0;

                                        const supplierRate = item.supplierRate ?? 0;
                                        // Formula: Base * (100 - Rate) / 100
                                        const supplierPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
                                        const supplierAmount = supplierPrice * item.quantity;
                                        // Profit = (Customer Sales Price - Supplier Cost Price) * Quantity
                                        const profit = (item.unitPrice - supplierPrice) * item.quantity;

                                        return (
                                            <tr key={idx} className={isUnlinked ? 'bg-red-50/30' : (isSupplierMode ? 'bg-white hover:bg-indigo-50/30' : (isStockInsufficient ? 'bg-red-50/50' : 'bg-white hover:bg-slate-50')) + ' transition-colors'}>
                                                <td className="px-2 py-3 text-center align-middle text-xs font-bold text-slate-500">
                                                    {idx + 1}
                                                </td>
                                                <td className="px-4 py-3 text-left align-middle">
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="text"
                                                            value={item.name}
                                                            title="Item Name"
                                                            placeholder="품목명"
                                                            onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                                            className="w-[4.5rem] px-2 py-1.5 rounded border border-slate-200 focus:border-teal-500 outline-none text-xs font-bold text-slate-800"
                                                        />
                                                        <span className="text-slate-300 select-none">-</span>
                                                        <input
                                                            type="text"
                                                            value={item.thickness}
                                                            title="Thickness"
                                                            onChange={(e) => handleItemChange(idx, 'thickness', e.target.value)}
                                                            className="w-14 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                                                            placeholder="T"
                                                        />
                                                        <span className="text-slate-300 select-none">-</span>
                                                        <input
                                                            type="text"
                                                            value={item.size}
                                                            title="Size"
                                                            onChange={(e) => handleItemChange(idx, 'size', e.target.value)}
                                                            className="w-[6.5rem] px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                                                            placeholder="Size"
                                                        />
                                                        <span className="text-slate-300 select-none">-</span>
                                                        <input
                                                            type="text"
                                                            value={item.material}
                                                            title="Material"
                                                            onChange={(e) => handleItemChange(idx, 'material', e.target.value)}
                                                            className="w-20 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                                                            placeholder="Mat"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center align-middle">
                                                    <input
                                                        type="number"
                                                        title="Supplier Item Quantity"
                                                        value={item.quantity}
                                                        onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                                                        className="w-12 text-center px-1 py-1 rounded border border-indigo-200 outline-none focus:border-indigo-500 font-mono font-bold text-slate-800 text-xs"
                                                    />
                                                </td>

                                                {
                                                    isSupplierMode ? (
                                                        /* Supplier Mode Cells */
                                                        <>
                                                            <td className="px-4 py-3 text-right align-middle text-slate-700 font-mono text-xs font-bold">
                                                                {formatCurrency(item.unitPrice)}
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle text-slate-900 font-mono text-xs font-bold">
                                                                {basePrice > 0 ? formatCurrency(basePrice) : '-'}
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle">
                                                                <div className="relative w-full">
                                                                    <input
                                                                        type="number"
                                                                        inputMode="numeric"
                                                                        value={supplierRate === 0 ? '' : supplierRate}
                                                                        placeholder="0"
                                                                        title="Supplier Rate"
                                                                        className="w-full text-center px-1 py-1.5 rounded border border-indigo-200 text-sm outline-none focus:border-indigo-500 font-bold text-indigo-600 bg-indigo-50/50"
                                                                        onChange={(e) => handleSupplierRateChange(idx, Number(e.target.value))}
                                                                    />
                                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-indigo-300">%</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle font-mono font-extrabold text-indigo-700 text-xs">
                                                                {formatCurrency(supplierPrice)}
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle font-mono font-extrabold text-slate-900 text-sm">
                                                                {formatCurrency(supplierAmount)}
                                                            </td>
                                                            <td className={`px-4 py-3 text-right align-middle font-mono font-extrabold text-xs ${profit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                {profit > 0 ? '+' : ''}{formatCurrency(profit)}
                                                            </td>
                                                            <td className="px-2 py-3 text-center align-middle">
                                                                <button
                                                                    onClick={() => handleRemoveItem(idx)}
                                                                    className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                                    title="품목 삭제"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </td>
                                                        </>
                                                    ) : (
                                                        /* Customer Mode Row Cells */
                                                        <>
                                                            <td className="px-4 py-3 text-center align-middle font-mono text-sm font-bold text-slate-900">
                                                                {isUnlinked ? '-' : currentStock.toLocaleString()}
                                                            </td>
                                                            <td className="px-4 py-3 text-center align-middle">
                                                                {isUnlinked ? (
                                                                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">미연동</span>
                                                                ) : isStockInsufficient ? (
                                                                    <div className="flex items-center justify-center gap-1 text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded">
                                                                        <AlertTriangle className="w-3 h-3" /> 부족
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center justify-center gap-1 text-teal-600 font-bold text-xs bg-teal-50 px-2 py-1 rounded">
                                                                        <Check className="w-3 h-3" /> 가능
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle font-mono text-sm font-bold text-slate-700">
                                                                {standardPrice > 0 ? formatCurrency(standardPrice) : '-'}
                                                            </td>
                                                            <td className="px-4 py-3 text-center align-middle">
                                                                <div className="relative w-full">
                                                                    <input
                                                                        type="number"
                                                                        inputMode="numeric"
                                                                        value={item.discountRate || ''}
                                                                        placeholder="0"
                                                                        title="Discount Percentage"
                                                                        className="w-full text-center px-1 py-1.5 rounded border border-slate-200 text-sm outline-none focus:border-teal-500 font-bold text-red-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                        onChange={(e) => handleDiscountChange(idx, Number(e.target.value))}
                                                                    />
                                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle">
                                                                <input
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    value={item.unitPrice.toLocaleString()}
                                                                    title="Unit Price"
                                                                    onChange={(e) => {
                                                                        const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                                                                        handlePriceChange(idx, val);
                                                                    }}
                                                                    className={`w-28 text-right px-2 py-1.5 rounded border outline-none font-mono text-sm font-extrabold text-slate-900 ${isPriceModified
                                                                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                                                                        : 'border-slate-200 focus:border-teal-500'
                                                                        }`}
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3 text-right align-middle font-mono font-extrabold text-slate-900 text-sm">
                                                                {formatCurrency(item.amount)}
                                                            </td>
                                                            <td className="px-2 py-3 text-center align-middle">
                                                                <button
                                                                    onClick={() => handleRemoveItem(idx)}
                                                                    className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                                    title="품목 삭제"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </td>
                                                        </>
                                                    )
                                                }
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className={`${isSupplierMode ? 'bg-indigo-50/50' : 'bg-slate-50'} border-t ${isSupplierMode ? 'border-indigo-200' : 'border-slate-200'}`}>
                                    <tr>
                                        {isSupplierMode ? (
                                            <>
                                                {/* Supplier Mode Footer: Sales - Cost = Profit */}
                                                <td colSpan={9} className="px-6 py-4 text-right bg-indigo-50/30 align-middle">
                                                    <div className="flex items-center justify-end gap-6 select-none">

                                                        {/* Sales Total */}
                                                        <div className="flex flex-col items-end opacity-60">
                                                            <span className="text-xs font-bold text-slate-500 mb-1">총 판매 금액 (Sales Total)</span>
                                                            <span className="font-mono text-lg font-bold text-slate-600">{formatCurrency(calculatedTotal)}</span>
                                                        </div>

                                                        {/* Minus Pattern */}
                                                        <div className="text-slate-300 pb-2">
                                                            <Minus className="w-5 h-5" />
                                                        </div>

                                                        {/* Supplier Total (Highlighted as Payable) */}
                                                        <div className="flex flex-col items-end relative">
                                                            <div className="absolute -top-3 right-0 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm animate-pulse">
                                                                실제 송금액 (Payable)
                                                            </div>
                                                            <span className="text-xs font-bold text-indigo-700 mb-1">총 매입 금액 (Supplier Total)</span>
                                                            <span className="font-mono text-2xl font-bold text-indigo-700">{formatCurrency(totalSupplierAmount)}</span>
                                                        </div>

                                                        {/* Equal Pattern */}
                                                        <div className="text-slate-300 pb-2">
                                                            <Equal className="w-5 h-5" />
                                                        </div>

                                                        {/* Profit */}
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-xs font-bold text-slate-500 mb-1">예상 이익 (Profit)</span>
                                                            <span className={`font-mono text-xl font-bold ${totalProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                {totalProfit > 0 ? '+' : ''}{formatCurrency(totalProfit)}
                                                            </span>
                                                        </div>

                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                {/* Customer Mode Footer */}
                                                <td colSpan={7} className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">
                                                    Total Amount (VAT 별도)
                                                </td>
                                                <td colSpan={2} className="px-4 py-3 text-right font-mono text-lg font-bold text-teal-700">
                                                    {formatCurrency(calculatedTotal)}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div className="mt-2 text-right">
                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleAddItem}
                                    className="text-xs h-8"
                                >
                                    <Plus className="w-3 h-3 mr-1" /> 항목 추가
                                </Button>
                            </div>
                        </div>
                    </div>

                    {!isSupplierMode && (
                        <>
                            {/* Additional Charges Section */}
                            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
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
                                                        className={`px-2 py-2 rounded text-xs font-bold border transition-colors ${isNegative
                                                            ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                            : 'bg-teal-50 text-teal-600 border-teal-200 hover:bg-teal-100'
                                                            }`}
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
                                                        className={`w-32 px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-teal-500 text-right font-mono font-bold ${isNegative ? 'text-red-500' : 'text-slate-700'}`}
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

                                    {/* [MOD] Global Discount Field */}
                                    <div className="pt-3 border-t border-dashed border-slate-200 mt-2">
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 text-sm font-bold text-slate-700 text-right">
                                                전체 할인율 (Global Discount %):
                                            </div>
                                            <div className="relative w-32">
                                                <input
                                                    type="number"
                                                    value={response.globalDiscountRate}
                                                    onChange={(e) => setResponse({ ...response, globalDiscountRate: Number(e.target.value) })}
                                                    className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded text-sm text-right font-bold text-red-500 outline-none focus:border-red-500 bg-red-50/10"
                                                    placeholder="0"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                                            </div>
                                        </div>
                                        {response.globalDiscountRate > 0 && (
                                            <div className="text-right text-xs text-red-500 mt-1 font-bold">
                                                - {formatCurrency(globalDiscountAmount)} 할인 적용됨
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Admin Response Form */}
                            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                                    <Check className="w-4 h-4 text-teal-600" />
                                    관리자 응답 작성 (견적 확정)
                                </h3>

                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="confirmedPrice" className="block text-xs font-bold text-slate-500 mb-1">총 견적 금액 (확정)</label>
                                        <div className="relative">
                                            <div className="w-full pl-4 pr-4 py-2 rounded-lg border border-slate-200 bg-slate-100 font-mono font-bold text-slate-800 flex items-center justify-between">
                                                <span>{formatCurrency(totalWithCharges)}</span>
                                                <span className="text-xs text-slate-500 font-normal">(VAT 별도)</span>
                                            </div>
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
                                                        <span>{formatCurrency(charges.reduce((acc, c) => acc + c.amount, 0))}</span>
                                                    </div>
                                                    {response.globalDiscountRate > 0 && (
                                                        <div className="flex justify-between font-bold text-red-500 pt-1">
                                                            <span>전체 할인 ({response.globalDiscountRate}%):</span>
                                                            <span>- {formatCurrency(globalDiscountAmount)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>


                                    <div>
                                        <label htmlFor="deliveryDate" className="block text-xs font-bold text-slate-500 mb-1">예상 납품일 (납기)</label>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                id="deliveryDate"
                                                type="date"
                                                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                                value={response.deliveryDate}
                                                onChange={(e) => setResponse({ ...response, deliveryDate: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="adminNote" className="block text-xs font-bold text-slate-500 mb-1">관리자 메모 (고객에게 전달됨)</label>
                                        <textarea
                                            id="adminNote"
                                            className="w-full p-3 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none text-sm resize-none h-24"
                                            placeholder="특이사항이나 전달할 내용을 입력하세요."
                                            value={response.note}
                                            onChange={(e) => setResponse({ ...response, note: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-200 bg-white flex items-center justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>
                        닫기
                    </Button>
                    <Button
                        onClick={isSupplierMode ? handleSupplierSave : handleSave}
                        className={`shadow-lg px-6 ${isSupplierMode
                            ? 'bg-red-600 hover:bg-red-700 shadow-red-500/20'
                            : 'bg-teal-600 hover:bg-teal-700 shadow-teal-500/20'} text-white`}
                    >
                        {isSupplierMode ? '매입 발주서 저장/전송' : '주문 확정 및 답변 전송'}
                    </Button>
                    <Button
                        onClick={handleJustSave}
                        className="bg-slate-800 text-white hover:bg-slate-900 shadow-lg px-4"
                    >
                        저장 (Save)
                    </Button>
                </div>

            </div >
        </div >
    );
});
