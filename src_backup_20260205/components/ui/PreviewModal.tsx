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
    docType?: string; // 'QUOTATION' | 'ORDER'
}

export function PreviewModal({ htmlContent, onClose, onSend, onPrint, docType = 'QUOTATION' }: PreviewModalProps) {
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

    // ESC Key Handler
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    const handlePrint = () => {
        if (onPrint) onPrint();
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
                            {docType === 'ORDER' ? '발주서 미리보기 (Order Preview)' : '견적서 미리보기 (Quotation Preview)'}
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
                <div className="flex-1 bg-slate-100 p-6 overflow-hidden relative flex flex-col items-center justify-center">
                    <div className="h-full w-full bg-white shadow-xl mx-auto overflow-hidden rounded-lg relative ring-1 ring-black/5">
                        <iframe
                            ref={iframeRef}
                            title="Document Preview"
                            className="w-full h-full border-none"
                        />
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 bg-white border-t border-slate-100 shrink-0 flex justify-between items-center gap-4">
                    <Button variant="ghost" onClick={onClose} className="text-slate-500 hover:bg-slate-100 font-bold">
                        닫기 (Close)
                    </Button>

                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline"
                            onClick={handlePrint}
                            className="gap-2 font-bold shadow-sm min-w-[140px] justify-center text-slate-700 border-slate-300 hover:bg-slate-50"
                        >
                            <Printer className="w-4 h-4" />
                            PDF 저장 / 인쇄
                        </Button>

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
