import type { Order } from '../types';

export interface CustomerStats {
    grade: '신규' | '성장' | '우수' | '일반' | '이탈위험';
    orderCount: number;
    totalSales: number;
    badgeColor: string;
    reason: string;
}

export function calculateCustomerGrade(
    orders: Order[],
    companyName: string,
    bizNo: string,
    userId?: string
): CustomerStats {
    const normalizeCompanyName = (name?: string) => {
        if (!name) return '';
        return name.replace(/[\s()주식회사]/g, '').toLowerCase();
    };

    const normalizeBizNo = (no?: string) => {
        if (!no) return '';
        return no.replace(/[^0-9]/g, '');
    };

    const targetCompanyClean = normalizeCompanyName(companyName);
    const targetBizNoClean = normalizeBizNo(bizNo);

    // If companyName is empty, we cannot identify the customer unless userId matches
    const customerOrders = (orders || []).filter(order => {
        if (order.isDeleted) return false;
        if (order.status === 'CANCELLED' || order.status === 'WITHDRAWN') return false;

        // 1. Match by userId if available
        if (userId && order.userId === userId) return true;

        // 2. Match by business number
        if (targetBizNoClean && normalizeBizNo(order.customerBizNo) === targetBizNoClean) return true;

        // 3. Match by company name
        const orderCompanyClean = normalizeCompanyName(order.customerName || order.payload?.customer?.company_name || '');
        if (targetCompanyClean && orderCompanyClean === targetCompanyClean) return true;

        return false;
    });

    const totalHistoricalOrders = customerOrders.length;

    // Calculate 90 days stats
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - 90);
    const cutoffTime = cutoffDate.getTime();

    const recentOrders = customerOrders.filter(order => {
        const orderDate = new Date(order.createdAt);
        return !isNaN(orderDate.getTime()) && orderDate.getTime() >= cutoffTime;
    });

    const orderCount = recentOrders.length;
    const totalSales = recentOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    if (totalHistoricalOrders === 0) {
        return {
            grade: '신규',
            orderCount,
            totalSales,
            badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
            reason: '신규 고객 (거래 없음)'
        };
    }

    if (orderCount === 0) {
        return {
            grade: '이탈위험',
            orderCount,
            totalSales,
            badgeColor: 'bg-red-50 text-red-700 border-red-200',
            reason: '이탈위험 (최근 90일 거래 없음)'
        };
    }

    if (orderCount >= 10 || totalSales >= 10000000) {
        return {
            grade: '우수',
            orderCount,
            totalSales,
            badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
            reason: `우수 고객 (90일 발주 ${orderCount}회, 매출 ₩${new Intl.NumberFormat('ko-KR').format(totalSales)})`
        };
    }

    if (orderCount >= 5 || totalSales >= 5000000) {
        return {
            grade: '성장',
            orderCount,
            totalSales,
            badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            reason: `성장 고객 (90일 발주 ${orderCount}회, 매출 ₩${new Intl.NumberFormat('ko-KR').format(totalSales)})`
        };
    }

    return {
        grade: '일반',
        orderCount,
        totalSales,
        badgeColor: 'bg-slate-50 text-slate-700 border-slate-200',
        reason: `일반 고객 (90일 발주 ${orderCount}회)`
    };
}
