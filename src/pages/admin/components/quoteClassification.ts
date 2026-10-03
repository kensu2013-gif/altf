import type { LineItem } from '../../../types';

export type MaterialGroupKey = 
    | '304-W' 
    | '304-S' 
    | '304L-W' 
    | '304L-S' 
    | '316L-W' 
    | '316L-S' 
    | 'SPG' 
    | 'CAP-SPECIAL' 
    | 'ZERO-RATE' 
    | 'OTHER';

export type ColorThemeKey = 'blue' | 'emerald' | 'rose' | 'purple' | 'amber' | 'slate' | 'cyan';

export interface ColorThemeDefinition {
    key: ColorThemeKey;
    label: string;
    swatchHex: string;
    textClass: string;
    textBoldClass: string;
    badgeClass: string;
    cardBorderClass: string;
    headerBgClass: string;
    bgLight: string;
    borderClass: string;
}

export const COLOR_THEME_MAP: Record<ColorThemeKey, ColorThemeDefinition> = {
    blue: {
        key: 'blue',
        label: '파랑',
        swatchHex: '#2563eb',
        textClass: 'text-blue-700',
        textBoldClass: 'text-blue-800 font-extrabold',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-300 font-bold',
        cardBorderClass: 'border-blue-200 hover:border-blue-400 bg-gradient-to-b from-blue-50/20 to-white',
        headerBgClass: 'bg-blue-50/70 border-blue-100',
        bgLight: 'bg-blue-50/40',
        borderClass: 'border-blue-300'
    },
    emerald: {
        key: 'emerald',
        label: '녹색',
        swatchHex: '#059669',
        textClass: 'text-emerald-700',
        textBoldClass: 'text-emerald-800 font-extrabold',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 font-bold',
        cardBorderClass: 'border-emerald-200 hover:border-emerald-400 bg-gradient-to-b from-emerald-50/20 to-white',
        headerBgClass: 'bg-emerald-50/70 border-emerald-100',
        bgLight: 'bg-emerald-50/40',
        borderClass: 'border-emerald-300'
    },
    rose: {
        key: 'rose',
        label: '빨강',
        swatchHex: '#e11d48',
        textClass: 'text-rose-700',
        textBoldClass: 'text-rose-800 font-extrabold',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-300 font-bold',
        cardBorderClass: 'border-rose-200 hover:border-rose-400 bg-gradient-to-b from-rose-50/20 to-white',
        headerBgClass: 'bg-rose-50/70 border-rose-100',
        bgLight: 'bg-rose-50/40',
        borderClass: 'border-rose-300'
    },
    purple: {
        key: 'purple',
        label: '보라',
        swatchHex: '#9333ea',
        textClass: 'text-purple-700',
        textBoldClass: 'text-purple-800 font-extrabold',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-300 font-bold',
        cardBorderClass: 'border-purple-200 hover:border-purple-400 bg-gradient-to-b from-purple-50/20 to-white',
        headerBgClass: 'bg-purple-50/70 border-purple-100',
        bgLight: 'bg-purple-50/40',
        borderClass: 'border-purple-300'
    },
    amber: {
        key: 'amber',
        label: '주황',
        swatchHex: '#d97706',
        textClass: 'text-amber-800',
        textBoldClass: 'text-amber-900 font-extrabold',
        badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
        cardBorderClass: 'border-amber-300 hover:border-amber-400 bg-gradient-to-b from-amber-50/20 to-white',
        headerBgClass: 'bg-amber-100/70 border-amber-200',
        bgLight: 'bg-amber-50/40',
        borderClass: 'border-amber-300'
    },
    slate: {
        key: 'slate',
        label: '회색',
        swatchHex: '#64748b',
        textClass: 'text-slate-700',
        textBoldClass: 'text-slate-800 font-extrabold',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 font-bold',
        cardBorderClass: 'border-slate-300 hover:border-slate-400 bg-gradient-to-b from-slate-50/30 to-white',
        headerBgClass: 'bg-slate-100/80 border-slate-200',
        bgLight: 'bg-slate-100/50',
        borderClass: 'border-slate-300'
    },
    cyan: {
        key: 'cyan',
        label: '청록',
        swatchHex: '#0891b2',
        textClass: 'text-cyan-700',
        textBoldClass: 'text-cyan-800 font-extrabold',
        badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-300 font-bold',
        cardBorderClass: 'border-cyan-200 hover:border-cyan-400 bg-gradient-to-b from-cyan-50/20 to-white',
        headerBgClass: 'bg-cyan-50/70 border-cyan-100',
        bgLight: 'bg-cyan-50/40',
        borderClass: 'border-cyan-300'
    }
};

// A (mm) to Inch Mapping Table
export const A_TO_INCH_DICT: Record<number, string> = {
    6: '1/8"',
    8: '1/4"',
    10: '3/8"',
    15: '1/2"',
    20: '3/4"',
    25: '1"',
    32: '1-1/4"',
    40: '1-1/2"',
    50: '2"',
    65: '2-1/2"',
    80: '3"',
    90: '3-1/2"',
    100: '4"',
    125: '5"',
    150: '6"',
    200: '8"',
    250: '10"',
    300: '12"',
    350: '14"',
    400: '16"',
    450: '18"',
    500: '20"',
    600: '24"'
};

export function formatSizeLabel(sizeA: number, displayMode: 'both' | 'A' | 'inch' = 'both'): string {
    const inchStr = A_TO_INCH_DICT[sizeA];
    if (displayMode === 'A' || !inchStr) {
        return `${sizeA}A`;
    }
    if (displayMode === 'inch') {
        return inchStr;
    }
    // both: e.g. "50A (2")"
    return `${sizeA}A (${inchStr})`;
}

export function detectItemStandard(item: LineItem): 'ANSI' | 'JIS' {
    const raw = item as Partial<LineItem> & {
        item_size?: string;
        spec?: string;
    };
    const sizeStr = (item.size || raw.spec || raw.item_size || '').trim();

    // 1. 사이즈 단위가 " (인치 기호)로 끝나는지 확인 -> ANSI
    if (sizeStr.endsWith('"') || sizeStr.endsWith('”') || sizeStr.endsWith('″')) {
        return 'ANSI';
    }

    // 2. 사이즈 단위가 A 또는 a 로 끝나는지 확인 -> JIS
    if (sizeStr.toLowerCase().endsWith('a')) {
        return 'JIS';
    }

    // 3. 끝자리가 모호한 경우 보조 fallback (포함 여부 확인)
    if (sizeStr.includes('"') || sizeStr.includes('”') || sizeStr.includes('″')) {
        return 'ANSI';
    }
    if (/[0-9]a\b/i.test(sizeStr) || sizeStr.toLowerCase().includes('a')) {
        return 'JIS';
    }

    return 'JIS';
}

export interface ItemClassification {
    materialGroup: MaterialGroupKey;
    isCap: boolean;
    sizeA: number;
    sizeCategory: 'le' | 'gt' | 'unknown'; // le: <= splitSize, gt: > splitSize
    isZeroRate: boolean;
    splitSizeUsed: number;
    standard: 'ANSI' | 'JIS';
}

export interface UserRateConfig {
    useSizeSplit: boolean; // 기준 구경 분기 사용 여부 (true: 소/대구경 분기, false: 분기 없이 재질별 일괄)
    splitSizeA: number; // 사용자가 직접 설정하는 기준 구경 (기본 100A / 4")
    sizeUnitDisplay: 'both' | 'A' | 'inch'; // 구경 표기 모드: both: 50A(2"), A: 50A, inch: 2"
    seamlessRedHighlight: boolean; // -S 심리스 글자 강조 여부
    seamlessColor: ColorThemeKey; // -S 심리스 글자 강조 색상 (기본: rose)
    theme: {
        '304': ColorThemeKey;
        '304L': ColorThemeKey;
        '316': ColorThemeKey;
        'SPG': ColorThemeKey;
    };
}

export const DEFAULT_USER_RATE_CONFIG: UserRateConfig = {
    useSizeSplit: true,
    splitSizeA: 100,
    sizeUnitDisplay: 'both',
    seamlessRedHighlight: true,
    seamlessColor: 'rose',
    theme: {
        '304': 'blue',
        '304L': 'emerald',
        '316': 'rose',
        'SPG': 'slate'
    }
};

const STORAGE_KEY = 'altf_quote_rate_user_config_v4';

let cachedUserRateConfig: UserRateConfig | null = null;

export function loadUserRateConfig(): UserRateConfig {
    if (cachedUserRateConfig) {
        return cachedUserRateConfig;
    }
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            const loaded: UserRateConfig = {
                ...DEFAULT_USER_RATE_CONFIG,
                ...parsed,
                theme: {
                    ...DEFAULT_USER_RATE_CONFIG.theme,
                    ...(parsed.theme || {})
                }
            };
            cachedUserRateConfig = loaded;
            return loaded;
        }
    } catch {
        // Fallback to default
    }
    const fallback: UserRateConfig = { ...DEFAULT_USER_RATE_CONFIG };
    cachedUserRateConfig = fallback;
    return fallback;
}

export function saveUserRateConfig(config: UserRateConfig): void {
    cachedUserRateConfig = { ...config };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
        // Ignore storage write errors
    }
}

// Helper: Primary A size extraction from string spec/size
export function parseASize(sizeStr: string): number {
    if (!sizeStr) return 0;
    const clean = sizeStr.toUpperCase().trim();
    
    // Check for direct A (e.g. 100A, 50A, 15A)
    const matchA = clean.match(/(\d+)\s*A/);
    if (matchA) {
        return parseInt(matchA[1], 10);
    }

    // Inch mapping dictionary
    const inchToAMap: { [key: string]: number } = {
        '1/8': 6,
        '1/4': 8,
        '3/8': 10,
        '1/2': 15,
        '3/4': 20,
        '1': 25,
        '1 1/4': 32,
        '1-1/4': 32,
        '1 1/2': 40,
        '1-1/2': 40,
        '2': 50,
        '2 1/2': 65,
        '2-1/2': 65,
        '3': 80,
        '3 1/2': 90,
        '3-1/2': 90,
        '4': 100,
        '5': 125,
        '6': 150,
        '8': 200,
        '10': 250,
        '12': 300,
        '14': 350,
        '16': 400,
        '18': 450,
        '20': 500,
        '24': 600
    };

    // First part before X or space (e.g. 10" X 6" -> 10")
    const primaryPart = clean.split(/[X\s]/)[0].replace(/["']/g, '').trim();
    if (inchToAMap[primaryPart] !== undefined) {
        return inchToAMap[primaryPart];
    }

    // Try float parsing
    const val = parseFloat(primaryPart);
    if (!isNaN(val)) {
        if (val >= 15) return val;
        // Decimal inch
        if (val === 0.5) return 15;
        if (val === 0.75) return 20;
        if (val === 1.25) return 32;
        if (val === 1.5) return 40;
        if (val === 2.5) return 65;
        if (inchToAMap[String(val)]) return inchToAMap[String(val)];
    }

    return 0;
}

export function classifyItem(
    item: LineItem, 
    splitSizeA: number = 100,
    rateField: 'discountRate' | 'supplierRate' = 'discountRate'
): ItemClassification {
    const raw = item as Partial<LineItem> & {
        item_material?: string;
        itemName?: string;
        item_name?: string;
        item_size?: string;
        spec?: string;
    };
    const cleanMat = (item.material || raw.item_material || '').toUpperCase().trim();
    const cleanName = (item.name || raw.itemName || raw.item_name || '').toUpperCase().trim();
    const isCap = cleanName.includes('CAP');
    const currentRate = (rateField === 'supplierRate' ? item.supplierRate : item.discountRate) ?? 0;
    // In supplier PO mode, rate=0 is often unconfigured and should belong to its material group instead of zero-rate locked
    const isZeroRate = rateField === 'supplierRate' ? false : currentRate <= 0;
    const sizeA = parseASize(item.size || raw.spec || raw.item_size || '');
    const standard = detectItemStandard(item);
    
    // Dynamic size category based on splitSizeA
    const sizeCategory: 'le' | 'gt' | 'unknown' = sizeA > 0 ? (sizeA <= splitSizeA ? 'le' : 'gt') : 'unknown';

    let materialGroup: MaterialGroupKey = 'OTHER';

    // 1. SPG / Carbon Steel / 탄소강
    if (cleanMat.includes('SPG') || cleanMat.includes('SPPS') || cleanMat.includes('A53') || cleanMat.includes('A106') || cleanMat.includes('CARBON') || cleanMat.includes('탄소강') || cleanMat.includes('배관용탄소강')) {
        materialGroup = 'SPG';
    }
    // 2. 304L
    else if (cleanMat.includes('304L') || cleanMat.includes('STS304L') || cleanMat.includes('WP304L')) {
        materialGroup = (cleanMat.endsWith('-S') || cleanMat.includes('-S')) ? '304L-S' : '304L-W';
    } 
    // 3. 316 / 316L
    else if (cleanMat.includes('316') || cleanMat.includes('STS316') || cleanMat.includes('WP316')) {
        materialGroup = (cleanMat.endsWith('-S') || cleanMat.includes('-S')) ? '316L-S' : '316L-W';
    } 
    // 4. 304
    else if (cleanMat.includes('304') || cleanMat.includes('STS304') || cleanMat.includes('WP304')) {
        materialGroup = (cleanMat.endsWith('-S') || cleanMat.includes('-S')) ? '304-S' : '304-W';
    }

    return {
        materialGroup,
        isCap,
        sizeA,
        sizeCategory,
        isZeroRate,
        splitSizeUsed: splitSizeA,
        standard
    };
}

/**
 * Returns visual color classes based on user custom theme
 */
export function getMaterialVisualProps(matStr?: string, config?: UserRateConfig) {
    const clean = String(matStr || '').toUpperCase().trim();
    const isSeamless = clean.endsWith('-S') || clean.includes('-S');
    const isWelded = clean.endsWith('-W') || clean.includes('-W');
    const cfg = config || DEFAULT_USER_RATE_CONFIG;

    let targetThemeKey: ColorThemeKey = 'slate';
    let baseName = '기타';

    if (clean.includes('SPG') || clean.includes('SPPS') || clean.includes('A53') || clean.includes('CARBON') || clean.includes('탄소강')) {
        baseName = 'SPG';
        targetThemeKey = cfg.theme['SPG'] || 'slate';
    } else if (clean.includes('316') || clean.includes('316L')) {
        baseName = isSeamless ? '316L-S' : isWelded ? '316L-W' : '316L';
        targetThemeKey = cfg.theme['316'] || 'rose';
    } else if (clean.includes('304L')) {
        baseName = isSeamless ? '304L-S' : isWelded ? '304L-W' : '304L';
        targetThemeKey = cfg.theme['304L'] || 'emerald';
    } else if (clean.includes('304')) {
        baseName = isSeamless ? '304-S' : isWelded ? '304-W' : '304';
        targetThemeKey = cfg.theme['304'] || 'blue';
    }

    const themeDef = COLOR_THEME_MAP[targetThemeKey] || COLOR_THEME_MAP['slate'];

    // Seamless (-S) highlight rule
    let suffixClass = '';
    if (isSeamless && cfg.seamlessRedHighlight) {
        const sTheme = COLOR_THEME_MAP[cfg.seamlessColor || 'rose'] || COLOR_THEME_MAP['rose'];
        suffixClass = `${sTheme.textBoldClass} font-black`;
    }

    return {
        baseName,
        isSeamless,
        isWelded,
        targetThemeKey,
        badgeClass: themeDef.badgeClass,
        textClass: themeDef.textClass,
        borderClass: themeDef.borderClass,
        cardBorderClass: themeDef.cardBorderClass,
        headerBgClass: themeDef.headerBgClass,
        bgLight: themeDef.bgLight,
        suffixClass
    };
}

/**
 * Filter match helper for both quotation and purchase order rates
 */
export function checkItemMatchTargetRateFilter(
    item: LineItem, 
    targetFilter: string, 
    thresholdSize: number = 100,
    rateField: 'discountRate' | 'supplierRate' = 'discountRate'
): boolean {
    if (targetFilter === 'all') return true;

    const cls = classifyItem(item, thresholdSize, rateField);
    const itemRate = (rateField === 'supplierRate' ? item.supplierRate : item.discountRate) ?? 0;

    // 1. Mat & Size Filter: e.g. "mat_size:304-s:le"
    if (targetFilter.startsWith('mat_size:')) {
        const [, matKey, rawCat] = targetFilter.split(':');
        if (matKey.endsWith('-s') && cls.isCap) return false;
        const targetCat = rawCat.startsWith('le') ? 'le' : rawCat.startsWith('gt') ? 'gt' : rawCat;
        return cls.materialGroup.toLowerCase() === matKey.toLowerCase() &&
               cls.sizeCategory === targetCat;
    }

    // 1-1. Mat & Standard Filter: e.g. "mat_std:304-s:ansi"
    if (targetFilter.startsWith('mat_std:')) {
        const [, matKey, targetStd] = targetFilter.split(':');
        if (matKey.endsWith('-s') && cls.isCap) return false;
        return cls.materialGroup.toLowerCase() === matKey.toLowerCase() &&
               cls.standard.toLowerCase() === targetStd.toLowerCase();
    }

    // 1-2. Mat & Size & Standard Filter: e.g. "mat_size_std:304-s:le:ansi"
    if (targetFilter.startsWith('mat_size_std:')) {
        const [, matKey, rawCat, targetStd] = targetFilter.split(':');
        if (matKey.endsWith('-s') && cls.isCap) return false;
        const targetCat = rawCat.startsWith('le') ? 'le' : rawCat.startsWith('gt') ? 'gt' : rawCat;
        return cls.materialGroup.toLowerCase() === matKey.toLowerCase() &&
               cls.sizeCategory === targetCat &&
               cls.standard.toLowerCase() === targetStd.toLowerCase();
    }

    // 1-3. Mat & Size & Specific Rate Filter: e.g. "mat_size_rate:304-s:le:40"
    if (targetFilter.startsWith('mat_size_rate:')) {
        const [, matKey, rawCat, rateStr] = targetFilter.split(':');
        if (matKey.endsWith('-s') && cls.isCap) return false;
        const targetCat = rawCat.startsWith('le') ? 'le' : rawCat.startsWith('gt') ? 'gt' : rawCat;
        const targetRate = Number(rateStr);
        return cls.materialGroup.toLowerCase() === matKey.toLowerCase() &&
               cls.sizeCategory === targetCat &&
               itemRate === targetRate;
    }

    // 1-4. Mat & Specific Rate Filter: e.g. "mat_rate:304-s:40"
    if (targetFilter.startsWith('mat_rate:')) {
        const [, matKey, rateStr] = targetFilter.split(':');
        if (matKey.endsWith('-s') && cls.isCap) return false;
        const targetRate = Number(rateStr);
        return cls.materialGroup.toLowerCase() === matKey.toLowerCase() &&
               itemRate === targetRate;
    }

    // 2. Mat Filter (CAP excluded for -S): e.g. "mat:304-s"
    if (targetFilter.startsWith('mat:')) {
        const matKey = targetFilter.split(':')[1];
        if (matKey.endsWith('-s') && cls.isCap) return false;
        return cls.materialGroup.toLowerCase() === matKey.toLowerCase();
    }

    // 3. CAP Special Filters
    if (targetFilter.startsWith('cap_size_rate:')) {
        const [, , rawCat, rateStr] = targetFilter.split(':');
        const targetCat = rawCat.startsWith('le') ? 'le' : rawCat.startsWith('gt') ? 'gt' : rawCat;
        const targetRate = Number(rateStr);
        return cls.isCap && cls.sizeCategory === targetCat && itemRate === targetRate;
    }
    if (targetFilter.startsWith('cap_rate:')) {
        const [, , rateStr] = targetFilter.split(':');
        const targetRate = Number(rateStr);
        return cls.isCap && itemRate === targetRate;
    }
    if (targetFilter.startsWith('cap_size:')) {
        const [, , rawCat] = targetFilter.split(':');
        const targetCat = rawCat.startsWith('le') ? 'le' : rawCat.startsWith('gt') ? 'gt' : rawCat;
        return cls.isCap && cls.sizeCategory === targetCat;
    }
    if (targetFilter.startsWith('cap_size_std:')) {
        const [, , rawCat, targetStd] = targetFilter.split(':');
        const targetCat = rawCat.startsWith('le') ? 'le' : rawCat.startsWith('gt') ? 'gt' : rawCat;
        return cls.isCap && cls.sizeCategory === targetCat && cls.standard.toLowerCase() === targetStd.toLowerCase();
    }
    if (targetFilter.startsWith('cap_std:')) {
        const [, , targetStd] = targetFilter.split(':');
        return cls.isCap && cls.standard.toLowerCase() === targetStd.toLowerCase();
    }
    if (targetFilter.startsWith('cap:')) {
        return cls.isCap;
    }

    // Zero Rate Filter: "zero:all"
    if (targetFilter === 'zero:all') {
        return cls.isZeroRate;
    }

    // 4. Exact rate filter: e.g. "45" or "rate:45"
    const numericRate = targetFilter.startsWith('rate:')
        ? Number(targetFilter.split(':')[1])
        : Number(targetFilter);

    if (!isNaN(numericRate)) {
        return itemRate === numericRate;
    }

    return true;
}
