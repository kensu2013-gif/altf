import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { UserPlus, Trash2, Mail, Phone, MapPin, X, Briefcase, Search, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { User } from '../../types';

export default function AdminManagers() {
    const { users, fetchUsers, createUser, deleteUser, updateUser } = useStore((state) => state);
    const [searchTerm, setSearchTerm] = useState('');

    // Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);

    const [newUser, setNewUser] = useState<Partial<User>>({
        email: '', password: '', contactName: '', companyName: '', phone: '', address: '', role: 'MANAGER'
    });

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Filter only Managers
    const filteredUsers = users.filter(user => {
        if (user.role !== 'MANAGER') return false;

        const matchesSearch =
            (user.contactName?.toLowerCase().includes(searchTerm.toLowerCase()) || '') ||
            (user.email?.toLowerCase().includes(searchTerm.toLowerCase()) || '') ||
            (user.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) || ''); // companyName used for Department

        return matchesSearch;
    });

    const handleDelete = async (id: string, name: string) => {
        if (confirm(`${name} 매니저 계정을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) {
            await deleteUser(id);
        }
    };

    const handleCreateManager = async (e: React.FormEvent) => {
        e.preventDefault();
        const success = await createUser({
            ...newUser,
            role: 'MANAGER',
            status: 'APPROVED', // Managers created by admin are auto-approved
            agreedToTerms: true,
            agreedToPrivacy: true,
            agreedToMarketing: true,
            createdAt: new Date().toISOString()
        });

        if (success) {
            alert('영업 담당자가 생성되었습니다.');
            setIsCreateModalOpen(false);
            setNewUser({ email: '', password: '', contactName: '', companyName: '', phone: '', address: '', role: 'MANAGER' });
        } else {
            alert('생성 실패. 이메일 중복 등을 확인해주세요.');
        }
    };

    const handleEditClick = (user: User) => {
        setEditingUser(user);
        setIsEditModalOpen(true);
    };

    const handleUpdateManager = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;

        const updates: Partial<User> = {
            contactName: editingUser.contactName,
            companyName: editingUser.companyName,
            phone: editingUser.phone,
            address: editingUser.address
        };

        if (editingUser.password && editingUser.password.trim() !== '') {
            updates.password = editingUser.password;
        }

        await updateUser(editingUser.id, updates);

        alert('담당자 정보가 수정되었습니다.');
        setIsEditModalOpen(false);
        setEditingUser(null);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 relative">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Briefcase className="w-6 h-6 text-teal-600" />
                        담당자 관리 (Managers)
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        영업 담당자를 생성하고 관리합니다. 이들은 주문 및 견적 관리가 가능합니다.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="담당자 검색..."
                            className="pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-teal-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2 bg-slate-800 text-white hover:bg-slate-700">
                        <UserPlus className="w-4 h-4" /> 담당자 생성
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible min-h-[400px]">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-6 py-4 font-medium">이름 / 이메일</th>
                            <th className="px-6 py-4 font-medium">소속 (부서)</th>
                            <th className="px-6 py-4 font-medium">연락처</th>
                            <th className="px-6 py-4 font-medium text-right">관리</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredUsers.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                                    등록된 영업 담당자가 없습니다.
                                </td>
                            </tr>
                        ) : filteredUsers.map(user => (
                            <tr key={user.id} className="hover:bg-slate-50/50 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="font-bold text-slate-800 flex items-center gap-2">
                                        {user.contactName}
                                    </div>
                                    <div className="text-slate-400 text-xs flex items-center gap-1 mt-1">
                                        <Mail className="w-3 h-3" /> {user.email}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-slate-700 font-medium">{user.companyName}</div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-slate-500 text-xs flex items-center gap-1">
                                        <Phone className="w-3 h-3" /> {user.phone}
                                    </div>
                                    <div className="text-slate-400 text-xs flex items-center gap-1 mt-1">
                                        <MapPin className="w-3 h-3" /> {user.address}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => handleEditClick(user)} className="text-slate-400 hover:text-teal-600 h-8 w-8 p-0" aria-label="수정">
                                            <Pencil className="w-4 h-4" />
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => handleDelete(user.id, user.contactName)} className="text-slate-400 hover:text-red-600 h-8 w-8 p-0" aria-label="삭제">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Create Manager Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800">영업 담당자 생성</h3>
                            <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateManager} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">이메일 (ID)</label>
                                <input required type="email" className="w-full px-3 py-2 border rounded-lg text-sm"
                                    title="이메일 (ID)" placeholder="example@company.com"
                                    value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">비밀번호</label>
                                <input required type="password" className="w-full px-3 py-2 border rounded-lg text-sm"
                                    title="비밀번호" placeholder="비밀번호 입력"
                                    value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">이름</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                        title="이름" placeholder="담당자 이름"
                                        value={newUser.contactName} onChange={e => setNewUser({ ...newUser, contactName: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">소속 (부서/팀)</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                        title="소속" placeholder="소속 부서/팀"
                                        value={newUser.companyName} onChange={e => setNewUser({ ...newUser, companyName: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
                                <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                    title="연락처" placeholder="010-0000-0000"
                                    value={newUser.phone} onChange={e => setNewUser({ ...newUser, phone: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">주소 (상세 정보)</label>
                                <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                    title="주소" placeholder="주소 입력"
                                    value={newUser.address} onChange={e => setNewUser({ ...newUser, address: e.target.value })} />
                            </div>
                            <Button type="submit" className="w-full bg-slate-800 text-white hover:bg-slate-700 mt-2">
                                생성하기
                            </Button>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Manager Modal */}
            {isEditModalOpen && editingUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800">영업 담당자 정보 수정</h3>
                            <button onClick={() => { setIsEditModalOpen(false); setEditingUser(null); }} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleUpdateManager} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">이메일 (ID)</label>
                                <input disabled type="email" className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-100 text-slate-500 cursor-not-allowed"
                                    title="이메일 (ID)"
                                    value={editingUser.email} />
                            </div>

                            {/* Password Update Field */}
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
                                    <label className="block text-xs font-bold text-slate-500 mb-1">이름</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                        title="이름" placeholder="담당자 이름"
                                        value={editingUser.contactName}
                                        onChange={e => setEditingUser({ ...editingUser, contactName: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">소속 (부서/팀)</label>
                                    <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                        title="소속" placeholder="소속 부서/팀"
                                        value={editingUser.companyName}
                                        onChange={e => setEditingUser({ ...editingUser, companyName: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
                                <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                    title="연락처" placeholder="010-0000-0000"
                                    value={editingUser.phone}
                                    onChange={e => setEditingUser({ ...editingUser, phone: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">주소 (상세 정보)</label>
                                <input required type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
                                    title="주소" placeholder="주소 입력"
                                    value={editingUser.address}
                                    onChange={e => setEditingUser({ ...editingUser, address: e.target.value })} />
                            </div>
                            <Button type="submit" className="w-full bg-slate-800 text-white hover:bg-slate-700 mt-2">
                                수정 저장
                            </Button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
