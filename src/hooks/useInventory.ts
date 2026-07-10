import useSWR from 'swr';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';
import type { Product } from '../types';
import { parseSku } from '../lib/sku';

const INVENTORY_URL = (import.meta.env.VITE_API_URL || '') + '/api/inventory/inventory.json';

interface RawInventoryItem {
    // S3 snake_case keys
    item?: string;
    ready_qty?: number | string;
    final_price?: number;
    marking_wait_qty?: number | string;

    od_eq_key?: string;
    location1?: string;
    sh_qty?: number | string;

    // Supplier fields
    base_price?: number;
    rate_pct?: number;
    rate_act?: number;
    rate_act2?: number;

    // Client camelCase keys (fallbacks)
    id?: string;
    name?: string;
    currentStock?: number | string;
    unitPrice?: number;

    odEqKey?: string;
    stockStatus?: string;
    locationStock?: Record<string, number>;

    // Common/Pass-through fields
    thickness?: string;
    size?: string;
    material?: string;
    location?: string;
    maker?: string;
    maker1?: string;

    [key: string]: unknown; // Allow other properties to pass through
}

// Fetcher function
const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

export function useInventory() {
    const setInventory = useStore((state) => state.setInventory);
    const existingInventory = useStore((state) => state.inventory);

    const { data, error, isLoading, isValidating, mutate } = useSWR(INVENTORY_URL, fetcher, {
        revalidateIfStale: true, // Allow background revalidation on mount
        revalidateOnFocus: true,  // Revalidate when admin switches windows
        revalidateOnReconnect: true,
        dedupingInterval: 60000,  // Reduce deduping window to 1 minute
        keepPreviousData: true,   // Keep showing old data while fetching new
    });

    const refresh = async () => {
        try {
            console.log('[useInventory] Forced refresh initiated. Fetching bypass URL...');
            const forceUrl = INVENTORY_URL + (INVENTORY_URL.includes('?') ? '&' : '?') + 'refresh=true';
            const updated = await fetcher(forceUrl);
            
            // Format and update state directly
            const arr = Array.isArray(updated) ? updated : (Array.isArray(updated?.items) ? updated.items : []);
            const processed = arr.map((item: RawInventoryItem) => {
                const locationStock: Record<string, number> = {};
                const rawShQty = item.sh_qty !== undefined ? Number(item.sh_qty) : (item.shQty !== undefined ? Number(item.shQty) : 0);
                const rawYsQty = item.ready_qty !== undefined ? Number(item.ready_qty) : 0;
                
                if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                    for (const [key, qty] of Object.entries(item.locationStock)) {
                        const newKey = (key === '서울' || key === '서울재고') ? '시화' : key;
                        locationStock[newKey] = (locationStock[newKey] || 0) + Number(qty);
                    }
                }
                
                const isBusan = item.location1 === '부산' || 
                                (item.location1 && String(item.location1).includes('부산')) || 
                                item.location === '부산' || 
                                (item.locationStock && item.locationStock['부산'] !== undefined);

                if (isBusan) {
                    if (locationStock['시화'] > 0 && !locationStock['부산']) {
                        locationStock['부산'] = locationStock['시화'];
                        locationStock['시화'] = 0;
                    }
                }

                if (Object.keys(locationStock).length === 0) {
                    if (isBusan) {
                        if (rawShQty > 0) locationStock['부산'] = rawShQty;
                    } else {
                        if (rawShQty > 0) locationStock['시화'] = rawShQty;
                    }
                    if (rawYsQty > 0) locationStock['양산'] = rawYsQty;
                }

                const currentStock = (locationStock['부산'] || 0) + (locationStock['양산'] || 0) + (locationStock['시화'] || 0);
                let stockStatus = item.stockStatus;
                if (!stockStatus) {
                    stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
                }
                const mappedLocation = (item.location === '서울' || item.location === '서울재고') ? '시화' : item.location;
                const id = (item.sku_key || item.id || '') as string;
                const parsed = parseSku(id);
                const finalSize = parsed.size.replace(/^[A-Z]+-?/, '').trim().toUpperCase().replace(/\s*x\s*/gi, ' X ');

                return {
                    ...item,
                    id,
                    name: item.item || item.name || '',
                    thickness: parsed.thickness || item.thickness || '',
                    size: finalSize || item.size || '',
                    material: parsed.material || item.material || '',
                    location: mappedLocation,
                    unitPrice: item.final_price !== undefined ? item.final_price : item.unitPrice,
                    currentStock,
                    stockStatus,
                    odEqKey: item.od_eq_key || item.odEqKey,
                    locationStock,
                    maker1: item.maker1,
                    shQty: isBusan ? 0 : rawShQty,
                    marking_wait_qty: Number(item.marking_wait_qty) || 0
                } as Product;
            });

            if (processed.length > 0) {
                setInventory(processed);
            }
            
            // Also mutate SWR cache
            await mutate(updated, { revalidate: false });
            console.log('[useInventory] Forced refresh completed successfully.');
        } catch (err) {
            console.warn('[useInventory] Forced refresh failed. Falling back to standard revalidation.', err);
            await mutate();
        }
    };

    // Process and sync data to store
    useEffect(() => {
        if (data) {
            const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

            // Anti-Gravity: Data Adapter for S3 (snake_case) vs Client (camelCase)


            // The live S3 data uses 'item' for name, 'ready_qty' for stock, 'final_price' for price.
            // We map it here to ensure the Product interface is satisfied.
            const processed = arr.map((item: RawInventoryItem) => {
                const locationStock: Record<string, number> = {};
                const rawShQty = item.sh_qty !== undefined ? Number(item.sh_qty) : (item.shQty !== undefined ? Number(item.shQty) : 0);
                const rawYsQty = item.ready_qty !== undefined ? Number(item.ready_qty) : 0;
                
                if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                    for (const [key, qty] of Object.entries(item.locationStock)) {
                        const newKey = (key === '서울' || key === '서울재고') ? '시화' : key;
                        locationStock[newKey] = (locationStock[newKey] || 0) + Number(qty);
                    }
                }
                
                const isBusan = item.location1 === '부산' || 
                                (item.location1 && String(item.location1).includes('부산')) || 
                                item.location === '부산' || 
                                (item.locationStock && item.locationStock['부산'] !== undefined);

                if (isBusan) {
                    if (locationStock['시화'] > 0 && !locationStock['부산']) {
                        locationStock['부산'] = locationStock['시화'];
                        locationStock['시화'] = 0;
                    }
                }

                if (Object.keys(locationStock).length === 0) {
                    if (isBusan) {
                        if (rawShQty > 0) locationStock['부산'] = rawShQty;
                    } else {
                        if (rawShQty > 0) locationStock['시화'] = rawShQty;
                    }
                    if (rawYsQty > 0) locationStock['양산'] = rawYsQty;
                }

                const currentStock = (locationStock['부산'] || 0) + (locationStock['양산'] || 0) + (locationStock['시화'] || 0);

                // Derive status if missing (S3 data lacks stockStatus)
                let stockStatus = item.stockStatus;
                if (!stockStatus) {
                    stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
                }

                // Map main location property as well
                const mappedLocation = (item.location === '서울' || item.location === '서울재고') ? '시화' : item.location;

                const id = (item.sku_key || item.id || '') as string;
                const parsed = parseSku(id);
                const finalSize = parsed.size.replace(/^[A-Z]+-?/, '').trim().toUpperCase().replace(/\s*x\s*/gi, ' X ');

                return {
                    ...item, // Keep original props
                    id: id,
                    name: item.item || item.name || '',
                    thickness: parsed.thickness || item.thickness || '',
                    size: finalSize || item.size || '',
                    material: parsed.material || item.material || '',
                    location: mappedLocation,
                    unitPrice: item.final_price !== undefined ? item.final_price : item.unitPrice,
                    currentStock: currentStock,
                    stockStatus: stockStatus,

                    odEqKey: item.od_eq_key || item.odEqKey,
                    locationStock: locationStock, // Assign constructed map

                    // User Request: Capture maker1 for conditional display
                    maker1: item.maker1,
                    shQty: isBusan ? 0 : rawShQty,
                    marking_wait_qty: Number(item.marking_wait_qty) || 0
                } as Product;
            });

            // Anti-Gravity: Read-only State Pattern
            // Only update store if:
            // 1. Data is not empty (normal case)
            // 2. OR Data is explicitly empty and we are sure (rare, usually we want to keep cached data if fetch fails/returns garbage)
            // If API returns [], it might be a glitch. We prefer showing old data over nothing.
            if (processed.length > 0) {
                setInventory(processed);
            } else {
                console.warn('[useInventory] Fetched data is empty. Keeping logic: Read-only State (not clearing store).');
                // Optional: If you really want to clear, Logic would be needed. 
                // But user requested "Read-only State" and "Stop destroying data".
            }
        }
    }, [data, setInventory]);

    return {
        inventory: data ? useStore.getState().inventory : existingInventory, // Prefer processed store data
        lastModified: data?.lastModified || null,
        isLoading,
        isValidating,
        error: error ? String(error) : null,
        refresh
    };
}

