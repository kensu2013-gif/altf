import React, { useState, useEffect } from 'react';
import {
    X,
    FileText,
    AlertTriangle,
    RotateCw,
    UploadCloud,
    DollarSign,
    Truck,
    Package,
    MessageSquare,
    Check
} from 'lucide-react';

interface SupplierInvoiceItem {
    itemNo: number;
    type: 'PRODUCT' | 'FREIGHT';
    name: string;
    rawLine?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    poNo?: string;
    remarks?: string;
}

interface SupplierInvoice {
    id: string;
    fileName?: string;
    invoiceNo: string;
    displayInvoiceNo?: string;
    invoiceDate: string;
    supplier?: {
        name: string;
        bizNo?: string;
        ceo?: string;
    };
    buyer?: {
        name: string;
        bizNo?: string;
        ceo?: string;
    };
    items?: SupplierInvoiceItem[];
    itemCount?: number;
    poNumbers?: string[];
    pricing?: {
        totalSupplyPrice?: number;
        freightPrice?: number;
        subtotal?: number;
        vat?: number;
        grandTotal?: number;
    };
    source?: string;
    processedAt?: string;
    accounting?: {
        status?: string;
        subtotal?: number;
        vat?: number;
        grandTotal?: number;
    };
}

interface DispatchResult {
    success: boolean;
    message: string;
    invoiceNo: string;
    invoiceDate: string;
    poNumbers: string[];
    pricing: {
        subtotal: number;
        vat: number;
        grandTotal: number;
    };
    departments: {
        general: { status: string; message: string };
        purchase: { status: string; message: string; matchedCount?: number; updatedPos?: string[] };
        quality: { status: string; message: string; matchedCerts?: Array<Record<string, unknown>>; missingItems?: string[] };
        shipping: { status: string; message: string; targetLocation?: string };
    };
}

interface DaekyungInvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRefreshAgents?: () => void;
}

export const DaekyungInvoiceModal: React.FC<DaekyungInvoiceModalProps> = ({
    isOpen,
    onClose,
    onRefreshAgents
}) => {
    const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [lastResult, setLastResult] = useState<DispatchResult | null>(null);
    const [selectedSample, setSelectedSample] = useState<'0031' | '0015' | null>(null);

    // 텔레그램 연동 상태
    const [telegramStatus, setTelegramStatus] = useState({
        hasToken: false,
        tokenMasked: '',
        chatId: '',
        isPolling: false
    });
    const [botTokenInput, setBotTokenInput] = useState('');
    const [chatIdInput, setChatIdInput] = useState('');
    const [showTelegramConfig, setShowTelegramConfig] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchInvoices();
            fetchTelegramStatus();
        }
    }, [isOpen]);

    const fetchInvoices = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/inbound/daekyung-invoice/list');
            if (res.ok) {
                const data = await res.json();
                if (data.invoices) setInvoices(data.invoices);
            }
        } catch (e) {
            console.error('Failed to load supplier invoices:', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchTelegramStatus = async () => {
        try {
            const res = await fetch('/api/inbound/telegram/status');
            if (res.ok) {
                const data = await res.json();
                setTelegramStatus(data);
                if (data.chatId) setChatIdInput(data.chatId);
            }
        } catch (e) {
            console.error('Failed to load telegram status:', e);
        }
    };

    const handleSimulate = async (sampleId: '0031' | '0015') => {
        try {
            setLoading(true);
            setSelectedSample(sampleId);
            const res = await fetch('/api/inbound/daekyung-invoice/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sampleId })
            });
            const data = await res.json();
            if (data.success) {
                setLastResult(data);
                await fetchInvoices();
                if (onRefreshAgents) onRefreshAgents();
            } else {
                alert('시뮬레이션 실패: ' + data.error);
            }
        } catch (e) {
            alert('요청 실패: ' + e);
        } finally {
            setLoading(false);
            setSelectedSample(null);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setLoading(true);
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/inbound/daekyung-invoice/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (data.success) {
                setLastResult(data);
                await fetchInvoices();
                if (onRefreshAgents) onRefreshAgents();
                alert(`✅ 대경벤드 거래명세서 [${data.invoiceNo}] 파싱 및 4개 부서 자동 연계 완료!`);
            } else {
                alert('파싱 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            alert('업로드 실패: ' + err);
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    };

    const handleSaveTelegram = async (action?: 'START_POLLING' | 'STOP_POLLING') => {
        try {
            const res = await fetch('/api/inbound/telegram/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    botToken: botTokenInput || undefined,
                    chatId: chatIdInput || undefined,
                    action
                })
            });
            const data = await res.json();
            if (data.success) {
                setTelegramStatus(data);
                alert(action ? `텔레그램 봇 상태: ${action}` : '텔레그램 봇 설정이 저장되었습니다.');
            }
        } catch (e) {
            alert('설정 저장 실패: ' + e);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-6xl max-h-[92vh] bg-[#0c1015] border border-cyan-500/40 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.25)] flex flex-col overflow-hidden text-slate-100 font-sans">
                
                {/* 1. Modal Header */}
                <div className="px-6 py-4 border-b border-cyan-500/20 bg-linear-to-r from-[#0c1824] via-[#0e1726] to-[#0c1824] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                            <FileText className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-black text-white tracking-wide">
                                    📑 대경벤드 거래명세표(메신저/PDF) 매입 확정 & 자율 연계 관제기
                                </h2>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                                    GEN-01 × PUR-07 × QC-08 연계
                                </span>
                            </div>
                            <p className="text-xs text-slate-400">
                                공급처(대경벤드)가 카톡/텔레그램으로 보낸 거래명세서를 읽어, 매입 확정 및 미결 해제·성적서 확인을 1초 만에 자동 완결합니다.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchInvoices}
                            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                            title="새로고침"
                        >
                            <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 transition-all cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 2. Top Interactive Triggers Section */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
                    
                    {/* A. 2대 인입 채널: PDF 업로드 & 텔레그램 메신저 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        
                        {/* Channel 1: 드래그 앤 드롭 파일 업로드 & 샘플 원클릭 테스트 */}
                        <div className="p-4 rounded-xl border border-cyan-500/30 bg-[#08131d]/70 flex flex-col justify-between space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                                    <UploadCloud className="w-4 h-4" />
                                    <span>채널 1. 거래명세표 PDF 직접 업로드 & 테스트</span>
                                </span>
                                <span className="text-[10px] text-slate-400">다중 페이지 100% 지원</span>
                            </div>

                            {/* 드래그 앤 드롭 영역 */}
                            <label className="border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-black/40 hover:bg-cyan-950/20 group">
                                <UploadCloud className="w-8 h-8 text-cyan-400 group-hover:scale-110 transition-transform mb-1" />
                                <span className="text-xs font-bold text-slate-200">
                                    대경벤드 거래명세서 PDF 파일을 여기로 드래그하거나 클릭
                                </span>
                                <span className="text-[10px] text-slate-400 mt-0.5">
                                    수량, 단가, 비고(발주번호), 운임 자동 추출 및 전사 연계 가동
                                </span>
                                <input
                                    type="file"
                                    accept=".pdf"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>

                            {/* 방금 주신 사진 기반 원클릭 시뮬레이션 버튼 */}
                            <div className="pt-1">
                                <div className="text-[10px] font-bold text-slate-400 mb-1.5 flex items-center justify-between">
                                    <span>📸 사진 전표 즉시 테스트 (방금 주신 2개 전표 데이터):</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleSimulate('0031')}
                                        disabled={loading}
                                        className="p-2 rounded-lg bg-linear-to-r from-teal-900/60 to-cyan-900/60 hover:from-teal-800/80 hover:to-cyan-800/80 border border-teal-500/50 text-left cursor-pointer transition-all group disabled:opacity-50"
                                    >
                                        <div className="text-[11px] font-bold text-teal-300 flex items-center justify-between">
                                            <span className="flex items-center gap-1.5">
                                                {loading && selectedSample === '0031' && (
                                                    <RotateCw className="w-3 h-3 animate-spin text-teal-300" />
                                                )}
                                                <span>⚡ No.0031 전표</span>
                                            </span>
                                            <span className="text-[9px] bg-teal-500/20 px-1 rounded">서울재고분</span>
                                        </div>
                                        <div className="text-[10px] text-slate-300 truncate">45E(L) 100A (17개) + 운임</div>
                                        <div className="text-[9px] text-teal-400 font-mono font-bold">P.O: ES261019-2924</div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleSimulate('0015')}
                                        disabled={loading}
                                        className="p-2 rounded-lg bg-linear-to-r from-cyan-900/60 to-blue-900/60 hover:from-cyan-800/80 hover:to-blue-800/80 border border-cyan-500/50 text-left cursor-pointer transition-all group disabled:opacity-50"
                                    >
                                        <div className="text-[11px] font-bold text-cyan-300 flex items-center justify-between">
                                            <span className="flex items-center gap-1.5">
                                                {loading && selectedSample === '0015' && (
                                                    <RotateCw className="w-3 h-3 animate-spin text-cyan-300" />
                                                )}
                                                <span>⚡ No.0015 전표</span>
                                            </span>
                                            <span className="text-[9px] bg-cyan-500/20 px-1 rounded">고객직배분</span>
                                        </div>
                                        <div className="text-[10px] text-slate-300 truncate">45E(S) 300A (2개) 47.5만원</div>
                                        <div className="text-[9px] text-cyan-400 font-mono font-bold">P.O: ES261019-2915</div>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Channel 2: 텔레그램 메신저 봇 연동 */}
                        <div className="p-4 rounded-xl border border-sky-500/30 bg-[#081422]/70 flex flex-col justify-between space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                                    <MessageSquare className="w-4 h-4 text-sky-400" />
                                    <span>채널 2. 텔레그램 메신저 봇 실시간 수신</span>
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono border ${
                                    telegramStatus.isPolling
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                        : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}>
                                    {telegramStatus.isPolling ? '● 봇 가동 중 (Listening)' : '○ 봇 대기 중'}
                                </span>
                            </div>

                            <div className="p-3 bg-black/40 rounded-xl border border-sky-900/40 text-xs space-y-2">
                                <div className="text-slate-300 text-[11px] leading-relaxed">
                                    대경벤드 담당자가 카톡이나 메일로 보낸 거래명세표 PDF를 내 텔레그램 채팅방으로 그대로 <b>전달(Forward)</b>하면, 봇이 1초 만에 읽고 전사 부서에 신호를 쏩니다.
                                </div>
                                <div className="flex items-center justify-between pt-1 border-t border-sky-950 font-mono text-[10px]">
                                    <span className="text-slate-400">등록된 봇 토큰:</span>
                                    <span className="text-sky-300">{telegramStatus.tokenMasked || '미등록 (설정 필요)'}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowTelegramConfig(!showTelegramConfig)}
                                    className="flex-1 py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold text-xs transition-all cursor-pointer"
                                >
                                    ⚙️ 봇 토큰 / Chat ID 설정
                                </button>
                                {telegramStatus.hasToken && (
                                    <button
                                        type="button"
                                        onClick={() => handleSaveTelegram(telegramStatus.isPolling ? 'STOP_POLLING' : 'START_POLLING')}
                                        className={`py-1.5 px-3 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                                            telegramStatus.isPolling
                                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                                                : 'bg-sky-500 hover:bg-sky-400 text-black shadow-[0_0_15px_rgba(14,165,233,0.4)]'
                                        }`}
                                    >
                                        {telegramStatus.isPolling ? '정지' : '🚀 봇 가동'}
                                    </button>
                                )}
                            </div>

                            {/* 텔레그램 설정 팝업 드롭다운 */}
                            {showTelegramConfig && (
                                <div className="p-3 bg-slate-900 rounded-xl border border-sky-500/40 space-y-2 text-xs">
                                    <div>
                                        <label className="text-[10px] text-slate-400 block mb-0.5">텔레그램 봇 토큰 (BotFather 발급):</label>
                                        <input
                                            type="text"
                                            value={botTokenInput}
                                            onChange={e => setBotTokenInput(e.target.value)}
                                            placeholder="예: 7123456789:AAH..."
                                            className="w-full bg-black/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-400 block mb-0.5">알림 받을 Chat ID:</label>
                                        <input
                                            type="text"
                                            value={chatIdInput}
                                            onChange={e => setChatIdInput(e.target.value)}
                                            placeholder="예: 123456789"
                                            className="w-full bg-black/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
                                        />
                                    </div>
                                    <div className="flex justify-end gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => handleSaveTelegram()}
                                            className="px-3 py-1 bg-sky-500 text-black font-bold text-[11px] rounded cursor-pointer"
                                        >
                                            저장하기
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* B. 실시간 전사 4대 부서 연계 파이프라인 (Interactive Pipeline Result) */}
                    {lastResult && (
                        <div className="p-5 rounded-2xl border border-cyan-500/50 bg-[#07131e] space-y-4 shadow-[0_0_30px_rgba(6,182,212,0.15)] animate-fade-in">
                            <div className="flex items-center justify-between border-b border-cyan-900/50 pb-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                                    <h3 className="text-sm font-black text-cyan-300">
                                        ⚡ 대경벤드 전표 [No:{lastResult.invoiceNo}] ➔ 전사 4개 부서 자율 연계 결과
                                    </h3>
                                </div>
                                <span className="text-xs font-mono font-bold text-slate-400">
                                    발행일: {lastResult.invoiceDate} | P.O: {lastResult.poNumbers.join(', ')}
                                </span>
                            </div>

                            {/* 4대 부서 파이프라인 카드 */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                
                                {/* 1. 총무부 (GEN) */}
                                <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-950/20 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                                                <DollarSign className="w-3.5 h-3.5" />
                                                <span>📑 총무부 (GEN-01)</span>
                                            </span>
                                            <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">
                                                매입 확정
                                            </span>
                                        </div>
                                        <div className="font-mono text-xs font-black text-amber-200">
                                            {lastResult.pricing.grandTotal.toLocaleString()}원
                                        </div>
                                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                            공급가 {lastResult.pricing.subtotal.toLocaleString()}원 + 세액 {lastResult.pricing.vat.toLocaleString()}원
                                        </div>
                                    </div>
                                    <div className="text-[9px] text-amber-400/80 pt-2 border-t border-amber-900/40 mt-2">
                                        ✓ 10월 대경 매입 전표 장부 등록 완료
                                    </div>
                                </div>

                                {/* 2. 구매부 (PUR-07) */}
                                <div className="p-3 rounded-xl border border-teal-500/40 bg-teal-950/20 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[11px] font-bold text-teal-300 flex items-center gap-1">
                                                <Package className="w-3.5 h-3.5" />
                                                <span>🛒 구매부 (PUR-07)</span>
                                            </span>
                                            <span className="text-[9px] bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded font-bold">
                                                미결 해제
                                            </span>
                                        </div>
                                        <div className="text-[11px] font-bold text-teal-200">
                                            재고 발주 대장 엑셀 갱신
                                        </div>
                                        <div className="text-[10px] text-slate-300 mt-0.5">
                                            {lastResult.departments.purchase.message}
                                        </div>
                                    </div>
                                    <div className="text-[9px] text-teal-400/80 pt-2 border-t border-teal-900/40 mt-2">
                                        ✓ 입고상태: '입고완료(대경발송)' 전이
                                    </div>
                                </div>

                                {/* 3. 품질부 (QC-08) */}
                                <div className="p-3 rounded-xl border border-pink-500/40 bg-pink-950/20 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[11px] font-bold text-pink-300 flex items-center gap-1">
                                                <AlertTriangle className="w-3.5 h-3.5" />
                                                <span>🔬 품질부 (QC-08)</span>
                                            </span>
                                            <span className="text-[9px] bg-pink-500/20 text-pink-300 px-1.5 py-0.5 rounded font-bold">
                                                성적서 사전조회
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-pink-200 leading-snug">
                                            {lastResult.departments.quality.message}
                                        </div>
                                    </div>
                                    <div className="text-[9px] text-pink-400/80 pt-2 border-t border-pink-900/40 mt-2">
                                        ✓ 1,469개 MTC 대장 교차 검증
                                    </div>
                                </div>

                                {/* 4. 출고부 (LOG-01) */}
                                <div className="p-3 rounded-xl border border-purple-500/40 bg-purple-950/20 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[11px] font-bold text-purple-300 flex items-center gap-1">
                                                <Truck className="w-3.5 h-3.5" />
                                                <span>🚚 출고부 (LOG-01)</span>
                                            </span>
                                            <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold">
                                                입고/배송 감시
                                            </span>
                                        </div>
                                        <div className="text-[11px] font-bold text-purple-200">
                                            {lastResult.departments.shipping.targetLocation}
                                        </div>
                                        <div className="text-[10px] text-slate-300 mt-0.5">
                                            {lastResult.departments.shipping.message}
                                        </div>
                                    </div>
                                    <div className="text-[9px] text-purple-400/80 pt-2 border-t border-purple-900/40 mt-2">
                                        ✓ 하차 검수 및 스티커 갱신 대기
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* C. 누적 대경벤드 매입 확정 전표 목록 */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                                <span>📋</span>
                                <span>대경벤드 매입 확정 장부 (총 {invoices.length}건 보관)</span>
                            </h3>
                            <span className="text-[10px] text-slate-400 font-mono">
                                저장 경로: server/data/supplier_invoices.json
                            </span>
                        </div>

                        {invoices.length === 0 ? (
                            <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500">
                                아직 처리된 거래명세서가 없습니다. 위의 [PDF 업로드] 또는 [사진 전표 즉시 테스트] 버튼을 눌러보세요.
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-black/40">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-900/80 text-[10px] text-slate-400 font-mono uppercase border-b border-slate-800">
                                        <tr>
                                            <th className="py-2.5 px-3">전표번호</th>
                                            <th className="py-2.5 px-3">발행일자</th>
                                            <th className="py-2.5 px-3">공급처</th>
                                            <th className="py-2.5 px-3">발주 P.O</th>
                                            <th className="py-2.5 px-3">품목 요약</th>
                                            <th className="py-2.5 px-3 text-right">공급가액</th>
                                            <th className="py-2.5 px-3 text-right">부가세</th>
                                            <th className="py-2.5 px-3 text-right">매입 총금액</th>
                                            <th className="py-2.5 px-3 text-center">전사 상태</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                                        {invoices.map((inv, idx) => (
                                            <tr key={inv.id || idx} className="hover:bg-cyan-950/20 transition-colors">
                                                <td className="py-2.5 px-3 font-bold text-cyan-300 whitespace-nowrap">
                                                    {inv.displayInvoiceNo || inv.invoiceNo}
                                                </td>
                                                <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                                                    {inv.invoiceDate}
                                                </td>
                                                <td className="py-2.5 px-3 text-slate-200 font-bold whitespace-nowrap">
                                                    {inv.supplier?.name || '(주)대경벤드'}
                                                </td>
                                                <td className="py-2.5 px-3 text-teal-300 font-bold whitespace-nowrap">
                                                    {(inv.poNumbers || []).join(', ') || '-'}
                                                </td>
                                                <td className="py-2.5 px-3 text-slate-300 max-w-[200px] truncate" title={(inv.items || []).map(it => it.name).join(', ')}>
                                                    {(inv.items || []).map(it => `${it.name} (${it.quantity})`).join(', ') || '-'}
                                                </td>
                                                <td className="py-2.5 px-3 text-right text-slate-300 whitespace-nowrap">
                                                    {(inv.pricing?.subtotal || inv.accounting?.subtotal || 0).toLocaleString()}원
                                                </td>
                                                <td className="py-2.5 px-3 text-right text-slate-400 whitespace-nowrap">
                                                    {(inv.pricing?.vat || inv.accounting?.vat || 0).toLocaleString()}원
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-black text-amber-300 whitespace-nowrap">
                                                    {(inv.pricing?.grandTotal || inv.accounting?.grandTotal || 0).toLocaleString()}원
                                                </td>
                                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                                        ✓ 매입·입고 완료
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. Modal Footer */}
                <div className="px-6 py-3 border-t border-cyan-500/20 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-teal-400 font-bold">
                            <Check className="w-3.5 h-3.5" />
                            <span>대경벤드 성적서 DB(1,469개) 연동 가동 중</span>
                        </span>
                        <span className="text-slate-600">|</span>
                        <span>엑셀 동기화: storage/purchases/알트에프 재고 발주 대장.xlsx</span>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-all cursor-pointer"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
};
