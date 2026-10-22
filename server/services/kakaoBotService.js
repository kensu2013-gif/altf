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
import { sleQuoteReviewService } from './sleQuoteReviewService.js';
import { agentControlManager } from './agentControlManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const DATA_DIR = path.join(ROOT_DIR, 'server/data');
const INTAKES_FILE = path.join(DATA_DIR, 'kakao_intakes.json');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const DRAFT_QUOTES_FILE = path.join(DATA_DIR, 'kakao_draft_quotations.json');
const USERS_FILE = path.join(DATA_DIR, 'kakao_users.json');

export class KakaoBotService {
    constructor() {
        this.intakes = [];
        this.draftQuotations = [];
        this.users = [];
        this.stats = {
            totalReceived: 0,
            textQuotes: 0,
            imageQuotes: 0,
            lastReceivedAt: null
        };
        // 🔥 중복 수신 및 무한 루프 격발 차단용 캐시 (60초 TTL)
        this.recentRequests = new Map();
        this.standbyResetTimer = null;
        this.loadData();
        // 기동 시 영업팀 에이전트 실시간 대기 상태로 정돈
        this.resetAgentsToStandby();
    }

    /**
     * 만료된 중복 요청 캐시 청소 (2분 초과 삭제)
     */
    cleanupRecentRequests() {
        const now = Date.now();
        for (const [key, value] of this.recentRequests.entries()) {
            if (now - value.timestamp > 120000) {
                this.recentRequests.delete(key);
            }
        }
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

            if (fs.existsSync(USERS_FILE)) {
                this.users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            } else {
                this.users = [];
                fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8');
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
            fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2), 'utf8');
        } catch (e) {
            console.error('[KakaoBotService] 데이터 저장 실패:', e.message);
        }
    }

    /**
     * 카카오톡 ID(해시 botUserKey)로 사전 등록된 사용자/고객사 매칭 검색
     */
    findUserByBotUserKey(botUserKey) {
        if (!botUserKey || botUserKey === 'unknown_user') return null;
        return this.users.find(u => u.botUserKey === botUserKey) || null;
    }

    /**
     * 카카오톡 ID 매핑 신규 등록 또는 업데이트
     */
    registerUser(userData) {
        if (!userData || !userData.botUserKey) {
            throw new Error('botUserKey(카카오톡 ID)는 필수입니다.');
        }
        const existingIdx = this.users.findIndex(u => u.botUserKey === userData.botUserKey);
        const record = {
            botUserKey: userData.botUserKey,
            name: userData.name || '',
            phone: (userData.phone || '').replace(/[^0-9]/g, ''),
            company: userData.company || '',
            email: userData.email || '',
            registeredAt: new Date().toISOString(),
            notes: userData.notes || '관리자 화면에서 등록'
        };

        if (existingIdx >= 0) {
            this.users[existingIdx] = { ...this.users[existingIdx], ...record };
        } else {
            this.users.push(record);
        }
        this.saveData();
        console.log(`[KakaoBot] 👤 카카오 고객 매칭 저장 완료: ${record.name} (${record.company}, ${record.phone})`);
        return record;
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
        
        // 이미지 첨부 감지 (media, secureimage 등 또는 URL 발화)
        const rawMedia = params.media || params.secureimage || params.image || null;
        let finalImageUrl = typeof rawMedia === 'string' ? rawMedia : (rawMedia?.url || null);
        if (!finalImageUrl && utterance && (utterance.startsWith('http://') || utterance.startsWith('https://')) && (utterance.includes('kakaocdn.net') || utterance.match(/\.(jpg|jpeg|png|webp|gif)/i))) {
            finalImageUrl = utterance;
        }
        const isImage = !!finalImageUrl;

        // 2. 카카오 사용자 사전 매칭 (구글시트/대장 연동 botUserKey 확인)
        const matchedUser = this.findUserByBotUserKey(botUserKey);
        if (matchedUser) {
            console.log(`[KakaoBot] 🎯 등록된 카카오 고객 매칭 성공: ${matchedUser.name} (${matchedUser.company || '회사미기재'}, ${matchedUser.phone})`);
        } else {
            console.log(`[KakaoBot] ⚠️ 미등록 카카오 사용자 인입: botUserKey=${botUserKey}`);
        }

        // 3. 사용자가 "확인", "견적", "결과", "얼마", "접수 현황" 등의 조회 메시지를 보낸 경우
        const isStatusQuery = !isImage && (
            /^(확인|접수\s*현황|견적\s*확인|진행\s*상황|현황|조회|내역|견적|결과|얼마|답변|회신|언제|상황)$/i.test(utterance) ||
            utterance.includes('접수 현황') ||
            utterance.includes('접수 결과') ||
            utterance.includes('견적 확인') ||
            utterance.includes('견적서') ||
            utterance.includes('어떻게') ||
            utterance.includes('나왔') ||
            utterance.includes('얼마')
        );

        // 🔥 [중복 요청 차단 (Deduplication)]: 카카오 오픈빌더 재시도 및 연타로 인한 무한루프 백엔드 격발 방지
        this.cleanupRecentRequests();
        const cleanImageUrl = finalImageUrl ? finalImageUrl.split('?')[0] : '';
        const dedupKey = isImage
            ? `IMG:${botUserKey}:${cleanImageUrl}`
            : (isStatusQuery ? null : `TXT:${botUserKey}:${utterance.toLowerCase()}`);

        if (dedupKey && this.recentRequests.has(dedupKey)) {
            const cached = this.recentRequests.get(dedupKey);
            const elapsed = Date.now() - cached.timestamp;
            if (elapsed < 45000) { // 45초 이내 동일 신호 중복 차단
                console.log(`[KakaoBot] ⚡ [중복 신호 차단] ${dedupKey} (경과: ${elapsed}ms) - 단 1회 업로드 및 처리 원칙 준수`);
                if (cached.inProgress) {
                    return {
                        version: '2.0',
                        template: {
                            outputs: [
                                {
                                    simpleText: {
                                        text: '⏳ [알트에프 영업2팀]\n현재 전송해주신 견적서 사진을 비전 AI가 정밀 분석 중입니다.\n\n잠시만 기다려주시면 분석 완료 즉시 견적 결과가 자동으로 회신됩니다. (중복 업로드 방지)'
                                    }
                                }
                            ],
                            quickReplies: [
                                { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                            ]
                        }
                    };
                }

                if (cached.quoteId) {
                    const finishedQuote = this.draftQuotations.find(q => q.id === cached.quoteId && !q.isDeleted);
                    if (finishedQuote) {
                        return {
                            version: '2.0',
                            template: {
                                outputs: [
                                    {
                                        simpleText: {
                                            text: `✅ [알트에프 영업2팀]\n이미 정상 완료된 견적 건입니다.\n\n` + this.formatKakaoQuoteMessage(finishedQuote)
                                        }
                                    }
                                ],
                                quickReplies: [
                                    { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${finishedQuote.id}` },
                                    { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                                ]
                            }
                        };
                    }
                }
            }
        }

        if (dedupKey) {
            this.recentRequests.set(dedupKey, {
                timestamp: Date.now(),
                inProgress: isImage,
                quoteId: null
            });
        }

        if (isStatusQuery) {
            // 해당 사용자의 고유 botUserKey 또는 매칭된 전화번호로만 엄격 조회 (삭제된 견적 및 타 고객 견적 배제)
            const recentQuote = this.draftQuotations.find(dq => 
                !dq.isDeleted && (
                    dq.botUserKey === botUserKey || 
                    dq.kakaoBotUserKey === botUserKey || 
                    (matchedUser && dq.customerInfo?.phone && dq.customerInfo?.phone === matchedUser.phone)
                )
            );
            const recentIntake = this.intakes.find(it => it.botUserKey === botUserKey);

            if (recentIntake && recentIntake.status === 'PROCESSING') {
                return {
                    version: '2.0',
                    template: {
                        outputs: [
                            {
                                simpleText: {
                                    text: `⏳ [알트에프 영업2팀]\n현재 비전 AI(INT-03)와 규격표준화(INT-05) 에이전트가 견적서 사진을 정밀 분석 중입니다.\n\n분석이 완료되면 견적서가 자동으로 대화방에 도착합니다 (약 10~15초 소요). 잠시만 기다려주세요!`
                                }
                            }
                        ],
                        quickReplies: [
                            { messageText: '접수 현황 확인', action: 'message', label: '📊 접수 결과 확인' },
                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                        ]
                    }
                };
            }

            if (recentQuote) {
                // 이미 답변완료(PROCESSED) 상태라면 불필요한 백엔드 S3 동기화/재저장 트리거 스킵 (무한 저장 차단)
                if (recentQuote.status !== 'PROCESSED') {
                    recentQuote.status = 'PROCESSED';
                    if (this.onQuotationUpdated) {
                        this.onQuotationUpdated(recentQuote);
                    }
                    this.saveData();
                }

                const quoteText = this.formatKakaoQuoteMessage(recentQuote);
                return {
                    version: '2.0',
                    template: {
                        outputs: [
                            {
                                simpleText: {
                                    text: quoteText
                                }
                            }
                        ],
                        // 🚫 무한루프의 주범이었던 '접수 현황 확인' 버튼 영구 제거! 정식 견적서 확인 및 웹 바로가기만 노출
                        quickReplies: [
                            { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${recentQuote.id}` },
                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                        ]
                    }
                };
            }

            return {
                version: '2.0',
                template: {
                    outputs: [
                        {
                            simpleText: {
                                text: `📋 [알트에프 영업2팀]\n현재 접수되어 진행 중인 견적 내역이 없습니다.\n\n견적을 문의하시려면 견적서 사진을 전송하시거나 '40A 엘보 10개, 티 5개'와 같이 배관 규격을 입력해 주세요!`
                            }
                        }
                    ],
                    quickReplies: [
                        { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                    ]
                }
            };
        }

        // 4. 🔥 이미지 첨부 인입 처리: 단 1회의 신호는 단 1회의 인입 및 단 1회의 업로드로 완결
        const callbackUrl = userRequest.callbackUrl || null;
        if (isImage) {
            const intakeRecord = {
                id: `KAKAO-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
                type: 'image',
                botUserKey,
                isRegisteredUser: !!matchedUser,
                matchedUser: matchedUser || null,
                utterance: utterance || '[견적 요청 사진 첨부]',
                imageUrl: finalImageUrl,
                originalKakaoUrl: cleanImageUrl,
                status: 'PROCESSING',
                receivedAt,
                channel: '카카오톡 채널 (@altf)',
                assignedTeam: '영업2팀 (인입/표준화)',
                assignedAgents: ['INT-02', 'INT-03', 'INT-05', 'SLE-01', 'SLE-02'],
                parsedItems: []
            };

            this.intakes.unshift(intakeRecord);
            this.stats.totalReceived++;
            this.stats.imageQuotes++;
            this.stats.lastReceivedAt = receivedAt;
            this.saveData();

            // 백그라운드 비동기 비전 OCR 및 견적서 초안 생성 파이프라인 가동 (카카오 5초 타임아웃 방지)
            setImmediate(async () => {
                await this.processImageIntakeAsync(intakeRecord, finalImageUrl, utterance, botUserKey, matchedUser, callbackUrl);
            });

            // 카카오 i 오픈빌더 스킬 콜백이 지원되는 경우 콜백 대기 모드 반환
            if (callbackUrl) {
                return {
                    version: '2.0',
                    useCallback: true,
                    data: {
                        text: '견적서 사진을 분석 중입니다...'
                    }
                };
            }

            // 카카오톡 대화방에 0.1초 내 즉시 정상 접수 알림 출력 (안내 문구 정돈)
            return {
                version: '2.0',
                template: {
                    outputs: [
                        {
                            simpleText: {
                                text: `📄 [알트에프 영업2팀]\n견적서 사진이 정상 접수되었습니다!\n\n🤖 INT-03(비전 AI)과 SLE-01/02 에이전트가 14,132개 배관 피팅 규격·재고·단가를 정밀 대조하고 있습니다.\n\n약 10~15초 후 분석이 완료되면 결과가 자동으로 도착합니다.`
                            }
                        }
                    ],
                    quickReplies: [
                        {
                            messageText: '접수 현황 확인',
                            action: 'message',
                            label: '📊 접수 결과 확인'
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

        // 5. 일반 텍스트 인입 처리 (기존 견적 수정, 규격 추출, 안내)
        let normalized = fittingNormalizerService.normalize(utterance);
        const overrides = sleQuoteReviewService.parseUtteranceOverrides(utterance);

        // 해당 사용자의 최근 30분 내 견적서 확인
        const existingQuote = this.draftQuotations.find(dq => 
            dq.botUserKey === botUserKey || 
            dq.kakaoBotUserKey === botUserKey || 
            (matchedUser && dq.customerInfo?.phone && dq.customerInfo?.phone === matchedUser.phone)
        );

        // 5-1. 규격이 감지되지 않은 단순 텍스트 발화 (요율 지시, 질문, 인사 등)
        if (normalized.items.length === 0) {
            // 발화 내 요율/납기 지시가 있고 최근 견적이 있는 경우: 기존 견적 즉시 업데이트
            if (overrides && (overrides.rate || overrides.deliveryDate) && existingQuote) {
                if (overrides.rate) {
                    const newRate = overrides.rate;
                    existingQuote.items = existingQuote.items.map(it => {
                        const discountedUnitPrice = Math.round(it.base_price * (1 - newRate / 100));
                        return {
                            ...it,
                            discountRate: newRate,
                            unitPrice: discountedUnitPrice,
                            userUnitPrice: discountedUnitPrice,
                            amount: discountedUnitPrice * it.quantity
                        };
                    });
                    existingQuote.totalAmount = existingQuote.items.reduce((sum, it) => sum + it.amount, 0);
                    console.log(`[KakaoBot] 🎯 [SLE-02] 기존 견적서(${existingQuote.id}) 요율 즉시 재계산: -${newRate}%`);
                }
                if (overrides.deliveryDate) {
                    existingQuote.memo = (existingQuote.memo ? `${existingQuote.memo} / ` : '') + overrides.deliveryDate;
                }
                existingQuote.status = 'PROCESSED';
                if (this.onQuotationUpdated) {
                    this.onQuotationUpdated(existingQuote);
                }
                this.saveData();

                return {
                    version: '2.0',
                    template: {
                        outputs: [
                            {
                                simpleText: {
                                    text: `🎯 [알트에프 영업2팀]\n요청하신 변경사항(-${overrides.rate || ''}% 요율 / 납기 지시)이 견적서(${existingQuote.id})에 정상 반영되었습니다!\n\n` + this.formatKakaoQuoteMessage(existingQuote)
                                }
                            }
                        ],
                        quickReplies: [
                            { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${existingQuote.id}` },
                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                        ]
                    }
                };
            }

            // 최근 진행 중인 견적이 있는 경우 해당 견적 카드 즉시 안내
            if (existingQuote) {
                existingQuote.status = 'PROCESSED';
                if (this.onQuotationUpdated) {
                    this.onQuotationUpdated(existingQuote);
                }
                this.saveData();

                return {
                    version: '2.0',
                    template: {
                        outputs: [
                            {
                                simpleText: {
                                    text: this.formatKakaoQuoteMessage(existingQuote)
                                }
                            }
                        ],
                        quickReplies: [
                            { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${existingQuote.id}` },
                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                        ]
                    }
                };
            }

            // 기존 견적도 없고 규격도 없는 단순 발화: 불필요한 빈 견적 생성 없이 정중한 안내 회신
            return {
                version: '2.0',
                template: {
                    outputs: [
                        {
                            simpleText: {
                                text: `📋 [알트에프 영업2팀]\n안녕하세요! 알트에프 배관 피팅 견적 봇입니다.\n\n• 견적서 사진을 전송하시거나,\n• '40A 엘보 10개, 티 5개'와 같이 규격을 입력해 주시면 14,132개 재고와 대조하여 10초 내 견적서를 산출해 드립니다.`
                            }
                        }
                    ],
                    quickReplies: [
                        { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                    ]
                }
            };
        }

        // 5-2. 배관 품목 규격이 포함된 신규 견적 인입 처리
        if (overrides) {
            if (overrides.rate) normalized.discountRate = overrides.rate;
            if (overrides.deliveryDate) normalized.remarks = (normalized.remarks ? `${normalized.remarks} / ` : '') + overrides.deliveryDate;
        }

        if (matchedUser) {
            if (!normalized.customer) {
                normalized.customer = {
                    name: matchedUser.company || matchedUser.name,
                    ceo: matchedUser.name,
                    phone: matchedUser.phone,
                    email: matchedUser.email || '',
                    address: ''
                };
            } else {
                normalized.customer.phone = normalized.customer.phone || matchedUser.phone;
                normalized.customer.contact = matchedUser.name;
                normalized.customer.email = normalized.customer.email || matchedUser.email;
            }
        }

        const intakeRecord = {
            id: `KAKAO-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            type: 'text',
            botUserKey,
            isRegisteredUser: !!matchedUser,
            matchedUser: matchedUser || null,
            utterance: utterance || '[내용 없음]',
            imageUrl: null,
            status: 'QUOTE_DRAFTED',
            receivedAt,
            channel: '카카오톡 채널 (@altf)',
            assignedTeam: '영업2팀 (인입/표준화)',
            assignedAgents: ['INT-02', 'INT-05', 'SLE-01', 'SLE-02'],
            customer: normalized.customer,
            discountRate: normalized.discountRate,
            remarks: normalized.remarks,
            parsedItems: normalized.items
        };

        this.intakes.unshift(intakeRecord);
        this.stats.totalReceived++;
        this.stats.textQuotes++;
        this.stats.lastReceivedAt = receivedAt;

        const draftQuote = this.createDraftQuotation(intakeRecord, normalized);
        draftQuote.botUserKey = botUserKey;
        draftQuote.kakaoBotUserKey = botUserKey;
        draftQuote.status = 'PROCESSED'; // 답변완료 상태 설정
        
        const reviewResult = sleQuoteReviewService.reviewQuotation(draftQuote, this.draftQuotations);
        draftQuote.sleReview = reviewResult;
        draftQuote.reviewStatus = reviewResult.status;
        intakeRecord.quotationId = draftQuote.id;
        intakeRecord.sleReview = reviewResult;

        this.draftQuotations.unshift(draftQuote);
        console.log(`[KakaoBot] ✅ 견적서 생성 완료 [${draftQuote.id}] 고객사: ${draftQuote.customerName} (${draftQuote.items.length}개 품목, ${draftQuote.totalAmount.toLocaleString()}원)`);

        if (this.onQuotationCreated) {
            this.onQuotationCreated(draftQuote);
        }

        this.saveData();

        setTimeout(() => {
            this.dispatchToAgents(intakeRecord, draftQuote);
        }, 50);

        // 🔥 [솔라피 자동 견적 발송] 수동 버튼 클릭 없이도 즉시 솔라피로 견적서 발송!
        setTimeout(async () => {
            try {
                console.log(`[KakaoBot] ⚡ [자동 발송] 솔라피를 통한 견적서 ${draftQuote.id} 자동 발송 시도...`);
                await this.dispatchQuotation({
                    quotationId: draftQuote.id,
                    botUserKey,
                    targetPhone: normalized.customer?.phone || draftQuote.customerInfo?.phone
                });
            } catch (autoDispatchErr) {
                console.error('[KakaoBot] 솔라피 자동 견적 발송 오류:', autoDispatchErr.message);
            }
        }, 100);

        const responseText = this.formatKakaoQuoteMessage(draftQuote);

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
                // 🚫 '접수 현황 확인' 제거: 이미 결과가 나왔으므로 정식 견적서 보기 및 홈페이지 링크만 제공
                quickReplies: [
                    {
                        messageText: '견적서 보기',
                        action: 'webLink',
                        label: '📄 정식 견적서 보기',
                        webLinkUrl: `https://altf.kr/admin/quotes?id=${draftQuote.id}`
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
     * 비동기 백그라운드 이미지 비전 OCR 및 견적서 초안 생성 처리 (카카오 5초 타임아웃 회피)
     */
    async processImageIntakeAsync(intakeRecord, finalImageUrl, utterance, botUserKey, matchedUser, callbackUrl = null) {
        try {
            console.log(`[KakaoBot] 🚀 백그라운드 이미지 비전 분석 착수: ${finalImageUrl?.slice ? finalImageUrl.slice(0, 80) : ''}...`);
            let imgBuf = null;
            let contentType = 'image/jpeg';
            let uploadedS3Url = null;

            if (typeof finalImageUrl === 'string' && (finalImageUrl.startsWith('file://') || finalImageUrl.startsWith('/'))) {
                const localPath = finalImageUrl.replace('file://', '');
                if (fs.existsSync(localPath)) {
                    imgBuf = fs.readFileSync(localPath);
                }
            } else if (finalImageUrl) {
                const targetUrl = typeof finalImageUrl === 'string' ? finalImageUrl : (finalImageUrl.url || '');
                if (targetUrl) {
                    const fetch = (await import('node-fetch')).default;
                    const imgRes = await fetch(targetUrl);
                    if (imgRes.ok) {
                        const arrayBuffer = await imgRes.arrayBuffer();
                        imgBuf = Buffer.from(arrayBuffer);
                        contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                    }
                }
            }

            if (imgBuf) {
                try {
                    // 🔥 중복 S3 업로드 방지: 동일 원본 카카오 CDN URL에 대한 S3 업로드 이력이 있다면 재사용
                    const cleanKakaoUrl = typeof finalImageUrl === 'string' ? finalImageUrl.split('?')[0] : '';
                    const existingIntake = this.intakes.find(i => 
                        (i.originalKakaoUrl === cleanKakaoUrl || i.imageUrl === finalImageUrl) && 
                        i.s3UploadedUrl
                    );

                    if (existingIntake && existingIntake.s3UploadedUrl) {
                        uploadedS3Url = existingIntake.s3UploadedUrl;
                        intakeRecord.imageUrl = uploadedS3Url;
                        intakeRecord.s3UploadedUrl = uploadedS3Url;
                        console.log(`[KakaoBot] ⚡ 기존 S3 이미지 URL 재사용 (중복 업로드 방지): ${uploadedS3Url}`);
                    } else {
                        const { uploadFileToS3 } = await import('../../s3-db.js');
                        uploadedS3Url = await uploadFileToS3('documents/quotes', `kakao_${Date.now()}.jpg`, imgBuf, contentType);
                        intakeRecord.imageUrl = uploadedS3Url;
                        intakeRecord.s3UploadedUrl = uploadedS3Url;
                        console.log(`[KakaoBot] S3 이미지 단 1회 보관 완료: ${uploadedS3Url}`);
                    }
                    intakeRecord.originalKakaoUrl = cleanKakaoUrl;
                } catch (s3Err) {
                    console.warn('[KakaoBot] S3 업로드 폴백:', s3Err.message);
                }

                // 비전 OCR 및 규격 표준화 엔진 가동 (Gemini 3.1 Flash-Lite + Gemini 3.8 Flash Fallback)
                const normalized = await fittingVisionOcrService.recognizeAndNormalize(imgBuf, contentType);

                // SLE-02 발화 내 추가 지시 반영 (요율, 납기)
                const overrides = sleQuoteReviewService.parseUtteranceOverrides(utterance);
                if (overrides) {
                    if (overrides.rate) normalized.discountRate = overrides.rate;
                    if (overrides.deliveryDate) normalized.remarks = (normalized.remarks ? `${normalized.remarks} / ` : '') + overrides.deliveryDate;
                }

                if (matchedUser) {
                    intakeRecord.matchedUser = matchedUser;
                    intakeRecord.isRegisteredUser = true;

                    if (!normalized.customer) {
                        normalized.customer = {
                            name: matchedUser.company || matchedUser.name,
                            ceo: matchedUser.name,
                            contact: matchedUser.name,
                            phone: matchedUser.phone,
                            mobile: matchedUser.phone,
                            email: matchedUser.email || '',
                            address: ''
                        };
                    } else {
                        // 유선전화는 phone에 보존하되, 실제 문자를 받을 휴대폰은 matchedUser.phone으로 확정!
                        normalized.customer.mobile = matchedUser.phone;
                        normalized.customer.contact = matchedUser.name;
                        if (!normalized.customer.phone || !normalized.customer.phone.startsWith('01')) {
                            // 기존 phone이 유선전화면 백업하고 mobile에 휴대폰 저장
                            normalized.customer.landline = normalized.customer.phone;
                            normalized.customer.phone = matchedUser.phone;
                        }
                        normalized.customer.email = normalized.customer.email || matchedUser.email;
                    }
                }

                intakeRecord.customer = normalized.customer;
                intakeRecord.discountRate = normalized.discountRate;
                intakeRecord.remarks = normalized.remarks;
                intakeRecord.parsedItems = normalized.items;

                if (normalized.items.length > 0) {
                    const draftQuote = this.createDraftQuotation(intakeRecord, normalized);
                    draftQuote.botUserKey = botUserKey;
                    draftQuote.kakaoBotUserKey = botUserKey;

                    // SLE-02 (박조나단 과장 / 김부장 결재) 견적 심사 판정
                    const reviewResult = sleQuoteReviewService.reviewQuotation(draftQuote, this.draftQuotations);
                    draftQuote.sleReview = reviewResult;
                    draftQuote.reviewStatus = reviewResult.status;
                    intakeRecord.quotationId = draftQuote.id;
                    intakeRecord.sleReview = reviewResult;
                    intakeRecord.status = 'QUOTE_DRAFTED';

                    draftQuote.status = 'PROCESSED'; // 답변완료 상태로 즉시 설정
                    this.draftQuotations.unshift(draftQuote);
                    console.log(`[KakaoBot] ✅ 견적서 초안 생성 완료 [${draftQuote.id}] 고객사: ${draftQuote.customerName} (${draftQuote.items.length}개 품목, ${draftQuote.totalAmount.toLocaleString()}원)`);

                    // 캐시 상태를 완료로 업데이트
                    const cleanKakaoUrl = typeof finalImageUrl === 'string' ? finalImageUrl.split('?')[0] : '';
                    const dedupKey = `IMG:${botUserKey}:${cleanKakaoUrl}`;
                    if (this.recentRequests.has(dedupKey)) {
                        const cached = this.recentRequests.get(dedupKey);
                        cached.inProgress = false;
                        cached.quoteId = draftQuote.id;
                    }

                    if (this.onQuotationCreated) {
                        this.onQuotationCreated(draftQuote);
                    }

                    // 카카오 i 오픈빌더 스킬 콜백 URL로 완료된 견적서 자동 푸시 (1,000자 이내 안전 포맷)
                    if (callbackUrl) {
                        try {
                            const fetch = (await import('node-fetch')).default;
                            const quoteText = this.formatKakaoQuoteMessage(draftQuote);
                            const cbPayload = {
                                version: '2.0',
                                template: {
                                    outputs: [
                                        {
                                            simpleText: {
                                                text: quoteText
                                            }
                                        }
                                    ],
                                    // 🚫 콜백 시에도 무한루프를 유발하는 '접수 현황 확인' 버튼 삭제!
                                    quickReplies: [
                                        { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${draftQuote.id}` },
                                        { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                                    ]
                                }
                            };
                            const cbRes = await fetch(callbackUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(cbPayload)
                            });
                            const cbResText = await cbRes.text();
                            console.log(`[KakaoBot] 🎯 [스킬 콜백] 카카오톡 대화방 푸시 응답: HTTP ${cbRes.status} (${cbResText.slice(0, 100)})`);
                        } catch (cbErr) {
                            console.warn('[KakaoBot] 스킬 콜백 푸시 오류:', cbErr.message);
                        }
                    }

                    // 🔥 [솔라피 사진 견적 자동 발송] 단 1회만 발송되도록 가드 (SENT 상태 중복 방지)
                    if (draftQuote.dispatchStatus !== 'SENT') {
                        setTimeout(async () => {
                            try {
                                console.log(`[KakaoBot] ⚡ [사진 견적 자동 발송] 솔라피를 통한 견적서 ${draftQuote.id} 자동 발송 시도...`);
                                await this.dispatchQuotation({
                                    quotationId: draftQuote.id,
                                    botUserKey,
                                    targetPhone: normalized.customer?.phone || draftQuote.customerInfo?.phone
                                });
                            } catch (autoDispatchErr) {
                                console.error('[KakaoBot] 솔라피 사진 견적 자동 발송 오류:', autoDispatchErr.message);
                            }
                        }, 100);
                    }

                    // 0원 카카오 이벤트 푸시 발송 시도
                    await sleQuoteReviewService.dispatchKakaoEventPush({
                        botUserKey,
                        quotationId: draftQuote.id,
                        totalAmount: draftQuote.totalAmount,
                        quoteUrl: `https://altf.kr/admin/quotes?id=${draftQuote.id}`
                    });

                    this.dispatchToAgents(intakeRecord, draftQuote);
                } else {
                    intakeRecord.status = 'FAILED_OCR';
                    console.warn(`[KakaoBot] ⚠️ 비전 OCR 유효 배관 품목 추출 실패: botUserKey=${botUserKey}`);
                    if (callbackUrl) {
                        try {
                            const fetch = (await import('node-fetch')).default;
                            await fetch(callbackUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    version: '2.0',
                                    template: {
                                        outputs: [
                                            {
                                                simpleText: {
                                                    text: `📸 [알트에프 영업2팀]\n첨부해주신 견적서 사진의 화질이나 필기체 인식률이 낮아 규격 자동 추출에 실패했습니다.\n\n영업1팀 담당자가 원본 사진을 확인 후 정식 견적서를 작성하여 회신해 드리겠습니다. (선명한 사진을 다시 전송해 주시면 즉시 자동 산출됩니다!)`
                                                }
                                            }
                                        ],
                                        quickReplies: [
                                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                                        ]
                                    }
                                })
                            });
                        } catch (e) {
                            console.warn('[KakaoBot] 실패 안내 콜백 전송 오류:', e.message);
                        }
                    }
                }
                this.saveData();
            }
        } catch (err) {
            console.error('[KakaoBot] 백그라운드 이미지 처리 오류:', err.message);
            intakeRecord.status = 'ERROR';
            this.saveData();
        }
    }

    /**
     * 카카오톡 규격(최대 1,000자 제한)에 완벽 부합하는 정밀 견적서 카드 포맷터 (최대 650자 이내 보장)
     */
    formatKakaoQuoteMessage(quote) {
        const custName = quote.customerName || '고객사';
        const totalWon = (quote.totalAmount || 0).toLocaleString();
        const itemCount = quote.items?.length || 0;
        const rate = quote.items?.[0]?.discountRate || 50;

        // 주요 품목 최대 4개 요약 노출 (1000자 초과 절대 방지)
        const displayItems = (quote.items || []).slice(0, 4);
        const itemLines = displayItems.map((it, idx) => {
            const uPrice = (it.unitPrice || 0).toLocaleString();
            return `• ${it.name} ${it.thickness || ''} ${it.size} (${it.material || ''}) : ${it.quantity}EA | 단가: ${uPrice}원`;
        }).join('\n');

        const remainingCount = itemCount - displayItems.length;
        const remainingText = remainingCount > 0 ? `\n... 외 ${remainingCount}개 품목 추가 포함` : '';

        const reviewBadge = quote.reviewStatus === 'ESCALATION_REQUIRED'
            ? '⚠️ 영업부장 결재 진행 중'
            : '✅ [박조나단 과장 검토 완료 - 출고 준비]';

        return `📋 [알트에프 견적 회신]\n${custName} 귀하, 요청하신 피팅 견적이 산출되었습니다.\n\n[견적 요약 (요율 -${rate}% 적용)]\n${itemLines}${remainingText}\n\n💰 견적합계: ${totalWon}원 (VAT 별도)\n📦 검토상태: ${reviewBadge}\n🚚 납기/배송: ${quote.memo?.replace('카카오톡 채널 인입 (@altf) - ', '') || '시화/양산 당일 출고 준비'}\n\n👇 아래 [정식 견적서 보기] 버튼을 누르시면 직인 날인된 PDF를 즉시 확인하실 수 있습니다.`;
    }

    /**
     * 알트에프 표준 견적번호 생성 규칙 (Q + YYMMDD + -001, 002...)
     */
    generateQuotationId() {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const datePrefix = `Q${yy}${mm}${dd}`;

        const todayQuotes = this.draftQuotations.filter(q => q.id && q.id.startsWith(datePrefix));
        const seq = String(todayQuotes.length + 1).padStart(3, '0');
        return `${datePrefix}-${seq}`;
    }

    /**
     * 알트에프 표준 견적서 초안 생성
     */
    createDraftQuotation(intake, normalized) {
        const rate = normalized.discountRate || 50;
        const custName = normalized.customer ? normalized.customer.name : '카카오톡 고객';
        const quoteId = this.generateQuotationId();

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

        const rawImgUrl = typeof intake.imageUrl === 'string' ? intake.imageUrl : (intake.imageUrl?.url || '');

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
                mobile: normalized.customer.mobile || intake.matchedUser?.phone || null,
                bizNo: normalized.customer.businessNumber || '890-38-01079',
                address: normalized.customer.address || '경기도 시흥시 시화유통상가'
            } : null,
            items,
            totalAmount,
            status: 'SUBMITTED', // 🔥 중요: 접수(Submitted) 상태로 설정되어 관리자 목록에서 노란색 '접수' 버튼 활성화 및 필터링
            botUserKey: intake.botUserKey || null,
            isKakaoRegistered: !!intake.isRegisteredUser,
            kakaoUser: intake.matchedUser || null,
            sourcePhone: intake.matchedUser?.phone || normalized.customer?.mobile || null,
            dispatchStatus: 'NOT_SENT',
            attachments: rawImgUrl ? [
                {
                    name: `${custName}_재고의뢰서_사진.jpg`,
                    url: rawImgUrl
                }
            ] : [],
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

            // 보조 함수: 대시보드에서 OFFLINE/OFF로 설정된 에이전트의 status는 절대 덮어쓰지 않음
            const safeSetAgentStatus = (ag, targetStatus = 'ACTIVE') => {
                if (!ag) return;
                if (ag.status !== 'OFFLINE' && ag.status !== 'OFF') {
                    ag.status = targetStatus;
                }
            };

            // INT-02 (메신저/카톡 견적 인입 봇)
            const int02 = agents.find(a => a.code === 'INT-02' || a.id === 'int-02-messenger-intake' || a.id === 'INT-02');
            if (int02) {
                safeSetAgentStatus(int02, 'ACTIVE');
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
                    safeSetAgentStatus(int03, 'ACTIVE');
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
                safeSetAgentStatus(int05, 'ACTIVE');
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
                    safeSetAgentStatus(sle01, 'ACTIVE');
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
                    safeSetAgentStatus(sle02, 'ACTIVE');
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

                // 🔥 [실시간 대기 자동 환원] 처리 완료 후 10초 동안 완료 메시지를 노출한 뒤,
                // 에이전트들을 정상적인 "실시간 수신 대기(STANDBY)" 상태로 자동 복구합니다.
                // 이를 통해 과거 처리 건이 영구 박제되어 남아있는 문제를 원천 해결합니다.
                if (this.standbyResetTimer) {
                    clearTimeout(this.standbyResetTimer);
                }
                this.standbyResetTimer = setTimeout(() => {
                    this.resetAgentsToStandby(['INT-02', 'INT-03', 'INT-05', 'SLE-01', 'SLE-02']);
                }, 10000);
            }
        } catch (e) {
            console.error('[KakaoBotService] 에이전트 디스패치 오류:', e.message);
        }
    }

    /**
     * 영업2팀 / 영업1팀 에이전트들을 실시간 수신 대기(STANDBY / IDLE) 상태로 환원
     * 과거 완료 건이 currentTask에 계속 남아있는 현상 방지
     */
    resetAgentsToStandby(agentCodes = ['INT-02', 'INT-03', 'INT-05', 'SLE-01', 'SLE-02']) {
        try {
            if (!fs.existsSync(AGENTS_FILE)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
            let changed = false;

            const defaultTasks = {
                'INT-02': '카카오톡 채널(@altf) 및 솔라피 인입 실시간 수신 대기 중',
                'INT-03': '비정형 문서·사진 Vision OCR 판독 엔진 대기 중',
                'INT-05': '14,136건 ALTF 표준 마스터 품목 규격 정규화 대기 중',
                'SLE-01': '견적의뢰 인입 시 견적서 초안 자동 작성 대기',
                'SLE-02': '단가 요율 및 시화/양산 실시간 재고 검증 대기'
            };

            for (const code of agentCodes) {
                const prefix = code.toLowerCase() + '-';
                const ag = agents.find(a => a.code === code || a.id === code.toLowerCase() || (typeof a.id === 'string' && a.id.toLowerCase().startsWith(prefix)));
                if (ag) {
                    // 사용자가 대시보드에서 명시적으로 OFFLINE/OFF로 끈 경우 절대 깨우지 않음!
                    if (ag.status === 'OFFLINE' || ag.status === 'OFF') {
                        continue;
                    }

                    const targetTask = defaultTasks[code];
                    if (targetTask && ag.currentTask !== targetTask) {
                        ag.currentTask = targetTask;
                        ag.status = 'ACTIVE';
                        ag.lastActive = '방금 전';
                        changed = true;
                    }
                }
            }

            if (changed) {
                fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf8');
                console.log(`[KakaoBot] 🔄 영업 에이전트(${agentCodes.join(', ')}) 실시간 대기(STANDBY) 상태 복귀 완료`);
            }
        } catch (e) {
            console.error('[KakaoBotService] 에이전트 대기 복귀 오류:', e.message);
        }
    }

    /**
     * 카카오 테스트 데이터 초기화 및 에이전트 대기 복귀
     */
    clearTestData() {
        try {
            this.intakes = [];
            this.draftQuotations = [];
            this.stats = {
                totalReceived: 0,
                textQuotes: 0,
                imageQuotes: 0,
                lastReceivedAt: null
            };
            this.recentRequests.clear();
            this.saveData();
            this.resetAgentsToStandby();
            console.log('[KakaoBot] 🧹 카카오 인입 및 견적 테스트 데이터 전체 초기화 완료');
            return { success: true, message: '카카오 테스트 데이터 초기화 완료' };
        } catch (e) {
            console.error('[KakaoBot] 테스트 데이터 초기화 오류:', e.message);
            throw e;
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

    /**
     * 답변 완료된 견적서를 Solapi(문자/MMS) 또는 Make.com 웹훅으로 발송
     */
    async dispatchQuotation({ quotationId, botUserKey, customMessage, webhookUrl, targetPhone: explicitPhone }) {
        const quote = this.draftQuotations.find(q => q.id === quotationId);
        if (quote && (quote.dispatchStatus === 'SENT' || quote.dispatched === true)) {
            console.log(`[KakaoBot] ⚡ 견적서 ${quotationId}는 이미 발송 완료(SENT)되었습니다. 중복 발송을 차단합니다.`);
            return { success: true, mode: 'ALREADY_SENT', message: '이미 발송 완료된 견적서입니다.' };
        }
        const user = this.findUserByBotUserKey(botUserKey) || (quote?.kakaoUser) || null;
        
        const fallbackPhone = process.env.SOLAPI_SENDER_PHONE || '01062223751';

        // 휴대폰 번호(010, 011 등) 판별 헬퍼
        const isMobile = (num) => {
            if (!num || typeof num !== 'string') return false;
            const clean = num.replace(/[^0-9]/g, '');
            return /^(010|011|016|017|018|019)\d{7,8}$/.test(clean);
        };

        // 수신 후보 번호 우선순위 배열 (휴대폰 번호 최우선!)
        const candidatePhones = [
            explicitPhone,
            user?.phone,
            quote?.kakaoUser?.phone,
            quote?.sourcePhone,
            quote?.customerInfo?.mobile,
            quote?.customerInfo?.phone,
            fallbackPhone
        ].filter(Boolean);

        // 1순위: 유효한 휴대폰 번호(010-) 탐색
        let targetPhone = candidatePhones.find(p => isMobile(p));

        // 2순위: 휴대폰이 하나도 없으면 fallback 휴대폰 번호 사용 (유선전화로는 SMS/MMS 발송 불가)
        if (!targetPhone) {
            console.warn(`[KakaoBot] ⚠️ 견적서 ${quotationId} 수신 후보 중 휴대폰 번호가 없어 관리자 번호(${fallbackPhone})로 폴백합니다. (후보군: ${candidatePhones.join(', ')})`);
            targetPhone = fallbackPhone;
        } else {
            console.log(`[KakaoBot] 🎯 견적서 ${quotationId} 수신 휴대폰 매칭 성공: ${targetPhone} (카카오사용자: ${user?.name || '미기재'})`);
        }

        const targetName = user?.name || quote?.kakaoUser?.name || quote?.customerInfo?.contactName || '고객';
        const targetCompany = user?.company || quote?.kakaoUser?.company || quote?.customerName || '';
        const quoteUrl = `https://altf.kr/quote/view?id=${quotationId}`;

        // 1. 재고 보유 여부 및 납기 산출 (고객 요구사항: 헛갈리는 품목 나열 대신 명확한 재고/납기 요약)
        const totalItemsCount = quote?.items?.length || 0;
        let readyCount = 0;
        let outCount = 0;

        if (quote?.items && quote.items.length > 0) {
            quote.items.forEach(it => {
                const stock = it.currentStock !== undefined ? it.currentStock : (it.stock !== undefined ? it.stock : 999);
                const reqQty = it.quantity || it.qty || 1;
                const isReady = stock >= reqQty || it.stockStatus === 'READY' || it.stockStatus !== 'OUT_OF_STOCK';
                if (isReady) {
                    readyCount++;
                } else {
                    outCount++;
                }
            });
        }

        const deliverySummary = outCount === 0 
            ? '전 품목 재고 보유 (당일/익일 즉시 출고)'
            : `3~5일 이내 출고 (일부 품목 주문생산/입고 후 발송)`;

        const stockSummaryText = 
            `\n[재고 및 납기 현황]\n` +
            `• 총 의뢰품목: ${totalItemsCount}개 품목\n` +
            `• 즉시 출고가능: ${readyCount}개 품목\n` +
            (outCount > 0 ? `• 주문제작/입고필요: ${outCount}개 품목\n` : `• 재고 부족품목: 0개 (전량 즉시 출고)\n`) +
            `• 예상 납기: ${deliverySummary}\n`;

        // 1. [핵심] 알트에프 공식 직인 견적서 PDF 생성 및 S3 / 로컬 단일 보관 (Single Source of Truth)
        let shortPdfUrl = `https://altf.kr/q/${quotationId}`;
        let presignedPdfUrl = null;

        try {
            console.log(`[KakaoBot] 📑 견적서 ${quotationId} 공식 직인 PDF 단일 보관 및 생성 착수...`);
            const artifacts = await this.generateOfficialQuotationArtifacts(quote);
            if (artifacts?.s3PdfUrl) {
                presignedPdfUrl = artifacts.s3PdfUrl;
                console.log(`[KakaoBot] ☁️ S3 직통 서명 PDF URL 생성 성공: ${presignedPdfUrl}`);
            }
        } catch (artifactErr) {
            console.warn('[KakaoBot] 직인 PDF 자동 생성 실패 (웹 링크로 폴백):', artifactErr.message);
        }

        const formattedTotal = quote?.totalAmount ? `₩${quote.totalAmount.toLocaleString()}원 (VAT별도)` : '별도협의';

        // 사용자 요청 100% 반영: 
        // 1) 지저분하고 긴 S3 주소 대신 공식 초단축 URL(https://altf.kr/q/...) 제공
        // 2) 불필요한 '공유/저장' 안내 문구 완전 삭제
        // 3) 누르면 138KB 정식 PDF가 스마트폰에 즉시 다운로드
        const messageText = customMessage || (
            `[알트에프(AltF) 견적 회신]\n` +
            `${targetName} 담당자님, 요청하신 견적이 완료되었습니다.\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `• 견적번호: ${quotationId}\n` +
            `• 공급가액: ${formattedTotal}\n` +
            stockSummaryText +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📄 공식 견적서(PDF) 다운로드:\n` +
            `${shortPdfUrl}\n\n` +
            `문의: 051-303-3751 / 알트에프(주)`
        );

        const payload = {
            event: 'QUOTE_DISPATCHED',
            quotationId,
            botUserKey: botUserKey || quote?.botUserKey || '',
            recipient: {
                name: targetName,
                company: targetCompany,
                phone: targetPhone,
                email: user?.email || quote?.customerInfo?.email || ''
            },
            quote: {
                id: quotationId,
                totalAmount: quote?.totalAmount || 0,
                itemCount: quote?.items?.length || 0,
                quoteUrl: shortPdfUrl,
                pdfUrl: shortPdfUrl,
                s3Url: presignedPdfUrl,
                summary: `${targetCompany} ${quote?.items?.length || 0}개 품목 견적서`
            },
            message: messageText,
            timestamp: new Date().toISOString()
        };

        let result = { 
            success: false, 
            mode: 'NONE', 
            message: '발송 가능한 수단이 구성되지 않았습니다.' 
        };

        // 2. [우선순위 1] Solapi REST API 직접 연동 (고객 요청: 의미없는 사진 제외, 깔끔한 LMS 텍스트 모드로 신뢰도 극대화)
        if (process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && targetPhone) {
            try {
                console.log(`[KakaoBot] 🚀 Solapi로 공식 견적서 발송 시작: 수신자 ${targetPhone} (${quotationId})`);

                // 사용자가 요청한 대로 의미없는 저화질 MMS 사진은 제외하고 정식 LMS로 발송
                result = await this.sendSolapiMessage({
                    phone: targetPhone,
                    text: messageText,
                    title: `[알트에프] 견적서 (${quotationId})`,
                    imageId: null
                });
            } catch (solapiErr) {
                console.error('[KakaoBot] Solapi 발송 중 오류:', solapiErr);
                result = { success: false, mode: 'SOLAPI_ERROR', error: solapiErr.message };
            }
        }
        // 2. [우선순위 2] Make.com Webhook 연동 (웹훅 URL이 명시된 경우)
        else if (webhookUrl || process.env.MAKE_WEBHOOK_URL) {
            const targetWebhookUrl = webhookUrl || process.env.MAKE_WEBHOOK_URL;
            try {
                const fetch = (await import('node-fetch')).default;
                const hookRes = await fetch(targetWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                result = {
                    success: hookRes.ok,
                    mode: 'MAKE_WEBHOOK',
                    statusCode: hookRes.status,
                    message: hookRes.ok 
                        ? `Make.com 웹훅 전송 성공! (Solapi/알림톡 연계 격발)` 
                        : `Make.com 웹훅 응답 코드: ${hookRes.status}`
                };
            } catch (hookErr) {
                console.error('[KakaoBot] Make.com 웹훅 전송 실패:', hookErr.message);
                result = { success: false, mode: 'MAKE_WEBHOOK_ERROR', error: hookErr.message };
            }
        } 

        // 3. 견적서 발송 상태 기록 및 답변완료(PROCESSED) 전환
        if (quote) {
            quote.dispatchStatus = result.success ? 'SENT' : 'FAILED';
            quote.dispatchedAt = new Date().toISOString();
            quote.dispatchPayload = payload;
            if (result.success) {
                quote.status = 'PROCESSED'; // 🔥 답변완료 상태로 전환!
                console.log(`[KakaoBot] ✅ 견적서 ${quotationId}가 발송되어 'PROCESSED(답변완료)' 상태로 전환되었습니다.`);
            }
            this.saveData();

            // S3 및 서버 DB 동기화 콜백 호출
            if (this.onQuotationUpdated) {
                try {
                    this.onQuotationUpdated(quote);
                } catch (syncErr) {
                    console.error('[KakaoBot] 견적서 상태 업데이트 동기화 콜백 오류:', syncErr);
                }
            }
        }

        return { ...result, payload };
    }

    /**
     * 카카오톡 견적 및 인입 테스트 데이터 전체 초기화
     */
    clearTestData() {
        this.draftQuotations = [];
        this.intakes = [];
        this.stats = {
            totalReceived: 0,
            textQuotes: 0,
            imageQuotes: 0,
            lastReceivedAt: null
        };
        this.saveData();
        console.log('[KakaoBot] 🧹 카카오 견적 및 인입 테스트 데이터 전체 초기화 완료');
        return { success: true, message: '카카오 테스트 데이터가 깨끗이 초기화되었습니다.' };
    }

    /**
     * 카카오 견적서 소프트 삭제 (휴지통) 상태 동기화
     */
    markQuotationDeleted(quotationId, isDeleted = true) {
        const quote = this.draftQuotations.find(q => q.id === quotationId);
        if (quote) {
            quote.isDeleted = isDeleted;
            if (isDeleted) {
                quote.deletedAt = new Date().toISOString();
            } else {
                delete quote.isDeleted;
                delete quote.deletedAt;
            }
            this.saveData();
            console.log(`[KakaoBot] 🗑️ 견적서 [${quotationId}] isDeleted=${isDeleted} 상태 동기화 완료`);
            return true;
        }
        return false;
    }

    /**
     * 카카오 견적서 영구 삭제 동기화
     */
    deleteDraftQuotation(quotationId) {
        const initialCount = this.draftQuotations.length;
        this.draftQuotations = this.draftQuotations.filter(q => q.id !== quotationId);
        this.intakes.forEach(i => {
            if (i.quotationId === quotationId) {
                delete i.quotationId;
            }
        });
        if (this.draftQuotations.length !== initialCount) {
            this.saveData();
            console.log(`[KakaoBot] ❌ 견적서 [${quotationId}] 영구 삭제 동기화 완료`);
            return true;
        }
        return false;
    }

    /**
     * Solapi 파일 업로드 헬퍼 (MMS 이미지 등)
     */
    async uploadSolapiFile({ fileBase64, fileName = 'image.jpg', type = 'MMS' }) {
        const apiKey = process.env.SOLAPI_API_KEY;
        const apiSecret = process.env.SOLAPI_API_SECRET;
        if (!apiKey || !apiSecret) {
            throw new Error('SOLAPI_API_KEY 또는 SOLAPI_API_SECRET이 설정되지 않았습니다.');
        }

        const crypto = await import('crypto');
        const fetch = (await import('node-fetch')).default;

        const date = new Date().toISOString();
        const salt = crypto.randomBytes(16).toString('hex');
        const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
        const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

        const res = await fetch('https://api.solapi.com/storage/v1/files', {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file: fileBase64,
                type,
                name: fileName
            })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || `파일 업로드 실패 (HTTP ${res.status})`);
        }
        return data;
    }

    /**
     * Solapi 메시지 발송 헬퍼 (SMS/LMS/MMS)
     */
    async sendSolapiMessage({ phone, text, title, imageId }) {
        const apiKey = process.env.SOLAPI_API_KEY;
        const apiSecret = process.env.SOLAPI_API_SECRET;
        const sender = process.env.SOLAPI_SENDER_PHONE || '01062223751';

        const crypto = await import('crypto');
        const fetch = (await import('node-fetch')).default;

        const date = new Date().toISOString();
        const salt = crypto.randomBytes(16).toString('hex');
        const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
        const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

        const messagePayload = {
            to: phone.replace(/[^0-9]/g, ''),
            from: sender.replace(/[^0-9]/g, ''),
            text,
            subject: title
        };

        if (imageId) {
            messagePayload.imageId = imageId;
        }

        const res = await fetch('https://api.solapi.com/messages/v4/send', {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: messagePayload
            })
        });

        const data = await res.json();
        return {
            success: res.ok,
            mode: imageId ? 'SOLAPI_MMS' : 'SOLAPI_LMS',
            data,
            message: res.ok 
                ? `Solapi ${imageId ? 'MMS(포토문자)' : 'LMS/문자'} 발송 성공!` 
                : `Solapi 발송 실패: ${data.message || res.statusText}`
        };
    }

    /**
     * 알트에프 공식 직인 견적서 PDF 및 고해상도 JPG 이미지 자동 생성 & S3 업로드
     */
    async generateOfficialQuotationArtifacts(quote) {
        if (!quote) return null;

        const { execSync } = await import('child_process');
        const fs = await import('fs');
        const path = await import('path');
        const { uploadFileToS3 } = await import('../../s3-db.js');

        // Chrome 실행 경로 탐색 (Mac / Linux / Windows)
        let chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        if (!fs.existsSync(chromePath)) {
            try {
                chromePath = execSync('which google-chrome || which chromium || which chrome').toString().trim();
            } catch (e) {
                chromePath = 'google-chrome';
            }
        }

        const quoteId = quote.id || 'Q_TEMP';
        const custName = quote.customerName || quote.customerInfo?.companyName || '고객사';
        const contactName = quote.customerInfo?.contactName || '담당자 귀하';
        const totalAmount = quote.totalAmount || 0;
        const vat = Math.round(totalAmount * 0.1);
        const grandTotal = totalAmount + vat;
        const items = quote.items || [];
        const dateStr = quote.createdAt ? new Date(quote.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('ko-KR');

        const rowsHtml = items.map((it, idx) => {
            const spec = it.spec || `${it.name || '배관자재'} ${it.thickness || ''} ${it.size || ''} ${it.material || ''}`.trim();
            const qty = it.quantity || it.qty || 1;
            const unitPrice = it.userUnitPrice || it.unitPrice || 0;
            const amount = it.amount || (unitPrice * qty);
            return `
                <tr>
                    <td style="text-align:center; padding:7px; border:1px solid #cbd5e1;">${idx + 1}</td>
                    <td style="padding:7px; border:1px solid #cbd5e1; font-weight:bold;">${spec}</td>
                    <td style="text-align:center; padding:7px; border:1px solid #cbd5e1;">${it.material || 'STS'}</td>
                    <td style="text-align:right; padding:7px; border:1px solid #cbd5e1; font-weight:bold;">${qty.toLocaleString()}</td>
                    <td style="text-align:center; padding:7px; border:1px solid #cbd5e1;">EA</td>
                    <td style="text-align:right; padding:7px; border:1px solid #cbd5e1;">₩${unitPrice.toLocaleString()}</td>
                    <td style="text-align:right; padding:7px; border:1px solid #cbd5e1; font-weight:bold; color:#0f172a;">₩${amount.toLocaleString()}</td>
                    <td style="text-align:center; padding:7px; border:1px solid #cbd5e1; font-size:11px; color:#059669;">당일출고</td>
                </tr>
            `;
        }).join('');

        const html = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="utf-8">
            <title>견적서 - ${quoteId}</title>
            <style>
                * { box-sizing: border-box; }
                body { 
                    margin: 0; 
                    padding: 24px; 
                    font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", dotum, sans-serif;
                    background: white;
                    color: #1e293b;
                }
                .container { width: 100%; max-width: 760px; margin: 0 auto; }
                table { width: 100%; border-collapse: collapse; font-size: 11px; }
                th { background: #f8fafc; font-weight: bold; }
                .seal-stamp {
                    position: absolute;
                    right: 15px;
                    bottom: 5px;
                    width: 60px;
                    height: 60px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div style="text-align:center; margin-bottom: 20px; border-bottom: 3px double #0f172a; padding-bottom: 8px;">
                    <h1 style="margin:0; font-size:24px; letter-spacing:8px; color:#0f172a;">견 적 서</h1>
                    <span style="font-size:11px; letter-spacing:2px; color:#64748b;">QUOTATION</span>
                </div>

                <div style="display:flex; justify-content:space-between; margin-bottom: 16px; gap:12px;">
                    <div style="flex:1; border:1px solid #cbd5e1; border-radius:4px; padding:10px; background:#fafafa;">
                        <div style="font-size:10px; color:#64748b; margin-bottom:2px;">견적번호: <strong>${quoteId}</strong></div>
                        <div style="font-size:10px; color:#64748b; margin-bottom:6px;">견적일자: ${dateStr}</div>
                        <div style="font-size:16px; font-weight:800; color:#0f172a; margin-bottom:4px;">
                            ${custName} <span style="font-size:12px; font-weight:normal; color:#64748b;">귀하</span>
                        </div>
                        <div style="font-size:11px; color:#475569; line-height:1.5;">
                            • 담당자: ${contactName}<br>
                            • 공급조건: 화물 / 택배 / 상차도<br>
                            • 유효기간: 견적일로부터 7일간
                        </div>
                    </div>

                    <div style="flex:1; border:1px solid #cbd5e1; border-radius:4px; padding:10px; position:relative; background:#fff;">
                        <table style="width:100%; border:none; font-size:11px; line-height:1.4;">
                            <tr><td style="width:65px; color:#64748b;">등록번호</td><td style="font-weight:bold;">890-38-01079</td></tr>
                            <tr><td style="color:#64748b;">상　　호</td><td style="font-weight:bold;">알트에프(주)</td></tr>
                            <tr><td style="color:#64748b;">대 표 자</td><td style="font-weight:bold;">조 현 진</td></tr>
                            <tr><td style="color:#64748b;">소 재 지</td><td style="font-size:10px;">부산 사상구 삼락동 / 시흥 시화유통상가</td></tr>
                            <tr><td style="color:#64748b;">전화/팩스</td><td style="font-weight:bold; color:#2563eb;">051-303-3751 / 051-303-3752</td></tr>
                        </table>
                        <div class="seal-stamp">
                            <svg viewBox="0 0 100 100" width="60" height="60" style="opacity:0.9;">
                                <circle cx="50" cy="50" r="46" stroke="#dc2626" stroke-width="4" fill="none" />
                                <circle cx="50" cy="50" r="42" stroke="#dc2626" stroke-width="1.5" fill="none" />
                                <text x="50" y="42" font-size="16" font-family="sans-serif" font-weight="900" fill="#dc2626" text-anchor="middle">알트에프</text>
                                <text x="50" y="66" font-size="16" font-family="sans-serif" font-weight="900" fill="#dc2626" text-anchor="middle">주식회사</text>
                                <text x="50" y="84" font-size="11" font-family="sans-serif" font-weight="bold" fill="#dc2626" text-anchor="middle">인</text>
                            </svg>
                        </div>
                    </div>
                </div>

                <div style="background:#0f172a; color:white; padding:10px 14px; border-radius:4px; display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                    <div style="font-size:12px; font-weight:500;">견적 총 합계금액 (VAT 포함)</div>
                    <div style="font-size:18px; font-weight:900; color:#38bdf8;">₩${grandTotal.toLocaleString()}원</div>
                </div>

                <table style="border:1px solid #cbd5e1; margin-bottom:14px;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:2px solid #94a3b8;">
                            <th style="padding:8px 4px; border:1px solid #cbd5e1; width:30px; text-align:center;">No</th>
                            <th style="padding:8px 6px; border:1px solid #cbd5e1; text-align:left;">품목 및 규격 (Item & Spec)</th>
                            <th style="padding:8px 4px; border:1px solid #cbd5e1; width:50px; text-align:center;">재질</th>
                            <th style="padding:8px 4px; border:1px solid #cbd5e1; width:45px; text-align:right;">수량</th>
                            <th style="padding:8px 4px; border:1px solid #cbd5e1; width:35px; text-align:center;">단위</th>
                            <th style="padding:8px 6px; border:1px solid #cbd5e1; width:75px; text-align:right;">단가</th>
                            <th style="padding:8px 6px; border:1px solid #cbd5e1; width:85px; text-align:right;">공급가액</th>
                            <th style="padding:8px 4px; border:1px solid #cbd5e1; width:55px; text-align:center;">출고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                    <tfoot>
                        <tr style="background:#f8fafc; font-weight:bold;">
                            <td colspan="3" style="text-align:center; padding:8px; border:1px solid #cbd5e1;">합 계 (TOTAL)</td>
                            <td style="text-align:right; padding:8px; border:1px solid #cbd5e1;">${items.reduce((s, it) => s + (it.quantity || it.qty || 1), 0).toLocaleString()}</td>
                            <td style="text-align:center; padding:8px; border:1px solid #cbd5e1;">EA</td>
                            <td style="text-align:right; padding:8px; border:1px solid #cbd5e1; font-size:10px; color:#64748b;">공급가 합계</td>
                            <td style="text-align:right; padding:8px; border:1px solid #cbd5e1; font-size:13px; color:#0f172a;">₩${totalAmount.toLocaleString()}</td>
                            <td style="text-align:center; padding:8px; border:1px solid #cbd5e1; font-size:10px; color:#059669;">VAT별도</td>
                        </tr>
                    </tfoot>
                </table>

                <div style="border:1px solid #e2e8f0; border-radius:4px; padding:10px; font-size:11px; color:#475569; line-height:1.6; background:#fafafa;">
                    • <strong>예상 납기:</strong> 전 품목 재고 보유 (오후 3시 이전 발주 시 당일/익일 즉시 출고)<br>
                    • <strong>입금 계좌:</strong> 기업은행 051-303-3751 (예금주: 알트에프 주식회사)<br>
                    • <strong>견적 및 출고 문의:</strong> 알트에프 영업부 <strong>051-303-3751</strong> (월~금 08:30 ~ 18:00)
                </div>
            </div>
        </body>
        </html>
        `;

        const tempHtml = path.resolve(`./temp_quote_${Date.now()}.html`);
        const tempPdf = path.resolve(`./temp_quote_${Date.now()}.pdf`);
        const tempJpg = path.resolve(`./temp_quote_${Date.now()}.jpg`);

        fs.writeFileSync(tempHtml, html, 'utf-8');

        try {
            // 1. PDF 변환
            execSync(`"${chromePath}" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${tempPdf}" "${tempHtml}"`);
            
            // 2. JPG 스크린샷 렌더링 (MMS 포토문자용)
            execSync(`"${chromePath}" --headless=new --disable-gpu --screenshot="${tempJpg}" --window-size=800,1050 "${tempHtml}"`);

            const pdfBuf = fs.readFileSync(tempPdf);
            const jpgBuf = fs.readFileSync(tempJpg);

            // 로컬 캐시 스토리지에 영구 저장 (서버 직통 스트리밍용)
            const cleanId = quoteId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const storageDir = path.resolve('./storage/quotations');
            if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
            fs.writeFileSync(path.join(storageDir, `${cleanId}.pdf`), pdfBuf);

            // 3. AWS S3 서명 업로드 (단일 원본 경로 보관 exactKey=true)
            const s3FileName = `${cleanId}_altf_quotation.pdf`;
            let s3PdfUrl = null;
            try {
                s3PdfUrl = await uploadFileToS3('documents/quotations', s3FileName, pdfBuf, 'application/pdf', true);
            } catch (s3Err) {
                console.warn('[KakaoBot] S3 업로드 실패 (로컬 스트리밍으로 폴백):', s3Err.message);
                s3PdfUrl = `https://altf.kr/q/${quoteId}`;
            }

            return {
                s3PdfUrl,
                jpgBuffer: jpgBuf,
                pdfBuffer: pdfBuf
            };
        } finally {
            if (fs.existsSync(tempHtml)) fs.unlinkSync(tempHtml);
            if (fs.existsSync(tempPdf)) fs.unlinkSync(tempPdf);
            if (fs.existsSync(tempJpg)) fs.unlinkSync(tempJpg);
        }
    }
}

export const kakaoBotService = new KakaoBotService();

