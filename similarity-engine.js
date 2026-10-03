/**
 * ALTF 견적·발주 유사도 평가 공용 백엔드 엔진 (Node.js ES 모듈)
 * local-api-server.js 및 배치 스크립트에서 공용으로 사용
 */

export const THRESHOLDS = {
    DUPLICATE_MIN_SCORE: 85,
    DUPLICATE_MAX_DAYS: 30,

    SAME_PROJECT_MIN_SCORE: 75,
    SAME_PROJECT_MIN_SEQ: 60,
    SAME_PROJECT_MIN_RARE_ITEMS: 3,
    SAME_PROJECT_MAX_DAYS: 90,

    SHORTAGE_MIN_OVERLAP: 0.8,
    SHORTAGE_MAX_QTY_RATIO: 0.40,
    SHORTAGE_MAX_DAYS: 120,

    REPEAT_MIN_SCORE: 80,
    REPEAT_MIN_DAYS: 30
};

export const ITEM_NAME_ALIASES = {
    'STUB END': 'STUBEND',
    'STUB-END': 'STUBEND',
    'STUBEND': 'STUBEND',
    '스텁엔드': 'STUBEND',
    'LATERAL': 'LATERAL TEE',
    'LATERAL TEE': 'LATERAL TEE',
    '라테랄': 'LATERAL TEE',
    'R(C))': 'R(C)',
    'R(C)': 'R(C)',
    'R(E))': 'R(E)',
    'R(E)': 'R(E)',
    '90E(L)': '90E(L)',
    '90EL': '90E(L)',
    '90E(S)': '90E(S)',
    '90ES': '90E(S)',
    '45E(L)': '45E(L)',
    '45EL': '45E(L)',
    'TEE': 'TEE',
    '티': 'TEE',
    'CAP': 'CAP',
    '캡': 'CAP'
};

export const NON_ITEM_KEYWORDS = ['운임', '운임비', '화물', '착불', '배송비', 'D/C', 'DC', '할인', '기타', '네고', '절사'];

export const INCH_TO_A_MAP = {
    '1/8': 6, '1/4': 8, '3/8': 10, '1/2': 15, '3/4': 20, '1': 25,
    '1 1/4': 32, '1-1/4': 32, '1.25': 32, '1 1/2': 40, '1-1/2': 40, '1.5': 40,
    '2': 50, '2 1/2': 65, '2-1/2': 65, '2.5': 65, '3': 80, '3 1/2': 90, '3-1/2': 90, '3.5': 90,
    '4': 100, '5': 125, '6': 150, '8': 200, '10': 250, '12': 300, '14': 350, '16': 400, '18': 450, '20': 500, '24': 600
};

export function stripCorp(name) {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '').replace(/[^a-zA-Z0-9가-힣]/g, '').trim();
}

export function normalizeBizNo(bizNo) {
    return (bizNo || '').replace(/[^0-9]/g, '');
}

export function normalizeThickness(thickness) {
    if (!thickness) return '';
    const clean = thickness.toUpperCase().replace(/\s/g, '');
    if (clean === '10S' || clean === 'SCH10S' || clean === 'S10') return 'S10S';
    if (clean === '20S' || clean === 'SCH20S' || clean === 'S20') return 'S20S';
    if (clean === '40S' || clean === 'SCH40S' || clean === 'S40' || clean === 'STD') return 'S40S';
    if (clean === '80S' || clean === 'SCH80S' || clean === 'S80' || clean === 'XS') return 'S80S';
    if (clean === '160S' || clean === 'SCH160S' || clean === 'S160' || clean === 'XXS') return 'S160S';
    return clean;
}

export function normalizeSingleSizePart(part) {
    const trimmed = part.trim().toUpperCase();
    if (!trimmed) return '';
    const matchA = trimmed.match(/^(\d+)\s*A$/i);
    if (matchA) return `${matchA[1]}A`;
    const cleanInch = trimmed.replace(/["”″]/g, '').trim();
    if (INCH_TO_A_MAP[cleanInch] !== undefined) return `${INCH_TO_A_MAP[cleanInch]}A`;
    const val = parseFloat(cleanInch);
    if (!isNaN(val)) {
        if (val >= 15) return `${Math.round(val)}A`;
        if (INCH_TO_A_MAP[String(val)]) return `${INCH_TO_A_MAP[String(val)]}A`;
    }
    return trimmed;
}

export function normalizeSizeA(sizeStr) {
    if (!sizeStr) return '';
    const parts = sizeStr.split(/[\s*xX]+/).filter(Boolean);
    if (parts.length === 0) return '';
    return parts.map(p => normalizeSingleSizePart(p)).join(' X ');
}

export function extractMaterialFamily(matStr) {
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

export function normalizeLineItem(item) {
    const rawName = (item.name || item.item_name || '').trim();
    const upper = `${rawName} ${item.note || ''}`.toUpperCase();
    const isNonItem = !rawName || NON_ITEM_KEYWORDS.some(kw => upper.includes(kw.toUpperCase()));

    const upperName = rawName.toUpperCase();
    const normName = ITEM_NAME_ALIASES[upperName] || upperName.replace(/[\s\-_]/g, '');
    const normThick = normalizeThickness(item.thickness);
    const sizeA = normalizeSizeA(item.size);
    const normMaterial = (item.material || '').toUpperCase().replace(/\s+/g, '').trim();
    const materialFamily = extractMaterialFamily(normMaterial);

    const l1Key = `${normName}|${normThick}|${sizeA}|${normMaterial}`;
    const l2Key = `${normName}|${sizeA}|${materialFamily}`;

    return {
        raw: item,
        l1Key,
        l2Key,
        normName,
        normThick,
        sizeA,
        normMaterial,
        materialFamily,
        quantity: Math.max(0, item.quantity ?? item.qty ?? 0),
        unitPrice: item.unitPrice ?? item.unit_price ?? 0,
        basePrice: item.base_price ?? 0,
        isNonItem
    };
}

export function calculateLCS(seqA, seqB) {
    const m = seqA.length;
    const n = seqB.length;
    if (m === 0 || n === 0) return 0;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (seqA[i - 1] === seqB[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
            else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[m][n];
}

export function isStandardSorted(items) {
    if (items.length < 3) return false;
    let asc = true, desc = true;
    for (let i = 1; i < items.length; i++) {
        const prev = parseInt(items[i - 1].sizeA, 10) || 0;
        const curr = parseInt(items[i].sizeA, 10) || 0;
        if (prev > curr) asc = false;
        if (prev < curr) desc = false;
    }
    return asc || desc;
}

/**
 * 단일 문서에 대해 전체 DB 문서 집합과의 유사도를 고속 평가하여 similarity 요약 객체 반환
 */
export function computeDocumentSimilaritySummary(targetDoc, allDocs, idfMap) {
    const validItemsA = (targetDoc.items || []).map(normalizeLineItem).filter(i => !i.isNonItem && i.l1Key.length > 5);
    if (validItemsA.length === 0) {
        return { topType: 'NONE', topScore: 0 };
    }

    const itemKeySetA = new Set(validItemsA.map(it => it.l1Key));
    let bestMatch = null;

    for (const otherDoc of allDocs) {
        if (otherDoc.id === targetDoc.id || otherDoc.isDeleted) continue;
        if (otherDoc.id === targetDoc.linkedQuoteId || otherDoc.linkedQuoteId === targetDoc.id) continue;

        const validItemsB = (otherDoc.items || []).map(normalizeLineItem).filter(i => !i.isNonItem && i.l1Key.length > 5);
        if (validItemsB.length === 0) continue;

        // 빠른 교집합 검사
        let hasCommon = false;
        for (const itB of validItemsB) {
            if (itemKeySetA.has(itB.l1Key)) {
                hasCommon = true;
                break;
            }
        }
        if (!hasCommon) continue;

        // L1 / L2 매칭
        const matchedBIndices = new Set();
        let matchedL1Count = 0;
        let matchedL2Count = 0;
        let rareCount = 0;
        const qtyRatios = [];

        validItemsA.forEach(itA => {
            for (let bIdx = 0; bIdx < validItemsB.length; bIdx++) {
                if (matchedBIndices.has(bIdx)) continue;
                if (itA.l1Key === validItemsB[bIdx].l1Key) {
                    matchedBIndices.add(bIdx);
                    matchedL1Count++;
                    const idf = (idfMap && idfMap.get(itA.l1Key)) || 1.0;
                    if (idf >= 3.0) rareCount++;
                    if (itA.quantity > 0 && validItemsB[bIdx].quantity > 0) {
                        qtyRatios.push(Math.min(itA.quantity, validItemsB[bIdx].quantity) / Math.max(itA.quantity, validItemsB[bIdx].quantity));
                    }
                    break;
                }
            }
        });

        const unionKeys = new Set([...itemKeySetA, ...validItemsB.map(it => it.l1Key)]);
        let wUnion = 0;
        unionKeys.forEach(k => wUnion += ((idfMap && idfMap.get(k)) || 1.0));

        let wInter = 0;
        validItemsA.forEach(itA => {
            const idf = (idfMap && idfMap.get(itA.l1Key)) || 1.0;
            if (validItemsB.some(b => b.l1Key === itA.l1Key)) wInter += idf;
        });

        const specScore = wUnion > 0 ? Math.min(100, Math.round((wInter / wUnion) * 1000) / 10) : 0;
        const avgQty = qtyRatios.length > 0 ? (qtyRatios.reduce((a, b) => a + b, 0) / qtyRatios.length) * 100 : 0;
        const qtyScore = Math.round(avgQty * 10) / 10;

        const seqA = validItemsA.map(it => it.l1Key);
        const seqB = validItemsB.map(it => it.l1Key);
        const lcs = calculateLCS(seqA, seqB);
        const maxLen = Math.max(seqA.length, seqB.length);
        let seqScore = maxLen > 0 ? (lcs / maxLen) * 100 : 0;
        if (isStandardSorted(validItemsA) && isStandardSorted(validItemsB)) seqScore *= 0.5;
        seqScore = Math.round(seqScore * 10) / 10;

        let totalScore = 0;
        if (validItemsA.length < 3 || validItemsB.length < 3) {
            totalScore = Math.round((0.70 * specScore + 0.30 * qtyScore) * 10) / 10;
        } else {
            totalScore = Math.round((0.55 * specScore + 0.25 * qtyScore + 0.20 * seqScore) * 10) / 10;
        }

        const custA = stripCorp(targetDoc.customerName || targetDoc.customerInfo?.companyName);
        const custB = stripCorp(otherDoc.customerName || otherDoc.customerInfo?.companyName);
        const bizA = normalizeBizNo(targetDoc.customerInfo?.bizNo);
        const bizB = normalizeBizNo(otherDoc.customerInfo?.bizNo);
        const isSameCust = (bizA && bizB && bizA === bizB) || (custA && custB && custA === custB);

        const dtA = new Date(targetDoc.createdAt || '2026-01-01').getTime();
        const dtB = new Date(otherDoc.createdAt || '2026-01-01').getTime();
        const diffDays = Math.abs(dtA - dtB) / (1000 * 60 * 60 * 24);

        let type = 'NONE';
        if (isSameCust && totalScore >= THRESHOLDS.DUPLICATE_MIN_SCORE && diffDays <= THRESHOLDS.DUPLICATE_MAX_DAYS) {
            type = 'DUPLICATE';
        } else if (!isSameCust && totalScore >= THRESHOLDS.SAME_PROJECT_MIN_SCORE && (seqScore >= THRESHOLDS.SAME_PROJECT_MIN_SEQ || rareCount >= THRESHOLDS.SAME_PROJECT_MIN_RARE_ITEMS) && diffDays <= THRESHOLDS.SAME_PROJECT_MAX_DAYS) {
            type = 'SAME_PROJECT';
        } else if (isSameCust && totalScore >= THRESHOLDS.REPEAT_MIN_SCORE && diffDays > THRESHOLDS.REPEAT_MIN_DAYS) {
            type = 'REPEAT';
        }

        if (type !== 'NONE' && (!bestMatch || totalScore > bestMatch.topScore)) {
            bestMatch = {
                topType: type,
                topScore: totalScore,
                relatedDocNo: otherDoc.id,
                targetCustomer: otherDoc.customerName || otherDoc.customerInfo?.companyName || ''
            };
        }
    }

    return bestMatch || { topType: 'NONE', topScore: 0 };
}
