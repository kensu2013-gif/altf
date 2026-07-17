export type StockStatus = 'AVAILABLE' | 'CHECK_LEAD_TIME' | 'OUT_OF_STOCK';

export interface Product {
    id: string;
    name: string;
    thickness: string;
    size: string;
    material: string;
    unitPrice: number;
    currentStock: number;

    stockStatus: StockStatus;
    location?: string;
    maker?: string;
    maker1?: string;
    odEqKey?: string;
    locationStock?: Record<string, number>;
    location1?: string;
    shQty?: number;
    sh_qty?: number;
    ready_qty?: number;
    marking_wait_qty?: number;
    uniqueKey?: string;
    // Supplier / Pricing Fields
    base_price?: number;
    rate_pct?: number;
    rate_act?: number;
    rate_act2?: number; // Future use
}

export interface LineItem {
    id: string; // UUID
    productId: string | null; // Null if manual entry / unlinked
    // Editable fields
    name: string;
    thickness: string;
    size: string;
    material: string;
    quantity: number;
    // Computed/Fetched
    unitPrice: number;
    amount: number;
    note?: string; // Appended for packing lists and transaction items
    base_price?: number; // Added for verification display
    isVerified: boolean; // True if matched to product
    stockStatus?: StockStatus;
    location?: string;
    maker?: string;
    // Composite Key (Hidden)
    itemId?: string; // name-thickness-size-material
    currentStock?: number;
    parentId?: string; // 원래 품목의 ID (분할 품목의 경우)
    isSplit?: boolean; // 분할된 가상 품목 여부


    locationStock?: Record<string, number>;
    marking_wait_qty?: number;
    // Supplier Fields
    supplierRate?: number;
    discountRate?: number;
    supplierPriceOverride?: number; // Added for manual vendor price override
    poSent?: boolean; // Track if this line item has been ordered
    vendorName?: string; // Track which vendor it was sent to
    transactionIssued?: boolean; // [NEW] True if transaction statement has been issued
    comments?: { author: string; timestamp: string; content: string; authorId?: string }[]; // [NEW] Chat/Comments per item

    // Legacy Fields (Snake Case)
    item_name?: string;
    item_id?: string;
    unit_price?: number;
    qty?: number;

    // UI State
    isSelected?: boolean; // True if included in documents
    tags?: string[]; // [NEW] Status tags/stickers like '재고품', '사급'
}

export interface Quotation {
    id: string;
    userId: string; // [NEW] Link to User
    customerNumber: string; // From auth/invite
    customerName?: string;
    customerInfo?: {
        companyName?: string;
        contactName?: string;
        phone?: string;
        email?: string;
        address?: string;
        bizNo?: string;
        fax?: string;
    };
    items: LineItem[];
    status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'PROCESSING' | 'PROCESSED' | 'COMPLETED';
    totalAmount: number;
    createdAt: string;
    memo?: string; // Inquiry/Request
    adminResponse?: AdminResponse;
    manager?: { name: string; id: string; email: string; }; // Permanent Sales Rep
    isDeleted?: boolean; // Soft Delete Flag
    attachments?: { name: string; url: string; }[]; // Customer request files
    adminAttachments?: { name: string; url: string; }[]; // Official ALTF quote files
}

export interface User {
    id: string;
    email: string;
    contactName: string; // contact_name
    password?: string; // Optional, for creation payload
    companyName: string;
    bizNo: string;
    address: string;
    phone: string;
    fax?: string;
    role: 'MASTER' | 'MANAGER' | 'CUSTOMER' | 'admin' | 'user'; // Kept legacy for compatibility during migration
    lastLoginAt?: number;
    managerIds?: string[]; // [NEW] Support multiple managers
    managerId?: string; // [DEPRECATED] Backwards compatibility
    // For MANAGER
    department?: string;
    permissions?: {
        viewCrm?: boolean;
        viewSihwa?: boolean;
    };
    contactInfo?: {
        phone: string;
        email: string;
    };
    createdAt: string;
    // Consent Flags
    agreedToTerms: boolean;
    agreedToPrivacy: boolean;
    agreedToMarketing: boolean;
    consentDate: string; // ISO Date required for audit trail
    // Admin 2.0
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    bizLicenseFile?: string; // Mock path

    // Analytics & Metrics
    activityMetrics?: {
        loginCount: number;
        lastLoginAt?: string;
        aiSearchCount: number;
        inquiryCount: number;
        poCount?: number;
    };
}

export interface AdminResponse {
    confirmedPrice?: number;
    deliveryDate?: string;
    note?: string;
    additionalCharges?: { name: string; amount: number; }[];
    globalDiscountRate?: number; // Total Discount %
}

export interface Order {
    id: string;
    userId: string;
    customerName: string; // Snapshot
    customerBizNo: string; // Snapshot
    customerBizType?: string; // Editable
    customerContactName?: string; // Editable
    customerTel?: string; // Editable
    customerEmail?: string; // Editable
    customerAddress?: string; // Editable
    items: LineItem[];
    po_items?: LineItem[]; // [NEW] Supplier PO Items (Separated from Customer Items)
    totalAmount: number;
    status: 'SUBMITTED' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD' | 'WITHDRAWN';
    adminResponse?: AdminResponse;
    createdAt: string;
    memo?: string;
    poEndCustomer?: string; // Editable End Customer for Purchase Order Prints
    isDeleted?: boolean; // Soft Delete Flag
    linkedQuoteId?: string; // Link to original Quote if originated from one
    parentOrderId?: string; // ID of the parent order if this is a split sub-order
    splitOrders?: string[]; // IDs of the split sub-orders if this is a parent order
    splitDeliveries?: SplitDelivery[]; // [NEW] Embedded split PO delivery info
    isSplitPoSubOrder?: boolean; // Flag to indicate if this order is a sub-order generated from a split PO
    // Supplier PO Data
    poSent?: boolean; // [NEW] Track whether PO webhook was fired
    isStockOrder?: boolean; // [NEW] Track if it is a stock replenishment order
    supplierInfo?: {
        company_name: string;
        contact_name: string;
        tel: string;
        email: string;
        address: string;
        note: string;
    };
    buyerInfo?: {
        company_name: string;
        contact_name: string;
        tel: string;
        email: string;
        address: string;
    };
    poNumber?: string;
    poTitle?: string;
    lastUpdatedBy?: {
        name: string;
        id: string;
        email: string;
        at: string; // ISO Date
    };
    managers?: { name: string; id: string; email?: string; }[]; // [NEW] Multiple Sales Reps
    manager?: { name: string; id: string; email: string; }; // [DEPRECATED] Permanent Sales Rep
    // S3 File Attachments
    customerPO?: { name: string; url: string; }; // Original PO from customer
    deliveryNote?: { name: string; url: string; }; // ALTF delivery note to customer
    supplierPO?: { name: string; url: string; }; // ALTF purchase order to supplier (internal)
    attachments?: { name: string; url: string; }[]; // General attachments added by customer
    // Generic Payload for flexible data (e.g. from Order Form)
    payload?: {
        customer?: {
            company_name?: string;
            contact_name?: string;
            tel?: string;
            email?: string;
            address?: string;
            memo?: string;
        };
        [key: string]: unknown;
    };
}

export interface Customer {
    id: string;
    companyName: string;
    ceo: string;
    businessNumber: string;
    address: string;
    region: string;
    salesType: string;
    industry: string;
    items: string;
    contactName: string;
    phone: string;
    email: string;
    contacts?: { contactName: string; phone: string; email: string }[];
    isDeleted?: boolean;
}

export interface Supplier {
    id: string;
    company_name: string;
    contact_name: string;
    tel: string;
    email: string;
    address: string;
    note?: string;
}

export interface SplitDelivery {
    supplier: Supplier;
    items: LineItem[];
    po_items?: LineItem[];
    totalAmount: number;
    salesAmount: number; // 발송 확정 시점의 수주(판매) 금액 스냅샷 - 이후 원본 주문이 수정되어도 변하지 않음
    poSent: boolean;
    poNumber: string;
    poTitle: string;
    status: 'PENDING' | 'SENT' | 'COMPLETED';
    sentAt?: string;
    supplierPO?: { name: string; url: string; };
}
