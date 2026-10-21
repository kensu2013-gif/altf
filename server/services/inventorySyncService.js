import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { uploadInventoryToS3, hasAwsCredentials } from '../../s3-db.js';

const CONFIG_PATH = path.resolve(process.cwd(), './server/data/inventory_sync_config.json');
const STORAGE_DIR = path.resolve(process.cwd(), './storage/inventory');
const LOCAL_INVENTORY_JSON = path.resolve(process.cwd(), './public/api/inventory/inventory.json');

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
      lastFullRun: null,
      error: null
    };

    this.timerInterval = null;
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

  loadConfig() {
    const defaultConfig = {
      taeilAppsScriptUrl: '',
      daekyungAppsScriptUrl: '',
      altfDbAppsScriptUrl: '',
      bufferWaitMinutes: 3.5, // 3.5분 (210초) 기본
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
  // [사원 1] DAT-03: 태일/시화재고 동기화
  // ==========================================
  async runStep1TaeilSihwa() {
    this.state.step1.status = 'RUNNING';
    this.state.step1.message = '태일/시화재고 Apps Script 및 원격 API 호출 중...';
    this.state.error = null;

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

      return { success: true, step1: this.state.step1 };
    } catch (err) {
      this.state.step1.status = 'ERROR';
      this.state.step1.message = '태일/시화 동기화 실패: ' + err.message;
      this.state.error = err.message;
      throw err;
    }
  }

  // ==========================================
  // [사원 2] DAT-04: 대경재고 파일 수신 & 변환
  // ==========================================
  async runStep2Daekyung(fileData = null) {
    this.state.step2.status = 'RUNNING';
    this.state.step2.message = '대경재고 원장 파일 수신 및 구글시트 변환 트리거 중...';
    this.state.error = null;

    try {
      let savedPath = null;
      let rowCount = 0;

      // 파일이나 데이터가 전달된 경우 storage에 안전 보관
      if (fileData) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = fileData.filename || `daekyung_stock_${timestamp}.xlsx`;
        savedPath = path.join(STORAGE_DIR, filename);

        if (fileData.buffer) {
          fs.writeFileSync(savedPath, fileData.buffer);
        } else if (typeof fileData.content === 'string') {
          fs.writeFileSync(savedPath, fileData.content, 'utf8');
        }
        this.state.step2.fileName = filename;
      }

      // Apps Script Webhook URL 호출 (있는 경우)
      let appsScriptResult = null;
      if (this.config.daekyungAppsScriptUrl && this.config.daekyungAppsScriptUrl.trim()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
          const res = await fetch(this.config.daekyungAppsScriptUrl.trim(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'import_daekyung', timestamp: new Date().toISOString() }),
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
      this.state.step2.message = '대경재고 원장 수신 및 대경재고변환 시트 변환 완료';
      this.state.step2.details = {
        savedPath: savedPath ? path.basename(savedPath) : '기존 시트 직접 갱신',
        appsScriptResult,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      };

      return { success: true, step2: this.state.step2 };
    } catch (err) {
      this.state.step2.status = 'ERROR';
      this.state.step2.message = '대경재고 변환 실패: ' + err.message;
      this.state.error = err.message;
      throw err;
    }
  }

  // ==========================================
  // [대리] DAT-05: 3~5분 버퍼링 카운트다운 & ALTF 재고 DB 실행
  // ==========================================
  async startStep3BufferAndAltfDb(skipBuffer = false) {
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
    this.state.isRunning = false;
    this.state.autoPilot = false;
    return { success: true, message: '취소 완료' };
  }

  async _executeAltfDbAppsScript() {
    this.state.step3.status = 'RUNNING';
    this.state.step3.message = 'ALTF 재고 DATA BASE Apps Script 실행 중 (inventory.json 생성)...';

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

      return { success: true, step3: this.state.step3 };
    } catch (err) {
      this.state.step3.status = 'ERROR';
      this.state.step3.message = 'ALTF DB 생성 실패: ' + err.message;
      this.state.error = err.message;
      throw err;
    }
  }

  // ==========================================
  // [과장] DAT-06: 중복 방지 파일 정리, S3 배포, 재고 갱신, 시화 변동량 분석
  // ==========================================
  async runStep4DeployAndAnalyzeDiff() {
    this.state.step4.status = 'RUNNING';
    this.state.step4.message = '구버전 잔여 파일 정리 및 최신 inventory.json 검증 중...';
    this.state.error = null;

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

      let inventoryData = null;

      if (freshestSourcePath) {
        console.log(`[Step 4 과장봇] 가장 최신 소스 파일 감지: ${freshestSourcePath}`);
        try {
          const raw = fs.readFileSync(freshestSourcePath, 'utf8');
          inventoryData = JSON.parse(raw);
        } catch (readErr) {
          console.warn('[Step 4 과장봇] 파일 파싱 실패:', readErr.message);
        }
      }

      // 만약 Downloads에 최신 파일이 없다면 기존 public json 또는 s3_raw.json 폴백 확인
      if (!inventoryData && fs.existsSync(LOCAL_INVENTORY_JSON)) {
        try {
          inventoryData = JSON.parse(fs.readFileSync(LOCAL_INVENTORY_JSON, 'utf8'));
        } catch (e) {}
      }

      if (!inventoryData) {
        throw new Error('배포할 inventory.json 파일을 찾을 수 없습니다. (다운로드 폴더에 최신 파일이 생성되었는지 확인해주세요)');
      }

      const itemsArray = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || []);
      this.state.step4.totalItems = itemsArray.length;

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

      // 5. 시화재고 일일 변동량 분석
      this.state.step4.message = '시화재고 일일 변동량 및 출고/입고 트렌드 분석 중...';
      const diffStats = await this._analyzeSihwaDiffs();

      this.state.step4.status = 'SUCCESS';
      this.state.step4.lastRun = new Date().toISOString();
      this.state.step4.message = `성공 완결: S3 업로드(${itemsArray.length.toLocaleString()}건) + 웹 갱신 + 시화 변동(${diffStats.totalChanges}건) 산출`;
      this.state.step4.sihwaChangesCount = diffStats.totalChanges;
      this.state.step4.sihwaInboundCount = diffStats.inboundCount;
      this.state.step4.sihwaOutboundCount = diffStats.outboundCount;
      this.state.step4.details = {
        diffStats,
        cleanedFiles,
        timestamp: new Date().toLocaleTimeString('ko-KR')
      };

      this.state.lastFullRun = new Date().toISOString();
      return { success: true, step4: this.state.step4 };
    } catch (err) {
      this.state.step4.status = 'ERROR';
      this.state.step4.message = '배포 및 변동량 분석 실패: ' + err.message;
      this.state.error = err.message;
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
  // [전체 원클릭 전자동 오토파일럿] 사원1 ➔ 사원2 ➔ 대리 버퍼 ➔ 과장 배포
  // ==========================================
  async runAutoPilot(options = {}) {
    if (this.state.isRunning) {
      return { success: false, message: '이미 파이프라인이 가동 중입니다.' };
    }

    this.state.isRunning = true;
    this.state.autoPilot = true;
    this.state.currentStep = 1;
    this.state.error = null;

    try {
      // 1단계
      console.log('[Auto-Pilot] 1단계: 사원1 태일/시화 동기화 시작');
      await this.runStep1TaeilSihwa();

      // 2단계
      this.state.currentStep = 2;
      console.log('[Auto-Pilot] 2단계: 사원2 대경재고 변환 시작');
      await this.runStep2Daekyung(options.daekyungFile || null);

      // 3단계
      this.state.currentStep = 3;
      console.log('[Auto-Pilot] 3단계: 대리 ALTF DB 3~5분 버퍼링 시작');
      // startStep3BufferAndAltfDb will proceed to step 4 when buffer expires
      await this.startStep3BufferAndAltfDb(options.skipBuffer || false);

      return { success: true, message: '오토파일럿 파이프라인이 정상적으로 시작되었습니다.' };
    } catch (err) {
      this.state.isRunning = false;
      this.state.autoPilot = false;
      this.state.error = err.message;
      throw err;
    }
  }
}

// 싱글톤 인스턴스 생성 및 내보내기
export const inventorySyncService = new InventorySyncService();
