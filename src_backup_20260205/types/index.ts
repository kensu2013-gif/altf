export type StockStatus = 'AVAILABLE' | 'CHECK_LEAD_TIME' | 'OUT_OF_STOCK';

export interface Product {
    id: string;
    name: string;
    thickness: string;
    size: string;
    material: string;
    unitPrice: number;
    currentStock: number;
    markingWaitQty?: number;
    stockStatus: StockStatus;
    location?: string;
    maker?: string;
    odEqKey?: string;
    locationStock?: Record<string, number>;
    location1?: string;
    shQty?: number;
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
    isVerified: boolean; // True if matched to product
    stockStatus?: StockStatus;
    location?: string;
    maker?: string;
    // Composite Key (Hidden)
    itemId?: string; // name-thickness-size-material
    currentStock?: number;
    markingWaitQty?: number;
    locationStock?: Record<string, number>;
}

export interface Quotation {
    id: string;
    customerNumber: string; // From auth/invite
    items: LineItem[];
    status: 'DRAFT' | 'SUBMITTED' | 'PROCESSED';
    totalAmount: number;
    createdAt: string;
}

export interface User {
    id: string;
    email: string;
    contactName: string; // contact_name
    password?: string; // In real app, never store plain text. Mock only.
    companyName: string;
    bizNo: string;
    address: string;
    phone: string;
    fax?: string;
    role: 'admin' | 'user';
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
}

export interface Order {
    id: string;
    userId: string;
    customerName: string; // Snapshot
    customerBizNo: string; // Snapshot
    items: LineItem[];
    totalAmount: number;
    status: 'SUBMITTED' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
    adminResponse?: AdminResponse;
    createdAt: string;
}
