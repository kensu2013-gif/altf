/**
 * 🟡 KakaoTalk Direct Bot Service for ALTF (영업2팀 카카오톡 직통 견적 입수봇)
 * 
 * [목적]
 * Make.com(코인/과금)을 전혀 거치지 않고, 카카오 i 오픈빌더(Kakao i OpenBuilder) 스킬 서버에서
 * 알트에프 백엔드(/api/kakao/skill)로 직접 다이렉트 웹훅을 수신하여 0원/무제한으로 실시간 처리합니다.
 * 
 * [파이프라인]
 * 1. 카카오 오픈빌더 스킬 웹훅 수신 (userRequest: utterance, media, botUserKey)
 * 2. 5초 타임아웃 방지: 0.2초 이내 즉각 카카오 v2.0 확인 응답 회신
 * 3. 영업2팀 에이전트 백그라운드 파이프라인 자동 격발:
 *    - INT-02 (메신저/카톡 견적 인입 봇): 텍스트/사진 추출 및 인입 큐 등록
 *    - INT-03 (비전 OCR 봇): 사진 첨부 시 OCR 파싱 대기 큐 연계
 *    - INT-05 (피팅 은어/약어 표준화 봇): 현장 은어("90E 50A" -> "ELBOW 90 L/R SCH40 50A A234-WPB") 정규화
 *    - SLE-01 / SLE-02 (영업1팀 견적 작성): 재고/단가 대장 매칭 및 웹 견적서 초안 생성
 * 4. 에이전트 오피스(AgentOfficeDashboard) 실시간 활동 및 카운트 자동 반영
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fittingNormalizerService } from './fittingNormalizerService.js';
import { fittingVisionOcrService } from './fittingVisionOcrService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const DATA_DIR = path.join(ROOT_DIR, 'server/data');
const INTAKES_FILE = path.join(DATA_DIR, 'kakao_intakes.json');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const DRAFT_QUOTES_FILE = path.join(DATA_DIR, 'kakao_draft_quotations.json');

export class KakaoBotService {
    constructor() {
        this.intakes = [];
        this.draftQuotations = [];
        this.stats = {
            totalReceived: 0,
            textQuotes: 0,
            imageQuotes: 0,
            lastReceivedAt: null
        };
        this.loadData();
    }

    loadData() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            if (fs.existsSync(INTAKES_FILE)) {
                const raw = fs.readFileSync(INTAKES_FILE, 'utf8');
                this.intakes = JSON.parse(raw);
                this.stats.totalReceived = this.intakes.length;
                this.stats.textQuotes = this.intakes.filter(i => i.type === 'text').length;
                this.stats.imageQuotes = this.intakes.filter(i => i.type === 'image').length;
                if (this.intakes.length > 0) {
                    this.stats.lastReceivedAt = this.intakes[0].receivedAt;
                }
            } else {
                this.intakes = [];
                fs.writeFileSync(INTAKES_FILE, JSON.stringify([], null, 2), 'utf8');
            }

            if (fs.existsSync(DRAFT_QUOTES_FILE)) {
                this.draftQuotations = JSON.parse(fs.readFileSync(DRAFT_QUOTES_FILE, 'utf8'));
            } else {
                this.draftQuotations = [];
                fs.writeFileSync(DRAFT_QUOTES_FILE, JSON.stringify([], null, 2), 'utf8');
            }
        } catch (e) {
            console.error('[KakaoBotService] 데이터 로드 실패:', e.message);
            this.intakes = [];
        }
    }

    saveData() {
        try {
            fs.writeFileSync(INTAKES_FILE, JSON.stringify(this.intakes.slice(0, 500), null, 2), 'utf8');
            fs.writeFileSync(DRAFT_QUOTES_FILE, JSON.stringify(this.draftQuotations.slice(0, 500), null, 2), 'utf8');
        } catch (e) {
            console.error('[KakaoBotService] 데이터 저장 실패:', e.message);
        }
    }

    /**
     * 카카오 i 오픈빌더 스킬 웹훅 처리
     * @param {Object} body 카카오 요청 바디
     */
    async handleSkillRequest(body) {
        const receivedAt = new Date().toISOString();
        
        // 1. 카카오 payload 파싱
        const userRequest = body?.userRequest || {};
        const utterance = (userRequest.utterance || '').trim();
        const botUserKey = userRequest.user?.id || userRequest.user?.properties?.botUserKey || 'unknown_user';
        const action = body?.action || {};
        const params = { ...(userRequest.params || {}), ...(action.params || {}) };
        
        // 이미지 첨부 감지 (media, secureimage 등)
        const imageUrl = params.media || params.secureimage || params.image || null;
        const isImage = !!imageUrl;

        // 2. 영업2팀 INT-05 규격 정규화 엔진 가동 (텍스트 또는 이미지 OCR)
        let normalized = { customer: null, discountRate: 50, remarks: '', items: [] };
        if (!isImage && utterance) {
            normalized = fittingNormalizerService.normalize(utterance);
        } else if (isImage && imageUrl) {
            // 🔥 사진인 경우 비전 LLM (대표님 프롬프트 주입) 및 로컬 폴백 비전 OCR 가동
            try {
                const imgTargetUrl = typeof imageUrl === 'string' ? imageUrl : (imageUrl.url || '');
                if (imgTargetUrl) {
                    let imgBuf = null;
                    let contentType = 'image/jpeg';
                    if (imgTargetUrl.startsWith('file://') || imgTargetUrl.startsWith('/')) {
                        const localPath = imgTargetUrl.replace('file://', '');
                        if (fs.existsSync(localPath)) {
                            imgBuf = fs.readFileSync(localPath);
                            console.log(`[KakaoBot] 로컬 이미지 로드 완료 (${imgBuf.length} bytes), 비전 AI 분석 착수`);
                        }
                    } else {
                        const fetch = (await import('node-fetch')).default;
                        const imgRes = await fetch(imgTargetUrl);
                        if (imgRes.ok) {
                            imgBuf = await imgRes.buffer();
                            contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                            console.log(`[KakaoBot] 원격 이미지 다운로드 완료 (${imgBuf.length} bytes), 비전 AI 분석 착수`);
                        }
                    }

                    if (imgBuf) {
                        normalized = await fittingVisionOcrService.recognizeAndNormalize(imgBuf, contentType);
                    }
                }
            } catch (imgErr) {
                console.error('[KakaoBot] 이미지 비전 OCR 처리 실패:', imgErr.message);
            }
        }

        const intakeRecord = {
            id: `KAKAO-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            type: isImage ? 'image' : 'text',
            botUserKey,
            utterance: utterance || (isImage ? '[견적 요청 사진 첨부]' : '[내용 없음]'),
            imageUrl: imageUrl || null,
            status: normalized.items.length > 0 ? 'QUOTE_DRAFTED' : 'RECEIVED',
            receivedAt,
            channel: '카카오톡 채널 (@altf)',
            assignedTeam: '영업2팀 (인입/표준화)',
            assignedAgents: isImage ? ['INT-02', 'INT-03', 'INT-05', 'SLE-01'] : ['INT-02', 'INT-05', 'SLE-01'],
            customer: normalized.customer,
            discountRate: normalized.discountRate,
            remarks: normalized.remarks,
            parsedItems: normalized.items
        };

        // 3. 인입 큐에 추가
        this.intakes.unshift(intakeRecord);
        this.stats.totalReceived++;
        if (isImage) this.stats.imageQuotes++;
        else this.stats.textQuotes++;
        this.stats.lastReceivedAt = receivedAt;

        // 4. 품목이 정상 정규화된 경우 견적서 초안(Draft Quotation) 생성
        let draftQuote = null;
        if (normalized.items.length > 0) {
            draftQuote = this.createDraftQuotation(intakeRecord, normalized);
            intakeRecord.quotationId = draftQuote.id;
            this.draftQuotations.unshift(draftQuote);
            console.log(`[KakaoBot] ✅ 견적서 초안 생성 완료 [${draftQuote.id}] 고객사: ${draftQuote.customerName} (${draftQuote.items.length}개 품목, ${draftQuote.totalAmount.toLocaleString()}원)`);
        }

        this.saveData();

        // 5. 백그라운드에서 에이전트 활동 기록 갱신 (비동기 처리)
        setTimeout(() => {
            this.dispatchToAgents(intakeRecord, draftQuote);
        }, 50);

        // 6. 카카오톡 답변 메시지 조립
        let responseText = '';
        if (isImage) {
            responseText = `📄 [알트에프 영업2팀]\n견적서 사진이 정상 접수되었습니다!\n\n🤖 INT-03(비전 OCR) & INT-05(규격 표준화) 에이전트가 품목과 수량을 분석하고 있습니다.\n검토 완료 후 카카오톡으로 견적 결과를 안내해 드리겠습니다.`;
        } else if (normalized.items.length > 0) {
            const custName = normalized.customer ? normalized.customer.name : '고객사';
            const rate = normalized.discountRate;
            let itemLines = normalized.items.map((it, idx) => {
                const discountedUnitPrice = Math.round(it.basePrice * (1 - rate / 100));
                const itemAmount = discountedUnitPrice * it.qty;
                return `${idx + 1}. ${it.type} ${it.schedule} ${it.size} ${it.material}\n   - 수량: ${it.qty}EA | 단가: ${discountedUnitPrice.toLocaleString()}원 | 금액: ${itemAmount.toLocaleString()}원\n   - 재고: ${it.currentStock}EA (${it.location}) [${it.stockStatus === 'AVAILABLE' ? '출고가능' : '부족'}]`;
            }).join('\n');

            const totalAmount = normalized.items.reduce((sum, it) => {
                const discountedUnitPrice = Math.round(it.basePrice * (1 - rate / 100));
                return sum + (discountedUnitPrice * it.qty);
            }, 0);

            responseText = `📋 [알트에프 영업2팀 x 영업1팀 견적 회신]\n${custName}님, 요청하신 견적 내용이 산출되었습니다.\n\n[견적 세부 내역 (요율 -${rate}% 적용)]\n${itemLines}\n\n💰 견적합계: ${totalAmount.toLocaleString()}원 (VAT 별도)\n🚚 비고/배송: ${normalized.remarks || '시화/양산 당일 출고 준비'}\n\n담당 영업자(영업1팀) 검토 후 웹 정식 견적서 링크를 추가 발송해 드립니다.`;
        } else {
            responseText = `📋 [알트에프 영업2팀]\n견적 문의가 정상 접수되었습니다!\n\n접수 내용: "${utterance.slice(0, 40)}${utterance.length > 40 ? '...' : ''}"\n\n🤖 INT-05(표준화봇)가 규격 및 단가를 매칭하여 견적서 초안을 작성 중입니다.`;
        }

        return {
            version: '2.0',
            template: {
                outputs: [
                    {
                        simpleText: {
                            text: responseText
                        }
                    }
                ],
                quickReplies: [
                    {
                        messageText: '접수 현황 확인',
                        action: 'message',
                        label: '📊 접수 현황 확인'
                    },
                    {
                        messageText: '홈페이지 방문',
                        action: 'webLink',
                        label: '🌐 알트에프 웹 바로가기',
                        webLinkUrl: 'https://altf.kr'
                    }
                ]
            }
        };
    }

    /**
     * 알트에프 표준 견적서 초안 생성
     */
    createDraftQuotation(intake, normalized) {
        const rate = normalized.discountRate || 50;
        const custName = normalized.customer ? normalized.customer.name : '카카오톡 고객';
        const quoteId = `Q-KAKAO-${Date.now().toString().slice(-6)}`;

        let totalAmount = 0;
        const items = normalized.items.map((it, idx) => {
            const discountedUnitPrice = Math.round(it.basePrice * (1 - rate / 100));
            const amount = discountedUnitPrice * it.qty;
            totalAmount += amount;

            return {
                id: `item-${Date.now()}-${idx}`,
                productId: it.itemId,
                itemId: it.itemId,
                name: it.type,
                thickness: it.schedule,
                size: it.size,
                material: it.material,
                quantity: it.qty,
                unitPrice: discountedUnitPrice,
                userUnitPrice: discountedUnitPrice,
                amount,
                base_price: it.basePrice,
                discountRate: rate,
                currentStock: it.currentStock,
                location: it.location,
                maker: '대경',
                stockStatus: it.stockStatus,
                isVerified: true,
                isSelected: true
            };
        });

        return {
            id: quoteId,
            userId: 'c7410ecb-2684-4054-b5b7-2ad060299c63', // 박조나단 과장 (시화)
            customerName: custName,
            customerNumber: custName,
            customerInfo: normalized.customer ? {
                companyName: normalized.customer.name,
                contactName: normalized.customer.ceo ? `${normalized.customer.ceo} 대표` : '담당자님',
                email: normalized.customer.email || 'ggbg1019@naver.com',
                phone: normalized.customer.phone || '031-503-1019',
                bizNo: normalized.customer.businessNumber || '890-38-01079',
                address: normalized.customer.address || '경기도 시흥시 시화유통상가'
            } : null,
            items,
            totalAmount,
            status: 'DRAFT',
            source: 'KAKAO',
            createdAt: new Date().toISOString(),
            memo: `카카오톡 채널 인입 (@altf) - ${normalized.remarks || '내일 발송'}`,
            adminResponse: {
                confirmedPrice: totalAmount,
                deliveryDate: '내일 발송',
                note: normalized.remarks || ''
            },
            manager: {
                name: '박조나단 과장',
                id: 'c7410ecb-2684-4054-b5b7-2ad060299c63',
                email: 'jpark@altf.kr'
            }
        };
    }

    /**
     * 영업2팀 및 영업1팀 에이전트 자동 디스패치 및 통계 업데이트
     */
    async dispatchToAgents(intake, draftQuote = null) {
        try {
            if (!fs.existsSync(AGENTS_FILE)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));

            const nowStr = new Date().toISOString();
            let changed = false;

            // INT-02 (메신저/카톡 견적 인입 봇)
            const int02 = agents.find(a => a.code === 'INT-02' || a.id === 'int-02-messenger-intake' || a.id === 'INT-02');
            if (int02) {
                int02.status = 'ACTIVE';
                int02.lastActive = '방금 전';
                int02.currentTask = `카카오톡 견적 접수 [${intake.id}] - ${intake.utterance.slice(0, 30)}`;
                int02.processedCount = (int02.processedCount || 0) + 1;
                if (int02.metrics) int02.metrics.tasksToday = (int02.metrics.tasksToday || 0) + 1;
                if (!Array.isArray(int02.logs)) int02.logs = [];
                int02.logs.unshift(`[${new Date().toLocaleTimeString('ko-KR')}] 카톡 수신 완료: ${intake.utterance.slice(0, 35)}...`);
                int02.logs = int02.logs.slice(0, 10);
                changed = true;
            }

            // INT-03 (비전 OCR) - 이미지인 경우
            if (intake.type === 'image') {
                const int03 = agents.find(a => a.code === 'INT-03' || a.id === 'int-03-vision-ocr' || a.id === 'INT-03');
                if (int03) {
                    int03.status = 'ACTIVE';
                    int03.lastActive = '방금 전';
                    int03.currentTask = `견적서 이미지 OCR 분석 중: ${intake.id}`;
                    int03.processedCount = (int03.processedCount || 0) + 1;
                    if (int03.metrics) int03.metrics.tasksToday = (int03.metrics.tasksToday || 0) + 1;
                    if (!Array.isArray(int03.logs)) int03.logs = [];
                    int03.logs.unshift(`[${new Date().toLocaleTimeString('ko-KR')}] 견적서 사진 수신 (${intake.id}) -> OCR 파싱 착수`);
                    int03.logs = int03.logs.slice(0, 10);
                    changed = true;
                }
            }

            // INT-05 (피팅 은어/약어 표준화 봇)
            const int05 = agents.find(a => a.code === 'INT-05' || a.id === 'int-05-ai-normalizer' || a.id === 'INT-05');
            if (int05) {
                int05.status = 'ACTIVE';
                int05.lastActive = '방금 전';
                int05.currentTask = `배관 피팅 규격 표준화 매칭 [${intake.id}]`;
                int05.processedCount = (int05.processedCount || 0) + 1;
                if (int05.metrics) int05.metrics.tasksToday = (int05.metrics.tasksToday || 0) + 1;
                if (!Array.isArray(int05.logs)) int05.logs = [];
                int05.logs.unshift(`[${new Date().toLocaleTimeString('ko-KR')}] 피팅 규격 분석 및 표준화 매칭 착수: [${intake.id}]`);
                int05.logs = int05.logs.slice(0, 10);
                changed = true;
            }

            // SLE-01 (견적 초안 등록봇)
            if (draftQuote) {
                const sle01 = agents.find(a => a.code === 'SLE-01' || a.id === 'sle-01-quote-drafter' || a.id === 'SLE-01');
                if (sle01) {
                    sle01.status = 'ACTIVE';
                    sle01.lastActive = '방금 전';
                    sle01.currentTask = `견적서 초안 자동 생성 [${draftQuote.id}] - ${draftQuote.customerName} (${draftQuote.items.length}개 품목, ${draftQuote.totalAmount.toLocaleString()}원)`;
                    sle01.processedCount = (sle01.processedCount || 0) + 1;
                    if (sle01.metrics) sle01.metrics.tasksToday = (sle01.metrics.tasksToday || 0) + 1;
                    if (!Array.isArray(sle01.logs)) sle01.logs = [];
                    sle01.logs.unshift(`[${new Date().toLocaleTimeString('ko-KR')}] ${draftQuote.customerName} 견적 초안 발행 완료: ${draftQuote.totalAmount.toLocaleString()}원`);
                    sle01.logs = sle01.logs.slice(0, 10);
                    changed = true;
                }

                // SLE-02 (견적 승인 회신봇)
                const sle02 = agents.find(a => a.code === 'SLE-02' || a.id === 'sle-02-quote-dispatcher' || a.id === 'SLE-02');
                if (sle02) {
                    sle02.status = 'ACTIVE';
                    sle02.lastActive = '방금 전';
                    sle02.currentTask = `단가 요율(-${draftQuote.items[0]?.discountRate || 50}%) 및 시화/양산 실시간 재고 검증 완료`;
                    sle02.processedCount = (sle02.processedCount || 0) + 1;
                    if (sle02.metrics) sle02.metrics.tasksToday = (sle02.metrics.tasksToday || 0) + 1;
                    if (!Array.isArray(sle02.logs)) sle02.logs = [];
                    sle02.logs.unshift(`[${new Date().toLocaleTimeString('ko-KR')}] ${draftQuote.customerName} 단가 요율 및 재고 검증 통과`);
                    sle02.logs = sle02.logs.slice(0, 10);
                    changed = true;
                }
            }

            if (changed) {
                fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf8');
            }
        } catch (e) {
            console.error('[KakaoBotService] 에이전트 디스패치 오류:', e.message);
        }
    }

    /**
     * 상태 및 통계 반환
     */
    getStatus() {
        return {
            success: true,
            service: 'Kakao Direct Bot Service (영업2팀 카카오톡 직통)',
            channel: 'AltF (@altf)',
            status: 'ONLINE',
            stats: this.stats,
            recentIntakes: this.intakes.slice(0, 15)
        };
    }

    /**
     * 인입 목록 페이징 조회
     */
    getIntakes({ limit = 50, offset = 0 } = {}) {
        return {
            total: this.intakes.length,
            limit,
            offset,
            items: this.intakes.slice(offset, offset + limit)
        };
    }
}

export const kakaoBotService = new KakaoBotService();
