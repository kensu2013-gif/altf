import { useState, useMemo, useEffect } from 'react';
import { Users, MapPin, Building2, TrendingUp, Search, Contact, Activity, AlertTriangle, Trash2, Edit2, Plus, BarChart2, AlertCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';

interface Customer {
    id: string;
    companyName: string;
    ceo: string;
    businessNumber: string;
    address: string;
    region: string;
    salesType: string;
    industry: string;
    items: string;
    contactName: string;
    phone: string;
    email: string;
    isDeleted?: boolean;
}

export default function Customers() {
    const user = useStore(state => state.auth.user);
    const orders = useStore(state => state.orders);
    const [customersList, setCustomersList] = useState<Customer[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
    const [activeTab, setActiveTab] = useState<'MASTER' | 'ANALYTICS'>('MASTER');
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);

    const load = async () => {
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                headers: { 'x-requester-role': user?.role || 'GUEST' }
            });
            if (res.ok) {
                const data = await res.json();
                setCustomersList(data.filter((c: Customer) => !c.isDeleted));
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        load();
    }, [user?.role]);

    const handlePurge = async () => {
        if (!window.confirm("정말 [이메일, 연락처, 주소, 담당자명] 중 하나라도 누락된 업체와 중복 데이터를 싹 지우시겠습니까?\n이 작업은 즉시 S3 데이터베이스에 반영되며 복구할 수 없습니다.")) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/action/purge`, {
                method: 'POST',
                headers: { 'x-requester-role': user?.role || 'GUEST' }
            });
            if (res.ok) {
                const data = await res.json();
                alert(`정화 완료!\n기존 ${data.originalCount}업체 -> 정예화 후 ${data.newCount}업체로 리셋되었습니다.`);
                load();
            } else {
                alert('권한이 없거나 오류가 발생했습니다.');
            }
        } catch(e) {
            alert('오류가 발생했습니다.');
        }
    };

    const handleDelete = async (id: string, companyName: string) => {
        if (!window.confirm(`[${companyName}]을(를) 정말 삭제하시겠습니까?`)) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-requester-role': user?.role || 'GUEST'
                },
                body: JSON.stringify({ isDeleted: true })
            });
            if (res.ok) {
                setCustomersList(prev => prev.filter(c => c.id !== id));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSaveForm = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingCustomer) return;
        try {
            if (editingCustomer.id) {
                // UPDATE
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${editingCustomer.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-requester-role': user?.role || 'GUEST'
                    },
                    body: JSON.stringify(editingCustomer)
                });
                if (res.ok) {
                    const saved = await res.json();
                    setCustomersList(prev => prev.map(c => c.id === saved.id ? saved : c));
                    setIsModalOpen(false);
                }
            } else {
                // CREATE
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-requester-role': user?.role || 'GUEST'
                    },
                    body: JSON.stringify(editingCustomer)
                });
                if (res.ok) {
                    const saved = await res.json();
                    setCustomersList(prev => [saved, ...prev]);
                    setIsModalOpen(false);
                }
            }
        } catch(e) {
            alert('저장 중 오류가 발생했습니다.');
        }
    };

    const regions = useMemo(() => {
        const set = new Set<string>();
        customersList.forEach(c => c.region && set.add(c.region));
        return ['경기도', '경상도', ...Array.from(set).filter(r => r !== '경기도' && r !== '경상도')].sort();
    }, [customersList]);

    const filtered = useMemo(() => {
        let list = customersList;
        if (selectedRegion !== 'ALL') {
            list = list.filter(c => c.region === selectedRegion);
        }
        if (searchTerm) {
            const low = searchTerm.toLowerCase();
            list = list.filter(c => 
                (c.companyName && c.companyName.toLowerCase().includes(low)) ||
                (c.address && c.address.toLowerCase().includes(low)) ||
                (c.contactName && c.contactName.toLowerCase().includes(low))
            );
        }
        return list;
    }, [searchTerm, selectedRegion, customersList]);

    const stats = useMemo(() => {
        return {
            total: customersList.length,
            "경기도": customersList.filter(c => c.region === '경기도').length,
            "경상도": customersList.filter(c => c.region === '경상도').length,
            etc: customersList.filter(c => c.region !== '경기도' && c.region !== '경상도').length
        };
    }, [customersList]);

    // Analytics Engine
    const analytics = useMemo(() => {
        const regionMap: Record<string, { totalAmount: number; totalQty: number; items: Record<string, number>; missingCustomers: Set<string> }> = {};
        
        orders.forEach(o => {
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return;
            
            const customer = customersList.find(c => c.companyName === o.customerName);
            const region = customer?.region || 'CRM 미등록/예외';
            
            if (!regionMap[region]) {
                regionMap[region] = { totalAmount: 0, totalQty: 0, items: {}, missingCustomers: new Set() };
            }
            if (!customer) {
                regionMap[region].missingCustomers.add(o.customerName);
            }

            regionMap[region].totalAmount += o.totalAmount;
            
            o.items?.forEach(item => {
                const itemKey = `${item.name}-${item.thickness}-${item.size}`;
                regionMap[region].totalQty += item.quantity || 0;
                regionMap[region].items[itemKey] = (regionMap[region].items[itemKey] || 0) + (item.quantity || 0);
            });
        });

        // Convert to sorted array
        const results = Object.keys(regionMap).map(k => {
            const topItems = Object.entries(regionMap[k].items)
                .sort((a,b) => b[1] - a[1])
                .slice(0, 5);
            return {
                region: k,
                ...regionMap[k],
                topItems,
                missingArray: Array.from(regionMap[k].missingCustomers)
            };
        }).sort((a,b) => b.totalQty - a.totalQty);

        return results;
    }, [orders, customersList]);

    if (user?.role !== 'MASTER' && user?.role?.toLowerCase() !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center h-full pt-20 text-slate-500">
                <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
                <h1 className="text-2xl font-bold text-slate-800">접근 권한 없음</h1>
                <p className="mt-2">알트에프 거래처(CRM) 원장 관리는 최고 관리자(MASTER) 권한만 접근할 수 있습니다.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* TABS */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button 
                    onClick={() => setActiveTab('MASTER')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all ${activeTab === 'MASTER' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                >
                    <Users className="w-4 h-4 inline mr-2"/>
                    전사 거래처 8도 원장 (Master)
                </button>
                <button 
                    onClick={() => setActiveTab('ANALYTICS')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all ${activeTab === 'ANALYTICS' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                >
                    <BarChart2 className="w-4 h-4 inline mr-2"/>
                    지역/품목별 실판매 분석 (Analytics)
                </button>
            </div>

            {activeTab === 'MASTER' && (
                <>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                                <Users className="w-7 h-7 text-indigo-600" />
                                지역별 전사 거래처 마스터 관리
                            </h1>
                            <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                                고품질 CRM 에코시스템 유지를 위해 필요 정보가 누락된 데이터는 빠르게 정화하세요.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={handlePurge}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                깡통 데이터 일괄 삭제
                            </button>
                            <button 
                                onClick={() => { setEditingCustomer({ region: '경기도' }); setIsModalOpen(true); }}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md transition-colors flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                새 거래처 추가
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><Building2 className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><Users className="w-4 h-4"/>총 거래망 유지</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats.total}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>

                        <div className="bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><MapPin className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><MapPin className="w-4 h-4"/>경기도권 (시화 배송망)</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats['경기도']}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>

                        <div className="bg-gradient-to-br from-sky-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><MapPin className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><MapPin className="w-4 h-4"/>경상도권 (부산 배송망)</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats['경상도']}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>

                        <div className="bg-gradient-to-br from-slate-600 to-slate-800 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><Activity className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><TrendingUp className="w-4 h-4"/>충청/전라/강원 기타</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats.etc}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-600 mr-2">지역(8도) 필터링:</span>
                                <select 
                                    title="지역 필터링"
                                    value={selectedRegion}
                                    onChange={(e) => setSelectedRegion(e.target.value)}
                                    className="bg-white border text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-indigo-500 shadow-sm"
                                >
                                    <option value="ALL">전국 지도 (전체)</option>
                                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            
                            <div className="flex items-center gap-2 w-full md:w-auto relative">
                                <Search className="w-4 h-4 absolute left-3 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="상호명, 주소, 담당자 검색..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="bg-white border pl-9 text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-indigo-500 w-full md:w-72 shadow-inner"
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="px-5 py-3">속령 (지점)</th>
                                        <th className="px-5 py-3">업체명 (대표자)</th>
                                        <th className="px-5 py-3">무결성 체크</th>
                                        <th className="px-5 py-3">배송/주소지</th>
                                        <th className="px-5 py-3">연락처/담당망</th>
                                        <th className="px-5 py-3 text-center">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filtered.slice(0, 300).map(c => {
                                        const missingEmail = !c.email || c.email.trim() === '';
                                        const missingBizNo = !c.businessNumber || c.businessNumber.trim() === '';

                                        return (
                                        <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                                            <td className="px-5 py-3 font-medium">
                                                {c.region === '경기도' ? (
                                                    <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold">경기도권</span>
                                                ) : c.region === '경상도' ? (
                                                    <span className="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold">경상도권</span>
                                                ) : (
                                                    <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full text-xs font-bold">{c.region}</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 font-bold text-slate-800">{c.companyName} <span className="text-[10px] text-slate-400 font-normal ml-1">({c.ceo || '-'})</span></td>
                                            <td className="px-5 py-3">
                                                <div className="flex gap-1">
                                                    {missingBizNo ? (
                                                        <span className="bg-rose-50 text-rose-500 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-bold">사업자누락</span>
                                                    ) : (
                                                        <span className="text-slate-400 text-xs font-mono">{c.businessNumber}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600 text-[13px] hover:text-indigo-600 cursor-pointer max-w-[200px] truncate" title={c.address}>
                                                <MapPin className="w-3.5 h-3.5 inline mr-1 text-slate-400"/>
                                                {c.address ? c.address : <span className="text-rose-400 text-[10px] font-bold border border-rose-200 px-1 py-0.5 rounded bg-rose-50">주소누락</span>}
                                            </td>
                                            <td className="px-5 py-3 text-slate-700 font-bold border-l border-slate-50 bg-slate-50/50">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="flex items-center gap-1.5">
                                                        <Contact className="w-3.5 h-3.5 text-indigo-400"/>
                                                        {c.contactName || <span className="text-rose-400 text-[10px] font-bold border border-rose-200 px-1 py-0.5 rounded bg-rose-50">담당자누락</span>}
                                                        ({c.phone || <span className="text-rose-400 text-[10px] font-bold border border-rose-200 px-1 py-0.5 rounded bg-rose-50">번호누락</span>})
                                                    </span>
                                                    {missingEmail ? (
                                                        <span className="bg-rose-50 text-rose-500 border border-rose-200 px-2 py-0.5 mt-0.5 rounded text-[10px] font-bold w-fit ml-5">이메일누락</span>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-500 font-normal ml-5">{c.email}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button 
                                                        onClick={() => { setEditingCustomer(c); setIsModalOpen(true); }}
                                                        className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all outline-none"
                                                        title="수정"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(c.id, c.companyName)}
                                                        className="p-1.5 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all outline-none"
                                                        title="삭제"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        )
                                    })}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-5 py-12 text-center text-slate-400 font-medium">검색된 정보가 없습니다.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'ANALYTICS' && (
                <div className="space-y-6">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                            <BarChart2 className="w-7 h-7 text-indigo-600" />
                            판매 배관 지역 점유율 (CRM Cross Analytics)
                        </h1>
                        <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                            접수된 주문건의 상호명을 CRM 고객 명부와 크로스체크하여 "어느 지역으로 어떤 자재가 집중되고 있는지"를 분석합니다.
                        </p>
                    </div>

                    <div className="grid gap-4">
                        {analytics.map((reg) => (
                            <div key={reg.region} className={`rounded-xl border ${reg.region === 'CRM 미등록/예외' ? 'bg-amber-50/50 border-amber-200 shadow-sm' : 'bg-white border-slate-200 shadow-sm'} overflow-hidden`}>
                                <div className={`px-5 py-4 flex items-center justify-between border-b ${reg.region === 'CRM 미등록/예외' ? 'border-amber-100 bg-amber-50' : 'border-slate-100 bg-slate-50/80'}`}>
                                    <h3 className="font-bold flex items-center gap-2 text-lg">
                                        {reg.region === 'CRM 미등록/예외' ? <AlertCircle className="w-5 h-5 text-amber-500"/> : <MapPin className="w-5 h-5 text-indigo-500"/>}
                                        {reg.region} 
                                        <span className="text-sm font-medium text-slate-500 ml-2">배관 총 {reg.totalQty.toLocaleString()}본 유통</span>
                                    </h3>
                                    <span className="font-black text-slate-800">₩{reg.totalAmount.toLocaleString()} 매출원</span>
                                </div>
                                <div className="p-5 flex flex-col md:flex-row gap-6">
                                    <div className="flex-1">
                                        <h4 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Top 5 베스트셀러 배관</h4>
                                        <ul className="space-y-2">
                                            {reg.topItems.map(([itemKey, qty], i) => (
                                                <li key={itemKey} className="flex items-center justify-between text-sm">
                                                    <span className="font-medium text-slate-700 flex items-center gap-2">
                                                        <span className="w-5 h-5 rounded bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-bold">{i+1}</span>
                                                        {itemKey}
                                                    </span>
                                                    <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{qty}본</span>
                                                </li>
                                            ))}
                                            {reg.topItems.length === 0 && <span className="text-slate-400 text-sm">판매된 아이템이 없습니다.</span>}
                                        </ul>
                                    </div>
                                    {reg.region === 'CRM 미등록/예외' && reg.missingArray.length > 0 && (
                                        <div className="md:w-64 bg-amber-100/50 rounded-lg p-4 border border-amber-200">
                                            <h4 className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5"/> CRM 등재 요망 상호명</h4>
                                            <div className="flex flex-wrap gap-1.5">
                                                {reg.missingArray.map(m => (
                                                    <button 
                                                        key={m} 
                                                        onClick={() => {
                                                            setEditingCustomer({ companyName: m, region: '경기도' });
                                                            setActiveTab('MASTER');
                                                            setIsModalOpen(true);
                                                        }}
                                                        className="text-[11px] font-bold bg-amber-200 text-amber-800 px-2 py-1 rounded hover:bg-amber-500 hover:text-white transition-colors"
                                                        title="클릭하여 즉시 CRM 추가하기"
                                                    >
                                                        {m} +
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {analytics.length === 0 && (
                            <div className="py-20 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                                분석할 발주 이력이 아직 없습니다.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* MODAL (ADD / EDIT) */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                {editingCustomer?.id ? <Edit2 className="w-5 h-5 text-indigo-600"/> : <Plus className="w-5 h-5 text-indigo-600"/>}
                                {editingCustomer?.id ? '거래처 정보 수정' : '신규 CRM 거래처 등록'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-800 text-2xl font-light">&times;</button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            <form id="customerForm" onSubmit={handleSaveForm} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">업체명 (상호) *</label>
                                        <input required value={editingCustomer?.companyName || ''} onChange={e => setEditingCustomer(p => ({...p, companyName: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">대표자명</label>
                                        <input value={editingCustomer?.ceo || ''} onChange={e => setEditingCustomer(p => ({...p, ceo: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">사업자등록번호 * (중복금지)</label>
                                        <input required placeholder="000-00-00000" value={editingCustomer?.businessNumber || ''} onChange={e => setEditingCustomer(p => ({...p, businessNumber: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">권역 (8도 분류) *</label>
                                        <select required value={editingCustomer?.region || '경기도'} onChange={e => setEditingCustomer(p => ({...p, region: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                                            <option value="경기도">경기도 (시화배송망)</option>
                                            <option value="경상도">경상도 (부산배송망)</option>
                                            <option value="충청도">충청도</option>
                                            <option value="전라도">전라도</option>
                                            <option value="강원도">강원도</option>
                                            <option value="제주도">제주도</option>
                                            <option value="기타">기타 / 직접입력안됨</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">배송 주소지 *</label>
                                        <input required value={editingCustomer?.address || ''} onChange={e => setEditingCustomer(p => ({...p, address: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">담당자명 *</label>
                                        <input required value={editingCustomer?.contactName || ''} onChange={e => setEditingCustomer(p => ({...p, contactName: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">연락처 (전화번호) *</label>
                                        <input required value={editingCustomer?.phone || ''} onChange={e => setEditingCustomer(p => ({...p, phone: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">업무 이메일 *</label>
                                        <input required type="email" value={editingCustomer?.email || ''} onChange={e => setEditingCustomer(p => ({...p, email: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl">
                            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">취소</button>
                            <button type="submit" form="customerForm" className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm shadow-md transition-colors">저장하기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
