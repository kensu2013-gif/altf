import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

interface SearchableMultiSelectProps {
    title: string;
    options: string[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
}

export function SearchableMultiSelect({
    title,
    options,
    selectedValues,
    onChange,
    placeholder = "검색..."
}: SearchableMultiSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Filter options based on search query
    const filteredOptions = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return options;
        return options.filter(opt => opt.toLowerCase().includes(query));
    }, [options, searchQuery]);

    // Handle outside clicks to close the dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleToggle = (value: string) => {
        if (selectedValues.includes(value)) {
            onChange(selectedValues.filter(v => v !== value));
        } else {
            onChange([...selectedValues, value]);
        }
    };

    const handleSelectAllFiltered = () => {
        const next = Array.from(new Set([...selectedValues, ...filteredOptions]));
        onChange(next);
    };

    const handleClearFiltered = () => {
        const next = selectedValues.filter(v => !filteredOptions.includes(v));
        onChange(next);
    };

    const handleClearAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange([]);
    };

    return (
        <div className="relative w-full sm:w-auto min-w-[130px] max-w-[200px]" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1.5 min-h-[30px] w-full text-left text-xs text-slate-700 hover:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
            >
                <div className="flex-1 truncate pr-1">
                    {selectedValues.length === 0 ? (
                        <span className="text-slate-400 font-semibold">{title} 전체</span>
                    ) : (
                        <span className="font-extrabold text-indigo-600">
                            {title}: {selectedValues.length}
                        </span>
                    )}
                </div>
                {selectedValues.length > 0 && (
                    <span 
                        onClick={handleClearAll} 
                        className="p-0.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 flex-shrink-0"
                    >
                        <X className="w-3 h-3" />
                    </span>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-auto flex-shrink-0" />
            </button>

            {isOpen && (
                <div className="absolute left-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1.5 flex flex-col max-h-64 animate-in fade-in zoom-in-95 duration-100">
                    {/* 검색 필드 */}
                    <div className="px-2 pb-1.5 border-b border-slate-100">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={placeholder}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:border-indigo-500 font-medium"
                        />
                    </div>

                    {/* 일괄 선택 컨트롤 */}
                    <div className="px-2 py-1 flex justify-between gap-2 border-b border-slate-100 bg-slate-50/50">
                        <button
                            type="button"
                            onClick={handleSelectAllFiltered}
                            className="text-[9px] text-indigo-600 hover:text-indigo-800 font-bold"
                        >
                            필터 전체선택
                        </button>
                        <button
                            type="button"
                            onClick={handleClearFiltered}
                            className="text-[9px] text-slate-500 hover:text-slate-700 font-bold"
                        >
                            필터 해제
                        </button>
                    </div>

                    {/* 옵션 목록 */}
                    <div className="overflow-y-auto flex-1 py-1 max-h-40 custom-scrollbar">
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-2 text-center text-slate-400 text-xs">검색 결과가 없습니다.</div>
                        ) : (
                            filteredOptions.map(opt => {
                                const isSelected = selectedValues.includes(opt);
                                return (
                                    <button
                                        type="button"
                                        key={opt}
                                        onClick={() => handleToggle(opt)}
                                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2"
                                    >
                                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                                            {isSelected && <Check className="w-2.5 h-2.5" />}
                                        </div>
                                        <span className={`truncate ${isSelected ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{opt}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
