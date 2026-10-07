/**
 * 견적 및 발주 유사도 평가 코어 엔진 (Quote & Order Similarity Core Engine)
 */

import type { LineItem } from '../types';
import { 
    ITEM_NAME_ALIASES, 
    NON_ITEM_KEYWORDS, 
    INCH_TO_A_MAP, 
    type SimilarityThresholds, 
    DEFAULT_SIMILARITY_THRESHOLDS 
} from './quoteSimilarityConfig';

export interface NormalizedItem {
    raw: LineItem;
    l1Key: string;           // 완전 일치 키: 품목|두께|구경|재질
    l2Key: string;           // 계열 일치 키: 품목|구경|재질군
    materialFamily: string;  // 재질군 (304-W, 304-S, 316-W 등)
    sizeA: string;           // A단위 통일 구경 (예: 150A, 80A X 50A)
    normName: string;        // 정규화 품목명
    normThick: string;       // 정규화 두께
    normMaterial: string;    // 정규화 재질 (하이픈 유지)
    quantity: number;
    unitPrice: number;
    basePrice: number;
    reverseRate: number | null; // 추정 할인율/요율 (%)
    isNonItem: boolean;      // 운임 등 비품목 여부
}

export type SimilarityType = 'DUPLICATE' | 'SAME_PROJECT' | 'SHORTAGE' | 'REPEAT' | 'NONE';

export interface SimilarityMatchCandidate {
    targetId: string;
    targetType: 'QUOTATION' | 'ORDER';
    targetDocNo: string;
    customerName: string;
    businessNo?: string;
    createdAt: string;
    similarityType: SimilarityType;
    totalScore: number;
    specScore: number;
    qtyScore: number;
    seqScore: number;
    overlapRatio: number;      // |A ∩ B| / |A|
    matchedL1Count: number;
    matchedL2Count: number;
    totalItemsA: number;
    totalItemsB: number;
    rareItemsMatchedCount: number;
    isScaleVariant: boolean;
    scaleRatio?: number;
    rationale: string[];       // 판단 근거 태그 목록
    itemsA: NormalizedItem[];
    itemsB: NormalizedItem[];
    itemMatchMap: Map<number, { matchType: 'L1' | 'L2' | 'NONE'; targetIndex?: number }>;
}

export interface SimilaritySummary {
    topType: SimilarityType;
    topScore: number;
    candidates: SimilarityMatchCandidate[]; // 상위 3건
}

/** 고객사명 정규화 (customer-matching.js 준수) */
export function stripCorp(name?: string): string {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '')
               .replace(/[^a-zA-Z0-9가-힣]/g, '')
               .trim();
}

/** 사업자번호 정규화 */
export function normalizeBizNo(bizNo?: string): string {
    return (bizNo || '').replace(/[^0-9]/g, '');
}

/** 비품목 라인 여부 검사 */
export function isNonItemLine(name?: string, note?: string): boolean {
    const text = `${name || ''} ${note || ''}`.trim();
    if (!text) return true;
    const upper = text.toUpperCase();
    return NON_ITEM_KEYWORDS.some(kw => upper.includes(kw.toUpperCase()));
}

/** 두께 표기 정규화 (10S, SCH10S -> S10S) */
export function normalizeThickness(thickness?: string): string {
    if (!thickness) return '';
    const clean = thickness.toUpperCase().replace(/\s/g, '');
    if (clean === '10S' || clean === 'SCH10S' || clean === 'S10') return 'S10S';
    if (clean === '20S' || clean === 'SCH20S' || clean === 'S20') return 'S20S';
    if (clean === '40S' || clean === 'SCH40S' || clean === 'S40' || clean === 'STD') return 'S40S';
    if (clean === '80S' || clean === 'SCH80S' || clean === 'S80' || clean === 'XS') return 'S80S';
    if (clean === '160S' || clean === 'SCH160S' || clean === 'S160' || clean === 'XXS') return 'S160S';
    return clean;
}

/** 단일 구경 문자열을 A단위로 정규화 */
function normalizeSingleSizePart(part: string): string {
    const trimmed = part.trim().toUpperCase();
    if (!trimmed) return '';

    // 이미 A 단위 (e.g. 100A, 50A)
    const matchA = trimmed.match(/^(\d+)\s*A$/i);
    if (matchA) return `${matchA[1]}A`;

    // 인치 표기 (e.g. 6", 2 1/2", 1-1/2")
    const cleanInch = trimmed.replace(/["”″]/g, '').trim();
    if (INCH_TO_A_MAP[cleanInch] !== undefined) {
        return `${INCH_TO_A_MAP[cleanInch]}A`;
    }

    // 소수점 인치 (e.g. 1.5 -> 40A, 2.5 -> 65A)
    const val = parseFloat(cleanInch);
    if (!isNaN(val)) {
        if (val >= 15) return `${Math.round(val)}A`;
        if (INCH_TO_A_MAP[String(val)]) return `${INCH_TO_A_MAP[String(val)]}A`;
    }

    return trimmed;
}

/** 구경 표기 정규화 (크기 구분자 대문자 X 통일, 인치 -> A 통일) */
export function normalizeSizeA(sizeStr?: string): string {
    if (!sizeStr) return '';
    // 크기 구분자 x, X, * 공통 ' X ' 분할
    const parts = sizeStr.split(/[\s*xX]+/).filter(Boolean);
    if (parts.length === 0) return '';
    const normParts = parts.map(p => normalizeSingleSizePart(p));
    return normParts.join(' X ');
}

/** 재질군 추출 (304, 304L, 316, 316L 및 심리스 -S 여부 보존) */
export function extractMaterialFamily(matStr?: string): string {
    const clean = (matStr || '').toUpperCase().trim();
    const isSeamless = clean.endsWith('-S') || clean.includes('-S');
    const suffix = isSeamless ? '-S' : '-W';

    if (clean.includes('304L') || clean.includes('STS304L') || clean.includes('WP304L')) return `304L${suffix}`;
    if (clean.includes('316L') || clean.includes('STS316L') || clean.includes('WP316L')) return `316L${suffix}`;
    if (clean.includes('316') || clean.includes('STS316') || clean.includes('WP316')) return `316${suffix}`;
    if (clean.includes('304') || clean.includes('STS304') || clean.includes('WP304')) return `304${suffix}`;
    if (clean.includes('SPG') || clean.includes('SPPS') || clean.includes('A53') || clean.includes('A106') || clean.includes('CARBON') || clean.includes('탄소강')) return 'SPG';
    return 'OTHER';
}

/** 품목 행 정규화 및 L1/L2 지문 생성 */
export function normalizeLineItem(item: LineItem): NormalizedItem {
    const rawName = (item.name || item.item_name || '').trim();
    const isNonItem = isNonItemLine(rawName, item.note);

    // 품목명 별칭 정규화
    const upperName = rawName.toUpperCase();
    const normName = ITEM_NAME_ALIASES[upperName] || upperName.replace(/[\s\-_]/g, '');

    const normThick = normalizeThickness(item.thickness);
    const sizeA = normalizeSizeA(item.size);

    // 재질 정규화: 하이픈 보존!
    const normMaterial = (item.material || '').toUpperCase().replace(/\s+/g, '').trim();
    const materialFamily = extractMaterialFamily(normMaterial);

    const l1Key = `${normName}|${normThick}|${sizeA}|${normMaterial}`;
    const l2Key = `${normName}|${sizeA}|${materialFamily}`;

    const unitPrice = item.unitPrice ?? item.unit_price ?? 0;
    const basePrice = item.base_price ?? 0;
    let reverseRate: number | null = null;
    if (basePrice > 0 && unitPrice > 0) {
        reverseRate = Math.round((1 - unitPrice / basePrice) * 1000) / 10;
    }

    return {
        raw: item,
        l1Key,
        l2Key,
        materialFamily,
        sizeA,
        normName,
        normThick,
        normMaterial,
        quantity: Math.max(0, item.quantity ?? item.qty ?? 0),
        unitPrice,
        basePrice,
        reverseRate,
        isNonItem
    };
}

/** LCS (최장 공통 부분 수열) 계산 */
export function calculateLCS(seqA: string[], seqB: string[]): number {
    const m = seqA.length;
    const n = seqB.length;
    if (m === 0 || n === 0) return 0;

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (seqA[i - 1] === seqB[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return dp[m][n];
}

/** 구경순 등 표준 정렬인지 감지 (도면 고유 순서가 아니면 감점) */
export function isStandardSorted(items: NormalizedItem[]): boolean {
    if (items.length < 3) return false;
    let ascending = true;
    let descending = true;
    for (let i = 1; i < items.length; i++) {
        const prev = parseInt(items[i - 1].sizeA, 10) || 0;
        const curr = parseInt(items[i].sizeA, 10) || 0;
        if (prev > curr) ascending = false;
        if (prev < curr) descending = false;
    }
    return ascending || descending;
}

/** 
 * 두 문서 간 유사도 상세 평가
 */
export function compareTwoNormalizedDocuments(
    docA: { id: string; type: 'QUOTATION' | 'ORDER'; docNo: string; customerName: string; bizNo?: string; createdAt: string; items: NormalizedItem[] },
    docB: { id: string; type: 'QUOTATION' | 'ORDER'; docNo: string; customerName: string; bizNo?: string; createdAt: string; items: NormalizedItem[] },
    idfMap: Map<string, number>,
    thresholds: SimilarityThresholds = DEFAULT_SIMILARITY_THRESHOLDS
): SimilarityMatchCandidate | null {
    const validItemsA = docA.items.filter(it => !it.isNonItem && it.l1Key.length > 5);
    const validItemsB = docB.items.filter(it => !it.isNonItem && it.l1Key.length > 5);

    if (validItemsA.length === 0 || validItemsB.length === 0) return null;

    // 1. 매칭 테이블 구성 (L1 정확 일치 우선, 그 다음 L2 계열 일치)
    const matchedBIndices = new Set<number>();
    const itemMatchMap = new Map<number, { matchType: 'L1' | 'L2' | 'NONE'; targetIndex?: number }>();

    let matchedL1Count = 0;
    let matchedL2Count = 0;
    let rareItemsMatchedCount = 0;

    const matchedPairsQtyRatio: number[] = [];

    // L1 매칭
    validItemsA.forEach((itemA, idxA) => {
        let foundBIdx = -1;
        for (let j = 0; j < validItemsB.length; j++) {
            if (matchedBIndices.has(j)) continue;
            if (itemA.l1Key === validItemsB[j].l1Key) {
                foundBIdx = j;
                break;
            }
        }
        if (foundBIdx !== -1) {
            matchedBIndices.add(foundBIdx);
            itemMatchMap.set(idxA, { matchType: 'L1', targetIndex: foundBIdx });
            matchedL1Count++;
            const idf = idfMap.get(itemA.l1Key) ?? 1.0;
            if (idf >= 3.0) rareItemsMatchedCount++;

            const qA = itemA.quantity;
            const qB = validItemsB[foundBIdx].quantity;
            if (qA > 0 && qB > 0) {
                matchedPairsQtyRatio.push(Math.min(qA, qB) / Math.max(qA, qB));
            }
        }
    });

    // L2 매칭 (L1 미매칭 대상)
    validItemsA.forEach((itemA, idxA) => {
        if (itemMatchMap.has(idxA)) return;
        let foundBIdx = -1;
        for (let j = 0; j < validItemsB.length; j++) {
            if (matchedBIndices.has(j)) continue;
            if (itemA.l2Key === validItemsB[j].l2Key) {
                foundBIdx = j;
                break;
            }
        }
        if (foundBIdx !== -1) {
            matchedBIndices.add(foundBIdx);
            itemMatchMap.set(idxA, { matchType: 'L2', targetIndex: foundBIdx });
            matchedL2Count++;
            const qA = itemA.quantity;
            const qB = validItemsB[foundBIdx].quantity;
            if (qA > 0 && qB > 0) {
                matchedPairsQtyRatio.push(Math.min(qA, qB) / Math.max(qA, qB));
            }
        } else {
            itemMatchMap.set(idxA, { matchType: 'NONE' });
        }
    });

    // 2. IDF 가중 품목 스펙 점수 산출
    let weightedIntersection = 0;
    let weightedUnion = 0;
    const allL1Keys = new Set<string>();

    validItemsA.forEach(it => allL1Keys.add(it.l1Key));
    validItemsB.forEach(it => allL1Keys.add(it.l1Key));

    allL1Keys.forEach(k => {
        const idf = idfMap.get(k) ?? 1.0;
        weightedUnion += idf;
    });

    itemMatchMap.forEach((match, idxA) => {
        const itemA = validItemsA[idxA];
        const idf = idfMap.get(itemA.l1Key) ?? 1.0;
        if (match.matchType === 'L1') weightedIntersection += idf * 1.0;
        else if (match.matchType === 'L2') weightedIntersection += idf * 0.5;
    });

    const specScore = weightedUnion > 0 ? Math.min(100, Math.round((weightedIntersection / weightedUnion) * 1000) / 10) : 0;

    // 3. 수량 패턴 점수 산출
    let qtyScore = 0;
    if (matchedPairsQtyRatio.length > 0) {
        const avgQtyMatch = matchedPairsQtyRatio.reduce((s, r) => s + r, 0) / matchedPairsQtyRatio.length;
        qtyScore = Math.round(avgQtyMatch * 1000) / 10;
    }

    // 전 품목 일정 배수 판정 (스케일 변형)
    let isScaleVariant = false;
    let scaleRatio: number | undefined;
    if (matchedPairsQtyRatio.length >= 3) {
        const ratios: number[] = [];
        itemMatchMap.forEach((m, idxA) => {
            if (m.targetIndex !== undefined) {
                const qA = validItemsA[idxA].quantity;
                const qB = validItemsB[m.targetIndex].quantity;
                if (qA > 0 && qB > 0) ratios.push(Math.round((qA / qB) * 10) / 10);
            }
        });
        if (ratios.length >= 3 && ratios.every(r => Math.abs(r - ratios[0]) <= 0.1) && ratios[0] !== 1.0) {
            isScaleVariant = true;
            scaleRatio = ratios[0];
        }
    }

    // 4. 순서 일치율 산출 (LCS 정규화: max(|A|, |B|))
    const seqA = validItemsA.map(it => it.l1Key);
    const seqB = validItemsB.map(it => it.l1Key);
    const rawLcs = calculateLCS(seqA, seqB);
    const maxLen = Math.max(seqA.length, seqB.length);
    let seqScore = maxLen > 0 ? (rawLcs / maxLen) * 100 : 0;

    // 표준 정렬 감점 (구경 오름/내림차순 정렬인 경우 50% 감점)
    if (isStandardSorted(validItemsA) && isStandardSorted(validItemsB)) {
        seqScore *= 0.5;
    }
    seqScore = Math.round(seqScore * 10) / 10;

    // 5. 종합 점수 가중치 공식 (대형 견적은 품목 스펙 일치 비중을 강화하여 수량/순서 왜곡 방지)
    let totalScore = 0;
    if (validItemsA.length < 3 || validItemsB.length < 3) {
        // 3품목 미만: 순서 점수 미사용 (스펙 70% + 수량 30%)
        totalScore = Math.round((0.70 * specScore + 0.30 * qtyScore) * 10) / 10;
    } else if (validItemsA.length >= 20 || validItemsB.length >= 20) {
        // 대형 견적 (20품목 이상): 품목 스펙 일치도가 핵심 (스펙 75% + 수량 15% + 순서 10%)
        totalScore = Math.round((0.75 * specScore + 0.15 * qtyScore + 0.10 * seqScore) * 10) / 10;
    } else {
        // 표준: 스펙 60% + 수량 25% + 순서 15%
        totalScore = Math.round((0.60 * specScore + 0.25 * qtyScore + 0.15 * seqScore) * 10) / 10;
    }

    // 6. 고객 및 경과일 분석
    const cleanCustA = stripCorp(docA.customerName);
    const cleanCustB = stripCorp(docB.customerName);
    const bizA = normalizeBizNo(docA.bizNo);
    const bizB = normalizeBizNo(docB.bizNo);

    const isSameCustomer = (bizA && bizB && bizA === bizB) || (cleanCustA && cleanCustB && cleanCustA === cleanCustB);

    const dateA = new Date(docA.createdAt).getTime();
    const dateB = new Date(docB.createdAt).getTime();
    const diffDays = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);

    // 동일 고객인 경우 최대 1년(365일) 이내 건만 대조
    const maxDays = thresholds.SAME_CUSTOMER_MAX_DAYS ?? 365;
    if (isSameCustomer && diffDays > maxDays) {
        return null;
    }

    const overlapRatio = validItemsA.length > 0 ? (matchedL1Count + matchedL2Count) / validItemsA.length : 0;

    // 7. 유형 판정 (50점 이상 유의 알림)
    let similarityType: SimilarityType = 'NONE';
    const rationale: string[] = [];

    // [DUPLICATE] 같은 고객, S >= 80, 30일 이내
    if (isSameCustomer && totalScore >= thresholds.DUPLICATE_MIN_SCORE && diffDays <= thresholds.DUPLICATE_MAX_DAYS) {
        similarityType = 'DUPLICATE';
        rationale.push(`동일고객 최근 ${Math.round(diffDays)}일 전 중복 견적 (${totalScore}점)`);
    }
    // [SHORTAGE] 같은 고객, 포함도 >= 0.7, 수량 비율 <= 40%, 180일 이내 (발주건 대조 시 최우선)
    else if (isSameCustomer && overlapRatio >= thresholds.SHORTAGE_MIN_OVERLAP && (qtyScore <= thresholds.SHORTAGE_MAX_QTY_RATIO * 100 || docA.items.reduce((s,i)=>s+i.quantity,0) < docB.items.reduce((s,i)=>s+i.quantity,0) * 0.4) && diffDays <= thresholds.SHORTAGE_MAX_DAYS) {
        similarityType = 'SHORTAGE';
        rationale.push(`동일고객 지난 발주 품목 ${Math.round(overlapRatio * 100)}% 포함 (쇼티지 소량 추가 의심)`);
    }
    // [REPEAT] 같은 고객, S >= 50, 1년(365일) 이내 동사/반복 유의 견적
    else if (isSameCustomer && totalScore >= (thresholds.REPEAT_MIN_SCORE ?? 50) && diffDays <= maxDays) {
        similarityType = 'REPEAT';
        if (diffDays <= thresholds.DUPLICATE_MAX_DAYS) {
            rationale.push(`동사/반복 유의 (동일고객 최근 ${Math.round(diffDays)}일 전 유사 견적, ${totalScore}점)`);
        } else {
            rationale.push(`동사/반복 유의 (동일고객 이전 ${Math.round(diffDays)}일 전 발주/견적 패턴, ${totalScore}점)`);
        }
    }
    // [SAME_PROJECT] 다른 고객, S >= 50, 180일 이내 타사/경쟁 유의
    else if (!isSameCustomer && totalScore >= thresholds.SAME_PROJECT_MIN_SCORE && diffDays <= thresholds.SAME_PROJECT_MAX_DAYS) {
        similarityType = 'SAME_PROJECT';
        rationale.push(`타사/경쟁 유의 (타 거래처 ${docB.customerName}와 동일 현장 의심, ${totalScore}점)`);
        if (rareItemsMatchedCount >= 2) rationale.push(`희귀 품목 ${rareItemsMatchedCount}종 일치`);
        if (seqScore >= 50) rationale.push(`BOM 순서 일치도 ${seqScore}%`);
    }

    if (isScaleVariant && scaleRatio) {
        rationale.push(`전 품목 ${scaleRatio}배 규모 변형`);
    }

    // 50점 이상이면 무조건 알림이 가도록 유형 보정
    const minAlertScore = thresholds.GENERAL_MIN_SCORE ?? 50;
    if (similarityType === 'NONE' && totalScore >= minAlertScore) {
        similarityType = isSameCustomer ? 'REPEAT' : 'SAME_PROJECT';
        rationale.push(`유사도 감지 (${totalScore}점)`);
    }

    // 50점 미만은 매칭 제외
    if (totalScore < minAlertScore) {
        return null;
    }

    return {
        targetId: docB.id,
        targetType: docB.type,
        targetDocNo: docB.docNo,
        customerName: docB.customerName,
        businessNo: docB.bizNo,
        createdAt: docB.createdAt,
        similarityType,
        totalScore,
        specScore,
        qtyScore,
        seqScore,
        overlapRatio: Math.round(overlapRatio * 1000) / 10,
        matchedL1Count,
        matchedL2Count,
        totalItemsA: validItemsA.length,
        totalItemsB: validItemsB.length,
        rareItemsMatchedCount,
        isScaleVariant,
        scaleRatio,
        rationale,
        itemsA: validItemsA,
        itemsB: validItemsB,
        itemMatchMap
    };
}
