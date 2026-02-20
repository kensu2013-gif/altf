import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, CheckCircle2, X, Printer, Truck, Phone, User, MapPin, Search } from 'lucide-react'; // Added icons
import { Button } from './Button';
import { AddressSearchModal } from './AddressSearchModal'; // Import
import { useStore, type DeliveryInfo } from '../../store/useStore';
import { renderDocumentHTML } from '../../lib/documentTemplate';
import type { DocumentPayload } from '../../types/document';

interface OrderSubmissionOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (info: DeliveryInfo) => void;
    basePayload: DocumentPayload | null; // Changed from htmlContent
    buttonRef?: React.RefObject<HTMLButtonElement | null>;
}

export function OrderSubmissionOverlay({ isOpen, onClose, onConfirm, basePayload, buttonRef }: OrderSubmissionOverlayProps) {
    const [phase, setPhase] = useState<'idle' | 'morph' | 'sheet' | 'complete'>('idle');
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [launchRect, setLaunchRect] = useState<{ top: number; left: number } | null>(null);
    const [isAddressModalOpen, setIsAddressModalOpen] = useState(false); // Modal State

    // Form State
    const storedPreferences = useStore((state) => state.deliveryPreferences);
    const setStorePreferences = useStore((state) => state.setDeliveryPreferences);

    const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo>({
        method: 'FREIGHT',
        branchName: '',
        address: '',
        contactName: '',
        contactPhone: '',
        additionalRequest: ''
    });

    // Dynamic HTML Generation for Preview
    const previewHtml = useMemo(() => {
        if (!basePayload) return '';

        // Clone payload
        const enrichedPayload = JSON.parse(JSON.stringify(basePayload)); // Deep clone for safety

        // Format Delivery Info
        const deliveryNote = `[배송: ${deliveryInfo.method === 'FREIGHT' ? '화물' : '택배'}] ` +
            `${deliveryInfo.method === 'FREIGHT' ? deliveryInfo.branchName : deliveryInfo.address} ` +
            `| 담당자: ${deliveryInfo.contactName} (${deliveryInfo.contactPhone})` +
            (deliveryInfo.additionalRequest ? ` | 요청: ${deliveryInfo.additionalRequest}` : '');

        // Inject into customer.memo
        if (!enrichedPayload.customer) enrichedPayload.customer = {};
        enrichedPayload.customer.memo = enrichedPayload.customer.memo
            ? `${enrichedPayload.customer.memo}\n${deliveryNote}`
            : deliveryNote;

        return renderDocumentHTML(enrichedPayload);
    }, [basePayload, deliveryInfo]);

    // Track previous open state to reset form on open
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

    // Adjust state during render to avoid effect cascade
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen && storedPreferences) {
            setDeliveryInfo(storedPreferences);
        }
    }

    // Validation (Derived State)
    const isContactValid = deliveryInfo.contactName.trim().length > 0 && deliveryInfo.contactPhone.trim().length > 0;
    const isMethodValid = deliveryInfo.method === 'FREIGHT'
        ? deliveryInfo.branchName.trim().length > 0
        : deliveryInfo.address.trim().length > 0;

    const isValid = isContactValid && isMethodValid;

    const handleUpdate = (field: keyof DeliveryInfo, value: string) => {
        setDeliveryInfo(prev => ({ ...prev, [field]: value }));
    };

    const handleConfirm = () => {
        if (!isValid) return;
        setStorePreferences(deliveryInfo); // Persist
        onConfirm(deliveryInfo);
    };

    useEffect(() => {
        if (isOpen) {
            if (buttonRef?.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                setLaunchRect({
                    top: rect.top + rect.height / 2,
                    left: rect.left + rect.width / 2
                });
            } else {
                setLaunchRect({ top: 40, left: window.innerWidth - 100 });
            }

            setPhase('morph');
            const morphToSheetTimer = setTimeout(() => setPhase('sheet'), 900);
            return () => clearTimeout(morphToSheetTimer);
        } else {
            setPhase('idle');
        }
    }, [isOpen, buttonRef]);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose, isOpen]);

    useEffect(() => {
        if (phase === 'sheet' && iframeRef.current) {
            const doc = iframeRef.current.contentDocument;
            if (doc) {
                doc.open();
                doc.write(previewHtml);
                doc.close();
            }
        }
    }, [phase, previewHtml]);

    const handlePrint = () => {
        if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.print();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <div className="relative z-10 w-full max-w-4xl px-4 perspective-1000 h-[90vh] flex flex-col justify-center">

                        {/* Morphing Button - Keeping original logic */}
                        {phase !== 'sheet' && phase !== 'idle' && launchRect && (
                            <motion.div
                                initial={{
                                    top: launchRect.top, left: launchRect.left, width: 200, height: 48, borderRadius: 12, backgroundColor: '#000F0F', opacity: 1, scale: 1
                                }}
                                animate={phase === 'morph' ? {
                                    top: '50%', left: '50%', x: '-50%', y: '-50%', width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff', scale: 1.2
                                } : {}}
                                exit={{ opacity: 0, scale: 0 }}
                                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                                className="fixed z-50 shadow-2xl flex items-center justify-center overflow-hidden pointer-events-none"
                            >
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                                    <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
                                </motion.div>
                            </motion.div>
                        )}

                        {phase === 'sheet' && (
                            <motion.div
                                initial={{ scaleY: 0.8, opacity: 0, rotateX: -15, y: 20 }}
                                animate={{ scaleY: 1, opacity: 1, rotateX: 0, y: 0 }}
                                exit={{ scaleY: 0.9, opacity: 0, scale: 0.95 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.1 }}
                                className="bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col w-full h-full mx-auto origin-top ring-1 ring-white/20"
                            >
                                {/* Header */}
                                <div className="bg-slate-800 text-white p-4 flex items-center justify-between shadow-md shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-white/10 p-2 rounded-full">
                                            <Send className="w-5 h-5 text-teal-400" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold">주문서 제출 (Order Submit)</h2>
                                            <p className="text-xs text-slate-300">최종 내용 및 배송정보를 확인해 주세요.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-full">
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Content: Iframe + Form */}
                                <div className="flex-1 bg-slate-100 p-4 gap-4 flex flex-col overflow-y-auto">

                                    {/* Invoice Preview */}
                                    <div className="flex-[3] w-full bg-white shadow-sm mx-auto overflow-hidden rounded-sm relative ring-1 ring-black/5 min-h-[300px]">
                                        <iframe ref={iframeRef} srcDoc={previewHtml} title="Order Doc" className="w-full h-full border-none" />
                                        <motion.div
                                            initial={{ scale: 2, opacity: 0, rotate: 15 }}
                                            animate={{ scale: 1, opacity: 0.1, rotate: -12 }}
                                            transition={{ delay: 0.5, type: 'spring' }}
                                            className="absolute bottom-10 right-10 border-4 border-teal-800 text-teal-900 p-2 font-black text-4xl uppercase tracking-widest opacity-10 pointer-events-none select-none z-10"
                                        >
                                            DRAFT
                                        </motion.div>
                                    </div>

                                    {/* Delivery Info Form */}
                                    <div className="flex-[0] shrink-0 bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                                        <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold border-b border-slate-100 pb-2">
                                            <Search className="w-4 h-4 text-teal-600" />
                                            <span>물건 받으실 방법 (Delivery Request)</span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Left: Method Selection & Address */}
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-4">
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${deliveryInfo.method === 'FREIGHT' ? 'border-teal-600' : 'border-slate-300 group-hover:border-teal-400'}`}>
                                                            {deliveryInfo.method === 'FREIGHT' && <div className="w-2 h-2 rounded-full bg-teal-600" />}
                                                        </div>
                                                        <input type="radio" className="hidden" checked={deliveryInfo.method === 'FREIGHT'} onChange={() => handleUpdate('method', 'FREIGHT')} />
                                                        <span className={`text-sm font-medium ${deliveryInfo.method === 'FREIGHT' ? 'text-teal-700' : 'text-slate-600'}`}>화물 (Freight)</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 cursor-pointer group">
                                                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${deliveryInfo.method === 'COURIER' ? 'border-teal-600' : 'border-slate-300 group-hover:border-teal-400'}`}>
                                                            {deliveryInfo.method === 'COURIER' && <div className="w-2 h-2 rounded-full bg-teal-600" />}
                                                        </div>
                                                        <input type="radio" className="hidden" checked={deliveryInfo.method === 'COURIER'} onChange={() => handleUpdate('method', 'COURIER')} />
                                                        <span className={`text-sm font-medium ${deliveryInfo.method === 'COURIER' ? 'text-teal-700' : 'text-slate-600'}`}>택배 (Courier)</span>
                                                    </label>
                                                </div>

                                                <div className="relative">
                                                    {deliveryInfo.method === 'FREIGHT' ? (
                                                        <>
                                                            <Truck className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                                            <input
                                                                type="text"
                                                                placeholder="지점명 입력 (예: 경동화물 부산사상지점)"
                                                                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                                                                value={deliveryInfo.branchName}
                                                                onChange={(e) => handleUpdate('branchName', e.target.value)}
                                                            />
                                                        </>
                                                    ) : (
                                                        <>
                                                            <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="text"
                                                                    placeholder="배송지 주소 입력"
                                                                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                                                                    value={deliveryInfo.address}
                                                                    onChange={(e) => handleUpdate('address', e.target.value)}
                                                                    onClick={() => setIsAddressModalOpen(true)}
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    onClick={() => setIsAddressModalOpen(true)}
                                                                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 h-[38px] px-3 whitespace-nowrap"
                                                                >
                                                                    검색
                                                                </Button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            <AddressSearchModal
                                                isOpen={isAddressModalOpen}
                                                onClose={() => setIsAddressModalOpen(false)}
                                                onComplete={(data) => handleUpdate('address', data.fullAddress)}
                                            />

                                            {/* Right: Contact Info */}
                                            <div className="space-y-3">
                                                <div className="flex gap-2">
                                                    <div className="relative flex-1">
                                                        <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                                        <input
                                                            type="text"
                                                            placeholder="담당자 성함"
                                                            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                                                            value={deliveryInfo.contactName}
                                                            onChange={(e) => handleUpdate('contactName', e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="relative flex-[1.5]">
                                                        <Phone className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                                        <input
                                                            type="text"
                                                            placeholder="연락처"
                                                            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                                                            value={deliveryInfo.contactPhone}
                                                            onChange={(e) => handleUpdate('contactPhone', e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                                {/* Additional Request */}
                                                <div>
                                                    <input
                                                        type="text"
                                                        placeholder="추가 요청사항 (선택) - 예: 성적서 요청"
                                                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300 bg-slate-50 focus:bg-white"
                                                        value={deliveryInfo.additionalRequest}
                                                        onChange={(e) => handleUpdate('additionalRequest', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer Actions */}
                                <div className="p-4 bg-white border-t border-slate-200 shrink-0 flex justify-between items-center z-20">
                                    <Button variant="ghost" onClick={onClose} className="text-slate-500 hover:bg-slate-100 font-bold">
                                        취소 (ESC)
                                    </Button>

                                    <div className="flex gap-3">
                                        <Button
                                            variant="outline"
                                            onClick={handlePrint}
                                            className="gap-2 text-slate-600 hover:bg-slate-50 font-bold"
                                        >
                                            <Printer className="w-4 h-4" />
                                            PDF 저장 / 인쇄
                                        </Button>
                                        <Button
                                            onClick={handleConfirm}
                                            disabled={!isValid}
                                            className={`gap-2 px-6 shadow-lg font-bold transition-all ${isValid ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-500/20' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}`}
                                        >
                                            <CheckCircle2 className="w-4 h-4" />
                                            최종 주문 제출
                                        </Button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>
            )}
        </AnimatePresence>
    );
}
