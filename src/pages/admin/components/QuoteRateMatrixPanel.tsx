import React, { useState, useMemo } from 'react';
import { 
    Sliders, 
    ShieldCheck, 
    Check, 
    ChevronDown, 
    ChevronUp, 
    Layers, 
    Sparkles,
    Settings2,
    RotateCcw,
    X,
    Palette
} from 'lucide-react';
import type { LineItem } from '../../../types';
import { 
    classifyItem, 
    loadUserRateConfig, 
    saveUserRateConfig, 
    DEFAULT_USER_RATE_CONFIG,
    COLOR_THEME_MAP,
    formatSizeLabel,
    type UserRateConfig,
    type MaterialGroupKey,
    type ColorThemeKey
} from './quoteClassification';

export interface QuoteRateMatrixPanelProps {
    items: LineItem[];
    onApplyRate: (filterKey: string, newRate: number, splitSizeA: number) => void;
    isOpen: boolean;
    onToggle: () => void;
    currentSplitSize?: number;
    onSplitSizeChange?: (size: number) => void;
    selectedFilterKey?: string | null;
    onSelectFilter?: (filterKey: string | null, label: string) => void;
}

export interface RateStatItem {
    rate: number;
    count: number;
    tooltip: string;
}

function buildRateStatsList(itemsList: LineItem[]): RateStatItem[] {
    if (!itemsList || itemsList.length === 0) return [];

    const grouped = new Map<number, LineItem[]>();
    for (let i = 0; i < itemsList.length; i++) {
        const item = itemsList[i];
        const r = item.discountRate ?? 0;
        let list = grouped.get(r);
        if (!list) {
            list = [];
            grouped.set(r, list);
        }
        list.push(item);
    }

    const result: RateStatItem[] = [];
    for (const [rate, mItems] of grouped.entries()) {
        const typeCounts: Record<string, number> = {};
        const schedules: Set<string> = new Set();
        const sizes: Set<string> = new Set();

        for (let i = 0; i < mItems.length; i++) {
            const it = mItems[i];
            const name = (it.name || '기타').trim();
            typeCounts[name] = (typeCounts[name] || 0) + 1;
            if (it.thickness) schedules.add(it.thickness.trim());
            if (it.size) sizes.add(it.size.trim());
        }

        const typeSummary = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([n, c]) => `${n}(${c}건)`)
            .join(', ');

        const schSummary = Array.from(schedules).slice(0, 3).join(', ');
        const sizeSummary = Array.from(sizes).slice(0, 4).join(', ');

        const tooltip = `[요율 ${rate}%] 총 ${mItems.length}건 (클릭 시 아래 테이블 필터)\n` +
            `• 품종: ${typeSummary || '기타'}\n` +
            (schSummary ? `• 두께: ${schSummary}\n` : '') +
            (sizeSummary ? `• 규격: ${sizeSummary}` : '');

        result.push({ rate, count: mItems.length, tooltip });
    }

    return result.sort((a, b) => a.rate - b.rate);
}

interface GroupCardData {
    key: MaterialGroupKey;
    title: string;
    subTitle: string;
    typeDesc: string;
    colorKey: ColorThemeKey;
    badgeClass: string;
    cardBorderClass: string;
    headerBgClass: string;
    textClass: string;
    isSeamless?: boolean;
    totalCount: number;
    countAnsi: number;
    countJis: number;
    countLe: number;
    countGt: number;
    rates: Set<number>;
    ratesLe: Set<number>;
    ratesGt: Set<number>;
    rateStatsList?: RateStatItem[];
    rateStatsListLe?: RateStatItem[];
    rateStatsListGt?: RateStatItem[];
    isZero?: boolean;
    note?: string;
    items: LineItem[];
    itemsLe: LineItem[];
    itemsGt: LineItem[];
}

export const QuoteRateMatrixPanel: React.FC<QuoteRateMatrixPanelProps> = ({
    items,
    onApplyRate,
    isOpen,
    onToggle,
    currentSplitSize,
    onSplitSizeChange,
    selectedFilterKey,
    onSelectFilter
}) => {
    // 1. User config (Split Size & Material Theme) - persisted in localStorage
    const [config, setConfig] = useState<UserRateConfig>(() => loadUserRateConfig());
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Sync split size with parent if controlled, else use local config
    const splitSizeA = currentSplitSize !== undefined ? currentSplitSize : config.splitSizeA;
    const useSizeSplit = config.useSizeSplit !== undefined ? config.useSizeSplit : true;
    const sizeUnitDisplay = config.sizeUnitDisplay || 'both';

    // Local string state to allow natural typing without premature min-clamping or NaN jumping
    const [splitInputStr, setSplitInputStr] = useState<string>(() => String(splitSizeA));

    // Keep splitInputStr in sync when splitSizeA changes from preset buttons or parent
    React.useEffect(() => {
        setSplitInputStr(String(splitSizeA));
    }, [splitSizeA]);

    const handleSplitSizeChange = (newSize: number) => {
        const valid = Math.max(10, Math.min(1000, Number(newSize) || 100));
        const updated: UserRateConfig = { ...config, splitSizeA: valid, useSizeSplit: true };
        setConfig(updated);
        saveUserRateConfig(updated);
        if (onSplitSizeChange) {
            onSplitSizeChange(valid);
        }
    };

    const handleSplitInputChange = (rawVal: string) => {
        setSplitInputStr(rawVal);
        if (rawVal.trim() === '') return;
        const num = Number(rawVal);
        if (!isNaN(num) && num >= 10 && num <= 1000) {
            handleSplitSizeChange(num);
        }
    };

    const handleSplitInputCommit = () => {
        const num = Number(splitInputStr);
        if (isNaN(num) || num < 10) {
            handleSplitSizeChange(10);
            setSplitInputStr('10');
        } else if (num > 1000) {
            handleSplitSizeChange(1000);
            setSplitInputStr('1000');
        } else {
            handleSplitSizeChange(num);
            setSplitInputStr(String(num));
        }
    };

    const handleToggleSizeSplit = (enabled: boolean) => {
        const updated: UserRateConfig = { ...config, useSizeSplit: enabled };
        setConfig(updated);
        saveUserRateConfig(updated);
    };

    const handleSizeUnitDisplayChange = (mode: 'both' | 'A' | 'inch') => {
        const updated: UserRateConfig = { ...config, sizeUnitDisplay: mode };
        setConfig(updated);
        saveUserRateConfig(updated);
    };

    const handleConfigSave = (newConfig: UserRateConfig) => {
        setConfig(newConfig);
        saveUserRateConfig(newConfig);
        if (onSplitSizeChange && newConfig.splitSizeA !== splitSizeA) {
            onSplitSizeChange(newConfig.splitSizeA);
        }
    };

    const handleMaterialColorChange = (mat: '304' | '304L' | '316' | 'SPG', color: ColorThemeKey) => {
        const updated: UserRateConfig = {
            ...config,
            theme: {
                ...config.theme,
                [mat]: color
            }
        };
        handleConfigSave(updated);
    };

    const handleSeamlessColorChange = (color: ColorThemeKey) => {
        const updated: UserRateConfig = {
            ...config,
            seamlessColor: color
        };
        handleConfigSave(updated);
    };

    const handleResetConfig = () => {
        handleConfigSave({ ...DEFAULT_USER_RATE_CONFIG });
    };

    // 2. Local input states
    const [rateInputs, setRateInputs] = useState<{ [key: string]: string }>({});
    const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
    const [sizeViewFilter, setSizeViewFilter] = useState<'all' | 'le' | 'gt'>('all');
    const [standardFilter, setStandardFilter] = useState<'all' | 'ANSI' | 'JIS'>('all');

    // 3. Dynamic card style resolution from user config
    const matrixData = useMemo(() => {
        const theme304 = COLOR_THEME_MAP[config.theme['304']] || COLOR_THEME_MAP['blue'];
        const theme304L = COLOR_THEME_MAP[config.theme['304L']] || COLOR_THEME_MAP['emerald'];
        const theme316 = COLOR_THEME_MAP[config.theme['316']] || COLOR_THEME_MAP['rose'];
        const themeSPG = COLOR_THEME_MAP[config.theme['SPG']] || COLOR_THEME_MAP['slate'];
        const amberTheme = COLOR_THEME_MAP['amber'];

        const groups: Record<MaterialGroupKey, GroupCardData> = {
            '304-W': {
                key: '304-W',
                title: 'STS304-W',
                subTitle: '용접관',
                typeDesc: '용접 (Welded)',
                colorKey: config.theme['304'],
                badgeClass: theme304.badgeClass,
                cardBorderClass: theme304.cardBorderClass,
                headerBgClass: theme304.headerBgClass,
                textClass: theme304.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            '304-S': {
                key: '304-S',
                title: 'STS304-S',
                subTitle: '심리스관',
                typeDesc: '심리스 (Seamless - CAP제외)',
                colorKey: config.theme['304'],
                isSeamless: true,
                badgeClass: theme304.badgeClass,
                cardBorderClass: `${theme304.cardBorderClass} ring-1 ring-slate-200`,
                headerBgClass: theme304.headerBgClass,
                textClass: theme304.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                note: '※ CAP 품목은 용접(-W) 요율군으로 자동 분리 보호',
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            '304L-W': {
                key: '304L-W',
                title: 'STS304L-W',
                subTitle: '저탄소 용접관',
                typeDesc: '용접 (Welded)',
                colorKey: config.theme['304L'],
                badgeClass: theme304L.badgeClass,
                cardBorderClass: theme304L.cardBorderClass,
                headerBgClass: theme304L.headerBgClass,
                textClass: theme304L.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            '304L-S': {
                key: '304L-S',
                title: 'STS304L-S',
                subTitle: '저탄소 심리스',
                typeDesc: '심리스 (Seamless - CAP제외)',
                colorKey: config.theme['304L'],
                isSeamless: true,
                badgeClass: theme304L.badgeClass,
                cardBorderClass: `${theme304L.cardBorderClass} ring-1 ring-slate-200`,
                headerBgClass: theme304L.headerBgClass,
                textClass: theme304L.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                note: '※ CAP 품목은 용접(-W) 요율군으로 자동 분리 보호',
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            '316L-W': {
                key: '316L-W',
                title: 'STS316L-W',
                subTitle: '몰리브덴 용접관',
                typeDesc: '용접 (Welded)',
                colorKey: config.theme['316'],
                badgeClass: theme316.badgeClass,
                cardBorderClass: theme316.cardBorderClass,
                headerBgClass: theme316.headerBgClass,
                textClass: theme316.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            '316L-S': {
                key: '316L-S',
                title: 'STS316L-S',
                subTitle: '몰리브덴 심리스',
                typeDesc: '심리스 (Seamless)',
                colorKey: config.theme['316'],
                isSeamless: true,
                badgeClass: theme316.badgeClass,
                cardBorderClass: `${theme316.cardBorderClass} ring-1 ring-slate-200`,
                headerBgClass: theme316.headerBgClass,
                textClass: theme316.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            'SPG': {
                key: 'SPG',
                title: 'SPG / 탄소강',
                subTitle: '배관용 탄소강관',
                typeDesc: 'SPG / SPPS / Carbon Steel',
                colorKey: config.theme['SPG'],
                badgeClass: themeSPG.badgeClass,
                cardBorderClass: themeSPG.cardBorderClass,
                headerBgClass: themeSPG.headerBgClass,
                textClass: themeSPG.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                note: '배관용 탄소강 (SPG / SPPS / A53) 품목군',
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            'CAP-SPECIAL': {
                key: 'CAP-SPECIAL',
                title: 'CAP 특수 품목군',
                subTitle: '캡 전용 연동',
                typeDesc: '심리스/용접 CAP (-W 요율 연동군)',
                colorKey: 'amber',
                badgeClass: amberTheme.badgeClass,
                cardBorderClass: amberTheme.cardBorderClass,
                headerBgClass: amberTheme.headerBgClass,
                textClass: amberTheme.textClass,
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                note: '★ -S 재질 CAP이라도 -W 단가/요율을 적용받는 품목군',
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            'ZERO-RATE': {
                key: 'ZERO-RATE',
                title: '0% 고정가 품목',
                subTitle: '수정 보호',
                typeDesc: '특수/수기단가/미연동 품목',
                colorKey: 'slate',
                badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 font-medium',
                cardBorderClass: 'border-slate-200 bg-slate-50/70',
                headerBgClass: 'bg-slate-100 border-slate-200',
                textClass: 'text-slate-700',
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set([0]),
                ratesLe: new Set(),
                ratesGt: new Set(),
                isZero: true,
                note: '🔒 일괄 변경 대상에서 영구 보호 (단가 변동 차단)',
                items: [],
                itemsLe: [],
                itemsGt: []
            },
            'OTHER': {
                key: 'OTHER',
                title: '기타 재질 품목',
                subTitle: '미분류 재질',
                typeDesc: '기타 규격/재질',
                colorKey: 'slate',
                badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 font-bold',
                cardBorderClass: 'border-slate-200 hover:border-slate-300 bg-white',
                headerBgClass: 'bg-slate-50 border-slate-100',
                textClass: 'text-slate-700',
                totalCount: 0,
                countAnsi: 0,
                countJis: 0,
                countLe: 0,
                countGt: 0,
                rates: new Set(),
                ratesLe: new Set(),
                ratesGt: new Set(),
                items: [],
                itemsLe: [],
                itemsGt: []
            }
        };

        items.forEach(it => {
            const cls = classifyItem(it, splitSizeA);
            const rate = it.discountRate ?? 0;

            // If standard filter is active, skip non-matching items
            if (standardFilter !== 'all' && cls.standard !== standardFilter) {
                return;
            }

            if (cls.isZeroRate) {
                groups['ZERO-RATE'].totalCount++;
                groups['ZERO-RATE'].items.push(it);
                if (cls.standard === 'ANSI') groups['ZERO-RATE'].countAnsi++;
                else groups['ZERO-RATE'].countJis++;
                if (cls.sizeCategory === 'le') {
                    groups['ZERO-RATE'].countLe++;
                    groups['ZERO-RATE'].itemsLe.push(it);
                }
                if (cls.sizeCategory === 'gt') {
                    groups['ZERO-RATE'].countGt++;
                    groups['ZERO-RATE'].itemsGt.push(it);
                }
                return;
            }

            // Cap items in -S materials route to CAP-SPECIAL
            if (cls.isCap) {
                groups['CAP-SPECIAL'].totalCount++;
                groups['CAP-SPECIAL'].items.push(it);
                if (cls.standard === 'ANSI') groups['CAP-SPECIAL'].countAnsi++;
                else groups['CAP-SPECIAL'].countJis++;
                groups['CAP-SPECIAL'].rates.add(rate);
                if (cls.sizeCategory === 'le') {
                    groups['CAP-SPECIAL'].countLe++;
                    groups['CAP-SPECIAL'].ratesLe.add(rate);
                    groups['CAP-SPECIAL'].itemsLe.push(it);
                }
                if (cls.sizeCategory === 'gt') {
                    groups['CAP-SPECIAL'].countGt++;
                    groups['CAP-SPECIAL'].ratesGt.add(rate);
                    groups['CAP-SPECIAL'].itemsGt.push(it);
                }
                return;
            }

            const targetGroup = groups[cls.materialGroup] || groups['OTHER'];
            targetGroup.totalCount++;
            targetGroup.items.push(it);
            if (cls.standard === 'ANSI') targetGroup.countAnsi++;
            else targetGroup.countJis++;

            targetGroup.rates.add(rate);
            if (cls.sizeCategory === 'le') {
                targetGroup.countLe++;
                targetGroup.ratesLe.add(rate);
                targetGroup.itemsLe.push(it);
            }
            if (cls.sizeCategory === 'gt') {
                targetGroup.countGt++;
                targetGroup.ratesGt.add(rate);
                targetGroup.itemsGt.push(it);
            }
        });

        const result = Object.values(groups).filter(g => g.totalCount > 0);
        for (let i = 0; i < result.length; i++) {
            const g = result[i];
            g.rateStatsList = buildRateStatsList(g.items);
            g.rateStatsListLe = buildRateStatsList(g.itemsLe);
            g.rateStatsListGt = buildRateStatsList(g.itemsGt);
        }
        return result;
    }, [items, splitSizeA, config.theme, standardFilter]);

    const handleInputChange = (groupKey: string, val: string) => {
        setRateInputs(prev => ({ ...prev, [groupKey]: val }));
    };

    // Apply Rate Handler supporting standard filter & sub size filter
    const handleApply = (groupKey: string, targetSubFilter?: 'le' | 'gt', targetStandard?: 'ANSI' | 'JIS') => {
        const inputKey = targetSubFilter ? `${groupKey}:${targetSubFilter}` : groupKey;
        const valStr = rateInputs[inputKey] ?? rateInputs[groupKey];
        const val = Number(valStr);

        if (isNaN(val) || val < 0 || val > 100 || valStr === undefined || valStr.trim() === '') {
            alert('올바른 요율(0~100 사이 숫자)을 입력해주세요.');
            return;
        }

        let filterKey = '';
        if (targetStandard) {
            // Apply only to specific standard (ANSI or JIS)
            if (groupKey === 'CAP-SPECIAL') {
                filterKey = `cap_std:all:${targetStandard.toLowerCase()}`;
            } else if (useSizeSplit && targetSubFilter) {
                filterKey = `mat_size_std:${groupKey.toLowerCase()}:${targetSubFilter}:${targetStandard.toLowerCase()}`;
            } else {
                filterKey = `mat_std:${groupKey.toLowerCase()}:${targetStandard.toLowerCase()}`;
            }
        } else {
            // Standard general application
            if (groupKey === 'CAP-SPECIAL') {
                filterKey = (useSizeSplit && targetSubFilter) ? `cap_size:all:${targetSubFilter}` : 'cap:all';
            } else if (useSizeSplit && targetSubFilter) {
                filterKey = `mat_size:${groupKey.toLowerCase()}:${targetSubFilter}`;
            } else {
                filterKey = `mat:${groupKey.toLowerCase()}`;
            }
        }

        onApplyRate(filterKey, val, splitSizeA);

        const subText = (useSizeSplit && targetSubFilter === 'le') 
            ? ` (${formatSizeLabel(splitSizeA, sizeUnitDisplay)} 이하)` 
            : (useSizeSplit && targetSubFilter === 'gt') 
                ? ` (${formatSizeLabel(splitSizeA, sizeUnitDisplay)} 초과)` 
                : '';
        const stdText = targetStandard ? ` [${targetStandard} 품목만]` : '';
        setAppliedNotice(`[${groupKey}${subText}${stdText}] 그룹에 요율 ${val}%가 성공적으로 적용되었습니다.`);
        setTimeout(() => setAppliedNotice(null), 3500);
    };


    const renderRateBadges = (
        statsList: RateStatItem[] | undefined,
        filterKeyPrefix: string,
        labelPrefix: string
    ) => {
        if (!statsList || statsList.length === 0) return <span className="text-slate-400 font-normal text-xs">-</span>;

        return (
            <div className="inline-flex items-center gap-1 flex-wrap">
                {statsList.map(st => {
                    const filterKey = `${filterKeyPrefix}:${st.rate}`;
                    const isSelected = selectedFilterKey === filterKey;

                    return (
                        <button
                            key={st.rate}
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!onSelectFilter) return;
                                if (isSelected) {
                                    onSelectFilter(null, '');
                                } else {
                                    onSelectFilter(filterKey, `${labelPrefix} [요율 ${st.rate}%]`);
                                }
                            }}
                            title={st.tooltip}
                            className={`px-1.5 py-0.5 rounded text-[11px] font-black transition-all cursor-pointer border ${
                                isSelected
                                    ? 'bg-teal-600 text-white border-teal-700 shadow-xs ring-2 ring-teal-400 scale-105'
                                    : 'bg-white hover:bg-teal-50 hover:text-teal-700 hover:border-teal-300 text-slate-700 border-slate-200 shadow-2xs'
                            }`}
                        >
                            {st.rate}%
                            {statsList.length > 1 && (
                                <span className={`ml-0.5 text-[9px] font-bold ${isSelected ? 'text-teal-100' : 'text-slate-400'}`}>
                                    ({st.count})
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        );
    };

    const COLOR_OPTIONS: ColorThemeKey[] = ['blue', 'emerald', 'rose', 'purple', 'amber', 'slate', 'cyan'];

    const formattedSplitSize = formatSizeLabel(splitSizeA, sizeUnitDisplay);

    return (
        <div className="mb-4 bg-white border border-teal-200/90 rounded-2xl shadow-sm overflow-hidden transition-all">
            {/* Header Toggle Bar */}
            <div 
                className="flex flex-wrap items-center justify-between px-4 py-3 bg-linear-to-r from-teal-50/90 via-slate-50 to-white cursor-pointer select-none border-b border-teal-100 hover:bg-teal-100/40 transition-colors"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-xs">
                        <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-slate-800 tracking-tight">
                                스마트 재질 및 요율 매트릭스
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-teal-600 text-white shadow-2xs">
                                총 {items.length}개 품목 분석
                            </span>
                            {useSizeSplit ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-teal-50 text-teal-700 border border-teal-300">
                                    구경 분기 ON: {formattedSplitSize} 기준
                                </span>
                            ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                                    구경 분기 OFF: 재질별 일괄
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>• 304 / 304L / 316 / SPG 재질별 색상 커스텀</span>
                            <span className="hidden md:inline font-bold" style={{ color: COLOR_THEME_MAP[config.seamlessColor || 'rose'].swatchHex }}>
                                • -S 심리스 글자 강조
                            </span>
                            <span className="hidden md:inline">
                                • {useSizeSplit ? `${formattedSplitSize} 기준 소/대구경 분기 제어` : '재질별 심플 일괄 적용'}
                            </span>
                            <span className="hidden lg:inline text-purple-700 font-bold">
                                • ANSI ↔ JIS 혼용 자동 감지 & 원클릭 분리 적용 지원
                            </span>
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                    {/* Settings Trigger */}
                    <button
                        type="button"
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                            isSettingsOpen 
                                ? 'bg-teal-600 text-white border-teal-600 shadow-xs' 
                                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs'
                        }`}
                        title="담당자 맞춤 설정 (구경 분기 여부 및 재질 색상 팔레트)"
                    >
                        <Palette className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">재질 색상 & 구경 맞춤설정</span>
                    </button>

                    <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-600 bg-white/90 px-2.5 py-1.5 rounded-lg border border-teal-200/60 shadow-2xs">
                        <Layers className="w-3.5 h-3.5 text-teal-600" />
                        <span>활성 그룹: <b>{matrixData.length}개</b></span>
                    </div>

                    <button
                        type="button"
                        onClick={onToggle}
                        className="flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-800 px-2 py-1.5 rounded-lg hover:bg-teal-50"
                    >
                        <span>{isOpen ? '패널 접기' : '매트릭스 열기'}</span>
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Notification alert on apply */}
            {appliedNotice && (
                <div className="mx-4 mt-3 p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-2 text-xs font-bold text-emerald-800 animate-fadeIn shadow-2xs">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{appliedNotice}</span>
                </div>
            )}

            {/* Manager Custom Settings Modal / Drawer */}
            {isSettingsOpen && (
                <div className="p-4 mx-4 mt-3 bg-white rounded-2xl border-2 border-teal-300 shadow-lg animate-fadeIn">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3.5">
                        <div className="flex items-center gap-2">
                            <Settings2 className="w-4.5 h-4.5 text-teal-600" />
                            <div>
                                <h4 className="text-xs font-black text-slate-800">
                                    🎨 담당자별 맞춤 설정 (원하는 색상과 구경 분기 방식을 직접 선택하세요)
                                </h4>
                                <p className="text-[10px] text-slate-500">
                                    설정하신 색상과 구경 분기 모드는 담당자 개인 브라우저에 자동 보관됩니다.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleResetConfig}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
                                title="표준 기본값으로 복원"
                            >
                                <RotateCcw className="w-3 h-3" />
                                <span>기본값 초기화</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen(false)}
                                className="text-slate-400 hover:text-slate-600 p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                        {/* 1. Split Size A customizer (col 5) */}
                        <div className="lg:col-span-5 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 flex flex-col justify-between">
                            <div>
                                <label className="block font-black text-slate-800 mb-1">
                                    📏 기준 구경 분기 방식 & 호칭 단위 설정
                                </label>
                                <p className="text-[11px] text-slate-500 mb-2.5">
                                    구경으로 세분화할지, 재질별로 일괄 적용할지와 호칭 표기 방식을 정합니다.
                                </p>

                                {/* Size Split Switch Tabs */}
                                <div className="inline-flex w-full rounded-xl border border-slate-300 p-1 bg-white shadow-2xs mb-3">
                                    <button
                                        type="button"
                                        onClick={() => handleToggleSizeSplit(false)}
                                        className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all text-center ${
                                            !useSizeSplit 
                                                ? 'bg-slate-700 text-white shadow-xs' 
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        안 나눔 (단일)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleSizeSplit(true)}
                                        className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all text-center ${
                                            useSizeSplit 
                                                ? 'bg-teal-600 text-white shadow-xs' 
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        구경별 분기 사용 (ON)
                                    </button>
                                </div>

                                {/* Size Unit Display Selector */}
                                <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs mb-3">
                                    <span className="block font-bold text-slate-700 mb-1.5 text-[11px]">
                                        📐 구경 표기 방식 (A 호칭 vs 인치 호칭):
                                    </span>
                                    <div className="inline-flex w-full rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                                        <button
                                            type="button"
                                            onClick={() => handleSizeUnitDisplayChange('both')}
                                            className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-all ${
                                                sizeUnitDisplay === 'both' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                        >
                                            50A (2") 병기
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleSizeUnitDisplayChange('inch')}
                                            className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-all ${
                                                sizeUnitDisplay === 'inch' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                        >
                                            2" 인치만 (ANSI)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleSizeUnitDisplayChange('A')}
                                            className={`flex-1 py-1 text-[11px] font-bold rounded-md transition-all ${
                                                sizeUnitDisplay === 'A' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                        >
                                            50A만 (JIS)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {useSizeSplit ? (
                                <div className="flex items-center justify-between pt-2 border-t border-slate-200/80 animate-fadeIn">
                                    <span className="text-[11px] text-slate-700 font-bold">기준 구경 직접 입력:</span>
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="number"
                                            value={splitInputStr}
                                            onChange={(e) => handleSplitInputChange(e.target.value)}
                                            onBlur={handleSplitInputCommit}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    handleSplitInputCommit();
                                                    (e.target as HTMLInputElement).blur();
                                                }
                                            }}
                                            className="w-16 px-1.5 py-1 text-center font-bold text-xs border border-slate-300 rounded-lg bg-white outline-none focus:border-teal-500 shadow-2xs"
                                            title="기준 구경 직접 입력"
                                        />
                                        <span className="font-extrabold text-slate-700">A</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-2 bg-slate-100/70 rounded-lg text-slate-500 text-[11px] text-center border border-slate-200 font-medium">
                                    ✓ 구경 구분 없이 재질별로 깔끔하게 전체 적용됩니다.
                                </div>
                            )}
                        </div>

                        {/* 2. Interactive Material Color Palette Picker (col 7) */}
                        <div className="lg:col-span-7 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200">
                            <label className="block font-black text-slate-800 mb-1">
                                🎨 재질별 전용 색상 지정 (원하는 색상 버튼을 클릭하세요)
                            </label>
                            <p className="text-[11px] text-slate-500 mb-3">
                                카드의 테두리, 헤더, 뱃지 및 품목 테이블의 재질명 색상이 즉시 연동됩니다.
                            </p>

                            <div className="space-y-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                                {/* 304 Row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2 min-w-32.5">
                                        <span className={`px-2 py-0.5 rounded-md text-[11px] border font-bold ${COLOR_THEME_MAP[config.theme['304']].badgeClass}`}>
                                            STS304
                                        </span>
                                        <span className="text-[11px] text-slate-600 font-medium">304 용접/심리스:</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {COLOR_OPTIONS.map(cKey => {
                                            const theme = COLOR_THEME_MAP[cKey];
                                            const isSelected = config.theme['304'] === cKey;
                                            return (
                                                <button
                                                    key={cKey}
                                                    type="button"
                                                    onClick={() => handleMaterialColorChange('304', cKey)}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-white transition-all transform hover:scale-110 ${
                                                        isSelected ? 'ring-2 ring-offset-2 ring-slate-700 scale-105 shadow-xs' : 'opacity-80 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: theme.swatchHex }}
                                                    title={`304 재질을 ${theme.label}으로 설정`}
                                                >
                                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-3" />}
                                                </button>
                                            );
                                        })}
                                        <span className="text-[10px] text-slate-400 font-bold ml-1 min-w-7">
                                            {COLOR_THEME_MAP[config.theme['304']].label}
                                        </span>
                                    </div>
                                </div>

                                {/* 304L Row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2 min-w-32.5">
                                        <span className={`px-2 py-0.5 rounded-md text-[11px] border font-bold ${COLOR_THEME_MAP[config.theme['304L']].badgeClass}`}>
                                            STS304L
                                        </span>
                                        <span className="text-[11px] text-slate-600 font-medium">304L 저탄소:</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {COLOR_OPTIONS.map(cKey => {
                                            const theme = COLOR_THEME_MAP[cKey];
                                            const isSelected = config.theme['304L'] === cKey;
                                            return (
                                                <button
                                                    key={cKey}
                                                    type="button"
                                                    onClick={() => handleMaterialColorChange('304L', cKey)}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-white transition-all transform hover:scale-110 ${
                                                        isSelected ? 'ring-2 ring-offset-2 ring-slate-700 scale-105 shadow-xs' : 'opacity-80 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: theme.swatchHex }}
                                                    title={`304L 재질을 ${theme.label}으로 설정`}
                                                >
                                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-3" />}
                                                </button>
                                            );
                                        })}
                                        <span className="text-[10px] text-slate-400 font-bold ml-1 min-w-7">
                                            {COLOR_THEME_MAP[config.theme['304L']].label}
                                        </span>
                                    </div>
                                </div>

                                {/* 316 Row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2 min-w-32.5">
                                        <span className={`px-2 py-0.5 rounded-md text-[11px] border font-bold ${COLOR_THEME_MAP[config.theme['316']].badgeClass}`}>
                                            STS316/L
                                        </span>
                                        <span className="text-[11px] text-slate-600 font-medium">316 몰리브덴:</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {COLOR_OPTIONS.map(cKey => {
                                            const theme = COLOR_THEME_MAP[cKey];
                                            const isSelected = config.theme['316'] === cKey;
                                            return (
                                                <button
                                                    key={cKey}
                                                    type="button"
                                                    onClick={() => handleMaterialColorChange('316', cKey)}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-white transition-all transform hover:scale-110 ${
                                                        isSelected ? 'ring-2 ring-offset-2 ring-slate-700 scale-105 shadow-xs' : 'opacity-80 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: theme.swatchHex }}
                                                    title={`316 재질을 ${theme.label}으로 설정`}
                                                >
                                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-3" />}
                                                </button>
                                            );
                                        })}
                                        <span className="text-[10px] text-slate-400 font-bold ml-1 min-w-7">
                                            {COLOR_THEME_MAP[config.theme['316']].label}
                                        </span>
                                    </div>
                                </div>

                                {/* SPG Row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2 min-w-32.5">
                                        <span className={`px-2 py-0.5 rounded-md text-[11px] border font-bold ${COLOR_THEME_MAP[config.theme['SPG']].badgeClass}`}>
                                            SPG
                                        </span>
                                        <span className="text-[11px] text-slate-600 font-medium">배관용 탄소강:</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {COLOR_OPTIONS.map(cKey => {
                                            const theme = COLOR_THEME_MAP[cKey];
                                            const isSelected = config.theme['SPG'] === cKey;
                                            return (
                                                <button
                                                    key={cKey}
                                                    type="button"
                                                    onClick={() => handleMaterialColorChange('SPG', cKey)}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-white transition-all transform hover:scale-110 ${
                                                        isSelected ? 'ring-2 ring-offset-2 ring-slate-700 scale-105 shadow-xs' : 'opacity-80 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: theme.swatchHex }}
                                                    title={`SPG 재질을 ${theme.label}으로 설정`}
                                                >
                                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-3" />}
                                                </button>
                                            );
                                        })}
                                        <span className="text-[10px] text-slate-400 font-bold ml-1 min-w-7">
                                            {COLOR_THEME_MAP[config.theme['SPG']].label}
                                        </span>
                                    </div>
                                </div>

                                {/* -S Seamless Highlight Row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id="seamless_highlight_chk"
                                            checked={config.seamlessRedHighlight}
                                            onChange={(e) => {
                                                const updated: UserRateConfig = { ...config, seamlessRedHighlight: e.target.checked };
                                                handleConfigSave(updated);
                                            }}
                                            className="rounded accent-teal-600 w-4 h-4 cursor-pointer"
                                        />
                                        <label htmlFor="seamless_highlight_chk" className="cursor-pointer font-bold text-slate-700">
                                            -S (심리스) 글자 강조 색상:
                                        </label>
                                    </div>
                                    {config.seamlessRedHighlight && (
                                        <div className="flex items-center gap-1.5">
                                            {COLOR_OPTIONS.map(cKey => {
                                                const theme = COLOR_THEME_MAP[cKey];
                                                const isSelected = (config.seamlessColor || 'rose') === cKey;
                                                return (
                                                    <button
                                                        key={cKey}
                                                        type="button"
                                                        onClick={() => handleSeamlessColorChange(cKey)}
                                                        className={`w-6 h-6 rounded-full flex items-center justify-center text-white transition-all transform hover:scale-110 ${
                                                            isSelected ? 'ring-2 ring-offset-2 ring-slate-700 scale-105 shadow-xs' : 'opacity-80 hover:opacity-100'
                                                        }`}
                                                        style={{ backgroundColor: theme.swatchHex }}
                                                        title={`-S 심리스를 ${theme.label} 글자로 강조`}
                                                    >
                                                        {isSelected && <Check className="w-3.5 h-3.5 stroke-3" />}
                                                    </button>
                                                );
                                            })}
                                            <span className="text-[10px] text-slate-400 font-bold ml-1 min-w-7">
                                                {COLOR_THEME_MAP[config.seamlessColor || 'rose'].label}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Expandable Content */}
            {isOpen && (
                <div className="p-4 bg-slate-50/50">
                    {/* Size Filter & Standard Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200">
                        <div className="flex flex-wrap items-center gap-2.5">
                            {/* Standard Filter (ANSI vs JIS) */}
                            <div className="flex items-center gap-1 text-xs font-bold text-slate-600 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs">
                                <span className="text-slate-500 font-medium">규격 보기:</span>
                                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                                    <button
                                        type="button"
                                        onClick={() => setStandardFilter('all')}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-md transition-all ${
                                            standardFilter === 'all' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        통합 전체
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setStandardFilter('ANSI')}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-md transition-all ${
                                            standardFilter === 'ANSI' ? 'bg-sky-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        ANSI만
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setStandardFilter('JIS')}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-md transition-all ${
                                            standardFilter === 'JIS' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        JIS만
                                    </button>
                                </div>
                            </div>

                            {/* Split size ON / OFF Toggle in Toolbar */}
                            <div className="flex items-center gap-1 text-xs font-bold text-slate-600 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs">
                                <span className="text-slate-500 font-medium">구경 분기:</span>
                                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                                    <button
                                        type="button"
                                        onClick={() => handleToggleSizeSplit(false)}
                                        className={`px-2 py-0.5 text-xs font-black rounded-md transition-all ${
                                            !useSizeSplit 
                                                ? 'bg-slate-700 text-white shadow-xs' 
                                                : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="구경 구분 없이 재질별로 단일 적용합니다."
                                    >
                                        안 나눔 (단일)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleSizeSplit(true)}
                                        className={`px-2 py-0.5 text-xs font-black rounded-md transition-all ${
                                            useSizeSplit 
                                                ? 'bg-teal-600 text-white shadow-xs' 
                                                : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="구경을 기준으로 소구경/대구경을 나눕니다."
                                    >
                                        구경별 분기
                                    </button>
                                </div>

                                {useSizeSplit && (
                                    <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-slate-200 animate-fadeIn">
                                        <span className="text-slate-500 font-medium text-xs">기준:</span>
                                        <div className="flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-300 focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-200 shadow-2xs transition-all">
                                            <input
                                                type="number"
                                                value={splitInputStr}
                                                onChange={(e) => handleSplitInputChange(e.target.value)}
                                                onBlur={handleSplitInputCommit}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        handleSplitInputCommit();
                                                        (e.target as HTMLInputElement).blur();
                                                    }
                                                }}
                                                className="w-12 text-center font-black text-xs bg-transparent outline-none text-teal-800"
                                                placeholder="100"
                                                title="기준 구경 직접 입력 (Enter 또는 포커스 아웃 시 확정)"
                                            />
                                            <span className="font-black text-slate-600 text-xs">A</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* View Filter (when size split is on) */}
                            {useSizeSplit && (
                                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-white shadow-2xs">
                                    <button
                                        type="button"
                                        onClick={() => setSizeViewFilter('all')}
                                        className={`px-2.5 py-0.5 text-xs font-bold rounded-md transition-all ${
                                            sizeViewFilter === 'all' 
                                                ? 'bg-teal-600 text-white shadow-xs' 
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                        title={`입력한 ${formattedSplitSize} 기준으로 전체 그룹을 확인합니다`}
                                    >
                                        전체 보기 ({formattedSplitSize})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSizeViewFilter('le')}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-md transition-all ${
                                            sizeViewFilter === 'le' 
                                                ? 'bg-teal-600 text-white shadow-xs' 
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        ≤ {formattedSplitSize}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSizeViewFilter('gt')}
                                        className={`px-2 py-0.5 text-xs font-bold rounded-md transition-all ${
                                            sizeViewFilter === 'gt' 
                                                ? 'bg-teal-600 text-white shadow-xs' 
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        &gt; {formattedSplitSize}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>
                                {useSizeSplit 
                                    ? `${formattedSplitSize} 분기 기준 적용 · ANSI/JIS 혼용 상태 실시간 표시` 
                                    : '구경 구분 없이 재질별로 깔끔하게 한 번에 일괄 적용합니다.'}
                            </span>
                        </div>
                    </div>

                    {/* Matrix Grid Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                        {matrixData.map(group => {
                            if (useSizeSplit) {
                                if (sizeViewFilter === 'le' && group.countLe === 0) return null;
                                if (sizeViewFilter === 'gt' && group.countGt === 0) return null;
                            }

                            const isZero = group.isZero;
                            const isSeamless = group.isSeamless;
                            const seamlessTheme = COLOR_THEME_MAP[config.seamlessColor || 'rose'];
                            const isMixed = group.countAnsi > 0 && group.countJis > 0;

                            const cardFilterKey = group.key === 'CAP-SPECIAL' ? 'cap:all' : group.key === 'ZERO-RATE' ? 'zero:all' : `mat:${group.key.toLowerCase()}`;
                            const isCardActive = selectedFilterKey === cardFilterKey;
                            const isAnySubActive = !!(selectedFilterKey && (
                                selectedFilterKey.startsWith(`mat_size:${group.key.toLowerCase()}:`) ||
                                selectedFilterKey.startsWith(`mat_size_rate:${group.key.toLowerCase()}:`) ||
                                selectedFilterKey.startsWith(`mat_rate:${group.key.toLowerCase()}:`) ||
                                (group.key === 'CAP-SPECIAL' && selectedFilterKey.startsWith('cap')) ||
                                (group.key === 'ZERO-RATE' && selectedFilterKey === 'zero:all')
                            ));

                            return (
                                <div 
                                    key={group.key}
                                    className={`rounded-2xl border p-3.5 flex flex-col justify-between transition-all bg-white shadow-2xs hover:shadow-xs ${group.cardBorderClass} ${
                                        (isCardActive || isAnySubActive) ? 'ring-2 ring-teal-500 shadow-md bg-teal-50/15' : ''
                                    }`}
                                >
                                    <div>
                                        {/* Card Header with Distinct Material Badge & ANSI/JIS Hybrid indicator */}
                                        <div 
                                            onClick={() => {
                                                if (!onSelectFilter) return;
                                                if (isCardActive) {
                                                    onSelectFilter(null, '');
                                                } else {
                                                    onSelectFilter(cardFilterKey, `${group.title} 전체 (${group.totalCount}건)`);
                                                }
                                            }}
                                            className={`flex items-center justify-between gap-1.5 pb-2.5 border-b ${group.headerBgClass} -mx-3.5 -mt-3.5 px-3.5 pt-3 rounded-t-2xl cursor-pointer hover:opacity-95 transition-all`}
                                            title="클릭 시 아래 테이블에 이 재질 전체 품목을 필터링합니다"
                                        >
                                            <div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span 
                                                        className="font-black text-sm tracking-tight"
                                                        style={{
                                                            color: isSeamless && config.seamlessRedHighlight
                                                                ? seamlessTheme.swatchHex
                                                                : undefined
                                                        }}
                                                    >
                                                        {group.title}
                                                    </span>
                                                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] border shadow-2xs ${group.badgeClass}`}>
                                                        {group.totalCount}건
                                                    </span>
                                                    {(isCardActive || isAnySubActive) && (
                                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-teal-600 text-white shadow-2xs animate-pulse">
                                                            필터 활성
                                                        </span>
                                                    )}
                                                    {isSeamless && config.seamlessRedHighlight && (
                                                        <span 
                                                            className="px-1 py-0.2 rounded text-[9px] font-black border"
                                                            style={{
                                                                color: seamlessTheme.swatchHex,
                                                                backgroundColor: '#ffffff',
                                                                borderColor: seamlessTheme.swatchHex
                                                            }}
                                                        >
                                                            심리스(-S)
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Smart ANSI/JIS Mixing Tag without cluttering extra cards */}
                                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                    {isMixed ? (
                                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-purple-100 text-purple-800 border border-purple-300" title="ANSI와 JIS 품목이 혼용되어 있습니다.">
                                                            ⚡ 혼용: ANSI {group.countAnsi} · JIS {group.countJis}
                                                        </span>
                                                    ) : group.countAnsi > 0 ? (
                                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                                                            ANSI 전용 ({group.countAnsi})
                                                        </span>
                                                    ) : (
                                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                            JIS 전용 ({group.countJis})
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-slate-400 font-medium">
                                                        {group.typeDesc}
                                                    </span>
                                                </div>
                                            </div>

                                            {isZero ? (
                                                <div className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 shrink-0">
                                                    <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                                                    <span>보호됨</span>
                                                </div>
                                            ) : (
                                                <div className="text-right shrink-0" onClick={(e) => e.stopPropagation()}>
                                                    <span className="text-[10px] text-slate-400 font-medium">현재 요율</span>
                                                    <div className="mt-0.5">
                                                        {renderRateBadges(
                                                            group.rateStatsList, 
                                                            group.key === 'CAP-SPECIAL' ? 'cap_rate:all' : `mat_rate:${group.key.toLowerCase()}`,
                                                            `${group.title}`
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Size Breakdown Info (Shown ONLY if useSizeSplit is ON) */}
                                        {!isZero && useSizeSplit && (
                                            <div className="my-2.5 bg-slate-50/90 rounded-xl p-2 border border-slate-100 space-y-1 shadow-2xs animate-fadeIn">
                                                {/* LE row */}
                                                {(() => {
                                                    const leKey = group.key === 'CAP-SPECIAL' ? 'cap_size:all:le' : `mat_size:${group.key.toLowerCase()}:le`;
                                                    const isLeActive = selectedFilterKey === leKey;
                                                    return (
                                                        <div 
                                                            onClick={() => {
                                                                if (!onSelectFilter) return;
                                                                if (isLeActive) onSelectFilter(null, '');
                                                                else onSelectFilter(leKey, `${group.title} ≤ ${formattedSplitSize} (${group.countLe}건)`);
                                                            }}
                                                            className={`flex items-center justify-between text-[11px] p-1.5 rounded-lg cursor-pointer transition-all ${
                                                                isLeActive 
                                                                    ? 'bg-teal-100/90 text-teal-900 font-bold ring-1 ring-teal-500 shadow-2xs' 
                                                                    : 'hover:bg-slate-200/50'
                                                            }`}
                                                            title="클릭 시 소구경 품목만 아래 테이블에 필터링"
                                                        >
                                                            <span className="text-slate-600 font-medium">
                                                                ≤ {formattedSplitSize} (소구경):
                                                            </span>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-slate-800 shrink-0">{group.countLe}건</span>
                                                                <div onClick={(e) => e.stopPropagation()}>
                                                                    {renderRateBadges(
                                                                        group.rateStatsListLe,
                                                                        group.key === 'CAP-SPECIAL' ? 'cap_size_rate:all:le' : `mat_size_rate:${group.key.toLowerCase()}:le`,
                                                                        `${group.title} ≤ ${formattedSplitSize}`
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                {/* GT row */}
                                                {(() => {
                                                    const gtKey = group.key === 'CAP-SPECIAL' ? 'cap_size:all:gt' : `mat_size:${group.key.toLowerCase()}:gt`;
                                                    const isGtActive = selectedFilterKey === gtKey;
                                                    return (
                                                        <div 
                                                            onClick={() => {
                                                                if (!onSelectFilter) return;
                                                                if (isGtActive) onSelectFilter(null, '');
                                                                else onSelectFilter(gtKey, `${group.title} > ${formattedSplitSize} (${group.countGt}건)`);
                                                            }}
                                                            className={`flex items-center justify-between text-[11px] p-1.5 rounded-lg cursor-pointer transition-all ${
                                                                isGtActive 
                                                                    ? 'bg-teal-100/90 text-teal-900 font-bold ring-1 ring-teal-500 shadow-2xs' 
                                                                    : 'hover:bg-slate-200/50'
                                                            }`}
                                                            title="클릭 시 대구경 품목만 아래 테이블에 필터링"
                                                        >
                                                            <span className="text-slate-600 font-medium">
                                                                &gt; {formattedSplitSize} (대구경):
                                                            </span>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-slate-800 shrink-0">{group.countGt}건</span>
                                                                <div onClick={(e) => e.stopPropagation()}>
                                                                    {renderRateBadges(
                                                                        group.rateStatsListGt,
                                                                        group.key === 'CAP-SPECIAL' ? 'cap_size_rate:all:gt' : `mat_size_rate:${group.key.toLowerCase()}:gt`,
                                                                        `${group.title} > ${formattedSplitSize}`
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {/* Special notice for CAP & Seamless */}
                                        {group.note && (
                                            <div className={`text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2 py-1.5 mb-2.5 leading-snug ${!useSizeSplit ? 'mt-2.5' : ''}`}>
                                                {group.note}
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Input and Buttons */}
                                    {!isZero ? (
                                        <div className={`pt-2 border-t border-slate-100 space-y-2 ${!useSizeSplit && !group.note ? 'mt-3' : ''}`}>
                                            {/* All size direct apply */}
                                            <div className="flex items-center gap-1.5">
                                                <div className="relative flex-1">
                                                    <input
                                                        type="number"
                                                        placeholder="요율(%)"
                                                        value={rateInputs[group.key] || ''}
                                                        onChange={(e) => handleInputChange(group.key, e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleApply(group.key);
                                                        }}
                                                        className="w-full px-2 py-1 text-center text-xs font-bold border border-slate-300 rounded-lg focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                                                    />
                                                    <span className="absolute right-2 top-1 text-[11px] text-slate-400 font-bold pointer-events-none">%</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleApply(group.key)}
                                                    className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs active:scale-95 whitespace-nowrap cursor-pointer"
                                                    title="이 재질의 모든 품목에 요율 일괄 적용"
                                                >
                                                    전체 적용
                                                </button>
                                            </div>

                                            {/* Smart Standard Pinpoint Action (Shown ONLY when ANSI and JIS are mixed) */}
                                            {isMixed && (
                                                <div className="flex items-center gap-1 pt-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApply(group.key, undefined, 'ANSI')}
                                                        className="flex-1 py-1 px-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg text-[10px] font-black transition-all cursor-pointer text-center"
                                                        title={`이 재질의 ANSI 규격 ${group.countAnsi}건만 입력한 요율로 변경`}
                                                    >
                                                        ANSI만 ({group.countAnsi})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApply(group.key, undefined, 'JIS')}
                                                        className="flex-1 py-1 px-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg text-[10px] font-black transition-all cursor-pointer text-center"
                                                        title={`이 재질의 JIS 규격 ${group.countJis}건만 입력한 요율로 변경`}
                                                    >
                                                        JIS만 ({group.countJis})
                                                    </button>
                                                </div>
                                            )}

                                            {/* Sub buttons for <=splitSizeA and >splitSizeA (Shown ONLY if useSizeSplit is ON) */}
                                            {(useSizeSplit && group.countLe > 0 && group.countGt > 0) && (
                                                <div className="flex items-center gap-1 pt-1 animate-fadeIn">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApply(group.key, 'le')}
                                                        className="flex-1 py-1 px-1.5 bg-slate-100 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-300 text-slate-700 rounded-lg text-[10px] font-bold border border-slate-200 transition-all cursor-pointer text-center"
                                                        title={`${formattedSplitSize} 이하 ${group.countLe}건만 입력한 요율로 변경`}
                                                    >
                                                        ≤{formattedSplitSize}만 ({group.countLe})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApply(group.key, 'gt')}
                                                        className="flex-1 py-1 px-1.5 bg-slate-100 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-300 text-slate-700 rounded-lg text-[10px] font-bold border border-slate-200 transition-all cursor-pointer text-center"
                                                        title={`${formattedSplitSize} 초과 ${group.countGt}건만 입력한 요율로 변경`}
                                                    >
                                                        &gt;{formattedSplitSize}만 ({group.countGt})
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="pt-2 border-t border-slate-100 text-center">
                                            <span className="text-[11px] text-slate-400 font-medium">
                                                단가 직접 입력 품목 (수정 보호)
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
