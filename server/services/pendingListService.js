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
    let excludedNonProductCount = 0;

    // Row 2 is Header, Data starts at Row 3 (1-based index)
    for (let r = 3; r <= range.e.r + 1; r++) {
      const lotNo = sheet['A' + r]?.v;
      if (!lotNo || String(lotNo).trim() === '') continue;

      const itemName = String(sheet['C' + r]?.v || '').trim();

      // 💡 [비제품 항목 제외]: NEGO, 시편TEST비, 시험비, 운임 등 실제 제조 공정이 없는 행은 전면 제외
      if (this._isNonProductItem(itemName)) {
        excludedNonProductCount++;
        continue;
      }

      const row = {
        rowIdx: r,
        lotNo: String(sheet['A' + r]?.v || '').trim(),
        no: sheet['B' + r]?.v ?? '',
        itemName,
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

    this._updateAgentStatus('PUR-02', `대경 미결 리스트 ${rows.length}개 제조 품목 파싱 완료 (비제품 ${excludedNonProductCount}건 제외)`, `제조 품목 ${rows.length}건 / 비제품(네고·시편 등) ${excludedNonProductCount}건 제외`, 'ACTIVE');
    return { sheetName, totalRows: rows.length, excludedNonProductCount, rows };
  }

  _isNonProductItem(itemName) {
    if (!itemName) return true;
    const upper = String(itemName).toUpperCase().replace(/\s+/g, '');
    const nonProductKeywords = ['NEGO', '네고', '시편', 'TEST', '시험', '운임', '운송비', '포장비', '할인', '수수료', 'SAMPLE'];
    return nonProductKeywords.some(kw => upper.includes(kw));
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

  _extractPoDate(orderNo, workDate, poCreatedAt) {
    if (poCreatedAt) {
      try {
        const d = new Date(poCreatedAt);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch (e) {}
    }
    if (orderNo) {
      // 1. ES260326-711 형태 (ES + YYMMDD)
      const m1 = String(orderNo).match(/ES(\d{2})(\d{2})(\d{2})/i);
      if (m1) {
        return `20${m1[1]}-${m1[2]}-${m1[3]}`;
      }
      // 2. 2026-03-26 or 2026.03.26
      const m2 = String(orderNo).match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
      if (m2) {
        return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
      }
      // 3. 20260326
      const m3 = String(orderNo).match(/(20\d{2})(\d{2})(\d{2})/);
      if (m3) {
        return `${m3[1]}-${m3[2]}-${m3[3]}`;
      }
    }
    if (workDate) {
      const s = String(workDate).trim();
      const m = s.match(/(20\d{2})[-./]?(\d{2})[-./]?(\d{2})/);
      if (m) {
        return `${m[1]}-${m[2]}-${m[3]}`;
      }
    }
    return '';
  }

  _calculateElapsedDays(dateStr) {
    if (!dateStr) return 0;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 0;
      const today = new Date();
      const diffMs = today.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 0;
    } catch (e) {
      return 0;
    }
  }

  _calculateRemainingDays(dateStr) {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      const today = new Date();
      // Set to midnight comparison
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      const diffMs = d.getTime() - today.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    } catch (e) {
      return null;
    }
  }

  _estimateRemainingProductionDays(itemName, stage, progressPct) {
    if (stage === '창고입고완료' || progressPct >= 100) return 0;
    
    // 카테고리별 실측 평균 리드타임
    const cat = String(itemName || '').toUpperCase();
    let totalLead = 22; // default
    if (cat.includes('TEE')) totalLead = 27;
    else if (cat.includes('45E')) totalLead = 32;
    else if (cat.includes('90E')) totalLead = 21;
    else if (cat.includes('R(') || cat.includes('REDUCER')) totalLead = 18;
    else if (cat.includes('CAP')) totalLead = 20;

    if (stage === '산세완결') return 2;
    if (stage === '가공완료') return 4;
    if (stage === '교정완료') return 7;
    if (stage === '열처리완료') return 10;
    if (stage === '성형완료') return 14;
    if (stage === '절단완료') return 17;
    if (stage === '재고/가공대기') return 10;
    if (stage === '절단대기') return totalLead;
    return totalLead; // 검토정체 등 0%
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
        const trimmed = o.poNumber.trim();
        poMap.set(trimmed, o);
        poMap.set(trimmed.toUpperCase(), o);
        const m = trimmed.match(/ES\d+-\d+/i);
        if (m) poMap.set(m[0].toUpperCase(), o);
      }
      if (o.id) {
        poMap.set(o.id.trim(), o);
        poMap.set(o.id.trim().toUpperCase(), o);
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
      const rawOrderNo = (row.orderNo || '').trim();
      const codeMatch = rawOrderNo.match(/ES\d+-\d+/i);
      const matchedOrder = poMap.get(rawOrderNo)
        || poMap.get(rawOrderNo.toUpperCase())
        || (codeMatch ? poMap.get(codeMatch[0].toUpperCase()) : null);
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

      // 발주일자 추출 및 발주일 기준 경과 일수 산출
      const poDate = this._extractPoDate(row.orderNo, row.workDate, poCreatedAt);
      const elapsedDays = this._calculateElapsedDays(poDate);

      // 💡 [혁신적 고도화]: 고객 약속 납기일 ⟷ 대경 남은 제작 리드타임 대조 분석
      const customerDueDate = matchedOrder?.adminResponse?.deliveryDate || (matchedOrder?.dueDate ? String(matchedOrder.dueDate).slice(0, 10) : null);
      const remainingCustomerDays = this._calculateRemainingDays(customerDueDate);
      const remainingProductionDays = this._estimateRemainingProductionDays(row.itemName, stage, progressPct);
      const leadtimeDeficit = remainingCustomerDays !== null ? (remainingCustomerDays - remainingProductionDays) : null;

      let dueDateStatus = 'NORMAL';
      if (isCompleted) {
        dueDateStatus = 'COMPLETED';
      } else if (remainingCustomerDays !== null) {
        if (remainingCustomerDays < 0) {
          dueDateStatus = 'OVERDUE'; // 고객 약속 납기일 이미 초과
        } else if (leadtimeDeficit < -3) {
          dueDateStatus = 'IMPOSSIBLE_DELAY'; // 남은 납기일보다 제작 필요일수가 훨씬 큼 (납기 펑크 확정)
        } else if (leadtimeDeficit <= 3) {
          dueDateStatus = 'TIGHT_WARNING'; // 납기 임박/촉박
        } else {
          dueDateStatus = 'SAFE'; // 납기 안정
        }
      }

      // 3. 지연 및 병목 감지 (PUR-04 과장 연계 규칙)
      // 💡 [중요 규칙]: 창고입고(V열 storeDate) 완료된 품목은 출고 직전이므로 독촉 대상에서 100% 완전 제외!
      let alertReason = null;
      let alertSeverity = 'NORMAL'; // NORMAL | WARNING | CRITICAL

      if (!isCompleted) {
        // A. 고객 납기 초과 (이미 약속 납기가 지남) -> 최고 긴급 독촉!
        if (dueDateStatus === 'OVERDUE') {
          alertReason = `고객 약속 납기(${customerDueDate}) ${Math.abs(remainingCustomerDays)}일 초과 지연 중! (${stage})`;
          alertSeverity = 'CRITICAL';
        }
        // B. 납기 불가 확정 (고객 납기일까지 남은 기간 < 제작 필요 기간) -> 긴급 경보!
        else if (dueDateStatus === 'IMPOSSIBLE_DELAY') {
          alertReason = remainingCustomerDays === 0
            ? `고객 납기 오늘(D-Day) 도래했으나 미착수/정체 (제작 ${remainingProductionDays}일 추가 소요 예상)`
            : `고객 납기까지 ${remainingCustomerDays}일 남았으나 제작 ${remainingProductionDays}일 소요 예상 (약 ${Math.abs(leadtimeDeficit)}일 납기 펑크 위험!)`;
          alertSeverity = 'CRITICAL';
        }
        // C. 납기 임박 (촉박한 상태)
        else if (dueDateStatus === 'TIGHT_WARNING') {
          alertReason = `고객 납기 임박 (D-${remainingCustomerDays}일 / 제작 ${remainingProductionDays}일 예상, 오늘 즉시 후속 공정 필수)`;
          alertSeverity = 'WARNING';
        }
        // D. 생산 확정인데 절단(P열) 미착수 -> 긴급 독촉!
        else if (row.workType.includes('생산') && !row.cutDate) {
          alertReason = elapsedDays > 0 
            ? `생산 확정되었으나 절단(P열) 미착수 (발주 후 ${elapsedDays}일 경과)`
            : '생산 확정되었으나 절단(P열) 미착수 상태';
          alertSeverity = 'CRITICAL';
        }
        // E. 1주일 이상 검토 정체인 경우 -> 검토 홀딩 독촉!
        else if (row.workType.includes('검토') && !row.cutDate && !row.machDate) {
          alertReason = elapsedDays > 0
            ? `공정 미착수 (검토 상태 ${elapsedDays}일 장기 정체)`
            : '공정 미착수 (검토 상태 1주일 이상 장기 정체)';
          alertSeverity = 'WARNING';
        }
        // F. 절단 완료 후 후속 성형/열처리 미진행
        else if (row.cutDate && !row.formDate && !row.machDate) {
          alertReason = `절단(${row.cutDate}) 완료 후 후속 성형/가공 미진행 정체`;
          alertSeverity = 'WARNING';
        }
        // G. 성형 완료 후 열처리/가공 미진행
        else if (row.formDate && !row.heatDate && !row.calibDate && !row.machDate) {
          alertReason = `성형(${row.formDate}) 완료 후 후속 열처리/가공 정체`;
          alertSeverity = 'WARNING';
        }
        // H. 가공 완료 후 산세/창고입고 미진행
        else if (row.machDate && !row.acidDate && !row.storeDate) {
          alertReason = `가공(${row.machDate}) 완료 후 산세/창고입고 대기 정체`;
          alertSeverity = 'WARNING';
        }
        // I. 수정/재고 배정 후 가공/입고 미진행
        else if ((row.workType.includes('수정') || row.workType.includes('재고')) && !row.machDate && !row.storeDate) {
          alertReason = `${row.workType} 배정 후 가공/출고 미진행 정체`;
          alertSeverity = 'WARNING';
        }
        // J. 외주 의뢰 후 미입고
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
        poDate,
        elapsedDays,
        customerDueDate,
        remainingCustomerDays,
        remainingProductionDays,
        leadtimeDeficit,
        dueDateStatus,
        isStockOrder,
        alertReason,
        alertSeverity
      };

      analyzedRows.push(analyzedItem);
      if (alertReason) {
        alertItems.push(analyzedItem);
      }
    });

    // 4. 거래처별(납품처별) 병목 진단 집계 (Client Diagnoses)
    const clientMap = {};
    analyzedRows.forEach(item => {
      const client = item.deliveryTo || item.customerName || '자체/미지정';
      if (!clientMap[client]) {
        clientMap[client] = {
          clientName: client,
          totalCount: 0,
          alertCount: 0,
          criticalCount: 0,
          warningCount: 0,
          unstartedCount: 0, // 진행률 <= 5%
          completedCount: 0,
          maxElapsedDays: 0,
          oldestOrderNo: '',
          oldestPoDate: '',
          oldestItemSummary: '',
          cutPendingCount: 0,
          stockPendingCount: 0,
          reviewPendingCount: 0,
          sampleItems: []
        };
      }
      const c = clientMap[client];
      c.totalCount++;
      if (item.isCompleted) c.completedCount++;
      if (item.alertSeverity === 'CRITICAL') {
        c.alertCount++;
        c.criticalCount++;
      } else if (item.alertSeverity === 'WARNING') {
        c.alertCount++;
        c.warningCount++;
      }

      if (item.dueDateStatus === 'OVERDUE') {
        c.overdueCount = (c.overdueCount || 0) + 1;
      } else if (item.dueDateStatus === 'IMPOSSIBLE_DELAY') {
        c.deficitRiskCount = (c.deficitRiskCount || 0) + 1;
      }

      if (!item.isCompleted) {
        if (item.workType.includes('재고') && !item.storeDate) {
          c.stockPendingCount++;
        }
        if (item.progressPct <= 5) {
          c.unstartedCount++;
          if (item.workType.includes('생산') && !item.cutDate) c.cutPendingCount++;
          if (item.workType.includes('검토') && !item.cutDate) c.reviewPendingCount++;
        }
      }

      if (item.elapsedDays > c.maxElapsedDays) {
        c.maxElapsedDays = item.elapsedDays;
        c.oldestOrderNo = item.orderNo || '';
        c.oldestPoDate = item.poDate || '';
        c.oldestItemSummary = `${item.itemName} ${item.size} (${item.thickness})`;
      }

      if (c.sampleItems.length < 5) {
        c.sampleItems.push(item);
      }
    });

    // 각 거래처별 가장 주요한 문제 요약 문구 생성
    const clientDiagnoses = Object.values(clientMap).map(c => {
      let primaryIssue = '정상 진행 중';
      if ((c.overdueCount || 0) > 0) {
        if (c.stockPendingCount > 0 && c.cutPendingCount === 0) {
          primaryIssue = `🚨 고객 약속 납기 초과 ${c.overdueCount}건 (재고 배정 후 출고 정체)`;
        } else {
          primaryIssue = `🚨 고객 약속 납기 초과 ${c.overdueCount}건 (최장 ${c.maxElapsedDays}일 정체)`;
        }
      } else if ((c.deficitRiskCount || 0) > 0) {
        primaryIssue = `🚨 납기 펑크 위험 ${c.deficitRiskCount}건 (고객납기 < 제작필요일수)`;
      } else if (c.cutPendingCount > 0) {
        primaryIssue = `절단 미착수 긴급 ${c.cutPendingCount}건 (최장 ${c.maxElapsedDays}일 정체)`;
      } else if (c.stockPendingCount > 0) {
        primaryIssue = `재고 배정 후 출고 대기 ${c.stockPendingCount}건 (최장 ${c.maxElapsedDays}일 정체)`;
      } else if (c.unstartedCount > 0) {
        primaryIssue = `공정 미착수 ${c.unstartedCount}건 (최장 ${c.maxElapsedDays}일 멈춤)`;
      } else if (c.warningCount > 0) {
        primaryIssue = `중간 공정 정체 ${c.warningCount}건`;
      } else if (c.completedCount === c.totalCount) {
        primaryIssue = '전량 창고입고 완료 (출고 대기)';
      }
      return {
        ...c,
        primaryIssue
      };
    }).sort((a, b) => {
      if ((b.overdueCount || 0) !== (a.overdueCount || 0)) return (b.overdueCount || 0) - (a.overdueCount || 0);
      if ((b.deficitRiskCount || 0) !== (a.deficitRiskCount || 0)) return (b.deficitRiskCount || 0) - (a.deficitRiskCount || 0);
      if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
      if (b.alertCount !== a.alertCount) return b.alertCount - a.alertCount;
      if (b.maxElapsedDays !== a.maxElapsedDays) return b.maxElapsedDays - a.maxElapsedDays;
      return b.totalCount - a.totalCount;
    });

    // 5. 발주일 기준 최장 미착수 정체 TOP 리스트 (Longest Stagnant Items)
    const longestStagnantItems = analyzedRows
      .filter(r => !r.isCompleted && r.progressPct <= 5)
      .sort((a, b) => (b.elapsedDays || 0) - (a.elapsedDays || 0))
      .slice(0, 50);

    // 6. 고객 납기 대비 지연 위험 품목 TOP 리스트 (Critical Due Date Risk Items)
    const criticalDueRiskItems = analyzedRows
      .filter(r => !r.isCompleted && r.dueDateStatus && r.dueDateStatus !== 'COMPLETED' && r.dueDateStatus !== 'SAFE')
      .sort((a, b) => {
        if (a.dueDateStatus === 'OVERDUE' && b.dueDateStatus !== 'OVERDUE') return -1;
        if (b.dueDateStatus === 'OVERDUE' && a.dueDateStatus !== 'OVERDUE') return 1;
        const defA = a.leadtimeDeficit !== null ? a.leadtimeDeficit : 999;
        const defB = b.leadtimeDeficit !== null ? b.leadtimeDeficit : 999;
        return defA - defB;
      })
      .slice(0, 50);

    // 7. 💡 [핵심] 발주서별(주문번호+납품처) 정밀 납기 위험 분석 매트릭스 (Order-level Risk Matrix)
    // 구조: 업체명 - 발주번호 - 고객납기 - 현재공정 - 위험(🚨) / 경계(⚠️) / 안정(✅) / 완료(🏁)
    const orderGroupMap = new Map();
    analyzedRows.forEach(item => {
      const client = item.deliveryTo || item.customerName || '자체/미지정';
      const orderNo = item.orderNo || '주문번호미상';
      const compositeKey = `${client}____${orderNo}`;

      if (!orderGroupMap.has(compositeKey)) {
        orderGroupMap.set(compositeKey, {
          client,
          orderNo,
          customerDueDate: item.customerDueDate || null,
          remainingDays: item.remainingCustomerDays !== undefined ? item.remainingCustomerDays : null,
          poDate: item.poDate || null,
          elapsedDays: item.elapsedDays || 0,
          items: []
        });
      }
      const grp = orderGroupMap.get(compositeKey);
      grp.items.push(item);
      if (item.customerDueDate && !grp.customerDueDate) {
        grp.customerDueDate = item.customerDueDate;
        grp.remainingDays = item.remainingCustomerDays;
      }
      if (item.elapsedDays > grp.elapsedDays) {
        grp.elapsedDays = item.elapsedDays;
      }
    });

    const orderAnalyses = [];
    for (const [_, grp] of orderGroupMap.entries()) {
      const items = grp.items;
      const totalItems = items.length;
      const totalQty = items.reduce((sum, i) => sum + (i.remainQty || 0), 0);
      const completedCount = items.filter(i => i.isCompleted).length;
      const overdueCount = items.filter(i => i.dueDateStatus === 'OVERDUE').length;
      const impossibleCount = items.filter(i => i.dueDateStatus === 'IMPOSSIBLE_DELAY').length;
      const tightCount = items.filter(i => i.dueDateStatus === 'TIGHT_WARNING').length;
      const criticalCount = items.filter(i => i.alertSeverity === 'CRITICAL').length;
      const warningCount = items.filter(i => i.alertSeverity === 'WARNING').length;

      // 대표 공정 단계 요약
      const stageMap = {};
      items.forEach(i => {
        stageMap[i.stage] = (stageMap[i.stage] || 0) + 1;
      });
      const mainStage = Object.entries(stageMap)
        .sort((a, b) => b[1] - a[1])
        .map(([st, cnt]) => `${st} ${cnt}건`)
        .slice(0, 3)
        .join(', ');

      let riskLevel = 'SAFE'; // DANGER | WARNING | SAFE | COMPLETED
      let riskLabel = '안정';
      let riskReason = '고객 약속납기 여유 및 공정 정상 진행';
      let actionItem = '진행 공정 모니터링 유지';

      if (completedCount === totalItems) {
        riskLevel = 'COMPLETED';
        riskLabel = '입고완료';
        riskReason = '전 품목 대경 창고 입고 완료 (출고 준비)';
        actionItem = '상차 및 고객사 배송 출고 조율';
      } else if (overdueCount > 0) {
        riskLevel = 'DANGER';
        riskLabel = '위험';
        const maxOver = Math.max(...items.filter(i => i.dueDateStatus === 'OVERDUE').map(i => Math.abs(i.remainingCustomerDays || 0)));
        riskReason = `고객 약속납기(${grp.customerDueDate || '-'}) ${maxOver}일 초과 (${overdueCount}건 지연)`;
        actionItem = items.some(i => i.workType.includes('재고'))
          ? '대경 창고 출고 즉시 독촉 및 오늘 직송 차량 수배'
          : '대경 공장장 직통 유선 연락 및 최우선 가공/출고 요청';
      } else if (impossibleCount > 0) {
        riskLevel = 'DANGER';
        riskLabel = '위험';
        riskReason = `납기 펑크 불가피 (${impossibleCount}건, 남은납기 < 제작필요일수)`;
        actionItem = '공정 단축 긴급 투입 요청 및 고객사 사전 납기 조율';
      } else if (tightCount > 0 || criticalCount > 0) {
        riskLevel = 'WARNING';
        riskLabel = '경계';
        riskReason = tightCount > 0 ? `고객 납기 임박 (${tightCount}건)` : `절단/검토 장기 미착수 (${criticalCount}건)`;
        actionItem = '금일 중 절단/가공 후속 공정 즉시 투입 지시';
      } else if (warningCount > 0) {
        riskLevel = 'WARNING';
        riskLabel = '경계';
        riskReason = `중간 공정 정체 (${warningCount}건)`;
        actionItem = '후속 열처리/가공 라인 일정 확인';
      }

      orderAnalyses.push({
        client: grp.client,
        orderNo: grp.orderNo,
        customerDueDate: grp.customerDueDate,
        remainingDays: grp.remainingDays,
        poDate: grp.poDate,
        elapsedDays: grp.elapsedDays,
        mainStage,
        totalItems,
        totalQty,
        completedCount,
        riskLevel,
        riskLabel,
        riskReason,
        actionItem,
        items
      });
    }

    // 정렬: 위험 -> 경계 -> 안정 -> 입고완료 순
    orderAnalyses.sort((a, b) => {
      const score = { DANGER: 4, WARNING: 3, SAFE: 2, COMPLETED: 1 };
      if (score[b.riskLevel] !== score[a.riskLevel]) return score[b.riskLevel] - score[a.riskLevel];
      const remA = a.remainingDays !== null ? a.remainingDays : 999;
      const remB = b.remainingDays !== null ? b.remainingDays : 999;
      return remA - remB;
    });

    this._updateAgentStatus('PUR-03', `발주 매칭 ${matchedCount}건, 거래처 ${clientDiagnoses.length}개, 발주서 매트릭스 ${orderAnalyses.length}개 분석 완료`, `매칭 ${matchedCount}건 / 발주 매트릭스 ${orderAnalyses.length}건 / 납기 위험 ${criticalDueRiskItems.length}건`, 'ACTIVE');

    return {
      totalRows: analyzedRows.length,
      matchedCount,
      unmatchedCount: analyzedRows.length - matchedCount,
      stockOrderCount,
      stageCounts,
      alertCount: alertItems.length,
      alertItems,
      clientDiagnoses,
      orderAnalyses,
      longestStagnantItems,
      criticalDueRiskItems,
      rows: analyzedRows
    };
  }

  /**
   * 3. 대경벤드 납기 정밀 분석 보고서 및 독촉 공문 생성 (PUR-04 과장봇)
   * 💡 [핵심 원칙]: 창고 입고(V열 storeDate) 완료 건은 출고 직전 상태이므로 독촉 대상에서 100% 완전 제외!
   * 💡 [정밀 매트릭스]: 업체명 - 발주번호 - 고객납기 - 현재공정 - 위험도 판정(위험/경계/안정) 체계 반영
   */
  generateChaserReport(analyzedData) {
    this._updateAgentStatus('PUR-04', '발주서별 정밀 납기 위험 분석 매트릭스 및 대경 공문 생성 중...', '납기 정밀 보고서 작성 착수', 'ACTIVE');

    const pendingAlertItems = analyzedData.alertItems.filter(i => !i.isCompleted && !i.storeDate);
    const criticalItems = pendingAlertItems.filter(i => i.alertSeverity === 'CRITICAL');
    const warningItems = pendingAlertItems.filter(i => i.alertSeverity === 'WARNING');
    const orderAnalyses = analyzedData.orderAnalyses || [];

    const dangerOrders = orderAnalyses.filter(o => o.riskLevel === 'DANGER');
    const warningOrders = orderAnalyses.filter(o => o.riskLevel === 'WARNING');
    const safeOrders = orderAnalyses.filter(o => o.riskLevel === 'SAFE');
    const completedOrders = orderAnalyses.filter(o => o.riskLevel === 'COMPLETED');

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

    let markdown = `# 📊 [알트에프 구매부] 대경벤드 생산 미결 및 납기 정밀 분석 보고서\n`;
    markdown += `**작성 일시**: ${todayStr} | **분석 총괄**: 구매부 미결관리팀 (PUR-04 과장)\n`;
    markdown += `**총 분석 품목**: ${analyzedData.totalRows.toLocaleString()}건 | **분석 발주서**: 총 ${orderAnalyses.length}건\n`;
    markdown += `**위험도 현황**: 🚨 위험 **${dangerOrders.length}건** | ⚠️ 경계 **${warningOrders.length}건** | ✅ 안정 **${safeOrders.length}건** | 🏁 완료 **${completedOrders.length}건**\n\n`;

    markdown += `> 💡 **판정 기준 안내**:\n`;
    markdown += `> - **🚨 위험 (DANGER)**: 고객 약속 납기일 이미 초과(OVERDUE) 또는 잔여 납기일보다 제작 소요 일수가 훨씬 길어 펑크가 확정된 건\n`;
    markdown += `> - **⚠️ 경계 (WARNING)**: 고객 약속 납기 임박(D-3일 이내) 또는 14일 이상 절단/검토 미착수 및 중간 공정 정체 건\n`;
    markdown += `> - **✅ 안정 (SAFE)**: 고객 납기일까지 일정 여유가 충분하고 정상 공정 진행 중인 건\n`;
    markdown += `> - **🏁 완료 (COMPLETED)**: 대경 창고 입고(V열) 완료되어 즉시 상차/출고 가능한 건 (독촉 대상 제외)\n\n`;

    markdown += `## 📋 [정밀 매트릭스] 업체명 - 발주번호 - 납기 - 현재공정 - 위험도 판정\n`;
    markdown += `| 업체명 (납품처) | 발주번호 | 고객납기 (잔여일) | 현재 공정 현황 | 위험도 판정 | 수량 | 권장 긴급 조치사항 |\n`;
    markdown += `| :--- | :--- | :--- | :--- | :---: | :---: | :--- |\n`;

    orderAnalyses.forEach(o => {
      const riskBadge = o.riskLevel === 'DANGER' ? '🚨 위험' :
                        o.riskLevel === 'WARNING' ? '⚠️ 경계' :
                        o.riskLevel === 'COMPLETED' ? '🏁 완료' : '✅ 안정';
      const dueText = o.customerDueDate 
        ? `${o.customerDueDate} (${o.remainingDays < 0 ? `${Math.abs(o.remainingDays)}일 초과` : `D-${o.remainingDays}일`})`
        : '납기미정';
      markdown += `| **${o.client}** | \`${o.orderNo}\` | ${dueText} | ${o.mainStage} | **${riskBadge}** | ${o.totalQty.toLocaleString()}개 | ${o.actionItem} |\n`;
    });
    markdown += `\n`;

    markdown += `## ⚡ [발주처별 상세 지연 품목 및 독촉 내역]\n`;
    for (const [_, group] of Object.entries(groupByOrder)) {
      markdown += `### 📌 [${group.deliveryTo}] 주문번호: \`${group.orderNo}\` (지연: ${group.items.length}건)\n`;
      markdown += `| LOT | 품명 | 규격(두께) | 작업(L열) | 잔량 | 정체 단계 및 독촉 사유 |\n`;
      markdown += `| :--- | :--- | :--- | :---: | :---: | :--- |\n`;
      group.items.slice(0, 8).forEach(it => {
        const icon = it.alertSeverity === 'CRITICAL' ? '🚨' : '⚠️';
        markdown += `| ${it.lotNo} | ${it.itemName} | ${it.size} (${it.thickness}) | ${it.workType} | **${it.remainQty}개** | ${icon} ${it.alertReason} |\n`;
      });
      if (group.items.length > 8) {
        markdown += `| ... | 외 ${group.items.length - 8}개 품목 추가 지연 중 | | | | |\n`;
      }
      markdown += `\n`;
    }

    markdown += `## 💬 긴급 현장 조치 가이드라인\n`;
    markdown += `1. **🚨 위험 등급 발주서 (${dangerOrders.length}건)**: 즉시 대경벤드 영업/공장 직통 통화 및 금일 출고/납품 일정 확인서 요청.\n`;
    markdown += `2. **재고 배정 품목 (한국스텐레스 등)**: 이미 자재가 확보된 상태이므로 포장/가공 완료 즉시 직송 차량 배차.\n`;
    markdown += `3. **창고 입고 완료 건 (${completedOrders.length}건)**: 출고물류부(LOG-01) 즉시 연계하여 검사 성적서 확인 후 출고.\n`;

    const report = {
      reportId: `CHASER-${Date.now()}`,
      createdAt: new Date().toISOString(),
      summary: {
        totalRows: analyzedData.totalRows,
        alertCount: pendingAlertItems.length,
        criticalCount: criticalItems.length,
        warningCount: warningItems.length,
        excludedCompletedCount: analyzedData.stageCounts?.창고입고완료 || 0,
        totalOrders: orderAnalyses.length,
        dangerOrdersCount: dangerOrders.length,
        warningOrdersCount: warningOrders.length,
        safeOrdersCount: safeOrders.length,
        completedOrdersCount: completedOrders.length
      },
      orderAnalyses,
      markdown,
      groupByOrder
    };

    this._updateAgentStatus('PUR-04', `대경 정밀 납기 분석 보고서 생성 완료 (위험 ${dangerOrders.length}건 / 경계 ${warningOrders.length}건)`, `납기 정밀 분석 보고서 및 공문 작성 완료`, 'ACTIVE');
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
    
    // Clean originalFilename to prevent stacking prefixes
    const cleanFilename = path.basename(originalFilename).replace(/^(pending_[0-9T\-_.]+Z_)+/, '');
    let archivePath;
    if (typeof bufferOrPath === 'string' && path.resolve(bufferOrPath).startsWith(path.resolve(STORAGE_DIR))) {
      // 이미 storage 디렉토리에 보관된 파일이면 중복 복사 방지
      archivePath = bufferOrPath;
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      archivePath = path.join(STORAGE_DIR, `pending_${timestamp}_${cleanFilename}`);
      if (typeof bufferOrPath === 'string') {
        fs.copyFileSync(bufferOrPath, archivePath);
      } else {
        fs.writeFileSync(archivePath, bufferOrPath);
      }
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
    const overdueCount = (analyzed.rows || []).filter(r => r.dueDateStatus === 'OVERDUE').length;
    const deficitRiskCount = (analyzed.rows || []).filter(r => r.dueDateStatus === 'IMPOSSIBLE_DELAY').length;
    const orderAnalyses = analyzed.orderAnalyses || [];
    const dangerOrdersCount = orderAnalyses.filter(o => o.riskLevel === 'DANGER').length;
    const warningOrdersCount = orderAnalyses.filter(o => o.riskLevel === 'WARNING').length;
    const safeOrdersCount = orderAnalyses.filter(o => o.riskLevel === 'SAFE').length;
    const completedOrdersCount = orderAnalyses.filter(o => o.riskLevel === 'COMPLETED').length;

    const finalResult = {
      timestamp: new Date().toISOString(),
      filename: originalFilename,
      archivePath: path.basename(archivePath),
      summary: {
        totalRows: analyzed.totalRows,
        matchedCount: analyzed.matchedCount,
        unmatchedCount: analyzed.unmatchedCount,
        stockOrderCount: analyzed.stockOrderCount,
        alertCount: analyzed.alertCount,
        overdueCount,
        deficitRiskCount,
        dueRiskCount: (analyzed.criticalDueRiskItems || []).length,
        excludedNonProductCount: parsed.excludedNonProductCount || 0,
        totalOrders: orderAnalyses.length,
        dangerOrdersCount,
        warningOrdersCount,
        safeOrdersCount,
        completedOrdersCount
      },
      stageCounts: analyzed.stageCounts,
      clientDiagnoses: analyzed.clientDiagnoses,
      orderAnalyses,
      longestStagnantItems: analyzed.longestStagnantItems,
      criticalDueRiskItems: analyzed.criticalDueRiskItems || [],
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
