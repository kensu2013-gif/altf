/**
 * ALTF Autonomous Agent Swarm Organization (전사 6대 실무 부서 18인 정예 에이전트 조직도)
 * ALTF_OFFICE_DEV_PROMPTS.md 마스터 로드맵 기반 실제 파이프라인 에이전트 명세
 */

export interface AgentMetric {
    speed: number;       // 처리 속도 (1-100)
    accuracy: number;    // 정확도 (1-100)
    load: number;        // 현재 부하율 (1-100)
    uptime: string;      // 가동률 (예: '99.9%')
    tasksToday: number;  // 오늘 처리한 건수
}

export type AgentStatus = 'ACTIVE' | 'STANDBY' | 'IDLE' | 'OFFLINE';

export type AgentPosition = '부장' | '팀장' | '과장' | '대리' | '사원';

// 업무 성격 ↔ 직급: 접수=사원, 실행=대리, 검증·관찰=과장, 팀 종합 관찰·보고=팀장, 부서 총괄=부장
export type AgentRoleType = 'INTAKE' | 'EXECUTE' | 'REVIEW' | 'MONITOR' | 'REPORT';

// 👑 부서별 5단계 직위 체계 및 권한 메타데이터
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
    '부장': {
        label: '부장 (Director)',
        icon: '🎩',
        color: '#E2E8F0',
        bg: 'rgba(226, 232, 240, 0.15)',
        border: 'rgba(226, 232, 240, 0.8)',
        roleDescription: '전사 부서·봇 관제 및 대표 직보 (비서실장)',
        level: 5,
        requiresApproval: true
    },
    '팀장': {
        label: '팀장 (Head)',
        icon: '👑',
        color: '#FFD700',
        bg: 'rgba(255, 215, 0, 0.15)',
        border: 'rgba(255, 215, 0, 0.7)',
        roleDescription: '부서 총괄 및 이상징후 최종 승인·반려권 보유 (발송 게이트 등)',
        level: 4,
        requiresApproval: true
    },
    '과장': {
        label: '과장 (Chief)',
        icon: '👔',
        color: '#A855F7',
        bg: 'rgba(168, 85, 247, 0.15)',
        border: 'rgba(168, 85, 247, 0.7)',
        roleDescription: '판별/분석 결과 검수 및 경로 확정/서류 번들링 상신',
        level: 3,
        requiresApproval: true
    },
    '대리': {
        label: '대리 (Assistant)',
        icon: '💼',
        color: '#00F0FF',
        bg: 'rgba(0, 240, 255, 0.15)',
        border: 'rgba(0, 240, 255, 0.7)',
        roleDescription: '실무 데이터 정제, 표준화 변환 및 24시간 자율 무결재 반복',
        level: 2,
        requiresApproval: false
    },
    '사원': {
        label: '사원 (Associate)',
        icon: '📋',
        color: '#94A3B8',
        bg: 'rgba(148, 163, 184, 0.15)',
        border: 'rgba(148, 163, 184, 0.5)',
        roleDescription: '단위 실무 24시간 무결재 자율 반복: 메일/카톡 감시 및 인입 등록',
        level: 1,
        requiresApproval: false
    }
};

export interface AgentUnit {
    id: string;
    code: string;
    name: string;
    deptId: string;
    departmentId?: string; // alias for deptId
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
    connectedDeptIds?: string[]; // 부서간 그물망 연계 대상 부서 ID 목록
    connectedAgentIds?: string[]; // 연계 대상 특정 에이전트 ID 목록
    position?: AgentPosition; // 부서 내 직위 (팀장, 과장, 대리, 사원)
    supervisorId?: string; // 직속 결재/확인 상위 직위자 에이전트 ID
    roleType?: AgentRoleType; // 업무 성격 (접수/실행/검증/관찰/보고)
    mainDeptId?: string; // 주관(메인) 부서
    subDeptIds?: string[]; // 협업(서브) 부서
    approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'AUTO_RUNNING'; // 결재 상태
    orderIndex?: number; // 조직도 내 서열/배치 순서
    teamName?: string; // 소속 팀
    assignedHuman?: string; // 배정된 실제 사람 담당자 역할 (예: '담당 영업자', '사무실 관리자')
    requiresApproval?: boolean; // 승인 필수 여부 (true: 사람 승인 전 발송/전이 중단)
    scheduleInterval?: string; // 봇 실행 주기: 'REALTIME' | '10m' | '30m' | '1h' | '3h' | '8h' | '12h' | '24h' | 'MANUAL'
}

export interface ScheduleIntervalOption {
    id: string;
    label: string;
    shortBadge: string;
    icon: string;
    description: string;
}

export const SCHEDULE_INTERVALS: ScheduleIntervalOption[] = [
    { id: 'REALTIME', label: '하루종일 실시간 신호 계속 감지 (이벤트·웹훅 즉각 반응)', shortBadge: '⚡ 실시간 감지', icon: '⚡', description: '이메일, 텔레그램, 웹훅 등 외부 신호 인입 즉시 1초 내 반응' },
    { id: '10m', label: '10분마다 반복 실행 (초밀착 집중 점검)', shortBadge: '⏱️ 10분마다', icon: '⏱️', description: '10분 간격으로 인입 내역 및 변경 사항 정밀 확인' },
    { id: '30m', label: '30분마다 반복 실행 (시간당 2회 가동)', shortBadge: '⏱️ 30분마다', icon: '⏱️', description: '30분 단위 정기 대조 및 동기화 루틴' },
    { id: '1h', label: '1시간마다 반복 실행 (매시 정각 주기)', shortBadge: '⏱️ 1시간마다', icon: '⏱️', description: '1시간 간격 정기 상태 점검 및 미결 항목 동기화' },
    { id: '3h', label: '3시간마다 반복 실행 (업무시간 중 하루 8번)', shortBadge: '⏱️ 하루 8번 (3h)', icon: '⏱️', description: '주요 근무 시간대 집중 점검 및 데이터 갱신' },
    { id: '8h', label: '8시간마다 반복 실행 (하루 3번 - 출근/점심/퇴근)', shortBadge: '⏱️ 하루 3번 (8h)', icon: '⏱️', description: '출근(09시), 점심(13시), 퇴근(18시) 기준 하루 3회 정기 점검' },
    { id: '12h', label: '12시간마다 반복 실행 (하루 2번 - 오전/오후)', shortBadge: '⏱️ 하루 2번 (12h)', icon: '⏱️', description: '오전/오후 12시간 교대 기준 하루 2회 종합 점검' },
    { id: '24h', label: '하루에 1번 반복 실행 (매일 24시간 정기)', shortBadge: '⏱️ 하루 1번 (24h)', icon: '⏱️', description: '야간 또는 일과 마감 시점 일일 1회 대장 마감 및 백업' },
    { id: 'MANUAL', label: '수동 가동만 허용 (스케줄 중지)', shortBadge: '✋ 수동 가동', icon: '✋', description: '자동 스케줄을 중단하고 관리자가 직접 버튼을 누를 때만 가동' }
];

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
    teams?: string[];
}

export const DEPARTMENTS: Department[] = [
    {
        id: 'management',
        name: '경영총괄부',
        code: 'MGT',
        color: '#E2E8F0', // Platinum
        bgGlow: 'rgba(226, 232, 240, 0.15)',
        icon: '🎩',
        description: '대표이사 직속. 전사 부서·봇 관제, 이상 징후 판정 및 대표님 텔레그램 간결 보고(비서실장)',
        headRole: '비서실장 (전사 관제·대표 보고 총괄)',
        totalUnits: 1,
        teams: ['비서실']
    },
    {
        id: 'sle',
        name: '영업부',
        code: 'SLE',
        color: '#00F0FF', // Cyber Cyan
        bgGlow: 'rgba(0, 240, 255, 0.15)',
        icon: '💼',
        description: '메일·카카오톡·OCR·엑셀 다채널 견적 인입, AI 표준화 및 전사 재고·요율 반영 웹 견적서 자동화',
        headRole: '영업 총괄 관리',
        totalUnits: 12,
        teams: ['영업1팀', '영업2팀', '영업3팀']
    },
    {
        id: 'purchase',
        name: '구매부',
        code: 'PUR',
        color: '#00E676', // Neon Green
        bgGlow: 'rgba(0, 230, 118, 0.15)',
        icon: '🛒',
        description: '고객 발주서 등록, 견적 대조, S/D/M 경로 판별, 대경 매입발주 및 미결 관제',
        headRole: '구매/SCM 총괄',
        totalUnits: 5
    },
    {
        id: 'quality',
        name: '품질부',
        code: 'QC',
        color: '#FF0055', // Cyber Neon Pink
        bgGlow: 'rgba(255, 0, 85, 0.15)',
        icon: '🔬',
        description: '외주 성적서 수집, 26개 컬럼 파싱, 시화 성적서 무결점 발행 및 누락 경보',
        headRole: '품질 보증(QA) 총괄',
        totalUnits: 5
    },
    {
        id: 'shipping',
        name: '출고물류부',
        code: 'LOG',
        color: '#7C4DFF', // Cyber Purple
        bgGlow: 'rgba(124, 77, 255, 0.15)',
        icon: '🚚',
        description: '시화 창고 출고 지시, 포장 완료 신호 감지, MES 출고 번호 및 LOT 연동',
        headRole: '물류/출고 총괄',
        totalUnits: 3
    },
    {
        id: 'general',
        name: '총무부',
        code: 'GEN',
        color: '#FFD600', // Neon Amber
        bgGlow: 'rgba(255, 214, 0, 0.15)',
        icon: '📑',
        description: '매출 거래명세표 생성, 성적서 결합 서류 패키징 번들링, CRM 거래처 마스터',
        headRole: '경리/총무 총괄',
        totalUnits: 3
    },
    {
        id: 'executive',
        name: '관제·게이트부',
        code: 'EXE',
        color: '#E040FB', // Neon Magenta
        bgGlow: 'rgba(224, 64, 251, 0.15)',
        icon: '👑',
        description: '메신저(텔레그램/카톡) 인바운드 분배, 견적·발주 자동 분류, 전사 발송 게이트 통제 및 AI 자율 관제',
        headRole: '인바운드 분배 & 자율 운영 관제',
        totalUnits: 4
    }
];

const RAW_INITIAL_AGENTS: AgentUnit[] = [
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 💼 1. 영업부 (SLE)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'int-01-mail-intake',
        code: 'INT-01',
        name: '메일 견적접수봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업2팀',
        tier: 1,
        position: '사원',
        role: 'altf@altf.kr 전체 메일함 실시간 감시, 견적의뢰/발주 인입 메일 및 첨부파일 자동 접수',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '영업 지원 / 메일 담당',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 99, load: 20, uptime: '99.9%', tasksToday: 18 },
        currentTask: 'altf@altf.kr 견적의뢰 메일 실시간 수신 대기 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MAIL_RECEIVED'],
        emittedEvents: ['EVENT_INTAKE_CLASSIFIED'],
        logs: ['[정상] altf@altf.kr 메일플러그 IMAP 실시간 모니터링 가동 중'],
        connectedDeptIds: ['sle', 'purchase'],
        orderIndex: 0
    },
    {
        id: 'int-02-messenger-intake',
        code: 'INT-02',
        name: '영업2팀 견적접수·큐관리봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업2팀',
        tier: 1,
        position: '사원',
        role: 'EXE-02 사전분배 대리로부터 이첩된 견적 의뢰건 수신 등록 및 품목 정규화 파이프라인(INT-03~06) 배정',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '영업자 / 카카오 채널 관리자',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 98, load: 25, uptime: '99.9%', tasksToday: 24 },
        currentTask: '카카오톡 채널 웹훅 및 솔라피 메시지 수신 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MESSENGER_RECEIVED'],
        emittedEvents: ['EVENT_INTAKE_CLASSIFIED'],
        logs: ['[정상] 카카오톡 채널 / 솔라피 웹훅 리스너 대기 중'],
        connectedDeptIds: ['sle', 'purchase'],
        orderIndex: 1
    },
    {
        id: 'int-03-doc-ocr',
        code: 'INT-03',
        name: '비정형 문서·OCR 판독봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업2팀',
        tier: 2,
        position: '대리',
        role: '카카오톡/메일 첨부 사진, 팩스 스캔본, 손글씨, PDF 발주서 Vision OCR 텍스트 및 테이블 구조화',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '문서 판독 담당자',
        requiresApproval: false,
        metrics: { speed: 93, accuracy: 96, load: 30, uptime: '99.8%', tasksToday: 15 },
        currentTask: '인입 이미지 및 PDF OCR 텍스트 추출 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_FILE_UPLOADED'],
        emittedEvents: ['EVENT_DOC_PARSED'],
        logs: ['[정상] Vision OCR 엔진 및 표 추출 어댑터 가동 중'],
        connectedDeptIds: ['sle'],
        orderIndex: 2
    },
    {
        id: 'int-04-excel-parser',
        code: 'INT-04',
        name: '대량 엑셀·BOM 파서봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업2팀',
        tier: 2,
        position: '대리',
        role: '고객사 대량 엑셀 견적의뢰서 및 구글 스프레드시트 연동, 복잡한 셀 서식에서 품목·수량·규격 자동 파싱',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '데이터/엑셀 정제 담당',
        requiresApproval: false,
        metrics: { speed: 95, accuracy: 99, load: 15, uptime: '99.9%', tasksToday: 10 },
        currentTask: '대용량 엑셀 BOM 및 구글시트 파싱 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_EXCEL_RECEIVED'],
        emittedEvents: ['EVENT_BOM_EXTRACTED'],
        logs: ['[정상] ExcelJS / 구글시트 파서 엔진 대기 중'],
        connectedDeptIds: ['sle', 'dat'],
        orderIndex: 3
    },
    {
        id: 'int-05-ai-normalizer',
        code: 'INT-05',
        name: '배관·피팅 품목정규화 AI 봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업2팀',
        tier: 3,
        position: '과장',
        role: '비표준 은어/약어(엘보, 뽕티, 편심, C타입 등)를 ALTF 표준 품목 키로 정규화 및 1,265개 거래처 CRM 마스터 매칭',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '품목 마스터 / 기술영업 과장',
        requiresApproval: false,
        metrics: { speed: 96, accuracy: 98, load: 22, uptime: '99.9%', tasksToday: 32 },
        currentTask: '비정형 품목 ➔ ALTF 표준 품목 키(Code Key) 자동 변환 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_DOC_PARSED', 'EVENT_BOM_EXTRACTED', 'EVENT_INTAKE_CLASSIFIED'],
        emittedEvents: ['EVENT_ITEMS_NORMALIZED'],
        logs: ['[정상] 배관/피팅 전용 AI 정규화 프롬프트 엔진 대기 중'],
        connectedDeptIds: ['sle', 'purchase', 'executive'],
        orderIndex: 4
    },
    {
        id: 'sle-01-quote-drafter',
        code: 'SLE-01',
        name: '견적 초안 등록봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업1팀',
        tier: 2,
        position: '대리',
        role: '정규화 품목에 거래처 최근 요율(SLE-07) 및 요청 요율 적용, 전사 재고·단가·납기 대조 견적서 초안 자동 작성',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '거래처 담당 영업자',
        requiresApproval: false,
        metrics: { speed: 94, accuracy: 97, load: 18, uptime: '99.9%', tasksToday: 14 },
        currentTask: '정규화 완료 품목 견적 초안 생성 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ITEMS_NORMALIZED'],
        emittedEvents: ['EVENT_QUOTE_DRAFT_CREATED'],
        logs: ['[정상] 거래처별 요율표 및 3대 창고 재고 대조 완료'],
        connectedDeptIds: ['sle', 'executive'],
        orderIndex: 5
    },
    {
        id: 'sle-02-quote-dispatcher',
        code: 'SLE-02',
        name: '견적 승인 회신봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업1팀',
        tier: 3,
        position: '팀장',
        role: '영업자 승인 시 원메일 In-Reply-To PDF 회신 또는 카카오톡 알림톡/친구톡(솔라피 연동) 견적 링크 자동 발송',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'PENDING',
        assignedHuman: '담당 영업자 (필수 승인)',
        requiresApproval: true,
        metrics: { speed: 99, accuracy: 100, load: 10, uptime: '100%', tasksToday: 9 },
        currentTask: '영업자 견적 승인 대기열 감시 및 다채널 발송 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_QUOTE_APPROVED_BY_SALES'],
        emittedEvents: ['EVENT_QUOTE_DISPATCHED'],
        logs: ['[정상] 솔라피 알림톡 및 메일플러그 발송 게이트 대기 중'],
        connectedDeptIds: ['sle', 'executive'],
        orderIndex: 6
    },
    {
        id: 'sle-08-followup',
        code: 'SLE-08',
        name: '미주문 팔로업봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업1팀',
        tier: 2,
        position: '과장',
        role: '견적 발송 후 D+2, D+7 동안 미주문 상태인 건을 식별하여 담당 영업자에게 알림 및 카카오톡 리마인드',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '담당 영업자',
        requiresApproval: false,
        metrics: { speed: 95, accuracy: 98, load: 12, uptime: '99.9%', tasksToday: 20 },
        currentTask: '발송 견적 경과일 추적 및 수주 전환 모니터링',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_QUOTE_DISPATCHED'],
        emittedEvents: ['EVENT_FOLLOWUP_ALERT'],
        logs: ['[정상] 미주문 견적 스케줄러 대기'],
        connectedDeptIds: ['sle'],
        orderIndex: 7
    },
    {
        id: 'sle-11-order-vision-ocr',
        code: 'SLE-11',
        name: '카카오 발주 비전 OCR 판독봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업3팀',
        tier: 2,
        position: '대리',
        role: '카카오톡으로 인입된 수기 발주서, 사진 캡처, 전표 이미지에서 Gemini Vision / GPT-4o-mini 비전 AI를 가동하여 텍스트 및 품목 표 정밀 추출',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '발주서 판독 담당자',
        requiresApproval: false,
        metrics: { speed: 96, accuracy: 98, load: 20, uptime: '99.9%', tasksToday: 18 },
        currentTask: '카카오 발주 사진/전표 Vision OCR 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_KAKAO_ORDER_IMAGE'],
        emittedEvents: ['EVENT_ORDER_DOC_PARSED'],
        logs: ['[정상] Gemini Vision & GPT-4o-mini 발주서 OCR 엔진 가동 중'],
        connectedDeptIds: ['sle', 'executive'],
        orderIndex: 8
    },
    {
        id: 'sle-12-order-ai-parser',
        code: 'SLE-12',
        name: '발주 품목·규격 AI 분석봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업3팀',
        tier: 3,
        position: '과장',
        role: '배관·피팅 품목분석 프롬프트(규칙 0~11) + Gemini/GPT + 14,136개 재고 DB 대조하여 품명, 규격, 재질(WP/STS, -S/-W), 두께, 수량, 단가 정밀 매칭',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '기술영업 과장 / 발주 정밀 분석관',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 99, load: 25, uptime: '100%', tasksToday: 24 },
        currentTask: '인입 발주 텍스트 ➔ 배관 피팅 정밀 품목 및 단가 매칭 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_DOC_PARSED', 'EVENT_KAKAO_ORDER_TEXT'],
        emittedEvents: ['EVENT_ORDER_ITEMS_ANALYZED'],
        logs: ['[정상] 배관 피팅 정밀 품목 분석 프롬프트 엔진 대기 중'],
        connectedDeptIds: ['sle', 'purchase'],
        orderIndex: 9
    },
    {
        id: 'sle-13-order-terms-verifier',
        code: 'SLE-13',
        name: '발주 필수조건 검증봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업3팀',
        tier: 2,
        position: '대리',
        role: '고객 발주서의 필수 4대 항목(도착지 화물지점/주소, 수령인, 연락처, 운송조건 선불/착불) 충족 여부를 분석하고 누락 시 미비(INCOMPLETE) 분류 및 담당자 알림',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '영업 담당자',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 15, uptime: '100%', tasksToday: 24 },
        currentTask: '도착지 정보 및 운송조건(선불/착불) 무결점 검증 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_ITEMS_ANALYZED'],
        emittedEvents: ['EVENT_ORDER_TERMS_VERIFIED'],
        logs: ['[정상] 도착지 지점 및 운송비 조건(선불/착불) 판별기 작동 중'],
        connectedDeptIds: ['sle', 'purchase'],
        orderIndex: 10
    },
    {
        id: 'sle-14-order-pur-dispatcher',
        code: 'SLE-14',
        name: '발주 확정 & 구매부 이첩봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업3팀',
        tier: 4,
        position: '팀장',
        role: '영업3팀 담당자 2차 검토 후 최종 승인 시, 정식 발주서 대장에 적재하고 구매부(PUR-01 재고 발주 & PUR-07 미결 관제)로 안전하게 인계',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '영업3팀장',
        requiresApproval: true,
        metrics: { speed: 99, accuracy: 100, load: 18, uptime: '100%', tasksToday: 24 },
        currentTask: '영업3팀 검토 확정 발주서 ➔ 구매부(PUR-01/07) 실시간 이첩 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_TERMS_VERIFIED'],
        emittedEvents: ['EVENT_ORDER_TRANSFERRED_TO_PUR'],
        logs: ['[정상] 구매부 SCM 연동 게이트 대기 중'],
        connectedDeptIds: ['sle', 'purchase', 'shipping'],
        orderIndex: 11
    },
    {
        id: 'sle-15-order-rule-watcher',
        code: 'SLE-15',
        name: '발주서 수정관찰 & 규칙 학습봇',
        deptId: 'sle',
        deptName: '영업부',
        teamName: '영업3팀',
        tier: 3,
        position: '과장',
        role: '사무실 담당자의 발주서 수정 내역(품명-두께-규격-재질-수량 및 운송조건)을 실시간 Diff 감지하여 누적 저장하고 정기 보고서 생성 및 AI 규칙 학습 피드백 주입',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '영업3팀장',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 12, uptime: '100%', tasksToday: 24 },
        currentTask: '사무실 발주서 수정 Diff 실시간 감시 및 누적 규칙 학습 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_UPDATED', 'EVENT_ORDER_APPROVED'],
        emittedEvents: ['EVENT_ORDER_RULE_LEARNED'],
        logs: ['[정상] 발주서 품목 5대 요소 및 운송조건 수정 관찰기 가동 중'],
        connectedDeptIds: ['sle', 'quality'],
        orderIndex: 12
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🛒 2. 구매부 (PUR)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'pur-11-po-intake',
        code: 'PUR-11',
        name: '고객 발주서 등록봇',
        deptId: 'purchase',
        deptName: '구매부',
        teamName: '구매SCM팀',
        tier: 1,
        position: '사원',
        role: '고객 발주서(CUSTOMER_PO) 접수 시 주문 초안(DRAFT_BY_BOT) 생성 및 keys.customerPoNo 저장',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '사무실 주문 접수자',
        requiresApproval: false,
        metrics: { speed: 96, accuracy: 98, load: 10, uptime: '99.9%', tasksToday: 6 },
        currentTask: '발주서 접수 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_CUSTOMER_PO_RECEIVED'],
        emittedEvents: ['EVENT_ORDER_DRAFT_CREATED'],
        logs: ['[정상] 주문 등록 파이프라인 가동'],
        connectedDeptIds: ['purchase'],
        orderIndex: 0
    },
    {
        id: 'pur-12-cross-checker',
        code: 'PUR-12',
        name: '견적·주문 대조봇',
        deptId: 'purchase',
        deptName: '구매부',
        teamName: '구매SCM팀',
        tier: 2,
        position: '대리',
        role: '해당 거래처 최근 견적과 품목·수량·단가를 라인별로 대조하여 차이점 자동 표시',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '사무실 담당자',
        requiresApproval: false,
        metrics: { speed: 95, accuracy: 99, load: 15, uptime: '99.9%', tasksToday: 6 },
        currentTask: '견적 이력 대조 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_DRAFT_CREATED'],
        emittedEvents: ['EVENT_ORDER_CROSS_CHECKED'],
        logs: ['[정상] 30일 이내 견적 검색 대기'],
        connectedDeptIds: ['purchase', 'sle'],
        orderIndex: 1
    },
    {
        id: 'pur-13-route-planner',
        code: 'PUR-13',
        name: '경로 판별 제안봇',
        deptId: 'purchase',
        deptName: '구매부',
        teamName: '구매SCM팀',
        tier: 3,
        position: '과장',
        role: '라인별 시화재고(S) vs 대경직송(D) vs 제작(M) 경로 자동 판별 및 사무실 확정 상신',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'PENDING',
        assignedHuman: '사무실 관리자 (경로 확정 승인)',
        requiresApproval: true,
        metrics: { speed: 97, accuracy: 96, load: 20, uptime: '99.9%', tasksToday: 6 },
        currentTask: '재고/외주 경로 분석 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_CROSS_CHECKED'],
        emittedEvents: ['EVENT_ROUTES_PROPOSED'],
        logs: ["[정상] 재고 현황(시화/대경) 동기화 대기"],
        connectedDeptIds: ['purchase', 'shipping'],
        orderIndex: 2
    },
    {
        id: 'pur-14-supplier-order',
        code: 'PUR-14',
        name: '대경 매입발주·회신봇',
        deptId: 'purchase',
        deptName: '구매부',
        teamName: '구매SCM팀',
        tier: 2,
        position: '대리',
        role: 'D/M 경로 라인 대경 매입발주서(ES...) 자동 생성 및 통화 후 직송/제작 한줄 회신 기록',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '구매 담당자',
        requiresApproval: false,
        metrics: { speed: 94, accuracy: 98, load: 25, uptime: '99.8%', tasksToday: 4 },
        currentTask: '대경 회신 메모 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ROUTES_PROPOSED'],
        emittedEvents: ['EVENT_SUPPLIER_PO_DISPATCHED'],
        logs: ['[정상] 대경 매입발주 대장 연동'],
        connectedDeptIds: ['purchase', 'quality'],
        orderIndex: 3
    },
    {
        id: 'pur-backlog-bot',
        code: 'PUR-07',
        name: '발주서 분류·미결 관제봇',
        deptId: 'purchase',
        deptName: '구매부',
        teamName: '구매SCM팀',
        tier: 2,
        position: '대리',
        role: '2,439건 전사 주문 수집, 거래처별 분류 및 미결(Pending) 백로그 24시간 실시간 추적',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '구매팀장',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 99, load: 45, uptime: '99.9%', tasksToday: 462 },
        currentTask: '미결 주문(462건) 실시간 모니터링 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_ORDER_CREATED', 'EVENT_HOURLY_TRIGGER'],
        emittedEvents: ['EVENT_BACKLOG_SYNCED'],
        logs: ['[정상] 미결 백로그 462건 추적 중'],
        connectedDeptIds: ['purchase', 'general'],
        orderIndex: 4
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔬 3. 품질부 (QC)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'qc-email-collector',
        code: 'QC-01',
        name: '외주 성적서 IMAP 수집봇',
        deptId: 'quality',
        deptName: '품질부',
        teamName: '품질보증팀',
        tier: 1,
        position: '사원',
        role: '메일플러그 대경 성적서 메일 24시간 자동 감지, ZIP 메모리 즉시 해제 및 PDF 무손실 수집',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '품질 관리자',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 30, uptime: '99.9%', tasksToday: 505 },
        currentTask: '메일플러그 IMAP 소켓 수신 대기 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_HOURLY_TRIGGER'],
        emittedEvents: ['EVENT_CERT_DOWNLOADED'],
        logs: ['[정상] 505건 성적서 메일 수집 완료'],
        connectedDeptIds: ['quality'],
        orderIndex: 0
    },
    {
        id: 'qc-vision-parser',
        code: 'QC-02',
        name: '성적서 26개컬럼 파싱봇',
        deptId: 'quality',
        deptName: '품질부',
        teamName: '품질보증팀',
        tier: 2,
        position: '대리',
        role: '성적서 본문 파싱, 화학/기계 성질 추출, KS/ASTM 이상치 검출(PASS/FAIL) 및 엑셀 마스터 적재',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '품질 관리자',
        requiresApproval: false,
        metrics: { speed: 96, accuracy: 99, load: 40, uptime: '99.9%', tasksToday: 1424 },
        currentTask: '1,424건 마스터 성적서 인덱스 유지 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_CERT_DOWNLOADED'],
        emittedEvents: ['EVENT_CERT_PARSED'],
        logs: ['[정상] 1,424개 성적서 품목 동기화 완료'],
        connectedDeptIds: ['quality'],
        orderIndex: 1
    },
    {
        id: 'qc-cert-issuer',
        code: 'QC-06',
        name: '시화 성적서 무결점 발행봇',
        deptId: 'quality',
        deptName: '품질부',
        teamName: '품질보증팀',
        tier: 3,
        position: '과장',
        role: '시화 출고 품목 LOT 번호 1:1 엄격 매칭 기반 성적서 발행 (추정/기본값 대체 100% 금지)',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '품질 총괄 책임자',
        requiresApproval: true,
        metrics: { speed: 95, accuracy: 100, load: 15, uptime: '100%', tasksToday: 1 },
        currentTask: '0-A 단계 기본값 제거 완료, 엄격 매칭 가동 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_OUTBOUND_CONFIRMED'],
        emittedEvents: ['EVENT_CERT_ISSUED'],
        logs: ['[검증] 0-A 단위 테스트 100% 통과'],
        connectedDeptIds: ['quality', 'shipping', 'general'],
        orderIndex: 2
    },
    {
        id: 'qc-direct-matcher',
        code: 'QC-12',
        name: '대경직송 성적서 매칭봇',
        deptId: 'quality',
        deptName: '품질부',
        teamName: '품질보증팀',
        tier: 2,
        position: '대리',
        role: '대경 거래명세표 수신 시 해당 supplierPoNo + 품명으로 certificates.json에서 HEAT/LOT 확정',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '품질 담당자',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 99, load: 20, uptime: '99.9%', tasksToday: 2 },
        currentTask: '대경 명세표 인입 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_SUPPLIER_INVOICE_PARSED'],
        emittedEvents: ['EVENT_DIRECT_CERT_MATCHED'],
        logs: ['[정상] 명세표-성적서 체인 가동'],
        connectedDeptIds: ['quality', 'purchase', 'general'],
        orderIndex: 3
    },
    {
        id: 'qc-missing-chaser',
        code: 'QC-13',
        name: '성적서 누락 경보·독촉봇',
        deptId: 'quality',
        deptName: '품질부',
        teamName: '품질보증팀',
        tier: 3,
        position: '팀장',
        role: '성적서 미입고 건 누락 경보 기록(qc_missing_alerts.json) 및 24시간 초과 시 대경 독촉 메일 초안 작성',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '품질 책임자 / 사무실',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 10, uptime: '100%', tasksToday: 1 },
        currentTask: '성적서 누락 경보 큐 감시 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_CERT_NOT_FOUND'],
        emittedEvents: ['EVENT_MISSING_CERT_ALERT'],
        logs: ['[정상] QC-13 누락 경보 로깅 엔진 활성'],
        connectedDeptIds: ['quality', 'executive'],
        orderIndex: 4
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🚚 4. 출고물류부 (LOG)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'log-11-picker',
        code: 'LOG-11',
        name: '시화 출고지시봇',
        deptId: 'shipping',
        deptName: '출고물류부',
        teamName: '물류출고팀',
        tier: 1,
        position: '사원',
        role: '시화재고(S) 경로 확정 라인에 대해 창고 작업자에게 픽업 지시서(품목, 수량, 랙 위치) 전달',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '창고 출고 작업자',
        requiresApproval: false,
        metrics: { speed: 97, accuracy: 99, load: 15, uptime: '99.9%', tasksToday: 3 },
        currentTask: '출고지시 대기열 감시',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_S_ROUTE_CONFIRMED'],
        emittedEvents: ['EVENT_PICK_REQUESTED'],
        logs: ['[정상] 창고 랙 위치 연동'],
        connectedDeptIds: ['shipping'],
        orderIndex: 0
    },
    {
        id: 'log-12-packer',
        code: 'LOG-12',
        name: '포장 완료 확인봇',
        deptId: 'shipping',
        deptName: '출고물류부',
        teamName: '물류출고팀',
        tier: 2,
        position: '대리',
        role: '창고의 포장 완료 신호 접수 시 라인 상태를 PACKED로 전이하고 검수 사진 기록',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '창고 검수자',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 100, load: 10, uptime: '99.9%', tasksToday: 3 },
        currentTask: '포장 확인 신호 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_PICK_REQUESTED'],
        emittedEvents: ['EVENT_PACKING_CONFIRMED'],
        logs: ['[정상] 포장 확인 신호 수신 대기'],
        connectedDeptIds: ['shipping'],
        orderIndex: 1
    },
    {
        id: 'log-13-mes-matcher',
        code: 'LOG-13',
        name: 'MES 출고 연동봇',
        deptId: 'shipping',
        deptName: '출고물류부',
        teamName: '물류출고팀',
        tier: 3,
        position: '과장',
        role: 'MES 출고 데이터(출고번호, LOT) 수집 및 원장 S 라인 매칭하여 MES_SHIPPED 확정',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '물류 총괄 담당자',
        requiresApproval: false,
        metrics: { speed: 96, accuracy: 98, load: 20, uptime: '99.9%', tasksToday: 3 },
        currentTask: 'MES Mock 어댑터 연동 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MES_OUTBOUND_SYNC'],
        emittedEvents: ['EVENT_MES_SHIPPED'],
        logs: ['[정상] MES 어댑터 인터페이스 준비'],
        connectedDeptIds: ['shipping', 'quality'],
        orderIndex: 2
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📑 5. 총무부 (GEN)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'gen-01-statement-maker',
        code: 'GEN-01',
        name: '매출 거래명세표 생성봇',
        deptId: 'general',
        deptName: '총무부',
        teamName: '경리총무팀',
        tier: 2,
        position: '대리',
        role: '출고 묶음(shipment) 단위로 ALTF 자사 매출 거래명세표 자동 번호 채번 및 작성',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '사무실 경리/총무',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 15, uptime: '100%', tasksToday: 4 },
        currentTask: '출고 묶음 명세표 생성 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_MES_SHIPPED', 'EVENT_DIRECT_CERT_MATCHED'],
        emittedEvents: ['EVENT_STATEMENT_READY'],
        logs: ['[정상] 전표 채번 엔진 가동'],
        connectedDeptIds: ['general'],
        orderIndex: 0
    },
    {
        id: 'gen-03-bundler',
        code: 'GEN-03',
        name: '서류 패키징·번들링봇',
        deptId: 'general',
        deptName: '총무부',
        teamName: '경리총무팀',
        tier: 3,
        position: '과장',
        role: '거래명세표 + 품질부 성적서 PDF를 1:1 결합하여 고객 발송 대기 패키지(PACKAGED) 번들링',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '사무실 총무 담당자',
        requiresApproval: false,
        metrics: { speed: 97, accuracy: 99, load: 20, uptime: '99.9%', tasksToday: 4 },
        currentTask: '서류 1:1 번들링 대기',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_STATEMENT_READY'],
        emittedEvents: ['EVENT_PACKAGE_READY'],
        logs: ['[정상] PDF 병합 엔진 대기'],
        connectedDeptIds: ['general', 'executive'],
        orderIndex: 1
    },
    {
        id: 'gen-10-crm-sync',
        code: 'GEN-10',
        name: 'CRM 거래처 마스터 연동봇',
        deptId: 'general',
        deptName: '총무부',
        teamName: '경리총무팀',
        tier: 1,
        position: '사원',
        role: '1,265개 거래처 마스터 사업자번호, 대표자, 이메일, 팩스, 담당 영업자 동기화',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '영업관리 / 총무',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 99, load: 15, uptime: '99.9%', tasksToday: 1265 },
        currentTask: '1,265개 거래처 마스터 연동 유지 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_CUSTOMER_UPDATED'],
        emittedEvents: ['EVENT_CRM_SYNCED'],
        logs: ['[정상] 1,265개 거래처 데이터 동기화 완료'],
        connectedDeptIds: ['general', 'sle'],
        orderIndex: 2
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 👑 6. 관제·게이트부 (EXE & DIS)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        id: 'dis-01-gate-keeper',
        code: 'DIS-01',
        name: '단일 발송 게이트 통제봇',
        deptId: 'executive',
        deptName: '관제·게이트부',
        teamName: '운영관제팀',
        tier: 3,
        position: '팀장',
        role: '이메일/카카오/텔레그램 발송 단일 창구. 담당 영업자/사무실 승인 전 발송 원천 차단 및 중복 방지',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'PENDING',
        assignedHuman: '영업자(견적) / 사무실(서류·발주)',
        requiresApproval: true,
        metrics: { speed: 99, accuracy: 100, load: 10, uptime: '100%', tasksToday: 2 },
        currentTask: '승인 대기열 통제 가동',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_DISPATCH_ENQUEUED'],
        emittedEvents: ['EVENT_DISPATCH_SENT'],
        logs: ['[정상] 발송 게이트 큐 모듈 연동'],
        connectedDeptIds: ['executive', 'sle', 'general'],
        orderIndex: 0
    },
    {
        id: 'exe-01-telegram-dispatcher',
        code: 'EXE-01',
        name: '텔레그램 인바운드 분배봇',
        deptId: 'executive',
        deptName: '관제·게이트부',
        teamName: '인바운드게이트팀',
        tier: 2,
        position: '대리',
        role: '텔레그램 수신 파일(거래명세표, 재고장, 성적서, 현장지시) 1차 정합성 검증 및 총무부/구매부/데이터관리팀 자동 분배',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '총괄 운영자',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 15, uptime: '100%', tasksToday: 12 },
        currentTask: '텔레그램 인바운드 스트림 실시간 라우팅 대기 중',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_TELEGRAM_INBOUND'],
        emittedEvents: ['EVENT_STATEMENT_DISPATCHED', 'EVENT_STOCK_EXCEL_DISPATCHED', 'EVENT_CERT_DISPATCHED'],
        logs: ['[정상] 텔레그램 메신저 전용 인바운드 라우터 가동'],
        connectedDeptIds: ['executive', 'general', 'purchase', 'dat'],
        orderIndex: 1
    },
    {
        id: 'exe-02-kakao-classifier',
        code: 'EXE-02',
        name: '카카오 사전확인·분배 대리',
        deptId: 'executive',
        deptName: '관제·게이트부',
        teamName: '인바운드게이트팀',
        tier: 2,
        position: '대리',
        role: '카카오톡 수신 텍스트·사진 1차 사전확인(고객사 CRM 매칭, 텍스트 의도 분석 및 Vision OCR 서식 판독) ➔ 영업2팀(견적) vs 영업3팀(발주) 실무 파이프라인 자동 분배',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '인바운드 게이트 관리자',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 20, uptime: '100%', tasksToday: 20 },
        currentTask: '[사전분배 대리] 사진 발주서 판독 ➔ 영업3팀(발주팀) 배정 [(주)원주스텐레스]',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_KAKAO_INBOUND'],
        emittedEvents: ['EVENT_QUOTE_DISPATCHED', 'EVENT_ORDER_DISPATCHED'],
        logs: ['[정상] 카카오톡 텍스트/사진 사전확인 및 영업2팀/영업3팀 지능형 분배 가동'],
        connectedDeptIds: ['executive', 'sle', 'purchase'],
        orderIndex: 2
    },
    {
        id: 'mgt-01-chief-of-staff',
        code: 'MGT-01',
        name: '비서실장 (경영총괄 AI)',
        deptId: 'management',
        deptName: '경영총괄부',
        teamName: '비서실',
        tier: 3,
        position: '부장',
        role: '전사 모든 부서·봇(영업/구매/품질/출고/총무/관제/데이터 및 신규 부서) 가동·업무 이상 관제, 대표님 텔레그램 질의에 결론 먼저·예외만 간결 보고, 긴급 경보 및 평일 08:30/17:30 정기 브리핑',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'APPROVED',
        assignedHuman: '대표이사 직속',
        requiresApproval: false,
        metrics: { speed: 98, accuracy: 100, load: 10, uptime: '100%', tasksToday: 0 },
        currentTask: '전사 관제 및 대표님 텔레그램 보고 대기 (긴급 감시 10분 주기)',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_EXECUTIVE_QUESTION', 'EVENT_CRON_0830', 'EVENT_CRON_1730', 'EVENT_CRITICAL_ISSUE'],
        emittedEvents: ['EVENT_EXECUTIVE_BRIEFING', 'EVENT_CRITICAL_ALERT'],
        logs: ['[정상] 비서실장 전사 관제·보고 엔진 가동'],
        connectedDeptIds: ['management', 'sle', 'purchase', 'quality', 'shipping', 'general', 'executive', 'dat'],
        orderIndex: 0
    },
    {
        id: 'exe-11-monitor',
        code: 'EXE-11',
        name: '전사 업무 흐름 감시봇',
        deptId: 'executive',
        deptName: '관제·게이트부',
        teamName: '운영관제팀',
        tier: 3,
        position: '팀장',
        role: '매일 08:00, 14:00 지연 건(접수 2시간 미배정, 견적 4시간 미승인, 직송 24시간 성적서 미비) 감지 보고',
        status: 'ACTIVE',
        isCreated: true,
        approvalStatus: 'AUTO_RUNNING',
        assignedHuman: '대표이사 / 총괄 관리자',
        requiresApproval: false,
        metrics: { speed: 99, accuracy: 100, load: 5, uptime: '100%', tasksToday: 1 },
        currentTask: '업무 지연 감시 스케줄러 가동',
        lastActive: '방금 전',
        triggerEvents: ['EVENT_CRON_0800', 'EVENT_CRON_1400'],
        emittedEvents: ['EVENT_BOTTLENECK_REPORTED'],
        logs: ['[정상] 전사 파이프라인 감시 중'],
        connectedDeptIds: ['executive'],
        orderIndex: 4
    }
];

export const INITIAL_AGENTS: AgentUnit[] = RAW_INITIAL_AGENTS;

export interface DepartmentNetwork {
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

export const DEPARTMENT_NETWORKS: DepartmentNetwork[] = [
    {
        id: 'net-01',
        name: '인입 접수 → 표준화 & 견적 초안 연계',
        description: '카카오/메일로 발주/견적 요청이 들어오면 규격 변환 후 견적 초안을 자동 생성',
        sourceDept: '영업부',
        sourceAgent: 'int-01-receiver',
        event: 'EVENT_INTAKE_CLASSIFIED',
        targetDept: '영업부',
        targetAgent: 'int-02-normalizer',
        action: '표준 품목 키 정규화 및 요율표 적용'
    },
    {
        id: 'net-02',
        name: '고객 발주서 → S/D/M 3개 경로 자동 분할',
        description: '고객 PO 접수 시 시화재고(S)와 대경직송(D) 및 제작(M) 경로를 자동 제안',
        sourceDept: '구매부',
        sourceAgent: 'pur-11-po-intake',
        event: 'EVENT_ORDER_CROSS_CHECKED',
        targetDept: '구매부',
        targetAgent: 'pur-13-route-planner',
        action: '라인별 재고 유무에 따른 공급 경로 판별'
    },
    {
        id: 'net-03',
        name: '시화 출고(S) → 무결점 성적서 1:1 발행',
        description: '시화 창고 출고 라인에 대해 대경 LOT 1:1 매칭 기반 성적서 자동 발행',
        sourceDept: '출고물류부',
        sourceAgent: 'log-13-mes-matcher',
        event: 'EVENT_MES_SHIPPED',
        targetDept: '품질부',
        targetAgent: 'qc-cert-issuer',
        action: '추정/기본값 없는 LOT 1:1 성적서 발행'
    },
    {
        id: 'net-04',
        name: '대경 직송(D) → 명세표 수신 및 성적서 자동 매칭',
        description: '대경 거래명세표 수신 시 해당 발주 품목의 성적서를 자동 매칭',
        sourceDept: '구매부',
        sourceAgent: 'pur-14-supplier-order',
        event: 'EVENT_SUPPLIER_INVOICE_PARSED',
        targetDept: '품질부',
        targetAgent: 'qc-direct-matcher',
        action: '대경 발주번호 기반 성적서 매칭 및 준비'
    },
    {
        id: 'net-05',
        name: '거래명세표 + 성적서 1:1 서류 패키징',
        description: '출고 묶음 단위로 자사 매출명세표와 성적서를 결합하여 패키지 생성',
        sourceDept: '품질부',
        sourceAgent: 'qc-cert-issuer',
        event: 'EVENT_CERT_ISSUED',
        targetDept: '총무부',
        targetAgent: 'gen-03-bundler',
        action: '거래명세표와 성적서 PDF 결합 번들링'
    },
    {
        id: 'net-06',
        name: '발송 게이트 승인 통제',
        description: '패키징된 서류나 작성된 견적서는 담당자 승인을 거쳐서만 1회 발송',
        sourceDept: '총무부',
        sourceAgent: 'gen-03-bundler',
        event: 'EVENT_PACKAGE_READY',
        targetDept: '관제·게이트부',
        targetAgent: 'dis-01-gate-keeper',
        action: '역할별(영업자/사무실) 승인 후 고객사 전송'
    }
];

export const EVENT_NETWORKS = DEPARTMENT_NETWORKS;
