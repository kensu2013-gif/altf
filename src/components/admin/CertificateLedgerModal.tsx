import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, Download, RefreshCw, FileText, CheckCircle2, AlertTriangle, ShieldCheck, FolderOpen, Filter, Copy, Sparkles } from 'lucide-react';
import type { CertificateLedgerRow } from '../../data/certificateSchema';

interface CertificateLedgerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onViewPdf: (filename: string) => void;
    onOpenFolder: () => void;
}

export const CertificateLedgerModal: React.FC<CertificateLedgerModalProps> = ({
    isOpen,
    onClose,
    onViewPdf,
    onOpenFolder
}) => {
    const [rows, setRows] = useState<CertificateLedgerRow[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [syncing, setSyncing] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [gradeFilter, setGradeFilter] = useState<string>('ALL');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [viewMode, setViewMode] = useState<'standard' | 'template_copy'>('standard');
    const [copiedToast, setCopiedToast] = useState<string | null>(null);
    const [stats, setStats] = useState<{
        totalItems: number;
        passCount: number;
        warnCount: number;
        failCount: number;
        passRate: string;
        outliersCount: number;
    } | null>(null);

    // 장부 데이터 로드
    const fetchLedger = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/certificates');
            const data = await res.json();
            if (data.success && data.rows) {
                setRows(data.rows);
                if (data.stats) setStats(data.stats);
            }
        } catch (err) {
            console.error('Failed to fetch certificate ledger:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchLedger();
        }
    }, [isOpen]);

    // 전체 PDF 일괄 파싱 및 장부 동기화 트리거 (QC-02 에이전트 실행)
    const handleParseAll = async () => {
        setSyncing(true);
        try {
            const res = await fetch('/api/qc/qc02/run', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setRows(data.rows || []);
                if (data.stats) setStats(data.stats);
                setCopiedToast(`QC-02 판독 완료! 총 ${data.totalRowsCount}개 품목이 엑셀에 누적 저장되었습니다.`);
                setTimeout(() => setCopiedToast(null), 4000);
            }
        } catch (err) {
            console.error('Failed to run QC-02 agent:', err);
        } finally {
            setSyncing(false);
        }
    };

    // 엑셀 다운로드
    const handleDownloadExcel = () => {
        window.open('/api/certificates/download-excel', '_blank');
    };

    // 📋 성적서 양식.xlsx 3열 병합 간격 맞춤 클립보드 복사
    // 성적서 양식의 C, Si, Mn, P, S, Ni, Cr, Mo / YS, TS, EL 각 셀이 3열 병합되어 있으므로 3칸 탭 간격으로 복사
    const handleCopyForTemplate = (targetRows: CertificateLedgerRow[]) => {
        if (targetRows.length === 0) return;
        
        const lines = targetRows.map(r => {
            // C(H~J), Si(K~M), Mn(N~P), P(Q~S), S(T~V), Ni(W~Y), Cr(Z~AB), Mo(AC~AE) / YS, TS, EL
            return [
                r.chemC ?? 0, '', '',
                r.chemSi ?? 0, '', '',
                r.chemMn ?? 0, '', '',
                r.chemP ?? 0, '', '',
                r.chemS ?? 0, '', '',
                r.chemNi ?? 0, '', '',
                r.chemCr ?? 0, '', '',
                r.chemMo ?? 0, '', '',
                r.mechYs ?? 0, '', '',
                r.mechTs ?? 0, '', '',
                r.mechEl ?? 0
            ].join('\t');
        }).join('\n');

        navigator.clipboard.writeText(lines);
        setCopiedToast(`${targetRows.length}개 품목의 성분값이 '성적서 양식.xlsx'(3열 병합 간격)으로 복사되었습니다! 엑셀에 바로 붙여넣기(Ctrl+V)하세요.`);
        setTimeout(() => setCopiedToast(null), 4000);
    };

    // 필터링된 행 목록
    const filteredRows = useMemo(() => {
        return rows.filter(r => {
            // 텍스트 검색
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matched = 
                    (r.certNo && r.certNo.toLowerCase().includes(q)) ||
                    (r.poNo && r.poNo.toLowerCase().includes(q)) ||
                    (r.heatNo && r.heatNo.toLowerCase().includes(q)) ||
                    (r.lotNo && r.lotNo.toLowerCase().includes(q)) ||
                    (r.description && r.description.toLowerCase().includes(q)) ||
                    (r.customer && r.customer.toLowerCase().includes(q)) ||
                    (r.specMaterial && r.specMaterial.toLowerCase().includes(q));
                if (!matched) return false;
            }

            // 강종 필터
            if (gradeFilter !== 'ALL') {
                const is316 = (r.specMaterial && r.specMaterial.includes('316')) || 
                              (r.specInspection && r.specInspection.includes('316')) || 
                              (r.chemMo > 1.5);
                if (gradeFilter === 'STS316L' && !is316) return false;
                if (gradeFilter === 'STS304' && is316) return false;
            }

            // 상태 필터
            if (statusFilter !== 'ALL') {
                const s = r.quality?.status || 'PASS';
                if (s !== statusFilter) return false;
            }

            return true;
        });
    }, [rows, searchQuery, gradeFilter, statusFilter]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
            <div className="bg-[#0A0F1D] border border-cyan-500/40 rounded-2xl w-full max-w-[96vw] h-[92vh] flex flex-col shadow-[0_0_60px_rgba(6,182,212,0.25)] overflow-hidden">
                {/* 1. 모달 상단 헤더 */}
                <div className="p-3.5 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-white tracking-wide">
                                    품질부 (QC-02) 공인 성적서 관리 대장 & 3열 병합 복사 연동
                                </h2>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                                    대경벤드 성적서.xlsx (Sheet1: 대장 / Sheet2: 3열병합복사)
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-mono">
                                storage/certificates/대경벤드 성적서.xlsx · 다중 페이지(10~30p) 전수 판독 및 '성적서 양식.xlsx' 1:1 클립보드 호환
                            </p>
                        </div>
                    </div>

                    {/* 우측 상단 액션 버튼 그룹 */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handleCopyForTemplate(filteredRows)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/50 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                            title="현재 필터된 품목의 성분값을 성적서 양식(3열 병합 간격)으로 클립보드 복사"
                        >
                            <Copy className="w-3.5 h-3.5" />
                            <span>📋 양식 복사 (3열 병합)</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadExcel}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                            title="엑셀(XLSX) 원장 다운로드 (2개 시트 포함)"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span>엑셀 다운로드 (2개 시트)</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleParseAll}
                            disabled={syncing}
                            className="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                            title="QC-02 에이전트: 전체 PDF 재스캔 및 장부 자동 동기화"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                            <span>{syncing ? 'QC-02 판독 중...' : '🚀 QC-02 전수 판독 & 대장 누적'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={onOpenFolder}
                            className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                            title="내 컴퓨터 저장 폴더 열기"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>폴더 열기</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer ml-1"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 복사 완료 알림 토스트 배너 */}
                {copiedToast && (
                    <div className="px-4 py-2 bg-gradient-to-r from-indigo-950 via-cyan-950 to-slate-900 border-b border-cyan-500/40 flex items-center justify-between text-xs text-cyan-200 animate-fadeIn">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
                            <span className="font-semibold">{copiedToast}</span>
                        </div>
                        <button 
                            type="button" 
                            onClick={() => setCopiedToast(null)}
                            className="text-slate-400 hover:text-white"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* 2. KPI 대시보드 및 필터 툴바 */}
                <div className="p-3 bg-[#0d162b] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    {/* 뷰 모드 탭 & 통계 KPI */}
                    <div className="flex items-center gap-2 text-xs">
                        <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
                            <button
                                type="button"
                                onClick={() => setViewMode('standard')}
                                className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                                    viewMode === 'standard' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                📊 표준 26개 컬럼 대장
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('template_copy')}
                                className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                                    viewMode === 'template_copy' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                📋 성적서 양식 복사용 (3열 병합 간격)
                            </button>
                        </div>

                        <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2">
                            <span className="text-slate-400 font-bold">누적 등록:</span>
                            <span className="text-cyan-300 font-mono font-bold text-sm">{rows.length}건</span>
                        </div>
                        <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-emerald-900/50 flex items-center gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-slate-400 font-bold">합격률:</span>
                            <span className="text-emerald-300 font-mono font-bold text-sm">
                                {stats?.passRate || '100.0%'}
                            </span>
                        </div>
                        <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-slate-400 font-bold">이상치:</span>
                            <span className={`font-mono font-bold text-sm ${stats?.outliersCount ? 'text-amber-400' : 'text-slate-300'}`}>
                                {stats?.outliersCount || 0}건
                            </span>
                        </div>
                    </div>

                    {/* 검색 및 필터 컨트롤 */}
                    <div className="flex items-center gap-2 flex-1 justify-end min-w-[320px]">
                        <div className="relative flex-1 max-w-xs">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="HEAT, LOT, PO, CERT No, 규격 검색..."
                                className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                            />
                        </div>

                        {/* 강종 필터 */}
                        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                            <Filter className="w-3 h-3 text-slate-400 ml-1" />
                            <button
                                type="button"
                                onClick={() => setGradeFilter('ALL')}
                                className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                                    gradeFilter === 'ALL' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                전체
                            </button>
                            <button
                                type="button"
                                onClick={() => setGradeFilter('STS304')}
                                className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                                    gradeFilter === 'STS304' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                STS304
                            </button>
                            <button
                                type="button"
                                onClick={() => setGradeFilter('STS316L')}
                                className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                                    gradeFilter === 'STS316L' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                STS316L
                            </button>
                        </div>

                        {/* 판정 상태 필터 */}
                        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                            {(['ALL', 'PASS', 'WARN', 'FAIL'] as const).map(st => (
                                <button
                                    key={st}
                                    type="button"
                                    onClick={() => setStatusFilter(st)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                                        statusFilter === st ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {st === 'ALL' ? '전체 상태' : st}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 3. 26개 컬럼 대형 데이터 그리드 테이블 */}
                <div className="flex-1 overflow-auto bg-[#070b14]">
                    {loading ? (
                        <div className="h-full flex items-center justify-center flex-col gap-2 text-slate-400">
                            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                            <span className="text-xs">성적서 장부 데이터를 로드하고 있습니다...</span>
                        </div>
                    ) : filteredRows.length === 0 ? (
                        <div className="h-full flex items-center justify-center flex-col gap-2 text-slate-400">
                            <FileText className="w-8 h-8 text-slate-600" />
                            <span className="text-xs">조건에 맞는 성적서 품목이 없습니다.</span>
                        </div>
                    ) : (
                        <table className="w-full text-[11px] text-left border-collapse font-mono whitespace-nowrap">
                            <thead className="sticky top-0 z-20 bg-slate-900 border-b border-cyan-500/30 text-slate-300 text-[10px] uppercase font-bold tracking-wider select-none shadow-md">
                                <tr>
                                    <th className="p-2 border-r border-slate-800 text-center bg-slate-900 sticky left-0 z-30">품질판정</th>
                                    <th className="p-2 border-r border-slate-800">일 자</th>
                                    <th className="p-2 border-r border-slate-800">Customer</th>
                                    <th className="p-2 border-r border-slate-800">공급처</th>
                                    <th className="p-2 border-r border-slate-800">P.O No</th>
                                    <th className="p-2 border-r border-slate-800 text-cyan-300">CERT-No</th>
                                    <th className="p-2 border-r border-slate-800">Spec MATERIAL</th>
                                    <th className="p-2 border-r border-slate-800">Spec INSPECTION</th>
                                    <th className="p-2 border-r border-slate-800 text-amber-300">HEAT No</th>
                                    <th className="p-2 border-r border-slate-800">LOT No</th>
                                    <th className="p-2 border-r border-slate-800 text-center">ITEM</th>
                                    <th className="p-2 border-r border-slate-800">DESCRIPTION</th>
                                    <th className="p-2 border-r border-slate-800 text-right">Q'TY</th>
                                    <th className="p-2 border-r border-slate-800">MATERIAL</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">C</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">Si</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">Mn</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">P</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">S</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">Ni</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">Cr</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-pink-300">Mo</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-emerald-300">Y.S</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-emerald-300">T.S</th>
                                    <th className="p-2 border-r border-slate-800 text-right text-emerald-300">E.L</th>
                                    <th className="p-2 border-r border-slate-800 text-center">외관/치수</th>
                                    <th className="p-2 text-center sticky right-0 bg-slate-900 z-20">양식복사 / PDF</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/80">
                                {filteredRows.map((r, idx) => {
                                    const q = r.quality || { status: 'PASS', hasOutliers: false, outliers: [] };
                                    const isPass = q.status === 'PASS';
                                    const isWarn = q.status === 'WARN';
                                    const isFail = q.status === 'FAIL';

                                    return (
                                        <tr
                                            key={idx}
                                            className="hover:bg-cyan-950/20 transition-colors group"
                                        >
                                            {/* 품질 판정 뱃지 */}
                                            <td className="p-2 text-center border-r border-slate-800 bg-[#070b14] group-hover:bg-[#0c182b] sticky left-0 z-10">
                                                <span
                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                        isPass 
                                                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' 
                                                            : isWarn
                                                                ? 'bg-amber-950 text-amber-400 border border-amber-500/40'
                                                                : isFail
                                                                    ? 'bg-rose-950 text-rose-400 border border-rose-500/40'
                                                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                                    }`}
                                                    title={q.outliers?.join(' | ') || '규격 적합 (OK)'}
                                                >
                                                    {q.status}
                                                </span>
                                            </td>

                                            <td className="p-2 border-r border-slate-800 text-slate-300">{r.issueDate}</td>
                                            <td className="p-2 border-r border-slate-800 text-slate-200 font-sans font-medium">{r.customer}</td>
                                            <td className="p-2 border-r border-slate-800 text-slate-400">{r.supplier}</td>
                                            <td className="p-2 border-r border-slate-800 text-cyan-400">{r.poNo}</td>
                                            <td className="p-2 border-r border-slate-800 text-cyan-300 font-bold">{r.certNo}</td>
                                            <td className="p-2 border-r border-slate-800 text-slate-300">{r.specMaterial}</td>
                                            <td className="p-2 border-r border-slate-800 text-slate-400">{r.specInspection}</td>
                                            <td className="p-2 border-r border-slate-800 text-amber-300 font-bold">{r.heatNo}</td>
                                            <td className="p-2 border-r border-slate-800 text-slate-400">{r.lotNo}</td>
                                            <td className="p-2 border-r border-slate-800 text-center text-slate-400">{r.itemNo}</td>
                                            <td className="p-2 border-r border-slate-800 text-white font-bold">{r.description}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-emerald-300 font-bold">{r.qty}</td>
                                            <td className="p-2 border-r border-slate-800 text-slate-400">{r.material}</td>

                                            {/* 화학 성분 (C, Si, Mn, P, S, Ni, Cr, Mo) */}
                                            <td className="p-2 border-r border-slate-800 text-right text-slate-300">{r.chemC ? r.chemC.toFixed(3) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-slate-300">{r.chemSi ? r.chemSi.toFixed(2) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-slate-300">{r.chemMn ? r.chemMn.toFixed(2) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-slate-300">{r.chemP ? r.chemP.toFixed(3) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-slate-300">{r.chemS ? r.chemS.toFixed(3) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-pink-300 font-bold">{r.chemNi ? r.chemNi.toFixed(2) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-pink-300 font-bold">{r.chemCr ? r.chemCr.toFixed(2) : '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-pink-300 font-bold">{r.chemMo ? r.chemMo.toFixed(2) : '-'}</td>

                                            {/* 기계적 성질 (Y.S, T.S, E.L) */}
                                            <td className="p-2 border-r border-slate-800 text-right text-emerald-300 font-bold">{r.mechYs || '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-emerald-300 font-bold">{r.mechTs || '-'}</td>
                                            <td className="p-2 border-r border-slate-800 text-right text-emerald-300 font-bold">{r.mechEl || '-'}</td>

                                            <td className="p-2 border-r border-slate-800 text-center text-emerald-400 font-bold">{r.dimensionVi || 'GOOD'}</td>

                                            {/* 양식 복사 및 PDF 미리보기 액션 버튼 */}
                                            <td className="p-2 text-center sticky right-0 bg-[#070b14] group-hover:bg-[#0c182b]">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyForTemplate([r])}
                                                        className="px-2 py-0.5 rounded bg-indigo-950 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                                        title="이 품목 성분값을 성적서 양식(3열 병합 간격)으로 복사"
                                                    >
                                                        <Copy className="w-2.5 h-2.5" />
                                                        <span>양식복사</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onViewPdf(r.pdfUrl)}
                                                        className="px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-500 hover:text-black text-cyan-300 border border-cyan-500/40 text-[10px] font-bold cursor-pointer transition-colors"
                                                        title="원본 PDF 즉시 보기"
                                                    >
                                                        미리보기
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* 4. 모달 하단 상태 바 */}
                <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
                    <div className="flex items-center gap-3">
                        <span>표시 중: <strong className="text-cyan-300">{filteredRows.length}</strong> / {rows.length}개 품목</span>
                        <span>·</span>
                        <span className="text-slate-500">대경벤드 실시간 수집 및 KS B 1543 26개 컬럼 장부</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Google Drive:</span>
                        <span className="text-cyan-400 text-[11px]">내 드라이브 &gt; ALTF 통합문서 &gt; ALTF_성적서 &gt; 대경벤드 성적서.xlsx</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
