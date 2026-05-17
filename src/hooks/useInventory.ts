import useSWR from 'swr';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';
import type { Product } from '../types';

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
        revalidateIfStale: false, // Don't revalidate if we have data (unless expired)
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 300000, // 5 minutes (Increased from 1 min)
        keepPreviousData: true, // Keep showing old data while fetching new
    });

    // Process and sync data to store
    useEffect(() => {
        if (data) {
            const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

            // Anti-Gravity: Data Adapter for S3 (snake_case) vs Client (camelCase)


            // The live S3 data uses 'item' for name, 'ready_qty' for stock, 'final_price' for price.
            // We map it here to ensure the Product interface is satisfied.
            const processed = arr.map((item: RawInventoryItem) => {
                // 1. Calculate Location Stock Map
                // 1. Calculate Location Stock Map
                // Anti-Gravity: Prefer server-provided locationStock if available, mapped '서울' -> '시화'
                const locationStock: Record<string, number> = {};

                if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                    for (const [key, qty] of Object.entries(item.locationStock)) {
                        const newKey = (key === '서울' || key === '서울재고') ? '시화' : key;
                        locationStock[newKey] = (locationStock[newKey] || 0) + Number(qty);
                    }
                } else {
                    // 1. Process Secondary Location (Sihwa)
                    if (item.location1 && item.sh_qty) {
                        const loc1 = (item.location1 === '서울' || item.location1 === '서울재고') ? '시화' : item.location1;
                        locationStock[loc1] = Number(item.sh_qty);
                    }

                    // 2. Process Primary Location (Daekyung/Yangsan)
                    if (item.location && item.ready_qty) {
                        const primaryLoc = (item.location === '서울' || item.location === '서울재고') ? '시화' : item.location;
                        locationStock[primaryLoc] = Number(item.ready_qty);
                    }
                }

                // The user explicitly stated: "Do not do other operations on inventory.json"
                // "90e(l)-s10s-100a-sts304-w MUST be 8165. Other numbers should not appear (5536 is wrong)."
                // Therefore, currentStock is exactly ready_qty.
                const currentStock = item.ready_qty !== undefined ? Number(item.ready_qty) : (Number(item.currentStock) || 0);

                // Derive status if missing (S3 data lacks stockStatus)
                let stockStatus = item.stockStatus;
                if (!stockStatus) {
                    stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
                }

                // Map main location property as well
                const mappedLocation = (item.location === '서울' || item.location === '서울재고') ? '시화' : item.location;

                return {
                    ...item, // Keep original props
                    id: item.sku_key || item.id, // S3 uses sku_key
                    name: item.item || item.name, // S3 uses item
                    // thickness, size, material, location, maker usually match keys
                    location: mappedLocation,
                    unitPrice: item.final_price !== undefined ? item.final_price : item.unitPrice,
                    currentStock: currentStock,
                    stockStatus: stockStatus,

                    odEqKey: item.od_eq_key || item.odEqKey,
                    locationStock: locationStock, // Assign constructed map

                    // User Request: Capture maker1 for conditional display
                    maker1: item.maker1,
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
        refresh: mutate
    };
}

