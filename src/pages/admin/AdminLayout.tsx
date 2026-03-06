import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Menu,
    User,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';
import { useState, useEffect } from 'react';

export default function AdminLayout() {
    const navigate = useNavigate();
    const location = useLocation();
    const logout = useStore((state) => state.logout);
    const user = useStore((state) => state.auth.user);
    const { orders, quotes, isMobileModalOpen } = useStore((state) => state);

    // [MOD] Initialize sidebar state from local storage so it persists across refreshes and menu clicks.
    const [isSidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('altfAdminSidebar');
        return saved ? saved === 'true' : true;
    });

    useEffect(() => {
        localStorage.setItem('altfAdminSidebar', String(isSidebarOpen));
    }, [isSidebarOpen]);

    // [MOD] Ensure inventory is loaded/validated when accessing Admin Panel
    useInventory();

    const delayedPendingCount = orders.reduce((count, order) => {
        if (order.isDeleted || order.status === 'CANCELLED') return count;
        if (!order.po_items) return count;

        const deliveryDateStr = order.adminResponse?.deliveryDate || order.createdAt;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dDate = new Date(deliveryDateStr);
        const diffDays = Math.ceil((dDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            const hasPendingItems = order.po_items.some(pi => pi.poSent && !pi.transactionIssued);
            return count + (hasPendingItems ? 1 : 0);
        }
        return count;
    }, 0);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const NAV_ITEMS = [
        // { label: '대시보드', path: '/admin', exact: true, emoji: '📊' }, // Maybe later
        { label: '회원 관리', path: '/admin/members', emoji: '👥' },
        { label: '담당자 관리', path: '/admin/managers', emoji: '👨‍💼' },
        { label: '주문 관리', path: '/admin/orders', emoji: '🛒', badge: orders.filter(o => o.status === 'SUBMITTED' && !o.isDeleted).length },
        { label: '미결 관리', path: '/admin/pending', emoji: '⏳', badge: delayedPendingCount },
        { label: '견적 관리', path: '/admin/quotes', emoji: '📝', badge: quotes.filter(q => q.status === 'SUBMITTED' && !q.isDeleted).length },
        { label: '재고 관리', path: '/admin/inventory', emoji: '📦' },
        { label: '설정', path: '/admin/settings', emoji: '⚙️' },
    ];

    return (
        <div className="flex h-screen bg-slate-50 font-pretendard">
            {/* Sidebar Overlay for Mobile/Tablet */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/50 z-20 md:hidden transition-opacity"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`bg-slate-900 text-white transition-all duration-300 flex flex-col fixed md:relative z-30 h-full ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0 md:w-20'} shadow-2xl md:shadow-none`}
            >
                {/* Logo Area */}
                <div className="h-16 relative flex items-center justify-center border-b border-slate-800">
                    {isSidebarOpen ? (
                        <span className="text-xl font-bold tracking-wider text-teal-400">ALTF ADMIN</span>
                    ) : (
                        <span className="text-xl font-bold text-teal-400">A</span>
                    )}

                    {/* Desktop Toggle Button */}
                    <button
                        onClick={() => setSidebarOpen(!isSidebarOpen)}
                        className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-teal-500 hover:bg-teal-400 border-2 border-slate-900 rounded-full hidden md:flex items-center justify-center text-white transition-colors z-50 shadow-md ring-2 ring-slate-900/50"
                        title={isSidebarOpen ? '메뉴 접기' : '메뉴 펼치기'}
                    >
                        {isSidebarOpen ? <ChevronLeft className="w-5 h-5 -ml-0.5" /> : <ChevronRight className="w-5 h-5 ml-0.5" />}
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 py-6 px-2 space-y-1">
                    {NAV_ITEMS.filter(item => {
                        if (user?.role === 'MANAGER') {
                            return ['/admin/orders', '/admin/pending', '/admin/quotes'].includes(item.path);
                        }
                        // MASTER or admin sees everything
                        return true;
                    }).map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            title={!isSidebarOpen ? item.label : undefined}
                            className={({ isActive }) => `
                                flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors relative
                                ${isActive
                                    ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/20'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                            `}
                        >
                            <div className="flex items-center gap-3 w-full justify-center md:justify-start">
                                <div className="relative flex-shrink-0">
                                    <span className={`flex items-center justify-center transition-all ${isSidebarOpen ? 'text-xl w-6 h-6' : 'text-2xl w-8 h-8'}`}>
                                        {item.emoji}
                                    </span>
                                    {!isSidebarOpen && item.badge !== undefined && item.badge > 0 && (
                                        <span className="absolute -top-1 -right-2 bg-yellow-400 text-slate-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm border border-slate-900 z-10">
                                            {item.badge}
                                        </span>
                                    )}
                                </div>
                                {isSidebarOpen && <span className="text-sm">{item.label}</span>}
                            </div>
                            {isSidebarOpen && item.badge !== undefined && item.badge > 0 && (
                                <span className="bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm ml-auto">
                                    {item.badge}
                                </span>
                            )}
                        </NavLink>
                    ))}
                </nav>

                {/* Sidebar Footer */}
                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-4 py-2 text-rose-400 hover:text-rose-300 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <span className={`flex items-center justify-center flex-shrink-0 transition-all ${isSidebarOpen ? 'text-xl w-6 h-6' : 'text-2xl w-8 h-8 mx-auto'}`}>
                            🚪
                        </span>
                        {isSidebarOpen && <span className="text-sm font-medium">로그아웃</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full relative z-10 bg-slate-50">
                {/* Header: Hide on mobile when a modal is open to save screen space */}
                <header className={`h-16 bg-white border-b border-slate-200 items-center justify-between px-6 shadow-sm z-10 ${isMobileModalOpen ? 'hidden md:flex' : 'flex'}`}>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setSidebarOpen(!isSidebarOpen)}
                            className="p-2 hover:bg-slate-100 rounded-full text-slate-500"
                            title="사이드바 토글"
                            aria-label="사이드바 토글"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <h2 className="text-lg font-bold text-slate-800">관리자 페이지</h2>
                    </div>

                    <NavLink to="/admin/profile" className="flex items-center gap-3 hover:bg-slate-50 p-2 rounded-lg transition-colors group">
                        <div className="flex flex-col items-end mr-2">
                            <span className="text-sm font-bold text-slate-800 group-hover:text-teal-600 transition-colors">{user?.contactName || '관리자'}</span>
                            <span className="text-xs text-slate-500">{user?.email}</span>
                        </div>
                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-teal-50 group-hover:text-teal-600 transition-colors">
                            <User className="w-6 h-6" />
                        </div>
                    </NavLink>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-8">
                    <AnimatePresence mode="wait">
                        <motion.div key={location.pathname} className="h-full w-full">
                            <Outlet />
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
}
