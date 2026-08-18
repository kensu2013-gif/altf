import type { LineItem, Product } from '../types';
import { formatProductId, findMatchingProduct } from '../lib/productUtils';

// JIS (A) -> ANSI (Inch) Mapping Table
export const A_TO_INCH_MAP: Record<string, string> = {
    '8A': '1/4"',
    '10A': '3/8"',
    '15A': '1/2"',
    '20A': '3/4"',
    '25A': '1"',
    '32A': '1-1/4"',
    '40A': '1-1/2"',
    '50A': '2"',
    '65A': '2-1/2"',
    '80A': '3"',
    '90A': '3-1/2"',
    '100A': '4"',
    '125A': '5"',
    '150A': '6"',
    '200A': '8"',
    '250A': '10"',
    '300A': '12"',
    '350A': '14"',
    '400A': '16"',
    '450A': '18"',
    '500A': '20"',
    '550A': '22"',
    '600A': '24"',
    '650A': '26"',
    '700A': '28"',
    '750A': '30"',
    '800A': '32"',
    '900A': '36"',
    '1000A': '40"'
};

// ANSI (Inch) -> JIS (A) Mapping Table
export const INCH_TO_A_MAP: Record<string, string> = {
    '1/4"': '8A', '1/4': '8A',
    '3/8"': '10A', '3/8': '10A',
    '1/2"': '15A', '1/2': '15A',
    '3/4"': '20A', '3/4': '20A',
    '1"': '25A', '1': '25A',
    '1-1/4"': '32A', '1-1/4': '32A', '1.1/4"': '32A', '1 1/4"': '32A', '1.1/4': '32A', '1 1/4': '32A',
    '1-1/2"': '40A', '1-1/2': '40A', '1.1/2"': '40A', '1 1/2"': '40A', '1.1/2': '40A', '1 1/2': '40A',
    '2"': '50A', '2': '50A',
    '2-1/2"': '65A', '2-1/2': '65A', '2.1/2"': '65A', '2 1/2"': '65A', '2.1/2': '65A', '2 1/2': '65A',
    '3"': '80A', '3': '80A',
    '3-1/2"': '90A', '3-1/2': '90A',
    '4"': '100A', '4': '100A',
    '5"': '125A', '5': '125A',
    '6"': '150A', '6': '150A',
    '8"': '200A', '8': '200A',
    '10"': '250A', '10': '250A',
    '12"': '300A', '12': '300A',
    '14"': '350A', '14': '350A',
    '16"': '400A', '16': '400A',
    '18"': '450A', '18': '450A',
    '20"': '500A', '20': '500A',
    '22"': '550A', '22': '550A',
    '24"': '600A', '24': '600A',
    '26"': '650A', '26': '650A',
    '28"': '700A', '28': '700A',
    '30"': '750A', '30': '750A',
    '32"': '800A', '32': '800A',
    '36"': '900A', '36': '900A',
    '40"': '1000A', '40': '1000A'
};

/**
 * Checks whether a given size string is in JIS (A) format.
 */
export function isJisSize(size: string): boolean {
    if (!size) return false;
    return size.toUpperCase().includes('A') && !size.includes('"');
}

/**
 * Converts a single size term (e.g., "40A" -> "1-1/2"", "2"" -> "50A").
 */
export function convertSingleSize(sizePart: string, targetSystem?: 'ANSI' | 'JIS'): string {
    const trimmed = sizePart.trim();
    if (!trimmed) return trimmed;

    const upper = trimmed.toUpperCase();

    if (targetSystem === 'ANSI') {
        return A_TO_INCH_MAP[upper] || trimmed;
    } else if (targetSystem === 'JIS') {
        return INCH_TO_A_MAP[upper] || INCH_TO_A_MAP[trimmed] || trimmed;
    }

    // Toggle mode based on current format
    if (isJisSize(trimmed)) {
        return A_TO_INCH_MAP[upper] || trimmed;
    } else {
        return INCH_TO_A_MAP[upper] || INCH_TO_A_MAP[trimmed] || trimmed;
    }
}

/**
 * Converts a size string (supports single and dual sizes e.g., "50A X 40A" <-> "2" X 1-1/2"").
 */
export function convertSize(rawSize: string, targetSystem?: 'ANSI' | 'JIS'): string {
    if (!rawSize) return rawSize;

    // Split dual sizes by "X" or "x" with optional spaces
    const parts = rawSize.split(/\s*[Xx]\s*/);
    
    // Determine target system for the whole string if not specified
    const determinedSystem = targetSystem || (parts.some(p => isJisSize(p)) ? 'ANSI' : 'JIS');

    const convertedParts = parts.map(part => convertSingleSize(part, determinedSystem));
    return convertedParts.join(' X ');
}

/**
 * Converts material string between JIS (STS...) and ANSI (WP...).
 * e.g., "STS316L-W" <-> "WP316L-W", "STS304" <-> "WP304"
 */
export function convertMaterial(rawMaterial: string, targetSystem?: 'ANSI' | 'JIS'): string {
    if (!rawMaterial) return rawMaterial;

    const trimmed = rawMaterial.trim();
    const upper = trimmed.toUpperCase();

    if (targetSystem === 'ANSI' || (!targetSystem && upper.startsWith('STS'))) {
        // Convert STS to WP
        if (upper.startsWith('STS')) {
            return 'WP' + trimmed.slice(3);
        }
        return trimmed;
    } else if (targetSystem === 'JIS' || (!targetSystem && upper.startsWith('WP'))) {
        // Convert WP to STS
        if (upper.startsWith('WP')) {
            return 'STS' + trimmed.slice(2);
        }
        return trimmed;
    }

    return trimmed;
}

/**
 * Converts a LineItem's size, material, and product ID between ANSI and JIS systems.
 * If inventoryList is provided, re-matches item against inventory to update stock, status, location, maker, etc.
 */
export function convertLineItemStandard<T extends LineItem>(
    item: T,
    targetSystem?: 'ANSI' | 'JIS',
    inventoryList?: Product[]
): T {
    // Determine system based on size and material if not provided
    const isCurrentJis = isJisSize(item.size) || item.material.toUpperCase().startsWith('STS');
    const systemToUse = targetSystem || (isCurrentJis ? 'ANSI' : 'JIS');

    const newSize = convertSize(item.size, systemToUse);
    const newMaterial = convertMaterial(item.material, systemToUse);

    const newProductId = formatProductId(
        item.name || '',
        item.thickness || '',
        newSize,
        newMaterial
    );

    const updatedItem: T = {
        ...item,
        size: newSize,
        material: newMaterial,
        productId: newProductId,
        itemId: newProductId
    };

    if (inventoryList && inventoryList.length > 0) {
        const match = findMatchingProduct(updatedItem, inventoryList);
        if (match) {
            updatedItem.productId = match.id;
            updatedItem.currentStock = match.currentStock;
            updatedItem.stockStatus = match.stockStatus;
            updatedItem.location = match.location;
            updatedItem.maker = match.maker;
            updatedItem.locationStock = match.locationStock;
            updatedItem.marking_wait_qty = match.marking_wait_qty || 0;
            if (match.base_price || match.unitPrice) {
                updatedItem.base_price = match.base_price ?? match.unitPrice;
            }
        } else {
            updatedItem.productId = null;
            updatedItem.currentStock = undefined;
            updatedItem.stockStatus = undefined;
            updatedItem.location = undefined;
            updatedItem.maker = undefined;
            updatedItem.locationStock = undefined;
            updatedItem.marking_wait_qty = 0;
        }
    }

    return updatedItem;
}
