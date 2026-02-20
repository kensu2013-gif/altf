import { useState } from 'react';
import { FileText, Calendar, Download } from 'lucide-react';
import { AdminQuoteDetail } from './components/AdminQuoteDetail';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/Button';

export default function AdminQuotes() {
    const quotes = useStore((state) => state.quotes);
    const [selectedQuote, setSelectedQuote] = useState<typeof quotes[0] | null>(null);

    const handlePdfDownload = (e: React.MouseEvent) => {
        e.stopPropagation();
        alert("PDF 다운로드 기능은 준비중입니다.");
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <FileText className="w-6 h-6 text-teal-600" />
                    견적 관리 (Quotation History)
                </h1>
                <p className="text-slate-500 text-sm mt-1">고객들이 온라인으로 생성/출력한 견적서 내역입니다.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {quotes.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-medium">아직 생성된 견적서가 없습니다.</p>
                    </div>
                ) : (
                    quotes.map((quote) => (
                        <div key={quote.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:shadow-md transition-all">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-teal-50 text-teal-600 rounded-lg group-hover:bg-teal-100 transition-colors">
                                    <FileText className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-bold text-slate-800 text-lg">{quote.customerNumber}</span>
                                        <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{quote.id}</span>
                                    </div>
                                    <div className="text-sm text-slate-500 flex items-center gap-4">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" />
                                            {new Date(quote.createdAt).toLocaleString()}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <span className="font-bold text-slate-700">{quote.items.length}</span> 개 품목
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-6 pl-14 md:pl-0">
                                <div className="text-right">
                                    <div className="text-xs text-slate-400 font-medium">총 견적금액</div>
                                    <div className="text-xl font-bold text-teal-700 font-mono">
                                        {formatCurrency(quote.totalAmount)}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        onClick={() => setSelectedQuote(quote)}
                                    >
                                        <FileText className="w-4 h-4" /> 상세
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-slate-400 hover:text-teal-600"
                                        onClick={handlePdfDownload}
                                    >
                                        <Download className="w-4 h-4" /> PDF
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {selectedQuote && (
                <AdminQuoteDetail
                    quote={selectedQuote}
                    onClose={() => setSelectedQuote(null)}
                />
            )}
        </div>
    );
}
