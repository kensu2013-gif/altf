import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const STORAGE_DIR = path.resolve(process.cwd(), './storage/pending_lists');
const DB_PATH = path.resolve(process.cwd(), './data/db.json');
const ANALYSIS_RESULT_PATH = path.resolve(process.cwd(), './server/data/pending_orders_analysis.json');
const LEADTIME_STATS_PATH = path.resolve(process.cwd(), './server/data/leadtime_stats.json');
const LEADTIME_HISTORY_PATH = path.resolve(process.cwd(), './server/data/leadtime_history.json');
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

      // 2. 발주 매칭 및 Z열(납품처) ↔ Y열(주문번호) 연계
      const matchedOrder = poMap.get(row.orderNo);
      // Z열 납품처 우선, 없으면 ALTF DB의 customerName
      let customerName = row.deliveryTo || (matchedOrder?.customerName) || '자체/미지정';
      let poCreatedAt = null;
      let isStockOrder = row.orderNo.includes('재고') || row.project.includes('재고') || (row.deliveryTo && row.deliveryTo.includes('재고'));

      if (matchedOrder) {
        matchedCount++;
        if (!row.deliveryTo && matchedOrder.customerName) {
          customerName = matchedOrder.customerName;
        }
        poCreatedAt = matchedOrder.createdAt;
        if (matchedOrder.isStockOrder) isStockOrder = true;
      }
      if (isStockOrder) stockOrderCount++;

      // 3. 지연 및 병목 감지 (PUR-04 과장 연계 규칙)
      // 💡 [중요 규칙]: 창고입고(V열 storeDate) 완료된 품목은 출고 직전이므로 독촉 대상에서 100% 완전 제외!
      let alertReason = null;
      let alertSeverity = 'NORMAL'; // NORMAL | WARNING | CRITICAL

      if (!isCompleted) {
        // A. 생산 확정인데 절단(P열) 미착수 -> 긴급 독촉!
        if (row.workType.includes('생산') && !row.cutDate) {
          alertReason = '생산 확정되었으나 절단(P열) 미착수 상태';
          alertSeverity = 'CRITICAL';
        }
        // B. 1주일 이상 검토 정체인 경우 -> 검토 홀딩 독촉!
        else if (row.workType.includes('검토') && !row.cutDate && !row.machDate) {
          alertReason = '공정 미착수 (검토 상태 1주일 이상 장기 정체)';
          alertSeverity = 'WARNING';
        }
        // C. 절단 완료 후 후속 성형/열처리 미진행
        else if (row.cutDate && !row.formDate && !row.machDate) {
          alertReason = `절단(${row.cutDate}) 완료 후 후속 성형/가공 미진행 정체`;
          alertSeverity = 'WARNING';
        }
        // D. 성형 완료 후 열처리/가공 미진행
        else if (row.formDate && !row.heatDate && !row.calibDate && !row.machDate) {
          alertReason = `성형(${row.formDate}) 완료 후 후속 열처리/가공 정체`;
          alertSeverity = 'WARNING';
        }
        // E. 가공 완료 후 산세/창고입고 미진행
        else if (row.machDate && !row.acidDate && !row.storeDate) {
          alertReason = `가공(${row.machDate}) 완료 후 산세/창고입고 대기 정체`;
          alertSeverity = 'WARNING';
        }
        // F. 수정/재고 배정 후 가공/입고 미진행
        else if ((row.workType.includes('수정') || row.workType.includes('재고')) && !row.machDate && !row.storeDate) {
          alertReason = `${row.workType} 배정 후 가공/출고 미진행 정체`;
          alertSeverity = 'WARNING';
        }
        // G. 외주 의뢰 후 미입고
        else if (row.workType.includes('외주') && !row.storeDate) {
          alertReason = '외주 가공 의뢰 후 창고 입고 대기';
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

    this._updateAgentStatus('PUR-03', `발주 매칭 ${matchedCount}건, 공정 단계 분류 완료`, `매칭 ${matchedCount}건 / 지연 경보 ${alertItems.length}건 산출 (입고완료 제외)`, 'ACTIVE');

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
   * 💡 [핵심 원칙]: 창고 입고(V열 storeDate) 완료 건은 출고 직전 상태이므로 독촉 보고서에서 100% 완전 제외!
   * 💡 Z열(납품처)과 Y열(주문번호) 기준으로 그룹핑하여 대경벤드에 직통 전달 가능한 형식으로 작성
   */
  generateChaserReport(analyzedData) {
    this._updateAgentStatus('PUR-04', '공정 진행도 종합 분석 및 대경벤드 납기 독촉 보고서 작성 중...', '납기 독촉 리포트 작성 착수', 'ACTIVE');

    // 🚨 창고입고 완료 품목은 출고 직전이므로 독촉 대상에서 완전히 배제
    const pendingAlertItems = analyzedData.alertItems.filter(i => !i.isCompleted && !i.storeDate);

    const criticalItems = pendingAlertItems.filter(i => i.alertSeverity === 'CRITICAL');
    const warningItems = pendingAlertItems.filter(i => i.alertSeverity === 'WARNING');

    // Grouping by [주문번호(Y열) + 납품처(Z열)]
    const groupByOrder = {};
    pendingAlertItems.forEach(item => {
      const orderKey = item.orderNo || '주문번호미상';
      const destKey = item.deliveryTo || item.customerName || '자체/미지정';
      const compositeKey = `${orderKey}__${destKey}`;

      if (!groupByOrder[compositeKey]) {
        groupByOrder[compositeKey] = {
          orderNo: orderKey,
          deliveryTo: destKey,
          customerName: item.customerName || destKey,
          items: []
        };
      }
      groupByOrder[compositeKey].items.push(item);
    });

    const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

    let markdown = `# 🚨 [알트에프 구매부] 대경벤드 생산 미결 및 긴급 납기 독촉 보고서\n`;
    markdown += `**작성 일시**: ${todayStr} | **주관**: 구매부 미결관리팀 (PUR-04 과장)\n`;
    markdown += `**총 미결 항목**: ${analyzedData.totalRows.toLocaleString()}건 | **창고입고 완료(독촉 제외)**: ${(analyzedData.stageCounts?.창고입고완료 || 0).toLocaleString()}건\n`;
    markdown += `**실제 독촉 대상(공정 멈춤/지연)**: 총 **${pendingAlertItems.length}건** (긴급: ${criticalItems.length}건, 경고: ${warningItems.length}건)\n\n`;

    markdown += `> 💡 **안내**: 창고 입고(V열)가 완료된 품목은 출고 직전/완료 상태이므로 본 독촉 보고서에서 전면 제외되었으며, 현재 제조 공정이 착수되지 않았거나 중간에 멈춰 있는 품목들만 수록되었습니다.\n\n`;

    markdown += `## ⚡ [납품처 / 주문번호별] 긴급 조치 및 납기 독촉 요청 리스트\n`;
    for (const [_, group] of Object.entries(groupByOrder)) {
      markdown += `### 📌 [주문번호: ${group.orderNo}] 납품처: ${group.deliveryTo} (지연: ${group.items.length}건)\n`;
      markdown += `| LOT | 품명 | 규격(두께) | 재질 | 작업(L열) | 잔량 | 정체 단계 및 독촉 사유 |\n`;
      markdown += `| :--- | :--- | :--- | :--- | :---: | :---: | :--- |\n`;
      group.items.slice(0, 8).forEach(it => {
        const icon = it.alertSeverity === 'CRITICAL' ? '🚨' : '⚠️';
        markdown += `| ${it.lotNo} | ${it.itemName} | ${it.size} (${it.thickness}) | ${it.material} | ${it.workType} | **${it.remainQty}개** | ${icon} ${it.alertReason} |\n`;
      });
      if (group.items.length > 8) {
        markdown += `| ... | 외 ${group.items.length - 8}개 품목 추가 지연 중 | | | | | |\n`;
      }
      markdown += `\n`;
    }

    markdown += `## 💬 영업부 및 출고물류부 연계 가이드라인 (SAL-03 연계)\n`;
    markdown += `- '생산' 확정 상태이나 절단일자가 없는 ${criticalItems.length}건은 대경 공장장 직통 유선 독촉 요망.\n`;
    markdown += `- '검토' 상태에서 1주일 이상 멈춰 있는 품목은 즉각 기술 사양 확정 및 생산 라인 투입 요구.\n`;
    markdown += `- 창고입고 완료된 ${(analyzedData.stageCounts?.창고입고완료 || 0)}건은 출고물류부(LOG-01)와 즉시 연계하여 고객사 상차/배송 일정 조율.\n`;

    const report = {
      reportId: `CHASER-${Date.now()}`,
      createdAt: new Date().toISOString(),
      summary: {
        totalRows: analyzedData.totalRows,
        alertCount: pendingAlertItems.length,
        criticalCount: criticalItems.length,
        warningCount: warningItems.length,
        excludedCompletedCount: analyzedData.stageCounts?.창고입고완료 || 0
      },
      markdown,
      groupByOrder
    };

    this._updateAgentStatus('PUR-04', `대경 독촉 보고서 생성 완료 (지연 ${pendingAlertItems.length}건)`, `대경벤드 납기 독촉 리포트 작성 완료 (입고완료 제외)`, 'ACTIVE');
    return report;
  }

  /**
   * 4. 제조공정 리드타임 누적 통계 산출 (DAT-07 분석팀 봇)
   * 💡 [누적 데이터베이스]: 업로드되는 모든 엑셀 파일의 완료 데이터를 영구 누적 관리
   * 💡 [세부 분석]: 품목 카테고리뿐만 아니라 사이즈(소경/중경/대경/초대경) 및 두께(Schedule)별 세분화 통계 산출
   */
  calculateLeadtimeStats(analyzedRows, originalFilename = '알트에프 미결 리스트.xlsx') {
    this._updateAgentStatus('DAT-07', '품목·사이즈·두께별 실제 제조 리드타임 누적 통계 산출 중...', '리드타임 분석 착수', 'ACTIVE');

    // 1. 기존 영구 누적 히스토리 로드 (server/data/leadtime_history.json)
    const historyMap = new Map();
    if (fs.existsSync(LEADTIME_HISTORY_PATH)) {
      try {
        const rawHistory = JSON.parse(fs.readFileSync(LEADTIME_HISTORY_PATH, 'utf8'));
        if (Array.isArray(rawHistory)) {
          rawHistory.forEach(item => {
            if (item.key) historyMap.set(item.key, item);
          });
        }
      } catch (e) {
        console.warn('[PendingListService] leadtime_history.json 읽기 경고:', e.message);
      }
    }

    // 2. 현재 파일에서 절단일자(P)와 창고입고(V)가 존재하는 완료 품목 추출 및 누적 병합
    let newSamplesAdded = 0;
    analyzedRows.forEach(r => {
      if (!r.cutDate || !r.storeDate) return;
      const cut = this._parseDateString(r.cutDate);
      const store = this._parseDateString(r.storeDate);
      if (!cut || !store || store < cut) return;

      const diffDays = Math.round((store - cut) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0 || diffDays > 180) return; // 이상치 제외

      const category = r.itemName.toUpperCase().split('(')[0].trim() || '기타';
      const size = r.size || '미분류';
      const sizeGroup = this._normalizeSizeGroup(size);
      const thickness = r.thickness || '기본두께';

      const key = `${r.lotNo}_${r.orderNo}_${category}_${size}_${thickness}`;

      const sample = {
        key,
        lotNo: r.lotNo,
        orderNo: r.orderNo,
        deliveryTo: r.deliveryTo || r.customerName || '자체',
        itemName: r.itemName,
        category,
        size,
        sizeGroup,
        thickness,
        material: r.material,
        cutDate: r.cutDate,
        storeDate: r.storeDate,
        diffDays,
        sourceFile: originalFilename,
        updatedAt: new Date().toISOString()
      };

      if (!historyMap.has(key)) {
        newSamplesAdded++;
      }
      historyMap.set(key, sample);
    });

    const allSamples = Array.from(historyMap.values());

    // 3. 누적 히스토리 영구 저장
    fs.writeFileSync(LEADTIME_HISTORY_PATH, JSON.stringify(allSamples, null, 2), 'utf8');

    // 4. 다차원 통계 산출
    const categoryStatsMap = {};
    const sizeGroupStatsMap = {};
    const thicknessStatsMap = {};
    const detailedMatrixMap = {};

    allSamples.forEach(s => {
      // A. 카테고리 종합 통계
      if (!categoryStatsMap[s.category]) {
        categoryStatsMap[s.category] = { category: s.category, count: 0, totalDays: 0, minDays: 999, maxDays: 0, avgDays: 0 };
      }
      this._accumulateStat(categoryStatsMap[s.category], s.diffDays);

      // B. 카테고리 x 사이즈그룹 세그먼트
      const sgKey = `${s.category} / ${s.sizeGroup}`;
      if (!sizeGroupStatsMap[sgKey]) {
        sizeGroupStatsMap[sgKey] = { category: s.category, sizeGroup: s.sizeGroup, count: 0, totalDays: 0, minDays: 999, maxDays: 0, avgDays: 0 };
      }
      this._accumulateStat(sizeGroupStatsMap[sgKey], s.diffDays);

      // C. 카테고리 x 두께
      const thkKey = `${s.category} / ${s.thickness}`;
      if (!thicknessStatsMap[thkKey]) {
        thicknessStatsMap[thkKey] = { category: s.category, thickness: s.thickness, count: 0, totalDays: 0, minDays: 999, maxDays: 0, avgDays: 0 };
      }
      this._accumulateStat(thicknessStatsMap[thkKey], s.diffDays);

      // D. 상세 복합 매트릭스 (Category x Size x Thickness)
      const detKey = `${s.category}__${s.size}__${s.thickness}`;
      if (!detailedMatrixMap[detKey]) {
        detailedMatrixMap[detKey] = { category: s.category, size: s.size, thickness: s.thickness, count: 0, totalDays: 0, minDays: 999, maxDays: 0, avgDays: 0 };
      }
      this._accumulateStat(detailedMatrixMap[detKey], s.diffDays);
    });

    const statsResult = {
      lastUpdated: new Date().toISOString(),
      sampleCount: allSamples.length,
      newSamplesAdded,
      categoryStats: Object.values(categoryStatsMap),
      sizeGroupStats: Object.values(sizeGroupStatsMap),
      thicknessStats: Object.values(thicknessStatsMap),
      detailedMatrix: Object.values(detailedMatrixMap)
    };

    fs.writeFileSync(LEADTIME_STATS_PATH, JSON.stringify(statsResult, null, 2), 'utf8');
    this._updateAgentStatus('DAT-07', `누적 ${allSamples.length}건 표본 기반 리드타임 벤치마크(사이즈·두께별) 갱신 완료`, `견적팀 공급용 리드타임 누적 통계 DB 저장 완료`, 'ACTIVE');

    return statsResult;
  }

  _accumulateStat(target, days) {
    target.count++;
    target.totalDays += days;
    if (days < target.minDays) target.minDays = days;
    if (days > target.maxDays) target.maxDays = days;
    target.avgDays = Math.round((target.totalDays / target.count) * 10) / 10;
  }

  _normalizeSizeGroup(sizeStr) {
    if (!sizeStr) return '미분류';
    const numMatch = String(sizeStr).match(/(\d+)/);
    if (!numMatch) return '기타 규격';
    const val = parseInt(numMatch[1], 10);
    if (val <= 50) return '소경 (50A 이하 / 2" 이하)';
    if (val <= 150) return '중경 (65A~150A / 2-1/2"~6")';
    if (val <= 350) return '대경 (200A~350A / 8"~14")';
    return '초대경 (400A 이상 / 16" 이상)';
  }

  /**
   * 💡 견적팀(SLE) 연계: 품목/사이즈/두께 입력 시 최적 예상 제조 리드타임 조회
   */
  estimateLeadtime(category, size, thickness) {
    const stats = this.getLeadtimeStats();
    if (!stats) return { avgDays: 25, confidence: 'DEFAULT' };

    const catUpper = String(category || '').toUpperCase().split('(')[0].trim();
    const sizeStr = String(size || '').trim();
    const thkStr = String(thickness || '').trim();

    // 1. 상세 매트릭스 정확 일치
    if (stats.detailedMatrix) {
      const match = stats.detailedMatrix.find(m => m.category === catUpper && m.size === sizeStr && m.thickness === thkStr);
      if (match) return { avgDays: match.avgDays, minDays: match.minDays, maxDays: match.maxDays, count: match.count, confidence: 'EXACT_SPEC' };
    }

    // 2. 사이즈그룹 일치
    const sizeGroup = this._normalizeSizeGroup(sizeStr);
    if (stats.sizeGroupStats) {
      const sgMatch = stats.sizeGroupStats.find(s => s.category === catUpper && s.sizeGroup === sizeGroup);
      if (sgMatch) return { avgDays: sgMatch.avgDays, minDays: sgMatch.minDays, maxDays: sgMatch.maxDays, count: sgMatch.count, confidence: 'SIZE_GROUP' };
    }

    // 3. 두께 일치
    if (stats.thicknessStats) {
      const thkMatch = stats.thicknessStats.find(t => t.category === catUpper && t.thickness === thkStr);
      if (thkMatch) return { avgDays: thkMatch.avgDays, minDays: thkMatch.minDays, maxDays: thkMatch.maxDays, count: thkMatch.count, confidence: 'THICKNESS' };
    }

    // 4. 카테고리 종합 평균
    if (stats.categoryStats) {
      const catMatch = stats.categoryStats.find(c => c.category === catUpper);
      if (catMatch) return { avgDays: catMatch.avgDays, minDays: catMatch.minDays, maxDays: catMatch.maxDays, count: catMatch.count, confidence: 'CATEGORY_AVG' };
    }

    return { avgDays: 25, confidence: 'DEFAULT' };
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

    // 4. 누적 리드타임 통계 산출 (DAT-07 분석팀 과장)
    const leadtimeStats = this.calculateLeadtimeStats(analyzed.rows, originalFilename);

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
