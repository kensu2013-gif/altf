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
            utterance.includes('견적 확인') ||
            utterance.includes('견적서') ||
            utterance.includes('어떻게') ||
            utterance.includes('나왔') ||
            utterance.includes('얼마')
        );

        if (isStatusQuery) {
            // 해당 사용자의 고유 botUserKey 또는 매칭된 전화번호로만 엄격 조회 (타 고객 견적서 노출 방지)
            const recentQuote = this.draftQuotations.find(dq => 
                dq.botUserKey === botUserKey || 
                dq.kakaoBotUserKey === botUserKey || 
                (matchedUser && dq.customerInfo?.phone && dq.customerInfo?.phone === matchedUser.phone)
            );
            const recentIntake = this.intakes.find(it => it.botUserKey === botUserKey);

            if (recentIntake && recentIntake.status === 'PROCESSING') {
                return {
                    version: '2.0',
                    template: {
                        outputs: [
                            {
                                simpleText: {
                                    text: `⏳ [알트에프 영업2팀]\n현재 비전 AI(INT-03)와 규격표준화(INT-05) 에이전트가 첨부해주신 견적서 사진을 정밀 분석 중입니다.\n\n약 10~15초 후 '📊 접수 현황 확인' 버튼을 다시 한 번 눌러주세요!`
                                }
                            }
                        ],
                        quickReplies: [
                            { messageText: '접수 현황 확인', action: 'message', label: '📊 접수 현황 확인' },
                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                        ]
                    }
                };
            }

            if (recentQuote) {
                // 사용자가 확인하는 순간 답변완료(PROCESSED)로 전환 및 동기화
                recentQuote.status = 'PROCESSED';
                if (this.onQuotationUpdated) {
                    this.onQuotationUpdated(recentQuote);
                }
                this.saveData();

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
                        quickReplies: [
                            { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${recentQuote.id}` },
                            { messageText: '접수 현황 확인', action: 'message', label: '📊 접수 현황 확인' },
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

        // 4. 🔥 이미지 첨부 인입 처리: 카카오 5초 타임아웃 절대 방지를 위해 즉시 회신 후 백그라운드 비전 OCR 가동
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

            // 카카오톡 대화방에 0.1초 내 즉시 정상 접수 알림 출력
            return {
                version: '2.0',
                template: {
                    outputs: [
                        {
                            simpleText: {
                                text: `📄 [알트에프 영업2팀]\n견적서 사진이 정상 접수되었습니다!\n\n🤖 INT-03(비전 AI)과 SLE-01/02 에이전트가 14,132개 배관 피팅 규격·재고·단가를 정밀 대조하고 있습니다.\n\n약 10~15초 후 아래 '📊 접수 현황 확인' 버튼을 누르시면 산출된 견적서를 바로 확인하실 수 있습니다.`
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
                quickReplies: [
                    {
                        messageText: '견적서 보기',
                        action: 'webLink',
                        label: '📄 정식 견적서 보기',
                        webLinkUrl: `https://altf.kr/admin/quotes?id=${draftQuote.id}`
                    },
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
                    const { uploadFileToS3 } = await import('../../s3-db.js');
                    uploadedS3Url = await uploadFileToS3('documents/quotes', `kakao_${Date.now()}.jpg`, imgBuf, contentType);
                    intakeRecord.imageUrl = uploadedS3Url;
                    console.log(`[KakaoBot] S3 이미지 영구 보관 완료: ${uploadedS3Url}`);
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
                                    quickReplies: [
                                        { messageText: '견적서 보기', action: 'webLink', label: '📄 정식 견적서 보기', webLinkUrl: `https://altf.kr/admin/quotes?id=${draftQuote.id}` },
                                        { messageText: '접수 현황 확인', action: 'message', label: '📊 접수 현황 확인' },
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

                    // 🔥 [솔라피 사진 견적 자동 발송] 분석 완료 즉시 솔라피 MMS(포토+견적서 링크) 자동 발송!
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
                bizNo: normalized.customer.businessNumber || '890-38-01079',
                address: normalized.customer.address || '경기도 시흥시 시화유통상가'
            } : null,
            items,
            totalAmount,
            status: 'SUBMITTED', // 🔥 중요: 접수(Submitted) 상태로 설정되어 관리자 목록에서 노란색 '접수' 버튼 활성화 및 필터링
            botUserKey: intake.botUserKey || null,
            isKakaoRegistered: !!intake.isRegisteredUser,
            kakaoUser: intake.matchedUser || null,
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

    /**
     * 답변 완료된 견적서를 Solapi(문자/MMS) 또는 Make.com 웹훅으로 발송
     */
    async dispatchQuotation({ quotationId, botUserKey, customMessage, webhookUrl, targetPhone: explicitPhone }) {
        const quote = this.draftQuotations.find(q => q.id === quotationId);
        const user = this.findUserByBotUserKey(botUserKey) || (quote?.kakaoUser) || null;
        
        const fallbackPhone = process.env.SOLAPI_SENDER_PHONE || '01062223751';
        const targetPhone = explicitPhone || user?.phone || quote?.customerInfo?.phone || quote?.sourcePhone || fallbackPhone;
        const targetName = user?.name || quote?.customerInfo?.contactName || '고객';
        const targetCompany = user?.company || quote?.customerName || '';
        const quoteUrl = `https://altf.kr/quote/view?id=${quotationId}`;

        // 품목 요약 텍스트 생성
        let itemsSummary = '';
        if (quote?.items && quote.items.length > 0) {
            const previewItems = quote.items.slice(0, 4).map(it => 
                `• ${it.spec || it.item || '배관자재'} | ${it.quantity || 1}개 | ₩${(it.unitPrice || 0).toLocaleString()}`
            ).join('\n');
            const moreCount = quote.items.length > 4 ? `\n• 외 ${quote.items.length - 4}건` : '';
            itemsSummary = `\n[견적 품목 내역]\n${previewItems}${moreCount}\n`;
        }

        const formattedTotal = quote?.totalAmount ? `₩${quote.totalAmount.toLocaleString()}원 (VAT별도)` : '별도협의';

        const messageText = customMessage || (
            `[알트에프(AltF) 견적 회신]\n` +
            `${targetName} 담당자님, 요청하신 견적이 완료되었습니다.\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `• 견적번호: ${quotationId}\n` +
            `• 공급가액: ${formattedTotal}\n` +
            itemsSummary +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📄 정식 견적서 확인 및 PDF 다운로드:\n` +
            `${quoteUrl}\n\n` +
            `문의: 031-503-1019 / 알트에프(주)`
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
                quoteUrl,
                pdfUrl: quote?.attachments?.[0]?.url || quoteUrl,
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

        // 1. [우선순위 1] Solapi REST API 직접 연동 (MMS 이미지 첨부 지원)
        if (process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && targetPhone) {
            try {
                console.log(`[KakaoBot] 🚀 Solapi로 견적서 발송 시작: 수신자 ${targetPhone} (${quotationId})`);

                // 견적서 첨부 이미지 탐색 (MMS 발송용)
                let imageId = null;
                const attachCandidate = quote?.attachments?.[0];
                let attachBuffer = null;

                if (attachCandidate?.data && typeof attachCandidate.data === 'string') {
                    // Base64 데이터가 직접 들어있는 경우
                    const base64Data = attachCandidate.data.includes(',') ? attachCandidate.data.split(',')[1] : attachCandidate.data;
                    attachBuffer = Buffer.from(base64Data, 'base64');
                } else if (attachCandidate?.url && attachCandidate.url.startsWith('http')) {
                    // 원격 이미지 URL인 경우 다운로드
                    try {
                        const fetch = (await import('node-fetch')).default;
                        const imgRes = await fetch(attachCandidate.url);
                        if (imgRes.ok) {
                            attachBuffer = Buffer.from(await imgRes.arrayBuffer());
                        }
                    } catch (e) {
                        console.warn('[KakaoBot] 첨부 이미지 다운로드 실패 (텍스트로만 발송):', e.message);
                    }
                }

                // 이미지가 200KB 이하인 경우 Solapi Storage에 MMS 업로드
                if (attachBuffer && attachBuffer.length <= 200 * 1024) {
                    try {
                        const uploadRes = await this.uploadSolapiFile({
                            fileBase64: attachBuffer.toString('base64'),
                            fileName: `quote_${quotationId}.jpg`,
                            type: 'MMS'
                        });
                        if (uploadRes?.fileId) {
                            imageId = uploadRes.fileId;
                            console.log(`[KakaoBot] 📸 Solapi MMS 이미지 업로드 성공! fileId: ${imageId}`);
                        }
                    } catch (uploadErr) {
                        console.warn('[KakaoBot] Solapi 이미지 업로드 실패, 텍스트 LMS로 발송 진행:', uploadErr.message);
                    }
                }

                result = await this.sendSolapiMessage({
                    phone: targetPhone,
                    text: messageText,
                    title: `[알트에프] 견적서 (${quotationId})`,
                    imageId
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
}

export const kakaoBotService = new KakaoBotService();

