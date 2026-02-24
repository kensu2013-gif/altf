import { useMemo } from 'react';
import type { Order, Product } from '../../../types';
import { TrendingUp, TrendingDown, DollarSign, Users } from 'lucide-react';

interface AnalyticsPanelProps {
    orders: Order[];
    inventory: Product[];
}

export function AnalyticsPanel({ orders, inventory }: AnalyticsPanelProps) {
    const stats = useMemo(() => {
        let totalSales = 0;
        let totalCost = 0;
        const managerStats: Record<string, { count: number; profit: number; sales: number }> = {};

        orders.forEach(order => {
            // Only count if not cancelled/withdrawn/trash
            if (['CANCELLED', 'WITHDRAWN', 'ON_HOLD'].includes(order.status) || order.isDeleted) return;

            // Sales amount is the final total Amount (which includes confirmedPrice and additionalCharges)
            // But if it's not confirmed yet, we can use the default totalAmount. Let's just use totalAmount.
            const sales = order.totalAmount || 0;
            totalSales += sales;

            // Calculate cost from items
            let orderCost = 0;
            // Use po_items if available (which means it was edited in Supplier mode), otherwise items
            const itemsToCalc = order.po_items && order.po_items.length > 0 ? order.po_items : order.items;

            itemsToCalc.forEach(item => {
                const product = inventory.find(p => p.id === item.productId);
                const basePrice = product?.base_price ?? product?.unitPrice ?? 0;
                const rate = item.supplierRate ?? 0;
                const supplierPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                orderCost += (supplierPrice * item.quantity);
            });

            totalCost += orderCost;

            // Track by Manager
            const managerName = order.lastUpdatedBy?.name || '미배정/시스템';
            if (!managerStats[managerName]) {
                managerStats[managerName] = { count: 0, profit: 0, sales: 0 };
            }
            managerStats[managerName].count += 1;
            managerStats[managerName].sales += sales;
            managerStats[managerName].profit += (sales - orderCost);
        });

        const totalProfit = totalSales - totalCost;
        const marginRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

        // Sort managers by profit descending
        const topManagers = Object.entries(managerStats)
            .sort(([, a], [, b]) => b.profit - a.profit);

        return {
            totalSales,
            totalCost,
            totalProfit,
            marginRate,
            topManagers
        };
    }, [orders, inventory]);

    const formatCur = (num: number) => new Intl.NumberFormat('ko-KR').format(num);

    if (orders.length === 0) return null;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
            <div className="bg-slate-800 text-white px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-teal-400" />
                    <h2 className="font-bold text-sm">실시간 손익 요약 (조회된 주문 기준)</h2>
                </div>
                <div className="text-xs text-slate-300 font-mono">
                    총 {orders.length}건
                </div>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-6 relative">

                {/* 1. Sales */}
                <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-400 mb-1 flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5" />총 매출 (Sales)
                    </span>
                    <span className="text-2xl font-black text-slate-800 tracking-tight">
                        {formatCur(stats.totalSales)}<span className="text-sm font-bold ml-1 text-slate-400">원</span>
                    </span>
                </div>

                {/* 2. Costs */}
                <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-400 mb-1 flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5 text-red-400" />총 매입 (Costs)
                    </span>
                    <span className="text-2xl font-black text-rose-600 tracking-tight">
                        {formatCur(stats.totalCost)}<span className="text-sm font-bold ml-1 flex-opacity-50 text-rose-400">원</span>
                    </span>
                </div>

                {/* 3. Profit */}
                <div className="flex flex-col border-l border-slate-100 pl-6">
                    <span className="text-xs font-bold text-slate-400 mb-1 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-teal-500" />총 이익금 (Profit)
                    </span>
                    <span className="text-2xl font-black text-teal-600 tracking-tight">
                        {formatCur(stats.totalProfit)}<span className="text-sm font-bold ml-1 text-teal-400">원</span>
                    </span>
                    <span className="text-xs font-bold text-slate-400 mt-1">
                        마진율: <strong className={stats.marginRate > 0 ? 'text-teal-600' : 'text-red-500'}>{stats.marginRate.toFixed(1)}%</strong>
                    </span>
                </div>

                {/* 4. Top Managers */}
                <div className="flex flex-col border-l border-slate-100 pl-6">
                    <span className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />담당자별 실적 (Top 3)
                    </span>
                    <div className="space-y-1.5 overflow-y-auto max-h-24 pr-2 custom-scrollbar">
                        {stats.topManagers.slice(0, 3).map(([name, data], idx) => (
                            <div key={name} className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-600 truncate mr-2">
                                    {idx + 1}. {name}
                                </span>
                                <span className="font-mono font-bold text-teal-600 whitespace-nowrap">
                                    {formatCur(data.profit)}원 <span className="text-slate-400 font-normal">({data.count}건)</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}
