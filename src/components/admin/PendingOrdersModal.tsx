import { useState, useEffect, useMemo } from 'react';
import { 
    X, 
    Search, 
    RefreshCw, 
    FolderOpen, 
    AlertTriangle, 
    Clock, 
    Layers, 
    Copy, 
    Check, 
    UploadCloud, 
    TrendingUp, 
    Factory,
    Flame,
    Calculator,
    ShieldAlert,
    Building2,
    Hourglass,
    ChevronDown,
    ChevronUp,
    ArrowUpRight,
    Filter,
    BarChart3,
    FileText,
    CheckCircle2,
    ExternalLink
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
    poDate?: string;
    elapsedDays?: number;
    customerDueDate?: string | null;
    remainingCustomerDays?: number | null;
    remainingProductionDays?: number;
    leadtimeDeficit?: number | null;
    dueDateStatus?: 'NORMAL' | 'OVERDUE' | 'IMPOSSIBLE_DELAY' | 'TIGHT_WARNING' | 'SAFE' | 'COMPLETED';
    isStockOrder: boolean;
    alertReason?: string | null;
    alertSeverity?: 'NORMAL' | 'WARNING' | 'CRITICAL';
    priority?: PendingPriority;
    priorityLabel?: string;
    priorityReason?: string;
    delayDays?: number;
    isActuallyDelayed?: boolean;
    delayBasis?: 'CUSTOMER_DUE' | 'STANDARD_LEADTIME' | 'UNKNOWN' | null;
    expectedSlipDays?: number;
}

// 미결관리팀 확인 순서: P1 필수확인 → P2 지연·임박 독촉 → P3 예상 문제 → P4 모니터링
export type PendingPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'DONE';

export interface ClientDiagnosis {
    clientName: string;
    totalCount: number;
    alertCount: number;
    criticalCount: number;
    warningCount: number;
    unstartedCount: number;
    completedCount: number;
    cutPendingCount?: number;
    stockPendingCount?: number;
    reviewPendingCount?: number;
    overdueCount?: number;
    deficitRiskCount?: number;
    maxElapsedDays: number;
    oldestOrderNo: string;
    oldestPoDate: string;
    oldestItemSummary: string;
    primaryIssue: string;
    sampleItems?: PendingOrderItem[];
}

export interface OrderAnalysis {
    client: string;
    orderNo: string;
    customerDueDate: string | null;
    remainingDays: number | null;
    poDate: string | null;
    elapsedDays: number;
    mainStage: string;
    totalItems: number;
    totalQty: number;
    completedCount: number;
    riskLevel: 'DANGER' | 'WARNING' | 'SAFE' | 'COMPLETED';
    riskLabel: string; // '위험' | '경계' | '안정' | '입고완료'
    riskReason: string;
    actionItem: string;
    priority?: PendingPriority;
    priorityLabel?: string;
    priorityReason?: string;
    mustCheckCount?: number;
    delayChaseCount?: number;
    forecastRiskCount?: number;
    maxDelayDays?: number;
    minProgressPct?: number;
    items?: PendingOrderItem[];
}

export interface PriorityBoard {
    counts: Record<PendingPriority, number>;
    actualDelayedCount: number;
    noDueDateCount: number;
    mustCheckOrders: Array<OrderAnalysis & { mustCheckItems: PendingOrderItem[] }>;
    mustCheckItems: PendingOrderItem[];
    delayChaseItems: PendingOrderItem[];
    forecastRiskItems: PendingOrderItem[];
}

export interface PendingAnalysisSummary {
    totalRows: number;
    matchedCount: number;
    unmatchedCount: number;
    stockOrderCount: number;
    alertCount: number;
    overdueCount?: number;
    deficitRiskCount?: number;
    dueRiskCount?: number;
    excludedNonProductCount?: number;
    totalOrders?: number;
    dangerOrdersCount?: number;
    warningOrdersCount?: number;
    safeOrdersCount?: number;
    completedOrdersCount?: number;
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
    clientDiagnoses?: ClientDiagnosis[];
    orderAnalyses?: OrderAnalysis[];
    longestStagnantItems?: PendingOrderItem[];
    criticalDueRiskItems?: PendingOrderItem[];
    priorityBoard?: PriorityBoard;
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
            totalOrders?: number;
            dangerOrdersCount?: number;
            warningOrdersCount?: number;
            safeOrdersCount?: number;
            completedOrdersCount?: number;
        };
        orderAnalyses?: OrderAnalysis[];
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
    const [severityFilter, setSeverityFilter] = useState<'ALL' | 'ALERT_ONLY' | 'CRITICAL' | 'WARNING' | 'DUE_RISK'>('ALL');
    const [clientFilter, setClientFilter] = useState<string>('ALL');
    const [copiedReport, setCopiedReport] = useState(false);
    const [activeTab, setActiveTab] = useState<'PRIORITY' | 'TABLE' | 'CLIENTS' | 'STAGNANT' | 'CHASER_REPORT' | 'LEADTIME'>('PRIORITY');
    const [stagnantSubTab, setStagnantSubTab] = useState<'DUE_DEFICIT' | 'ELAPSED_DAYS'>('DUE_DEFICIT');
    const [uploading, setUploading] = useState(false);
    const [showExpandedMetrics, setShowExpandedMetrics] = useState(false);

    // Executive Report state (업체명-발주번호-납기-현재공정-위험/경계/안정 매트릭스)
    const [reportSubTab, setReportSubTab] = useState<'MATRIX' | 'MEMO'>('MATRIX');
    const [orderRiskFilter, setOrderRiskFilter] = useState<'ALL' | 'DANGER' | 'WARNING' | 'SAFE' | 'COMPLETED'>('ALL');
    const [orderSearchKeyword, setOrderSearchKeyword] = useState('');
    const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null);
    const [expandedMustCheckOrder, setExpandedMustCheckOrder] = useState<string | null>(null);

    // Client diagnosis search in CLIENTS tab
    const [clientSearch, setClientSearch] = useState('');

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

    // Available unique clients with counts
    const clientOptions = useMemo(() => {
        if (!data?.rows) return [];
        const map = new Map<string, number>();
        data.rows.forEach(r => {
            const client = r.deliveryTo || r.customerName || '자체/미지정';
            map.set(client, (map.get(client) || 0) + 1);
        });
        return Array.from(map.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }, [data]);

    // Filtered rows for TABLE tab
    const filteredRows = useMemo(() => {
        if (!data?.rows) return [];
        return data.rows.filter(item => {
            // Client filter
            if (clientFilter !== 'ALL') {
                const client = item.deliveryTo || item.customerName || '자체/미지정';
                if (client !== clientFilter) return false;
            }

            // Stage filter
            if (stageFilter !== 'ALL' && item.stage !== stageFilter) {
                return false;
            }

            // Severity filter
            if (severityFilter === 'ALERT_ONLY' && !item.alertReason) return false;
            if (severityFilter === 'CRITICAL' && item.alertSeverity !== 'CRITICAL') return false;
            if (severityFilter === 'WARNING' && item.alertSeverity !== 'WARNING') return false;
            if (severityFilter === 'DUE_RISK' && item.dueDateStatus !== 'OVERDUE' && item.dueDateStatus !== 'IMPOSSIBLE_DELAY') return false;

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
    }, [data, clientFilter, stageFilter, severityFilter, searchKeyword]);

    // Filtered Client Diagnoses for CLIENTS tab
    const filteredClients = useMemo(() => {
        if (!data?.clientDiagnoses) return [];
        if (!clientSearch.trim()) return data.clientDiagnoses;
        const kw = clientSearch.toLowerCase();
        return data.clientDiagnoses.filter(c => 
            c.clientName.toLowerCase().includes(kw) || 
            c.primaryIssue.toLowerCase().includes(kw) ||
            c.oldestOrderNo.toLowerCase().includes(kw)
        );
    }, [data?.clientDiagnoses, clientSearch]);

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

    // Order-level analyses memo
    const orderAnalyses: OrderAnalysis[] = useMemo(() => {
        return data?.orderAnalyses || data?.chaserReport?.orderAnalyses || [];
    }, [data]);

    // Filtered Order analyses for Executive Matrix Tab
    const filteredOrderAnalyses = useMemo(() => {
        return orderAnalyses.filter(order => {
            if (orderRiskFilter !== 'ALL' && order.riskLevel !== orderRiskFilter) return false;
            if (orderSearchKeyword.trim()) {
                const kw = orderSearchKeyword.toLowerCase().trim();
                const matchClient = order.client.toLowerCase().includes(kw);
                const matchOrderNo = order.orderNo.toLowerCase().includes(kw);
                const matchReason = order.riskReason.toLowerCase().includes(kw);
                const matchStage = order.mainStage.toLowerCase().includes(kw);
                if (!matchClient && !matchOrderNo && !matchReason && !matchStage) return false;
            }
            return true;
        });
    }, [orderAnalyses, orderRiskFilter, orderSearchKeyword]);

    // Jump to client filter in Table tab (검색어 및 단계 필터 완전 초기화하여 빈 검색 방지)
    const handleSelectClient = (clientName: string) => {
        setClientFilter(clientName);
        setSearchKeyword('');
        setStageFilter('ALL');
        setSeverityFilter('ALL');
        setActiveTab('TABLE');
    };

    // Jump to order filter in Table tab
    const handleSelectOrder = (orderNo: string) => {
        setClientFilter('ALL');
        setSearchKeyword(orderNo);
        setStageFilter('ALL');
        setSeverityFilter('ALL');
        setActiveTab('TABLE');
    };

    if (!isOpen) return null;

    const summary = data?.summary;
    const stageCounts = data?.stageCounts || {};
    const chaserReport = data?.chaserReport;
    const leadtimeStats = data?.leadtimeStats;
    const clientDiagnoses = data?.clientDiagnoses || [];
    const longestStagnantItems = data?.longestStagnantItems || [];
    const criticalDueRiskItems = data?.criticalDueRiskItems || [];
    const priorityBoard = data?.priorityBoard;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
            <div className="relative w-full max-w-[98vw] h-[95vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
                
                {/* 1. Ultra-Compact Modal Header & Navigation */}
                <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800 bg-slate-950/90 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/20 shrink-0">
                            <Factory className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                                    대경벤드 생산 미결 & 공정 관제
                                </h2>
                                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    PUR-01~04
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate max-w-[420px]" title={data?.filename}>
                                원장: <span className="text-slate-300 font-mono">{data?.filename || '알트에프 미결 리스트.xlsx'}</span>
                            </p>
                        </div>
                    </div>

                    {/* Navigation Tabs (Streamlined) */}
                    <div className="flex items-center bg-slate-800/90 rounded-xl p-1 border border-slate-700/80 shadow-inner">
                        <button
                            onClick={() => setActiveTab('PRIORITY')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                activeTab === 'PRIORITY'
                                    ? 'bg-red-600 text-white shadow-md'
                                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                            }`}
                        >
                            <ShieldAlert className="w-3.5 h-3.5 text-red-200" />
                            <span>확인 순서</span>
                            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-red-950/70 text-red-200 border border-red-400/30 font-bold">
                                필수 {priorityBoard?.counts.P1 ?? 0}
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab('TABLE')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                activeTab === 'TABLE' 
                                    ? 'bg-amber-600 text-white shadow-md' 
                                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                            }`}
                        >
                            <Layers className="w-3.5 h-3.5" />
                            <span>제품 공정 대장</span>
                            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 text-amber-200">
                                {data?.rows?.length || 0}
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab('CLIENTS')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                activeTab === 'CLIENTS' 
                                    ? 'bg-blue-600 text-white shadow-md' 
                                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                            }`}
                        >
                            <Building2 className="w-3.5 h-3.5 text-blue-300" />
                            <span>거래처별 병목 진단</span>
                            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-950/60 text-blue-200 border border-blue-400/30 font-bold">
                                {clientDiagnoses.length}개사
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab('STAGNANT')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                activeTab === 'STAGNANT' 
                                    ? 'bg-rose-600 text-white shadow-md' 
                                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                            }`}
                        >
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-300 animate-pulse" />
                            <span>납기 위험 & 정체 진단</span>
                            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-950/60 text-rose-200 border border-rose-400/30 font-bold">
                                {criticalDueRiskItems.length > 0 ? `${criticalDueRiskItems.length}건 위험` : `${longestStagnantItems.length}건`}
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab('CHASER_REPORT')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                activeTab === 'CHASER_REPORT' 
                                    ? 'bg-gradient-to-r from-red-600 to-amber-600 text-white shadow-md' 
                                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                            }`}
                        >
                            <BarChart3 className="w-3.5 h-3.5 text-amber-300" />
                            <span>납기 정밀 분석 보고서</span>
                            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-red-950/80 text-amber-200 font-bold border border-red-500/40">
                                {orderAnalyses.length}개 발주
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab('LEADTIME')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                activeTab === 'LEADTIME' 
                                    ? 'bg-indigo-600 text-white shadow-md' 
                                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                            }`}
                        >
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span>리드타임</span>
                        </button>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                        {/* File Upload Button */}
                        <label className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 cursor-pointer transition-colors">
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
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
                            title="storage/pending_lists 보관함 열기"
                        >
                            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                            <span>보관함</span>
                        </button>

                        {/* Sync button */}
                        <button
                            onClick={handleSync}
                            disabled={loading}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 border border-amber-500/30 transition-colors"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            <span>재분석</span>
                        </button>

                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-1"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 2. Slim KPI Strip (Takes only 38px instead of 300px!) */}
                <div className="px-5 py-2 bg-slate-950/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
                    <div className="flex items-center gap-4 divide-x divide-slate-800">
                        <div className="flex items-center gap-2">
                            <span className="text-slate-400">대경 미결 총:</span>
                            <span className="font-bold text-white font-mono text-sm">{summary?.totalRows || 0}</span>
                            <span className="text-slate-500 text-[11px]">건</span>
                        </div>
                        <div className="pl-4 flex items-center gap-2">
                            <span className="text-slate-400">우리 발주(PO) 매칭:</span>
                            <span className="font-bold text-emerald-400 font-mono text-sm">{summary?.matchedCount || 0}</span>
                            <span className="text-slate-500 text-[11px]">건</span>
                        </div>
                        <div className="pl-4 flex items-center gap-2">
                            <span className="text-red-400 font-semibold flex items-center gap-1">
                                <Flame className="w-3 h-3 text-red-400" />
                                <span>정체·독촉 대상:</span>
                            </span>
                            <span className="font-extrabold text-red-400 font-mono text-sm">{chaserReport?.summary?.alertCount || 0}</span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-red-950/80 text-red-300 border border-red-500/30 font-bold">
                                긴급(절단미착수) {chaserReport?.summary?.criticalCount || 0}건
                            </span>
                        </div>
                        <div className="pl-4 flex items-center gap-2">
                            <span className="text-teal-400">창고 입고 완료:</span>
                            <span className="font-bold text-teal-300 font-mono text-sm">{stageCounts['창고입고완료'] || 0}</span>
                            <span className="text-slate-500 text-[11px]">(독촉 전면 제외)</span>
                        </div>
                        <div className="pl-4 flex items-center gap-2">
                            <span className="text-slate-400">평균 리드타임:</span>
                            <span className="font-bold text-indigo-400 font-mono text-sm">23.5</span>
                            <span className="text-slate-500 text-[11px]">일 (누적 57건 실측)</span>
                        </div>
                        {summary?.excludedNonProductCount ? (
                            <div className="pl-4 hidden lg:flex items-center gap-1.5 text-slate-400">
                                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 font-sans">
                                    비제품(네고·시편비 등 {summary.excludedNonProductCount}건) 자동 제외
                                </span>
                            </div>
                        ) : null}
                    </div>

                    {/* Expand/Collapse Detailed Funnel & Metrics Toggle */}
                    <button
                        onClick={() => setShowExpandedMetrics(!showExpandedMetrics)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 transition-colors"
                    >
                        <span>9단계 공정 퍼널 / 상세 지표</span>
                        {showExpandedMetrics ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                </div>

                {/* Collapsible Expanded Funnel Banner (Hidden by default to give MAX space to table) */}
                {showExpandedMetrics && (
                    <div className="px-5 py-3 bg-slate-950/90 border-b border-slate-800 shrink-0 animate-in slide-in-from-top-2 duration-150">
                        <div className="text-[11px] font-semibold text-slate-400 mb-2 flex items-center justify-between">
                            <span>🏭 9단계 제조 공정 진행 현황 퍼널 (클릭 시 해당 공정으로 즉시 필터)</span>
                            <span className="text-[10px] text-slate-500">L열 검토·생산 판별 ➔ P~X열 실시간 추적</span>
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
                                    onClick={() => {
                                        setStageFilter(stageFilter === st.name ? 'ALL' : st.name);
                                        setActiveTab('TABLE');
                                    }}
                                    className={`p-1.5 rounded-lg border transition-all text-left ${st.color} ${
                                        stageFilter === st.name ? 'ring-2 ring-amber-400 scale-[1.02]' : 'hover:border-slate-500'
                                    }`}
                                >
                                    <div className="text-[9px] text-slate-400 flex items-center justify-between">
                                        <span>Step {i + 1}</span>
                                        <span>{st.pct}</span>
                                    </div>
                                    <div className="font-semibold truncate text-[11px] mt-0.5">{st.name}</div>
                                    <div className="text-sm font-bold mt-0.5 font-mono">{st.count}건</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* TAB 0: 미결관리팀 확인 순서 (① 실지연 판정 → ② P1 필수확인 → ③ P2 독촉 → ④ P3 예상 문제) */}
                {activeTab === 'PRIORITY' && (
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900/60">
                        {!priorityBoard ? (
                            <div className="p-6 text-center text-sm text-slate-400 border border-slate-800 rounded-xl">
                                우선순위 판정 데이터가 없습니다. 미결 엑셀을 다시 업로드하거나 새로고침(재분석)해 주세요.
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                    {[
                                        { step: '①', label: '실지연 판정', count: priorityBoard.actualDelayedCount, desc: '잔량 有 · 창고입고 前 · 납기 경과', cls: 'border-slate-600 text-slate-200' },
                                        { step: '②', label: 'P1 필수확인', count: priorityBoard.counts.P1, desc: '지연/임박 + 공정진행률 50% 미만', cls: 'border-red-500/60 text-red-300 bg-red-950/30' },
                                        { step: '③', label: 'P2 지연·임박 독촉', count: priorityBoard.counts.P2, desc: '공정 후반 · 재고 배정 → 출고 독촉', cls: 'border-orange-500/50 text-orange-300' },
                                        { step: '④', label: 'P3 예상 문제', count: priorityBoard.counts.P3, desc: '잔여 공정일수 > 남은 납기 → 사전 예방', cls: 'border-yellow-500/50 text-yellow-300' },
                                        { step: '⑤', label: 'P4 모니터링', count: priorityBoard.counts.P4, desc: '정상 진행 · 정기 감시', cls: 'border-emerald-600/40 text-emerald-300' }
                                    ].map(card => (
                                        <div key={card.step} className={`rounded-xl border p-3 ${card.cls}`}>
                                            <div className="text-[11px] font-semibold opacity-80">{card.step} {card.label}</div>
                                            <div className="text-2xl font-bold font-mono mt-1">{card.count}<span className="text-xs font-normal ml-1 opacity-70">건</span></div>
                                            <div className="text-[10px] text-slate-400 mt-1">{card.desc}</div>
                                        </div>
                                    ))}
                                </div>
                                {priorityBoard.noDueDateCount > 0 && (
                                    <p className="text-[11px] text-slate-500">※ 고객납기 미등록 {priorityBoard.noDueDateCount}건은 발주일 경과일 vs 품목 표준 리드타임으로 지연 여부를 추정했습니다.</p>
                                )}

                                <section className="rounded-xl border border-red-500/40 bg-slate-950/40">
                                    <header className="px-3 py-2 border-b border-red-500/30 text-sm font-bold text-red-300">
                                        🔴 반드시 확인 — 대경 공장 확인 요청 발주 ({priorityBoard.mustCheckOrders.length}건 / 품목 {priorityBoard.counts.P1}건)
                                    </header>
                                    {priorityBoard.mustCheckOrders.length === 0 ? (
                                        <div className="p-4 text-xs text-slate-400">필수확인 대상 없음</div>
                                    ) : priorityBoard.mustCheckOrders.map((o, idx) => {
                                        const key = `${o.client}__${o.orderNo}`;
                                        const open = expandedMustCheckOrder === key;
                                        const top = o.mustCheckItems[0];
                                        return (
                                            <div key={key} className="border-b border-slate-800 last:border-0">
                                                <button
                                                    onClick={() => setExpandedMustCheckOrder(open ? null : key)}
                                                    className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-slate-800/50"
                                                >
                                                    <span className="w-5 text-slate-500 font-mono">{idx + 1}</span>
                                                    <span className="font-bold text-white min-w-[120px]">{o.client}</span>
                                                    <span className="font-mono text-amber-300">{o.orderNo}</span>
                                                    <span className="text-red-300 font-semibold">{top.delayDays ? `${top.delayDays}일 지연` : `D-${top.remainingCustomerDays}`}</span>
                                                    <span className="text-slate-300">최저 진행률 <b className="text-red-300">{o.minProgressPct}%</b></span>
                                                    <span className="text-slate-400">필수확인 {o.mustCheckCount}건 / 전체 {o.totalItems}품목</span>
                                                    <span className="ml-auto text-slate-500">{open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
                                                </button>
                                                {open && (
                                                    <table className="w-full text-[11px] mb-2">
                                                        <thead className="text-slate-500">
                                                            <tr>
                                                                <th className="text-left px-3 py-1 font-medium">LOT</th>
                                                                <th className="text-left px-2 py-1 font-medium">품명 / 규격</th>
                                                                <th className="text-left px-2 py-1 font-medium">고객납기</th>
                                                                <th className="text-left px-2 py-1 font-medium">현재 공정</th>
                                                                <th className="text-right px-2 py-1 font-medium">잔량</th>
                                                                <th className="text-left px-2 py-1 font-medium">확인 사유</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {o.mustCheckItems.map(it => (
                                                                <tr key={`${it.lotNo}-${it.rowIdx}`} className="text-slate-300 border-t border-slate-800/60">
                                                                    <td className="px-3 py-1 font-mono">{it.lotNo}</td>
                                                                    <td className="px-2 py-1">{it.itemName} {it.size} ({it.thickness})</td>
                                                                    <td className="px-2 py-1">{it.customerDueDate || '미등록'}</td>
                                                                    <td className="px-2 py-1">{it.stage} <b className="text-red-300">{it.progressPct}%</b></td>
                                                                    <td className="px-2 py-1 text-right">{it.remainQty}</td>
                                                                    <td className="px-2 py-1 text-slate-400">{it.priorityReason}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        );
                                    })}
                                </section>

                                <section className="rounded-xl border border-yellow-500/30 bg-slate-950/40">
                                    <header className="px-3 py-2 border-b border-yellow-500/20 text-sm font-bold text-yellow-300">
                                        🟡 예상 문제 지점 — 사전 예방 ({priorityBoard.counts.P3}건)
                                    </header>
                                    {priorityBoard.forecastRiskItems.length === 0 ? (
                                        <div className="p-4 text-xs text-slate-400">현재 공정일수 기준 예상 문제 없음</div>
                                    ) : (
                                        <table className="w-full text-[11px]">
                                            <thead className="text-slate-500">
                                                <tr>
                                                    <th className="text-left px-3 py-1.5 font-medium">납품처</th>
                                                    <th className="text-left px-2 py-1.5 font-medium">발주번호</th>
                                                    <th className="text-left px-2 py-1.5 font-medium">품명 / 규격</th>
                                                    <th className="text-left px-2 py-1.5 font-medium">고객납기</th>
                                                    <th className="text-left px-2 py-1.5 font-medium">현재 공정</th>
                                                    <th className="text-right px-2 py-1.5 font-medium">잔여 공정</th>
                                                    <th className="text-right px-3 py-1.5 font-medium">예상 지연</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {priorityBoard.forecastRiskItems.map(it => (
                                                    <tr key={`${it.lotNo}-${it.rowIdx}`} className="text-slate-300 border-t border-slate-800/60">
                                                        <td className="px-3 py-1">{it.deliveryTo || it.customerName}</td>
                                                        <td className="px-2 py-1 font-mono text-amber-300">{it.orderNo}</td>
                                                        <td className="px-2 py-1">{it.itemName} {it.size} ({it.thickness})</td>
                                                        <td className="px-2 py-1">{it.customerDueDate ? `${it.customerDueDate} (D-${it.remainingCustomerDays})` : '미등록'}</td>
                                                        <td className="px-2 py-1">{it.stage} {it.progressPct}%</td>
                                                        <td className="px-2 py-1 text-right">{it.remainingProductionDays}일</td>
                                                        <td className="px-3 py-1 text-right font-bold text-yellow-300">{it.expectedSlipDays}일</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </section>
                            </>
                        )}
                    </div>
                )}

                {/* 3. TAB 1: 제품 공정 대장 (Expanded Full-Screen Ledger View) */}
                {activeTab === 'TABLE' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/60 overflow-hidden">
                        {/* Compact Search & Multi-Filter Bar */}
                        <div className="p-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 bg-slate-950/40 shrink-0">
                            {/* Left: Client filter select & Keyword search */}
                            <div className="flex items-center gap-2 flex-1 max-w-2xl">
                                {/* 거래처 선택 드롭다운 */}
                                <div className="relative min-w-[180px]">
                                    <select
                                        value={clientFilter}
                                        onChange={e => setClientFilter(e.target.value)}
                                        className="w-full py-1.5 pl-3 pr-8 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300 focus:outline-none focus:border-amber-500 transition-colors cursor-pointer"
                                    >
                                        <option value="ALL">🏢 전체 거래처 ({data?.rows?.length || 0}건)</option>
                                        {clientOptions.map(c => (
                                            <option key={c.name} value={c.name}>
                                                {c.name} ({c.count}건)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* 검색어 인풋 */}
                                <div className="relative flex-1">
                                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="주문번호(Y), 품명, 규격, 재질, 작업구분 검색..."
                                        value={searchKeyword}
                                        onChange={e => setSearchKeyword(e.target.value)}
                                        className="w-full pl-8 pr-4 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-colors"
                                    />
                                    {searchKeyword && (
                                        <button 
                                            onClick={() => setSearchKeyword('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Right: Stage & Severity Filter Buttons */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {/* 공정 단계 필터 */}
                                {stageFilter !== 'ALL' && (
                                    <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                        공정: {stageFilter}
                                        <button onClick={() => setStageFilter('ALL')} className="hover:text-white">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                )}

                                {clientFilter !== 'ALL' && (
                                    <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1 font-semibold">
                                        거래처: {clientFilter}
                                        <button onClick={() => setClientFilter('ALL')} className="hover:text-white">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                )}

                                <div className="h-4 w-px bg-slate-700 mx-1" />

                                <button
                                    onClick={() => setSeverityFilter('ALL')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'ALL' ? 'bg-slate-700 text-white font-bold' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    전체
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('ALERT_ONLY')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                                        severityFilter === 'ALERT_ONLY' ? 'bg-red-600 text-white font-bold' : 'text-red-400 hover:text-red-300'
                                    }`}
                                >
                                    <AlertTriangle className="w-3 h-3" />
                                    정체·독촉 대상
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('CRITICAL')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'CRITICAL' ? 'bg-red-700 text-white font-bold' : 'text-red-300 hover:text-white'
                                    }`}
                                >
                                    🚨 긴급 절단미착수
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('WARNING')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                                        severityFilter === 'WARNING' ? 'bg-amber-600 text-white font-bold' : 'text-amber-300 hover:text-white'
                                    }`}
                                >
                                    ⚠️ 공정 정체
                                </button>
                                <button
                                    onClick={() => setSeverityFilter('DUE_RISK')}
                                    className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                                        severityFilter === 'DUE_RISK' ? 'bg-rose-600 text-white font-bold' : 'text-rose-400 hover:text-white'
                                    }`}
                                >
                                    <AlertTriangle className="w-3 h-3 text-rose-300" />
                                    🚨 납기 위험
                                    {(summary?.dueRiskCount || 0) > 0 && (
                                        <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-950 text-rose-200">
                                            {summary?.dueRiskCount}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Large, High-Visibility Product Ledger Table */}
                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead className="sticky top-0 bg-slate-950 text-slate-300 border-b border-slate-800 z-10 shadow-sm font-semibold">
                                    <tr>
                                        <th className="py-2.5 px-3 w-12 text-center text-slate-400">#</th>
                                        <th className="py-2.5 px-3 min-w-[125px]">발주일 / 경과일</th>
                                        <th className="py-2.5 px-3 min-w-[125px]">납품처 (Z열)</th>
                                        <th className="py-2.5 px-3 min-w-[115px]">주문번호 (Y열)</th>
                                        <th className="py-2.5 px-3 min-w-[145px] text-amber-300">고객납기 / 제작마진</th>
                                        <th className="py-2.5 px-3 min-w-[90px]">품 명</th>
                                        <th className="py-2.5 px-3 min-w-[120px]">규격 / 두께</th>
                                        <th className="py-2.5 px-3 min-w-[90px]">재질</th>
                                        <th className="py-2.5 px-3 text-center min-w-[70px]">작업 (L)</th>
                                        <th className="py-2.5 px-3 text-right min-w-[70px]">수주잔량</th>
                                        <th className="py-2.5 px-3 text-center min-w-[100px]">공정 단계</th>
                                        <th className="py-2.5 px-3 text-center min-w-[90px]">진행률</th>
                                        <th className="py-2.5 px-3 min-w-[80px]">절단일</th>
                                        <th className="py-2.5 px-3 min-w-[80px]">입고일</th>
                                        <th className="py-2.5 px-3 min-w-50">병목 진단 / 납기 독촉 사유</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60 font-mono">
                                    {filteredRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={15} className="py-16 text-center text-slate-400 font-sans">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <Filter className="w-8 h-8 text-slate-600" />
                                                    <p className="text-sm">조건에 일치하는 미결 제품이 없습니다.</p>
                                                    <button 
                                                        onClick={() => { setClientFilter('ALL'); setStageFilter('ALL'); setSeverityFilter('ALL'); setSearchKeyword(''); }}
                                                        className="text-xs text-amber-400 hover:underline mt-1"
                                                    >
                                                        모든 필터 초기화
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredRows.map((row, idx) => {
                                            const isAlert = !!row.alertReason;
                                            const isCritical = row.alertSeverity === 'CRITICAL';
                                            const clientName = row.deliveryTo || row.customerName || '자체/미지정';
                                            const elapsed = row.elapsedDays || 0;

                                            return (
                                                <tr 
                                                    key={row.rowIdx}
                                                    className={`hover:bg-slate-800/60 transition-colors ${
                                                        isCritical ? 'bg-red-950/25' : (isAlert ? 'bg-amber-950/15' : (idx % 2 === 1 ? 'bg-slate-950/20' : ''))
                                                    }`}
                                                >
                                                    {/* Row idx */}
                                                    <td className="py-2 px-3 text-center text-slate-500 text-[11px]">{row.rowIdx}</td>

                                                    {/* 발주일 / 경과일 */}
                                                    <td className="py-2 px-3">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs text-slate-300 font-semibold">{row.poDate || '-'}</span>
                                                            {elapsed > 0 && !row.isCompleted ? (
                                                                <span className={`text-[10px] font-bold mt-0.5 inline-flex items-center gap-1 ${
                                                                    elapsed >= 100 ? 'text-red-400' :
                                                                    elapsed >= 30 ? 'text-amber-400' : 'text-slate-400'
                                                                }`}>
                                                                    <Clock className="w-2.5 h-2.5" />
                                                                    D+{elapsed}일째 {row.progressPct <= 5 ? '멈춤' : '진행'}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] text-slate-500 font-sans">
                                                                    {row.isCompleted ? '입고 완료' : '-'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {/* 납품처 (Z열) */}
                                                    <td className="py-2 px-3 font-sans font-bold text-amber-300">
                                                        <button 
                                                            onClick={() => setClientFilter(clientName)}
                                                            className="hover:underline text-left truncate max-w-[140px] block"
                                                            title={`이 거래처(${clientName})만 모아보기`}
                                                        >
                                                            {clientName}
                                                        </button>
                                                    </td>

                                                    {/* 주문번호 (Y열) */}
                                                    <td className="py-2 px-3">
                                                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                                            row.matched 
                                                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                                                : 'bg-slate-800 text-slate-400'
                                                        }`}>
                                                            {row.orderNo || '-'}
                                                        </span>
                                                    </td>

                                                    {/* 고객납기 / 제작마진 */}
                                                    <td className="py-2 px-3">
                                                        {row.customerDueDate ? (
                                                            <div className="flex flex-col">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-xs text-slate-200 font-semibold">{row.customerDueDate}</span>
                                                                    {typeof row.remainingCustomerDays === 'number' && (
                                                                        <span className={`text-[10px] font-bold ${
                                                                            row.remainingCustomerDays < 0 ? 'text-rose-400' :
                                                                            row.remainingCustomerDays <= 7 ? 'text-amber-400' : 'text-emerald-400'
                                                                        }`}>
                                                                            ({row.remainingCustomerDays < 0 ? `+${Math.abs(row.remainingCustomerDays)}일 초과` : `D-${row.remainingCustomerDays}일`})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {!row.isCompleted && (
                                                                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                                        {row.dueDateStatus === 'OVERDUE' && (
                                                                            <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                                                                🚨 납기초과
                                                                            </span>
                                                                        )}
                                                                        {row.dueDateStatus === 'IMPOSSIBLE_DELAY' && (
                                                                            <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-red-600/30 text-red-200 border border-red-500/50" title={`고객잔여 ${row.remainingCustomerDays}일 vs 필요제작 ${row.remainingProductionDays}일`}>
                                                                                🚨 {Math.abs(row.leadtimeDeficit || 0)}일 펑크위험
                                                                            </span>
                                                                        )}
                                                                        {row.dueDateStatus === 'TIGHT_WARNING' && (
                                                                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                                                                ⚠️ 납기촉박
                                                                            </span>
                                                                        )}
                                                                        {row.dueDateStatus === 'SAFE' && (
                                                                            <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400">
                                                                                ✅ 안전
                                                                            </span>
                                                                        )}
                                                                        <span className="text-[10px] text-slate-400 font-sans">
                                                                            (잔여제작 {row.remainingProductionDays}일)
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-500 text-[11px]">-</span>
                                                        )}
                                                    </td>

                                                    {/* 품 명 */}
                                                    <td className="py-2 px-3 font-extrabold text-white text-xs">{row.itemName}</td>

                                                    {/* 규격 / 두께 */}
                                                    <td className="py-2 px-3 text-slate-200 font-semibold">
                                                        {row.size} <span className="text-slate-400 font-normal">({row.thickness})</span>
                                                    </td>

                                                    {/* 재질 */}
                                                    <td className="py-2 px-3 text-slate-300 text-[11px]">{row.material}</td>

                                                    {/* 작업 (L열) */}
                                                    <td className="py-2 px-3 text-center font-sans">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                            row.workType.includes('생산') ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                                            row.workType.includes('재고') ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' :
                                                            row.workType.includes('검토') ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                                                            row.workType.includes('수정') ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' :
                                                            'bg-slate-800 text-slate-400'
                                                        }`}>
                                                            {row.workType}
                                                        </span>
                                                    </td>

                                                    {/* 수주 잔량 */}
                                                    <td className="py-2 px-3 text-right font-extrabold text-white">
                                                        {row.remainQty.toLocaleString()}
                                                    </td>

                                                    {/* 공정 단계 */}
                                                    <td className="py-2 px-3 text-center font-sans">
                                                        <span className="text-[11px] font-semibold text-slate-300">
                                                            {row.stage}
                                                        </span>
                                                    </td>

                                                    {/* 진행률 */}
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
                                                            <span className="text-[10px] text-slate-400 font-bold">{row.progressPct}%</span>
                                                        </div>
                                                    </td>

                                                    {/* 절단일 */}
                                                    <td className="py-2 px-3 text-slate-400 text-[11px]">{row.cutDate || '-'}</td>

                                                    {/* 입고일 */}
                                                    <td className="py-2 px-3 text-slate-400 text-[11px]">
                                                        {row.storeDate ? (
                                                            <span className="text-teal-400 font-bold">{row.storeDate}</span>
                                                        ) : '-'}
                                                    </td>

                                                    {/* 병목 사유 / 경보 */}
                                                    <td className="py-2 px-3 font-sans">
                                                        {row.alertReason ? (
                                                            <div className={`flex items-center gap-1.5 text-[11px] ${
                                                                isCritical ? 'text-red-400 font-bold' : 'text-amber-400'
                                                            }`}>
                                                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                                                <span>{row.alertReason}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-teal-400/80 text-[10px] flex items-center gap-1 font-mono">
                                                                <Check className="w-3 h-3" /> 정상 완료
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

                {/* 4. TAB 2: 거래처별 병목 진단 (CLIENTS - "우리 거래처별로 뭔가가장문제인지") */}
                {activeTab === 'CLIENTS' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/60 p-4 md:p-6 overflow-auto">
                        <div className="max-w-6xl mx-auto w-full space-y-4">
                            {/* Header description & Search */}
                            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/80 border border-slate-800 p-4 rounded-xl">
                                <div>
                                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                                        <Building2 className="w-5 h-5 text-blue-400" />
                                        거래처(납품처)별 공정 병목 진단 대시보드
                                        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-300 font-mono">
                                            총 {clientDiagnoses.length}개 고객사
                                        </span>
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-1">
                                        고객사별로 대경벤드에서 어떤 공정이 멈춰있는지, 무엇이 가장 심각한 문제인지 한눈에 진단합니다.
                                    </p>
                                </div>

                                <div className="relative w-72">
                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="거래처명 검색 (예: 한화, 부산밸브, 경남...)"
                                        value={clientSearch}
                                        onChange={e => setClientSearch(e.target.value)}
                                        className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>

                            {/* Client Cards Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                {filteredClients.map((client, idx) => {
                                    const hasCritical = client.criticalCount > 0;
                                    const hasAlert = client.alertCount > 0;
                                    const isAllDone = client.completedCount === client.totalCount;

                                    return (
                                        <div 
                                            key={client.clientName}
                                            className={`rounded-xl border p-4 transition-all flex flex-col justify-between ${
                                                hasCritical 
                                                    ? 'bg-red-950/20 border-red-500/40 hover:border-red-400 shadow-lg shadow-red-950/10' 
                                                    : hasAlert 
                                                    ? 'bg-slate-950/70 border-slate-800 hover:border-amber-500/50' 
                                                    : (isAllDone ? 'bg-teal-950/15 border-teal-500/30' : 'bg-slate-950/50 border-slate-800')
                                            }`}
                                        >
                                            <div>
                                                {/* Top row: Client name & rank */}
                                                <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] text-slate-500 font-mono">
                                                                #{idx + 1} 순위 거래처
                                                            </span>
                                                            {(client.overdueCount || 0) > 0 || (client.deficitRiskCount || 0) > 0 ? (
                                                                <span className="px-1.5 py-0.2 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                                                    🚨 위험
                                                                </span>
                                                            ) : client.warningCount > 0 || (client.cutPendingCount || 0) > 0 ? (
                                                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                                                    ⚠️ 경계
                                                                </span>
                                                            ) : isAllDone ? (
                                                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">
                                                                    🏁 입고완료
                                                                </span>
                                                            ) : (
                                                                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                                                    ✅ 안정
                                                                </span>
                                                            )}
                                                        </div>
                                                        <h4 className="text-base font-extrabold text-white mt-0.5 truncate max-w-[200px]" title={client.clientName}>
                                                            {client.clientName}
                                                        </h4>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-xs text-slate-400 font-medium">총 미결</div>
                                                        <div className="text-lg font-black text-amber-400 font-mono">
                                                            {client.totalCount} <span className="text-xs font-normal text-slate-400">건</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Status badges */}
                                                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                                                    {(client.overdueCount || 0) > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/25 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse">
                                                            <AlertTriangle className="w-3 h-3 text-rose-400" />
                                                            납기초과 {client.overdueCount}건
                                                        </span>
                                                    )}
                                                    {(client.deficitRiskCount || 0) > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-600/30 text-red-200 border border-red-500/50 flex items-center gap-1">
                                                            <Flame className="w-3 h-3 text-red-400" />
                                                            제작지연 펑크위험 {client.deficitRiskCount}건
                                                        </span>
                                                    )}
                                                    {(client.cutPendingCount || 0) > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1">
                                                            <Flame className="w-3 h-3 text-red-400" />
                                                            절단미착수 {client.cutPendingCount}건
                                                        </span>
                                                    )}
                                                    {(client.stockPendingCount || 0) > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 flex items-center gap-1">
                                                            <Layers className="w-3 h-3 text-teal-400" />
                                                            재고출고대기 {client.stockPendingCount}건
                                                        </span>
                                                    )}
                                                    {(client.reviewPendingCount || 0) > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                                            검토대기 {client.reviewPendingCount}건
                                                        </span>
                                                    )}
                                                    {client.warningCount > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                                            정체 {client.warningCount}건
                                                        </span>
                                                    )}
                                                    {client.unstartedCount > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                                                            미착수 0% {client.unstartedCount}건
                                                        </span>
                                                    )}
                                                    {client.completedCount > 0 && (
                                                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
                                                            입고완료 {client.completedCount}건
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Primary Issue Highlight */}
                                                <div className={`mt-3 p-2.5 rounded-lg border text-xs leading-snug ${
                                                    hasCritical 
                                                        ? 'bg-red-950/40 border-red-500/30 text-red-200' 
                                                        : hasAlert 
                                                        ? 'bg-amber-950/30 border-amber-500/30 text-amber-200' 
                                                        : 'bg-slate-900 border-slate-800 text-slate-300'
                                                }`}>
                                                    <div className="text-[10px] text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        가장 시급한 문제:
                                                    </div>
                                                    <div className="font-bold">{client.primaryIssue}</div>
                                                </div>

                                                {/* Oldest order info */}
                                                {client.maxElapsedDays > 0 && (
                                                    <div className="mt-2.5 text-[11px] text-slate-400 font-mono space-y-0.5">
                                                        <div className="flex items-center justify-between">
                                                            <span>최장 정체:</span>
                                                            <span className="font-bold text-rose-400">
                                                                발주 후 {client.maxElapsedDays}일 경과
                                                            </span>
                                                        </div>
                                                        {client.oldestOrderNo && (
                                                            <div className="flex items-center justify-between truncate text-slate-400">
                                                                <span>발주번호:</span>
                                                                <span className="text-slate-300">{client.oldestOrderNo}</span>
                                                            </div>
                                                        )}
                                                        {client.oldestItemSummary && (
                                                            <div className="text-slate-500 truncate text-[10px] mt-0.5" title={client.oldestItemSummary}>
                                                                품목: {client.oldestItemSummary}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Action button */}
                                            <button
                                                onClick={() => handleSelectClient(client.clientName)}
                                                className="mt-4 w-full py-1.5 rounded-lg bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-700 hover:border-amber-500"
                                            >
                                                <span>이 거래처 품목 모아보기 ({client.totalCount}건)</span>
                                                <ArrowUpRight className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* 5. TAB 3: 고객 납기 지연 예측 & 최장 미착수 정체 진단 */}
                {activeTab === 'STAGNANT' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/60 p-4 md:p-6 overflow-auto">
                        <div className="max-w-6xl mx-auto w-full space-y-4">
                            {/* Mode Segmented Controls */}
                            <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => setStagnantSubTab('DUE_DEFICIT')}
                                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            stagnantSubTab === 'DUE_DEFICIT'
                                                ? 'bg-rose-600 text-white shadow-md'
                                                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                                        }`}
                                    >
                                        <AlertTriangle className="w-3.5 h-3.5 text-rose-300 animate-pulse" />
                                        <span>🚨 고객 납기 위험 진단 (남은납기 ⟷ 예상제작소요 대조)</span>
                                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-950 text-rose-200 border border-rose-400/40">
                                            {criticalDueRiskItems.length}건
                                        </span>
                                    </button>

                                    <button
                                        onClick={() => setStagnantSubTab('ELAPSED_DAYS')}
                                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            stagnantSubTab === 'ELAPSED_DAYS'
                                                ? 'bg-slate-700 text-white shadow-md'
                                                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                                        }`}
                                    >
                                        <Hourglass className="w-3.5 h-3.5 text-amber-300" />
                                        <span>⏳ 발주 후 장기 미착수 정체 (0% 미착수 경과순)</span>
                                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                            {longestStagnantItems.length}건
                                        </span>
                                    </button>
                                </div>

                                <div className="text-[11px] text-slate-400 font-sans hidden md:block pr-2">
                                    {stagnantSubTab === 'DUE_DEFICIT' ? (
                                        <span className="text-rose-300 font-medium">💡 고객 약속납기 잔여일수보다 대경 제작 소요가 길어 펑크가 확정된 순위</span>
                                    ) : (
                                        <span className="text-amber-300 font-medium">💡 발주 후 수개월간 절단 착수조차 안 된 미착수 순위</span>
                                    )}
                                </div>
                            </div>

                            {/* MODE A: 고객 납기 대비 지연 예측 (Leadtime Deficit) */}
                            {stagnantSubTab === 'DUE_DEFICIT' && (
                                <div className="space-y-4">
                                    {/* Header description */}
                                    <div className="bg-gradient-to-r from-rose-950/60 via-slate-950 to-amber-950/40 border border-rose-500/40 p-5 rounded-xl shadow-xl">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                                                    <AlertTriangle className="w-5 h-5 text-rose-400 animate-pulse" />
                                                    고객 약속납기 ⟷ 대경 남은 공정 리드타임 정밀 대조 진단
                                                    <span className="px-2 py-0.5 rounded text-xs bg-rose-500/20 text-rose-300 font-mono font-bold">
                                                        선제적 납기 펑크 예측
                                                    </span>
                                                </h3>
                                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                                    단순히 '발주 후 며칠 경과'만 보는 과거 기준을 넘어, <b>'고객 납기일까지 남은 기간(D-day)'</b>과 <b>'대경벤드의 현재 공정 단계에서 완성까지 소요되는 예상 제작일수'</b>를 대조하여 <b>납기 펑크 및 지연 결손(Deficit)</b>을 사전에 판정합니다.
                                                    <span className="text-amber-300 font-medium ml-1">
                                                        (예: 고객 납기가 7일 남았으나 티(TEE) 공정이 아직 절단대기 상태(27일 소요)라면 20일 펑크 확정)
                                                    </span>
                                                </p>
                                            </div>
                                            <div className="text-right font-mono shrink-0 pl-4">
                                                <div className="text-xs text-slate-400">납기 위험 감지</div>
                                                <div className="text-2xl font-black text-rose-400">
                                                    {criticalDueRiskItems.length} <span className="text-sm font-normal text-slate-400">건</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Top 3 Worst Highlight Cards */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {criticalDueRiskItems.slice(0, 3).map((item, idx) => (
                                            <div 
                                                key={item.rowIdx}
                                                className="p-4 rounded-xl bg-slate-950 border border-rose-500/50 shadow-lg relative overflow-hidden flex flex-col justify-between"
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-xs text-slate-400 font-semibold truncate max-w-[170px]" title={item.deliveryTo || item.customerName}>
                                                            {item.deliveryTo || item.customerName}
                                                        </div>
                                                        <div className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono">
                                                            #{idx + 1} {item.dueDateStatus === 'OVERDUE' ? '납기 초과' : '펑크 위험'}
                                                        </div>
                                                    </div>

                                                    <div className="text-lg font-black text-rose-400 mt-2 font-mono">
                                                        {item.dueDateStatus === 'OVERDUE' ? (
                                                            <span>🚨 고객납기 {Math.abs(item.remainingCustomerDays || 0)}일 초과</span>
                                                        ) : (
                                                            <span>🚨 {Math.abs(item.leadtimeDeficit || 0)}일 펑크 위험!</span>
                                                        )}
                                                    </div>

                                                    <div className="text-xs text-white font-bold mt-2 truncate" title={`${item.itemName} ${item.size} (${item.thickness})`}>
                                                        {item.itemName} {item.size} ({item.thickness})
                                                    </div>

                                                    <div className="mt-2.5 p-2 rounded bg-slate-900 border border-slate-800 text-[11px] space-y-1">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-slate-400">고객 납기:</span>
                                                            <span className="font-bold text-amber-300 font-mono">
                                                                {item.customerDueDate || '-'} ({typeof item.remainingCustomerDays === 'number' ? (item.remainingCustomerDays < 0 ? `+${Math.abs(item.remainingCustomerDays)}일 초과` : `D-${item.remainingCustomerDays}일`) : 'N/A'})
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-slate-400">대경 현재 공정:</span>
                                                            <span className="font-bold text-slate-200">
                                                                {item.stage} ({item.progressPct}%)
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-slate-400">잔여 제작 필요:</span>
                                                            <span className="font-bold text-rose-300 font-mono">
                                                                약 {item.remainingProductionDays}일 소요 예상
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="text-[11px] text-slate-400 mt-2 font-mono flex items-center justify-between">
                                                        <span>발주: {item.orderNo}</span>
                                                        <span className="text-white font-bold">{item.orderQty}개</span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => {
                                                        setSearchKeyword(item.orderNo);
                                                        setActiveTab('TABLE');
                                                    }}
                                                    className="mt-3 w-full py-1 text-center rounded bg-slate-800 hover:bg-rose-600 hover:text-white text-[11px] text-slate-300 transition-colors"
                                                >
                                                    공정 대장에서 확인 →
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Full Table of Due Date Risk Items */}
                                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                                        <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                                            <span className="font-semibold text-slate-300">
                                                고객 납기 지연 및 펑크 위험 상위 50개 품목 대장
                                            </span>
                                            <span>정렬: 납기 결손 마진 큰 순 (내림차순)</span>
                                        </div>

                                        <div className="overflow-x-auto max-h-[500px]">
                                            <table className="w-full text-left text-xs border-collapse font-mono">
                                                <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800 font-semibold">
                                                    <tr>
                                                        <th className="py-2.5 px-3 text-center">순위</th>
                                                        <th className="py-2.5 px-3 text-center">납기 판정</th>
                                                        <th className="py-2.5 px-3">고객 약속납기 (D-day)</th>
                                                        <th className="py-2.5 px-3">대경 공정 & 잔여소요</th>
                                                        <th className="py-2.5 px-3 text-center">납기 결손 마진</th>
                                                        <th className="py-2.5 px-3">주문번호 (Y열)</th>
                                                        <th className="py-2.5 px-3 font-sans">납품처 (Z열)</th>
                                                        <th className="py-2.5 px-3">품명</th>
                                                        <th className="py-2.5 px-3">규격 / 두께</th>
                                                        <th className="py-2.5 px-3 text-right">수량</th>
                                                        <th className="py-2.5 px-3 text-center">액션</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800/60">
                                                    {criticalDueRiskItems.map((item, idx) => (
                                                        <tr key={item.rowIdx} className="hover:bg-slate-900/60 transition-colors">
                                                            <td className="py-2 px-3 text-center text-slate-500 font-bold">
                                                                #{idx + 1}
                                                            </td>
                                                            <td className="py-2 px-3 text-center">
                                                                {item.dueDateStatus === 'OVERDUE' ? (
                                                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                                                        🚨 납기초과
                                                                    </span>
                                                                ) : item.dueDateStatus === 'IMPOSSIBLE_DELAY' ? (
                                                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-600/30 text-red-200 border border-red-500/50">
                                                                        🚨 펑크위험
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                                                        ⚠️ 촉박
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="py-2 px-3">
                                                                <div className="flex flex-col">
                                                                    <span className="text-slate-200 font-semibold">{item.customerDueDate || '-'}</span>
                                                                    {typeof item.remainingCustomerDays === 'number' && (
                                                                        <span className={`text-[10px] font-bold ${
                                                                            item.remainingCustomerDays < 0 ? 'text-rose-400' : 'text-amber-400'
                                                                        }`}>
                                                                            {item.remainingCustomerDays < 0 ? `+${Math.abs(item.remainingCustomerDays)}일 경과` : `D-${item.remainingCustomerDays}일 남음`}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-2 px-3">
                                                                <div className="flex flex-col">
                                                                    <span className="text-slate-300 font-sans">{item.stage} ({item.progressPct}%)</span>
                                                                    <span className="text-[10px] text-rose-300 font-semibold">
                                                                        잔여제작: 약 {item.remainingProductionDays}일 필요
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-2 px-3 text-center font-bold">
                                                                <span className="px-2 py-0.5 rounded text-[11px] bg-red-950 text-red-200 border border-red-500/40">
                                                                    {item.leadtimeDeficit !== null ? `${item.leadtimeDeficit}일` : '-'}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-3 font-bold text-emerald-400">{item.orderNo}</td>
                                                            <td className="py-2 px-3 font-sans font-bold text-amber-300">
                                                                {item.deliveryTo || item.customerName}
                                                            </td>
                                                            <td className="py-2 px-3 font-extrabold text-white">{item.itemName}</td>
                                                            <td className="py-2 px-3 text-slate-300">{item.size} ({item.thickness})</td>
                                                            <td className="py-2 px-3 text-right font-bold text-white">{item.orderQty}</td>
                                                            <td className="py-2 px-3 text-center">
                                                                <button
                                                                    onClick={() => {
                                                                        setSearchKeyword(item.orderNo);
                                                                        setActiveTab('TABLE');
                                                                    }}
                                                                    className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 transition-colors"
                                                                >
                                                                    대장 보기
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* MODE B: 발주일 기준 장기 미착수 정체 (0% 진행 품목 TOP) */}
                            {stagnantSubTab === 'ELAPSED_DAYS' && (
                                <div className="space-y-4">
                                    {/* Header description */}
                                    <div className="bg-gradient-to-r from-amber-950/50 via-slate-950 to-slate-900 border border-amber-500/40 p-5 rounded-xl shadow-xl">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                                                    <Hourglass className="w-5 h-5 text-amber-400 animate-spin" />
                                                    발주일 기준 최장 미착수 정체 순위 (0% 진행 품목 TOP)
                                                    <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300 font-mono font-bold">
                                                        발주 후 방치 품목 집중 관제
                                                    </span>
                                                </h3>
                                                <p className="text-xs text-slate-400 mt-1">
                                                    발주(PO)를 넣은 지 수개월이 지나도록 <b>대경벤드에서 절단(P열) 착수조차 안 되고 검토/홀딩 상태로 멈춰 있는</b> 피팅 자재들을 경과일수 순으로 정렬했습니다.
                                                    <span className="text-amber-400 font-medium ml-1">
                                                        (💡 NEGO, 시편TEST비 등 비제품성 정산 행은 자동 제외되어 순수 배관 피팅 자재만 표시됩니다)
                                                    </span>
                                                </p>
                                            </div>
                                            <div className="text-right font-mono shrink-0 pl-4">
                                                <div className="text-xs text-slate-400">최장 정체 일수</div>
                                                <div className="text-2xl font-black text-amber-400">
                                                    {longestStagnantItems[0]?.elapsedDays || 0} <span className="text-sm font-normal text-slate-400">일</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Top 3 Worst Highlight Cards */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {longestStagnantItems.slice(0, 3).map((item, idx) => (
                                            <div 
                                                key={item.rowIdx}
                                                className="p-4 rounded-xl bg-slate-950 border border-amber-500/40 shadow-lg relative overflow-hidden"
                                            >
                                                <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                                                    #{idx + 1} 최장 멈춤
                                                </div>
                                                <div className="text-xs text-slate-400 font-semibold truncate max-w-[170px]">
                                                    {item.deliveryTo || item.customerName}
                                                </div>
                                                <div className="text-xl font-black text-amber-400 mt-1 font-mono">
                                                    D+{item.elapsedDays}일째 멈춤
                                                </div>
                                                <div className="text-xs text-white font-bold mt-2">
                                                    {item.itemName} {item.size} ({item.thickness})
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-1">
                                                    발주: <span className="text-slate-300 font-mono">{item.orderNo}</span> ({item.poDate})
                                                </div>
                                                <div className="text-[11px] text-amber-300 mt-0.5">
                                                    수량: <span className="font-bold">{item.orderQty}개</span> | 작업구분: {item.workType} ({item.stage})
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        setSearchKeyword(item.orderNo);
                                                        setActiveTab('TABLE');
                                                    }}
                                                    className="mt-3 w-full py-1 text-center rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 hover:text-white transition-colors"
                                                >
                                                    공정 대장에서 확인 →
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Full Table of Stagnant Items */}
                                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                                        <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                                            <span className="font-semibold text-slate-300">
                                                공정 미착수 정체 상위 50개 품목 대장
                                            </span>
                                            <span>정렬: 발주 후 경과일수 많은 순 (내림차순)</span>
                                        </div>

                                        <div className="overflow-x-auto max-h-[500px]">
                                            <table className="w-full text-left text-xs border-collapse font-mono">
                                                <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800 font-semibold">
                                                    <tr>
                                                        <th className="py-2.5 px-3 text-center">순위</th>
                                                        <th className="py-2.5 px-3">정체 일수</th>
                                                        <th className="py-2.5 px-3">발주일자</th>
                                                        <th className="py-2.5 px-3">주문번호 (Y열)</th>
                                                        <th className="py-2.5 px-3 font-sans">납품처 (Z열)</th>
                                                        <th className="py-2.5 px-3">품명</th>
                                                        <th className="py-2.5 px-3">규격 / 두께</th>
                                                        <th className="py-2.5 px-3 text-right">수량</th>
                                                        <th className="py-2.5 px-3 text-center font-sans">작업구분</th>
                                                        <th className="py-2.5 px-3 text-center font-sans">현재 상태</th>
                                                        <th className="py-2.5 px-3 text-center">액션</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800/60">
                                                    {longestStagnantItems.map((item, idx) => (
                                                        <tr key={item.rowIdx} className="hover:bg-slate-900/60 transition-colors">
                                                            <td className="py-2 px-3 text-center text-slate-500 font-bold">
                                                                #{idx + 1}
                                                            </td>
                                                            <td className="py-2 px-3 font-bold">
                                                                <span className={`px-2 py-0.5 rounded text-[11px] ${
                                                                    (item.elapsedDays || 0) >= 100 
                                                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                                                                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                                                }`}>
                                                                    D+{item.elapsedDays}일
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-3 text-slate-300">{item.poDate || '-'}</td>
                                                            <td className="py-2 px-3 font-bold text-emerald-400">{item.orderNo}</td>
                                                            <td className="py-2 px-3 font-sans font-bold text-amber-300">
                                                                {item.deliveryTo || item.customerName}
                                                            </td>
                                                            <td className="py-2 px-3 font-extrabold text-white">{item.itemName}</td>
                                                            <td className="py-2 px-3 text-slate-300">{item.size} ({item.thickness})</td>
                                                            <td className="py-2 px-3 text-right font-bold text-white">{item.orderQty}</td>
                                                            <td className="py-2 px-3 text-center font-sans">
                                                                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                                                    {item.workType}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-3 text-center font-sans text-red-300 text-[11px]">
                                                                {item.stage}
                                                            </td>
                                                            <td className="py-2 px-3 text-center">
                                                                <button
                                                                    onClick={() => {
                                                                        setSearchKeyword(item.orderNo);
                                                                        setActiveTab('TABLE');
                                                                    }}
                                                                    className="px-2 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 transition-colors"
                                                                >
                                                                    대장 보기
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 6. TAB 4: 대경벤드 긴급 납기 독촉 보고서 */}
                {/* 6. TAB 4: 대경벤드 납기 정밀 분석 보고서 (Executive Delivery Risk Matrix) */}
                {activeTab === 'CHASER_REPORT' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/60 p-3 md:p-6 overflow-auto">
                        <div className="max-w-[98%] mx-auto w-full space-y-4">
                            {/* Top Header & Sub-Tab Navigation */}
                            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                                            <BarChart3 className="w-5 h-5 text-amber-400" />
                                            대경벤드 납기 정밀 분석 보고서
                                        </h3>
                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                            Executive Risk Matrix
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">
                                        <b>업체명 - 발주번호 - 고객납기 - 현재공정 - 위험도 판정(🚨위험 / ⚠️경계 / ✅안정)</b> 체계로 집계된 경영진 및 현장용 분석 보고서입니다.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {/* Sub-tab switcher */}
                                    <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
                                        <button
                                            onClick={() => setReportSubTab('MATRIX')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                reportSubTab === 'MATRIX'
                                                    ? 'bg-amber-600 text-white shadow-md'
                                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                            }`}
                                        >
                                            <Layers className="w-3.5 h-3.5" />
                                            <span>정밀 분석 매트릭스 ({orderAnalyses.length}개)</span>
                                        </button>
                                        <button
                                            onClick={() => setReportSubTab('MEMO')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                reportSubTab === 'MEMO'
                                                    ? 'bg-red-700 text-white shadow-md'
                                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                            }`}
                                        >
                                            <FileText className="w-3.5 h-3.5" />
                                            <span>대경 제출용 공문 전문</span>
                                        </button>
                                    </div>

                                    {/* Copy report button */}
                                    <button
                                        onClick={handleCopyReport}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer"
                                        title="공문 전문을 클립보드에 복사"
                                    >
                                        {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        <span>{copiedReport ? '복사 완료!' : '공문 복사'}</span>
                                    </button>
                                </div>
                            </div>

                            {/* SUB-TAB A: 정밀 분석 매트릭스 (Executive Matrix Table) */}
                            {reportSubTab === 'MATRIX' && (
                                <div className="space-y-4">
                                    {/* 4 KPI Summary Cards */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div 
                                            onClick={() => setOrderRiskFilter('DANGER')}
                                            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                                orderRiskFilter === 'DANGER'
                                                    ? 'bg-red-950/60 border-red-500 ring-2 ring-red-500/40'
                                                    : 'bg-slate-950 border-red-500/30 hover:border-red-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between text-xs text-rose-300 font-semibold">
                                                <span className="flex items-center gap-1">
                                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                                                    🚨 위험 (DANGER)
                                                </span>
                                                <span className="text-[10px] bg-red-950/80 px-1.5 py-0.5 rounded text-rose-300 border border-red-500/40">
                                                    납기초과·펑크확정
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-baseline justify-between font-mono">
                                                <span className="text-2xl font-black text-rose-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'DANGER').length}
                                                    <span className="text-xs text-slate-400 font-sans ml-1">개 발주서</span>
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'DANGER').reduce((s, o) => s + o.totalQty, 0).toLocaleString()}개
                                                </span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-slate-400 truncate">
                                                고객 납기일 초과 또는 잔여소요 부족
                                            </div>
                                        </div>

                                        <div 
                                            onClick={() => setOrderRiskFilter('WARNING')}
                                            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                                orderRiskFilter === 'WARNING'
                                                    ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/40'
                                                    : 'bg-slate-950 border-amber-500/30 hover:border-amber-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between text-xs text-amber-300 font-semibold">
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                                                    ⚠️ 경계 (WARNING)
                                                </span>
                                                <span className="text-[10px] bg-amber-950/80 px-1.5 py-0.5 rounded text-amber-300 border border-amber-500/40">
                                                    납기임박·공정정체
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-baseline justify-between font-mono">
                                                <span className="text-2xl font-black text-amber-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'WARNING').length}
                                                    <span className="text-xs text-slate-400 font-sans ml-1">개 발주서</span>
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'WARNING').reduce((s, o) => s + o.totalQty, 0).toLocaleString()}개
                                                </span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-slate-400 truncate">
                                                납기 D-3일 이내 또는 14일 이상 미착수
                                            </div>
                                        </div>

                                        <div 
                                            onClick={() => setOrderRiskFilter('SAFE')}
                                            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                                orderRiskFilter === 'SAFE'
                                                    ? 'bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-500/40'
                                                    : 'bg-slate-950 border-emerald-500/30 hover:border-emerald-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold">
                                                <span className="flex items-center gap-1">
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                                    ✅ 안정 (SAFE)
                                                </span>
                                                <span className="text-[10px] bg-emerald-950/80 px-1.5 py-0.5 rounded text-emerald-300 border border-emerald-500/40">
                                                    일정여유·정상제작
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-baseline justify-between font-mono">
                                                <span className="text-2xl font-black text-emerald-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'SAFE').length}
                                                    <span className="text-xs text-slate-400 font-sans ml-1">개 발주서</span>
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'SAFE').reduce((s, o) => s + o.totalQty, 0).toLocaleString()}개
                                                </span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-slate-400 truncate">
                                                고객 납기일까지 일정 여유 충분
                                            </div>
                                        </div>

                                        <div 
                                            onClick={() => setOrderRiskFilter('COMPLETED')}
                                            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                                orderRiskFilter === 'COMPLETED'
                                                    ? 'bg-teal-950/60 border-teal-500 ring-2 ring-teal-500/40'
                                                    : 'bg-slate-950 border-teal-500/30 hover:border-teal-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between text-xs text-teal-300 font-semibold">
                                                <span className="flex items-center gap-1">
                                                    <Layers className="w-3.5 h-3.5 text-teal-400" />
                                                    🏁 완료 (COMPLETED)
                                                </span>
                                                <span className="text-[10px] bg-teal-950/80 px-1.5 py-0.5 rounded text-teal-300 border border-teal-500/40">
                                                    창고입고완료
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-baseline justify-between font-mono">
                                                <span className="text-2xl font-black text-teal-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'COMPLETED').length}
                                                    <span className="text-xs text-slate-400 font-sans ml-1">개 발주서</span>
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    {orderAnalyses.filter(o => o.riskLevel === 'COMPLETED').reduce((s, o) => s + o.totalQty, 0).toLocaleString()}개
                                                </span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-slate-400 truncate">
                                                대경 창고 입고 완료 (출고 배차 준비)
                                            </div>
                                        </div>
                                    </div>

                                    {/* Search & Filter Pills Toolbar */}
                                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
                                            <button
                                                onClick={() => setOrderRiskFilter('ALL')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                    orderRiskFilter === 'ALL'
                                                        ? 'bg-slate-700 text-white shadow'
                                                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                                                }`}
                                            >
                                                전체 발주서 ({orderAnalyses.length})
                                            </button>
                                            <button
                                                onClick={() => setOrderRiskFilter('DANGER')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                                    orderRiskFilter === 'DANGER'
                                                        ? 'bg-rose-600 text-white shadow'
                                                        : 'bg-slate-900 text-rose-300 hover:bg-slate-800 border border-rose-500/30'
                                                }`}
                                            >
                                                🚨 위험 ({orderAnalyses.filter(o => o.riskLevel === 'DANGER').length})
                                            </button>
                                            <button
                                                onClick={() => setOrderRiskFilter('WARNING')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                                    orderRiskFilter === 'WARNING'
                                                        ? 'bg-amber-600 text-white shadow'
                                                        : 'bg-slate-900 text-amber-300 hover:bg-slate-800 border border-amber-500/30'
                                                }`}
                                            >
                                                ⚠️ 경계 ({orderAnalyses.filter(o => o.riskLevel === 'WARNING').length})
                                            </button>
                                            <button
                                                onClick={() => setOrderRiskFilter('SAFE')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                                    orderRiskFilter === 'SAFE'
                                                        ? 'bg-emerald-600 text-white shadow'
                                                        : 'bg-slate-900 text-emerald-300 hover:bg-slate-800 border border-emerald-500/30'
                                                }`}
                                            >
                                                ✅ 안정 ({orderAnalyses.filter(o => o.riskLevel === 'SAFE').length})
                                            </button>
                                            <button
                                                onClick={() => setOrderRiskFilter('COMPLETED')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                                    orderRiskFilter === 'COMPLETED'
                                                        ? 'bg-teal-600 text-white shadow'
                                                        : 'bg-slate-900 text-teal-300 hover:bg-slate-800 border border-teal-500/30'
                                                }`}
                                            >
                                                🏁 입고완료 ({orderAnalyses.filter(o => o.riskLevel === 'COMPLETED').length})
                                            </button>
                                        </div>

                                        {/* Search Input */}
                                        <div className="relative w-full md:w-72">
                                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                            <input
                                                type="text"
                                                value={orderSearchKeyword}
                                                onChange={e => setOrderSearchKeyword(e.target.value)}
                                                placeholder="업체명, 발주번호, 공정 검색..."
                                                className="w-full pl-9 pr-8 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                                            />
                                            {orderSearchKeyword && (
                                                <button
                                                    onClick={() => setOrderSearchKeyword('')}
                                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* The Core Matrix Table */}
                                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                                        <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs">
                                            <div className="font-bold text-white flex items-center gap-2">
                                                <span>발주서별 정밀 납기 위험 분석 매트릭스</span>
                                                <span className="text-slate-400 font-normal">
                                                    (검색 결과: <b className="text-amber-400">{filteredOrderAnalyses.length}</b>건 / 전체 {orderAnalyses.length}건)
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-slate-400 font-mono hidden md:block">
                                                정렬: 위험도 순 (🚨위험 ➔ ⚠️경계 ➔ ✅안정 ➔ 🏁완료)
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto max-h-[620px]">
                                            <table className="w-full text-left text-xs border-collapse">
                                                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-sm text-slate-300 border-b border-slate-800 font-semibold z-10">
                                                    <tr>
                                                        <th className="py-2.5 px-3 text-center w-12">#</th>
                                                        <th className="py-2.5 px-3 min-w-[130px]">업체명 (납품처)</th>
                                                        <th className="py-2.5 px-3 font-mono min-w-[120px]">발주번호</th>
                                                        <th className="py-2.5 px-3 min-w-[140px]">고객 약속납기</th>
                                                        <th className="py-2.5 px-3 min-w-[180px]">현재 공정 현황</th>
                                                        <th className="py-2.5 px-3 text-center min-w-[95px]">위험도 판정</th>
                                                        <th className="py-2.5 px-3 text-right font-mono min-w-[95px]">품목 / 수량</th>
                                                        <th className="py-2.5 px-3 min-w-[260px]">판정 사유 및 긴급 조치사항</th>
                                                        <th className="py-2.5 px-3 text-center w-24">상세 / 액션</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800/60">
                                                    {filteredOrderAnalyses.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={9} className="py-12 text-center text-slate-500">
                                                                <Filter className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                                                <div>조건에 일치하는 발주 분석 내역이 없습니다.</div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        filteredOrderAnalyses.map((order, idx) => {
                                                            const orderKey = `${order.client}____${order.orderNo}`;
                                                            const isExpanded = expandedOrderKey === orderKey;
                                                            const isDanger = order.riskLevel === 'DANGER';
                                                            const isWarning = order.riskLevel === 'WARNING';
                                                            const isCompleted = order.riskLevel === 'COMPLETED';

                                                            return (
                                                                <>
                                                                    <tr 
                                                                        key={orderKey}
                                                                        className={`transition-colors hover:bg-slate-800/50 ${
                                                                            isDanger ? 'bg-red-950/20' :
                                                                            isWarning ? 'bg-amber-950/15' :
                                                                            isCompleted ? 'bg-teal-950/10' :
                                                                            (idx % 2 === 1 ? 'bg-slate-900/30' : '')
                                                                        }`}
                                                                    >
                                                                        {/* Index */}
                                                                        <td className="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px]">
                                                                            {idx + 1}
                                                                        </td>

                                                                        {/* 1. 업체명 (납품처) */}
                                                                        <td className="py-2.5 px-3 font-bold text-white">
                                                                            <button
                                                                                onClick={() => handleSelectClient(order.client)}
                                                                                className="hover:underline text-amber-300 text-left truncate max-w-[150px] block"
                                                                                title={`[${order.client}] 거래처 대장 모아보기`}
                                                                            >
                                                                                {order.client}
                                                                            </button>
                                                                            {order.poDate && (
                                                                                <div className="text-[10px] text-slate-400 font-normal font-mono">
                                                                                    발주: {order.poDate} {order.elapsedDays > 0 ? `(D+${order.elapsedDays}일)` : ''}
                                                                                </div>
                                                                            )}
                                                                        </td>

                                                                        {/* 2. 발주번호 */}
                                                                        <td className="py-2.5 px-3 font-mono font-bold">
                                                                            <button
                                                                                onClick={() => handleSelectOrder(order.orderNo)}
                                                                                className="px-2 py-0.5 rounded text-xs bg-slate-800 hover:bg-amber-600 hover:text-white text-emerald-400 border border-slate-700 hover:border-amber-500 transition-colors"
                                                                                title="이 발주번호로 공정 대장 바로 조회"
                                                                            >
                                                                                {order.orderNo}
                                                                            </button>
                                                                        </td>

                                                                        {/* 3. 고객납기 */}
                                                                        <td className="py-2.5 px-3">
                                                                            {order.customerDueDate ? (
                                                                                <div className="flex flex-col">
                                                                                    <div className="font-semibold text-slate-200">
                                                                                        {order.customerDueDate}
                                                                                    </div>
                                                                                    {order.remainingDays !== null && (
                                                                                        <span className={`text-[11px] font-bold mt-0.5 ${
                                                                                            order.remainingDays < 0 ? 'text-rose-400 animate-pulse' :
                                                                                            order.remainingDays <= 3 ? 'text-amber-400' : 'text-emerald-400'
                                                                                        }`}>
                                                                                            {order.remainingDays < 0 
                                                                                                ? `🚨 ${Math.abs(order.remainingDays)}일 초과` 
                                                                                                : order.remainingDays === 0 ? '🚨 오늘(D-Day) 마감' : `D-${order.remainingDays}일 남음`}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            ) : (
                                                                                <span className="text-slate-500 text-xs">-</span>
                                                                            )}
                                                                        </td>

                                                                        {/* 4. 현재공정 */}
                                                                        <td className="py-2.5 px-3 text-slate-300">
                                                                            <span className="text-xs font-medium leading-relaxed">
                                                                                {order.mainStage}
                                                                            </span>
                                                                        </td>

                                                                        {/* 5. 위험도 판정 */}
                                                                        <td className="py-2.5 px-3 text-center">
                                                                            {isDanger && (
                                                                                <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/25 text-rose-300 border border-rose-500/50 flex items-center justify-center gap-1 shadow-sm">
                                                                                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                                                                                    🚨 위험
                                                                                </span>
                                                                            )}
                                                                            {isWarning && (
                                                                                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/25 text-amber-300 border border-amber-500/50 flex items-center justify-center gap-1 shadow-sm">
                                                                                    <Clock className="w-3 h-3 text-amber-400" />
                                                                                    ⚠️ 경계
                                                                                </span>
                                                                            )}
                                                                            {isCompleted && (
                                                                                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40 flex items-center justify-center gap-1">
                                                                                    <CheckCircle2 className="w-3 h-3 text-teal-400" />
                                                                                    🏁 완료
                                                                                </span>
                                                                            )}
                                                                            {!isDanger && !isWarning && !isCompleted && (
                                                                                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center justify-center gap-1">
                                                                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                                                                    ✅ 안정
                                                                                </span>
                                                                            )}
                                                                        </td>

                                                                        {/* 6. 품목 / 수량 */}
                                                                        <td className="py-2.5 px-3 text-right font-mono">
                                                                            <div className="font-extrabold text-white text-xs">
                                                                                {order.totalQty.toLocaleString()}개
                                                                            </div>
                                                                            <div className="text-[10px] text-slate-400">
                                                                                총 {order.totalItems}개 품목
                                                                            </div>
                                                                        </td>

                                                                        {/* 7. 판정 사유 및 조치사항 */}
                                                                        <td className="py-2.5 px-3">
                                                                            <div className="space-y-0.5">
                                                                                <div className={`text-xs font-bold ${
                                                                                    isDanger ? 'text-rose-300' : isWarning ? 'text-amber-300' : 'text-slate-300'
                                                                                }`}>
                                                                                    {order.riskReason}
                                                                                </div>
                                                                                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                                                                                    <span className="text-amber-400 font-semibold">▶ 조치:</span>
                                                                                    <span>{order.actionItem}</span>
                                                                                </div>
                                                                            </div>
                                                                        </td>

                                                                        {/* 8. 상세 / 대장 액션 */}
                                                                        <td className="py-2.5 px-3 text-center">
                                                                            <div className="flex items-center justify-center gap-1">
                                                                                <button
                                                                                    onClick={() => setExpandedOrderKey(isExpanded ? null : orderKey)}
                                                                                    className={`p-1.5 rounded hover:bg-slate-700 transition-colors text-xs ${
                                                                                        isExpanded ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                                                                                    }`}
                                                                                    title={isExpanded ? '상세 닫기' : '하위 품목 상세 펼치기'}
                                                                                >
                                                                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleSelectOrder(order.orderNo)}
                                                                                    className="p-1.5 rounded hover:bg-amber-600 hover:text-white text-slate-400 transition-colors text-xs"
                                                                                    title="이 발주서 공정 대장으로 이동"
                                                                                >
                                                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>

                                                                    {/* Accordion Detail: 하위 품목 리스트 */}
                                                                    {isExpanded && (
                                                                        <tr className="bg-slate-950/90 border-y border-slate-700/80">
                                                                            <td colSpan={9} className="p-3">
                                                                                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                                                                                    <div className="flex items-center justify-between text-xs text-slate-300 border-b border-slate-800 pb-2">
                                                                                        <span className="font-bold flex items-center gap-2">
                                                                                            <span className="text-amber-400">{order.client}</span> - 발주번호 <span className="font-mono text-emerald-400">{order.orderNo}</span> 하위 품목 상세 ({order.items?.length || 0}건)
                                                                                        </span>
                                                                                        <button
                                                                                            onClick={() => handleSelectOrder(order.orderNo)}
                                                                                            className="px-2 py-0.5 rounded text-[11px] bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors flex items-center gap-1"
                                                                                        >
                                                                                            <span>전체 대장에서 크게 보기</span>
                                                                                            <ArrowUpRight className="w-3 h-3" />
                                                                                        </button>
                                                                                    </div>
                                                                                    <div className="max-h-60 overflow-auto">
                                                                                        <table className="w-full text-left text-[11px] font-mono">
                                                                                            <thead className="bg-slate-950 text-slate-400 sticky top-0">
                                                                                                <tr>
                                                                                                    <th className="p-1.5">LOT</th>
                                                                                                    <th className="p-1.5">품명</th>
                                                                                                    <th className="p-1.5">규격/두께</th>
                                                                                                    <th className="p-1.5">재질</th>
                                                                                                    <th className="p-1.5 text-center">작업(L)</th>
                                                                                                    <th className="p-1.5 text-right">잔여수량</th>
                                                                                                    <th className="p-1.5 text-center">공정단계</th>
                                                                                                    <th className="p-1.5">정체 사유</th>
                                                                                                </tr>
                                                                                            </thead>
                                                                                            <tbody className="divide-y divide-slate-800/50">
                                                                                                {order.items?.map(it => (
                                                                                                    <tr key={it.rowIdx} className="hover:bg-slate-800/40">
                                                                                                        <td className="p-1.5 text-slate-400">{it.lotNo}</td>
                                                                                                        <td className="p-1.5 font-bold text-white">{it.itemName}</td>
                                                                                                        <td className="p-1.5 text-slate-300">{it.size} ({it.thickness})</td>
                                                                                                        <td className="p-1.5 text-slate-400">{it.material}</td>
                                                                                                        <td className="p-1.5 text-center">
                                                                                                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300">
                                                                                                                {it.workType}
                                                                                                            </span>
                                                                                                        </td>
                                                                                                        <td className="p-1.5 text-right font-bold text-white">{it.remainQty}개</td>
                                                                                                        <td className="p-1.5 text-center text-amber-300">{it.stage}</td>
                                                                                                        <td className="p-1.5 text-rose-300 font-sans truncate max-w-[280px]" title={it.alertReason || ''}>
                                                                                                            {it.alertReason || '-'}
                                                                                                        </td>
                                                                                                    </tr>
                                                                                                ))}
                                                                                            </tbody>
                                                                                        </table>
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* SUB-TAB B: 대경 제출용 공문 전문 (Official Text Memo) */}
                            {reportSubTab === 'MEMO' && (
                                <div className="space-y-4">
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
                                                    🚨 대경벤드 생산 미결 및 긴급 납기 독촉 공문
                                                    <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-normal">
                                                        PUR-04 팀장봇 작성
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
                                                <span>{copiedReport ? '복사 완료!' : '공문 전문 복사'}</span>
                                            </button>
                                        </div>

                                        <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed bg-slate-900/80 p-4 rounded-lg border border-slate-800/80 max-h-[550px] overflow-auto">
                                            {chaserReport?.markdown || '생성된 독촉 보고서가 없습니다.'}
                                        </pre>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 7. TAB 5: 제조 리드타임 벤치마크 및 견적 시뮬레이터 */}
                {activeTab === 'LEADTIME' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50 p-4 md:p-6 overflow-auto">
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

                {/* 8. Compact Modal Footer */}
                <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-800 bg-slate-950/90 text-xs text-slate-400 shrink-0">
                    <div className="flex items-center gap-3">
                        <span>현재 대장 표시: <b className="text-white">{filteredRows.length}</b>건</span>
                        <span>•</span>
                        <span>창고입고 완료: <b className="text-teal-400">{stageCounts['창고입고완료'] || 0}</b>건 (독촉 제외)</span>
                        <span>•</span>
                        <span>거래처 총: <b className="text-blue-400">{clientDiagnoses.length}</b>개사 분석 완료</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer font-medium"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
