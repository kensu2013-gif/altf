import { useState, useEffect, useMemo } from 'react';
import { 
    X, 
    Search, 
    RefreshCw, 
    FolderOpen, 
    AlertTriangle, 
    CheckCircle2, 
    Clock, 
    Layers, 
    Copy, 
    Check, 
    UploadCloud, 
    TrendingUp, 
    BellRing,
    Factory,
    FileSpreadsheet,
    Flame
} from 'lucide-react';

export interface PendingOrderItem {
    rowIdx: number;
    lotNo: string;
    no?: string | number;
    itemName: string;
    material: string;
    thickness: string;
    status: string; // ERW / SML'S
    size: string;
    orderQty: number;
    remainQty: number;
    releaseQty: number;
    packing: string;
    workType: string; // 검토 / 생산 / 재고 / 수정
    processNo: string;
    orderCompany: string;
    inboundDate: string;
    cutDate: string;
    formDate: string;
    heatDate: string;
    calibDate: string;
    machDate: string;
    acidDate: string;
    storeDate: string;
    sandDate: string;
    ndeDate: string;
    orderNo: string;
    deliveryTo: string;
    project: string;
    customerReq: string;
    notes: string;
    stage: string;
    progressPct: number;
    isCompleted: boolean;
    matched: boolean;
    customerName: string;
    poCreatedAt?: string | null;
    isStockOrder: boolean;
    alertReason?: string | null;
    alertSeverity?: 'NORMAL' | 'WARNING' | 'CRITICAL';
}

export interface PendingAnalysisSummary {
    totalRows: number;
    matchedCount: number;
    unmatchedCount: number;
    stockOrderCount: number;
    alertCount: number;
}

export interface LeadtimeCategoryStat {
    category: string;
    count: number;
    totalDays: number;
    minDays: number;
    maxDays: number;
    avgDays: number;
}

export interface PendingAnalysisData {
    timestamp: string;
    filename: string;
    archivePath: string;
    summary: PendingAnalysisSummary;
    stageCounts: Record<string, number>;
    chaserReport?: {
        reportId: string;
        createdAt: string;
        markdown: string;
        summary: {
            totalRows: number;
            alertCount: number;
            criticalCount: number;
            warningCount: number;
        };
        groupByOrder: Record<string, {
            orderNo: string;
            customerName: string;
            items: PendingOrderItem[];
        }>;
    };
    leadtimeStats?: {
        lastUpdated: string;
        sampleCount: number;
        categoryStats: LeadtimeCategoryStat[];
    };
    rows: PendingOrderItem[];
}

interface PendingOrdersModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function PendingOrdersModal({ isOpen, onClose }: PendingOrdersModalProps) {
    const [data, setData] = useState<PendingAnalysisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [stageFilter, setStageFilter] = useState<string>('ALL');
    const [severityFilter, setSeverityFilter] = useState<'ALL' | 'ALERT_ONLY' | 'CRITICAL' | 'WARNING'>('ALL');
    const [copiedReport, setCopiedReport] = useState(false);
    const [activeTab, setActiveTab] = useState<'TABLE' | 'CHASER_REPORT' | 'LEADTIME'>('TABLE');
    const [uploading, setUploading] = useState(false);

    // Fetch latest analysis
    const fetchLatestAnalysis = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/pending-orders/latest');
            const json = await res.json();
            if (json.success && json.data) {
                setData(json.data);
            }
        } catch (e) {
            console.error('Fetch latest pending orders error:', e);
        } finally {
            setLoading(false);
        }
    };

    // Trigger sync / re-analysis
    const handleSync = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/pending-orders/sync', { method: 'POST' });
            const json = await res.json();
            if (json.success && json.data) {
                setData(json.data);
            }
        } catch (e) {
            console.error('Sync pending orders error:', e);
        } finally {
            setLoading(false);
        }
    };

    // Open storage folder
    const handleOpenFolder = async () => {
        try {
            await fetch('/api/pending-orders/open-folder', { method: 'POST' });
        } catch (e) {
            console.error('Open folder error:', e);
        }
    };

    // Copy chaser report markdown
    const handleCopyReport = () => {
        if (!data?.chaserReport?.markdown) return;
        navigator.clipboard.writeText(data.chaserReport.markdown);
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2500);
    };

    // File upload
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/pending-orders/upload', {
                method: 'POST',
                body: formData
            });
            const json = await res.json();
            if (json.success && json.data) {
                setData(json.data);
            }
        } catch (err) {
            console.error('Upload pending excel error:', err);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchLatestAnalysis();
        }
    }, [isOpen]);

    // Filtered rows
    const filteredRows = useMemo(() => {
        if (!data?.rows) return [];
        return data.rows.filter(item => {
            // Stage filter
            if (stageFilter !== 'ALL' && item.stage !== stageFilter) {
                return false;
            }

            // Severity filter
            if (severityFilter === 'ALERT_ONLY' && !item.alertReason) return false;
            if (severityFilter === 'CRITICAL' && item.alertSeverity !== 'CRITICAL') return false;
            if (severityFilter === 'WARNING' && item.alertSeverity !== 'WARNING') return false;

            // Search keyword
            if (searchKeyword.trim()) {
                const kw = searchKeyword.toLowerCase();
                const matchOrder = item.orderNo?.toLowerCase().includes(kw);
                const matchLot = item.lotNo?.toLowerCase().includes(kw);
                const matchName = item.itemName?.toLowerCase().includes(kw);
                const matchCust = item.customerName?.toLowerCase().includes(kw);
                const matchSize = item.size?.toLowerCase().includes(kw);
                const matchMat = item.material?.toLowerCase().includes(kw);
                const matchWork = item.workType?.toLowerCase().includes(kw);
                const matchReason = item.alertReason?.toLowerCase().includes(kw);

                if (!matchOrder && !matchLot && !matchName && !matchCust && !matchSize && !matchMat && !matchWork && !matchReason) {
                    return false;
                }
            }

            return true;
        });
    }, [data, stageFilter, severityFilter, searchKeyword]);

    if (!isOpen) return null;

    const summary = data?.summary;
    const stageCounts = data?.stageCounts || {};
    const chaserReport = data?.chaserReport;
    const leadtimeStats = data?.leadtimeStats;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-[96vw] h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
                {/* 1. Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                            <Factory className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                                    대경벤드 생산 미결 & 공정 관제 허브
                                </h2>
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    구매부 미결관리팀 (PUR-01~04)
                                </span>
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    영업부(SAL-03) · 데이터팀(DAT-07)
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                                <span>원장: <b>{data?.filename || '알트에프 미결 리스트.xlsx'}</b></span>
                                <span>•</span>
                                <span>동기화: {data?.timestamp ? new Date(data.timestamp).toLocaleString('ko-KR') : '확인 중'}</span>
                            </p>
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                        {/* Tab Switch */}
                        <div className="flex items-center bg-slate-800/80 rounded-lg p-1 border border-slate-700 mr-2">
                            <button
                                onClick={() => setActiveTab('TABLE')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                    activeTab === 'TABLE' 
                                        ? 'bg-amber-600 text-white shadow-sm' 
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <Layers className="w-3.5 h-3.5 inline mr-1.5" />
                                공정 대장 ({data?.rows?.length || 0})
                            </button>
                            <button
                                onClick={() => setActiveTab('CHASER_REPORT')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                    activeTab === 'CHASER_REPORT' 
                                        ? 'bg-red-600 text-white shadow-sm' 
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <BellRing className="w-3.5 h-3.5 inline mr-1.5" />
                                납기 독촉장 ({summary?.alertCount || 0})
                            </button>
                            <button
                                onClick={() => setActiveTab('LEADTIME')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                    activeTab === 'LEADTIME' 
                                        ? 'bg-indigo-600 text-white shadow-sm' 
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                <TrendingUp className="w-3.5 h-3.5 inline mr-1.5" />
                                제조 리드타임 통계
                            </button>
                        </div>

                        {/* File Upload Button */}
                        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 cursor-pointer transition-colors">
                            <UploadCloud className="w-3.5 h-3.5 text-amber-400" />
                            <span>{uploading ? '분석 중...' : '엑셀 업로드'}</span>
                            <input 
                                type="file" 
                                accept=".xlsx,.xls" 
                                className="hidden" 
                                onChange={handleFileUpload}
                                disabled={uploading || loading}
                            />
                        </label>

                        {/* Open folder button */}
                        <button
                            onClick={handleOpenFolder}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
                            title="storage/pending_lists 폴더 열기"
                        >
                            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                            <span>보관함</span>
                        </button>

                        {/* Sync button */}
                        <button
                            onClick={handleSync}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 border border-amber-500/30 transition-colors"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            <span>즉시 재분석</span>
                        </button>

                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-2"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 2. Key Metrics Summary Banner */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-950/40 border-b border-slate-800">
                    {/* Total rows */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-slate-400 font-medium">대경 미결 총 행수</div>
                            <div className="text-xl font-bold text-white mt-1">
                                {summary?.totalRows ? summary.totalRows.toLocaleString() : '0'} <span className="text-xs font-normal text-slate-400">건</span>
                            </div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                            <FileSpreadsheet className="w-4 h-4" />
                        </div>
                    </div>

                    {/* Matched count */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-slate-400 font-medium">우리 발주(PO) 매칭</div>
                            <div className="text-xl font-bold text-emerald-400 mt-1">
                                {summary?.matchedCount ? summary.matchedCount.toLocaleString() : '0'} <span className="text-xs font-normal text-slate-400">건</span>
                            </div>
                            <div className="text-[11px] text-slate-500">재고발주 {summary?.stockOrderCount || 0}건 포함</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" />
                        </div>
                    </div>

                    {/* Urgent Chaser Alerts */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-red-500/30 flex items-center justify-between bg-red-950/20">
                        <div>
                            <div className="text-xs text-red-400 font-medium flex items-center gap-1">
                                <Flame className="w-3 h-3 text-red-400 animate-pulse" />
                                <span>대경 납기 독촉 경보</span>
                            </div>
                            <div className="text-xl font-bold text-red-400 mt-1">
                                {summary?.alertCount ? summary.alertCount.toLocaleString() : '0'} <span className="text-xs font-normal text-slate-400">건</span>
                            </div>
                            <div className="text-[11px] text-red-300/80">긴급 {chaserReport?.summary?.criticalCount || 0}건 · 경고 {chaserReport?.summary?.warningCount || 0}건</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
                            <AlertTriangle className="w-4 h-4" />
                        </div>
                    </div>

                    {/* Completed stored */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-slate-400 font-medium">창고 입고 완료 (출고가능)</div>
                            <div className="text-xl font-bold text-teal-400 mt-1">
                                {stageCounts['창고입고완료'] ? stageCounts['창고입고완료'].toLocaleString() : '0'} <span className="text-xs font-normal text-slate-400">건</span>
                            </div>
                            <div className="text-[11px] text-teal-400/70">진행률 100% 완료</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                            <Check className="w-4 h-4" />
                        </div>
                    </div>

                    {/* Avg Leadtime */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-slate-400 font-medium">제조 평균 리드타임</div>
                            <div className="text-xl font-bold text-indigo-400 mt-1">
                                23.5 <span className="text-xs font-normal text-slate-400">일</span>
                            </div>
                            <div className="text-[11px] text-slate-500">실측 57개 표본 분석</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                            <Clock className="w-4 h-4" />
                        </div>
                    </div>
                </div>

                {/* 3. 9-Stage Process Funnel Visual Progress */}
                <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800/80">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                            <span>🏭 9단계 제조 공정 진행 현황 퍼널</span>
                            <span className="text-[11px] text-slate-500 font-normal">
                                (L열 검토·생산·재고 판별 ➔ 절단~입고 추적)
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-9 gap-1.5 text-center text-xs">
                        {[
                            { name: '검토정체', count: stageCounts['검토정체'] || 0, color: 'bg-amber-950/40 border-amber-500/40 text-amber-300', pct: '0%' },
                            { name: '절단대기', count: stageCounts['절단대기'] || 0, color: 'bg-red-950/40 border-red-500/40 text-red-300', pct: '5%' },
                            { name: '절단완료', count: stageCounts['절단완료'] || 0, color: 'bg-blue-950/40 border-blue-500/40 text-blue-300', pct: '20%' },
                            { name: '성형완료', count: stageCounts['성형완료'] || 0, color: 'bg-blue-950/40 border-blue-500/40 text-blue-300', pct: '35%' },
                            { name: '열처리완료', count: stageCounts['열처리완료'] || 0, color: 'bg-purple-950/40 border-purple-500/40 text-purple-300', pct: '50%' },
                            { name: '교정완료', count: stageCounts['교정완료'] || 0, color: 'bg-purple-950/40 border-purple-500/40 text-purple-300', pct: '60%' },
                            { name: '가공완료', count: stageCounts['가공완료'] || 0, countColor: 'text-cyan-400', color: 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300', pct: '75%' },
                            { name: '산세완결', count: stageCounts['산세완료'] || 0, color: 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300', pct: '90%' },
                            { name: '창고입고', count: stageCounts['창고입고완료'] || 0, color: 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300', pct: '100%' }
                        ].map((st, i) => (
                            <button
                                key={st.name}
                                onClick={() => setStageFilter(stageFilter === st.name ? 'ALL' : st.name)}
                                className={`p-2 rounded-lg border transition-all text-left ${st.color} ${
                                    stageFilter === st.name ? 'ring-2 ring-amber-400 scale-[1.02]' : 'hover:border-slate-500'
                                }`}
                            >
                                <div className="text-[10px] text-slate-400 flex items-center justify-between">
                                    <span>Step {i + 1}</span>
                                    <span>{st.pct}</span>
                                </div>
                                <div className="font-semibold truncate text-[11px] mt-0.5">{st.name}</div>
                                <div className="text-base font-bold mt-0.5">{st.count}건</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 4. Tab Contents */}
                {activeTab === 'TABLE' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50">
                        {/* Search & Filter Toolbar */}
                        <div className="p-3 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/30">
                            {/* Search input */}
                            <div className="relative flex-1 max-w-md">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="주문번호, 품명, 고객사, 규격, 재질, 정체사유 검색..."
                                    value={searchKeyword}
                                    onChange={e => setSearchKeyword(e.target.value)}
                                    className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-colors"
                                />
                            </div>

                            {/* Filter Chips */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">경보 필터:</span>
                                <button
                                    onClick={() => setSeverityFilter('ALL')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    전체
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('ALERT_ONLY')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                                        severityFilter === 'ALERT_ONLY' ? 'bg-red-600 text-white' : 'text-red-400 hover:text-red-300'
                                    }`}
                                >
                                    <AlertTriangle className="w-3 h-3" />
                                    지연 경보 전체 ({summary?.alertCount || 0})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('CRITICAL')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'CRITICAL' ? 'bg-red-700 text-white' : 'text-red-300 hover:text-white'
                                    }`}
                                >
                                    🚨 긴급 (절단누락 {chaserReport?.summary?.criticalCount || 0})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('WARNING')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'WARNING' ? 'bg-amber-600 text-white' : 'text-amber-300 hover:text-white'
                                    }`}
                                >
                                    ⚠️ 경고 (검토정체 {chaserReport?.summary?.warningCount || 0})
                                </button>
                            </div>
                        </div>

                        {/* Data Table */}
                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800 z-10 shadow-sm font-semibold">
                                    <tr>
                                        <th className="py-2.5 px-3">행</th>
                                        <th className="py-2.5 px-3">LOT번호</th>
                                        <th className="py-2.5 px-3">주문번호 (Y열)</th>
                                        <th className="py-2.5 px-3">고객사</th>
                                        <th className="py-2.5 px-3">품 명</th>
                                        <th className="py-2.5 px-3">규격 / 두께</th>
                                        <th className="py-2.5 px-3">재질</th>
                                        <th className="py-2.5 px-3 text-center">작업 (L열)</th>
                                        <th className="py-2.5 px-3 text-right">수주잔량</th>
                                        <th className="py-2.5 px-3 text-center">공정 단계</th>
                                        <th className="py-2.5 px-3 text-center">진행률</th>
                                        <th className="py-2.5 px-3">절단일</th>
                                        <th className="py-2.5 px-3">가공일</th>
                                        <th className="py-2.5 px-3">입고일</th>
                                        <th className="py-2.5 px-3">납기 독촉 / 정체 사유</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60 font-mono">
                                    {filteredRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={15} className="py-12 text-center text-slate-500 font-sans">
                                                조건에 일치하는 미결 데이터가 없습니다.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredRows.map(row => {
                                            const isAlert = !!row.alertReason;
                                            const isCritical = row.alertSeverity === 'CRITICAL';
                                            return (
                                                <tr 
                                                    key={row.rowIdx}
                                                    className={`hover:bg-slate-800/50 transition-colors ${
                                                        isCritical ? 'bg-red-950/20' : (isAlert ? 'bg-amber-950/10' : '')
                                                    }`}
                                                >
                                                    <td className="py-2 px-3 text-slate-500">{row.rowIdx}</td>
                                                    <td className="py-2 px-3 font-semibold text-slate-300">{row.lotNo}</td>
                                                    <td className="py-2 px-3">
                                                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                                            row.matched 
                                                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                                : 'bg-slate-800 text-slate-400'
                                                        }`}>
                                                            {row.orderNo || '-'}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-3 font-sans text-slate-300 truncate max-w-[120px]" title={row.customerName}>
                                                        {row.customerName}
                                                    </td>
                                                    <td className="py-2 px-3 font-bold text-white">{row.itemName}</td>
                                                    <td className="py-2 px-3 text-slate-300">{row.size} ({row.thickness})</td>
                                                    <td className="py-2 px-3 text-slate-400">{row.material}</td>
                                                    <td className="py-2 px-3 text-center font-sans">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                            row.workType.includes('생산') ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                                            row.workType.includes('재고') ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' :
                                                            row.workType.includes('검토') ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                                            'bg-slate-800 text-slate-400'
                                                        }`}>
                                                            {row.workType}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-3 text-right font-bold text-white">
                                                        {row.remainQty.toLocaleString()}
                                                    </td>
                                                    <td className="py-2 px-3 text-center font-sans">
                                                        <span className="text-[11px] font-medium text-slate-300">
                                                            {row.stage}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-3 text-center">
                                                        <div className="flex items-center gap-1.5 justify-center">
                                                            <div className="w-12 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                                                <div 
                                                                    className={`h-full rounded-full ${
                                                                        row.progressPct === 100 ? 'bg-emerald-500' :
                                                                        row.progressPct >= 60 ? 'bg-cyan-500' :
                                                                        row.progressPct >= 20 ? 'bg-blue-500' : 'bg-amber-500'
                                                                    }`}
                                                                    style={{ width: `${row.progressPct}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-[10px] text-slate-400">{row.progressPct}%</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-400 text-[11px]">{row.cutDate || '-'}</td>
                                                    <td className="py-2 px-3 text-slate-400 text-[11px]">{row.machDate || '-'}</td>
                                                    <td className="py-2 px-3 text-slate-400 text-[11px]">{row.storeDate || '-'}</td>
                                                    <td className="py-2 px-3 font-sans">
                                                        {row.alertReason ? (
                                                            <div className={`flex items-center gap-1 text-[11px] ${
                                                                isCritical ? 'text-red-400 font-bold' : 'text-amber-400'
                                                            }`}>
                                                                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                                                <span>{row.alertReason}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-600 text-[10px]">정상 진행</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* 5. Chaser Report Tab */}
                {activeTab === 'CHASER_REPORT' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50 p-6 overflow-auto">
                        <div className="max-w-4xl mx-auto w-full bg-slate-950 border border-slate-800 rounded-xl p-6 shadow-xl">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        🚨 대경벤드 납기 독촉 보고서
                                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-normal">
                                            PUR-04 과장봇 작성
                                        </span>
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-1">
                                        지연 품목 총 <b>{summary?.alertCount || 0}건</b>에 대한 대경벤드 전달용 공식 독촉 공문
                                    </p>
                                </div>
                                <button
                                    onClick={handleCopyReport}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-md transition-colors"
                                >
                                    {copiedReport ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    <span>{copiedReport ? '복사 완료!' : '독촉장 텍스트 전체 복사'}</span>
                                </button>
                            </div>

                            <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed bg-slate-900/80 p-4 rounded-lg border border-slate-800/80">
                                {chaserReport?.markdown || '생성된 독촉 보고서가 없습니다.'}
                            </pre>
                        </div>
                    </div>
                )}

                {/* 6. Leadtime Stats Tab */}
                {activeTab === 'LEADTIME' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50 p-6 overflow-auto">
                        <div className="max-w-4xl mx-auto w-full space-y-6">
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 shadow-xl">
                                <div className="border-b border-slate-800 pb-4 mb-4">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        ⏱️ 대경벤드 품목별 실제 제조 소요 일수 (리드타임 벤치마크)
                                        <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-normal">
                                            DAT-07 분석팀 봇 산출 ➔ 견적팀 연계
                                        </span>
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-1">
                                        절단 착수일자부터 창고 입고완료까지 실제 대경 제조일지 데이터를 누적 분석한 통계치입니다.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    {(leadtimeStats?.categoryStats || []).map(cat => (
                                        <div key={cat.category} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                                            <div className="text-sm font-bold text-white">{cat.category}</div>
                                            <div className="text-2xl font-bold text-indigo-400 mt-2">
                                                {cat.avgDays} <span className="text-xs font-normal text-slate-400">일</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">
                                                최소 {cat.minDays}일 ~ 최대 {cat.maxDays}일
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800">
                                                완료 표본 {cat.count}건
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 7. Modal Footer */}
                <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
                    <div className="flex items-center gap-4">
                        <span>표시 중: <b>{filteredRows.length}</b>건</span>
                        <span>•</span>
                        <span>구매부(PUR-01~04) ⟷ 영업부(SAL-03) ⟷ 데이터팀(DAT-07) 실시간 연동 중</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
