import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, XCircle, X } from 'lucide-react';
import { Button } from './Button';

interface AlertDialogProps {
    isOpen: boolean;
    title: string;
    description: React.ReactNode;
    confirmText?: string;
    type?: 'success' | 'error' | 'info';
    onClose: () => void;
}

export function AlertDialog({
    isOpen,
    title,
    description,
    confirmText = '확인',
    type = 'info',
    onClose
}: AlertDialogProps) {
    const getIconInfo = () => {
        switch (type) {
            case 'success':
                return { icon: CheckCircle2, colorClass: 'bg-teal-50 text-teal-600', btnClass: 'bg-teal-600 hover:bg-teal-700 shadow-teal-200' };
            case 'error':
                return { icon: XCircle, colorClass: 'bg-red-50 text-red-500', btnClass: 'bg-red-500 hover:bg-red-600 shadow-red-200' };
            default:
                return { icon: AlertCircle, colorClass: 'bg-blue-50 text-blue-600', btnClass: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' };
        }
    };

    const { icon: Icon, colorClass, btnClass } = getIconInfo();

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                    />

                    {/* Dialog */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden ring-1 ring-slate-900/5"
                    >
                        <button
                            onClick={onClose}
                            aria-label="닫기"
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="p-6 pt-8 text-center flex flex-col items-center">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${colorClass}`}>
                                <Icon className="w-6 h-6" />
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {title}
                            </h3>

                            <div className="text-slate-500 text-sm leading-relaxed mb-6">
                                {description}
                            </div>

                            <div className="flex w-full">
                                <Button
                                    onClick={onClose}
                                    className={`w-full text-white shadow-lg ${btnClass}`}
                                >
                                    {confirmText}
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
