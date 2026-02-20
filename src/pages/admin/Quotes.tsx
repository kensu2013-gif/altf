import { useState, useEffect } from 'react';
import { FileText, Calendar, Download, Trash2, ArchiveRestore } from 'lucide-react';
import { AdminQuoteDetail } from './components/AdminQuoteDetail';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/Button';

import type { Quotation } from '../../types';

export default function AdminQuotes() {
    const { quotes, updateQuotation, trashQuotation, restoreQuotation, permanentDeleteQuotation, setQuotes } = useStore((state) => state);
    const [selectedQuote, setSelectedQuote] = useState<typeof quotes[0] | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('all');

    const user = useStore((state) => state.auth.user);

    // Sync with Server on Mount
    useEffect(() => {
        if (!user) return;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        // Inject Role/ID for Scope Control
        if (user.id) headers['x-requester-id'] = user.id;
        if (user.role) headers['x-requester-role'] = user.role;

        fetch(import.meta.env.VITE_API_URL + '/api/my/quotations', { headers })
            .then(res => {
                if (res.ok) return res.json();
                throw new Error('Failed to fetch');
            })
            .then(data => {
                if (Array.isArray(data)) setQuotes(data);
            })
            .catch(console.error);
    }, [setQuotes, user]);

    const filteredQuotes = quotes.filter(q => {
        if (filterStatus === 'TRASH') return q.isDeleted;
        if (q.isDeleted) return false;
        if (filterStatus === 'all') return true;
        return q.status === filterStatus;
    });

    const handlePdfDownload = (e: React.MouseEvent) => {
        e.stopPropagation();
        alert("PDF 다운로드 기능은 준비중입니다.");
    };

    const handleStatusUpdate = (quoteId: string, newStatus: string) => {
        // Cast string to specific union type if needed, or let TypeScript infer
        updateQuotation(quoteId, { status: newStatus as Quotation['status'] });
    };

    const handleDelete = async (quoteId: string) => {
        if (confirm('이 견적서를 휴지통으로 이동하시겠습니까?')) {
            await trashQuotation(quoteId);
            if (selectedQuote?.id === quoteId) setSelectedQuote(null);
        }
    };

    const handleRestore = async (quoteId: string) => {
        if (confirm('이 견적서를 복구하시겠습니까?')) {
            await restoreQuotation(quoteId);
            if (selectedQuote?.id === quoteId) setSelectedQuote(null);
        }
    };

    const handlePermanentDelete = async (quoteId: string) => {
        if (confirm('정말로 영구 삭제하시겠습니까? 복구할 수 없습니다.')) {
            await permanentDeleteQuotation(quoteId);
            if (selectedQuote?.id === quoteId) setSelectedQuote(null);
        }
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

            <div className="flex flex-wrap items-center gap-3">
                {/* Status Filters */}
                <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                    <FilterButton active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} label="All" />
                    <FilterButton active={filterStatus === 'SUBMITTED'} onClick={() => setFilterStatus('SUBMITTED')} label="접수 (Submitted)" />
                    <FilterButton active={filterStatus === 'PROCESSING'} onClick={() => setFilterStatus('PROCESSING')} label="응답대기 (Processing)" />
                    <FilterButton active={filterStatus === 'PROCESSED'} onClick={() => setFilterStatus('PROCESSED')} label="답변완료 (Processed)" />
                    <FilterButton active={filterStatus === 'COMPLETED'} onClick={() => setFilterStatus('COMPLETED')} label="주문접수 (Completed)" />
                    <div className="w-[1px] h-4 bg-slate-200 mx-1" />
                    <button
                        onClick={() => setFilterStatus('TRASH')}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${filterStatus === 'TRASH' ? 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-red-500'}`}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        휴지통
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {filteredQuotes.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-medium">해당 상태의 견적서가 없습니다.</p>
                    </div>
                ) : (
                    filteredQuotes.map((quote) => (
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
                                <div>
                                    <StatusSelect
                                        status={quote.status}
                                        onChange={(val) => handleStatusUpdate(quote.id, val)}
                                    />
                                </div>

                                <div className="text-right">
                                    <div className="text-xs text-slate-400 font-medium">총 견적금액</div>
                                    <div className="text-xl font-bold text-teal-700 font-mono">
                                        {formatCurrency(quote.totalAmount)}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {user?.role === 'MASTER' && (
                                        <>
                                            {filterStatus === 'TRASH' ? (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-slate-400 hover:text-teal-600 hover:bg-teal-50"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRestore(quote.id);
                                                        }}
                                                        title="복구"
                                                    >
                                                        <ArchiveRestore className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-slate-400 hover:text-red-600 hover:bg-red-50"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePermanentDelete(quote.id);
                                                        }}
                                                        title="영구 삭제"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-slate-400 hover:text-red-600 hover:bg-red-50"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(quote.id);
                                                    }}
                                                    title="휴지통으로 이동"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </>
                                    )}
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
                    onSuccess={() => {
                        // Switch to 'PROCESSED' view so the user sees the result
                        setFilterStatus('PROCESSED');
                    }}
                />
            )}
        </div>
    );
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${active ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
        >
            {label}
        </button>
    );
}

function StatusSelect({ status, onChange }: { status: string; onChange: (val: string) => void }) {
    const styles: Record<string, string> = {
        SUBMITTED: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200',
        PROCESSING: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200',
        PROCESSED: 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200',
        COMPLETED: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200',
        DRAFT: 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200',
    };

    return (
        <div className="relative group">
            <select
                aria-label="견적 상태 변경"
                value={status}
                onChange={(e) => onChange(e.target.value)}
                className={`appearance-none cursor-pointer pl-3 pr-8 py-1.5 rounded-full text-xs font-bold border outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-300 transition-all ${styles[status] || styles.DRAFT}`}
                onClick={(e) => e.stopPropagation()}
            >
                <option value="SUBMITTED">접수 (Submitted)</option>
                <option value="PROCESSING">응답대기 (Processing)</option>
                <option value="PROCESSED">답변완료 (Processed)</option>
                <option value="COMPLETED">주문접수 (Completed)</option>
            </select>
            {/* Simple CSS Chevron */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 border-t-[4px] border-t-slate-600 border-x-[3px] border-x-transparent" />
        </div>
    );
}
