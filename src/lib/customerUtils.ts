import type { Order } from '../types';

export interface CustomerStats {
    grade: '신규' | '성장' | '우수' | '일반' | '이탈위험';
    orderCount: number;
    totalSales: number;
    badgeColor: string;
    reason: string;
}

export interface CrmCustomer {
    id?: string;
    companyName: string;
    businessNumber?: string;
}

const stripCorp = (name: string) => {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '')
               .replace(/[^a-zA-Z0-9가-힣]/g, '')
               .trim();
};

const resolveOrderDate = (o: {
    poNumber?: string;
    id?: string;
    payload?: {
        meta?: {
            created_at?: string;
        };
        [key: string]: unknown;
    };
    createdAt?: string;
}): Date => {
    const parseDateStr = (yy: string, mm: string, dd: string) => {
        const year = yy.length === 2 ? `20${yy}` : yy;
        return new Date(`${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T12:00:00Z`);
    };

    const identifiers = [o.poNumber, o.id].filter(Boolean);
    for (const str of identifiers) {
        if (typeof str !== 'string') continue;
        
        let m = str.match(/\D(20\d{6})(-|$)/);
        if (m) return parseDateStr(m[1].slice(0, 4), m[1].slice(4, 6), m[1].slice(6, 8));
        
        m = str.match(/\D(\d{6})(-|$)/);
        if (m) return parseDateStr(m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6));
    }

    const kDateStr = o.payload?.meta?.created_at;
    if (typeof kDateStr === 'string') {
        const kDateMatch = kDateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
        if (kDateMatch) return parseDateStr(kDateMatch[1], kDateMatch[2], kDateMatch[3]);
    }
    
    const d = new Date(o.createdAt || new Date());
    if (!isNaN(d.getTime())) {
        return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00Z`);
    }
    return new Date();
};

const matchCustomerToCrm = (
    item: {
        poEndCustomer?: string;
        customerName?: string;
        customerBizNo?: string;
        customerInfo?: {
            companyName?: string;
            bizNo?: string;
            company_name?: string;
        };
        payload?: {
            customer?: {
                business_no?: string;
                company_name?: string;
            };
            [key: string]: unknown;
        };
    },
    customersList: CrmCustomer[]
) => {
    let bizNo = '';
    if (item.payload?.customer?.business_no) bizNo = item.payload.customer.business_no;
    else if (item.customerInfo?.bizNo) bizNo = item.customerInfo.bizNo;
    else if (item.customerBizNo) bizNo = item.customerBizNo;
    bizNo = bizNo.replace(/[^0-9]/g, '');

    if (bizNo && bizNo.length >= 5) {
        const matched = customersList.find(c => {
            const crmBizNo = (c.businessNumber || '').replace(/[^0-9]/g, '');
            return crmBizNo === bizNo;
        });
        if (matched) return matched;
    }

    let rawName = '';
    if (item.poEndCustomer) rawName = item.poEndCustomer;
    else if (item.payload?.customer?.company_name) rawName = item.payload.customer.company_name;
    else if (item.customerInfo?.companyName) rawName = item.customerInfo.companyName;
    else if (item.customerInfo?.company_name) rawName = item.customerInfo.company_name;
    else if (item.customerName) rawName = item.customerName;

    rawName = rawName.trim().toLowerCase();
    if (rawName) {
        const exactMatch = customersList.find(c => (c.companyName || '').trim().toLowerCase() === rawName);
        if (exactMatch) return exactMatch;
    }

    const cleanOrderName = stripCorp(item.customerName || rawName);
    if (!cleanOrderName) return undefined;

    return customersList.find(c => {
        const cleanCrm = stripCorp(c.companyName);
        if (!cleanCrm) return false;
        return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
    });
};

export function calculateCustomerGrade(
    orders: Order[],
    companyName: string,
    bizNo: string,
    userId?: string,
    crmCustomers: CrmCustomer[] = []
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

    // 1. Find the target CRM customer standard record first
    const targetItemDummy = {
        customerName: companyName,
        customerBizNo: bizNo,
        customerInfo: { companyName, bizNo }
    };
    const targetCrm = matchCustomerToCrm(targetItemDummy, crmCustomers);

    // 2. Filter orders that match the target (with CRM matching falling back to text matching)
    const customerOrders = (orders || []).filter(order => {
        if (order.isDeleted) return false;
        if (order.status === 'CANCELLED' || order.status === 'WITHDRAWN') return false;

        // Exclude internal stock orders
        const fullCustomerName = (order.poEndCustomer || order.payload?.customer?.company_name || order.customerName || '').toLowerCase();
        if (fullCustomerName.includes('서울재고') || fullCustomerName.includes('시화재고') || fullCustomerName.includes('알트에프') || fullCustomerName.includes('altf') || fullCustomerName.includes('재고입고') || fullCustomerName.includes('stock')) return false;

        // A. Match by CRM if target CRM is found
        if (targetCrm) {
            const orderCrm = matchCustomerToCrm(order, crmCustomers);
            if (orderCrm && orderCrm.companyName === targetCrm.companyName) {
                return true;
            }
        }

        // B. Fallback: Match by userId
        if (userId && order.userId === userId) return true;

        // C. Fallback: Match by business number
        if (targetBizNoClean && normalizeBizNo(order.customerBizNo) === targetBizNoClean) return true;

        // D. Fallback: Match by company name
        const orderCompanyClean = normalizeCompanyName(order.customerName || order.payload?.customer?.company_name || '');
        if (targetCompanyClean && orderCompanyClean === targetCompanyClean) return true;

        return false;
    });

    const totalHistoricalOrders = customerOrders.length;

    // Calculate 60 days stats
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - 60);
    const cutoffTime = cutoffDate.getTime();

    const recentOrders = customerOrders.filter(order => {
        const orderDate = resolveOrderDate(order);
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
            reason: '이탈위험 (최근 60일 거래 없음)'
        };
    }

    if (orderCount >= 15 || totalSales >= 20000000) {
        return {
            grade: '우수',
            orderCount,
            totalSales,
            badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
            reason: `우수 고객 (60일 발주 ${orderCount}회, 매출 ₩${new Intl.NumberFormat('ko-KR').format(totalSales)})`
        };
    }

    if (orderCount >= 10 || totalSales >= 10000000) {
        return {
            grade: '성장',
            orderCount,
            totalSales,
            badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            reason: `성장 고객 (60일 발주 ${orderCount}회, 매출 ₩${new Intl.NumberFormat('ko-KR').format(totalSales)})`
        };
    }

    return {
        grade: '일반',
        orderCount,
        totalSales,
        badgeColor: 'bg-slate-50 text-slate-700 border-slate-200',
        reason: `일반 고객 (60일 발주 ${orderCount}회)`
    };
}
