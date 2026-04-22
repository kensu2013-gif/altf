import { useState, memo, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Order, LineItem, Product, User as UserType } from '../../../types';
// import { generateSku } from '../../../lib/sku'; // REMOVED: Managed in useInventoryIndex
import { useStore } from '../../../store/useStore';
import { X, AlertTriangle, Check, Calendar, Package, User, Trash2, Plus, Download, FileText, Minus, Equal, Send, SplitSquareHorizontal, Image } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useInventoryIndex } from '../../../hooks/useInventoryIndex';


import { formatCurrency } from '../../../lib/utils';
import { renderDocumentHTML } from '../../../lib/documentTemplate';
import type { DocumentPayload } from '../../../types/document';
import { PreviewModal } from '../../../components/ui/PreviewModal';
import { ManagerMultiSelect } from '../../../components/ui/ManagerMultiSelect';

interface AdminOrderDetailProps {
    order: Order;
    onClose: () => void;
    onUpdate: (orderId: string, updates: Partial<Order>) => void;
    initialMode?: 'CUSTOMER' | 'SUPPLIER'; // [MOD] Added initialMode prop
}

// ... (helpers) ...

interface CrmCustomerOption {
    id?: string;
    companyName: string;
    contactName?: string;
    ceo?: string;
    email?: string;
    phone?: string;
    businessNumber?: string;
    address?: string;
    isDeleted?: boolean;
}


export const AdminOrderDetail = memo(function AdminOrderDetail({ order, onClose, onUpdate, initialMode = 'CUSTOMER' }: AdminOrderDetailProps) {
    const inventory = useStore((state) => state.inventory);
    const user = useStore((state) => state.auth.user);
    const users = useStore((state) => state.users);
    const customPrices = useStore((state) => state.customPrices);
    const saveCustomPrices = useStore((state) => state.saveCustomPrices);

    const { findProduct } = useInventoryIndex(inventory);

    const linkedUser = useMemo(() => users.find((u: UserType) => u.id === order.userId), [users, order.userId]);
    const customerInfo = useMemo(() => {
        const payloadCustomer = order.payload?.customer as Record<string, string> | undefined;
        return {
            name: payloadCustomer?.company_name || user?.companyName || 'Unknown',
            contactName: payloadCustomer?.contact_name || user?.contactName || '',
            tel: payloadCustomer?.tel || user?.phone || '',
            bizNo: payloadCustomer?.business_no || payloadCustomer?.biz_no || user?.bizNo || '-',
            email: payloadCustomer?.email || user?.email || '',
            address: payloadCustomer?.address || user?.address || ''
        };
    }, [order.payload, user]);

    const cleanDefault = (val: string) => {
        if (!val) return '';
        if (val === '000-00-00000' || val === '-' || val === 'Admin' || val === '010-0000-0000' || val === 'Unknown') return '';
        return val;
    };

    const [editableCustomerInfo, setEditableCustomerInfo] = useState({
        bizNo: cleanDefault(order.customerBizNo || customerInfo.bizNo),
        bizType: order.customerBizType || '',
        contactName: cleanDefault(order.customerContactName || customerInfo.contactName),
        tel: cleanDefault(order.customerTel || customerInfo.tel),
        email: cleanDefault(order.customerEmail || customerInfo.email),
        address: cleanDefault(order.customerAddress || customerInfo.address)
    });

    const [crmCustomers, setCrmCustomers] = useState<CrmCustomerOption[]>([]);
    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
            headers: {
                'Content-Type': 'application/json',
                ...(user?.id ? { 'x-requester-id': user.id } : {}),
                ...(user?.role ? { 'x-requester-role': user.role } : {})
            }
        })
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) setCrmCustomers(data.filter((c: CrmCustomerOption) => !c.isDeleted));
        })
        .catch(console.error);
    }, [user]);

    const [poEndCustomer, setPoEndCustomer] = useState(order.poEndCustomer || order.customerName || '');

    const uploadFile = useStore(state => state.uploadFile);

    // ... (state initialization) ...

    // Supplier Mode State
    const [isSupplierMode, setIsSupplierMode] = useState(initialMode === 'SUPPLIER');

    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [previewType, setPreviewType] = useState<'PO' | 'SALES' | 'PACKING'>('PO');

    const setMobileModalOpen = useStore((state) => state.setMobileModalOpen);

    useEffect(() => {
        setMobileModalOpen(true);
        return () => setMobileModalOpen(false);
    }, [setMobileModalOpen]);

    const [items, setItems] = useState<LineItem[]>(order.items || []);
    const [poItems, setPoItems] = useState<LineItem[]>(() => {
        // [FIX] If PO Items specific list exists, use it.
        // If not, clone the Customer Items as the starting point for the PO.
        if (order.po_items && order.po_items.length > 0) {
            return order.po_items;
        }
        return order.items ? [...order.items] : [];
    });

    // [MOD] Ensure poItems stays synced with base properties from items (sales price, quantity, etc.)
    useEffect(() => {
        setPoItems(prev => prev.map((poItem, idx) => {
            const cItem = items[idx];
            if (!cItem) return poItem;
            // Sync core fields so manual inputs in Customer Mode flow into Supplier Mode
            if (poItem.unitPrice !== cItem.unitPrice || poItem.quantity !== cItem.quantity || poItem.amount !== cItem.amount || poItem.name !== cItem.name || poItem.thickness !== cItem.thickness || poItem.size !== cItem.size || poItem.material !== cItem.material) {
                return {
                    ...poItem,
                    name: cItem.name,
                    thickness: cItem.thickness,
                    size: cItem.size,
                    material: cItem.material,
                    quantity: cItem.quantity,
                    unitPrice: cItem.unitPrice,
                    amount: cItem.amount,
                };
            }
            return poItem;
        }));
    }, [items]);

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
                isSelected: item.isSelected ?? true // default to true
            };
        }

        return {
            ...item,
            productId: null,
            isVerified: false,
            currentStock: 0,
            stockStatus: undefined,
            base_price: 0,
            marking_wait_qty: 0,
            isSelected: item.isSelected ?? true // default to true
        };
    }, [findProduct]);

    // [Refactor] Use Derived State for Item Enrichment instead of Syncing State
    // This prevents "setState during render" warnings and ensures items are always up-to-date with inventory.
    const enrichedItems = useMemo(() => items.map(i => enrichItem(i)), [items, enrichItem]);
    const enrichedPoItems = useMemo(() => poItems.map(i => enrichItem(i)), [poItems, enrichItem]);

    // Computed Properties for "Current View" - Use Enriched Versions
    const displayedItems = isSupplierMode ? enrichedPoItems : enrichedItems;
    const setDisplayedItems = isSupplierMode ? setPoItems : setItems;
    const selectedItems = useMemo(() => displayedItems.filter(item => item.isSelected !== false), [displayedItems]);

    const [charges, setCharges] = useState<{ name: string; amount: number; }[]>(order.adminResponse?.additionalCharges || []);

    // Local state for response form
    const [response, setResponse] = useState({
        confirmedPrice: order.adminResponse?.confirmedPrice || 0,
        deliveryDate: order.adminResponse?.deliveryDate || '',
        note: order.adminResponse?.note || '',
        globalDiscountRate: order.adminResponse?.globalDiscountRate || 0 // [MOD] Add Global Discount State
    });

    const [currentManagers, setCurrentManagers] = useState<{ id: string; name: string }[]>(order.managers || (order.manager ? [order.manager] : []));

    // PO Specific State
    const [supplierInfo, setSupplierInfo] = useState(order.supplierInfo || {
        company_name: '(주)대경벤드',
        contact_name: '정호근 과장',
        tel: '055-364-1800',
        email: 'dksales@daekyungbend.com',
        address: '경상남도 양산시 어실로 115',
        note: ''
    });

    const [deliveryNoteFiles, setDeliveryNoteFiles] = useState<File[]>([]);
    const [supplierPoFiles, setSupplierPoFiles] = useState<File[]>([]);

    // Webhook Email States
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const poDateStr = `${yy}${mm}${dd}`; // Changed from YYDDMM to YYMMDD as requested

    // Calculate sequence first
    const highestIdxForToday = useStore.getState().orders
        .filter(o => o.poNumber?.startsWith(`ES${poDateStr}-`))
        .map(o => parseInt(o.poNumber!.split('-')[1], 10))
        .filter(n => !isNaN(n))
        .reduce((max, cur) => Math.max(max, cur), 0);
    const nextSeqStr = String(highestIdxForToday + 1).padStart(3, '0');
    const autoPoNumber = `ES${poDateStr}-${nextSeqStr}`;

    const poNumMatch = (order.poNumber || autoPoNumber).match(/\d+$/);
    const poNum = poNumMatch ? poNumMatch[0] : (order.poNumber || autoPoNumber);

    const cleanSupplierName = supplierInfo.company_name.replace('(주)', '').trim();
    // Use poEndCustomer for buyer name if available, else fallback
    const currentEndCustomer = order.poEndCustomer || order.customerName || '';
    const cleanBuyerName = currentEndCustomer.replace('(주)', '').trim() || '에스제이엔브이';

    const defaultSubject = `[알트에프] ${cleanSupplierName} 발주서 첨부건 - ${poNum}`;
    const defaultFileName = `${poNum} 발주서 ${cleanSupplierName} ${poDateStr} (ALTF, ${cleanBuyerName}).pdf`;

    const [emailSubject, setEmailSubject] = useState(order.poNumber ? order.poTitle || defaultSubject : defaultSubject);
    const [emailAttachmentName, setEmailAttachmentName] = useState(order.poNumber ? defaultFileName : defaultFileName);
    const [isSendingWebhook, setIsSendingWebhook] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [buyerInfo, setBuyerInfo] = useState(() => {
        if (order.buyerInfo) return order.buyerInfo;
        // Default to ALTF info
        return {
            company_name: '알트에프',
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
        const memo = order.memo || order.payload?.customer?.memo || '';
        return memo.replace(/[\uFFFC\uFFFD]/g, '');
    });

    // --- Delivery Preset Logic ---
    const getPresetKey = useCallback(() => `delivery_preset_${(isSupplierMode ? supplierInfo.company_name : (poEndCustomer || '')).replace('(주)', '').trim()}`, [isSupplierMode, supplierInfo.company_name, poEndCustomer]);

    const [showPresetDropdown, setShowPresetDropdown] = useState(false);

    // Get all historical memos for this customer from the entire database
    const availablePresets = useMemo(() => {
        if (!showPresetDropdown) return [];

        const key = getPresetKey();
        let saved: string[] = [];
        try {
            const raw = localStorage.getItem(key);
            if (raw) saved = raw.startsWith('[') ? JSON.parse(raw) : [raw];
        } catch {
            // no-op
        }

        // Fetch past orders from Zustand store to auto-suggest
        const allOrders = useStore.getState().orders || [];
        const currentTarget = isSupplierMode ? supplierInfo.company_name : (order.poEndCustomer || order.customerName || '');
        const targetClean = currentTarget.replace('(주)', '').trim();

        // Find all memos from past orders that match this customer
        const historicalMemos = allOrders
            .filter(o => {
                const poCustomer = (o.poEndCustomer || o.customerName || '').replace('(주)', '').trim();
                const supCustomer = (o.supplierInfo?.company_name || '').replace('(주)', '').trim();
                return isSupplierMode ? supCustomer === targetClean : poCustomer === targetClean;
            })
            .map(o => isSupplierMode ? o.supplierInfo?.note : o.memo)
            .filter(Boolean) as string[];

        // Merge and deduplicate
        const uniqueKeys = new Set<string>();
        const finalMerged: string[] = [];

        for (const m of [...saved, ...historicalMemos]) {
            const cleanM = m.trim().replace(/[\uFFFC\uFFFD]/g, '');
            if (!cleanM) continue;

            // Generate a deduplication key by removing auto tags and spaces
            const dedupKey = cleanM
                .replace(/\[.*?\]/g, '') // remove all [tags]
                .replace(/\s+/g, '') // remove all whitespace
                .toLowerCase();

            if (!uniqueKeys.has(dedupKey)) {
                uniqueKeys.add(dedupKey);
                finalMerged.push(cleanM);
            }
        }

        return finalMerged;
    }, [showPresetDropdown, isSupplierMode, supplierInfo.company_name, getPresetKey, order.customerName, order.poEndCustomer]);

    const handleSaveDeliveryPreset = () => {
        const key = getPresetKey();
        if (!key || !shippingMemo.trim()) {
            alert('업체명(거래처명/고객명)과 배송 요청사항이 모두 있어야 저장할 수 있습니다.');
            return;
        }

        let existingSaved: string[] = [];
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                if (raw.startsWith('[')) {
                    existingSaved = JSON.parse(raw);
                } else {
                    existingSaved = [raw]; // legacy support
                }
            }
        } catch {
            // Ignore parse errors
        }

        const newMemo = shippingMemo.trim();
        existingSaved = existingSaved.filter(s => s !== newMemo);
        existingSaved.unshift(newMemo);

        localStorage.setItem(key, JSON.stringify(existingSaved.slice(0, 10)));
        alert(`[${key.replace('delivery_preset_', '')}] 배송 요청사항이 저장되었습니다.`);
        setShowPresetDropdown(false);
    };

    const handleLoadPresetItem = (preset: string) => {
        setShippingMemo(preset);
        setShowPresetDropdown(false);
    };

    // PO Options State
    const initialMemo = order.memo || '';
    const [poOptionNoMarking, setPoOptionNoMarking] = useState(initialMemo.includes('[무마킹 출고 조건]'));
    const [poOptionStockCheck, setPoOptionStockCheck] = useState(initialMemo.includes('[재고장 확인의 건]'));
    const [poOptionCustomOrder, setPoOptionCustomOrder] = useState(initialMemo.includes('[주문제작 요청건]'));

    // UX Animation Trackers
    const isPoPersisted = !!order.supplierPO || !!order.poSent;
    const [poNumTouched, setPoNumTouched] = useState(isPoPersisted);
    const [customerTouched, setCustomerTouched] = useState(isPoPersisted);
    const [printOptionTouched, setPrintOptionTouched] = useState(isPoPersisted);
    const [deliveryDateTouched, setDeliveryDateTouched] = useState(isPoPersisted);
    const [hasSavedPO, setHasSavedPO] = useState(isPoPersisted);

    // Effect to compose shippingMemo automatically for POs
    useEffect(() => {
        if (!order || !isSupplierMode) return;

        let baseMemo = (order.memo || '').replace(/[\uFFFC\uFFFD]/g, '');
        if (baseMemo.includes('[배송:')) {
            baseMemo = baseMemo
                .replace(/\[배송:\s*([^\]]+)\]/g, '배송:$1 -')
                .replace(/\s*\|\s*담당자:/g, '\n담당자:')
                .replace(/\s*\|\s*요청:/g, '\n요청사항:');
        }

        let newMemo = baseMemo;
        if (poOptionNoMarking) newMemo += '\n[무마킹 출고 조건]';
        if (poOptionStockCheck) newMemo += '\n[재고장 확인의 건]';
        if (poOptionCustomOrder) newMemo += '\n[주문제작 요청건]'; // Ensure matching string with check above

        // Remove duplicates easily if initialized with them
        newMemo = Array.from(new Set(newMemo.split('\n'))).join('\n').trim();

        setShippingMemo(newMemo);
    }, [poOptionNoMarking, poOptionStockCheck, poOptionCustomOrder, isSupplierMode, order]);

    // PO Info State
    const [poNumber, setPoNumber] = useState(order.poNumber || autoPoNumber);
    const [poTitle, setPoTitle] = useState(order.poTitle || defaultSubject);

    // Transaction Statement Specific State
    const [transactionShipDate, setTransactionShipDate] = useState('');
    const [transactionTrackingNo, setTransactionTrackingNo] = useState('');

    // Sync PO numbering dynamically if user changes poNumber but keep it smart
    const handlePoNumberChange = (newPoNum: string) => {
        setPoNumber(newPoNum);
        const match = newPoNum.match(/\d+$/);
        const seq = match ? match[0] : newPoNum;
        const newTitle = `[알트에프] ${cleanSupplierName} 발주서 첨부건 - ${seq}`;
        setPoTitle(newTitle);
        setEmailSubject(newTitle);
        setEmailAttachmentName(`${seq} 발주서 ${cleanSupplierName} ${poDateStr} (ALTF, ${poEndCustomer.replace('(주)', '').trim() || '에스제이엔브이'}).pdf`);
    };

    const [showCrmSuggestions, setShowCrmSuggestions] = useState(false);

    const handlePoEndCustomerChange = (newCustomer: string) => {
        setPoEndCustomer(newCustomer);
        const matchInfo = poNumber.match(/\d+$/);
        const seq = matchInfo ? matchInfo[0] : poNumber;
        setEmailAttachmentName(`${seq} 발주서 ${cleanSupplierName} ${poDateStr} (ALTF, ${newCustomer.replace('(주)', '').trim() || '에스제이엔브이'}).pdf`);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCustomerSelect = (c: any) => {
        if (window.confirm(`[${c.companyName}]의 연락처, 이메일, 담당자 등 전체 정보를 자동으로 덮어씌울까요?\n(현대배관 등 여러 지점이 있는 업체의 경우 '취소'를 누르시면 상호명만 적용됩니다)`)) {
            setPoEndCustomer(c.companyName);
            setEditableCustomerInfo(prev => ({
                ...prev,
                bizNo: c.businessNumber || '',
                address: c.address || '',
                contactName: c.contactName || c.ceo || '',
                email: c.email || '',
                tel: c.phone || ''
            }));
            const matchInfo = poNumber.match(/\d+$/);
            const seq = matchInfo ? matchInfo[0] : poNumber;
            setEmailAttachmentName(`${seq} 발주서 ${cleanSupplierName} ${poDateStr} (ALTF, ${c.companyName.replace('(주)', '').trim() || '에스제이엔브이'}).pdf`);
        } else {
            setPoEndCustomer(c.companyName);
            setEditableCustomerInfo(prev => ({ 
                ...prev,
                bizNo: c.businessNumber || '' 
            }));
            const matchInfo = poNumber.match(/\d+$/);
            const seq = matchInfo ? matchInfo[0] : poNumber;
            setEmailAttachmentName(`${seq} 발주서 ${cleanSupplierName} ${poDateStr} (ALTF, ${c.companyName.replace('(주)', '').trim() || '에스제이엔브이'}).pdf`);
        }
        setShowCrmSuggestions(false);
    };

    // Calculation based on Selected Items
    const calculatedTotal = selectedItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    // [MOD] Apply Global Discount to the Total Calculation
    // Logic: (ItemTotal + AdditionalCharges) * (1 - GlobalDiscount/100)
    const subTotalWithCharges = calculatedTotal + charges.reduce((sum, c) => sum + c.amount, 0);
    const globalDiscountAmount = Math.round(subTotalWithCharges * (response.globalDiscountRate / 100));
    const totalWithCharges = subTotalWithCharges - globalDiscountAmount;

    // Supplier Totals Calculation
    const { totalSupplierAmount, totalProfit } = selectedItems.reduce((acc, item) => {
        const product = findProduct({ productId: item.productId });
        const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? 0;
        const rate = item.supplierRate ?? 0;

        // [FIX] Use supplierPriceOverride if manually entered by the manager
        let supplierPrice = item.supplierPriceOverride;
        if (supplierPrice === undefined) {
            supplierPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
        }

        const supplierAmount = supplierPrice * item.quantity;
        const profit = (item.unitPrice - supplierPrice) * item.quantity;

        return {
            totalSupplierAmount: acc.totalSupplierAmount + supplierAmount,
            totalProfit: acc.totalProfit + profit
        };
    }, { totalSupplierAmount: 0, totalProfit: 0 });

    const handleItemSelect = (index: number, isSelected: boolean) => {
        const newItems = [...displayedItems];
        newItems[index] = { ...newItems[index], isSelected };
        setDisplayedItems(newItems);
    };

    const handleSelectAll = (isSelected: boolean) => {
        const newItems = displayedItems.map(item => ({ ...item, isSelected }));
        setDisplayedItems(newItems);
    };

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

    const handleSplitItem = (index: number) => {
        const item = displayedItems[index];
        const splitQtyStr = prompt(`현재 수량은 ${item.quantity}입니다. 분할하여 빼낼(새로운 줄로 만들) 수량을 입력하세요.`);
        if (!splitQtyStr) return;
        const splitQty = Number(splitQtyStr);
        if (isNaN(splitQty) || splitQty <= 0 || splitQty >= item.quantity) {
            alert('유효하지 않은 수량입니다. 기존 수량보다 작아야 합니다.');
            return;
        }

        const newItems = [...displayedItems];
        // 1. Reduce original item quantity
        const newOriginalQty = item.quantity - splitQty;
        newItems[index] = {
            ...item,
            quantity: newOriginalQty,
            amount: item.unitPrice * newOriginalQty
        };

        // 2. Create new split item
        const splitItemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const splitItem: LineItem = {
            ...item,
            id: splitItemId,
            quantity: splitQty,
            amount: item.unitPrice * splitQty,
            transactionIssued: false // Reset for the split item
        };

        // Insert the split item right after the original item
        newItems.splice(index + 1, 0, splitItem);
        setDisplayedItems(newItems);
    };

    const handleDownloadPO = () => {
        const payload: DocumentPayload = {
            document_type: 'PURCHASE_ORDER',
            meta: {
                doc_no: poNumber, // Custom PO Number
                created_at: new Date().toLocaleDateString(),
                channel: 'WEB',
                title: poTitle, // Custom Title in meta
                end_customer: poEndCustomer // Editable end customer field
            },
            supplier: supplierInfo, // Vendor
            customer: {
                ...buyerInfo, // Defaults to ALTF or Manager Info
                address: buyerInfo.address,
                memo: shippingMemo // Keep memo if it's used elsewhere, but we'll prioritize footer.note below
            },    // Buyer (ALTF)
            items: selectedItems.map((item, idx) => {
                const product = inventory.find(i => i.id === item.productId);
                const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? 0;
                const supplierRate = item.supplierRate ?? 0;

                let supplierPrice = item.supplierPriceOverride;
                if (supplierPrice === undefined) {
                    supplierPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
                }

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
                    stock_qty: product?.currentStock ?? item.currentStock ?? 0,
                    stock_status: (item.marking_wait_qty || 0) > 0
                        ? `마킹대기:${item.marking_wait_qty}`
                        : (
                            (product?.currentStock ?? item.currentStock) !== undefined
                                ? ((product?.currentStock ?? item.currentStock ?? 0) === 0 ? '재고없음' : (item.quantity > (product?.currentStock ?? item.currentStock ?? 0) ? '일부 주문생산' : '출고가능'))
                                : '-'
                        ),
                    location_maker: product?.location || '-'
                };
            }),
            totals: {
                total_amount: totalSupplierAmount,
                currency: 'KRW',
                final_amount: totalSupplierAmount // VAT excluded in display usually, but PO total fits here
            },
            footer: {
                message: '',
                note: [shippingMemo, supplierInfo?.note].filter(Boolean).join('\n\n') // Combine notes into footer block designed for POs
            }
        };

        try {
            const html = renderDocumentHTML(payload);
            setPreviewHtml(html);
            setPreviewType('PO');
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
                delivery_date: transactionShipDate, // Map dynamic shipment date to template meta
                title: '거래명세서 (Transaction Statement)'
            },
            supplier: {
                company_name: '알트에프',
                contact_name: buyerInfo.contact_name || user?.contactName || '조현진 대표',
                tel: '051-303-3751',
                email: 'altf@altf.kr',
                address: '부산광역시 사상구 낙동대로1330번길, 67'
            },
            customer: {
                // [MOD] Use CRM Info first for Transaction Statement, fallback to linkedUser
                company_name: poEndCustomer || linkedUser?.companyName || order.customerName,
                contact_name: editableCustomerInfo.contactName || "담당자님",
                tel: editableCustomerInfo.tel || linkedUser?.phone || customerInfo.tel,
                email: editableCustomerInfo.email || linkedUser?.email || '',
                address: editableCustomerInfo.address || linkedUser?.address || '',
                memo: transactionTrackingNo ? `[제품송장 번호]: ${transactionTrackingNo}\n${shippingMemo}` : shippingMemo
            },
            items: selectedItems.map((item, idx) => {
                const product = findProduct({ productId: item.productId });
                return {
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
                    stock_status: (item.marking_wait_qty || 0) > 0
                        ? `마킹대기:${item.marking_wait_qty}`
                        : (
                            (product?.currentStock ?? item.currentStock) !== undefined
                                ? ((product?.currentStock ?? item.currentStock ?? 0) === 0 ? '재고없음' : (item.quantity > (product?.currentStock ?? item.currentStock ?? 0) ? '일부 주문생산' : '출고가능'))
                                : '-'
                        )
                };
            }),
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
            setPreviewHtml(html);
            setPreviewType('SALES');
        } catch (e) {
            console.error('Error generating Sales Order:', e);
            alert('문서 생성 중 오류가 발생했습니다.');
        }
    };

    const handleDownloadPackingList = () => {
        if (selectedItems.length === 0) {
            alert('출력할 품목을 선택해주세요.');
            return;
        }

        const includeDetails = window.confirm('배송 요청사항과 거래처 상세정보(연락처/이메일/주소)를 포함하여 출력하시겠습니까?\\n\\n[확인]을 누르면 모두 표시되고, [취소]를 누르면 상호명과 담당자만 표시됩니다.');

        const payload: DocumentPayload = {
            document_type: 'PACKING_LIST',
            meta: {
                doc_no: `PK${order.id.slice(2, 8)}-${order.id.split('-')[1] || '000'}`,
                created_at: new Date().toLocaleDateString(),
                channel: 'WEB',
            },
            supplier: {
                company_name: '알트에프',
                contact_name: buyerInfo.contact_name || user?.contactName || '조현진 대표',
                tel: '051-303-3751',
                email: 'altf@altf.kr',
                address: '부산광역시 사상구 낙동대로1330번길, 67'
            },
            customer: {
                company_name: poEndCustomer || linkedUser?.companyName || order.customerName || '',
                contact_name: editableCustomerInfo.contactName || "담당자님",
                ...(includeDetails ? {
                    tel: editableCustomerInfo.tel || linkedUser?.phone || customerInfo.tel,
                    email: editableCustomerInfo.email || linkedUser?.email || '',
                    address: editableCustomerInfo.address || linkedUser?.address || '',
                    memo: transactionTrackingNo ? `[제품송장 번호]: ${transactionTrackingNo}\\n${shippingMemo}` : shippingMemo
                } : {})
            },
            items: selectedItems.map((item, index) => ({
                no: index + 1,
                item_name: item.name,
                thickness: item.thickness,
                size: item.size,
                material: item.material,
                qty: item.quantity,
                unit_price: 0,
                amount: 0,
                note: item.note || ''
            })),
            totals: {
                total_amount: 0,
                currency: 'KRW'
            }
        };

        try {
            const html = renderDocumentHTML(payload);
            setPreviewHtml(html);
            setPreviewType('PACKING');
        } catch (e) {
            console.error('Error generating Packing List:', e);
            alert('문서 생성 중 오류가 발생했습니다.');
        }
    };

    const handleItemChange = (index: number, field: keyof LineItem | 'spec', value: string | number) => {
        const newItems = [...displayedItems];
        if (field === 'spec') return;

        const updatedItem = { ...newItems[index], [field]: value };

        // [BUG FIX] Reset productId when manual specs are typed to force a fresh spec match
        if (['name', 'thickness', 'size', 'material'].includes(field as string)) {
            updatedItem.productId = null;
        }

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

    const handleSupplierPriceChange = (index: number, newPrice: number) => {
        const newItems = [...displayedItems];
        const item = newItems[index];
        const product = findProduct({ productId: item.productId });
        const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? 0;

        // If price is manually set, we set the supplierRate such that base * (100-rate)/100 = price
        let newRate = item.supplierRate ?? 0;
        if (basePrice > 0) {
            newRate = (1 - (newPrice / basePrice)) * 100;
            // Cap at 2 decimals for precision
            newRate = Math.round(newRate * 100) / 100;
        }

        newItems[index] = { ...item, supplierRate: newRate, supplierPriceOverride: newPrice };
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
        const product = findProduct({ productId: item.productId });
        const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? item.unitPrice;
        if (basePrice === 0) return;
        const newPrice = Math.round(Math.round(basePrice * (1 - discountRate / 100)) / 10) * 10;
        newItems[index] = { ...item, unitPrice: newPrice, discountRate: discountRate, amount: newPrice * item.quantity };
        setDisplayedItems(newItems);
    };

    const persistCustomPrices = () => {
        const records = displayedItems
            .filter(item => {
                const liveProduct = getProductStock(item);
                return !liveProduct && item.name;
            })
            .map(item => {
                const specKey = [item.name, item.thickness, item.size, item.material].filter(Boolean).join('-').trim();
                return {
                    id: specKey,
                    name: item.name,
                    thickness: item.thickness || '',
                    size: item.size || '',
                    material: item.material || '',
                    salesPrice: item.unitPrice,
                    purchasePrice: item.supplierPriceOverride ?? 0,
                    updatedAt: new Date().toISOString(),
                    updatedBy: user?.email || 'admin'
                };
            }).filter(r => r.salesPrice > 0 || r.purchasePrice > 0);
        if (records.length > 0) saveCustomPrices(records);
    };

    const handleJustSave = async () => {
        if (!poEndCustomer || !editableCustomerInfo.bizNo || !editableCustomerInfo.contactName || !editableCustomerInfo.tel || !editableCustomerInfo.address) {
            alert("업체명, 사업자번호, 담당자명, 연락처, 주소를 모두 입력해야 저장이 가능합니다. (신규 거래처인 경우 상세 내역에 정보를 입력해 주세요.)");
            return;
        }
        setIsSaving(true);
        try {
            persistCustomPrices();

        // CRM 데이터 반영 (비동기)
        if (poEndCustomer) {
            const normalize = (str?: string) => (str || '').replace(/[\s()주식회사]/g, '').toLowerCase();
            const currentData = {
                companyName: poEndCustomer,
                businessNumber: editableCustomerInfo.bizNo,
                contactName: editableCustomerInfo.contactName,
                phone: editableCustomerInfo.tel,
                email: editableCustomerInfo.email,
                address: editableCustomerInfo.address
            };
            
            let matchedCrm = null;
            let bestMatches = 0;

            for (const c of crmCustomers) {
                let matches = 0;
                if (c.companyName && currentData.companyName && normalize(c.companyName) === normalize(currentData.companyName)) matches++;
                if (c.businessNumber && currentData.businessNumber && normalize(c.businessNumber) === normalize(currentData.businessNumber)) matches++;
                if (c.address && currentData.address && normalize(c.address) === normalize(currentData.address)) matches++;
                if (c.phone && currentData.phone && normalize(c.phone) === normalize(currentData.phone)) matches++;
                if (c.email && currentData.email && normalize(c.email) === normalize(currentData.email)) matches++;

                if (matches >= 4 && matches > bestMatches) {
                    matchedCrm = c;
                    bestMatches = matches;
                }
            }
            
            if (matchedCrm && matchedCrm.id) {
                fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${matchedCrm.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...(user?.role ? { 'x-requester-role': user.role } : {}) },
                    body: JSON.stringify(currentData)
                }).catch(console.error);
            } else {
                fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(user?.role ? { 'x-requester-role': user.role } : {}) },
                    body: JSON.stringify(currentData)
                }).catch(console.error);
            }
        }

        const updateData: Partial<Order> = {
            totalAmount: totalWithCharges,
            adminResponse: {
                ...response,
                confirmedPrice: totalWithCharges,
                additionalCharges: charges
            },
            status: order.status === 'SUBMITTED' ? 'PROCESSING' : order.status,
            customerName: poEndCustomer,
            customerBizNo: editableCustomerInfo.bizNo,
            customerBizType: editableCustomerInfo.bizType,
            customerContactName: editableCustomerInfo.contactName,
            customerTel: editableCustomerInfo.tel,
            customerEmail: editableCustomerInfo.email,
            customerAddress: editableCustomerInfo.address,
            supplierInfo: supplierInfo,
            buyerInfo: buyerInfo,
            poNumber: poNumber,
            poTitle: poTitle,
            poEndCustomer: poEndCustomer,
            memo: shippingMemo,
            items: enrichedItems,
            po_items: enrichedPoItems,
            lastUpdatedBy: {
                name: user?.contactName || '관리자',
                id: user?.id || 'admin',
                email: user?.email || '',
                at: new Date().toISOString()
            },
            managers: currentManagers
        };

        // Process Uploads
        if (deliveryNoteFiles.length > 0) {
            const res = await uploadFile(deliveryNoteFiles[0], 'order', order.id + '_delivery');
            if (res) updateData.deliveryNote = res;
        }
        if (supplierPoFiles.length > 0) {
            const res = await uploadFile(supplierPoFiles[0], 'po', order.id + '_po');
            if (res) updateData.supplierPO = res;
        }

        onUpdate(order.id, updateData);
        setTimeout(() => alert('저장되었습니다.'), 100);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSave = async (extraUpdate: Partial<Order> = {}) => {
        if (!poEndCustomer || !editableCustomerInfo.bizNo || !editableCustomerInfo.contactName || !editableCustomerInfo.tel || !editableCustomerInfo.address) {
            alert("업체명, 사업자번호, 담당자명, 연락처, 주소를 모두 입력해야 저장이 가능합니다. (신규 거래처인 경우 상세 내역에 정보를 입력해 주세요.)");
            return;
        }
        setIsSaving(true);
        try {
            persistCustomPrices();

        // CRM 데이터 반영 (비동기)
        if (poEndCustomer) {
            const normalize = (str?: string) => (str || '').replace(/[\s()주식회사]/g, '').toLowerCase();
            const currentData = {
                companyName: poEndCustomer,
                businessNumber: editableCustomerInfo.bizNo,
                contactName: editableCustomerInfo.contactName,
                phone: editableCustomerInfo.tel,
                email: editableCustomerInfo.email,
                address: editableCustomerInfo.address
            };
            
            let matchedCrm = null;
            let bestMatches = 0;

            for (const c of crmCustomers) {
                let matches = 0;
                if (c.companyName && currentData.companyName && normalize(c.companyName) === normalize(currentData.companyName)) matches++;
                if (c.businessNumber && currentData.businessNumber && normalize(c.businessNumber) === normalize(currentData.businessNumber)) matches++;
                if (c.address && currentData.address && normalize(c.address) === normalize(currentData.address)) matches++;
                if (c.phone && currentData.phone && normalize(c.phone) === normalize(currentData.phone)) matches++;
                if (c.email && currentData.email && normalize(c.email) === normalize(currentData.email)) matches++;

                if (matches >= 4 && matches > bestMatches) {
                    matchedCrm = c;
                    bestMatches = matches;
                }
            }
            
            if (matchedCrm && matchedCrm.id) {
                fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${matchedCrm.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...(user?.role ? { 'x-requester-role': user.role } : {}) },
                    body: JSON.stringify(currentData)
                }).catch(console.error);
            } else {
                fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(user?.role ? { 'x-requester-role': user.role } : {}) },
                    body: JSON.stringify(currentData)
                }).catch(console.error);
            }
        }

        const finalStatus = extraUpdate.status || (order.status === 'SUBMITTED' ? 'PROCESSING' : order.status);

        // Auto Save Preset if COMPLETED
        if (finalStatus === 'COMPLETED') {
            const key = getPresetKey();
            const newMemo = shippingMemo.trim();
            if (key && newMemo) {
                let existingSaved: string[] = [];
                try {
                    const raw = localStorage.getItem(key);
                    if (raw) existingSaved = raw.startsWith('[') ? JSON.parse(raw) : [raw];
                } catch {
                    // Ignore parse errors
                }
                existingSaved = existingSaved.filter(s => s !== newMemo);
                existingSaved.unshift(newMemo);
                localStorage.setItem(key, JSON.stringify(existingSaved.slice(0, 10)));
            }
        }

        const updateData: Partial<Order> = {
            totalAmount: totalWithCharges,
            adminResponse: {
                ...response,
                confirmedPrice: totalWithCharges,
                additionalCharges: charges
            },
            status: finalStatus,
            supplierInfo: supplierInfo,
            buyerInfo: buyerInfo,
            poNumber: poNumber,
            poTitle: poTitle,
            poEndCustomer: poEndCustomer,
            customerName: poEndCustomer, // Synchronize core user name
            customerBizNo: editableCustomerInfo.bizNo,
            customerBizType: editableCustomerInfo.bizType,
            customerContactName: editableCustomerInfo.contactName,
            customerTel: editableCustomerInfo.tel,
            customerEmail: editableCustomerInfo.email,
            customerAddress: editableCustomerInfo.address,
            memo: shippingMemo,
            items: enrichedItems,
            po_items: enrichedPoItems,
            lastUpdatedBy: {
                name: user?.contactName || '관리자',
                id: user?.id || 'admin',
                email: user?.email || '',
                at: new Date().toISOString()
            },
            managers: currentManagers,
            ...extraUpdate
        };

        if (deliveryNoteFiles.length > 0) {
            const res = await uploadFile(deliveryNoteFiles[0], 'order', order.id + '_delivery');
            if (res) updateData.deliveryNote = res;
        }
        if (!extraUpdate.supplierPO && supplierPoFiles.length > 0) {
            // Only upload PO here if we haven't already uploaded it in handleSupplierSave
            const res = await uploadFile(supplierPoFiles[0], 'po', order.id + '_po');
            if (res) updateData.supplierPO = res;
        }

        onUpdate(order.id, updateData);
        onClose();
        } finally {
            setIsSaving(false);
        }
    };

    const handleSupplierSave = async () => {
        if (!poEndCustomer || !editableCustomerInfo.bizNo || !editableCustomerInfo.contactName || !editableCustomerInfo.tel || !editableCustomerInfo.address) {
            alert("업체명, 사업자번호, 담당자명, 연락처, 주소를 모두 입력해야 발주서 전송이 가능합니다.");
            return;
        }
        persistCustomPrices();
        if (user?.role !== 'MASTER' && user?.role !== 'MANAGER') {
            alert('권한이 없습니다 (Only Master/Manager allowed).');
            return;
        }

        const fileStatus = supplierPoFiles.length > 0 ? "있음 (새 첨부)" : (order.supplierPO ? "있음 (기존 파일)" : "없음");
        const priceStr = new Intl.NumberFormat('ko-KR').format(totalSupplierAmount);

        const confirmMsg = `[매입 발주서 전송 확인]\n\n첨부파일: ${fileStatus}\n메일 제목: ${emailSubject}\n매입 금액: ${priceStr}원\n\n이대로 벤더사에 매입 발주서를 전송하시겠습니까? (확인을 누르면 전송됩니다)`;

        if (!confirm(confirmMsg)) {
            return;
        }

        setIsSendingWebhook(true);

        try {
            let attachmentUrl = order.supplierPO?.url;
            let attachmentBase64 = null;
            let attachmentMimeType = null;
            let newSupplierPO = order.supplierPO;

            if (supplierPoFiles.length > 0) {
                const file = supplierPoFiles[0];
                attachmentMimeType = file.type || 'application/pdf';

                attachmentBase64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64String = (reader.result as string).split(',')[1];
                        resolve(base64String);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const { uploadFile } = useStore.getState();
                const res = await uploadFile(file, 'po', order.id + '_po');
                if (res) {
                    attachmentUrl = res.url;
                    newSupplierPO = res;
                }
            }

            if (!attachmentUrl && !attachmentBase64) {
                alert("첨부파일 데이터 확보에 실패했습니다.");
                setIsSendingWebhook(false);
                return;
            }

            const payload = {
                event: "purchase_order_sent",
                data: {
                    orderId: order.id,
                    supplier: {
                        company_name: supplierInfo.company_name,
                        contact_name: supplierInfo.contact_name,
                        tel: supplierInfo.tel,
                        email: supplierInfo.email || "dksales@daekyungbend.com"
                    },
                    buyer: { ...buyerInfo },
                    shipping: { memo: shippingMemo },
                    email: {
                        from: "ALTF@ALTF.KR",
                        bcc: "AIRSPACE@ALTF.KR",
                        to: supplierInfo.email || "dksales@daekyungbend.com",
                        subject: emailSubject,
                        attachmentName: emailAttachmentName
                    },
                    attachmentUrl: attachmentUrl || null,
                    attachmentBase64: attachmentBase64 || null,
                    attachmentMimeType: attachmentMimeType || null
                }
            };

            const response = await fetch("https://hook.us2.make.com/hyb2pdm95pae17a8f96sqyexj82lyhnw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok || response.type === 'opaque') {
                const updatedPoItems = enrichedPoItems.map(item => {
                    // Auto-tagging logic
                    const tags = item.tags ? [...item.tags] : [];
                    if (!item.tags || item.tags.length === 0) {
                        if (item.stockStatus === 'AVAILABLE') {
                            tags.push('재고품');
                        }
                    }

                    return {
                        ...item,
                        poSent: true,
                        vendorName: supplierInfo.company_name,
                        tags
                    };
                });
                const allTxIssued = updatedPoItems.length > 0 && updatedPoItems.every(item => item.transactionIssued);
                const newStatus = allTxIssued ? 'COMPLETED' : 'SHIPPED';

                alert(`매입 발주서 전송이 완료되었습니다. 상태가 [${allTxIssued ? '완료' : '배송중'}]으로 변경됩니다.`);

                await handleSave({
                    status: newStatus,
                    poSent: true,
                    supplierPO: newSupplierPO,
                    po_items: updatedPoItems
                });

            } else {
                throw new Error("웹훅 호출 실패: " + response.statusText);
            }
        } catch (error) {
            console.error("Webhook Error:", error);
            alert("메일 전송 요청 중 오류가 발생했습니다.");
        } finally {
            setIsSendingWebhook(false);
        }
    };

    const handleRetractOrder = async () => {
        if (confirm('이 주문을 견적서 접수 상태로 회수하시겠습니까?\n\n(회수된 주문은 주문 관리 대시보드에서 삭제되고 견적 관리로 이동합니다.)')) {
            try {
                await useStore.getState().retractOrder(order.id);
                alert('견적서로 회수 완료되었습니다.');
                onClose();
            } catch (e) {
                console.error('Failed to retract order:', e);
                alert('회수 처리 중 오류가 발생했습니다.');
            }
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex justify-end pointer-events-none">
            {/* Backdrop */}


            {/* Slide-over Panel */}
            <div className="w-full xl:max-w-7xl h-full bg-white shadow-2xl pointer-events-auto flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className={`flex items-center justify-between p-6 border-b shrink-0 ${isSupplierMode ? 'bg-indigo-50/50 border-indigo-100' : 'bg-slate-50/50 border-slate-100'}`
                }>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400"> Order ID </span>
                            <span className="text-xs font-mono font-bold text-slate-600"> {order.id} </span>
                        </div>
                        <h2 className={`text-xl font-bold ${isSupplierMode ? 'text-indigo-900' : 'text-slate-900'}`}>
                            {isSupplierMode ? '매입 발주서 작성 (Supplier Order)' : '주문 상세 내역 (Customer Order)'}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        {isSupplierMode && (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setHasSavedPO(true);
                                    alert('새 창이 열리면 "PDF로 저장" 기능 등을 이용해 PC에 문서를 저장해주세요!\n\n저장 후, 아래 "매입발주서 첨부" 영역에 파일을 등록해 주시면 전송이 가능합니다.');
                                    setTimeout(() => handleDownloadPO(), 100);
                                }}
                                className="gap-2 font-bold bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                                <Download className="w-4 h-4" />
                                발주서 인쇄 / PDF 저장(SAVE)
                            </Button>
                        )}
                        {
                            !isSupplierMode && (
                                <>
                                    <Button
                                        variant="outline"
                                        onClick={handleDownloadSalesOrder}
                                        className="gap-2 font-bold bg-white text-teal-600 border-teal-200 hover:bg-teal-50">
                                        <Download className="w-4 h-4" />
                                        거래명세서 출력
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={handleDownloadPackingList}
                                        className="gap-2 font-bold bg-white text-orange-600 border-orange-200 hover:bg-orange-50">
                                        <Download className="w-4 h-4" />
                                        포장내역 출력
                                    </Button>
                                </>
                            )
                        }
                        {
                            !isSupplierMode && order.supplierInfo && (
                                <Button
                                    variant="outline"
                                    onClick={() => setIsSupplierMode(true)
                                    }
                                    className="gap-2 font-bold bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                                    <FileText className="w-4 h-4" />
                                    작성된 발주서 보기
                                </Button>
                            )}
                        <Button
                            variant="outline"
                            onClick={() => setIsSupplierMode(!isSupplierMode)}
                            className={`gap-2 font-bold ${isSupplierMode ? 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                            {isSupplierMode ? <User className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                            {isSupplierMode ? '주문 내역으로 돌아가기' : '매입 발주서로 전환'}
                        </Button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                            aria-label="닫기">
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">

                    {/* Info Block: Customer (Normal) vs PO Info (Supplier) */}
                    {
                        isSupplierMode ? (
                            <div className="rounded-xl border border-indigo-200 p-5 shadow-sm bg-indigo-50/20">
                                <h3 className="text-sm font-bold text-indigo-900 border-b border-indigo-100 pb-3 mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-indigo-600" />
                                    발주서 정보 설정(Purchase Order Info)
                                </h3>

                                {/* PO Number & Title Inputs */}
                                <div className="grid grid-cols-2 gap-6 mb-4 pb-4 border-b border-indigo-100">
                                    <div>
                                        <label className="block text-xs font-bold text-indigo-700 mb-1"> 발주 번호(PO No.) </label>
                                        <input
                                            type="text"
                                            value={poNumber}
                                            onChange={(e) => {
                                                handlePoNumberChange(e.target.value);
                                                if (!poNumTouched) setPoNumTouched(true);
                                            }
                                            }
                                            className={`w-full px-2 py-1.5 text-sm border rounded outline-none font-mono font-bold transition-all ${!poNumTouched ? 'border-red-400 ring-2 ring-red-400 animate-pulse text-red-900' : 'border-indigo-200 focus:border-indigo-500 text-indigo-900'}`}
                                            placeholder="ESYYMMDD-000"
                                        />
                                    </div>
                                    {
                                        poNumTouched && (
                                            <div>
                                                <label className="block text-xs font-bold text-indigo-700 mb-1"> 발주서 제목(Title) </label>
                                                <input
                                                    type="text"
                                                    value={poTitle}
                                                    onChange={(e) => {
                                                        setPoTitle(e.target.value);
                                                        setEmailSubject(e.target.value);
                                                    }
                                                    }
                                                    className="w-full px-2 py-1.5 text-sm border border-indigo-200 rounded focus:border-indigo-500 outline-none font-bold text-indigo-900"
                                                    placeholder="[알트에프] 대경벤드 발주서 첨부건 - 000"
                                                />
                                            </div>
                                        )}
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    {/* Vendor Info */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-xs font-bold text-indigo-700 uppercase"> 공급자(Vendor) - 매입처 </h4>
                                        </div>
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
                                        {
                                            (order.memo || (order.attachments && order.attachments.length > 0)) && (
                                                <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-xs mb-2">
                                                    {order.memo && (
                                                        <>
                                                            <span className="font-bold text-yellow-800 block mb-1"> 고객 요청/ 배송 메모(Customer Memo): </span>
                                                            <div className="whitespace-pre-wrap text-slate-700 mb-2"> {(order.memo || '').replace(/[\uFFFC\uFFFD]/g, '').replace(/요청항:/g, '요청사항:')} </div>
                                                        </>
                                                    )}
                                                    {order.attachments && order.attachments.length > 0 && (
                                                        <div className="mt-2 pt-2 border-t border-yellow-200/50">
                                                            <span className="font-bold text-yellow-800 block mb-2"> 첨부된 사진/파일: </span>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {order.attachments.map((file, i) => (
                                                                    <a
                                                                        key={i}
                                                                        href={file.url}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-yellow-300 text-yellow-700 hover:bg-yellow-100 rounded text-[10px] font-bold transition-colors shadow-sm">
                                                                        <Image className="w-3 h-3" />
                                                                        보기 {order.attachments!.length > 1 ? `(${i + 1})` : ''}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => {
                                                            // Quick Action: Copy Memo to Note or Address?
                                                            // For now just display it so admin can see while editing
                                                        }}
                                                        className="text-indigo-600 underline mt-1 hidden">
                                                        복사하기
                                                    </button>
                                                </div>
                                            )}
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-xs font-bold text-indigo-700 uppercase"> 발주자(Buyer) / 배송지(Ship To) </h4>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-indigo-700 uppercase"> CUSTOMER </span>
                                                <div className="relative group/autocomplete">
                                                    <input
                                                        value={poEndCustomer}
                                                        onChange={e => {
                                                            handlePoEndCustomerChange(e.target.value);
                                                            if (!customerTouched) setCustomerTouched(true);
                                                            setShowCrmSuggestions(true);
                                                        }}
                                                        onFocus={() => setShowCrmSuggestions(true)}
                                                        className={`px-2 py-1 text-sm font-bold border rounded min-w-[140px] shadow-sm outline-none transition-all ${!customerTouched ? 'border-red-400 ring-2 ring-red-400 animate-pulse text-red-900' : 'border-indigo-200 focus:border-indigo-500 text-indigo-900'}`}
                                                        placeholder="고객사 이름"
                                                        title="PO에 표시될 요청 고객사 이름을 수정할 수 있습니다."
                                                    />
                                                    {showCrmSuggestions && poEndCustomer.length > 0 && Array.isArray(crmCustomers) && (() => {
                                                        const searchClean = poEndCustomer.replace(/[()주식회사\s]/g, '').toLowerCase();
                                                        const matches = crmCustomers.filter(c => {
                                                            if (!c?.companyName) return false;
                                                            return c.companyName.replace(/[()주식회사\s]/g, '').toLowerCase().includes(searchClean);
                                                        }).slice(0, 5);

                                                        if (matches.length > 0) {
                                                            return (
                                                                <div className="absolute z-100 top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden">
                                                                    {matches.map(c => (
                                                                        <button
                                                                            key={c.id || c.companyName}
                                                                            className="w-full text-left px-3 py-2 text-xs hover:bg-teal-50 focus:bg-teal-50 focus:outline-none transition-colors border-b border-slate-100 last:border-0"
                                                                            onClick={() => handleCustomerSelect(c)}
                                                                        >
                                                                            <div className="font-bold text-slate-800">{c.companyName}</div>
                                                                            <div className="text-slate-500 text-[10px] truncate">{c.address || c.businessNumber || '정보 없음'}</div>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
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
                                    <div className="col-span-2 pt-4 border-t border-indigo-100">
                                        <div className="grid grid-cols-2 gap-6">
                                            {/* Left: Supplier PO File */}
                                            <div>
                                                <h4 className="text-xs font-bold text-indigo-700 uppercase mb-2"> 매입발주서 첨부(Supplier PO) </h4>
                                                <div className={`flex flex-col gap-2 transition-all p-2 rounded-lg -ml-2 ${hasSavedPO && supplierPoFiles.length === 0 && !order.supplierPO ? 'ring-4 ring-indigo-500 ring-offset-2 animate-pulse bg-indigo-50' : ''}`}>
                                                    <input
                                                        type="file"
                                                        title="매입발주서 첨부 (Supplier PO)"
                                                        className="text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border border-indigo-200 file:text-sm file:font-medium file:bg-white file:text-indigo-700 hover:file:bg-indigo-50 transition-all cursor-pointer w-full max-w-sm"
                                                        onChange={(e) => {
                                                            setSupplierPoFiles(Array.from(e.target.files || []));
                                                            if (!hasSavedPO && e.target.files && e.target.files.length > 0) {
                                                                setHasSavedPO(true); // Treat attaching a file as "Saving/Persisting" progress visually
                                                            }
                                                        }}
                                                    />
                                                    {
                                                        order.supplierPO && (
                                                            <div className="mt-2 text-xs">
                                                                <span className="text-slate-500 mr-2"> 기존 매입발주서: </span>
                                                                <a href={order.supplierPO.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                                                                    {order.supplierPO.name}
                                                                </a>
                                                            </div>
                                                        )
                                                    }
                                                    {
                                                        supplierPoFiles.length > 0 && (
                                                            <div className="text-xs text-indigo-600 font-bold mt-1">
                                                                선택된 파일: {supplierPoFiles[0].name}
                                                            </div>
                                                        )
                                                    }
                                                </div>

                                                <div className={`mt-4 p-3 rounded-lg border transition-all ${!printOptionTouched ? 'bg-indigo-50/20 border-red-300 ring-2 ring-red-400 animate-pulse' : 'bg-indigo-50/50 border-indigo-100'}`}>
                                                    <h4 className="text-xs font-bold text-indigo-700 mb-2 flex items-center gap-1">
                                                        발주서 인쇄 옵션(Print Options)
                                                    </h4>

                                                    <div className="space-y-2 mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                id="po-opt-nomarking"
                                                                className="w-4 h-4 cursor-pointer accent-indigo-600"
                                                                checked={poOptionNoMarking}
                                                                onChange={(e) => { setPoOptionNoMarking(e.target.checked); if (!printOptionTouched) setPrintOptionTouched(true); }}
                                                            />
                                                            <label htmlFor="po-opt-nomarking" className="text-xs font-bold text-slate-700 cursor-pointer">
                                                                무마킹 출고 조건
                                                            </label>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                id="po-opt-stock"
                                                                className="w-4 h-4 cursor-pointer accent-indigo-600"
                                                                checked={poOptionStockCheck}
                                                                onChange={(e) => { setPoOptionStockCheck(e.target.checked); if (!printOptionTouched) setPrintOptionTouched(true); }}
                                                            />
                                                            <label htmlFor="po-opt-stock" className="text-xs font-bold text-slate-700 cursor-pointer">
                                                                재고장 확인의 건 </label>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                id="po-opt-custom"
                                                                className="w-4 h-4 cursor-pointer accent-indigo-600"
                                                                checked={poOptionCustomOrder}
                                                                onChange={(e) => { setPoOptionCustomOrder(e.target.checked); if (!printOptionTouched) setPrintOptionTouched(true); }}
                                                            />
                                                            <label htmlFor="po-opt-custom" className="text-xs font-bold text-slate-700 cursor-pointer">
                                                                주문제작 요청건
                                                            </label>
                                                        </div>
                                                    </div>

                                                    <div className={`mt-3 pt-3 border-t border-indigo-200 border-dashed transition-all ${!deliveryDateTouched ? 'ring-2 ring-red-400 bg-red-50 p-2 -mx-2 rounded' : ''}`}>
                                                        <label className="block text-xs font-bold text-slate-700 mb-1"> 납기지정(비고란에 추가) </label>
                                                        <input
                                                            type="date"
                                                            title="납기지정 (Delivery Date)"
                                                            value={response.deliveryDate || ''}
                                                            className="w-full px-2 py-1.5 text-xs border rounded outline-none focus:border-indigo-500"
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setResponse(prev => ({ ...prev, deliveryDate: val }));
                                                                setSupplierInfo(prev => ({
                                                                    ...prev,
                                                                    note: prev.note.replace(/\n?\[납기지정\]: .*/, '') + (val ? `\n[납기지정]: ${val}` : '')
                                                                }));
                                                                if (!deliveryDateTouched) setDeliveryDateTouched(true);
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Webhook Email Integration */}
                                            {
                                                poNumTouched && (
                                                    <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 relative">
                                                        <h4 className="text-xs font-bold text-indigo-700 mb-2 flex items-center gap-1">
                                                            <Send className="w-3 h-3" /> 매입 발주서 이메일 전송(Webhook)
                                                        </h4>
                                                        <div className="space-y-4">
                                                            <div>
                                                                <label className="block text-[10px] text-indigo-500 font-bold mb-1"> 메일 제목(Email Subject) </label>
                                                                <input
                                                                    type="text"
                                                                    title="메일 제목 (Email Subject)"
                                                                    placeholder="이메일 제목 입력"
                                                                    value={emailSubject}
                                                                    onChange={(e) => setEmailSubject(e.target.value)
                                                                    }
                                                                    className="w-full px-2 py-1 text-xs border border-indigo-200 rounded outline-none focus:border-indigo-500 bg-white"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] text-indigo-500 font-bold mb-1"> 첨부파일명(Attachment Name) </label>
                                                                <input
                                                                    type="text"
                                                                    title="첨부파일명 (Attachment Name)"
                                                                    placeholder="첨부파일명 입력"
                                                                    value={emailAttachmentName}
                                                                    onChange={(e) => setEmailAttachmentName(e.target.value)}
                                                                    className="w-full px-2 py-1 text-xs border border-indigo-200 rounded outline-none focus:border-indigo-500 bg-white"
                                                                />
                                                            </div>

                                                            {
                                                                !hasSavedPO ? (
                                                                    <div className="text-xs text-slate-500 text-center py-2 bg-white/50 rounded border border-slate-100">
                                                                        먼저 <b> 발주서를 PDF로 저장(SAVE) </b> 해주세요.
                                                                    </div>
                                                                ) : (!order.supplierPO && supplierPoFiles.length === 0) ? (
                                                                    <div className="text-xs text-indigo-600 font-bold text-center py-2 bg-indigo-50/80 rounded border border-indigo-200 animate-pulse">
                                                                        저장한 발주서 파일을 <b> 좌측에 첨부 </b>해주세요!
                                                                    </div>
                                                                ) : (
                                                                    <Button
                                                                        onClick={handleSupplierSave}
                                                                        disabled={isSendingWebhook}
                                                                        className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
                                                                        <Send className="w-4 h-4" />
                                                                        매입 발주서 전송
                                                                    </Button>
                                                                )
                                                            }
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Order & Shipping Info */
                            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3 flex items-center gap-2">
                                    <User className="w-4 h-4 text-teal-600" />
                                    주문 및 배송 정보(Order & Shipping Info)
                                </h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="col-span-2 text-[10px] text-teal-600 bg-teal-50 px-2 py-1.5 rounded -mb-1 shadow-inner border border-teal-100 flex items-center justify-center font-bold">
                                        💡 기본 고객 정보(CUSTOMER)를 변경하시면, 시스템 전체의 업체명 및 사업자번호 등이 업데이트됩니다.
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 업체명(Customer) </span>
                                        <div className="relative group/autocomplete">
                                            <input
                                                type="text"
                                                value={poEndCustomer}
                                                onChange={(e) => {
                                                    handlePoEndCustomerChange(e.target.value);
                                                    if (!customerTouched) setCustomerTouched(true);
                                                    setShowCrmSuggestions(true);
                                                }}
                                                onFocus={() => setShowCrmSuggestions(true)}
                                                className={`w-full font-bold text-slate-800 bg-transparent border-b hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1 ${!customerTouched ? 'border-transparent' : 'border-teal-400 border-dotted'}`}
                                                placeholder="고객사명 수정"
                                            />
                                            {showCrmSuggestions && poEndCustomer.length > 0 && Array.isArray(crmCustomers) && (() => {
                                                const searchClean = poEndCustomer.replace(/[()주식회사\s]/g, '').toLowerCase();
                                                const matches = crmCustomers.filter(c => {
                                                    if (!c?.companyName) return false;
                                                    return c.companyName.replace(/[()주식회사\s]/g, '').toLowerCase().includes(searchClean);
                                                }).slice(0, 5);

                                                if (matches.length > 0) {
                                                    return (
                                                        <div className="absolute z-100 top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden">
                                                            {matches.map(c => (
                                                                <button
                                                                    key={c.id || c.companyName}
                                                                    className="w-full text-left px-3 py-2 text-xs hover:bg-teal-50 focus:bg-teal-50 focus:outline-none transition-colors border-b border-slate-100 last:border-0"
                                                                    onClick={() => handleCustomerSelect(c)}
                                                                >
                                                                    <div className="font-bold text-slate-800">{c.companyName}</div>
                                                                    <div className="text-slate-500 text-[10px] truncate">{c.address || c.businessNumber || '정보 없음'}</div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 영업 담당자(Managers) </span>
                                        <ManagerMultiSelect
                                            currentManagers={currentManagers}
                                            users={users.filter(u => ['MASTER', 'MANAGER', 'admin'].includes(u.role))}
                                            onUpdate={setCurrentManagers}
                                        />
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 사업자번호(Biz No) </span>
                                        <input
                                            type="text"
                                            value={editableCustomerInfo.bizNo}
                                            onChange={(e) => setEditableCustomerInfo({ ...editableCustomerInfo, bizNo: e.target.value })}
                                            className="w-full font-mono text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1"
                                            placeholder="***-**-*****"
                                        />
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 업태 / 종목(Biz Type) </span>
                                        <input
                                            type="text"
                                            value={editableCustomerInfo.bizType}
                                            onChange={(e) => setEditableCustomerInfo({ ...editableCustomerInfo, bizType: e.target.value })}
                                            className="w-full text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1"
                                            placeholder="업태/종목 입력"
                                        />
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 담당자명(Contact) </span>
                                        <input
                                            type="text"
                                            value={editableCustomerInfo.contactName}
                                            onChange={(e) => setEditableCustomerInfo({ ...editableCustomerInfo, contactName: e.target.value })}
                                            className="w-full font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1"
                                            placeholder="담당자명(선택)"
                                        />
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 연락처(Phone) </span>
                                        <input
                                            type="text"
                                            value={editableCustomerInfo.tel}
                                            onChange={(e) => setEditableCustomerInfo({ ...editableCustomerInfo, tel: e.target.value })}
                                            className="w-full font-mono text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1"
                                            placeholder="연락처(선택)"
                                        />
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 업무 이메일(Email) </span>
                                        <input
                                            type="text"
                                            value={editableCustomerInfo.email}
                                            onChange={(e) => setEditableCustomerInfo({ ...editableCustomerInfo, email: e.target.value })}
                                            className="w-full font-mono text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1"
                                            placeholder="이메일(선택)"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <span className="block text-slate-400 text-xs mb-1"> 본사 주소(Address) </span>
                                        <input
                                            type="text"
                                            value={editableCustomerInfo.address}
                                            onChange={(e) => setEditableCustomerInfo({ ...editableCustomerInfo, address: e.target.value })}
                                            className="w-full text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 outline-none transition-colors px-1 -ml-1"
                                            placeholder="주소(선택)"
                                        />
                                    </div>

                                    {/* Status & Date */}
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 주문일시(Date) </span>
                                        <span className="text-slate-600"> {new Date(order.createdAt).toLocaleString()} </span>
                                    </div>
                                    <div>
                                        <span className="block text-slate-400 text-xs mb-1"> 현재 상태(Status) </span>
                                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${order.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-700' :
                                            order.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                            }`}>
                                            {order.status}
                                        </span>
                                    </div>

                                    {/* Editable Shipping Info */}
                                    <div className="col-span-2 pt-3 border-t border-slate-100 mt-1">
                                        <h4 className="text-xs font-bold text-teal-700 mb-2 flex items-center gap-1">
                                            <Package className="w-3 h-3" /> 발주 - 담당자 </h4>
                                        <div className="grid grid-cols-1 gap-3">
                                            <div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <label className="block text-xs text-slate-400"> 수취인 / 담당자(Recipient) </label>
                                                            <button
                                                                onClick={loadMyInfoToBuyer}
                                                                className="text-[10px] text-teal-600 font-bold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100 hover:bg-teal-100"
                                                                title="내 정보 불러오기">
                                                                나(Me)
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
                                                        <label className="block text-xs text-slate-400 mb-1"> 연락처(Tel) </label>
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
                                                <label className="block text-xs text-slate-400 mb-1"> 주소(Address) </label>
                                                <input
                                                    type="text"
                                                    value={buyerInfo.address}
                                                    onChange={(e) => setBuyerInfo({ ...buyerInfo, address: e.target.value })}
                                                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none"
                                                    placeholder="배송지 주소 입력"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1 mt-4">
                                                <div className="flex items-center justify-between mb-1">
                                                    <label className="block text-xs font-bold text-slate-600">배송 요청사항(Shipping Memo)</label>
                                                    <div className="flex gap-2 relative">
                                                        <button
                                                            onClick={handleSaveDeliveryPreset}
                                                            className="text-[10px] px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded border border-slate-200 font-bold transition-colors"
                                                            title="현재 입력된 배송 요청사항을 이 업체명으로 기억합니다.">
                                                            저장하기
                                                        </button>
                                                        <button
                                                            onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                                                            className="text-[10px] flex items-center gap-1 px-2 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded border border-teal-200 font-bold transition-colors"
                                                            title="이전에 저장한 이 업체의 다양한 배송 요청사항을 불러옵니다.">
                                                            불러오기 <span className="text-[8px]">▼</span>
                                                        </button>
                                                        {showPresetDropdown && (
                                                            <div className="absolute right-0 top-full mt-1 w-[320px] bg-white border border-slate-200 rounded-md shadow-xl z-50 max-h-[300px] overflow-y-auto">
                                                                {availablePresets.length === 0 ? (
                                                                    <div className="p-3 text-sm text-slate-500 text-center">저장된 내역이 없습니다.</div>
                                                                ) : (
                                                                    availablePresets.map((s, idx) => (
                                                                        <div
                                                                            key={idx}
                                                                            onClick={() => handleLoadPresetItem(s)}
                                                                            className="p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer text-xs text-slate-700 whitespace-pre-wrap select-none">
                                                                            {s}
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <textarea
                                                    value={shippingMemo}
                                                    onChange={(e) => setShippingMemo(e.target.value)}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none resize-none h-20 bg-yellow-50/50"
                                                    placeholder="배송 요청사항을 입력하세요."
                                                />
                                                {/* NEW: Attached Photos */}
                                                {order.attachments && order.attachments.length > 0 && (
                                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                                        <h4 className="text-xs font-bold text-slate-500 mb-2">첨부된 사진/파일 (Customer Attachments)</h4>
                                                        <div className="flex flex-wrap gap-2">
                                                            {order.attachments.map((file, i) => (
                                                                <a
                                                                    key={i}
                                                                    href={file.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded text-xs font-bold transition-colors">
                                                                    <Image className="w-3 h-3" />
                                                                    첨부사진 보기 {order.attachments!.length > 1 ? `(${i + 1})` : ''}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {
                                                order.status === 'COMPLETED' && (
                                                    <div className="flex gap-4 p-3 bg-teal-50/30 border border-teal-100 rounded-lg">
                                                        <div className="flex-1">
                                                            <label className="block text-xs font-bold text-teal-700 mb-1"> 출고일자(Shipment Date) * 명세서 출력용 </label>
                                                            <input
                                                                type="date"
                                                                value={transactionShipDate}
                                                                onChange={(e) => setTransactionShipDate(e.target.value)
                                                                }
                                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none bg-white"
                                                                title="거래명세서에 '출고일자'로 표시됩니다."
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-xs font-bold text-teal-700 mb-1"> 제품송장 번호(Tracking No.) * 명세서 출력용 </label>
                                                            <input
                                                                type="text"
                                                                value={transactionTrackingNo}
                                                                onChange={(e) => setTransactionTrackingNo(e.target.value)}
                                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm focus:border-teal-500 outline-none bg-white"
                                                                placeholder="예: CJ대한통운 12345678"
                                                                title="거래명세서의 배송요청사항(물건 받으실 방법) 하단에 추가됩니다."
                                                            />
                                                        </div>
                                                    </div>
                                                )}
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
                                        <th className="px-2 py-3 w-[2%] text-center">
                                            <input
                                                type="checkbox"
                                                checked={displayedItems.length > 0 && selectedItems.length === displayedItems.length}
                                                onChange={(e) => handleSelectAll(e.target.checked)}
                                                className="w-3.5 h-3.5 cursor-pointer accent-teal-600"
                                                title="전체 선택/해제"
                                            />
                                        </th>
                                        <th className="px-1 py-3 w-[2%] text-center font-normal text-slate-400"> No.</th>
                                        <th className="px-4 py-3 w-[30%] text-left"> 품목명 / 규격(Item / Spec) </th>
                                        <th className="px-2 py-3 text-center w-[5%]"> 수량 </th>
                                        {
                                            isSupplierMode ? (
                                                /* Supplier Columns */
                                                <>
                                                    <th className="px-2 py-3 text-right w-[8%]">
                                                        판매단가
                                                        <div className="text-[10px] font-normal opacity-70"> (Sales) </div>
                                                    </th>
                                                    <th className="px-2 py-3 text-right w-[8%]">
                                                        기준단가
                                                        <div className="text-[10px] font-normal opacity-70"> (Base) </div>
                                                    </th>
                                                    <th className="px-1 py-3 text-center w-[8%] whitespace-nowrap">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-xs font-bold text-indigo-700"> 매입율(%) </span>
                                                            <div className="flex items-center justify-center gap-1 w-full">
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
                                                                    }
                                                                    }
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        const newItems = displayedItems.map(item => {
                                                                            const product = findProduct({ productId: item.productId });
                                                                            const productRate = product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
                                                                            return { ...item, supplierRate: productRate };
                                                                        });
                                                                        setDisplayedItems(newItems);
                                                                    }}
                                                                    className="px-1 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 whitespace-nowrap"
                                                                    title="모두 기본 매입율 적용">
                                                                    All
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </th>
                                                    <th className="px-1 py-3 text-center w-[8%] text-xs font-bold">
                                                        매입단가
                                                        <div className="text-[10px] font-normal opacity-70"> (Cost) </div>
                                                    </th>
                                                    <th className="px-2 py-3 text-right whitespace-nowrap w-[8%]">
                                                        매입금액
                                                        <div className="text-[10px] font-normal opacity-70"> (Total) </div>
                                                    </th>
                                                    <th className="px-2 py-3 text-right text-green-600 whitespace-nowrap w-[7%]">
                                                        이익
                                                        <div className="text-[10px] font-normal opacity-70"> (Profit) </div>
                                                    </th>
                                                    <th className="px-1 py-3 w-[2%]"> </th>
                                                </>
                                            ) : (
                                                /* Customer Columns */
                                                <>
                                                    <th className="px-2 py-3 text-center w-[6%] whitespace-nowrap"> 현재재고 </th>
                                                    <th className="px-2 py-3 text-center w-[5%]"> 상태 </th>
                                                    <th className="px-2 py-3 text-right text-slate-500 w-[7%]"> 기준단가(Base) </th>
                                                    <th className="px-4 py-3 text-center w-[8%]">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-xs"> Rate(요율) </span>
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
                                                                                    const product = findProduct({ productId: item.productId });
                                                                                    // Calculate new price based on base price and bulk discount
                                                                                    const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? item.unitPrice;
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
                                                                            const product = findProduct({ productId: item.productId });
                                                                            const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? item.unitPrice;
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
                                                                    title="모두 기본단가 적용 (0%)">
                                                                    All
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </th>
                                                    <th className="px-2 py-3 text-right w-[7%]"> 판매단가 </th>
                                                    <th className="px-2 py-3 text-right w-[9%]"> 합계금액 </th>
                                                </>
                                            )}
                                        {!isSupplierMode && <th className="px-1 py-3 w-[2%]"> </th>}
                                    </tr>
                                </thead>
                                <tbody className={`divide-y ${isSupplierMode ? 'divide-indigo-100' : 'divide-slate-100'}`}>
                                    {
                                        displayedItems.map((item, idx) => {
                                            const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
                                                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                                    e.preventDefault();
                                                    const currentInput = e.currentTarget;
                                                    const currentTr = currentInput.closest('tr');
                                                    if (!currentTr) return;

                                                    const inputs = Array.from(currentTr.querySelectorAll('input:not([type="checkbox"])'));
                                                    const colIndex = inputs.indexOf(currentInput);
                                                    if (colIndex === -1) return;

                                                    const targetTr = e.key === 'ArrowUp'
                                                        ? currentTr.previousElementSibling
                                                        : currentTr.nextElementSibling;

                                                    if (targetTr) {
                                                        const targetInputs = Array.from(targetTr.querySelectorAll('input:not([type="checkbox"])'));
                                                        const targetInput = targetInputs[colIndex] as HTMLInputElement;
                                                        if (targetInput) {
                                                            targetInput.focus();
                                                            targetInput.select();
                                                        }
                                                    }
                                                }
                                            };
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

                                            // Use override if available
                                            let supplierPrice = item.supplierPriceOverride;
                                            if (supplierPrice === undefined) {
                                                supplierPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
                                            }
                                            const supplierAmount = supplierPrice * item.quantity;
                                            // Profit = (Customer Sales Price - Supplier Cost Price) * Quantity
                                            const profit = (item.unitPrice - supplierPrice) * item.quantity;
                                            const isSelected = item.isSelected !== false;

                                            return (
                                                <tr key={idx} className={`${isSelected ? '' : 'opacity-40 grayscale'} ${isUnlinked ? 'bg-red-50/30' : (isSupplierMode ? 'bg-white hover:bg-indigo-50/30' : (isStockInsufficient ? 'bg-red-50/50' : 'bg-white hover:bg-slate-50'))} transition-all`
                                                }>
                                                    <td className="px-2 py-3 text-center align-middle">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={(e) => handleItemSelect(idx, e.target.checked)}
                                                            className="w-3.5 h-3.5 cursor-pointer accent-teal-600"
                                                            title="품목 선택"
                                                        />
                                                    </td>
                                                    <td className="px-1 py-3 text-center align-middle text-xs font-bold text-slate-500">
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
                                                                onKeyDown={handleKeyDown}
                                                                className="w-18 px-2 py-1.5 rounded border border-slate-200 focus:border-teal-500 outline-none text-xs font-bold text-slate-800"
                                                            />
                                                            <span className="text-slate-300 select-none"> -</span>
                                                            <input
                                                                type="text"
                                                                value={item.thickness}
                                                                title="Thickness"
                                                                onChange={(e) => handleItemChange(idx, 'thickness', e.target.value)}
                                                                onKeyDown={handleKeyDown}
                                                                className="w-14 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                                                                placeholder="T"
                                                            />
                                                            <span className="text-slate-300 select-none"> -</span>
                                                            <input
                                                                type="text"
                                                                value={item.size}
                                                                title="Size"
                                                                onChange={(e) => handleItemChange(idx, 'size', e.target.value)}
                                                                onKeyDown={handleKeyDown}
                                                                className="w-26 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                                                                placeholder="Size"
                                                            />
                                                            <span className="text-slate-300 select-none"> -</span>
                                                            <input
                                                                type="text"
                                                                value={item.material}
                                                                title="Material"
                                                                onChange={(e) => handleItemChange(idx, 'material', e.target.value)}
                                                                onKeyDown={handleKeyDown}
                                                                className="w-20 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                                                                placeholder="Mat"
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center align-middle">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <input
                                                                type="number"
                                                                title="Supplier Item Quantity"
                                                                value={item.quantity}
                                                                onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                                                                onKeyDown={handleKeyDown}
                                                                className="w-12 text-center px-1 py-1 rounded border border-indigo-200 outline-none focus:border-indigo-500 font-mono font-bold text-slate-800 text-xs"
                                                            />
                                                            {!isSupplierMode && item.quantity > 1 && (
                                                                <button
                                                                    onClick={() => handleSplitItem(idx)}
                                                                    className="p-1 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors"
                                                                    title="품목 분할 (부분 출고)">
                                                                    <SplitSquareHorizontal className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {
                                                        isSupplierMode ? (
                                                            /* Supplier Mode Cells */
                                                            <>
                                                                <td className="px-4 py-3 text-right align-middle text-slate-700 font-mono text-xs font-bold">
                                                                    {formatCurrency(item.unitPrice)}
                                                                </td>
                                                                <td className="px-4 py-3 text-right align-middle text-slate-900 font-mono text-xs font-bold">
                                                                    {basePrice > 0 ? formatCurrency(basePrice) : '-'
                                                                    }
                                                                </td>
                                                                <td className="px-2 py-3 text-center align-middle">
                                                                    <div className="flex items-center justify-center gap-1 w-full">
                                                                        <div className="relative w-16 focus-within:z-10">
                                                                            <input
                                                                                type="number"
                                                                                inputMode="numeric"
                                                                                value={supplierRate === 0 ? '' : supplierRate}
                                                                                placeholder="0"
                                                                                title="Supplier Rate"
                                                                                className="w-full text-center pr-3 pl-1 py-1.5 rounded border border-indigo-200 text-sm outline-none focus:border-indigo-500 font-bold text-indigo-600 bg-indigo-50/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                                onChange={(e) => handleSupplierRateChange(idx, Number(e.target.value))}
                                                                                onKeyDown={handleKeyDown}
                                                                            />
                                                                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-indigo-300 pointer-events-none">% </span>
                                                                        </div>
                                                                        {(() => {
                                                                            const product = findProduct({ productId: item.productId });
                                                                            const mat = item.material?.toUpperCase() || product?.material?.toUpperCase() || '';
                                                                            const nm = item.name?.toUpperCase() || product?.name?.toUpperCase() || '';

                                                                            const is316W = mat === 'STS316L-W' || mat === 'WP316L-W';
                                                                            const isCap316S = nm === 'CAP' && (mat === 'STS316L-S' || mat === 'WP316L-S');

                                                                            if (is316W || isCap316S) {
                                                                                return (
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            const newItems = [...displayedItems];
                                                                                            const targetItem = { ...newItems[idx] };
                                                                                            const product = findProduct({ productId: targetItem.productId });
                                                                                            const productBasePrice = product?.base_price ?? targetItem.base_price ?? product?.unitPrice ?? 0;
                                                                                            const rate = targetItem.supplierRate ?? 0;

                                                                                            if (productBasePrice > 0) {
                                                                                                const targetPrice = Math.ceil(((productBasePrice / 2) * ((100 - rate) / 100) * 1.9) / 10) * 10;
                                                                                                targetItem.supplierPriceOverride = targetPrice;
                                                                                                newItems[idx] = targetItem;
                                                                                                setDisplayedItems(newItems);
                                                                                            }
                                                                                        }}
                                                                                        className="px-1.5 py-1 text-[10px] bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 font-bold whitespace-nowrap shadow-sm"
                                                                                        title="해당 품목만 316 보정단가 적용">
                                                                                        316
                                                                                    </button>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        })()}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 text-center align-middle font-mono font-extrabold text-indigo-700 text-xs">
                                                                    <input
                                                                        type="text"
                                                                        inputMode="numeric"
                                                                        title="Supplier Price Override"
                                                                        placeholder="수기단가"
                                                                        value={supplierPrice.toLocaleString()}
                                                                        className="w-full text-center bg-transparent outline-none focus:border-b focus:border-indigo-400 font-mono font-extrabold text-indigo-700"
                                                                        onChange={(e) => {
                                                                            const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                                                                            handleSupplierPriceChange(idx, val);
                                                                        }}
                                                                        onKeyDown={handleKeyDown}
                                                                    />
                                                                    {(() => {
                                                                        if (!isUnlinked) return null;
                                                                        const specKey = [item.name, item.thickness, item.size, item.material].filter(Boolean).join('-').trim();
                                                                        const record = customPrices[specKey];
                                                                        if (record && record.purchasePrice > 0) {
                                                                            return (
                                                                                <button
                                                                                    className="mt-1 px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-700 border border-slate-300 rounded hover:bg-slate-200 font-bold whitespace-nowrap shadow-sm block w-full truncate"
                                                                                    title={`과거 매입실적: ${formatCurrency(record.purchasePrice)} (클릭하여 적용)`}
                                                                                    onClick={() => handleSupplierPriceChange(idx, record.purchasePrice)}>
                                                                                    📋 {formatCurrency(record.purchasePrice)}
                                                                                </button>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    })()}
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
                                                                        title="품목 삭제">
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </td>
                                                            </>
                                                        ) : (
                                                            /* Customer Mode Row Cells */
                                                            <>
                                                                <td className="px-2 py-3 text-center align-middle whitespace-nowrap">
                                                                    {isUnlinked ? (
                                                                        <span className="font-bold text-slate-400">-</span>
                                                                    ) : (
                                                                        <div className="flex flex-col items-center text-xs w-auto min-w-[75px] mx-auto px-1 space-y-0.5">
                                                                            <div className="flex justify-between w-full gap-2 whitespace-nowrap">
                                                                                <span className="text-slate-500 font-normal">양산:</span>
                                                                                <span className="font-bold text-slate-800">{((product?.locationStock?.['양산'] as number) ?? (product?.currentStock !== undefined ? Math.max(0, product.currentStock - (product.shQty ?? 0)) : (item.currentStock || 0))).toLocaleString()}</span>
                                                                            </div>
                                                                            <div className="flex justify-between w-full gap-2 whitespace-nowrap">
                                                                                <span className="text-slate-500 font-normal">시화:</span>
                                                                                <span className="font-bold text-blue-600">{((product?.locationStock?.['시화'] as number) ?? product?.shQty ?? 0).toLocaleString()}</span>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3 text-center align-middle">
                                                                    {
                                                                        isUnlinked ? (
                                                                            <div className="flex flex-col items-center gap-1">
                                                                                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">미연동</span>
                                                                                {(() => {
                                                                                    const specKey = [item.name, item.thickness, item.size, item.material].filter(Boolean).join('-').trim();
                                                                                    const record = customPrices[specKey];
                                                                                    if (record) {
                                                                                        return (
                                                                                            <div className="flex flex-col items-center mt-1 border border-slate-200 bg-slate-50 rounded p-1 text-[10px] w-full max-w-[90px] mx-auto shadow-sm">
                                                                                                <span className="text-slate-700 font-bold mb-0.5 whitespace-nowrap">📋 과거 실적확인</span>
                                                                                                <span className="text-slate-600 truncate w-full flex justify-between" title={`판매: ${formatCurrency(record.salesPrice)}`}>
                                                                                                    <span className="text-[9px]">판매:</span>
                                                                                                    <span className="font-bold">{formatCurrency(record.salesPrice)}</span>
                                                                                                </span>
                                                                                                {(record.purchasePrice > 0) && (
                                                                                                    <span className="text-slate-600 truncate w-full flex justify-between" title={`매입: ${formatCurrency(record.purchasePrice)}`}>
                                                                                                        <span className="text-[9px]">매입:</span>
                                                                                                        <span className="font-bold">{formatCurrency(record.purchasePrice)}</span>
                                                                                                    </span>
                                                                                                )}
                                                                                                <button type="button" onClick={() => {
                                                                                                    const newItems = [...displayedItems];
                                                                                                    newItems[idx] = {
                                                                                                        ...newItems[idx],
                                                                                                        unitPrice: record.salesPrice,
                                                                                                        amount: record.salesPrice * newItems[idx].quantity,
                                                                                                        supplierPriceOverride: record.purchasePrice > 0 ? record.purchasePrice : newItems[idx].supplierPriceOverride
                                                                                                    };
                                                                                                    setDisplayedItems(newItems);
                                                                                                }} className="mt-1 bg-teal-600 text-white rounded hover:bg-teal-700 w-full py-0.5 font-bold transition-colors">적용하기</button>
                                                                                            </div>
                                                                                        );
                                                                                    }
                                                                                    return null;
                                                                                })()}
                                                                            </div>
                                                                        ) : item.poSent ? (
                                                                            <div className="flex flex-col items-center justify-center gap-0.5">
                                                                                <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded font-bold border border-indigo-100 whitespace-nowrap"> 발주완료 </span>
                                                                                <span className="text-[9px] text-slate-500 max-w-[50px] overflow-hidden text-ellipsis whitespace-nowrap" title={item.vendorName}> {item.vendorName} </span>
                                                                            </div>
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
                                                                            onKeyDown={handleKeyDown}
                                                                        />
                                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">% </span>
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
                                                                        onKeyDown={handleKeyDown}
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
                                                                        title="품목 삭제">
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
                                        {
                                            isSupplierMode ? (
                                                <>
                                                    {/* Supplier Mode Footer: Sales - Cost = Profit */}
                                                    <td colSpan={10} className="px-6 py-4 text-right bg-indigo-50/30 align-middle">
                                                        <div className="flex items-center justify-end gap-6 select-none">

                                                            {/* Sales Total */}
                                                            <div className="flex flex-col items-end opacity-60">
                                                                <span className="text-xs font-bold text-slate-500 mb-1"> 총 판매 금액(Sales Total) </span>
                                                                <span className="font-mono text-lg font-bold text-slate-600"> {formatCurrency(calculatedTotal)} </span>
                                                            </div>

                                                            {/* Minus Pattern */}
                                                            <div className="text-slate-300 pb-2">
                                                                <Minus className="w-5 h-5" />
                                                            </div>

                                                            {/* Supplier Total (Highlighted as Payable) */}
                                                            <div className="flex flex-col items-end relative">
                                                                <div className="absolute -top-3 right-0 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm animate-pulse">
                                                                    실제 송금액(Payable)
                                                                </div>
                                                                <span className="text-xs font-bold text-indigo-700 mb-1"> 총 매입 금액(Supplier Total) </span>
                                                                <span className="font-mono text-2xl font-bold text-indigo-700"> {formatCurrency(totalSupplierAmount)} </span>
                                                            </div>

                                                            {/* Equal Pattern */}
                                                            <div className="text-slate-300 pb-2">
                                                                <Equal className="w-5 h-5" />
                                                            </div>

                                                            {/* Profit */}
                                                            <div className="flex flex-col items-end">
                                                                <span className="text-xs font-bold text-slate-500 mb-1"> 예상 이익(Profit) </span>
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
                                                    <td colSpan={8} className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">
                                                        Total Amount(VAT 별도)
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
                                    className="text-xs h-8">
                                    <Plus className="w-3 h-3 mr-1" /> 항목 추가
                                </Button>
                            </div>
                        </div>
                    </div>

                    {
                        !isSupplierMode && (
                            <>
                                {/* Additional Charges Section */}
                                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3 flex items-center gap-2">
                                        <Plus className="w-4 h-4 text-teal-600" />
                                        추가 비용 및 할인(Additional Charges)
                                    </h3>
                                    <div className="space-y-3">
                                        {
                                            charges.map((charge, idx) => {
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
                                                            }
                                                            }
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
                                                                    }`
                                                                }>
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
                                                            aria-label="항목 삭제">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        <button
                                            onClick={() => setCharges([...charges, { name: '', amount: 0 }])}
                                            className="text-sm text-teal-600 font-bold hover:text-teal-700 flex items-center gap-1">
                                            <Plus className="w-4 h-4" /> 항목 추가
                                        </button>

                                        {/* [MOD] Global Discount Field */}
                                        <div className="pt-3 border-t border-dashed border-slate-200 mt-2">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 text-sm font-bold text-slate-700 text-right">
                                                    전체 할인율(Global Discount %):
                                                </div>
                                                <div className="relative w-32">
                                                    <input
                                                        type="number"
                                                        value={response.globalDiscountRate}
                                                        onChange={(e) => setResponse({ ...response, globalDiscountRate: Number(e.target.value) })}
                                                        className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded text-sm text-right font-bold text-red-500 outline-none focus:border-red-500 bg-red-50/10"
                                                        placeholder="0"
                                                    />
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">% </span>
                                                </div>
                                            </div>
                                            {
                                                response.globalDiscountRate > 0 && (
                                                    <div className="text-right text-xs text-red-500 mt-1 font-bold">
                                                        - {formatCurrency(globalDiscountAmount)} 할인 적용됨
                                                    </div>
                                                )
                                            }
                                        </div>
                                    </div>
                                </div>

                                {/* Admin Response Form */}
                                <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                                    <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                                        <Check className="w-4 h-4 text-teal-600" />
                                        관리자 응답 작성(견적 확정)
                                    </h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label htmlFor="confirmedPrice" className="block text-xs font-bold text-slate-500 mb-1"> 총 견적 금액(확정) </label>
                                            <div className="relative">
                                                <div className="w-full pl-4 pr-4 py-2 rounded-lg border border-slate-200 bg-slate-100 font-mono font-bold text-slate-800 flex items-center justify-between">
                                                    <span>{formatCurrency(totalWithCharges)} </span>
                                                    <span className="text-xs text-slate-500 font-normal"> (VAT 별도)</span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-slate-400 mt-1 space-y-1">
                                                <div className="flex justify-between">
                                                    <span>품목 합계: </span>
                                                    <span> {formatCurrency(calculatedTotal)} </span>
                                                </div>
                                                {
                                                    charges.length > 0 && (
                                                        <div className="space-y-1 pt-2 border-t border-dashed border-slate-200">
                                                            {
                                                                charges.map((charge, idx) => (
                                                                    <div key={idx} className="flex justify-between text-slate-500 text-xs">
                                                                        <span>{charge.name} </span>
                                                                        <span className={charge.amount < 0 ? 'text-red-500' : 'text-slate-700'}>
                                                                            {formatCurrency(charge.amount)
                                                                            }
                                                                        </span>
                                                                    </div>
                                                                ))
                                                            }
                                                            <div className="flex justify-between font-bold text-slate-600 pt-1">
                                                                <span>{formatCurrency(charges.reduce((acc, c) => acc + c.amount, 0))} </span>
                                                            </div>
                                                            {
                                                                response.globalDiscountRate > 0 && (
                                                                    <div className="flex justify-between font-bold text-red-500 pt-1">
                                                                        <span>전체 할인({response.globalDiscountRate} %): </span>
                                                                        <span> - {formatCurrency(globalDiscountAmount)} </span>
                                                                    </div>
                                                                )
                                                            }
                                                        </div>
                                                    )}
                                            </div>
                                        </div>


                                        <div>
                                            <label htmlFor="deliveryDate" className="block text-xs font-bold text-slate-500 mb-1"> 예상 납품일(납기) </label>
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
                                            <label htmlFor="adminNote" className="block text-xs font-bold text-slate-500 mb-1"> 관리자 메모(고객에게 전달됨) </label>
                                            <textarea
                                                id="adminNote"
                                                className="w-full p-3 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none text-sm resize-none h-24"
                                                placeholder="특이사항이나 전달할 내용을 입력하세요."
                                                value={response.note}
                                                onChange={(e) => setResponse({ ...response, note: e.target.value })}
                                            />
                                        </div>

                                        <div className="pt-4 border-t border-slate-200">
                                            <label className="block text-xs font-bold text-slate-500 mb-1"> 최종 문서 첨부(납품명세서 / 공식 서류 등) </label>
                                            <div className="flex flex-col gap-2">
                                                <input
                                                    type="file"
                                                    title="최종 문서 첨부 (납품명세서/공식 서류 등)"
                                                    className="text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border border-slate-200 file:text-sm file:font-medium file:bg-white file:text-slate-700 hover:file:bg-slate-50 transition-all cursor-pointer w-full max-w-sm"
                                                    onChange={(e) => setDeliveryNoteFiles(Array.from(e.target.files || []))}
                                                />
                                                {
                                                    order.deliveryNote && (
                                                        <div className="mt-2 text-xs">
                                                            <span className="text-slate-500 mr-2"> 기존 첨부문서: </span>
                                                            <a href={order.deliveryNote.url} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">
                                                                {order.deliveryNote.name}
                                                            </a>
                                                        </div>
                                                    )
                                                }
                                                {
                                                    deliveryNoteFiles.length > 0 && (
                                                        <div className="text-xs text-teal-600 font-bold mt-1">
                                                            선택된 파일: {deliveryNoteFiles[0].name}
                                                        </div>
                                                    )
                                                }

                                                {
                                                    order.customerPO && (
                                                        <div className="mt-2 text-xs bg-slate-100 p-2 rounded">
                                                            <span className="text-slate-500 mr-2"> 고객 발주서 원본(PO): </span>
                                                            <a href={order.customerPO.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold">
                                                                {order.customerPO.name}
                                                            </a>
                                                        </div>
                                                    )
                                                }
                                                {
                                                    (order.attachments && order.attachments.length > 0) && (
                                                        <div className="mt-2 text-xs bg-slate-100 p-2 rounded">
                                                            <span className="text-slate-500 mr-2"> 일반 첨부파일: </span>
                                                            <ul className="list-disc pl-4">
                                                                {
                                                                    order.attachments.map((file, i) => (
                                                                        <li key={i}>
                                                                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                                                                {file.name}
                                                                            </a>
                                                                        </li>
                                                                    ))
                                                                }
                                                            </ul>
                                                        </div>
                                                    )
                                                }
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        {!isSupplierMode && (
                            <Button
                                variant="outline"
                                onClick={handleRetractOrder}
                                className="border-yellow-400 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 shadow-sm transition-colors text-xs font-bold px-4"
                                title="이 발주를 취소하고 견적 단계로 다시 돌려보냅니다.">
                                회수(견적으로 전환)
                            </Button>
                        )}
                        {!isSupplierMode && order.po_items && order.po_items.length > 0 && order.po_items.some(item => !item.transactionIssued) && (
                            <Button
                                onClick={async () => {
                                    if (confirm('이 주문의 모든 품목을 "명세표 발행 완료(미결 종료)" 상태로 강제 변경하시겠습니까?\n\n(참고: 운임비 등 수기 추가 품목으로 인해 미결목록에서 안 빠지는 경우 이 버튼을 누르세요.)')) {
                                        const updatedPoItems = order.po_items!.map(poItem => ({ ...poItem, transactionIssued: true }));
                                        const isPoOverallSent = order.poSent || !!order.supplierPO || (updatedPoItems.length > 0 && updatedPoItems.every(item => item.poSent));
                                        const newStatus = (updatedPoItems.every(item => item.transactionIssued) && isPoOverallSent) ? 'COMPLETED' : order.status;
                                        await handleSave({ po_items: updatedPoItems, status: newStatus !== order.status ? newStatus : undefined });
                                        alert('미결 리스트에서 성공적으로 강제 종료되었습니다.');
                                    }
                                }}
                                className="bg-orange-600 hover:bg-orange-700 text-white shadow-lg px-4 text-xs font-bold transition-colors">
                                모든 미결품목 강제종료
                            </Button>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button variant="outline" onClick={onClose}>
                            닫기
                        </Button>
                        <Button
                            onClick={() => isSupplierMode ? handleSupplierSave() : handleSave()}
                            disabled={isSendingWebhook || isSaving}
                            className={`shadow-lg px-6 text-white ${(isSendingWebhook || isSaving) ? 'opacity-80 cursor-not-allowed ' : ''}${isSupplierMode
                                ? ((isSendingWebhook || isSaving) ? 'bg-red-700' : 'bg-red-600 hover:bg-red-700 shadow-red-500/20')
                                : ((isSendingWebhook || isSaving) ? 'bg-teal-700' : 'bg-teal-600 hover:bg-teal-700 shadow-teal-500/20')}`}>
                            {(isSendingWebhook || isSaving) ? (
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                    <span>처리중...</span>
                                </div>
                            ) : (isSupplierMode ? '매입 발주서 저장/전송' : '주문 확정 및 답변 전송')}
                        </Button>
                        <Button
                            onClick={handleJustSave}
                            disabled={isSaving}
                            className={`text-white shadow-lg px-4 ${isSaving ? 'bg-slate-700 cursor-not-allowed opacity-80' : 'bg-slate-800 hover:bg-slate-900'}`}>
                            {isSaving ? (
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                    <span>저장 중...</span>
                                </div>
                            ) : '저장(Save)'}
                        </Button>
                    </div>
                </div>

            </div>
            {
                previewHtml && (
                    <PreviewModal
                        htmlContent={previewHtml}
                        docType={previewType === 'PO' ? 'ORDER' : previewType === 'PACKING' ? 'PACKING_LIST' : 'TRANSACTION'}
                        onClose={() => setPreviewHtml(null)}
                        onPrint={async () => {
                            if (previewType === 'SALES') {
                                // Mark the selected items as transaction issued in the PO Items list
                                const updatedPoItems = enrichedPoItems.map(poItem => {
                                    const isSelectedInCurrentTx = selectedItems.some(si =>
                                        si.productId === poItem.productId && si.name === poItem.name
                                    );
                                    if (isSelectedInCurrentTx) {
                                        return { ...poItem, transactionIssued: true };
                                    }
                                    return poItem;
                                });

                                // Check if this makes both Sales and Purchase complete
                                const allTxIssued = updatedPoItems.length > 0 && updatedPoItems.every(item => item.transactionIssued);
                                const isPoOverallSent = order.poSent || !!order.supplierPO || (updatedPoItems.length > 0 && updatedPoItems.every(item => item.poSent));

                                const newStatus = (allTxIssued && isPoOverallSent) ? 'COMPLETED' : order.status;
                                if (newStatus === 'COMPLETED' && order.status !== 'COMPLETED') {
                                    alert('모든 매입 및 매출 처리가 완료되어, 주문 상태가 [완료]로 자동 변경됩니다.');
                                }

                                // Auto-save the order with the updated po_items
                                await handleSave({
                                    po_items: updatedPoItems,
                                    status: newStatus !== order.status ? newStatus : undefined
                                });
                            }
                        }}
                    />
                )
            }
        </div>,
        document.body
    );
});
