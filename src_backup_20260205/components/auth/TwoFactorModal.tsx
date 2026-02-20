import { useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';

interface TwoFactorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onVerify: (code: string) => boolean;
}

export function TwoFactorModal({ isOpen, onClose, onVerify }: TwoFactorModalProps) {
    const [code, setCode] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (code.length !== 6) {
            setError('6자리 인증번호를 입력해주세요.');
            return;
        }

        const success = onVerify(code);
        if (!success) {
            setError('인증번호가 올바르지 않습니다.');
            setCode('');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mb-2">
                        <ShieldCheck className="w-8 h-8 text-teal-600" />
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-slate-900">2단계 인증</h2>
                        <p className="text-slate-500 text-sm mt-1">관리자 계정 보호를 위해 인증번호를 입력해주세요.</p>
                        <p className="text-xs text-teal-600 font-bold mt-2 bg-teal-50 py-1 px-2 rounded inline-block">Demo Code: 123456</p>
                    </div>

                    <form onSubmit={handleSubmit} className="w-full space-y-4 pt-4">
                        <div className="space-y-2">
                            <input
                                type="text"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                                className="w-full text-center text-2xl font-bold tracking-[0.5em] py-4 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all placeholder:text-slate-200"
                                placeholder="000000"
                                autoFocus
                            />
                            {error && <p className="text-red-500 text-sm font-medium animate-pulse">{error}</p>}
                        </div>

                        <Button
                            type="submit"
                            className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow-lg shadow-teal-500/20"
                        >
                            인증 확인
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}
