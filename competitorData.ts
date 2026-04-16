// ============================================================
// 경쟁사 1년치 판매량 데이터 (ALTF 분석팀 제공, 2024 기준)
// 사용처: sihwainventory.tsx 최상단에 import 또는 직접 붙여넣기
//
// 연동 방법:
//   import { COMPETITOR_DATA } from './competitorData';
//   또는 sihwainventory.tsx 상단 상수 영역에 직접 복붙
// ============================================================

export interface CompetitorItem {
  compSales: number;  // 경쟁사 연간 판매량 (개)
  compFreq: number;   // 경쟁사 연간 판매 빈도 (회)
}

export const COMPETITOR_DATA: Record<string, CompetitorItem> = {

  // ─────────────────────────────────────────────
  // 90E(L) — S10S — STS304-W  [ 가장 큰 시장 ]
  // ─────────────────────────────────────────────
  '90E(L)-S10S-50A-STS304-W':  { compSales: 28745, compFreq: 764 },  // 시장합계 41,343 / 우리점유율 30.5%
  '90E(L)-S10S-25A-STS304-W':  { compSales: 28333, compFreq: 465 },  // 시장합계 45,486 / 우리점유율 37.7%
  '90E(L)-S10S-40A-STS304-W':  { compSales: 17939, compFreq: 426 },  // 시장합계 26,211 / 우리점유율 31.6%
  '90E(L)-S10S-15A-STS304-W':  { compSales: 16720, compFreq: 227 },  // 시장합계 24,149 / 우리점유율 30.8%
  '90E(L)-S10S-20A-STS304-W':  { compSales: 12654, compFreq: 182 },  // 시장합계 20,368 / 우리점유율 37.9%
  '90E(L)-S10S-32A-STS304-W':  { compSales: 12463, compFreq: 294 },  // 시장합계 19,412 / 우리점유율 35.8%
  '90E(L)-S10S-80A-STS304-W':  { compSales: 10912, compFreq: 576 },  // 시장합계 15,369 / 우리점유율 29.0%
  '90E(L)-S10S-65A-STS304-W':  { compSales: 9561,  compFreq: 472 },  // 시장합계 13,593 / 우리점유율 29.7%
  '90E(L)-S10S-100A-STS304-W': { compSales: 9432,  compFreq: 587 },  // 시장합계 12,038 / 우리점유율 21.6% ★재고확충급
  '90E(L)-S10S-150A-STS304-W': { compSales: 3280,  compFreq: 369 },
  '90E(L)-S10S-125A-STS304-W': { compSales: 2780,  compFreq: 278 },
  '90E(L)-S10S-200A-STS304-W': { compSales: 1369,  compFreq: 246 },
  '90E(L)-S10S-25A-STS316L-W': { compSales: 1290,  compFreq: 63  },
  '90E(L)-S10S-40A-STS316L-W': { compSales: 966,   compFreq: 45  },
  '90E(L)-S10S-50A-STS316L-W': { compSales: 923,   compFreq: 82  },
  '90E(L)-S10S-10A-STS304-W':  { compSales: 866,   compFreq: 10  },

  // ─────────────────────────────────────────────
  // 90E(L) — S20S / S40S
  // ─────────────────────────────────────────────
  '90E(L)-S20S-25A-STS304-W':  { compSales: 2648,  compFreq: 67  },  // 시장합계 4,982  / 우리점유율 46.8% ★경합
  '90E(L)-S20S-50A-STS304-W':  { compSales: 1959,  compFreq: 77  },
  '90E(L)-S20S-40A-STS304-W':  { compSales: 1280,  compFreq: 64  },
  '90E(L)-S20S-15A-STS304-W':  { compSales: 1065,  compFreq: 24  },
  '90E(L)-S20S-80A-STS304-W':  { compSales: 813,   compFreq: 67  },
  '90E(L)-S20S-65A-STS304-W':  { compSales: 722,   compFreq: 48  },
  '90E(L)-S20S-100A-STS304-W': { compSales: 610,   compFreq: 59  },
  '90E(L)-S20S-20A-STS304-W':  { compSales: 676,   compFreq: 20  },
  '90E(L)-S40S-25A-STS304-W':  { compSales: 1244,  compFreq: 44  },
  '90E(L)-S40S-40A-STS304-W':  { compSales: 664,   compFreq: 50  },

  // ─────────────────────────────────────────────
  // 90E(S) — S10S
  // ─────────────────────────────────────────────
  '90E(S)-S10S-40A-STS304-W':  { compSales: 1762,  compFreq: 50  },
  '90E(S)-S10S-50A-STS304-W':  { compSales: 1628,  compFreq: 82  },
  '90E(S)-S10S-100A-STS304-W': { compSales: 935,   compFreq: 87  },
  '90E(S)-S10S-150A-STS304-W': { compSales: 907,   compFreq: 117 },
  '90E(S)-S10S-80A-STS304-W':  { compSales: 906,   compFreq: 72  },
  '90E(S)-S10S-200A-STS304-W': { compSales: 824,   compFreq: 119 },
  '90E(S)-S10S-65A-STS304-W':  { compSales: 704,   compFreq: 44  },
  '90E(S)-S10S-25A-STS304-W':  { compSales: 696,   compFreq: 29  },
  '90E(S)-S10S-125A-STS304-W': { compSales: 552,   compFreq: 83  },
  '90E(S)-S20S-65A-STS304-W':  { compSales: 560,   compFreq: 14  },

  // ─────────────────────────────────────────────
  // T(S) — S10S  [ 수성 강화 구간 포함 ]
  // ─────────────────────────────────────────────
  'T(S)-S10S-25A-STS304-W':    { compSales: 7836,  compFreq: 189 },  // 시장합계 9,142  / 우리점유율 14.3% ★재고확충급
  'T(S)-S10S-50A-STS304-W':    { compSales: 5133,  compFreq: 388 },  // 시장합계 6,293  / 우리점유율 18.4% ★재고확충급
  'T(S)-S10S-15A-STS304-W':    { compSales: 3484,  compFreq: 90  },  // 시장합계 3,929  / 우리점유율 11.3% ★재고확충급
  'T(S)-S10S-100A-STS304-W':   { compSales: 2024,  compFreq: 314 },
  'T(S)-S10S-80A-STS304-W':    { compSales: 1900,  compFreq: 276 },
  'T(S)-S10S-32A-STS304-W':    { compSales: 1890,  compFreq: 101 },  // 시장합계 3,956  / 우리점유율 52.2% ★수성강화
  'T(S)-S10S-65A-STS304-W':    { compSales: 1495,  compFreq: 197 },
  'T(S)-S10S-40A-STS304-W':    { compSales: 2410,  compFreq: 169 },
  'T(S)-S10S-20A-STS304-W':    { compSales: 2505,  compFreq: 67  },
  'T(S)-S10S-150A-STS304-W':   { compSales: 714,   compFreq: 198 },
  'T(S)-S20S-25A-STS304-W':    { compSales: 548,   compFreq: 27  },

  // ─────────────────────────────────────────────
  // T(R) — S10S  [ 이경 / 레듀서 ]
  // ─────────────────────────────────────────────
  'T(R)-S10S-40A X 25A-STS304-W':  { compSales: 2916, compFreq: 72  },
  'T(R)-S10S-50A X 25A-STS304-W':  { compSales: 2243, compFreq: 118 },
  'T(R)-S10S-25A X 15A-STS304-W':  { compSales: 2220, compFreq: 108 },
  'T(R)-S10S-32A X 25A-STS304-W':  { compSales: 1874, compFreq: 49  },
  'T(R)-S10S-50A X 40A-STS304-W':  { compSales: 887,  compFreq: 78  },
  'T(R)-S10S-20A X 15A-STS304-W':  { compSales: 861,  compFreq: 40  },
  'T(R)-S10S-80A X 50A-STS304-W':  { compSales: 630,  compFreq: 117 },
  'T(R)-S10S-50A X 15A-STS304-W':  { compSales: 612,  compFreq: 56  },
  'T(R)-S10S-100A X 50A-STS304-W': { compSales: 701,  compFreq: 83  },
  'T(R)-S10S-40A X 15A-STS304-W':  { compSales: 701,  compFreq: 57  },
  'T(R)-S10S-32A X 15A-STS304-W':  { compSales: 554,  compFreq: 34  },
  'T(R)-S10S-25A X 20A-STS304-W':  { compSales: 540,  compFreq: 34  },

  // ─────────────────────────────────────────────
  // R(C) — S10S  [ 레듀싱 커플링 ]
  // ─────────────────────────────────────────────
  'R(C)-S10S-50A X 40A-STS304-W':   { compSales: 2621, compFreq: 177 },
  'R(C)-S10S-32A X 25A-STS304-W':   { compSales: 2248, compFreq: 65  },
  'R(C)-S10S-40A X 32A-STS304-W':   { compSales: 2087, compFreq: 84  },
  'R(C)-S10S-65A X 50A-STS304-W':   { compSales: 1843, compFreq: 167 },
  'R(C)-S10S-40A X 25A-STS304-W':   { compSales: 1652, compFreq: 93  },
  'R(C)-S10S-25A X 15A-STS304-W':   { compSales: 1420, compFreq: 74  },
  'R(C)-S10S-100A X 80A-STS304-W':  { compSales: 1243, compFreq: 167 },
  'R(C)-S10S-80A X 50A-STS304-W':   { compSales: 1238, compFreq: 167 },
  'R(C)-S10S-50A X 25A-STS304-W':   { compSales: 1008, compFreq: 87  },
  'R(C)-S10S-80A X 65A-STS304-W':   { compSales: 948,  compFreq: 130 },
  'R(C)-S10S-50A X 32A-STS304-W':   { compSales: 908,  compFreq: 86  },
  'R(C)-S10S-125A X 100A-STS304-W': { compSales: 682,  compFreq: 144 },
  'R(C)-S10S-100A X 65A-STS304-W':  { compSales: 526,  compFreq: 78  },
  'R(C)-S10S-25A X 20A-STS304-W':   { compSales: 561,  compFreq: 48  },

  // ─────────────────────────────────────────────
  // CAP — S10S  [ 수성 강화 구간 포함 ]
  // ─────────────────────────────────────────────
  'CAP-S10S-50A-STS304-S':   { compSales: 2872, compFreq: 137 },
  'CAP-S10S-80A-STS304-S':   { compSales: 2208, compFreq: 143 },
  'CAP-S10S-25A-STS304-S':   { compSales: 2169, compFreq: 82  },
  'CAP-S10S-100A-STS304-S':  { compSales: 1668, compFreq: 178 },
  'CAP-S10S-15A-STS304-S':   { compSales: 1453, compFreq: 32  },
  'CAP-S10S-65A-STS304-S':   { compSales: 1301, compFreq: 94  },
  'CAP-S10S-40A-STS304-S':   { compSales: 1283, compFreq: 63  },
  'CAP-S10S-32A-STS304-S':   { compSales: 1258, compFreq: 59  },  // 우리 점유율 63.8% ★수성강화
  'CAP-S10S-20A-STS304-S':   { compSales: 1140, compFreq: 34  },
  'CAP-S10S-125A-STS304-S':  { compSales: 604,  compFreq: 83  },
  'CAP-S10S-150A-STS304-S':  { compSales: 501,  compFreq: 95  },

  // ─────────────────────────────────────────────
  // 45E(L) — S10S
  // ─────────────────────────────────────────────
  '45E(L)-S10S-50A-STS304-W':  { compSales: 1906, compFreq: 87  },
  '45E(L)-S10S-25A-STS304-W':  { compSales: 1747, compFreq: 52  },
  '45E(L)-S10S-20A-STS304-W':  { compSales: 1064, compFreq: 17  },
  '45E(L)-S10S-65A-STS304-W':  { compSales: 979,  compFreq: 71  },
  '45E(L)-S10S-32A-STS304-W':  { compSales: 877,  compFreq: 36  },
  '45E(L)-S10S-100A-STS304-W': { compSales: 843,  compFreq: 119 },
  '45E(L)-S10S-80A-STS304-W':  { compSales: 686,  compFreq: 88  },
  '45E(L)-S10S-40A-STS304-W':  { compSales: 641,  compFreq: 42  },
  '45E(L)-S10S-150A-STS304-W': { compSales: 593,  compFreq: 112 },
  '45E(L)-S10S-15A-STS304-W':  { compSales: 550,  compFreq: 15  },

} as const;


// ============================================================
// 유틸리티 함수 — sihwainventory.tsx에서 직접 사용
// ============================================================

/** 전략 등급 반환 */
export type StrategicGrade = 'A1' | 'A2' | 'B1' | 'B2' | 'B3' | 'C1' | 'C2' | 'D';

export function getStrategicGrade(
  ourSales: number,
  compSales: number,
  marketShare: number
): StrategicGrade {
  const total = ourSales + compSales;
  if (total === 0) return 'D';
  if (ourSales >= 5000 && compSales >= 5000) return marketShare >= 40 ? 'A1' : 'A2';
  if (ourSales >= 1000 && compSales >= 1000) return marketShare >= 45 ? 'B1' : 'B2';
  if (ourSales >= 500  || (compSales >= 1000 && ourSales > 0)) return 'B3';
  if (compSales >= 500 && ourSales === 0) return 'C1';
  if (ourSales > 0) return 'C2';
  return 'D';
}

/** 전략 등급 → 한국어 라벨 */
export function gradeLabel(grade: StrategicGrade): string {
  const map: Record<StrategicGrade, string> = {
    A1: '주력수성',
    A2: '주력공략',
    B1: '성장수성',
    B2: '성장공략',
    B3: '틈새강화',
    C1: '신규진입',
    C2: '소량유지',
    D:  '—',
  };
  return map[grade];
}

/** 전략 등급 → Tailwind 색상 클래스 */
export function gradeColorClass(grade: StrategicGrade): string {
  if (grade === 'A1') return 'bg-emerald-100 text-emerald-700';
  if (grade === 'A2') return 'bg-rose-100 text-rose-600';
  if (grade.startsWith('B')) return 'bg-amber-100 text-amber-700';
  if (grade === 'C1') return 'bg-blue-100 text-blue-600';
  return 'bg-slate-100 text-slate-400';
}

/** 점유율 → 색상 클래스 */
export function shareColorClass(share: number): string {
  if (share >= 50) return 'text-emerald-600';
  if (share >= 35) return 'text-amber-500';
  return 'text-rose-500';
}

/** 점유율 → 프로그레스바 색상 클래스 */
export function shareBarClass(share: number): string {
  if (share >= 50) return 'bg-emerald-500';
  if (share >= 35) return 'bg-amber-400';
  return 'bg-rose-400';
}
