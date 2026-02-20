
import { Link, useLocation } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import logo from '../../assets/logo_v5.png';
import logoDaekyung from '../../assets/logo_daekyung.png.png';

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

                {/* Left: Logo */}
                {/* Left: Logo */}
                <div className="flex items-center gap-4 flex-shrink-0 z-20">
                    <Link to="/" className="flex items-center">
                        <img
                            src={logo}
                            alt="AltF Industrial"
                            className="h-10 md:h-14 w-auto object-contain"
                        />
                    </Link>
                    <div className="w-px h-8 bg-slate-300 mx-2 hidden md:block" />
                    <a href="http://www.daekyung21.com" target="_blank" rel="noopener noreferrer" className="flex items-center transition-opacity hover:opacity-80">
                        <img
                            src={logoDaekyung}
                            alt="(주)대경벤드"
                            className="h-8 md:h-10 w-auto object-contain"
                        />
                    </a>
                </div>

                {/* Center: Navigation - Always visible on Home or Auth */}


                {/* Right: Actions */}
                <div className="flex items-center gap-6 flex-shrink-0 z-20">
                    <nav className="hidden md:flex items-center gap-6 mr-4">
                        {isHome ? (
                            <>
                                <Link to="/search" className="text-base font-bold text-slate-700 hover:text-teal-600 transition-colors">제품 검색</Link>
                                <Link to="#" className="text-base font-bold text-slate-700 hover:text-teal-600 transition-colors">고객센터</Link>
                            </>
                        ) : isAuthenticated && (
                            <>
                                <Link to="/search" className={cn("text-base font-bold transition-colors hover:text-teal-600", location.pathname === '/search' ? "text-teal-600" : "text-slate-600")}>제품 검색</Link>
                                <Link to="/quote" className={cn("text-base font-bold transition-colors hover:text-teal-600", location.pathname === '/quote' ? "text-teal-600" : "text-slate-600")}>
                                    견적서 작성
                                    {cartCount > 0 && <span className="ml-2 bg-teal-100 text-teal-700 text-[10px] px-1.5 py-0.5 rounded-full">{cartCount}</span>}
                                </Link>
                            </>
                        )}
                    </nav>
                    {isAuthenticated ? (
                        <>
                            <div className="w-px h-4 bg-slate-300 hidden md:block" />
                            <Link to="/my-page">
                                <Button variant="ghost" size="sm" className="text-slate-500 hover:text-teal-600 gap-2 relative text-base">
                                    <User className="w-5 h-5" />
                                    <span className="hidden md:inline">나의 페이지</span>
                                    {newOrderCount > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold ring-2 ring-white">
                                            {newOrderCount}
                                        </span>
                                    )}
                                </Button>
                            </Link>
                            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-red-600 gap-2 text-base">
                                <LogOut className="w-5 h-5" />
                                <span className="hidden md:inline">종료</span>
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
        </header>
    );
}

