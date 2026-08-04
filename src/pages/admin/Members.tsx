import { useState, useEffect, useDeferredValue } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { Check, X, Search, Clock, Trash2, RefreshCcw, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useNavigate } from 'react-router-dom';
import type { User } from '../../types';

export default function AdminMembers() {
    const { users, fetchUsers, deleteUser, updateUser, auth } = useStore(useShallow((state) => ({
        users: state.users,
        fetchUsers: state.fetchUsers,
        deleteUser: state.deleteUser,
        updateUser: state.updateUser,
        auth: state.auth
    })));
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
    const [openManagerDropdown, setOpenManagerDropdown] = useState<string | null>(null); // userId of open dropdown
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
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
            user.companyName.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
            user.contactName.toLowerCase().includes(deferredSearchTerm.toLowerCase());

        const userStatus = user.status || 'PENDING';

        let matchesFilter = true;
        if (filter === 'ALL') matchesFilter = true;
        else matchesFilter = userStatus === filter;

        return matchesSearch && matchesFilter;
    });

    const handleApprove = async (id: string, name: string) => {
        if (confirm(`${name} 님의 가입을 승인하시겠습니까?`)) {
            try {
                await updateUser(id, { status: 'APPROVED' });
            } catch {
                // Error is already alerted in store, but we catch to prevent unhandled promise rejection
            }
        }
    };

    const handleReject = async (id: string, name: string) => {
        if (confirm(`${name} 님의 가입을 거절(보류)하시겠습니까?`)) {
            try {
                await updateUser(id, { status: 'REJECTED' });
            } catch {
                // Error is already alerted in store
            }
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (confirm(`${name} 계정을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) {
            await deleteUser(id);
        }
    };

    const handleEditClick = (user: User) => {
        setEditingUser({ ...user });
        setIsEditModalOpen(true);
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;
        try {
            const updates: Partial<User> = {
                companyName: editingUser.companyName,
                bizNo: editingUser.bizNo,
                address: editingUser.address,
                contactName: editingUser.contactName,
                email: editingUser.email,
                phone: editingUser.phone,
            };

            if (editingUser.password && editingUser.password.trim() !== '') {
                updates.password = editingUser.password;
            }

            await updateUser(editingUser.id, updates);
            alert('회원 정보가 수정되었습니다.');
            setIsEditModalOpen(false);
            setEditingUser(null);
        } catch (err) {
            console.error(err);
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
                <div className="hidden md:block">
                    {/* Empty div to keep flex-between layout if needed, or we can just justify-end the right side */}
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
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible min-h-100">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-6 py-4 font-medium">기업 정보 / 소속</th>
                            <th className="px-6 py-4 font-medium">담당자 / 연락처</th>
                            <th className="px-6 py-4 font-medium">영업 담당자 배정</th>
                            <th className="px-6 py-4 font-medium text-center">상태</th>
                            <th className="px-6 py-4 font-medium text-center">최근 접속일</th>
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
                                                className="w-full max-w-50 flex items-center justify-between text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-left hover:border-teal-500 transition-colors"
                                            >
                                                <span className="truncate">
                                                    {currentManagerIds.length > 0
                                                        ? (() => {
                                                            const firstManager = managers.find(m => m.id === currentManagerIds[0]);
                                                            const name = firstManager ? firstManager.contactName : 'Unknown';
                                                            return currentManagerIds.length > 1
                                                                ? `${name} 외 ${currentManagerIds.length - 1}명`
                                                                : `${name} ${firstManager?.companyName ? `(${firstManager.companyName})` : ''}`;
                                                        })()
                                                        : <span className="text-slate-400">(미배정 - 전체)</span>}
                                                </span>
                                                <div className="bg-slate-100 p-0.5 rounded">
                                                    <Search className="w-3 h-3 text-slate-400" />
                                                </div>
                                            </button>

                                            {openManagerDropdown === user.id && (
                                                <div className="absolute top-full left-0 mt-1 w-65 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="p-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500">
                                                        영업 담당자 선택 (다중가능)
                                                    </div>
                                                    <div className="max-h-60 overflow-y-auto p-1">
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
                                    <td className="px-6 py-4 text-center text-xs text-slate-500">
                                        {user.lastLoginAt ? (
                                            <div className="flex flex-col items-center gap-1">
                                                <span>{new Date(user.lastLoginAt).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                                                <span className="text-[10px] text-slate-400">{new Date(user.lastLoginAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        ) : (
                                            <span className="text-slate-300">-</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2 items-center">
                                            {currentStatus === 'PENDING' && (
                                                <>
                                                    <Button size="sm" onClick={() => handleApprove(user.id, user.companyName)} className="bg-teal-600 h-8 text-xs">승인</Button>
                                                    <Button size="sm" variant="outline" onClick={() => handleReject(user.id, user.companyName)} className="text-rose-600 h-8 text-xs">거절</Button>
                                                </>
                                            )}
                                            {currentStatus === 'APPROVED' && (
                                                <Button size="sm" variant="outline" onClick={() => handleReject(user.id, user.companyName)} className="text-rose-600 border-rose-200 hover:bg-rose-50 h-8 text-xs">승인 취소 (보류)</Button>
                                            )}
                                            {currentStatus === 'REJECTED' && (
                                                <Button size="sm" onClick={() => handleApprove(user.id, user.companyName)} className="bg-teal-600 h-8 text-xs">다시 승인</Button>
                                            )}

                                            {/* 마스터 수정/삭제 관리 권한 */}
                                            {(auth.user?.role === 'MASTER' || auth.user?.role === 'admin') && (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleEditClick(user)}
                                                        className="text-slate-600 border-slate-200 hover:bg-slate-50 h-8 w-8 p-0 flex items-center justify-center"
                                                        title="수정"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleDelete(user.id, user.companyName || user.contactName)}
                                                        className="text-slate-400 border-slate-200 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 h-8 w-8 p-0 flex items-center justify-center"
                                                        title="삭제"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Edit User Modal */}
            {isEditModalOpen && editingUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800">회원 정보 수정</h3>
                            <button onClick={() => { setIsEditModalOpen(false); setEditingUser(null); }} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">이메일 (ID)</label>
                                <input disabled type="email" className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-100 text-slate-500 cursor-not-allowed"
                                    title="이메일 (ID)"
                                    value={editingUser.email} />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">비밀번호 변경 (선택)</label>
                                <input
                                    type="password"
                                    className="w-full px-3 py-2 border rounded-lg text-sm text-slate-900 placeholder:text-slate-300 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all"
                                    title="비밀번호"
                                    placeholder="변경시에만 입력하세요"
                                    value={editingUser.password || ''}
                                    onChange={e => setEditingUser({ ...editingUser, password: e.target.value })}
                                />
                                <p className="text-[10px] text-slate-400 mt-1">* 입력하지 않으면 기존 비밀번호가 유지됩니다.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">기업명</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                        title="기업명" placeholder="회사명 입력"
                                        value={editingUser.companyName}
                                        onChange={e => setEditingUser({ ...editingUser, companyName: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">사업자등록번호</label>
                                    <input type="text" className="w-full px-3 py-2 border rounded-lg text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                        title="사업자등록번호" placeholder="123-45-67890"
                                        value={editingUser.bizNo || ''}
                                        onChange={e => setEditingUser({ ...editingUser, bizNo: e.target.value })} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">담당자 이름</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                        title="담당자 이름" placeholder="담당자 성함"
                                        value={editingUser.contactName}
                                        onChange={e => setEditingUser({ ...editingUser, contactName: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                        title="연락처" placeholder="010-0000-0000"
                                        value={editingUser.phone}
                                        onChange={e => setEditingUser({ ...editingUser, phone: e.target.value })} />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">주소</label>
                                <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                    title="주소" placeholder="회사 주소 입력"
                                    value={editingUser.address}
                                    onChange={e => setEditingUser({ ...editingUser, address: e.target.value })} />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <Button type="button" variant="outline" onClick={() => { setIsEditModalOpen(false); setEditingUser(null); }} className="flex-1 border-slate-200 text-slate-600 hover:bg-slate-50">
                                    취소
                                </Button>
                                <Button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-medium">
                                    저장
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function FilterTab({ label, active, onClick, count }: { label: string, active: boolean, onClick: () => void, count?: number }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-px flex items-center gap-2 ${active ? 'text-teal-600 border-b-2 border-teal-600 bg-teal-50/50' : 'text-slate-500 hover:text-slate-700'}`}
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
