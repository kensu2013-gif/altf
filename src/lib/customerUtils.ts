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
    grade?: string;
    orderCount60Days?: number;
    totalSales60Days?: number;
    badgeColor?: string;
    reason?: string;
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
    // Find matching customer in CRM
    const targetItemDummy = {
        customerName: companyName,
        customerBizNo: bizNo,
        customerInfo: { companyName, bizNo }
    };
    const targetCrm = matchCustomerToCrm(targetItemDummy, crmCustomers);

    if (targetCrm && targetCrm.grade) {
        return {
            grade: targetCrm.grade as any,
            orderCount: targetCrm.orderCount60Days || 0,
            totalSales: targetCrm.totalSales60Days || 0,
            badgeColor: targetCrm.badgeColor || 'bg-slate-50 text-slate-700 border-slate-200',
            reason: targetCrm.reason || `일반 고객`
        };
    }

    // Fallback if not found in CRM (treat as new)
    return {
        grade: '신규',
        orderCount: 0,
        totalSales: 0,
        badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
        reason: '신규 고객 (CRM 미등록)'
    };
}
