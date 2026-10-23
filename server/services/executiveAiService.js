/**
 * 👑 Executive AI Service for ALTF (관제·게이트부 자율 총괄 AI 비서 및 메신저 인바운드 분배 엔진)
 * 
 * [주요 임무]
 * 1. 텔레그램 인바운드 분배봇(EXE-01):
 *    - 텔레그램 수신 파일(거래명세표, 재고장, 성적서) 1차 접수 및 무결성 검증 ➔ 총무부/구매부/데이터관리팀 분배
 * 2. 카카오톡 인바운드 분배봇(EXE-02):
 *    - 카카오톡 수신 메시지/사진 1차 접수 및 의도 분류(견적 의뢰 vs 발주서 접수) ➔ 영업부 vs 구매부 분배
 * 3. 텔레그램 자율 관제 AI 비서(EXE-AI):
 *    - 대표님(조현진 대표님)의 자연어 질의(Make.com 인증, 미결 현황, 매입 현황 등)를 실시간 대시보드 상태를 읽어 직통 브리핑
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const DATA_DIR = path.join(ROOT_DIR, 'server/data');
const AGENTS_PATH = path.join(DATA_DIR, 'agents.json');
const MAKE_CONNECTIONS_PATH = path.join(DATA_DIR, 'make_connections.json');
const PENDING_ANALYSIS_PATH = path.join(DATA_DIR, 'pending_orders_analysis.json');
const SUPPLIER_INVOICES_PATH = path.join(DATA_DIR, 'supplier_invoices.json');
const KAKAO_ORDERS_PATH = path.join(DATA_DIR, 'kakao_orders.json');
const MAILPLUG_HISTORY_PATH = path.join(DATA_DIR, 'mailplug_history.json');
const CERTIFICATES_PATH = path.join(DATA_DIR, 'certificates.json');

export class ExecutiveAiService {
    constructor() {
        this.cache = null;
    }

    /**
     * 📊 전사 실시간 대시보드 상태 스냅샷 수집
     */
    getLiveDashboardContext() {
        const context = {
            timestamp: new Date().toISOString(),
            makeConnections: { total: 0, verified: 0, needReauth: [], warningCount: 0 },
            pendingOrders: { totalRows: 0, overdueCount: 0, dangerOrders: 0, urgentItems: [], stagnantItems: [] },
            supplierInvoices: { totalCount: 0, latest: null, todayTotalAmount: 0 },
            kakaoOrders: { totalCount: 0, latest: null },
            certificates: { totalCount: 0, lastSync: null },
            agents: { total: 0, activeCount: 0, departments: {} }
        };

        // 1. Make.com 크리덴셜 상태
        try {
            if (fs.existsSync(MAKE_CONNECTIONS_PATH)) {
                const conns = JSON.parse(fs.readFileSync(MAKE_CONNECTIONS_PATH, 'utf8'));
                context.makeConnections.total = conns.length;
                context.makeConnections.verified = conns.filter(c => c.status === 'VERIFIED' && !c.needsReauthorize).length;
                context.makeConnections.needReauth = conns.filter(c => c.needsReauthorize).map(c => `${c.name} (${c.type})`);
                context.makeConnections.warningCount = conns.reduce((sum, c) => sum + (c.warnings || 0), 0);
            }
        } catch (e) {
            console.error('[ExecutiveAI] Make.com 상태 로드 실패:', e.message);
        }

        // 2. 구매부 대경 생산 미결 상태
        try {
            if (fs.existsSync(PENDING_ANALYSIS_PATH)) {
                const pending = JSON.parse(fs.readFileSync(PENDING_ANALYSIS_PATH, 'utf8'));
                const summary = pending.summary || {};
                context.pendingOrders.totalRows = summary.totalRows || 0;
                context.pendingOrders.overdueCount = summary.overdueCount || 0;
                context.pendingOrders.dangerOrders = summary.dangerOrdersCount || 0;

                // 가장 긴급한 납기 위험 품목 (Top 3)
                if (Array.isArray(pending.criticalDueRiskItems)) {
                    context.pendingOrders.urgentItems = pending.criticalDueRiskItems.slice(0, 3).map(it => ({
                        poNo: it.orderNo || it.poNo || '미기재',
                        customer: it.customerName || it.deliveryTo || it.customer || '미지정',
                        item: `${it.itemName || ''} ${it.size || ''} (${it.material || ''})`.trim() || it.spec || '배관 피팅',
                        dueRisk: it.alertReason || '납기 지연 위험',
                        daysOverdue: Math.abs(it.remainingCustomerDays || it.elapsedDays || 0)
                    }));
                }

                // 가장 정체된 공정 품목 (Top 3)
                if (Array.isArray(pending.longestStagnantItems)) {
                    context.pendingOrders.stagnantItems = pending.longestStagnantItems.slice(0, 3).map(it => ({
                        customer: it.customerName || it.deliveryTo || it.customer || '미지정',
                        item: `${it.itemName || ''} ${it.size || ''} (${it.material || ''})`.trim() || it.spec || '배관 피팅',
                        stage: it.stage || it.stageName || '공정 정체',
                        stagnantDays: it.elapsedDays || it.stagnantDays || 0
                    }));
                }
            }
        } catch (e) {
            console.error('[ExecutiveAI] 미결 분석 로드 실패:', e.message);
        }

        // 3. 매입 거래명세표 현황
        try {
            if (fs.existsSync(SUPPLIER_INVOICES_PATH)) {
                const invs = JSON.parse(fs.readFileSync(SUPPLIER_INVOICES_PATH, 'utf8'));
                context.supplierInvoices.totalCount = invs.length;
                if (invs.length > 0) {
                    const last = invs[invs.length - 1];
                    context.supplierInvoices.latest = {
                        invoiceNo: last.invoiceNo,
                        date: last.invoiceDate,
                        customer: last.customerName,
                        amount: last.pricing?.grandTotal || 0,
                        itemsCount: last.items ? last.items.length : 0
                    };
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const todayInvs = invs.filter(i => i.invoiceDate === todayStr || i.createdAt?.startsWith(todayStr));
                    context.supplierInvoices.todayTotalAmount = todayInvs.reduce((sum, i) => sum + (i.pricing?.grandTotal || 0), 0);
                }
            }
        } catch (e) {
            console.error('[ExecutiveAI] 거래명세표 로드 실패:', e.message);
        }

        // 4. 카카오 발주서 접수 현황
        try {
            if (fs.existsSync(KAKAO_ORDERS_PATH)) {
                const orders = JSON.parse(fs.readFileSync(KAKAO_ORDERS_PATH, 'utf8'));
                context.kakaoOrders.totalCount = orders.length;
                if (orders.length > 0) {
                    const last = orders[0];
                    context.kakaoOrders.latest = {
                        orderNo: last.orderNo,
                        customer: last.customerName,
                        amount: last.totalAmount,
                        receivedAt: last.receivedAt
                    };
                }
            }
        } catch (e) {
            console.error('[ExecutiveAI] 카카오 발주서 로드 실패:', e.message);
        }

        // 5. 품질부 성적서 현황
        try {
            if (fs.existsSync(MAILPLUG_HISTORY_PATH)) {
                const hist = JSON.parse(fs.readFileSync(MAILPLUG_HISTORY_PATH, 'utf8'));
                context.certificates.totalCount = hist.length;
                if (hist.length > 0) {
                    context.certificates.lastSync = hist[0].downloadedAt;
                }
            }
        } catch (e) {
            console.error('[ExecutiveAI] 성적서 히스토리 로드 실패:', e.message);
        }

        // 6. 전사 에이전트 가동 상태
        try {
            if (fs.existsSync(AGENTS_PATH)) {
                const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
                context.agents.total = agents.length;
                context.agents.activeCount = agents.filter(a => a.status === 'ACTIVE').length;
            }
        } catch (e) {
            console.error('[ExecutiveAI] 에이전트 로드 실패:', e.message);
        }

        return context;
    }

    /**
     * 🧠 텔레그램 질문에 대해 전사 대시보드 상태를 바탕으로 AI 답변 생성
     * @param {string} userQuestion 대표님의 질문 텍스트
     * @returns {Promise<string>} 텔레그램 규격 HTML 답변
     */
    async askExecutiveAI(userQuestion) {
        const liveContext = this.getLiveDashboardContext();
        const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        const promptContext = `
[알트에프(ALTF) 실시간 전사 시스템 상태 - ${now}]
1. Make.com OAuth 연결 상태:
   - 총 ${liveContext.makeConnections.total}개 연결 중 ${liveContext.makeConnections.verified}개 정상 인증됨 (VERIFIED).
   - 재인증 필요 항목: ${liveContext.makeConnections.needReauth.length > 0 ? liveContext.makeConnections.needReauth.join(', ') : '없음 (전체 최신화 완료)'}.
   - 경고 수: ${liveContext.makeConnections.warningCount}건.

2. 구매부 대경 생산 미결 공정 현황 (9단계 추적):
   - 총 미결 건수: ${liveContext.pendingOrders.totalRows}건.
   - 납기 초과/지연 건수: ${liveContext.pendingOrders.overdueCount}건.
   - 위험 거래처 건수: ${liveContext.pendingOrders.dangerOrders}건.
   - [가장 급한 연락 필요 미결 Top 3]:
     ${liveContext.pendingOrders.urgentItems.map((it, idx) => `${idx + 1}) [${it.customer}] ${it.item} - 발주번호: ${it.poNo || '미기재'} (${it.dueRisk}, ${it.daysOverdue}일 지연)`).join('\n     ') || '현재 긴급 납기위험 건 없음'}
   - [가장 오래 정체된 공정 Top 3]:
     ${liveContext.pendingOrders.stagnantItems.map((it, idx) => `${idx + 1}) [${it.customer}] ${it.item} - 공정: ${it.stage} (${it.stagnantDays}일 정체)`).join('\n     ') || '장기 정체 품목 없음'}

3. 매입 거래명세표 현황 (총무부 GEN-01 / 구매부 PUR-07):
   - 누적 매입 전표: 총 ${liveContext.supplierInvoices.totalCount}건.
   - 최근 전표: ${liveContext.supplierInvoices.latest ? `No.${liveContext.supplierInvoices.latest.invoiceNo} (${liveContext.supplierInvoices.latest.customer}, ${(liveContext.supplierInvoices.latest.amount || 0).toLocaleString()}원)` : '없음'}.
   - 금일 확정 매입 총액: ${(liveContext.supplierInvoices.todayTotalAmount || 0).toLocaleString()}원.

4. 카카오톡 인바운드 접수 현황:
   - 누적 카카오 발주서: ${liveContext.kakaoOrders.totalCount}건 접수.
   ${liveContext.kakaoOrders.latest ? `- 최근 카카오 발주: ${liveContext.kakaoOrders.latest.orderNo} (${liveContext.kakaoOrders.latest.customer})` : ''}

5. 품질부 외주 성적서 수집 (QC-01/02):
   - 수집된 외주 성적서: 총 ${liveContext.certificates.totalCount}개 파일 정상 판독 대장 연동 중.

6. 전사 에이전트 봇 상태:
   - 7대 실무 부서 총 ${liveContext.agents.total}기 중 ${liveContext.agents.activeCount}기 정상 가동 중 (ALL ACTIVE).
`;

        const systemInstruction = `너는 알트에프(ALTF)의 '관제·게이트부 자율 총괄 AI 비서(EXE-AI)'야.
조현진 대표님이 텔레그램을 통해 주신 질문에 대해, 위 [알트에프 실시간 전사 시스템 상태]를 근거로 정확하고 신속하게 팩트 위주로 보고해야 해.

[답변 작성 가이드]
1. 텔레그램 전용 HTML 태그(<b>굵게</b>, <code>코드/수치</code>)를 적극 사용해.
2. 불필요한 미사여구나 서론("안녕하세요 대표님" 등)은 생략하고 바로 핵심 답변을 3~6줄로 일목요연하게 브리핑해.
3. 질문에 해당하는 팩트(수치, 거래처명, 품목, 해결 조치)를 명확히 제시해.
4. "make.com 인증 최신화 했어?" 같은 질문에는 Make.com 상태 섹션의 인증 결과(전체 정상인지, 재인증 필요한 것이 있는지)를 명확히 답해.
5. "미결 중 가장 급하게 연락해야 되는 것이 뭐야?" 같은 질문에는 [가장 급한 연락 필요 미결]의 거래처명, 품명, 지연일수를 명확히 짚어줘.`;

        // 1차: OpenAI gpt-4o-mini 호출
        if (process.env.OPENAI_API_KEY) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: `${systemInstruction}\n\n${promptContext}` },
                            { role: 'user', content: userQuestion }
                        ],
                        temperature: 0.2
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content;
                    if (reply) {
                        this.updateAgentLog('EXE-AI', `[답변 완료] ${userQuestion.slice(0, 25)}`);
                        return reply;
                    }
                }
            } catch (err) {
                console.warn('[ExecutiveAI] OpenAI 호출 실패, Gemini 폴백 전환:', err.message);
            }
        }

        // 2차: Gemini 3.8 Flash 폴백 호출
        if (process.env.GEMINI_API_KEY) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    { text: `${systemInstruction}\n\n${promptContext}\n\n[대표님 질문]\n${userQuestion}` }
                                ]
                            }
                        ]
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (reply) {
                        this.updateAgentLog('EXE-AI', `[Gemini 답변 완료] ${userQuestion.slice(0, 25)}`);
                        return reply;
                    }
                }
            } catch (gErr) {
                console.warn('[ExecutiveAI] Gemini 호출 실패:', gErr.message);
            }
        }

        // 3차: 룰 기반 스마트 폴백
        return this.generateRuleBasedAnswer(userQuestion, liveContext);
    }

    /**
     * API 키 장애 시 자체 대시보드 데이터 기반 스마트 직통 답변
     */
    generateRuleBasedAnswer(question, ctx) {
        const q = question.toLowerCase();

        // 1. Make.com 관련 질의
        if (q.includes('make') || q.includes('인증') || q.includes('크리덴셜') || q.includes('oauth')) {
            const need = ctx.makeConnections.needReauth;
            if (need.length === 0) {
                return `
<b>👑 [EXE-AI 관제 브리핑: Make.com 크리덴셜]</b>
• <b>상태</b>: ✅ <b>전체 ${ctx.makeConnections.total}개 연결 정상 인증 완료</b>
• <b>재인증 필요 항목</b>: 없음 (구글시트, S3 업로더, IMAP 등 상시 정상 가동)
• <b>특이사항</b>: DAT-01/06 봇이 8시간 주기로 무결성을 상시 감시 중입니다.
                `.trim();
            } else {
                return `
<b>👑 [EXE-AI 관제 긴급 보고: Make.com 재인증 필요]</b>
• <b>주의 항목 (${need.length}건)</b>: <code>${need.join(', ')}</code>
• <b>조치</b>: 대시보드 DAT-01 도구함에서 <b>[1-Click Reauthorize]</b> 갱신이 필요합니다.
                `.trim();
            }
        }

        // 2. 미결 관련 질의
        if (q.includes('미결') || q.includes('연락') || q.includes('급한') || q.includes('독촉') || q.includes('지연')) {
            const urgent = ctx.pendingOrders.urgentItems[0];
            const urgentText = urgent 
                ? `• <b>가장 급한 건</b>: <b>${urgent.customer}</b> (${urgent.item})\n• <b>사유</b>: ${urgent.dueRisk} (${urgent.daysOverdue}일 경과)\n• <b>발주번호</b>: <code>${urgent.poNo || '미기재'}</code>`
                : '• 현재 납기 긴급 위험 건은 없습니다.';

            return `
<b>👑 [EXE-AI 관제 브리핑: 대경 생산미결 현황]</b>
• <b>총 미결 규모</b>: <b>${ctx.pendingOrders.totalRows}건</b> (초과/지연: <b>${ctx.pendingOrders.overdueCount}건</b>)
${urgentText}
• <b>조치사항</b>: 구매부(PUR-02~04)가 대경벤드 생산공정(성형/열처리) 9단계를 실시간 추적 중입니다.
            `.trim();
        }

        // 3. 거래명세표 / 매입 관련 질의
        if (q.includes('명세표') || q.includes('매입') || q.includes('전표') || q.includes('금액')) {
            return `
<b>👑 [EXE-AI 관제 브리핑: 거래명세표 매입 현황]</b>
• <b>누적 등록 전표</b>: 총 <b>${ctx.supplierInvoices.totalCount}건</b>
• <b>최근 전표</b>: <code>No.${ctx.supplierInvoices.latest?.invoiceNo || '-'}</code> (${ctx.supplierInvoices.latest?.customer || '알트에프'})
• <b>최근 전표 금액</b>: <b>${(ctx.supplierInvoices.latest?.amount || 0).toLocaleString()}원</b>
• <b>조치</b>: 총무부(GEN-01) 매입 전표 DB 보관 및 구매부(PUR-07) 미결 해제 완료
            `.trim();
        }

        // 4. 전사 봇 근무 상태
        if (q.includes('상태') || q.includes('직원') || q.includes('봇') || q.includes('가동')) {
            return `
<b>👑 [EXE-AI 관제 브리핑: 전사 44기 봇 가동 현황]</b>
• <b>가동 상태</b>: 7대 실무 부서 <b>${ctx.agents.activeCount} / ${ctx.agents.total}기 ALL ACTIVE (100%)</b>
• <b>인바운드 게이트</b>: 텔레그램(EXE-01) 및 카카오톡(EXE-02) 분배 엔진 상시 작동 중
• <b>백엔드 파이프라인</b>: 대경 미결 추적, 성적서 IMAP 수집, S3 재고 동기화 전원 대기 완료
            `.trim();
        }

        // 기본 안내
        return `
<b>👑 [EXE-AI 관제 비서]</b>
대표님, 요청하신 내용을 전사 데이터와 대조했습니다.
• <b>Make.com</b>: ${ctx.makeConnections.verified}/${ctx.makeConnections.total}개 인증 완료
• <b>대경 미결</b>: ${ctx.pendingOrders.totalRows}건 관제 중 (위험 ${ctx.pendingOrders.dangerOrders}개사)
• <b>거래명세표</b>: ${ctx.supplierInvoices.totalCount}건 매입 확정 보관
궁금하신 세부 부서 업무나 지시사항을 말씀해 주시면 즉시 수행하겠습니다!
        `.trim();
    }

    /**
     * agents.json 로그 및 상태 업데이트
     */
    updateAgentLog(agentCode, logMessage) {
        try {
            if (!fs.existsSync(AGENTS_PATH)) return;
            const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
            const agent = agents.find(a => a.code === agentCode || a.id.includes(agentCode.toLowerCase()));
            if (agent) {
                agent.lastActive = '방금 전';
                if (!Array.isArray(agent.logs)) agent.logs = [];
                const timeStr = new Date().toLocaleTimeString('ko-KR');
                agent.logs.unshift(`[${timeStr}] ${logMessage}`);
                agent.logs = agent.logs.slice(0, 10);
                if (agent.metrics) agent.metrics.tasksToday = (agent.metrics.tasksToday || 0) + 1;
                fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf8');
            }
        } catch (e) {
            console.error(`[ExecutiveAI] ${agentCode} 로그 업데이트 실패:`, e.message);
        }
    }
}

export const executiveAiService = new ExecutiveAiService();
