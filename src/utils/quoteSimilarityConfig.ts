/**
 * 견적 및 발주 유사도 평가 시스템 설정 및 상수 (Quote Similarity Engine Config)
 */

export interface SimilarityThresholds {
    DUPLICATE_MIN_SCORE: number; // 동일 고객 중복 판정 최소 점수 (기본 80)
    DUPLICATE_MAX_DAYS: number;  // 동일 고객 중복 판정 유효 일수 (기본 30일)

    SAME_PROJECT_MIN_SCORE: number; // 타 고객 동일 현장 판정 최소 점수 (기본 50)
    SAME_PROJECT_MIN_SEQ: number;   // 타 고객 동일 현장 순서 일치도 기준 (기본 50)
    SAME_PROJECT_MIN_RARE_ITEMS: number; // 희귀 품목 일치 최소 개수 (기본 2개)
    SAME_PROJECT_MAX_DAYS: number;  // 동일 현장 판정 유효 일수 (기본 180일)

    SHORTAGE_MIN_OVERLAP: number;   // 쇼티지 포함도 |새∩기존| / |새| 기준 (기본 0.7)
    SHORTAGE_MAX_QTY_RATIO: number; // 쇼티지 수량 비율 기준 (기본 0.40)
    SHORTAGE_MAX_DAYS: number;      // 쇼티지 유효 출하/발주 일수 (기본 180일)

    REPEAT_MIN_SCORE: number;       // 동일 고객 반복/유사 발주 최소 점수 (50점 이상부터 유의 알림)
    REPEAT_MIN_DAYS: number;        // 반복 발주 판정 최소 경과 일수 (기본 30일)
    SAME_CUSTOMER_MAX_DAYS: number; // 동일 고객 비교 유효 기간 (1년: 365일)

    GENERAL_MIN_SCORE: number;      // 유사도 감지 및 알림 최소 점수 (50점)

    PRICE_STALE_DAYS: number;       // 단가 시세 변동 경고 일수 (기본 60일)
}

export const DEFAULT_SIMILARITY_THRESHOLDS: SimilarityThresholds = {
    DUPLICATE_MIN_SCORE: 80,
    DUPLICATE_MAX_DAYS: 30,

    SAME_PROJECT_MIN_SCORE: 50,
    SAME_PROJECT_MIN_SEQ: 50,
    SAME_PROJECT_MIN_RARE_ITEMS: 2,
    SAME_PROJECT_MAX_DAYS: 180,

    SHORTAGE_MIN_OVERLAP: 0.7,
    SHORTAGE_MAX_QTY_RATIO: 0.40,
    SHORTAGE_MAX_DAYS: 180,

    REPEAT_MIN_SCORE: 50,
    REPEAT_MIN_DAYS: 30,
    SAME_CUSTOMER_MAX_DAYS: 365, // 동일고객 1년(365일) 이내

    GENERAL_MIN_SCORE: 50, // 50점 이상부터 알림

    PRICE_STALE_DAYS: 60
};

/** 품목명 표준 별칭 사전 */
export const ITEM_NAME_ALIASES: Record<string, string> = {
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

/** 비품목 키워드 목록 (유사도 연산 제외) */
export const NON_ITEM_KEYWORDS = [
    '운임',
    '운임비',
    '화물',
    '착불',
    '배송비',
    'D/C',
    'DC',
    '할인',
    '기타',
    '네고',
    '절사'
];

/** 인치 표기 -> A 단위 정규화 매핑 */
export const INCH_TO_A_MAP: Record<string, number> = {
    '1/8': 6,
    '1/4': 8,
    '3/8': 10,
    '1/2': 15,
    '3/4': 20,
    '1': 25,
    '1 1/4': 32,
    '1-1/4': 32,
    '1.25': 32,
    '1 1/2': 40,
    '1-1/2': 40,
    '1.5': 40,
    '2': 50,
    '2 1/2': 65,
    '2-1/2': 65,
    '2.5': 65,
    '3': 80,
    '3 1/2': 90,
    '3-1/2': 90,
    '3.5': 90,
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
