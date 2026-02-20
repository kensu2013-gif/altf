import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    description: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'primary' | 'danger';
    onConfirm: () => void;
    onCancel?: () => void;
}

export function ConfirmDialog({
    isOpen,
    title,
    description,
    confirmText = '확인',
    cancelText = '취소',
    confirmVariant = 'primary',
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onCancel}
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
                            onClick={onCancel}
                            aria-label="닫기"
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="p-6 pt-8 text-center flex flex-col items-center">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmVariant === 'danger' ? 'bg-red-50 text-red-500' : 'bg-teal-50 text-teal-600'
                                }`}>
                                <AlertCircle className="w-6 h-6" />
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {title}
                            </h3>

                            <div className="text-slate-500 text-sm leading-relaxed mb-6">
                                {description}
                            </div>

                            <div className="flex gap-3 w-full">
                                {onCancel && cancelText && (
                                    <Button
                                        variant="outline"
                                        onClick={onCancel}
                                        className="flex-1 border-slate-200 text-slate-600 hover:bg-slate-50"
                                    >
                                        {cancelText}
                                    </Button>
                                )}
                                <Button
                                    onClick={onConfirm}
                                    className={`flex-1 ${confirmVariant === 'danger'
                                        ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-200'
                                        : 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-200'
                                        } shadow-lg`}
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
