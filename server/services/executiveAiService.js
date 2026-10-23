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
 * 3. 보고(Report): 사실(수치)은 항상 코드가 계산, LLM 은 자연어 질문의 문장 다듬기에만 사용
 *                  → 숫자 환각 차단, API 장애 시에도 동일 품질의 규칙 기반 보고
 * 4. 선제 보고   : 10분 주기 감시 → 신규 🔴 이슈만 즉시 푸시, 평일 08:30/17:30 정기 브리핑
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
const STATE_PATH = path.join(DATA_DIR, 'chief_of_staff_state.json');
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
const DISPATCH_QUEUE_PATH = path.join(DATA_DIR, 'dispatch_queue.json');

export const CHIEF_CODE = 'MGT-01';

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
            out.kpis.push(`미결 ${s.totalRows ?? 0}`, `지연 ${s.overdueCount ?? 0}`, `위험업체 ${s.dangerOrdersCount ?? 0}`);

            const risks = Array.isArray(pending.criticalDueRiskItems) ? pending.criticalDueRiskItems : [];
            if (risks.length > 0) {
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
        const alerts = readJson(QC_MISSING_ALERTS_PATH, []).filter(a => !a.resolved && a.status !== 'RESOLVED');
        out.kpis.push(`수집메일 ${hist.length}`, `발행 ${issued.length}`, `누락경보 ${alerts.length}`);

        if (alerts.length > 0) {
            const lines = alerts.reduce((sum, a) => sum + (a.missingCount || 0), 0);
            out.issues.push({
                key: `qc:missing:${alerts.length}`,
                sev: SEV.WARN,
                owner: 'QC-13',
                text: `성적서 누락 ${alerts.length}건/${lines}라인 (${alerts[0].customer || '미상'}${alerts.length > 1 ? ' 외' : ''})`
            });
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
        const s = readJson(STATE_PATH, {});
        return { alertsEnabled: true, alertedKeys: [], lastBriefSlot: null, heartbeats: {}, ...s };
    }

    saveState() {
        try {
            fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (e) {
            console.error('[ChiefOfStaff] 상태 저장 실패:', e.message);
        }
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

        const issues = depts.flatMap(d => d.issues).sort((a, b) => b.sev - a.sev);
        return {
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
            `봇 ${sit.active}/${sit.total} 가동${sit.stopped ? ` · 정지 ${sit.stopped}` : ''} · 🔴${sit.crit} 🟡${sit.warn}`
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
            '<code>상세 품질</code> 부서 봇 전체 목록',
            '<code>/알림 on|off</code> 긴급 자동경보',
            '그 외는 자연어로 질문하세요.'
        ].join('\n');
    }

    /**
     * 정형 명령 처리. 해당 없으면 null (→ 자연어 질의로 넘어감)
     */
    handleCommand(text = '') {
        const t = text.trim().replace(/^\//, '').replace(/\s+/g, ' ').replace(/[?？!.]+$/, '');
        if (!t) return null;

        if (/^(help|도움말?|명령어?)$/i.test(t)) return this.formatHelp();

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
        if (pending?.criticalDueRiskItems?.length) {
            lines.push(`[납기위험 Top3] ${pending.criticalDueRiskItems.slice(0, 3).map(it => `${fmtItem(it)} (${it.alertReason || '납기위험'}, ${Math.abs(it.remainingCustomerDays ?? it.elapsedDays ?? 0)}일)`).join(' / ')}`);
        }
        if (pending?.longestStagnantItems?.length) {
            lines.push(`[장기정체 Top3] ${pending.longestStagnantItems.slice(0, 3).map(it => `${fmtItem(it)} 공정:${it.stage || it.stageName || '-'} ${it.elapsedDays || it.stagnantDays || 0}일`).join(' / ')}`);
        }

        const invs = readJson(SUPPLIER_INVOICES_PATH, []);
        const lastInv = invs[invs.length - 1];
        if (lastInv) lines.push(`[최근 매입전표] No.${lastInv.invoiceNo} ${lastInv.customerName || ''} ${won(lastInv.pricing?.grandTotal || 0)} (${lastInv.invoiceDate || '-'})`);

        lines.push(`[봇 목록] ${sit.agents.map(a => `${a.code}:${a.name}(${a.status})`).join(', ')}`);
        return lines.join('\n');
    }

    async callLLM(system, user) {
        const timeoutFetch = async (url, init) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                return await fetch(url, { ...init, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
        };

        if (process.env.OPENAI_API_KEY) {
            try {
                const res = await timeoutFetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
                    body: JSON.stringify({
                        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                        temperature: 0.1,
                        max_tokens: 350
                    })
                });
                if (res.ok) {
                    const reply = (await res.json()).choices?.[0]?.message?.content;
                    if (reply) return reply;
                }
            } catch (err) {
                console.warn('[ChiefOfStaff] OpenAI 호출 실패, Gemini 폴백:', err.message);
            }
        }

        if (process.env.GEMINI_API_KEY) {
            try {
                const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
                const res = await timeoutFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: system }] },
                        contents: [{ parts: [{ text: user }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 400 }
                    })
                });
                if (res.ok) {
                    const reply = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text;
                    if (reply) return reply;
                }
            } catch (err) {
                console.warn('[ChiefOfStaff] Gemini 호출 실패:', err.message);
            }
        }
        return null;
    }

    /**
     * LLM 출력은 텔레그램 HTML 파싱 실패로 메시지가 통째로 유실될 수 있으므로
     * 전부 이스케이프 후 <b>/<i>/<code> 만 복원, 마크다운 굵게는 <b> 로 변환
     */
    sanitizeLLM(text) {
        return esc(text.trim())
            .replace(/&lt;(\/?)(b|i|code)&gt;/g, '<$1$2>')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/^#+\s*/gm, '');
    }

    /**
     * 규칙 기반 폴백: 질문 속 봇코드 → 부서명 → 전사 요약 순으로 매칭
     */
    fallbackAnswer(question, sit) {
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
    async askExecutiveAI(userQuestion) {
        const direct = this.handleCommand(userQuestion);
        if (direct) {
            this.updateAgentLog(CHIEF_CODE, `[보고] ${userQuestion.slice(0, 25)}`);
            return direct;
        }

        const sit = this.collectSituation();
        const system = `너는 ALTF 경영총괄부 비서실장(MGT-01, 부장)이다. 전사 모든 부서 봇을 관제하고 대표님께 텔레그램으로 보고한다.
[보고 규칙]
1. 결론 한 줄 먼저. 전체 최대 5줄, 줄당 60자 이내.
2. 인사·서론·맺음말·사과·"궁금하신 점" 금지.
3. [현황]에 있는 사실과 수치만 사용. 없으면 "데이터 없음"이라고 하고 추측 금지.
4. 문제는 "무엇 → 담당봇 → 조치" 순서로.
5. 서식은 <b>, <code> 태그만. 마크다운·목록기호(*, -) 금지, 줄머리는 • 사용.`;

        const reply = await this.callLLM(system, `${this.toLLMContext(sit)}\n\n[대표님 질문]\n${userQuestion}`);
        this.updateAgentLog(CHIEF_CODE, `[${reply ? 'AI 답변' : '규칙 답변'}] ${userQuestion.slice(0, 25)}`);
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
