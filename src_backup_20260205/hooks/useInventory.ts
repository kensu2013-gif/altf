import useSWR from 'swr';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';
import type { Product } from '../types';

const INVENTORY_URL = '/api/inventory/inventory.json';

interface RawInventoryItem {
    // S3 snake_case keys
    sku_key?: string;
    item?: string;
    ready_qty?: number | string;
    final_price?: number;
    marking_wait_qty?: number;
    od_eq_key?: string;
    location1?: string;
    sh_qty?: number | string;

    // Client camelCase keys (fallbacks)
    id?: string;
    name?: string;
    currentStock?: number | string;
    unitPrice?: number;
    markingWaitQty?: number;
    odEqKey?: string;
    stockStatus?: string;
    locationStock?: Record<string, number>;

    // Common/Pass-through fields
    thickness?: string;
    size?: string;
    material?: string;
    location?: string;
    maker?: string;

    [key: string]: unknown; // Allow other properties to pass through
}

// Fetcher function
const fetcher = (url: string) => fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
});

export function useInventory() {
    const setInventory = useStore((state) => state.setInventory);
    const existingInventory = useStore((state) => state.inventory);

    const { data, error, isLoading, isValidating } = useSWR(INVENTORY_URL, fetcher, {
        revalidateIfStale: true,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 60000, // 1 minute
        keepPreviousData: true, // Keep showing old data while fetching new
    });

    // Process and sync data to store
    useEffect(() => {
        if (data) {
            const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

            // Anti-Gravity: Data Adapter for S3 (snake_case) vs Client (camelCase)
            console.log('[useInventory] Raw Data from S3:', data);

            // The live S3 data uses 'item' for name, 'ready_qty' for stock, 'final_price' for price.
            // We map it here to ensure the Product interface is satisfied.
            const processed = arr.map((item: RawInventoryItem) => {
                // 1. Calculate Location Stock Map
                const locationStock: Record<string, number> = {};

                // Primary Location (location / ready_qty)
                if (item.location && item.ready_qty) {
                    locationStock[item.location] = Number(item.ready_qty);
                }

                // Secondary Location (location1 / sh_qty)
                if (item.location1 && item.sh_qty) {
                    // Logic: If location names are same, add qty. If different, set new key.
                    // Usually they are different (Yangsan vs Sihwa)
                    const loc1 = item.location1;
                    const qty1 = Number(item.sh_qty);
                    locationStock[loc1] = (locationStock[loc1] || 0) + qty1;
                }

                // Calculate Total Stock from components
                // If user provided raw currentStock, we might fallback, but here we prefer calculated total.
                let totalStock = 0;
                if (Object.keys(locationStock).length > 0) {
                    totalStock = Object.values(locationStock).reduce((sum, q) => sum + q, 0);
                } else {
                    // Fallback to ready_qty or currentStock if no location breakdown found
                    totalStock = item.ready_qty !== undefined ? Number(item.ready_qty) : (Number(item.currentStock) || 0);
                }

                const currentStock = totalStock;

                // Derive status if missing (S3 data lacks stockStatus)
                let stockStatus = item.stockStatus;
                if (!stockStatus) {
                    stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
                }

                return {
                    ...item, // Keep original props
                    id: item.sku_key || item.id, // S3 uses sku_key
                    name: item.item || item.name, // S3 uses item
                    // thickness, size, material, location, maker usually match keys
                    unitPrice: item.final_price !== undefined ? item.final_price : item.unitPrice,
                    currentStock: currentStock,
                    stockStatus: stockStatus,
                    markingWaitQty: item.marking_wait_qty || item.markingWaitQty,
                    odEqKey: item.od_eq_key || item.odEqKey,
                    locationStock: locationStock // Assign constructed map
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
        isLoading,
        isValidating,
        error: error ? String(error) : null
    };
}
