import { useState, useEffect } from 'react';
import { FileText, Calendar, Download, Trash2, ArchiveRestore, Search, Image } from 'lucide-react';
import { AdminQuoteDetail } from './components/AdminQuoteDetail';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/Button';

import type { Quotation } from '../../types';
import type { DocumentPayload } from '../../types/document';
import { renderDocumentHTML } from '../../lib/documentTemplate';
import { PreviewModal } from '../../components/ui/PreviewModal';

export default function AdminQuotes() {
    const { quotes, users, updateQuotation, trashQuotation, restoreQuotation, permanentDeleteQuotation, setQuotes, fetchUsers } = useStore((state) => state);
    const [selectedQuote, setSelectedQuote] = useState<typeof quotes[0] | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);

    const user = useStore((state) => state.auth.user);

    // Sync with Server on Mount and Focus
    useEffect(() => {
        if (!user) return;

        const fetchQuotes = () => {
            fetchUsers();

            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            // Inject Role/ID for Scope Control
            if (user.id) headers['x-requester-id'] = user.id;
            if (user.role) headers['x-requester-role'] = user.role;

            fetch((import.meta.env.VITE_API_URL || '') + '/api/my/quotations?limit=2000', {
                headers,
                cache: 'no-store'
            })
                .then(res => {
                    if (res.ok) return res.json();
                    throw new Error('Failed to fetch');
                })
                .then(data => {
                    if (Array.isArray(data)) setQuotes(data);
                })
                .catch(console.error);
        };

        fetchQuotes();
        window.addEventListener('focus', fetchQuotes);
        return () => window.removeEventListener('focus', fetchQuotes);
    }, [setQuotes, user, fetchUsers]);

    const quoteCounts = quotes.reduce((acc, q) => {
        if (q.isDeleted) {
            acc.TRASH = (acc.TRASH || 0) + 1;
            return acc;
        }
        acc.all = (acc.all || 0) + 1;
        if (q.status) {
            acc[q.status] = (acc[q.status] || 0) + 1;
        }
        return acc;
    }, {} as Record<string, number>);

    const filteredQuotes = quotes.filter(q => {
        // Status Match
        let statusMatch = true;
        if (filterStatus === 'TRASH') {
            if (!q.isDeleted) statusMatch = false;
        } else {
            if (q.isDeleted) statusMatch = false;
            if (filterStatus !== 'all' && q.status !== filterStatus) statusMatch = false;
        }

        if (!statusMatch) return false;

        // Search Match
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            const customerName = q.customerName?.toLowerCase() || '';
            const companyName = q.customerInfo?.companyName?.toLowerCase() || '';
            const contactName = q.customerInfo?.contactName?.toLowerCase() || '';

            const quoteUser = users.find(u => u.id === q.userId);
            const userCompany = quoteUser?.companyName?.toLowerCase() || '';
            const userContact = quoteUser?.contactName?.toLowerCase() || '';

            if (!customerName.includes(query) &&
                !companyName.includes(query) &&
                !contactName.includes(query) &&
                !userCompany.includes(query) &&
                !userContact.includes(query)) {
                return false;
            }
        }

        return true;
    });

    const handlePdfDownload = (e: React.MouseEvent, quote: Quotation) => {
        e.stopPropagation();

        const quoteUser = users.find(u => u.id === quote.userId);
        
        const customerInfo = {
            companyName: quote.customerInfo?.companyName || quoteUser?.companyName || quote.customerName || '',
            contactName: quote.customerInfo?.contactName || quoteUser?.contactName || '',
            phone: quote.customerInfo?.phone || quoteUser?.phone || '',
            email: quote.customerInfo?.email || quoteUser?.email || '',
            address: quote.customerInfo?.address || quoteUser?.address || '',
            bizNo: quote.customerInfo?.bizNo || quoteUser?.bizNo || '',
            fax: quote.customerInfo?.fax || quoteUser?.fax || ''
        };

        const calculatedTotal = quote.items.reduce((sum, item) => sum + item.amount, 0);
        const charges = quote.adminResponse?.additionalCharges || [];
        const totalWithCharges = quote.totalAmount || (calculatedTotal + charges.reduce((sum, c) => sum + c.amount, 0));

        const payload: DocumentPayload = {
            document_type: 'QUOTATION',
            meta: {
                doc_no: quote.id,
                created_at: new Date(quote.createdAt).toLocaleDateString(),
                channel: 'WEB',
                title: '견 적 서 (QUOTATION)',
                delivery_date: quote.adminResponse?.deliveryDate || ''
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
            items: quote.items.map((item, idx) => {
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
                    stock_qty: item.currentStock || 0,
                    stock_status: (item.marking_wait_qty || 0) > 0 ? `마킹대기:${item.marking_wait_qty}` : '-',
                    location_maker: item.maker ? `${item.location || ''} / ${item.maker}` : (item.location || '-')
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
                message: quote.adminResponse?.note || quote.memo || ''
            }
        };

        const html = renderDocumentHTML(payload);
        setPreviewHtml(html);
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

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                {/* Status Filters */}
                <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200 shadow-sm overflow-x-auto w-full sm:w-auto">
                    <FilterButton active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} label="All" count={quoteCounts.all} />
                    <FilterButton active={filterStatus === 'SUBMITTED'} onClick={() => setFilterStatus('SUBMITTED')} label="접수 (Submitted)" count={quoteCounts.SUBMITTED} variant="highlight" />
                    <FilterButton active={filterStatus === 'PROCESSING'} onClick={() => setFilterStatus('PROCESSING')} label="응답대기 (Processing)" count={quoteCounts.PROCESSING} />
                    <FilterButton active={filterStatus === 'PROCESSED'} onClick={() => setFilterStatus('PROCESSED')} label="답변완료 (Processed)" count={quoteCounts.PROCESSED} />
                    <FilterButton active={filterStatus === 'COMPLETED'} onClick={() => setFilterStatus('COMPLETED')} label="주문접수 (Completed)" count={quoteCounts.COMPLETED} />
                    <div className="w-[1px] h-4 bg-slate-200 mx-1" />
                    <button
                        onClick={() => setFilterStatus('TRASH')}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap ${filterStatus === 'TRASH' ? 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-red-500'}`}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        휴지통 {quoteCounts.TRASH ? `(${quoteCounts.TRASH})` : ''}
                    </button>
                </div>

                {/* Search */}
                <div className="relative w-full sm:w-64">
                    <input
                        type="text"
                        placeholder="고객명, 회사명 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all font-medium placeholder-slate-400"
                    />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar pb-4 pr-2">
                <div className="grid grid-cols-1 gap-4 min-w-[900px]">
                    {filteredQuotes.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500 font-medium">해당 상태의 견적서가 없습니다.</p>
                        </div>
                    ) : (
                        filteredQuotes.map((quote) => {
                            const quoteUser = users.find(u => u.id === quote.userId);
                            const isModified = !!(quote.customerInfo?.companyName || quote.customerInfo?.contactName);
                            const displayCompany = quote.customerInfo?.companyName || quoteUser?.companyName || quote.customerName || '알 수 없음';
                            const displayContact = quote.customerInfo?.contactName || quoteUser?.contactName || '';

                            return (
                                <div key={quote.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:shadow-md transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-teal-50 text-teal-600 rounded-lg group-hover:bg-teal-100 transition-colors">
                                            <FileText className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-bold text-slate-800 text-lg">
                                                    {displayCompany}
                                                    {displayContact && <span className="text-base text-slate-500 font-medium ml-1">({displayContact})</span>}
                                                </span>
                                                <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{quote.id}</span>
                                                {isModified && <span className="text-[10px] font-normal text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded ml-1 border border-teal-100">수정됨</span>}
                                            </div>
                                            <div className={`text-sm font-bold ${isModified ? 'text-teal-700' : 'text-indigo-700'} mb-1 flex items-center gap-1.5`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${isModified ? 'bg-teal-400' : 'bg-indigo-400'} inline-block`}></span>
                                                원주문: {quote.customerNumber}
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
                                        <div className="flex items-center gap-3">
                                            {(quote.attachments && quote.attachments.length > 0) && (
                                                <div className="flex gap-2">
                                                    {quote.attachments.map((file, i) => (
                                                        <a 
                                                            key={i} 
                                                            href={`${import.meta.env.VITE_API_URL || ''}/api/download?url=${encodeURIComponent(file.url)}`}
                                                            target="_blank" 
                                                            rel="noopener noreferrer" 
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 hover:bg-yellow-100 rounded-full text-xs font-bold transition-colors shadow-sm"
                                                            title={file.name}
                                                        >
                                                            <Image className="w-3.5 h-3.5" />
                                                            사진 보기 {quote.attachments!.length > 1 ? `(${i+1})` : ''}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
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
                                                onClick={(e) => handlePdfDownload(e, quote)}
                                            >
                                                <Download className="w-4 h-4" /> PDF
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
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

            {previewHtml && (
                <PreviewModal
                    htmlContent={previewHtml}
                    onClose={() => setPreviewHtml(null)}
                    docType="QUOTATION"
                />
            )}
        </div>
    );
}

function FilterButton({ active, onClick, label, count, variant = 'default' }: { active: boolean; onClick: () => void; label: string; count?: number; variant?: 'default' | 'highlight' }) {
    let buttonStyle = active ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50';
    let badgeStyle = active ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-400';

    if (variant === 'highlight') {
        buttonStyle = active ? 'bg-slate-900 text-yellow-500 shadow-md ring-2 ring-yellow-400/50' : 'text-slate-500 hover:bg-slate-50';
        badgeStyle = active ? 'bg-yellow-400 text-slate-900 font-bold px-2 py-0.5' : 'bg-slate-100 text-slate-400';
    }

    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 ${buttonStyle}`}
        >
            {label}
            {count !== undefined && count > 0 && (
                <span className={`rounded-full text-[10px] font-mono leading-none ${badgeStyle} ${variant !== 'highlight' || !active ? 'px-1.5 py-0.5' : ''}`}>
                    {count}
                </span>
            )}
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
