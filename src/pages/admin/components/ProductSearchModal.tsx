import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';

import { useStore } from '../../../store/useStore';
import type { Product } from '../../../types';
import { Button } from '../../../components/ui/Button';
import { generateSku } from '../../../lib/sku';

interface ProductSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (product: Product) => void;
}

export function ProductSearchModal({ isOpen, onClose, onSelect }: ProductSearchModalProps) {
    const inventory = useStore((state) => state.inventory);
    const [query, setQuery] = useState('');

    // Filter Logic
    const filteredProducts = useMemo(() => {
        if (!query) return [];

        let result = inventory;

        if (query) {
            const q = query.toLowerCase();
            result = result.filter(p => {
                if (!p) return false;
                const sku = generateSku(p).toLowerCase();
                return (
                    (p.name && p.name.toLowerCase().includes(q)) ||
                    (p.size && p.size.toLowerCase().includes(q)) ||
                    (p.material && p.material.toLowerCase().includes(q)) ||
                    (p.maker && p.maker.toLowerCase().includes(q)) ||
                    sku.includes(q) ||
                    (p.id && p.id.toLowerCase().includes(q))
                );
            });
        }

        return result.slice(0, 50); // Limit results
    }, [inventory, query]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <Search className="w-5 h-5 text-teal-600" />
                        제품 검색 및 변경
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors" title="닫기" aria-label="닫기">
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-4 bg-slate-50 border-b border-slate-100">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="품목명, 규격, 재질 등으로 검색하세요 (예: 90E(L), 10A, STS304-W)"
                            className="w-full pl-9 pr-4 py-3 rounded-lg border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>

                {/* Results List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {filteredProducts.length === 0 ? (
                        <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-sm">
                            {query ? '검색 결과가 없습니다.' : '검색어를 입력하세요.'}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredProducts.map(product => (
                                <button
                                    key={product.id}
                                    onClick={() => {
                                        onSelect(product);
                                        onClose();
                                    }}
                                    className="w-full flex items-center justify-between p-3 hover:bg-teal-50 rounded-lg group transition-colors text-left"
                                >
                                    <div>
                                        <div className="font-bold text-slate-800 flex items-center gap-2">
                                            {product.name}
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${product.currentStock > 0
                                                ? 'bg-blue-50 text-blue-600 border-blue-100'
                                                : 'bg-slate-100 text-slate-500 border-slate-200'
                                                }`}>
                                                재고: {product.currentStock.toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5">
                                            {product.thickness} | {product.size} | {product.material} | {product.maker || 'Unknown'}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-mono font-bold text-teal-600">
                                            ₩{product.unitPrice.toLocaleString()}
                                        </div>
                                        <div className="text-[10px] text-slate-400">
                                            {product.location}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end">
                    <Button variant="outline" onClick={onClose}>
                        취소
                    </Button>
                </div>
            </div>
        </div>
    );
}
