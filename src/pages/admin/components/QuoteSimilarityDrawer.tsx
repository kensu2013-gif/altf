import React from 'react';
import { X, ExternalLink, Columns, Copy, Check } from 'lucide-react';
import type { SimilarityMatchCandidate } from '../../../utils/quoteSimilarityCore';

interface QuoteSimilarityDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    candidates: SimilarityMatchCandidate[];
    selectedCandidate: SimilarityMatchCandidate | null;
    onSelectCandidate: (candidate: SimilarityMatchCandidate | null) => void;
    onOpenComparisonModal: (candidate: SimilarityMatchCandidate) => void;
    onDismissMatch: (targetId: string) => void;
}

export const QuoteSimilarityDrawer: React.FC<QuoteSimilarityDrawerProps> = ({
    isOpen,
    onClose,
    candidates,
    selectedCandidate,
    onSelectCandidate,
    onOpenComparisonModal,
    onDismissMatch
}) => {
    const [copiedId, setCopiedId] = React.useState<string | null>(null);

    if (!isOpen) return null;

    const handleCopyShortagePrompt = (c: SimilarityMatchCandidate) => {
        const text = `[ALTF 견적 확인] ${c.customerName} 담당자님, 접수해주신 품목 중 일부가 지난번 ${c.createdAt?.substring(0, 10)} 발주건(${c.targetDocNo})과 동일하여 확인차 연락드립니다. 혹시 현장 누락/추가분(Shortage)이 맞으실까요? 확인해주시면 지난번 단가 및 매입처를 우선 승계하여 빠르게 처리해 드리겠습니다.`;
        navigator.clipboard.writeText(text);
        setCopiedId(c.targetId);
        setTimeout(() => setCopiedId(null), 2500);
    };

    const handleOpenInNewWindow = (c: SimilarityMatchCandidate) => {
        const path = c.targetType === 'ORDER' 
            ? `/admin/orders?orderId=${c.targetId}` 
            : `/admin/quotes?quoteId=${c.targetId}`;
        window.open(path, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-115 bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-slideLeft">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse" />
                        <h3 className="font-extrabold text-sm text-slate-800">유사 견적 & 발주 정밀 분석</h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">과거 1~2년 누적 데이터 기반 상위 {candidates.length}건 매칭</p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                    title="패널 닫기"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Candidate List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {candidates.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-xs">
                        감지된 타사/경쟁 유의 또는 동사/반복 유의 내역이 없습니다.
                    </div>
                ) : (
                    candidates.map((c, idx) => {
                        const isSelected = selectedCandidate?.targetId === c.targetId;
                        const badgeColor = 
                            c.similarityType === 'SAME_PROJECT' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                            c.similarityType === 'SHORTAGE' ? 'bg-blue-100 text-blue-800 border-blue-300' :
                            c.similarityType === 'DUPLICATE' ? 'bg-purple-100 text-purple-800 border-purple-300' :
                            'bg-teal-100 text-teal-800 border-teal-300';

                        const badgeTitle = 
                            c.similarityType === 'SAME_PROJECT' ? '⚠️ 타사/경쟁 유의' :
                            c.similarityType === 'SHORTAGE' ? '🔗 Shortage(추가) 감지' :
                            c.similarityType === 'DUPLICATE' ? '중복 접수 의심' : '동사/반복 유의';

                        return (
                            <div
                                key={c.targetId}
                                className={`border rounded-xl p-4 transition-all shadow-xs ${
                                    isSelected 
                                        ? 'border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/20' 
                                        : 'border-slate-200 hover:border-slate-300 bg-white'
                                }`}
                            >
                                {/* Card Header */}
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${badgeColor}`}>
                                                {badgeTitle}
                                            </span>
                                            <span className="text-xs font-bold text-slate-800 truncate max-w-45">
                                                {c.customerName || '무명 고객사'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
                                            <span className="font-mono">{c.targetDocNo}</span>
                                            <span>·</span>
                                            <span>{c.createdAt?.substring(0, 10)}</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-base font-black text-teal-700">
                                            {c.totalScore}
                                            <span className="text-[10px] font-medium text-slate-400 ml-0.5">점</span>
                                        </div>
                                        <span className="text-[9px] text-slate-400">랭크 #{idx + 1}</span>
                                    </div>
                                </div>

                                {/* Score Component Bars */}
                                <div className="space-y-1.5 my-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs">
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-slate-500">품목 구성 (55%)</span>
                                        <span className="font-bold text-slate-700">{c.specScore}%</span>
                                    </div>
                                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-teal-500 h-full rounded-full" style={{ width: `${Math.min(100, c.specScore)}%` }} />
                                    </div>

                                    <div className="flex items-center justify-between text-[11px] pt-1">
                                        <span className="text-slate-500">수량 패턴 (25%)</span>
                                        <span className="font-bold text-slate-700">{c.qtyScore}%</span>
                                    </div>
                                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-sky-500 h-full rounded-full" style={{ width: `${Math.min(100, c.qtyScore)}%` }} />
                                    </div>

                                    <div className="flex items-center justify-between text-[11px] pt-1">
                                        <span className="text-slate-500">BOM 순서 (20%)</span>
                                        <span className="font-bold text-slate-700">{c.seqScore}%</span>
                                    </div>
                                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                        <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${Math.min(100, c.seqScore)}%` }} />
                                    </div>
                                </div>

                                {/* Rationale Chips */}
                                <div className="flex flex-wrap gap-1 mb-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                        품목 일치: {c.matchedL1Count}개(정확) + {c.matchedL2Count}개(계열)
                                    </span>
                                    {c.rareItemsMatchedCount > 0 && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                            희귀품목 {c.rareItemsMatchedCount}종 일치
                                        </span>
                                    )}
                                    {c.isScaleVariant && c.scaleRatio && (
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                            전 품목 {c.scaleRatio}배 규모
                                        </span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => onSelectCandidate(isSelected ? null : c)}
                                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
                                            isSelected 
                                                ? 'bg-teal-600 text-white' 
                                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                        }`}
                                        title="견적서 품목 테이블에 일치 색 띠를 표시합니다."
                                    >
                                        <span>{isSelected ? '색 띠 해제' : '행 색 띠 강조'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onOpenComparisonModal(c)}
                                        className="py-1.5 px-2.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                                        title="양쪽 품목을 나란히 놓고 비교합니다."
                                    >
                                        <Columns className="w-3.5 h-3.5" />
                                        <span>정밀 비교</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleOpenInNewWindow(c)}
                                        className="py-1.5 px-2 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-all"
                                        title="현재 창을 유지한 채 새 탭에서 과거 문서를 확인합니다."
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        <span>새 창</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onDismissMatch(c.targetId)}
                                        className="py-1.5 px-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold transition-all"
                                        title="이 문서는 관련이 없습니다 (학습 피드백)"
                                    >
                                        아님
                                    </button>
                                </div>

                                {/* Shortage Quick Copy Prompt Button */}
                                {c.similarityType === 'SHORTAGE' && (
                                    <div className="mt-2.5 pt-2 border-t border-blue-100 bg-blue-50/50 -mx-4 -mb-4 p-3 rounded-b-xl">
                                        <button
                                            type="button"
                                            onClick={() => handleCopyShortagePrompt(c)}
                                            className="w-full py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs"
                                        >
                                            {copiedId === c.targetId ? (
                                                <>
                                                    <Check className="w-3.5 h-3.5" />
                                                    <span>확인 문구 복사 완료!</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="w-3.5 h-3.5" />
                                                    <span>담당자 확인 문구 복사</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer Guidance */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
                <span>색 띠: 초록(정확) · 노랑(계열) · 회색(미일치)</span>
                <span className="text-slate-400">Esc로 닫기</span>
            </div>
        </div>
    );
};
