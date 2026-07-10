
import React from 'react';
import type { LineItem, Product } from '../../../types';
import type { CustomPriceRecord } from '../../../store/useStore';
import { findMatchingProduct } from '../../../lib/productUtils';
import { formatCurrency } from '../../../lib/utils'; // Adjust path if needed

interface QuoteItem extends LineItem {
    userUnitPrice?: number;
}

function getPrimaryASize(sizeStr: string | undefined): number {
    const clean = String(sizeStr || '').toUpperCase().trim();
    if (!clean) return 0;
    const parts = clean.split(/X/i);
    const primaryPart = parts[0].trim();
    if (primaryPart.includes('A')) {
        const match = primaryPart.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }
    const inchToAMap: Record<string, number> = {
        '1/2': 15, '3/4': 20, '1': 25, '1-1/4': 32, '1.1/4': 32, '1 1/4': 32,
        '1-1/2': 40, '1.1/2': 40, '1 1/2': 40, '2': 50, '2-1/2': 65, '2.1/2': 65, '2 1/2': 65,
        '3': 80, '4': 100, '5': 125, '6': 150, '8': 200, '10': 250, '12': 300,
        '14': 350, '16': 400, '18': 450, '20': 500, '22': 550, '24': 600,
        '26': 650, '28': 700, '30': 750, '32': 800, '36': 900, '40': 1000
    };
    const stripped = primaryPart.replace(/"/g, '').trim();
    if (inchToAMap[stripped] !== undefined) return inchToAMap[stripped];
    const decimalVal = parseFloat(stripped) || 0;
    if (decimalVal >= 15) return decimalVal;
    return 0;
}

function normalizeMaterial(matStr: string | undefined): string {
    const clean = String(matStr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.includes('316L') || clean.includes('316')) return '316L';
    if (clean.includes('304L') || clean.includes('304')) return '304';
    return clean;
}

interface QuoteItemRowProps {
    item: QuoteItem;
    index: number;
    inventory: Product[];
    onItemChange: (index: number, field: keyof LineItem | 'spec', value: string | number) => void;
    onPriceChange: (index: number, newPrice: number) => void;
    onSupplierRateChange: (index: number, value: number) => void;
    onDiscountRateChange: (index: number, value: number) => void;
    isSelected?: boolean;
    onItemSelect?: (index: number, isSelected: boolean) => void;
    customPriceRecord?: CustomPriceRecord;
    onApplyCustomPrice?: (record: CustomPriceRecord) => void;
}

export const QuoteItemRow = React.memo(({
    item,
    index,
    inventory,
    onItemChange,
    onPriceChange,
    onSupplierRateChange,
    onDiscountRateChange,
    isSelected = true,
    onItemSelect,
    customPriceRecord,
    onApplyCustomPrice
}: QuoteItemRowProps) => {

    // Memoize product lookup to prevent unnecessary recalcs if inventory/item identity changes but data is same
    // Actually, item identity changes on every edit. inventory refs might be stable.
    // We just run it. It's fast enough for one row.
    let product = findMatchingProduct(item, inventory);

    // Fallback logic from original component
    if (!product && item.base_price && item.base_price > 0) {
        product = {
            id: item.productId || item.itemId || 'temp-fallback',
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
            // Add missing required properties for type 'Product'
            // We cast to Product in original code, so we do same here or add missing props
        } as Product;
    }

    const isUnlinked = !product;
    const basePrice = (item.base_price && item.base_price > 0) ? item.base_price : (product?.base_price ?? product?.unitPrice ?? 0);
    const supplierRate = item.supplierRate ?? 0;
    const costPrice = Math.round((basePrice * (100 - supplierRate) / 100) / 10) * 10;
    const profit = (item.unitPrice - costPrice) * item.quantity;
    const isPriceModified = product ? item.unitPrice !== product.unitPrice : false;

    // Anti-Gravity: Calculate bsStock dynamically by matching compatible logical specifications in inventory.
    // Works even if the product is unlinked (null) or a custom item by falling back to item details.
    const bsStock = (() => {
        const nameStr = (product?.name || item.name || '').toUpperCase().trim();
        const thickStr = (product?.thickness || item.thickness || '').toUpperCase().trim();
        const sizeA = getPrimaryASize(product?.size || item.size);
        const matNorm = normalizeMaterial(product?.material || item.material);
        
        if (!nameStr) return 0;
        
        const hasLocStock = product?.locationStock && Object.keys(product.locationStock).length > 0;
        const isBusan = product?.location1 === '부산' || (product?.location1 && String(product?.location1).includes('부산')) || (product?.locationStock && product?.locationStock['부산'] !== undefined);
        
        let sum = hasLocStock 
            ? (product?.locationStock?.['부산'] || 0) 
            : (isBusan ? (product?.shQty ?? product?.sh_qty ?? 0) : 0);
        
        inventory.forEach(p => {
            if (product && p.id === product.id) return;
            
            const pName = (p.name || '').toUpperCase().trim();
            const pThick = (p.thickness || '').toUpperCase().trim();
            if (pName !== nameStr || pThick !== thickStr) return;
            
            const pSizeA = getPrimaryASize(p.size);
            const pMatNorm = normalizeMaterial(p.material);
            
            const pHasLocStock = p.locationStock && Object.keys(p.locationStock).length > 0;
            const pIsBusan = p.location1 === '부산' || (p.location1 && String(p.location1).includes('부산')) || (p.locationStock && p.locationStock['부산'] !== undefined);
            
            if (pSizeA === sizeA && pMatNorm === matNorm) {
                sum += pHasLocStock 
                    ? (p.locationStock?.['부산'] || 0) 
                    : (pIsBusan ? (p.shQty ?? p.sh_qty ?? 0) : 0);
            }
        });
        return sum;
    })();

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

    return (
        <tr className={`${isSelected ? '' : 'opacity-40 grayscale'} ${isUnlinked ? 'bg-red-50/30' : 'bg-white hover:bg-slate-50'} transition-all`}>
            <td className="px-2 py-3 text-center align-middle">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => onItemSelect?.(index, e.target.checked)}
                    className="w-3.5 h-3.5 cursor-pointer accent-teal-600"
                    title="품목 선택"
                />
            </td>
            <td className="px-1 py-3 text-center align-middle text-xs font-bold text-slate-500">
                {index + 1}
            </td>
            <td className="px-4 py-3 text-left align-middle">
                <div className="flex items-center gap-1">
                    <input
                        type="text"
                        value={item.name}
                        title="Item Name"
                        placeholder="품목명"
                        onChange={(e) => onItemChange(index, 'name', e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-20 px-2 py-1.5 rounded border border-slate-200 focus:border-teal-500 outline-none text-xs font-bold text-slate-800"
                    />
                    <span className="text-slate-300 select-none">-</span>
                    <input
                        type="text"
                        value={item.thickness}
                        title="Thickness"
                        onChange={(e) => onItemChange(index, 'thickness', e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-20 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                        placeholder="T"
                    />
                    <span className="text-slate-300 select-none">-</span>
                    <input
                        type="text"
                        value={item.size}
                        title="Size"
                        onChange={(e) => onItemChange(index, 'size', e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-28 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                        placeholder="Size"
                    />
                    <span className="text-slate-300 select-none">-</span>
                    <input
                        type="text"
                        value={item.material}
                        title="Material"
                        onChange={(e) => onItemChange(index, 'material', e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-36 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                        placeholder="Mat"
                    />
                </div>
            </td>
            <td className="px-2 py-2 text-center align-middle font-mono text-sm text-slate-600">
                {isUnlinked ? (
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">미연동</span>
                        {bsStock > 0 && (
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded mt-1">부산: {bsStock}</span>
                        )}
                        {customPriceRecord && (
                            <div className="flex flex-col items-center mt-1 border border-slate-200 bg-slate-50 rounded p-1.5 text-[10px] w-full max-w-[100px] shadow-sm">
                        <span className="text-slate-700 font-bold mb-1 whitespace-nowrap border-b border-slate-200 w-full text-center pb-0.5">📋 과거 실적확인</span>
                        <div className="flex justify-between w-full mb-0.5" title={`판매: ${formatCurrency(customPriceRecord.salesPrice)}`}>
                                    <span className="text-[9px]">판매:</span> 
                                    <span className="font-bold">{formatCurrency(customPriceRecord.salesPrice)}</span>
                                </div>
                                {(customPriceRecord.purchasePrice > 0) && (
                                    <span className="text-slate-600 truncate w-full flex justify-between" title={`매입: ${formatCurrency(customPriceRecord.purchasePrice)}`}>
                                        <span className="text-[9px]">매입:</span> 
                                        <span className="font-bold">{formatCurrency(customPriceRecord.purchasePrice)}</span>
                                    </span>
                                )}
                                <button type="button" onClick={() => onApplyCustomPrice?.(customPriceRecord)} className="mt-1 bg-teal-600 text-white rounded hover:bg-teal-700 w-full py-0.5 font-bold transition-colors">적용하기</button>
                            </div>
                        )}
                    </div>
                ) : (
                    (() => {
                        const hasLocStock = product?.locationStock && Object.keys(product.locationStock).length > 0;
                        const isBusan = product?.location1 === '부산' || (product?.location1 && String(product?.location1).includes('부산')) || (product?.locationStock && product?.locationStock['부산'] !== undefined);
                        const ysStock = hasLocStock 
                            ? (product?.locationStock?.['양산'] || 0) 
                            : (product?.currentStock !== undefined ? Math.max(0, product.currentStock - (isBusan ? 0 : (product.shQty ?? 0))) : 0);
                        const shStock = hasLocStock 
                            ? (product?.locationStock?.['시화'] || 0) 
                            : (isBusan ? 0 : (product?.shQty ?? 0));
                        
                        const waitStock = product?.marking_wait_qty ?? item.marking_wait_qty ?? 0;

                        return (
                            <div className="flex flex-col items-center text-xs rounded border p-1.5 w-auto min-w-[85px] mx-auto space-y-0.5 transition-colors duration-300 bg-slate-50 border-slate-100">
                                <div className="flex justify-between w-full gap-2 whitespace-nowrap">
                                    <span className="text-slate-500">양산:</span>
                                    <span className="font-bold text-slate-800">{ysStock.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between w-full gap-2 whitespace-nowrap">
                                    <span className="text-slate-500">시화:</span>
                                    <span className="font-bold text-blue-600">{shStock.toLocaleString()}</span>
                                </div>
                                {bsStock > 0 && (
                                    <div className="flex justify-between w-full gap-2 whitespace-nowrap">
                                        <span className="text-slate-500">부산:</span>
                                        <span className="font-bold text-emerald-600">{bsStock.toLocaleString()}</span>
                                    </div>
                                )}
                                {waitStock > 0 && (
                                    <div className="flex justify-between w-full gap-2 whitespace-nowrap">
                                        <span className="text-slate-500">대기:</span>
                                        <span className="font-bold text-purple-600">{waitStock.toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })()
                )}
            </td>
            <td className="px-4 py-3 text-center align-middle">
                <input
                    type="number"
                    value={item.quantity}
                    title="Quantity"
                    onChange={(e) => onItemChange(index, 'quantity', Number(e.target.value))}
                    onKeyDown={handleKeyDown}
                    className="w-16 text-center px-2 py-1.5 rounded border border-slate-200 focus:border-teal-500 outline-none font-mono text-sm"
                />
            </td>

            {/* Base Price (from Inventory) */}
            <td className="px-4 py-3 text-right align-middle font-mono text-sm text-slate-500">
                {basePrice > 0 ? formatCurrency(basePrice) : '-'}
            </td>

            {/* Supplier Rate Input */}
            <td className="px-2 py-3 text-center align-middle">
                <input
                    type="number"
                    value={item.supplierRate ?? ''}
                    placeholder="0"
                    className="w-16 text-center px-1 py-1 rounded border border-indigo-100 focus:border-indigo-500 outline-none font-mono text-xs text-indigo-700 bg-indigo-50/10"
                    onChange={(e) => onSupplierRateChange(index, Number(e.target.value))}
                    onKeyDown={handleKeyDown}
                />
            </td>

            {/* Cost Price (Calculated) */}
            <td className="px-2 py-3 text-right align-middle font-mono text-sm text-indigo-800">
                {formatCurrency(costPrice)}
            </td>

            {/* Rate (Discount Rate) */}
            <td className="px-4 py-3 text-center align-middle">
                <div className="flex flex-col items-center gap-1">
                    <div className="relative w-full flex justify-center">
                        <input
                            type="number"
                            value={item.discountRate || ''}
                            placeholder={String(product?.rate_pct || 0)}
                            title="Rate (Discount Percentage)"
                            className="w-16 text-center px-1 py-1.5 rounded border border-slate-200 text-sm outline-none focus:border-teal-500 font-bold text-red-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            onChange={(e) => onDiscountRateChange(index, Number(e.target.value))}
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                </div>
            </td>
            {/* User Price (Reference) */}
            <td className="px-2 py-3 text-right align-middle font-mono text-sm text-slate-400">
                {formatCurrency(item.userUnitPrice || 0)}
            </td>

            <td className="px-4 py-3 text-right align-middle">
                <input
                    type="text"
                    value={item.unitPrice.toLocaleString()}
                    title="Unit Price"
                    onChange={(e) => {
                        const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                        onPriceChange(index, val);
                    }}
                    onKeyDown={handleKeyDown}
                    className={`w-24 text-right px-2 py-1.5 rounded border outline-none font-mono text-sm font-bold ${isPriceModified
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 focus:border-teal-500'
                        } `}
                />
            </td>
            <td className="px-4 py-3 text-right align-middle font-mono font-bold text-slate-700 text-sm">
                {formatCurrency(item.amount)}
            </td>

            {/* Profit (Calculated) */}
            <td className={`px-2 py-3 text-right align-middle font-mono text-sm font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-500'} `}>
                {formatCurrency(profit)}
            </td>
        </tr>
    );
}, (prev, next) => {
    // Custom comparison function for React.memo
    // Returns true if props are equal (no re-render needed)
    return (
        prev.item === next.item && // Item identity check (requires immutable updates)
        prev.index === next.index &&
        prev.inventory === next.inventory &&
        prev.onItemChange === next.onItemChange
        // other handlers assumed stable
    );
});
