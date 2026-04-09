import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import { 
    Factory, 
    TrendingUp, 
    AlertTriangle,
    Box,
    BrainCircuit,
    ChevronDown,
    ChevronRight,
    Activity
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import salesHistoryRaw from '../../data/sales_history.json';

const salesHistory = salesHistoryRaw as Record<string, { salesVolume: number, salesFreq: number }>;

// Helpers removed (unused in Tableau view)

export default function SihwaInventory() {
    const { user } = useStore(useShallow(state => ({ user: state.auth.user })));
    const { inventory, isLoading: invLoading } = useInventory();
    
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'AI' | 'ALL'>('AI');
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        'CRITICAL': true,
        'WARNING': true
    });

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Removed unused orders fetch and maps

    // 4. Smart Stock Intelligence Mapper
    const analyzedInventory = useMemo(() => {
        const processedList = [];

        for (const item of inventory) {
            let shQty = 0;
            let ysQty = 0;

            if (item.locationStock) {
                if (item.locationStock['시화'] !== undefined) shQty += Number(item.locationStock['시화']);
                if (item.locationStock['서울'] !== undefined) shQty += Number(item.locationStock['서울']);
                if (item.locationStock['양산'] !== undefined) ysQty += Number(item.locationStock['양산']);
                if (item.locationStock['대경'] !== undefined) ysQty += Number(item.locationStock['대경']);
            } else {
                if ((item.location || '').includes('시화') || (item.location || '').includes('서울')) {
                    shQty = item.currentStock;
                } else if ((item.location || '').includes('양산') || (item.location || '').includes('대경')) {
                    ysQty = item.currentStock;
                }
            }

            // Fallback for safety: if no explicit location info but stock exists, determine by default.
            // But we trust locationStock more.

            const salesData = salesHistory[item.id] || { salesVolume: 0, salesFreq: 0 };
            const safeStock = Math.ceil((salesData.salesVolume / 12) * 1.5);
            const deficit = safeStock - shQty;

            let statusCategory = 'IDLE'; // Not much activity
            let statusLabel = '데이터 없음';

            if (salesData.salesVolume > 0) {
                if (shQty <= 0) {
                    if (ysQty <= 0) {
                        statusCategory = 'CRITICAL';
                        statusLabel = '🚨 선발주 요망 (매입처 결품)';
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 발주 필요 (매입처 구매)';
                    }
                } else if (shQty < safeStock) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 안전재고 미달 (발주 필요)';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (shQty > 0 || ysQty > 0) {
                 statusCategory = 'SAFE';
                 statusLabel = '✅ 판매미비 (보유중)';
            }

            processedList.push({
                product: item,
                shQty,
                ysQty,
                ...salesData,
                safeStock,
                deficit: deficit > 0 ? deficit : 0,
                statusCategory,
                statusLabel
            });
        }

        // Apply Search Term
        let filtered = processedList;
        if (searchTerm) {
            const lowerQuery = searchTerm.toLowerCase();
            filtered = processedList.filter(row => 
                row.product.id.toLowerCase().includes(lowerQuery) || 
                (row.product.name && row.product.name.toLowerCase().includes(lowerQuery))
            );
        }

        return filtered.sort((a, b) => b.salesFreq - a.salesFreq || b.salesVolume - a.salesVolume);
    }, [inventory, searchTerm]);

    // Aggregate stats for Tableau cards
    const stats = useMemo(() => {
        return {
            critical: analyzedInventory.filter(r => r.statusCategory === 'CRITICAL'),
            warning: analyzedInventory.filter(r => r.statusCategory === 'WARNING'),
            safeActive: analyzedInventory.filter(r => r.statusCategory === 'SAFE' && r.salesFreq > 10)
        };
    }, [analyzedInventory]);

    if (user?.role === 'MANAGER') {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-center pb-40">
                <AlertTriangle className="w-16 h-16 text-rose-300 mb-4" />
                <h2 className="text-xl font-bold text-slate-700">접근 권한이 제한되었습니다</h2>
                <p className="text-slate-500 mt-2">이 페이지는 최고 관리자(MASTER) 전용입니다.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <BrainCircuit className="w-7 h-7 text-indigo-600" />
                        AI 통합 재고 분석 (Tableau 뷰)
                    </h1>
                    <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                        실제 판매량을 기반으로 시화재고(내 재고)와 대경재고(매입처)를 분리 평가하고 사입 방침을 최적화합니다.
                    </p>
                </div>
            </div>

            {/* Smart Tableau Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 xl:gap-6">
                <div className="bg-gradient-to-br from-rose-500 to-red-600 rounded-2xl p-5 shadow-lg shadow-rose-200 text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-6 -mt-6 p-4 opacity-20 transform group-hover:scale-110 transition-transform duration-500">
                        <AlertTriangle className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><AlertTriangle className="w-5 h-5"/>매입처 동반 결품 위험 (선발주)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.critical.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10">내 재고가 0이면서 매입처 대경재고 마저 없는 초긴급 품목</p>
                </div>
                
                <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-5 shadow-lg shadow-amber-200 text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-20 transform group-hover:rotate-12 transition-transform duration-500">
                        <Box className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><Factory className="w-5 h-5"/>일반 발주 요망 (안전재고 미달)</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.warning.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10">대경 재고는 있으나, 목표 안전치에 미달된 품목</p>
                </div>

                <div className="bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl p-5 shadow-lg shadow-teal-200 text-white flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-20 transform group-hover:-translate-y-2 transition-transform duration-500">
                        <Activity className="w-32 h-32" />
                    </div>
                    <h3 className="font-bold flex items-center gap-2 opacity-90 mb-1 z-10"><TrendingUp className="w-5 h-5"/>고회전 적정 보유</h3>
                    <p className="text-4xl font-black mb-1 z-10">{stats.safeActive.length}<span className="text-lg font-bold opacity-80 tracking-normal ml-1">품목</span></p>
                    <p className="text-sm font-medium opacity-80 z-10">판매 빈도가 높은 주력 품목 중 안전재고 이상 확보됨</p>
                </div>
            </div>

            {/* Smart Table Settings & Filters */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                    <div className="flex bg-slate-200/50 p-1 rounded-lg">
                        <button 
                            className={`px-6 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'AI' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('AI')}
                        >
                            AI 요약보기 (Action Items)
                        </button>
                        <button 
                            className={`px-6 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'ALL' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('ALL')}
                        >
                            전체 재고 리스트
                        </button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="코드 또는 품명 검색..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="bg-white border text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-indigo-500  w-full md:w-64 shadow-inner"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto p-4">
                    {invLoading ? (
                        <div className="py-20 flex justify-center text-slate-400 font-medium">데이터를 분석 중입니다...</div>
                    ) : (
                        <div className="space-y-6">
                            {(activeTab === 'ALL' || searchTerm !== '') ? (
                                /* 전체 테이블 형식 */
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="text-slate-500 font-bold bg-slate-50 border-y border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3">품목 아이디</th>
                                            <th className="px-4 py-3 text-right">1년 판매량</th>
                                            <th className="px-4 py-3 text-center">안전재고(1.5m)</th>
                                            <th className="px-4 py-3 text-right text-indigo-600 bg-indigo-50/30">시화재고 (우리)</th>
                                            <th className="px-4 py-3 text-right text-slate-600 bg-slate-50">대경재고 (제휴)</th>
                                            <th className="px-4 py-3 text-center">인공지능 진단</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {analyzedInventory.slice(0, 500).map(row => (
                                            <tr key={row.product.id} className="hover:bg-slate-50 group">
                                                <td className="px-4 py-3 font-mono font-bold text-slate-700">{row.product.id}</td>
                                                <td className="px-4 py-3 text-right text-slate-600">
                                                    {row.salesVolume > 0 ? (
                                                        <span><span className="font-bold text-slate-800">{row.salesVolume}</span>개 <span className="text-[10px] bg-slate-100 px-1 rounded text-slate-500">({row.salesFreq}회)</span></span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-center font-mono text-slate-400">
                                                    {row.safeStock > 0 ? row.safeStock : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right font-black font-mono text-indigo-600 bg-indigo-50/20">
                                                    {row.shQty}
                                                </td>
                                                <td className="px-4 py-3 text-right font-black font-mono text-slate-600 bg-slate-50/40 opacity-70 group-hover:opacity-100 transition-opacity">
                                                    {row.ysQty}
                                                </td>
                                                <td className="px-4 py-3 text-center text-xs font-bold">
                                                    {row.statusCategory === 'CRITICAL' && <span className="bg-rose-100 text-rose-700 px-2 py-1 rounded shadow-sm">{row.statusLabel}</span>}
                                                    {row.statusCategory === 'WARNING' && <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded shadow-sm">{row.statusLabel}</span>}
                                                    {row.statusCategory === 'SAFE' && <span className="text-teal-600">{row.statusLabel}</span>}
                                                    {row.statusCategory === 'IDLE' && <span className="text-slate-400">{row.statusLabel}</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                /* 아코디언 컴포넌트 형식 (Tableau Summary 뷰) */
                                <div className="space-y-4 max-w-5xl mx-auto pb-8">
                                    {/* CRITICAL Section */}
                                    <div className="border border-rose-200 rounded-xl overflow-hidden shadow-sm">
                                        <button 
                                            onClick={() => toggleGroup('CRITICAL')}
                                            className="w-full flex items-center justify-between px-5 py-4 bg-rose-50 hover:bg-rose-100 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                {expandedGroups['CRITICAL'] ? <ChevronDown className="w-5 h-5 text-rose-500"/> : <ChevronRight className="w-5 h-5 text-rose-500"/>}
                                                <h3 className="font-bold text-rose-800 text-lg">🚨 선발주 요망 리스트 <span className="text-sm font-medium text-rose-500 ml-2">(대경매입처 동반 결품)</span></h3>
                                            </div>
                                            <span className="bg-rose-200 text-rose-800 font-black px-3 py-1 rounded-full text-sm">{stats.critical.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['CRITICAL'] && (
                                            <div className="bg-white border-t border-rose-100">
                                                {stats.critical.length > 0 ? (
                                                <table className="w-full text-sm text-left">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100">
                                                        <tr>
                                                            <th className="px-5 py-3 pt-3">품목 코드</th>
                                                            <th className="px-5 py-3 text-right">총 판/회수</th>
                                                            <th className="px-5 py-3 text-right text-rose-600 bg-rose-50/50">시화재고</th>
                                                            <th className="px-5 py-3 text-right">대경재고</th>
                                                            <th className="px-5 py-3 text-right font-black">부족분</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.critical.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50">
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-800">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right">
                                                                    <span className="font-black text-slate-700">{row.salesVolume}</span> <span className="text-xs text-slate-400">({row.salesFreq}회)</span>
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-rose-600 bg-rose-50/30">0</td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-slate-400">0</td>
                                                                <td className="px-5 py-4 text-right font-black text-rose-600">-{row.deficit}개</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                ) : <div className="p-8 text-center text-slate-400">훌륭합니다! 매입처 결품으로 인한 리스크 항목이 없습니다.</div>}
                                            </div>
                                        )}
                                    </div>

                                    {/* WARNING Section */}
                                    <div className="border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                                        <button 
                                            onClick={() => toggleGroup('WARNING')}
                                            className="w-full flex items-center justify-between px-5 py-4 bg-amber-50 hover:bg-amber-100 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                {expandedGroups['WARNING'] ? <ChevronDown className="w-5 h-5 text-amber-600"/> : <ChevronRight className="w-5 h-5 text-amber-600"/>}
                                                <h3 className="font-bold text-amber-800 text-lg">⚠️ 일반 발주 필요 리스트 <span className="text-sm font-medium text-amber-600 ml-2">(시화재고 안잔성 미달)</span></h3>
                                            </div>
                                            <span className="bg-amber-200 text-amber-800 font-black px-3 py-1 rounded-full text-sm">{stats.warning.length}건</span>
                                        </button>
                                        
                                        {expandedGroups['WARNING'] && (
                                            <div className="bg-white border-t border-amber-100">
                                                {stats.warning.length > 0 ? (
                                                <table className="w-full text-sm text-left">
                                                    <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-100">
                                                        <tr>
                                                            <th className="px-5 py-3 pt-3">품목 코드</th>
                                                            <th className="px-5 py-3 text-right">총 판/회수</th>
                                                            <th className="px-5 py-3 text-right text-indigo-600 bg-amber-50/30">시화재고</th>
                                                            <th className="px-5 py-3 text-right text-slate-600">대경재고</th>
                                                            <th className="px-5 py-3 text-right font-black">부족분</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {stats.warning.map(row => (
                                                            <tr key={row.product.id} className="hover:bg-slate-50">
                                                                <td className="px-5 py-4 font-mono font-bold text-slate-800">{row.product.id}</td>
                                                                <td className="px-5 py-4 text-right">
                                                                    <span className="font-black text-slate-700">{row.salesVolume}</span> <span className="text-xs text-slate-400">({row.salesFreq}회)</span>
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-indigo-600 bg-amber-50/10">
                                                                    <span className="text-xs mr-2 text-slate-400">(목표:{row.safeStock})</span>
                                                                    {row.shQty}
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black font-mono text-teal-600">
                                                                    보유중 ({row.ysQty})
                                                                </td>
                                                                <td className="px-5 py-4 text-right font-black text-amber-600">필요 -{row.deficit}개</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                ) : <div className="p-8 text-center text-slate-400">발주가 필요한 품목이 없습니다. 시화재고 관리가 매우 이상적입니다!</div>}
                                            </div>
                                        )}
                                    </div>
                                    
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            
        </div>
    );
}

