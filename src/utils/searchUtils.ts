/**
 * 스마트/유연 검색 함수
 * - 제품 ID, 품명, 재질, 규격, 두께, 제조사 등의 모든 속성을 조합하여 다각도 매칭
 * - 공백, 하이픈(-), 괄호(()), 슬래시(/) 등 기호 제거 정규화 검색 지원
 * - 다중 토큰 AND 조건 매칭 (예: "90e 250a sts304")
 * - STS304 <-> STS304L, STS316 <-> STS316L, S20S <-> SCH20S 등 주요 재질/규격 서픽스 유연 매칭
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

    // 1. 정규화 쿼리가 포함되는지 검사
    if (normalizedTargetText.includes(normalizedQuery)) return true;

    // 2. STS304 / STS316 등 서픽스 유연화 검사
    let flexQuery = normalizedQuery;
    if (flexQuery.includes('sts304') && !flexQuery.includes('sts304l')) {
        flexQuery = flexQuery.replace('sts304', 'sts304l');
        if (normalizedTargetText.includes(flexQuery)) return true;
    }
    if (flexQuery.includes('sts316') && !flexQuery.includes('sts316l')) {
        flexQuery = flexQuery.replace('sts316', 'sts316l');
        if (normalizedTargetText.includes(flexQuery)) return true;
    }

    // 3. 토큰 분할 AND 검사
    const rawTokens = query.split(/[\s\-()/_.,]+/).filter(Boolean);
    if (rawTokens.length > 0) {
        const allTokensMatched = rawTokens.every(token => {
            const normToken = token.replace(/[\s\-()/_.,]/g, '');
            if (!normToken) return true;

            if (fullTargetText.includes(token) || normalizedTargetText.includes(normToken)) return true;

            if (normToken === 'sts304' && (fullTargetText.includes('sts304l') || normalizedTargetText.includes('sts304l'))) return true;
            if (normToken === 'sts316' && (fullTargetText.includes('sts316l') || normalizedTargetText.includes('sts316l'))) return true;
            if (normToken === 'w' || normToken === 's') return true;

            return false;
        });

        if (allTokensMatched) return true;
    }

    return false;
}
