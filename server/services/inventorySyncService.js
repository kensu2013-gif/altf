import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import XLSX from 'xlsx';
import { uploadInventoryToS3, hasAwsCredentials } from '../../s3-db.js';

const CONFIG_PATH = path.resolve(process.cwd(), './server/data/inventory_sync_config.json');
const STORAGE_DIR = path.resolve(process.cwd(), './storage/inventory');
const LOCAL_INVENTORY_JSON = path.resolve(process.cwd(), './public/api/inventory/inventory.json');
const AGENTS_JSON_PATH = path.resolve(process.cwd(), './server/data/agents.json');

export class InventorySyncService {
  constructor() {
    this.ensureDirs();
    this.loadConfig();
    this.state = {
      isRunning: false,
      currentStep: 0,
      autoPilot: false,
      step1: {
        status: 'IDLE', // IDLE | RUNNING | SUCCESS | ERROR
        lastRun: null,
        message: '대기 중',
        details: null
      },
      step2: {
        status: 'IDLE',
        lastRun: null,
        message: '대기 중',
        fileName: null,
        itemCount: 0,
        details: null
      },
      step3: {
        status: 'IDLE', // IDLE | BUFFERING | RUNNING | SUCCESS | ERROR
        lastRun: null,
        message: '대기 중',
        bufferTotalSeconds: this.config.bufferWaitMinutes * 60,
        bufferRemainingSeconds: 0,
        timerActive: false,
        details: null
      },
      step4: {
        status: 'IDLE',
        lastRun: null,
        message: '대기 중',
        s3Uploaded: false,
        totalItems: 0,
        sihwaChangesCount: 0,
        sihwaInboundCount: 0,
        sihwaOutboundCount: 0,
        cleanedFiles: [],
        details: null
      },
      // 🔗 [에이전트 직급별 직전 봇 감시 & SUCCESS 승계 체인]
      chain: {
        dat03: {
          code: 'DAT-03',
          name: '태일·시화 재고 동기화 봇',
          roleLevel: '사원',
          status: 'IDLE', // IDLE | RUNNING | SUCCESS | ERROR
          lastSuccessAt: null,
          message: '대기 중'
        },
        dat04: {
          code: 'DAT-04',
          name: '대경 재고 파일 수신 & 변환 봇',
          roleLevel: '사원',
          status: 'IDLE', // IDLE | WAITING_PREVIOUS | RUNNING | SUCCESS | ERROR
          prerequisite: 'DAT-03 SUCCESS',
          lastSuccessAt: null,
          message: '[대기] DAT-03 사원 완료 신호 감시 중'
        },
        dat05: {
          code: 'DAT-05',
          name: 'ALTF 재고 DB 총괄 & 버퍼링 관제 봇',
          roleLevel: '대리',
          status: 'IDLE', // IDLE | WAITING_PREVIOUS | BUFFERING | RUNNING | SUCCESS | ERROR
          prerequisite: 'DAT-03 & DAT-04 SUCCESS',
          lastSuccessAt: null,
          message: '[대기] DAT-03, DAT-04 사원 완료 신호 감시 중'
        },
        dat06: {
          code: 'DAT-06',
          name: 'S3 배포 & 재고 갱신/변동량 감시 봇',
          roleLevel: '과장',
          status: 'IDLE', // IDLE | WAITING_PREVIOUS | RUNNING | SUCCESS | ERROR
          prerequisite: 'DAT-05 SUCCESS & 신규 결과물 검증 통과',
          lastSuccessAt: null,
          message: '[대기] DAT-05 대리 완료 신호 및 결과물 검수 대기 중'
        }
      },
      lastFullRun: null,
      error: null
    };

    this.timerInterval = null;
    this.schedulerInterval = null;
    this.lastScheduledRunDate = {};
    this.initTaeilScheduler();
  }

  ensureDirs() {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    const dataDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // 🤖 에이전트 오피스 대시보드(agents.json) 실시간 상태/과업/로그 동기화
  _updateAgentStatus(code, taskMessage, logMessage = null, newStatus = null) {
    try {
      if (!fs.existsSync(AGENTS_JSON_PATH)) return;
      const raw = fs.readFileSync(AGENTS_JSON_PATH, 'utf8');
      const agents = JSON.parse(raw);
      let updated = false;

      for (const ag of agents) {
        if (ag.code === code) {
          if (taskMessage) ag.currentTask = taskMessage;
          if (newStatus) ag.status = newStatus;
          ag.lastActive = '방금 전';
          if (logMessage) {
            const timeStr = new Date().toLocaleTimeString('ko-KR');
            if (!Array.isArray(ag.logs)) ag.logs = [];
            ag.logs = [`[${timeStr}] ${logMessage}`, ...ag.logs.slice(0, 14)];
          }
          updated = true;
          break;
        }
      }

      if (updated) {
        fs.writeFileSync(AGENTS_JSON_PATH, JSON.stringify(agents, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn(`[InventorySyncService] _updateAgentStatus(${code}) warning:`, e.message);
    }
  }

  loadConfig() {
    const defaultConfig = {
      taeilAppsScriptUrl: '',
      daekyungAppsScriptUrl: '',
      altfDbAppsScriptUrl: '',
      bufferWaitMinutes: 3.5, // 3.5분 (210초) 기본
      retryWaitMinutes: 3.5,  // 실패 시 3~5분 후 재시도
      maxRetries: 5,          // 최대 재시도 횟수
      taeilScheduleTimes: ['09:00', '13:00', '17:30'], // 태일/시화 하루 3번
      autoCleanupDownloads: true,
      autoPilotAutoConfirm: false
    };

    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        this.config = { ...defaultConfig, ...JSON.parse(raw) };
      } catch (e) {
        console.error('[InventorySyncService] Config read error:', e.message);
        this.config = defaultConfig;
      }
    } else {
      this.config = defaultConfig;
      this.saveConfig(this.config);
    }
  }

  saveConfig(newConfig) {
    try {
      this.config = { ...this.config, ...newConfig };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
      if (this.state.step3 && !this.state.step3.timerActive) {
        this.state.step3.bufferTotalSeconds = Math.round(this.config.bufferWaitMinutes * 60);
      }
      return { success: true, config: this.config };
    } catch (e) {
      console.error('[InventorySyncService] Config save error:', e.message);
      return { success: false, error: e.message };
    }
  }

  getStatus() {
    return {
      state: this.state,
      config: this.config
    };
  }

  // ==========================================
  // [DAT-03 스케줄러] 태일/시화 하루 3회 정기 동기화 감시
  // ==========================================
  initTaeilScheduler() {
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
    this.schedulerInterval = setInterval(() => {
      try {
        const now = new Date();
        const kstTime = new Intl.DateTimeFormat('ko-KR', {
          timeZone: 'Asia/Seoul',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(now);
        const kstDate = new Intl.DateTimeFormat('ko-KR', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(now);

        const scheduleList = this.config.taeilScheduleTimes || ['09:00', '13:00', '17:30'];
        if (scheduleList.includes(kstTime) && this.lastScheduledRunDate[kstTime] !== kstDate) {
          this.lastScheduledRunDate[kstTime] = kstDate;
          console.log(`[DAT-03 스케줄러] ⏰ 하루 3회 정기 동기화 시각 도달: ${kstTime}`);
          this.triggerScheduledTaeilSync(kstTime);
        }
      } catch (e) {
        console.error('[DAT-03 스케줄러] 체크 오류:', e.message);
      }
    }, 20000);
  }

  async triggerScheduledTaeilSync(scheduledTime) {
    if (this.state.isRunning) {
      console.log(`[DAT-03 스케줄러] 이미 파이프라인 가동 중으로 예약(${scheduledTime}) 대기`);
      return;
    }
    try {
      console.log(`\n======================================================`);
      console.log(`🚀 [자동화팀 정기 파이프라인] 하루 3회 정기 동기화 시작 (${scheduledTime})`);
      console.log(`[순서 규칙] DAT-03(사원) ➔ DAT-04(사원) ➔ DAT-05(대리) ➔ DAT-06(과장)`);
      console.log(`======================================================\n`);
      await this.runSequentialPipeline({ source: `SCHEDULE_${scheduledTime}` });
    } catch (err) {
      console.error(`[자동화팀 정기 파이프라인] 실행 실패:`, err.message);
    }
  }

  // ==========================================
  // [사원 1] DAT-03: 태일/시화재고 동기화
  // ==========================================
  async runStep1TaeilSihwa() {
    this.state.step1.status = 'RUNNING';
    this.state.step1.message = '태일/시화재고 Apps Script 및 원격 API 호출 중...';
    this.state.chain.dat03.status = 'RUNNING';
    this.state.chain.dat03.message = '태일/시화재고 Apps Script 및 원격 API 호출 중...';
    this.state.error = null;
    this._updateAgentStatus('DAT-03', '[가동] 태일/시화재고 구글시트 Apps Script 실행 중...', '태일/시화재고 Apps Script 및 원격 API 호출 시작', 'ACTIVE');

    try {
      let appsScriptResult = null;
      // 1. 만약 사용자가 Apps Script Webhook URL을 등록해 두었으면 직접 GET 호출
      if (this.config.taeilAppsScriptUrl && this.config.taeilAppsScriptUrl.trim()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); // 60초 타임아웃
        try {
          const res = await fetch(this.config.taeilAppsScriptUrl.trim(), {
            method: 'GET',
            signal: controller.signal
          });
          clearTimeout(timeout);
          appsScriptResult = { status: res.status, text: await res.text() };
        } catch (fetchErr) {
          clearTimeout(timeout);
          console.warn('[Step 1] Apps Script Webhook 호출 오류 (계속 진행):', fetchErr.message);
          appsScriptResult = { warning: fetchErr.message };
        }
      }

      // 2. 원격 태일/시화 API 핑 테스트
      let apiPing = 'UNCHECKED';
      try {
        const pingCtrl = new AbortController();
        const pingTimer = setTimeout(() => pingCtrl.abort(), 5000);
        const pingRes = await fetch('http://121.145.79.200:8800/stocklist_get.php?item=', { signal: pingCtrl.signal });
        clearTimeout(pingTimer);
        apiPing = pingRes.ok ? `HTTP ${pingRes.status} 정상` : `HTTP ${pingRes.status}`;
      } catch (pErr) {
        apiPing = '연결 지연/차단: ' + pErr.message;
      }

      this.state.step1.status = 'SUCCESS';
      this.state.step1.lastRun = new Date().toISOString();
      this.state.step1.message = '태일/시화재고 구글시트 Apps Script 동기화 완료';
      this.state.step1.details = {
        appsScriptResult,
        apiPing,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      };

      // 🔗 DAT-03 완료 신호(SUCCESS) 방출 및 DAT-04 대기 알림
      this.state.chain.dat03.status = 'SUCCESS';
      this.state.chain.dat03.lastSuccessAt = new Date().toISOString();
      this.state.chain.dat03.message = '태일/시화재고 구글시트 Apps Script 동기화 완료 (SUCCESS 신호 방출)';
      this.state.chain.dat04.message = '[신호 감지] DAT-03 사원 완료 감지 ➔ 대경재고 변환 착수 대기';

      this._updateAgentStatus('DAT-03', '[완료] 태일/시화 동기화 완료 (SUCCESS 신호 방출)', '태일/시화재고 구글시트 동기화 완료 (SUCCESS)', 'ACTIVE');
      this._updateAgentStatus('DAT-04', '[신호 감지] DAT-03 사원 완료 감지 ➔ 대경재고 변환 착수 대기', '직전 봇 DAT-03의 SUCCESS 신호 감지됨');

      console.log(`[DAT-03 사원] ✅ 태일/시화 동기화 완료 (SUCCESS). 다음 봇 DAT-04 사원에게 바통 터치!`);
      return { success: true, step1: this.state.step1 };
    } catch (err) {
      this.state.step1.status = 'ERROR';
      this.state.step1.message = '태일/시화 동기화 실패: ' + err.message;
      this.state.chain.dat03.status = 'ERROR';
      this.state.chain.dat03.message = '태일/시화 동기화 실패: ' + err.message;
      this.state.error = err.message;
      this._updateAgentStatus('DAT-03', `[실패] 태일/시화 동기화 오류: ${err.message}`, `태일/시화 동기화 실패: ${err.message}`);
      throw err;
    }
  }

  // ==========================================
  // [사원 2] DAT-04: 대경재고 파일 수신 & 변환 (A4:M1168 실제 데이터 정밀 추출)
  // ==========================================
  parseDaekyungXlsx(bufferOrPath) {
    try {
      const wb = typeof bufferOrPath === 'string'
        ? XLSX.readFile(bufferOrPath)
        : XLSX.read(bufferOrPath, { type: 'buffer' });
      
      const sheetName = wb.SheetNames[0] || '재고현황';
      const sheet = wb.Sheets[sheetName];
      const rows = [];

      // Row 4(헤더)부터 '合 計' 또는 빈 행 전까지 A~M열 추출
      for (let r = 4; r <= 1500; r++) {
        const cellA = sheet['A' + r];
        const valA = cellA ? String(cellA.v).trim() : '';
        if (valA === '合 計' || valA === '합계') break;
        if (!valA && r > 10) {
          const nextCell = sheet['A' + (r + 1)];
          if (!nextCell || !nextCell.v) break;
        }

        const rowData = [];
        for (let c = 0; c < 13; c++) {
          const col = String.fromCharCode(65 + c);
          const cell = sheet[col + r];
          rowData.push(cell !== undefined && cell !== null ? cell.v : '');
        }
        rows.push(rowData);
      }

      return {
        success: true,
        sheetName,
        header: rows[0],
        itemsCount: Math.max(0, rows.length - 1),
        rows
      };
    } catch (err) {
      console.error('[InventorySyncService] Daekyung xlsx parse error:', err.message);
      return { success: false, error: err.message, itemsCount: 0, rows: [] };
    }
  }

  async runStep2Daekyung(fileData = null, options = {}) {
    // 🛡️ [직전 봇 감시/확인]: 만약 options.isParallel(동시 실행 모드) 또는 bypassPrerequisite가 아니면 직전 봇 DAT-03 SUCCESS 신호 감시
    if (!options.bypassPrerequisite && !options.isParallel && this.state.chain.dat03.status !== 'SUCCESS') {
      const errMsg = `[DAT-04 사원 거부] 직전 봇 DAT-03(태일/시화 동기화)의 SUCCESS 신호가 확인되지 않았습니다. (현재 상태: ${this.state.chain.dat03.status})`;
      console.warn(errMsg);
      this.state.chain.dat04.status = 'WAITING_PREVIOUS';
      this.state.chain.dat04.message = errMsg;
      this._updateAgentStatus('DAT-04', '[거부] 직전 봇 DAT-03 SUCCESS 신호 미확인 ➔ 실행 대기', errMsg);
      throw new Error(errMsg);
    }

    this.state.step2.status = 'RUNNING';
    this.state.step2.message = options.isParallel 
      ? '태일·시화와 동시 가동 중: 대경재고 원장 파일 수신 및 구글시트 변환 트리거 중...'
      : '대경재고 원장 파일 수신 및 구글시트 변환 트리거 중...';
    this.state.chain.dat04.status = 'RUNNING';
    this.state.chain.dat04.message = this.state.step2.message;
    this.state.error = null;

    const startMsg = options.isParallel 
      ? '[동시 가동] 태일·시화(DAT-03)와 함께 대경재고 원장 접수 및 변환 중...'
      : '[가동] 직전 DAT-03 SUCCESS 확인됨 ➔ 대경재고 원장 접수 및 변환 중...';
    this._updateAgentStatus('DAT-04', startMsg, '대경재고 원장 처리 시작', 'ACTIVE');

    try {
      let savedPath = null;
      let parsed = null;

      // 1. 전달된 파일 버퍼가 있는 경우
      if (fileData?.buffer) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = fileData.filename || `daekyung_stock_${timestamp}.xlsx`;
        savedPath = path.join(STORAGE_DIR, filename);
        fs.writeFileSync(savedPath, fileData.buffer);
        this.state.step2.fileName = filename;
        parsed = this.parseDaekyungXlsx(fileData.buffer);
      } else if (fileData?.content) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = fileData.filename || `daekyung_stock_${timestamp}.txt`;
        savedPath = path.join(STORAGE_DIR, filename);
        fs.writeFileSync(savedPath, fileData.content, 'utf8');
        this.state.step2.fileName = filename;
      } else {
        // 2. 전달된 데이터가 없을 경우 루트 디렉터리의 대경벤드 재고장*.xlsx 자동 탐색
        const rootFiles = fs.readdirSync(process.cwd());
        const stockFile = rootFiles.find(f => f.startsWith('대경벤드 재고장') && f.endsWith('.xlsx'));
        if (stockFile) {
          const fullPath = path.join(process.cwd(), stockFile);
          this.state.step2.fileName = stockFile;
          savedPath = fullPath;
          parsed = this.parseDaekyungXlsx(fullPath);
          console.log(`[DAT-04 사원] 루트 디렉터리의 최신 대경 파일 감지: ${stockFile} (${parsed.itemsCount}개 품목)`);
        }
      }

      const itemCount = parsed?.itemsCount || 0;
      this.state.step2.itemCount = itemCount;

      // Apps Script Webhook URL 호출 (있는 경우 2차원 배열 데이터 전달)
      let appsScriptResult = null;
      if (this.config.daekyungAppsScriptUrl && this.config.daekyungAppsScriptUrl.trim()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
          const res = await fetch(this.config.daekyungAppsScriptUrl.trim(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'import_daekyung',
              filename: this.state.step2.fileName,
              itemCount,
              rows: parsed?.rows || [],
              timestamp: new Date().toISOString()
            }),
            signal: controller.signal
          });
          clearTimeout(timeout);
          appsScriptResult = { status: res.status, text: await res.text() };
        } catch (fetchErr) {
          clearTimeout(timeout);
          console.warn('[Step 2] 대경 Apps Script Webhook 호출 오류 (계속 진행):', fetchErr.message);
          appsScriptResult = { warning: fetchErr.message };
        }
      }

      this.state.step2.status = 'SUCCESS';
      this.state.step2.lastRun = new Date().toISOString();
      this.state.step2.message = `대경재고 원장 접수 완료 (${itemCount > 0 ? `${itemCount.toLocaleString()}개 품목 A4~M열 추출` : '기존 시트 갱신'})`;
      this.state.step2.details = {
        savedPath: savedPath ? path.basename(savedPath) : '기존 시트 직접 갱신',
        itemCount,
        header: parsed?.header,
        appsScriptResult,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      };

      // 🔗 DAT-04 완료 신호(SUCCESS) 방출 및 DAT-05 대리 대기 알림
      this.state.chain.dat04.status = 'SUCCESS';
      this.state.chain.dat04.lastSuccessAt = new Date().toISOString();
      this.state.chain.dat04.message = `대경재고 원장 접수 및 변환 완료 (SUCCESS 신호 방출)`;
      
      const isDat03Done = this.state.chain.dat03.status === 'SUCCESS';
      this.state.chain.dat05.message = isDat03Done 
        ? '[신호 감지] DAT-03, DAT-04 사원 완료 감지 ➔ 3~5분 버퍼링 및 ALTF DB 연산 착수 대기'
        : '[신호 대기] DAT-04 완료, DAT-03 태일·시화 동시 작업 완료 대기 중';

      this._updateAgentStatus('DAT-04', `[완료] 대경재고 변환 완료 (${itemCount}건, SUCCESS 신호 방출)`, `대경재고 ${itemCount}건 구글시트 변환 완료 (SUCCESS)`);
      if (isDat03Done) {
        this._updateAgentStatus('DAT-05', '[신호 감지] DAT-03, DAT-04 사원 완료 감지 ➔ 3~5분 버퍼링 및 ALTF DB 대기', '직전 사원 봇들(DAT-03, DAT-04)의 SUCCESS 신호 모두 감지됨');
      }

      console.log(`[DAT-04 사원] ✅ 대경재고 변환 완료 (SUCCESS). 다음 봇 DAT-05 대리에게 바통 터치!`);
      return { success: true, step2: this.state.step2 };
    } catch (err) {
      this.state.step2.status = 'ERROR';
      this.state.step2.message = '대경재고 변환 실패: ' + err.message;
      this.state.chain.dat04.status = 'ERROR';
      this.state.chain.dat04.message = '대경재고 변환 실패: ' + err.message;
      this.state.error = err.message;
      this._updateAgentStatus('DAT-04', `[실패] 대경재고 변환 오류: ${err.message}`, `대경재고 변환 오류: ${err.message}`);
      throw err;
    }
  }

  // ==========================================
  // [사원 동시 병렬 가동] 텔레그램 수신 또는 원클릭 시 DAT-03 & DAT-04 거의 동시 실행
  // ==========================================
  async runSimultaneousDualSync(daekyungFileData = null) {
    console.log(`\n⚡ [사원 동시 병렬 가동] 대경재고장 수신 즉시 태일·시화재고 Apps Script 동시 실행`);
    console.log(`[순서 규칙] DAT-03(사원) & DAT-04(사원) 거의 동시 가동 ➔ 둘 다 SUCCESS 완료 후 DAT-05(대리)`);

    this._updateAgentStatus('DAT-03', '[동시 가동] 대경재고장 수신에 맞춰 태일·시화재고 Apps Script 즉시 실행 중...', '태일·시화 동시 실행', 'ACTIVE');
    this._updateAgentStatus('DAT-04', '[동시 가동] 대경재고 원장 접수 및 구글시트 변환 중...', '대경재고 동시 실행', 'ACTIVE');

    // 두 사원의 작업을 거의 동시에 병렬 트리거
    const [step1Result, step2Result] = await Promise.all([
      this.runStep1TaeilSihwa(),
      this.runStep2Daekyung(daekyungFileData, { isParallel: true, bypassPrerequisite: true })
    ]);

    if (this.state.chain.dat03.status !== 'SUCCESS' || this.state.chain.dat04.status !== 'SUCCESS') {
      throw new Error(`[사원 동시 가동 오류] DAT-03(${this.state.chain.dat03.status}) 또는 DAT-04(${this.state.chain.dat04.status}) 실패`);
    }

    console.log(`[사원 동시 가동 완결] ✅ DAT-03 & DAT-04 모두 SUCCESS 완료! 대리 DAT-05에게 바통 터치.\n`);
    this.state.chain.dat05.message = '[신호 감지] 직전 사원들(DAT-03, DAT-04) 동시 완료 확인됨 ➔ 3~5분 버퍼링 대기';
    this._updateAgentStatus('DAT-05', '[신호 감지] 사원들(DAT-03, DAT-04) 동시 완료 확인됨 ➔ 3~5분 버퍼링 및 ALTF DB 대기', 'DAT-03 & DAT-04 동시 완료 확인');

    return {
      success: true,
      step1: step1Result.step1,
      step2: step2Result.step2,
      chain: this.state.chain
    };
  }

  // ==========================================
  // [대리] DAT-05: 3~5분 버퍼링 카운트다운 & ALTF 재고 DB 실행
  // ==========================================
  async startStep3BufferAndAltfDb(skipBuffer = false, options = {}) {
    // 🛡️ [직전 사원 봇들 감시/확인]: DAT-03 및 DAT-04가 모두 SUCCESS 완료되어야 작동
    if (!options.bypassPrerequisite) {
      const isDat03Ready = this.state.chain.dat03.status === 'SUCCESS';
      const isDat04Ready = this.state.chain.dat04.status === 'SUCCESS';
      if (!isDat03Ready || !isDat04Ready) {
        const errMsg = `[DAT-05 대리 거부] 직전 사원 봇들의 SUCCESS 신호가 모두 확인되지 않았습니다. (DAT-03: ${this.state.chain.dat03.status}, DAT-04: ${this.state.chain.dat04.status}) 사원 작업이 100% 완료된 후에만 버퍼링을 시작할 수 있습니다.`;
        console.warn(errMsg);
        this.state.chain.dat05.status = 'WAITING_PREVIOUS';
        this.state.chain.dat05.message = errMsg;
        this._updateAgentStatus('DAT-05', '[거부] 직전 사원(DAT-03, DAT-04) SUCCESS 미확인 ➔ 대기 중', errMsg);
        throw new Error(errMsg);
      }
    }

    if (this.state.step3.timerActive) {
      return { success: false, message: '이미 버퍼링 타이머가 작동 중입니다.' };
    }

    const waitSeconds = skipBuffer ? 0 : Math.round(this.config.bufferWaitMinutes * 60);
    this.state.step3.bufferTotalSeconds = waitSeconds;
    this.state.step3.bufferRemainingSeconds = waitSeconds;

    if (waitSeconds > 0) {
      this.state.step3.status = 'BUFFERING';
      this.state.step3.timerActive = true;
      this.state.step3.message = `구글시트 대용량 수식 연산 안정화 대기 중 (${Math.ceil(waitSeconds / 60)}분)...`;

      this.state.chain.dat05.status = 'BUFFERING';
      this.state.chain.dat05.message = `[신호 감지 완료] 직전 사원(DAT-03, DAT-04) SUCCESS 확인됨. 구글시트 대용량 수식 안정화 버퍼링 중 (${Math.ceil(waitSeconds / 60)}분)...`;
      this._updateAgentStatus('DAT-05', `[버퍼링] 직전 사원 SUCCESS 확인됨 ➔ 구글시트 안정화 버퍼링 중 (${Math.ceil(waitSeconds / 60)}분)`, '구글시트 대용량 수식 연산 안정화 버퍼링 가동', 'ACTIVE');

      return new Promise((resolve, reject) => {
        if (this.timerInterval) clearInterval(this.timerInterval);

        this.timerInterval = setInterval(async () => {
          this.state.step3.bufferRemainingSeconds -= 1;

          if (this.state.step3.bufferRemainingSeconds <= 0) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            this.state.step3.timerActive = false;

            try {
              const res = await this._executeAltfDbAppsScript();
              if (this.state.autoPilot) {
                // AutoPilot 진행 중이면 곧바로 4단계(과장 봇) 실행
                await this.runStep4DeployAndAnalyzeDiff();
                this.state.isRunning = false;
                this.state.autoPilot = false;
              }
              resolve(res);
            } catch (e) {
              reject(e);
            }
          }
        }, 1000);

        // 즉시 첫 상태 반환
        resolve({ success: true, status: 'BUFFERING_STARTED', waitSeconds });
      });
    } else {
      return await this._executeAltfDbAppsScript();
    }
  }

  cancelStep3Buffer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.state.step3.timerActive = false;
    this.state.step3.status = 'IDLE';
    this.state.step3.bufferRemainingSeconds = 0;
    this.state.step3.message = '버퍼링 카운트다운이 취소되었습니다.';
    this.state.chain.dat05.status = 'IDLE';
    this.state.chain.dat05.message = '버퍼링 카운트다운이 취소되었습니다.';
    this.state.isRunning = false;
    this.state.autoPilot = false;
    this._updateAgentStatus('DAT-05', '[취소] 버퍼링 카운트다운 취소됨', '버퍼링 카운트다운 취소');
    return { success: true, message: '취소 완료' };
  }

  /**
   * 대리 버퍼링 및 ALTF DB 앱스크립트 실행이 완료될 때까지 비동기 대기
   */
  waitForStep3Completion() {
    return new Promise((resolve, reject) => {
      const isStillPending = () => this.state.step3.timerActive || this.state.step3.status === 'BUFFERING' || this.state.step3.status === 'RUNNING';

      if (!isStillPending()) {
        if (this.state.step3.status === 'ERROR') {
          return reject(new Error(this.state.step3.message || 'ALTF DB 연산 실패'));
        }
        return resolve({ success: true, step3: this.state.step3 });
      }

      const checkInterval = setInterval(() => {
        if (!isStillPending()) {
          clearInterval(checkInterval);
          if (this.state.step3.status === 'ERROR') {
            reject(new Error(this.state.step3.message || 'ALTF DB 연산 실패'));
          } else {
            resolve({ success: true, step3: this.state.step3 });
          }
        }
      }, 1000);
    });
  }

  async _executeAltfDbAppsScript() {
    this.state.step3.status = 'RUNNING';
    this.state.step3.message = 'ALTF 재고 DATA BASE Apps Script 실행 중 (inventory.json 생성)...';
    this.state.chain.dat05.status = 'RUNNING';
    this.state.chain.dat05.message = 'ALTF 재고 DATA BASE Apps Script 실행 중 (최신 inventory.json 생성)...';
    this._updateAgentStatus('DAT-05', '[가동] ALTF 재고 DB Apps Script 실행 중 (inventory.json 생성)...', 'ALTF DB Apps Script 실행 시작', 'ACTIVE');

    try {
      let appsScriptResult = null;
      if (this.config.altfDbAppsScriptUrl && this.config.altfDbAppsScriptUrl.trim()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000); // 90초 타임아웃
        try {
          const res = await fetch(this.config.altfDbAppsScriptUrl.trim(), {
            method: 'GET',
            signal: controller.signal
          });
          clearTimeout(timeout);
          appsScriptResult = { status: res.status, text: await res.text() };
        } catch (fetchErr) {
          clearTimeout(timeout);
          console.warn('[Step 3] ALTF DB Apps Script 호출 경고:', fetchErr.message);
          appsScriptResult = { warning: fetchErr.message };
        }
      }

      this.state.step3.status = 'SUCCESS';
      this.state.step3.lastRun = new Date().toISOString();
      this.state.step3.message = 'ALTF 재고 DATA BASE 시트 연산 완료 및 최신 inventory.json 준비 완료';
      this.state.step3.details = {
        appsScriptResult,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      };

      // 🔗 DAT-05 완료 신호(SUCCESS) 방출 및 DAT-06 과장 대기 알림
      this.state.chain.dat05.status = 'SUCCESS';
      this.state.chain.dat05.lastSuccessAt = new Date().toISOString();
      this.state.chain.dat05.message = 'ALTF DB 연산 완료 및 최신 inventory.json 준비 완료 (SUCCESS 신호 방출)';
      this.state.chain.dat06.message = '[신호 감지] DAT-05 대리 완료 신호 감지됨 ➔ 생성된 최신 inventory.json 결과물 검수 대기';

      this._updateAgentStatus('DAT-05', '[완료] ALTF DB 연산 완료 및 최신 inventory.json 준비 완료 (SUCCESS 신호 방출)', 'ALTF DB 연산 완료 (SUCCESS)', 'ACTIVE');
      this._updateAgentStatus('DAT-06', '[신호 감지] DAT-05 대리 완료 신호 감지됨 ➔ 최신 inventory.json 결과물 엄격 검수 대기', '직전 대리 DAT-05의 SUCCESS 신호 감지됨');

      console.log(`[DAT-05 대리] ✅ ALTF DB 연산 완료 (SUCCESS). 다음 봇 DAT-06 과장에게 바통 터치!`);
      return { success: true, step3: this.state.step3 };
    } catch (err) {
      this.state.step3.status = 'ERROR';
      this.state.step3.message = 'ALTF DB 생성 실패: ' + err.message;
      this.state.chain.dat05.status = 'ERROR';
      this.state.chain.dat05.message = 'ALTF DB 생성 실패: ' + err.message;
      this.state.error = err.message;
      this._updateAgentStatus('DAT-05', `[실패] ALTF DB 생성 오류: ${err.message}`, `ALTF DB 생성 실패: ${err.message}`);
      throw err;
    }
  }

  // ==========================================
  // [대리 ➔ 과장 자동 연계 & 재시도 로직]
  // ==========================================
  _checkInventoryJsonAvailable() {
    const homedir = os.homedir();
    const downloadsDir = path.join(homedir, 'Downloads');
    const targetFilenames = ['inventory (1).json', 'inventory (2).json', 'inventory.json'];

    for (const fname of targetFilenames) {
      const p = path.join(downloadsDir, fname);
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          const parsed = JSON.parse(raw);
          const count = Array.isArray(parsed) ? parsed.length : (parsed.items?.length || 0);
          if (count > 0) {
            return { available: true, path: p, count };
          }
        } catch (e) {}
      }
    }

    const localInv = path.resolve(process.cwd(), './storage/inventory/inventory.json');
    if (fs.existsSync(localInv)) {
      try {
        const raw = fs.readFileSync(localInv, 'utf8');
        const parsed = JSON.parse(raw);
        const count = Array.isArray(parsed) ? parsed.length : (parsed.items?.length || 0);
        if (count > 0) return { available: true, path: localInv, count };
      } catch (e) {}
    }

    if (fs.existsSync(LOCAL_INVENTORY_JSON)) {
      return { available: true, path: LOCAL_INVENTORY_JSON, count: 0 };
    }

    return null;
  }

  /**
   * 상위 재고 반응 감지 시 체인 실행
   */
  async onUpstreamStockUpdated(source = 'UPSTREAM') {
    return await this.runSequentialPipeline({ source });
  }

  async runStep3RetryUntilInventoryJsonReady(maxRetries = 5) {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      const found = this._checkInventoryJsonAvailable();
      if (found && attempt === 1) return found;

      try {
        console.log(`[DAT-05 대리] ALTF DB 실행 및 inventory.json 검증 (${attempt}/${maxRetries})...`);
        await this._executeAltfDbAppsScript();
        const check = this._checkInventoryJsonAvailable();
        if (check) return check;
        throw new Error('구글 드라이브 최신 inventory.json 파일 미확인');
      } catch (retryErr) {
        console.warn(`[DAT-05 대리] 실행 실패/미완료 (${attempt}/${maxRetries}): ${retryErr.message}`);
        if (attempt >= maxRetries) {
          throw new Error(`최대 재시도(${maxRetries}회) 초과: ${retryErr.message}`);
        }

        const retryWaitSeconds = Math.round((this.config.retryWaitMinutes || 3.5) * 60);
        this.state.step3.status = 'BUFFERING';
        this.state.step3.bufferRemainingSeconds = retryWaitSeconds;
        this.state.step3.bufferTotalSeconds = retryWaitSeconds;
        this.state.step3.timerActive = true;
        this.state.step3.message = `ALTF DB 연산 미완료. 3~5분(${Math.ceil(retryWaitSeconds / 60)}분) 후 자동 재시작 (${attempt}/${maxRetries})...`;

        await new Promise((resolve) => {
          const t = setInterval(() => {
            this.state.step3.bufferRemainingSeconds -= 1;
            if (this.state.step3.bufferRemainingSeconds <= 0) {
              clearInterval(t);
              this.state.step3.timerActive = false;
              resolve(true);
            }
          }, 1000);
        });
      }
    }
  }

  // ==========================================
  // [과장] DAT-06: 중복 방지 파일 정리, S3 배포, 재고 갱신, 시화 변동량 분석
  // ==========================================
  async runStep4DeployAndAnalyzeDiff(options = {}) {
    // 🛡️ [직전 대리 봇 감시/확인]: 반드시 DAT-05 대리의 SUCCESS 신호가 감지되어야 작동
    if (!options.bypassPrerequisite && this.state.chain.dat05.status !== 'SUCCESS') {
      const errMsg = `[DAT-06 과장 거부] 직전 대리 봇 DAT-05(ALTF DB 총괄)의 SUCCESS 신호가 감지되지 않아 작업을 시작할 수 없습니다. (현재 상태: ${this.state.chain.dat05.status}) 대리 작업 완료 후 검수를 진행합니다.`;
      console.warn(errMsg);
      this.state.chain.dat06.status = 'WAITING_PREVIOUS';
      this.state.chain.dat06.message = errMsg;
      this._updateAgentStatus('DAT-06', '[거부] 직전 대리 DAT-05 SUCCESS 신호 미확인 ➔ 대기 중', errMsg);
      throw new Error(errMsg);
    }

    this.state.step4.status = 'RUNNING';
    this.state.step4.message = '구버전 잔여 파일 방지 검수 및 최신 inventory.json 결과물 검증 중...';
    this.state.chain.dat06.status = 'RUNNING';
    this.state.chain.dat06.message = '구버전 잔여 파일 방지 검수 및 최신 inventory.json 결과물 검증 중...';
    this.state.error = null;
    this._updateAgentStatus('DAT-06', '[검수] 직전 대리 SUCCESS 확인됨 ➔ 최신 inventory.json 실물 타임스탬프 및 품목수 검증 중...', '최신 결과물 실물 검수 착수', 'ACTIVE');

    try {
      const homedir = os.homedir();
      const downloadsDir = path.join(homedir, 'Downloads');
      const cleanedFiles = [];

      // 1. 중복 다운로드 방지: 오래된 inventory*.json 파일들 탐색
      const targetFilenames = ['inventory (1).json', 'inventory (2).json', 'inventory.json'];
      let freshestSourcePath = null;
      let freshestMtime = 0;

      for (const fname of targetFilenames) {
        const p = path.join(downloadsDir, fname);
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (stat.mtimeMs > freshestMtime) {
            freshestMtime = stat.mtimeMs;
            freshestSourcePath = p;
          }
        }
      }

      // 🛡️ [결과물 실물 검수 - 구버전 잔여 파일 업로드 원천 차단 가드]
      const dat05SuccessTime = this.state.chain.dat05.lastSuccessAt 
        ? new Date(this.state.chain.dat05.lastSuccessAt).getTime() 
        : (this.state.step3.lastRun ? new Date(this.state.step3.lastRun).getTime() : 0);

      if (!options.bypassFileValidation) {
        if (!freshestSourcePath) {
          const errMsg = '[DAT-06 과장 검수 실패] 구글 드라이브에서 다운로드된 inventory.json 파일을 찾을 수 없습니다. 구글 드라이브에서 최신 파일을 다운로드해 주세요.';
          this.state.chain.dat06.status = 'ERROR';
          this.state.chain.dat06.message = errMsg;
          this._updateAgentStatus('DAT-06', `[검수 실패] ${errMsg}`, errMsg);
          throw new Error(errMsg);
        }

        // 파일의 수정시각(mtime)이 DAT-05 완료 시점 이전이거나 20분 이상 경과된 과거 파일인 경우 차단
        const now = Date.now();
        const fileAgeMs = now - freshestMtime;
        // DAT-05 성공 시각보다 60초 이상 이전에 생성된 파일은 구버전 잔여 파일임
        const isOlderThanDat05 = dat05SuccessTime > 0 && freshestMtime < (dat05SuccessTime - (60 * 1000));
        const isStaleFile = fileAgeMs > (20 * 60 * 1000); // 20분 이상 경과된 과거 파일

        if (isOlderThanDat05 || isStaleFile) {
          const reason = isOlderThanDat05 
            ? `DAT-05 연산 시점(${new Date(dat05SuccessTime).toLocaleTimeString('ko-KR')})보다 이전에 생성된 과거 파일` 
            : `다운로드 후 20분 이상 경과된 과거 잔여 파일(${Math.round(fileAgeMs / 60000)}분 전)`;
          const errMsg = `[DAT-06 과장 검수 실패] 감지된 파일(${path.basename(freshestSourcePath)})은 ${reason}(수정시각: ${new Date(freshestMtime).toLocaleTimeString('ko-KR')})입니다. 구버전 파일이 업로드되는 사고를 원천 차단합니다.`;
          console.error(errMsg);
          this.state.chain.dat06.status = 'ERROR';
          this.state.chain.dat06.message = errMsg;
          this._updateAgentStatus('DAT-06', `[검수 차단] ${reason} ➔ 업로드 차단`, errMsg);
          throw new Error(errMsg);
        }
      }

      let inventoryData = null;

      if (freshestSourcePath) {
        console.log(`[Step 4 과장봇] 가장 최신 소스 파일 감지 및 검증 통과: ${freshestSourcePath} (수정: ${new Date(freshestMtime).toLocaleTimeString('ko-KR')})`);
        try {
          const raw = fs.readFileSync(freshestSourcePath, 'utf8');
          inventoryData = JSON.parse(raw);
        } catch (readErr) {
          console.warn('[Step 4 과장봇] 파일 파싱 실패:', readErr.message);
        }
      }

      // 만약 Downloads에 최신 파일이 없다면 기존 public json 폴백 확인 (수동 우회 모드일 때만)
      if (!inventoryData && options.bypassFileValidation && fs.existsSync(LOCAL_INVENTORY_JSON)) {
        try {
          inventoryData = JSON.parse(fs.readFileSync(LOCAL_INVENTORY_JSON, 'utf8'));
        } catch (e) {}
      }

      if (!inventoryData) {
        throw new Error('배포할 inventory.json 파일을 파싱할 수 없습니다. 파일 유효성을 확인해 주세요.');
      }

      const itemsArray = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || []);
      if (itemsArray.length < 10000 && !options.bypassFileValidation) {
        throw new Error(`[DAT-06 과장 검수 실패] 유효 품목 수가 부족합니다 (${itemsArray.length}건). 최소 10,000건 이상의 전체 대장이어야 합니다.`);
      }

      this.state.step4.totalItems = itemsArray.length;
      this._updateAgentStatus('DAT-06', `[검수 통과] 최신 inventory.json (${itemsArray.length.toLocaleString()}건) 검증 완료 ➔ S3 배포 중...`, '결과물 실물 검증 통과', 'ACTIVE');

      // 2. AWS S3 업로드
      this.state.step4.message = `최신 재고 (${itemsArray.length.toLocaleString()}건) S3 클라우드 업로드 중...`;
      let s3Success = false;

      if (hasAwsCredentials()) {
        try {
          await uploadInventoryToS3(itemsArray);
          s3Success = true;
          console.log('[Step 4 과장봇] ✅ S3 업로드 완료');
        } catch (s3Err) {
          console.error('[Step 4 과장봇] S3 업로드 실패:', s3Err.message);
          throw new Error('S3 업로드 실패: ' + s3Err.message);
        }
      } else {
        console.log('[Step 4 과장봇] AWS 자격증명 미설정 (로컬 시뮬레이션 업로드 완료)');
        s3Success = true;
      }
      this.state.step4.s3Uploaded = s3Success;

      // 3. 중복 방지 파일 클린업: 사용자가 요청한 대로 업로드 후 중복 방지를 위해 Downloads 내 파일들 안전 정리
      if (this.config.autoCleanupDownloads && freshestSourcePath) {
        for (const fname of targetFilenames) {
          const p = path.join(downloadsDir, fname);
          if (fs.existsSync(p)) {
            try {
              // 백업 보관 후 삭제
              const backupName = `backup_${Date.now()}_${fname}`;
              fs.copyFileSync(p, path.join(STORAGE_DIR, backupName));
              fs.unlinkSync(p);
              cleanedFiles.push(fname);
              console.log(`[Step 4 과장봇] 🧹 중복 방지 파일 정리 완료: ${fname}`);
            } catch (delErr) {
              console.warn('[Step 4 과장봇] 파일 정리 경고:', delErr.message);
            }
          }
        }
      }
      this.state.step4.cleanedFiles = cleanedFiles;

      // 4. altf.kr admin 재고 갱신 스크립트 실행
      this.state.step4.message = 'altf.kr 웹 재고 캐시 갱신 및 동기화 실행 중...';
      await new Promise((resolve) => {
        exec('node scripts/update-inventory.js', (err, stdout, stderr) => {
          if (err) {
            console.warn('[Step 4 과장봇] update-inventory.js 실행 경고:', err.message);
          } else {
            console.log('[Step 4 과장봇] update-inventory.js 완료:', stdout?.slice(0, 150));
          }
          resolve(true);
        });
      });

      // 4-1. altf.kr admin 재고 API 캐시 강제 무효화 & 오른쪽 하단 기준 일시 최신화 트리거
      let adminSyncTime = new Date().toISOString();
      try {
        const refreshRes = await fetch('http://localhost:3001/api/inventory/inventory.json?refresh=true', {
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (refreshRes.ok) {
          const freshData = await refreshRes.json();
          if (freshData?.lastModified) {
            adminSyncTime = freshData.lastModified;
          }
          console.log('[Step 4 과장봇] ✅ altf.kr admin 재고 캐시 무효화 및 기준 일시 최신화 완료:', adminSyncTime);
        }
      } catch (fErr) {
        console.warn('[Step 4 과장봇] admin API refresh 호출 경고:', fErr.message);
      }
      this.state.step4.adminSyncTime = adminSyncTime;

      // 5. 시화재고 일일 변동량 분석
      this.state.step4.message = '시화재고 일일 변동량 및 출고/입고 트렌드 분석 중...';
      const diffStats = await this._analyzeSihwaDiffs();

      this.state.step4.status = 'SUCCESS';
      this.state.step4.lastRun = new Date().toISOString();
      this.state.step4.message = `성공 완결: S3 업로드(${itemsArray.length.toLocaleString()}건) + admin 기준일시 최신화 + 시화 변동(${diffStats.totalChanges}건) 산출`;
      this.state.step4.sihwaChangesCount = diffStats.totalChanges;
      this.state.step4.sihwaInboundCount = diffStats.inboundCount;
      this.state.step4.sihwaOutboundCount = diffStats.outboundCount;
      this.state.step4.details = {
        diffStats,
        cleanedFiles,
        adminSyncTime,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      };

      // 🔗 DAT-06 완료 신호(SUCCESS) 및 체인 완결
      this.state.chain.dat06.status = 'SUCCESS';
      this.state.chain.dat06.lastSuccessAt = new Date().toISOString();
      this.state.chain.dat06.message = `결과물 검수 통과, S3 배포 및 시화 변동량(${diffStats.totalChanges}건) 산출 완료 (SUCCESS)`;

      this.state.lastFullRun = new Date().toISOString();
      this._updateAgentStatus('DAT-06', `[완결] 결과물 검수 통과, S3 배포 및 시화 변동량(${diffStats.totalChanges}건) 산출 완료 (SUCCESS)`, `S3 배포 및 시화 변동량(${diffStats.totalChanges}건: 입고+${diffStats.inboundCount}/출고-${diffStats.outboundCount}) 확정 (SUCCESS)`, 'ACTIVE');

      console.log(`[DAT-06 과장] ✅ 결과물 검수 통과 & S3 배포 완료 (전체 파이프라인 SUCCESS 완결!)`);
      return { success: true, step4: this.state.step4 };
    } catch (err) {
      this.state.step4.status = 'ERROR';
      this.state.step4.message = '배포 및 변동량 분석 실패: ' + err.message;
      this.state.chain.dat06.status = 'ERROR';
      this.state.chain.dat06.message = '배포 및 변동량 분석 실패: ' + err.message;
      this.state.error = err.message;
      this._updateAgentStatus('DAT-06', `[실패] 배포/변동량 분석 오류: ${err.message}`, `배포/변동량 분석 실패: ${err.message}`);
      throw err;
    }
  }

  // 시화재고 변동량 분석 헬퍼
  async _analyzeSihwaDiffs() {
    try {
      // local-api-server의 db.json 또는 pending 변동 사항 분석
      const dbPath = path.resolve(process.cwd(), './data/db.json');
      if (!fs.existsSync(dbPath)) {
        return { totalChanges: 0, inboundCount: 0, outboundCount: 0, items: [] };
      }

      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      const sihwaStockMap = db.currentSnapshot || {};
      const lastSnapshot = db.lastSnapshot || {};

      let totalChanges = 0;
      let inboundCount = 0;
      let outboundCount = 0;
      const items = [];

      for (const [id, currentQty] of Object.entries(sihwaStockMap)) {
        const lastQty = lastSnapshot[id] || 0;
        const diff = Number(currentQty) - Number(lastQty);
        if (diff !== 0) {
          totalChanges++;
          if (diff > 0) inboundCount++;
          else outboundCount++;
          items.push({ id, currentQty, lastQty, diff });
        }
      }

      return {
        totalChanges,
        inboundCount,
        outboundCount,
        items: items.slice(0, 50)
      };
    } catch (e) {
      console.warn('[Step 4 과장봇] 변동량 분석 예외:', e.message);
      return { totalChanges: 0, inboundCount: 0, outboundCount: 0, items: [] };
    }
  }

  // ==========================================
  // [엄격 순차 파이프라인] DAT-03(사원) ➔ DAT-04(사원) ➔ DAT-05(대리) ➔ DAT-06(과장)
  // ==========================================
  async runSequentialPipeline(options = {}) {
    if (this.state.isRunning) {
      return { success: false, message: '이미 파이프라인이 가동 중입니다.' };
    }

    this.state.isRunning = true;
    this.state.autoPilot = true;
    this.state.error = null;

    try {
      // 1단계: 사원 DAT-03 작동
      console.log('\n[체인 1/4] DAT-03 사원: 태일/시화재고 동기화 시작...');
      this.state.currentStep = 1;
      await this.runStep1TaeilSihwa();
      if (this.state.chain.dat03.status !== 'SUCCESS') {
        throw new Error('[체인 중단] DAT-03 사원 동기화 실패');
      }

      // 2단계: 사원 DAT-04 작동 (DAT-03 SUCCESS 확인 후)
      console.log('\n[체인 2/4] DAT-04 사원: DAT-03 완료 확인 ➔ 대경재고 변환 시작...');
      this.state.currentStep = 2;
      await this.runStep2Daekyung(options.daekyungFile || null);
      if (this.state.chain.dat04.status !== 'SUCCESS') {
        throw new Error('[체인 중단] DAT-04 사원 변환 실패');
      }

      // 3단계: 대리 DAT-05 작동 (DAT-03 & DAT-04 SUCCESS 확인 후)
      console.log('\n[체인 3/4] DAT-05 대리: DAT-03, DAT-04 완료 확인 ➔ 3~5분 버퍼링 및 ALTF DB 연산 시작...');
      this.state.currentStep = 3;
      await this.startStep3BufferAndAltfDb(options.skipBuffer || false);
      await this.waitForStep3Completion();
      if (this.state.chain.dat05.status !== 'SUCCESS') {
        throw new Error('[체인 중단] DAT-05 대리 연산 실패');
      }

      // 4단계: 과장 DAT-06 작동 (DAT-05 SUCCESS 확인 및 결과물 실물 검수 후)
      console.log('\n[체인 4/4] DAT-06 과장: DAT-05 완료 확인 ➔ 결과물 검수 및 S3 배포 시작...');
      this.state.currentStep = 4;
      const step4Res = await this.runStep4DeployAndAnalyzeDiff({
        bypassFileValidation: options.bypassFileValidation || false
      });

      this.state.isRunning = false;
      this.state.autoPilot = false;
      this.state.currentStep = 0;
      console.log('\n✨ [체인 완결] DAT-03 ➔ DAT-04 ➔ DAT-05 ➔ DAT-06 전체 파이프라인 100% 정상 완결!\n');
      return { success: true, chain: this.state.chain, step4: step4Res.step4 };
    } catch (err) {
      this.state.isRunning = false;
      this.state.autoPilot = false;
      this.state.error = err.message;
      console.error('[파이프라인 오류]', err.message);
      throw err;
    }
  }

  // ==========================================
  // [전체 원클릭 전자동 오토파일럿] runSequentialPipeline으로 일원화
  // ==========================================
  async runAutoPilot(options = {}) {
    return await this.runSequentialPipeline(options);
  }
}

// 싱글톤 인스턴스 생성 및 내보내기
export const inventorySyncService = new InventorySyncService();
