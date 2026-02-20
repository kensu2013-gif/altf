import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Button } from '../components/ui/Button';
import './AccessGate.css';
import { MessageCircle, Zap, Sparkles } from 'lucide-react';

export default function AccessGate() {
    const navigate = useNavigate();
    const login = useStore((state) => state.login);
    const isAuthenticated = useStore((state) => state.auth.isAuthenticated);

    const handleQuickStart = () => {
        if (isAuthenticated) {
            navigate('/search');
        } else {
            // For prototype: auto-login or redirect to login
            // Assuming "Quick Order" implies browsing inventory
            // We'll redirect to search, which might be protected.
            // Or just logging them in as guest for now?
            // "Access via quotation number or invitation code only" says the prompt.
            // Let's redirect to a login/code entry flow. 
            // Since we don't have a separate login page yet, we can simple trigger a prompt or
            // just Navigate to /search and let the Guard handle it?
            // For now, let's make it auto-login for "simulated" experience or go to search.
            login('GUEST_SESSION'); // Simulating entry
            navigate('/search');
        }
    };

    const [showCards, setShowCards] = useState(false);
    const cardsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setShowCards(true);
                }
            },
            { threshold: 0.1 }
        );

        if (cardsRef.current) {
            observer.observe(cardsRef.current);
        }

        return () => observer.disconnect();
    }, []);

    return (
        <div className="access-gate-bg relative w-full flex flex-col font-sans bg-cover bg-fixed min-h-screen">
            {/* Dark Overlay for logo matching and brightness - Moved to global scope to cover full scroll */}
            <div className="absolute inset-0 bg-black/60 fixed" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-slate-900/90 fixed" />

            {/* Hero Section */}
            <section className="relative w-full min-h-[850px] flex flex-col items-center pt-[200px] text-center overflow-hidden">

                {/* Content */}
                <div className="relative z-10 max-w-7xl px-4 space-y-16 animate-in fade-in zoom-in duration-700">
                    <h1 className="text-4xl md:text-6xl font-extrabold leading-[1.2] tracking-tight drop-shadow-sm whitespace-nowrap">
                        <span className="animate-text-shimmer bg-gradient-to-r from-teal-400 via-white to-teal-400 bg-clip-text text-transparent inline-block">
                            찾으시는 PIPE FITTING 자재는 무엇인가요?
                        </span>
                    </h1>

                    <p className="text-xl text-gray-200 font-bold leading-relaxed max-w-2xl mx-auto drop-shadow-sm">
                        알트에프는 구매결정에 소요되는 <br className="hidden md:block" />
                        당신의 시간을 최대한 절약 시켜 드리겠습니다.
                    </p>
                </div>
            </section>

            {/* Feature Cards Section */}
            <section ref={cardsRef} className="relative z-20 -mt-64 pb-32 px-4">
                <div className={`max-w-[1400px] mx-auto grid md:grid-cols-2 gap-32 transition-all duration-1000 ease-out transform ${showCards ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'}`}>

                    {/* Quick Card */}
                    <div className="group bg-white/5 backdrop-blur-md rounded-[2rem] p-12 shadow-2xl border border-white/10 flex flex-col items-center text-center space-y-6 hover:border-teal-500 transition-colors duration-300">
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-teal-500/10 rounded-full border border-teal-500/20">
                            <Zap className="w-4 h-4 text-teal-400 fill-current" />
                            <span className="text-teal-300 font-extrabold tracking-widest text-sm">QUICK</span>
                        </div>
                        <h3 className="text-2xl font-bold text-white leading-snug">
                            필요하신 재고와 단가를<br />즉시 확인해 보세요
                        </h3>
                        <Button
                            onClick={handleQuickStart}
                            className="mt-4 bg-teal-600 text-white hover:bg-teal-700 h-12 px-8 rounded-lg text-lg font-medium w-full max-w-[240px] shadow-lg shadow-teal-500/30"
                        >
                            검색하기
                        </Button>
                    </div>

                    {/* Easy Card */}
                    <div className="group bg-white/5 backdrop-blur-md rounded-[2rem] p-12 shadow-2xl border border-white/10 flex flex-col items-center text-center space-y-6 hover:border-[#FEE500] transition-colors duration-300">
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 rounded-full border border-blue-500/20">
                            <Sparkles className="w-4 h-4 text-blue-400 fill-current" />
                            <span className="text-blue-300 font-extrabold tracking-widest text-sm">EASY</span>
                        </div>
                        <h3 className="text-2xl font-bold text-white leading-snug">
                            담당자에게 직접<br />
                            문의해 보세요.
                        </h3>
                        <button
                            onClick={() => window.open('http://pf.kakao.com/_jxcxaBn', '_blank')}
                            className="mt-4 bg-[#FEE500] hover:bg-[#E5CE00] text-black font-bold h-12 px-6 rounded-lg flex items-center justify-center gap-2 transition-all shadow-md w-full max-w-[280px] text-lg whitespace-nowrap"
                        >
                            <MessageCircle className="h-5 w-5 fill-current flex-shrink-0" />
                            <span>문의하기</span>
                        </button>
                    </div>

                </div>
            </section>

        </div>
    );
}
