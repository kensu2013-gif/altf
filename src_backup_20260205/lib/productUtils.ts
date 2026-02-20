// System Constants
// System Constants
export type StandardSystem = 'KS' | 'ANSI';

export const STANDARD_SYSTEMS = {
    KS: { label: 'KS/JIS(A)', value: 'KS' as StandardSystem },
    ANSI: { label: 'ANSI(INCH)', value: 'ANSI' as StandardSystem }
};

export const MAIN_MATERIALS = ['STS304', 'STS316L']; // Default visible
export const ALL_MATERIALS = [
    'STS304-W', 'STS304-S',
    'STS316L-W', 'STS316L-S',
    'WP304-W', 'WP304-S',
    'WP304L-W', 'WP304L-S',
    'WP316L-W', 'WP316L-S'
];

/**
 * Validates if the size format matches the selected system.
 * ANSI -> Inch (contains " or ")
 * KS/DIN -> A unit (contains A)
 */
export function isValidSizeForSystem(size: string, system: StandardSystem): boolean {
    if (system === 'ANSI') {
        return size.includes('"');
    }
    if (system === 'KS') {
        return size.includes('A') && !size.includes('"');
    }
    return true;
}

/**
 * Returns available material options for a given product name AND system.
 * ANSI -> WP only
 * KS -> STS only
 */
export function getValidMaterialsForSystem(productName: string, system: StandardSystem): string[] {
    let materials = ALL_MATERIALS;

    // Filter by System
    if (system === 'ANSI') {
        materials = materials.filter(m => m.startsWith('WP'));
    } else {
        materials = materials.filter(m => m.startsWith('STS'));
    }

    // Special logic: CAP forces -S, hides -W.
    if (productName === 'CAP') {
        return materials.filter(m => m.endsWith('-S'));
    }

    return materials;
}

/**
 * Formats a size string based on material type.
 * STS -> A unit (e.g., 50A, 300A X 200A)
 * WP -> Inch unit (e.g., 4", 24" X 20")
 */
export function formatSize(rawSize: string): string {
    // Simple heuristic: if it contains A, it's A unit. If it contains ", it's Inch.
    // Ideally we would parse and re-format, but assuming input data might need cleanup:

    // For the purpose of strict ID generation:
    let formatted = rawSize.trim().toUpperCase();

    // Fix separator spacing (normalize x/X to " X ")
    formatted = formatted.replace(/\s*x\s*/gi, ' X ');

    return formatted;
}

/**
 * Generates the strict Product ID.
 * Format: "{Name}-{Thickness}-{Size}-{Material}"
 */
export function formatProductId(name: string, thickness: string, size: string, material: string): string {
    const safeName = name.trim();
    const safeThickness = thickness.trim();
    const strictSize = formatSize(size).trim();
    const safeMaterial = material.trim();

    return `${safeName}-${safeThickness}-${strictSize}-${safeMaterial}`;
}

/**
 * Normalizes thickness string to strict format.
 * S/10S -> S10S
 * SCH40 -> S40S
 */
export function formatThickness(rawThickness: string): string {
    const t = rawThickness.trim().toUpperCase();

    // Strict conversions
    if (t === 'S/10S' || t === 'SCH10S' || t === 'SCH10') return 'S10S';
    if (t === 'S/20S' || t === 'SCH20S' || t === 'SCH20') return 'S20S';
    if (t === 'S/40S' || t === 'SCH40S' || t === 'SCH40' || t === 'STD') return 'S40S';
    if (t === 'S/80S' || t === 'SCH80S' || t === 'SCH80' || t === 'XS') return 'S80S';
    if (t === 'S/160' || t === 'SCH160') return 'S160';
    if (t === 'XX-S') return 'XX-S'; // Keep special

    return t;
}

/**
 * Parses a size string to a comparable numeric value.
 * e.g. "100A" -> 100
 * e.g. "1/2"" -> 0.5
 */
function parseSizeValue(s: string): number {
    const clean = s.trim().toUpperCase().replace(/["A]/g, '');
    if (clean.includes('/')) {
        const [num, den] = clean.split('/').map(Number);
        return den ? num / den : 0;
    }
    return Number(clean) || 99999; // Fallback to end
}

/**
 * Sorts a list of size strings numerically.
 * Rules:
 * 1. Primary size (ASC)
 * 2. Single size before Dual size (if Primary is same)
 *    e.g. 40A < 40A X 25A
 * 3. Secondary size (ASC)
 */
export function sortSizes(sizes: string[]): string[] {
    return [...sizes].sort((a, b) => {
        // Split dual sizes (e.g. "100A X 50A")
        const partsA = a.split(/[\sX]+/).filter(Boolean);
        const partsB = b.split(/[\sX]+/).filter(Boolean);

        const valA1 = parseSizeValue(partsA[0] || '');
        const valB1 = parseSizeValue(partsB[0] || '');

        // 1. Compare Primary Size
        if (valA1 !== valB1) {
            return valA1 - valB1;
        }

        // 2. Compare number of parts (Single vs Dual)
        // We want Single (fewer parts) BEFORE Dual (more parts)
        // e.g. "100A" (1 part) < "100A X 50A" (2 parts)
        if (partsA.length !== partsB.length) {
            return partsA.length - partsB.length;
        }

        // 3. Compare Secondary Size (if both are dual)
        const valA2 = parseSizeValue(partsA[1] || '');
        const valB2 = parseSizeValue(partsB[1] || '');
        return valA2 - valB2;
    });
}


