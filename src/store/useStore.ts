import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LineItem, Product, User, Order, Quotation } from '../types';
import { generateSku } from '../lib/sku';
import { generateUUID } from '../lib/utils';


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

export interface CustomPriceRecord {
    id: string; // e.g. "Name-Thickness-Size-Material"
    name: string;
    thickness: string;
    size: string;
    material: string;
    salesPrice: number;
    purchasePrice: number;
    updatedAt: string;
    updatedBy: string;
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
        token: string | null;
        isAuthenticated: boolean;
        pendingAdminUser: User | null; // For 2FA
    };
    users: User[]; // Mock DB
    quotation: {
        items: LineItem[];
        customerNumber: string;
        memo: string;
    };
    // Admin 2.0 Persistence
    orders: Order[];
    quotes: Quotation[]; // History
    inventory: Product[];

    // Auth Actions
    signup: (user: Omit<User, 'id' | 'createdAt' | 'role' | 'status'>) => Promise<boolean>;
    login: (email: string, password?: string) => Promise<'SUCCESS' | 'MFA_REQUIRED' | 'FAILED' | 'PENDING_APPROVAL'>;
    verify2FA: (code: string) => boolean;
    logout: () => void;

    // User Management (API)
    fetchUsers: () => Promise<void>;
    createUser: (user: Partial<User>) => Promise<boolean>;
    updateUser: (id: string, updates: Partial<User>) => Promise<void>;
    deleteUser: (id: string) => Promise<void>;
    updateUserStatus: (userId: string, status: User['status']) => void;

    // Quote Actions
    addItem: (item: LineItem) => void;
    updateItem: (itemId: string, updates: Partial<LineItem>) => void;
    removeItem: (itemId: string) => void;
    clearQuotation: () => void;
    setQuotationMemo: (memo: string) => void;
    loadQuotation: (items: (QuoteImportItem | LineItem)[]) => void;
    syncDraftQuotation: () => Promise<void>;
    pullDraftQuotation: () => Promise<void>;

    // Inventory Actions
    setInventory: (data: Product[]) => void;
    fetchInventory: (force?: boolean) => Promise<void>;
    lastInventoryFetch: number; // Timestamp
    // Order Notification
    newOrderCount: number;
    incrementNewOrderCount: () => void;
    resetNewOrderCount: () => void;

    // Admin Order Actions
    submitOrder: (order: Partial<Order> & Omit<Order, 'id' | 'createdAt'>) => string;
    updateOrder: (orderId: string, updates: Partial<Order>) => void;
    trashOrder: (orderId: string) => Promise<void>;
    restoreOrder: (orderId: string) => Promise<void>;
    permanentDeleteOrder: (orderId: string) => Promise<boolean>;
    retractOrder: (orderId: string) => Promise<boolean>;

    addQuotation: (quotation: Omit<Quotation, 'id' | 'createdAt'>) => void;
    updateQuotation: (quoteId: string, updates: Partial<Quotation>) => void;
    trashQuotation: (quoteId: string) => Promise<void>;
    restoreQuotation: (quoteId: string) => Promise<void>;
    permanentDeleteQuotation: (quoteId: string) => Promise<boolean>;

    setQuotes: (quotes: Quotation[]) => void; // Sync action
    setOrders: (orders: Order[]) => void; // Sync action

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

    // --- S3 Generic File Upload ---
    uploadFile: (file: File, type: 'member' | 'quote' | 'order' | 'po', refId: string) => Promise<{ url: string, name: string } | null>;

    // --- Admin Mobile Layout State ---
    isMobileModalOpen: boolean;
    setMobileModalOpen: (isOpen: boolean) => void;

    // --- Custom Item Pricing ---
    customPrices: Record<string, CustomPriceRecord>;
    saveCustomPrices: (records: CustomPriceRecord[]) => void;
}

export const useStore = create<AppState>()(
    persist(
        (set, get) => ({
            auth: {
                user: null,
                token: null,
                isAuthenticated: false,
                pendingAdminUser: null,
            },
            users: [],
            quotation: {
                items: [],
                customerNumber: '',
                memo: ''
            },
            inventory: [],
            lastInventoryFetch: 0,
            // Admin 2.0
            orders: [], // Normalized Persistent DB
            quotes: [],

            newOrderCount: 0,
            deliveryPreferences: null,

            isMobileModalOpen: false,
            setMobileModalOpen: (isOpen) => set({ isMobileModalOpen: isOpen }),

            customPrices: {},
            saveCustomPrices: (records) => {
                set((state) => {
                    const newPrices = { ...state.customPrices };
                    let hasChanges = false;
                    records.forEach(record => {
                        if (record.salesPrice > 0 || record.purchasePrice > 0) {
                            newPrices[record.id] = record;
                            hasChanges = true;
                        }
                    });
                    return hasChanges ? { customPrices: newPrices } : state;
                });
            },

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

            // --- S3 Generic File Upload ---
            uploadFile: async (file, type, refId) => {
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('refId', refId);

                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/upload/${type}`, {
                        method: 'POST',
                        body: formData
                    });

                    if (res.ok) {
                        const data = await res.json();
                        return { url: data.url, name: data.filename };
                    } else {
                        throw new Error('Upload failed');
                    }
                } catch (e) {
                    console.error('[Store] uploadFile error', e);
                    return null;
                }
            },

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
                    return;
                }

                try {
                    const response = await fetch((import.meta.env.VITE_API_URL || '') + '/api/inventory/inventory.json');
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
            signup: async (formData) => {
                try {
                    const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    });
                    const success = res.ok;
                    if (success) {
                        // Refresh list 
                        get().fetchUsers();
                    }
                    return success;
                } catch {
                    return false;
                }
            },

            // --- Auth & User Management (API) ---
            fetchUsers: async () => {
                try {
                    const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/users');
                    if (res.ok) {
                        const data = await res.json();
                        set({ users: data });
                    }
                } catch (e) {
                    console.error("Failed to fetch users", e);
                }
            },

            createUser: async (userData) => {
                try {
                    const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(userData)
                    });
                    if (res.ok) {
                        const newUser = await res.json();
                        set(state => ({ users: [...state.users, newUser] }));
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.error(e);
                    return false;
                }
            },

            updateUser: async (id, updates) => { // Changed signature to (id, updates)
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/users/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updates)
                    });
                    if (res.ok) {
                        const updatedUser = await res.json();
                        set(state => ({
                            users: state.users.map(u => u.id === id ? updatedUser : u),
                            // Also update current auth user if it matches
                            auth: state.auth.user?.id === id ? { ...state.auth, user: updatedUser } : state.auth
                        }));
                    } else {
                        throw new Error(`Failed to update user. Status: ${res.status}`);
                    }
                } catch (e) {
                    console.error('Failed to update user:', e);
                    alert('사용자 정보 업데이트(승인/거절)에 실패했습니다. (서버/권한 오류)');
                    throw e; // Rethrow so components mapping this can react to the failure
                }
            },

            deleteUser: async (id) => {
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/users/${id}`, { method: 'DELETE' });
                    if (res.ok) {
                        set(state => ({
                            users: state.users.filter(u => u.id !== id)
                        }));
                    }
                } catch (e) {
                    console.error(e);
                }
            },

            login: async (email, password) => {
                try {

                    const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });

                    if (res.ok) {
                        const { user, token } = await res.json();


                        // MFA Check for MASTER
                        // Ensure we catch 'MASTER', 'admin' and potentially 'MANAGER' if needed later
                        if (user.role === 'MASTER' || user.role === 'admin') {
                            set({
                                auth: { ...get().auth, pendingAdminUser: user, token: token || null }
                            });

                            return 'MFA_REQUIRED';
                        }

                        // Normal User / Manager
                        set({
                            auth: { user, token: token || null, isAuthenticated: true, pendingAdminUser: null },
                            quotation: { ...get().quotation, customerNumber: user.companyName }
                        });
                        return 'SUCCESS';

                    } else if (res.status === 403) {

                        return 'PENDING_APPROVAL';
                    }

                    return 'FAILED';
                } catch (e) {
                    console.error('[Store] Login error:', e);
                    return 'FAILED';
                }
            },

            updateAuthUser: (updates: Partial<User>) => set((state) => {
                if (state.auth.user) {
                    return {
                        auth: { user: { ...state.auth.user, ...updates }, token: state.auth.token, isAuthenticated: true, pendingAdminUser: null }
                    };
                }
                return state;
            }),

            verify2FA: (code: string) => {
                const { auth } = get();


                // Demo Code: 123456 or user requested code
                if (auth.pendingAdminUser && (code === '******' || code === '120528')) {
                    set({
                        auth: { user: auth.pendingAdminUser, token: auth.token, isAuthenticated: true, pendingAdminUser: null },
                        quotation: { ...get().quotation, customerNumber: auth.pendingAdminUser.companyName }
                    });

                    return true;
                }

                return false;
            },

            seedAdmin: () => {
                // Deprecated: Admin is seeded on backend
            },

            logout: () => {
                const { token, user } = get().auth;
                if (token || user) {
                    fetch((import.meta.env.VITE_API_URL || '') + '/api/auth/logout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, user })
                    }).catch(e => console.error('[Store] Logout error:', e));
                }
                set({
                    auth: { user: null, token: null, isAuthenticated: false, pendingAdminUser: null }
                });
            },

            // Deprecated: Use updateUser(id, updates) instead
            // updateUser: (updates) => ... 

            updateUserStatus: async (userId, status) => {
                // Use the generic update
                await get().updateUser(userId, { status });
            },

            submitOrder: (orderData) => {
                const newId = (orderData as Partial<Order>).id || `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`;
                const newOrder: Order = {
                    ...orderData,
                    id: newId,
                    createdAt: (orderData as Partial<Order>).createdAt || new Date().toISOString()
                } as Order;

                set((state) => ({
                    orders: [newOrder, ...state.orders],
                    newOrderCount: state.newOrderCount + 1
                }));
                return newId;
            },

            updateOrder: async (orderId, updates) => {
                const currentUser = get().auth.user;
                const enrichedUpdates = {
                    ...updates,
                    lastUpdatedBy: currentUser ? {
                        name: currentUser.contactName || currentUser.companyName || 'Unknown',
                        id: currentUser.id,
                        email: currentUser.email,
                        at: new Date().toISOString()
                    } : undefined
                };

                // 1. Optimistic Update
                set((state) => ({
                    orders: state.orders.map(o => o.id === orderId ? { ...o, ...enrichedUpdates } : o)
                }));

                // 2. Persist to API
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/orders/${orderId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(enrichedUpdates)
                    });
                    if (!res.ok) throw new Error('Failed to update order');
                } catch (e) {
                    console.error("Failed to persist order update:", e);
                }
            },

            trashOrder: async (orderId) => {
                await get().updateOrder(orderId, { isDeleted: true });
            },

            restoreOrder: async (orderId) => {
                await get().updateOrder(orderId, { isDeleted: false });
            },

            permanentDeleteOrder: async (orderId) => {
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/orders/${orderId}`, { method: 'DELETE' });
                    if (res.ok) {
                        set((state) => ({
                            orders: state.orders.filter(o => o.id !== orderId)
                        }));
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.error(e);
                    return false;
                }
            },

            retractOrder: async (orderId) => {
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/orders/${orderId}/retract`, { method: 'POST' });
                    if (res.ok) {
                        const { quote } = await res.json();
                        set((state) => ({
                            orders: state.orders.filter(o => o.id !== orderId),
                            quotes: [quote, ...state.quotes.filter(q => q.id !== quote.id)]
                        }));
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.error('Failed to retract order:', e);
                    return false;
                }
            },

            addQuotation: (quotationData) => {
                const newId = `QT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`;
                const newQuotation: Quotation = {
                    ...quotationData,
                    id: newId,
                    createdAt: new Date().toISOString(),
                    status: (quotationData as Partial<Quotation>).status || 'DRAFT'
                };
                set((state) => ({
                    quotes: [newQuotation, ...state.quotes]
                }));
            },

            updateQuotation: async (quoteId, updates) => {
                // 1. Optimistic Update
                set((state) => ({
                    quotes: state.quotes.map(q => q.id === quoteId ? { ...q, ...updates } : q)
                }));

                // 2. Persist to API
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/quotations/${quoteId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updates)
                    });
                    if (!res.ok) throw new Error('Failed to update quotation');
                } catch (e) {
                    console.error("Failed to persist quotation update:", e);
                }
            },

            trashQuotation: async (quoteId) => {
                await get().updateQuotation(quoteId, { isDeleted: true });
            },

            restoreQuotation: async (quoteId) => {
                await get().updateQuotation(quoteId, { isDeleted: false });
            },

            permanentDeleteQuotation: async (quoteId) => {
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/quotations/${quoteId}`, { method: 'DELETE' });
                    if (res.ok) {
                        set((state) => ({
                            quotes: state.quotes.filter(q => q.id !== quoteId)
                        }));
                        return true;
                    }
                    return false;
                } catch (e) {
                    console.error(e);
                    return false;
                }
            },

            setQuotes: (quotes) => set({ quotes }),
            setOrders: (orders) => set({ orders }),

            addItem: (item) => {
                set((state) => {
                    const normalizedItem = {
                        ...item,
                        itemId: generateSku(item),
                        unitPrice: item.unitPrice,
                        amount: Number(item.unitPrice) * Number(item.quantity)
                    };
                    return {
                        quotation: {
                            ...state.quotation,
                            items: [...state.quotation.items, normalizedItem]
                        }
                    };
                });
                get().syncDraftQuotation();
            },
            loadQuotation: (items: (QuoteImportItem | LineItem)[]) => {
                set((state) => {
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

                                locationStock: match.locationStock,
                                marking_wait_qty: match.marking_wait_qty, // Restore Marking Wait Quantity from Live Inventory
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
                            id: generateUUID(), // Always new ID
                            name: name,
                            thickness: thickness,
                            size: size,
                            material: material,
                            quantity: qty,
                            amount: price * qty, // Restore amount calculation
                            // Generate Composite ID
                            itemId: generateSku({ name, thickness, size, material }),
                            ...baseItem
                        } as LineItem;
                    });
                    return {
                        quotation: {
                            ...state.quotation,
                            items: normalizedItems
                        }
                    };
                });
                get().syncDraftQuotation();
            },
            updateItem: (itemId, updates) => {
                set((state) => {
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
                                        updatedItem.itemId = generateSku(updatedItem);
                                    }
                                    return updatedItem;
                                }
                                return i;
                            })
                        }
                    };
                });
                get().syncDraftQuotation();
            },
            removeItem: (itemId) => {
                set((state) => ({
                    quotation: {
                        ...state.quotation,
                        items: state.quotation.items.filter(i => i.id !== itemId)
                    }
                }));
                get().syncDraftQuotation();
            },
            clearQuotation: () => {
                set((state) => ({ quotation: { ...state.quotation, items: [], memo: '' } }));
                get().syncDraftQuotation();
            },
            setQuotationMemo: (memo) => {
                set((state) => ({ quotation: { ...state.quotation, memo } }));
                get().syncDraftQuotation();
            },
            syncDraftQuotation: async () => {
                const { auth, quotation } = get();
                if (!auth.isAuthenticated || !auth.user) return;
                
                // Attach a timestamp to ensure accurate polling from other devices
                const syncedQuotation = {
                    ...quotation,
                    lastUpdated: Date.now()
                };

                // Update local state to reflect the new timestamp
                set({ quotation: syncedQuotation });

                try {
                    // Save draft to user profile
                    await fetch(`${import.meta.env.VITE_API_URL || ''}/api/users/${auth.user.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ draftQuotation: syncedQuotation })
                    });
                } catch (e) {
                    console.error('Failed to sync draft', e);
                }
            },
            pullDraftQuotation: async () => {
                const { auth, quotation } = get();
                if (!auth.isAuthenticated || !auth.user) return;
                try {
                    const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/users`);
                    if (res.ok) {
                        const users = await res.json();
                        const user = users.find((u: User) => u.id === auth.user?.id);
                        if (user && user.draftQuotation) {
                            
                            const serverDraft = user.draftQuotation;
                            const localTimestamp = (quotation as { lastUpdated?: number }).lastUpdated || 0;
                            const serverTimestamp = serverDraft.lastUpdated || 0;

                            // If server has a newer draft (e.g. edited on Mobile), pull it.
                            if (serverTimestamp > localTimestamp) {
                                set({ quotation: serverDraft });
                                console.log('[Store] Pulled newer draft quotation from server.');
                            } else if (quotation.items.length === 0 && serverDraft.items.length > 0 && localTimestamp === 0) {
                                // Fallback: Initial load where local has nothing and no timestamp
                                set({ quotation: serverDraft });
                                console.log('[Store] Initial draft quotation load from server.');
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to pull draft', e);
                }
            }
        }),
        {
            name: 'altf-b2b-storage',
            partialize: (state) => ({
                auth: state.auth,
                quotation: state.quotation,
                deliveryPreferences: state.deliveryPreferences,
                newOrderCount: state.newOrderCount,
                customPrices: state.customPrices
            }),
        }
    )
);
