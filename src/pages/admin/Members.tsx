import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Check, X, Search, ShieldCheck, Clock, Trash2, RefreshCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useNavigate } from 'react-router-dom';

export default function AdminMembers() {
    const { users, updateUserStatus, fetchUsers, deleteUser, updateUser, auth } = useStore((state) => state);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
    const [openManagerDropdown, setOpenManagerDropdown] = useState<string | null>(null); // userId of open dropdown
    const navigate = useNavigate();

    useEffect(() => {
        // Redirect if not MASTER
        // Although the route should be protected, double check here or just let the layout/App.tsx handle it.
        // We will assume App.tsx protection is sufficient but having a check doesn't hurt.
        if (auth.user?.role !== 'MASTER' && auth.user?.role !== 'admin') {
            navigate('/admin/orders');
        }
        fetchUsers();
    }, [fetchUsers, auth.user, navigate]);

    // Close dropdown when clicking outside (simple implementation)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (openManagerDropdown && !(e.target as Element).closest('.manager-dropdown-container')) {
                setOpenManagerDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openManagerDropdown]);

    const managers = users.filter(u => u.role === 'MANAGER');

    const filteredUsers = users.filter(user => {
        // Exclude Managers and Master Admin
        if (user.role === 'MANAGER' || user.role === 'MASTER' || user.email === 'admin@altf.kr') return false;

        const matchesSearch =
            user.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.contactName.toLowerCase().includes(searchTerm.toLowerCase());

        const userStatus = user.status || 'PENDING';

        let matchesFilter = true;
        if (filter === 'ALL') matchesFilter = true;
        else matchesFilter = userStatus === filter;

        return matchesSearch && matchesFilter;
    });

    const handleApprove = async (id: string, name: string) => {
        if (confirm(`${name} 님의 가입을 승인하시겠습니까?`)) {
            await updateUserStatus(id, 'APPROVED');
        }
    };

    const handleReject = (id: string, name: string) => {
        if (confirm(`${name} 님의 가입을 거절(보류)하시겠습니까?`)) {
            updateUserStatus(id, 'REJECTED');
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (confirm(`${name} 계정을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) {
            await deleteUser(id);
        }
    };

    const handleToggleManager = async (userId: string, managerId: string, currentIds: string[]) => {
        let newIds = [...currentIds];
        if (newIds.includes(managerId)) {
            newIds = newIds.filter(id => id !== managerId);
        } else {
            newIds.push(managerId);
        }
        await updateUser(userId, { managerIds: newIds }); // use managerIds
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 relative min-h-screen pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <ShieldCheck className="w-6 h-6 text-teal-600" />
                        회원 관리 (Members)
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        고객 회원을 승인하고 영업 담당자를 배정합니다.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchUsers()}
                        className="gap-2 text-slate-600 hover:text-teal-600 border-slate-200"
                        title="새로고침"
                    >
                        <RefreshCcw className="w-4 h-4" />
                    </Button>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="회원 검색..."
                            className="pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-teal-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 border-b border-slate-200 pb-1">
                <FilterTab label="전체" active={filter === 'ALL'} onClick={() => setFilter('ALL')} />
                <FilterTab label="승인 대기" active={filter === 'PENDING'} onClick={() => setFilter('PENDING')} count={users.filter(u => u.role !== 'MANAGER' && u.role !== 'MASTER' && u.status === 'PENDING').length} />
                <FilterTab label="승인됨" active={filter === 'APPROVED'} onClick={() => setFilter('APPROVED')} />
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible min-h-[400px]">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-6 py-4 font-medium">기업 정보 / 소속</th>
                            <th className="px-6 py-4 font-medium">담당자 / 연락처</th>
                            <th className="px-6 py-4 font-medium">영업 담당자 배정</th>
                            <th className="px-6 py-4 font-medium text-center">상태</th>
                            <th className="px-6 py-4 font-medium text-right">관리</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredUsers.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                                    검색된 회원이 없습니다.
                                </td>
                            </tr>
                        ) : filteredUsers.map(user => {
                            const currentStatus = user.status || 'PENDING';
                            const currentManagerIds = user.managerIds || (user.managerId ? [user.managerId] : []);

                            return (
                                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-800 flex items-center gap-2">
                                            {user.companyName}
                                        </div>
                                        {user.bizNo && <div className="text-slate-400 text-xs mt-0.5">{user.bizNo}</div>}
                                        <div className="text-slate-400 text-xs">{user.address}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-slate-700 font-medium">{user.contactName}</div>
                                        <div className="text-slate-400 text-xs">{user.email}</div>
                                        <div className="text-slate-400 text-xs">{user.phone}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="relative manager-dropdown-container">
                                            <button
                                                onClick={() => setOpenManagerDropdown(openManagerDropdown === user.id ? null : user.id)}
                                                className="w-full max-w-[200px] flex items-center justify-between text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-left hover:border-teal-500 transition-colors"
                                            >
                                                <span className="truncate">
                                                    {currentManagerIds.length > 0
                                                        ? (() => {
                                                            const firstManager = managers.find(m => m.id === currentManagerIds[0]);
                                                            const name = firstManager ? firstManager.contactName : 'Unknown';
                                                            return currentManagerIds.length > 1
                                                                ? `${name} 외 ${currentManagerIds.length - 1}명`
                                                                : `${name} (${firstManager?.companyName || ''})`;
                                                        })()
                                                        : <span className="text-slate-400">(미배정 - 전체)</span>}
                                                </span>
                                                <div className="bg-slate-100 p-0.5 rounded">
                                                    <Search className="w-3 h-3 text-slate-400" />
                                                </div>
                                            </button>

                                            {openManagerDropdown === user.id && (
                                                <div className="absolute top-full left-0 mt-1 w-[260px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="p-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500">
                                                        영업 담당자 선택 (다중가능)
                                                    </div>
                                                    <div className="max-h-[240px] overflow-y-auto p-1">
                                                        {managers.map(m => {
                                                            const isSelected = currentManagerIds.includes(m.id);
                                                            return (
                                                                <div
                                                                    key={m.id}
                                                                    onClick={() => handleToggleManager(user.id, m.id, currentManagerIds)}
                                                                    className={`flex items-start gap-2 p-2 rounded cursor-pointer transition-colors ${isSelected ? 'bg-teal-50/50' : 'hover:bg-slate-50'}`}
                                                                >
                                                                    <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-teal-600 border-teal-600' : 'border-slate-300 bg-white'}`}>
                                                                        {isSelected && <Check className="w-3 h-3 text-white" />}
                                                                    </div>
                                                                    <div>
                                                                        <div className={`text-sm ${isSelected ? 'font-bold text-teal-700' : 'font-medium text-slate-700'}`}>
                                                                            {m.contactName}
                                                                        </div>
                                                                        <div className="text-xs text-slate-400">{m.companyName}</div>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                        {managers.length === 0 && (
                                                            <div className="p-4 text-center text-xs text-slate-400">
                                                                등록된 영엄 담당자가 없습니다.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <StatusBadge status={currentStatus} />
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            {currentStatus === 'PENDING' && (
                                                <>
                                                    <Button size="sm" onClick={() => handleApprove(user.id, user.companyName)} className="bg-teal-600 h-8 text-xs">승인</Button>
                                                    <Button size="sm" variant="outline" onClick={() => handleReject(user.id, user.companyName)} className="text-rose-600 h-8 text-xs">거절</Button>
                                                </>
                                            )}
                                            {currentStatus !== 'PENDING' && (
                                                <Button size="sm" variant="ghost" onClick={() => handleDelete(user.id, user.companyName || user.contactName)} className="text-slate-400 hover:text-red-600 h-8 w-8 p-0" aria-label="삭제">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
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

function FilterTab({ label, active, onClick, count }: { label: string, active: boolean, onClick: () => void, count?: number }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] flex items-center gap-2 ${active ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-slate-500 hover:text-slate-700'}`}
        >
            {label}
            {count !== undefined && count > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                    {count}
                </span>
            )}
        </button>
    );
}

function StatusBadge({ status }: { status: string }) {
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
