export type DocumentType = 'QUOTATION' | 'ORDER' | 'PO';

export interface DocumentItem {
    no: number;
    item_name: string;
    thickness: string;
    size: string;
    material: string;
    stock_qty: number;
    stock_status: string;
    location_maker: string;
    qty: number;
    unit_price: number;
    amount: number;
    note?: string;
    item_id?: string; // Composite Key (Back Data)
}

export interface DocumentPayload {
    document_type: DocumentType;
    meta: {
        doc_no: string;
        created_at: string;
        channel: 'WEB' | 'KAKAO' | 'EMAIL';
        trace_key?: string;
    };
    supplier: {
        company_name: string;
        address: string;
        tel: string;
        fax: string;
        email: string;
        business_no?: string;
    };
    customer: {
        company_name: string | null;
        business_no?: string;
        contact_name?: string;
        address?: string;
        tel?: string;
        fax?: string;
        email?: string;
        memo?: string;
    };
    items: DocumentItem[];
    totals: {
        total_amount: number;
        currency: 'KRW';
    };
}
