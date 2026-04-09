import { useState, useMemo } from 'react';
import { Users, MapPin, Building2, TrendingUp, Search, Contact, Activity } from 'lucide-react';
import rawCustomers from '../../data/customers.json';

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
}

const customersList = rawCustomers as Customer[];

export default function Customers() {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<string>('ALL');

    const regions = useMemo(() => {
        const set = new Set<string>();
        customersList.forEach(c => c.region && set.add(c.region));
        return Array.from(set).sort();
    }, []);

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
    }, [searchTerm, selectedRegion]);

    const stats = useMemo(() => {
        return {
            total: customersList.length,
            "s 수도권": customersList.filter(c => c.region === '수도권(시화권)').length,
            "b 부산권": customersList.filter(c => c.region === '부산/경남권').length,
            etc: customersList.filter(c => c.region !== '수도권(시화권)' && c.region !== '부산/경남권').length
        };
    }, []);

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <Users className="w-7 h-7 text-indigo-600" />
                        지역별 전사 거래처 (CRM) 분석망
                    </h1>
                    <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                        지역별 거래처 밀집도와 배송 현황을 분석하여 신규 물류 창고 및 직배송 라인업 전략을 수립합니다.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform">
                        <Building2 className="w-24 h-24" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90"><Users className="w-4 h-4"/>총 거래망 유지</h3>
                    <p className="text-4xl font-black mt-2 z-10">{stats.total}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                </div>

                <div className="bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform">
                        <MapPin className="w-24 h-24" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90"><MapPin className="w-4 h-4"/>수도권 (시화권) 베이스</h3>
                    <p className="text-4xl font-black mt-2 z-10">{stats['s 수도권']}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                    <p className="text-sm opacity-80 mt-1">Sihwa 직배송 라우팅 거점</p>
                </div>

                <div className="bg-gradient-to-br from-sky-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform">
                        <MapPin className="w-24 h-24" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90"><MapPin className="w-4 h-4"/>부산/경남/울산 베이스</h3>
                    <p className="text-4xl font-black mt-2 z-10">{stats['b 부산권']}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                    <p className="text-sm opacity-80 mt-1">Busan 메인 물류망</p>
                </div>

                <div className="bg-gradient-to-br from-slate-600 to-slate-800 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform">
                        <Activity className="w-24 h-24" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90"><TrendingUp className="w-4 h-4"/>기타 (충청/전라 등)</h3>
                    <p className="text-4xl font-black mt-2 z-10">{stats.etc}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                    <p className="text-sm opacity-80 mt-1">택배 및 화물 조달 거점</p>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-600 mr-2">지역 필터링:</span>
                        <select 
                            title="지역 필터링"
                            aria-label="지역 필터링"
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
                            placeholder="업체명, 주소, 담당자 검색..."
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
                                <th className="px-5 py-3">소속 지역 (거점망)</th>
                                <th className="px-5 py-3">거래처 상호명</th>
                                <th className="px-5 py-3">실제 직배송 주소지</th>
                                <th className="px-5 py-3">주요 취급 물품군</th>
                                <th className="px-5 py-3">담당자 연락처</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.slice(0, 300).map(c => (
                                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-3 font-medium">
                                        {c.region === '수도권(시화권)' ? (
                                            <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold">시화권 직배물류</span>
                                        ) : c.region === '부산/경남권' ? (
                                            <span className="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold">부산권 메인물류</span>
                                        ) : (
                                            <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full text-xs font-bold">택배/화물 조달망</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 font-bold text-slate-800">{c.companyName} <span className="text-[10px] text-slate-400 font-normal ml-1">({c.ceo})</span></td>
                                    <td className="px-5 py-3 text-slate-600 text-[13px] hover:text-indigo-600 cursor-pointer max-w-xs truncate" title={c.address}>
                                        <MapPin className="w-3.5 h-3.5 inline mr-1 text-slate-400"/>
                                        {c.address}
                                    </td>
                                    <td className="px-5 py-3 text-slate-500 font-medium text-xs">{c.items}</td>
                                    <td className="px-5 py-3 text-slate-700 font-bold border-l border-slate-50 bg-slate-50/50">
                                        <div className="flex flex-col">
                                            <span className="flex items-center gap-1.5"><Contact className="w-3.5 h-3.5 text-indigo-400"/>{c.contactName || '미지정'} ({c.phone || '-'})</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-5 py-12 text-center text-slate-400 font-medium">
                                        검색된 지역 거래처 정보가 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    {filtered.length > 300 && (
                        <div className="p-4 text-center text-slate-400 text-sm bg-slate-50 font-medium">
                            검색 결과가 너무 많아 상위 300개만 표시합니다. 검색어를 통해 좁혀주세요.
                        </div>
                    )}
                </div>
            </div>
            
        </div>
    );
}
