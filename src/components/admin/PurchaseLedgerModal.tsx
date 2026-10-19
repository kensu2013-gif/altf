import { useState, useEffect } from 'react';
import { 
    X, 
    Search, 
    RefreshCw, 
    Download,
    FolderOpen,
    CheckCircle2, 
    AlertCircle, 
    Clock, 
    Boxes
} from 'lucide-react';

export interface PurchaseStockItem {
    id: string;
    orderId: string;
    orderDate: string;
    receivedDate: string;
    customer: string;
    supplier: string;
    poNo: string;
    certNo: string;
    specMaterial: string;
    specInspection: string;
    heatNo: string;
    lotNo: string;
    itemNo: number;
    description: string;
    orderQty: number;
    receivedQty: number;
    pendingQty: number;
    status: '입고완료' | '부분입고' | '미결';
    chem?: {
        C: string | number;
        Si: string | number;
        Mn: string | number;
        P: string | number;
        S: string | number;
        Ni: string | number;
        Cr: string | number;
        Mo: string | number;
    };
    mech?: string;
    pdfUrls?: string[];
    memo?: string;
}

export interface PurchaseStockSummary {
    totalItems: number;
    fulfilledCount: number;
    partialCount: number;
    pendingCount: number;
    fulfillmentRate: number;
    lastSyncTime: string;
}

interface PurchaseLedgerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface SchedulerInfo {
    manager: string;
    managerName: string;
    cycle: string;
    targetUrl: string;
    status: string;
    lastSyncTime: string;
    nextSyncTime: string;
    remainingFormatted: string;
}

export function PurchaseLedgerModal({ isOpen, onClose }: PurchaseLedgerModalProps) {
    const [items, setItems] = useState<PurchaseStockItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'ALL' | '입고완료' | '부분입고' | '미결'>('ALL');
    const [searchKeyword, setSearchKeyword] = useState('');
    const [summary, setSummary] = useState<PurchaseStockSummary | null>(null);
    const [schedulerInfo, setSchedulerInfo] = useState<SchedulerInfo | null>(null);

    // 데이터 로드
    const fetchStockOrders = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'ALL') params.append('status', statusFilter);
            if (searchKeyword) params.append('search', searchKeyword);

            const res = await fetch(`/api/pur/stock-orders?${params.toString()}`);
            const data = await res.json();
            if (data.success) {
                setItems(data.items || []);
            }
        } catch (e) {
            console.error('Fetch stock orders error:', e);
        } finally {
            setLoading(false);
        }
    };

    // 요약 지표 로드
    const fetchSummary = async () => {
        try {
            const res = await fetch('/api/pur/summary');
            const data = await res.json();
            if (data.success) {
                setSummary(data);
            }
        } catch (e) {
            console.error('Fetch summary error:', e);
        }
    };

    // 하루 1회 감지 스케줄러 상태 로드
    const fetchSchedulerStatus = async () => {
        try {
            const res = await fetch('/api/pur/scheduler-status');
            const data = await res.json();
            if (data.success) {
                setSchedulerInfo(data);
            }
        } catch (e) {
            console.error('Fetch scheduler status error:', e);
        }
    };

    // 웹 알트에프 재고 발주 신규 신호 감지 & List Up 재실행 (altf.kr API 호출)
    const handleSyncAll = async () => {
        setLoading(true);
        try {
            await fetch('/api/pur/scheduler-trigger', { method: 'POST' });
            await fetchStockOrders();
            await fetchSummary();
            await fetchSchedulerStatus();
        } catch (e) {
            console.error('Sync error:', e);
        } finally {
            setLoading(false);
        }
    };

    // 보관함 폴더 열기 (storage/purchases)
    const handleOpenFolder = async () => {
        try {
            await fetch('/api/pur/open-folder', { method: 'POST' });
        } catch (e) {
            console.error('Open folder error:', e);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchSummary();
            fetchStockOrders();
            fetchSchedulerStatus();
        }
    }, [isOpen, statusFilter]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-[96vw] h-[92vh] bg-slate-950 border border-emerald-500/40 rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.2)] flex flex-col overflow-hidden text-slate-100 font-sans">
                
                {/* 헤더 바 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/70">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                            <Boxes className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-lg font-bold text-slate-100">
                                    알트에프 재고 발주 & QC 성적서 1:1 매칭 대장
                                </h2>
                                <span className="px-2.5 py-0.5 text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 rounded flex items-center gap-1 shadow-sm">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                    <span>PUR-01 사원 관리지정</span>
                                </span>
                                <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-slate-800 text-amber-300 border border-amber-500/40 rounded flex items-center gap-1 shadow-sm">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                    <span>1일 2회 (10:00 / 17:00) 대기 중 (다음: {schedulerInfo?.remainingFormatted || '오전 10:00'})</span>
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                [담당: 구매부 PUR-01] altf.kr 웹 재고 발주 신호 자동 감지 ➔ 발주번호별/아이템별 List Up ➔ QC-01 성적서(26개 컬럼) 1:1 매칭 & 미결(Pending) 관리
                            </p>
                        </div>
                    </div>

                    {/* 우측 퀵 액션 & 닫기 */}
                    <div className="flex items-center gap-2.5">
                        <a
                            href="/api/pur/download-excel"
                            download="알트에프_재고_발주_대장.xlsx"
                            className="px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/50 text-emerald-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                            title="QC-01과 100% 동일한 26개 컬럼 체계의 엑셀 대장 파일 다운로드"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span>📥 엑셀 대장 다운로드</span>
                        </a>

                        <button
                            onClick={handleOpenFolder}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                            title="내 컴퓨터의 storage/purchases 폴더 창을 직접 엽니다."
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>📂 폴더 열기</span>
                        </button>

                        <button
                            onClick={handleSyncAll}
                            disabled={loading}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all cursor-pointer"
                            title="웹 altf.kr의 재고 발주 API 신호를 즉시 점검하여 신규 발주분과 미결 현황을 List Up합니다."
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            <span>🌐 altf.kr API 즉시 감지 & 동기화</span>
                        </button>

                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer ml-1"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 상단 현황 지표 바 */}
                {summary && (
                    <div className="px-6 py-2.5 bg-emerald-950/20 border-b border-emerald-900/30 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">총 재고 발주품목:</span>
                                <span className="font-bold font-mono text-emerald-400 text-sm">{summary.totalItems?.toLocaleString()}개</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                <span className="text-slate-400">입고 완료 (성적서 일치):</span>
                                <span className="font-bold font-mono text-emerald-300 text-sm">{summary.fulfilledCount?.toLocaleString()}건</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                <span className="text-slate-400">부분 입고:</span>
                                <span className="font-bold font-mono text-amber-300 text-sm">{summary.partialCount?.toLocaleString()}건</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                                <span className="text-slate-400">미결 (입고 대기):</span>
                                <span className="font-bold font-mono text-rose-300 text-sm">{summary.pendingCount?.toLocaleString()}건</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">입고율:</span>
                                <span className="font-bold font-mono text-cyan-300 text-sm">{summary.fulfillmentRate}%</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                            <span>관리자: <strong className="text-emerald-300">PUR-01 사원</strong></span>
                            <span className="text-slate-600">|</span>
                            <span>스케줄: <strong className="text-amber-300">1일 2회 (10:00 / 17:00) 대기 중</strong></span>
                            <span className="text-slate-600">|</span>
                            <span>다음 감지: <strong className="text-cyan-300">{schedulerInfo?.remainingFormatted || '오전 10:00'}</strong></span>
                            <span className="text-slate-600">|</span>
                            <span>원장: <span className="text-slate-200">storage/purchases/알트에프 재고 발주 대장.xlsx</span></span>
                        </div>
                    </div>
                )}

                {/* 필터 & 검색 바 */}
                <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-medium">입고 상태 필터:</span>
                        <div className="flex items-center gap-1 bg-black/50 p-1 rounded-lg border border-slate-800">
                            {(['ALL', '입고완료', '부분입고', '미결'] as const).map(st => (
                                <button
                                    key={st}
                                    onClick={() => setStatusFilter(st)}
                                    className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                                        statusFilter === st
                                            ? 'bg-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {st === 'ALL' ? '전체' : st}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="relative w-80">
                        <input
                            type="text"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchStockOrders()}
                            placeholder="P.O 번호, 품목 규격, HEAT No, LOT No 검색"
                            className="w-full pl-8 pr-3 py-2 bg-black/60 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500 transition-all font-mono"
                        />
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                    </div>
                </div>

                {/* 대장 그리드 테이블 (QC-01과 100% 동일한 26개 컬럼 체계) */}
                <div className="flex-1 overflow-auto bg-black/60 p-4">
                    <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/80 shadow-inner">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-900/95 text-slate-400 sticky top-0 z-20 border-b border-slate-800 font-bold font-mono text-[11px]">
                                <tr>
                                    <th className="p-3 whitespace-nowrap">발주일자</th>
                                    <th className="p-3 whitespace-nowrap">입고일자</th>
                                    <th className="p-3 whitespace-nowrap">Customer</th>
                                    <th className="p-3 whitespace-nowrap">공급처</th>
                                    <th className="p-3 whitespace-nowrap">P.O No</th>
                                    <th className="p-3 whitespace-nowrap">CERT-No</th>
                                    <th className="p-3 whitespace-nowrap">Spec MAT</th>
                                    <th className="p-3 whitespace-nowrap">Spec INSP</th>
                                    <th className="p-3 whitespace-nowrap">HEAT No</th>
                                    <th className="p-3 whitespace-nowrap">LOT No</th>
                                    <th className="p-3 text-center whitespace-nowrap">ITEM</th>
                                    <th className="p-3 whitespace-nowrap min-w-[220px]">DESCRIPTION (품목 규격)</th>
                                    <th className="p-3 text-right whitespace-nowrap">발주수량</th>
                                    <th className="p-3 text-right whitespace-nowrap">입고수량</th>
                                    <th className="p-3 text-right whitespace-nowrap">미결수량</th>
                                    <th className="p-3 text-center whitespace-nowrap">입고상태</th>
                                    <th className="p-3 whitespace-nowrap">화학성분 (C/Si/Mn/Ni/Cr/Mo)</th>
                                    <th className="p-3 whitespace-nowrap">기계적성질</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-900 font-mono text-[11px]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={18} className="p-16 text-center text-slate-400 font-sans">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-400" />
                                            <span>알트에프 재고 발주분을 조회 및 성적서와 매칭 중입니다...</span>
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={18} className="p-16 text-center text-slate-500 font-sans">
                                            조회된 재고 발주 내역이 없습니다.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map((r, idx) => (
                                        <tr key={idx} className="hover:bg-slate-900/60 transition-colors">
                                            <td className="p-3 text-slate-400 whitespace-nowrap">{r.orderDate}</td>
                                            <td className="p-3 text-slate-400 whitespace-nowrap">{r.receivedDate}</td>
                                            <td className="p-3 whitespace-nowrap">
                                                <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 font-bold text-[10px]">
                                                    {r.customer}
                                                </span>
                                            </td>
                                            <td className="p-3 text-slate-300 whitespace-nowrap">{r.supplier}</td>
                                            <td className="p-3 font-bold text-slate-100 whitespace-nowrap">{r.poNo}</td>
                                            <td className="p-3 text-emerald-300 font-bold whitespace-nowrap">{r.certNo}</td>
                                            <td className="p-3 text-slate-400 whitespace-nowrap">{r.specMaterial}</td>
                                            <td className="p-3 text-slate-400 whitespace-nowrap">{r.specInspection}</td>
                                            <td className="p-3 whitespace-nowrap">
                                                {r.heatNo !== '-' ? (
                                                    <span className="px-1.5 py-0.5 rounded bg-amber-950/50 border border-amber-500/40 text-amber-300 font-black text-[10px]">
                                                        {r.heatNo}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-600">-</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-300 whitespace-nowrap">{r.lotNo}</td>
                                            <td className="p-3 text-center text-slate-400 whitespace-nowrap">{r.itemNo}</td>
                                            <td className="p-3 font-sans font-medium text-slate-200 whitespace-nowrap">
                                                {r.description}
                                            </td>
                                            <td className="p-3 text-right font-bold text-slate-100 whitespace-nowrap">
                                                {r.orderQty?.toLocaleString()}
                                            </td>
                                            <td className="p-3 text-right font-bold text-emerald-400 whitespace-nowrap">
                                                {r.receivedQty?.toLocaleString()}
                                            </td>
                                            <td className="p-3 text-right font-bold text-rose-400 whitespace-nowrap">
                                                {r.pendingQty > 0 ? r.pendingQty?.toLocaleString() : '-'}
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                {r.status === '입고완료' ? (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-[10px] inline-flex items-center gap-1">
                                                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                                        입고완료
                                                    </span>
                                                ) : r.status === '부분입고' ? (
                                                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-[10px] inline-flex items-center gap-1">
                                                        <Clock className="w-3 h-3 text-amber-400" />
                                                        부분입고
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-[10px] inline-flex items-center gap-1">
                                                        <AlertCircle className="w-3 h-3 text-rose-400" />
                                                        미결
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-400 text-[10px] whitespace-nowrap">
                                                {r.chem?.Ni ? (
                                                    <span>Ni:{r.chem.Ni} Cr:{r.chem.Cr} {r.chem.Mo ? `Mo:${r.chem.Mo}` : ''} C:{r.chem.C}</span>
                                                ) : (
                                                    <span className="text-slate-600">-</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-400 text-[10px] whitespace-nowrap">{r.mech}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
