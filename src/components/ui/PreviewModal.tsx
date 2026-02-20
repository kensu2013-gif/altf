import { useRef, useEffect, useState } from 'react';
import { X, Printer, Send, Check, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from './Button';

// Wait, I don't see toast in the codebase. I will just use console/alert or create a simple toast if needed.
// User requirement: "Success toast: 발주서가 접수되었습니다."
// I'll check if I can use a simple UI feedback inside the modal header or just alert for now if no toast lib.
// There is no toast lib visible in imports. I'll rely on the button state change for feedback as requested ("접수완료" button).

interface PreviewModalProps {
    htmlContent: string;
    onClose: () => void;
    onSend?: () => Promise<boolean>; // Optional: if provided, shows the Send button
    onPrint?: () => void; // Optional hook for print action
    onOrder?: () => void; // Direct Order Action
    docType?: string; // 'QUOTATION' | 'ORDER'
    memo?: string;
    onMemoChange?: (val: string) => void;
    hidePrint?: boolean; // [NEW] Option to hide Print button
    hideClose?: boolean; // [NEW] Option to hide Close button in footer
}

export function PreviewModal({ htmlContent, onClose, onSend, onPrint, onOrder, docType = 'QUOTATION', memo, onMemoChange, hidePrint, hideClose }: PreviewModalProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

    useEffect(() => {
        if (iframeRef.current) {
            const doc = iframeRef.current.contentDocument;
            if (doc) {
                doc.open();
                doc.write(htmlContent);
                doc.close();
            }
        }
    }, [htmlContent]);

    // ESC Key Handler (Global + Iframe Message)
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        const handleMessage = (e: MessageEvent) => {
            if (e.data === 'ESC_KEY') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEsc);
        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('keydown', handleEsc);
            window.removeEventListener('message', handleMessage);
        };
    }, [onClose]);

    const handlePrint = async () => {
        if (onPrint) await onPrint();
        if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.print();
        }
    };

    const handleSendClick = async () => {
        if (!onSend) return;

        setSendStatus('sending');
        try {
            const success = await onSend();
            if (success) {
                setSendStatus('success');
            } else {
                setSendStatus('error');
            }
        } catch (error) {
            console.error(error);
            setSendStatus('error');
        }
    };

    const isOrder = docType === 'ORDER';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            {/* Click backdrop to close */}
            <div className="absolute inset-0" onClick={onClose} />

            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden relative z-10 animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="bg-teal-50 p-2 rounded-lg">
                            <Check className="w-5 h-5 text-teal-600" />
                        </div>
                        <h2 className="text-lg font-bold text-slate-800">
                            {docType === 'ORDER' ? '발주서 미리보기 (Order Preview)' : '견적서 답변 확인 (Quotation check)'}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                        title="닫기 (ESC)"
                        aria-label="Close Preview"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 bg-slate-100 p-6 overflow-hidden relative flex gap-6">
                    {/* Main Preview */}
                    <div className="flex-1 h-full bg-white shadow-xl overflow-hidden rounded-lg relative ring-1 ring-black/5">
                        <iframe
                            ref={iframeRef}
                            title="Document Preview"
                            className="w-full h-full border-none"
                        />
                    </div>

                    {/* Inquiry Sidebar (Only for Quotation) */}
                    {docType === 'QUOTATION' && onMemoChange && (
                        <div className="w-[320px] bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col shrink-0 animate-in slide-in-from-right-4 duration-500">
                            <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                                    문의 및 요청사항
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    견적서에 포함될 요청사항을 입력하세요.
                                </p>
                            </div>
                            <div className="p-4 flex-1 flex flex-col gap-2">
                                <textarea
                                    placeholder="예: 최단 납기 확인 부탁드립니다.&#13;&#10;네고 가능한가요?&#13;&#10;성적서 포함해 주세요."
                                    className="w-full h-full min-h-[200px] p-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none resize-none bg-slate-50 focus:bg-white transition-all placeholder:text-slate-400 leading-relaxed"
                                    value={memo || ''}
                                    onChange={(e) => onMemoChange(e.target.value)}
                                />
                                <div className="text-xs text-slate-400 text-right">
                                    * 입력 시 미리보기에 즉시 반영됩니다.
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 bg-white border-t border-slate-100 shrink-0 flex justify-between items-center gap-4">
                    {!hideClose ? (
                        <Button variant="ghost" onClick={onClose} className="text-slate-500 hover:bg-slate-100 font-bold">
                            닫기 (Close)
                        </Button>
                    ) : <div></div>}

                    <div className="flex items-center gap-3">
                        {!hidePrint && (
                            <Button
                                variant="outline"
                                onClick={handlePrint}
                                className="gap-2 font-bold shadow-sm min-w-[140px] justify-center text-slate-700 border-slate-300 hover:bg-slate-50"
                            >
                                <Printer className="w-4 h-4" />
                                {docType === 'ORDER' ? '발주서 출력 (Print Order Sheet)' : '견적서 발급 (PDF 저장)'}
                            </Button>
                        )}

                        {/* Direct Order from Quote (New Requirement) */}
                        {docType === 'QUOTATION' && onOrder && (
                            <Button
                                onClick={onOrder}
                                className="gap-2 font-bold shadow-md min-w-[140px] justify-center bg-teal-600 hover:bg-teal-700 text-white"
                            >
                                <Check className="w-4 h-4" />
                                주문하기
                            </Button>
                        )}

                        {/* Send Action (Only if onSend provided) */}
                        {onSend && isOrder && (
                            <>
                                {sendStatus === 'idle' || sendStatus === 'error' ? (
                                    <Button
                                        onClick={handleSendClick}
                                        className={`gap-2 font-bold shadow-md min-w-[160px] justify-center ${sendStatus === 'error' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
                                            } text-white`}
                                    >
                                        {sendStatus === 'error' ? '전송 실패 (재시도)' : '발주서 전송하기'}
                                        <Send className="w-4 h-4 ml-1" />
                                    </Button>
                                ) : sendStatus === 'sending' ? (
                                    <Button disabled className="gap-2 font-bold shadow-sm min-w-[160px] justify-center bg-teal-600/80 text-white cursor-not-allowed">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        전송중...
                                    </Button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={handleSendClick}
                                            className="gap-2 text-xs h-9 border-teal-200 text-teal-700 hover:bg-teal-50"
                                            title="다시 보내기"
                                        >
                                            <RefreshCw className="w-3 h-3" />
                                        </Button>
                                        <Button disabled className="gap-2 font-bold shadow-sm min-w-[140px] justify-center bg-teal-700 text-white border-transparent select-none cursor-default">
                                            <Check className="w-4 h-4" />
                                            접수완료
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
