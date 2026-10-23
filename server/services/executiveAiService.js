/**
 * 🎩 Chief of Staff AI for ALTF (경영총괄부 비서실장 MGT-01, 부장급)
 *
 * [역할]
 * 전사 모든 부서·봇(영업/구매/품질/출고/총무/관제/데이터 + 앞으로 추가될 부서)을 관제하고,
 * 대표님께 텔레그램으로 "결론 먼저, 예외만" 보고하는 비서실장 봇.
 *
 * [설계 - Supervisor/Worker + BLUF(Bottom Line Up Front) 예외 보고]
 * 1. 수집(Sense) : departments.json / agents.json 을 그대로 읽어 부서·봇 목록을 자동 구성
 *                  → 새 부서/봇이 생겨도 코드 수정 없이 관제 대상에 포함
 * 2. 판정(Judge) : 공통 봇 헬스체크(정지·결재대기·오류로그·무응답·과부하) + 부서별 업무 프로브(KPI/이슈)
 *                  → 새 부서의 업무 지표는 registerProbe(deptId, fn) 으로 확장
 * 3. 보고(Report): 기본은 결론 먼저·예외만. "자세히/발주번호" 요청 시 전화·조치 가능한 원장 수준 상세 보고
 *                  → GPT 는 읽기 전용 조회 도구(tool calling)로 실제 레코드를 직접 조회한 뒤 답변 (숫자 환각 차단)
 *                  → API 장애 시에도 규칙 기반 상세 보고로 동일한 사실 제공
 * 4. 선제 보고   : 10분 주기 감시 → 신규 🔴 이슈만 즉시 푸시, 평일 08:30/17:30 정기 브리핑
 * 5. 양방향 지시 : "성적서 매칭했으니 알림 그만" 같은 지시를 도구로 이행하고 기억
 *                  - resolutions: 대표님이 처리 완료한 건 (QC-13 이 재감지해도 재알림 안 함)
 *                  - mutes      : 특정 이슈 알림 끄기 (기간 지정 가능)
 *                  - memories   : 상시 지시사항 (매 답변 시 반영)
 *                  - conversation: 최근 대화 12턴 ("그거 해결했어" 같은 후속 지시 이해)
 *                  모든 지시는 되돌릴 수 있고 actions 이력에 남김
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { agentControlManager } from './agentControlManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const DATA_DIR = path.join(ROOT_DIR, 'server/data');
const AGENTS_PATH = path.join(DATA_DIR, 'agents.json');
const DEPARTMENTS_PATH = path.join(DATA_DIR, 'departments.json');
const STATE_PATH = path.join(DATA_DIR, 'chief_of_staff_state.json');   // 런타임(하트비트·대화·경보중복) - git 제외
const DIRECTIVES_PATH = path.join(DATA_DIR, 'chief_directives.json');     // 대표님 지시(기억·음소거·해결) - git 동기화로 모든 PC 공유
const DIRECTIVE_KEYS = ['resolutions', 'mutes', 'memories', 'actions'];
const MAKE_CONNECTIONS_PATH = path.join(DATA_DIR, 'make_connections.json');
const PENDING_ANALYSIS_PATH = path.join(DATA_DIR, 'pending_orders_analysis.json');
const PURCHASE_SCHEDULER_PATH = path.join(DATA_DIR, 'purchase_scheduler.json');
const SUPPLIER_INVOICES_PATH = path.join(DATA_DIR, 'supplier_invoices.json');
const KAKAO_ORDERS_PATH = path.join(DATA_DIR, 'kakao_orders.json');
const KAKAO_INTAKES_PATH = path.join(DATA_DIR, 'kakao_intakes.json');
const KAKAO_QUOTES_PATH = path.join(DATA_DIR, 'kakao_draft_quotations.json');
const MAILPLUG_HISTORY_PATH = path.join(DATA_DIR, 'mailplug_history.json');
const QC_MISSING_ALERTS_PATH = path.join(DATA_DIR, 'qc_missing_alerts.json');
const ISSUED_CERTS_PATH = path.join(DATA_DIR, 'issued_certificates.json');
const PURCHASE_QC_MATCHES_PATH = path.join(DATA_DIR, 'purchase_qc_matches.json'); // purchase_orders + 성적서 매칭 상태
const DISPATCH_QUEUE_PATH = path.join(DATA_DIR, 'dispatch_queue.json');

export const CHIEF_CODE = 'MGT-01';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1'; // .env OPENAI_MODEL 로 변경 가능

const SEV = { CRIT: 3, WARN: 2, INFO: 1 };
const SEV_ICON = { 3: '🔴', 2: '🟡', 1: '⚪' };

const OPEN_STATES = new Set(['RECEIVED', 'NEW', 'PENDING', 'PENDING_APPROVAL', 'WAITING', 'DRAFT', 'QUEUED']);
const FAILED_STATES = new Set(['FAILED', 'ERROR']);
const STOPPED_STATES = new Set(['OFFLINE', 'OFF', 'IDLE']);
const ERROR_LOG_RE = /❌|오류|실패|에러|\berror\b|exception|timeout/i;

const MAX_BRIEF_ISSUES = 5;
const WATCH_INTERVAL_MS = 10 * 60 * 1000;
const BRIEF_SLOTS_KST = ['08:30', '17:30']; // 평일 정기 브리핑
const BRIEF_WINDOW_MIN = 60;                // 슬롯 경과 후 이 시간 안에만 발송 (재시작 시 지난 브리핑 폭주 방지)

const INTERVAL_HOURS = { '5m': 1 / 12, '10m': 1 / 6, '30m': 0.5, '1h': 1, '2h': 2, '3h': 3, '4h': 4, '8h': 8, '12h': 12, '24h': 24 };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const readJson = (p, fallback) => {
    try {
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
    } catch (e) {
        console.error(`[ChiefOfStaff] ${path.basename(p)} 로드 실패:`, e.message);
        return fallback;
    }
};

const hoursSince = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? (Date.now() - t) / 3.6e6 : null;
};

const ago = (iso) => {
    const h = hoursSince(iso);
    if (h === null) return '기록 없음';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}분 전`;
    if (h < 48) return `${Math.round(h)}시간 전`;
    return `${Math.round(h / 24)}일 전`;
};

const kst = () => new Date(Date.now() + 9 * 3.6e6); // getUTC* 로 읽으면 KST
const pad = (n) => String(n).padStart(2, '0');
const kstStamp = () => {
    const d = kst();
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const won = (n = 0) => {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
    if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만원`;
    return `${n.toLocaleString()}원`;
};

const shortDept = (name = '') => name.replace(/(부|팀)$/, '');

const ymd = (iso) => (iso ? String(iso).slice(0, 10) : '-');
const PO_RE = /\b(ES\d{6}-\d{3,5}|PO-[A-Z0-9-]{6,})\b/i;

// 개발 중 생성된 테스트 경보(TEST_OUT_99999, NON_EXISTENT_LOT 등)는 대표 보고에서 제외
const isTestRecord = (a) => /^TEST[_-]/i.test(a.poNo || a.outboundNo || '') || /테스트/.test(a.customer || '')
    || (a.missingLines || []).some(l => /NON_EXISTENT|TEST/i.test(`${l.vendorLot || ''}${l.lotNo || ''}`));

/**
 * 🔬 성적서 누락 경보 상세: 테스트·중복 제거 후 발주 원장(품목·수량·금액)과 발행 이력을 결합
 */
export function getMissingCertDetails() {
    // 대표님이 해결 처리한 발주는 QC-13 이 같은 건을 다시 감지해도 보고하지 않음
    const resolutions = readJson(DIRECTIVES_PATH, {}).resolutions || {};
    const open = readJson(QC_MISSING_ALERTS_PATH, []).filter(a => !a.resolved && a.status !== 'RESOLVED' && !resolutions[a.poNo || a.outboundNo]);
    const tests = open.filter(isTestRecord);

    // 같은 발주/출고번호의 반복 경보는 최신 1건만
    const latest = new Map();
    for (const a of open.filter(a => !isTestRecord(a))) {
        const ref = a.poNo || a.outboundNo || a.id;
        const prev = latest.get(ref);
        if (!prev || Date.parse(a.detectedAt) > Date.parse(prev.detectedAt)) latest.set(ref, a);
    }
    const realCount = open.length - tests.length;

    const refs = new Set(latest.keys());
    const lines = refs.size ? readJson(PURCHASE_QC_MATCHES_PATH, []).filter(o => refs.has(o.poNumber)) : [];
    const issued = readJson(ISSUED_CERTS_PATH, []);
    const itemNo = (o) => Number(String(o.id).split('_item_')[1] ?? 0);

    const items = [...latest.entries()].map(([ref, a]) => {
        const poLines = lines.filter(o => o.poNumber === ref).sort((x, y) => itemNo(x) - itemNo(y));
        const head = poLines[0] || {};
        const missing = (a.missingLines || []).map(l => {
            const byIdx = poLines[(l.itemIndex || 0) - 1];
            const o = byIdx && byIdx.productId === l.description ? byIdx : poLines.find(p => p.productId === l.description) || {};
            return { no: l.itemIndex ?? l.lineNo, item: l.description, qty: o.quantity ?? null, pendingQty: o.pendingQty ?? null, lot: l.lotNo || l.vendorLot || null, heat: l.heatNo || null };
        });
        const certs = issued.filter(c => c.poNo === ref);
        const masterMatched = poLines.reduce((s, o) => s + (o.certMatchCount || 0), 0);
        // 발행이력과 마스터 매칭이 엇갈리면 '미입고'가 아니라 마스터 적재 누락일 가능성이 높으므로 확인 순서가 달라짐
        const diagnosis = certs.length > 0 && masterMatched === 0
            ? { cause: '발행이력은 있으나 성적서 마스터(certificates.json) HEAT/LOT 매칭 0건 → 원본은 수령했으나 마스터 미적재 가능성', action: '대경 재요청 전에 QC-02에서 원본 파싱·마스터 적재 여부 먼저 확인, 원본이 없으면 대경벤드에 재송 요청', owner: 'QC-02' }
            : { cause: '발행·매칭 이력 없음 → 대경벤드 성적서 미발송 가능성', action: `대경벤드에 ${ref} 성적서(HEAT/LOT) 발송 요청`, owner: 'QC-13' };
        return {
            kind: a.kind === 'OUTBOUND_CERT_MISSING' ? '출고' : '발주',
            ref,
            customer: head.customerName || a.customer || '미상',
            alertCustomer: a.customer,
            orderId: head.orderId || null,
            orderDate: head.date || null,
            request: (head.memo || '').match(/요청사항:\s*([^\n]*)/)?.[1]?.trim() || null,
            detectedAt: a.detectedAt,
            totalItems: a.totalItems,
            missingCount: a.missingCount ?? missing.length,
            totalQty: missing.reduce((s, m) => s + (m.qty || 0), 0),
            totalAmount: poLines.reduce((s, o) => s + (o.amount || 0), 0),
            masterMatched,
            diagnosis,
            issuedCerts: certs.map(c => ({ certNo: c.certNo, issuedAt: c.issuedAt || c.createdAt, itemCount: c.itemCount })),
            missing
        };
    }).sort((x, y) => Date.parse(x.detectedAt) - Date.parse(y.detectedAt));

    return { items, excludedTests: tests.length, mergedDuplicates: realCount - items.length };
}

// 발행번호 압축: YR-26-07015-1 … -6 ➔ YR-26-07015-1~6
const compactCertNos = (nos) => {
    if (nos.length <= 1) return nos.join('');
    const prefix = nos[0].slice(0, nos[0].lastIndexOf('-') + 1);
    if (prefix && nos.every(n => n.startsWith(prefix))) return `${prefix}${nos[0].slice(prefix.length)}~${nos[nos.length - 1].slice(prefix.length)}`;
    return nos.join(', ');
};

/**
 * 🔌 부서별 업무 프로브: () => { kpis: string[], issues: Issue[] }
 * Issue = { key, sev, owner?, text }  (key 는 선제 경보 중복 방지용 고정 식별자)
 */
const BUILTIN_PROBES = {
    purchase() {
        const out = { kpis: [], issues: [] };
        const pending = readJson(PENDING_ANALYSIS_PATH, null);
        if (pending?.summary) {
            const s = pending.summary;
            out.kpis.push(`미결 ${s.totalRows ?? 0}`, `실지연 ${s.actualDelayedCount ?? s.overdueCount ?? 0}`, `필수확인 ${s.mustCheckCount ?? 0}`, `예상문제 ${s.forecastRiskCount ?? 0}`);

            // 미결관리팀 확인 순서: P1 필수확인(지연/임박 + 공정진행률 저조) → P3 예상 문제
            const board = pending.priorityBoard;
            const risks = Array.isArray(pending.criticalDueRiskItems) ? pending.criticalDueRiskItems : [];
            if (board?.mustCheckOrders?.length) {
                const top = board.mustCheckOrders[0];
                const it = top.mustCheckItems[0];
                out.issues.push({
                    key: `pur:mustcheck:${top.orderNo}`,
                    sev: SEV.CRIT,
                    owner: 'PUR-04',
                    text: `필수확인 ${board.counts.P1}건(발주 ${board.mustCheckOrders.length}) · 최우선 ${top.client} ${it.itemName} ${it.size} ${it.delayDays > 0 ? `${it.delayDays}일 지연` : `D-${it.remainingCustomerDays}`} 공정 ${it.progressPct}%`
                });
                if (board.counts.P3 > 0) {
                    const f = board.forecastRiskItems[0];
                    out.issues.push({
                        key: `pur:forecast:${f.orderNo}`,
                        sev: SEV.WARN,
                        owner: 'PUR-04',
                        text: `예상 문제 ${board.counts.P3}건 · ${f.deliveryTo || f.customerName} ${f.itemName} ${f.size} 약 ${f.expectedSlipDays}일 지연 예상`
                    });
                }
            } else if (risks.length > 0) {
                const top = risks[0];
                const customer = top.customerName || top.deliveryTo || top.customer || '미지정';
                const item = `${top.itemName || ''} ${top.size || ''}`.trim() || top.spec || '품목';
                const days = Math.abs(top.remainingCustomerDays ?? top.elapsedDays ?? 0);
                out.issues.push({
                    key: `pur:duerisk:${top.orderNo || top.poNo || customer}`,
                    sev: SEV.CRIT,
                    owner: 'PUR-04',
                    text: `납기위험 ${risks.length}건 · 최우선 ${customer} ${item} (${days}일)`
                });
            }

            const age = hoursSince(pending.timestamp);
            if (age !== null && age > 36) {
                out.issues.push({ key: 'pur:pending-stale', sev: SEV.WARN, owner: 'PUR-01', text: `미결 분석 ${Math.floor(age / 24)}일째 미갱신` });
            }
        }

        const sched = readJson(PURCHASE_SCHEDULER_PATH, null);
        if (sched) {
            if (FAILED_STATES.has(sched.status)) {
                out.issues.push({ key: 'pur:scheduler-failed', sev: SEV.CRIT, owner: 'PUR-01', text: `발주 동기화 실패 (${sched.statusLabel || sched.status})` });
            } else {
                const age = hoursSince(sched.lastSyncTime);
                if (age !== null && age > 26) {
                    out.issues.push({ key: 'pur:scheduler-stale', sev: SEV.WARN, owner: 'PUR-01', text: `발주 동기화 ${Math.round(age)}시간째 없음` });
                }
            }
        }

        const orders = readJson(KAKAO_ORDERS_PATH, []);
        const stuck = orders.filter(o => OPEN_STATES.has(o.status) && (hoursSince(o.receivedAt) ?? 0) > 2);
        if (stuck.length > 0) {
            out.issues.push({ key: `pur:kakao-orders:${stuck.length}`, sev: SEV.WARN, owner: 'PUR-07', text: `카톡 발주 미처리 ${stuck.length}건 (2시간 초과)` });
        }
        return out;
    },

    sle() {
        const out = { kpis: [], issues: [] };
        const quotes = readJson(KAKAO_QUOTES_PATH, []);
        const waiting = quotes.filter(q => OPEN_STATES.has(q.status));
        out.kpis.push(`카톡견적 ${quotes.length}`, `승인대기 ${waiting.length}`);
        if (waiting.length > 0) {
            out.issues.push({ key: `sle:quote-wait:${waiting.length}`, sev: SEV.WARN, owner: 'SLE-02', text: `견적 승인 대기 ${waiting.length}건` });
        }

        const intakes = readJson(KAKAO_INTAKES_PATH, []);
        const unassigned = intakes.filter(i => OPEN_STATES.has(i.status) && (hoursSince(i.receivedAt || i.createdAt) ?? 0) > 2);
        if (unassigned.length > 0) {
            out.issues.push({ key: `sle:intake-wait:${unassigned.length}`, sev: SEV.WARN, owner: 'EXE-02', text: `카톡 인입 미배정 ${unassigned.length}건 (2시간 초과)` });
        }
        return out;
    },

    quality() {
        const out = { kpis: [], issues: [] };
        const hist = readJson(MAILPLUG_HISTORY_PATH, []);
        const issued = readJson(ISSUED_CERTS_PATH, []);
        const { items, excludedTests } = getMissingCertDetails();
        out.kpis.push(`수집메일 ${hist.length}`, `발행 ${issued.length}`, `누락 ${items.length}`);

        if (items.length > 0) {
            const lines = items.reduce((sum, a) => sum + a.missingCount, 0);
            const refs = items.slice(0, 2).map(a => `${a.ref} ${a.customer}`).join(', ');
            out.issues.push({
                key: `qc:missing:${items.map(a => a.ref).join(',')}`,
                sev: SEV.WARN,
                owner: 'QC-13',
                text: `성적서 누락 ${items.length}건/${lines}라인: ${refs}${items.length > 2 ? ' 외' : ''} (상세: 누락)`
            });
        }
        if (excludedTests > 0) {
            out.issues.push({ key: 'qc:test-alerts', sev: SEV.INFO, owner: 'QC-13', text: `테스트 경보 ${excludedTests}건 정리 필요 (보고 제외)` });
        }

        const last = hist[0]?.timestamp || hist[0]?.downloadedAt;
        const age = hoursSince(last);
        if (age !== null && age > 24) {
            out.issues.push({ key: 'qc:imap-stale', sev: SEV.WARN, owner: 'QC-01', text: `성적서 메일 수집 ${Math.round(age)}시간째 없음` });
        }
        return out;
    },

    general() {
        const out = { kpis: [], issues: [] };
        const invs = readJson(SUPPLIER_INVOICES_PATH, []);
        const today = kst().toISOString().slice(0, 10);
        const todays = invs.filter(i => i.invoiceDate === today || i.createdAt?.startsWith(today));
        const sum = todays.reduce((s, i) => s + (i.pricing?.grandTotal || 0), 0);
        out.kpis.push(`매입전표 ${invs.length}`, `금일 ${todays.length}건/${won(sum)}`);
        return out;
    },

    dat() {
        const out = { kpis: [], issues: [] };
        const conns = readJson(MAKE_CONNECTIONS_PATH, []);
        const verified = conns.filter(c => c.status === 'VERIFIED' && !c.needsReauthorize).length;
        out.kpis.push(`Make 인증 ${verified}/${conns.length}`);

        const reauth = conns.filter(c => c.needsReauthorize);
        if (reauth.length > 0) {
            out.issues.push({ key: `dat:reauth:${reauth.map(c => c.id).join(',')}`, sev: SEV.CRIT, owner: 'DAT-01', text: `Make 재인증 필요: ${reauth.map(c => c.name).join(', ')}` });
        }
        const warnings = conns.reduce((s, c) => s + (c.warnings || 0), 0);
        if (warnings > 0) {
            out.issues.push({ key: `dat:make-warn:${warnings}`, sev: SEV.WARN, owner: 'DAT-02', text: `Make 경고 ${warnings}건` });
        }
        return out;
    },

    executive() {
        const out = { kpis: [], issues: [] };
        const queue = readJson(DISPATCH_QUEUE_PATH, []);
        const waiting = queue.filter(d => OPEN_STATES.has(d.status));
        const failed = queue.filter(d => FAILED_STATES.has(d.status));
        out.kpis.push(`발송대기 ${waiting.length}`, `발송실패 ${failed.length}`);
        if (failed.length > 0) {
            out.issues.push({ key: `exe:dispatch-failed:${failed.map(d => d.id).join(',')}`, sev: SEV.CRIT, owner: 'DIS-01', text: `발송 실패 ${failed.length}건 (${failed[0].subject || failed[0].kind || ''})` });
        }
        if (waiting.length > 0) {
            out.issues.push({ key: `exe:dispatch-wait:${waiting.length}`, sev: SEV.WARN, owner: 'DIS-01', text: `발송 승인 대기 ${waiting.length}건` });
        }
        return out;
    }
};

export class ExecutiveAiService {
    constructor() {
        this.probes = new Map(Object.entries(BUILTIN_PROBES));
        this.state = this.loadState();
        this.watchTimer = null;
        this.send = null;
    }

    /**
     * 새 부서의 업무 지표 프로브 등록 (예: registerProbe('rnd', () => ({ kpis: [...], issues: [...] })))
     */
    registerProbe(deptId, probeFn) {
        this.probes.set(deptId, probeFn);
    }

    loadState() {
        return {
            alertsEnabled: true, alertedKeys: [], lastBriefSlot: null, heartbeats: {}, conversation: [],
            resolutions: {}, mutes: [], memories: [], actions: [],
            ...readJson(STATE_PATH, {}),
            ...readJson(DIRECTIVES_PATH, {})
        };
    }

    saveState() {
        try {
            const directives = Object.fromEntries(DIRECTIVE_KEYS.map(k => [k, this.state[k]]));
            const runtime = Object.fromEntries(Object.entries(this.state).filter(([k]) => !DIRECTIVE_KEYS.includes(k)));
            const nextDirectives = JSON.stringify(directives, null, 2);
            // 지시 파일은 바뀔 때만 기록 (git 변경 노이즈 방지)
            if (!fs.existsSync(DIRECTIVES_PATH) || fs.readFileSync(DIRECTIVES_PATH, 'utf8') !== nextDirectives) {
                fs.writeFileSync(DIRECTIVES_PATH, nextDirectives, 'utf8');
            }
            fs.writeFileSync(STATE_PATH, JSON.stringify(runtime, null, 2), 'utf8');
        } catch (e) {
            console.error('[ChiefOfStaff] 상태 저장 실패:', e.message);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 0. 대표님 지시 이행 & 기억 (모두 되돌릴 수 있음)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * 질의가 아니라 "처리했다/알림 꺼/기억해" 같은 지시인지 판별 (텔레그램 라우팅에서 최우선 처리)
     */
    isInstruction(text = '') {
        return /(알림|경보|보고|알려).{0,12}(끄|꺼|그만|하지 ?마|안 ?해도|필요 ?없|빼|제외|중지|멈춰|다시|켜)|(해결|완료|처리|매칭|확인|조치)\s?(했|됐|완료|끝)|기억해|잊어|메모해|앞으로|해제해|무시해|재개/.test(text);
    }

    activeMutes() {
        const now = Date.now();
        return this.state.mutes.filter(m => !m.until || Date.parse(m.until) > now);
    }

    muteMatches(mute, issue) {
        const k = String(mute.match || '').toLowerCase();
        return !!k && [issue.key, issue.text, issue.owner, issue.deptName].some(v => String(v || '').toLowerCase().includes(k));
    }

    logAction(type, detail) {
        const entry = { at: new Date().toISOString(), type, ...detail };
        this.state.actions = [entry, ...this.state.actions].slice(0, 100);
        this.saveState();
        this.updateAgentLog(CHIEF_CODE, `[대표 지시 이행] ${type} ${detail.ref || detail.match || detail.text || detail.id || ''}`.slice(0, 80));
        return entry;
    }

    resolveMissingCert(ref, note = '대표님 텔레그램 확인') {
        const target = String(ref || '').trim();
        const alerts = readJson(QC_MISSING_ALERTS_PATH, []);
        const hits = alerts.filter(a => (a.poNo || a.outboundNo) === target);
        if (!target || hits.length === 0) {
            const openRefs = getMissingCertDetails().items.map(i => i.ref);
            return { ok: false, error: `누락 경보에 없는 번호: ${target || '(미지정)'}`, openRefs };
        }

        const at = new Date().toISOString();
        for (const a of hits) Object.assign(a, { resolved: true, resolvedAt: at, resolvedBy: 'CEO(telegram)', resolutionNote: note });
        fs.writeFileSync(QC_MISSING_ALERTS_PATH, JSON.stringify(alerts, null, 2), 'utf8');
        this.state.resolutions[target] = { at, note, kind: 'MISSING_CERT' };
        this.logAction('resolve', { ref: target, note });
        this.updateAgentLog('QC-13', `[대표 확인 종결] ${target} 성적서 누락 경보 해제 (${note})`);

        // 지시는 이행하되 데이터가 아직 따라오지 않았으면 사실대로 알림
        const masterMatchedNow = readJson(PURCHASE_QC_MATCHES_PATH, []).filter(o => o.poNumber === target).reduce((s, o) => s + (o.certMatchCount || 0), 0);
        return { ok: true, ref: target, alertsClosed: hits.length, masterMatchedNow, note: masterMatchedNow === 0 ? '성적서 마스터 HEAT/LOT 매칭은 아직 0건 (데이터 미반영). 이 건은 재감지돼도 알리지 않음.' : '마스터 매칭 반영 확인' };
    }

    reopenMissingCert(ref) {
        const target = String(ref || '').trim();
        if (!this.state.resolutions[target]) return { ok: false, error: `해결 처리된 기록 없음: ${target}` };
        const alerts = readJson(QC_MISSING_ALERTS_PATH, []);
        for (const a of alerts.filter(a => (a.poNo || a.outboundNo) === target)) {
            a.resolved = false;
            delete a.resolvedAt; delete a.resolvedBy; delete a.resolutionNote;
        }
        fs.writeFileSync(QC_MISSING_ALERTS_PATH, JSON.stringify(alerts, null, 2), 'utf8');
        delete this.state.resolutions[target];
        this.logAction('reopen', { ref: target });
        return { ok: true, ref: target };
    }

    addMute(match, { reason = '', days = null } = {}) {
        const m = String(match || '').trim();
        if (m.length < 2) return { ok: false, error: '음소거 키워드는 2자 이상 (예: PUR-07, 과부하, 성적서)' };
        const id = (this.state.mutes.reduce((mx, x) => Math.max(mx, x.id), 0) || 0) + 1;
        const until = days ? new Date(Date.now() + Number(days) * 864e5).toISOString() : null;
        const mute = { id, match: m, reason, at: new Date().toISOString(), until };
        this.state.mutes.push(mute);
        this.logAction('mute', { match: m, reason, until });
        const affected = this.collectSituation().mutedCount;
        return { ok: true, ...mute, currentlyMutedIssues: affected };
    }

    removeMute(idOrMatch) {
        const key = String(idOrMatch ?? '').trim();
        const before = this.state.mutes.length;
        this.state.mutes = this.state.mutes.filter(m => String(m.id) !== key && m.match !== key);
        if (this.state.mutes.length === before) return { ok: false, error: `음소거 없음: ${key}`, mutes: this.activeMutes() };
        this.logAction('unmute', { match: key });
        return { ok: true, removed: key };
    }

    remember(text) {
        const t = String(text || '').trim();
        if (!t) return { ok: false, error: '기억할 내용 없음' };
        const id = (this.state.memories.reduce((mx, x) => Math.max(mx, x.id), 0) || 0) + 1;
        const memo = { id, text: t.slice(0, 300), at: new Date().toISOString() };
        this.state.memories.push(memo);
        this.logAction('remember', { id, text: memo.text });
        return { ok: true, ...memo };
    }

    forget(id) {
        const before = this.state.memories.length;
        this.state.memories = this.state.memories.filter(m => String(m.id) !== String(id));
        if (this.state.memories.length === before) return { ok: false, error: `기억 없음: #${id}`, memories: this.state.memories };
        this.logAction('forget', { id });
        return { ok: true, removed: Number(id) };
    }

    /**
     * 최근 대화 기록 (6시간 지난 대화는 문맥에서 제외)
     */
    recordTurn(role, content) {
        const plain = String(content || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        this.state.conversation = [...this.state.conversation, { role, content: plain.slice(0, 1500), at: new Date().toISOString() }].slice(-12);
        this.saveState();
    }

    recentConversation() {
        return this.state.conversation.filter(c => (hoursSince(c.at) ?? 99) < 6).map(({ role, content }) => ({ role, content }));
    }

    formatDirectives() {
        const lines = ['🗂 <b>대표님 지시 현황</b>'];
        const mems = this.state.memories;
        const mutes = this.activeMutes();
        const res = Object.entries(this.state.resolutions);
        lines.push(`<b>기억 ${mems.length}</b>`, ...(mems.length ? mems.map(m => `#${m.id} ${esc(m.text)}`) : ['없음']));
        lines.push(`<b>음소거 ${mutes.length}</b>`, ...(mutes.length ? mutes.map(m => `#${m.id} "${esc(m.match)}"${m.until ? ` ~${ymd(m.until)}` : ' (무기한)'}${m.reason ? ` · ${esc(m.reason)}` : ''}`) : ['없음']));
        lines.push(`<b>해결 처리 ${res.length}</b>`, ...(res.length ? res.map(([ref, r]) => `<code>${esc(ref)}</code> ${ymd(r.at)} · ${esc(r.note)}`) : ['없음']));
        return lines.join('\n');
    }

    /**
     * LLM 없이도 동작하는 정형 지시 명령
     */
    handleDirectiveCommand(t) {
        let m;
        if (/^(지시|지시사항|기억|메모)( ?(목록|현황))?$/.test(t)) return this.formatDirectives();
        if ((m = t.match(/^(기억|메모) (.+)$/))) {
            const r = this.remember(m[2]);
            return r.ok ? `🧠 기억 #${r.id}: ${esc(r.text)}` : `❌ ${esc(r.error)}`;
        }
        if ((m = t.match(/^잊어 ?#?(\d+)$/))) {
            const r = this.forget(m[1]);
            return r.ok ? `🗑 기억 #${m[1]} 삭제.` : `❌ ${esc(r.error)}`;
        }
        if ((m = t.match(/^음소거 ?해제 (.+)$/))) {
            const r = this.removeMute(m[1].replace(/^#/, ''));
            return r.ok ? `🔔 음소거 해제: ${esc(m[1])}` : `❌ ${esc(r.error)}`;
        }
        if ((m = t.match(/^음소거 (.+?)(?: (\d+)일?)?$/))) {
            const r = this.addMute(m[1], { days: m[2] ? Number(m[2]) : null });
            return r.ok ? `🔕 "${esc(r.match)}" 알림 끔${r.until ? ` (~${ymd(r.until)})` : ' (무기한)'} · 해당 이슈 ${r.currentlyMutedIssues}건` : `❌ ${esc(r.error)}`;
        }
        if ((m = t.match(/^(해결|종결) (.+)$/))) {
            const r = this.resolveMissingCert(m[2]);
            return r.ok
                ? `✅ <code>${esc(r.ref)}</code> 성적서 누락 종결 (경보 ${r.alertsClosed}건). 재알림 안 함.${r.masterMatchedNow === 0 ? '\n⚠️ 마스터 HEAT/LOT 매칭은 아직 0건. 데이터 반영은 QC-02 확인 필요.' : ''}`
                : `❌ ${esc(r.error)}${r.openRefs?.length ? `\n열린 건: ${r.openRefs.map(x => `<code>${esc(x)}</code>`).join(', ')}` : ''}`;
        }
        if ((m = t.match(/^(재개|다시 ?열기) (.+)$/))) {
            const r = this.reopenMissingCert(m[2]);
            return r.ok ? `↩️ <code>${esc(r.ref)}</code> 누락 경보 재개.` : `❌ ${esc(r.error)}`;
        }
        return null;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 수집 & 판정
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * 봇이 마지막으로 "실제로 움직인" 시각.
     * 기존 서비스들은 lastActive 를 항상 '방금 전'으로만 기록하므로, 로그·처리건수·현재업무의
     * 지문(fingerprint)이 바뀐 시점을 비서실장이 직접 관측해 하트비트로 사용한다.
     */
    observeHeartbeat(agent) {
        const fp = `${agent.logs?.[0] || ''}|${agent.metrics?.tasksToday ?? ''}|${agent.currentTask || ''}`;
        const hb = this.state.heartbeats[agent.code];
        if (!hb || hb.fp !== fp) {
            this.state.heartbeats[agent.code] = { fp, seenAt: new Date().toISOString() };
        }
        const seenAt = this.state.heartbeats[agent.code].seenAt;
        if (agent.lastActiveAt && Date.parse(agent.lastActiveAt) > Date.parse(seenAt)) return agent.lastActiveAt;
        return seenAt;
    }

    /**
     * 모든 봇 공통 헬스체크 (부서 무관 → 신규 봇 자동 적용)
     */
    auditAgent(agent) {
        const issues = [];
        const tag = `${agent.code} ${agent.name}`;

        if (STOPPED_STATES.has(agent.status)) {
            issues.push({ key: `bot:stopped:${agent.code}`, sev: SEV.INFO, owner: agent.code, text: `${tag} 정지(${agent.status})` });
            return issues; // 정지 봇은 나머지 판정 불필요
        }
        if (agent.approvalStatus === 'PENDING') {
            issues.push({ key: `bot:approval:${agent.code}`, sev: SEV.WARN, owner: agent.code, text: `${tag} 결재 대기` });
        }
        const lastLog = agent.logs?.[0] || '';
        if (ERROR_LOG_RE.test(lastLog)) {
            issues.push({ key: `bot:error:${agent.code}:${lastLog.slice(0, 40)}`, sev: SEV.WARN, owner: agent.code, text: `${agent.code} 오류: ${lastLog.replace(/^\[[^\]]*\]\s*/, '').slice(0, 50)}` });
        }
        const intervalH = INTERVAL_HOURS[agent.scheduleInterval];
        const silentH = hoursSince(agent.lastSeenAt);
        if (intervalH && silentH !== null && silentH > Math.max(3, intervalH * 3)) {
            issues.push({ key: `bot:silent:${agent.code}`, sev: SEV.WARN, owner: agent.code, text: `${tag} ${Math.round(silentH)}시간 무응답 (주기 ${agent.scheduleInterval})` });
        }
        if ((agent.metrics?.load ?? 0) >= 90) {
            issues.push({ key: `bot:load:${agent.code}`, sev: SEV.WARN, owner: agent.code, text: `${tag} 과부하 ${agent.metrics.load}%` });
        }
        return issues;
    }

    /**
     * 📊 전사 상황판: 부서별 봇 가동 + 업무 KPI + 이슈(심각도순)
     */
    collectSituation() {
        const agents = readJson(AGENTS_PATH, []).filter(a => a.isCreated !== false && a.code !== CHIEF_CODE);
        const deptList = readJson(DEPARTMENTS_PATH, []);

        // departments.json 에 없는 deptId 를 가진 신규 봇도 누락 없이 부서로 편입
        const known = new Set(deptList.map(d => d.id));
        for (const a of agents) {
            if (a.deptId && !known.has(a.deptId)) {
                deptList.push({ id: a.deptId, name: a.deptName || a.deptId, code: (a.code || '').split('-')[0], icon: '🏢' });
                known.add(a.deptId);
            }
        }

        for (const a of agents) a.lastSeenAt = this.observeHeartbeat(a);
        this.saveState();

        const depts = deptList.map(dept => {
            const members = agents.filter(a => a.deptId === dept.id);
            const botIssues = members.flatMap(a => this.auditAgent(a));
            let probe = { kpis: [], issues: [] };
            const probeFn = this.probes.get(dept.id);
            if (probeFn) {
                try {
                    probe = probeFn() || probe;
                } catch (e) {
                    probe.issues = [{ key: `probe:${dept.id}`, sev: SEV.WARN, text: `${dept.name} 지표 수집 오류: ${e.message}` }];
                }
            }
            const issues = [...(probe.issues || []), ...botIssues]
                .map(i => ({ ...i, deptId: dept.id, deptName: dept.name }))
                .sort((a, b) => b.sev - a.sev);
            return {
                id: dept.id,
                name: dept.name,
                code: dept.code,
                icon: dept.icon || '🏢',
                total: members.length,
                active: members.filter(a => a.status === 'ACTIVE' || a.status === 'STANDBY').length,
                stopped: members.filter(a => STOPPED_STATES.has(a.status)).length,
                kpis: probe.kpis || [],
                issues,
                members
            };
        }).filter(d => d.total > 0 || d.issues.length > 0);

        // 대표님이 끈 알림은 보고·경보에서 제외 (건수만 표시)
        const mutes = this.activeMutes();
        let mutedCount = 0;
        for (const d of depts) {
            const kept = d.issues.filter(i => !mutes.some(m => this.muteMatches(m, i)));
            mutedCount += d.issues.length - kept.length;
            d.issues = kept;
        }

        const issues = depts.flatMap(d => d.issues).sort((a, b) => b.sev - a.sev);
        return {
            mutedCount,
            at: kstStamp(),
            depts,
            agents,
            issues,
            total: agents.length,
            active: depts.reduce((s, d) => s + d.active, 0),
            stopped: depts.reduce((s, d) => s + d.stopped, 0),
            crit: issues.filter(i => i.sev === SEV.CRIT).length,
            warn: issues.filter(i => i.sev === SEV.WARN).length
        };
    }

    resolveDept(sit, word) {
        const w = word.trim();
        if (w.length < 2) return null;
        const upper = w.toUpperCase();
        return sit.depts.find(d => {
            const short = shortDept(d.name);
            return d.id === w.toLowerCase() || d.code === upper || d.name === w || short.includes(w) || w.includes(short)
                || d.members.some(a => (a.code || '').split('-')[0] === upper);
        }) || null;
    }

    findAgent(code) {
        const c = code.trim().toUpperCase();
        return readJson(AGENTS_PATH, []).find(a => a.code?.toUpperCase() === c) || null;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 보고 포맷 (텔레그램 HTML, 결론 먼저 · 예외만)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    issueLine(i, withDept = true) {
        const dept = withDept ? `${esc(shortDept(i.deptName))} | ` : '';
        const owner = i.owner ? ` → <code>${esc(i.owner)}</code>` : '';
        return `${SEV_ICON[i.sev]} ${dept}${esc(i.text)}${owner}`;
    }

    verdict(crit, warn) {
        return crit ? '🔴' : warn ? '🟡' : '🟢';
    }

    formatBrief(sit = this.collectSituation()) {
        const visible = sit.issues.filter(i => i.sev >= SEV.WARN);
        const lines = [
            `${this.verdict(sit.crit, sit.warn)} <b>전사 보고</b> ${sit.at}`,
            `봇 ${sit.active}/${sit.total} 가동${sit.stopped ? ` · 정지 ${sit.stopped}` : ''} · 🔴${sit.crit} 🟡${sit.warn}${sit.mutedCount ? ` · 🔕${sit.mutedCount}` : ''}`
        ];
        if (visible.length === 0) {
            lines.push('특이사항 없음.');
        } else {
            lines.push('', ...visible.slice(0, MAX_BRIEF_ISSUES).map(i => this.issueLine(i)));
            if (visible.length > MAX_BRIEF_ISSUES) lines.push(`외 ${visible.length - MAX_BRIEF_ISSUES}건 → /이슈`);
        }
        return lines.join('\n');
    }

    formatIssues(sit = this.collectSituation()) {
        const visible = sit.issues.filter(i => i.sev >= SEV.WARN);
        if (visible.length === 0) return `🟢 <b>이슈 없음</b> ${sit.at}`;
        return [`${this.verdict(sit.crit, sit.warn)} <b>전체 이슈 ${visible.length}건</b> ${sit.at}`, ...visible.slice(0, 20).map(i => this.issueLine(i))].join('\n');
    }

    formatDept(dept) {
        const crit = dept.issues.filter(i => i.sev === SEV.CRIT).length;
        const warn = dept.issues.filter(i => i.sev === SEV.WARN).length;
        const lines = [`${this.verdict(crit, warn)} ${dept.icon} <b>${esc(dept.name)}</b> 봇 ${dept.active}/${dept.total}${dept.stopped ? ` · 정지 ${dept.stopped}` : ''}`];
        if (dept.kpis.length) lines.push(esc(dept.kpis.join(' · ')));
        const shown = dept.issues.filter(i => i.sev >= SEV.WARN || i.key.startsWith('bot:stopped'));
        lines.push(...(shown.length ? shown.slice(0, 6).map(i => this.issueLine(i, false)) : ['특이사항 없음.']));
        return lines.join('\n');
    }

    formatAgent(agent, sit) {
        const seen = sit.agents.find(a => a.code === agent.code)?.lastSeenAt || agent.lastActiveAt;
        const issues = agent.code === CHIEF_CODE ? [] : this.auditAgent({ ...agent, lastSeenAt: seen });
        const icon = issues.some(i => i.sev >= SEV.WARN) ? '🟡' : STOPPED_STATES.has(agent.status) ? '⏸️' : '🟢';
        const lines = [
            `${icon} <b>${esc(agent.code)}</b> ${esc(agent.name)} (${esc(agent.deptName || agent.deptId)}·${esc(agent.position || '-')})`,
            `${esc(agent.status)} · 최근 활동 ${ago(seen)} · 금일 ${agent.metrics?.tasksToday ?? 0}건`,
            `업무: ${esc((agent.currentTask || '대기').slice(0, 60))}`
        ];
        if (agent.logs?.[0]) lines.push(`최근: ${esc(agent.logs[0].slice(0, 70))}`);
        lines.push(...issues.filter(i => i.sev >= SEV.WARN).map(i => this.issueLine(i, false)));
        return lines.join('\n');
    }

    formatHelp() {
        return [
            '<b>🎩 비서실장 명령</b>',
            '<code>/보고</code> 전사 요약 · <code>/이슈</code> 전체 이슈',
            '부서명(예: <code>구매</code>) · 봇코드(예: <code>PUR-04</code>)',
            '<code>누락</code> 성적서 누락 발주번호·품목 전체',
            '<code>상세 품질</code> 부서 봇 전체 목록',
            '<code>/알림 on|off</code> 긴급 자동경보',
            '<code>/해결 발주번호</code> · <code>/음소거 키워드 [일수]</code> · <code>/기억 내용</code> · <code>/잊어 번호</code> · <code>/지시</code> 기억·음소거 목록',
            '"성적서 매칭했으니 알림 그만" 처럼 말로 지시해도 이행합니다.',
            '그 외는 자연어로 질문하세요. "자세히"라고 하면 원장 수준으로 답합니다.'
        ].join('\n');
    }

    /**
     * 🔬 성적서 누락 상세 (발주번호·거래처·품목·수량·발행이력) - 전화 확인용
     */
    formatMissingCerts(detail = getMissingCertDetails()) {
        const { items, excludedTests, mergedDuplicates } = detail;
        const notes = [excludedTests && `테스트 ${excludedTests}건`, mergedDuplicates && `중복 ${mergedDuplicates}건`].filter(Boolean).join('·');
        if (items.length === 0) return `🟢 <b>성적서 누락 없음</b> ${kstStamp()}${notes ? `\n(제외: ${notes})` : ''}`;

        const blocks = [`🟡 <b>성적서 누락 ${items.length}건</b> ${kstStamp()}${notes ? ` (제외: ${notes})` : ''}`];
        items.forEach((a, idx) => {
            const lines = [
                '',
                `<b>${idx + 1}. ${esc(a.ref)}</b> · ${esc(a.customer)}${a.alertCustomer && a.alertCustomer !== a.customer ? ` (경보표기: ${esc(a.alertCustomer)})` : ''}`,
                `${a.kind} ${ymd(a.orderDate)}${a.orderId ? ` · 주문 <code>${esc(a.orderId)}</code>` : ''}`,
                `누락 <b>${a.missingCount}/${a.totalItems}라인</b>${a.totalQty ? ` · ${a.totalQty.toLocaleString()}EA` : ''}${a.totalAmount ? ` · ${won(a.totalAmount)}` : ''} · 감지 ${ymd(a.detectedAt)} (${ago(a.detectedAt)})`
            ];
            if (a.request) lines.push(`요청사항: ${esc(a.request)}`);
            if (a.issuedCerts.length) {
                const certItems = a.issuedCerts.reduce((s, c) => s + (c.itemCount || 0), 0);
                lines.push(`⚠️ 발행이력 있음: <code>${esc(compactCertNos(a.issuedCerts.map(c => c.certNo)))}</code> (${ymd(a.issuedCerts[0].issuedAt)}, ${certItems}품목) · 마스터 HEAT/LOT 매칭 ${a.masterMatched}건`);
            }
            lines.push('품목:');
            lines.push(...a.missing.map(m => `${m.no}. ${esc(m.item)}${m.qty != null ? ` ×${m.qty}` : ''}${m.lot ? ` LOT ${esc(m.lot)}` : ''}`));
            lines.push(`🔎 원인: ${esc(a.diagnosis.cause)}`);
            lines.push(`☎ 조치: ${esc(a.diagnosis.action)} → <code>${a.diagnosis.owner}</code>`);
            blocks.push(...lines);
        });
        return blocks.join('\n');
    }

    /**
     * 정형 명령 처리. 해당 없으면 null (→ 자연어 질의로 넘어감)
     */
    handleCommand(text = '') {
        const t = text.trim().replace(/^\//, '').replace(/\s+/g, ' ').replace(/[?？!.]+$/, '');
        if (!t) return null;

        if (/^(help|도움말?|명령어?)$/i.test(t)) return this.formatHelp();

        const directive = this.handleDirectiveCommand(t);
        if (directive) return directive;

        const alertMatch = t.match(/^알림 ?(on|off|켜기?|끄기|꺼)$/i);
        if (alertMatch) {
            this.state.alertsEnabled = /on|켜/i.test(alertMatch[1]);
            this.saveState();
            return this.state.alertsEnabled ? '🔔 긴급 자동경보 켜짐.' : '🔕 긴급 자동경보 꺼짐. 정기 브리핑은 유지.';
        }

        if (/^(보고|브리핑|brief|status|agents|staff|현황|요약|전체 ?(현황|보고|상태)?|(직원|봇|에이전트)들? ?(상태|현황)?|업무현황|근무현황)( ?(해줘|줘|확인|확인해줘|알려줘))?$/i.test(t)) {
            return this.formatBrief();
        }
        if (/^(이슈|issues?|문제|이상|경보)( ?(목록|전체|확인|있어))?$/i.test(t)) {
            return this.formatIssues();
        }
        // "누락", "성적서 누락 4건 발주번호 알려줘" 등 → 전화 확인 가능한 상세 목록
        // 단, 원인·해결 질문은 GPT 가 원장을 조회해 판단하도록 넘김
        if (/누락/.test(t) && (/성적서|mtc|cert/i.test(t) || t.length <= 12) && !/왜|원인|이유|어떻게|해결|대책|누구/.test(t) && !this.isInstruction(t)) {
            return this.formatMissingCerts();
        }

        const sit = this.collectSituation();
        if (/^[A-Z]{2,4}-[A-Z0-9]{1,4}$/i.test(t)) {
            const agent = this.findAgent(t);
            return agent ? this.formatAgent(agent, sit) : `❓ <code>${esc(t.toUpperCase())}</code> 봇 없음.`;
        }

        // "구매", "품질부 상태", "데이터팀 어때" 처럼 짧은 부서 질의만 처리 (긴 문장은 자연어로)
        const deptWord = t.replace(/ ?(상태|현황|보고|어때|어때요|은|는)$/,'').trim();
        if (deptWord.length <= 8) {
            const dept = this.resolveDept(sit, deptWord);
            if (dept) return this.formatDept(dept);
        }
        return null;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 자연어 질의 (LLM 은 표현만, 사실은 상황판에서)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    toLLMContext(sit) {
        const lines = [`[현황 ${sit.at} KST] 봇 ${sit.active}/${sit.total} 가동, 정지 ${sit.stopped}, 🔴${sit.crit} 🟡${sit.warn}`];
        for (const d of sit.depts) {
            const iss = d.issues.filter(i => i.sev >= SEV.WARN).slice(0, 6).map(i => `${SEV_ICON[i.sev]}${i.text}${i.owner ? `→${i.owner}` : ''}`).join('; ');
            lines.push(`[${d.name}] 봇 ${d.active}/${d.total} | ${d.kpis.join(' · ') || '지표 없음'} | ${iss || '이슈 없음'}`);
        }

        const pending = readJson(PENDING_ANALYSIS_PATH, null);
        const fmtItem = (it) => `${it.customerName || it.deliveryTo || it.customer || '미지정'} ${`${it.itemName || ''} ${it.size || ''} ${it.material || ''}`.trim()} PO:${it.orderNo || it.poNo || '-'}`;
        const board = pending?.priorityBoard;
        if (board) {
            lines.push(`[미결 확인순서] 실지연 ${board.actualDelayedCount} → 필수확인P1 ${board.counts.P1} → 독촉P2 ${board.counts.P2} → 예상문제P3 ${board.counts.P3}`);
            if (board.mustCheckItems?.length) {
                lines.push(`[필수확인 Top3] ${board.mustCheckItems.slice(0, 3).map(it => `${fmtItem(it)} (${it.priorityReason})`).join(' / ')}`);
            }
            if (board.forecastRiskItems?.length) {
                lines.push(`[예상문제 Top3] ${board.forecastRiskItems.slice(0, 3).map(it => `${fmtItem(it)} (${it.priorityReason})`).join(' / ')}`);
            }
        } else if (pending?.criticalDueRiskItems?.length) {
            lines.push(`[납기위험 Top3] ${pending.criticalDueRiskItems.slice(0, 3).map(it => `${fmtItem(it)} (${it.alertReason || '납기위험'}, ${Math.abs(it.remainingCustomerDays ?? it.elapsedDays ?? 0)}일)`).join(' / ')}`);
        }
        if (pending?.longestStagnantItems?.length) {
            lines.push(`[장기정체 Top3] ${pending.longestStagnantItems.slice(0, 3).map(it => `${fmtItem(it)} 공정:${it.stage || it.stageName || '-'} ${it.elapsedDays || it.stagnantDays || 0}일`).join(' / ')}`);
        }

        const invs = readJson(SUPPLIER_INVOICES_PATH, []);
        const lastInv = invs[invs.length - 1];
        if (lastInv) lines.push(`[최근 매입전표] No.${lastInv.invoiceNo} ${lastInv.customerName || ''} ${won(lastInv.pricing?.grandTotal || 0)} (${lastInv.invoiceDate || '-'})`);

        lines.push(`[봇 목록] ${sit.agents.map(a => `${a.code}:${a.name}(${a.status})`).join(', ')}`);

        const mems = this.state.memories.map(m => `#${m.id} ${m.text}`).join(' / ');
        const mutes = this.activeMutes().map(m => `#${m.id} "${m.match}"${m.until ? `~${ymd(m.until)}` : ''}`).join(', ');
        const res = Object.entries(this.state.resolutions).map(([ref, r]) => `${ref}(${ymd(r.at)} ${r.note})`).join(', ');
        lines.push(`[대표님 상시 지시·기억] ${mems || '없음'}`, `[음소거 중] ${mutes || '없음'} (숨긴 이슈 ${sit.mutedCount}건)`, `[대표님 해결 처리] ${res || '없음'}`);
        return lines.join('\n');
    }

    // ── 읽기 전용 조회 도구 (GPT tool calling 및 규칙 폴백 공용) ──

    lookupPurchaseOrders(query = '') {
        const q = String(query).trim();
        if (!q) return { error: '발주번호 또는 거래처명을 입력하세요.' };
        const rows = readJson(PURCHASE_QC_MATCHES_PATH, []).filter(o =>
            o.poNumber === q || o.orderId === q || (q.length >= 2 && o.customerName?.includes(q)));
        const byPo = new Map();
        for (const o of rows) {
            if (!byPo.has(o.poNumber)) byPo.set(o.poNumber, []);
            byPo.get(o.poNumber).push(o);
        }
        const orders = [...byPo.entries()]
            .sort((a, b) => String(b[1][0].date).localeCompare(String(a[1][0].date)))
            .slice(0, 5)
            .map(([po, ls]) => ({
                poNumber: po,
                orderId: ls[0].orderId,
                customer: ls[0].customerName,
                date: ls[0].date,
                memo: ls[0].memo,
                totalAmount: ls.reduce((s, o) => s + (o.amount || 0), 0),
                lines: ls.slice(0, 40).map(o => ({
                    item: o.productId, qty: o.quantity, pendingQty: o.pendingQty, receivedQty: o.receivedQty,
                    status: o.fulfillmentStatus, certNos: o.certNos, heatNos: o.heatNos
                }))
            }));
        return { matchedPoCount: byPo.size, orders };
    }

    getPendingRisks({ type = 'due_risk', customer = '', limit = 10 } = {}) {
        const pending = readJson(PENDING_ANALYSIS_PATH, null);
        if (!pending) return { error: '미결 분석 데이터 없음' };
        const n = Math.min(Math.max(Number(limit) || 10, 1), 30);
        const match = (v) => !customer || String(v || '').includes(customer);
        if (type === 'orders') {
            return {
                analyzedAt: pending.timestamp,
                orders: (pending.orderAnalyses || []).filter(o => match(o.client)).slice(0, n)
                    .map(({ items, ...o }) => ({ ...o, itemCount: items?.length || 0 }))
            };
        }
        const board = pending.priorityBoard || {};
        const src = type === 'stagnant' ? pending.longestStagnantItems
            : type === 'must_check' ? board.mustCheckItems
            : type === 'forecast' ? board.forecastRiskItems
            : pending.criticalDueRiskItems;
        const keys = ['orderNo', 'customerName', 'deliveryTo', 'itemName', 'size', 'thickness', 'material', 'orderQty', 'remainQty',
            'lotNo', 'stage', 'progressPct', 'poDate', 'elapsedDays', 'customerDueDate', 'remainingCustomerDays', 'customerReq', 'alertReason',
            'priority', 'priorityReason', 'delayDays', 'remainingProductionDays', 'expectedSlipDays'];
        return {
            analyzedAt: pending.timestamp,
            summary: pending.summary,
            items: (src || []).filter(it => match(it.customerName) || match(it.deliveryTo)).slice(0, n)
                .map(it => Object.fromEntries(keys.filter(k => it[k] !== undefined && it[k] !== '').map(k => [k, it[k]])))
        };
    }

    getQueue(source) {
        const pick = (arr, keys, n = 20) => arr.slice(0, n).map(x => Object.fromEntries(keys.map(k => [k, x[k]])));
        switch (source) {
            case 'dispatch': return pick(readJson(DISPATCH_QUEUE_PATH, []), ['id', 'channel', 'subject', 'kind', 'status', 'enqueuedAt', 'enqueuedBy', 'sentAt']);
            case 'kakao_orders': return pick(readJson(KAKAO_ORDERS_PATH, []), ['orderNo', 'customerName', 'phone', 'status', 'receivedAt', 'utterance', 'items', 'totalAmount', 'assignedAgents']);
            case 'kakao_quotes': return pick(readJson(KAKAO_QUOTES_PATH, []), ['id', 'customerName', 'customerInfo', 'status', 'createdAt', 'items']);
            case 'make_connections': return readJson(MAKE_CONNECTIONS_PATH, []);
            case 'supplier_invoices': return pick(readJson(SUPPLIER_INVOICES_PATH, []).slice(-15).reverse(), ['invoiceNo', 'invoiceDate', 'customerName', 'poNumbers', 'pricing']);
            default: return { error: `알 수 없는 source: ${source}` };
        }
    }

    getToolDefinitions() {
        const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
        return [
            fn('get_missing_certificates', '성적서 누락 경보 상세: 발주/출고번호, 거래처, 주문ID, 누락 품목별 수량·LOT, 기존 발행이력. 테스트·중복 경보는 제외됨.'),
            fn('get_purchase_order', 'ALTF 발주 원장: 발주번호(ES260709-1974, PO-...) 또는 거래처명으로 품목 라인별 수량, 미입고 수량, 성적서 매칭 상태 조회', { query: { type: 'string' } }, ['query']),
            fn('get_pending_risks', '대경 생산 미결 분석. 납기·미결·지연·급한 발주·독촉 질문은 반드시 먼저 type=orders 로 조회할 것 (발주서별 거래처, 고객납기, 미결관리팀 우선순위 priority(P1 필수확인→P2 지연·임박 독촉→P3 예상 문제→P4 모니터링) 순 정렬, P1건수·최대 지연일·최저 진행률, 권장조치). 답변도 이 순서로: P1(지연/임박인데 공정진행률 저조, 반드시 확인) 먼저, P3(잔여 공정일수 > 남은 납기, 사전 예방)는 후순위로 덧붙임. 품목 단위 상세는 must_check(P1)/forecast(P3)/due_risk(납기위험)/stagnant(장기정체). 발주서 품목 라인이 더 필요하면 get_purchase_order 추가 조회.', {
                type: { type: 'string', enum: ['orders', 'must_check', 'forecast', 'due_risk', 'stagnant'] },
                customer: { type: 'string', description: '거래처명 필터(선택)' },
                limit: { type: 'integer' }
            }),
            fn('get_agent', '봇 코드(예: PUR-04)로 상태, 현재업무, 최근 로그 10건 조회', { code: { type: 'string' } }, ['code']),
            fn('get_department', '부서명(구매, 품질, 영업, 출고, 총무, 관제, 데이터 등)으로 KPI·이슈·소속 봇 상태 조회', { name: { type: 'string' } }, ['name']),
            fn('get_queue', '대기열·원장 조회', { source: { type: 'string', enum: ['dispatch', 'kakao_orders', 'kakao_quotes', 'make_connections', 'supplier_invoices'] } }, ['source']),

            // ── 대표님 지시 이행 (쓰기, 모두 되돌릴 수 있음) ──
            fn('resolve_missing_certificate', '[지시] 대표님이 성적서 누락 건을 처리/매칭/확인했다고 할 때 해당 발주·출고번호의 누락 경보를 종결하고 재알림을 영구 중지. 번호를 모르면 먼저 get_missing_certificates 로 열린 건을 확인. 열린 건이 1건이고 대상이 명백할 때만 실행, 모호하면 실행하지 말고 되물을 것.', {
                ref: { type: 'string', description: '발주번호 또는 출고번호 (예: ES260709-1974)' },
                note: { type: 'string', description: '대표님 지시 요지 (예: 대표님 성적서 매칭 완료)' }
            }, ['ref']),
            fn('reopen_missing_certificate', '[지시] 종결 처리했던 성적서 누락 건을 다시 열어 알림 재개', { ref: { type: 'string' } }, ['ref']),
            fn('mute_alert', '[지시] 특정 이슈의 보고·알림을 끔 (데이터는 그대로). 이슈 문구·봇코드·부서명에 포함되는 키워드로 지정', {
                keyword: { type: 'string', description: '예: PUR-07, 과부하, 납기위험' },
                reason: { type: 'string' },
                days: { type: 'integer', description: '기간(일). 생략 시 무기한' }
            }, ['keyword']),
            fn('unmute_alert', '[지시] 음소거 해제 (음소거 번호 또는 키워드)', { id_or_keyword: { type: 'string' } }, ['id_or_keyword']),
            fn('remember', '[지시] 대표님의 상시 지시·선호를 장기 기억 (예: "월드윈 건은 내가 직접 처리", "보고는 숫자 위주로")', { text: { type: 'string' } }, ['text']),
            fn('forget', '[지시] 장기 기억 삭제 (기억 번호)', { id: { type: 'integer' } }, ['id'])
        ];
    }

    runTool(name, args = {}, sit = this.collectSituation()) {
        switch (name) {
            case 'get_missing_certificates': return getMissingCertDetails();
            case 'get_purchase_order': return this.lookupPurchaseOrders(args.query);
            case 'get_pending_risks': return this.getPendingRisks(args);
            case 'get_agent': {
                const a = this.findAgent(String(args.code || ''));
                if (!a) return { error: `봇 없음: ${args.code}` };
                const { id, code, name: n, deptName, teamName, position, roleType, role, status, approvalStatus, scheduleInterval, currentTask, metrics, logs, subDeptIds } = a;
                const supervisor = readJson(AGENTS_PATH, []).find(x => x.id === a.supervisorId);
                return { id, code, name: n, deptName, teamName, position, roleType, reportsTo: supervisor ? `${supervisor.code} ${supervisor.name}` : null, subDeptIds, role, status, approvalStatus, scheduleInterval, currentTask, metrics, logs, lastSeenAt: sit.agents.find(x => x.code === code)?.lastSeenAt };
            }
            case 'get_department': {
                const d = this.resolveDept(sit, String(args.name || ''));
                if (!d) return { error: `부서 없음: ${args.name}` };
                return { name: d.name, active: d.active, total: d.total, kpis: d.kpis, issues: d.issues.map(({ sev, text, owner }) => ({ sev: SEV_ICON[sev], text, owner })), bots: d.members.map(a => ({ code: a.code, name: a.name, position: a.position, status: a.status, currentTask: a.currentTask, lastLog: a.logs?.[0] })) };
            }
            case 'get_queue': return this.getQueue(args.source);
            case 'resolve_missing_certificate': return this.resolveMissingCert(args.ref, args.note || '대표님 텔레그램 지시');
            case 'reopen_missing_certificate': return this.reopenMissingCert(args.ref);
            case 'mute_alert': return this.addMute(args.keyword, { reason: args.reason || '', days: args.days || null });
            case 'unmute_alert': return this.removeMute(args.id_or_keyword);
            case 'remember': return this.remember(args.text);
            case 'forget': return this.forget(args.id);
            default: return { error: `알 수 없는 도구: ${name}` };
        }
    }

    async timeoutFetch(url, init, ms = 20000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            return await fetch(url, { ...init, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * GPT tool calling 루프: 모델이 필요한 원장을 직접 조회(최대 5라운드)한 뒤 답변
     */
    async callOpenAIWithTools(system, user, sit, history = []) {
        const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: user }];
        const tools = this.getToolDefinitions();
        const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
        // gpt-5 계열(추론 모델)은 temperature 미지원, max_tokens 대신 max_completion_tokens
        const isReasoning = /^(gpt-[5-9]|o\d)/.test(model);
        const tuning = isReasoning
            ? { max_completion_tokens: 6000 }
            : { max_completion_tokens: 2000, temperature: 0.1 };
        for (let round = 0; round < 6; round++) {
            const res = await this.timeoutFetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
                body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', ...tuning })
            }, 45000);
            if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
            const msg = (await res.json()).choices?.[0]?.message;
            if (!msg) return null;
            if (!msg.tool_calls?.length) return msg.content || null;

            messages.push(msg);
            for (const call of msg.tool_calls) {
                let args = {};
                try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* 빈 인자로 조회 */ }
                const result = JSON.stringify(this.runTool(call.function.name, args, sit));
                console.log(`[ChiefOfStaff] 🔧 ${call.function.name}(${call.function.arguments || ''}) → ${result.length}자`);
                messages.push({ role: 'tool', tool_call_id: call.id, content: result.slice(0, 15000) });
            }
        }
        return null;
    }

    /**
     * Gemini 폴백은 도구 없이, 질문 키워드로 관련 원장을 미리 조회해 함께 전달
     */
    prefetchForQuestion(question, sit) {
        const out = [];
        const po = question.match(PO_RE)?.[0];
        if (po) out.push(['get_purchase_order', { query: po }]);
        if (/누락|성적서|mtc/i.test(question)) out.push(['get_missing_certificates', {}]);
        if (/미결|납기|정체|지연|독촉|급한|연락/.test(question)) out.push(['get_pending_risks', { type: 'orders', limit: 10 }]);
        const code = question.match(/\b[A-Z]{2,4}-[A-Z0-9]{1,4}\b/i)?.[0];
        if (code && !po) out.push(['get_agent', { code }]);
        return out.map(([name, args]) => `[${name}]\n${JSON.stringify(this.runTool(name, args, sit)).slice(0, 12000)}`).join('\n\n');
    }

    async callGemini(system, user) {
        const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const res = await this.timeoutFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ parts: [{ text: user }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
            })
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || null;
    }

    /**
     * LLM 출력은 텔레그램 HTML 파싱 실패로 메시지가 통째로 유실될 수 있으므로
     * 전부 이스케이프 후 <b>/<i>/<code> 만 복원, 마크다운 굵게는 <b> 로 변환
     */
    sanitizeLLM(text) {
        return esc(text.trim())
            .replace(/&lt;(\/?)(b|i|code)&gt;/g, '<$1$2>')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/`([^`\n]+)`/g, '<code>$1</code>')
            .replace(/^#+\s*/gm, '');
    }

    /**
     * 규칙 기반 폴백: 발주번호 → 누락 → 봇코드 → 부서명 → 전사 요약 순으로 매칭
     */
    fallbackAnswer(question, sit) {
        // LLM 장애 시 지시: 대상이 명백할 때만 이행 (발주번호 명시 또는 열린 누락 건이 1건)
        if (this.isInstruction(question) && /성적서|누락|매칭|mtc/i.test(question)) {
            const ref = question.match(PO_RE)?.[0] || null;
            const open = getMissingCertDetails().items.map(i => i.ref);
            const target = ref || (open.length === 1 ? open[0] : null);
            if (target) return this.handleDirectiveCommand(`해결 ${target}`);
            if (open.length === 0) {
                const done = Object.keys(this.state.resolutions);
                return `✅ 열린 성적서 누락 건 없음.${done.length ? ` 이미 종결: ${done.map(r => `<code>${esc(r)}</code>`).join(', ')}` : ''}`;
            }
            return `❓ 어느 건인지 지정해 주세요: ${open.map(r => `<code>해결 ${esc(r)}</code>`).join(' · ')}`;
        }
        if (this.isInstruction(question)) {
            return `❓ AI 해석 불가 상태입니다. 정형 명령으로 지시해 주세요:\n<code>/음소거 키워드 [일수]</code> · <code>/기억 내용</code> · <code>/해결 발주번호</code> · <code>/지시</code>`;
        }
        const po = question.match(PO_RE)?.[0];
        if (po) {
            const { orders } = this.lookupPurchaseOrders(po);
            const o = orders?.[0];
            if (o) {
                return [
                    `📋 <b>${esc(o.poNumber)}</b> · ${esc(o.customer)} (${ymd(o.date)}, ${won(o.totalAmount)})`,
                    `주문 <code>${esc(o.orderId)}</code>`,
                    ...o.lines.map((l, i) => `${i + 1}. ${esc(l.item)} ×${l.qty}${l.pendingQty ? ` (미입고 ${l.pendingQty})` : ''} · ${esc(l.status || '-')}`)
                ].join('\n');
            }
        }
        if (/누락/.test(question)) return this.formatMissingCerts();
        if (/미결|납기|급한|독촉|지연|연락/.test(question)) {
            const { orders, analyzedAt } = this.getPendingRisks({ type: 'orders', limit: 5 });
            if (orders?.length) {
                return [`🔴 <b>미결 확인순서 Top ${orders.length}</b> (분석 ${ymd(analyzedAt)})`, ...orders.flatMap((o, i) => [
                    '',
                    `<b>${i + 1}. ${esc(o.orderNo)}</b> · ${esc(o.client)} · ${esc(o.priorityLabel || o.riskLabel || o.riskLevel)}${o.mustCheckCount ? ` ${o.mustCheckCount}건` : ''}`,
                    `고객납기 ${esc(o.customerDueDate || '-')} (${o.remainingDays < 0 ? `${-o.remainingDays}일 초과` : `${o.remainingDays}일 남음`}) · ${o.totalItems}품목/${o.totalQty}EA`,
                    `사유: ${esc(o.priorityReason || o.riskReason || '-')}`,
                    `공정: ${esc(o.mainStage || '-')}`,
                    `조치: ${esc(o.actionItem || '-')} → <code>PUR-04</code>`
                ])].join('\n');
            }
        }
        const code = question.match(/\b[A-Z]{2,4}-[A-Z0-9]{1,4}\b/i)?.[0];
        if (code) {
            const agent = this.findAgent(code);
            if (agent) return this.formatAgent(agent, sit);
        }
        if (/make|인증|크리덴셜|oauth/i.test(question)) {
            const dat = sit.depts.find(d => d.id === 'dat');
            if (dat) return this.formatDept(dat);
        }
        for (const word of question.split(/[\s,.?!]+/).filter(w => w.length >= 2)) {
            const dept = this.resolveDept(sit, word.replace(/(은|는|이|가|의|도)$/, ''));
            if (dept) return this.formatDept(dept);
        }
        return this.formatBrief(sit);
    }

    /**
     * 🧠 텔레그램 질의 진입점 (기존 호출부 호환)
     * @returns {Promise<string>} 텔레그램 HTML 답변
     */
    /**
     * 텔레그램용: 정형 명령이면 즉시 답하고 대화 기록에 남김. 지시 문장은 null (→ askExecutiveAI 로 해석)
     */
    tryCommand(text) {
        const isFormal = /^\/?(해결|종결|재개|다시 ?열기|음소거|기억|메모|잊어|지시)( |$)/.test(text.trim());
        if (this.isInstruction(text) && !isFormal) return null;
        const reply = this.handleCommand(text);
        if (reply) {
            this.recordTurn('user', text);
            this.recordTurn('assistant', reply);
        }
        return reply;
    }

    async askExecutiveAI(userQuestion) {
        const reply = await this.answer(userQuestion);
        this.recordTurn('user', userQuestion);
        this.recordTurn('assistant', reply);
        return reply;
    }

    async answer(userQuestion) {
        const direct = this.handleCommand(userQuestion);
        if (direct) {
            this.updateAgentLog(CHIEF_CODE, `[보고] ${userQuestion.slice(0, 25)}`);
            return direct;
        }

        const sit = this.collectSituation();
        const system = `너는 ALTF 경영총괄부 비서실장(MGT-01, 부장)이다. 전사 모든 부서 봇을 관제하고 대표님께 텔레그램으로 보고한다.
[보고 규칙]
1. 결론 한 줄 먼저. 인사·서론·맺음말·사과·"궁금하신 점" 금지.
2. 일반 질문은 5줄 이내로 간결하게.
3. 대표님이 "자세히/상세/전부/목록/발주번호/어디/누구" 등 구체 정보를 원하면 길이 제한 없이,
   대표님이 바로 전화·지시할 수 있도록 발주번호, 거래처, 고객납기·초과일수, 품목·수량, 진행공정, 권장조치, 담당봇을 빠짐없이 나열한다.
   "외 N건", "등"으로 생략 금지. 품목은 조회된 라인을 전부 쓴다.
4. 상세 정보는 반드시 도구로 조회한 결과만 사용한다. 조회 결과에 없으면 "데이터 없음"이라고 하고 추측 금지.
5. 데이터끼리 모순되면(예: 발행이력은 있는데 누락 경보) 반드시 짚어서 보고한다. 조회 결과에 diagnosis 가 있으면 원인·조치는 그것을 따른다.
   사람 이름·직함·전화번호·이메일은 조회 결과에 있을 때만 쓴다. 없으면 "연락처 데이터 없음".
6. 문제는 "무엇 → 담당봇 → 조치" 순서로.
7. 서식은 <b>, <code> 태그만. 마크다운 금지, 줄머리는 • 또는 번호 사용.
8. 대표님 말이 지시(처리했다/알림 꺼/기억해/다시 알려)이면 [지시] 도구로 즉시 이행하고, 무엇을 했는지 1~3줄로 확인 보고한다.
   대상이 모호하면(후보 2건 이상) 이행하지 말고 후보 목록을 보여주며 되묻는다. 이전 대화의 "그거/그 건"은 대화 기록으로 판단한다.
   지시와 데이터가 어긋나면(예: 매칭했다는데 마스터 매칭 0건) 이행은 하되 그 사실을 한 줄로 함께 알린다.
   도구 없이 이행했다고 말하는 것 금지.
9. [대표님 상시 지시·기억]은 항상 지킨다.`;
        const user = `${this.toLLMContext(sit)}\n\n[대표님 질문]\n${userQuestion}`;

        let reply = null;
        let engine = '규칙';
        if (process.env.OPENAI_API_KEY) {
            try {
                reply = await this.callOpenAIWithTools(system, user, sit, this.recentConversation());
                engine = 'GPT';
            } catch (err) {
                console.warn('[ChiefOfStaff] OpenAI 실패, Gemini 폴백:', err.message);
            }
        }
        if (!reply && process.env.GEMINI_API_KEY) {
            try {
                const prefetched = this.prefetchForQuestion(userQuestion, sit);
                reply = await this.callGemini(system, prefetched ? `${user}\n\n[조회 결과]\n${prefetched}` : user);
                engine = 'Gemini';
            } catch (err) {
                console.warn('[ChiefOfStaff] Gemini 실패:', err.message);
            }
        }

        this.updateAgentLog(CHIEF_CODE, `[${reply ? engine : '규칙'} 답변] ${userQuestion.slice(0, 25)}`);
        return reply ? this.sanitizeLLM(reply) : this.fallbackAnswer(userQuestion, sit);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. 선제 보고 (긴급 경보 + 정기 브리핑)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @param {(text: string) => Promise<any>} send 대표님 채팅방 전송 함수
     */
    startWatch(send) {
        this.send = send;
        if (this.watchTimer) return;
        const tick = () => this.runWatchTick().catch(e => console.error('[ChiefOfStaff] 감시 오류:', e.message));
        setTimeout(tick, 15000).unref?.();
        this.watchTimer = setInterval(tick, WATCH_INTERVAL_MS);
        this.watchTimer.unref?.();
        console.log(`🎩 [ChiefOfStaff] ${CHIEF_CODE} 전사 관제 시작 (감시 ${WATCH_INTERVAL_MS / 60000}분, 정기 ${BRIEF_SLOTS_KST.join('/')})`);
    }

    stopWatch() {
        if (this.watchTimer) clearInterval(this.watchTimer);
        this.watchTimer = null;
    }

    /**
     * 지금 발송해야 할 정기 브리핑 슬롯 ID (없으면 null). 평일만.
     */
    dueBriefSlot() {
        const d = kst();
        const day = d.getUTCDay();
        if (day === 0 || day === 6) return null;
        const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
        const date = d.toISOString().slice(0, 10);
        for (const slot of [...BRIEF_SLOTS_KST].reverse()) {
            const [h, m] = slot.split(':').map(Number);
            const diff = nowMin - (h * 60 + m);
            if (diff >= 0) {
                const id = `${date}@${slot}`;
                return diff <= BRIEF_WINDOW_MIN && id !== this.state.lastBriefSlot ? id : null;
            }
        }
        return null;
    }

    async runWatchTick() {
        if (!this.send || !agentControlManager.isAgentActive(CHIEF_CODE)) return; // 대시보드 OFF 시 침묵
        const sit = this.collectSituation();

        const slot = this.dueBriefSlot();
        if (slot) {
            await this.send(this.formatBrief(sit));
            this.state.lastBriefSlot = slot;
            this.updateAgentLog(CHIEF_CODE, `[정기 브리핑] ${slot}`);
        }

        // 신규 🔴 만 푸시. 해소된 이슈는 목록에서 빠지므로 재발 시 다시 경보
        const crit = sit.issues.filter(i => i.sev === SEV.CRIT);
        const fresh = crit.filter(i => !this.state.alertedKeys.includes(i.key));
        if (this.state.alertsEnabled && fresh.length > 0 && !slot) {
            await this.send([`🔴 <b>긴급 보고</b> ${sit.at}`, ...fresh.slice(0, MAX_BRIEF_ISSUES).map(i => this.issueLine(i))].join('\n'));
            this.updateAgentLog(CHIEF_CODE, `[긴급 경보] ${fresh.length}건`);
        }
        this.state.alertedKeys = crit.map(i => i.key);
        this.saveState();
    }

    /**
     * agents.json 로그 및 처리건수 갱신 (대시보드 통제값은 agentControlManager 가 보호)
     */
    updateAgentLog(agentCode, logMessage) {
        try {
            agentControlManager.loadAgents();
            const agent = agentControlManager.getAgent(agentCode);
            if (!agent) return;
            const timeStr = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
            agentControlManager.safeUpdateAgentMetrics(agentCode, {
                logs: [`[${timeStr}] ${logMessage}`, ...(agent.logs || [])].slice(0, 10),
                metrics: { tasksToday: (agent.metrics?.tasksToday || 0) + 1 }
            });
        } catch (e) {
            console.error(`[ChiefOfStaff] ${agentCode} 로그 업데이트 실패:`, e.message);
        }
    }
}

export const executiveAiService = new ExecutiveAiService();
