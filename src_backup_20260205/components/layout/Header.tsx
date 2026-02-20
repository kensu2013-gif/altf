
import { Link, useLocation } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import logo from '../../assets/logo_v5.png';
import daekyungLogo from '../../assets/daekyung_logo.png';

export function Header() {
    const location = useLocation();
    const isHome = location.pathname === '/';

    // Auth state from store
    const isAuthenticated = useStore((state) => state.auth.isAuthenticated);
    const logout = useStore((state) => state.logout);
    const cartCount = useStore((state) => state.quotation.items.length);

    const newOrderCount = useStore((state) => state.newOrderCount);

    const handleLogout = () => {
        logout();
        // Redirect handled by protected route or AccessGate
    };

    return (
        <header className={cn(
            "sticky top-0 z-50 w-full transition-colors duration-300",
            isHome ? "bg-transparent absolute top-0 left-0 right-0 border-transparent shadow-none" : "bg-white/80 backdrop-blur-md border-b border-slate-200"
        )}>
            <div className="mx-auto flex h-auto min-h-[60px] max-w-[1600px] items-center justify-between px-8 py-6 relative">

                {/* Left: Logo Area */}
                <div className="flex items-center gap-6 z-20">
                    <Link to="/" className="flex items-center flex-shrink-0">
                        <img
                            src={logo}
                            alt="AltF Industrial"
                            className="h-14 md:h-20 w-auto"
                        />
                    </Link>

                    {/* Collaboration Logo (Only on Search & Quote) */}
                    {isAuthenticated && (location.pathname === '/search' || location.pathname === '/quote') && (
                        <div className="hidden md:flex items-center gap-5 animate-in fade-in slide-in-from-left-4 duration-700 delay-100">
                            <span className="text-slate-300 font-extralight text-2xl pb-0.5">x</span>

                            <a
                                href="http://www.daekyung21.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="opacity-90 hover:opacity-100 transition-opacity flex items-center"
                                title="대경벤드 홈페이지 바로가기"
                            >
                                <img
                                    src={daekyungLogo}
                                    alt="(주)대경벤드"
                                    className="h-12 md:h-12 w-auto object-contain"
                                />
                            </a>
                        </div>
                    )}
                </div>

                {/* Right Group: Navigation + Actions */}
                <div className="flex items-center gap-8 z-20">

                    {/* Navigation - Moved to Right */}
                    <nav className="hidden md:flex items-center gap-8">
                        {isHome ? (
                            <>
                                <Link to="/search" className="text-xl font-bold text-slate-900 hover:text-teal-600 transition-colors">제품찾기</Link>
                                <Link to="#" className="text-xl font-bold text-slate-900 hover:text-teal-600 transition-colors">고객센터</Link>
                            </>
                        ) : isAuthenticated && (
                            <>
                                <Link to="/search" className={cn("text-base font-medium transition-colors hover:text-primary-700", location.pathname === '/search' ? "text-primary-700" : "text-slate-600")}>제품 검색</Link>
                                <Link to="/quote" className={cn("text-base font-medium transition-colors hover:text-primary-700", location.pathname === '/quote' ? "text-primary-700" : "text-slate-600")}>
                                    견적서 작성
                                    {cartCount > 0 && <span className="ml-2 bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded-full">{cartCount}</span>}
                                </Link>
                                <div className="h-4 w-px bg-slate-300 mx-2"></div>
                            </>
                        )}
                    </nav>

                    {/* User Actions */}
                    <div className="flex items-center gap-6 flex-shrink-0">
                        {isAuthenticated ? (
                            <>
                                <Link to="/my-page">
                                    <Button variant="ghost" size="sm" className="text-slate-500 hover:text-teal-600 gap-2 relative">
                                        <User className="w-4 h-4" />
                                        <span>나의 페이지</span>
                                        {newOrderCount > 0 && (
                                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold ring-2 ring-white">
                                                {newOrderCount}
                                            </span>
                                        )}
                                    </Button>
                                </Link>
                                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-red-600 gap-2">
                                    <LogOut className="w-4 h-4" />
                                    <span>종료</span>
                                </Button>
                            </>
                        ) : (
                            <div className="flex items-center gap-4 text-lg">
                                <Link to="/login" className="font-bold text-slate-900 hover:text-teal-600 transition-colors">로그인</Link>
                                <span className="text-slate-400 font-bold">|</span>
                                <Link to="/signup" className="font-bold text-slate-900 hover:text-teal-600 transition-colors">회원가입</Link>

                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}

