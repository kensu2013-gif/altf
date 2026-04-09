import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Truck, Phone, User, MapPin, ArrowRight, X } from 'lucide-react';
import { Button } from './Button';
import { AddressSearchModal } from './AddressSearchModal';
import { useStore, type DeliveryInfo } from '../../store/useStore';

interface DeliveryInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (info: DeliveryInfo) => void;
}

export function DeliveryInfoModal({ isOpen, onClose, onConfirm }: DeliveryInfoModalProps) {
    const storedPreferences = useStore((state) => state.deliveryPreferences);
    const setStorePreferences = useStore((state) => state.setDeliveryPreferences);

    const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
    const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo>({
        method: 'FREIGHT',
        branchName: '',
        address: '',
        contactName: '',
        contactPhone: '',
        additionalRequest: ''
    });

    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen && storedPreferences) {
            setDeliveryInfo(storedPreferences);
        }
    }

    const isContactValid = deliveryInfo.contactName.trim().length > 0 && deliveryInfo.contactPhone.trim().length > 0;
    const isMethodValid = deliveryInfo.method === 'FREIGHT'
        ? deliveryInfo.branchName.trim().length > 0
        : deliveryInfo.address.trim().length > 0;

    const isValid = isContactValid && isMethodValid;

    const handleUpdate = (field: keyof DeliveryInfo, value: string) => {
        setDeliveryInfo(prev => ({ ...prev, [field]: value }));
    };

    const handleAction = () => {
        if (!isValid) return;
        setStorePreferences(deliveryInfo);
        onConfirm(deliveryInfo); 
    };

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose, isOpen]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        className="relative z-10 w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden shadow-teal-900/20"
                    >
                        {/* Header */}
                        <div className="bg-slate-800 text-white p-5 flex items-center justify-between shadow-md relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-teal-900/50 to-transparent pointer-events-none" />
                            <div className="relative z-10 flex items-center gap-3">
                                <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm">
                                    <Truck className="w-5 h-5 text-teal-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold tracking-tight">배송(수령) 정보 입력</h2>
                                    <p className="text-xs text-slate-300 mt-1 font-medium">출력 전 송장과 받으실 분 정보를 입력해주세요.</p>
                                </div>
                            </div>
                            <button onClick={onClose} title="닫기" className="p-2 relative z-10 text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-full">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content Form */}
                        <div className="p-6 bg-slate-50/50">
                            <div className="space-y-6">
                                {/* Left: Method Selection & Address */}
                                <div className="space-y-3">
                                    <label className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                        물건 받으실 방법
                                    </label>
                                    <div className="flex items-center gap-6 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${deliveryInfo.method === 'FREIGHT' ? 'border-teal-600 bg-teal-50' : 'border-slate-300 group-hover:border-teal-400'}`}>
                                                {deliveryInfo.method === 'FREIGHT' && <div className="w-2.5 h-2.5 rounded-full bg-teal-600 shadow-sm" />}
                                            </div>
                                            <input type="radio" className="hidden" checked={deliveryInfo.method === 'FREIGHT'} onChange={() => handleUpdate('method', 'FREIGHT')} />
                                            <span className={`text-base font-bold ${deliveryInfo.method === 'FREIGHT' ? 'text-teal-800' : 'text-slate-600 group-hover:text-slate-800'}`}>화물 지점 수령</span>
                                        </label>
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${deliveryInfo.method === 'COURIER' ? 'border-teal-600 bg-teal-50' : 'border-slate-300 group-hover:border-teal-400'}`}>
                                                {deliveryInfo.method === 'COURIER' && <div className="w-2.5 h-2.5 rounded-full bg-teal-600 shadow-sm" />}
                                            </div>
                                            <input type="radio" className="hidden" checked={deliveryInfo.method === 'COURIER'} onChange={() => handleUpdate('method', 'COURIER')} />
                                            <span className={`text-base font-bold ${deliveryInfo.method === 'COURIER' ? 'text-teal-800' : 'text-slate-600 group-hover:text-slate-800'}`}>택배 직접 수령</span>
                                        </label>
                                    </div>

                                    <div className="relative mt-2">
                                        {deliveryInfo.method === 'FREIGHT' ? (
                                            <>
                                                <Truck className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                                                <input
                                                    type="text"
                                                    placeholder="화물 지점명 입력 (예: 경동화물 부산사상지점)"
                                                    className="w-full pl-12 pr-4 py-3 text-sm font-medium border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 shadow-sm"
                                                    value={deliveryInfo.branchName}
                                                    onChange={(e) => handleUpdate('branchName', e.target.value)}
                                                />
                                            </>
                                        ) : (
                                            <>
                                                <MapPin className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        placeholder="상세 배송지 주소 (직접 입력 또는 우측 검색 이용)"
                                                        className="w-full pl-12 pr-4 py-3 text-sm font-medium border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 shadow-sm"
                                                        value={deliveryInfo.address}
                                                        onChange={(e) => handleUpdate('address', e.target.value)}
                                                    />
                                                    <Button
                                                        type="button"
                                                        onClick={() => setIsAddressModalOpen(true)}
                                                        className="bg-slate-700 hover:bg-slate-800 text-white h-[46px] px-6 rounded-xl font-bold shadow-sm"
                                                    >
                                                        검색
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Right: Contact Info */}
                                <div className="space-y-3 pt-2">
                                    <label className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                        수령인 및 연락처
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="relative">
                                            <User className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                                            <input
                                                type="text"
                                                placeholder="담당자 성함"
                                                className="w-full pl-12 pr-4 py-3 text-sm font-medium border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 shadow-sm"
                                                value={deliveryInfo.contactName}
                                                onChange={(e) => handleUpdate('contactName', e.target.value)}
                                            />
                                        </div>
                                        <div className="relative">
                                            <Phone className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                                            <input
                                                type="text"
                                                placeholder="연락처 (010-0000-0000)"
                                                className="w-full pl-12 pr-4 py-3 text-sm font-medium border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 shadow-sm"
                                                value={deliveryInfo.contactPhone}
                                                onChange={(e) => handleUpdate('contactPhone', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-2">
                                        <input
                                            type="text"
                                            placeholder="추가 요청사항 (선택) - 예: 성적서 포함 요청 등"
                                            className="w-full px-4 py-3 text-sm font-medium border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 shadow-sm"
                                            value={deliveryInfo.additionalRequest}
                                            onChange={(e) => handleUpdate('additionalRequest', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="p-5 bg-white border-t border-slate-100 flex justify-end gap-3">
                            <Button variant="ghost" onClick={onClose} className="text-slate-500 hover:bg-slate-100 font-bold px-6 h-12 rounded-xl">
                                취소
                            </Button>
                            <Button
                                onClick={handleAction}
                                disabled={!isValid}
                                className={`gap-2 h-12 px-8 rounded-xl font-black text-[15px] shadow-lg transition-all ${isValid ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-900/20 scale-100 hover:scale-[1.02]' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none scale-100'}`}
                            >
                                확정
                                <ArrowRight className="w-5 h-5" />
                            </Button>
                        </div>

                        <AddressSearchModal
                            isOpen={isAddressModalOpen}
                            onClose={() => setIsAddressModalOpen(false)}
                            onComplete={(data) => handleUpdate('address', data.fullAddress)}
                        />
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
