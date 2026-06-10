import { useMemo, useCallback } from 'react';
import type { Product, LineItem } from '../types';
import { generateSku } from '../lib/sku';

export function useInventoryIndex(inventory: Product[]) {
    // 1. Build Indexes (O(N) - runs only when inventory changes)
    const { idMap, specMap } = useMemo(() => {
        const iMap = new Map<string, Product>();
        const sMap = new Map<string, Product>();

        const normalize = (val: string | number | undefined) => String(val || '').replace(/\s+/g, '').toUpperCase();

        inventory.forEach(p => {
            // Index by ID
            iMap.set(p.id, p);
            iMap.set(normalize(p.id), p); // Normalized ID for robust matching

            // Index by Spec (Name + Thickness + Size + Material)
            // Key format: NAME|THICK|SIZE|MAT
            const specKey = `${normalize(p.name)}|${normalize(p.thickness)}|${normalize(p.size)}|${normalize(p.material)}`;
            sMap.set(specKey, p);
        });

        return { idMap: iMap, specMap: sMap };
    }, [inventory]);

    // 2. Lookup Function (O(1))
    const findProduct = useCallback((item: LineItem | { name?: string; thickness?: string; size?: string; material?: string; productId?: string | null }): Product | null => {
        const normalize = (val: string | number | undefined) => String(val || '').replace(/\s+/g, '').toUpperCase();

        // Priority 1: Direct ID Match (Fastest)
        if ('productId' in item && item.productId) {
            const byId = idMap.get(item.productId) || idMap.get(normalize(item.productId));
            if (byId) return byId;
        }

        // Priority 2: Generated SKU Match (Matches original AdminQuoteDetail logic)
        try {
            // Use generateSku to see if we can find a product by its constructed ID
            // This mimics: const candidateId = generateSku(item); inventory.find(p => p.id === candidateId);
            const candidateId = generateSku(item);
            if (candidateId) {
                const byId = idMap.get(candidateId) || idMap.get(normalize(candidateId));
                if (byId) return byId;
            }
        } catch (e) {
            // Ignore if item doesn't support SKU generation
        }

        // Priority 3: Robust Spec Property Match
        const specKey = `${normalize(item.name)}|${normalize(item.thickness)}|${normalize(item.size)}|${normalize(item.material)}`;
        const bySpec = specMap.get(specKey);
        if (bySpec) return bySpec;

        return null;
    }, [idMap, specMap]);

    return { findProduct };
}
