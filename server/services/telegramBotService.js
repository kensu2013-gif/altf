/**
 * 🤖 Telegram Bot Service for Daekyung Bend Invoice Dispatch
 * 
 * [주요 기능]
 * 1. 텔레그램 메신저 채팅방에서 사용자가 전달(Forward/Upload)한 거래명세서 PDF 파일 자동 감지
 * 2. Telegram Bot API를 통해 PDF 버퍼 실시간 다운로드
 * 3. DaekyungInvoiceService 호출:
 *    - PDF 파싱 (헤더, 공급자, 공급받는자, 품목, 단가, 수량, 금액, P.O 번호)
 *    - 📑 총무부: 매입 확정 장부 기록 (공급가, 세액)
 *    - 🛒 구매부: 재고 발주 대장 엑셀 미결 해제 & '입고완료(대경발송)' 상태 갱신
 *    - 🔬 품질부: 성적서(MTC) 사전 매칭 확인
 *    - 🚚 출고부: 창고 입고 or 고객 직배송 감시
 * 4. 처리 완료 후 텔레그램 채팅방으로 상세 분석 보고서 즉시 회신
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { daekyungInvoiceService } from './daekyungInvoiceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const CONFIG_PATH = path.join(ROOT_DIR, 'server/data/telegram_config.json');

export class TelegramBotService {
    constructor() {
        this.config = {
            botToken: process.env.TELEGRAM_BOT_TOKEN || '',
            chatId: process.env.TELEGRAM_CHAT_ID || '',
            polling: false,
            lastUpdateId: 0
        };
        this.isPollingActive = false;
        this.pollingTimer = null;
        this.loadConfig();
        if (this.config.botToken && this.config.polling !== false) {
            this.startPolling();
        }
    }

    loadConfig() {
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                this.config = { ...this.config, ...saved };
            }
        } catch (e) {
            console.error('[TelegramBot] 설정 로드 실패:', e.message);
        }
    }

    saveConfig() {
        try {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (e) {
            console.error('[TelegramBot] 설정 저장 실패:', e.message);
        }
    }

    setConfig({ botToken, chatId }) {
        if (botToken !== undefined) this.config.botToken = botToken.trim();
        if (chatId !== undefined) this.config.chatId = chatId.trim();
        this.saveConfig();
        return this.getStatus();
    }

    getStatus() {
        return {
            hasToken: !!this.config.botToken,
            tokenMasked: this.config.botToken ? `${this.config.botToken.slice(0, 6)}...${this.config.botToken.slice(-4)}` : '',
            chatId: this.config.chatId || '',
            isPolling: this.isPollingActive
        };
    }

    /**
     * 텔레그램 API 요청 헬퍼
     */
    async makeRequest(endpoint, payload = {}) {
        if (!this.config.botToken) throw new Error('텔레그램 봇 토큰이 설정되지 않았습니다.');
        const url = `https://api.telegram.org/bot${this.config.botToken}/${endpoint}`;

        return new Promise((resolve, reject) => {
            const reqData = JSON.stringify(payload);
            const parsedUrl = new URL(url);

            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(reqData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            req.on('error', reject);
            req.write(reqData);
            req.end();
        });
    }

    /**
     * 파일 다운로드 헬퍼
     */
    async downloadFile(filePath) {
        const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`;
        return new Promise((resolve, reject) => {
            https.get(fileUrl, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            }).on('error', reject);
        });
    }

    /**
     * 메시지 전송
     */
    async sendMessage(chatId, text) {
        try {
            return await this.makeRequest('sendMessage', {
                chat_id: chatId || this.config.chatId,
                text,
                parse_mode: 'HTML'
            });
        } catch (e) {
            console.error('[TelegramBot] 메시지 전송 실패:', e.message);
        }
    }

    /**
     * 실시간 롱폴링 시작
     */
    startPolling() {
        if (this.isPollingActive) return;
        if (!this.config.botToken) {
            console.log('[TelegramBot] 봇 토큰 미설정으로 폴링을 시작할 수 없습니다.');
            return;
        }

        this.isPollingActive = true;
        console.log('[TelegramBot] 🚀 텔레그램 거래명세서 수신 봇 폴링 가동 시작 (@Altf_office_auto_bot)');
        this.pollUpdates();
    }

    stopPolling() {
        this.isPollingActive = false;
        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = null;
        }
        console.log('[TelegramBot] 텔레그램 봇 폴링 중단');
    }

    async pollUpdates() {
        try {
            const res = await this.makeRequest('getUpdates', {
                offset: this.config.lastUpdateId + 1,
                timeout: 20
            });

            if (res && res.ok && Array.isArray(res.result)) {
                for (const update of res.result) {
                    this.config.lastUpdateId = update.update_id;
                    await this.handleUpdate(update);
                }
                this.saveConfig();
            }
        } catch (e) {
            // 폴링 오류 시 5초 후 재시도
        } finally {
            if (this.config.botToken) {
                this.pollingTimer = setTimeout(() => this.pollUpdates(), 1000);
            }
        }
    }

    /**
     * 수신된 텔레그램 메시지 처리
     */
    async handleUpdate(update) {
        const msg = update.message;
        if (!msg) return;

        const chatId = msg.chat.id;
        if (!this.config.chatId) {
            this.config.chatId = String(chatId);
            this.saveConfig();
        }

        // 1. /start 명령어 안내
        if (msg.text && msg.text.startsWith('/start')) {
            await this.sendMessage(chatId, `
<b>🤖 ALTF 전사 자율 에이전트 관제 봇 (@Altf_office_auto_bot)</b>
안녕하세요 조현진 대표님!
대경벤드 등 공급처에서 전달받은 <b>거래명세서 PDF 파일</b>을 이 채팅방에 그대로 전달(포워딩/파일 첨부)해 주세요!

<b>자동 처리 파이프라인:</b>
1. 📑 <b>총무부</b>: 공급가·부가세·운임 합산 매입 확정 전표 등록
2. 🛒 <b>구매부</b>: 발주번호(P.O No) 자동 매칭 & 엑셀 재고 발주 대장 미결 해제
3. 🔬 <b>품질부</b>: 1,469개 MTC 성적서 DB 사전 교차 매칭 확인
4. 🚚 <b>출고부</b>: 시화재고 입고 하차 검수 or 고객사 직배송 운송 감시
            `.trim());
            return;
        }

        // 사진으로 보냈을 때 친절한 안내
        if (msg.photo && !msg.document) {
            await this.sendMessage(chatId, `
📸 <b>이미지(사진)가 수신되었습니다.</b>
거래명세서 텍스트와 단가, 수량, P.O 번호를 100% 오차 없이 정밀 파싱하기 위해, 카카오톡/메신저에서 다운로드하신 <b>PDF 문서 원본 파일(Document)</b> 형태로 전송해 주시면 가장 빠르고 정확하게 4개 부서 자율 연계가 실행됩니다!
            `.trim());
            return;
        }

        // 2. 문서(PDF) 수신 처리
        if (msg.document) {
            const doc = msg.document;
            const fileName = doc.file_name || '거래명세서.pdf';

            await this.sendMessage(chatId, `⏳ <b>[${fileName}]</b> 거래명세서 문서를 감지했습니다. 전사 에이전트 연계 파이프라인을 가동합니다...`);

            try {
                // 파일 정보 가져오기
                const fileInfo = await this.makeRequest('getFile', { file_id: doc.file_id });
                if (!fileInfo || !fileInfo.ok || !fileInfo.result.file_path) {
                    throw new Error('텔레그램 파일 경로 획득 실패');
                }

                // 버퍼 다운로드
                const buffer = await this.downloadFile(fileInfo.result.file_path);

                // 파싱 & 전사 연계 (단면, 수십 장 다중 페이지, 여러 전표 통합 PDF 모두 지원)
                const rawParsed = await daekyungInvoiceService.parsePdfBuffer(buffer, fileName);
                const invoicesToProcess = Array.isArray(rawParsed) ? rawParsed : [rawParsed];

                for (const invoiceData of invoicesToProcess) {
                    const dispatchResult = await daekyungInvoiceService.processAndDispatch(invoiceData, 'TELEGRAM_BOT');

                    const pagesLabel = invoiceData.totalPages && invoiceData.totalPages > 1 ? ` (총 ${invoiceData.totalPages}페이지 파싱)` : '';
                    // 텔레그램 결과 보고 회신
                    const replyText = `
<b>✅ [대경벤드 거래명세표 접수 & 전사 연계 완료]</b>${pagesLabel}

📋 <b>전표 정보</b>
• 전표번호: <code>${invoiceData.invoiceNo}</code> (발행: ${invoiceData.invoiceDate})
• 공급자: ${invoiceData.supplier.name} ➔ 공급받는자: ${invoiceData.buyer.name}
• 비고 P.O 번호: <code>${invoiceData.poNumbers.join(', ') || '없음'}</code>
• 품목 수: <b>${invoiceData.items.length}개 품목</b> (다중 페이지 전체 누적)

💰 <b>총무부 매입 확정 금액</b>
• 공급가액: <b>${invoiceData.pricing.subtotal.toLocaleString()}원</b> (자재: ${invoiceData.pricing.totalSupplyPrice.toLocaleString()}원 + 운임: ${invoiceData.pricing.freightPrice.toLocaleString()}원)
• 부가세(10%): <b>${invoiceData.pricing.vat.toLocaleString()}원</b>
• <b>총 매입 합계: ${invoiceData.pricing.grandTotal.toLocaleString()}원</b>

🏢 <b>부서별 자율 조치 결과:</b>
• <b>🛒 구매부(PUR-07)</b>: ${dispatchResult.departments.purchase.message}
• <b>🔬 품질부(QC-08)</b>: ${dispatchResult.departments.quality.message}
• <b>🚚 출고부(LOG-01)</b>: ${dispatchResult.departments.shipping.message}
• <b>📑 총무부(GEN-01)</b>: 대경 매입 전표 DB 등록 완료
                    `.trim();

                    await this.sendMessage(chatId, replyText);
                }

            } catch (err) {
                console.error('[TelegramBot] 문서 처리 실패:', err);
                await this.sendMessage(chatId, `❌ 거래명세서 처리 중 오류가 발생했습니다: ${err.message}`);
            }
        }
    }
}

export const telegramBotService = new TelegramBotService();
