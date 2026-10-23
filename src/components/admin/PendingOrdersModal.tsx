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
    Flame,
    Calculator,
    ShieldAlert
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
    workType: string; // 검토 / 생산 / 재고 / 수정 / 외주 / 재공품
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
    orderNo: string; // Y열
    deliveryTo: string; // Z열
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

export interface LeadtimeSizeGroupStat {
    category: string;
    sizeGroup: string;
    count: number;
    totalDays: number;
    minDays: number;
    maxDays: number;
    avgDays: number;
}

export interface LeadtimeThicknessStat {
    category: string;
    thickness: string;
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
            excludedCompletedCount?: number;
        };
        groupByOrder: Record<string, {
            orderNo: string;
            deliveryTo?: string;
            customerName: string;
            items: PendingOrderItem[];
        }>;
    };
    leadtimeStats?: {
        lastUpdated: string;
        sampleCount: number;
        newSamplesAdded?: number;
        categoryStats: LeadtimeCategoryStat[];
        sizeGroupStats: LeadtimeSizeGroupStat[];
        thicknessStats: LeadtimeThicknessStat[];
        detailedMatrix?: Array<{
            category: string;
            size: string;
            thickness: string;
            count: number;
            avgDays: number;
            minDays: number;
            maxDays: number;
        }>;
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

    // Leadtime Calculator Simulator state (견적팀 연계)
    const [simCategory, setSimCategory] = useState<string>('90E');
    const [simSize, setSimSize] = useState<string>('200A');
    const [simThk, setSimThk] = useState<string>('S/20S');

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
                const matchDest = item.deliveryTo?.toLowerCase().includes(kw);
                const matchLot = item.lotNo?.toLowerCase().includes(kw);
                const matchName = item.itemName?.toLowerCase().includes(kw);
                const matchCust = item.customerName?.toLowerCase().includes(kw);
                const matchSize = item.size?.toLowerCase().includes(kw);
                const matchMat = item.material?.toLowerCase().includes(kw);
                const matchWork = item.workType?.toLowerCase().includes(kw);
                const matchReason = item.alertReason?.toLowerCase().includes(kw);

                if (!matchOrder && !matchDest && !matchLot && !matchName && !matchCust && !matchSize && !matchMat && !matchWork && !matchReason) {
                    return false;
                }
            }

            return true;
        });
    }, [data, stageFilter, severityFilter, searchKeyword]);

    // Dynamic simulator estimate computation
    const simulatedEstimate = useMemo(() => {
        const stats = data?.leadtimeStats;
        if (!stats) return { avg: 25, min: 14, max: 35, count: 0, level: '기본 추정' };

        // 1. Detailed Matrix
        const matrixMatch = stats.detailedMatrix?.find(m => 
            m.category === simCategory && 
            m.size.includes(simSize) && 
            m.thickness.includes(simThk)
        );
        if (matrixMatch) {
            return { avg: matrixMatch.avgDays, min: matrixMatch.minDays, max: matrixMatch.maxDays, count: matrixMatch.count, level: '정밀 규격 실측 (정확 일치)' };
        }

        // 2. Size Group Match
        const sizeNum = parseInt(simSize.replace(/\D/g, '') || '100', 10);
        let groupLabel = '중경 (65A~150A / 2-1/2"~6")';
        if (sizeNum <= 50) groupLabel = '소경 (50A 이하 / 2" 이하)';
        else if (sizeNum >= 400) groupLabel = '초대경 (400A 이상 / 16" 이상)';
        else if (sizeNum >= 200) groupLabel = '대경 (200A~350A / 8"~14")';

        const sgMatch = stats.sizeGroupStats?.find(s => s.category === simCategory && s.sizeGroup.includes(groupLabel.slice(0, 2)));
        if (sgMatch) {
            return { avg: sgMatch.avgDays, min: sgMatch.minDays, max: sgMatch.maxDays, count: sgMatch.count, level: `사이즈 세그먼트 (${sgMatch.sizeGroup})` };
        }

        // 3. Category Overall
        const catMatch = stats.categoryStats?.find(c => c.category === simCategory);
        if (catMatch) {
            return { avg: catMatch.avgDays, min: catMatch.minDays, max: catMatch.maxDays, count: catMatch.count, level: `품목 카테고리 종합 평균 (${simCategory})` };
        }

        return { avg: 24, min: 14, max: 35, count: stats.sampleCount, level: 'ALTF 전체 평균 벤치마크' };
    }, [data, simCategory, simSize, simThk]);

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
                                <span>분석 기준: {data?.timestamp ? new Date(data.timestamp).toLocaleString('ko-KR') : '확인 중'}</span>
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
                                납기 독촉장 ({chaserReport?.summary?.alertCount || 0})
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
                                제조 리드타임 벤치마크 (누적 {leadtimeStats?.sampleCount || 0}건)
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

                    {/* Urgent Chaser Alerts (Excluding stored items) */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-red-500/30 flex items-center justify-between bg-red-950/20">
                        <div>
                            <div className="text-xs text-red-400 font-medium flex items-center gap-1">
                                <Flame className="w-3 h-3 text-red-400 animate-pulse" />
                                <span>실제 공정 정체·독촉 대상</span>
                            </div>
                            <div className="text-xl font-bold text-red-400 mt-1">
                                {chaserReport?.summary?.alertCount ? chaserReport.summary.alertCount.toLocaleString() : (summary?.alertCount || 0)} <span className="text-xs font-normal text-slate-400">건</span>
                            </div>
                            <div className="text-[11px] text-red-300/80">긴급(절단미착수) {chaserReport?.summary?.criticalCount || 0}건 · 정체 {chaserReport?.summary?.warningCount || 0}건</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
                            <AlertTriangle className="w-4 h-4" />
                        </div>
                    </div>

                    {/* Completed stored (Excluded from chasers) */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-teal-500/30 flex items-center justify-between bg-teal-950/20">
                        <div>
                            <div className="text-xs text-teal-400 font-medium">창고 입고 완료 (독촉 제외)</div>
                            <div className="text-xl font-bold text-teal-400 mt-1">
                                {stageCounts['창고입고완료'] ? stageCounts['창고입고완료'].toLocaleString() : '0'} <span className="text-xs font-normal text-slate-400">건</span>
                            </div>
                            <div className="text-[11px] text-teal-300/80">출고 직전 완료 (독촉 대상 제외)</div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                            <Check className="w-4 h-4" />
                        </div>
                    </div>

                    {/* Avg Leadtime */}
                    <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                        <div>
                            <div className="text-xs text-slate-400 font-medium">누적 제조 평균 리드타임</div>
                            <div className="text-xl font-bold text-indigo-400 mt-1">
                                23.5 <span className="text-xs font-normal text-slate-400">일</span>
                            </div>
                            <div className="text-[11px] text-slate-500">누적 {leadtimeStats?.sampleCount || 0}개 실측 표본</div>
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
                                (L열 검토·생산·재고·수정 판별 ➔ P~X열 절단~입고 실시간 추적)
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
                            { name: '가공완료', count: stageCounts['가공완료'] || 0, color: 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300', pct: '75%' },
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
                                    placeholder="주문번호(Y), 납품처(Z), 품명, 고객사, 규격, 재질 검색..."
                                    value={searchKeyword}
                                    onChange={e => setSearchKeyword(e.target.value)}
                                    className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-colors"
                                />
                            </div>

                            {/* Filter Chips */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">정체/경보 필터:</span>
                                <button
                                    onClick={() => setSeverityFilter('ALL')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    전체 ({data?.rows?.length || 0})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('ALERT_ONLY')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                                        severityFilter === 'ALERT_ONLY' ? 'bg-red-600 text-white' : 'text-red-400 hover:text-red-300'
                                    }`}
                                >
                                    <AlertTriangle className="w-3 h-3" />
                                    정체/독촉 대상 ({chaserReport?.summary?.alertCount || 0})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('CRITICAL')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'CRITICAL' ? 'bg-red-700 text-white' : 'text-red-300 hover:text-white'
                                    }`}
                                >
                                    🚨 긴급 절단누락 ({chaserReport?.summary?.criticalCount || 0})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('WARNING')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'WARNING' ? 'bg-amber-600 text-white' : 'text-amber-300 hover:text-white'
                                    }`}
                                >
                                    ⚠️ 공정 정체 ({chaserReport?.summary?.warningCount || 0})
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
                                        <th className="py-2.5 px-3">납품처 (Z열)</th>
                                        <th className="py-2.5 px-3">품 명</th>
                                        <th className="py-2.5 px-3">규격 / 두께</th>
                                        <th className="py-2.5 px-3">재질</th>
                                        <th className="py-2.5 px-3 text-center">작업 (L열)</th>
                                        <th className="py-2.5 px-3 text-right">수주잔량</th>
                                        <th className="py-2.5 px-3 text-center">공정 단계</th>
                                        <th className="py-2.5 px-3 text-center">진행률</th>
                                        <th className="py-2.5 px-3">절단(P)</th>
                                        <th className="py-2.5 px-3">가공(T)</th>
                                        <th className="py-2.5 px-3">입고(V)</th>
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
                                                    <td className="py-2 px-3 font-sans font-semibold text-amber-300 truncate max-w-[130px]" title={row.deliveryTo || row.customerName}>
                                                        {row.deliveryTo || row.customerName || '-'}
                                                    </td>
                                                    <td className="py-2 px-3 font-bold text-white">{row.itemName}</td>
                                                    <td className="py-2 px-3 text-slate-300">{row.size} ({row.thickness})</td>
                                                    <td className="py-2 px-3 text-slate-400">{row.material}</td>
                                                    <td className="py-2 px-3 text-center font-sans">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                            row.workType.includes('생산') ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                                            row.workType.includes('재고') ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' :
                                                            row.workType.includes('검토') ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                                            row.workType.includes('수정') ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
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
                                                    <td className="py-2 px-3 text-slate-400 text-[11px]">
                                                        {row.storeDate ? (
                                                            <span className="text-teal-400 font-bold">{row.storeDate}</span>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="py-2 px-3 font-sans">
                                                        {row.alertReason ? (
                                                            <div className={`flex items-center gap-1 text-[11px] ${
                                                                isCritical ? 'text-red-400 font-bold' : 'text-amber-400'
                                                            }`}>
                                                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                                                <span>{row.alertReason}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-teal-400/80 text-[10px] flex items-center gap-1 font-mono">
                                                                <Check className="w-3 h-3" /> 정상
                                                            </span>
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

                {/* 5. Chaser Report Tab (Excluding stored items, grouped by 주문번호 + 납품처) */}
                {activeTab === 'CHASER_REPORT' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50 p-6 overflow-auto">
                        <div className="max-w-4xl mx-auto w-full space-y-4">
                            {/* 안내 배너: 창고입고 제외 명시 */}
                            <div className="p-4 rounded-xl bg-teal-950/30 border border-teal-500/30 flex items-start gap-3">
                                <ShieldAlert className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
                                <div className="text-xs">
                                    <div className="font-bold text-teal-300">
                                        창고 입고(V열) 완료 건({stageCounts['창고입고완료'] || 0}건) 독촉 대상 전면 제외 완료
                                    </div>
                                    <div className="text-slate-400 mt-1 leading-relaxed">
                                        대경벤드 제조 공정에서 창고 입고가 완료된 제품은 출고 직전 또는 출고 준비 상태이므로, 독촉 보고서에서 100% 제외되었습니다. 아래 보고서에는 **현재 절단 미착수 또는 공정 중간에 멈춰 있는 순수 지연 품목({chaserReport?.summary?.alertCount || 0}건)**만 주문번호 및 납품처별로 집계되어 있습니다.
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 shadow-xl">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                            🚨 대경벤드 생산 미결 및 긴급 납기 독촉 보고서
                                            <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-normal">
                                                PUR-04 과장봇 작성
                                            </span>
                                        </h3>
                                        <p className="text-xs text-slate-400 mt-1">
                                            공정 정체 품목 총 <b>{chaserReport?.summary?.alertCount || 0}건</b>에 대한 대경벤드 직통 전달용 공식 독촉 공문
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleCopyReport}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
                                    >
                                        {copiedReport ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        <span>{copiedReport ? '복사 완료!' : '독촉장 전문 복사'}</span>
                                    </button>
                                </div>

                                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed bg-slate-900/80 p-4 rounded-lg border border-slate-800/80">
                                    {chaserReport?.markdown || '생성된 독촉 보고서가 없습니다.'}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}

                {/* 6. Leadtime Stats Tab (Cumulative multi-tier by size & thickness + Quotation Estimator) */}
                {activeTab === 'LEADTIME' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50 p-6 overflow-auto">
                        <div className="max-w-5xl mx-auto w-full space-y-6">
                            {/* Simulator Card for Quotation Team */}
                            <div className="bg-gradient-to-r from-indigo-950/60 to-purple-950/60 border border-indigo-500/40 rounded-xl p-5 shadow-xl">
                                <div className="flex items-center justify-between border-b border-indigo-500/30 pb-3 mb-4">
                                    <div className="flex items-center gap-2.5">
                                        <Calculator className="w-5 h-5 text-indigo-400" />
                                        <div>
                                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                                견적팀 실시간 제조 리드타임 산출기
                                                <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-normal">
                                                    DAT-07 ⟷ 견적팀 직결
                                                </span>
                                            </h3>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                품목, 규격, 두께를 선택하면 누적 실측 데이터베이스에서 가장 최적의 제조 소요 일수를 즉시 산출합니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-slate-400">누적 실측 표본</div>
                                        <div className="text-base font-bold text-indigo-300 font-mono">
                                            {leadtimeStats?.sampleCount || 0}건 영구 보관 중
                                        </div>
                                    </div>
                                </div>

                                {/* Simulator Inputs & Output */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-300 mb-1 block">품목 (Category)</label>
                                        <select
                                            value={simCategory}
                                            onChange={e => setSimCategory(e.target.value)}
                                            className="w-full py-2 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-400"
                                        >
                                            <option value="90E">90E (엘보)</option>
                                            <option value="45E">45E (엘보)</option>
                                            <option value="TEE">TEE (티)</option>
                                            <option value="R">REDUCER (레듀샤)</option>
                                            <option value="CAP">CAP (캡)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-300 mb-1 block">규격 (Size)</label>
                                        <select
                                            value={simSize}
                                            onChange={e => setSimSize(e.target.value)}
                                            className="w-full py-2 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-400"
                                        >
                                            <option value="50A">50A (소경 2" 이하)</option>
                                            <option value="100A">100A (중경 4")</option>
                                            <option value="200A">200A (대경 8")</option>
                                            <option value="250A">250A (대경 10")</option>
                                            <option value="350A">350A (대경 14")</option>
                                            <option value="400A">400A (초대경 16")</option>
                                            <option value="500A">500A (초대경 20")</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-semibold text-slate-300 mb-1 block">두께 (Schedule)</label>
                                        <select
                                            value={simThk}
                                            onChange={e => setSimThk(e.target.value)}
                                            className="w-full py-2 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-400"
                                        >
                                            <option value="S/10S">S/10S (SCH10S)</option>
                                            <option value="S/20S">S/20S (SCH20S)</option>
                                            <option value="S/40S">S/40S (SCH40)</option>
                                            <option value="S/80S">S/80S (SCH80)</option>
                                        </select>
                                    </div>

                                    {/* Estimated Result Box */}
                                    <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/50 flex flex-col justify-center">
                                        <div className="text-[10px] text-indigo-300 font-medium flex items-center justify-between">
                                            <span>실측 제조 납기</span>
                                            <span className="text-[9px] text-slate-400">{simulatedEstimate.level}</span>
                                        </div>
                                        <div className="text-xl font-black text-white mt-0.5">
                                            평균 <span className="text-indigo-400">{simulatedEstimate.avg}</span>일
                                            <span className="text-xs font-normal text-slate-400 ml-1.5 font-sans">
                                                ({simulatedEstimate.min}~{simulatedEstimate.max}일)
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-emerald-400 mt-1">
                                            고객 권장 안내: 약 {Math.ceil(simulatedEstimate.avg / 7)}주 ({simulatedEstimate.avg + 2}일 이내)
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 1. 카테고리 종합 통계 */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-xl">
                                <div className="border-b border-slate-800 pb-3 mb-4">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        📊 1. 품목 카테고리별 종합 벤치마크
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        대경벤드 실제 절단 착수일자부터 창고 입고완료까지의 소요 일수 평균입니다.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    {(leadtimeStats?.categoryStats || []).map(cat => (
                                        <div key={cat.category} className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors">
                                            <div className="text-xs text-slate-400 font-semibold">{cat.category}</div>
                                            <div className="text-2xl font-bold text-indigo-400 mt-1 font-mono">
                                                {cat.avgDays} <span className="text-xs font-normal text-slate-400">일</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">
                                                최소 {cat.minDays}일 ~ 최대 {cat.maxDays}일
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800 flex justify-between">
                                                <span>누적 완료 표본</span>
                                                <span className="font-bold text-slate-300">{cat.count}건</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 2. 사이즈 세그먼트별 통계 (SizeGroup) */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-xl">
                                <div className="border-b border-slate-800 pb-3 mb-4">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        📏 2. 사이즈 세그먼트별 세부 리드타임
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        소경(50A 이하)은 성형이 빠른 반면, 대경(200A 이상) 및 초대경(400A 이상)은 열처리/가공 공수 증가로 리드타임이 길어집니다.
                                    </p>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                                                <th className="py-2 px-3">품목</th>
                                                <th className="py-2 px-3">사이즈 세그먼트</th>
                                                <th className="py-2 px-3 text-right">표본 수</th>
                                                <th className="py-2 px-3 text-right">평균 소요 일수</th>
                                                <th className="py-2 px-3 text-right">최소 ~ 최대 소요 일수</th>
                                                <th className="py-2 px-3 text-center">비고</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/60 font-mono">
                                            {(leadtimeStats?.sizeGroupStats || []).map((sg, idx) => (
                                                <tr key={idx} className="hover:bg-slate-900/50">
                                                    <td className="py-2 px-3 font-bold text-white">{sg.category}</td>
                                                    <td className="py-2 px-3 text-slate-300 font-sans">{sg.sizeGroup}</td>
                                                    <td className="py-2 px-3 text-right text-slate-400">{sg.count}건</td>
                                                    <td className="py-2 px-3 text-right font-bold text-indigo-400">{sg.avgDays}일</td>
                                                    <td className="py-2 px-3 text-right text-slate-400">{sg.minDays}일 ~ {sg.maxDays}일</td>
                                                    <td className="py-2 px-3 text-center font-sans text-[11px] text-slate-500">
                                                        {sg.avgDays <= 20 ? '🟢 빠른 공정' : (sg.avgDays <= 30 ? '🟡 표준 공정' : '🔴 장기 소요')}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* 3. 두께(Schedule)별 통계 */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-xl">
                                <div className="border-b border-slate-800 pb-3 mb-4">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        🧱 3. 두께(Schedule)별 세부 리드타임
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        두께가 두꺼운 SCH40/SCH80 규격은 열처리 유지 시간 및 가공 시간 증가로 표준 스케줄보다 제조 기간이 길어집니다.
                                    </p>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                                                <th className="py-2 px-3">품목</th>
                                                <th className="py-2 px-3">두께 (Schedule)</th>
                                                <th className="py-2 px-3 text-right">표본 수</th>
                                                <th className="py-2 px-3 text-right">평균 소요 일수</th>
                                                <th className="py-2 px-3 text-right">최소 ~ 최대 소요 일수</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/60 font-mono">
                                            {(leadtimeStats?.thicknessStats || []).map((th, idx) => (
                                                <tr key={idx} className="hover:bg-slate-900/50">
                                                    <td className="py-2 px-3 font-bold text-white">{th.category}</td>
                                                    <td className="py-2 px-3 text-slate-300 font-semibold">{th.thickness}</td>
                                                    <td className="py-2 px-3 text-right text-slate-400">{th.count}건</td>
                                                    <td className="py-2 px-3 text-right font-bold text-indigo-400">{th.avgDays}일</td>
                                                    <td className="py-2 px-3 text-right text-slate-400">{th.minDays}일 ~ {th.maxDays}일</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
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
                        <span>창고입고 완료: <b>{stageCounts['창고입고완료'] || 0}</b>건 (독촉 대상 제외)</span>
                        <span>•</span>
                        <span>구매부(PUR-01~04) ⟷ 영업부(SAL-03) ⟷ 데이터팀(DAT-07) 실시간 연동 중</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
