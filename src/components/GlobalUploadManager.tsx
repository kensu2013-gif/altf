import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Product } from '../types';
import { useInventory } from '../hooks/useInventory';
import { parseSku } from '../lib/sku';

interface ImportedItem {
    item_id: string;
    unit_price?: number | string;
    price?: number | string;
    qty?: number;
}

// Reusing Logic from Search.tsx, but adapted for global store.
// To avoid huge duplication, we should ideally refactor logic to a utility, but for now we'll implement the poller here.

export function GlobalUploadManager() {
    const { uploadState, setUploadStatus, updateProcessedCount, inventory: storeInventory, addItem } = useStore();
    const { status, sessionId, processedCount } = uploadState;
    const { inventory } = useInventory(); // Ensure inventory is loaded/fresh

    // We need a stable reference to inventory for the interval closure
    const inventoryRef = useRef<Product[]>([]);
    useEffect(() => { inventoryRef.current = inventory || storeInventory || []; }, [inventory, storeInventory]);

    useEffect(() => {
        if (status !== 'PROCESSING' || !sessionId) return;



        const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
        const COMPLETION_SILENCE_MS = 5000; // 5 seconds

        let lastActivity = Date.now();
        let lastItemTime: number | null = null;
        let localProcessedCount = processedCount; // Use local var for accurate interval tracking

        const interval = setInterval(async () => {
            const now = Date.now();

            // 1. Success by Silence logic
            if (localProcessedCount > 0 && lastItemTime && (now - lastItemTime >= COMPLETION_SILENCE_MS)) {
                clearInterval(interval);
                setUploadStatus('DONE');

                return;
            }

            // 2. Timeout
            if (now - lastActivity > TIMEOUT_MS) {
                clearInterval(interval);
                alert('분석시간이 초과되었습니다.');
                setUploadStatus('IDLE');
                return;
            }

            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/quote/session/${sessionId}`);
                if (res.ok) {
                    const data = await res.json();

                    if (data.items && Array.isArray(data.items)) {
                        const totalItems = data.items;

                        if (totalItems.length > localProcessedCount) {
                            const newItems = totalItems.slice(localProcessedCount);


                            // Process Items Global Logic
                            newItems.forEach((importedItem: ImportedItem) => {
                                const currentInventory = inventoryRef.current;
                                let product = currentInventory.find(p => p.id === importedItem.item_id);

                                // Retry with Swapped Dimensions (Copy of Search.tsx Logic)
                                if (!product && (importedItem.item_id.match(/[\d\w"]+\s*[Xx*]\s*[\d\w"]+/) || importedItem.item_id.includes(' X '))) {
                                    try {
                                        const swapRegex = /([\w\d."]+)\s*[Xx*]\s*([\w\d."]+)/;
                                        const match = importedItem.item_id.match(swapRegex);
                                        if (match) {
                                            const [full, partA, partB] = match;
                                            const swappedSize = `${partB} X ${partA}`;
                                            const swappedId = importedItem.item_id.replace(full, swappedSize);
                                            product = currentInventory.find(p => p.id === swappedId);
                                        }
                                    } catch (error) {
                                        console.warn('Dimension swap failed:', error);
                                    }
                                }

                                if (product) {
                                    const aiPrice = Number(importedItem.unit_price || importedItem.price || 0);
                                    const finalPrice = aiPrice > 0 ? aiPrice : product.unitPrice;

                                    const lineItem = {
                                        id: crypto.randomUUID(),
                                        productId: product.id,
                                        name: product.name,
                                        thickness: product.thickness,
                                        size: product.size,
                                        material: product.material,
                                        quantity: importedItem.qty || 1,
                                        unitPrice: finalPrice,
                                        amount: finalPrice * (importedItem.qty || 1),
                                        isVerified: true,
                                        stockStatus: product.stockStatus,
                                        location: product.location,
                                        maker: product.maker,
                                        currentStock: product.currentStock,

                                    };
                                    // Use store's addItem
                                    addItem(lineItem);
                                } else {
                                    // Fallback Parsing Logic (Simplified for brevity, or need to copy FULL logic)
                                    // For now, let's use a simplified parser or copy the one from Search.tsx? 
                                    // Ideally we should move logic to `lib/productUtils.ts`.
                                    // I'll assume users want robust logic. I will implement a robust parser here briefly.

                                    // Let's use the standardized parseSku utility to make it robust.
                                    let pName = importedItem.item_id;
                                    let pThickness = '-', pSize = '-', pMaterial = '-';
                                    try {
                                        const parsed = parseSku(importedItem.item_id.trim());
                                        pName = parsed.name || importedItem.item_id;
                                        pThickness = parsed.thickness || '-';
                                        pSize = parsed.size ? parsed.size.trim().toUpperCase().replace(/\s*x\s*/gi, ' X ') : '-';
                                        pMaterial = parsed.material || '-';
                                    } catch {
                                        // Ignore parsing failures; use default values
                                    }

                                    // Attribute Match Logic
                                    // ...

                                    addItem({
                                        id: crypto.randomUUID(),
                                        productId: null,
                                        name: pName,
                                        thickness: pThickness,
                                        size: pSize,
                                        material: pMaterial,
                                        quantity: importedItem.qty || 1,
                                        unitPrice: 0,
                                        amount: 0,
                                        isVerified: false,
                                        stockStatus: 'OUT_OF_STOCK'
                                    });
                                }
                            });

                            localProcessedCount = totalItems.length;
                            updateProcessedCount(localProcessedCount);
                            lastActivity = Date.now();
                            lastItemTime = Date.now();
                        }

                        if (data.status === 'done' && localProcessedCount > 0) {
                            clearInterval(interval);
                            setUploadStatus('DONE');
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [status, sessionId, processedCount, setUploadStatus, updateProcessedCount, addItem]); // Only re-run if status/session/count changes.

    return null; // Logic only
}
