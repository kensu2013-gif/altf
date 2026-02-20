import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import {
    ShoppingCart,
    FileText,
    Package,
    Settings,
    LogOut,
    Menu,
    User
} from 'lucide-react';
import { useState } from 'react';

export default function AdminLayout() {
    const navigate = useNavigate();
    const logout = useStore((state) => state.logout);
    const user = useStore((state) => state.auth.user);
    const [isSidebarOpen, setSidebarOpen] = useState(true);

    // [MOD] Ensure inventory is loaded/validated when accessing Admin Panel
    useInventory();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const NAV_ITEMS = [
        // { label: '대시보드', path: '/admin', icon: LayoutDashboard, exact: true }, // Maybe later
        { label: '회원 관리', path: '/admin/members', icon: User },
        { label: '담당자 관리', path: '/admin/managers', icon: User },
        { label: '주문 관리', path: '/admin/orders', icon: ShoppingCart },
        { label: '견적 관리', path: '/admin/quotes', icon: FileText },
        { label: '재고 관리', path: '/admin/inventory', icon: Package },
        { label: '설정', path: '/admin/settings', icon: Settings },
    ];

    return (
        <div className="flex h-screen bg-slate-50 font-pretendard">
            {/* Sidebar */}
            <aside
                className={`bg-slate-900 text-white transition-all duration-300 flex flex-col ${isSidebarOpen ? 'w-64' : 'w-20'}`}
            >
                {/* Logo Area */}
                <div className="h-16 flex items-center justify-center border-b border-slate-800">
                    {isSidebarOpen ? (
                        <span className="text-xl font-bold tracking-wider text-teal-400">ALTF ADMIN</span>
                    ) : (
                        <span className="text-xl font-bold text-teal-400">A</span>
                    )}
                </div>

                {/* Nav */}
                <nav className="flex-1 py-6 px-2 space-y-1">
                    {NAV_ITEMS.filter(item => {
                        if (user?.role === 'MANAGER') {
                            return ['/admin/orders', '/admin/quotes'].includes(item.path);
                        }
                        // MASTER or admin sees everything
                        return true;
                    }).map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) => `
                                flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors
                                ${isActive
                                    ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/20'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}
                            `}
                        >
                            <item.icon className="w-5 h-5 flex-shrink-0" />
                            {isSidebarOpen && <span>{item.label}</span>}
                        </NavLink>
                    ))}
                </nav>

                {/* Sidebar Footer */}
                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-4 py-2 text-rose-400 hover:text-rose-300 hover:bg-slate-800 rounded-lg transition-colors text-sm"
                    >
                        <LogOut className="w-5 h-5" />
                        {isSidebarOpen && <span>로그아웃</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-10">
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
                <main className="flex-1 overflow-auto p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
