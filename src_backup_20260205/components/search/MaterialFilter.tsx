import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown, ChevronUp, Check, Layers, RotateCcw } from 'lucide-react';
import { getValidMaterialsForSystem } from '../../lib/productUtils';
import type { StandardSystem } from '../../lib/productUtils';

interface MaterialFilterProps {
    selectedMaterials: string[];
    onToggleMaterial: (mat: string) => void;
    productName: string; // Needed for CAP logic
    system: StandardSystem; // New Prop
    onReset?: () => void; // Optional reset handler
    showGuide?: boolean; // New Prop for Guide Point
    selectedThicknesses?: string[]; // New Prop for Seamless Logic
}

export function MaterialFilter({ selectedMaterials, onToggleMaterial, productName, system, onReset, showGuide, selectedThicknesses = [] }: MaterialFilterProps) {
    const [isAdvanced, setIsAdvanced] = useState(true);

    // Get relevant materials based on product rules AND system
    let options = getValidMaterialsForSystem(productName, system);

    // Seamless Rule: If ONLY high-pressure/seamless thicknesses are selected, restrict to "-S" materials.
    // If a mix of seamless and standard (e.g. S40S) is selected, show ALL options.
    const SEAMLESS_ONLY_THICKNESSES = ['S80S', 'S160', 'XX-S'];
    const isRestrictedToSeamless = selectedThicknesses.length > 0 && selectedThicknesses.every(t => SEAMLESS_ONLY_THICKNESSES.includes(t));

    if (isRestrictedToSeamless) {
        options = options.filter(m => m.endsWith('-S'));
    }

    return (
        <div className={cn("space-y-2 relative transition-all duration-300", showGuide && "p-2 -m-2 bg-pink-50/50 rounded-xl border border-pink-200")}>
            {showGuide && (
                <div className="absolute -top-2 -right-1 z-10 animate-bounce">
                    <span className="bg-pink-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        재질 선택 필수
                    </span>
                </div>
            )}
            <div className="flex items-center justify-between">
                <button
                    onClick={() => setIsAdvanced(!isAdvanced)}
                    className="flex items-center gap-1 text-base font-extrabold text-slate-700 hover:text-slate-900 transition-colors uppercase"
                >
                    <Layers className="w-5 h-5" />
                    <span>재질 (MATERIAL)</span>
                    {isAdvanced ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                </button>
                {onReset && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onReset();
                        }}
                        className="px-2 py-0.5 rounded text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center gap-1"
                    >
                        <RotateCcw className="w-3 h-3" />
                        초기화
                    </button>
                )}
            </div>

            {isAdvanced && (
                <div className="bg-white p-3 rounded-md border border-slate-200 grid grid-cols-2 gap-2 sm:grid-cols-4 animate-in slide-in-from-top-2 fade-in duration-200">
                    {options.map(mat => {
                        const isSelected = selectedMaterials.includes(mat);

                        // Helper for color coding (Light Theme Variants)
                        const getMaterialColor = (m: string) => {
                            if (!isSelected) return "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50";

                            if (m.includes('316L')) return "bg-rose-50 border-rose-200 text-rose-700 ring-1 ring-rose-200";
                            if (m.includes('304L')) return "bg-emerald-50 border-emerald-200 text-emerald-700 ring-1 ring-emerald-200";
                            if (m.includes('304')) return "bg-amber-50 border-amber-200 text-amber-700 ring-1 ring-amber-200";

                            // Default for others
                            return "bg-teal-50 border-teal-200 text-teal-700 ring-1 ring-teal-200";
                        };

                        const getIndicatorColor = (m: string) => {
                            if (!isSelected) return "bg-slate-300";

                            let type: string;
                            if (m.includes('316L') || m.includes('304L') || m.includes('304')) {
                                type = 'STS'; // Stainless Steel
                            } else {
                                type = 'CS'; // Carbon Steel or other
                            }

                            switch (type) {
                                case 'STS': return 'bg-blue-500'; // Clean Blue for STS
                                case 'CS': return 'bg-slate-500'; // Slate for CS
                                default: return 'bg-gray-400';
                            }
                        }

                        return (
                            <button
                                key={mat}
                                onClick={() => onToggleMaterial(mat)}
                                className={cn(
                                    "flex items-center justify-center gap-1 px-2 py-1.5 text-xs border rounded-md transition-all font-bold",
                                    getMaterialColor(mat)
                                )}
                            >
                                <span className={cn("w-1.5 h-1.5 rounded-full transition-colors", getIndicatorColor(mat))} />
                                {mat}
                            </button>
                        );
                    })}
                    <div className="col-span-full pt-2 text-[10px] text-slate-400 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>다중 선택 가능</span>
                    </div>
                </div>
            )}

            {!isAdvanced && selectedMaterials.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {selectedMaterials.map(mat => {
                        let colorClass = "bg-teal-50 text-teal-700 border-teal-200";
                        if (mat.includes('316L')) colorClass = "bg-rose-50 text-rose-700 border-rose-200";
                        else if (mat.includes('304L')) colorClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        else if (mat.includes('304')) colorClass = "bg-amber-50 text-amber-700 border-amber-200";

                        return (
                            <span key={mat} className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", colorClass)}>
                                {mat}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
