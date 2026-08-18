export type RegionType = 'SIHWA' | 'BUSAN' | 'UNASSIGNED';

export interface CustomerRegionInfo {
    region: RegionType;
    label: string;
    isUnassigned: boolean;
}

/**
 * 주소 및 거래처 정보를 기점으로 중부권(시화) / 남부권(부산) / 미분류 파싱
 */
export function getCustomerRegion(address?: string, regionOverride?: string): CustomerRegionInfo {
    if (regionOverride === 'SIHWA' || regionOverride === '중부' || regionOverride === '시화') {
        return { region: 'SIHWA', label: '중부권(시화)', isUnassigned: false };
    }
    if (regionOverride === 'BUSAN' || regionOverride === '남부' || regionOverride === '부산') {
        return { region: 'BUSAN', label: '남부권(부산)', isUnassigned: false };
    }

    if (!address || typeof address !== 'string' || address.trim() === '') {
        return { region: 'UNASSIGNED', label: '미분류(지역 미지정)', isUnassigned: true };
    }

    const addr = address.trim();

    // 중부권 (시화 거점): 서울, 경기, 강원, 충남, 충북, 세종, 대전
    const isSihwaRegion = /서울|경기|강원|충남|충북|충청남도|충청북도|세종|대전/i.test(addr);

    // 남부권 (부산 거점): 부산, 경남, 경북, 전남, 전북, 대구, 광주, 울산, 제주
    const isBusanRegion = /부산|경남|경북|경상남도|경상북도|전남|전북|전라남도|전라북도|대구|광주|울산|제주/i.test(addr);

    if (isSihwaRegion && !isBusanRegion) {
        return { region: 'SIHWA', label: '중부권(시화)', isUnassigned: false };
    }

    if (isBusanRegion && !isSihwaRegion) {
        return { region: 'BUSAN', label: '남부권(부산)', isUnassigned: false };
    }

    // 주소는 있으나 모호한 경우 미분류 처리
    return { region: 'UNASSIGNED', label: '미분류(지역 지정 필요)', isUnassigned: true };
}
