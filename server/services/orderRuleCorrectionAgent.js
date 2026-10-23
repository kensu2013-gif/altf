/**
 * 🤖 발주서 수정 관찰봇 (ORDER-RULES-01 / Order Rule Correction & Learning Agent)
 * 
 * [역할]
 * 1. 영업3팀 AI 봇(SLE-11~14)이 카카오톡 발주서(사진/텍스트)에서 추출한 품목(품명-두께-규격-재질-수량)과
 *    도착지/운송조건을 사무실 담당자가 웹 화면에서 수정할 때,
 *    수정 전(Before)과 수정 후(After)의 차이(Diff)를 실시간 감지하여 영구 저장합니다.
 * 2. 감지된 수정 패턴(품목명 보정, 두께 SCH 변경, 인치 규격 정규화, 재질 STS/WP -S/-W 교정, 수량 정정, 운송조건 등)을
 *    체계적으로 누적 보존하여 정기 보고서를 생성하고, 봇들의 프롬프트 및 정규화 규칙으로 지속 학습시킵니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const ORDER_CORRECTIONS_FILE = path.join(DATA_DIR, 'order_rule_corrections.json');

export class OrderRuleCorrectionAgent {
    constructor() {
        this.corrections = [];
        this.loadCorrections();
    }

    loadCorrections() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            if (fs.existsSync(ORDER_CORRECTIONS_FILE)) {
                const raw = fs.readFileSync(ORDER_CORRECTIONS_FILE, 'utf8');
                this.corrections = JSON.parse(raw);
            } else {
                this.corrections = [];
                this.saveCorrections();
            }
        } catch (e) {
            console.error('[OrderRuleCorrectionAgent] 발주 수정 내역 로드 실패:', e.message);
            this.corrections = [];
        }
    }

    saveCorrections() {
        try {
            fs.writeFileSync(ORDER_CORRECTIONS_FILE, JSON.stringify(this.corrections, null, 2), 'utf8');
        } catch (e) {
            console.error('[OrderRuleCorrectionAgent] 발주 수정 내역 저장 실패:', e.message);
        }
    }

    /**
     * 발주서 품목 및 필수조건 수정 감지 및 누적 학습
     */
    detectAndLearn({ orderId, orderNo, beforeOrder, afterOrder, modifiedBy = '사무실 관리자' }) {
        if (!beforeOrder || !afterOrder) return null;

        const beforeItems = beforeOrder.items || [];
        const afterItems = afterOrder.items || [];
        const detectedChanges = [];

        // 1. 품목 레벨 Diff 분석 (품명, 두께, 규격, 재질, 수량)
        const maxLen = Math.max(beforeItems.length, afterItems.length);
        for (let i = 0; i < maxLen; i++) {
            const b = beforeItems[i] || null;
            const a = afterItems[i] || null;

            if (!b && a) {
                detectedChanges.push({
                    type: 'ITEM_ADDED',
                    index: i,
                    after: {
                        name: a.name,
                        thickness: a.thickness,
                        size: a.size,
                        material: a.material,
                        quantity: a.quantity,
                        itemCode: `${a.name || ''}-${a.thickness || ''}-${a.size || ''}-${a.material || ''}`
                    },
                    reason: '사무실 담당자가 누락된 발주 품목을 직접 추가함'
                });
                continue;
            }

            if (b && !a) {
                detectedChanges.push({
                    type: 'ITEM_REMOVED',
                    index: i,
                    before: {
                        name: b.name,
                        thickness: b.thickness,
                        size: b.size,
                        material: b.material,
                        quantity: b.quantity,
                        itemCode: `${b.name || ''}-${b.thickness || ''}-${b.size || ''}-${b.material || ''}`
                    },
                    reason: '사무실 담당자가 잘못 인식되거나 불필요한 품목을 제거함'
                });
                continue;
            }

            // 필드별 비교
            const fieldDiffs = [];
            const fields = ['name', 'thickness', 'size', 'material', 'quantity'];

            for (const f of fields) {
                const bVal = String(b[f] ?? '').trim();
                const aVal = String(a[f] ?? '').trim();

                if (bVal && aVal && bVal !== aVal) {
                    fieldDiffs.push({
                        field: f,
                        from: bVal,
                        to: aVal
                    });
                }
            }

            if (fieldDiffs.length > 0) {
                detectedChanges.push({
                    type: 'ITEM_MODIFIED',
                    index: i,
                    before: {
                        name: b.name,
                        thickness: b.thickness,
                        size: b.size,
                        material: b.material,
                        quantity: b.quantity,
                        itemCode: `${b.name || ''}-${b.thickness || ''}-${b.size || ''}-${b.material || ''}`
                    },
                    after: {
                        name: a.name,
                        thickness: a.thickness,
                        size: a.size,
                        material: a.material,
                        quantity: a.quantity,
                        itemCode: `${a.name || ''}-${a.thickness || ''}-${a.size || ''}-${a.material || ''}`
                    },
                    fieldDiffs,
                    ruleInferred: this.inferItemRule(fieldDiffs, b, a)
                });
            }
        }

        // 2. 발송/운송 필수 조건 Diff 분석 (도착지, 운송비, 고객사, 담당자)
        const conditionDiffs = [];
        if (beforeOrder.destination !== afterOrder.destination) {
            conditionDiffs.push({ field: 'destination', from: beforeOrder.destination || '(미기재)', to: afterOrder.destination || '' });
        }
        if (beforeOrder.freightTerms !== afterOrder.freightTerms) {
            conditionDiffs.push({ field: 'freightTerms', from: beforeOrder.freightTerms || '(미기재)', to: afterOrder.freightTerms || '' });
        }
        if (beforeOrder.customerName !== afterOrder.customerName) {
            conditionDiffs.push({ field: 'customerName', from: beforeOrder.customerName || '', to: afterOrder.customerName || '' });
        }

        if (detectedChanges.length === 0 && conditionDiffs.length === 0) {
            return null; // 변경사항 없음
        }

        const record = {
            id: `ORD-CORR-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            orderId,
            orderNo: orderNo || '(접수대기중)',
            timestamp: new Date().toISOString(),
            modifiedBy,
            customerName: afterOrder.customerName || beforeOrder.customerName || '고객사',
            channelTag: '카카오톡',
            itemChangesCount: detectedChanges.length,
            conditionChangesCount: conditionDiffs.length,
            itemChanges: detectedChanges,
            conditionChanges: conditionDiffs
        };

        this.corrections.unshift(record);
        if (this.corrections.length > 1000) {
            this.corrections = this.corrections.slice(0, 1000);
        }
        this.saveCorrections();

        console.log(`[OrderRuleCorrectionAgent] 🧠 [수정관찰봇] 발주서(${orderId})에서 품목 ${detectedChanges.length}건, 조건 ${conditionDiffs.length}건 수정 감지 및 누적 보존 완료!`);
        return record;
    }

    /**
     * 품목 수정 규칙 추론
     */
    inferItemRule(diffs, beforeItem, afterItem) {
        const rules = [];
        for (const d of diffs) {
            if (d.field === 'material') {
                if (d.from.includes('SUS') && d.to.includes('STS')) {
                    rules.push('SUS 표기를 STS 표준 재질로 변경');
                }
                if (!d.from.endsWith('-W') && !d.from.endsWith('-S') && (d.to.endsWith('-W') || d.to.endsWith('-S'))) {
                    rules.push(`제조방식(-W/-S) 명시: ${d.to}`);
                }
            } else if (d.field === 'thickness') {
                rules.push(`두께 보정: ${d.from} ➔ ${d.to}`);
            } else if (d.field === 'size') {
                rules.push(`규격 표준화: ${d.from} ➔ ${d.to}`);
            } else if (d.field === 'quantity') {
                rules.push(`수량 오탈자 정정: ${d.from}EA ➔ ${d.to}EA`);
            }
        }
        return rules.join('; ') || '일반 수정';
    }

    /**
     * 누적 학습 보고서 생성
     */
    getSummaryReport() {
        const total = this.corrections.length;
        const materialCorrections = [];
        const thicknessCorrections = [];
        const sizeCorrections = [];

        for (const c of this.corrections) {
            for (const ch of (c.itemChanges || [])) {
                for (const d of (ch.fieldDiffs || [])) {
                    if (d.field === 'material') materialCorrections.push(`${d.from} ➔ ${d.to}`);
                    if (d.field === 'thickness') thicknessCorrections.push(`${d.from} ➔ ${d.to}`);
                    if (d.field === 'size') sizeCorrections.push(`${d.from} ➔ ${d.to}`);
                }
            }
        }

        return {
            totalCorrections: total,
            materialCorrectionsCount: materialCorrections.length,
            thicknessCorrectionsCount: thicknessCorrections.length,
            sizeCorrectionsCount: sizeCorrections.length,
            recentCorrections: this.corrections.slice(0, 20)
        };
    }
}

export const orderRuleCorrectionAgent = new OrderRuleCorrectionAgent();
