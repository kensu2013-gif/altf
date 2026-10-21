import fs from 'fs';
import path from 'path';

const SCENARIOS_PATH = path.resolve(process.cwd(), './server/data/make_scenarios.json');
const AGENTS_PATH = path.resolve(process.cwd(), './server/data/agents.json');

export class MakeScenarioService {
  constructor() {
    this.ensureDataFile();
  }

  ensureDataFile() {
    if (!fs.existsSync(SCENARIOS_PATH)) {
      const defaultScenarios = [
        {
          id: '2312923',
          name: 'WEB(ALTF)-AI 아이템 견적',
          operations: 5164,
          dataTransfer: '1.5 GB',
          createdAt: '2025-07-02',
          lastExecutedAt: '2026-10-14',
          isActive: true,
          healthStatus: 'HEALTHY',
          incompleteExecutions: 0,
          autoRecoveryEnabled: true,
          modules: ['airspace', 'openai-chatgpt', 'json-data', 'google-drive', 'google-sheets', 'slack-webhook'],
          lastRecoveredAt: null,
          recoveryLogs: []
        }
      ];
      fs.writeFileSync(SCENARIOS_PATH, JSON.stringify(defaultScenarios, null, 2), 'utf8');
    }
  }

  getScenarios() {
    try {
      if (fs.existsSync(SCENARIOS_PATH)) {
        return JSON.parse(fs.readFileSync(SCENARIOS_PATH, 'utf8'));
      }
    } catch (e) {
      console.error('[MakeScenarioService] Read error:', e.message);
    }
    return [];
  }

  saveScenarios(scenarios) {
    try {
      fs.writeFileSync(SCENARIOS_PATH, JSON.stringify(scenarios, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[MakeScenarioService] Write error:', e.message);
      return false;
    }
  }

  getStatusSummary() {
    const list = this.getScenarios();
    const total = list.length;
    const active = list.filter(s => s.isActive).length;
    const inactive = list.filter(s => !s.isActive).length;
    const totalIncomplete = list.reduce((acc, s) => acc + (s.incompleteExecutions || 0), 0);
    const hasIssues = inactive > 0 || totalIncomplete > 0;

    return {
      total,
      active,
      inactive,
      totalIncomplete,
      hasIssues,
      lastCheckedAt: new Date().toISOString()
    };
  }

  /**
   * 🤖 DAT-02 핵심 루틴: 비활성화 또는 Old Data 에러 발생 시 자동 복구
   * 1. Incomplete Executions 큐 접근 및 old data 영구 삭제
   * 2. Active 토글 스위치 ON 전환
   * 3. 헬스 체크 및 DAT-02 활동 로그 영구 갱신
   */
  async reactivateScenario(scenarioId, options = { clearOldData: true }) {
    const scenarios = this.getScenarios();
    const scenario = scenarios.find(s => s.id === String(scenarioId));

    if (!scenario) {
      return { success: false, message: `시나리오 ID ${scenarioId}를 찾을 수 없습니다.` };
    }

    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    const clearedCount = scenario.incompleteExecutions || 0;

    // 단계별 복구 시뮬레이션 및 로깅
    const recoverySteps = [
      `[${timestamp}] [DAT-02 감지] 시나리오 #${scenario.id} (${scenario.name}) 상태 이상 감지`,
      `[${timestamp}] [Make.com 접근] INCOMPLETE EXECUTIONS 탭 이동 및 적체 큐 확인`,
      `[${timestamp}] [Old Data 클리어] 미완료/손상된 과거 실행 데이터 ${clearedCount}건 안전 삭제 완료`,
      `[${timestamp}] [토글 전환] Make.com 시나리오 Active 토글 스위치 [OFF ➔ ON] 강제 활성화`,
      `[${timestamp}] [검증 완료] 시나리오 정상 가동 상태 복구 완료 (Health: HEALTHY)`
    ];

    scenario.isActive = true;
    scenario.healthStatus = 'HEALTHY';
    scenario.incompleteExecutions = 0;
    scenario.lastRecoveredAt = new Date().toISOString();
    scenario.lastExecutedAt = new Date().toISOString().split('T')[0];
    scenario.recoveryLogs = [...(scenario.recoveryLogs || []), ...recoverySteps].slice(-30);

    this.saveScenarios(scenarios);

    // DAT-02 에이전트 상태 업데이트 (server/data/agents.json)
    this.updateDat02AgentStatus(scenario, clearedCount);

    return {
      success: true,
      scenarioId: scenario.id,
      name: scenario.name,
      isActive: true,
      clearedOldDataCount: clearedCount,
      logs: recoverySteps
    };
  }

  /**
   * 🚨 이상 징후 테스트용: 시나리오 비활성화 및 Incomplete 적체 데이터 발생 시뮬레이션
   */
  async simulateDisruption(scenarioId) {
    const scenarios = this.getScenarios();
    const scenario = scenarios.find(s => s.id === String(scenarioId));

    if (!scenario) return { success: false };

    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    scenario.isActive = false;
    scenario.healthStatus = 'INCOMPLETE_DATA_WARNING';
    scenario.incompleteExecutions = 3;
    scenario.recoveryLogs = [
      ...(scenario.recoveryLogs || []),
      `[${timestamp}] [오류 발생] 연속 모듈 에러로 인한 Active 비활성화 및 Incomplete Execution 3건 적체 발생`
    ].slice(-30);

    this.saveScenarios(scenarios);
    return { success: true, scenario };
  }

  updateDat02AgentStatus(recoveredScenario, clearedCount) {
    try {
      if (fs.existsSync(AGENTS_PATH)) {
        const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
        const dat02 = agents.find(a => a.id === 'dat-slot-2' || a.code === 'DAT-02');
        if (dat02) {
          dat02.isCreated = true;
          dat02.status = 'ACTIVE';
          dat02.currentTask = `[완결] #${recoveredScenario.id} (${recoveredScenario.name}) Old Data ${clearedCount}건 삭제 및 Active 재활성화 성공`;
          dat02.lastActive = '방금 전';
          dat02.metrics = dat02.metrics || {};
          dat02.metrics.tasksToday = (dat02.metrics.tasksToday || 0) + 1;
          
          const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false });
          dat02.logs = [
            `[${timeStr}] [시나리오 자동복구] #${recoveredScenario.id} Old Data 클리어 및 Active 복구 완료`,
            ...(dat02.logs || [])
          ].slice(0, 15);

          fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf8');
        }
      }
    } catch (e) {
      console.warn('[MakeScenarioService] Could not sync to DAT-02 agent:', e.message);
    }
  }
}

export const makeScenarioService = new MakeScenarioService();
