import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { CalmPageShell } from '../../components/ui/CalmPageShell';
import {
    Bot, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
    FileText, ShoppingCart, Package, Building2, TrendingUp, TrendingDown,
    ArrowUpRight, ArrowDownRight, Minus, Sparkles, Info, MapPin, Activity, PackageSearch,
    Download,
} from 'lucide-react';

// 리포트 인쇄(PDF 저장) 시 화면 전용 요소(헤더/탭/버튼/원본 JSON 등)는 숨기고, 현재 펼친 리포트
// 카드 하나만 A4 레이아웃으로 출력한다. 배경색이 인쇄 시 날아가지 않도록 print-color-adjust를 강제한다.
const PRINT_STYLE = `
@media print {
    @page { size: A4; margin: 14mm; }
    body { background: #fff !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
}
`;

type ReportPeriod = 'weekly' | 'monthly' | 'quarterly' | 'semiannual';

const PERIOD_TABS: { key: ReportPeriod; label: string }[] = [
    { key: 'weekly', label: '주간' },
    { key: 'monthly', label: '월간' },
    { key: 'quarterly', label: '분기' },
    { key: 'semiannual', label: '반기' },
];

interface AiReportSection {
    title: string;
    content: string;
}

interface TopEntry {
    name: string;
    amount: number;
}

interface QuotationTrend {
    count: number;
    totalAmount: number;
    avgAmount: number;
    statusBreakdown: Record<string, number>;
    topCustomers: TopEntry[];
    countChangePct: number;
    amountChangePct: number;
}

interface OrderTrend extends QuotationTrend {
    totalSupplierAmount: number;
    estimatedMargin: number;
}

interface InventoryItemChange {
    id: string;
    name: string;
    change: number;
}

interface InventoryTrend {
    confirmedDaysInRange: number;
    totalOutbound: number;
    totalInbound: number;
    topDropItems: InventoryItemChange[];
    topSurgeItems: InventoryItemChange[];
    _note?: string;
}

interface SupplierTrend {
    topSuppliers: TopEntry[];
    newSuppliers: string[];
    droppingSuppliers: string[];
}

interface RegionRow {
    region: string;
    count: number;
    amount: number;
    countChangePct: number;
    amountChangePct: number;
}

interface RegionTrend {
    quotationByRegion: RegionRow[];
    orderByRegion: RegionRow[];
    unmatchedLabel: string;
    unmatchedQuotationShare: number;
    unmatchedOrderShare: number;
}

interface TrendBucket {
    periodKey: string;
    rangeStart: string;
    rangeEnd: string;
    quotationCount: number;
    quotationAmount: number;
    orderCount: number;
    orderAmount: number;
}

interface TrendSeries {
    buckets: TrendBucket[];
}

type InventoryActionCategory = 'RESTOCK' | 'STABLE' | 'EXCESS' | 'DEAD_STOCK_CANDIDATE';

interface InventoryActionItem {
    id: string;
    name: string;
    material?: string;
    size?: string;
    thickness?: string;
    unitPrice?: number;
    currentStock: number;
    recentHalfOutbound: number;
    earlierHalfOutbound: number;
    trendPct: number;
    daysOnHand: number | null;
    category: InventoryActionCategory;
    reason: string;
}

interface InventoryActionAnalysis {
    windowSnapCount: number;
    insufficientData: boolean;
    items: InventoryActionItem[];
    _note?: string;
}

interface ReportMetrics {
    periodKey: string;
    rangeStart: string;
    rangeEnd: string;
    quotationTrend: QuotationTrend;
    orderTrend: OrderTrend;
    inventoryTrend: InventoryTrend;
    supplierTrend: SupplierTrend;
    regionTrend?: RegionTrend;
    trendSeries?: TrendSeries;
    inventoryActionAnalysis?: InventoryActionAnalysis;
}

interface AiReport {
    id: string;
    period: ReportPeriod;
    periodKey: string;
    rangeStart: string;
    rangeEnd: string;
    generatedAt: string;
    status: 'SUCCESS' | 'FAILED';
    errorMessage?: string;
    metrics?: ReportMetrics;
    aiSummary?: string;
    aiSections?: AiReportSection[];
    aiRecommendations?: string[];
    model?: string;
    tokenUsage?: { input: number; output: number };
}

const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const formatWon = (num?: number) => {
    if (!num || isNaN(num)) return '0원';
    if (Math.abs(num) >= 100000000) return `${(num / 100000000).toFixed(1)}억원`;
    if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(0)}만원`;
    return `${Math.round(num).toLocaleString()}원`;
};

// 견적(SUBMITTED/PROCESSING/PROCESSED/PARTIAL_ORDERED/COMPLETED/CANCELED)과
// 발주(SUBMITTED/PROCESSING/HOLD/WITHDRAWN/SHIPPED/COMPLETED/CANCELLED) 상태값을 함께 커버
const STATUS_LABEL: Record<string, string> = {
    DRAFT: '임시저장',
    SUBMITTED: '접수',
    PROCESSING: '처리중',
    PROCESSED: '답변완료',
    PARTIAL_ORDERED: '부분발주완료',
    HOLD: '보류',
    ON_HOLD: '보류',
    SHIPPED: '배송중',
    COMPLETED: '완료',
    CANCELED: '취소',
    CANCELLED: '취소',
    WITHDRAW: '회수',
    WITHDRAWN: '회수',
};

// ── 작은 시각화 부품들 ──────────────────────────────────────────

function ChangeBadge({ value }: { value?: number }) {
    const v = value ?? 0;
    if (v === 0) {
        return (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-400">
                <Minus className="w-3 h-3" /> 0%
            </span>
        );
    }
    const isUp = v > 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
            {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {isUp ? '+' : ''}{v}%
        </span>
    );
}

function StatTile({
    icon: Icon, label, value, delta, deltaLabel, accent, sub,
}: {
    icon: React.ElementType;
    label: string;
    value: string;
    delta?: number;
    deltaLabel?: string;
    accent: string;
    sub?: string;
}) {
    return (
        <div className={`bg-white rounded-xl border border-slate-200 border-l-4 ${accent} p-3.5 shadow-xs`}>
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                <Icon className="w-3 h-3" />
                {label}
            </div>
            <div className="text-lg font-black text-slate-800 leading-tight">{value}</div>
            <div className="flex items-center gap-1.5 mt-1 min-h-[16px]">
                {delta !== undefined && <ChangeBadge value={delta} />}
                {deltaLabel && <span className="text-[10px] text-slate-400">{deltaLabel}</span>}
                {sub && <span className="text-[10px] text-slate-400">{sub}</span>}
            </div>
        </div>
    );
}

function RankBarList({ items, barClass, emptyText = '내역 없음' }: { items: TopEntry[]; barClass: string; emptyText?: string }) {
    if (!items || items.length === 0) {
        return <div className="text-[11px] text-slate-400 py-1">{emptyText}</div>;
    }
    const max = Math.max(...items.map(i => Math.abs(i.amount)), 1);
    return (
        <div className="space-y-2">
            {items.map((item, i) => (
                <div key={`${item.name}-${i}`}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="font-bold text-slate-700 truncate max-w-[65%]">{item.name}</span>
                        <span className="text-slate-500 font-semibold">{formatWon(item.amount)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full ${barClass}`}
                            style={{ width: `${Math.max(4, (Math.abs(item.amount) / max) * 100)}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function InventoryItemList({ items, tone }: { items: InventoryItemChange[]; tone: 'out' | 'in' }) {
    if (!items || items.length === 0) {
        return <div className="text-[11px] text-slate-400 py-1">변동 없음</div>;
    }
    const max = Math.max(...items.map(i => Math.abs(i.change)), 1);
    const isOut = tone === 'out';
    return (
        <div className="space-y-2">
            {items.map((item, i) => (
                <div key={`${item.id}-${i}`}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="font-bold text-slate-700 truncate max-w-[60%]">{item.name}</span>
                        <span className={`font-semibold flex items-center gap-0.5 ${isOut ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {isOut ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                            {isOut ? '-' : '+'}{Number(item.change).toLocaleString()}개
                        </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full ${isOut ? 'bg-rose-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.max(4, (Math.abs(item.change) / max) * 100)}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function CompareBars({
    rows,
}: {
    rows: { label: string; value: number; barClass: string }[];
}) {
    const max = Math.max(...rows.map(r => r.value), 1);
    return (
        <div className="space-y-2.5">
            {rows.map(r => (
                <div key={r.label}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-bold text-slate-600">{r.label}</span>
                        <span className="font-black text-slate-800">{formatWon(r.value)}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full ${r.barClass}`}
                            style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function StatusChips({ breakdown }: { breakdown?: Record<string, number> }) {
    const entries = Object.entries(breakdown || {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return <div className="text-[11px] text-slate-400">상태별 데이터 없음</div>;
    return (
        <div className="flex flex-wrap gap-1.5">
            {entries.map(([status, count]) => (
                <span key={status} className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                    {STATUS_LABEL[status] || status}
                    <span className="text-slate-400">{count}건</span>
                </span>
            ))}
        </div>
    );
}

function SectionCard({
    icon: Icon, title, accentText, children,
}: {
    icon: React.ElementType;
    title: string;
    accentText: string;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <div className={`flex items-center gap-1.5 text-xs font-black mb-3 ${accentText}`}>
                <Icon className="w-3.5 h-3.5" />
                {title}
            </div>
            {children}
        </div>
    );
}

const ACTION_CATEGORY_CONFIG: Record<InventoryActionCategory, { label: string; className: string; icon: React.ElementType }> = {
    RESTOCK: { label: '재구매 추천', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ArrowUpRight },
    STABLE: { label: '재고 유지', className: 'bg-slate-100 text-slate-600 border-slate-200', icon: Minus },
    EXCESS: { label: '과잉재고 주의', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
    DEAD_STOCK_CANDIDATE: { label: '처분 검토', className: 'bg-rose-50 text-rose-700 border-rose-200', icon: TrendingDown },
};

function ActionBadge({ category }: { category: InventoryActionCategory }) {
    const cfg = ACTION_CATEGORY_CONFIG[category] || ACTION_CATEGORY_CONFIG.STABLE;
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold border px-2 py-0.5 rounded-full shrink-0 ${cfg.className}`}>
            <Icon className="w-3 h-3" />
            {cfg.label}
        </span>
    );
}

function TrendSparkline({ label, series, barClass }: { label: string; series: { periodKey: string; value: number }[]; barClass: string }) {
    const max = Math.max(...series.map(s => s.value), 1);
    return (
        <div>
            <div className="text-[10px] font-bold text-slate-500 mb-1">{label}</div>
            <div className="flex items-end gap-1 h-12">
                {series.map((s, i) => (
                    <div key={`${s.periodKey}-${i}`} className="flex-1 flex flex-col items-center justify-end gap-1">
                        <div
                            className={`w-full rounded-t-full ${barClass}`}
                            style={{ height: `${Math.max(6, (s.value / max) * 100)}%` }}
                            title={`${s.periodKey}: ${formatWon(s.value)}`}
                        />
                    </div>
                ))}
            </div>
            <div className="flex gap-1 mt-1">
                {series.map((s, i) => (
                    <div key={`${s.periodKey}-lbl-${i}`} className="flex-1 text-center text-[8px] text-slate-400 truncate">
                        {s.periodKey.replace(/^\d{4}-/, '')}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── 리포트 대시보드 본문 ──────────────────────────────────────────

function ReportDashboard({ report }: { report: AiReport }) {
    const [showText, setShowText] = useState(false);
    const [showRawMetrics, setShowRawMetrics] = useState(false);
    const m = report.metrics;

    if (!m) {
        return (
            <div className="space-y-4">
                <div className="bg-slate-900 text-white rounded-xl p-4">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">전체 요약</div>
                    <p className="text-xs leading-relaxed">{report.aiSummary}</p>
                </div>
            </div>
        );
    }

    const q = m.quotationTrend;
    const o = m.orderTrend;
    const inv = m.inventoryTrend;
    const s = m.supplierTrend;

    const marginPct = o.totalAmount > 0 ? ((o.estimatedMargin / o.totalAmount) * 100).toFixed(1) : '0';
    const conversionRate = q.count > 0 ? ((o.count / q.count) * 100).toFixed(0) : (o.count > 0 ? '100' : '—');
    const lowSample = inv.confirmedDaysInRange < 3;

    const handlePdfDownload = () => {
        const periodLabel = PERIOD_TABS.find(t => t.key === report.period)?.label || report.period;
        const originalTitle = document.title;
        document.title = `ALTF_AI경영리포트_${periodLabel}_${report.periodKey}`;
        const restoreTitle = () => {
            document.title = originalTitle;
            window.removeEventListener('afterprint', restoreTitle);
        };
        window.addEventListener('afterprint', restoreTitle);
        window.print();
    };

    return (
        <div className="space-y-4">
            {/* 인쇄 전용 리포트 제목 (화면에는 숨김) */}
            <div className="hidden print:block mb-2">
                <div className="text-base font-black text-slate-900">ALTF AI 경영 리포트 · {report.periodKey}</div>
                <div className="text-[11px] text-slate-500">{fmtDate(report.rangeStart)} ~ {fmtDate(report.rangeEnd)}</div>
            </div>

            <div className="print:hidden flex justify-end">
                <button
                    onClick={handlePdfDownload}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-teal-700 border border-slate-200 hover:border-teal-300 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                    <Download className="w-3.5 h-3.5" />
                    PDF 다운로드
                </button>
            </div>

            {/* AI 한 줄 요약 */}
            <div className="bg-slate-900 text-white rounded-xl p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    <Sparkles className="w-3 h-3" /> AI 전체 요약
                </div>
                <p className="text-xs leading-relaxed">{report.aiSummary}</p>
            </div>

            {/* KPI 타일 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile icon={FileText} label="견적 총액" value={formatWon(q.totalAmount)} delta={q.amountChangePct} deltaLabel="전기대비" accent="border-teal-400" />
                <StatTile icon={ShoppingCart} label="발주 매출" value={formatWon(o.totalAmount)} delta={o.amountChangePct} deltaLabel="전기대비" accent="border-indigo-400" />
                <StatTile icon={TrendingUp} label="예상 영업마진" value={formatWon(o.estimatedMargin)} sub={`마진율 ${marginPct}%`} accent="border-emerald-400" />
                <StatTile icon={Package} label="재고 확정 스냅샷" value={`${inv.confirmedDaysInRange}일`} sub={lowSample ? '표본 부족 주의' : '충분한 표본'} accent={lowSample ? 'border-amber-400' : 'border-slate-300'} />
            </div>

            {/* 견적 → 발주 전환 */}
            <SectionCard icon={ArrowUpRight} title={`견적 → 발주 전환율 ${conversionRate}%`} accentText="text-slate-700">
                <CompareBars
                    rows={[
                        { label: `견적 ${q.count}건`, value: q.totalAmount, barClass: 'bg-teal-400' },
                        { label: `발주 ${o.count}건`, value: o.totalAmount, barClass: 'bg-indigo-400' },
                    ]}
                />
            </SectionCard>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 견적 트렌드 */}
                <SectionCard icon={FileText} title="견적 트렌드 · 주요 고객사" accentText="text-teal-700">
                    <div className="text-[11px] text-slate-500 mb-2">
                        건수 {q.count}건 <ChangeBadge value={q.countChangePct} /> · 평균 단가 {formatWon(q.avgAmount)}
                    </div>
                    <RankBarList items={q.topCustomers} barClass="bg-teal-400" />
                    <div className="mt-3 pt-2 border-t border-slate-100">
                        <StatusChips breakdown={q.statusBreakdown} />
                    </div>
                </SectionCard>

                {/* 발주 트렌드 */}
                <SectionCard icon={ShoppingCart} title="발주 트렌드 · 주요 고객사" accentText="text-indigo-700">
                    <div className="text-[11px] text-slate-500 mb-2">
                        건수 {o.count}건 <ChangeBadge value={o.countChangePct} /> · 매입원가 {formatWon(o.totalSupplierAmount)}
                    </div>
                    <RankBarList items={o.topCustomers} barClass="bg-indigo-400" />
                    <div className="mt-3 pt-2 border-t border-slate-100">
                        <StatusChips breakdown={o.statusBreakdown} />
                    </div>
                </SectionCard>

                {/* 재고 트렌드 */}
                <SectionCard icon={Package} title="재고 트렌드 · 출고 상위 품목" accentText="text-rose-700">
                    <div className="text-[11px] text-slate-500 mb-2">
                        총 출고 {inv.totalOutbound.toLocaleString()}개 · 총 입고 {inv.totalInbound.toLocaleString()}개
                    </div>
                    <InventoryItemList items={inv.topDropItems} tone="out" />
                    <div className="mt-3 pt-2 border-t border-slate-100">
                        <div className="text-[10px] font-bold text-emerald-700 mb-1.5">입고(증가) 상위 품목</div>
                        <InventoryItemList items={inv.topSurgeItems} tone="in" />
                    </div>
                    {lowSample && (
                        <div className="mt-2.5 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                            확정 스냅샷이 {inv.confirmedDaysInRange}일뿐이라 표본이 부족합니다. 대경재고를 자주 확정할수록 신뢰도가 올라갑니다.
                        </div>
                    )}
                </SectionCard>

                {/* 업체 트렌드 */}
                <SectionCard icon={Building2} title="업체(공급사) 트렌드" accentText="text-violet-700">
                    <RankBarList items={s.topSuppliers} barClass="bg-violet-400" />
                    <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap gap-3">
                        <div className="flex-1 min-w-[100px]">
                            <div className="text-[10px] font-bold text-emerald-700 mb-1">신규 거래</div>
                            {s.newSuppliers.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {s.newSuppliers.map(n => (
                                        <span key={n} className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">{n}</span>
                                    ))}
                                </div>
                            ) : <span className="text-[10px] text-slate-400">없음</span>}
                        </div>
                        <div className="flex-1 min-w-[100px]">
                            <div className="text-[10px] font-bold text-rose-700 mb-1">거래 중단/미발생</div>
                            {s.droppingSuppliers.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {s.droppingSuppliers.map(n => (
                                        <span key={n} className="text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded-full">{n}</span>
                                    ))}
                                </div>
                            ) : <span className="text-[10px] text-slate-400">없음</span>}
                        </div>
                    </div>
                </SectionCard>
            </div>

            {/* 권역별 동향 */}
            {m.regionTrend && (() => {
                const rg = m.regionTrend!;
                const regionNote = (report.aiSections || []).find(sec => sec.title.includes('권역'));
                const showUnmatchedWarning = rg.unmatchedQuotationShare > 15 || rg.unmatchedOrderShare > 15;
                return (
                    <SectionCard icon={MapPin} title="권역별 동향 (견적/발주)" accentText="text-violet-700">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div className="text-[10px] font-bold text-slate-500 mb-1.5">견적 상위 권역</div>
                                <RankBarList items={rg.quotationByRegion.map(r => ({ name: r.region, amount: r.amount }))} barClass="bg-teal-400" />
                            </div>
                            <div>
                                <div className="text-[10px] font-bold text-slate-500 mb-1.5">발주 상위 권역</div>
                                <RankBarList items={rg.orderByRegion.map(r => ({ name: r.region, amount: r.amount }))} barClass="bg-indigo-400" />
                            </div>
                        </div>
                        {regionNote && (
                            <p className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed">{regionNote.content}</p>
                        )}
                        {showUnmatchedWarning && (
                            <div className="mt-2.5 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                견적 {rg.unmatchedQuotationShare}%, 발주 {rg.unmatchedOrderShare}%가 &quot;{rg.unmatchedLabel}&quot;로 분류되어 권역별 수치의 신뢰도가 제한적입니다.
                            </div>
                        )}
                    </SectionCard>
                );
            })()}

            {/* 추세 모멘텀 */}
            {m.trendSeries && m.trendSeries.buckets.length > 1 && (() => {
                const buckets = m.trendSeries!.buckets;
                const momentumNote = (report.aiSections || []).find(sec => sec.title.includes('모멘텀'));
                return (
                    <SectionCard icon={Activity} title={`추세 모멘텀 (최근 ${buckets.length}구간)`} accentText="text-teal-700">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <TrendSparkline
                                label="견적 금액"
                                series={buckets.map(b => ({ periodKey: b.periodKey, value: b.quotationAmount }))}
                                barClass="bg-teal-400"
                            />
                            <TrendSparkline
                                label="발주 금액"
                                series={buckets.map(b => ({ periodKey: b.periodKey, value: b.orderAmount }))}
                                barClass="bg-indigo-400"
                            />
                        </div>
                        {momentumNote && (
                            <p className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed">{momentumNote.content}</p>
                        )}
                    </SectionCard>
                );
            })()}

            {/* 재고 액션 제안 */}
            {m.inventoryActionAnalysis && (() => {
                const act = m.inventoryActionAnalysis!;
                return (
                    <SectionCard icon={PackageSearch} title="재고 액션 제안 (최근 활동 상위 품목)" accentText="text-rose-700">
                        {act.insufficientData ? (
                            <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                {act._note}
                            </div>
                        ) : act.items.length === 0 ? (
                            <div className="text-[11px] text-slate-400 py-1">분석 가능한 품목이 없습니다.</div>
                        ) : (
                            <div className="space-y-2.5">
                                {act.items.map(item => (
                                    <div key={item.id} className="border border-slate-100 rounded-lg p-2.5">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <span className="text-[11px] font-bold text-slate-700 truncate">{item.name}</span>
                                            <ActionBadge category={item.category} />
                                        </div>
                                        <div className="flex items-center gap-2.5 text-[10px] text-slate-500 mb-1">
                                            <span>현재고 {item.currentStock.toLocaleString()}개</span>
                                            <ChangeBadge value={item.trendPct} />
                                            {item.daysOnHand !== null && <span>· 소진예상 {item.daysOnHand}일</span>}
                                        </div>
                                        <p className="text-[10px] text-slate-500 leading-relaxed">{item.reason}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                );
            })()}

            {/* AI 교차분석 & 추천 액션 */}
            {(report.aiSections || []).filter(sec => sec.title.includes('교차')).map((sec, i) => (
                <div key={i} className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-xs font-black text-indigo-800 mb-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> {sec.title}
                    </div>
                    <p className="text-[11px] text-indigo-900 leading-relaxed whitespace-pre-line">{sec.content}</p>
                </div>
            ))}

            {(report.aiRecommendations || []).length > 0 && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                    <div className="text-xs font-black text-teal-800 mb-2">향후 1~2개월 준비 방향</div>
                    <ul className="space-y-1.5">
                        {report.aiRecommendations!.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-[11px] text-teal-900">
                                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                                <span>{rec}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* AI 텍스트 전문 / 원본 데이터 토글 (PDF에는 AI 텍스트 해설은 항상 포함, 원본 JSON은 제외) */}
            <div className="print:hidden flex items-center gap-4 pt-1">
                <button
                    onClick={() => setShowText(v => !v)}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <Info className="w-3 h-3" />
                    {showText ? '▲ AI 텍스트 해설 숨기기' : '▼ AI 텍스트 해설 전문 보기'}
                </button>
                <button
                    onClick={() => setShowRawMetrics(v => !v)}
                    className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
                >
                    {showRawMetrics ? '▲ 원본 집계 데이터 숨기기' : '▼ 원본 집계 데이터 보기'}
                </button>
            </div>

            <div className={showText ? 'space-y-3' : 'hidden print:block print:space-y-3'}>
                <div className="hidden print:block text-xs font-black text-slate-700">AI 텍스트 해설 전문</div>
                {(report.aiSections || []).map((section, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-200/60 rounded-xl p-4">
                        <div className="text-xs font-black text-slate-700 mb-1.5">{section.title}</div>
                        <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">{section.content}</p>
                    </div>
                ))}
            </div>

            {showRawMetrics && (
                <pre className="print:hidden bg-slate-900 text-slate-300 text-[10px] p-3 rounded-lg overflow-x-auto max-h-96">
                    {JSON.stringify(report.metrics, null, 2)}
                </pre>
            )}

            <div className="text-[9px] text-slate-400">
                생성: {new Date(report.generatedAt).toLocaleString('ko-KR')} · 모델: {report.model || '-'}
                {report.tokenUsage && ` · 토큰: 입력 ${report.tokenUsage.input.toLocaleString()} / 출력 ${report.tokenUsage.output.toLocaleString()}`}
            </div>
        </div>
    );
}

export default function AdminAiReports() {
    const user = useStore(state => state.auth.user);

    const [activePeriod, setActivePeriod] = useState<ReportPeriod>('weekly');
    const [reports, setReports] = useState<AiReport[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const fetchReports = useCallback(async (period: ReportPeriod) => {
        try {
            setLoading(true);
            setError(null);
            const token = useStore.getState().auth.token;
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(
                (import.meta.env.VITE_API_URL || '') + `/api/admin/ai-reports?period=${period}&limit=20`,
                { headers }
            );
            if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
            const data = await res.json();
            setReports(data.reports || []);
        } catch (err) {
            console.error('Failed to fetch AI reports:', err);
            setError('리포트를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user?.role !== 'MASTER') return;
        fetchReports(activePeriod);
    }, [activePeriod, fetchReports, user?.role]);

    const handleManualGenerate = async () => {
        try {
            setGenerating(true);
            setError(null);
            const token = useStore.getState().auth.token;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/admin/ai-reports/generate', {
                method: 'POST',
                headers,
                body: JSON.stringify({ period: activePeriod }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `요청 실패 (${res.status})`);
            }
            await fetchReports(activePeriod);
        } catch (err) {
            console.error('Failed to manually generate AI report:', err);
            setError(err instanceof Error ? err.message : '리포트 생성에 실패했습니다.');
        } finally {
            setGenerating(false);
        }
    };

    // MASTER 전용 — AdminRoute는 MASTER/MANAGER/admin을 모두 통과시키므로 페이지 내부에서 별도 가드 필요
    if (user?.role !== 'MASTER') {
        return <Navigate to="/admin/orders" replace />;
    }

    return (
        <CalmPageShell clean>
            <style>{PRINT_STYLE}</style>

            <div className="print:hidden flex items-center justify-between mb-6 flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <Bot className="w-6 h-6 text-teal-600" />
                    <h1 className="text-xl font-black text-slate-800">AI 경영 리포트</h1>
                    <span className="text-xs font-bold text-slate-400 ml-1">MASTER 전용</span>
                </div>
                <button
                    onClick={handleManualGenerate}
                    disabled={generating}
                    className="flex items-center gap-1.5 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white px-3 py-2 rounded-lg transition-colors"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
                    {generating ? '생성 중...' : `지금 ${PERIOD_TABS.find(t => t.key === activePeriod)?.label} 리포트 생성`}
                </button>
            </div>

            <p className="print:hidden text-[11px] text-slate-500 mb-4 leading-relaxed">
                견적/발주/재고/업체 트렌드를 서버가 주간(매주 월요일)·월간(매월 1일)·분기(1/4/7/10월 1일)·반기(1/7월 1일)
                주기로 자동 집계하여 AI 엔진에게 분석을 요청한 결과입니다. 이 리포트는 "탐구의 출발점"이며,
                더 깊게 파고들 방향은 하단의 원본 집계 데이터를 참고해 직접 결정하세요.
            </p>

            <div className="print:hidden flex items-center bg-slate-200/60 p-1 rounded-lg w-fit mb-5">
                {PERIOD_TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActivePeriod(tab.key)}
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                            activePeriod === tab.key ? 'bg-white text-teal-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="print:hidden flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-4 py-3 rounded-xl mb-4">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-center py-16 text-sm text-slate-400">불러오는 중...</div>
            ) : reports.length === 0 ? (
                <div className="text-center py-16 text-sm text-slate-400">아직 생성된 리포트가 없습니다.</div>
            ) : (
                <div className="space-y-3">
                    {reports.map(report => {
                        const isExpanded = expandedId === report.id;
                        const m = report.metrics;
                        const previewMarginPct = m && m.orderTrend.totalAmount > 0
                            ? ((m.orderTrend.estimatedMargin / m.orderTrend.totalAmount) * 100).toFixed(1)
                            : null;
                        return (
                            <div key={report.id} className={`bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs ${isExpanded ? '' : 'print:hidden'}`}>
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : report.id)}
                                    className="print:hidden w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="text-sm font-black text-slate-800">{report.periodKey}</span>
                                            <span
                                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                    report.status === 'SUCCESS'
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : 'bg-rose-100 text-rose-700'
                                                }`}
                                            >
                                                {report.status === 'SUCCESS' ? '완료' : '실패'}
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                {fmtDate(report.rangeStart)} ~ {fmtDate(report.rangeEnd)}
                                            </span>
                                            {m && (
                                                <span className="flex items-center gap-2 text-[10px] font-bold text-slate-500 ml-1">
                                                    <span className="inline-flex items-center gap-0.5"><FileText className="w-3 h-3 text-teal-500" />{formatWon(m.quotationTrend.totalAmount)}</span>
                                                    <span className="inline-flex items-center gap-0.5"><ShoppingCart className="w-3 h-3 text-indigo-500" />{formatWon(m.orderTrend.totalAmount)}</span>
                                                    {previewMarginPct !== null && (
                                                        <span className="inline-flex items-center gap-0.5"><TrendingUp className="w-3 h-3 text-emerald-500" />마진 {previewMarginPct}%</span>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 truncate max-w-2xl">
                                            {report.status === 'SUCCESS' ? (report.aiSummary || '') : (report.errorMessage || '생성 실패')}
                                        </p>
                                    </div>
                                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0 ml-3" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-3" />}
                                </button>

                                {isExpanded && (
                                    <div className="px-5 pb-5 border-t border-slate-100 pt-4">
                                        {report.status === 'FAILED' ? (
                                            <div className="text-xs text-rose-600">{report.errorMessage}</div>
                                        ) : (
                                            <ReportDashboard report={report} />
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </CalmPageShell>
    );
}
