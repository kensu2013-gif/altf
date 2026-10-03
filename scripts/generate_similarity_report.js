import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 설정 상수
const THRESHOLDS = {
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

const ITEM_NAME_ALIASES = {
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

const NON_ITEM_KEYWORDS = ['운임', '운임비', '화물', '착불', '배송비', 'D/C', 'DC', '할인', '기타', '네고', '절사'];

const INCH_TO_A_MAP = {
    '1/8': 6, '1/4': 8, '3/8': 10, '1/2': 15, '3/4': 20, '1': 25,
    '1 1/4': 32, '1-1/4': 32, '1.25': 32, '1 1/2': 40, '1-1/2': 40, '1.5': 40,
    '2': 50, '2 1/2': 65, '2-1/2': 65, '2.5': 65, '3': 80, '3 1/2': 90, '3-1/2': 90, '3.5': 90,
    '4': 100, '5': 125, '6': 150, '8': 200, '10': 250, '12': 300, '14': 350, '16': 400, '18': 450, '20': 500, '24': 600
};

function stripCorp(name) {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '').replace(/[^a-zA-Z0-9가-힣]/g, '').trim();
}

function normalizeBizNo(bizNo) {
    return (bizNo || '').replace(/[^0-9]/g, '');
}

function normalizeThickness(thickness) {
    if (!thickness) return '';
    const clean = thickness.toUpperCase().replace(/\s/g, '');
    if (clean === '10S' || clean === 'SCH10S' || clean === 'S10') return 'S10S';
    if (clean === '20S' || clean === 'SCH20S' || clean === 'S20') return 'S20S';
    if (clean === '40S' || clean === 'SCH40S' || clean === 'S40' || clean === 'STD') return 'S40S';
    if (clean === '80S' || clean === 'SCH80S' || clean === 'S80' || clean === 'XS') return 'S80S';
    if (clean === '160S' || clean === 'SCH160S' || clean === 'S160' || clean === 'XXS') return 'S160S';
    return clean;
}

function normalizeSingleSizePart(part) {
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

function normalizeSizeA(sizeStr) {
    if (!sizeStr) return '';
    const parts = sizeStr.split(/[\s*xX]+/).filter(Boolean);
    if (parts.length === 0) return '';
    return parts.map(p => normalizeSingleSizePart(p)).join(' X ');
}

function extractMaterialFamily(matStr) {
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

function normalizeLineItem(item) {
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

function calculateLCS(seqA, seqB) {
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

function isStandardSorted(items) {
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

// 메인 실행
async function run() {
    console.log('🔍 ALTF 견적·발주 유사도 평가 1단계 과거 데이터 분석 리포트 생성 중...\n');

    const dbPath = path.resolve(__dirname, '../data/db.json');
    if (!fs.existsSync(dbPath)) {
        console.error('❌ data/db.json 파일을 찾을 수 없습니다.');
        return;
    }

    const rawDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const quotes = rawDb.quotations || [];
    const orders = rawDb.orders || [];

    console.log(`📊 데이터베이스 통계: 견적서 ${quotes.length}건, 발주서 ${orders.length}건`);

    // 유효 문서 파싱
    const validDocs = [];
    const idfDocFreq = new Map();

    quotes.forEach(q => {
        if (q.isDeleted) return;
        const items = (q.items || []).map(normalizeLineItem).filter(i => !i.isNonItem && i.l1Key.length > 5);
        if (items.length === 0) return;

        const customerName = q.customerName || q.customerInfo?.companyName || '';
        const bizNo = q.customerInfo?.bizNo || '';
        const createdAt = q.createdAt || q.created_at || '2026-01-01';

        const doc = {
            id: q.id,
            type: 'QUOTATION',
            docNo: q.id,
            customerName,
            bizNo,
            createdAt,
            items,
            itemKeySet: new Set(items.map(it => it.l1Key)),
            parentQuoteId: q.linkedQuoteId
        };
        validDocs.push(doc);

        doc.itemKeySet.forEach(k => {
            idfDocFreq.set(k, (idfDocFreq.get(k) || 0) + 1);
        });
    });

    const N = validDocs.length;
    const idfMap = new Map();
    idfDocFreq.forEach((count, key) => {
        idfMap.set(key, Math.log((N - count + 0.5) / (count + 0.5) + 1));
    });

    console.log(`📌 유효 견적 문서 ${N}건, 고유 품목 지문 ${idfMap.size}종 수집 완료.`);

    // 가장 흔한 품목 vs 희귀 품목 Top 5
    const sortedFreq = Array.from(idfDocFreq.entries()).sort((a, b) => b[1] - a[1]);
    console.log('\n[참고] 가장 빈번하게 등장한 Top 3 품목 (낮은 가중치):');
    sortedFreq.slice(0, 3).forEach(([k, c]) => console.log(`  - ${k}: ${c}회 등장 (IDF: ${idfMap.get(k).toFixed(2)})`));

    const matches = {
        DUPLICATE: [],
        SAME_PROJECT: [],
        SHORTAGE: [],
        REPEAT: []
    };

    let totalPairsChecked = 0;

    // 전체 쌍 비교 (대칭 최적화 i < j)
    for (let i = 0; i < validDocs.length; i++) {
        for (let j = i + 1; j < validDocs.length; j++) {
            const docA = validDocs[i];
            const docB = validDocs[j];

            // 계보 관계 제외
            if (docA.id === docB.parentQuoteId || docB.id === docA.parentQuoteId) continue;

            // 빠른 스크리닝: 품목 교집합이 최소 1개라도 있는지 확인
            let hasCommonKey = false;
            for (const k of docA.itemKeySet) {
                if (docB.itemKeySet.has(k)) {
                    hasCommonKey = true;
                    break;
                }
            }
            if (!hasCommonKey) continue;

            totalPairsChecked++;

            // 상세 비교
            const validItemsA = docA.items;
            const validItemsB = docB.items;

            const matchedBIndices = new Set();
            let matchedL1Count = 0;
            let matchedL2Count = 0;
            let rareItemsMatchedCount = 0;
            const matchedPairsQtyRatio = [];

            // L1
            validItemsA.forEach(itA => {
                for (let bIdx = 0; bIdx < validItemsB.length; bIdx++) {
                    if (matchedBIndices.has(bIdx)) continue;
                    if (itA.l1Key === validItemsB[bIdx].l1Key) {
                        matchedBIndices.add(bIdx);
                        matchedL1Count++;
                        const idf = idfMap.get(itA.l1Key) || 1.0;
                        if (idf >= 3.0) rareItemsMatchedCount++;
                        if (itA.quantity > 0 && validItemsB[bIdx].quantity > 0) {
                            matchedPairsQtyRatio.push(Math.min(itA.quantity, validItemsB[bIdx].quantity) / Math.max(itA.quantity, validItemsB[bIdx].quantity));
                        }
                        break;
                    }
                }
            });

            // L2
            validItemsA.forEach(itA => {
                for (let bIdx = 0; bIdx < validItemsB.length; bIdx++) {
                    if (matchedBIndices.has(bIdx)) continue;
                    if (itA.l2Key === validItemsB[bIdx].l2Key) {
                        matchedBIndices.add(bIdx);
                        matchedL2Count++;
                        if (itA.quantity > 0 && validItemsB[bIdx].quantity > 0) {
                            matchedPairsQtyRatio.push(Math.min(itA.quantity, validItemsB[bIdx].quantity) / Math.max(itA.quantity, validItemsB[bIdx].quantity));
                        }
                        break;
                    }
                }
            });

            const unionKeys = new Set([...docA.itemKeySet, ...docB.itemKeySet]);
            let wUnion = 0;
            unionKeys.forEach(k => wUnion += (idfMap.get(k) || 1.0));

            let wInter = 0;
            validItemsA.forEach(itA => {
                const idf = idfMap.get(itA.l1Key) || 1.0;
                // L1 또는 L2에 포함된 경우
                if (docB.itemKeySet.has(itA.l1Key)) wInter += idf * 1.0;
            });

            const specScore = wUnion > 0 ? Math.min(100, Math.round((wInter / wUnion) * 1000) / 10) : 0;
            const avgQty = matchedPairsQtyRatio.length > 0 ? (matchedPairsQtyRatio.reduce((a, b) => a + b, 0) / matchedPairsQtyRatio.length) * 100 : 0;
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

            const cleanA = stripCorp(docA.customerName);
            const cleanB = stripCorp(docB.customerName);
            const bA = normalizeBizNo(docA.bizNo);
            const bB = normalizeBizNo(docB.bizNo);
            const isSameCust = (bA && bB && bA === bB) || (cleanA && cleanB && cleanA === cleanB);

            const dtA = new Date(docA.createdAt).getTime();
            const dtB = new Date(docB.createdAt).getTime();
            const diffDays = Math.abs(dtA - dtB) / (1000 * 60 * 60 * 24);

            const pairInfo = {
                docA: `${docA.docNo} (${docA.customerName})`,
                docB: `${docB.docNo} (${docB.customerName})`,
                isSameCust,
                diffDays: Math.round(diffDays),
                totalScore,
                specScore,
                qtyScore,
                seqScore,
                matchedL1: matchedL1Count,
                matchedL2: matchedL2Count,
                rareCount: rareItemsMatchedCount,
                lenA: validItemsA.length,
                lenB: validItemsB.length
            };

            // 유형 분류 판정
            if (isSameCust && totalScore >= THRESHOLDS.DUPLICATE_MIN_SCORE && diffDays <= THRESHOLDS.DUPLICATE_MAX_DAYS) {
                matches.DUPLICATE.push(pairInfo);
            } else if (!isSameCust && totalScore >= THRESHOLDS.SAME_PROJECT_MIN_SCORE && (seqScore >= THRESHOLDS.SAME_PROJECT_MIN_SEQ || rareItemsMatchedCount >= THRESHOLDS.SAME_PROJECT_MIN_RARE_ITEMS) && diffDays <= THRESHOLDS.SAME_PROJECT_MAX_DAYS) {
                matches.SAME_PROJECT.push(pairInfo);
            } else if (isSameCust && totalScore >= THRESHOLDS.REPEAT_MIN_SCORE && diffDays > THRESHOLDS.REPEAT_MIN_DAYS) {
                matches.REPEAT.push(pairInfo);
            }
        }
    }

    console.log(`\n======================================================`);
    console.log(`📋 유사도 평가 엔진 실측 분석 결과 요약`);
    console.log(`======================================================`);
    console.log(`- 탐색 대상 견적 문서: ${N}건`);
    console.log(`- 품목 공유 검증 쌍: ${totalPairsChecked}쌍`);
    console.log(`- [DUPLICATE] 동일 고객 중복 (30일 이내 S≥85): ${matches.DUPLICATE.length}건`);
    console.log(`- [SAME_PROJECT] 타 고객 동일 현장 (90일 이내 S≥75): ${matches.SAME_PROJECT.length}건`);
    console.log(`- [REPEAT] 동일 고객 반복 발주 (30일 초과 S≥80): ${matches.REPEAT.length}건`);
    console.log(`======================================================\n`);

    if (matches.SAME_PROJECT.length > 0) {
        console.log('🔥 [SAME_PROJECT] 타 고객 동일 현장 대표 검출 사례 Top 3:');
        matches.SAME_PROJECT.slice(0, 3).forEach((m, idx) => {
            console.log(`  ${idx + 1}. [${m.totalScore}점 / 순서 ${m.seqScore}% / 희귀품목 ${m.rareCount}개]`);
            console.log(`     A: ${m.docA} (품목 ${m.lenA}개)`);
            console.log(`     B: ${m.docB} (품목 ${m.lenB}개)`);
            console.log(`     간격: ${m.diffDays}일 차이 (일치: L1 ${m.matchedL1}개, L2 ${m.matchedL2}개)\n`);
        });
    }

    if (matches.DUPLICATE.length > 0) {
        console.log('📌 [DUPLICATE] 동일 고객 중복 견적 대표 검출 사례 Top 3:');
        matches.DUPLICATE.slice(0, 3).forEach((m, idx) => {
            console.log(`  ${idx + 1}. [${m.totalScore}점 / ${m.diffDays}일 전 접수]`);
            console.log(`     A: ${m.docA}`);
            console.log(`     B: ${m.docB} (L1 일치 ${m.matchedL1}개)\n`);
        });
    }

    // 마크다운 리포트 저장
    const reportMdPath = path.resolve(__dirname, '../data/similarity_analysis_report.md');
    let md = `# 📊 ALTF 견적·발주 유사도 평가 실측 분석 리포트\n\n`;
    md += `- 생성일시: ${new Date().toISOString()}\n`;
    md += `- 분석 대상 견적 문서: **${N}건**\n`;
    md += `- 고유 품목 지문 수: **${idfMap.size}종**\n\n`;
    md += `## 1. 유형별 검출 통계\n\n`;
    md += `| 유형 | 감지 건수 | 적용 기준 |\n| :--- | :---: | :--- |\n`;
    md += `| **DUPLICATE** (동일 고객 중복) | **${matches.DUPLICATE.length}건** | 같은 고객, 종합 점수 ≥ 85점, 30일 이내 |\n`;
    md += `| **SAME_PROJECT** (타 고객 동일 현장) | **${matches.SAME_PROJECT.length}건** | 다른 고객, 종합 점수 ≥ 75점, (순서 ≥ 60% 또는 희귀품목 3개 일치), 90일 이내 |\n`;
    md += `| **REPEAT** (동일 고객 반복 발주) | **${matches.REPEAT.length}건** | 같은 고객, 종합 점수 ≥ 80점, 30일 초과 |\n\n`;

    md += `## 2. 타 고객 동일 현장 (SAME_PROJECT) 상세 매칭 내역\n\n`;
    matches.SAME_PROJECT.forEach((m, idx) => {
        md += `### ${idx + 1}. 종합 점수: ${m.totalScore}점 (경과일: ${m.diffDays}일)\n`;
        md += `- **문서 A**: ${m.docA} (품목 ${m.lenA}개)\n`;
        md += `- **문서 B**: ${m.docB} (품목 ${m.lenB}개)\n`;
        md += `- **상세 지표**: 스펙 일치도 ${m.specScore}% | 수량 일치도 ${m.qtyScore}% | BOM 순서 일치도 ${m.seqScore}%\n`;
        md += `- **일치 품목 수**: L1 정확 일치 ${m.matchedL1}개 / L2 계열 일치 ${m.matchedL2}개 (희귀품목 일치: ${m.rareCount}개)\n\n`;
    });

    fs.writeFileSync(reportMdPath, md, 'utf8');
    console.log(`✅ 상세 분석 리포트가 저장되었습니다: ${reportMdPath}`);
}

run().catch(console.error);
