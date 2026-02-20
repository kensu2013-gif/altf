export type DocumentType = 'QUOTATION' | 'ORDER' | 'INVOICE' | 'TRANSACTION' | 'SHIPPING' | 'PURCHASE_ORDER' | 'ORDER_RECEIPT';

export interface DocumentItem {
    no: number;
    item_id?: string | null;
    item_name: string;
    spec?: string;
    thickness?: string;
    size?: string;
    material?: string;

    // Stock Info (Quote Only)
    stock_qty?: number;
    stock_status?: string; // '가능', '부족', '문의'
    location_maker?: string; // Maker / Brand

    qty: number;
    unit_price: number;
    amount: number;
    note?: string;
    rate?: number; // Negotiated Discount Rate (Percentage)
}

export interface DocumentPayload {
    document_type: DocumentType;
    meta: {
        doc_no: string;
        created_at: string;
        channel: 'WEB' | 'EMAIL' | 'PHONE' | 'VISIT';
        delivery_date?: string; // For Quote/Order
        page_count?: number; // Total pages (if pre-calc needed)
        title?: string; // Custom Title Overwrite
    };
    supplier: { // Sender Info (Us or Vendor)
        company_name: string;
        contact_name: string;
        business_no?: string;
        address?: string;
        tel?: string;
        fax?: string;
        email?: string;
        note?: string; // Admin Note
    };
    customer: { // Receiver Info (Customer or Us)
        company_name: string;
        contact_name: string;
        business_no?: string;
        address?: string;
        tel?: string;
        fax?: string;
        email?: string;
        memo?: string;
    };
    items: DocumentItem[];
    totals: {
        total_amount: number;
        currency: 'KRW' | 'USD';
        vat_rate?: number; // e.g. 0.1
        vat_amount?: number;
        final_amount?: number; // Total + VAT
        additional_charges?: { name: string; amount: number }[];
        global_discount_rate?: number; // %
        global_discount_amount?: number; // Amount
    };
    footer?: {
        message?: string;
        terms?: string[];
    };
}
