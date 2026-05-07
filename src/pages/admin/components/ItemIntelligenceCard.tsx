import React, { useMemo, useState } from 'react';
import { X, TrendingUp, PackageSearch, AlertCircle, CheckCircle2, Factory, Package, Filter } from 'lucide-react';
import { useStore, type AppState } from '../../../store/useStore';
import type { Order, Quotation, User } from '../../../types';

interface InventoryDataProps {
    healthGrade?: string;
    turnoverRate?: number | string;
    shQty?: number | string;
    pendingOrderQty?: number | string;
    ysQty?: number | string;
    profitMarginRate?: number;
    recentPurchasePrice?: number;
    healthScore?: number;
    [key: string]: unknown;
}

interface ItemIntelligenceCardProps {
    productId: string;
    productName?: string;
    onClose: () => void;
    inventoryData?: InventoryDataProps;
}

export const ItemIntelligenceCard: React.FC<ItemIntelligenceCardProps> = ({ productId, productName, onClose, inventoryData }) => {
    const orders: Order[] = useStore((state: AppState) => state.orders);
    const myQuotations: Quotation[] = useStore((state: AppState) => state.quotes);
    const users: User[] = useStore((state: AppState) => state.users);
    
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'HISTORY' | 'INSIGHTS'>('OVERVIEW');

    // 1. Data Aggregation
    const itemQuotations = useMemo(() => {
        const filtered = myQuotations.filter(q => 
            q.items && q.items.some(item => (item.productId === productId || item.item_id === productId || item.itemId === productId || item.name === productId))
        );

        const uniqueQuotes = new Map<string, Quotation>();
        filtered.forEach(q => uniqueQuotes.set(q.id, q));

        return Array.from(uniqueQuotes.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [myQuotations, productId]);

    const itemOrders = useMemo(() => {
        const filtered = orders.filter(o => {
            const customerName = (o.poEndCustomer || o.supplierInfo?.company_name || o.customerName || '').toLowerCase();
            // 알트에프(자사) 등고/이동 발주는 매출 실적에서 제외
            if (customerName.includes('알트에프') || customerName.includes('alt.f') || customerName.includes('altf')) return false;

            const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;
            return items && items.some(item => (item.productId === productId || item.item_id === productId || item.itemId === productId || item.name === productId));
        });

        // Deduplicate by PO Number or ID to prevent exact UI duplicates
        const uniqueOrders = new Map<string, Order>();
        filtered.forEach(o => {
            const customerName = o.poEndCustomer || o.supplierInfo?.company_name || o.customerName || '';
            const key = o.poNumber ? `${customerName}-${o.poNumber}` : o.id;
            if (!uniqueOrders.has(key)) {
                uniqueOrders.set(key, o);
            }
        });

        return Array.from(uniqueOrders.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [orders, productId]);

    // Metrics
    const totalQuotations = itemQuotations.length;
    const totalOrders = itemOrders.length;
    const conversionRate = totalQuotations > 0 ? ((totalOrders / totalQuotations) * 100).toFixed(1) : '0.0';

    // Dispatch Analysis
    const dispatchAnalysis = useMemo(() => {
        let siHwaCount = 0;
        let daekyungCount = 0;
        
        itemOrders.forEach(o => {
            const isDaekyung = o.supplierInfo?.company_name?.includes('대경') || o.supplierInfo?.company_name?.includes('직발주');
            if (isDaekyung) daekyungCount++;
            else siHwaCount++;
        });
        
        return { siHwaCount, daekyungCount };
    }, [itemOrders]);

    const getRegionTag = (addr: string = '') => {
        if (!addr) return null;
        const a = addr.toLowerCase();
        if (a.includes('경기') || a.includes('시흥') || a.includes('안산') || a.includes('화성') || a.includes('평택') || a.includes('김포') || a.includes('인천') || a.includes('서울')) return { label: '수도권', color: 'bg-sky-100 text-sky-700' };
        if (a.includes('경남') || a.includes('부산') || a.includes('김해') || a.includes('창원') || a.includes('울산') || a.includes('경상')) return { label: '경상권', color: 'bg-emerald-100 text-emerald-700' };
        if (a.includes('충청') || a.includes('천안') || a.includes('아산') || a.includes('청주') || a.includes('당진')) return { label: '충청권', color: 'bg-amber-100 text-amber-700' };
        if (a.includes('전라') || a.includes('광주') || a.includes('전주') || a.includes('광양') || a.includes('여수')) return { label: '전라권', color: 'bg-orange-100 text-orange-700' };
        if (a.includes('경북') || a.includes('대구') || a.includes('구미') || a.includes('포항')) return { label: '경북권', color: 'bg-teal-100 text-teal-700' };
        return null;
    };

    const getCompanyRegion = (companyName: string) => {
        const user = users.find(u => u.companyName === companyName);
        return getRegionTag(user?.address || '');
    };

    const aiMarketAnalysis = useMemo(() => {
        if (itemOrders.length === 0) return { topCustomers: '데이터 부족', avgPrice: 0, topRegions: '데이터 부족' };
        
        const customerCounts: Record<string, number> = {};
        const regionCounts: Record<string, number> = {};
        let totalValidPrice = 0;
        let validPriceCount = 0;

        itemOrders.forEach(o => {
            const customerName = o.poEndCustomer || o.supplierInfo?.company_name || o.customerName || '';
            if (customerName) {
                customerCounts[customerName] = (customerCounts[customerName] || 0) + 1;
                const extO = o as typeof o & { customerInfo?: { address?: string }, customer?: { address?: string } };
                let addr = (o.supplierInfo?.address || extO.customerInfo?.address || extO.customer?.address || o.customerAddress || '').toLowerCase();
                if (!addr) {
                    const u = users.find(user => user.companyName === customerName);
                    if (u) addr = u.address;
                }

                if (addr.includes('경기') || addr.includes('시흥') || addr.includes('안산') || addr.includes('화성') || addr.includes('평택') || addr.includes('김포') || addr.includes('인천')) regionCounts['경기/수도권'] = (regionCounts['경기/수도권'] || 0) + 1;
                if (addr.includes('경남') || addr.includes('부산') || addr.includes('김해') || addr.includes('창원') || addr.includes('울산') || addr.includes('경상')) regionCounts['경남/경상권'] = (regionCounts['경남/경상권'] || 0) + 1;
                if (addr.includes('충청') || addr.includes('천안') || addr.includes('아산') || addr.includes('청주') || addr.includes('당진')) regionCounts['충청권'] = (regionCounts['충청권'] || 0) + 1;
                if (addr.includes('전라') || addr.includes('광주') || addr.includes('전주') || addr.includes('광양') || addr.includes('여수')) regionCounts['전라권'] = (regionCounts['전라권'] || 0) + 1;
                if (addr.includes('경북') || addr.includes('대구') || addr.includes('구미') || addr.includes('포항')) regionCounts['경북/대구권'] = (regionCounts['경북/대구권'] || 0) + 1;
            }

            const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;
            const match = items?.find(i => i.productId === productId || i.item_id === productId || i.itemId === productId || i.name === productId);
            const m = match as typeof match & { price?: number; unit_price?: number; cost?: number; };
            const p = m?.unitPrice || m?.price || m?.unit_price || m?.cost || 0;
            if (p > 0) {
                totalValidPrice += Number(p);
                validPriceCount++;
            }
        });

        const topCustomersList = Object.entries(customerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(e => e[0]);

        const topRegionsList = Object.entries(regionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(e => e[0]);

        return {
            topCustomers: topCustomersList.length > 0 ? topCustomersList.join(', ') : '특정 고객 편중 없음',
            topRegions: topRegionsList.length > 0 ? topRegionsList.join(', ') : '전국 (또는 지역 정보 없음)',
            avgPrice: validPriceCount > 0 ? Math.round(totalValidPrice / validPriceCount) : 0
        };
    }, [itemOrders, productId, users]);

    // History Filters
    const [historyDays, setHistoryDays] = useState<number>(365);
    const [historyCompany, setHistoryCompany] = useState<string>('ALL');

    const filteredOrders = useMemo(() => {
        return itemOrders.filter(o => {
            if (historyDays !== 0) {
                const days = (new Date().getTime() - new Date(o.createdAt).getTime()) / (1000 * 3600 * 24);
                if (days > historyDays) return false;
            }
            const customerName = o.poEndCustomer || o.supplierInfo?.company_name || o.customerName || '알 수 없는 업체';
            if (historyCompany !== 'ALL' && customerName !== historyCompany) return false;
            return true;
        });
    }, [itemOrders, historyDays, historyCompany]);

    const filteredQuotes = useMemo(() => {
        return itemQuotations.filter(q => {
            if (historyDays !== 0) {
                const days = (new Date().getTime() - new Date(q.createdAt).getTime()) / (1000 * 3600 * 24);
                if (days > historyDays) return false;
            }
            const customerName = q.customerInfo?.companyName || q.customerName || '알 수 없는 업체';
            if (historyCompany !== 'ALL' && customerName !== historyCompany) return false;
            return true;
        });
    }, [itemQuotations, historyDays, historyCompany]);

    const allCompanies = useMemo(() => {
        const set = new Set([
            ...itemOrders.map(o => o.poEndCustomer || o.supplierInfo?.company_name || o.customerName || '알 수 없는 업체'),
            ...itemQuotations.map(q => q.customerInfo?.companyName || q.customerName || '알 수 없는 업체')
        ]);
        return Array.from(set).sort();
    }, [itemOrders, itemQuotations]);

    // Grouping for Orders
    const ordersByCompany = useMemo(() => {
        const groups: Record<string, typeof filteredOrders> = {};
        filteredOrders.forEach(o => {
            const cName = o.poEndCustomer || o.supplierInfo?.company_name || o.customerName || '알 수 없는 업체';
            if (!groups[cName]) groups[cName] = [];
            groups[cName].push(o);
        });
        return groups;
    }, [filteredOrders]);

    return (
        <div className="fixed inset-0 z-150 flex justify-end bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="w-[800px] max-w-[90vw] h-full bg-slate-50 shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="bg-white px-6 py-5 border-b border-slate-200 flex justify-between items-start shrink-0 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                    <div className="flex flex-col gap-1 z-10">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-black tracking-widest uppercase">품목정보</span>
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold tracking-widest uppercase flex items-center gap-1">
                                <PackageSearch className="w-3 h-3" />
                                심층 분석
                            </span>
                        </div>
                        <h2 className="text-xl font-black text-slate-800 break-all">{productId}</h2>
                        {productName && productName !== productId && (
                            <span className="text-xs font-medium text-slate-500">{productName}</span>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors z-10 text-slate-400 hover:text-slate-700" aria-label="닫기">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-6 px-6 bg-white border-b border-slate-200 shrink-0">
                    <button 
                        onClick={() => setActiveTab('OVERVIEW')}
                        className={`py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'OVERVIEW' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        종합 요약
                    </button>
                    <button 
                        onClick={() => setActiveTab('HISTORY')}
                        className={`py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'HISTORY' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        거래 히스토리
                    </button>
                    <button 
                        onClick={() => setActiveTab('INSIGHTS')}
                        className={`py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'INSIGHTS' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        ✨ AI 전략 분석
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {activeTab === 'OVERVIEW' && (
                        <>
                            {/* Conversion KPI */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                                <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4" />
                                    전환율 (Conversion Rate)
                                </div>
                                <div className="grid grid-cols-3 divide-x divide-slate-100">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] text-slate-500 font-bold mb-1">총 견적</span>
                                        <span className="text-2xl font-black text-slate-700">{totalQuotations}</span>
                                        <span className="text-[9px] text-slate-400">건 접수</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] text-slate-500 font-bold mb-1">총 발주</span>
                                        <span className="text-2xl font-black text-emerald-600">{totalOrders}</span>
                                        <span className="text-[9px] text-slate-400">건 성공</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center bg-indigo-50/50 rounded-r-xl">
                                        <span className="text-[10px] text-indigo-500 font-bold mb-1">전환 성공률</span>
                                        <span className="text-2xl font-black text-indigo-600">{conversionRate}%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Dispatch Sources */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                                <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Package className="w-4 h-4" />
                                    출고처 점유율
                                </div>
                                <div className="flex gap-4">
                                    <div className="flex-1 bg-slate-50 rounded-xl p-4 flex items-center gap-3 border border-slate-100">
                                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                                            <Package className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-slate-500">시화 재고 출고</span>
                                            <span className="text-xl font-black text-slate-800">{dispatchAnalysis.siHwaCount}건</span>
                                        </div>
                                    </div>
                                    <div className="flex-1 bg-slate-50 rounded-xl p-4 flex items-center gap-3 border border-slate-100">
                                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                                            <Factory className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-slate-500">대경 직발주</span>
                                            <span className="text-xl font-black text-slate-800">{dispatchAnalysis.daekyungCount}건</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Inventory Comprehensive View */}
                            {inventoryData && (
                                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                                    <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <PackageSearch className="w-4 h-4" />
                                        재고 및 수익성 종합 지표
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                        <div className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <span className="text-[10px] text-slate-500 font-bold mb-1">건전성 등급</span>
                                            <div className="flex items-baseline gap-1">
                                                <span className={`text-xl font-black ${inventoryData.healthGrade === 'A' ? 'text-emerald-600' : inventoryData.healthGrade === 'B' ? 'text-blue-600' : inventoryData.healthGrade === 'C' ? 'text-amber-600' : inventoryData.healthGrade === 'D' ? 'text-orange-600' : 'text-rose-600'}`}>{inventoryData.healthGrade}급</span>
                                                <span className="text-xs text-slate-400 font-mono">({Math.round(Number(inventoryData.healthScore ?? 0))}점)</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <span className="text-[10px] text-slate-500 font-bold mb-1">시화 재고 / 입고 대기</span>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-xl font-black text-indigo-600">{inventoryData.shQty}</span>
                                                <span className="text-xs text-slate-400 font-bold">/ +{inventoryData.pendingOrderQty}개</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <span className="text-[10px] text-slate-500 font-bold mb-1">대경 본사 재고</span>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-xl font-black text-slate-700">{inventoryData.ysQty}</span>
                                                <span className="text-xs text-slate-400">개</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <span className="text-[10px] text-slate-500 font-bold mb-1">평균 이익률</span>
                                            <div className="flex items-baseline gap-1">
                                                <span className={`text-xl font-black ${(inventoryData.profitMarginRate ?? 0) <= 0 ? 'text-rose-500' : (inventoryData.profitMarginRate ?? 0) >= 30 ? 'text-emerald-600' : 'text-slate-700'}`}>{inventoryData.profitMarginRate ?? 0}%</span>
                                                <span className="text-xs text-slate-400 font-mono">({inventoryData.recentPurchasePrice?.toLocaleString()}원)</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'HISTORY' && (
                        <div className="space-y-6">
                            {/* Filters */}
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-wrap items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-slate-400" />
                                    <span className="text-xs font-bold text-slate-700">조회 필터</span>
                                </div>
                                <select 
                                    className="text-xs border border-slate-300 rounded px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={historyDays}
                                    onChange={(e) => setHistoryDays(Number(e.target.value))}
                                    aria-label="조회 기간"
                                    title="조회 기간 필터"
                                >
                                    <option value={30}>최근 30일</option>
                                    <option value={90}>최근 90일</option>
                                    <option value={180}>최근 180일</option>
                                    <option value={365}>최근 1년</option>
                                    <option value={0}>전체 기간</option>
                                </select>
                                <select 
                                    className="text-xs border border-slate-300 rounded px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[200px]"
                                    value={historyCompany}
                                    onChange={(e) => setHistoryCompany(e.target.value)}
                                    aria-label="조회 업체"
                                    title="조회 업체 필터"
                                >
                                    <option value="ALL">전체 업체</option>
                                    {allCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>

                            {/* Recent Orders */}
                            <div>
                                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                    최근 발주 이력 ({filteredOrders.length}건)
                                </h3>
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                    {Object.keys(ordersByCompany).length === 0 ? (
                                        <div className="p-6 text-center text-sm text-slate-400">발주 이력이 없습니다.</div>
                                    ) : (
                                        <div className="divide-y divide-slate-200">
                                            {Object.entries(ordersByCompany).map(([companyName, compOrders]) => {
                                                const region = getCompanyRegion(companyName);
                                                return (
                                                    <div key={companyName} className="p-0">
                                                        <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center gap-2 sticky top-0">
                                                            <span className="font-black text-slate-800 text-sm">{companyName}</span>
                                                            {region && (
                                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${region.color}`}>{region.label}</span>
                                                            )}
                                                            <span className="text-[10px] text-slate-400 font-medium ml-auto">{compOrders.length}건</span>
                                                        </div>
                                                        <div className="divide-y divide-slate-100">
                                                            {compOrders.map(o => {
                                                                const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;
                                                                const match = items?.find(i => i.productId === productId || i.item_id === productId || i.itemId === productId || i.name === productId);
                                                                const m = match as typeof match & { price?: number; unit_price?: number; cost?: number; };
                                                                const unitPrice = m?.unitPrice || m?.price || m?.unit_price || m?.cost || 0;
                                                                return (
                                                                    <div key={o.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center pl-6">
                                                                        <div className="flex flex-col gap-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="font-mono text-[10px] text-slate-400" title="발주번호">{(o.poNumber || o.id).split('-').pop()}</span>
                                                                                {o.supplierInfo?.company_name?.includes('대경') ? (
                                                                                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">직발주</span>
                                                                                ) : (
                                                                                    <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">시화출고</span>
                                                                                )}
                                                                            </div>
                                                                            <span className="text-xs font-bold text-slate-600">{new Date(o.createdAt).toLocaleDateString()}</span>
                                                                        </div>
                                                                        <div className="flex flex-col items-end">
                                                                            <span className="font-black text-emerald-600">{match?.quantity}개</span>
                                                                            <span className="text-[10px] text-slate-400">단가 ₩{Number(unitPrice).toLocaleString()}</span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Recent Quotes */}
                            <div>
                                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-indigo-500" />
                                    최근 견적 이력 ({filteredQuotes.length}건)
                                </h3>
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                    {filteredQuotes.length === 0 ? (
                                        <div className="p-6 text-center text-sm text-slate-400">견적 이력이 없습니다.</div>
                                    ) : (
                                        <div className="divide-y divide-slate-100">
                                            {filteredQuotes.map(q => {
                                                const match = q.items?.find(i => i.productId === productId || i.item_id === productId || i.itemId === productId || i.name === productId);
                                                const m = match as typeof match & { price?: number; unit_price?: number; cost?: number; };
                                                const unitPrice = m?.unitPrice || m?.price || m?.unit_price || m?.cost || 0;
                                                const customerName = q.customerInfo?.companyName || q.customerName || '알 수 없는 업체';
                                                const region = getCompanyRegion(customerName);

                                                return (
                                                    <div key={q.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-slate-800 text-sm">{customerName}</span>
                                                                {region && (
                                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${region.color}`}>{region.label}</span>
                                                                )}
                                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${q.status === 'COMPLETED' || q.status === 'PROCESSED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                                    {q.status === 'COMPLETED' || q.status === 'PROCESSED' ? '발주성공' : '견적제출'}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono text-[10px] text-slate-400" title="견적번호">{q.id.split('-').pop()}</span>
                                                                <span className="text-xs font-bold text-slate-600">{new Date(q.createdAt).toLocaleDateString()}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-black text-indigo-600">{match?.quantity}개</span>
                                                            <span className="text-[10px] text-slate-400">제안단가 ₩{Number(unitPrice).toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'INSIGHTS' && (
                        <div className="space-y-6 pb-20">
                            {/* AI Strategy Analysis */}
                            <div className="bg-linear-to-br from-indigo-900 to-purple-900 border border-indigo-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                                <div className="relative z-10 space-y-6">
                                    <div className="flex items-center gap-3 border-b border-indigo-800/50 pb-4">
                                        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                                            <TrendingUp className="w-5 h-5 text-purple-300" />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-black text-white">AI 인사이트 & 전략 평가</h3>
                                            <p className="text-[11px] text-indigo-300">CRM 및 재고 빅데이터 기반 종합 판단</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* Market Insight */}
                                        <div className="bg-slate-900/40 rounded-xl p-4 border border-indigo-800/50">
                                            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest block mb-2">시장 분석</span>
                                            <ul className="space-y-2 text-sm text-indigo-100">
                                                <li className="flex gap-2">
                                                    <span className="text-purple-400 font-bold">•</span>
                                                    <span>주요 타겟 고객층: <strong className="text-xs">{aiMarketAnalysis.topCustomers}</strong></span>
                                                </li>
                                                <li className="flex gap-2">
                                                    <span className="text-purple-400 font-bold">•</span>
                                                    <span>주요 출고 지역: <strong>{aiMarketAnalysis.topRegions}</strong></span>
                                                </li>
                                                <li className="flex gap-2">
                                                    <span className="text-purple-400 font-bold">•</span>
                                                    <span>평균 출고 단가: <strong>₩{aiMarketAnalysis.avgPrice.toLocaleString()}</strong></span>
                                                </li>
                                                <li className="flex gap-2">
                                                    <span className="text-purple-400 font-bold">•</span>
                                                    <span>평균 견적-발주 전환율: <strong>{conversionRate}%</strong> (총 {totalQuotations}건 중 {totalOrders}건 수주)</span>
                                                </li>
                                            </ul>
                                        </div>

                                        {/* Supply Chain Insight */}
                                        <div className="bg-slate-900/40 rounded-xl p-4 border border-indigo-800/50">
                                            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest block mb-2">공급망 리드타임</span>
                                            <ul className="space-y-2 text-sm text-indigo-100">
                                                <li className="flex gap-2">
                                                    <span className="text-emerald-400 font-bold">•</span>
                                                    <span>시화 재고 출고 시: 평균 <strong>당일 ~ 1일</strong> 소요 (수주 우위 확보)</span>
                                                </li>
                                                <li className="flex gap-2">
                                                    <span className="text-amber-400 font-bold">•</span>
                                                    <span>대경 발주 출고 시: 평균 <strong>2~3일</strong> 소요</span>
                                                </li>
                                                <li className="flex gap-2">
                                                    <span className="text-rose-400 font-bold">•</span>
                                                    <span>현재 상태: <strong>{Number(inventoryData?.shQty) > 0 ? '당일 즉시 대응 가능 (단가 방어 유리)' : '재고 부족 상태 (단납기 수주 불리)'}</strong></span>
                                                </li>
                                            </ul>
                                        </div>
                                    </div>

                                    {/* Strategy Suggestion */}
                                    <div className="bg-white/10 rounded-xl p-4 border border-purple-500/30 backdrop-blur-sm">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center shrink-0">
                                                <PackageSearch className="w-4 h-4 text-white" />
                                            </div>
                                            <div>
                                                <span className="text-[10px] font-bold text-purple-200 uppercase tracking-widest block mb-1">AI 전략 코멘트</span>
                                                <p className="text-sm font-medium text-white leading-relaxed">
                                                    {inventoryData?.healthGrade === 'A' || inventoryData?.healthGrade === 'B' ? (
                                                        Number(inventoryData?.shQty) < Number(inventoryData?.safeStock) ? 
                                                        "수요 회전율이 높은 핵심 자재이나 현재 시화 재고가 안전재고 미달입니다. 결품 시 고객사 이탈 리스크가 높으므로 긴급 선발주가 요구되며, 현재 들어오는 견적은 납기를 보수적으로 잡아야 합니다." :
                                                        "우수 핵심 자재로 현재 재고도 충분히 확보되어 있습니다. 타사 대비 당일 출고 프리미엄을 내세워 단가를 깎지 말고 마진율을 극대화하세요."
                                                    ) : inventoryData?.healthGrade === 'D' || inventoryData?.healthGrade === 'E' ? (
                                                        "수요 빈도가 낮은 둔착 및 장기 미판매 자재입니다. 악성 재고의 현금화가 우선이므로 마진을 포기하고 파격적인 단가 할인을 제안해서라도 신속히 털어내는 전략을 추천합니다."
                                                    ) : (
                                                        "시장 수요가 일정하게 유지되는 스탠다드 품목입니다. 시세에 맞춰 유연하게 견적을 대응하여 고객 이탈을 방지하고 안정적인 전환율을 유지하세요."
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Legacy Memo Block */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                                <h3 className="text-sm font-black text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-slate-400" />
                                    품목 영업 메모 및 실패 분석
                                </h3>
                                <p className="text-xs text-slate-500">영업 담당자의 코멘트나 특정 고객의 피드백, 실주 사유 등을 자유롭게 기록하세요.</p>
                                
                                <div>
                                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">주요 피드백 태그</label>
                                    <div className="flex gap-2">
                                        <button className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors font-medium">단가 경쟁력 부족</button>
                                        <button className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors font-medium">재고 부족 (납기 지연)</button>
                                        <button className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors font-medium">단순 비교/참고용 문의</button>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">상세 영업 메모</label>
                                    <textarea 
                                        className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 h-24 resize-none"
                                        placeholder="이 품목에 대한 특이사항, 타겟 수요처, 적정 마진 등을 기록해 두세요..."
                                    ></textarea>
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button className="bg-slate-800 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors shadow-sm">
                                        코멘트 저장하기
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
