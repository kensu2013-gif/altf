import React, { useState } from 'react';
import { X, Check, AlertTriangle, ExternalLink, CheckSquare, Square } from 'lucide-react';
import type { SimilarityMatchCandidate } from '../../../utils/quoteSimilarityCore';

interface QuoteComparisonModalProps {
    isOpen: boolean;
    onClose: () => void;
    candidate: SimilarityMatchCandidate | null;
    onApplyPrices?: (priceMap: Map<number, { unitPrice: number; discountRate?: number }>) => void;
}

export const QuoteComparisonModal: React.FC<QuoteComparisonModalProps> = ({
    isOpen,
    onClose,
    candidate,
    onApplyPrices
}) => {
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    if (!isOpen || !candidate) return null;

    const isReadOnly = candidate.similarityType === 'SAME_PROJECT';
    const isStale = (new Date().getTime() - new Date(candidate.createdAt).getTime()) / (1000 * 60 * 60 * 24) > 60;

    const itemsA = candidate.itemsA;
    const itemsB = candidate.itemsB;

    const handleToggleAll = () => {
        if (selectedIndices.size === itemsA.length) {
            setSelectedIndices(new Set());
        } else {
            const all = new Set<number>();
            itemsA.forEach((_, idx) => {
                const match = candidate.itemMatchMap.get(idx);
                if (match && match.targetIndex !== undefined && itemsB[match.targetIndex].unitPrice > 0) {
                    all.add(idx);
                }
            });
            setSelectedIndices(all);
        }
    };

    const handleToggleIndex = (idx: number) => {
        const next = new Set(selectedIndices);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        setSelectedIndices(next);
    };

    const handleApply = () => {
        if (!onApplyPrices || isReadOnly) return;
        const priceMap = new Map<number, { unitPrice: number; discountRate?: number }>();
        selectedIndices.forEach(idxA => {
            const match = candidate.itemMatchMap.get(idxA);
            if (match && match.targetIndex !== undefined) {
                const matchedItemB = itemsB[match.targetIndex];
                if (matchedItemB.unitPrice > 0) {
                    priceMap.set(idxA, {
                        unitPrice: matchedItemB.unitPrice,
                        discountRate: matchedItemB.reverseRate ?? undefined
                    });
                }
            }
        });
        onApplyPrices(priceMap);
        onClose();
    };

    const handleOpenInNewTab = () => {
        const path = candidate.targetType === 'ORDER'
            ? `/admin/orders?orderId=${candidate.targetId}`
            : `/admin/quotes?quoteId=${candidate.targetId}`;
        window.open(path, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-scaleUp">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-extrabold text-slate-800">
                                정밀 견적·발주 대조 (Visual Diff & 역산 요율 분석)
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-black border ${
                                isReadOnly ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-teal-100 text-teal-800 border-teal-300'
                            }`}>
                                {candidate.similarityType === 'SAME_PROJECT' ? '⚠️ 타사/경쟁 유의 (읽기 전용)' : '동사/반복 유의 (단가 승계 가능)'}
                            </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                            <span>대조 대상: <b className="text-slate-700">{candidate.customerName}</b> ({candidate.targetDocNo})</span>
                            <span>·</span>
                            <span>작성일: {candidate.createdAt?.substring(0, 10)}</span>
                            <span>·</span>
                            <span className="text-teal-700 font-bold">유사도 {candidate.totalScore}점</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleOpenInNewTab}
                            className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-colors"
                            title="현재 창을 유지하고 새 창에서 열기"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>새 창 열기</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Stale Warning Alert */}
                {isStale && (
                    <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>비교 대상 건이 60일 이전 데이터입니다. 자재 원가 및 시세 변동 가능성을 유의하여 확인하십시오.</span>
                    </div>
                )}

                {/* Table Content */}
                <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                    <table className="w-full text-xs text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-bold text-slate-600">
                                {!isReadOnly && (
                                    <th className="py-2.5 px-3 text-center w-10">
                                        <button type="button" onClick={handleToggleAll} className="cursor-pointer">
                                            {selectedIndices.size > 0 && selectedIndices.size === itemsA.length ? (
                                                <CheckSquare className="w-4 h-4 text-teal-600" />
                                            ) : (
                                                <Square className="w-4 h-4 text-slate-400" />
                                            )}
                                        </button>
                                    </th>
                                )}
                                <th className="py-2.5 px-2 text-center w-12">순번</th>
                                <th className="py-2.5 px-3">현재 품목 규격</th>
                                <th className="py-2.5 px-3 text-center w-16">수량</th>
                                <th className="py-2.5 px-3 text-right w-24">현재 단가</th>
                                <th className="py-2.5 px-2 text-center w-24">일치 구분</th>
                                <th className="py-2.5 px-3">비교 대상 규격</th>
                                <th className="py-2.5 px-3 text-center w-20">비교 수량</th>
                                <th className="py-2.5 px-3 text-right w-24">비교 단가</th>
                                <th className="py-2.5 px-3 text-right w-24 bg-teal-50/50">추정 요율(%)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {itemsA.map((itA, idxA) => {
                                const match = candidate.itemMatchMap.get(idxA);
                                const matchType = match?.matchType ?? 'NONE';
                                const targetIdx = match?.targetIndex;
                                const itB = targetIdx !== undefined ? itemsB[targetIdx] : null;

                                const isL1 = matchType === 'L1';
                                const isL2 = matchType === 'L2';
                                const isNone = matchType === 'NONE';

                                const qtyDiff = itB ? itA.quantity - itB.quantity : null;
                                const isChecked = selectedIndices.has(idxA);

                                // Row Background Highlight
                                const rowBg = isL1 
                                    ? 'bg-emerald-50/30 hover:bg-emerald-50/50' 
                                    : isL2 
                                        ? 'bg-amber-50/30 hover:bg-amber-50/50' 
                                        : 'bg-slate-50/40 hover:bg-slate-100/50 opacity-60';

                                return (
                                    <tr key={idxA} className={`transition-colors ${rowBg}`}>
                                        {!isReadOnly && (
                                            <td className="py-2 px-3 text-center">
                                                {itB && itB.unitPrice > 0 ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => handleToggleIndex(idxA)}
                                                        className="rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                                                    />
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="py-2 px-2 text-center font-mono text-slate-400">
                                            {idxA + 1}
                                        </td>
                                        <td className="py-2 px-3">
                                            <div className="font-bold text-slate-800">
                                                {itA.normName} {itA.normThick} {itA.sizeA} {itA.normMaterial}
                                            </div>
                                        </td>
                                        <td className="py-2 px-3 text-center font-bold text-slate-700">
                                            {itA.quantity}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                                            {itA.unitPrice > 0 ? `${itA.unitPrice.toLocaleString()}원` : '-'}
                                        </td>
                                        <td className="py-2 px-2 text-center">
                                            {isL1 && (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                                                    L1 정확
                                                </span>
                                            )}
                                            {isL2 && (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                                    L2 계열
                                                </span>
                                            )}
                                            {isNone && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400">
                                                    신규
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2 px-3">
                                            {itB ? (
                                                <div className="font-bold text-slate-700">
                                                    {itB.normName} {itB.normThick} {itB.sizeA} {itB.normMaterial}
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 italic">미포함 품목</span>
                                            )}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {itB ? (
                                                <div className="flex items-center justify-center gap-1">
                                                    <span className="font-bold text-slate-700">{itB.quantity}</span>
                                                    {qtyDiff !== null && qtyDiff !== 0 && (
                                                        <span className={`text-[10px] font-bold ${qtyDiff > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                                            ({qtyDiff > 0 ? `+${qtyDiff}` : qtyDiff})
                                                        </span>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                                            {itB && itB.unitPrice > 0 ? `${itB.unitPrice.toLocaleString()}원` : '-'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono font-bold text-teal-700 bg-teal-50/30">
                                            {itB && itB.reverseRate !== null ? `${itB.reverseRate}%` : '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Footer Controls */}
                <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <div className="text-xs text-slate-500 flex items-center gap-4">
                        <span>L1 정확 일치: <b className="text-emerald-700">{candidate.matchedL1Count}개</b></span>
                        <span>L2 계열 일치: <b className="text-amber-700">{candidate.matchedL2Count}개</b></span>
                        {!isReadOnly && (
                            <span>선택된 품목: <b className="text-teal-700">{selectedIndices.size}개</b></span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 transition-colors"
                        >
                            닫기
                        </button>

                        {!isReadOnly && onApplyPrices && (
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={selectedIndices.size === 0}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                            >
                                <Check className="w-3.5 h-3.5" />
                                <span>선택 {selectedIndices.size}개 품목 단가 승계 적용</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
