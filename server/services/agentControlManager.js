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

        try {
            fs.writeFileSync(AGENTS_PATH, JSON.stringify(this.agentsCache, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[AgentControlManager] 메트릭 저장 오류:', e.message);
            return false;
        }
    }
}

export const agentControlManager = new AgentControlManager();
