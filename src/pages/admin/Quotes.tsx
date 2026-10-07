import { useState, useEffect, useDeferredValue, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Calendar, Download, Trash2, ArchiveRestore, Search, Image } from 'lucide-react';
import { AdminQuoteDetail } from './components/AdminQuoteDetail';
import { QuoteSimilarityDrawer } from './components/QuoteSimilarityDrawer';
import { QuoteComparisonModal } from './components/QuoteComparisonModal';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/Button';
import { useInventory } from '../../hooks/useInventory';

import type { Quotation } from '../../types';
import type { DocumentPayload } from '../../types/document';
import { renderDocumentHTML } from '../../lib/documentTemplate';
import { PreviewModal } from '../../components/ui/PreviewModal';
import {
    normalizeLineItem,
    compareTwoNormalizedDocuments,
    stripCorp,
    type SimilarityMatchCandidate,
    type NormalizedItem,
    type SimilarityType
} from '../../utils/quoteSimilarityCore';

export default function AdminQuotes() {
    const [searchParams] = useSearchParams();
    const { quotes, users, updateQuotation, trashQuotation, restoreQuotation, permanentDeleteQuotation, setQuotes, fetchUsers } = useStore(useShallow((state) => ({
        quotes: state.quotes,
        users: state.users,
        updateQuotation: state.updateQuotation,
        trashQuotation: state.trashQuotation,
        restoreQuotation: state.restoreQuotation,
        permanentDeleteQuotation: state.permanentDeleteQuotation,
        setQuotes: state.setQuotes,
        fetchUsers: state.fetchUsers
    })));
    const { inventory } = useInventory();
    const [selectedQuote, setSelectedQuote] = useState<typeof quotes[0] | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState(() => searchParams.get('quoteId') || '');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);

    // 유사도 서랍(Drawer) 및 정밀 비교 모달 상태
    const [drawerQuoteId, setDrawerQuoteId] = useState<string | null>(null);
    const [activeDrawerCandidate, setActiveDrawerCandidate] = useState<SimilarityMatchCandidate | null>(null);
    const [comparisonCandidate, setComparisonCandidate] = useState<SimilarityMatchCandidate | null>(null);
    const [dismissedTargetIds, setDismissedTargetIds] = useState<Set<string>>(new Set());

    const user = useStore((state) => state.auth.user);
    const userRole = user?.role as string;
    const canManageTrash = userRole === 'MASTER';

    // Sync with Server on Mount and Focus
    useEffect(() => {
        if (!user) return;

        let lastFetchTime = 0;
        const fetchQuotes = () => {
            const now = Date.now();
            if (now - lastFetchTime < 20000) return;
            lastFetchTime = now;
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

    const [lastOpenedQuoteId, setLastOpenedQuoteId] = useState<string | null>(null);

    // Handle incoming URL query parameter (?quoteId=...) for direct search & open
    const urlQuoteId = searchParams.get('quoteId');
    if (urlQuoteId && urlQuoteId !== lastOpenedQuoteId) {
        const found = quotes.find(q => q.id === urlQuoteId || q.customerNumber === urlQuoteId);
        if (found) {
            setLastOpenedQuoteId(urlQuoteId);
            setSelectedQuote(found);
            if (searchQuery !== urlQuoteId) setSearchQuery(urlQuoteId);
            if (filterStatus !== 'all') setFilterStatus('all');
        }
    }

    // 전체 견적 대상 초고속 역색인 유사도 평가 엔진
    const similarityMap = useMemo(() => {
        interface NormDoc {
            id: string;
            type: 'QUOTATION';
            docNo: string;
            customerName: string;
            corpName: string;
            bizNo?: string;
            createdAt: string;
            items: NormalizedItem[];
            itemKeySet: Set<string>;
            parentQuoteId?: string;
        }

        const normDocs: NormDoc[] = [];
        const itemKeyToDocIndices = new Map<string, number[]>();
        const corpToDocIndices = new Map<string, number[]>();
        const idfDocFreq = new Map<string, number>();

        quotes.forEach((q) => {
            if (q.isDeleted) return;
            const normItems = (q.items || []).map(normalizeLineItem).filter(i => !i.isNonItem && i.l1Key.length > 5);
            if (normItems.length === 0) return;

            const custName = q.customerName || q.customerInfo?.companyName || '';
            const corp = stripCorp(custName);
            const bizNo = q.customerInfo?.bizNo || '';
            const itemKeySet = new Set(normItems.map(it => it.l1Key));

            const docIdx = normDocs.length;
            const doc: NormDoc = {
                id: q.id,
                type: 'QUOTATION',
                docNo: q.id,
                customerName: custName,
                corpName: corp,
                bizNo,
                createdAt: q.createdAt || '2026-01-01',
                items: normItems,
                itemKeySet,
                parentQuoteId: q.linkedQuoteId || q.relatedId
            };
            normDocs.push(doc);

            itemKeySet.forEach(k => {
                idfDocFreq.set(k, (idfDocFreq.get(k) || 0) + 1);
                const list = itemKeyToDocIndices.get(k);
                if (list) list.push(docIdx);
                else itemKeyToDocIndices.set(k, [docIdx]);
            });

            if (corp) {
                const cList = corpToDocIndices.get(corp);
                if (cList) cList.push(docIdx);
                else corpToDocIndices.set(corp, [docIdx]);
            }
        });

        const N = Math.max(1, normDocs.length);
        const idfMap = new Map<string, number>();
        idfDocFreq.forEach((count, key) => {
            idfMap.set(key, Math.log((N - count + 0.5) / (count + 0.5) + 1));
        });

        const map = new Map<string, { topType: SimilarityType; topScore: number; topMatch: SimilarityMatchCandidate; candidates: SimilarityMatchCandidate[] }>();

        normDocs.forEach((docA, idxA) => {
            const candidateIndices = new Set<number>();

            docA.itemKeySet.forEach(k => {
                const matches = itemKeyToDocIndices.get(k);
                if (matches) {
                    matches.forEach(idxB => {
                        if (idxB !== idxA) candidateIndices.add(idxB);
                    });
                }
            });

            if (docA.corpName) {
                const corpMatches = corpToDocIndices.get(docA.corpName);
                if (corpMatches) {
                    corpMatches.forEach(idxB => {
                        if (idxB !== idxA) candidateIndices.add(idxB);
                    });
                }
            }

            const matches: SimilarityMatchCandidate[] = [];
            candidateIndices.forEach(idxB => {
                const docB = normDocs[idxB];
                if (!docB) return;
                if (docB.id === docA.parentQuoteId || docB.parentQuoteId === docA.id) return;

                // 1년 초과 건은 무거운 LCS 연산 전에 즉시 건너뛰기 (브라우저 연산 부하 90% 절감)
                const dtA = new Date(docA.createdAt).getTime();
                const dtB = new Date(docB.createdAt).getTime();
                const diffDays = Math.abs(dtA - dtB) / (1000 * 60 * 60 * 24);
                if (diffDays > 365) return;

                const res = compareTwoNormalizedDocuments(docA, docB, idfMap);
                if (res && res.totalScore >= 50) {
                    matches.push(res);
                }
            });

            if (matches.length > 0) {
                matches.sort((a, b) => b.totalScore - a.totalScore);
                const top3 = matches.slice(0, 3);
                map.set(docA.id, {
                    topType: top3[0].similarityType,
                    topScore: top3[0].totalScore,
                    topMatch: top3[0],
                    candidates: top3
                });
            }
        });

        return map;
    }, [quotes]);

    const activeDrawerData = drawerQuoteId ? similarityMap.get(drawerQuoteId) : null;

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
        if (deferredSearchQuery.trim()) {
            const query = deferredSearchQuery.toLowerCase();
            const quoteId = q.id?.toLowerCase() || '';
            const customerNumber = q.customerNumber?.toLowerCase() || '';
            const customerName = q.customerName?.toLowerCase() || '';
            const companyName = q.customerInfo?.companyName?.toLowerCase() || '';
            const contactName = q.customerInfo?.contactName?.toLowerCase() || '';

            const quoteUser = users.find(u => u.id === q.userId);
            const userCompany = quoteUser?.companyName?.toLowerCase() || '';
            const userContact = quoteUser?.contactName?.toLowerCase() || '';

            if (!quoteId.includes(query) &&
                !customerNumber.includes(query) &&
                !customerName.includes(query) &&
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

    const handleExportCSV = () => {
        if (filteredQuotes.length === 0) {
            alert("다운로드할 데이터가 없습니다.");
            return;
        }

        const escapeCSV = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;

        const headers = ['견적번호', '견적일시', '고객사', '담당자', '품목', '두께', '사이즈', '재질', '수량', '단가', '금액', '상태'];
        const csvRows = [headers.join(',')];

        filteredQuotes.forEach(quote => {
            const dateStr = new Date(quote.createdAt).toLocaleString('ko-KR');
            const quoteUser = users.find(u => u.id === quote.userId);
            const customerName = quote.customerInfo?.companyName || quoteUser?.companyName || quote.customerName || '';
            const contactName = quote.customerInfo?.contactName || quoteUser?.contactName || '';

            if (!quote.items || quote.items.length === 0) {
                const row = [
                    escapeCSV(quote.id),
                    escapeCSV(dateStr),
                    escapeCSV(customerName),
                    escapeCSV(contactName),
                    '""',
                    '""',
                    '""',
                    '""',
                    0,
                    0,
                    0,
                    escapeCSV(quote.status)
                ];
                csvRows.push(row.join(','));
                return;
            }

            quote.items.forEach(item => {
                const row = [
                    escapeCSV(quote.id),
                    escapeCSV(dateStr),
                    escapeCSV(customerName),
                    escapeCSV(contactName),
                    escapeCSV(item.name),
                    escapeCSV(item.thickness),
                    escapeCSV(item.size),
                    escapeCSV(item.material),
                    item.quantity,
                    item.unitPrice,
                    item.amount,
                    escapeCSV(quote.status)
                ];
                csvRows.push(row.join(','));
            });
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `견적목록_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
                    <div className="w-px h-4 bg-slate-200 mx-1" />
                    <button
                        onClick={() => setFilterStatus('TRASH')}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap ${filterStatus === 'TRASH' ? 'bg-red-50 text-red-600 shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-red-500'}`}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        휴지통 {quoteCounts.TRASH ? `(${quoteCounts.TRASH})` : ''}
                    </button>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
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

                    <Button
                        variant="outline"
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-xs"
                    >
                        <Download className="w-4 h-4 text-teal-600" />
                        엑셀 다운로드
                    </Button>
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

                            const checkQuoteStockInsufficiency = (q: typeof quote) => {
                                if (q.isDeleted) return false;
                                for (const item of q.items) {
                                    const id = item.productId || (item as { item_id?: string }).item_id;
                                    if (!id) continue;
                                    const product = inventory.find(p => p.id === id);
                                    if (!product) continue;
                                    
                                    let totalStock = 0;
                                    if (product.locationStock) {
                                        totalStock = Object.values(product.locationStock).reduce((sum, qty) => sum + Number(qty), 0);
                                    } else {
                                        totalStock = product.currentStock || 0;
                                    }
                                    
                                    const waitQty = product.marking_wait_qty || item.marking_wait_qty || 0;
                                    totalStock += Number(waitQty);
                                    
                                    const reqQty = Number(item.quantity ?? item.qty ?? 0);
                                    if (reqQty > totalStock) return true;
                                }
                                return false;
                            };

                            const simInfo = similarityMap.get(quote.id) || (quote.similarity && (quote.similarity.topScore ?? 0) >= 50 ? {
                                topType: quote.similarity.topType,
                                topScore: quote.similarity.topScore,
                                topMatch: quote.similarity as unknown as SimilarityMatchCandidate,
                                candidates: [quote.similarity as unknown as SimilarityMatchCandidate]
                            } : null);

                            return (
                                <div key={quote.id} className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4 group hover:shadow-md transition-all">
                                    {/* 좌측: 기본 정보 및 상태 태그 그룹 (수정됨, 재고부족, 유사도) */}
                                    <div className="flex items-start gap-4 min-w-0 flex-1">
                                        <div className="p-3 bg-teal-50 text-teal-600 rounded-lg group-hover:bg-teal-100 transition-colors shrink-0">
                                            <FileText className="w-6 h-6" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="font-bold text-slate-800 text-lg whitespace-nowrap">
                                                    {displayCompany}
                                                    {displayContact && <span className="text-base text-slate-500 font-medium ml-1">({displayContact})</span>}
                                                </span>
                                                <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded shrink-0">{quote.id}</span>

                                                {/* 좌측 정렬 상태 태그 그룹 */}
                                                <div className="inline-flex items-center gap-1.5 flex-wrap">
                                                    {isModified && (
                                                        <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 shrink-0 whitespace-nowrap">
                                                            수정됨
                                                        </span>
                                                    )}
                                                    {checkQuoteStockInsufficiency(quote) && (
                                                        <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1 shadow-sm shrink-0 whitespace-nowrap">
                                                            ⚠️ 재고 부족
                                                        </span>
                                                    )}
                                                    {simInfo && (simInfo.topType !== 'NONE' || simInfo.topScore >= 50) && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDrawerQuoteId(quote.id);
                                                                setActiveDrawerCandidate(simInfo.topMatch);
                                                            }}
                                                            className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border shadow-2xs inline-flex items-center gap-1 cursor-pointer transition-all hover:scale-105 active:scale-95 shrink-0 whitespace-nowrap ${
                                                                simInfo.topType === 'SAME_PROJECT' ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' :
                                                                simInfo.topType === 'SHORTAGE' ? 'bg-blue-50 text-blue-800 border-blue-300 hover:bg-blue-100' :
                                                                simInfo.topType === 'DUPLICATE' ? 'bg-purple-50 text-purple-800 border-purple-300 hover:bg-purple-100' :
                                                                'bg-teal-50 text-teal-800 border-teal-300 hover:bg-teal-100'
                                                            }`}
                                                            title={`클릭하여 유사 내역 서랍 열기 (유사도 ${simInfo.topScore}점 / 대상: ${simInfo.topMatch.targetDocNo})`}
                                                        >
                                                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
                                                            <span>
                                                                {simInfo.topType === 'SAME_PROJECT' ? `⚠️ 타사/경쟁 유의 (${simInfo.topScore}점)` :
                                                                 simInfo.topType === 'SHORTAGE' ? `🔗 Shortage (${simInfo.topScore}점)` :
                                                                 simInfo.topType === 'DUPLICATE' ? `중복 접수 (${simInfo.topScore}점)` :
                                                                 `동사/반복 유의 (${simInfo.topScore}점)`}
                                                            </span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`text-sm font-bold ${isModified ? 'text-teal-700' : 'text-indigo-700'} mb-1 flex items-center gap-1.5`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${isModified ? 'bg-teal-400' : 'bg-indigo-400'} inline-block`}></span>
                                                원주문: {quote.customerNumber}
                                            </div>

                                            <div className="text-sm text-slate-500 flex flex-wrap items-center gap-4">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {new Date(quote.createdAt).toLocaleString()}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <span className="font-bold text-slate-700">{quote.items.length}</span> 개 품목
                                                </span>
                                                {quote.isDeleted && (
                                                    <span className="text-xs text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded font-bold">
                                                        삭제: {quote.deletedAt ? new Date(quote.deletedAt).toLocaleString() : ''} 
                                                        {quote.deletedBy ? ` (ID: ${quote.deletedBy})` : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 우측 고정 영역: 사진보기, 접수상태, 총견적금액, 액션버튼 (우측 끝에 완벽 고정) */}
                                    <div className="flex items-center justify-end gap-3 lg:gap-5 shrink-0 w-full xl:w-auto pt-3 xl:pt-0 border-t border-slate-100 xl:border-t-0 flex-nowrap ml-auto">
                                        {/* 사진 보기 및 접수(StatusSelect) 영역 */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            {(quote.attachments && quote.attachments.length > 0) && (
                                                <div className="flex gap-1.5 shrink-0">
                                                    {quote.attachments.map((file, i) => (
                                                        <a 
                                                            key={i} 
                                                            href={`${import.meta.env.VITE_API_URL || ''}/api/download?url=${encodeURIComponent(file.url)}`}
                                                            target="_blank" 
                                                            rel="noopener noreferrer" 
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 hover:bg-yellow-100 rounded-full text-xs font-bold transition-colors shadow-sm shrink-0 whitespace-nowrap"
                                                            title={file.name}
                                                        >
                                                            <Image className="w-3.5 h-3.5" />
                                                            사진 보기 {quote.attachments!.length > 1 ? `(${i+1})` : ''}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="shrink-0">
                                                <StatusSelect
                                                    status={quote.status}
                                                    onChange={(val) => handleStatusUpdate(quote.id, val)}
                                                />
                                            </div>
                                        </div>

                                        {/* 총 견적금액 (기준선 통일을 위한 min-width 적용) */}
                                        <div className="text-right shrink-0 min-w-[105px] lg:min-w-[120px]">
                                            <div className="text-xs text-slate-400 font-medium whitespace-nowrap">총 견적금액</div>
                                            <div className="text-lg lg:text-xl font-bold text-teal-700 font-mono whitespace-nowrap">
                                                {formatCurrency(quote.totalAmount)}
                                            </div>
                                        </div>

                                        {/* 액션 버튼 그룹 */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            {canManageTrash && (
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
                                                className="gap-1.5 whitespace-nowrap"
                                                onClick={() => setSelectedQuote(quote)}
                                            >
                                                <FileText className="w-4 h-4" /> 상세
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-slate-400 hover:text-teal-600 gap-1 whitespace-nowrap"
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

            {/* 유사 견적/발주 서랍 패널 */}
            {activeDrawerData && (
                <QuoteSimilarityDrawer
                    isOpen={!!drawerQuoteId}
                    onClose={() => {
                        setDrawerQuoteId(null);
                        setActiveDrawerCandidate(null);
                    }}
                    candidates={activeDrawerData.candidates.filter(c => !dismissedTargetIds.has(c.targetId))}
                    selectedCandidate={activeDrawerCandidate}
                    onSelectCandidate={setActiveDrawerCandidate}
                    onOpenComparisonModal={(cand) => {
                        setComparisonCandidate(cand);
                    }}
                    onDismissMatch={(targetId) => {
                        setDismissedTargetIds(prev => new Set([...prev, targetId]));
                        if (activeDrawerCandidate?.targetId === targetId) {
                            setActiveDrawerCandidate(null);
                        }
                    }}
                />
            )}

            {/* 정밀 비교 모달 (Side-by-side Visual Diff) */}
            <QuoteComparisonModal
                isOpen={!!comparisonCandidate}
                onClose={() => setComparisonCandidate(null)}
                candidate={comparisonCandidate}
            />

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
        PARTIAL_ORDERED: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200',
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
                <option value="PARTIAL_ORDERED">부분 발주 (Partial)</option>
                <option value="COMPLETED">주문접수 (Completed)</option>
            </select>
            {/* Simple CSS Chevron */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 border-t-4 border-t-slate-600 border-x-[3px] border-x-transparent" />
        </div>
    );
}
