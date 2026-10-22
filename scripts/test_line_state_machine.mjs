/**
 * 0-C. Line State Machine Unit Tests
 * 실행: node scripts/test_line_state_machine.mjs
 */

import {
    canTransition,
    isValidTransition,
    isNonProductLine,
    initLineSchema,
    isOrderFullySettled,
    transitionLine,
    ROUTES
} from '../server/services/lineStateMachine.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

console.log('\n======================================================');
console.log('🧪 [0-C Unit Tests] Line State Machine & Transition Rules');
console.log('======================================================\n');

// 1. 허용된 전이 케이스 (Allowed Transitions - 8 cases)
console.log('--- 1. 허용된 전이 케이스 (Allowed Cases) ---');

assert(isValidTransition('RECEIVED', 'CONFIRMED'), 'RECEIVED -> CONFIRMED 허용');
assert(isValidTransition('CONFIRMED', 'ROUTED'), 'CONFIRMED -> ROUTED 허용');
assert(isValidTransition('ROUTED', 'PICK_REQUESTED', ROUTES.S), 'ROUTED -> PICK_REQUESTED (S 경로) 허용');
assert(isValidTransition('PICK_REQUESTED', 'PACKED', ROUTES.S), 'PICK_REQUESTED -> PACKED (S 경로) 허용');
assert(isValidTransition('ROUTED', 'SUPPLIER_PO_SENT', ROUTES.D), 'ROUTED -> SUPPLIER_PO_SENT (D 경로) 허용');
assert(isValidTransition('SUPPLIER_CONFIRMED', 'IN_PRODUCTION', ROUTES.M), 'SUPPLIER_CONFIRMED -> IN_PRODUCTION (M 경로) 허용');
assert(isValidTransition('DIRECT_SHIPPED', 'STATEMENT_READY', ROUTES.D), 'DIRECT_SHIPPED -> STATEMENT_READY 허용');
assert(isValidTransition('PACKAGED', 'SENT'), 'PACKAGED -> SENT 허용');
assert(isValidTransition('SENT', 'SETTLED'), 'SENT -> SETTLED 허용');
assert(isValidTransition('PACKED', 'PACKED'), '동일 상태(PACKED -> PACKED)는 no-op 허용');

// 2. 거부된 비정상 전이 케이스 (Disallowed Transitions - 8 cases)
console.log('\n--- 2. 거부된 비정상 전이 케이스 (Disallowed Cases) ---');

assert(!isValidTransition('RECEIVED', 'PICK_REQUESTED'), 'RECEIVED -> PICK_REQUESTED 건너뛰기 차단');
assert(!isValidTransition('ROUTED', 'PICK_REQUESTED', ROUTES.D), 'ROUTED -> PICK_REQUESTED (D 경로에서 S 단계 요청) 차단');
assert(!isValidTransition('ROUTED', 'PICK_REQUESTED', null), '경로 미지정 상태에서 분기 단계 진행 차단');
assert(!isValidTransition('CONFIRMED', 'MES_SHIPPED'), 'CONFIRMED -> MES_SHIPPED 직행 차단');
assert(!isValidTransition('PACKED', 'RECEIVED'), 'PACKED -> RECEIVED 역방향 전이 차단');
assert(!isValidTransition('SUPPLIER_CONFIRMED', 'IN_PRODUCTION', ROUTES.D), 'D(직송) 경로에서 IN_PRODUCTION(제작) 전이 차단');
assert(!isValidTransition('SETTLED', 'RECEIVED'), '종결(SETTLED) 이후 상태 변경 차단');
assert(!isValidTransition('RECEIVED', 'UNKNOWN_STATUS'), '존재하지 않는 상태명 차단');

// 3. 비품목 라인 판별 (isNonProductLine)
console.log('\n--- 3. 비품목 라인 판별 (isNonProductLine) ---');

assert(isNonProductLine({ name: '용차 운임비' }), '운임비 감지 (비품목)');
assert(isNonProductLine({ name: '화물 배송비(착불)' }), '배송비 감지 (비품목)');
assert(isNonProductLine({ name: '특별 할인 DC' }), '할인 DC 감지 (비품목)');
assert(isNonProductLine({ name: '' }), '빈 품목명 감지 (비품목)');
assert(!isNonProductLine({ name: '45E(L) 50A SCH10' }), '실제 파이프 피팅은 정상 품목 판정');
assert(!isNonProductLine({ name: '90E(L)-S10S-100A-STS304' }), '정상 규격 키는 정상 품목 판정');

// 4. 스키마 초기화 (initLineSchema)
console.log('\n--- 4. 스키마 초기화 (initLineSchema) ---');

const rawItem = { id: 'it-001', name: '45E(L) 50A' };
const initialized = initLineSchema(rawItem, 0, 'S');
assert(initialized.lineId === 'it-001', '기존 id를 lineId로 유지');
assert(initialized.route === 'S', '지정된 기본 경로 주입');
assert(initialized.lineStatus === 'RECEIVED', '기본 상태 RECEIVED 설정');
assert(initialized.certRequired === true, '일반 피팅은 성적서 필수(certRequired=true)');
assert(typeof initialized.keys === 'object', 'keys 객체 생성 완료');

const freightItem = { id: 'it-freight', name: '시화 화물 배송료' };
const initFreight = initLineSchema(freightItem, 1, 'S');
assert(initFreight.certRequired === false, '운임 라인은 성적서 불필요(certRequired=false)');

// 5. 주문 전체 종결 검증 (isOrderFullySettled)
console.log('\n--- 5. 주문 전체 종결 검증 (isOrderFullySettled) ---');

const pendingOrder = {
    id: 'ORD-TEST-1',
    items: [
        { lineId: 'l1', name: '45E 50A', lineStatus: 'SENT', certRequired: true },
        { lineId: 'l2', name: '90E 50A', lineStatus: 'PACKED', certRequired: true },
        { lineId: 'l3', name: '운임비', lineStatus: 'RECEIVED', certRequired: false }
    ]
};
assert(!isOrderFullySettled(pendingOrder), '일부 품목이 PACKED 상태이면 미완료 판정');

const settledOrder = {
    id: 'ORD-TEST-2',
    items: [
        { lineId: 'l1', name: '45E 50A', lineStatus: 'SENT', certRequired: true },
        { lineId: 'l2', name: '90E 50A', lineStatus: 'SETTLED', certRequired: true },
        { lineId: 'l3', name: '운임비', lineStatus: 'RECEIVED', certRequired: false }
    ]
};
assert(isOrderFullySettled(settledOrder), '모든 실품목이 SENT/SETTLED면 종결 판정 (비품목 무관)');

// 6. 상태 전이 및 이벤트 기록 (transitionLine)
console.log('\n--- 6. 주문 내 라인 상태 전이 실행 (transitionLine) ---');

const testOrder = {
    id: 'ORD-ORDER-TRANSITION-TEST',
    items: [
        initLineSchema({ id: 'line-alpha', name: '45E 100A STS304' }, 0, 'S')
    ],
    events: []
};

// Step A: RECEIVED -> CONFIRMED
const stepA = transitionLine(testOrder, 'line-alpha', 'CONFIRMED', { actor: 'bot:PUR-11' });
assert(stepA.success && stepA.updatedLine.lineStatus === 'CONFIRMED', 'Step A: CONFIRMED 전이 성공');

// Step B: CONFIRMED -> ROUTED
const stepB = transitionLine(testOrder, 'line-alpha', 'ROUTED', { actor: 'user:김철수' });
assert(stepB.success && stepB.updatedLine.lineStatus === 'ROUTED', 'Step B: ROUTED 전이 성공');

// Step C: ROUTED -> PICK_REQUESTED (S 경로)
const stepC = transitionLine(testOrder, 'line-alpha', 'PICK_REQUESTED', { actor: 'bot:LOG-11' });
assert(stepC.success && stepC.updatedLine.lineStatus === 'PICK_REQUESTED', 'Step C: PICK_REQUESTED 전이 성공');

// Step D: 잘못된 직행 시도 (PICK_REQUESTED -> SENT) -> 예외 발생 확인
let caughtError = false;
try {
    transitionLine(testOrder, 'line-alpha', 'SENT', { actor: 'bot:TEST' });
} catch (err) {
    caughtError = true;
    console.log(`  Expected transition rejection caught: "${err.message}"`);
}
assert(caughtError, '비정상 직행 전이 시 예외(throw Error) 발생 확인');

assert(testOrder.events.length === 3, '감사 이벤트(Audit Events) 3건 정상 누적 기록');

console.log('\n======================================================');
console.log(`📊 테스트 결과: 총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
console.log('======================================================\n');

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
