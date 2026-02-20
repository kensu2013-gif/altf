
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { Lock, Mail, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { InteractiveBackground } from '../../components/ui/InteractiveBackground';
import { LoginWidgets } from '../../components/ui/LoginWidgets';
import { TwoFactorModal } from '../../components/auth/TwoFactorModal';

export default function Login() {
    const navigate = useNavigate();
    const login = useStore((state) => state.login);
    const verify2FA = useStore((state) => state.verify2FA);
    const seedAdmin = useStore((state) => state.seedAdmin);

    useEffect(() => {
        seedAdmin();
    }, [seedAdmin]);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [show2FA, setShow2FA] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const result = login(email, password);

        if (result === 'SUCCESS') {
            navigate('/welcome');
        } else if (result === 'MFA_REQUIRED') {
            setShow2FA(true);
        } else if (result === 'PENDING_APPROVAL') {
            setError('관리자 승인 대기 중입니다. 승인 완료 후 이용 가능합니다.');
        } else {
            setError('이메일 또는 비밀번호가 일치하지 않습니다.');
        }
    };

    const handle2FAVerify = (code: string) => {
        if (verify2FA(code)) {
            navigate('/admin');
            return true;
        }
        return false;
    };

    return (
        <div className="min-h-screen min-w-[320px] flex flex-col items-center justify-center font-pretendard relative overflow-y-auto overflow-x-hidden">
            <InteractiveBackground />
            <LoginWidgets />

            <TwoFactorModal
                isOpen={show2FA}
                onClose={() => setShow2FA(false)}
                onVerify={handle2FAVerify}
            />

            <div className="flex-1 w-full flex items-center justify-center p-4">
                <div className="bg-white/10 backdrop-blur-xl p-8 md:p-10 rounded-3xl shadow-2xl w-[90%] max-w-md space-y-8 border border-white/20 relative z-10 animate-in fade-in zoom-in duration-700 flex-shrink-0">
                    <div className="text-center space-y-3">
                        <h1 className="text-3xl font-extrabold text-white tracking-tight drop-shadow-md">ALT.F 방문을 환영합니다.</h1>
                        <p className="text-blue-50/80 text-sm font-medium">서비스 이용을 위해 로그인해주세요.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-5">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-blue-50/90 ml-1">이메일</label>
                                <div className="relative group">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-200 w-5 h-5 transition-colors group-focus-within:text-teal-400" />
                                    <input
                                        type="email"
                                        required
                                        className="w-full pl-12 pr-4 py-4 rounded-xl bg-black/20 border border-white/10 text-white placeholder:text-white/40 focus:bg-black/30 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 outline-none transition-all"
                                        placeholder="name@company.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-blue-50/90 ml-1">비밀번호</label>
                                <div className="relative group">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-200 w-5 h-5 transition-colors group-focus-within:text-teal-400" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        className="w-full pl-12 pr-12 py-4 rounded-xl bg-black/20 border border-white/10 text-white placeholder:text-white/40 focus:bg-black/30 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 outline-none transition-all"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-5 h-5" />
                                        ) : (
                                            <Eye className="w-5 h-5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-100 text-sm font-medium text-center animate-shake backdrop-blur-md">
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full py-4 text-base font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-900/20 border-none transition-all hover:scale-[1.02] active:scale-[0.98]">
                            로그인
                        </Button>
                    </form>

                    <div className="text-center pt-6 border-t border-white/10">
                        <p className="text-blue-50/50 text-sm">
                            아직 계정이 없으신가요?{' '}
                            <Link to="/signup" className="text-teal-300 hover:text-white font-bold hover:underline flex items-center justify-center gap-1 inline-flex transition-colors">
                                회원가입 <ArrowRight className="w-4 h-4" />
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
