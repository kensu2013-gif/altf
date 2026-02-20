import type { Quotation } from '../../../types';
import { X, FileText, User, Package, Download } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { formatCurrency } from '../../../lib/utils';
import { useState } from 'react';

interface AdminQuoteDetailProps {
    quote: Quotation;
    onClose: () => void;
}

export function AdminQuoteDetail({ quote, onClose }: AdminQuoteDetailProps) {
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownload = () => {
        setIsDownloading(true);
        // Mock download delay
        setTimeout(() => {
            alert('PDF 다운로드가 시작되었습니다. (Demo)');
            setIsDownloading(false);
        }, 1000);
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm pointer-events-auto transition-opacity"
                onClick={onClose}
            />

            {/* Slide-over Panel */}
            <div className="w-full max-w-2xl h-full bg-white shadow-2xl pointer-events-auto flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-slate-400">Quote ID</span>
                            <span className="text-xs font-mono font-bold text-slate-600">{quote.id}</span>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-teal-600" />
                            견적 상세 내역
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                        aria-label="닫기"
                    >
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">

                    {/* Customer Info */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3 flex items-center gap-2">
                            <User className="w-4 h-4 text-teal-600" />
                            고객 정보
                        </h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">고객번호/업체명</span>
                                <span className="font-bold text-slate-800">{quote.customerNumber}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">견적일시</span>
                                <span className="text-slate-600 font-mono">{new Date(quote.createdAt).toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="block text-slate-400 text-xs mb-1">현재 상태</span>
                                <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600">
                                    {quote.status}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Quote Items Table */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                            <Package className="w-4 h-4 text-teal-600" />
                            견적 품목 상세
                        </h3>
                        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase">
                                    <tr>
                                        <th className="px-4 py-3">품목명 / 규격</th>
                                        <th className="px-4 py-3 text-right">수량</th>
                                        <th className="px-4 py-3 text-right">단가</th>
                                        <th className="px-4 py-3 text-right">금액</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {quote.items.map((item, idx) => (
                                        <tr key={idx} className="bg-white hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-slate-800">{item.name}</div>
                                                <div className="text-slate-500 text-xs">
                                                    {item.thickness} | {item.size} | {item.material}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {item.quantity.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-slate-500">
                                                {formatCurrency(item.unitPrice)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">
                                                {formatCurrency(item.amount)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 border-t border-slate-200">
                                    <tr>
                                        <td colSpan={3} className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Total Amount</td>
                                        <td className="px-4 py-3 text-right font-mono text-lg font-bold text-teal-700">
                                            {formatCurrency(quote.totalAmount)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-200 bg-white flex items-center justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>
                        닫기
                    </Button>
                    <Button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="bg-slate-800 hover:bg-slate-900 text-white gap-2"
                    >
                        {isDownloading ? (
                            <span className="flex items-center gap-2">
                                <Download className="w-4 h-4 animate-bounce" /> 다운로드 중...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                <Download className="w-4 h-4" /> PDF 다운로드
                            </span>
                        )}
                    </Button>
                </div>

            </div>
        </div>
    );
}
