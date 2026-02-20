import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Check, X, Search, ShieldCheck, Clock, FileText } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function AdminUsers() {
    const { users, updateUserStatus } = useStore((state) => state);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');

    // --- Data Migration / Fix ---
    // Ensure all users have a valid status. If missing, default to PENDING.
    // This runs once to fix legacy data (e.g. from local storage).
    useEffect(() => {
        users.forEach(user => {
            if (!user.status || (user.status !== 'APPROVED' && user.status !== 'PENDING' && user.status !== 'REJECTED')) {
                console.log(`[Migration] Fixing status for user ${user.companyName} (${user.id}) -> PENDING`);
                updateUserStatus(user.id, 'PENDING');
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array to run only once on mount

    const filteredUsers = users.filter(user => {
        const matchesSearch =
            user.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.contactName.toLowerCase().includes(searchTerm.toLowerCase());

        // Treat missing status as PENDING for filtering
        const userStatus = user.status || 'PENDING';
        const matchesFilter = filter === 'ALL' || userStatus === filter;

        // Filter out the main admin from the list to prevent accidents
        const isNotMainAdmin = user.email !== 'admin@altf.kr';

        return matchesSearch && matchesFilter && isNotMainAdmin;
    });

    const handleApprove = (id: string, name: string) => {
        if (confirm(`${name} 님의 가입을 승인하시겠습니까?`)) {
            updateUserStatus(id, 'APPROVED');
        }
    };

    const handleReject = (id: string, name: string) => {
        if (confirm(`${name} 님의 가입을 거절(보류)하시겠습니까?`)) {
            updateUserStatus(id, 'REJECTED');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <ShieldCheck className="w-6 h-6 text-teal-600" />
                        회원 관리 (Users)
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        가입 신청한 회원을 승인하거나 관리합니다.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="기업명, 이름, 이메일 검색"
                            className="pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-teal-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 border-b border-slate-200 pb-1">
                <button
                    onClick={() => setFilter('ALL')}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] ${filter === 'ALL' ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    전체
                </button>
                <button
                    onClick={() => setFilter('PENDING')}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] flex items-center gap-2 ${filter === 'PENDING' ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    승인 대기
                    {users.filter(u => (u.status || 'PENDING') === 'PENDING').length > 0 && (
                        <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                            {users.filter(u => (u.status || 'PENDING') === 'PENDING').length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setFilter('APPROVED')}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] ${filter === 'APPROVED' ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    승인됨
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-6 py-4 font-medium">기업 정보</th>
                            <th className="px-6 py-4 font-medium">담당자</th>
                            <th className="px-6 py-4 font-medium">사업자등록증</th>
                            <th className="px-6 py-4 font-medium">가입일</th>
                            <th className="px-6 py-4 font-medium text-center">상태</th>
                            <th className="px-6 py-4 font-medium text-right">관리</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredUsers.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                    검색된 회원이 없습니다.
                                </td>
                            </tr>
                        ) : filteredUsers.map(user => {
                            const currentStatus = user.status || 'PENDING';
                            return (
                                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-800">{user.companyName}</div>
                                        <div className="text-slate-400 text-xs mt-0.5">{user.bizNo}</div>
                                        <div className="text-slate-400 text-xs">{user.address}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-slate-700 font-medium">{user.contactName}</div>
                                        <div className="text-slate-400 text-xs">{user.email}</div>
                                        <div className="text-slate-400 text-xs">{user.phone}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        {/* Mock File Link */}
                                        {user.bizLicenseFile ? (
                                            <button
                                                onClick={() => window.open(user.bizLicenseFile, '_blank')}
                                                className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium bg-blue-50 px-2 py-1 rounded border border-blue-100"
                                            >
                                                <FileText className="w-3 h-3" />
                                                [사업자등록증 보기]
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-1 text-xs text-slate-400">
                                                <span className="w-4 h-4 bg-slate-100 rounded flex items-center justify-center">
                                                    <X className="w-3 h-3" />
                                                </span>
                                                미첨부
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-slate-500">
                                        {new Date(user.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <StatusBadge status={currentStatus} />
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        {currentStatus === 'PENDING' && (
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleApprove(user.id, user.companyName)}
                                                    className="bg-teal-600 hover:bg-teal-700 h-8"
                                                >
                                                    <Check className="w-4 h-4 mr-1" /> 승인
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleReject(user.id, user.companyName)}
                                                    className="text-rose-600 hover:bg-rose-50 border-rose-200 h-8"
                                                >
                                                    <X className="w-4 h-4 mr-1" /> 거절
                                                </Button>
                                            </div>
                                        )}
                                        {currentStatus === 'APPROVED' && (
                                            <Button variant="ghost" size="sm" className="text-slate-400" disabled>
                                                승인완료
                                            </Button>
                                        )}
                                        {currentStatus === 'REJECTED' && (
                                            <Button variant="ghost" size="sm" className="text-rose-400" disabled>
                                                거절됨
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    // Treat missing/unknown as PENDING
    if (!status || status === 'PENDING') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700 border border-yellow-200">
                <Clock className="w-3 h-3" /> 대기중
            </span>
        );
    }
    if (status === 'APPROVED') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                <Check className="w-3 h-3" /> 승인됨
            </span>
        );
    }
    if (status === 'REJECTED') {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                <X className="w-3 h-3" /> 거절됨
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
            {status}
        </span>
    );
}
