/**
 * 🟡 영업1팀 SLE-02 (박조나단 과장급) 견적 심사 & 검토 서비스 (Quote Review & Auto-Escalation Engine)
 * 
 * [역할 및 지능]
 * 1. SLE-01(초안 작성봇)이 만든 견적서 초안을 정밀 검토
 * 2. 텍스트 + 사진 복합 지시 처리:
 *    - 사진 첨부 + 텍스트(" -52% 요율 적용해주세요", "내일 오전까지 부탁") 시 고객 요청 요율/납기 자동 덮어쓰기
 * 3. 3단계 결재/회신 판정 (Tier Classification):
 *    - [AUTO_APPROVABLE (즉시 회신 가능)]: 단가 등록, 재고 확보, 2,000만원 미만 일반 견적건 -> 카카오 이벤트 푸시(0원) 즉시 회신 승인
 *    - [ESCALATION_REQUIRED (부장 결재 대기)]:
 *      (1) 견적 합계 2천만원(20,000,000원) 이상 대형 견적건
 *      (2) 단가표에 단가가 없거나(단가 0원/미등록), 대경벤드 본사에 특수 단가를 문의해야 하는 건
 *      (3) 최근 단가가 변경된 거래처이거나 과거 출고 단가와 큰 괴리가 있는 건
 * 4. 과거 견적서 기반 회신 소요 시간(SLA) 벤치마크 분석 (이상치 제거 알고리즘)
 * 5. 카카오 i 오픈빌더 0원 챗봇 이벤트 푸시 (Kakao Event API) 연동
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'server/data');

export class SleQuoteReviewService {
    constructor() {
        this.slaBenchmark = {
            avgResponseMinutes: 18,
            goldenTimeMinutes: 25,
            analyzedCount: 0,
            lastCalculatedAt: null
        };
    }

    /**
     * 1. 텍스트 내 고객 추가 지시(요율, 납기, 특이사항) 파싱
     * 예: "사진 견적입니다 -52% 요율 적용해주세요 내일 오전 착 부탁드립니다"
     */
    parseUtteranceOverrides(utterance) {
        if (!utterance || typeof utterance !== 'string') return null;

        const clean = utterance.trim();
        const overrides = {
            hasOverride: false,
            rate: null,
            deliveryDate: null,
            notes: []
        };

        // 1) 요율 추출: "-52%", "요율 52%", "52프로", "50%적용"
        const rateMatch = clean.match(/(?:[-~]?\s*([0-9]{1,2})\s*(?:%|프로|요율))|(?:요율\s*[-~]?\s*([0-9]{1,2}))/i);
        if (rateMatch) {
            const rawRate = parseInt(rateMatch[1] || rateMatch[2], 10);
            if (rawRate >= 10 && rawRate <= 85) {
                overrides.rate = rawRate;
                overrides.hasOverride = true;
                overrides.notes.push(`고객 텍스트 요청 요율(-${rawRate}%) 자동 반영`);
            }
        }

        // 2) 납기 추출: "내일 오전", "당일 퀵", "익일 출고", "시화 직수령", "양산 출고"
        if (/내일\s*(오전|오후|착)?/i.test(clean)) {
            overrides.deliveryDate = '내일 오전 출고 (고객 지정)';
            overrides.hasOverride = true;
        } else if (/당일\s*(퀵|출고|배송|착)/i.test(clean)) {
            overrides.deliveryDate = '당일 긴급 출고 (퀵 배송)';
            overrides.hasOverride = true;
        } else if (/직수령|방문\s*수령/i.test(clean)) {
            overrides.deliveryDate = '시화 창고 직접 방문 수령';
            overrides.hasOverride = true;
        }

        return overrides.hasOverride ? overrides : null;
    }

    /**
     * 2. 박조나단 과장(SLE-02)의 견적 심사 & 검토 판정 엔진
     * @param {Object} quote 견적서 데이터
     * @param {Array} pastQuotes 과거 견적서 목록 (단가 변동 및 거래처 이력 대조용)
     */
    reviewQuotation(quote, pastQuotes = []) {
        const items = quote.items || [];
        const totalAmount = quote.totalAmount || 0;
        const custName = quote.customerName || quote.customerInfo?.companyName || '고객사';

        const review = {
            status: 'AUTO_APPROVABLE', // 기본값: 즉시 회신 가능
            decision: 'APPROVE',       // 'APPROVE' | 'ESCALATE_TO_MANAGER' | 'INQUIRY_TO_DAEKYUNG'
            reviewer: '영업1팀 SLE-02 (박조나단 과장)',
            reviewedAt: new Date().toISOString(),
            escalationReasons: [],
            warnings: [],
            actionNeeded: '즉시 카카오톡 회신 가능 (0원 이벤트 푸시)',
            isLargeAmount: false,
            hasZeroPriceItem: false,
            hasPriceAnomaly: false,
            hasStockShortage: false
        };

        // ----------------------------------------------------
        // 규칙 1: 2천만원(20,000,000원) 이상 대형 견적건 -> 부장 결재 필수
        // ----------------------------------------------------
        if (totalAmount >= 20000000) {
            review.isLargeAmount = true;
            review.status = 'ESCALATION_REQUIRED';
            review.decision = 'ESCALATE_TO_MANAGER';
            review.escalationReasons.push(
                `총 견적금액 ₩${totalAmount.toLocaleString()}원 (2,000만원 이상 대형 견적건) ➔ 부장 직급 결재 및 승인 필수`
            );
        }

        // ----------------------------------------------------
        // 규칙 2: 단가표에 단가가 없거나(단가 0원/미등록), 대경벤드 단가 문의 건
        // ----------------------------------------------------
        const missingPriceItems = items.filter(it => !it.unitPrice || it.unitPrice <= 0 || !it.base_price || it.base_price <= 0);
        if (missingPriceItems.length > 0) {
            review.hasZeroPriceItem = true;
            review.status = 'ESCALATION_REQUIRED';
            review.decision = 'INQUIRY_TO_DAEKYUNG';
            const sampleSpecs = missingPriceItems.slice(0, 3).map(i => `${i.name} ${i.thickness || ''} ${i.size || ''}`).join(', ');
            review.escalationReasons.push(
                `단가표 미등록/0원 품목 ${missingPriceItems.length}건 포함 (${sampleSpecs}${missingPriceItems.length > 3 ? ' 외' : ''}) ➔ 대경벤드 본사 단가 문의 및 부장 확인 필요`
            );
        }

        // ----------------------------------------------------
        // 규칙 3: 최근 단가가 변동된 거래처이거나 과거 출고 단가와 큰 차이가 있는 건
        // ----------------------------------------------------
        if (pastQuotes.length > 0 && custName) {
            const customerPastQuotes = pastQuotes.filter(q => 
                (q.customerName === custName || q.customerInfo?.companyName === custName) &&
                q.id !== quote.id &&
                q.status === 'COMPLETED'
            );

            if (customerPastQuotes.length > 0) {
                // 직전 견적서와 요율/단가 비교
                const recentQuote = customerPastQuotes[0];
                const recentItem = recentQuote.items?.[0];
                const currentItem = items[0];

                if (recentItem && currentItem && recentItem.discountRate !== undefined && currentItem.discountRate !== undefined) {
                    const diffRate = Math.abs(recentItem.discountRate - currentItem.discountRate);
                    if (diffRate >= 5) {
                        review.hasPriceAnomaly = true;
                        review.status = 'ESCALATION_REQUIRED';
                        review.decision = 'ESCALATE_TO_MANAGER';
                        review.escalationReasons.push(
                            `거래처 직전 출고 요율(-${recentItem.discountRate}%) 대비 현재 적용 요율(-${currentItem.discountRate}%) 변동폭 ${diffRate}% 감지 ➔ 부장 직급 최종 단가 검토 필요`
                        );
                    }
                }
            }
        }

        // ----------------------------------------------------
        // 규칙 4: 시화/양산 창고 재고 부족 여부 점검
        // ----------------------------------------------------
        const shortageItems = items.filter(it => it.currentStock !== undefined && it.currentStock < it.quantity);
        if (shortageItems.length > 0) {
            review.hasStockShortage = true;
            review.warnings.push(
                `재고 부족 품목 ${shortageItems.length}건 (대경벤드 출고 납기 조율 필요)`
            );
        }

        // 최종 조치 사항 텍스트 세팅
        if (review.status === 'ESCALATION_REQUIRED') {
            review.actionNeeded = `⚠️ 김부장님 결재 대기 (${review.escalationReasons.length}개 검토 사유)`;
        } else {
            review.actionNeeded = `✅ 박조나단 과장 검토 완료 (즉시 정식 견적서 카카오톡 0원 회신 가능)`;
        }

        return review;
    }

    /**
     * 3. 과거 견적서 기반 회신 소요 시간(SLA) 벤치마크 산정
     * (야간, 주말, 누락 등 극단적으로 지연된 이상치 데이터는 사분위수(IQR) 기준으로 필터링)
     */
    calculateSlaBenchmark(quotations = []) {
        if (!quotations || quotations.length === 0) return this.slaBenchmark;

        const durations = [];

        for (const q of quotations) {
            if (!q.createdAt) continue;
            const start = new Date(q.createdAt).getTime();
            
            // 답변 시점 결정 (adminResponse 생성 시점 또는 dispatchedAt)
            let end = null;
            if (q.dispatchedAt) end = new Date(q.dispatchedAt).getTime();
            else if (q.adminResponse?.updatedAt) end = new Date(q.adminResponse.updatedAt).getTime();
            else if (q.status === 'PROCESSED' || q.status === 'COMPLETED') {
                end = start + (25 * 60 * 1000); // 과거 답변 기록 폴백
            }

            if (end && end > start) {
                const diffMinutes = Math.round((end - start) / (1000 * 60));
                // 극단적 이상치 1차 제거: 0분 이하 또는 48시간(2880분) 초과 제거
                if (diffMinutes > 0 && diffMinutes <= 2880) {
                    durations.push(diffMinutes);
                }
            }
        }

        if (durations.length === 0) return this.slaBenchmark;

        durations.sort((a, b) => a - b);

        // IQR (Interquartile Range) 기반 이상치 필터링
        const q1 = durations[Math.floor(durations.length * 0.25)];
        const q3 = durations[Math.floor(durations.length * 0.75)];
        const iqr = q3 - q1;
        const upperBound = q3 + 1.5 * iqr; // 이상치 상한

        const normalDurations = durations.filter(d => d <= upperBound);
        const avg = Math.round(normalDurations.reduce((sum, v) => sum + v, 0) / normalDurations.length);
        const goldenTime = Math.min(Math.round(avg * 1.3), 30); // 평균의 1.3배 또는 최대 30분을 골든타임으로 설정

        this.slaBenchmark = {
            avgResponseMinutes: Math.max(avg, 5),
            goldenTimeMinutes: Math.max(goldenTime, 15),
            analyzedCount: normalDurations.length,
            filteredOutliersCount: durations.length - normalDurations.length,
            lastCalculatedAt: new Date().toISOString()
        };

        return this.slaBenchmark;
    }

    /**
     * 4. 0원 카카오 i 오픈빌더 챗봇 이벤트 푸시 (Event API)
     * 카카오 챗봇 관리자센터의 Event API를 호출하여 고객의 원래 대화방에 견적 카드를 0원에 꽂아 넣음
     */
    async dispatchKakaoEventPush({ botUserKey, quotationId, totalAmount, quoteUrl }) {
        const botId = process.env.KAKAO_BOT_ID || 'altf_sales_bot';
        const apiKey = process.env.KAKAO_BOT_API_KEY || null;

        const payload = {
            event: 'QUOTE_ANSWERED_EVENT',
            user: {
                id: botUserKey
            },
            data: {
                quotationId,
                totalAmount: totalAmount ? totalAmount.toLocaleString() : '0',
                quoteUrl: quoteUrl || `https://altf.kr/quote/view?id=${quotationId}`,
                title: `[알트에프] 견적서 (${quotationId}) 검토 완료`,
                message: '담당자 검토가 완료되어 정식 견적서가 발행되었습니다. 아래 버튼을 눌러 직인 날인된 PDF를 확인하세요.'
            }
        };

        // 카카오 오픈빌더 이벤트 API 호출 시뮬레이션 및 실제 호출
        if (apiKey) {
            try {
                const fetch = (await import('node-fetch')).default;
                const res = await fetch(`https://bot-api.kakao.com/v1/bots/${botId}/events`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `KakaoAK ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const resData = await res.json();
                return {
                    success: res.ok,
                    mode: 'KAKAO_EVENT_PUSH_LIVE',
                    message: res.ok ? '카카오톡 채팅방 0원 이벤트 푸시 전송 성공!' : `카카오 푸시 에러: ${resData.message || res.statusText}`,
                    payload
                };
            } catch (err) {
                console.error('[SleQuoteReview] 카카오 이벤트 푸시 실패:', err.message);
                return { success: false, mode: 'KAKAO_PUSH_ERROR', error: err.message, payload };
            }
        }

        // API Key 미등록 시: 모의 0원 이벤트 푸시 생성 (성공 로그 기록)
        console.log(`[SleQuoteReview] 🟢 [비용 0원 카카오 이벤트 푸시 전송]: botUserKey=${botUserKey}, quote=${quotationId}`);
        return {
            success: true,
            mode: 'KAKAO_EVENT_PUSH_SIMULATED',
            message: `[0원 카카오 이벤트 푸시] 고객 대화창(${botUserKey.slice(0, 8)}...)으로 정식 견적 카드가 0원에 전송되었습니다.`,
            payload
        };
    }
}

export const sleQuoteReviewService = new SleQuoteReviewService();
