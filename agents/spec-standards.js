/**
 * 규격 마스터 기준표 (Material & Inspection Standards Master DB)
 * 스테인리스 파이프 및 피팅(배관재)의 재질별 화학성분(Chemical) 및 기계적 성질(Mechanical) 기준치 (Max/Min)
 */

export const MATERIAL_SPECS = {
    // 1. STS 316L 계열 (ASTM A312 TP316L / KS B1543 STS316L-W / KS D3576 STS316L)
    'ASTM A312 TP316L': {
        name: 'ASTM A312 TP316L',
        inspectionSpec: 'KS B1543 STS316L-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.035, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 14.00, Cr: 18.00, Mo: 3.00 },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 10.00, Cr: 16.00, Mo: 2.00 }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 175, TS: 480, EL: 35, RA: null }
        }
    },
    'KS B1543 STS316L-W': {
        name: 'KS B1543 STS316L-W',
        inspectionSpec: 'KS B1543 STS316L-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.030, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 15.00, Cr: 18.00, Mo: 3.00 },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 12.00, Cr: 16.00, Mo: 2.00 }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 175, TS: 480, EL: 35, RA: null }
        }
    },
    'KS D3576 STS316L TP': {
        name: 'KS D3576 STS316L TP',
        inspectionSpec: 'KS B1543 STS316L-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.030, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 15.00, Cr: 18.00, Mo: 3.00 },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 12.00, Cr: 16.00, Mo: 2.00 }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 175, TS: 480, EL: 35, RA: null }
        }
    },

    // 2. STS 304 계열 (ASTM A312 TP304 / KS B1543 STS304-W / KS D3576 STS304 TP)
    'ASTM A312 TP304': {
        name: 'ASTM A312 TP304',
        inspectionSpec: 'KS B1543 STS304-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.080, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 11.00, Cr: 20.00, Mo: null },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 8.00, Cr: 18.00, Mo: null }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 205, TS: 515, EL: 35, RA: null }
        }
    },
    'KS D3576 STS304 TP': {
        name: 'KS D3576 STS304 TP',
        inspectionSpec: 'KS B1543 STS304-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.080, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 10.50, Cr: 20.00, Mo: null },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 8.00, Cr: 18.00, Mo: null }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 205, TS: 520, EL: 35, RA: null }
        }
    },
    'KS B1543 STS304-W': {
        name: 'KS B1543 STS304-W',
        inspectionSpec: 'KS B1543 STS304-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.080, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 10.50, Cr: 20.00, Mo: null },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 8.00, Cr: 18.00, Mo: null }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 205, TS: 520, EL: 35, RA: null }
        }
    },

    // 3. STS 316 일반 계열
    'ASTM A312 TP316': {
        name: 'ASTM A312 TP316',
        inspectionSpec: 'KS B1543 STS316-W /B1500',
        heatTreatment: '1050℃ Solution Annealing & Water Quenching',
        chemical: {
            max: { C: 0.080, Si: 1.00, Mn: 2.00, P: 0.045, S: 0.030, Ni: 14.00, Cr: 18.00, Mo: 3.00 },
            min: { C: null, Si: null, Mn: null, P: null, S: null, Ni: 10.00, Cr: 16.00, Mo: 2.00 }
        },
        mechanical: {
            max: { YS: null, TS: null, EL: null, RA: null },
            min: { YS: 205, TS: 515, EL: 35, RA: null }
        }
    }
};

/**
 * 재질 문자열로부터 가장 근접한 규격 마스터를 반환하는 스마트 매칭 함수
 */
export function resolveMaterialSpec(rawSpec) {
    if (!rawSpec) return MATERIAL_SPECS['ASTM A312 TP316L'];
    const normalized = rawSpec.trim().toUpperCase();

    // 1. 정확히 매칭되는 키 검색
    for (const key of Object.keys(MATERIAL_SPECS)) {
        if (normalized === key.toUpperCase()) {
            return MATERIAL_SPECS[key];
        }
    }

    // 2. 키워드 기반 유연한 매칭
    if (normalized.includes('316L')) {
        if (normalized.includes('D3576')) return MATERIAL_SPECS['KS D3576 STS316L TP'];
        if (normalized.includes('B1543')) return MATERIAL_SPECS['KS B1543 STS316L-W'];
        return MATERIAL_SPECS['ASTM A312 TP316L'];
    }

    if (normalized.includes('304')) {
        if (normalized.includes('D3576')) return MATERIAL_SPECS['KS D3576 STS304 TP'];
        if (normalized.includes('B1543')) return MATERIAL_SPECS['KS B1543 STS304-W'];
        return MATERIAL_SPECS['ASTM A312 TP304'];
    }

    if (normalized.includes('316')) {
        return MATERIAL_SPECS['ASTM A312 TP316'];
    }

    // 기본값
    return MATERIAL_SPECS['ASTM A312 TP316L'];
}
