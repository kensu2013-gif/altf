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
    _orders: Order[],
    companyName: string,
    bizNo: string,
    _userId?: string,
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
            grade: targetCrm.grade as CustomerStats['grade'],
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
