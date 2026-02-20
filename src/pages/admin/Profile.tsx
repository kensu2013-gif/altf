import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { User, Lock, Save, AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function AdminProfile() {
    const user = useStore((state) => state.auth.user);
    const updateUser = useStore((state) => state.updateUser);

    const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    // If no user is logged in (should not happen in protected route)
    if (!user) return null;

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);

        // Validation
        if (!passwords.new || passwords.new.length < 4) {
            setMessage({ text: '새 비밀번호는 4자 이상이어야 합니다.', type: 'error' });
            return;
        }

        if (passwords.new !== passwords.confirm) {
            setMessage({ text: '새 비밀번호가 일치하지 않습니다.', type: 'error' });
            return;
        }

        // Add logic to verify current password if API supports it, 
        // currently standard user update endpoint might not verify old password explicitly 
        // without a specific endpoint, so we proceed with update.
        // Ideally, backend should handle current password verification.

        if (confirm('비밀번호를 변경하시겠습니까?')) {
            try {
                await updateUser(user.id, { password: passwords.new });
                setMessage({ text: '비밀번호가 성공적으로 변경되었습니다.', type: 'success' });
                setPasswords({ current: '', new: '', confirm: '' });
            } catch (error) {
                console.error(error);
                setMessage({ text: '비밀번호 변경 중 오류가 발생했습니다.', type: 'error' });
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <User className="w-6 h-6 text-teal-600" />
                    내 프로필 (My Profile)
                </h1>
                <p className="text-slate-500 text-sm mt-1">계정 정보를 확인하고 비밀번호를 변경할 수 있습니다.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Profile Info Card */}
                <div className="md:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex flex-col items-center">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-4">
                                <User className="w-10 h-10" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-800">{user.contactName || '관리자'}</h2>
                            <p className="text-sm text-slate-500">{user.email}</p>
                            <div className="mt-4 px-3 py-1 bg-teal-50 text-teal-700 text-xs font-bold rounded-full">
                                {user.role}
                            </div>
                        </div>

                        <div className="mt-6 space-y-4 pt-6 border-t border-slate-100">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase block mb-1">소속</label>
                                <p className="text-sm font-medium text-slate-700">{user.companyName || '-'}</p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase block mb-1">연락처</label>
                                <p className="text-sm font-medium text-slate-700">{user.phone || '-'}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Password Change Form */}
                <div className="md:col-span-2">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                            <Lock className="w-5 h-5 text-slate-400" />
                            비밀번호 변경
                        </h3>

                        <form onSubmit={handlePasswordChange} className="space-y-4">
                            {/* Note: Current password field is UI-only for now unless backend checks it */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">현재 비밀번호</label>
                                <input
                                    type="password"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                    placeholder="현재 비밀번호 입력"
                                    value={passwords.current}
                                    onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                                />
                            </div>

                            <div className="pt-2">
                                <label className="block text-sm font-medium text-slate-700 mb-1">새 비밀번호</label>
                                <input
                                    type="password"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                    placeholder="새 비밀번호 (4자 이상)"
                                    value={passwords.new}
                                    onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">새 비밀번호 확인</label>
                                <input
                                    type="password"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                    placeholder="새 비밀번호 재입력"
                                    value={passwords.confirm}
                                    onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                                />
                            </div>

                            {message && (
                                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                                    <AlertCircle className="w-4 h-4" />
                                    {message.text}
                                </div>
                            )}

                            <div className="pt-4 flex justify-end">
                                <Button type="submit" className="bg-slate-800 text-white hover:bg-slate-700 gap-2">
                                    <Save className="w-4 h-4" />
                                    비밀번호 변경 저장
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
