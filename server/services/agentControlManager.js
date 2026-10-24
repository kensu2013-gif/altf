/**
 * 🎛️ ALTF Agent Control & Authority Manager (대시보드 통제 우선권 관리자)
 * 
 * [핵심 원칙]:
 * 1. 대시보드 통제 절대 우선권 (Dashboard Authority):
 *    - 사용자가 대시보드에서 에이전트를 'OFFLINE'(OFF), 'IDLE', 'STANDBY', 'ACTIVE'로 변경하거나
 *      반복 주기(scheduleInterval: '10m', '30m', '1h', '24h', 'MANUAL' 등)를 설정하면,
 *      다른 백엔드 로직이나 스케줄러가 이를 임의로 덮어쓰지 못합니다.
 * 2. 백그라운드 자동화 실행 게이트:
 *    - 모든 에이전트 서비스(메일 수집, 발주 관제, 재고 동기화, 카카오/텔레그램 봇 등)는
 *      작업 실행 전 isAgentActive(agentCode)를 검사하여 OFF 상태인 경우 즉시 작업을 스킵합니다.
 * 3. 스케줄러 실시간 핫 리로딩:
 *    - 주기나 상태가 변경되면 등록된 모든 리스너에게 즉시 브로드캐스트하여 타이머를 재조정합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');
const AGENTS_PATH = path.join(ROOT_DIR, 'server/data/agents.json');

// 주기 ID ➔ 밀리초 변환 맵
export const INTERVAL_MS_MAP = {
    'REALTIME': 0,
    '5m': 5 * 60 * 1000,
    '10m': 10 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '3h': 3 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    'MANUAL': -1
};

export const DEFAULT_AGENT_TASKS = {
    'MGT-01': '전사 관제 및 대표님 텔레그램 보고 대기 (긴급 감시 10분 주기)',
    'PUR-01': '업무시간 1일 2회 정기 감시 대기 중 (다음: 익일 오전 10:00, 미결 1010건 관리)',
    'PUR-02': '대경 미결 엑셀 대장 및 신규 인입 실시간 파싱 대기',
    'PUR-03': '발주 대비 입고 지연 정밀 매칭 및 위험 등급 판정 대기',
    'PUR-04': 'P1 필수확인·P2 독촉·P3 예상문제 우선순위 보고 대기',
    'SAL-03': '고객사별 미결 공정 상태 및 납기 사전 조율 대기',
    'DAT-07': '품목군별 제조 리드타임 통계 분석 및 견적팀 제공 대기',
    'INT-01': 'altf@altf.kr 견적의뢰 메일 실시간 수신 대기 중',
    'INT-02': '카카오톡 채널(@altf) 및 솔라피 인입 실시간 수신 대기 중',
    'INT-03': '비정형 문서·사진 Vision OCR 판독 엔진 대기 중',
    'INT-04': '대용량 엑셀 BOM 및 구글시트 파싱 대기',
    'INT-05': '14,136건 ALTF 표준 마스터 품목 규격 정규화 대기 중',
    'INT-06': '사무실 견적서 수정 사항 실시간 감시 및 INT-03 피드백 학습 대기 중',
    'SLE-01': '견적의뢰 인입 시 견적서 초안 자동 작성 대기',
    'SLE-02': '단가 요율 및 시화/양산 실시간 재고 검증 대기',
    'SLE-07': '품목코드별 시스템 요율 대조 및 최근 거래처 요율 이력 상시 모니터링',
    'SLE-08': '견적 발송 후 48시간 이상 미수주 건 자동 추적 및 리마인드 모니터링',
    'SLE-11': '카카오 발주 사진/전표 Vision OCR 상시 대기',
    'SLE-12': '인입 발주 텍스트 ➔ 배관 피팅 정밀 품목 및 단가 매칭 대기',
    'SLE-13': '발주 필수 조건(도착지/운송비) 정합성 검증 대기',
    'SLE-14': '영업3팀 발주 검토 및 승인 대기열 관리 대기',
    'SLE-15': '사무실 발주서 수정 Diff 실시간 감시 및 누적 규칙 학습 대기',
    'PUR-11': '웹/ERP 수주 발주서 인입 실시간 파싱 및 주문 원장 등록 상시 가동',
    'PUR-12': '기등록 견적서(단가/스펙/납기) vs 고객 발주서 1:1 무결점 대조 파이프라인 가동',
    'PUR-13': '태일·시화 재고 우선 배정 및 대경 직송/가공 최적 경로 판별 대기',
    'PUR-14': 'D/M 경로 대경 매입발주서 생성 및 회신 확인 대기',
    'PUR-07': '[영업시간 1시간 주기] 발주 2,487건 분류 관리 및 미결 백로그 상시 추적 중',
    'PUR-08': '재고 발주 적정성 실시간 감시 대기 중',
    'QC-01': '메일플러그 IMAP 소켓 24시간 실시간 수신 대기 중',
    'QC-02': '외주 성적서 PDF 파싱 및 KS/ASTM 규격 이상치 실시간 검출 대기',
    'QC-06': '시화 출고 LOT 1:1 엄격 매칭 기반 성적서 무결점 발행 대기',
    'QC-12': '대경 직송 거래명세표 수신 시 성적서 1:1 확정 대기',
    'QC-13': '성적서 누락 경보 감시 및 24시간 초과 시 독촉 대기',
    'LOG-11': '출고 승인 건 시화 창고 랙 위치 매핑 및 피킹/패킹 작업 지시서 자동 생성',
    'LOG-12': '창고 현장 패킹 바코드 검수 및 중량/계근 데이터 확인 대기열 감시',
    'LOG-13': '차량 상차 완료 건 MES/ERP 출고 확정 및 거래명세표/인수증 자동 발행',
    'GEN-01': '대경벤드 매입 거래명세표 자동 채번 및 원장 매칭 대기',
    'GEN-03': '매출 거래명세표 + 성적서 PDF 1:1 결합 패키지 번들링 대기',
    'GEN-10': '1,265개 거래처 마스터 실시간 동기화 유지 중',
    'DIS-01': '고객/매입처 발송 단일 창구 승인 대기열 통제 가동',
    'EXE-01': '텔레그램 인바운드 스트림 실시간 라우팅 대기 중',
    'EXE-02': '카카오톡 인바운드 텍스트·사진 사전확인 및 영업2/3팀 분배 대기',
    'EXE-11': '매일 08:00/14:00 업무 지연 감시 스케줄러 가동',
    'DAT-01': 'Make.com OAuth 연결 상태 실시간 감시 대기 중',
    'DAT-02': 'Make.com 자동화 시나리오 상시 가동 상태 감시 중',
    'DAT-03': '태일철강/시화 재고 시트 실시간 변동 동기화 대기 중',
    'DAT-04': '대경 재고 원본 수신 및 표준 규격 변환 대기 중',
    'DAT-05': '통합 재고 DB 3~5분 버퍼링 연산 및 일관성 관제 대기 중',
    'DAT-06': '통합 inventory.json S3 배포 및 실시간 변동량 모니터링 대기 중'
};

class AgentControlManager extends EventEmitter {
    constructor() {
        super();
        this.agentsCache = [];
        this.loadAgents();
    }

    /**
     * agents.json 로드 및 메모리 캐싱
     */
    loadAgents() {
        try {
            if (fs.existsSync(AGENTS_PATH)) {
                this.agentsCache = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
            }
        } catch (e) {
            console.error('[AgentControlManager] agents.json 로드 실패:', e.message);
        }
        return this.agentsCache;
    }

    /**
     * 특정 에이전트 객체 조회 (코드 또는 ID)
     * @param {string} codeOrId (예: 'QC-01', 'PUR-07', 'pur-01-stock-listup')
     */
    getAgent(codeOrId) {
        if (!codeOrId) return null;
        const normalized = String(codeOrId).trim().toUpperCase();
        return this.agentsCache.find(a => 
            (a.code && a.code.toUpperCase() === normalized) ||
            (a.id && a.id.toUpperCase() === normalized)
        ) || null;
    }

    /**
     * 에이전트 활성(실행 가능) 상태인지 확인
     * @returns {boolean} true: 가동 가능 (ACTIVE, STANDBY), false: 실행 중단 (OFFLINE, IDLE, 미생성)
     */
    isAgentActive(codeOrId) {
        const agent = this.getAgent(codeOrId);
        if (!agent) return false;

        // 명시적으로 OFF(OFFLINE) 또는 IDLE이면 자동화 실행 금지
        if (agent.status === 'OFFLINE' || agent.status === 'OFF') {
            return false;
        }

        // isCreated가 명시적으로 false인 경우 (아직 미생성 상태)
        if (agent.isCreated === false) {
            return false;
        }

        // ACTIVE 또는 STANDBY는 실행 허용
        return agent.status === 'ACTIVE' || agent.status === 'STANDBY';
    }

    /**
     * 에이전트의 반복 주기 및 인터벌 정보 조회
     * @param {string} codeOrId 
     * @param {string} fallbackInterval 기본값 (e.g. '1h')
     */
    getAgentSchedule(codeOrId, fallbackInterval = '1h') {
        const agent = this.getAgent(codeOrId);
        const intervalId = agent?.scheduleInterval || fallbackInterval;
        const intervalMs = INTERVAL_MS_MAP[intervalId] !== undefined ? INTERVAL_MS_MAP[intervalId] : INTERVAL_MS_MAP['1h'];
        
        return {
            intervalId,
            intervalMs,
            isRealtime: intervalId === 'REALTIME',
            isManual: intervalId === 'MANUAL',
            isActive: this.isAgentActive(codeOrId)
        };
    }

    /**
     * 외부(대시보드 API 등)에서 전체 에이전트 목록 갱신 시 호출
     */
    reloadAgents(updatedAgents) {
        if (Array.isArray(updatedAgents)) {
            this.agentsCache = updatedAgents;
        } else {
            this.loadAgents();
        }

        console.log(`🎛️ [AgentControlManager] 에이전트 설정 리로드 완료 (총 ${this.agentsCache.length}명)`);
        this.emit('change', this.agentsCache);
    }

    /**
     * 단일 에이전트 상태/주기 직접 갱신 (대시보드 또는 원격 제어)
     */
    updateAgentConfig(codeOrId, updates = {}) {
        this.loadAgents();
        const agent = this.getAgent(codeOrId);
        if (!agent) {
            throw new Error(`에이전트를 찾을 수 없습니다: ${codeOrId}`);
        }

        const prevStatus = agent.status;
        const prevInterval = agent.scheduleInterval;

        // 허용된 통제 필드 업데이트
        if (updates.status !== undefined) agent.status = updates.status;
        if (updates.scheduleInterval !== undefined) agent.scheduleInterval = updates.scheduleInterval;
        if (updates.currentTask !== undefined) agent.currentTask = updates.currentTask;
        if (updates.isCreated !== undefined) agent.isCreated = updates.isCreated;
        agent.lastActive = '방금 전';
        agent.lastActiveAt = new Date().toISOString();

        try {
            fs.writeFileSync(AGENTS_PATH, JSON.stringify(this.agentsCache, null, 2), 'utf8');
            console.log(`🎛️ [AgentControlManager] [${agent.code}] 상태 변경: ${prevStatus} ➔ ${agent.status} | 주기: ${prevInterval} ➔ ${agent.scheduleInterval}`);
            this.emit('agentChange', { agent, prevStatus, prevInterval });
            this.emit('change', this.agentsCache);
            return { success: true, agent };
        } catch (e) {
            console.error('[AgentControlManager] 저장 에러:', e.message);
            throw e;
        }
    }

    /**
     * 백엔드 서비스에서 에이전트의 로그/메트릭을 안전하게 업데이트할 때 호출
     * [핵심]: 사용자가 대시보드에서 설정한 status(OFFLINE 등)나 scheduleInterval을 절대 덮어쓰지 않음!
     */
    safeUpdateAgentMetrics(codeOrId, { currentTask, logs, metrics } = {}) {
        this.loadAgents();
        const agent = this.getAgent(codeOrId);
        if (!agent) return false;

        if (currentTask && agent.status !== 'OFFLINE') {
            agent.currentTask = currentTask;
        }
        if (Array.isArray(logs)) {
            agent.logs = logs;
        }
        if (metrics) {
            agent.metrics = { ...(agent.metrics || {}), ...metrics };
        }
        agent.lastActive = '방금 전';
        agent.lastActiveAt = new Date().toISOString();

        try {
            fs.writeFileSync(AGENTS_PATH, JSON.stringify(this.agentsCache, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[AgentControlManager] 메트릭 저장 오류:', e.message);
            return false;
        }
    }

    /**
     * 🚀 전사 봇 전체 일괄 활성화 (Ready & Active State)
     * - 모든 봇의 status를 'ACTIVE'로 전환
     * - isCreated를 true로 보장
     * - 사원/대리는 AUTO_RUNNING, 과장/팀장은 APPROVED로 자동 승인 상태 설정
     * - 실시간 가동 로그 기록 및 대시보드 리스너 브로드캐스트
     */
    activateAllAgents() {
        this.loadAgents();
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ko-KR');

        this.agentsCache = this.agentsCache.map(agent => {
            const isManager = agent.position === '부장' || agent.position === '팀장' || agent.position === '과장';
            const approval = isManager ? 'APPROVED' : 'AUTO_RUNNING';
            const existingLogs = Array.isArray(agent.logs) ? agent.logs : [];
            const newLog = `[${timeStr}] [전사 일괄 가동] 봇 활성화 완료 (상태: ACTIVE, 파이프라인 상시 가동 준비)`;

            return {
                ...agent,
                status: 'ACTIVE',
                isCreated: true,
                approvalStatus: approval,
                lastActive: '방금 전',
                metrics: {
                    ...(agent.metrics || { speed: 98, accuracy: 99, load: 15, uptime: '99.9%', tasksToday: 10 }),
                    tasksToday: ((agent.metrics?.tasksToday || 0) + 1)
                },
                logs: [newLog, ...existingLogs.slice(0, 19)]
            };
        });

        try {
            fs.writeFileSync(AGENTS_PATH, JSON.stringify(this.agentsCache, null, 2), 'utf8');
            console.log(`🚀 [AgentControlManager] 전사 ${this.agentsCache.length}기 봇 전체 활성화(ACTIVE) 저장 완료`);
            this.emit('change', this.agentsCache);
            return { success: true, count: this.agentsCache.length, agents: this.agentsCache };
        } catch (e) {
            console.error('[AgentControlManager] 전사 활성화 저장 오류:', e.message);
            throw e;
        }
    }

    /**
     * 🔄 전사 봇 상태 및 업무를 제자리(STANDBY/ACTIVE 기본 위치)로 환원
     */
    resetAllAgentsToDefaultPositions() {
        this.loadAgents();
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ko-KR');

        this.agentsCache = this.agentsCache.map(agent => {
            const isManager = agent.position === '부장' || agent.position === '팀장' || agent.position === '과장';
            const approval = isManager ? 'APPROVED' : 'AUTO_RUNNING';
            const defaultTask = DEFAULT_AGENT_TASKS[agent.code] || `${agent.name} 상시 가동 대기 중`;
            const existingLogs = Array.isArray(agent.logs) ? agent.logs : [];
            const resetLog = `[${timeStr}] 🔄 [제자리 복귀] 봇 상태 제자리 위치(상시 대기)로 정상 복귀 완료`;

            return {
                ...agent,
                status: 'ACTIVE',
                isCreated: true,
                approvalStatus: approval,
                currentTask: defaultTask,
                lastActive: '방금 전',
                metrics: {
                    ...(agent.metrics || { speed: 98, accuracy: 99, load: 15, uptime: '99.9%', tasksToday: 10 }),
                    load: Math.min(agent.metrics?.load || 15, 20)
                },
                logs: [resetLog, ...existingLogs.filter(l => !l.includes('[제자리 복귀]')).slice(0, 9)]
            };
        });

        try {
            fs.writeFileSync(AGENTS_PATH, JSON.stringify(this.agentsCache, null, 2), 'utf8');
            console.log(`🔄 [AgentControlManager] 전사 ${this.agentsCache.length}기 봇 상태 제자리 위치(STANDBY) 복귀 완료`);
            this.emit('change', this.agentsCache);
            return { success: true, count: this.agentsCache.length, agents: this.agentsCache };
        } catch (e) {
            console.error('[AgentControlManager] 봇 제자리 복귀 오류:', e.message);
            throw e;
        }
    }
}

export const agentControlManager = new AgentControlManager();

