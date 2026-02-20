import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LineItem, Product, User, Order, Quotation } from '../types';

export interface QuoteImportItem {
    item_name?: string;
    name?: string;
    thickness?: string;
    size?: string;
    material?: string;
    qty?: number | string;
    quantity?: number | string;
    unit_price?: number | string;
    unitPrice?: number | string;
    [key: string]: unknown;
}

export interface DeliveryInfo {
    method: 'FREIGHT' | 'COURIER';
    branchName: string;
    address: string;
    contactName: string;
    contactPhone: string;
    additionalRequest?: string;
}

interface AppState {
    auth: {
        user: User | null;
        isAuthenticated: boolean;
        pendingAdminUser: User | null; // For 2FA
    };
    users: User[]; // Mock DB
    quotation: {
        items: LineItem[];
        customerNumber: string;
    };
    // Admin 2.0 Persistence
    orders: Order[];
    quotes: Quotation[]; // History
    inventory: Product[];

    // Auth Actions
    signup: (user: Omit<User, 'id' | 'createdAt' | 'role' | 'status'>) => boolean;
    login: (email: string, password?: string) => 'SUCCESS' | 'MFA_REQUIRED' | 'FAILED' | 'PENDING_APPROVAL';
    verify2FA: (code: string) => boolean;
    seedAdmin: () => void; // Force seed admin if missing
    logout: () => void;
    updateUser: (updates: Partial<User>) => void;
    updateUserStatus: (userId: string, status: User['status']) => void;

    // Quote Actions
    addItem: (item: LineItem) => void;
    updateItem: (itemId: string, updates: Partial<LineItem>) => void;
    removeItem: (itemId: string) => void;
    clearQuotation: () => void;
    loadQuotation: (items: (QuoteImportItem | LineItem)[]) => void;

    // Inventory Actions
    setInventory: (data: Product[]) => void;
    fetchInventory: (force?: boolean) => Promise<void>;
    lastInventoryFetch: number; // Timestamp
    // Order Notification
    newOrderCount: number;
    incrementNewOrderCount: () => void;
    resetNewOrderCount: () => void;

    // Admin Order Actions
    submitOrder: (order: Omit<Order, 'id' | 'createdAt'>) => string;
    updateOrder: (orderId: string, updates: Partial<Order>) => void;
    addQuotation: (quotation: Omit<Quotation, 'id' | 'createdAt'>) => void;

    // Delivery Persistence
    deliveryPreferences: DeliveryInfo | null;
    setDeliveryPreferences: (info: DeliveryInfo) => void;

    // --- Upload / Analysis State (Global) ---
    uploadState: {
        status: 'IDLE' | 'PROCESSING' | 'DONE';
        sessionId: string | null;
        processedCount: number;
        attachedFile: File | null;
    };
    startUpload: (file: File, sessionId: string) => void;
    setUploadStatus: (status: 'IDLE' | 'PROCESSING' | 'DONE') => void;
    updateProcessedCount: (count: number) => void;
    resetUpload: () => void;
}

export const useStore = create<AppState>()(
    persist(
        (set, get) => ({
            auth: {
                user: null,
                isAuthenticated: false,
                pendingAdminUser: null,
            },
            users: [
                {
                    id: 'admin-user-id',
                    email: 'admin@altf.kr',
                    password: 'admin1234!',
                    companyName: 'AltF Admin',
                    bizNo: '000-00-00000',
                    contactName: 'Admin',
                    phone: '010-0000-0000',
                    address: 'Seoul, Korea', // Mock address
                    role: 'admin', // This triggers the 2FA flow
                    createdAt: new Date().toISOString(),
                    agreedToTerms: true,
                    agreedToPrivacy: true,
                    agreedToMarketing: true,
                    consentDate: new Date().toISOString(),
                    status: 'APPROVED'
                }
            ],
            quotation: {
                items: [],
                customerNumber: '',
            },
            inventory: [],
            lastInventoryFetch: 0,
            // Admin 2.0
            orders: [], // Normalized Persistent DB
            quotes: [],

            newOrderCount: 0,
            deliveryPreferences: null,


            setDeliveryPreferences: (info) => set({ deliveryPreferences: info }),

            // --- Upload Actions ---
            uploadState: {
                status: 'IDLE',
                sessionId: null,
                processedCount: 0,
                attachedFile: null
            },
            startUpload: (file, sessionId) => set({
                uploadState: { status: 'PROCESSING', sessionId, attachedFile: file, processedCount: 0 }
            }),
            setUploadStatus: (status) => set((state) => ({
                uploadState: { ...state.uploadState, status }
            })),
            updateProcessedCount: (count) => set((state) => ({
                uploadState: { ...state.uploadState, processedCount: count }
            })),
            resetUpload: () => set({
                uploadState: { status: 'IDLE', sessionId: null, processedCount: 0, attachedFile: null }
            }),

            // --- Order Notification ---
            incrementNewOrderCount: () => set((state) => ({ newOrderCount: state.newOrderCount + 1 })),
            resetNewOrderCount: () => set({ newOrderCount: 0 }),

            // --- Inventory ---
            setInventory: (data) => set({ inventory: data }),
            fetchInventory: async (force = false) => {
                const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
                const now = Date.now();
                const { lastInventoryFetch, inventory } = get();

                // If not forced, data exists, and cache is fresh, skip fetch
                if (!force && inventory.length > 0 && (now - lastInventoryFetch < CACHE_DURATION)) {
                    console.log('Using cached inventory data');
                    return;
                }

                try {
                    const response = await fetch('/api/inventory/inventory.json', { cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    // Note: Actual data mapping is currently done in Search.tsx
                    // Ideally we should move it here, but keeping as is for now 
                    // to facilitate Search.tsx's existing logic.

                    // Update timestamp only on success
                    set({ lastInventoryFetch: now });
                } catch (error) {
                    console.error("Failed to fetch inventory", error);
                }
            },

            // --- Auth ---
            signup: (formData) => {
                const { users } = get();
                if (users.some(u => u.email === formData.email)) {
                    return false;
                }

                const newUser: User = {
                    ...formData,
                    id: crypto.randomUUID(),
                    role: 'user', // Default role
                    status: 'PENDING', // Default status
                    createdAt: new Date().toISOString(),
                };

                set((state) => ({
                    users: [...state.users, newUser]
                }));
                return true;
            },

            login: (email, password) => {
                const { users } = get();
                const user = users.find(u => u.email === email && u.password === password);

                if (user) {
                    // Check Approval (Skip for Admin)
                    if (user.role !== 'admin' && user.status !== 'APPROVED') {
                        return 'PENDING_APPROVAL';
                    }

                    // IF ADMIN, REQUIRE MFA
                    if (user.role === 'admin') {
                        set({
                            auth: { ...get().auth, pendingAdminUser: user }
                        });
                        return 'MFA_REQUIRED';
                    }

                    // NORMAL USER
                    set({
                        auth: { user, isAuthenticated: true, pendingAdminUser: null },
                        quotation: { ...get().quotation, customerNumber: user.companyName } // Use Company as Customer ID for now
                    });
                    return 'SUCCESS';
                }
                return 'FAILED';
            },

            verify2FA: (code: string) => {
                const { auth } = get();
                // Demo Code: 123456
                if (auth.pendingAdminUser && code === '123456') {
                    set({
                        auth: { user: auth.pendingAdminUser, isAuthenticated: true, pendingAdminUser: null },
                        quotation: { ...get().quotation, customerNumber: auth.pendingAdminUser.companyName }
                    });
                    return true;
                }
                return false;
            },

            seedAdmin: () => {
                const { users } = get();
                if (!users.some(u => u.email === 'admin@altf.kr')) {
                    const adminUser: User = {
                        id: 'admin-user-id',
                        email: 'admin@altf.kr',
                        password: 'admin1234!',
                        companyName: 'AltF Admin',
                        bizNo: '000-00-00000',
                        contactName: 'Admin',
                        phone: '010-0000-0000',
                        address: 'Seoul, Korea',
                        role: 'admin',
                        createdAt: new Date().toISOString(),
                        agreedToTerms: true,
                        agreedToPrivacy: true,
                        agreedToMarketing: true,
                        consentDate: new Date().toISOString(),
                        status: 'APPROVED'
                    };
                    set({ users: [...users, adminUser] });
                }
            },

            logout: () => set({
                auth: { user: null, isAuthenticated: false, pendingAdminUser: null }
            }),

            updateUser: (updates) => {
                const { auth } = get();
                if (!auth.user) return;

                const updatedUser = { ...auth.user, ...updates };

                // Update current auth user AND the user in the 'database' (users array)
                set((state) => ({
                    auth: { ...state.auth, user: updatedUser },
                    users: state.users.map(u => u.id === auth.user!.id ? updatedUser : u)
                }));
            },

            updateUserStatus: (userId, status) => {
                console.log(`[Admin] Changing User(${userId}) status to: ${status}`);
                set((state) => ({
                    users: state.users.map(u =>
                        u.id === userId ? { ...u, status: status } : u
                    )
                }));
            },

            submitOrder: (orderData) => {
                const newId = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`;
                const newOrder: Order = {
                    ...orderData,
                    id: newId,
                    createdAt: new Date().toISOString()
                };
                set((state) => ({
                    orders: [newOrder, ...state.orders],
                    newOrderCount: state.newOrderCount + 1
                }));
                return newId;
            },

            updateOrder: (orderId, updates) => set((state) => ({
                orders: state.orders.map(o => o.id === orderId ? { ...o, ...updates } : o)
            })),

            addQuotation: (quotationData) => {
                const newId = `QT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`;
                const newQuotation: Quotation = {
                    ...quotationData,
                    id: newId,
                    createdAt: new Date().toISOString(),
                    status: 'DRAFT'
                };
                set((state) => ({
                    quotes: [newQuotation, ...state.quotes]
                }));
            },

            // --- Quotation ---
            addItem: (item) => set((state) => {
                const normalizedItem = {
                    ...item,
                    itemId: `${item.name}-${item.thickness}-${item.size}-${item.material}`,
                    unitPrice: item.unitPrice,
                    amount: Number(item.unitPrice) * Number(item.quantity)
                };
                return {
                    quotation: {
                        ...state.quotation,
                        items: [...state.quotation.items, normalizedItem]
                    }
                };
            }),
            loadQuotation: (items: (QuoteImportItem | LineItem)[]) => set((state) => {
                // Normalize and generate IDs
                const normalizedItems: LineItem[] = items.map(item => {
                    // Cast to QuoteImportItem
                    const raw = item as QuoteImportItem;

                    const name = raw.item_name || raw.name || '';
                    const thickness = raw.thickness || '';
                    const size = raw.size || '';
                    const material = raw.material || '';

                    // --- Unified Verification Logic ---
                    // Try to find matching product in inventory to link it
                    const match = state.inventory.find(p =>
                        p.name === name &&
                        p.thickness === thickness &&
                        p.size === size &&
                        p.material === material
                    );

                    let baseItem: Partial<LineItem> = {};

                    if (match) {
                        // Found in inventory -> Link it!
                        baseItem = {
                            productId: match.id,
                            unitPrice: match.unitPrice,
                            stockStatus: match.stockStatus,
                            location: match.location,
                            maker: match.maker,
                            isVerified: true,
                            currentStock: match.currentStock,
                            markingWaitQty: match.markingWaitQty,
                            locationStock: match.locationStock,
                        };
                    } else {
                        // Not found -> Manual
                        const rawPrice = Number(raw.unit_price || raw.unitPrice || 0);
                        baseItem = {
                            productId: (raw['productId'] as string) || null,
                            unitPrice: rawPrice,
                            isVerified: false,
                        };
                    }

                    const qty = Number(raw.qty || raw.quantity || 1);
                    const price = baseItem.unitPrice || 0;

                    return {
                        ...item,
                        id: crypto.randomUUID(), // Always new ID
                        name: name,
                        thickness: thickness,
                        size: size,
                        material: material,
                        quantity: qty,
                        amount: price * qty, // Restore amount calculation
                        // Generate Composite ID
                        itemId: `${name}-${thickness}-${size}-${material}`,
                        ...baseItem
                    } as LineItem;
                });
                return {
                    quotation: {
                        ...state.quotation,
                        items: normalizedItems
                    }
                };
            }),
            updateItem: (itemId, updates) => set((state) => {
                return {
                    quotation: {
                        ...state.quotation,
                        items: state.quotation.items.map(i => {
                            if (i.id === itemId) {
                                const updatedItem = { ...i, ...updates };
                                // Re-calculate amount if price/qty changed
                                updatedItem.amount = Number(updatedItem.unitPrice) * Number(updatedItem.quantity);

                                // Re-generate composite ID if key fields changed
                                if (updates.name !== undefined || updates.thickness !== undefined || updates.size !== undefined || updates.material !== undefined) {
                                    updatedItem.itemId = `${updatedItem.name}-${updatedItem.thickness}-${updatedItem.size}-${updatedItem.material}`;
                                }
                                return updatedItem;
                            }
                            return i;
                        })
                    }
                };
            }),
            removeItem: (itemId) => set((state) => ({
                quotation: {
                    ...state.quotation,
                    items: state.quotation.items.filter(i => i.id !== itemId)
                }
            })),
            clearQuotation: () => set((state) => ({
                quotation: { ...state.quotation, items: [] }
            }))
        }),
        {
            name: 'altf-b2b-storage',
            partialize: (state) => ({
                auth: state.auth,
                users: state.users, // Persist Mock DB
                quotation: state.quotation,
                inventory: state.inventory,
                deliveryPreferences: state.deliveryPreferences,
                orders: state.orders,
                quotes: state.quotes,
                newOrderCount: state.newOrderCount
            }),
        }
    )
);
