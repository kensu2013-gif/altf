/**
 * ALTF Autonomous Agent Swarm Organization (전사 8대 부서 75인 에이전트 조직도)
 * 24시간 Mac mini M5 Pro에서 자율 구동되는 가상 오피스 에이전트 마스터 명세
 */

export interface AgentMetric {
    speed: number;       // 처리 속도 (1-100)
    accuracy: number;    // 정확도 (1-100)
    load: number;        // 현재 부하율 (1-100)
    uptime: string;      // 가동률 (예: '99.9%')
    tasksToday: number;  // 오늘 처리한 건수
}

export type AgentStatus = 'ACTIVE' | 'STANDBY' | 'IDLE' | 'OFFLINE';

export type AgentPosition = '팀장' | '과장' | '대리' | '사원';

// 👑 부서별 4단계 직위 체계 및 권한 메타데이터
export const POSITION_CONFIG: Record<AgentPosition, {
    label: string;
    icon: string;
    color: string;
    bg: string;
    border: string;
    roleDescription: string;
    level: number;
    requiresApproval: boolean;
}> = {
    '팀장': {
        label: '팀장 (Head)',
        icon: '👑',
        color: '#FFD700',
        bg: 'rgba(255, 215, 0, 0.15)',
        border: 'rgba(255, 215, 0, 0.7)',
        roleDescription: '부서 총괄 및 과장 이상징후 최종 승인·반려권 보유',
        level: 4,
        requiresApproval: false
    },
    '과장': {
        label: '과장 (Chief)',
        icon: '👔',
        color: '#A855F7',
        bg: 'rgba(168, 85, 247, 0.15)',
        border: 'rgba(168, 85, 247, 0.7)',
        roleDescription: '사원/대리 결과물 확인·검수 및 이상징후 감지 시 팀장 결재 상신',
        level: 3,
        requiresApproval: true
    },
    '대리': {
        label: '대리 (Assistant)',
        icon: '💼',
        color: '#00F0FF',
        bg: 'rgba(0, 240, 255, 0.15)',
        border: 'rgba(0, 240, 255, 0.7)',
        roleDescription: '실무 데이터 정제 및 24시간 연속 업무 무결재 지속 반복',
        level: 2,
        requiresApproval: false
    },
    '사원': {
        label: '사원 (Associate)',
        icon: '📋',
        color: '#94A3B8',
        bg: 'rgba(148, 163, 184, 0.15)',
        border: 'rgba(148, 163, 184, 0.5)',
        roleDescription: '단위 실무 24시간 무결재 자율 반복: 메일 감시/수집 등 논스톱 실행',
        level: 1,
        requiresApproval: false
    }
};

export interface AgentUnit {
    id: string;
    code: string;
    name: string;
    deptId: string;
    deptName: string;
    tier: number;          // 1, 2, 3 스타
    role: string;
    status: AgentStatus;
    metrics: AgentMetric;
    currentTask: string;
    lastActive: string;
    triggerEvents: string[];
    emittedEvents: string[];
    logs: string[];
    isCreated?: boolean; // 실제 구현/생성 완료 여부 (true: 가동 중, false: 미생성 슬롯)
    connectedDeptIds?: string[]; // 부서간 그물망 연계 대상 부서 ID 목록 (예: ['shipping', 'general'])
    connectedAgentIds?: string[]; // 연계 대상 특정 업무/담당자 에이전트 ID 목록 (예: ['est-01', 'qc-po-matcher'])
    position?: AgentPosition; // 부서 내 직위 (팀장, 과장, 대리, 사원)
    supervisorId?: string; // 직속 결재/확인 상위 직위자 에이전트 ID
    approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'AUTO_RUNNING'; // 과장 결재 상태 or 사원/대리 자율반복
    orderIndex?: number; // 조직도 내 서열/배치 순서
    teamName?: string; // 부서 내 소속 팀 (예: '총무1팀', '총무2팀')
}

export interface Department {
    id: string;
    name: string;
    code: string;
    color: string;       // 네온 컬러 코드
    bgGlow: string;
    icon: string;
    description: string;
    headRole: string;
    totalUnits: number;
}

export const DEPARTMENTS: Department[] = [
    {
        id: 'quote',
        name: '견적부',
        code: 'EST',
        color: '#00F0FF', // Cyber Cyan
        bgGlow: 'rgba(0, 240, 255, 0.15)',
        icon: '📝',
        description: '24시간 견적 인입 파싱, 규격 매핑, 단가/마진 산출 및 고객 회신',
        headRole: '견적 총괄 자동화',
        totalUnits: 10
    },
    {
        id: 'purchase',
        name: '구매부',
        code: 'PUR',
        color: '#00E676', // Neon Green
        bgGlow: 'rgba(0, 230, 118, 0.15)',
        icon: '🛒',
        description: '대경재고 감시, 안전재고 부족 선매입 발주 및 외주 발주서 생성',
        headRole: '구매/SCM 총괄',
        totalUnits: 9
    },
    {
        id: 'general',
        name: '총무부',
        code: 'GEN',
        color: '#FFD600', // Neon Amber
        bgGlow: 'rgba(255, 214, 0, 0.15)',
        icon: '📑',
        description: '전자세금계산서, 거래명세표 발행, 입금 대조 및 여신 한도 관리',
        headRole: '경리/회계 총괄',
        totalUnits: 9
    },
    {
        id: 'quality',
        name: '품질부',
        code: 'QC',
        color: '#FF0055', // Cyber Neon Pink
        bgGlow: 'rgba(255, 0, 85, 0.15)',
        icon: '🔬',
        description: '외주/재고 성적서(MTC) 판독, 구글시트 DB화, 매칭 및 성적서 자동 발송',
        headRole: '품질 보증(QA) 총괄',
        totalUnits: 10
    },
    {
        id: 'shipping',
        name: '출고부',
        code: 'LOG',
        color: '#7C4DFF', // Cyber Purple
        bgGlow: 'rgba(124, 77, 255, 0.15)',
        icon: '🚚',
        description: '출고 신호 발행, 미결 관리, 화물 배차 및 운송장 자동 알림',
        headRole: '물류/출고 총괄',
        totalUnits: 9
    },
    {
        id: 'data',
        name: '데이터관리부',
        code: 'DAT',
        color: '#00B0FF', // Deep Sky Blue
        bgGlow: 'rgba(0, 176, 255, 0.15)',
        icon: '💾',
        description: '대경 재고 크롤링, 시화/부산 색인, 유사도 엔진 및 S3 동기화',
        headRole: '데이터 아키텍트',
        totalUnits: 10
    },
    {
        id: 'material',
        name: '자재관리부',
        code: 'MAT',
        color: '#FF6D00', // Intense Orange
        bgGlow: 'rgba(255, 109, 0, 0.15)',
        icon: '📦',
        description: '창고 랙 위치 추적, 장기 과잉재고 유동화, 실사 오차 보정',
        headRole: '창고 자재 총괄',
        totalUnits: 9
    },
    {
        id: 'executive',
        name: '경영지원부',
        code: 'EXE',
        color: '#E040FB', // Neon Magenta
        bgGlow: 'rgba(224, 64, 251, 0.15)',
        icon: '👑',
        description: 'CEO 일일 결산 브리핑, 자금 흐름 예측, 이탈 고객 감지 및 최종 승인',
        headRole: 'CEO 전략실',
        totalUnits: 9
    }
];

const RAW_INITIAL_AGENTS: AgentUnit[] = [
    // ----------------------------------------------------
    // 1. 견적부 (10명)
    // ----------------------------------------------------
    {
        id: 'est-email-parser',
        code: 'EST-01',
        name: '견적 인입 파싱봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 3,
        role: '이메일/웹 견적 요청서 및 첨부 엑셀/PDF 실시간 분석',
        status: 'ACTIVE',
        metrics: { speed: 96, accuracy: 98, load: 42, uptime: '99.9%', tasksToday: 142 },
        currentTask: '대양철강 20A Sch40S 외 12종 견적서 자동 분석 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_INBOUND_EMAIL_RECEIVED', 'EVENT_WEB_QUOTE_SUBMITTED'],
        emittedEvents: ['EVENT_QUOTE_PARSED'],
        logs: ['[09:12] 견적 요청 접수 완료 (대양철강)', '[09:13] 12개 품목 파싱 완료']
    },
    {
        id: 'est-spec-classifier',
        code: 'EST-02',
        name: '규격 자동 식별봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 2,
        role: '배관 규격(ANSI Class 150/300 vs KS/JIS 10K/20K) 자동 분류',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 99, load: 35, uptime: '99.9%', tasksToday: 156 },
        currentTask: 'ANSI B16.9 vs KS B1543 규격 매핑 완료',
        lastActive: '1분 전',
        triggerEvents: ['EVENT_QUOTE_PARSED'],
        emittedEvents: ['EVENT_SPEC_CLASSIFIED'],
        logs: ['[09:13] 규격 정규화 완료 (ANSI 4종, KS 8종)']
    },
    {
        id: 'est-margin-calc',
        code: 'EST-03',
        name: '단가·마진 계산봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 3,
        role: '시화/부산 재고 기반 원가 및 적정 마진율 자동 적용',
        status: 'ACTIVE',
        metrics: { speed: 94, accuracy: 97, load: 68, uptime: '99.8%', tasksToday: 180 },
        currentTask: '적정 마진율 13.5% 적용 단가표 작성 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_SPEC_CLASSIFIED'],
        emittedEvents: ['EVENT_PRICE_CALCULATED'],
        logs: ['[09:14] 단가표 산출 완료 (총 공급가: 18,540,000원)']
    },
    {
        id: 'est-daekyung-cross',
        code: 'EST-04',
        name: '대경 재고 크로스봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 2,
        role: '자사 결품 품목 대경벤드 양산재고 매칭 및 납기 확인',
        status: 'STANDBY',
        metrics: { speed: 90, accuracy: 96, load: 20, uptime: '99.9%', tasksToday: 48 },
        currentTask: '대경 양산재고 50A Tee 즉시 출고 가능 여부 대조 완료',
        lastActive: '5분 전',
        triggerEvents: ['EVENT_PRICE_CALCULATED'],
        emittedEvents: ['EVENT_DAEKYUNG_STOCK_CONFIRMED'],
        logs: ['[08:50] 대경벤드 3품목 조달 가능 확인']
    },
    {
        id: 'est-cherrypick-guard',
        code: 'EST-05',
        name: '체리피커 방어봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 2,
        role: '타사 단가비교용 찔러보기 견적 판별 및 최저마진 방어',
        status: 'STANDBY',
        metrics: { speed: 92, accuracy: 94, load: 15, uptime: '100%', tasksToday: 32 },
        currentTask: '삼우플랜트 최근 3개월 견적 전환율(8.3%) 대조 중',
        lastActive: '12분 전',
        triggerEvents: ['EVENT_PRICE_CALCULATED'],
        emittedEvents: ['EVENT_MARGIN_DEFENDED'],
        logs: ['[08:42] 체리피커 유의 경고 해제 (정상 거래처 판정)']
    },
    {
        id: 'est-sheet-sync',
        code: 'EST-06',
        name: '견적 시트 동기화봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 1,
        role: '구글 시트 견적 이력 탭에 실시간 자동 누적',
        status: 'IDLE',
        metrics: { speed: 98, accuracy: 100, load: 8, uptime: '99.9%', tasksToday: 110 },
        currentTask: '대기 중 (신규 견적 완료 대기)',
        lastActive: '8분 전',
        triggerEvents: ['EVENT_MARGIN_DEFENDED'],
        emittedEvents: ['EVENT_QUOTE_RECORDED'],
        logs: ['[08:45] 구글시트 #2026-1044행 기록 완료']
    },
    {
        id: 'est-quote-doc',
        code: 'EST-07',
        name: '견적서 PDF 생성봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 3,
        role: '알트에프 공식 인장 포함 견적서 PDF/엑셀 렌더링',
        status: 'ACTIVE',
        metrics: { speed: 95, accuracy: 99, load: 55, uptime: '99.9%', tasksToday: 140 },
        currentTask: 'QT-26-1082 대양철강 견적서 PDF 렌더링 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_QUOTE_RECORDED'],
        emittedEvents: ['EVENT_QUOTE_PDF_READY'],
        logs: ['[09:15] 견적서 PDF 생성 (3.2MB)']
    },
    {
        id: 'est-customer-dispatch',
        code: 'EST-08',
        name: '견적 발송 담당봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 2,
        role: '고객사 담당자 메일 및 카카오 알림톡 자동 회신',
        status: 'ACTIVE',
        metrics: { speed: 97, accuracy: 99, load: 30, uptime: '100%', tasksToday: 138 },
        currentTask: '대양철강 김과장 앞 견적 메일 발송 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_QUOTE_PDF_READY'],
        emittedEvents: ['EVENT_QUOTE_SENT'],
        logs: ['[09:16] 메일플러그 SMTP 전송 성공']
    },
    {
        id: 'est-followup-guard',
        code: 'EST-09',
        name: '견적 추적 팔로업봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 2,
        role: '견적 발송 후 48시간 내 미발주 시 담당자 리마인드',
        status: 'STANDBY',
        metrics: { speed: 90, accuracy: 95, load: 12, uptime: '100%', tasksToday: 18 },
        currentTask: '어제 발송된 14건 중 4건 후속 알림 대기',
        lastActive: '30분 전',
        triggerEvents: ['CRON_EVERY_HOUR'],
        emittedEvents: ['EVENT_FOLLOWUP_TRIGGERED'],
        logs: ['[07:00] 48시간 경과 2개사 리마인드 큐 등록']
    },
    {
        id: 'est-winloss-analyst',
        code: 'EST-10',
        name: '수주·실주 분석봇',
        deptId: 'quote',
        deptName: '견적부',
        tier: 3,
        role: '견적 대비 실제 발주 전환율 및 가격 저항 분석',
        status: 'IDLE',
        metrics: { speed: 88, accuracy: 96, load: 5, uptime: '99.9%', tasksToday: 1 },
        currentTask: '주간 견적 전환율(34.2%) 보고서 빌드 준비',
        lastActive: '1시간 전',
        triggerEvents: ['CRON_DAILY_MIDNIGHT'],
        emittedEvents: ['EVENT_WINLOSS_REPORT_READY'],
        logs: ['[00:05] 일일 전환율 집계 완료']
    },

    // ----------------------------------------------------
    // 2. 구매부 (9명)
    // ----------------------------------------------------
    {
        id: 'pur-stock-reorder',
        code: 'PUR-01',
        name: '안전재고 발주봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 3,
        role: '시화 안전재고 21일 미만 품목 실시간 선매입 감지',
        status: 'ACTIVE',
        metrics: { speed: 95, accuracy: 99, load: 45, uptime: '99.9%', tasksToday: 64 },
        currentTask: '50A 10K 엘보 재고 14일분 미만 감지! 선발주 큐 인큐',
        lastActive: '2분 전',
        triggerEvents: ['EVENT_INVENTORY_CHANGED'],
        emittedEvents: ['EVENT_REORDER_REQUIRED'],
        logs: ['[09:10] 시화 안전재고 미달 2품목 발주 권고']
    },
    {
        id: 'pur-daekyung-watcher',
        code: 'PUR-02',
        name: '대경 재고 감시봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 3,
        role: '대경벤드 양산재고 급감/품귀 선행 신호 24시간 추적',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 99, load: 60, uptime: '100%', tasksToday: 240 },
        currentTask: '대경 Sch40S 재고 변동 내역 30분 주기 스캔 완료',
        lastActive: '방금 전',
        triggerEvents: ['CRON_EVERY_10MIN'],
        emittedEvents: ['EVENT_DAEKYUNG_STOCK_DIPPED'],
        logs: ['[09:20] 대경벤드 304 Sch40S 80A 200개 감소 감지']
    },
    {
        id: 'pur-supplier-po-gen',
        code: 'PUR-03',
        name: '외주 발주서 생성봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 2,
        role: '대경, 하이테크, 태광 등 협력사별 공식 발주서 작성',
        status: 'STANDBY',
        metrics: { speed: 94, accuracy: 98, load: 25, uptime: '99.9%', tasksToday: 28 },
        currentTask: '대경벤드 정기 발주서(PO-261018-01) 작성 대기',
        lastActive: '10분 전',
        triggerEvents: ['EVENT_REORDER_REQUIRED'],
        emittedEvents: ['EVENT_SUPPLIER_PO_GENERATED'],
        logs: ['[08:30] 대경 PO 생성 완료 (15개 품목)']
    },
    {
        id: 'pur-po-dispatcher',
        code: 'PUR-04',
        name: '발주서 전송봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 2,
        role: '매입처 영업 담당자 메일/웹으로 발주서 자동 전송',
        status: 'STANDBY',
        metrics: { speed: 98, accuracy: 100, load: 15, uptime: '100%', tasksToday: 28 },
        currentTask: '대경벤드 영업부 앞 메일 발송 완료',
        lastActive: '10분 전',
        triggerEvents: ['EVENT_SUPPLIER_PO_GENERATED'],
        emittedEvents: ['EVENT_PO_DISPATCHED'],
        logs: ['[08:31] yrkim@daekyungbend.com 발송 성공']
    },
    {
        id: 'pur-leadtime-tracker',
        code: 'PUR-05',
        name: '생산 납기 추적봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 2,
        role: '제조사 생산 완료 및 입고 예정일(D-Day) 카운트다운',
        status: 'ACTIVE',
        metrics: { speed: 91, accuracy: 96, load: 30, uptime: '99.9%', tasksToday: 45 },
        currentTask: '10/22 입고 예정건 3건 진행 상태 모니터링',
        lastActive: '4분 전',
        triggerEvents: ['CRON_EVERY_HOUR'],
        emittedEvents: ['EVENT_LEADTIME_UPDATED'],
        logs: ['[09:00] 입고 지연 위험 0건 정상']
    },
    {
        id: 'pur-price-trend',
        code: 'PUR-06',
        name: '원자재 시세 분석봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 3,
        role: 'LME 니켈 시세 및 국내 STS 판가 변동 모니터링',
        status: 'IDLE',
        metrics: { speed: 85, accuracy: 94, load: 10, uptime: '99.9%', tasksToday: 12 },
        currentTask: 'LME 니켈 $16,450/t 보합세 기록',
        lastActive: '40분 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_COMMODITY_PRICE_UPDATED'],
        logs: ['[06:30] 원자재 시세 지표 갱신']
    },
    {
        id: 'pur-split-balancer',
        code: 'PUR-07',
        name: '분할 발주 최적화봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 2,
        role: '긴급분(시화) vs 양산분(대경) 최적 단가 분할 배분',
        status: 'STANDBY',
        metrics: { speed: 93, accuracy: 97, load: 18, uptime: '99.8%', tasksToday: 22 },
        currentTask: '분할 발주 비율 최적화 대기',
        lastActive: '15분 전',
        triggerEvents: ['EVENT_PO_SPLIT_REQUESTED'],
        emittedEvents: ['EVENT_PO_SPLIT_OPTIMIZED'],
        logs: ['[08:15] 시화 30% / 대경 70% 최적 배분']
    },
    {
        id: 'pur-invoice-verifier',
        code: 'PUR-08',
        name: '매입 세금계산서 대조봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 2,
        role: '협력사 청구 금액과 발주서 확정 단가 1원 단위 대조',
        status: 'IDLE',
        metrics: { speed: 96, accuracy: 100, load: 12, uptime: '100%', tasksToday: 15 },
        currentTask: '매입 대사 완료 (불일치 0건)',
        lastActive: '50분 전',
        triggerEvents: ['EVENT_PURCHASE_INVOICE_INBOUND'],
        emittedEvents: ['EVENT_PURCHASE_VERIFIED'],
        logs: ['[07:40] 대경벤드 10/16 출고분 대사 일치']
    },
    {
        id: 'pur-month-end-budget',
        code: 'PUR-09',
        name: '월말 매입 자금 산출봇',
        deptId: 'purchase',
        deptName: '구매부',
        tier: 3,
        role: '익월/월말 결제 필요 구매 소요 자금 자동 계산',
        status: 'STANDBY',
        metrics: { speed: 90, accuracy: 98, load: 20, uptime: '99.9%', tasksToday: 4 },
        currentTask: '10월 말 예상 매입 채무 1억 4,200만원 추산',
        lastActive: '20분 전',
        triggerEvents: ['CRON_DAILY_EVENING'],
        emittedEvents: ['EVENT_PURCHASE_BUDGET_ESTIMATED'],
        logs: ['[08:00] 자금 스케줄 경영지원부 전달']
    },

    // ----------------------------------------------------
    // 3. 총무부 (9명)
    // ----------------------------------------------------
    {
        id: 'gen-invoice-creator',
        code: 'GEN-01',
        name: '거래명세표 발행봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 3,
        role: '출고 확정 데이터 기반 공식 거래명세표 PDF/엑셀 자동 생성',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 100, load: 50, uptime: '100%', tasksToday: 88 },
        currentTask: '(주)태형산업 ES261014 거래명세표 생성 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MATERIAL_SHIPPED'],
        emittedEvents: ['EVENT_INVOICE_ISSUED'],
        logs: ['[09:18] 거래명세표 #TR-261018-042 생성 완료']
    },
    {
        id: 'gen-tax-homotax-sync',
        code: 'GEN-02',
        name: '전자세금계산서 연동봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 3,
        role: '홈택스/바로빌 연동 전자세금계산서 자동 발행 및 국세청 전송',
        status: 'STANDBY',
        metrics: { speed: 96, accuracy: 100, load: 35, uptime: '99.9%', tasksToday: 74 },
        currentTask: '국세청 전자세금계산서 전송 대기',
        lastActive: '6분 전',
        triggerEvents: ['EVENT_INVOICE_ISSUED'],
        emittedEvents: ['EVENT_TAX_INVOICE_SUBMITTED'],
        logs: ['[09:05] 세금계산서 3건 정상 승인']
    },
    {
        id: 'gen-statement-dispatcher',
        code: 'GEN-03',
        name: '거래명세표 발송봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 2,
        role: '고객사 회계 담당자 앞 거래명세표 자동 메일/팩스 발송',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 28, uptime: '100%', tasksToday: 86 },
        currentTask: '태형산업 회계팀 앞 명세표 발송 신호 발행',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_INVOICE_ISSUED'],
        emittedEvents: ['EVENT_STATEMENT_DISPATCHED'],
        logs: ['[09:18] 발송 신호 발행 -> 품질부 연계 대기']
    },
    {
        id: 'gen-payment-tracker',
        code: 'GEN-04',
        name: '입금 내역 대조봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 3,
        role: '기업은행 계좌 실시간 입금 통지와 외상매출금 1:1 매칭',
        status: 'ACTIVE',
        metrics: { speed: 95, accuracy: 100, load: 40, uptime: '100%', tasksToday: 52 },
        currentTask: '방금 전 12,500,000원 입금 대조 완료 (현대이엔지)',
        lastActive: '1분 전',
        triggerEvents: ['EVENT_BANK_DEPOSIT_NOTIFICATION'],
        emittedEvents: ['EVENT_PAYMENT_RECONCILED'],
        logs: ['[09:17] 입금 반제 처리 완료']
    },
    {
        id: 'gen-credit-guard',
        code: 'GEN-05',
        name: '여신 한도 차단봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 2,
        role: '거래처별 외상 매출 한도 초과 시 출고 자동 홀드',
        status: 'STANDBY',
        metrics: { speed: 99, accuracy: 100, load: 10, uptime: '100%', tasksToday: 95 },
        currentTask: '여신 한도 이상 거래처 0건 (모두 정상 범위)',
        lastActive: '3분 전',
        triggerEvents: ['EVENT_NEW_ORDER_CREATED'],
        emittedEvents: ['EVENT_CREDIT_APPROVED', 'EVENT_CREDIT_BLOCKED'],
        logs: ['[09:14] 여신 체크 통과']
    },
    {
        id: 'gen-expense-archiver',
        code: 'GEN-06',
        name: '운영 경비 정리봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 1,
        role: '화물 운임비, 창고 부자재 영수증 OCR 자동 전표 처리',
        status: 'IDLE',
        metrics: { speed: 91, accuracy: 95, load: 8, uptime: '99.9%', tasksToday: 18 },
        currentTask: '대신화물 운임 전표 4건 처리 완료',
        lastActive: '25분 전',
        triggerEvents: ['EVENT_EXPENSE_RECEIPT_INBOUND'],
        emittedEvents: ['EVENT_EXPENSE_RECORDED'],
        logs: ['[08:50] 운임 전표 전표화 완료']
    },
    {
        id: 'gen-corp-doc-manager',
        code: 'GEN-07',
        name: '회사 서류 발급봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 1,
        role: '사업자등록증, 통장사본 등 거래처 신규 등록 서류 자동 회신',
        status: 'IDLE',
        metrics: { speed: 99, accuracy: 100, load: 5, uptime: '100%', tasksToday: 12 },
        currentTask: '서류 발급 요청 대기 중',
        lastActive: '1시간 전',
        triggerEvents: ['EVENT_CORP_DOC_REQUESTED'],
        emittedEvents: ['EVENT_CORP_DOC_SENT'],
        logs: ['[07:20] 신규 거래처 서류 세트 발송']
    },
    {
        id: 'gen-aging-analyst',
        code: 'GEN-08',
        name: '미수금 연체 경보봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 3,
        role: '30일/60일 초과 미수채권 자동 감지 및 독촉장 초안',
        status: 'STANDBY',
        metrics: { speed: 93, accuracy: 98, load: 15, uptime: '100%', tasksToday: 6 },
        currentTask: '장기 미수채권 1건 모니터링 중',
        lastActive: '30분 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_AGING_OVERDUE_ALERT'],
        logs: ['[08:00] 연체 경보 1건 경영지원부 통보']
    },
    {
        id: 'gen-settlement-closer',
        code: 'GEN-09',
        name: '월말 결산 집계봇',
        deptId: 'general',
        deptName: '총무부',
        tier: 3,
        role: '월말 매출·매입 마감 집계 및 손익계산서 자동 기초 작성',
        status: 'IDLE',
        metrics: { speed: 89, accuracy: 99, load: 10, uptime: '100%', tasksToday: 2 },
        currentTask: '월말 가결산 대기 중',
        lastActive: '2시간 전',
        triggerEvents: ['CRON_MONTHLY_CLOSE'],
        emittedEvents: ['EVENT_SETTLEMENT_CLOSED'],
        logs: ['[00:00] 전일자 매출/매입 마감 완료']
    },

    // ----------------------------------------------------
    // 4. 품질부 (10명) - 사용자가 가장 강조한 핵심 부서
    // ----------------------------------------------------
    {
        id: 'qc-inbound-ingest',
        code: 'QC-01',
        name: '외주 성적서 접수봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 3,
        role: 'altf@altf.kr 메일플러그 대경벤드 수신 성적서(.zip/pdf) 무인 다운로드 및 압축 해제',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 100, load: 52, uptime: '100%', tasksToday: 65 },
        currentTask: '10/12일 출고분 대경벤드 30개 PDF 압축 해제 및 아카이빙 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_INBOUND_EMAIL_RECEIVED'],
        emittedEvents: ['EVENT_MTC_FILES_READY'],
        logs: ['[09:05] yrkim@daekyungbend.com 성적서 30개 파일 접수 완료']
    },
    {
        id: 'qc-mtc-vision-reader',
        code: 'QC-02',
        name: '성적서 비전 판독봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 3,
        role: 'PDF 표/텍스트/OCR 정밀 판독 (DKB LOT, Heat No, C/Si/Mn/Ni/Cr, YS/TS/EL)',
        status: 'ACTIVE',
        metrics: { speed: 94, accuracy: 99, load: 75, uptime: '99.9%', tasksToday: 180 },
        currentTask: 'YR-26-09915 성적서 판독 완료 (Heat: SD62415, C: 0.017, Ni: 10.10)',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MTC_FILES_READY'],
        emittedEvents: ['EVENT_MTC_DATA_EXTRACTED'],
        logs: ['[09:06] SD62415 실측치 추출 성공']
    },
    {
        id: 'qc-chemical-db-sync',
        code: 'QC-03',
        name: '화학 성분 관리봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 2,
        role: '추출된 C, Si, Mn, P, S, Ni, Cr, Mo 값을 구글 시트 및 마스터 엑셀에 행 누적',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 38, uptime: '100%', tasksToday: 180 },
        currentTask: '구글 시트 엑셀 마스터(data/certificates_master.xlsx) 4개 행 동기화 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MTC_DATA_EXTRACTED'],
        emittedEvents: ['EVENT_CHEMICAL_DB_SYNCED'],
        logs: ['[09:07] 마스터 엑셀 실측치 DB 반영 완료']
    },
    {
        id: 'qc-mechanical-db-sync',
        code: 'QC-04',
        name: '기계 성질 관리봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 2,
        role: '인장강도(YS, TS, EL) 및 열처리 조건(1050℃ Annealing) 규격 매핑',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 100, load: 35, uptime: '100%', tasksToday: 180 },
        currentTask: 'YS 298MPa / TS 622MPa 정상 범위 인덱싱 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MTC_DATA_EXTRACTED'],
        emittedEvents: ['EVENT_MECHANICAL_DB_SYNCED'],
        logs: ['[09:07] 기계성질 DB 매핑 완료']
    },
    {
        id: 'qc-po-matcher',
        code: 'QC-05',
        name: '성적서·발주서 매칭봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 3,
        role: '출고 신호(출고부) + 거래명세표(총무부) 수신 시 고객사 P.O 번호와 Heat No 자동 1:1 매칭',
        status: 'ACTIVE',
        metrics: { speed: 97, accuracy: 100, load: 60, uptime: '100%', tasksToday: 92 },
        currentTask: '태형산업 ES261014-2869 발주건 Heat No SD62415 자동 매칭 성공',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MATERIAL_SHIPPED', 'EVENT_INVOICE_ISSUED'],
        emittedEvents: ['EVENT_MTC_MATCHED'],
        logs: ['[09:19] 출고부/총무부 신호 결합 -> 성적서 매칭 성공']
    },
    {
        id: 'qc-cert-builder',
        code: 'QC-06',
        name: 'EN10204 성적서 생성봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 3,
        role: '규격 기준치(ASTM/KS) 자동 결합하여 이미지 2 서식의 공식 성적서 엑셀 및 PDF 무인 렌더링',
        status: 'ACTIVE',
        metrics: { speed: 96, accuracy: 100, load: 65, uptime: '100%', tasksToday: 90 },
        currentTask: 'CERT_YR-26-09915_태형산업.xlsx 및 고해상도 PDF 생성 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MTC_MATCHED'],
        emittedEvents: ['EVENT_MTC_GENERATED'],
        logs: ['[09:20] 공식 성적서 PDF 렌더링 완료']
    },
    {
        id: 'qc-tolerance-inspector',
        code: 'QC-07',
        name: '규격 적합성 검증봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 3,
        role: 'C, Ni, Cr, YS, TS 실측값이 ASTM/KS 허용 공차 범위 내에 있는지 불량 사전 차단',
        status: 'STANDBY',
        metrics: { speed: 99, accuracy: 100, load: 20, uptime: '100%', tasksToday: 95 },
        currentTask: '공차 검증 통과 (C: 0.017 < Max 0.035, Ni: 10.10 in Range)',
        lastActive: '2분 전',
        triggerEvents: ['EVENT_MTC_GENERATED'],
        emittedEvents: ['EVENT_TOLERANCE_VERIFIED'],
        logs: ['[09:20] 품질 합격 판정']
    },
    {
        id: 'qc-package-dispatcher',
        code: 'QC-08',
        name: '성적서 발송 담당봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 2,
        role: '총무부 거래명세표와 성적서 PDF를 하나로 묶어 고객사 메일로 원스톱 자동 전송',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 100, load: 45, uptime: '100%', tasksToday: 88 },
        currentTask: '(주)태형산업 품질관리팀 앞 거래명세서 + 성적서 동봉 발송 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_TOLERANCE_VERIFIED'],
        emittedEvents: ['EVENT_CERTIFICATE_DELIVERED'],
        logs: ['[09:21] 고객사 발송 완료 및 텔레그램 대표님 보고']
    },
    {
        id: 'qc-missing-alert',
        code: 'QC-09',
        name: '성적서 누락 경보봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 2,
        role: '출고 예정 품목 중 외주 성적서 미입고 건 24시간 전 사전 경보 발령',
        status: 'STANDBY',
        metrics: { speed: 95, accuracy: 98, load: 15, uptime: '100%', tasksToday: 24 },
        currentTask: '금일 출고 대상 성적서 누락 0건 (모두 확보 완료)',
        lastActive: '15분 전',
        triggerEvents: ['CRON_EVERY_HOUR'],
        emittedEvents: ['EVENT_MISSING_MTC_ALERT'],
        logs: ['[08:30] 성적서 결품 위험 없음']
    },
    {
        id: 'qc-cloud-archiver',
        code: 'QC-10',
        name: '품질 기록 아카이브봇',
        deptId: 'quality',
        deptName: '품질부',
        tier: 1,
        role: '발급 완료된 모든 성적서 원본 AWS S3 및 로컬 영구 암호화 아카이빙',
        status: 'IDLE',
        metrics: { speed: 96, accuracy: 100, load: 10, uptime: '100%', tasksToday: 90 },
        currentTask: 's3://altf-db/certificates/2026/10/ 보관 완료',
        lastActive: '20분 전',
        triggerEvents: ['EVENT_CERTIFICATE_DELIVERED'],
        emittedEvents: ['EVENT_MTC_ARCHIVED'],
        logs: ['[08:40] S3 영구 저장 완료']
    },

    // ----------------------------------------------------
    // 5. 출고부 (9명)
    // ----------------------------------------------------
    {
        id: 'ship-signal-emitter',
        code: 'LOG-01',
        name: '출고 신호 발행봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 3,
        role: '창고 실물 검수 완료 시 전사에 "EVENT_MATERIAL_SHIPPED" 트리거 발신',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 55, uptime: '100%', tasksToday: 96 },
        currentTask: '(주)태형산업 ES261014 4개 품목 자재 출고 신호 발행 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_WAREHOUSE_PACKING_DONE'],
        emittedEvents: ['EVENT_MATERIAL_SHIPPED'],
        logs: ['[09:17] 자재 출고 신호 발행 -> 총무부/품질부 연계 시작']
    },
    {
        id: 'ship-pending-monitor',
        code: 'LOG-02',
        name: '미결 주문 감시봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 3,
        role: 'altf.kr 미결 주문(Pending Orders) 납기 지연 방지 및 코멘트 감시',
        status: 'ACTIVE',
        metrics: { speed: 97, accuracy: 99, load: 60, uptime: '100%', tasksToday: 130 },
        currentTask: '지연 미결 0건 유지 (납기 준수율 100%)',
        lastActive: '3분 전',
        triggerEvents: ['CRON_EVERY_10MIN'],
        emittedEvents: ['EVENT_PENDING_HEALTHY'],
        logs: ['[09:15] 미결 28건 납기 체크 정상']
    },
    {
        id: 'ship-sticker-updater',
        code: 'LOG-03',
        name: '상태 스티커 갱신봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 2,
        role: '주문별 상태 스티커(재고품/사급/생산중/출고대기) 실시간 자동 전이',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 100, load: 45, uptime: '100%', tasksToday: 110 },
        currentTask: '3건 스티커 "출고완료" 상태로 변경 완료',
        lastActive: '2분 전',
        triggerEvents: ['EVENT_MATERIAL_SHIPPED'],
        emittedEvents: ['EVENT_STICKER_UPDATED'],
        logs: ['[09:17] 스티커 [출고대기 -> 출고완료] 전이']
    },
    {
        id: 'ship-freight-booker',
        code: 'LOG-04',
        name: '화물 배차 신청봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 2,
        role: '대신/경동화물 API 연동 및 1톤/용차 실시간 호출 접수',
        status: 'STANDBY',
        metrics: { speed: 92, accuracy: 96, load: 22, uptime: '99.9%', tasksToday: 34 },
        currentTask: '시화공단 대신화물 17시 집하 예약 대기',
        lastActive: '15분 전',
        triggerEvents: ['EVENT_SHIPMENT_READY'],
        emittedEvents: ['EVENT_FREIGHT_BOOKED'],
        logs: ['[08:50] 배차 예약 3건 완료']
    },
    {
        id: 'ship-waybill-tracker',
        code: 'LOG-05',
        name: '운송장 번호 추적봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 2,
        role: '운송장 번호 자동 채번 및 택배사 배송 상태 동기화',
        status: 'ACTIVE',
        metrics: { speed: 96, accuracy: 99, load: 38, uptime: '100%', tasksToday: 82 },
        currentTask: '대신 2026-1049-2810 운송장 연동 완료',
        lastActive: '5분 전',
        triggerEvents: ['EVENT_FREIGHT_BOOKED'],
        emittedEvents: ['EVENT_WAYBILL_ASSIGNED'],
        logs: ['[09:12] 운송장 번호 고객사 시스템 연동']
    },
    {
        id: 'ship-customer-notice',
        code: 'LOG-06',
        name: '출고 안내 알림봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 2,
        role: '고객사 현장 소장/자재 담당자에게 운송장 및 도착 예정 카톡 발송',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 30, uptime: '100%', tasksToday: 82 },
        currentTask: '태형산업 자재과 앞 카카오 알림톡 발송 완료',
        lastActive: '4분 전',
        triggerEvents: ['EVENT_WAYBILL_ASSIGNED'],
        emittedEvents: ['EVENT_DISPATCH_NOTIFIED'],
        logs: ['[09:13] 카카오 알림톡 발송 성공']
    },
    {
        id: 'ship-split-coordinator',
        code: 'LOG-07',
        name: '분할 출고 조율봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 2,
        role: '1차 긴급 출고 후 2차 잔여 생산분 출고 일정 자동 관리',
        status: 'STANDBY',
        metrics: { speed: 91, accuracy: 95, load: 18, uptime: '99.8%', tasksToday: 14 },
        currentTask: '분할 출고 2건 잔여분 납기 트래킹 중',
        lastActive: '25분 전',
        triggerEvents: ['EVENT_SPLIT_SHIPPED'],
        emittedEvents: ['EVENT_SPLIT_SCHEDULED'],
        logs: ['[08:20] 2차 출고 D-2 알림 예약']
    },
    {
        id: 'ship-damage-handler',
        code: 'LOG-08',
        name: '오배송 클레임 접수봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 2,
        role: '운송 중 파손/수량 불일치 클레임 접수 시 긴급 재출고 큐 등록',
        status: 'IDLE',
        metrics: { speed: 95, accuracy: 98, load: 5, uptime: '100%', tasksToday: 1 },
        currentTask: '클레임 0건 (모두 정상 배송)',
        lastActive: '1시간 전',
        triggerEvents: ['EVENT_CLAIM_INBOUND'],
        emittedEvents: ['EVENT_EMERGENCY_REPLACE_QUEUED'],
        logs: ['[07:00] 클레임 내역 없음']
    },
    {
        id: 'ship-daily-dispatch-log',
        code: 'LOG-09',
        name: '일일 출고 결산봇',
        deptId: 'shipping',
        deptName: '출고부',
        tier: 1,
        role: '오늘 출고된 총 중량(Kg), 박스/파레트 수, 운임비 합산 보고',
        status: 'IDLE',
        metrics: { speed: 90, accuracy: 99, load: 8, uptime: '100%', tasksToday: 2 },
        currentTask: '금일 누적 출고 중량 4,820Kg 집계 중',
        lastActive: '45분 전',
        triggerEvents: ['CRON_DAILY_EVENING'],
        emittedEvents: ['EVENT_DAILY_DISPATCH_LOGGED'],
        logs: ['[08:30] 총 4.8톤 출고 진행 중']
    },

    // ----------------------------------------------------
    // 6. 데이터관리부 (10명)
    // ----------------------------------------------------
    {
        id: 'data-daekyung-scraper',
        code: 'DAT-01',
        name: '대경 재고 크롤러',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 3,
        role: '대경벤드 공식 사이트 재고 4,800여 품목 1시간 주기 자동 크롤링',
        status: 'ACTIVE',
        metrics: { speed: 96, accuracy: 99, load: 70, uptime: '99.9%', tasksToday: 24 },
        currentTask: '대경벤드 양산재고 4,852개 품목 파싱 완료 (변동 14건)',
        lastActive: '방금 전',
        triggerEvents: ['CRON_EVERY_HOUR'],
        emittedEvents: ['EVENT_DAEKYUNG_SCRAPED'],
        logs: ['[09:00] 대경벤드 4852개 품목 수집 완료']
    },
    {
        id: 'data-sihwa-indexer',
        code: 'DAT-02',
        name: '시화 재고 색인봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 2,
        role: '시화 본사 창고 입출고 데이터 실시간 색인 및 인메모리 갱신',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 45, uptime: '100%', tasksToday: 160 },
        currentTask: '시화 재고 맵 1,420개 아이템 최신화 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_INVENTORY_CHANGED'],
        emittedEvents: ['EVENT_SIHWA_INDEXED'],
        logs: ['[09:18] 시화창고 색인 완료']
    },
    {
        id: 'data-busan-indexer',
        code: 'DAT-03',
        name: '부산 재고 색인봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 2,
        role: '부산 지사 창고 재고 데이터 실시간 색인',
        status: 'STANDBY',
        metrics: { speed: 99, accuracy: 100, load: 20, uptime: '100%', tasksToday: 60 },
        currentTask: '부산 재고 맵 680개 아이템 최신화 완료',
        lastActive: '10분 전',
        triggerEvents: ['EVENT_INVENTORY_CHANGED'],
        emittedEvents: ['EVENT_BUSAN_INDEXED'],
        logs: ['[08:50] 부산창고 색인 완료']
    },
    {
        id: 'data-similarity-engine',
        code: 'DAT-04',
        name: '유사도 교정 엔진',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 3,
        role: '비표준 배관 명칭(예: 45엘보, 엘보우, 45E) 오탈자 및 유사도 100% 매핑',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 99, load: 50, uptime: '100%', tasksToday: 320 },
        currentTask: '"45E 25A" -> "45E(L) S/10S 25A B.W" 정규화 완료',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_SEARCH_QUERY', 'EVENT_QUOTE_PARSED'],
        emittedEvents: ['EVENT_TERM_NORMALIZED'],
        logs: ['[09:12] 유사도 0.98 매칭 성공']
    },
    {
        id: 'data-customer-cleanser',
        code: 'DAT-05',
        name: '거래처 정보 정제봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 2,
        role: '사업자등록번호, 주소, 대표자명, 담당자 연락처 무결성 검증',
        status: 'IDLE',
        metrics: { speed: 95, accuracy: 98, load: 15, uptime: '100%', tasksToday: 40 },
        currentTask: '거래처 DB 412개사 정합성 체크 완료',
        lastActive: '30분 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_CUSTOMERS_CLEANSED'],
        logs: ['[07:00] 휴폐업 거래처 0건']
    },
    {
        id: 'data-price-crawler',
        code: 'DAT-06',
        name: '시장 판가 모니터봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 2,
        role: '경쟁 유통사 온라인 공시단가 및 철강 시장 동향 데이터 수집',
        status: 'STANDBY',
        metrics: { speed: 90, accuracy: 94, load: 25, uptime: '99.8%', tasksToday: 18 },
        currentTask: '경쟁사 STS 피팅 할인율 변동 모니터링',
        lastActive: '20분 전',
        triggerEvents: ['CRON_EVERY_4HOURS'],
        emittedEvents: ['EVENT_MARKET_PRICE_UPDATED'],
        logs: ['[06:00] 시화유통단지 할인율 보합 확인']
    },
    {
        id: 'data-s3-sync-guard',
        code: 'DAT-07',
        name: 'S3 실시간 동기화봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 3,
        role: '로컬 DB와 AWS S3 비즈니스 DB 간 양방향 무결성 동기화',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 100, load: 40, uptime: '100%', tasksToday: 210 },
        currentTask: 's3-db.js 원격 스냅샷 저장 완료',
        lastActive: '1분 전',
        triggerEvents: ['EVENT_DB_MUTATED'],
        emittedEvents: ['EVENT_S3_SYNCED'],
        logs: ['[09:17] S3 PUT 성공 (db.json)']
    },
    {
        id: 'data-backup-guardian',
        code: 'DAT-08',
        name: '스냅샷 백업 수호자',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 3,
        role: '매일 자정 타임스탬프별 불변 백업 생성 및 복구 테스트',
        status: 'STANDBY',
        metrics: { speed: 92, accuracy: 100, load: 10, uptime: '100%', tasksToday: 1 },
        currentTask: '전일 백업 스냅샷 1784174777806 무결성 검증 완료',
        lastActive: '4시간 전',
        triggerEvents: ['CRON_DAILY_MIDNIGHT'],
        emittedEvents: ['EVENT_BACKUP_COMPLETED'],
        logs: ['[00:00] 일일 자동 백업 완료']
    },
    {
        id: 'data-schema-validator',
        code: 'DAT-09',
        name: '규격 코드 검증봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 1,
        role: '신규 품목 추가 시 재질/압력/구경 코드 표준 준수 검사',
        status: 'IDLE',
        metrics: { speed: 99, accuracy: 100, load: 5, uptime: '100%', tasksToday: 14 },
        currentTask: '품목 코드 유효성 검사 대기',
        lastActive: '1시간 전',
        triggerEvents: ['EVENT_NEW_ITEM_REGISTERED'],
        emittedEvents: ['EVENT_SCHEMA_VALIDATED'],
        logs: ['[08:10] 표준 코드 매핑 완료']
    },
    {
        id: 'data-api-gateway-watch',
        code: 'DAT-10',
        name: '웹훅 게이트웨이 감시봇',
        deptId: 'data',
        deptName: '데이터관리부',
        tier: 2,
        role: 'Make.com, 구글시트, 메일플러그 웹훅 인입 트래픽 헬스체크',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 15, uptime: '100%', tasksToday: 420 },
        currentTask: '모든 외부 웹훅 엔드포인트 200 OK 정상 가동',
        lastActive: '방금 전',
        triggerEvents: ['CRON_EVERY_MINUTE'],
        emittedEvents: ['EVENT_GATEWAY_HEALTHY'],
        logs: ['[09:20] 웹훅 수신 레이턴시 18ms']
    },

    // ----------------------------------------------------
    // 7. 자재관리부 (9명)
    // ----------------------------------------------------
    {
        id: 'mat-location-tracker',
        code: 'MAT-01',
        name: '창고 랙 위치 추적봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 2,
        role: '시화/부산 창고 구역(Zone A~D) 및 랙 번호별 재고 위치 가이드',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 99, load: 35, uptime: '100%', tasksToday: 110 },
        currentTask: '태형산업 출고건 4개 품목: 랙 B-04, C-12 위치 매핑',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_PICKING_REQUESTED'],
        emittedEvents: ['EVENT_LOCATION_MAPPED'],
        logs: ['[09:16] 피킹 경로 최적화 완료']
    },
    {
        id: 'mat-aging-stock-guard',
        code: 'MAT-02',
        name: '장기 과잉재고 청산봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 3,
        role: '180일 이상 미출고 잠긴 자본(과잉재고) 식별 및 유동화 제안',
        status: 'STANDBY',
        metrics: { speed: 89, accuracy: 96, load: 20, uptime: '99.9%', tasksToday: 8 },
        currentTask: '장기 체류재고 8개 품목(총 1,840만원) 할인 프로모션 큐 전달',
        lastActive: '30분 전',
        triggerEvents: ['CRON_WEEKLY_MONDAY'],
        emittedEvents: ['EVENT_AGING_STOCK_FLAGGED'],
        logs: ['[07:00] 과잉재고 유동화 목록 도출']
    },
    {
        id: 'mat-cycle-counter',
        code: 'MAT-03',
        name: '재고 실사 오차 보정봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 2,
        role: '주기적 순환 실사(Cycle Count) 계획 및 장부/실물 차이 보정',
        status: 'IDLE',
        metrics: { speed: 94, accuracy: 99, load: 12, uptime: '100%', tasksToday: 15 },
        currentTask: '주간 실사 계획표 수립 대기',
        lastActive: '50분 전',
        triggerEvents: ['CRON_CYCLE_COUNT'],
        emittedEvents: ['EVENT_CYCLE_COUNT_LOGGED'],
        logs: ['[08:00] 시화 A구역 오차 0개']
    },
    {
        id: 'mat-inbound-inspector',
        code: 'MAT-04',
        name: '입고 현장 검수봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 2,
        role: '제조사 납품 트럭 도착 시 포장 외관 및 수량 일차 체크',
        status: 'STANDBY',
        metrics: { speed: 93, accuracy: 98, load: 22, uptime: '99.8%', tasksToday: 14 },
        currentTask: '14시 대경 납품 트럭 입고 검수 대기',
        lastActive: '20분 전',
        triggerEvents: ['EVENT_TRUCK_ARRIVED'],
        emittedEvents: ['EVENT_INBOUND_INSPECTED'],
        logs: ['[08:40] 오전 입고 2톤 검수 완료']
    },
    {
        id: 'mat-bundling-optimizer',
        code: 'MAT-05',
        name: '패키징 묶음 최적화봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 1,
        role: '파이프/피팅 배송 시 묶음 밴딩 및 파레트 적재 공간 최소화',
        status: 'IDLE',
        metrics: { speed: 96, accuracy: 95, load: 15, uptime: '100%', tasksToday: 35 },
        currentTask: '대형 플랜지 파레트 테트리스 패킹 가이드 생성',
        lastActive: '40분 전',
        triggerEvents: ['EVENT_PACKING_STARTED'],
        emittedEvents: ['EVENT_PACKING_OPTIMIZED'],
        logs: ['[08:20] 2개 파레트로 최적 적재']
    },
    {
        id: 'mat-warehouse-capacity',
        code: 'MAT-06',
        name: '창고 적재율 감시봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 2,
        role: '시화 창고 현재 적재율(68%) 및 여유 파레트 공간 실시간 산출',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 99, load: 28, uptime: '100%', tasksToday: 48 },
        currentTask: '시화창고 적재율 68.4% (안전 여유 공간 31.6%)',
        lastActive: '5분 전',
        triggerEvents: ['CRON_EVERY_HOUR'],
        emittedEvents: ['EVENT_CAPACITY_UPDATED'],
        logs: ['[09:00] 창고 적재율 정상 유지']
    },
    {
        id: 'mat-heat-lot-tagger',
        code: 'MAT-07',
        name: 'Heat·Lot 바코드 발행봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 2,
        role: '입고 시 실물 자재에 부착할 Heat No/Lot No 바코드 라벨 자동 출력',
        status: 'STANDBY',
        metrics: { speed: 99, accuracy: 100, load: 20, uptime: '100%', tasksToday: 65 },
        currentTask: '라벨 프린터 연동 대기 중',
        lastActive: '15분 전',
        triggerEvents: ['EVENT_INBOUND_INSPECTED'],
        emittedEvents: ['EVENT_BARCODE_TAGGED'],
        logs: ['[08:42] Heat 바코드 65장 출력 완료']
    },
    {
        id: 'mat-scrap-recycle',
        code: 'MAT-08',
        name: '절단 잔재 스크랩 관리봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 1,
        role: '파이프 절단 후 남은 단척 자재 및 고철 스크랩 재고화/매각 관리',
        status: 'IDLE',
        metrics: { speed: 92, accuracy: 94, load: 5, uptime: '99.9%', tasksToday: 8 },
        currentTask: 'STS304 스크랩 누적 중량 420Kg 기록',
        lastActive: '2시간 전',
        triggerEvents: ['EVENT_PIPE_CUTTING_DONE'],
        emittedEvents: ['EVENT_SCRAP_LOGGED'],
        logs: ['[07:15] 잔재 재고 2본 등록']
    },
    {
        id: 'mat-safety-compliance',
        code: 'MAT-09',
        name: '창고 환경·안전 점검봇',
        deptId: 'material',
        deptName: '자재관리부',
        tier: 1,
        role: '창고 내부 온·습도(부식 방지) 센서 및 지게차 이동 통로 안전 점검',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 10, uptime: '100%', tasksToday: 24 },
        currentTask: '창고 온도 18.5℃, 습도 42% (스테인리스 최적 보관 환경)',
        lastActive: '방금 전',
        triggerEvents: ['CRON_EVERY_30MIN'],
        emittedEvents: ['EVENT_WAREHOUSE_SAFE'],
        logs: ['[09:10] 환경 센서 정상']
    },

    // ----------------------------------------------------
    // 8. 경영지원부 (9명)
    // ----------------------------------------------------
    {
        id: 'exec-daily-briefing',
        code: 'EXE-01',
        name: 'CEO 일일 브리핑봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: '매일 아침 8시 CEO 전용 일일 전사 핵심 실적 및 현금 흐름 요약 브리핑',
        status: 'ACTIVE',
        metrics: { speed: 97, accuracy: 100, load: 40, uptime: '100%', tasksToday: 5 },
        currentTask: '금일 아침 대표님 전용 일일 결산 브리핑 발송 완료',
        lastActive: '10분 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_CEO_BRIEFING_SENT'],
        logs: ['[08:00] 텔레그램 일일 리포트 전송 성공']
    },
    {
        id: 'exec-cashflow-radar',
        code: 'EXE-02',
        name: '현금흐름 레이더',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: '30일/60일 향후 매출 수금 vs 매입 결제 현금 유출입 실시간 시뮬레이션',
        status: 'ACTIVE',
        metrics: { speed: 94, accuracy: 98, load: 55, uptime: '100%', tasksToday: 18 },
        currentTask: '10월 말 자금 수지 흑자 +4,800만원 전망 유지',
        lastActive: '5분 전',
        triggerEvents: ['EVENT_PAYMENT_RECONCILED', 'EVENT_PURCHASE_BUDGET_ESTIMATED'],
        emittedEvents: ['EVENT_CASHFLOW_HEALTHY'],
        logs: ['[09:10] 현금 유동성 안전 진단']
    },
    {
        id: 'exec-crm-churn-guard',
        code: 'EXE-03',
        name: '고객 이탈 경보봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: '45일 이상 발주가 끊긴 과거 우량 고객사 선제 감지 및 대응책 제안',
        status: 'STANDBY',
        metrics: { speed: 91, accuracy: 95, load: 20, uptime: '100%', tasksToday: 12 },
        currentTask: '이탈 위험 거래처 2개사(한성플랜트, 영진산업) 리인게이지먼트 추천',
        lastActive: '15분 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_CHURN_RISK_DETECTED'],
        logs: ['[08:10] 이탈 경보 거래처 2곳 식별']
    },
    {
        id: 'exec-rising-star-spotter',
        code: 'EXE-04',
        name: '급부상 업체 발굴봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: '최근 30일 매출이 50% 이상 급성장한 신규 핵심 파트너사 포착',
        status: 'STANDBY',
        metrics: { speed: 93, accuracy: 97, load: 18, uptime: '100%', tasksToday: 8 },
        currentTask: '(주)태형산업 전월 대비 발주액 +72% 급성장 확인',
        lastActive: '20분 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_RISING_CUSTOMER_SPOTTED'],
        logs: ['[08:15] 태형산업 VIP 파트너십 추천']
    },
    {
        id: 'exec-profit-margin-watch',
        code: 'EXE-05',
        name: '품목별 수익성 감시봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 2,
        role: 'ANSI 고마진 vs KS 박마진 매출 비중 및 실질 마진 기여도 실시간 분석',
        status: 'ACTIVE',
        metrics: { speed: 95, accuracy: 98, load: 35, uptime: '100%', tasksToday: 24 },
        currentTask: '금주 평균 마진율 14.8% 달성 (전주 대비 +1.2%p 개선)',
        lastActive: '8분 전',
        triggerEvents: ['EVENT_INVOICE_ISSUED'],
        emittedEvents: ['EVENT_MARGIN_HEALTHY'],
        logs: ['[09:00] 마진율 지표 갱신']
    },
    {
        id: 'exec-human-in-loop-gate',
        code: 'EXE-06',
        name: '대표님 결재 관문봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: '원가 이하 투찰이나 5천만원 이상 대형 발주 등 위험 의사결정 모바일 승인 요청',
        status: 'STANDBY',
        metrics: { speed: 99, accuracy: 100, load: 15, uptime: '100%', tasksToday: 10 },
        currentTask: '대표님 승인 대기 건: 0건 (모든 작업 정상 범위 자동 승인)',
        lastActive: '25분 전',
        triggerEvents: ['EVENT_HIGH_RISK_DETECTED'],
        emittedEvents: ['EVENT_CEO_APPROVAL_GRANTED'],
        logs: ['[08:35] 결재 대기 큐 정상']
    },
    {
        id: 'exec-dept-kpi-balancer',
        code: 'EXE-07',
        name: '부서별 병목 조율봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: '8개 부서 75명 에이전트 작업 부하율 실시간 모니터링 및 병목 해소',
        status: 'ACTIVE',
        metrics: { speed: 98, accuracy: 99, load: 45, uptime: '100%', tasksToday: 180 },
        currentTask: '전사 에이전트 가동률 87.4% (병목 부서 없음, 품질부 처리율 최우수)',
        lastActive: '방금 전',
        triggerEvents: ['CRON_EVERY_5MIN'],
        emittedEvents: ['EVENT_SWARM_BALANCED'],
        logs: ['[09:20] 전사 부하율 밸런싱 완료']
    },
    {
        id: 'exec-competitor-intel',
        code: 'EXE-08',
        name: '경쟁 인텔리전스봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 2,
        role: '국내 석유화학/반도체 배관 대형 프로젝트 발주 뉴스 및 경쟁 유통사 동향 집계',
        status: 'IDLE',
        metrics: { speed: 86, accuracy: 92, load: 10, uptime: '99.8%', tasksToday: 4 },
        currentTask: '여수 석유화학 보수공사 배관재 발주 입찰 정보 스캔 대기',
        lastActive: '1시간 전',
        triggerEvents: ['CRON_DAILY_MORNING'],
        emittedEvents: ['EVENT_INTEL_GATHERED'],
        logs: ['[06:00] 산업 뉴스 8건 브리핑 등록']
    },
    {
        id: 'exec-macmini-health',
        code: 'EXE-09',
        name: 'Mac mini 자가진단봇',
        deptId: 'executive',
        deptName: '경영지원부',
        tier: 3,
        role: 'Mac mini M5 Pro CPU/GPU/메모리(24GB)/디스크/네트워크 24시간 감시 및 헬스 리포트',
        status: 'ACTIVE',
        metrics: { speed: 99, accuracy: 100, load: 12, uptime: '100%', tasksToday: 720 },
        currentTask: 'Apple M5 Pro: CPU 4.2%, RAM 4.8GB / 24GB (정상, 저소음, 9W)',
        lastActive: '방금 전',
        triggerEvents: ['CRON_EVERY_MINUTE'],
        emittedEvents: ['EVENT_HARDWARE_HEALTHY'],
        logs: ['[09:21] 하드웨어 헬스 상태: 최적 (Optimal)']
    }
];

// 실제 코드가 구현되어 동작하는 정예 에이전트 목록 (그 외 슬롯은 '+ AGENT 생성' 대기 상태로 노출)
const REAL_CREATED_IDS = new Set([
    'qc-inbound-ingest',      // QC-01 외주 성적서 접수봇 (Inbound Ingest)
    'qc-mtc-vision-reader',   // QC-02 성적서 비전 판독봇 (agent2-extractor 연동)
    'qc-po-matcher',          // QC-05 성적서·발주서 매칭봇 (PO Matcher)
    'qc-cert-builder',        // QC-06 EN10204 성적서 생성봇 (agent3-generator 연동)
    'qc-package-dispatcher'   // QC-08 성적서 발송 담당봇 (Dispatcher)
]);

const DEFAULT_CONNECTIONS: Record<string, string[]> = {
    'qc-inbound-ingest': ['purchase', 'data'],
    'qc-mtc-vision-reader': ['data'],
    'qc-po-matcher': ['shipping', 'general'],
    'qc-cert-builder': ['shipping', 'executive'],
    'qc-package-dispatcher': ['general', 'shipping', 'executive']
};

export const INITIAL_AGENTS: AgentUnit[] = RAW_INITIAL_AGENTS.map(agent => ({
    ...agent,
    isCreated: REAL_CREATED_IDS.has(agent.id),
    connectedDeptIds: DEFAULT_CONNECTIONS[agent.id] || []
}));

/**
 * 부서간 그물망 이벤트 연계 체인 (Cross-Department Event Linkage Net)
 * 대표님이 설명하신 실제 비즈니스 흐름을 1:1로 표현
 */
export interface EventLink {
    id: string;
    name: string;
    description: string;
    sourceDept: string;
    sourceAgent: string;
    event: string;
    targetDept: string;
    targetAgent: string;
    action: string;
}

export const EVENT_NETWORKS: EventLink[] = [
    {
        id: 'net-01',
        name: '출고 자재 성적서 연동 (★ 대표님 핵심 지시)',
        description: '출고부 자재 출고 신호 발생 시 총무부와 품질부가 동시 반응하여 성적서 매칭 착수',
        sourceDept: '출고부',
        sourceAgent: 'ship-signal-emitter',
        event: 'EVENT_MATERIAL_SHIPPED',
        targetDept: '품질부',
        targetAgent: 'qc-po-matcher',
        action: '고객사 P.O 번호와 창고 출고 Heat No 실측치 자동 매칭 시작'
    },
    {
        id: 'net-02',
        name: '거래명세표 발행 연동',
        description: '출고 신호에 따라 총무부가 거래명세표를 자동 발행하고 발송 대기',
        sourceDept: '출고부',
        sourceAgent: 'ship-signal-emitter',
        event: 'EVENT_MATERIAL_SHIPPED',
        targetDept: '총무부',
        targetAgent: 'gen-invoice-creator',
        action: '거래명세표 PDF 자동 생성 및 품질부에 발송 동봉 신호 전달'
    },
    {
        id: 'net-03',
        name: '성적서 무인 생성 및 규격 결합',
        description: '매칭된 Heat No를 바탕으로 규격 기준치와 결합하여 EN10204 3.1 공식 성적서 자동 렌더링',
        sourceDept: '품질부',
        sourceAgent: 'qc-po-matcher',
        event: 'EVENT_MTC_MATCHED',
        targetDept: '품질부',
        targetAgent: 'qc-cert-builder',
        action: '엑셀 템플릿에 실측치 주입 및 고해상도 PDF 렌더링'
    },
    {
        id: 'net-04',
        name: '거래명세표 + 성적서 동봉 발송 완결',
        description: '총무부 명세표와 품질부 성적서를 결합하여 고객사 앞 최종 무인 이메일 발송',
        sourceDept: '품질부',
        sourceAgent: 'qc-cert-builder',
        event: 'EVENT_MTC_GENERATED',
        targetDept: '품질부',
        targetAgent: 'qc-package-dispatcher',
        action: '고객사 품질/자재 담당자 메일 발송 및 대표님 텔레그램 완료 보고'
    },
    {
        id: 'net-05',
        name: '대경 수신 성적서 자동 DB화',
        description: '대경벤드로부터 메일플러그로 성적서가 오면 압축 해제 후 구글시트에 실측치 자동 누적',
        sourceDept: '품질부',
        sourceAgent: 'qc-inbound-ingest',
        event: 'EVENT_MTC_FILES_READY',
        targetDept: '품질부',
        targetAgent: 'qc-chemical-db-sync',
        action: 'C, Si, Mn, Ni, Cr, YS, TS 실측값을 구글 시트 엑셀 마스터에 1초 만에 누적'
    },
    {
        id: 'net-06',
        name: '안전재고 결품 방어 연쇄',
        description: '시화창고 재고가 21일분 미만으로 떨어지면 구매부가 감지하여 대경에 자동 발주',
        sourceDept: '구매부',
        sourceAgent: 'pur-stock-reorder',
        event: 'EVENT_REORDER_REQUIRED',
        targetDept: '구매부',
        targetAgent: 'pur-supplier-po-gen',
        action: '대경벤드 외주 발주서 생성 및 자동 전송'
    }
];
