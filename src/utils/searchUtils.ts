/**
 * 스마트/유연 검색 함수
 * - 제품 ID, 품명, 재질, 규격, 두께, 제조사 등의 속성을 조합하여 정밀 및 스마트 매칭
 * - 공백, 하이픈(-), 괄호(()), 슬래시(/) 등 기호 제거 정규화 검색 지원
 * - 다중 토큰 AND 조건 매칭 (예: "90e 250a sts304")
 */
export function matchesSmartSearch(
    target: { id?: string; name?: string; material?: string; size?: string; thickness?: string; maker?: string },
    searchQuery: string
): boolean {
    if (!searchQuery || !searchQuery.trim()) return true;

    const id = (target.id || '').toLowerCase();
    const name = (target.name || '').toLowerCase();
    const material = (target.material || '').toLowerCase();
    const size = (target.size || '').toLowerCase();
    const thickness = (target.thickness || '').toLowerCase();
    const maker = (target.maker || '').toLowerCase();

    const fullTargetText = `${id} ${name} ${material} ${size} ${thickness} ${maker}`.toLowerCase();
    const normalizedTargetText = fullTargetText.replace(/[\s\-()/_.,]/g, '');

    const query = searchQuery.trim().toLowerCase();
    const normalizedQuery = query.replace(/[\s\-()/_.,]/g, '');

    // 1. 정규화 쿼리가 대상 텍스트에 완전히 포함되는지 검사 (최우선 exact/partial 포함)
    if (normalizedTargetText.includes(normalizedQuery)) return true;

    // 2. 토큰 분할 AND 검사
    const rawTokens = query.split(/[\s\-()/_.,]+/).filter(Boolean);
    if (rawTokens.length > 0) {
        const allTokensMatched = rawTokens.every(token => {
            const normToken = token.replace(/[\s\-()/_.,]/g, '');
            if (!normToken) return true;

            // 서픽스 구분 토큰 ('w', 's', 'l')은 명확한 위치 매칭 확인
            if (normToken === 'w') {
                return id.endsWith('-w') || id.includes('-w-') || fullTargetText.includes(' w ') || fullTargetText.endsWith(' w');
            }
            if (normToken === 's' && (token === 's' || token === '(s)')) {
                return id.endsWith('-s') || id.includes('(s)') || id.includes('-s-');
            }
            if (normToken === 'l' && (token === 'l' || token === '(l)')) {
                return id.includes('(l)') || id.includes('-l-') || id.endsWith('-l');
            }

            // 일반 토큰 포함 여부
            if (fullTargetText.includes(token) || normalizedTargetText.includes(normToken)) return true;

            return false;
        });

        if (allTokensMatched) return true;
    }

    return false;
}

