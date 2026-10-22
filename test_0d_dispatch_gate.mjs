/**
 * 🧪 Test Suite: 0-D Dispatch Gate & Approval Queue
 */

import assert from 'assert';
import { dispatchGate } from './server/services/dispatchGate.js';
import { ledgerClient } from './server/services/ledgerClient.js';

async function runTests() {
    console.log('🧪 [0-D Test] Starting Dispatch Gate Verification...');

    // Mock internal context for ledgerClient
    const mockOrder = {
        id: 'ORD-TEST-001',
        poNumber: 'PO-TEST-001',
        status: 'CONFIRMED',
        items: [{ lineId: 'LINE-1', lineStatus: 'ROUTED', route: 'S' }],
        events: []
    };
    ledgerClient.bindInternalContext({
        db: { orders: [mockOrder] },
        updateDb: async (fn) => fn()
    });

    // 1. Enqueue with approverRole (Should be PENDING_APPROVAL)
    console.log('\n--- 1. Enqueue with Approval Required ---');
    const quoteItem = await dispatchGate.enqueue({
        channel: 'EMAIL',
        to: 'customer@example.com',
        replyTo: 'sales-rep@altf.kr',
        subject: '[ALTF 견적서] 태형산업 견적 회신',
        body: '첨부 견적서를 확인해 주십시오.',
        attachments: [{ fileName: 'quote_태형산업.pdf', path: '/dummy/quote.pdf' }],
        orderId: 'ORD-TEST-001',
        kind: 'QUOTE',
        approverRole: 'SALES',
        enqueuedBy: 'bot:SLE-01'
    });

    assert.strictEqual(quoteItem.status, 'PENDING_APPROVAL');
    assert.strictEqual(quoteItem.requiresApproval, true);
    assert.strictEqual(quoteItem.approverRole, 'SALES');
    console.log('✅ Enqueue with approverRole is PENDING_APPROVAL');

    // 2. Cannot send duplicate before approval, and verify approve()
    console.log('\n--- 2. Approve Item ---');
    const approvedItem = await dispatchGate.approve(quoteItem.id, { name: '김영업', role: 'SALES' });
    assert.strictEqual(approvedItem.status, 'SENT');
    assert(approvedItem.sentAt);
    assert.strictEqual(approvedItem.approvedBy.name, '김영업');
    console.log('✅ approve() changed status to SENT and recorded approver');

    // Verify order events in ledger
    assert(mockOrder.events.length > 0);
    const lastEvent = mockOrder.events[mockOrder.events.length - 1];
    assert.strictEqual(lastEvent.eventType, 'DISPATCH_SENT');
    console.log('✅ LedgerClient recorded DISPATCH_SENT event in order');

    // 3. Double approval should be prevented
    console.log('\n--- 3. Prevent Double Approval ---');
    try {
        await dispatchGate.approve(quoteItem.id, { name: '이영업' });
        assert.fail('Should have thrown error on double approval');
    } catch (e) {
        assert(e.message.includes('이미 발송'));
        console.log('✅ Double approval successfully prevented:', e.message);
    }

    // 4. Duplicate DOC_PACKAGE prevention for same shipment
    console.log('\n--- 4. Prevent Duplicate DOC_PACKAGE for Same Shipment ---');
    const docPkg1 = await dispatchGate.enqueue({
        channel: 'EMAIL',
        to: 'customer@example.com',
        subject: '[ALTF 출고서류] 거래명세표 및 성적서',
        body: '출고 서류 일체 송부',
        orderId: 'ORD-TEST-001',
        shipmentId: 'SHIP-20261022-001',
        kind: 'DOC_PACKAGE',
        approverRole: 'OFFICE',
        enqueuedBy: 'bot:GEN-03'
    });

    // Approve the doc package so it enters SENT status
    await dispatchGate.approve(docPkg1.id, { name: '박총무', role: 'OFFICE' });
    assert.strictEqual(docPkg1.status, 'SENT');

    // Try enqueuing a second DOC_PACKAGE with same shipmentId
    try {
        await dispatchGate.enqueue({
            channel: 'EMAIL',
            to: 'customer@example.com',
            subject: '[ALTF 중복 서류]',
            body: '중복 테스트',
            orderId: 'ORD-TEST-001',
            shipmentId: 'SHIP-20261022-001',
            kind: 'DOC_PACKAGE',
            approverRole: 'OFFICE',
            enqueuedBy: 'bot:GEN-03'
        });
        assert.fail('Should have prevented duplicate DOC_PACKAGE');
    } catch (e) {
        assert(e.message.includes('중복 발송 차단'));
        console.log('✅ Duplicate DOC_PACKAGE successfully blocked:', e.message);
    }

    // 5. Rejection flow
    console.log('\n--- 5. Rejection Flow ---');
    const rejectItem = await dispatchGate.enqueue({
        channel: 'EMAIL',
        to: 'wrong-recipient@example.com',
        subject: '[ALTF 잘못된 요청]',
        body: '오류 테스트',
        orderId: 'ORD-TEST-001',
        kind: 'NOTICE',
        approverRole: 'SALES',
        enqueuedBy: 'bot:SLE-08'
    });

    const rejected = await dispatchGate.reject(rejectItem.id, { name: '최팀장' }, '수신처 이메일 주소 오류');
    assert.strictEqual(rejected.status, 'REJECTED');
    assert.strictEqual(rejected.rejectedBy.reason, '수신처 이메일 주소 오류');
    console.log('✅ reject() recorded rejection reason successfully');

    // 6. Direct dispatch for internal notification (no approverRole)
    console.log('\n--- 6. Immediate Dispatch without Approval (Internal) ---');
    const internalNotice = await dispatchGate.enqueue({
        channel: 'TELEGRAM_INTERNAL',
        to: 'INTERNAL',
        subject: '사내 공지',
        body: '일일 마감 보고',
        kind: 'NOTICE',
        approverRole: null,
        enqueuedBy: 'bot:EXE-11'
    });
    assert.strictEqual(internalNotice.status, 'SENT');
    console.log('✅ Internal dispatch without approverRole sent immediately');

    console.log('\n🎉 ALL 0-D DISPATCH GATE UNIT TESTS PASSED (100%)!');
}

runTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
