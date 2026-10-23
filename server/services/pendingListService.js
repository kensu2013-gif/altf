import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const STORAGE_DIR = path.resolve(process.cwd(), './storage/pending_lists');
const DB_PATH = path.resolve(process.cwd(), './data/db.json');
const ANALYSIS_RESULT_PATH = path.resolve(process.cwd(), './server/data/pending_orders_analysis.json');
const LEADTIME_STATS_PATH = path.resolve(process.cwd(), './server/data/leadtime_stats.json');
const AGENTS_JSON_PATH = path.resolve(process.cwd(), './server/data/agents.json');

export class PendingListService {
  constructor() {
    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
    const sDataDir = path.resolve(process.cwd(), './server/data');
    if (!fs.existsSync(sDataDir)) fs.mkdirSync(sDataDir, { recursive: true });
  }

  // 🤖 에이전트 오피스 대시보드(agents.json) 실시간 상태 및 로그 동기화
  _updateAgentStatus(code, taskMessage, logMessage = null, newStatus = null) {
    try {
      if (!fs.existsSync(AGENTS_JSON_PATH)) return;
      const raw = fs.readFileSync(AGENTS_JSON_PATH, 'utf8');
      const agents = JSON.parse(raw);
      let updated = false;

      for (const ag of agents) {
        if (ag.code === code) {
          if (taskMessage && ag.status !== 'OFFLINE' && ag.status !== 'OFF') ag.currentTask = taskMessage;
          if (newStatus && ag.status !== 'OFFLINE' && ag.status !== 'OFF') ag.status = newStatus;
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
      console.warn(`[PendingListService] _updateAgentStatus(${code}) warning:`, e.message);
    }
  }

  /**
   * 1. 엑셀 파일 열기 및 전 행/열 데이터 정밀 파싱 (PUR-02 사원봇)
   */
  parsePendingExcel(bufferOrPath) {
    this._updateAgentStatus('PUR-02', '대경 미결 리스트 엑셀 전 행/열 정밀 파싱 중...', '미결 엑셀 파싱 착수', 'ACTIVE');
    const wb = typeof bufferOrPath === 'string'
      ? XLSX.readFile(bufferOrPath)
      : XLSX.read(bufferOrPath, { type: 'buffer' });

    const sheetName = wb.SheetNames.find(n => n.includes('수주') || n.includes('미결')) || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);

    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:AC700');
    const rows = [];

    // Row 2 is Header, Data starts at Row 3 (1-based index)
    for (let r = 3; r <= range.e.r + 1; r++) {
      const lotNo = sheet['A' + r]?.v;
      if (!lotNo || String(lotNo).trim() === '') continue;

      const row = {
        rowIdx: r,
        lotNo: String(sheet['A' + r]?.v || '').trim(),
        no: sheet['B' + r]?.v ?? '',
        itemName: String(sheet['C' + r]?.v || '').trim(),
        material: String(sheet['D' + r]?.v || '').trim(),
        thickness: String(sheet['E' + r]?.v || '').trim(),
        status: String(sheet['F' + r]?.v || '').trim(), // ERW / SML'S
        size: String(sheet['G' + r]?.v || '').trim(),
        orderQty: Number(sheet['H' + r]?.v) || 0,
        remainQty: Number(sheet['I' + r]?.v) || 0,
        releaseQty: Number(sheet['J' + r]?.v) || 0,
        packing: String(sheet['K' + r]?.v || '').trim(),
        workType: String(sheet['L' + r]?.v || '').trim(), // 검토 / 생산 / 재고 / 수정 등
        processNo: String(sheet['M' + r]?.v || '').trim(),
        orderCompany: String(sheet['N' + r]?.v || '').trim(),
        inboundDate: this._formatExcelDate(sheet['O' + r]?.v),
        cutDate: this._formatExcelDate(sheet['P' + r]?.v),
        formDate: this._formatExcelDate(sheet['Q' + r]?.v),
        heatDate: this._formatExcelDate(sheet['R' + r]?.v),
        calibDate: this._formatExcelDate(sheet['S' + r]?.v),
        machDate: this._formatExcelDate(sheet['T' + r]?.v),
        acidDate: this._formatExcelDate(sheet['U' + r]?.v),
        storeDate: this._formatExcelDate(sheet['V' + r]?.v),
        sandDate: this._formatExcelDate(sheet['W' + r]?.v),
        ndeDate: this._formatExcelDate(sheet['X' + r]?.v),
        orderNo: String(sheet['Y' + r]?.v || '').trim(), // 우리 발주번호 매칭 키
        deliveryTo: String(sheet['Z' + r]?.v || '').trim(),
        project: String(sheet['AA' + r]?.v || '').trim(),
        customerReq: String(sheet['AB' + r]?.v || '').trim(),
        notes: String(sheet['AC' + r]?.v || '').trim()
      };

      rows.push(row);
    }

    this._updateAgentStatus('PUR-02', `대경 미결 리스트 ${rows.length}행 파싱 완료`, `${rows.length}개 유효 품목 행 파싱 성공`, 'ACTIVE');
    return { sheetName, totalRows: rows.length, rows };
  }

  _formatExcelDate(val) {
    if (!val) return '';
    if (typeof val === 'number') {
      // Excel serial date number
      const date = new Date((val - (25567 + 2)) * 86400 * 1000);
      return !isNaN(date.getTime()) ? date.toISOString().slice(2, 10).replace(/-/g, '.') : String(val);
    }
    return String(val).trim();
  }

  /**
   * 2. 주문번호(Y열) ↔ 우리 발주번호 매칭 및 공정 진행도 판단 (PUR-03 대리봇)
   */
  matchAndAnalyzeProcesses(parsedRows) {
    this._updateAgentStatus('PUR-03', '주문번호(Y열) ↔ 우리 발주번호 매칭 및 공정 단계 추적 중...', '발주번호 및 공정 매칭 착수', 'ACTIVE');
    
    // Load orders from db.json
    let orders = [];
    if (fs.existsSync(DB_PATH)) {
      try {
        const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        orders = db.orders || [];
      } catch (e) {
        console.warn('[PendingListService] db.json 읽기 실패:', e.message);
      }
    }

    const poMap = new Map();
    orders.forEach(o => {
      if (o.poNumber) {
        poMap.set(o.poNumber.trim(), o);
      }
      if (o.id) {
        poMap.set(o.id.trim(), o);
      }
    });

    const analyzedRows = [];
    const stageCounts = {
      검토정체: 0,
      절단대기: 0,
      절단완료: 0,
      성형완료: 0,
      열처리완료: 0,
      교정완료: 0,
      가공완료: 0,
      산세완료: 0,
      창고입고완료: 0
    };

    const alertItems = [];
    let matchedCount = 0;
    let stockOrderCount = 0;

    parsedRows.forEach(row => {
      // 1. 공정 단계 및 진행률 산출
      let stage = '검토단계';
      let progressPct = 0;
      let isCompleted = false;

      if (row.storeDate) {
        stage = '창고입고완료';
        progressPct = 100;
        isCompleted = true;
        stageCounts.창고입고완료++;
      } else if (row.acidDate) {
        stage = '산세완결';
        progressPct = 90;
        stageCounts.산세완료++;
      } else if (row.machDate) {
        stage = '가공완료';
        progressPct = 75;
        stageCounts.가공완료++;
      } else if (row.calibDate) {
        stage = '교정완료';
        progressPct = 60;
        stageCounts.교정완료++;
      } else if (row.heatDate) {
        stage = '열처리완료';
        progressPct = 50;
        stageCounts.열처리완료++;
      } else if (row.formDate) {
        stage = '성형완료';
        progressPct = 35;
        stageCounts.성형완료++;
      } else if (row.cutDate) {
        stage = '절단완료';
        progressPct = 20;
        stageCounts.절단완료++;
      } else {
        const isSkipFrontProcess = row.workType.includes('재고') || row.workType.includes('수정');
        if (isSkipFrontProcess) {
          stage = '재고/가공대기';
          progressPct = 15;
          stageCounts.검토정체++;
        } else if (row.workType.includes('생산')) {
          stage = '절단대기';
          progressPct = 5;
          stageCounts.절단대기++;
        } else {
          stage = '검토정체';
          progressPct = 0;
          stageCounts.검토정체++;
        }
      }

      // 2. 발주 매칭
      const matchedOrder = poMap.get(row.orderNo);
      let customerName = '자체/미지정';
      let poCreatedAt = null;
      let isStockOrder = row.orderNo.includes('재고') || row.project.includes('재고');

      if (matchedOrder) {
        matchedCount++;
        customerName = matchedOrder.customerName || '고객사 매칭';
        poCreatedAt = matchedOrder.createdAt;
        if (matchedOrder.isStockOrder) isStockOrder = true;
      }
      if (isStockOrder) stockOrderCount++;

      // 3. 지연 및 병목 감지 (PUR-04 과장 연계 규칙)
      let alertReason = null;
      let alertSeverity = 'NORMAL'; // NORMAL | WARNING | CRITICAL

      if (!isCompleted) {
        // A. 생산으로 넘겼으나 절단일자가 없는 경우
        if (row.workType.includes('생산') && !row.cutDate) {
          alertReason = '생산 확정되었으나 절단 미착수 상태';
          alertSeverity = 'CRITICAL';
        }
        // B. 1주일 이상 검토 정체인 경우
        else if (row.workType.includes('검토') && !row.cutDate && !row.machDate) {
          alertReason = '1주일 이상 공정 미착수 (검토 상태 정체)';
          alertSeverity = 'WARNING';
        }
        // C. 이전 공정 완료 후 장기 멈춤
        else if (row.formDate && !row.heatDate && !row.machDate) {
          alertReason = '성형 완료 후 열처리/가공 10일 이상 정체';
          alertSeverity = 'WARNING';
        }
      }

      const analyzedItem = {
        ...row,
        stage,
        progressPct,
        isCompleted,
        matched: !!matchedOrder,
        customerName,
        poCreatedAt,
        isStockOrder,
        alertReason,
        alertSeverity
      };

      analyzedRows.push(analyzedItem);
      if (alertReason) {
        alertItems.push(analyzedItem);
      }
    });

    this._updateAgentStatus('PUR-03', `발주 매칭 ${matchedCount}건, 공정 단계 분류 완료`, `매칭 ${matchedCount}건 / 지연 경보 ${alertItems.length}건 산출`, 'ACTIVE');

    return {
      totalRows: analyzedRows.length,
      matchedCount,
      unmatchedCount: analyzedRows.length - matchedCount,
      stockOrderCount,
      stageCounts,
      alertCount: alertItems.length,
      alertItems,
      rows: analyzedRows
    };
  }

  /**
   * 3. 대경벤드 납기 독촉 보고서 생성 (PUR-04 과장봇)
   */
  generateChaserReport(analyzedData) {
    this._updateAgentStatus('PUR-04', '공정 진행도 종합 분석 및 대경벤드 납기 독촉 보고서 작성 중...', '납기 독촉 리포트 작성 착수', 'ACTIVE');

    const criticalItems = analyzedData.alertItems.filter(i => i.alertSeverity === 'CRITICAL');
    const warningItems = analyzedData.alertItems.filter(i => i.alertSeverity === 'WARNING');

    // Group critical items by orderNo
    const groupByOrder = {};
    analyzedData.alertItems.forEach(item => {
      const key = item.orderNo || '주문번호미상';
      if (!groupByOrder[key]) {
        groupByOrder[key] = {
          orderNo: key,
          customerName: item.customerName,
          items: []
        };
      }
      groupByOrder[key].items.push(item);
    });

    const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

    let markdown = `# 🚨 [알트에프 구매부] 대경벤드 생산 미결 및 긴급 납기 독촉 보고서\n`;
    markdown += `**작성 일시**: ${todayStr} | **주관**: 구매부 미결관리팀 (PUR-04 과장)\n`;
    markdown += `**총 미결 항목**: ${analyzedData.totalRows.toLocaleString()}건 | **납기 지연/정체 경보**: 총 ${analyzedData.alertCount}건 (긴급: ${criticalItems.length}건, 경고: ${warningItems.length}건)\n\n`;

    markdown += `## 📊 1. 공정 단계별 미결 현황\n`;
    markdown += `| 공정 단계 | 품목 수 | 진행 상태 |\n`;
    markdown += `| :--- | :---: | :--- |\n`;
    for (const [st, cnt] of Object.entries(analyzedData.stageCounts)) {
      markdown += `| **${st}** | ${cnt}건 | ${st.includes('완료') ? '✅ 정상/완료' : '⚠️ 공정 진행 대기'} |\n`;
    }
    markdown += `\n`;

    markdown += `## ⚡ 2. 대경벤드 긴급 조치 및 납기 독촉 요청 리스트 (Top 발주건)\n`;
    let count = 0;
    for (const [ordNo, group] of Object.entries(groupByOrder)) {
      count++;
      if (count > 15) break; // 상위 15개 발주건 표출
      markdown += `### 📌 발주번호: ${ordNo} (고객사: ${group.customerName}) - 지연 ${group.items.length}건\n`;
      markdown += `| LOT | 품명 | 규격 | 재질 | 작업상태 | 잔량 | 정체 사유 |\n`;
      markdown += `| :--- | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
      group.items.slice(0, 5).forEach(it => {
        markdown += `| ${it.lotNo} | ${it.itemName} | ${it.size} (${it.thickness}) | ${it.material} | ${it.workType} | **${it.remainQty}개** | 🚨 ${it.alertReason} |\n`;
      });
      if (group.items.length > 5) {
        markdown += `| ... | 외 ${group.items.length - 5}개 품목 추가 지연 중 | | | | | |\n`;
      }
      markdown += `\n`;
    }

    markdown += `## 💬 3. 영업부 및 고객 대응 가이드라인 (SAL-03 연계)\n`;
    markdown += `- 고객사 긴급 주문건 중 '생산' 상태이나 절단일자가 없는 품목은 대경 공장장 직통 유선 독촉 요망.\n`;
    markdown += `- '재고' 상태 품목(${analyzedData.stageCounts.창고입고완료 || 0}건 창고입고 확인)은 즉시 출고물류부(LOG)와 연계하여 고객사 출고 일정 조율 가능.\n`;

    const report = {
      reportId: `CHASER-${Date.now()}`,
      createdAt: new Date().toISOString(),
      summary: {
        totalRows: analyzedData.totalRows,
        alertCount: analyzedData.alertCount,
        criticalCount: criticalItems.length,
        warningCount: warningItems.length
      },
      markdown,
      groupByOrder
    };

    this._updateAgentStatus('PUR-04', `대경 독촉 보고서 생성 완료 (지연 ${analyzedData.alertCount}건)`, `대경벤드 납기 독촉 리포트 작성 완료`, 'ACTIVE');
    return report;
  }

  /**
   * 4. 제조공정 리드타임 누적 통계 산출 (DAT-07 분석팀 봇)
   */
  calculateLeadtimeStats(analyzedRows) {
    this._updateAgentStatus('DAT-07', '공정별 실제 제조 리드타임(소요 일수) 통계 산출 중...', '리드타임 분석 착수', 'ACTIVE');

    const completedItems = analyzedRows.filter(r => r.storeDate && r.cutDate);
    const itemTypeStats = {};

    completedItems.forEach(r => {
      const cut = this._parseDateString(r.cutDate);
      const store = this._parseDateString(r.storeDate);
      if (!cut || !store || store < cut) return;

      const diffDays = Math.round((store - cut) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0 || diffDays > 120) return; // 이상치 제거

      const itemCategory = r.itemName.toUpperCase().split('(')[0].trim() || '기타';
      if (!itemTypeStats[itemCategory]) {
        itemTypeStats[itemCategory] = {
          category: itemCategory,
          count: 0,
          totalDays: 0,
          minDays: 999,
          maxDays: 0,
          avgDays: 0
        };
      }

      const stat = itemTypeStats[itemCategory];
      stat.count++;
      stat.totalDays += diffDays;
      if (diffDays < stat.minDays) stat.minDays = diffDays;
      if (diffDays > stat.maxDays) stat.maxDays = diffDays;
      stat.avgDays = Math.round((stat.totalDays / stat.count) * 10) / 10;
    });

    const statsResult = {
      lastUpdated: new Date().toISOString(),
      sampleCount: completedItems.length,
      categoryStats: Object.values(itemTypeStats)
    };

    fs.writeFileSync(LEADTIME_STATS_PATH, JSON.stringify(statsResult, null, 2), 'utf8');
    this._updateAgentStatus('DAT-07', `품목별 제조 리드타임 ${Object.keys(itemTypeStats).length}개 카테고리 통계 산출 완료`, `견적팀 공급용 리드타임 통계 DB 저장 완료`, 'ACTIVE');

    return statsResult;
  }

  _parseDateString(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.replace(/[^0-9.]/g, '').split('.');
    if (parts.length < 3) return null;
    let yy = parseInt(parts[0], 10);
    let mm = parseInt(parts[1], 10) - 1;
    let dd = parseInt(parts[2], 10);
    if (yy < 100) yy += 2000;
    const d = new Date(yy, mm, dd);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  /**
   * 🚀 전체 통합 실행 파이프라인 (수신 ➔ 파싱 ➔ 매칭 ➔ 독촉장 ➔ 리드타임)
   */
  async processPendingListPipeline(bufferOrPath, originalFilename = '알트에프 미결 리스트.xlsx') {
    console.log(`\n======================================================`);
    console.log(`🚀 [구매부 미결관리팀] 대경 미결 리스트 전체 분석 파이프라인 시작`);
    console.log(`[파일]: ${originalFilename}`);
    console.log(`======================================================\n`);

    // 0. 파일 아카이빙 (PUR-01 수신봇)
    this._updateAgentStatus('PUR-01', `신규 미결 엑셀 수신: ${originalFilename}`, `미결 파일 접수 및 아카이빙`, 'ACTIVE');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(STORAGE_DIR, `pending_${timestamp}_${originalFilename}`);
    if (typeof bufferOrPath === 'string') {
      fs.copyFileSync(bufferOrPath, archivePath);
    } else {
      fs.writeFileSync(archivePath, bufferOrPath);
    }

    // 1. 파싱 (PUR-02 사원)
    const parsed = this.parsePendingExcel(archivePath);

    // 2. 발주 매칭 및 공정 분석 (PUR-03 대리)
    const analyzed = this.matchAndAnalyzeProcesses(parsed.rows);

    // 3. 독촉 보고서 생성 (PUR-04 과장)
    const chaserReport = this.generateChaserReport(analyzed);

    // 4. 리드타임 누적 통계 산출 (DAT-07 분석팀 과장)
    const leadtimeStats = this.calculateLeadtimeStats(analyzed.rows);

    // 5. 영업부 연계 브리핑 생성 (SAL-03 대리)
    this._updateAgentStatus('SAL-03', `고객사별 미결 공정 상태 ${analyzed.matchedCount}건 동기화 완료`, `고객 납기 안내 준비 완료`, 'ACTIVE');

    // 6. 결과 전체 저장
    const finalResult = {
      timestamp: new Date().toISOString(),
      filename: originalFilename,
      archivePath: path.basename(archivePath),
      summary: {
        totalRows: analyzed.totalRows,
        matchedCount: analyzed.matchedCount,
        unmatchedCount: analyzed.unmatchedCount,
        stockOrderCount: analyzed.stockOrderCount,
        alertCount: analyzed.alertCount
      },
      stageCounts: analyzed.stageCounts,
      chaserReport,
      leadtimeStats,
      rows: analyzed.rows
    };

    fs.writeFileSync(ANALYSIS_RESULT_PATH, JSON.stringify(finalResult, null, 2), 'utf8');

    console.log(`\n✅ [구매부 미결관리팀] 파이프라인 완료: 총 ${analyzed.totalRows}행 분석, 발주 매칭 ${analyzed.matchedCount}건, 지연 경보 ${analyzed.alertCount}건, 리포트 생성 완료!\n`);
    return finalResult;
  }

  getLatestAnalysis() {
    if (fs.existsSync(ANALYSIS_RESULT_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(ANALYSIS_RESULT_PATH, 'utf8'));
      } catch (e) {
        console.warn('[PendingListService] getLatestAnalysis read warning:', e.message);
      }
    }
    return null;
  }

  getLeadtimeStats() {
    if (fs.existsSync(LEADTIME_STATS_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(LEADTIME_STATS_PATH, 'utf8'));
      } catch (e) {
        console.warn('[PendingListService] getLeadtimeStats read warning:', e.message);
      }
    }
    return null;
  }

  findLatestPendingExcel() {
    const cwd = process.cwd();
    try {
      // 1. 루트 디렉토리의 미결 엑셀 파일 우선 검색
      const rootFiles = fs.readdirSync(cwd).filter(f => !f.startsWith('.') && f.includes('미결') && (f.endsWith('.xlsx') || f.endsWith('.xls')));
      if (rootFiles.length > 0) {
        const sorted = rootFiles.map(f => ({
          name: f,
          fullPath: path.join(cwd, f),
          mtime: fs.statSync(path.join(cwd, f)).mtimeMs
        })).sort((a, b) => b.mtime - a.mtime);
        return sorted[0].fullPath;
      }

      // 2. 스토리지 디렉토리 검색
      if (fs.existsSync(STORAGE_DIR)) {
        const storageFiles = fs.readdirSync(STORAGE_DIR).filter(f => !f.startsWith('.') && (f.endsWith('.xlsx') || f.endsWith('.xls')));
        if (storageFiles.length > 0) {
          const sorted = storageFiles.map(f => ({
            name: f,
            fullPath: path.join(STORAGE_DIR, f),
            mtime: fs.statSync(path.join(STORAGE_DIR, f)).mtimeMs
          })).sort((a, b) => b.mtime - a.mtime);
          return sorted[0].fullPath;
        }
      }
    } catch (e) {
      console.warn('[PendingListService] findLatestPendingExcel warning:', e.message);
    }
    return null;
  }

  async syncLatest() {
    const latestFile = this.findLatestPendingExcel();
    if (!latestFile) {
      throw new Error('처리할 미결 리스트 엑셀 파일을 찾을 수 없습니다.');
    }
    return await this.processPendingListPipeline(latestFile, path.basename(latestFile));
  }
}

export const pendingListService = new PendingListService();
