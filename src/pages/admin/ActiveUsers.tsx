import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { CalmPageShell } from '../../components/ui/CalmPageShell';
import { PageTransition } from '../../components/ui/PageTransition';
import { ShieldCheck, Clock, Monitor } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface ActiveSession {
    userId: string;
    email: string;
    companyName: string;
    role: string;
    lastSeen: number;
    activity: string;
    ip: string;
}

export default function ActiveUsers() {
    const [sessions, setSessions] = useState<ActiveSession[]>([]);
    const [loading, setLoading] = useState(true);
    const user = useStore(state => state.auth.user);

    useEffect(() => {
        if (!user || (user.role !== 'MASTER' && user.role !== 'admin')) return;

        const fetchActiveUsers = async () => {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/active-users`, {
                    headers: {
                        'x-requester-role': user.role || ''
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setSessions(data);
                }
            } catch (err) {
                console.error("Failed to fetch active users", err);
            } finally {
                setLoading(false);
            }
        };

        fetchActiveUsers();
        const intervalId = setInterval(fetchActiveUsers, 30000); // Poll every 30s
        return () => clearInterval(intervalId);
    }, [user]);

    if (user?.role !== 'MASTER' && user?.role !== 'admin') {
        return <div className="p-8 text-center text-red-500 font-bold">접근 권한이 없습니다.</div>;
    }

    return (
        <CalmPageShell>
            <div className="mb-6 flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-teal-600" />
                    접속자 현황
                </h1>
                <p className="text-sm text-slate-500">현재 시스템을 사용 중인 사용자 목록입니다.</p>
            </div>

            <PageTransition>
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-slate-400">불러오는 중...</div>
                    ) : sessions.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">현재 접속 중인 사용자가 없습니다.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th scope="col" className="px-6 py-4 font-bold">사용자</th>
                                        <th scope="col" className="px-6 py-4 font-bold">권한</th>
                                        <th scope="col" className="px-6 py-4 font-bold">최근 활동 내용</th>
                                        <th scope="col" className="px-6 py-4 font-bold">최근 활동 시간</th>
                                        <th scope="col" className="px-6 py-4 font-bold">접속 IP</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sessions.sort((a, b) => b.lastSeen - a.lastSeen).map((session, index) => (
                                        <tr key={`${session.email}-${index}`} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-slate-800">{session.companyName}</div>
                                                <div className="text-xs text-slate-500">{session.email}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 text-[10px] font-bold rounded-md border ${session.role === 'MASTER' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                                        session.role === 'MANAGER' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                                                            'bg-slate-100 text-slate-600 border-slate-200'
                                                    }`}>
                                                    {session.role}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-slate-700">
                                                    <Monitor className="w-4 h-4 text-slate-400" />
                                                    <span className="font-medium">{session.activity}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-slate-500">
                                                    <Clock className="w-4 h-4" />
                                                    {formatDistanceToNow(session.lastSeen, { addSuffix: true, locale: ko })}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                                                {session.ip}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </PageTransition>
        </CalmPageShell>
    );
}
