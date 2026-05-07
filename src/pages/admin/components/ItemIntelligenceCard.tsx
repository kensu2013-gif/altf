import React, { useMemo, useState } from 'react';
import { X, TrendingUp, PackageSearch, AlertCircle, CheckCircle2, Factory, Package } from 'lucide-react';
import { useStore, type AppState } from '../../../store/useStore';
import type { Order, Quotation } from '../../../types';

interface InventoryDataProps {
    healthGrade?: string;
    turnoverRate?: number | string;
    shQty?: number | string;
    pendingOrderQty?: number | string;
    ysQty?: number | string;
    profitMarginRate?: number;
    recentPurchasePrice?: number;
    [key: string]: unknown;
}

interface ItemIntelligenceCardProps {
    productId: string;
    productName?: string;
    onClose: () => void;
    inventoryData?: InventoryDataProps; // Rich stats from SihwaInventory
}

export const ItemIntelligenceCard: React.FC<ItemIntelligenceCardProps> = ({ productId, productName, onClose, inventoryData }) => {
    const orders: Order[] = useStore((state: AppState) => state.orders);
    const myQuotations: Quotation[] = useStore((state: AppState) => state.quotes);
    
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'HISTORY' | 'INSIGHTS'>('OVERVIEW');

    // 1. Data Aggregation
    const itemQuotations = useMemo(() => {
        return myQuotations.filter(q => 
            q.items && q.items.some(item => (item.productId === productId || item.item_id === productId || item.itemId === productId || item.name === productId))
        ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [myQuotations, productId]);

    const itemOrders = useMemo(() => {
        return orders.filter(o => {
            const items = o.po_items && o.po_items.length > 0 ? o.po_items : o.items;
            return items && items.some(item => (item.productId === productId || item.item_id === productId || item.itemId === productId || item.name === productId));
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [orders, productId]);

    // Metrics
    const totalQuotations = itemQuotations.length;
    const totalOrders = itemOrders.length;
    const conversionRate = totalQuotations > 0 ? ((totalOrders / totalQuotations) * 100).toFixed(1) : 0;

    // Dispatch Analysis (Sihwa vs Daekyung)
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

    return (
        <div className="fixed inset-0 z-[150] flex justify-end bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="w-[500px] h-full bg-slate-50 shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="bg-white px-6 py-5 border-b border-slate-200 flex justify-between items-start shrink-0 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                    <div className="flex flex-col gap-1 z-10">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-black tracking-widest uppercase">품목 인텔리전스</span>
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
                        className={`py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'INSIGHTS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        실패 분석/메모
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
                                                <span className="text-xs text-slate-400 font-mono">({inventoryData.turnoverRate}x)</span>
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
                            {/* Recent Orders */}
                            <div>
                                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                    최근 발주 이력
                                </h3>
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                    {itemOrders.length === 0 ? (
                                        <div className="p-6 text-center text-sm text-slate-400">발주 이력이 없습니다.</div>
                                    ) : (
                                        <div className="divide-y divide-slate-100">
                                            {itemOrders.slice(0, 10).map(o => {
                                                const match = o.items?.find(i => i.id === productId || i.name === productId);
                                                return (
                                                    <div key={o.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-slate-800 text-sm">{o.poEndCustomer || '알 수 없는 업체'}</span>
                                                                {o.supplierInfo?.company_name?.includes('대경') ? (
                                                                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">직발주</span>
                                                                ) : (
                                                                    <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">시화출고</span>
                                                                )}
                                                            </div>
                                                            <span className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleDateString()}</span>
                                                        </div>
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-black text-emerald-600">{match?.quantity}개</span>
                                                            <span className="text-[10px] text-slate-400">단가 ₩{match?.unitPrice?.toLocaleString() || 0}</span>
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
                                    최근 견적 이력
                                </h3>
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                    {itemQuotations.length === 0 ? (
                                        <div className="p-6 text-center text-sm text-slate-400">견적 이력이 없습니다.</div>
                                    ) : (
                                        <div className="divide-y divide-slate-100">
                                            {itemQuotations.slice(0, 10).map(q => {
                                                const match = q.items?.find(i => i.id === productId || i.name === productId);
                                                return (
                                                    <div key={q.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-slate-800 text-sm">{q.customerInfo?.companyName || '알 수 없는 업체'}</span>
                                                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${q.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                                    {q.status === 'COMPLETED' ? '발주성공' : '견적제출'}
                                                                </span>
                                                            </div>
                                                            <span className="text-xs text-slate-500">{new Date(q.createdAt).toLocaleDateString()}</span>
                                                        </div>
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-black text-indigo-600">{match?.quantity}개</span>
                                                            <span className="text-[10px] text-slate-400">제안단가 ₩{match?.unitPrice?.toLocaleString() || 0}</span>
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
                        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                            <h3 className="text-sm font-black text-slate-800 border-b border-slate-100 pb-3">실패 분석 (Lost Sales Tracking)</h3>
                            <p className="text-xs text-slate-500 mb-4">견적이 발주로 이어지지 않은 이유를 관리하고 영업 자산으로 활용하세요.</p>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">주요 실패 사유 (태그)</label>
                                    <div className="flex gap-2">
                                        <button className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors font-medium">단가 경쟁력 부족</button>
                                        <button className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors font-medium">재고 부족 (납기 문제)</button>
                                        <button className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors font-medium">단순 비교/참고용</button>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">품목 영업 메모</label>
                                    <textarea 
                                        className="w-full h-32 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                                        placeholder="이 품목에 대한 특이사항, 주요 수요처, 적정 마진 등을 기록해 두세요."
                                    ></textarea>
                                </div>

                                <div className="flex justify-end pt-2">
                                    <button className="bg-slate-800 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors shadow-sm">
                                        저장하기
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
