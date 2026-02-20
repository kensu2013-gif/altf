
import React from 'react';
import type { LineItem, Product } from '../../../types';
import { findMatchingProduct } from '../../../lib/productUtils';
import { formatCurrency } from '../../../lib/utils'; // Adjust path if needed

interface QuoteItem extends LineItem {
    userUnitPrice?: number;
}

interface QuoteItemRowProps {
    item: QuoteItem;
    index: number;
    inventory: Product[];
    onItemChange: (index: number, field: keyof LineItem | 'spec', value: string | number) => void;
    onPriceChange: (index: number, newPrice: number) => void;
    onSupplierRateChange: (index: number, value: number) => void;
    onDiscountRateChange: (index: number, value: number) => void;
}

export const QuoteItemRow = React.memo(({
    item,
    index,
    inventory,
    onItemChange,
    onPriceChange,
    onSupplierRateChange,
    onDiscountRateChange
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

    return (
        <tr className={isUnlinked ? 'bg-red-50/30' : 'bg-white hover:bg-slate-50 transition-colors'}>
            <td className="px-2 py-3 text-center align-middle text-xs text-slate-400">
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
                        className="w-20 px-2 py-1.5 rounded border border-slate-200 focus:border-teal-500 outline-none text-xs font-bold text-slate-800"
                    />
                    <span className="text-slate-300 select-none">-</span>
                    <input
                        type="text"
                        value={item.thickness}
                        title="Thickness"
                        onChange={(e) => onItemChange(index, 'thickness', e.target.value)}
                        className="w-20 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                        placeholder="T"
                    />
                    <span className="text-slate-300 select-none">-</span>
                    <input
                        type="text"
                        value={item.size}
                        title="Size"
                        onChange={(e) => onItemChange(index, 'size', e.target.value)}
                        className="w-28 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                        placeholder="Size"
                    />
                    <span className="text-slate-300 select-none">-</span>
                    <input
                        type="text"
                        value={item.material}
                        title="Material"
                        onChange={(e) => onItemChange(index, 'material', e.target.value)}
                        className="w-36 px-1 py-1.5 text-center rounded border border-slate-200 focus:border-teal-500 outline-none text-xs"
                        placeholder="Mat"
                    />
                </div>
            </td>
            <td className="px-4 py-3 text-center align-middle font-mono text-sm text-slate-600">
                {isUnlinked ? (
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">미연동</span>
                ) : (
                    <div className="flex flex-col items-center">
                        <span>{product?.currentStock?.toLocaleString()}</span>
                        {(item.marking_wait_qty || 0) > 0 && (
                            <span className="text-xs text-purple-600 font-bold">
                                (대기: {item.marking_wait_qty?.toLocaleString()})
                            </span>
                        )}
                    </div>
                )}
            </td>
            <td className="px-4 py-3 text-center align-middle">
                <input
                    type="number"
                    value={item.quantity}
                    title="Quantity"
                    onChange={(e) => onItemChange(index, 'quantity', Number(e.target.value))}
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
                />
            </td>

            {/* Cost Price (Calculated) */}
            <td className="px-2 py-3 text-right align-middle font-mono text-sm text-indigo-800">
                {formatCurrency(costPrice)}
            </td>

            {/* Rate (Discount Rate) */}
            <td className="px-4 py-3 text-center align-middle">
                <div className="relative w-full">
                    <input
                        type="number"
                        value={item.discountRate || ''}
                        placeholder={String(product?.rate_pct || 0)}
                        title="Rate (Discount Percentage)"
                        className="w-16 text-center px-1 py-1.5 rounded border border-slate-200 text-sm outline-none focus:border-teal-500 font-bold text-red-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        onChange={(e) => onDiscountRateChange(index, Number(e.target.value))}
                    />
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
