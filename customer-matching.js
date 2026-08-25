// 주문/견적 레코드를 CRM 고객사(db.customers)에 귀속시키는 퍼지 매칭 로직.
// local-api-server.js의 enrichCustomersWithGrade()에서 쓰던 로직을 그대로 옮긴 것 — 동작 변경 없음.
// report-aggregation.js(지역별 집계)와 local-api-server.js(CRM 등급 산정) 양쪽에서 재사용한다.

export function stripCorp(name) {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '')
               .replace(/[^a-zA-Z0-9가-힣]/g, '')
               .trim();
}

// customers 배열로부터 bizNo/정확한 이름/정리된 이름/단순화된 이름 기준 조회 맵을 한 번만 구성한다.
export function buildCustomerMatchIndex(customers) {
    const bizNoMap = new Map();
    const exactNameMap = new Map();
    const cleanNameMap = new Map();
    const simplifiedNameMap = new Map();

    (customers || []).forEach(c => {
        const bizNo = (c.businessNumber || '').replace(/[^0-9]/g, '');
        if (bizNo && bizNo.length >= 5) bizNoMap.set(bizNo, c);

        const name = (c.companyName || '').trim().toLowerCase();
        if (name) exactNameMap.set(name, c);

        const clean = stripCorp(c.companyName);
        if (clean && !cleanNameMap.has(clean)) cleanNameMap.set(clean, c);

        const simplified = (c.companyName || '').replace(/[\s()주식회사]/g, '').toLowerCase();
        if (simplified && !simplifiedNameMap.has(simplified)) simplifiedNameMap.set(simplified, c);
    });

    return { bizNoMap, exactNameMap, cleanNameMap, simplifiedNameMap };
}

// order 또는 quotation 레코드 하나를 bizNo → 정확한 이름 → 정리된 이름 순으로 CRM 고객사와 매칭한다.
export function matchCustomerToCrmFast(order, bizNoMap, exactNameMap, cleanNameMap) {
    let bizNo = '';
    if (order.payload?.customer?.business_no) bizNo = order.payload.customer.business_no;
    else if (order.customerInfo?.bizNo) bizNo = order.customerInfo.bizNo;
    else if (order.customerBizNo) bizNo = order.customerBizNo;
    bizNo = (bizNo || '').replace(/[^0-9]/g, '');

    if (bizNo && bizNo.length >= 5) {
        const matched = bizNoMap.get(bizNo);
        if (matched) return matched;
    }

    let rawName = '';
    if (order.poEndCustomer) rawName = order.poEndCustomer;
    else if (order.payload?.customer?.company_name) rawName = order.payload.customer.company_name;
    else if (order.customerInfo?.companyName) rawName = order.customerInfo.companyName;
    else if (order.customerInfo?.company_name) rawName = order.customerInfo.company_name;
    else if (order.customerName) rawName = order.customerName;

    const lowerName = (rawName || '').trim().toLowerCase();
    if (lowerName) {
        const exactMatch = exactNameMap.get(lowerName);
        if (exactMatch) return exactMatch;
    }

    const cleanOrderName = stripCorp(order.customerName || rawName);
    if (!cleanOrderName) return undefined;

    const cleanExact = cleanNameMap.get(cleanOrderName);
    if (cleanExact) return cleanExact;

    // Partial match fallback — O(N) but only reached when all map lookups miss
    if (cleanOrderName.length > 1) {
        for (const [key, c] of cleanNameMap) {
            if (key && key.includes(cleanOrderName)) return c;
        }
    }

    return undefined;
}
