import { useState, useEffect } from 'react';
import { 
    X, 
    FileText, 
    Download, 
    FolderOpen, 
    Sparkles, 
    RefreshCw,
    ExternalLink,
    CheckCircle2,
    Eye,
    Table
} from 'lucide-react';

export interface IssuedCertRecord {
    id: string;
    poNo: string;
    certNo: string;
    customer: string;
    issueDate: string;
    sheetName: string;
    heatTreatment: string;
    itemCount: number;
    excelPath: string;
    excelUrl: string;
    pdfPath: string;
    pdfUrl: string;
    specMaterial?: string;
    specInspection?: string;
    outboundNo?: string;
    isOutbound?: boolean;
    location?: string;
    issuedAt: string;
    items: Array<{
        itemNo: number;
        lineNo?: string;
        description: string;
        qty: number;
        heatNo: string;
        lotNo: string;
        specMaterial: string;
        specInspection: string;
        startingMaterial: string;
        chem?: {
            C?: string | number;
            Si?: string | number;
            Mn?: string | number;
            P?: string | number;
            S?: string | number;
            Ni?: string | number;
            Cr?: string | number;
            Mo?: string | number;
        };
        mech?: {
            ys?: string | number;
            ts?: string | number;
            el?: string | number;
        };
    }>;
}

export interface AvailableOrder {
    poNumber: string;
    customerName: string;
    itemCount: number;
    createdAt: string;
}

interface CertificateIssuerModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialPoNo?: string;
}

export function CertificateIssuerModal({ isOpen, onClose, initialPoNo }: CertificateIssuerModalProps) {
    const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([]);
    const [issuedRecords, setIssuedRecords] = useState<IssuedCertRecord[]>([]);
    const [selectedPoNo, setSelectedPoNo] = useState<string>(initialPoNo || 'A202610150');
    const [customerName, setCustomerName] = useState<string>('(주)태양밴드');
    const [certNoInput, setCertNoInput] = useState<string>('YR-26-07015');
    const [viewMode, setViewMode] = useState<'cards' | 'preview'>('cards');
    const [loading, setLoading] = useState(false);
    const [issuing, setIssuing] = useState(false);

    // 발주서 및 발행 기록 로드
    useEffect(() => {
        if (isOpen) {
            loadAvailableOrders();
            loadIssuedList(selectedPoNo);
        }
    }, [isOpen]);

    const loadAvailableOrders = async () => {
        try {
            const res = await fetch('/api/qc/qc06/orders');
            const data = await res.json();
            if (data.success && Array.isArray(data.orders)) {
                setAvailableOrders(data.orders);
            }
        } catch (err) {
            console.error('발주 목록 로드 실패:', err);
        }
    };

    const loadIssuedList = async (poNo?: string) => {
        try {
            setLoading(true);
            const targetPo = poNo !== undefined ? poNo : selectedPoNo;
            const query = targetPo ? `?poNo=${encodeURIComponent(targetPo)}` : '';
            const res = await fetch(`/api/qc/qc06/issued-list${query}`);
            const data = await res.json();
            if (data.success && Array.isArray(data.items)) {
                setIssuedRecords(data.items);
                if (data.items.length > 0) {
                    setCustomerName(data.items[0].customer || '(주)태양밴드');
                }
            }
        } catch (err) {
            console.error('성적서 발행 목록 로드 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    // 발주서 선택 핸들러
    const handleSelectOrder = (po: string) => {
        setSelectedPoNo(po);
        const order = availableOrders.find(o => o.poNumber === po);
        if (order) {
            setCustomerName(order.customerName);
        }
        loadIssuedList(po);
    };

    // 3번째 사진 실데이터(A202610150 - (주)태양밴드, JCQ4366, STS316L) 즉시 발행 및 보기
    const handleIssueOutboundSample = async () => {
        try {
            setIssuing(true);
            const res = await fetch('/api/qc/qc06/test-outbound-sample', {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
                setSelectedPoNo('A202610150');
                setCustomerName('(주)태양밴드');
                setCertNoInput('YR-26-07015');
                await loadIssuedList('A202610150');
            }
        } catch (err) {
            console.error('3번 사진 출고지시서 성적서 발행 실패:', err);
        } finally {
            setIssuing(false);
        }
    };

    // 첨부 사진 1·2번 샘플 즉시 발행 및 보기 (월드원플랜에탈)
    const handleIssueSample = async () => {
        try {
            setIssuing(true);
            const res = await fetch('/api/qc/qc06/test-sample', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setSelectedPoNo('ES260709-1974');
                setCustomerName('월드원플랜에탈');
                setCertNoInput('YR-26-07015');
                await loadIssuedList('ES260709-1974');
            }
        } catch (err) {
            console.error('샘플 성적서 발행 실패:', err);
        } finally {
            setIssuing(false);
        }
    };

    // 현재 선택된 출고지시서/발주서로 성적서 자동 분할 발행 (6개 단위)
    const handleIssueCertificates = async () => {
        if (!selectedPoNo) {
            alert('출고지시서 또는 발주번호를 입력해주세요.');
            return;
        }
        try {
            setIssuing(true);
            const res = await fetch('/api/qc/qc06/issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    poNo: selectedPoNo,
                    customer: customerName,
                    certNo: certNoInput || undefined
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(`성적서 ${data.count}건이 자동 발행되었습니다!\n(원본 서식/WordArt 100% 복원 & MS Excel 순정 PDF 변환 완료)`);
                await loadIssuedList(selectedPoNo);
            } else {
                alert(`발행 실패: ${data.error || '오류 발생'}`);
            }
        } catch (err) {
            console.error('성적서 발행 실패:', err);
            alert('성적서 발행 중 통신 오류가 발생했습니다.');
        } finally {
            setIssuing(false);
        }
    };

    // MS Excel 프로그램으로 사용자 PC에서 즉시 열기 & 직접 수정
    const handleOpenExcel = async (record: IssuedCertRecord) => {
        try {
            const res = await fetch('/api/qc/qc06/open-excel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    poNo: record.poNo,
                    excelPath: record.excelPath
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(`PC의 Microsoft Excel 프로그램으로 성적서를 열었습니다!\n(${data.path || record.excelPath})`);
            } else {
                alert(`엑셀 열기 실패: ${data.error}`);
            }
        } catch (err) {
            console.error('엑셀 열기 오류:', err);
        }
    };

    // DAT-10 보관 폴더 탐색기 열기
    const handleOpenFolder = async () => {
        try {
            await fetch('/api/qc/qc06/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ poNo: selectedPoNo })
            });
        } catch (err) {
            console.error('폴더 열기 오류:', err);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-6xl max-h-[96vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* 상단 모달 헤더 */}
                <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-slate-700/80 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-indigo-600/30 border border-indigo-400/40 text-indigo-300">
                            <FileText className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white tracking-tight">품질부 QC-06 성적서 발행봇</h2>
                                <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">대리</span>
                                <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-medium">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    MS Office 순정 PDF 변환 & WordArt 100% 복원
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                재고출고분 전담 · 업체LOT(대경벤드 LOT) 기준 규격/시험값 100% 매칭 · 원본 서식 완벽 보존 엑셀 및 PDF 다운로드
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 제어 바: 지시서 선택 & 원클릭 발행 액션 */}
                <div className="px-6 py-3 bg-slate-800/60 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700">
                            <span className="text-slate-400 font-medium">출고지시서/PO:</span>
                            <input 
                                type="text"
                                value={selectedPoNo}
                                onChange={(e) => setSelectedPoNo(e.target.value)}
                                placeholder="예: A202610150"
                                className="bg-transparent text-white font-mono font-bold focus:outline-none w-36"
                            />
                        </div>

                        {/* 출고지시서 및 발주서 빠른 선택 드롭다운 */}
                        <select 
                            onChange={(e) => handleSelectOrder(e.target.value)}
                            value={selectedPoNo}
                            className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
                        >
                            <option value="A202610150">📦 [3번 사진] A202610150 ((주)태양밴드 - JCQ4366, STS316L)</option>
                            <option value="ES260709-1974">📌 [1·2번 사진] ES260709-1974 (월드원플랜에탈 - 34품목)</option>
                            {availableOrders.map(o => (
                                <option key={o.poNumber} value={o.poNumber}>
                                    {o.poNumber} - {o.customerName} ({o.itemCount}품목)
                                </option>
                            ))}
                        </select>

                        <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700">
                            <span className="text-slate-400 font-medium">고객사:</span>
                            <input 
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                className="bg-transparent text-white focus:outline-none w-28"
                            />
                        </div>

                        <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700">
                            <span className="text-slate-400 font-medium">성적서No:</span>
                            <input 
                                type="text"
                                value={certNoInput}
                                onChange={(e) => setCertNoInput(e.target.value)}
                                className="bg-transparent text-white font-mono focus:outline-none w-28"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleIssueOutboundSample}
                            disabled={issuing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.25)] cursor-pointer"
                            title="3번 사진의 실제 출고지시서 데이터((주)태양밴드 / A202610150 / 업체LOT JCQ4366)를 성적서 양식.xlsx에 100% 서식 보존 주입 및 MS Excel 순정 PDF 변환"
                        >
                            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                            [3번 사진] 태양밴드 재고출고 로드
                        </button>

                        <button
                            onClick={handleIssueSample}
                            disabled={issuing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-medium transition-all cursor-pointer"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            [1·2번 사진] 월드원 로드
                        </button>

                        <button
                            onClick={handleIssueCertificates}
                            disabled={issuing}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${issuing ? 'animate-spin' : ''}`} />
                            {issuing ? '성적서 생성중...' : '성적서 일괄 자동 발행'}
                        </button>
                    </div>
                </div>

                {/* 📌 시화/부산/시흥 재고 출고분 전담 안내 배너 */}
                <div className="px-6 py-2 bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/60 border-b border-indigo-900/40 text-[11px] text-slate-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
                            시화·부산·시흥 재고출고 전담
                        </span>
                        <span>
                            외주 발주 = <strong>QC-01</strong> 성적서 수집 매칭 | <strong>재고 출고지시서</strong> = <strong>QC-06</strong> 원본 양식지 서식·워드아트·워터마크 100% 보존 발행
                        </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setViewMode('cards')}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                                viewMode === 'cards' 
                                    ? 'bg-indigo-600 text-white' 
                                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Table className="w-3.5 h-3.5" />
                            발행 성적서 목록 ({issuedRecords.length}건)
                        </button>
                        <button
                            onClick={() => setViewMode('preview')}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                                viewMode === 'preview' 
                                    ? 'bg-indigo-600 text-white' 
                                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Eye className="w-3.5 h-3.5" />
                            A4 규격 미리보기
                        </button>
                        <button
                            onClick={handleOpenFolder}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center gap-1 cursor-pointer"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            DAT-10 보관 폴더
                        </button>
                    </div>
                </div>

                {/* 중앙 컨텐츠 영역 */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950 relative">
                    {loading && (
                        <div className="absolute inset-0 z-30 bg-slate-950/70 backdrop-blur-xs flex flex-col items-center justify-center gap-3">
                            <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                            <span className="text-xs text-indigo-200 font-medium">성적서 데이터 로드 중...</span>
                        </div>
                    )}

                    {/* 모드 1: 실용적인 발행 성적서 카드 리스트 (Multi-Page 분할 자동 대응) */}
                    {viewMode === 'cards' && (
                        <div className="space-y-4 max-w-5xl mx-auto">
                            {issuedRecords.length === 0 ? (
                                <div className="text-center py-16 bg-slate-900/60 rounded-xl border border-slate-800">
                                    <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                    <h3 className="text-base font-bold text-slate-300">발행된 성적서가 없습니다</h3>
                                    <p className="text-xs text-slate-500 mt-1">
                                        상단의 '[3번 사진] 태양밴드 재고출고 로드' 또는 '성적서 일괄 자동 발행' 버튼을 클릭해주세요.
                                    </p>
                                </div>
                            ) : (
                                issuedRecords.map((record, rIdx) => (
                                    <div 
                                        key={record.id || rIdx} 
                                        className="bg-slate-900 border border-slate-700/80 rounded-xl p-5 shadow-xl transition-all hover:border-indigo-500/50"
                                    >
                                        {/* 카드 헤더: 성적서 번호, 양식지, 규격 */}
                                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-700/60 flex items-center justify-center text-indigo-400 font-bold font-mono text-sm">
                                                    #{rIdx + 1}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-base font-bold text-white font-mono">{record.certNo}</span>
                                                        <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-900/70 text-indigo-300 font-bold border border-indigo-700">
                                                            {record.sheetName}
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                                            총 {record.itemCount}개 품목
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                                                        <span><strong>거래처:</strong> {record.customer}</span>
                                                        <span>•</span>
                                                        <span><strong>발주/지시서:</strong> {record.poNo}</span>
                                                        <span>•</span>
                                                        <span><strong>발행일자:</strong> {record.issueDate}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 핵심 4대 액션 버튼 (PDF 다운로드, 엑셀 다운로드, 엑셀 바로 열기, 폴더 열기) */}
                                            <div className="flex flex-wrap items-center gap-2">
                                                <a
                                                    href={record.pdfUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    download={`${record.poNo}_성적서_${record.certNo}.pdf`}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-md shadow-red-600/30 transition-all cursor-pointer"
                                                    title="MS Excel 순정 렌더링으로 워터마크와 WordArt가 완벽 인쇄된 공식 PDF 다운로드"
                                                >
                                                    <Download className="w-3.5 h-3.5" />
                                                    MS Excel PDF 다운로드
                                                </a>

                                                <a
                                                    href={record.excelUrl}
                                                    download={`${record.poNo}_성적서_${record.certNo}.xlsx`}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
                                                    title="원본 DrawingML(WordArt, 텍스트박스, 로고)이 100% 복원된 원본 서식 엑셀 다운로드"
                                                >
                                                    <Download className="w-3.5 h-3.5" />
                                                    수식 엑셀 다운로드
                                                </a>

                                                <button
                                                    onClick={() => handleOpenExcel(record)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-xs font-bold transition-all cursor-pointer"
                                                    title="사용자 PC의 Microsoft Excel 프로그램으로 해당 엑셀 파일을 즉시 열어 바로 확인 및 수정"
                                                >
                                                    <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                                                    엑셀 바로 열기
                                                </button>
                                            </div>
                                        </div>

                                        {/* 규격 및 열처리 조건 요약 바 */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 my-3 text-xs bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                                            <div>
                                                <span className="text-slate-400">소재 규격 (Spec Material): </span>
                                                <span className="font-bold text-slate-200">{record.specMaterial || record.items[0]?.specMaterial}</span>
                                            </div>
                                            <div>
                                                <span className="text-slate-400">검사 규격 (Spec Inspection): </span>
                                                <span className="font-bold text-slate-200">{record.specInspection || record.items[0]?.specInspection}</span>
                                            </div>
                                            <div>
                                                <span className="text-slate-400">열처리: </span>
                                                <span className="font-medium text-amber-300">{record.heatTreatment}</span>
                                            </div>
                                        </div>

                                        {/* 포함 품목 상세 테이블 */}
                                        <div className="overflow-x-auto rounded-lg border border-slate-800">
                                            <table className="w-full text-xs text-left border-collapse">
                                                <thead className="bg-slate-800/80 text-slate-300 font-semibold">
                                                    <tr>
                                                        <th className="p-2 w-12 text-center">No</th>
                                                        <th className="p-2 font-mono text-amber-300">DKB LOT No</th>
                                                        <th className="p-2 font-mono text-cyan-300">Heat No</th>
                                                        <th className="p-2">Description</th>
                                                        <th className="p-2 text-center w-16">Q'TY</th>
                                                        <th className="p-2">Starting Mat</th>
                                                        <th className="p-2">화학 성분 (C/Ni/Cr/Mo)</th>
                                                        <th className="p-2">기계 성질 (YS/TS/EL)</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800 text-slate-300">
                                                    {record.items.map((it, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-800/40">
                                                            <td className="p-2 text-center font-mono text-slate-400">{it.itemNo || (idx + 1)}</td>
                                                            <td className="p-2 font-mono font-bold text-amber-400">{it.lotNo}</td>
                                                            <td className="p-2 font-mono font-bold text-cyan-400">{it.heatNo}</td>
                                                            <td className="p-2 font-medium text-white">{it.description}</td>
                                                            <td className="p-2 text-center font-bold font-mono text-emerald-400">{it.qty}</td>
                                                            <td className="p-2 text-slate-400">{it.startingMaterial}</td>
                                                            <td className="p-2 font-mono text-[11px] text-slate-300">
                                                                C:{it.chem?.C || '-'} | Ni:{it.chem?.Ni || '-'} | Cr:{it.chem?.Cr || '-'} {it.chem?.Mo ? `| Mo:${it.chem?.Mo}` : ''}
                                                            </td>
                                                            <td className="p-2 font-mono text-[11px] text-slate-300">
                                                                YS:{it.mech?.ys || '-'} | TS:{it.mech?.ts || '-'} | EL:{it.mech?.el || '-'}%
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* 모드 2: A4 규격 미리보기 */}
                    {viewMode === 'preview' && (
                        <div className="flex justify-center">
                            {issuedRecords.length > 0 ? (
                                <div className="w-[794px] min-h-[1123px] bg-white text-slate-900 border-2 border-black p-5 relative shadow-2xl select-text">
                                    {/* 상단 헤더: 대경벤드 로고, 타이틀, 연락처 */}
                                    <div className="flex justify-between items-start mb-2 relative z-10">
                                        <div className="flex flex-col items-center w-36">
                                            <div className="w-10 h-10 rounded-full border-[3.5px] border-[#d32f2f] flex items-center justify-center mb-1">
                                                <div className="w-5 h-6 border-l-[3.5px] border-r-[3.5px] border-[#d32f2f]"></div>
                                            </div>
                                            <div className="text-[10px] font-extrabold tracking-tight text-center text-slate-900 leading-tight">
                                                DAEKYUNG BEND<br />CO., LTD.
                                            </div>
                                        </div>

                                        <div className="text-center flex-1 pt-1">
                                            <h1 className="text-2xl font-black tracking-widest text-slate-950">INSPECTION CERTIFICATE</h1>
                                            <div className="text-xs font-bold text-slate-700 tracking-normal">(EN10204 3.1)</div>
                                        </div>

                                        <div className="text-right text-[8.5px] leading-tight text-slate-700 w-44">
                                            115, Eosil-ro, Yangsan-Si,<br />
                                            Gyeongsangnam-Do, Korea<br />
                                            TEL : 82-055-364-1800<br />
                                            FAX : 82-055-362-7074
                                        </div>
                                    </div>

                                    {/* 1. 기본 발주/성적서 정보 테이블 */}
                                    <table className="w-full border-collapse border border-black text-[9px] mb-2 relative z-10">
                                        <tbody>
                                            <tr>
                                                <td className="border border-black font-bold p-1 bg-slate-50 w-[18%]">Customer</td>
                                                <td className="border border-black p-1 font-semibold w-[32%]">{issuedRecords[0]?.customer || customerName}</td>
                                                <td className="border border-black font-bold p-1 bg-slate-50 w-[18%]">Certificate. No.</td>
                                                <td className="border border-black p-1 font-mono font-bold w-[32%] text-blue-900">{issuedRecords[0]?.certNo || certNoInput}</td>
                                            </tr>
                                            <tr>
                                                <td className="border border-black font-bold p-1 bg-slate-50">P.O. No.</td>
                                                <td className="border border-black p-1 font-mono font-bold">{issuedRecords[0]?.poNo || selectedPoNo}</td>
                                                <td className="border border-black font-bold p-1 bg-slate-50">Date of Issue</td>
                                                <td className="border border-black p-1 font-mono">{issuedRecords[0]?.issueDate || '2026.10.19'}</td>
                                            </tr>
                                            <tr>
                                                <td className="border border-black font-bold p-1 bg-slate-50">Hull No.(Project No.)</td>
                                                <td className="border border-black p-1">N/A</td>
                                                <td className="border border-black font-bold p-1 bg-slate-50">Dimension & VI</td>
                                                <td className="border border-black p-1 font-semibold text-emerald-800">GOOD</td>
                                            </tr>
                                            <tr>
                                                <td className="border border-black font-bold p-1 bg-slate-50">Spec. for Material</td>
                                                <td className="border border-black p-1 font-semibold">{issuedRecords[0]?.specMaterial || issuedRecords[0]?.items[0]?.specMaterial}</td>
                                                <td className="border border-black font-bold p-1 bg-slate-50">Spec. for Inspection</td>
                                                <td className="border border-black p-1 font-semibold">{issuedRecords[0]?.specInspection || issuedRecords[0]?.items[0]?.specInspection}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    {/* 1. ITEM DESCRIPTION */}
                                    <div className="text-[10px] font-extrabold mb-1 mt-2 text-slate-900 relative z-10">
                                        1. ITEM DESCRIPTION
                                    </div>
                                    <table className="w-full border-collapse border border-black text-[9px] text-center mb-1 relative z-10">
                                        <thead>
                                            <tr className="bg-slate-100 font-bold">
                                                <th className="border border-black p-1 w-[14%]">DKB LOT No</th>
                                                <th className="border border-black p-1 w-[8%]">Item No</th>
                                                <th className="border border-black p-1 w-[14%]">Heat No</th>
                                                <th className="border border-black p-1 w-[32%]">Description</th>
                                                <th className="border border-black p-1 w-[8%]">Q'TY</th>
                                                <th className="border border-black p-1 w-[14%]">Starting Material</th>
                                                <th className="border border-black p-1 w-[10%]">NDE(RESULT)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Array.from({ length: 6 }).map((_, idx) => {
                                                const it = issuedRecords[0]?.items[idx];
                                                return (
                                                    <tr key={idx} className="h-6">
                                                        <td className="border border-black p-1 font-mono font-bold text-red-900">{it?.lotNo || '\u00A0'}</td>
                                                        <td className="border border-black p-1 font-mono">{it ? (idx + 1) : '\u00A0'}</td>
                                                        <td className="border border-black p-1 font-mono font-bold text-blue-900">{it?.heatNo || '\u00A0'}</td>
                                                        <td className="border border-black p-1 text-left pl-2 font-medium">{it?.description || '\u00A0'}</td>
                                                        <td className="border border-black p-1 font-mono">{it?.qty || '\u00A0'}</td>
                                                        <td className="border border-black p-1">{it?.startingMaterial || (it ? 'WELDED PIPE' : '\u00A0')}</td>
                                                        <td className="border border-black p-1">{it ? 'N/A' : '\u00A0'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>

                                    {/* 열처리 조건 */}
                                    <div className="text-[8.5px] font-semibold my-1 text-slate-900 relative z-10">
                                        {issuedRecords[0]?.heatTreatment}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                {/* 하단 모달 푸터 */}
                <div className="px-6 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>데이터관리부 DAT-10 연동: 발주번호별 폴더 <code className="text-slate-300 font-mono">storage/issued_certificates/{selectedPoNo}/</code>에 영구 보관 중</span>
                    </div>
                    <button 
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
