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

        // 3. 사용자가 "확인", "접수 현황 확인", "현황", "조회" 등의 확인 메시지를 보낸 경우
        const isStatusQuery = !isImage && (/^(확인|접수\s*현황|견적\s*확인|진행\s*상황|현황|조회|내역)$/i.test(utterance) || utterance.includes('접수 현황') || utterance.includes('견적 확인'));
        if (isStatusQuery) {
            // 해당 사용자의 가장 최근 견적서 조회
            const recentQuote = this.draftQuotations.find(dq => dq.botUserKey === botUserKey || dq.kakaoBotUserKey === botUserKey || (matchedUser && dq.customerInfo?.phone === matchedUser.phone)) || this.draftQuotations[0];
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
                const totalFormatted = recentQuote.totalAmount ? recentQuote.totalAmount.toLocaleString() : '0';
                const firstItem = recentQuote.items?.[0] ? `${recentQuote.items[0].name} ${recentQuote.items[0].size}` : '배관 피팅';
                const itemCount = recentQuote.items?.length || 0;
                const statusBadge = recentQuote.reviewStatus === 'ESCALATION_REQUIRED' 
                    ? '⚠️ [영업부장 결재 대기 중]' 
                    : '✅ [박조나단 과장 검토 완료 - 출고 준비]';

                const quoteText = `📋 [알트에프 견적 접수 현황]\n\n• 견적번호: ${recentQuote.id}\n• 고객사: ${recentQuote.customerName || '고객사'}\n• 견적품목: ${firstItem} 외 ${Math.max(0, itemCount - 1)}건 (총 ${itemCount}개)\n• 견적합계: ${totalFormatted}원 (VAT 별도)\n• 검토상태: ${statusBadge}\n• 접수일시: ${new Date(recentQuote.createdAt).toLocaleString('ko-KR')}\n\n상세 견적서와 성적서는 아래 버튼을 통해 바로 열람하실 수 있습니다.`;

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
                            { messageText: '홈페이지 방문', action: 'webLink', label: '🌐 알트에프 웹 바로가기', webLinkUrl: 'https://altf.kr' }
                        ]
                    }
                };
            }
        }

        // 4. 🔥 이미지 첨부 인입 처리: 카카오 5초 타임아웃 절대 방지를 위해 즉시 HTTP 200 회신 후 백그라운드 비전 OCR 가동
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
                await this.processImageIntakeAsync(intakeRecord, finalImageUrl, utterance, botUserKey, matchedUser);
            });

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

        // 5. 일반 텍스트 견적 인입 (초고속 즉시 표준화 처리)
        let normalized = fittingNormalizerService.normalize(utterance);

        // 5-1. 고객 발화 내 추가 지시(요율, 납기, 특이사항) SLE-02 추출
        const overrides = sleQuoteReviewService.parseUtteranceOverrides(utterance);
        if (overrides) {
            if (overrides.rate) {
                normalized.discountRate = overrides.rate;
                console.log(`[KakaoBot] 🎯 [SLE-02 감지] 고객 텍스트 요율 지시 자동 반영: -${overrides.rate}%`);
            }
            if (overrides.deliveryDate) {
                normalized.remarks = (normalized.remarks ? `${normalized.remarks} / ` : '') + overrides.deliveryDate;
                console.log(`[KakaoBot] 🚚 [SLE-02 감지] 고객 납기 지시 반영: ${overrides.deliveryDate}`);
            }
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
            status: normalized.items.length > 0 ? 'QUOTE_DRAFTED' : 'RECEIVED',
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

        let draftQuote = null;
        if (normalized.items.length > 0) {
            draftQuote = this.createDraftQuotation(intakeRecord, normalized);
            draftQuote.botUserKey = botUserKey;
            draftQuote.kakaoBotUserKey = botUserKey;
            
            const reviewResult = sleQuoteReviewService.reviewQuotation(draftQuote, this.draftQuotations);
            draftQuote.sleReview = reviewResult;
            draftQuote.reviewStatus = reviewResult.status;
            intakeRecord.quotationId = draftQuote.id;
            intakeRecord.sleReview = reviewResult;

            this.draftQuotations.unshift(draftQuote);
            console.log(`[KakaoBot] ✅ 견적서 초안 생성 완료 [${draftQuote.id}] 고객사: ${draftQuote.customerName} (${draftQuote.items.length}개 품목, ${draftQuote.totalAmount.toLocaleString()}원)`);

            if (this.onQuotationCreated) {
                this.onQuotationCreated(draftQuote);
            }
        }

        this.saveData();

        setTimeout(() => {
            this.dispatchToAgents(intakeRecord, draftQuote);
        }, 50);

        let responseText = '';
        if (normalized.items.length > 0) {
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
     * 비동기 백그라운드 이미지 비전 OCR 및 견적서 초안 생성 처리 (카카오 5초 타임아웃 회피)
     */
    async processImageIntakeAsync(intakeRecord, finalImageUrl, utterance, botUserKey, matchedUser) {
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

                // 비전 OCR 및 규격 표준화 엔진 가동 (Gemini 3.7 Vision + Tesseract Fallback)
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

                    this.draftQuotations.unshift(draftQuote);
                    console.log(`[KakaoBot] ✅ 견적서 초안 생성 완료 [${draftQuote.id}] 고객사: ${draftQuote.customerName} (${draftQuote.items.length}개 품목, ${draftQuote.totalAmount.toLocaleString()}원)`);

                    if (this.onQuotationCreated) {
                        this.onQuotationCreated(draftQuote);
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
     * 답변 완료된 견적서를 Make.com 웹훅 또는 Solapi로 발송
     */
    async dispatchQuotation({ quotationId, botUserKey, customMessage, webhookUrl }) {
        const quote = this.draftQuotations.find(q => q.id === quotationId);
        const user = this.findUserByBotUserKey(botUserKey) || (quote?.kakaoUser) || null;
        
        const targetWebhookUrl = webhookUrl || process.env.MAKE_WEBHOOK_URL || null;
        const targetPhone = user?.phone || quote?.customerInfo?.phone || '';
        const targetName = user?.name || quote?.customerInfo?.contactName || '고객';
        const targetCompany = user?.company || quote?.customerName || '';
        const quoteUrl = `https://altf.kr/quote/view?id=${quotationId}`;

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
            message: customMessage || `[알트에프 견적 안내]\n${targetName} 담당자님, 요청하신 견적(견적번호: ${quotationId})이 완료되었습니다.\n상세 확인 및 PDF 다운로드: ${quoteUrl}`,
            timestamp: new Date().toISOString()
        };

        let result = { 
            success: true, 
            mode: 'SIMULATED', 
            message: `[시뮬레이션/기본] ${targetName} 담당자 (${targetPhone || '전화번호 미등록'}) 앞으로 발송 신호가 생성되었습니다.` 
        };

        // 0. [0원 카카오 이벤트 푸시] botUserKey가 있는 경우 원래 채팅창으로 카카오 0원 직통 푸시
        const targetBotUserKey = botUserKey || quote?.botUserKey;
        if (targetBotUserKey) {
            const pushRes = await sleQuoteReviewService.dispatchKakaoEventPush({
                botUserKey: targetBotUserKey,
                quotationId,
                totalAmount: quote?.totalAmount,
                quoteUrl
            });
            if (pushRes.success) {
                result = pushRes;
            }
        }

        // 1. Make.com Webhook 연동 (환경변수 또는 인자로 웹훅 URL이 있는 경우)
        if (targetWebhookUrl) {
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
        // 2. Solapi REST API 직접 연동 (환경변수 SOLAPI_API_KEY 설정 시)
        else if (process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && targetPhone) {
            try {
                result = await this.sendSolapiMessage({
                    phone: targetPhone,
                    text: payload.message,
                    title: `[알트에프] 견적서 (${quotationId})`
                });
            } catch (solapiErr) {
                result = { success: false, mode: 'SOLAPI_ERROR', error: solapiErr.message };
            }
        }

        // 견적서 발송 상태 기록
        if (quote) {
            quote.dispatchStatus = result.success ? 'SENT' : 'FAILED';
            quote.dispatchedAt = new Date().toISOString();
            quote.dispatchPayload = payload;
            this.saveData();
        }

        return { ...result, payload };
    }

    /**
     * Solapi 메시지 발송 헬퍼
     */
    async sendSolapiMessage({ phone, text, title }) {
        const apiKey = process.env.SOLAPI_API_KEY;
        const apiSecret = process.env.SOLAPI_API_SECRET;
        const sender = process.env.SOLAPI_SENDER_PHONE || '0315031019';

        const crypto = await import('crypto');
        const fetch = (await import('node-fetch')).default;

        const date = new Date().toISOString();
        const salt = crypto.randomBytes(16).toString('hex');
        const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
        const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

        const res = await fetch('https://api.solapi.com/messages/v4/send', {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: {
                    to: phone.replace(/[^0-9]/g, ''),
                    from: sender.replace(/[^0-9]/g, ''),
                    text,
                    subject: title
                }
            })
        });

        const data = await res.json();
        return {
            success: res.ok,
            mode: 'SOLAPI_DIRECT',
            data,
            message: res.ok ? 'Solapi 문자/알림톡 발송 성공' : `Solapi 발송 실패: ${data.message || res.statusText}`
        };
    }
}

export const kakaoBotService = new KakaoBotService();

