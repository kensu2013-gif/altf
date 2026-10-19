import { useState, useEffect } from 'react';
import { 
    X, 
    FileText, 
    Download, 
    Printer, 
    FolderOpen, 
    Sparkles, 
    CheckCircle2, 
    Layers, 
    Search,
    ChevronLeft,
    ChevronRight,
    RefreshCw
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
    issuedAt: string;
    items: Array<{
        itemNo: number;
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
    const [selectedPoNo, setSelectedPoNo] = useState<string>(initialPoNo || 'ES260709-1974');
    const [customerName, setCustomerName] = useState<string>('월드원플랜에탈');
    const [certNoInput, setCertNoInput] = useState<string>('YR-26-07015');
    const [selectedPageIdx, setSelectedPageIdx] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [issuing, setIssuing] = useState(false);
    const [filterKeyword, setFilterKeyword] = useState('');

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
                    setSelectedPageIdx(0);
                    setCustomerName(data.items[0].customer || '월드원플랜에탈');
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

    // 첨부 사진 샘플 즉시 발행 및 보기
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

    // 현재 선택된 발주서로 성적서 자동 분할 발행 (6개 아이템 단위)
    const handleIssueCertificates = async () => {
        if (!selectedPoNo) {
            alert('발주번호를 입력 또는 선택해주세요.');
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
                alert(`성적서 ${data.count}건이 자동 발행되었습니다!\n(양식지 자동 매칭 & DAT-10 아카이빙 완료)`);
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

    // 인쇄 다이얼로그
    const handlePrint = () => {
        window.print();
    };

    if (!isOpen) return null;

    const currentCert = issuedRecords[selectedPageIdx] || null;
    const currentItems = currentCert?.items || [];

    // 6개 슬롯 채우기 (빈 줄은 공백 처리)
    const displayRows = [...currentItems];
    while (displayRows.length < 6) {
        displayRows.push({
            itemNo: 0,
            description: '',
            qty: 0,
            heatNo: '',
            lotNo: '',
            specMaterial: '',
            specInspection: '',
            startingMaterial: '',
            chem: {},
            mech: {}
        });
    }

    const is316L = currentCert?.sheetName?.includes('316L') || false;

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
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
                                    구글시트 6개 양식지 연동 가동중
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                발주서별 최대 6품목 자동 패킹 · 재질/규격/열처리 6개 시트 자동 판정 · 엑셀 원본 & 고해상도 PDF DAT-10 아카이빙
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 제어 바: 발주서 선택 & 발행 트리거 */}
                <div className="px-6 py-3 bg-slate-800/60 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700">
                            <span className="text-slate-400 font-medium">발주서(PO):</span>
                            <input 
                                type="text"
                                value={selectedPoNo}
                                onChange={(e) => setSelectedPoNo(e.target.value)}
                                placeholder="예: ES260709-1974"
                                className="bg-transparent text-white font-mono font-bold focus:outline-none w-36"
                            />
                        </div>

                        {/* 발주서 빠른 선택 드롭다운 */}
                        <select 
                            onChange={(e) => handleSelectOrder(e.target.value)}
                            value={selectedPoNo}
                            className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
                        >
                            <option value="ES260709-1974">📌 ES260709-1974 (사진 샘플 - 34개 품목)</option>
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
                            onClick={handleIssueSample}
                            disabled={issuing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-medium transition-all"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            사진 샘플(1:1) 로드
                        </button>

                        <button
                            onClick={handleIssueCertificates}
                            disabled={issuing}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${issuing ? 'animate-spin' : ''}`} />
                            {issuing ? '성적서 생성중...' : '성적서 일괄 자동 발행'}
                        </button>
                    </div>
                </div>

                {/* 6개 양식지 선택 상태 바 및 페이지네이션 */}
                <div className="px-6 py-2.5 bg-slate-800/40 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-slate-300">
                            <Layers className="w-4 h-4 text-indigo-400" />
                            <span className="font-semibold text-white">매칭된 양식지:</span>
                            <span className="px-2 py-0.5 rounded bg-indigo-900/60 border border-indigo-700 text-indigo-300 font-mono font-bold">
                                {currentCert?.sheetName || 'TP304(소재ASTM사용시)'}
                            </span>
                        </div>
                        <div className="text-slate-400 border-l border-slate-700 pl-3">
                            <span className="text-slate-300 font-medium">열처리:</span> {currentCert?.heatTreatment || '* Heat Treatment Condition : 1050℃ Solution Annealing & Water Quenching'}
                        </div>
                    </div>

                    {/* 분할 발행된 페이지 선택 탭 */}
                    {issuedRecords.length > 1 && (
                        <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-700">
                            <button
                                onClick={() => setSelectedPageIdx(prev => Math.max(0, prev - 1))}
                                disabled={selectedPageIdx === 0}
                                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="px-2 text-slate-300 font-medium font-mono">
                                Page {selectedPageIdx + 1} / {issuedRecords.length} ({currentCert?.itemCount || 0}품목)
                            </span>
                            <button
                                onClick={() => setSelectedPageIdx(prev => Math.min(issuedRecords.length - 1, prev + 1))}
                                disabled={selectedPageIdx === issuedRecords.length - 1}
                                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {/* 다운로드 및 보관소 액션 버튼들 */}
                    <div className="flex items-center gap-2">
                        {currentCert && (
                            <>
                                <a
                                    href={currentCert.pdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    download={`${selectedPoNo}_성적서_${currentCert.certNo}.pdf`}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 font-medium transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    PDF 다운로드
                                </a>

                                <a
                                    href={currentCert.excelUrl}
                                    download={`${selectedPoNo}_성적서_${currentCert.certNo}.xlsx`}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium transition-all"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    수식 엑셀 다운로드
                                </a>

                                <button
                                    onClick={handlePrint}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all"
                                >
                                    <Printer className="w-3.5 h-3.5" />
                                    인쇄
                                </button>
                            </>
                        )}

                        <button
                            onClick={handleOpenFolder}
                            className="flex items-center gap-1.5 px-3 py-1 rounded bg-slate-700/80 hover:bg-slate-700 text-slate-300 border border-slate-600 transition-all"
                            title="데이터관리부 DAT-10 보관소 탐색기 열기"
                        >
                            <FolderOpen className="w-3.5 h-3.5" />
                            DAT-10 보관 폴더
                        </button>
                    </div>
                </div>

                {/* 중앙 A4 규격 성적서 실시간 뷰어 (첨부 사진과 100% 동일한 서식) */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950 flex justify-center">
                    <div className="w-[794px] min-h-[1123px] bg-white text-slate-900 border-2 border-black p-5 relative shadow-2xl select-text print:border-none print:shadow-none print:w-full">
                        
                        {/* 대경벤드 붉은색 워터마크 심볼 */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-[0.07]">
                            <svg className="w-80 h-80" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="45" stroke="#d32f2f" strokeWidth="8" fill="none" />
                                <path d="M 35 30 L 35 70 M 65 30 L 65 70" stroke="#d32f2f" strokeWidth="8" />
                            </svg>
                        </div>

                        {/* 상단 헤더: 대경벤드 로고, 타이틀, 연락처 */}
                        <div className="flex justify-between items-start mb-2 relative z-10">
                            {/* 로고 */}
                            <div className="flex flex-col items-center w-36">
                                <div className="w-10 h-10 rounded-full border-[3.5px] border-[#d32f2f] flex items-center justify-center mb-1">
                                    <div className="w-5 h-6 border-l-[3.5px] border-r-[3.5px] border-[#d32f2f]"></div>
                                </div>
                                <div className="text-[10px] font-extrabold tracking-tight text-center text-slate-900 leading-tight">
                                    DAEKYUNG BEND<br />CO., LTD.
                                </div>
                            </div>

                            {/* 영문 타이틀 */}
                            <div className="text-center flex-1 pt-1">
                                <h1 className="text-2xl font-black tracking-widest text-slate-950">INSPECTION CERTIFICATE</h1>
                                <div className="text-xs font-bold text-slate-700 tracking-normal">(EN10204 3.1)</div>
                            </div>

                            {/* 주소 및 연락처 */}
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
                                    <td className="border border-black p-1 font-semibold w-[32%]">{currentCert?.customer || customerName || '월드원플랜에탈'}</td>
                                    <td className="border border-black font-bold p-1 bg-slate-50 w-[18%]">Certificate. No.</td>
                                    <td className="border border-black p-1 font-mono font-bold w-[32%] text-blue-900">{currentCert?.certNo || certNoInput || 'YR-26-07015'}</td>
                                </tr>
                                <tr>
                                    <td className="border border-black font-bold p-1 bg-slate-50">P.O. No.</td>
                                    <td className="border border-black p-1 font-mono font-bold">{currentCert?.poNo || selectedPoNo || 'ES260709-1974'}</td>
                                    <td className="border border-black font-bold p-1 bg-slate-50">Date of Issue</td>
                                    <td className="border border-black p-1 font-mono">{currentCert?.issueDate || '2026.07.09'}</td>
                                </tr>
                                <tr>
                                    <td className="border border-black font-bold p-1 bg-slate-50">Hull No.(Project No.)</td>
                                    <td className="border border-black p-1">N/A</td>
                                    <td className="border border-black font-bold p-1 bg-slate-50">Dimension & VI</td>
                                    <td className="border border-black p-1 font-semibold text-emerald-800">GOOD</td>
                                </tr>
                                <tr>
                                    <td className="border border-black font-bold p-1 bg-slate-50">Spec. for Material</td>
                                    <td className="border border-black p-1 font-semibold">{currentItems[0]?.specMaterial || 'ASTM A312 TP304'}</td>
                                    <td className="border border-black font-bold p-1 bg-slate-50">Spec. for Inspection</td>
                                    <td className="border border-black p-1 font-semibold">{currentItems[0]?.specInspection || 'KS B1543 STS304-W /B1500'}</td>
                                </tr>
                            </tbody>
                        </table>

                        {/* 1. ITEM DESCRIPTION (최대 6개 행) */}
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
                                {displayRows.map((it, idx) => (
                                    <tr key={idx} className="h-6">
                                        <td className="border border-black p-1 font-mono font-bold text-red-900">{it.lotNo || '\u00A0'}</td>
                                        <td className="border border-black p-1 font-mono">{it.lotNo ? (idx + 1) : '\u00A0'}</td>
                                        <td className="border border-black p-1 font-mono font-bold text-blue-900">{it.heatNo || '\u00A0'}</td>
                                        <td className="border border-black p-1 text-left pl-2 font-medium">{it.description || '\u00A0'}</td>
                                        <td className="border border-black p-1 font-mono">{it.qty ? it.qty : '\u00A0'}</td>
                                        <td className="border border-black p-1">{it.startingMaterial || (it.lotNo ? 'WELDED PIPE' : '\u00A0')}</td>
                                        <td className="border border-black p-1">{it.lotNo ? 'N/A' : '\u00A0'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* 열처리 조건 표기 */}
                        <div className="text-[8.5px] font-semibold my-1 text-slate-900 relative z-10">
                            {currentCert?.heatTreatment || '* Heat Treatment Condition : 1050℃ Solution Annealing & Water Quenching'}
                        </div>

                        {/* 2. CHEMICAL COMPOSITION(%) (Spec Max/Min 및 실제 시험 성적값) */}
                        <div className="text-[10px] font-extrabold mb-1 mt-2 text-slate-900 relative z-10">
                            2. CHEMICAL COMPOSITION(%)
                        </div>
                        <table className="w-full border-collapse border border-black text-[8.5px] text-center mb-1 relative z-10">
                            <thead>
                                <tr className="bg-slate-50 font-bold">
                                    <th rowSpan={3} className="border border-black p-1 w-[14%]">Heat No.</th>
                                    <th className="border border-black p-1 w-[8%]">Spec</th>
                                    <th className="border border-black p-0.5">C</th>
                                    <th className="border border-black p-0.5">Si</th>
                                    <th className="border border-black p-0.5">Mn</th>
                                    <th className="border border-black p-0.5">P</th>
                                    <th className="border border-black p-0.5">S</th>
                                    <th className="border border-black p-0.5">Ni</th>
                                    <th className="border border-black p-0.5">Cr</th>
                                    {is316L && <th className="border border-black p-0.5">Mo</th>}
                                </tr>
                                <tr className="bg-white text-[8px]">
                                    <th className="border border-black p-0.5 font-bold">Max</th>
                                    <td className="border border-black p-0.5">{is316L ? '0.030' : '0.080'}</td>
                                    <td className="border border-black p-0.5">1.00</td>
                                    <td className="border border-black p-0.5">2.00</td>
                                    <td className="border border-black p-0.5">0.045</td>
                                    <td className="border border-black p-0.5">0.030</td>
                                    <td className="border border-black p-0.5">{is316L ? '14.00' : '11.00'}</td>
                                    <td className="border border-black p-0.5">{is316L ? '18.00' : '20.00'}</td>
                                    {is316L && <td className="border border-black p-0.5">3.00</td>}
                                </tr>
                                <tr className="bg-white text-[8px]">
                                    <th className="border border-black p-0.5 font-bold">Min</th>
                                    <td className="border border-black p-0.5"></td>
                                    <td className="border border-black p-0.5"></td>
                                    <td className="border border-black p-0.5"></td>
                                    <td className="border border-black p-0.5"></td>
                                    <td className="border border-black p-0.5"></td>
                                    <td className="border border-black p-0.5">{is316L ? '10.00' : '8.00'}</td>
                                    <td className="border border-black p-0.5">{is316L ? '16.00' : '18.00'}</td>
                                    {is316L && <td className="border border-black p-0.5">2.00</td>}
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((it, idx) => (
                                    <tr key={idx} className="h-5">
                                        <td className="border border-black p-0.5 font-mono font-bold text-blue-900">{it.heatNo || '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'L' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.C ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.Si ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.Mn ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.P ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.S ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.Ni ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.chem?.Cr ?? '\u00A0'}</td>
                                        {is316L && <td className="border border-black p-0.5 font-mono">{it.chem?.Mo ?? '\u00A0'}</td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="text-[7.5px] text-slate-600 mb-1 relative z-10">* L : Ladle Analysis &nbsp;&nbsp; P : Product Analysis</div>

                        {/* 3. MECHANICAL PROPERTIES (TENSILE TEST, HARDNESS, CHARPY-V) */}
                        <div className="text-[10px] font-extrabold mb-1 mt-2 text-slate-900 relative z-10">
                            3. MECHANICAL PROPERTIES
                        </div>
                        <table className="w-full border-collapse border border-black text-[8px] text-center mb-1 relative z-10">
                            <thead>
                                <tr className="bg-slate-50 font-bold">
                                    <th rowSpan={3} className="border border-black p-1 w-[14%]">Heat No</th>
                                    <th rowSpan={3} className="border border-black p-0.5 w-[6%]">Unit</th>
                                    <th colSpan={4} className="border border-black p-0.5">TENSILE TEST</th>
                                    <th className="border border-black p-0.5">HARDNESS TEST</th>
                                    <th colSpan={8} className="border border-black p-0.5">CHARPY-V IMPACT TEST (Test Temp : ℃)</th>
                                </tr>
                                <tr className="bg-slate-50 font-bold">
                                    <th className="border border-black p-0.5">Y.S(0.2%)</th>
                                    <th className="border border-black p-0.5">T.S</th>
                                    <th className="border border-black p-0.5">E.L</th>
                                    <th className="border border-black p-0.5">R.A</th>
                                    <th rowSpan={2} className="border border-black p-0.5">TEST METHOD</th>
                                    <th rowSpan={2} className="border border-black p-0.5">Specimen Size</th>
                                    <th rowSpan={2} className="border border-black p-0.5">Direction Position</th>
                                    <th colSpan={4} className="border border-black p-0.5">ABSORBED ENERGY (Unit: J)</th>
                                    <th colSpan={2} className="border border-black p-0.5">LATERAL EXPANSION</th>
                                </tr>
                                <tr className="bg-white text-[7.5px]">
                                    <td className="border border-black p-0.5">MPa</td>
                                    <td className="border border-black p-0.5">MPa</td>
                                    <td className="border border-black p-0.5">%</td>
                                    <td className="border border-black p-0.5">%</td>
                                    <td className="border border-black p-0.5">1</td>
                                    <td className="border border-black p-0.5">2</td>
                                    <td className="border border-black p-0.5">3</td>
                                    <td className="border border-black p-0.5">AVR</td>
                                    <td className="border border-black p-0.5">Min</td>
                                    <td className="border border-black p-0.5">AVR</td>
                                </tr>
                                <tr className="bg-white text-[7.5px]">
                                    <th className="border border-black p-0.5 font-bold">Max</th>
                                    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                                </tr>
                                <tr className="bg-white text-[7.5px]">
                                    <th className="border border-black p-0.5 font-bold">Min</th>
                                    <td></td>
                                    <td className="border border-black p-0.5">{is316L ? '170' : '205'}</td>
                                    <td className="border border-black p-0.5">{is316L ? '485' : '520'}</td>
                                    <td className="border border-black p-0.5">35</td>
                                    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((it, idx) => (
                                    <tr key={idx} className="h-5">
                                        <td className="border border-black p-0.5 font-mono font-bold text-blue-900">{it.heatNo || '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'L,B' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.mech?.ys ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.mech?.ts ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-mono">{it.mech?.el ?? '\u00A0'}</td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                        <td className="border border-black p-0.5"></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="text-[7.5px] text-slate-600 mb-1 relative z-10">* L : Longitudinal, T : Transvers, B : Base Metal, W : Weld Metal</div>

                        {/* 추가 비파괴/검사 결과 테이블 (PMI, FLATTENING, CORROSION, HYDROSTATIC...) */}
                        <table className="w-full border-collapse border border-black text-[8px] text-center mb-2 relative z-10">
                            <thead>
                                <tr className="bg-slate-50 font-bold">
                                    <th className="border border-black p-1 w-[14%]">Heat No</th>
                                    <th className="border border-black p-1">PMI</th>
                                    <th className="border border-black p-1">FLATTENING</th>
                                    <th className="border border-black p-1">CORROSION TEST</th>
                                    <th className="border border-black p-1">HYDROSTATIC TEST</th>
                                    <th className="border border-black p-1">FERRITE</th>
                                    <th className="border border-black p-1">GRAIN SIZE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((it, idx) => (
                                    <tr key={idx} className="h-5">
                                        <td className="border border-black p-0.5 font-mono font-bold text-blue-900">{it.heatNo || '\u00A0'}</td>
                                        <td className="border border-black p-0.5 font-semibold text-emerald-800">{it.heatNo ? 'GOOD' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'N/A' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'N/A' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'N/A' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'N/A' : '\u00A0'}</td>
                                        <td className="border border-black p-0.5">{it.heatNo ? 'N/A' : '\u00A0'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* REMARK 박스 */}
                        <div className="border border-black h-9 p-1 text-[8px] text-slate-800 mb-2 relative z-10">
                            <span className="font-bold">REMARK:</span>
                        </div>

                        {/* 하단 품질 보증 인증문구 및 직인 날인 영역 */}
                        <div className="text-center text-[8px] leading-tight text-slate-800 mt-2 relative z-10">
                            We certify this material has been manufactured and examined in accordance with<br />
                            all requirements of the specification and the results of all examination are acceptable
                        </div>
                        <div className="flex justify-end items-center mt-3 pr-4 relative z-10">
                            <div className="text-[10px] font-extrabold tracking-wide text-slate-900 flex items-center gap-2">
                                <span>HEAD OF QUALITY MANAGEMENT</span>
                                <div className="w-9 h-9 rounded-full border border-red-500/40 flex items-center justify-center text-[7px] text-red-600 font-bold rotate-[-12deg]">
                                    (인)
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* 모달 하단 푸터 바 */}
                <div className="px-6 py-3 bg-slate-900 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>데이터관리부 DAT-10 연동: 발주번호별 폴더 <code className="text-indigo-300 font-mono">storage/issued_certificates/{selectedPoNo}/</code>에 영구 보관 중</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors font-medium"
                    >
                        닫기
                    </button>
                </div>

            </div>
        </div>
    );
}
