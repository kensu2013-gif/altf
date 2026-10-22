/**
 * 🚪 ALTF Single Dispatch Gate & Approval Queue (0-D 발송 게이트 & 승인 대기열)
 * 
 * [단일 창구 발송 원칙]:
 * 1. 고객/매입처로 나가는 모든 발송(견적서, 발주서, 성적서/명세표 패키지, 알림)은 반드시 dispatchGate를 통과합니다.
 * 2. 필수 승인 대상(approverRole: 'SALES' | 'OFFICE')은 사람이 웹에서 '승인' 버튼을 누르기 전까지 절대로 발송되지 않습니다.
 * 3. 동일 shipment/order의 서류 패키지(DOC_PACKAGE)가 이미 SENT 상태라면 중복 발송을 원천 차단합니다.
 * 4. 발송 결과(성공/실패/반려)는 dispatch_queue에 영구 저장되며, 단일 원장(ledgerClient) 주문 감사 이력(events[])에 자동 기록됩니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import tls from 'tls';
import { ledgerClient } from './ledgerClient.js';
import { telegramBotService } from './telegramBotService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const QUEUE_FILE = path.join(ROOT_DIR, 'server/data/dispatch_queue.json');

export class DispatchGate {
    constructor() {
        this.queue = [];
        this.loadQueue();
    }

    /**
     * 대기열 로드 (없으면 자동 생성)
     */
    loadQueue() {
        try {
            if (fs.existsSync(QUEUE_FILE)) {
                const data = fs.readFileSync(QUEUE_FILE, 'utf8');
                this.queue = JSON.parse(data || '[]');
            } else {
                this.queue = [];
                this.saveQueue();
            }
        } catch (e) {
            console.error('[DispatchGate] 대기열 로드 실패, 빈 배열로 초기화:', e.message);
            this.queue = [];
        }
    }

    /**
     * 대기열 저장
     */
    saveQueue() {
        try {
            const dir = path.dirname(QUEUE_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2), 'utf8');
        } catch (e) {
            console.error('[DispatchGate] 대기열 파일 저장 실패:', e.message);
        }
    }

    /**
     * 대기열 목록 조회 및 필터링
     */
    getQueue(filter = {}) {
        let items = [...this.queue];
        if (filter.status) {
            items = items.filter(i => i.status === filter.status);
        }
        if (filter.approverRole) {
            items = items.filter(i => i.approverRole === filter.approverRole);
        }
        if (filter.kind) {
            items = items.filter(i => i.kind === filter.kind);
        }
        if (filter.orderId) {
            items = items.filter(i => i.orderId === filter.orderId);
        }
        if (filter.shipmentId) {
            items = items.filter(i => i.shipmentId === filter.shipmentId);
        }
        // 최신순 정렬
        items.sort((a, b) => new Date(b.enqueuedAt).getTime() - new Date(a.enqueuedAt).getTime());
        if (filter.limit) {
            items = items.slice(0, Number(filter.limit));
        }
        return items;
    }

    /**
     * 단일 대기열 항목 조회
     */
    getItemById(id) {
        return this.queue.find(i => i.id === id) || null;
    }

    /**
     * 발송 요청 대기열 등록 (Enqueue)
     * 
     * @param {Object} param
     * @param {'EMAIL'|'FAX'|'KAKAO_LINK'|'TELEGRAM_INTERNAL'} param.channel
     * @param {string} param.to - 수신자 (이메일/전화번호/사내채팅)
     * @param {string} [param.replyTo] - 회신 주소(영업자 메일)
     * @param {string} param.subject - 제목
     * @param {string} param.body - 본문
     * @param {Array<{ fileName: string, path?: string, storageKey?: string, mime?: string, size?: number }>} [param.attachments]
     * @param {string} [param.orderId] - 연결된 주문 ID
     * @param {string} [param.shipmentId] - 연결된 출고 묶음 ID
     * @param {'QUOTE'|'SUPPLIER_PO'|'DOC_PACKAGE'|'CERT_REQUEST'|'NOTICE'} param.kind - 발송 유형
     * @param {'SALES'|'OFFICE'|null} [param.approverRole] - 결재권자 역할 (null이면 즉시 발송)
     * @param {string} [param.enqueuedBy] - 등록자 ('bot:SLE-02', 'user:홍길동')
     * @param {Object} [param.meta] - 기타 부가 정보
     */
    async enqueue({
        channel,
        to,
        replyTo,
        subject,
        body,
        attachments = [],
        orderId,
        shipmentId,
        kind = 'NOTICE',
        approverRole = null,
        enqueuedBy = 'SYSTEM',
        meta = {}
    }) {
        if (!channel || !to || !subject) {
            throw new Error('[DispatchGate] 필수 매개변수(channel, to, subject)가 누락되었습니다.');
        }

        // 🛡️ 중복 발송 방지 규칙: 같은 shipment의 DOC_PACKAGE가 이미 SENT인 경우 원천 차단
        if (kind === 'DOC_PACKAGE' && shipmentId) {
            const alreadySent = this.queue.find(i =>
                i.shipmentId === shipmentId &&
                i.kind === 'DOC_PACKAGE' &&
                i.status === 'SENT'
            );
            if (alreadySent) {
                const err = `[중복 발송 차단] 출고 묶음(${shipmentId}) 서류 패키지가 이미 발송 완료되었습니다. (발송 ID: ${alreadySent.id}, 일시: ${alreadySent.sentAt})`;
                console.warn(`[DispatchGate] ${err}`);
                throw new Error(err);
            }
        }

        const id = `DSP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const requiresApproval = Boolean(approverRole);
        const status = requiresApproval ? 'PENDING_APPROVAL' : 'SENDING';

        const item = {
            id,
            channel,
            to,
            replyTo: replyTo || process.env.SALES_DEFAULT_EMAIL || 'sales@altf.kr',
            subject,
            body,
            attachments,
            orderId: orderId || null,
            shipmentId: shipmentId || null,
            kind,
            approverRole,
            requiresApproval,
            status,
            enqueuedAt: new Date().toISOString(),
            enqueuedBy,
            retryCount: 0,
            meta
        };

        this.queue.unshift(item);
        this.saveQueue();

        console.log(`📥 [DispatchGate] 발송 대기열 등록 완료: [${id}] [${channel}] ${subject} (승인필요: ${requiresApproval ? approverRole : '즉시발송'})`);

        // 승인 불필요 항목은 즉시 발송 진행
        if (!requiresApproval) {
            await this._executeDispatch(item);
        } else {
            // 결재권자 알림 (사내 텔레그램 연동)
            const roleName = approverRole === 'SALES' ? '영업 담당자' : '사무실 관리자';
            const alertText = `🔔 <b>[ALTF 승인 대기열 알림]</b>\n` +
                `• 대상: <b>${roleName}</b>\n` +
                `• 유형: ${kind} (${channel})\n` +
                `• 제목: ${subject}\n` +
                `• 수신: ${to}\n` +
                `• 등록: ${enqueuedBy}\n` +
                `👉 관리자 포털 승인 대기함에서 확인 후 [승인]해 주십시오.`;
            telegramBotService.sendMessage(null, alertText).catch(() => {});
        }

        return item;
    }

    /**
     * 승인 처리 및 실제 발송 트리거
     * 
     * @param {string} id - 대기열 ID
     * @param {{ name: string, role?: string }} user - 승인자 정보
     */
    async approve(id, user = { name: '관리자', role: 'ADMIN' }) {
        const item = this.queue.find(i => i.id === id);
        if (!item) {
            throw new Error(`대기열 항목을 찾을 수 없습니다: ${id}`);
        }

        if (item.status === 'SENT') {
            throw new Error(`이미 발송이 완료된 항목입니다. (발송일시: ${item.sentAt})`);
        }

        if (item.status === 'REJECTED') {
            throw new Error(`이미 반려된 항목입니다. 재승인이 필요한 경우 신규 등록해 주십시오.`);
        }

        // 승인자 정보 기록
        item.status = 'APPROVED';
        item.approvedBy = {
            name: user.name || '관리자',
            role: user.role || 'ADMIN',
            at: new Date().toISOString()
        };
        this.saveQueue();

        console.log(`✅ [DispatchGate] 항목 승인 완료 [${id}] by ${user.name}. 실제 발송 시작...`);

        // 실제 발송 수행
        return await this._executeDispatch(item);
    }

    /**
     * 반려(거절) 처리
     * 
     * @param {string} id - 대기열 ID
     * @param {{ name: string, role?: string }} user - 반려자
     * @param {string} reason - 반려 사유
     */
    async reject(id, user = { name: '관리자' }, reason = '담당자 검토 결과 반려') {
        const item = this.queue.find(i => i.id === id);
        if (!item) {
            throw new Error(`대기열 항목을 찾을 수 없습니다: ${id}`);
        }

        if (item.status === 'SENT') {
            throw new Error(`이미 발송 완료된 건은 반려할 수 없습니다.`);
        }

        item.status = 'REJECTED';
        item.rejectedBy = {
            name: user.name || '관리자',
            at: new Date().toISOString(),
            reason: reason || '반려됨'
        };
        this.saveQueue();

        console.log(`🚫 [DispatchGate] 항목 반려 처리 [${id}] by ${user.name}: ${reason}`);

        // 주문 감사 이력 기록
        if (item.orderId) {
            try {
                await ledgerClient.appendOrderEvent(item.orderId, {
                    actor: `user:${user.name}`,
                    eventType: 'DISPATCH_REJECTED',
                    type: 'DISPATCH_REJECTED',
                    note: `[발송 반려] ${item.kind} (${item.channel}) 반려: ${reason}`,
                    detail: { dispatchId: item.id, reason }
                });
            } catch (e) {
                console.warn(`[DispatchGate] 주문 감사 이력 기록 실패: ${e.message}`);
            }
        }

        return item;
    }

    /**
     * 재시도 (실패 항목 재전송)
     */
    async retry(id, user = { name: '관리자' }) {
        const item = this.queue.find(i => i.id === id);
        if (!item) {
            throw new Error(`대기열 항목을 찾을 수 없습니다: ${id}`);
        }

        if (item.status === 'SENT') {
            throw new Error(`이미 성공적으로 발송된 항목입니다.`);
        }

        item.retryCount = (item.retryCount || 0) + 1;
        console.log(`🔄 [DispatchGate] 재전송 시도 (${item.retryCount}회차): [${id}]`);
        return await this._executeDispatch(item);
    }

    /**
     * 어댑터별 실제 발송 실행 내부 함수
     */
    async _executeDispatch(item) {
        item.status = 'SENDING';
        this.saveQueue();

        try {
            let result = null;

            switch (item.channel) {
                case 'EMAIL':
                    result = await this._sendEmailAdapter(item);
                    break;

                case 'TELEGRAM_INTERNAL':
                    result = await this._sendTelegramAdapter(item);
                    break;

                case 'FAX':
                    result = await this._sendFaxAdapter(item);
                    break;

                case 'KAKAO_LINK':
                    result = await this._sendKakaoAdapter(item);
                    break;

                default:
                    throw new Error(`지원하지 않는 발송 채널입니다: ${item.channel}`);
            }

            item.status = 'SENT';
            item.sentAt = new Date().toISOString();
            item.dispatchResult = result;
            item.lastError = null;
            this.saveQueue();

            console.log(`✨ [DispatchGate] 최종 발송 완료! [${item.id}] [${item.channel}] -> ${item.to}`);

            // 주문 감사 이력(events) 기록
            if (item.orderId) {
                try {
                    await ledgerClient.appendOrderEvent(item.orderId, {
                        actor: item.approvedBy ? `user:${item.approvedBy.name}` : (item.enqueuedBy || 'bot:DIS-01'),
                        eventType: 'DISPATCH_SENT',
                        type: 'DISPATCH_SENT',
                        note: `[발송 완료] ${item.kind} (${item.channel}) -> ${item.to}`,
                        detail: {
                            dispatchId: item.id,
                            channel: item.channel,
                            kind: item.kind,
                            to: item.to,
                            subject: item.subject,
                            attachmentsCount: (item.attachments || []).length
                        }
                    });
                } catch (e) {
                    console.warn(`[DispatchGate] 주문 감사 이력 기록 실패: ${e.message}`);
                }
            }

            return item;
        } catch (err) {
            item.status = 'FAILED';
            item.lastError = err.message || String(err);
            item.retryCount = (item.retryCount || 0) + 1;
            this.saveQueue();

            console.error(`💥 [DispatchGate] 발송 실패 [${item.id}]:`, err.message);

            if (item.orderId) {
                try {
                    await ledgerClient.appendOrderEvent(item.orderId, {
                        actor: 'SYSTEM:DISPATCH_GATE',
                        eventType: 'DISPATCH_FAILED',
                        type: 'DISPATCH_FAILED',
                        note: `[발송 실패] ${item.kind} (${item.channel}) 전송 오류: ${item.lastError}`,
                        detail: { dispatchId: item.id, error: item.lastError }
                    });
                } catch (e) {
                    console.warn(`[DispatchGate] 주문 감사 이력 기록 실패: ${e.message}`);
                }
            }

            throw err;
        }
    }

    /**
     * 메일 발송 어댑터 (메일플러그 SMTP 연동 및 안전 테스트 격리 가드)
     */
    async _sendEmailAdapter(item) {
        const testRecipient = process.env.TEST_RECIPIENT || process.env.TEST_EMAIL;
        const targetTo = testRecipient || item.to;
        const isSafeTestMode = Boolean(testRecipient || !process.env.MAIL_SMTP_HOST);

        console.log(`📧 [DispatchGate:Email] 발송 준비: To=${targetTo} (원본=${item.to}, 안전테스트=${isSafeTestMode ? 'ON' : 'OFF'})`);

        // SMTP 설정이 환경 변수에 존재할 경우 실제 전송 시도
        if (process.env.MAIL_SMTP_HOST && !isSafeTestMode) {
            // 프로덕션 SMTP 전송 로직
            return await this._sendRawSmtp({
                host: process.env.MAIL_SMTP_HOST,
                port: Number(process.env.MAIL_SMTP_PORT) || 465,
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASS,
                from: process.env.MAIL_USER || 'altf@altf.kr',
                to: targetTo,
                replyTo: item.replyTo,
                subject: item.subject,
                body: item.body,
                attachments: item.attachments
            });
        }

        // 로컬 테스트 격리 모드: mock 전송 이력 파일에 영구 기록
        const mockLogDir = path.join(ROOT_DIR, 'server/data/sent_mock_emails');
        if (!fs.existsSync(mockLogDir)) fs.mkdirSync(mockLogDir, { recursive: true });

        const mockFile = path.join(mockLogDir, `${item.id}.json`);
        const payload = {
            id: item.id,
            timestamp: new Date().toISOString(),
            from: 'altf@altf.kr',
            to: targetTo,
            originalTo: item.to,
            replyTo: item.replyTo,
            subject: item.subject,
            body: item.body,
            attachments: item.attachments,
            safeModeNote: '로컬 안전 테스트 모드 (Local Test Mode) 격리 가드 적용 완료'
        };
        fs.writeFileSync(mockFile, JSON.stringify(payload, null, 2), 'utf8');

        return {
            delivered: true,
            mode: 'LOCAL_SAFE_TEST',
            mockPath: mockFile,
            targetTo,
            attachmentsCount: (item.attachments || []).length
        };
    }

    /**
     * 텔레그램 사내 알림 어댑터
     */
    async _sendTelegramAdapter(item) {
        const text = `📢 <b>[ALTF 사내 발송 통지]</b>\n` +
            `• 유형: <b>${item.kind}</b>\n` +
            `• 제목: ${item.subject}\n\n` +
            `${item.body}`;
        const res = await telegramBotService.sendMessage(item.to !== 'INTERNAL' ? item.to : null, text);
        return { delivered: Boolean(res), telegramResponse: res };
    }

    /**
     * 팩스 어댑터 (인터페이스 정의 및 대기)
     */
    async _sendFaxAdapter(item) {
        console.warn(`📠 [DispatchGate:Fax] 팩스 송신 모듈 준비 중 (NOT_CONFIGURED): ${item.to}`);
        return {
            delivered: false,
            mode: 'NOT_CONFIGURED',
            message: '팩스 어댑터가 아직 구성되지 않았습니다. (추후 연동 예정)'
        };
    }

    /**
     * 카카오 링크 어댑터 (인터페이스 정의 및 대기)
     */
    async _sendKakaoAdapter(item) {
        console.warn(`💬 [DispatchGate:Kakao] 카카오 비즈메시지 모듈 준비 중 (NOT_CONFIGURED): ${item.to}`);
        return {
            delivered: false,
            mode: 'NOT_CONFIGURED',
            message: '카카오 비즈메시지/오픈빌더 연동은 1·2단계에서 활성화됩니다.'
        };
    }

    /**
     * 네이티브 TLS SMTP 전송 헬퍼
     */
    async _sendRawSmtp(opts) {
        return new Promise((resolve, reject) => {
            const socket = tls.connect({
                host: opts.host,
                port: opts.port,
                rejectUnauthorized: false
            }, () => {
                let step = 0;
                let buffer = '';

                socket.on('data', (data) => {
                    buffer += data.toString();
                    if (buffer.includes('\n')) {
                        const line = buffer.trim();
                        buffer = '';

                        if (step === 0 && line.startsWith('220')) {
                            step++;
                            socket.write(`EHLO altf.kr\r\n`);
                        } else if (step === 1 && line.startsWith('250')) {
                            step++;
                            socket.write(`AUTH LOGIN\r\n`);
                        } else if (step === 2 && line.startsWith('334')) {
                            step++;
                            socket.write(`${Buffer.from(opts.user).toString('base64')}\r\n`);
                        } else if (step === 3 && line.startsWith('334')) {
                            step++;
                            socket.write(`${Buffer.from(opts.pass).toString('base64')}\r\n`);
                        } else if (step === 4 && line.startsWith('235')) {
                            step++;
                            socket.write(`MAIL FROM:<${opts.from}>\r\n`);
                        } else if (step === 5 && line.startsWith('250')) {
                            step++;
                            socket.write(`RCPT TO:<${opts.to}>\r\n`);
                        } else if (step === 6 && line.startsWith('250')) {
                            step++;
                            socket.write(`DATA\r\n`);
                        } else if (step === 7 && line.startsWith('354')) {
                            step++;
                            const rawEmail = [
                                `From: <${opts.from}>`,
                                `To: <${opts.to}>`,
                                `Reply-To: <${opts.replyTo}>`,
                                `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString('base64')}?=`,
                                `MIME-Version: 1.0`,
                                `Content-Type: text/plain; charset=UTF-8`,
                                `Content-Transfer-Encoding: 8bit`,
                                ``,
                                opts.body,
                                `\r\n.\r\n`
                            ].join('\r\n');
                            socket.write(rawEmail);
                        } else if (step === 8 && line.startsWith('250')) {
                            step++;
                            socket.write(`QUIT\r\n`);
                            socket.end();
                            resolve({ delivered: true, message: 'SMTP 250 OK' });
                        }
                    }
                });
            });

            socket.on('error', reject);
            socket.setTimeout(15000, () => {
                socket.destroy();
                reject(new Error('SMTP Socket Timeout'));
            });
        });
    }
}

export const dispatchGate = new DispatchGate();
