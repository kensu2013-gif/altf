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
    marking_wait_qty?: number;
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
    base_price?: number; // Added for verification display
    isVerified: boolean; // True if matched to product
    stockStatus?: StockStatus;
    location?: string;
    maker?: string;
    // Composite Key (Hidden)
    itemId?: string; // name-thickness-size-material
    currentStock?: number;

    locationStock?: Record<string, number>;
    marking_wait_qty?: number;
    // Supplier Fields
    supplierRate?: number;
    discountRate?: number;
    supplierPriceOverride?: number; // Added for manual vendor price override
    poSent?: boolean; // Track if this line item has been ordered
    vendorName?: string; // Track which vendor it was sent to

    // Legacy Fields (Snake Case)
    item_name?: string;
    item_id?: string;
    unit_price?: number;
    qty?: number;

    // UI State
    isSelected?: boolean; // True if included in documents
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
    managerIds?: string[]; // [NEW] Support multiple managers
    managerId?: string; // [DEPRECATED] Backwards compatibility
    // For MANAGER
    department?: string;
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
    // Supplier PO Data
    poSent?: boolean; // [NEW] Track whether PO webhook was fired
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
    manager?: { name: string; id: string; email: string; }; // Permanent Sales Rep
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
