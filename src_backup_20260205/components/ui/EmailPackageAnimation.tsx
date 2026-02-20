import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, FileText, CheckCircle2 } from 'lucide-react';

interface EmailPackageAnimationProps {
    isOpen: boolean;
    onComplete: () => void;
}

export function EmailPackageAnimation({ isOpen, onComplete }: EmailPackageAnimationProps) {
    const [step, setStep] = useState<'idle' | 'doc' | 'morph' | 'fly' | 'success'>('idle');

    useEffect(() => {
        if (isOpen) {
            // Sequence Timing
            const t1 = setTimeout(() => setStep('morph'), 800);  // Show doc for 0.8s
            const t2 = setTimeout(() => setStep('fly'), 1500);   // Plane appears, then flies at 1.5s
            const t3 = setTimeout(() => setStep('success'), 2200); // Success screen at 2.2s
            const t4 = setTimeout(() => {
                onComplete();
            }, 3500); // Close at 3.5s

            return () => {
                clearTimeout(t1);
                clearTimeout(t2);
                clearTimeout(t3);
                clearTimeout(t4);
            };
        }
    }, [isOpen, onComplete]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <div className="relative flex flex-col items-center justify-center w-full h-full max-w-sm mx-auto">

                    {/* Stage 1: Document */}
                    {(step === 'doc' || step === 'idle') && (
                        <motion.div
                            layoutId="main-icon"
                            initial={{ scale: 0.5, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.8, opacity: 0, rotate: -10 }}
                            transition={{ type: "spring", stiffness: 200, damping: 20 }}
                            className="w-24 h-32 bg-white rounded-lg shadow-2xl flex items-center justify-center border border-slate-200"
                        >
                            <FileText className="w-12 h-12 text-slate-700" strokeWidth={1.5} />
                            {/* Lines for text effect */}
                            <motion.div
                                className="absolute top-8 left-6 right-6 h-2 bg-slate-200 rounded-full"
                                initial={{ width: "0%" }} animate={{ width: "60%" }} transition={{ delay: 0.3 }}
                            />
                            <motion.div
                                className="absolute top-12 left-6 right-6 h-2 bg-slate-200 rounded-full"
                                initial={{ width: "0%" }} animate={{ width: "80%" }} transition={{ delay: 0.4 }}
                            />
                            <motion.div
                                className="absolute top-16 left-6 right-6 h-2 bg-slate-200 rounded-full"
                                initial={{ width: "0%" }} animate={{ width: "50%" }} transition={{ delay: 0.5 }}
                            />
                        </motion.div>
                    )}

                    {/* Stage 2 & 3: Plane */}
                    {(step === 'morph' || step === 'fly') && (
                        <motion.div
                            layoutId="main-icon"
                            className="relative z-10"
                            initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
                            animate={step === 'fly' ? {
                                x: 300,
                                y: -300,
                                scale: 0.5,
                                opacity: 0,
                                rotate: 15
                            } : {
                                scale: 1,
                                opacity: 1,
                                rotate: 0
                            }}
                            transition={step === 'fly' ? {
                                duration: 0.8,
                                ease: [0.2, 0, 0.8, 1] // Ease In Back-ish
                            } : {
                                type: "spring", stiffness: 200, damping: 15
                            }}
                        >
                            <div className="bg-teal-500 p-6 rounded-full shadow-lg shadow-teal-500/30">
                                <Send className="w-12 h-12 text-white ml-1 mt-1" strokeWidth={2} />
                            </div>

                            {/* Speed lines trail */}
                            {step === 'fly' && (
                                <motion.div
                                    initial={{ opacity: 0, width: 0 }}
                                    animate={{ opacity: 1, width: 100 }}
                                    className="absolute top-1/2 right-full h-1 bg-gradient-to-l from-white to-transparent -translate-y-1/2"
                                />
                            )}
                        </motion.div>
                    )}

                    {/* Stage 4: Success Message */}
                    {step === 'success' && (
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white/90 backdrop-blur-xl p-8 rounded-3xl shadow-2xl flex flex-col items-center border border-white/50 text-center"
                        >
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 text-green-600 shadow-sm">
                                <CheckCircle2 className="w-8 h-8" strokeWidth={3} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-1">주문 전송 완료!</h3>
                            <p className="text-slate-500 text-sm font-medium">담당자가 확인 후 연락드리겠습니다.</p>
                        </motion.div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
