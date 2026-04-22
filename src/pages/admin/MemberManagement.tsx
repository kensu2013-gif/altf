// Removed unused React hooks
import { useStore } from '../../store/useStore';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminMembers from './Members';
import AdminManagers from './Managers';
import AdminActiveUsers from './ActiveUsers';
import { Users, Briefcase, Activity } from 'lucide-react';
import { PageTransition } from '../../components/ui/PageTransition';
import { CalmPageShell } from '../../components/ui/CalmPageShell';

export default function MemberManagement() {
    const location = useLocation();
    const navigate = useNavigate();
    const user = useStore(state => state.auth.user);
    let activeTab: 'MEMBERS' | 'MANAGERS' | 'ACTIVE_USERS' = 'MEMBERS';
    if (location.hash === '#managers') activeTab = 'MANAGERS';
    else if (location.hash === '#active-users' && (user?.role === 'MASTER' || user?.role === 'admin')) activeTab = 'ACTIVE_USERS';

    const handleTabChange = (tab: 'MEMBERS' | 'MANAGERS' | 'ACTIVE_USERS') => {
        let hash = '';
        if (tab === 'MANAGERS') hash = '#managers';
        if (tab === 'ACTIVE_USERS') hash = '#active-users';
        navigate(`/admin/members${hash}`, { replace: true });
    };

    return (
        <CalmPageShell>
            {/* Header Area */}
            <div className="mb-6 flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-6 h-6 text-teal-600" />
                    멤버 관리
                </h1>
                <p className="text-sm text-slate-500">
                    고객사, 영업 담당자, 현재 시스템 접속자를 통합 관리합니다.
                </p>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 mb-6 border-b border-slate-200">
                <button
                    onClick={() => handleTabChange('MEMBERS')}
                    className={`px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all flex items-center gap-2 relative top-[1px]
                        ${activeTab === 'MEMBERS' 
                            ? 'text-teal-700 bg-white border border-b-0 border-slate-200 shadow-[0_-2px_0_0_#0f766e_inset]' 
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                >
                    <Users className="w-4 h-4" />
                    고객사 회원 관리
                </button>
                <button
                    onClick={() => handleTabChange('MANAGERS')}
                    className={`px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all flex items-center gap-2 relative top-[1px]
                        ${activeTab === 'MANAGERS' 
                            ? 'text-indigo-700 bg-white border border-b-0 border-slate-200 shadow-[0_-2px_0_0_#4338ca_inset]' 
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                >
                    <Briefcase className="w-4 h-4" />
                    영업 담당자 관리
                </button>
                {(user?.role === 'MASTER' || user?.role === 'admin') && (
                    <button
                        onClick={() => handleTabChange('ACTIVE_USERS')}
                        className={`px-4 py-2.5 text-sm font-bold rounded-t-lg transition-all flex items-center gap-2 relative top-[1px]
                            ${activeTab === 'ACTIVE_USERS' 
                                ? 'text-amber-700 bg-white border border-b-0 border-slate-200 shadow-[0_-2px_0_0_#b45309_inset]' 
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <Activity className="w-4 h-4" />
                        접속자 현황
                    </button>
                )}
            </div>

            {/* Content Area */}
            <div className="bg-transparent">
                <PageTransition key={activeTab}>
                    {activeTab === 'MEMBERS' && (
                        <div className="member-management-wrapper">
                            <AdminMembers />
                        </div>
                    )}
                    {activeTab === 'MANAGERS' && (
                        <div className="member-management-wrapper">
                            <AdminManagers />
                        </div>
                    )}
                    {activeTab === 'ACTIVE_USERS' && (
                        <div className="member-management-wrapper">
                            <AdminActiveUsers />
                        </div>
                    )}
                </PageTransition>
            </div>
        </CalmPageShell>
    );
}
