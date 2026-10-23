/**
 * 🤖 규칙 수정 감지봇 (RULES-01 / Rule Correction & Learning Agent)
 * 
 * [역할]
 * 1. INT-03 비전 OCR이 읽어서 업로드한 견적서 품목을 사무실 담당자가 웹 화면에서 수정할 때,
 *    수정 전(Before)과 수정 후(After)의 차이(Diff)를 실시간 감지하여 영구 저장합니다.
 * 2. 감지된 수정 패턴(재질 변경, 규격 변경, WP↔STS 인치 변환, 품명 보정 등)을 자동 추론 및 학습합니다.
 * 3. 학습된 피드백 규칙을 INT-03 비전 OCR 프롬프트와 정규화 엔진에 동적으로 주입하여,
 *    인공지능이 동일한 실수를 반복하지 않고 지속적으로 자동 강화되도록 만듭니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const CORRECTIONS_FILE = path.join(DATA_DIR, 'rule_corrections.json');

export class RuleCorrectionAgent {
    constructor() {
        this.corrections = [];
        this.loadCorrections();
    }

    loadCorrections() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            if (fs.existsSync(CORRECTIONS_FILE)) {
                const raw = fs.readFileSync(CORRECTIONS_FILE, 'utf8');
                this.corrections = JSON.parse(raw);
            } else {
                this.corrections = [];
                this.saveCorrections();
            }
        } catch (e) {
            console.error('[RuleCorrectionAgent] 수정 내역 로드 실패:', e.message);
            this.corrections = [];
        }
    }

    saveCorrections() {
        try {
            fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(this.corrections, null, 2), 'utf8');
        } catch (e) {
            console.error('[RuleCorrectionAgent] 수정 내역 저장 실패:', e.message);
        }
    }

    /**
     * 사무실 웹 화면에서 저장/수정된 견적서의 품목 비교 및 규칙 학습
     * @param {string} quotationId 견적서 ID
     * @param {Array} beforeItems 수정 전 품목 배열 (OCR 원본)
     * @param {Array} afterItems 수정 후 품목 배열 (담당자가 저장한 최종본)
     * @param {Object} metadata 추가 메타데이터 (거래처명, 수정자, 비고 등)
     */
    detectAndLearn(quotationId, beforeItems = [], afterItems = [], metadata = {}) {
        if (!Array.isArray(beforeItems) || !Array.isArray(afterItems)) return [];

        const detectedChanges = [];
        const maxLen = Math.max(beforeItems.length, afterItems.length);

        for (let i = 0; i < maxLen; i++) {
            const b = beforeItems[i] || null;
            const a = afterItems[i] || null;

            if (!b && a) {
                // 신규 추가된 행
                detectedChanges.push({
                    type: 'ITEM_ADDED',
                    index: i,
                    after: a,
                    reason: '사무실 담당자가 누락된 품목을 수동으로 추가함'
                });
                continue;
            }

            if (b && !a) {
                // 삭제된 행
                detectedChanges.push({
                    type: 'ITEM_REMOVED',
                    index: i,
                    before: b,
                    reason: '사무실 담당자가 불필요하거나 잘못 인식된 품목을 삭제함'
                });
                continue;
            }

            // 필드별 비교
            const fieldDiffs = [];
            const fields = ['type', 'schedule', 'size', 'material', 'qty'];

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
                // 규칙 추론 (Inference)
                const inferredRule = this.inferRule(b, a, fieldDiffs);

                detectedChanges.push({
                    type: 'ITEM_MODIFIED',
                    index: i,
                    before: {
                        itemId: b.itemId || `${b.type}-${b.schedule}-${b.size}-${b.material}`,
                        type: b.type,
                        schedule: b.schedule,
                        size: b.size,
                        material: b.material,
                        qty: b.qty
                    },
                    after: {
                        itemId: a.itemId || `${a.type}-${a.schedule}-${a.size}-${a.material}`,
                        type: a.type,
                        schedule: a.schedule,
                        size: a.size,
                        material: a.material,
                        qty: a.qty
                    },
                    fieldDiffs,
                    inferredRule
                });
            }
        }

        if (detectedChanges.length > 0) {
            const record = {
                id: `RULE-CORR-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
                quotationId,
                timestamp: new Date().toISOString(),
                source: metadata.source || 'WEB_OFFICE_ADMIN',
                customerName: metadata.customerName || '',
                totalItemsBefore: beforeItems.length,
                totalItemsAfter: afterItems.length,
                changeCount: detectedChanges.length,
                changes: detectedChanges
            };

            this.corrections.unshift(record);
            // 최대 500개 유지
            if (this.corrections.length > 500) {
                this.corrections = this.corrections.slice(0, 500);
            }
            this.saveCorrections();

            console.log(`[RuleCorrectionAgent] 🧠 규칙 수정 감지봇 작동: 견적서(${quotationId})에서 ${detectedChanges.length}건의 수정 감지 및 학습 완료`);
            return record;
        }

        return null;
    }

    /**
     * 필드 변경 내용으로부터 도메인 규칙 자동 추론
     */
    inferRule(before, after, diffs) {
        const rules = [];

        for (const diff of diffs) {
            // 1. ASTM WP 재질에 인치("), STS에 A 규격 교정
            if (diff.field === 'size') {
                if (after.material?.startsWith('WP') && diff.from.includes('A') && diff.to.includes('"')) {
                    rules.push(`[ASTM 인치 정규화] WP 재질(${after.material})에는 A 규격(${diff.from}) 대신 인치 규격(${diff.to})을 적용해야 함`);
                } else if (after.material?.startsWith('STS') && diff.from.includes('"') && diff.to.includes('A')) {
                    rules.push(`[JIS A 정규화] STS 재질(${after.material})에는 인치 규격(${diff.from}) 대신 A 규격(${diff.to})을 적용해야 함`);
                } else if (diff.from.includes('X') && diff.to.includes('X')) {
                    rules.push(`[복수 규격 배치/표기] ${diff.from} -> ${diff.to} (큰 규격 우선 및 표준 표기)`);
                }
            }

            // 2. 재질 보정
            if (diff.field === 'material') {
                if (diff.from.includes('SUS') && !diff.to.includes('SUS')) {
                    rules.push(`[재질 명칭 정규화] SUS 금지 -> ${diff.to}`);
                }
                if (diff.from.endsWith('-W') && diff.to.endsWith('-S')) {
                    rules.push(`[심리스(-S) 교정] ${before.type} ${before.schedule}는 Seamless(-S)로 지정해야 함`);
                }
                if (diff.from.endsWith('-S') && diff.to.endsWith('-W')) {
                    rules.push(`[용접(-W) 기본값 교정] 근거 없는 -S를 -W로 변경`);
                }
            }

            // 3. 품명 보정
            if (diff.field === 'type') {
                rules.push(`[품명 판별 교정] ${diff.from} -> ${diff.to}`);
            }

            // 4. 두께 보정
            if (diff.field === 'schedule') {
                rules.push(`[두께 판별 교정] ${diff.from} -> ${diff.to}`);
            }
        }

        return rules.join(' | ') || '기타 사용자 수동 보정';
    }

    /**
     * INT-03 비전 OCR 시스템 프롬프트에 주입할 동적 학습 피드백 텍스트 생성
     */
    getLearnedRulesPrompt() {
        if (!this.corrections || this.corrections.length === 0) {
            return '';
        }

        const recentLearned = [];
        const seenPatterns = new Set();

        for (const record of this.corrections) {
            for (const ch of (record.changes || [])) {
                if (ch.inferredRule && !seenPatterns.has(ch.inferredRule)) {
                    seenPatterns.add(ch.inferredRule);
                    recentLearned.push(`- ${ch.inferredRule}`);
                    if (recentLearned.length >= 8) break;
                }
            }
            if (recentLearned.length >= 8) break;
        }

        if (recentLearned.length === 0) return '';

        return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[규칙 수정 감지봇(RULES-01) 실시간 학습 피드백 (사무실 담당자 최종 교정 사항)]
사무실 관리자가 과거 판독 결과 중 수정한 핵심 사례입니다. 판독 시 아래 학습 결과를 최우선 반영하십시오:
${recentLearned.join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    }

    /**
     * 전체 수정 감지 이력 조회
     */
    getCorrections(limit = 50) {
        return this.corrections.slice(0, limit);
    }
}

export const ruleCorrectionAgent = new RuleCorrectionAgent();
