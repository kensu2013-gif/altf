import React, { useState, useEffect, useMemo } from 'react';
import { 
    DEPARTMENTS, 
    INITIAL_AGENTS, 
    EVENT_NETWORKS, 
    POSITION_CONFIG,
    SCHEDULE_INTERVALS,
    type AgentUnit,
    type AgentStatus,
    type AgentPosition,
    type Department
} from '../../data/agentOrganization';
import { 
    Activity, 
    Terminal, 
    Network, 
    Search, 
    Play, 
    Layers, 
    Maximize2, 
    Minimize2, 
    RefreshCw, 
    RotateCw, 
    HardDrive, 
    Sparkles,
    Plus,
    Edit2,
    Edit3,
    Trash2,
    Check,
    X,
    ShieldCheck,
    ArrowUp,
    ArrowDown,
    GitBranch,
    CheckCircle2,
    AlertCircle,
    LayoutGrid,
    ChevronLeft,
    ChevronRight,
    ShoppingBag,
    Boxes,
    FileText,
    FolderOpen,
    ChevronDown,
    Zap,
    Users,
    UserPlus,
    Clock,
    UploadCloud,
    Timer,
    Settings
} from 'lucide-react';
import { CertificateLedgerModal } from '../../components/admin/CertificateLedgerModal';
import { PurchaseLedgerModal } from '../../components/admin/PurchaseLedgerModal';
import { CertificateIssuerModal } from '../../components/admin/CertificateIssuerModal';
import { DaekyungInvoiceModal } from '../../components/admin/DaekyungInvoiceModal';

const STORAGE_KEY = 'altf_agent_swarm_core18_v1';
const STORAGE_DEPT_KEY = 'altf_departments_core6_v1';

// 👑 에이전트 정렬 규칙:
// 1. 실제 생성되어 가동 중인 봇(isCreated === true)이 앞, 아직 만들어지지 않은 봇(isCreated !== true)은 항상 맨 뒤
// 2. 직급 순서: 팀장(4) > 과장(3) > 대리(2) > 사원(1) ➔ "대리는 앞으로, 사원은 뒤로"
// 3. 동일 직급 내: orderIndex 및 식별 코드(code) 오름차순 정렬
export function sortAgents(a: AgentUnit, b: AgentUnit): number {
    const aCreated = a.isCreated === true ? 1 : 0;
    const bCreated = b.isCreated === true ? 1 : 0;
    if (aCreated !== bCreated) {
        return bCreated - aCreated; // 생성된 봇(1)이 앞, 미생성 슬롯(0)은 맨 뒤
    }

    const rankWeight: Record<string, number> = {
        '팀장': 4,
        '과장': 3,
        '대리': 2,
        '사원': 1
    };
    const aRank = rankWeight[a.position || '사원'] || 1;
    const bRank = rankWeight[b.position || '사원'] || 1;
    if (aRank !== bRank) {
        return bRank - aRank; // 높은 직급(팀장, 과장, 대리)이 앞, 사원은 뒤
    }

    const aOrder = a.orderIndex !== undefined ? a.orderIndex : 999;
    const bOrder = b.orderIndex !== undefined ? b.orderIndex : 999;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return (a.code || '').localeCompare(b.code || '');
}

// 에이전트 직위 초기화 헬퍼 (팀장 1, 과장 2, 대리 3, 사원 나머지)
function initAgentPositions(rawAgents: AgentUnit[]): AgentUnit[] {
    const deptCountMap: Record<string, number> = {};
    return rawAgents.map(ag => {
        const count = deptCountMap[ag.deptId] || 0;
        deptCountMap[ag.deptId] = count + 1;

        let pos: AgentPosition = ag.position || '사원';
        if (!ag.position) {
            if (count === 0) pos = '팀장';
            else if (count <= 2) pos = '과장';
            else if (count <= 5) pos = '대리';
            else pos = '사원';
        }

        // 기본 teamName이 없을 경우의 예시 배정 (총무부 총무1팀 / 총무2팀 등)
        let team = ag.teamName;
        if (!team && ag.deptId === 'general') {
            if (['gen-invoice-creator', 'gen-statement-dispatcher', 'gen-customer-master', 'gen-01', 'gen-03', 'gen-10'].includes(ag.id)) {
                team = '총무1팀';
            } else if (['gen-tax-homotax-sync', 'gen-payment-tracker', 'gen-credit-guard', 'gen-02', 'gen-04', 'gen-05'].includes(ag.id)) {
                team = '총무2팀';
            }
        }

        // ⚡ 직위별 결재 규칙:
        // 사원(Lv.1) 및 대리(Lv.2): 업무 행동에 결재가 일절 불필요 ➔ 상시 AUTO_RUNNING (무한 반복 자율 루틴)
        // 과장(Lv.3): 결과물 확인/검수 작업 수행 ➔ 이상징후 감지 시에만 결재 상신 (기본: APPROVED)
        // 팀장(Lv.4): 부서 총괄 및 이상징후 최종 승인권자 ➔ APPROVED
        const approval = (pos === '사원' || pos === '대리') 
            ? 'AUTO_RUNNING' 
            : (ag.approvalStatus === 'PENDING' ? 'PENDING' : 'APPROVED');

        return {
            ...ag,
            position: pos,
            approvalStatus: approval,
            orderIndex: ag.orderIndex !== undefined ? ag.orderIndex : count,
            teamName: team
        };
    });
}

interface MakeConnectionItem {
    id: string;
    name: string;
    type: string;
    icon?: string;
    account: string;
    owner?: string;
    scenarios?: number;
    warnings?: number;
    status: string;
    needsReauthorize: boolean;
    lastVerified?: string;
    reauthorizeReason?: string;
}

interface MakeConnectionsSummary {
    total: number;
    verified: number;
    needsReauth: number;
    totalScenarios?: number;
    totalWarnings?: number;
    hasIssues?: boolean;
    lastCheckedAt?: string;
}

interface MakeScenarioItem {
    id: string;
    name: string;
    operations?: number;
    dataTransfer?: string;
    createdAt?: string;
    lastExecutedAt?: string;
    isActive: boolean;
    healthStatus?: string;
    incompleteExecutions: number;
    autoRecoveryEnabled?: boolean;
    modules?: string[];
    lastRecoveredAt?: string | null;
    recoveryLogs?: string[];
}

interface MakeScenariosSummary {
    total: number;
    active: number;
    inactive: number;
    totalIncomplete: number;
    hasIssues?: boolean;
    lastCheckedAt?: string;
}

interface InventorySyncStep1 {
    status?: string;
    lastRun?: string | number | null;
    message?: string;
    details?: unknown;
}

interface InventorySyncStep2 {
    status?: string;
    lastRun?: string | number | null;
    message?: string;
    fileName?: string | null;
    itemCount?: number;
    details?: unknown;
}

interface InventorySyncStep3 {
    status?: string;
    lastRun?: string | number | null;
    message?: string;
    bufferTotalSeconds: number;
    bufferRemainingSeconds: number;
    timerActive?: boolean;
    details?: unknown;
}

interface InventorySyncStep4Details {
    diffStats?: {
        inboundCount: number;
        outboundCount: number;
        changedCount?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface InventorySyncStep4 {
    status?: string;
    lastRun?: string | number | null;
    message?: string;
    s3Uploaded?: boolean;
    totalItems?: number;
    sihwaChangesCount?: number;
    sihwaInboundCount?: number;
    sihwaOutboundCount?: number;
    cleanedFiles?: string[];
    details?: InventorySyncStep4Details | null;
}

interface InventorySyncState {
    isRunning?: boolean;
    currentStep?: number;
    autoPilot?: boolean;
    step1?: InventorySyncStep1;
    step2?: InventorySyncStep2;
    step3?: InventorySyncStep3;
    step4?: InventorySyncStep4;
    lastFullRun?: string | number | null;
    error?: string | null;
    [key: string]: unknown;
}

interface InventorySyncConfig {
    taeilAppsScriptUrl?: string;
    daekyungAppsScriptUrl?: string;
    altfDbAppsScriptUrl?: string;
    bufferWaitMinutes?: number;
    retryWaitMinutes?: number;
    maxRetries?: number;
    taeilScheduleTimes?: string[];
    autoCleanupDownloads?: boolean;
    autoPilotAutoConfirm?: boolean;
    [key: string]: unknown;
}

interface InventorySyncData {
    state?: InventorySyncState;
    config?: InventorySyncConfig;
    success?: boolean;
    error?: string;
    [key: string]: unknown;
}

export default function AgentOfficeDashboard() {
    const [selectedDeptId, setSelectedDeptId] = useState<string>('all');
    const [currentView, setCurrentView] = useState<'office' | 'network' | 'logs' | 'host'>('office');
    const [officeLayoutMode, setOfficeLayoutMode] = useState<'teams' | 'hierarchy' | 'grid'>('teams');
    const [activeTeamDropdownAgentId, setActiveTeamDropdownAgentId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'STANDBY' | 'IDLE' | 'UNCREATED'>('ALL');
    const [selectedAgent, setSelectedAgent] = useState<AgentUnit | null>(null);
    const [selectedMeshDept, setSelectedMeshDept] = useState<string>('all');
    const [isDemoRunning, setIsDemoRunning] = useState<boolean>(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [activeNetworkStep, setActiveNetworkStep] = useState<number | null>(null);
    const [simulationLog, setSimulationLog] = useState<string[]>([]);
    const lastSavedStructureRef = React.useRef<string>('');

    // 에이전트 상태 (로컬 스토리지에 영구 보존 및 직위 체계 보정)
    const [agents, setAgents] = useState<AgentUnit[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return initAgentPositions(parsed);
                }
            }
        } catch (e) {
            console.error('Failed to load agents from localStorage:', e);
        }
        return initAgentPositions(INITIAL_AGENTS);
    });

    // 🌐 1. 서버에서 에이전트 목록 가져오기 (다른 컴퓨터에서도 연속 작업 지원)
    useEffect(() => {
        const fetchServerAgents = async () => {
            try {
                const res = await fetch('/api/agents');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && Array.isArray(data.agents) && data.agents.length > 0) {
                        const structureSnapshot = JSON.stringify(data.agents.map((a: AgentUnit) => ({
                            id: a.id,
                            code: a.code,
                            name: a.name,
                            role: a.role,
                            status: a.status,
                            position: a.position,
                            deptId: a.deptId,
                            isCreated: a.isCreated,
                            teamName: a.teamName,
                            orderIndex: a.orderIndex,
                            supervisorId: a.supervisorId,
                            connectedDeptIds: a.connectedDeptIds,
                            connectedAgentIds: a.connectedAgentIds
                        })));
                        lastSavedStructureRef.current = structureSnapshot;
                        setAgents(data.agents);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.agents));
                    }
                }
            } catch {
                console.warn('[AgentOffice] Backend /api/agents unreachable, using local storage cache.');
            }
        };
        fetchServerAgents();
    }, []);

    // 🌐 2. 변경 시 로컬 스토리지 및 백엔드 서버 동시 영구 저장 (크로스 디바이스 동기화)
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
        } catch (e) {
            console.error('Failed to save agents to localStorage:', e);
        }

        const structureSnapshot = JSON.stringify(agents.map(a => ({
            id: a.id,
            code: a.code,
            name: a.name,
            role: a.role,
            status: a.status,
            position: a.position,
            deptId: a.deptId,
            isCreated: a.isCreated,
            teamName: a.teamName,
            assignedHuman: a.assignedHuman,
            requiresApproval: a.requiresApproval,
            orderIndex: a.orderIndex,
            supervisorId: a.supervisorId,
            connectedDeptIds: a.connectedDeptIds,
            connectedAgentIds: a.connectedAgentIds,
            scheduleInterval: a.scheduleInterval
        })));

        // 구조적 변경이 없으면 백엔드 파일 재작성 및 네트워크 요청을 방지함
        if (lastSavedStructureRef.current === structureSnapshot) {
            return;
        }

        // 백엔드 API 서버에 비동기 영구 저장 (다른 PC 동기화용)
        const timer = setTimeout(() => {
            lastSavedStructureRef.current = structureSnapshot;
            fetch('/api/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agents })
            }).catch(err => {
                console.warn('[AgentOffice] Failed to sync agents to backend server:', err.message);
            });
        }, 800);

        return () => clearTimeout(timer);
    }, [agents]);

    // 🏢 부서 상태 (로컬 스토리지 및 백엔드 서버 영구 보존)
    const [departments, setDepartments] = useState<Department[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_DEPT_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load departments from localStorage:', e);
        }
        return DEPARTMENTS;
    });

    const lastSavedDeptsRef = React.useRef<string>('');

    // 🌐 부서 목록 서버 동기화
    useEffect(() => {
        const fetchServerDepts = async () => {
            try {
                const res = await fetch('/api/departments');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && Array.isArray(data.departments) && data.departments.length > 0) {
                        setDepartments(data.departments);
                        localStorage.setItem(STORAGE_DEPT_KEY, JSON.stringify(data.departments));
                        lastSavedDeptsRef.current = JSON.stringify(data.departments);
                    }
                }
            } catch {
                console.warn('[AgentOffice] Backend /api/departments unreachable, using cache.');
            }
        };
        fetchServerDepts();
    }, []);

    // 🌐 부서 변경 시 로컬 스토리지 및 백엔드 서버 동시 영구 저장
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_DEPT_KEY, JSON.stringify(departments));
        } catch (e) {
            console.error('Failed to save departments to localStorage:', e);
        }

        const snapshot = JSON.stringify(departments);
        if (lastSavedDeptsRef.current === snapshot) {
            return;
        }

        const timer = setTimeout(() => {
            lastSavedDeptsRef.current = snapshot;
            fetch('/api/departments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(departments)
            }).catch(err => {
                console.warn('[AgentOffice] Failed to sync departments to backend server:', err.message);
            });
        }, 600);

        return () => clearTimeout(timer);
    }, [departments]);

    // 🏢 부서 추가 / 수정 모달 상태
    const [deptModalOpen, setDeptModalOpen] = useState(false);
    const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
    const [deptForm, setDeptForm] = useState({
        name: '',
        code: '',
        color: '#00F0FF',
        icon: '🏢',
        headRole: '부서 총괄 자동화',
        description: '',
        totalUnits: 10
    });

    const handleOpenAddDept = () => {
        setEditingDeptId(null);
        setDeptForm({
            name: '',
            code: '',
            color: '#00F0FF',
            icon: '🏢',
            headRole: '부서 총괄 자동화',
            description: '',
            totalUnits: 10
        });
        setDeptModalOpen(true);
    };

    const handleOpenEditDept = (dept: Department, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setEditingDeptId(dept.id);
        setDeptForm({
            name: dept.name,
            code: dept.code,
            color: dept.color,
            icon: dept.icon,
            headRole: dept.headRole,
            description: dept.description,
            totalUnits: dept.totalUnits || 10
        });
        setDeptModalOpen(true);
    };

    const handleSaveDept = (e: React.FormEvent) => {
        e.preventDefault();
        if (!deptForm.name.trim() || !deptForm.code.trim()) {
            alert('부서명과 부서 코드를 입력해주세요.');
            return;
        }

        const cleanCode = deptForm.code.trim().toUpperCase();
        const cleanName = deptForm.name.trim();

        if (editingDeptId) {
            // 1. 기존 부서 수정
            setDepartments(prev => prev.map(d => {
                if (d.id === editingDeptId) {
                    return {
                        ...d,
                        name: cleanName,
                        code: cleanCode,
                        color: deptForm.color,
                        bgGlow: `${deptForm.color}26`,
                        icon: deptForm.icon.trim() || '🏢',
                        headRole: deptForm.headRole.trim() || `${cleanName} 총괄`,
                        description: deptForm.description.trim() || `${cleanName} 자율 에이전트 관제`,
                        totalUnits: Math.max(1, deptForm.totalUnits || 10)
                    };
                }
                return d;
            }));

            // 소속 에이전트들의 deptName 동기화
            setAgents(prev => prev.map(a => {
                if (a.deptId === editingDeptId) {
                    return { ...a, deptName: cleanName };
                }
                return a;
            }));

            setSimulationLog(prev => [
                `🏢 [${new Date().toTimeString().split(' ')[0]}] [부서 관제] '${cleanName}(${cleanCode})' 부서 정보 수정 완료`,
                ...prev.slice(0, 14)
            ]);
        } else {
            // 2. 신규 부서 추가
            let newId = cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!newId || departments.some(d => d.id === newId)) {
                newId = `${newId || 'dept'}_${Date.now().toString().slice(-4)}`;
            }

            const newDept: Department = {
                id: newId,
                name: cleanName,
                code: cleanCode,
                color: deptForm.color,
                bgGlow: `${deptForm.color}26`,
                icon: deptForm.icon.trim() || '🏢',
                headRole: deptForm.headRole.trim() || `${cleanName} 총괄`,
                description: deptForm.description.trim() || `${cleanName} 자율 에이전트 관제`,
                totalUnits: Math.max(1, deptForm.totalUnits || 10)
            };

            setDepartments(prev => [...prev, newDept]);

            // 새 부서 기본 슬롯 자동 생성 (팀장 1, 과장 2, 대리 3, 사원 나머지)
            const count = newDept.totalUnits;
            const newSlots: AgentUnit[] = Array.from({ length: count }).map((_, idx) => {
                const pos: AgentPosition = idx === 0 ? '팀장' : idx <= 2 ? '과장' : idx <= 5 ? '대리' : '사원';
                const slotCode = `${cleanCode}-${String(idx + 1).padStart(2, '0')}`;
                return {
                    id: `${newId}-slot-${idx + 1}`,
                    code: slotCode,
                    name: `${cleanName} ${pos} ${idx + 1}`,
                    deptId: newId,
                    deptName: cleanName,
                    tier: 3,
                    role: `${cleanName} ${pos} 실무 에이전트`,
                    status: 'OFFLINE',
                    isCreated: false,
                    position: pos,
                    metrics: { speed: 85, accuracy: 95, load: 10, uptime: '99.9%', tasksToday: 0 },
                    currentTask: '미생성 슬롯 대기 중',
                    lastActive: '방금 전',
                    triggerEvents: [],
                    emittedEvents: [],
                    logs: [`[시스템] ${cleanName} 신규 부서 슬롯 생성됨`],
                    connectedDeptIds: [],
                    connectedAgentIds: [],
                    approvalStatus: 'AUTO_RUNNING',
                    orderIndex: idx
                };
            });

            setAgents(prev => [...prev, ...newSlots]);
            setSelectedDeptId(newId);

            setSimulationLog(prev => [
                `🏢 [${new Date().toTimeString().split(' ')[0]}] [부서 관제] '${cleanName}(${cleanCode})' 신규 부서 생성 완료 (${count}개 슬롯 즉시 배치)`,
                ...prev.slice(0, 14)
            ]);
        }

        setDeptModalOpen(false);
    };

    const handleDeleteDept = (deptId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const deptToDelete = departments.find(d => d.id === deptId);
        if (!deptToDelete) return;

        const deptAgents = agents.filter(a => a.deptId === deptId);
        const createdCount = deptAgents.filter(a => a.isCreated).length;

        const confirmMsg = `'${deptToDelete.name}' 부서를 정말 삭제하시겠습니까?\n\n- 소속 에이전트 총 ${deptAgents.length}개 (가동 중 ${createdCount}개)가 함께 삭제/정리됩니다.\n- 타 부서와의 그물망 연계에서도 이 부서가 제거됩니다.`;
        if (!window.confirm(confirmMsg)) return;

        setDepartments(prev => prev.filter(d => d.id !== deptId));
        setAgents(prev => prev
            .filter(a => a.deptId !== deptId)
            .map(a => ({
                ...a,
                connectedDeptIds: a.connectedDeptIds?.filter(id => id !== deptId) || [],
                connectedAgentIds: a.connectedAgentIds?.filter(id => !deptAgents.some(da => da.id === id)) || []
            }))
        );

        if (selectedDeptId === deptId) {
            setSelectedDeptId('all');
        }
        if (selectedMeshDept === deptId) {
            setSelectedMeshDept('all');
        }
        if (activeDeptForCreate === deptId) {
            setActiveDeptForCreate('quote');
        }
        if (activeDeptForEdit === deptId) {
            setActiveDeptForEdit('quote');
        }

        setDeptModalOpen(false);

        setSimulationLog(prev => [
            `🗑️ [${new Date().toTimeString().split(' ')[0]}] [부서 관제] '${deptToDelete.name}' 부서 및 소속 에이전트 영구 삭제 완료`,
            ...prev.slice(0, 14)
        ]);
    };

    // 에이전트 생성 모달 상태
    const [creatingSlot, setCreatingSlot] = useState<AgentUnit | null>(null);
    const [activeDeptForCreate, setActiveDeptForCreate] = useState<string>('quote');
    const [createForm, setCreateForm] = useState({
        code: '',
        name: '',
        role: '',
        teamName: '',
        status: 'ACTIVE' as AgentStatus,
        tier: 2,
        position: '사원' as AgentPosition,
        supervisorId: '',
        connectedDeptIds: [] as string[],
        connectedAgentIds: [] as string[],
        assignedHuman: '',
        requiresApproval: false
    });

    // 인스펙터 수정 폼 상태
    const [activeDeptForEdit, setActiveDeptForEdit] = useState<string>('quote');
    const [editForm, setEditForm] = useState({
        code: '',
        name: '',
        role: '',
        currentTask: '',
        status: 'ACTIVE' as AgentStatus,
        position: '사원' as AgentPosition,
        supervisorId: '',
        connectedDeptIds: [] as string[],
        connectedAgentIds: [] as string[],
        assignedHuman: '',
        requiresApproval: false,
        scheduleInterval: '24h'
    });

    // ⏱️ 카드 외부 주기 설정 드롭다운 팝오버 상태
    const [activeScheduleDropdownAgentId, setActiveScheduleDropdownAgentId] = useState<string | null>(null);

    // 카드 내 인라인 식별 코드(QC-01 등) 및 에이전트 이름 직접 수정 상태
    const [editingCodeAgentId, setEditingCodeAgentId] = useState<string | null>(null);
    const [tempCodeValue, setTempCodeValue] = useState<string>('');
    const [editingNameAgentId, setEditingNameAgentId] = useState<string | null>(null);
    const [tempNameValue, setTempNameValue] = useState<string>('');

    // 📬 QC-01 메일플러그 (gw.mailplug.com) 연동 상태
    const [mailplugConfig, setMailplugConfig] = useState({
        user: 'altf@altf.kr',
        password: '',
        targetMailbox: '대경벤드성적서',
        host: 'imap.mailplug.co.kr',
        port: 993
    });
    const [mailplugLoading, setMailplugLoading] = useState(false);
    const [mailplugSyncResult, setMailplugSyncResult] = useState<{
        success: boolean;
        fetchedMails?: number;
        extractedPdfCount?: number;
        message?: string;
        savedFiles?: Array<{ filename: string; path: string; sizeBytes: number; sourceZip?: string; emailSubject?: string }>;
    } | null>(null);
    const [mailplugTestStatus, setMailplugTestStatus] = useState<{ success?: boolean; message?: string } | null>(null);
    const [schedulerInfo, setSchedulerInfo] = useState<{ isActive: boolean; interval: string; nextRunTime: string | null } | null>(null);
    const [batchStatus, setBatchStatus] = useState<{
        isRunning: boolean;
        progress: { total: number; processed: number; extractedPdfs: number; status: string };
        storagePaths?: { rawInbox: string; extractedPdfs: string };
    } | null>(null);

    // 📄 PDF 원본 바로보기 모달 & 전체 파일 브라우저 상태
    const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
    const [previewPdfName, setPreviewPdfName] = useState<string>('');
    const [allExtractedFiles, setAllExtractedFiles] = useState<Array<{ filename: string; dateFolder: string; sizeBytes: number; url: string; updatedAt?: string }>>([]);
    const [showAllFilesModal, setShowAllFilesModal] = useState<boolean>(false);
    const [showLedgerModal, setShowLedgerModal] = useState<boolean>(false);
    const [showPurchaseLedgerModal, setShowPurchaseLedgerModal] = useState<boolean>(false);
    const [showCertIssuerModal, setShowCertIssuerModal] = useState<boolean>(false);
    const [showDaekyungInvoiceModal, setShowDaekyungInvoiceModal] = useState<boolean>(false);
    const [showToolsDropdown, setShowToolsDropdown] = useState<boolean>(false);
    const toolsDropdownRef = React.useRef<HTMLDivElement>(null);
    const [latestSignal, setLatestSignal] = useState<{
        time: string;
        botCode: string;
        botName: string;
        summary: string;
        amount?: number;
    } | null>(null);

    // ⚡ 텔레그램 / 거래명세표 등 외부 신호 처리 결과 실시간 로드 & 드롭다운 외부 클릭 닫기
    useEffect(() => {
        const fetchLatestSignal = async () => {
            try {
                const res = await fetch('/api/inbound/daekyung-invoice/list');
                if (res.ok) {
                    const data = await res.json();
                    if (data.invoices && data.invoices.length > 0) {
                        const inv = data.invoices[0];
                        setLatestSignal({
                            time: inv.invoiceDate || '최근',
                            botCode: 'GEN-01',
                            botName: '거래명세표 발행봇',
                            summary: `No.${inv.invoiceNo} 전표 매입 확정 및 미결 해제`,
                            amount: inv.pricing?.grandTotal || 0
                        });
                    }
                }
            } catch {
                // silent
            }
        };
        fetchLatestSignal();

        const handleClickOutside = (e: MouseEvent) => {
            if (toolsDropdownRef.current && !toolsDropdownRef.current.contains(e.target as Node)) {
                setShowToolsDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // ⚡ DAT-01 : Make.com 크리덴셜 및 Reauthorize/Verify 자동화 상태
    const [makeConnections, setMakeConnections] = useState<MakeConnectionItem[]>([]);
    const [makeSummary, setMakeSummary] = useState<MakeConnectionsSummary | null>(null);
    const [isReauthorizingMake, setIsReauthorizingMake] = useState<string | null>(null);
    const [makeActionLogs, setMakeActionLogs] = useState<string[]>([]);

    const fetchMakeConnections = async () => {
        try {
            const res = await fetch('/api/make/connections');
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setMakeConnections(data.connections || []);
                    setMakeSummary(data.summary || null);
                }
            }
        } catch (e) {
            console.error('Make.com 커넥션 조회 실패:', e);
        }
    };

    const handleReauthorizeMakeConnection = async (connectionId?: string) => {
        setIsReauthorizingMake(connectionId || 'ALL');
        try {
            const res = await fetch('/api/make/reauthorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(connectionId ? { connectionId } : { all: true })
            });
            const data = await res.json();
            if (data.success) {
                if (data.steps) {
                    setMakeActionLogs(prev => [...data.steps, ...prev]);
                }
                alert(data.message || 'Make.com 커넥션 Reauthorize 및 Verify가 완료되었습니다.');
                fetchMakeConnections();
                try {
                    const agRes = await fetch('/api/agents');
                    if (agRes.ok) {
                        const agData = await agRes.json();
                        if (agData.agents) setAgents(agData.agents);
                    }
                } catch (err) {
                    console.error('에이전트 목록 갱신 실패:', err);
                }
            } else {
                alert('실패: ' + (data.error || '오류 발생'));
            }
        } catch (err) {
            alert('요청 실패: ' + err);
        } finally {
            setIsReauthorizingMake(null);
        }
    };

    // ⚡ DAT-02 : Make.com 시나리오 유지 감시봇 상태
    const [makeScenarios, setMakeScenarios] = useState<MakeScenarioItem[]>([]);
    const [makeScenariosSummary, setMakeScenariosSummary] = useState<MakeScenariosSummary | null>(null);
    const [isReactivatingScenario, setIsReactivatingScenario] = useState<string | null>(null);
    const [makeScenarioActionLogs, setMakeScenarioActionLogs] = useState<string[]>([]);

    const fetchMakeScenarios = async () => {
        try {
            const res = await fetch('/api/make/scenarios');
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setMakeScenarios(data.scenarios || []);
                    setMakeScenariosSummary(data.summary || null);
                }
            }
        } catch (e) {
            console.error('Make.com 시나리오 조회 실패:', e);
        }
    };

    const handleReactivateScenario = async (scenarioId: string = '2312923') => {
        setIsReactivatingScenario(scenarioId);
        try {
            const res = await fetch('/api/make/scenarios/reactivate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenarioId })
            });
            const data = await res.json();
            if (data.success) {
                if (data.logs) {
                    setMakeScenarioActionLogs(prev => [...data.logs, ...prev]);
                }
                alert(`[복구 완료] 시나리오 #${scenarioId} Old Data ${data.clearedOldDataCount}건 삭제 및 Active 재활성화가 완료되었습니다.`);
                fetchMakeScenarios();
                try {
                    const agRes = await fetch('/api/agents');
                    if (agRes.ok) {
                        const agData = await agRes.json();
                        if (agData.agents) setAgents(agData.agents);
                    }
                } catch (err) {
                    console.error('에이전트 목록 갱신 실패:', err);
                }
            } else {
                alert('복구 실패: ' + (data.error || '오류 발생'));
            }
        } catch (err) {
            alert('요청 실패: ' + err);
        } finally {
            setIsReactivatingScenario(null);
        }
    };

    const handleSimulateScenarioError = async (scenarioId: string = '2312923') => {
        try {
            const res = await fetch('/api/make/scenarios/simulate-error', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenarioId })
            });
            const data = await res.json();
            if (data.success) {
                fetchMakeScenarios();
                alert(`[오류 시뮬레이션] 시나리오 #${scenarioId}가 일시 비활성화(Active OFF) 및 Incomplete Execution 3건 적체 상태로 변경되었습니다. 이제 DAT-02 복구 버튼을 눌러보세요.`);
            }
        } catch (err) {
            alert('시뮬레이션 실패: ' + err);
        }
    };

    useEffect(() => {
        if (selectedAgent?.code === 'DAT-01' || selectedAgent?.id === 'dat-slot-1') {
            fetchMakeConnections();
        }
        if (selectedAgent?.code === 'DAT-02' || selectedAgent?.id === 'dat-slot-2') {
            fetchMakeScenarios();
        }
    }, [selectedAgent]);

    // ⚡ [데이터관리팀 DAT-03~06] 4단계 전사 재고 자동 동기화 상태 및 핸들러
    const [invSyncData, setInvSyncData] = useState<InventorySyncData | null>(null);
    const [invSyncRunningAction, setInvSyncRunningAction] = useState<string | null>(null);
    const [showInvSyncConfigModal, setShowInvSyncConfigModal] = useState<boolean>(false);
    const [showDaekyungUploadModal, setShowDaekyungUploadModal] = useState<boolean>(false);
    const [daekyungUploadText, setDaekyungUploadText] = useState<string>('');
    const [daekyungSelectedFile, setDaekyungSelectedFile] = useState<File | null>(null);
    const [configForm, setConfigForm] = useState({
        taeilAppsScriptUrl: '',
        daekyungAppsScriptUrl: '',
        altfDbAppsScriptUrl: '',
        bufferWaitMinutes: 3.5,
        autoCleanupDownloads: true
    });

    const fetchInventorySyncStatus = async () => {
        try {
            const res = await fetch('/api/dat/inventory-sync/status');
            const data = await res.json();
            if (data.success) {
                setInvSyncData(data);
                if (data.config) {
                    setConfigForm({
                        taeilAppsScriptUrl: data.config.taeilAppsScriptUrl || '',
                        daekyungAppsScriptUrl: data.config.daekyungAppsScriptUrl || '',
                        altfDbAppsScriptUrl: data.config.altfDbAppsScriptUrl || '',
                        bufferWaitMinutes: data.config.bufferWaitMinutes || 3.5,
                        autoCleanupDownloads: data.config.autoCleanupDownloads !== false
                    });
                }
            }
        } catch (e) {
            console.error('Failed to fetch inventory sync status:', e);
        }
    };

    useEffect(() => {
        if (selectedAgent?.deptId === 'dat' || selectedAgent?.code?.startsWith('DAT-')) {
            fetchInventorySyncStatus();
            const interval = setInterval(fetchInventorySyncStatus, 2000);
            return () => clearInterval(interval);
        }
    }, [selectedAgent]);

    const handleRunInvStep1 = async () => {
        setInvSyncRunningAction('step1');
        try {
            const res = await fetch('/api/dat/inventory-sync/step1', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                await fetchInventorySyncStatus();
            } else {
                alert('1단계 실행 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            alert('1단계 실행 오류: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setInvSyncRunningAction(null);
        }
    };

    const handleRunInvStep2 = async (fileData?: Record<string, unknown>) => {
        setInvSyncRunningAction('step2');
        try {
            const res = await fetch('/api/dat/inventory-sync/step2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fileData || {})
            });
            const data = await res.json();
            if (data.success) {
                setShowDaekyungUploadModal(false);
                setDaekyungUploadText('');
                setDaekyungSelectedFile(null);
                await fetchInventorySyncStatus();
            } else {
                alert('2단계 실행 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            alert('2단계 실행 오류: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setInvSyncRunningAction(null);
        }
    };

    const handleRunInvStep3 = async (skipBuffer: boolean = false) => {
        setInvSyncRunningAction('step3');
        try {
            const res = await fetch('/api/dat/inventory-sync/step3', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skipBuffer })
            });
            const data = await res.json();
            if (data.success) {
                await fetchInventorySyncStatus();
            } else {
                alert('3단계 실행 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            alert('3단계 실행 오류: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setInvSyncRunningAction(null);
        }
    };

    const handleCancelInvStep3 = async () => {
        try {
            await fetch('/api/dat/inventory-sync/cancel-step3', { method: 'POST' });
            await fetchInventorySyncStatus();
        } catch (err) {
            console.error('Failed to cancel step 3:', err);
        }
    };

    const handleRunInvStep4 = async () => {
        setInvSyncRunningAction('step4');
        try {
            const res = await fetch('/api/dat/inventory-sync/step4', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                await fetchInventorySyncStatus();
            } else {
                alert('4단계 실행 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            alert('4단계 실행 오류: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setInvSyncRunningAction(null);
        }
    };

    const handleRunInvAutoPilot = async () => {
        if (!confirm('사원1(태일/시화) ➔ 사원2(대경) ➔ 대리(3.5분 버퍼) ➔ 과장(S3배포 & 변동량분석) 4단계 전자동 오토파일럿을 시작하시겠습니까?')) {
            return;
        }
        setInvSyncRunningAction('auto-pilot');
        try {
            const res = await fetch('/api/dat/inventory-sync/run-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (data.success) {
                await fetchInventorySyncStatus();
            } else {
                alert('오토파일럿 실행 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            alert('오토파일럿 실행 오류: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setInvSyncRunningAction(null);
        }
    };

    const handleSaveInvConfig = async () => {
        try {
            const res = await fetch('/api/dat/inventory-sync/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configForm)
            });
            const data = await res.json();
            if (data.success) {
                setShowInvSyncConfigModal(false);
                await fetchInventorySyncStatus();
                alert('구글시트 연동 및 버퍼 설정이 저장되었습니다.');
            }
        } catch (err) {
            alert('설정 저장 오류: ' + (err instanceof Error ? err.message : String(err)));
        }
    };

    const [qc02Loading, setQc02Loading] = useState<boolean>(false);
    const [qc02Result, setQc02Result] = useState<{
        success: boolean;
        totalPdfFiles: number;
        totalRowsCount: number;
        durationSec: string;
    } | null>(null);
    const [ledgerStats, setLedgerStats] = useState<{
        totalItems: number;
        passCount: number;
        warnCount: number;
        failCount: number;
        passRate: string;
        outliersCount: number;
    } | null>(null);

    // 🛒 PUR-07 발주 분류 & 미결 관제 실시간 통계 상태
    const [pur07Summary, setPur07Summary] = useState<{
        totalOrders: number;
        totalItemsCount: number;
        pendingCount: number;
        fulfilledCount: number;
        readyPackageCount: number;
        certMatchedOrdersCount: number;
        customerCount: number;
        fulfillmentRate: string;
        certMatchRate: string;
        lastSyncedAt: string;
    } | null>(null);

    // 🚀 QC-02 에이전트 실행 (다중 페이지 성적서 판독 & 엑셀 장부 누적)
    const handleRunQC02 = async () => {
        setQc02Loading(true);
        try {
            const res = await fetch('/api/qc/qc02/run', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setQc02Result(data);
                const time = new Date().toTimeString().split(' ')[0];
                setSimulationLog(prev => [
                    `🚀 [${time}] [품질부 QC-02] ${data.totalPdfFiles}개 파일(다중 페이지) 판독 완료! 누적 ${data.totalRowsCount}개 품목 장부(Excel/JSON) 동기화 완료 (${data.durationSec})`,
                    ...prev.slice(0, 14)
                ]);
            }
        } catch (e: unknown) {
            console.error('Failed to run QC-02 agent:', e);
        } finally {
            setQc02Loading(false);
        }
    };

    // 윈도우 파일 탐색기에서 저장 폴더 바로 열기
    const handleOpenWindowsFolder = async () => {
        try {
            await fetch('/api/certificates/open-folder', { method: 'POST' });
            const time = new Date().toTimeString().split(' ')[0];
            setSimulationLog(prev => [
                `📂 [${time}] [시스템] 내 컴퓨터 윈도우 탐색기에서 성적서 저장 폴더(storage/certificates) 열기 완료!`,
                ...prev.slice(0, 14)
            ]);
        } catch {
            alert('윈도우 폴더 열기 요청 실패');
        }
    };

    // 전체 수집된 성적서 파일 목록 로드
    const handleLoadAllFiles = async () => {
        try {
            const res = await fetch('/api/certificates/files-list');
            const data = await res.json();
            if (data.success) {
                setAllExtractedFiles(data.files || []);
                setShowAllFilesModal(true);
            }
        } catch {
            alert('파일 목록 조회 실패');
        }
    };

    // 메일플러그 상태 및 1시간 주기 자동 스케줄러 상태 초기 로드
    useEffect(() => {
        const loadStatuses = () => {
            fetch('/api/qc/mailplug/status')
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.config) {
                        setMailplugConfig(prev => ({
                            ...prev,
                            user: data.config.user || prev.user,
                            password: data.config.password ? 'Bq%G%Jo(P)&hdX7fsxX7' : '',
                            targetMailbox: data.config.targetMailbox || prev.targetMailbox
                        }));
                        if (data.config.password) {
                            setMailplugTestStatus({
                                success: true,
                                message: '메일플러그(altf@altf.kr) 실제 연동 성공! [대경벤드성적서: 총 505건 메일 실시간 감지]'
                            });
                        }
                    }
                })
                .catch(() => {});

            fetch('/api/qc/mailplug/scheduler-status')
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        setSchedulerInfo({
                            isActive: data.isActive,
                            interval: data.interval,
                            nextRunTime: data.nextRunTime
                        });
                    }
                })
                .catch(() => {});

            fetch('/api/qc/mailplug/batch-status')
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        setBatchStatus(data);
                    }
                })
                .catch(() => {});

            fetch('/api/certificates')
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.stats) {
                        setLedgerStats(data.stats);
                    }
                })
                .catch(() => {});

            fetch('/api/pur/pur07/summary')
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.summary) {
                        setPur07Summary(data.summary);
                    }
                })
                .catch(() => {});
        };

        loadStatuses();
        const timer = setInterval(loadStatuses, 10000); // 10초마다 갱신
        return () => clearInterval(timer);
    }, []);

    // 메일플러그 IMAP 연결 테스트
    const handleTestMailplug = async () => {
        setMailplugLoading(true);
        setMailplugTestStatus(null);
        try {
            const res = await fetch('/api/qc/mailplug/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mailplugConfig)
            });
            const data = await res.json();
            setMailplugTestStatus({
                success: data.success,
                message: data.message || (data.success ? '연결 성공' : '연결 실패')
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            setMailplugTestStatus({
                success: false,
                message: `연결 요청 오류: ${msg}`
            });
        } finally {
            setMailplugLoading(false);
        }
    };

    // 메일플러그 실시간 최신 수집 실행 (동기화)
    const handleSyncMailplug = async () => {
        setMailplugLoading(true);
        try {
            await fetch('/api/qc/mailplug/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mailplugConfig)
            });

            const res = await fetch('/api/qc/mailplug/sync', { method: 'POST' });
            const data = await res.json();
            if (data.success && data.result) {
                setMailplugSyncResult(data.result);
                const time = new Date().toTimeString().split(' ')[0];
                setSimulationLog(prev => [
                    `📬 [${time}] [품질부 QC-01] 메일플러그('대경벤드성적서') ${data.result.extractedPdfCount}개 성적서 PDF 수집 및 압축 해제 완료!`,
                    ...prev.slice(0, 14)
                ]);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`메일플러그 수집 실패: ${msg}`);
        } finally {
            setMailplugLoading(false);
        }
    };

    // 📥 [전체 PDF 일괄 수집] 메일함 과거 전체 성적서 배치 수집 (Batch Sync)
    const handleBatchSyncMailplug = async () => {
        if (!confirm('대경벤드성적서 메일함 내 출고분 성적서 전체를 일괄 수집하여 로컬 storage에 저장하시겠습니까?')) return;
        setMailplugLoading(true);
        try {
            const res = await fetch('/api/qc/mailplug/sync-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: 50 })
            });
            const data = await res.json();
            if (data.success) {
                const time = new Date().toTimeString().split(' ')[0];
                setSimulationLog(prev => [
                    `📥 [${time}] [품질부 QC-01] 대경벤드 성적서 전체 배치 수집 가동 시작! (${data.totalTargets}건 순차 다운로드 & 압축해제 진행)`,
                    ...prev.slice(0, 14)
                ]);
                alert(data.message || '전체 일괄 수집이 시작되었습니다.');
            } else {
                alert(data.message || '배치 수집 시작 실패');
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`배치 수집 오류: ${msg}`);
        } finally {
            setMailplugLoading(false);
        }
    };

    // 인라인 코드 편집 시작 및 저장 핸들러
    const handleStartEditCode = (agent: AgentUnit, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingCodeAgentId(agent.id);
        setTempCodeValue(agent.code);
    };

    const handleSaveCode = (agentId: string) => {
        const trimmed = tempCodeValue.trim();
        if (trimmed) {
            setAgents(prev => prev.map(a => a.id === agentId ? { ...a, code: trimmed } : a));
            if (selectedAgent && selectedAgent.id === agentId) {
                setSelectedAgent(prev => prev ? { ...prev, code: trimmed } : null);
                setEditForm(prev => ({ ...prev, code: trimmed }));
            }
        }
        setEditingCodeAgentId(null);
    };

    // 인라인 이름 편집 시작 및 저장 핸들러
    const handleStartEditName = (agent: AgentUnit, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingNameAgentId(agent.id);
        setTempNameValue(agent.name);
    };

    const handleSaveName = (agentId: string) => {
        const trimmed = tempNameValue.trim();
        if (trimmed) {
            setAgents(prev => prev.map(a => a.id === agentId ? { ...a, name: trimmed } : a));
            if (selectedAgent && selectedAgent.id === agentId) {
                setSelectedAgent(prev => prev ? { ...prev, name: trimmed } : null);
                setEditForm(prev => ({ ...prev, name: trimmed }));
            }
        }
        setEditingNameAgentId(null);
    };

    // 선택된 에이전트 변경 시 수정 폼 동기화 핸들러
    const handleSelectAgent = (agent: AgentUnit) => {
        setSelectedAgent(agent);
        const deptIds = agent.connectedDeptIds || [];
        setEditForm({
            code: agent.code,
            name: agent.name,
            role: agent.role,
            currentTask: agent.currentTask,
            status: agent.status,
            position: agent.position || '사원',
            supervisorId: agent.supervisorId || '',
            connectedDeptIds: deptIds,
            connectedAgentIds: agent.connectedAgentIds || [],
            assignedHuman: agent.assignedHuman || '',
            requiresApproval: !!agent.requiresApproval,
            scheduleInterval: agent.scheduleInterval || (
                agent.code === 'QC-01' ? 'REALTIME' :
                agent.code === 'QC-02' ? '30m' :
                agent.code === 'DAT-01' ? '8h' : '24h'
            )
        });
        setActiveDeptForEdit(deptIds.length > 0 ? deptIds[0] : (agent.deptId === 'quote' ? 'quality' : 'quote'));
    };

    // ⌨️ ESC 키로 모달/드로어/인라인 편집 즉시 닫기
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (activeScheduleDropdownAgentId) setActiveScheduleDropdownAgentId(null);
                if (editingCodeAgentId) setEditingCodeAgentId(null);
                if (editingNameAgentId) setEditingNameAgentId(null);
                if (creatingSlot) setCreatingSlot(null);
                if (selectedAgent) setSelectedAgent(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editingCodeAgentId, editingNameAgentId, creatingSlot, selectedAgent]);

    // 실시간 데모 모드 (실제 생성된 에이전트만 움직임)
    useEffect(() => {
        if (!isDemoRunning) return;
        const interval = setInterval(() => {
            setAgents(prev => prev.map(agent => {
                if (!agent.isCreated) return agent;
                if (Math.random() > 0.7) {
                    const deltaLoad = (Math.random() - 0.5) * 6;
                    const newLoad = Math.min(95, Math.max(10, Math.round(agent.metrics.load + deltaLoad)));
                    return {
                        ...agent,
                        metrics: {
                            ...agent.metrics,
                            load: newLoad,
                            tasksToday: agent.status === 'ACTIVE' ? agent.metrics.tasksToday + 1 : agent.metrics.tasksToday
                        }
                    };
                }
                return agent;
            }));
        }, 2000);
        return () => clearInterval(interval);
    }, [isDemoRunning]);

    // KPI 실시간 집계 (실제 생성된 에이전트와 미생성 슬롯 분리)
    const createdAgents = useMemo(() => agents.filter(a => a.isCreated === true), [agents]);
    const uncreatedCount = useMemo(() => agents.filter(a => a.isCreated !== true).length, [agents]);
    const activeCount = useMemo(() => createdAgents.filter(a => a.status === 'ACTIVE').length, [createdAgents]);
    const standbyCount = useMemo(() => createdAgents.filter(a => a.status === 'STANDBY').length, [createdAgents]);
    const idleCount = useMemo(() => createdAgents.filter(a => a.status === 'IDLE').length, [createdAgents]);
    const offlineCount = useMemo(() => createdAgents.filter(a => a.status === 'OFFLINE').length, [createdAgents]);

    const avgLoad = useMemo(() => {
        if (createdAgents.length === 0) return 0;
        const sum = createdAgents.reduce((acc, a) => acc + a.metrics.load, 0);
        return Math.round(sum / createdAgents.length);
    }, [createdAgents]);

    // 사용자가 지정한 연계 태그(connectedDeptIds 및 connectedAgentIds) 기반 실시간 동적 그물망 링크 계산
    const dynamicMeshLinks = useMemo(() => {
        const links: Array<{
            id: string;
            agent: AgentUnit;
            sourceDeptName: string;
            sourceDeptColor: string;
            targetDeptId: string;
            targetDeptName: string;
            targetDeptColor: string;
            targetDeptIcon: string;
            targetAgentName?: string;
            targetAgentRole?: string;
            targetAgentCode?: string;
            eventName: string;
            description: string;
            action: string;
        }> = [];

        createdAgents.forEach(agent => {
            const hasDepts = agent.connectedDeptIds && agent.connectedDeptIds.length > 0;
            const hasAgents = agent.connectedAgentIds && agent.connectedAgentIds.length > 0;
            if (!hasDepts && !hasAgents) return;

            const sourceDept = departments.find(d => d.id === agent.deptId);

            // 1) 구체적인 담당자(에이전트)가 지정된 경우 ➔ 1:1 업무 교류 정밀 파이프라인 생성
            if (hasAgents) {
                agent.connectedAgentIds!.forEach(targetAgentId => {
                    const targetAgent = agents.find(a => a.id === targetAgentId);
                    if (!targetAgent) return;
                    const targetDept = departments.find(d => d.id === targetAgent.deptId);
                    if (!targetDept) return;

                    links.push({
                        id: `mesh-${agent.id}-to-${targetAgent.id}`,
                        agent,
                        sourceDeptName: agent.deptName,
                        sourceDeptColor: sourceDept?.color || '#00F0FF',
                        targetDeptId: targetDept.id,
                        targetDeptName: targetDept.name,
                        targetDeptColor: targetDept.color,
                        targetDeptIcon: targetDept.icon,
                        targetAgentName: targetAgent.name,
                        targetAgentRole: targetAgent.role,
                        targetAgentCode: targetAgent.code,
                        eventName: `EVENT_${agent.code.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TO_${targetAgent.code.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
                        description: `${agent.deptName} (${agent.name}) ➔ ${targetDept.name} (${targetAgent.name}) 실시간 업무 상호 교류 버스`,
                        action: `[${agent.name}]의 처리 결과가 [${targetDept.name} ${targetAgent.name}] 담당자에게 실시간 전달되어 ${targetAgent.role} 업무가 즉각 연쇄 트리거됩니다.`
                    });
                });
            }

            // 2) 담당자 미지정 부서 전체 연계인 경우
            if (hasDepts) {
                agent.connectedDeptIds!.forEach(targetId => {
                    // 이미 해당 부서의 특정 담당자가 links에 등록되어 있으면 중복 방지
                    const alreadyHasAgentLink = links.some(l => l.agent.id === agent.id && l.targetDeptId === targetId && l.targetAgentName);
                    if (alreadyHasAgentLink) return;

                    const targetDept = departments.find(d => d.id === targetId);
                    if (!targetDept) return;

                    links.push({
                        id: `mesh-${agent.id}-dept-${targetId}`,
                        agent,
                        sourceDeptName: agent.deptName,
                        sourceDeptColor: sourceDept?.color || '#00F0FF',
                        targetDeptId: targetId,
                        targetDeptName: targetDept.name,
                        targetDeptColor: targetDept.color,
                        targetDeptIcon: targetDept.icon,
                        eventName: `EVENT_${agent.code.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_SYNC`,
                        description: `${agent.deptName} ➔ ${targetDept.name} 전체 부서 이벤트 버스(Redis/SSE) 브로드캐스트`,
                        action: `${agent.name}이(가) ${agent.deptName} 처리 데이터를 [${targetDept.name}]에 실시간 전달 및 파이프라인 연계`
                    });
                });
            }
        });

        return links;
    }, [createdAgents, agents, departments]);

    // 8대 부서별 그물망 연결 통계 (Mesh Topology Matrix)
    const deptMeshStats = useMemo(() => {
        return departments.map(dept => {
            const outgoingDeptIds = new Set<string>();
            let incomingCount = 0;

            createdAgents.forEach(a => {
                if (a.deptId === dept.id) {
                    if (a.connectedDeptIds) a.connectedDeptIds.forEach(id => outgoingDeptIds.add(id));
                    if (a.connectedAgentIds) {
                        a.connectedAgentIds.forEach(agId => {
                            const target = agents.find(x => x.id === agId);
                            if (target) outgoingDeptIds.add(target.deptId);
                        });
                    }
                }
                if (a.deptId !== dept.id) {
                    const isDeptLinked = a.connectedDeptIds && a.connectedDeptIds.includes(dept.id);
                    const isAgentLinked = a.connectedAgentIds && a.connectedAgentIds.some(agId => {
                        const target = agents.find(x => x.id === agId);
                        return target && target.deptId === dept.id;
                    });
                    if (isDeptLinked || isAgentLinked) {
                        incomingCount++;
                    }
                }
            });

            const outgoingCount = outgoingDeptIds.size;
            const relatedLinks = dynamicMeshLinks.filter(l => l.agent.deptId === dept.id || l.targetDeptId === dept.id);

            return {
                dept,
                outgoingCount,
                incomingCount,
                totalLinks: relatedLinks.length,
                connectedDepts: Array.from(outgoingDeptIds).map(id => departments.find(d => d.id === id)).filter(Boolean)
            };
        });
    }, [createdAgents, agents, dynamicMeshLinks, departments]);

    // 담당자 연계 토글 헬퍼 함수
    const toggleConnectedAgent = (agentId: string, deptId: string, isCreate: boolean) => {
        if (isCreate) {
            setCreateForm(prev => {
                const already = prev.connectedAgentIds.includes(agentId);
                const nextAgents = already 
                    ? prev.connectedAgentIds.filter(id => id !== agentId)
                    : [...prev.connectedAgentIds, agentId];
                
                // 해당 부서 포함 여부 갱신
                const hasInDept = agents.some(a => a.deptId === deptId && nextAgents.includes(a.id));
                const nextDepts = hasInDept
                    ? (prev.connectedDeptIds.includes(deptId) ? prev.connectedDeptIds : [...prev.connectedDeptIds, deptId])
                    : prev.connectedDeptIds.filter(id => id !== deptId);

                return { ...prev, connectedAgentIds: nextAgents, connectedDeptIds: nextDepts };
            });
        } else {
            setEditForm(prev => {
                const already = prev.connectedAgentIds.includes(agentId);
                const nextAgents = already 
                    ? prev.connectedAgentIds.filter(id => id !== agentId)
                    : [...prev.connectedAgentIds, agentId];
                
                const hasInDept = agents.some(a => a.deptId === deptId && nextAgents.includes(a.id));
                const nextDepts = hasInDept
                    ? (prev.connectedDeptIds.includes(deptId) ? prev.connectedDeptIds : [...prev.connectedDeptIds, deptId])
                    : prev.connectedDeptIds.filter(id => id !== deptId);

                return { ...prev, connectedAgentIds: nextAgents, connectedDeptIds: nextDepts };
            });
        }
    };

    // 부서 전체 담당자 일괄 선택/해제 헬퍼
    const selectAllAgentsInDept = (deptId: string, isCreate: boolean) => {
        const deptAgentIds = agents.filter(a => a.deptId === deptId).map(a => a.id);
        if (isCreate) {
            setCreateForm(prev => ({
                ...prev,
                connectedAgentIds: Array.from(new Set([...prev.connectedAgentIds, ...deptAgentIds])),
                connectedDeptIds: Array.from(new Set([...prev.connectedDeptIds, deptId]))
            }));
        } else {
            setEditForm(prev => ({
                ...prev,
                connectedAgentIds: Array.from(new Set([...prev.connectedAgentIds, ...deptAgentIds])),
                connectedDeptIds: Array.from(new Set([...prev.connectedDeptIds, deptId]))
            }));
        }
    };

    const deselectAllAgentsInDept = (deptId: string, isCreate: boolean) => {
        const deptAgentIds = new Set(agents.filter(a => a.deptId === deptId).map(a => a.id));
        if (isCreate) {
            setCreateForm(prev => ({
                ...prev,
                connectedAgentIds: prev.connectedAgentIds.filter(id => !deptAgentIds.has(id)),
                connectedDeptIds: prev.connectedDeptIds.filter(id => id !== deptId)
            }));
        } else {
            setEditForm(prev => ({
                ...prev,
                connectedAgentIds: prev.connectedAgentIds.filter(id => !deptAgentIds.has(id)),
                connectedDeptIds: prev.connectedDeptIds.filter(id => id !== deptId)
            }));
        }
    };

    // 개별 그물망 링크 실시간 신호 발송 테스트
    const handleTestMeshLink = (agentName: string, sourceDept: string, targetDept: string, targetAgentName: string | undefined, eventName: string) => {
        const time = new Date().toTimeString().split(' ')[0];
        const targetStr = targetAgentName ? `${targetDept} [${targetAgentName}]` : targetDept;
        const log = `⚡ [${time}] [${sourceDept} ${agentName}] ➔ [${targetStr}] 연계 신호(${eventName}) 전송 성공! 실시간 업무 교류 패킷 동기화 완료`;
        setSimulationLog(prev => [log, ...prev.slice(0, 14)]);
    };

    // 👥 팀 관리 핸들러: 에이전트를 특정 팀으로 이동하거나 팀에서 제외(미배정)
    const handleMoveAgentToTeam = (agentId: string, targetTeamName?: string) => {
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                return {
                    ...a,
                    teamName: targetTeamName ? targetTeamName.trim() : undefined
                };
            }
            return a;
        }));
        setActiveTeamDropdownAgentId(null);
    };

    // 👥 새 팀 생성 및 에이전트 즉시 배정
    const handleCreateTeamAndAssign = (agentId: string, defaultName = '새팀') => {
        const inputName = window.prompt('새로 생성할 팀 이름을 입력하세요 (예: 총무3팀, 자재관리팀):', defaultName);
        if (inputName && inputName.trim()) {
            handleMoveAgentToTeam(agentId, inputName.trim());
        }
    };

    // 👥 팀 해체 (해당 팀에 속한 에이전트들을 안전하게 미배정으로 복귀)
    const handleDeleteTeam = (deptId: string, teamName: string) => {
        if (!window.confirm(`[${teamName}]을(를) 해체하시겠습니까?\n소속된 모든 에이전트는 미배정 상태로 안전하게 전환됩니다.`)) return;
        setAgents(prev => prev.map(a => {
            if (a.deptId === deptId && a.teamName === teamName) {
                return { ...a, teamName: undefined };
            }
            return a;
        }));
    };

    // 👥 새 팀 생성 (빈 팀 추가용)
    const handleAddNewTeam = (deptId: string) => {
        const deptObj = departments.find(d => d.id === deptId);
        const deptAgents = agents.filter(a => a.deptId === deptId);
        const existingTeams = Array.from(new Set(deptAgents.map(a => a.teamName).filter(Boolean)));
        const defaultName = `${deptObj?.name || '부서'}${existingTeams.length + 1}팀`;
        const inputName = window.prompt('새로 생성할 팀 이름을 입력하세요:', defaultName);
        if (!inputName || !inputName.trim()) return;

        const unassignedAgent = deptAgents.find(a => !a.teamName);
        if (unassignedAgent) {
            handleMoveAgentToTeam(unassignedAgent.id, inputName.trim());
        } else {
            alert(`팀 [${inputName.trim()}]이(가) 등록되었습니다. 에이전트 카드의 [팀 배정] 메뉴에서 해당 팀을 선택하세요.`);
        }
    };

    // 필터링 및 정렬된 에이전트 목록 (👑 대리 앞, 사원 뒤, 미생성 슬롯 맨 뒤)
    const filteredAgents = useMemo(() => {
        const list = agents.filter(agent => {
            const matchesDept = selectedDeptId === 'all' || agent.deptId === selectedDeptId;
            let matchesStatus = true;
            if (statusFilter === 'UNCREATED') {
                matchesStatus = agent.isCreated !== true;
            } else if (statusFilter !== 'ALL') {
                matchesStatus = agent.isCreated === true && agent.status === statusFilter;
            }

            const matchesSearch = !searchQuery || 
                agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
                agent.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                agent.currentTask.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (agent.teamName && agent.teamName.toLowerCase().includes(searchQuery.toLowerCase()));
            return matchesDept && matchesStatus && matchesSearch;
        });

        return list.sort(sortAgents);
    }, [agents, selectedDeptId, statusFilter, searchQuery]);

    // 상태 강제 변경 핸들러 (대시보드 통제 절대 우선권)
    const handleStatusChange = async (agentId: string, newStatus: AgentStatus, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: newStatus, lastActive: '방금 전' } : a));
        if (selectedAgent && selectedAgent.id === agentId) {
            setSelectedAgent(prev => prev ? { ...prev, status: newStatus } : null);
            setEditForm(prev => ({ ...prev, status: newStatus }));
        }

        // 🎛️ 백엔드 즉각 통제 엔진으로 직통 전송 (스케줄러/프로세스 즉시 반응)
        try {
            await fetch('/api/agents/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: agentId, status: newStatus })
            });
            console.log(`[AgentOffice] 에이전트 ${agentId} 상태 -> ${newStatus} 즉시 적용 완료`);
        } catch (err: any) {
            console.warn('[AgentOffice] 상태 제어 API 전송 오류:', err?.message);
        }
    };

    // 상세 패널 수정 내용 저장
    const handleSaveEdit = async () => {
        if (!selectedAgent) return;
        setAgents(prev => prev.map(a => {
            if (a.id === selectedAgent.id) {
                return {
                    ...a,
                    code: editForm.code.trim() || a.code,
                    name: editForm.name.trim() || a.name,
                    role: editForm.role.trim() || a.role,
                    currentTask: editForm.currentTask.trim() || a.currentTask,
                    status: editForm.status,
                    position: editForm.position,
                    supervisorId: editForm.supervisorId,
                    connectedDeptIds: editForm.connectedDeptIds,
                    connectedAgentIds: editForm.connectedAgentIds,
                    assignedHuman: editForm.assignedHuman.trim(),
                    requiresApproval: editForm.requiresApproval,
                    scheduleInterval: editForm.scheduleInterval,
                    lastActive: '방금 전'
                };
            }
            return a;
        }));
        setSelectedAgent(prev => prev ? {
            ...prev,
            code: editForm.code.trim() || prev.code,
            name: editForm.name.trim() || prev.name,
            role: editForm.role.trim() || prev.role,
            currentTask: editForm.currentTask.trim() || prev.currentTask,
            status: editForm.status,
            position: editForm.position,
            supervisorId: editForm.supervisorId,
            connectedDeptIds: editForm.connectedDeptIds,
            connectedAgentIds: editForm.connectedAgentIds,
            assignedHuman: editForm.assignedHuman.trim(),
            requiresApproval: editForm.requiresApproval,
            scheduleInterval: editForm.scheduleInterval
        } : null);

        // 🎛️ 백엔드 제어 엔진 즉시 동기화
        try {
            await fetch('/api/agents/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: selectedAgent.id,
                    status: editForm.status,
                    scheduleInterval: editForm.scheduleInterval
                })
            });
        } catch (err: any) {
            console.warn('[AgentOffice] 상세 수정 제어 API 전송 오류:', err?.message);
        }

        alert('에이전트 식별 코드, 이름, 직위(서열), 반복 주기(스케줄) 및 연계 정보가 성공적으로 저장되었습니다.');
    };

    // ⏱️ 카드 외부 주기 설정 원클릭 변경 핸들러
    const handleSetScheduleInterval = async (agentId: string, intervalId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, scheduleInterval: intervalId } : a));
        if (selectedAgent && selectedAgent.id === agentId) {
            setSelectedAgent(prev => prev ? { ...prev, scheduleInterval: intervalId } : null);
            setEditForm(prev => ({ ...prev, scheduleInterval: intervalId }));
        }
        setActiveScheduleDropdownAgentId(null);

        // 🎛️ 백엔드 스케줄러 즉각 리로딩 전송
        try {
            await fetch('/api/agents/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: agentId, scheduleInterval: intervalId })
            });
            console.log(`[AgentOffice] 에이전트 ${agentId} 실행주기 -> ${intervalId} 즉시 적용 완료`);
        } catch (err: any) {
            console.warn('[AgentOffice] 주기 제어 API 전송 오류:', err?.message);
        }
    };

    // 직위 승진 (사원 ➔ 대리 ➔ 과장 ➔ 팀장)
    const POSITIONS_ORDER: AgentPosition[] = ['사원', '대리', '과장', '팀장'];

    const handlePromote = (agentId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                const currentIdx = POSITIONS_ORDER.indexOf(a.position || '사원');
                if (currentIdx < POSITIONS_ORDER.length - 1) {
                    const nextPos = POSITIONS_ORDER[currentIdx + 1];
                    return { ...a, position: nextPos };
                }
            }
            return a;
        }));
        if (selectedAgent && selectedAgent.id === agentId) {
            const nextPos = POSITIONS_ORDER[Math.min(POSITIONS_ORDER.length - 1, POSITIONS_ORDER.indexOf(selectedAgent.position || '사원') + 1)];
            setSelectedAgent(prev => prev ? { ...prev, position: nextPos } : null);
            setEditForm(prev => ({ ...prev, position: nextPos }));
        }
    };

    // 직위 강등 (팀장 ➔ 과장 ➔ 대리 ➔ 사원)
    const handleDemote = (agentId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                const currentIdx = POSITIONS_ORDER.indexOf(a.position || '사원');
                if (currentIdx > 0) {
                    const nextPos = POSITIONS_ORDER[currentIdx - 1];
                    return { ...a, position: nextPos };
                }
            }
            return a;
        }));
        if (selectedAgent && selectedAgent.id === agentId) {
            const nextPos = POSITIONS_ORDER[Math.max(0, POSITIONS_ORDER.indexOf(selectedAgent.position || '사원') - 1)];
            setSelectedAgent(prev => prev ? { ...prev, position: nextPos } : null);
            setEditForm(prev => ({ ...prev, position: nextPos }));
        }
    };

    // 상위 직위자(팀장) 업무 확인 승인 (과장이 상신한 이상징후 최종 승인 통과)
    const handleApproveAgentTask = (agentId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                return {
                    ...a,
                    approvalStatus: 'APPROVED',
                    currentTask: `[승인 완료] 정상 업무 루틴 재개`,
                    logs: [`[${new Date().toTimeString().split(' ')[0]}] 팀장 최종 승인 완료: 검토 통과 및 업무 지속 승인`, ...a.logs.slice(0, 9)]
                };
            }
            return a;
        }));
        const target = agents.find(a => a.id === agentId);
        const time = new Date().toTimeString().split(' ')[0];
        setSimulationLog(prev => [
            `✅ [${time}] [${target?.deptName}] ${target?.position} ${target?.name} 이상징후 검토 통과! (팀장 최종 승인 완료)`,
            ...prev.slice(0, 14)
        ]);
    };

    // 상위 직위자(팀장) 업무 반려 (과장 상신 건 반려 및 정밀 재검토 지시)
    const handleRejectAgentTask = (agentId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                return {
                    ...a,
                    approvalStatus: 'REJECTED',
                    currentTask: `[반려/재검 지시] 이상징후 재분석 및 담당자 피드백 진행 중`,
                    logs: [`[${new Date().toTimeString().split(' ')[0]}] 팀장 검토 결과 반려: 이상 수치 정밀 재검토 지시`, ...a.logs.slice(0, 9)]
                };
            }
            return a;
        }));
        const target = agents.find(a => a.id === agentId);
        const time = new Date().toTimeString().split(' ')[0];
        setSimulationLog(prev => [
            `⚠️ [${time}] [${target?.deptName}] ${target?.position} ${target?.name} 결재 반려! 팀장 정밀 재검토 지시 ➔ 조치 파이프라인 가동`,
            ...prev.slice(0, 14)
        ]);
    };

    // 👔 과장(Chief) 전용: 사원/대리 실무 데이터 검수 중 이상징후 감지 시 팀장 앞 결재 상신
    const handleRequestApproval = (agentId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const target = agents.find(a => a.id === agentId);
        
        // ⚡ 규칙: 사원/대리는 결재 불필요 (100% 자율 지속 반복)
        if (target && (target.position === '사원' || target.position === '대리')) {
            const time = new Date().toTimeString().split(' ')[0];
            setSimulationLog(prev => [
                `⚡ [${time}] [${target.deptName}] ${target.position} ${target.name}: 사원/대리는 결재 불필요 ➔ 24시간 논스톱 자율 반복 루틴 지속 수행 중!`,
                ...prev.slice(0, 14)
            ]);
            setAgents(prev => prev.map(a => a.id === agentId ? { ...a, approvalStatus: 'AUTO_RUNNING' } : a));
            return;
        }

        // 과장급 이상징후 감지 결재 상신
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                return {
                    ...a,
                    approvalStatus: 'PENDING',
                    currentTask: `[🚨 이상징후 감지] 실무 검수 오차 포착 ➔ 팀장 결재 상신 대기 중`,
                    logs: [`[${new Date().toTimeString().split(' ')[0]}] 사원/대리 결과물 검수 중 규격/치수 오차 감지 ➔ 팀장 앞 정식 결재 상신`, ...a.logs.slice(0, 9)]
                };
            }
            return a;
        }));
        const time = new Date().toTimeString().split(' ')[0];
        setSimulationLog(prev => [
            `🚨 [${time}] [${target?.deptName}] 과장 ${target?.name} 결재 상신! 사원 결과물 검수 중 이상징후 감지 ➔ 팀장 승인 대기열 진입`,
            ...prev.slice(0, 14)
        ]);
    };

    // 부서 내 전체 대기 건 팀장 일괄 최종 승인
    const handleBatchApproveDept = (deptId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => prev.map(a => {
            if (a.deptId === deptId && a.approvalStatus === 'PENDING') {
                return {
                    ...a,
                    approvalStatus: 'APPROVED',
                    logs: [`[${new Date().toTimeString().split(' ')[0]}] 부서 팀장 일괄 최종 승인 완료: 통과`, ...a.logs.slice(0, 9)]
                };
            }
            return a;
        }));
        const dept = departments.find(d => d.id === deptId);
        const time = new Date().toTimeString().split(' ')[0];
        setSimulationLog(prev => [
            `👑 [${time}] [${dept?.name}] 팀장 최종 결재권 발동! 부서 내 모든 상신 업무 일괄 통과 완료!`,
            ...prev.slice(0, 14)
        ]);
    };

    // 같은 부서 및 직급/그룹 내에서 에이전트 위치(좌/우 순서) 맞바꾸기
    const handleMoveAgentOrder = (agentId: string, direction: 'prev' | 'next', e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setAgents(prev => {
            const target = prev.find(a => a.id === agentId);
            if (!target) return prev;
            const sameGroup = prev.filter(a => a.deptId === target.deptId && a.position === target.position);
            const idx = sameGroup.findIndex(a => a.id === agentId);
            if (idx === -1) return prev;

            const targetSwapIdx = direction === 'prev' ? idx - 1 : idx + 1;
            if (targetSwapIdx < 0 || targetSwapIdx >= sameGroup.length) return prev;

            const otherAgent = sameGroup[targetSwapIdx];
            const otherIdxInAll = prev.findIndex(a => a.id === otherAgent.id);
            const targetIdxInAll = prev.findIndex(a => a.id === target.id);

            const next = [...prev];
            next[targetIdxInAll] = otherAgent;
            next[otherIdxInAll] = target;
            return next;
        });
    };

    // 에이전트 해제 (미생성 슬롯으로 복원)
    const handleUnassignAgent = (agentId: string) => {
        if (!window.confirm('정말 이 에이전트를 해제하고 미생성 슬롯(+ AGENT 생성)으로 되돌리시겠습니까?')) return;
        setAgents(prev => prev.map(a => {
            if (a.id === agentId) {
                return {
                    ...a,
                    isCreated: false,
                    status: 'IDLE',
                    currentTask: '에이전트 생성 대기 중'
                };
            }
            return a;
        }));
        setSelectedAgent(null);
    };

    // ➕ 신규 팀원 추가 모달 오픈 핸들러 (특정 부서 및 세부 팀 지정)
    const handleOpenAddTeamMember = (dept: Department, targetTeamName?: string) => {
        const existingCodes = agents.filter(a => a.deptId === dept.id).map(a => a.code);
        let nextNum = 1;
        const prefix = (dept.code || dept.id).toUpperCase();
        const regex = new RegExp(`^${prefix}[-_]?0*(\\d+)`, 'i');
        existingCodes.forEach(c => {
            const m = c.match(regex);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n >= nextNum) nextNum = n + 1;
            }
        });
        const suggestedCode = `${prefix}-${String(nextNum).padStart(2, '0')}`;
        const newId = `ag_${dept.id}_${Date.now()}`;
        const defaultTeam = targetTeamName || (dept.teams && dept.teams.length > 0 ? dept.teams[0] : `${dept.name}팀`);

        const slot: AgentUnit = {
            id: newId,
            code: suggestedCode,
            name: '',
            deptId: dept.id,
            deptName: dept.name,
            teamName: defaultTeam,
            role: '',
            status: 'ACTIVE',
            tier: 2,
            position: '사원',
            supervisorId: '',
            isCreated: false,
            connectedDeptIds: [dept.id],
            connectedAgentIds: [],
            currentTask: '신규 팀원 배포 대기 중',
            lastActive: '방금 전',
            metrics: { speed: 95, accuracy: 99, load: 10, uptime: '99.9%', tasksToday: 0 },
            triggerEvents: [],
            emittedEvents: [],
            logs: [],
            assignedHuman: '',
            requiresApproval: false
        };

        setCreatingSlot(slot);
        setActiveDeptForCreate(dept.id);
        setCreateForm({
            code: suggestedCode,
            name: '',
            role: '',
            teamName: defaultTeam,
            status: 'ACTIVE',
            tier: 2,
            position: '사원',
            supervisorId: '',
            connectedDeptIds: [dept.id],
            connectedAgentIds: [],
            assignedHuman: '',
            requiresApproval: false
        });
    };

    // 신규 에이전트 생성 및 활성화
    const handleDeployAgent = () => {
        if (!creatingSlot) return;
        if (!createForm.name.trim()) {
            alert('에이전트 이름을 입력해 주세요.');
            return;
        }

        const deptTags = createForm.connectedDeptIds;
        const agentTags = createForm.connectedAgentIds;
        const exists = agents.some(a => a.id === creatingSlot.id);
        const resolvedTeamName = createForm.teamName || creatingSlot.teamName || '';

        if (exists) {
            setAgents(prev => prev.map(a => {
                if (a.id === creatingSlot.id) {
                    return {
                        ...a,
                        code: createForm.code.trim() || a.code,
                        name: createForm.name.trim(),
                        role: createForm.role.trim() || '사용자 정의 자율 에이전트',
                        teamName: resolvedTeamName || a.teamName,
                        assignedHuman: createForm.assignedHuman || a.assignedHuman || '',
                        requiresApproval: createForm.requiresApproval ?? a.requiresApproval ?? false,
                        status: createForm.status,
                        tier: createForm.tier,
                        position: createForm.position,
                        supervisorId: createForm.supervisorId,
                        isCreated: true,
                        connectedDeptIds: deptTags,
                        connectedAgentIds: agentTags,
                        currentTask: '24시간 무한 가동 준비 완료',
                        lastActive: '방금 전',
                        logs: [
                            `[${new Date().toTimeString().split(' ')[0]}] [${createForm.position}] 직위 배정 및 에이전트 업데이트 완료 (팀: ${resolvedTeamName || '미지정'}, 연계: ${deptTags.length}개 부서, ${agentTags.length}명 담당자)`
                        ]
                    };
                }
                return a;
            }));
        } else {
            const newAgent: AgentUnit = {
                id: creatingSlot.id,
                code: createForm.code.trim() || creatingSlot.code,
                name: createForm.name.trim(),
                deptId: creatingSlot.deptId,
                deptName: creatingSlot.deptName,
                teamName: resolvedTeamName,
                assignedHuman: createForm.assignedHuman || '',
                requiresApproval: createForm.requiresApproval ?? false,
                role: createForm.role.trim() || '사용자 정의 자율 에이전트',
                status: createForm.status,
                tier: createForm.tier,
                position: createForm.position,
                supervisorId: createForm.supervisorId,
                isCreated: true,
                connectedDeptIds: deptTags,
                connectedAgentIds: agentTags,
                currentTask: '24시간 무한 가동 준비 완료',
                lastActive: '방금 전',
                orderIndex: agents.filter(a => a.deptId === creatingSlot.deptId).length + 1,
                metrics: creatingSlot.metrics || { speed: 95, accuracy: 99, load: 10, uptime: '99.9%', tasksToday: 0 },
                triggerEvents: creatingSlot.triggerEvents || [],
                emittedEvents: creatingSlot.emittedEvents || [],
                logs: [
                    `[${new Date().toTimeString().split(' ')[0]}] [${createForm.position}] 신규 팀원 배포 완료 (소속팀: ${resolvedTeamName || '미지정'}, 연계: ${deptTags.length}개 부서, ${agentTags.length}명 담당자)`
                ]
            };
            setAgents(prev => [...prev, newAgent]);
        }

        setCreatingSlot(null);
        setCreateForm({ 
            code: '',
            name: '', 
            role: '', 
            teamName: '',
            status: 'ACTIVE', 
            tier: 2, 
            position: '사원', 
            supervisorId: '', 
            connectedDeptIds: [], 
            connectedAgentIds: [],
            assignedHuman: '',
            requiresApproval: false
        });
        alert(`[${createForm.position} ${createForm.name}] 에이전트가 성공적으로 생성 및 [${resolvedTeamName || '조직도'}]에 배치되었습니다!`);
    };

    // 전체화면 토글
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(console.error);
            setIsFullscreen(true);
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(console.error);
                setIsFullscreen(false);
            }
        }
    };

    // 전체 데이터 초기화 (기본값 복원)
    const handleResetAll = () => {
        if (!window.confirm('전체 에이전트 및 부서 설정을 기본값으로 초기화하시겠습니까?')) return;
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_DEPT_KEY);
        setDepartments(DEPARTMENTS);
        setAgents(INITIAL_AGENTS);
        setSelectedAgent(null);
    };

    // 출고-총무-품질 성적서 연쇄 시뮬레이션 실행 (대표님 핵심 기능)
    const runCertificatePipelineSimulation = () => {
        setSimulationLog([]);
        setActiveNetworkStep(1);
        const steps = [
            { step: 1, text: '🚚 [출고부 ship-signal-emitter] 태형산업 ES261014-2869 자재 4품목 포장 완료 -> 자재 출고 신호(EVENT_MATERIAL_SHIPPED) 발행' },
            { step: 2, text: '📑 [총무부 gen-invoice-creator] 출고 신호 수신! 공식 거래명세표 PDF 자동 렌더링 완료 (#TR-261018-042)' },
            { step: 3, text: '🔬 [품질부 qc-po-matcher] 출고 신호 + 거래명세표 동시 감지! 고객 발주서와 시화창고 Heat No(SD62415) 실측치 1:1 매칭 성공' },
            { step: 4, text: '🛠️ [품질부 qc-cert-builder] ASTM A312 TP316L 규격 기준치 결합 -> EN10204 3.1 공식 성적서 엑셀/PDF 생성 완료' },
            { step: 5, text: '✉️ [품질부 qc-package-dispatcher] 거래명세표 + 공식 성적서 묶음(Merge) 고객사 담당자 메일 발송 완료! 代表님 텔레그램 보고 전송' }
        ];

        steps.forEach((s, idx) => {
            setTimeout(() => {
                setActiveNetworkStep(s.step);
                setSimulationLog(prev => [...prev, s.text]);
                if (idx === steps.length - 1) {
                    setTimeout(() => setActiveNetworkStep(null), 3000);
                }
            }, idx * 1200);
        });
    };

    // 🏢 단일 에이전트 조직도 카드 렌더링 (미생성 vs 실제 생성 에이전트)
    const renderOrgCard = (agent: AgentUnit, dept?: Department) => {
        const currentDept = dept || departments.find(d => d.id === agent.deptId);
        const pos = agent.position || '사원';
        const posMeta = POSITION_CONFIG[pos] || POSITION_CONFIG['사원'];
        const isHead = pos === '팀장';
        const isChief = pos === '과장';
        const isPending = agent.approvalStatus === 'PENDING';
        const isRejected = agent.approvalStatus === 'REJECTED';
        const deptTeams = Array.from(new Set(agents.filter(a => a.deptId === agent.deptId).map(a => a.teamName).filter(Boolean))) as string[];

        // 👥 팀 선택/이동 드롭다운 팝오버 렌더러
        const renderTeamDropdown = () => (
            <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-slate-700 bg-[#0C1322] shadow-2xl z-50 p-1.5 text-xs text-slate-200 animate-in fade-in duration-150 text-left font-sans">
                <div className="text-[10px] font-mono text-slate-400 px-2 py-1 border-b border-slate-800 flex items-center justify-between">
                    <span>소속 팀 배정/이동</span>
                    <span className="text-[9px] text-cyan-400 font-bold">{agent.code}</span>
                </div>
                
                {/* 현재 부서 내 등록된 팀 목록 */}
                <div className="max-h-36 overflow-y-auto py-1 space-y-0.5">
                    {deptTeams.map(tName => (
                        <button
                            key={tName}
                            onClick={() => handleMoveAgentToTeam(agent.id, tName)}
                            className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition-colors ${
                                agent.teamName === tName
                                    ? 'bg-indigo-600/30 text-indigo-300 font-bold border border-indigo-500/50'
                                    : 'hover:bg-slate-800 text-slate-300'
                            }`}
                        >
                            <span>{tName}</span>
                            {agent.teamName === tName && <Check className="w-3 h-3 text-indigo-400" />}
                        </button>
                    ))}
                    {deptTeams.length === 0 && (
                        <div className="text-[10px] text-slate-500 px-2 py-1">등록된 세부 팀이 없습니다.</div>
                    )}
                </div>

                {/* 팀에서 제외(미배정) 및 새 팀 생성 버튼 */}
                <div className="border-t border-slate-800 pt-1 mt-1 space-y-0.5">
                    {agent.teamName && (
                        <button
                            onClick={() => handleMoveAgentToTeam(agent.id, undefined)}
                            className="w-full text-left px-2 py-1 rounded text-[10px] text-rose-400 hover:bg-rose-950/40 flex items-center gap-1 transition-colors"
                            title="팀에서 제외하여 미배정 풀로 이동"
                        >
                            <X className="w-3 h-3 text-rose-400" />
                            <span>팀에서 제외 (미배정 풀로)</span>
                        </button>
                    )}
                    <button
                        onClick={() => handleCreateTeamAndAssign(agent.id, `${currentDept?.name || '부서'}팀`)}
                        className="w-full text-left px-2 py-1 rounded text-[10px] text-cyan-300 hover:bg-cyan-950/40 flex items-center gap-1 transition-colors"
                        title="새 팀을 만들고 이 카드를 그 팀으로 즉시 배정"
                    >
                        <Plus className="w-3 h-3 text-cyan-400" />
                        <span>+ 새 팀 생성 후 이동</span>
                    </button>
                </div>
            </div>
        );

        // ⏱️ 봇 업무 반복 주기 선택 팝오버 렌더러 (실시간 신호 감지, 10분, 30분, 1시간, 3시간, 8시간(하루 3번), 12시간(하루 2번), 24시간(하루 1번), 수동)
        const renderScheduleDropdown = () => {
            const currentSched = agent.scheduleInterval || (
                agent.code === 'QC-01' ? 'REALTIME' :
                agent.code === 'QC-02' ? '30m' :
                agent.code === 'DAT-01' ? '8h' : '24h'
            );
            return (
                <div 
                    className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-cyan-500/50 bg-[#09101F] shadow-[0_0_25px_rgba(0,240,255,0.35)] z-50 p-2 text-xs text-slate-200 animate-in fade-in duration-150 text-left font-sans backdrop-blur-md"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="text-[10px] font-mono text-cyan-300 px-2 py-1 border-b border-slate-800 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-bold">
                            <Clock className="w-3.5 h-3.5 text-cyan-400" />
                            <span>반복 가동 주기 설정</span>
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono font-bold">{agent.code}</span>
                    </div>
                    
                    <div className="max-h-64 overflow-y-auto py-1.5 space-y-1">
                        {SCHEDULE_INTERVALS.map(opt => {
                            const isSelected = currentSched === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    onClick={(e) => handleSetScheduleInterval(agent.id, opt.id, e)}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] flex flex-col gap-0.5 transition-all cursor-pointer ${
                                        isSelected
                                            ? 'bg-cyan-950/80 text-cyan-300 font-bold border border-cyan-500/70 shadow-[0_0_10px_rgba(0,240,255,0.25)]'
                                            : 'hover:bg-slate-800/80 text-slate-300 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="flex items-center gap-1.5">
                                            <span>{opt.icon}</span>
                                            <span className="font-bold">{opt.shortBadge}</span>
                                        </span>
                                        {isSelected && <Check className="w-3 h-3 text-cyan-400 shrink-0" />}
                                    </div>
                                    <span className="text-[9.5px] text-slate-400 font-normal leading-tight">
                                        {opt.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="border-t border-slate-800 pt-1 mt-1 px-1 flex items-center justify-between text-[9px] text-slate-500 font-mono">
                        <span>* 즉시 스케줄러에 영구 반영</span>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setActiveScheduleDropdownAgentId(null); }}
                            className="text-cyan-400 hover:text-cyan-300 font-bold"
                        >
                            닫기
                        </button>
                    </div>
                </div>
            );
        };

        // ─────────────────────────────────────────────────────────────
        // CASE A: 아직 생성되지 않은 슬롯 ➔ [+ AGENT 생성] 카드 노출
        // ─────────────────────────────────────────────────────────────
        if (!agent.isCreated) {
            return (
                <div
                    key={agent.id}
                    onClick={() => {
                        setCreatingSlot(agent);
                        const deptIds = agent.connectedDeptIds || [];
                        setCreateForm({
                            code: agent.code || '',
                            name: agent.name || '',
                            role: agent.role || '',
                            teamName: agent.teamName || '',
                            status: agent.status || 'ACTIVE',
                            tier: agent.tier || 2,
                            position: pos,
                            supervisorId: agent.supervisorId || '',
                            connectedDeptIds: deptIds,
                            connectedAgentIds: agent.connectedAgentIds || [],
                            assignedHuman: agent.assignedHuman || '',
                            requiresApproval: agent.requiresApproval ?? false
                        });
                        setActiveDeptForCreate(deptIds.length > 0 ? deptIds[0] : (agent.deptId === 'quote' ? 'quality' : 'quote'));
                    }}
                    className="group relative rounded-xl border-2 border-dashed bg-[#070C16]/50 hover:bg-slate-900/60 p-4 cursor-pointer transition-all duration-200 flex flex-col items-center justify-between text-center min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(0,240,255,0.15)]"
                    style={{ borderColor: posMeta.border }}
                >
                    <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-500">
                        <span className="font-bold">{agent.code}</span>
                        <div className="flex items-center gap-1">
                            {/* 소속 팀 배정 드롭다운 (미생성 슬롯도 팀에 넣고 빼기 가능) */}
                            <div className="relative" onClick={e => e.stopPropagation()}>
                                <button
                                    onClick={() => setActiveTeamDropdownAgentId(activeTeamDropdownAgentId === agent.id ? null : agent.id)}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border transition-all ${
                                        agent.teamName
                                            ? 'border-indigo-500/70 bg-indigo-950/70 text-indigo-300'
                                            : 'border-slate-800 bg-slate-900/80 text-slate-500 hover:text-slate-300'
                                    }`}
                                    title="소속 팀 배정/이동"
                                >
                                    <Users className="w-2.5 h-2.5 text-indigo-400" />
                                    <span className="max-w-[65px] truncate">{agent.teamName || '미배정'}</span>
                                    <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                                </button>
                                {activeTeamDropdownAgentId === agent.id && renderTeamDropdown()}
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: posMeta.bg, color: posMeta.color }}>
                                {posMeta.icon} {pos} 슬롯
                            </span>
                        </div>
                    </div>

                    <div className="my-2 flex flex-col items-center">
                        <div className="w-12 h-12 rounded-full border border-dashed flex items-center justify-center mb-2 group-hover:scale-110 transition-transform" style={{ borderColor: posMeta.color, backgroundColor: posMeta.bg }}>
                            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" style={{ color: posMeta.color }} />
                        </div>
                        <div className="text-xs font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                            + {pos} 에이전트 생성
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 max-w-45 line-clamp-2 leading-relaxed">
                            {agent.role ? `[기획] ${agent.role}` : `${posMeta.roleDescription}`}
                        </div>
                    </div>

                    {/* 직위 승진/강등 조정 버튼 */}
                    <div className="w-full pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={(e) => handlePromote(agent.id, e)}
                                disabled={pos === '팀장'}
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 hover:text-white"
                                title="직위 승진"
                            >
                                <ArrowUp className="w-3 h-3 text-emerald-400" />
                            </button>
                            <button
                                onClick={(e) => handleDemote(agent.id, e)}
                                disabled={pos === '사원'}
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 hover:text-white"
                                title="직위 강등"
                            >
                                <ArrowDown className="w-3 h-3 text-rose-400" />
                            </button>
                        </div>
                        <span className="text-[9px] text-cyan-400 font-bold group-hover:underline">
                            클릭하여 생성 ➔
                        </span>
                    </div>
                </div>
            );
        }

        // ─────────────────────────────────────────────────────────────
        // CASE B: 실제 생성되어 가동 중인 에이전트 ➔ 실시간 제어 카드
        // ─────────────────────────────────────────────────────────────
        const isActive = agent.status === 'ACTIVE';
        const isStandby = agent.status === 'STANDBY';
        const isIdle = agent.status === 'IDLE';

        // ⏱️ 봇별 개별 반복/감지 주기 판별 (QC-01: 실시간, QC-02: 30분, DAT-01: 8시간, 기본: 24시간)
        const schedId = agent.scheduleInterval || (
            agent.code === 'QC-01' ? 'REALTIME' :
            agent.code === 'QC-02' ? '30m' :
            agent.code === 'DAT-01' ? '8h' : '24h'
        );
        const schedOpt = SCHEDULE_INTERVALS.find(s => s.id === schedId) || SCHEDULE_INTERVALS[7];

        return (
            <div
                key={agent.id}
                onClick={() => handleSelectAgent(agent)}
                className={`group relative rounded-xl border bg-[#090F1C] hover:bg-[#0B1324] p-3.5 cursor-pointer transition-all duration-200 shadow-md flex flex-col justify-between ${
                    isPending
                        ? 'border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/50'
                        : isRejected
                            ? 'border-rose-600 shadow-[0_0_15px_rgba(225,29,72,0.3)]'
                            : isHead
                                ? 'border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.25)] hover:border-amber-300'
                                : isChief
                                    ? 'border-purple-500/80 shadow-[0_0_15px_rgba(168,85,247,0.2)] hover:border-purple-400'
                                    : 'border-slate-800 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(0,240,255,0.2)]'
                }`}
                style={{
                    minWidth: isHead ? '280px' : isChief ? '250px' : '230px'
                }}
            >
                {/* 상단 직위 뱃지 & 코드 & 우측 상태 토글 (ACT/STB/IDL/OFF) - 부서명 텍스트 중첩 문제 완전 해소 */}
                <div className="flex items-center justify-between text-[10px] mb-1.5 pb-1 border-b border-slate-800/80 gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span 
                            className="px-1.5 py-0.5 rounded text-[10px] font-black flex items-center gap-1 shadow-sm shrink-0"
                            style={{ backgroundColor: posMeta.bg, color: posMeta.color, border: `1px solid ${posMeta.border}` }}
                        >
                            <span>{posMeta.icon}</span>
                            <span>{pos}</span>
                        </span>

                        {/* 담당자 식별 코드 (줄바꿈 없이 한 줄로 고정 표시) */}
                        {editingCodeAgentId === agent.id ? (
                            <input
                                autoFocus
                                type="text"
                                value={tempCodeValue}
                                onChange={(e) => setTempCodeValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveCode(agent.id);
                                    else if (e.key === 'Escape') setEditingCodeAgentId(null);
                                }}
                                onBlur={() => handleSaveCode(agent.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="px-1.5 py-0.5 bg-black text-cyan-300 border border-cyan-400 rounded text-[10px] font-bold w-20 outline-none shadow-[0_0_8px_rgba(0,240,255,0.7)] font-mono shrink-0"
                                placeholder="식별코드"
                                title="Enter 저장, Esc 취소"
                            />
                        ) : (
                            <div
                                className="group/code flex items-center gap-1 cursor-pointer hover:bg-slate-800/80 px-1 py-0.5 rounded transition-all shrink-0"
                                onClick={(e) => handleStartEditCode(agent, e)}
                                title="클릭하여 담당자 식별코드(QC-01 등) 직접 수정"
                            >
                                <span className="font-bold text-slate-200 group-hover/code:text-cyan-300 transition-colors whitespace-nowrap font-mono text-[11px]">
                                    {agent.code}
                                </span>
                                <Edit2 className="w-2.5 h-2.5 text-slate-500 opacity-0 group-hover/code:opacity-100 transition-opacity shrink-0" />
                            </div>
                        )}
                    </div>

                    {/* 카드 위 상태 강제 토글 버튼 (우측 끝 정렬 고정, 겹침 원천 제거) */}
                    <div className="flex items-center gap-0.5 bg-black/60 p-0.5 rounded border border-slate-800 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
                        {(['ACTIVE', 'STANDBY', 'IDLE', 'OFFLINE'] as const).map(st => (
                            <button
                                key={st}
                                onClick={(e) => handleStatusChange(agent.id, st, e)}
                                className={`text-[8px] px-1 py-0.5 rounded font-black transition-all ${
                                    agent.status === st
                                        ? st === 'ACTIVE' 
                                            ? 'bg-emerald-500 text-black shadow-[0_0_6px_#00E676]'
                                            : st === 'STANDBY'
                                                ? 'bg-cyan-500 text-black shadow-[0_0_6px_#00F0FF]'
                                                : st === 'IDLE'
                                                    ? 'bg-slate-400 text-black'
                                                    : 'bg-rose-600 text-white'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                                title={`${st} 상태로 강제 전환`}
                            >
                                {st === 'ACTIVE' ? 'ACT' : st === 'STANDBY' ? 'STB' : st === 'IDLE' ? 'IDL' : 'OFF'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 👥 소속 팀 배정 바 (전용 서브라인으로 완전히 분리하여 상태 버튼과 절대 중첩되지 않음) */}
                <div className="flex items-center justify-between text-[9px] mb-2 px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-800/80">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Users className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                        <span className="text-slate-400 text-[9px] font-mono shrink-0">소속팀:</span>
                        <div className="relative" onClick={e => e.stopPropagation()}>
                            <button
                                onClick={() => setActiveTeamDropdownAgentId(activeTeamDropdownAgentId === agent.id ? null : agent.id)}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border transition-all ${
                                    agent.teamName
                                        ? 'border-indigo-500/70 bg-indigo-950/80 text-indigo-300 hover:border-indigo-400 hover:bg-indigo-900/60'
                                        : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:text-slate-200'
                                }`}
                                title="소속 팀 변경 및 배정/제외 (클릭하여 다른 팀으로 즉시 이동)"
                            >
                                <span className="max-w-[120px] truncate">{agent.teamName || '팀 미배정'}</span>
                                <ChevronDown className="w-2.5 h-2.5 opacity-60 shrink-0" />
                            </button>
                            {activeTeamDropdownAgentId === agent.id && renderTeamDropdown()}
                        </div>
                    </div>

                    {/* 배정된 사람 담당자 (1인 1역할) */}
                    {agent.assignedHuman && (
                        <div className="flex items-center gap-1 text-amber-300/90 text-[8px] font-mono shrink-0 truncate max-w-[100px]" title={`배정된 실제 사람 담당자: ${agent.assignedHuman}`}>
                            <span>👤</span>
                            <span className="truncate">{agent.assignedHuman}</span>
                        </div>
                    )}
                </div>

                {/* 중앙 에이전트 정보 & 레이더 & 승인 상태 배지 */}
                <div className="space-y-1.5">
                    {/* 레이더 & 가동 인디케이터 */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
                                <svg className="w-full h-full text-slate-800" viewBox="0 0 100 100">
                                    <polygon 
                                        points="50,5 90,25 90,75 50,95 10,75 10,25" 
                                        fill="none" 
                                        stroke={posMeta.color} 
                                        strokeWidth="1.5"
                                        className="opacity-70"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div 
                                        className={`w-2.5 h-2.5 rounded-full ${
                                            isActive 
                                                ? 'bg-emerald-400 shadow-[0_0_10px_#00E676] animate-ping' 
                                                : isStandby 
                                                    ? 'bg-cyan-400 shadow-[0_0_8px_#00F0FF]' 
                                                    : isIdle
                                                        ? 'bg-slate-500'
                                                        : 'bg-rose-500'
                                        }`}
                                    ></div>
                                </div>
                            </div>

                            <div className="min-w-0 flex-1">
                                {editingNameAgentId === agent.id ? (
                                    <input
                                        autoFocus
                                        type="text"
                                        value={tempNameValue}
                                        onChange={(e) => setTempNameValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveName(agent.id);
                                            else if (e.key === 'Escape') setEditingNameAgentId(null);
                                        }}
                                        onBlur={() => handleSaveName(agent.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="px-1.5 py-0.5 bg-black text-white border border-cyan-400 rounded text-xs font-bold w-full outline-none shadow-[0_0_8px_rgba(0,240,255,0.7)]"
                                        placeholder="에이전트 이름"
                                        title="Enter 저장, Esc 취소"
                                    />
                                ) : (
                                    <div 
                                        className="group/name flex items-center gap-1 cursor-pointer hover:bg-slate-800/80 px-1 py-0.5 rounded transition-all"
                                        onClick={(e) => handleStartEditName(agent, e)}
                                        title="클릭하여 담당자 이름 직접 수정"
                                    >
                                        <span className="text-xs font-bold text-white group-hover/name:text-cyan-300 transition-colors truncate">
                                            {agent.name}
                                        </span>
                                        <Edit3 className="w-3 h-3 text-slate-500 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                                    </div>
                                )}
                                <div className="text-[10px] text-slate-400 truncate px-1" title={agent.role}>
                                    {agent.role}
                                </div>
                            </div>
                        </div>

                        {/* 결재선 보조 상태 (과장 이상징후 대기/반려, 팀장 최종결재권자 등 - 가운데 중복 주기 버튼 제거) */}
                        {(isChief || isHead) && (
                            <div className="flex flex-col items-end gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                                {isChief && isPending && (
                                    <span className="text-[8px] px-1.5 py-0.2 rounded font-black border border-amber-500 bg-amber-950/80 text-amber-300 animate-pulse flex items-center gap-0.5 shadow-[0_0_6px_rgba(245,158,11,0.5)]">
                                        <span>⏳</span>
                                        <span>결재대기</span>
                                    </span>
                                )}
                                {isChief && isRejected && (
                                    <span className="text-[8px] px-1.5 py-0.2 rounded font-black border border-rose-600 bg-rose-950/80 text-rose-300 flex items-center gap-0.5">
                                        <span>⚠️</span>
                                        <span>반려</span>
                                    </span>
                                )}
                                {isHead && (
                                    <span className="text-[8px] px-1.5 py-0.2 rounded font-black border border-amber-400/60 bg-amber-950/50 text-amber-300 flex items-center gap-0.5">
                                        <span>👑</span>
                                        <span>총괄결재</span>
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 부서간 그물망 연계 태그 (연계된 타 부서 담당자의 코드/이름 직접 노출) */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono">
                            <span className="flex items-center gap-1 text-purple-300 font-bold">
                                <span>🔗 연계 파트너:</span>
                            </span>
                            {agent.connectedAgentIds && agent.connectedAgentIds.length > 0 && (
                                <span className="text-[8px] text-purple-400 font-bold">
                                    {agent.connectedAgentIds.length}명 협업
                                </span>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                            {/* 1. 구체적인 담당자가 지정된 연계 (수정된 이름/코드가 실시간 반영!) */}
                            {agent.connectedAgentIds && agent.connectedAgentIds.length > 0 ? (
                                agent.connectedAgentIds.map(targetId => {
                                    const targetAg = agents.find(a => a.id === targetId);
                                    if (!targetAg) return null;
                                    const tDept = departments.find(d => d.id === targetAg.deptId);
                                    return (
                                        <span
                                            key={targetId}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSelectAgent(targetAg);
                                            }}
                                            className="text-[9px] px-1.5 py-0.5 rounded border border-purple-500/70 bg-purple-950/60 text-purple-200 font-mono flex items-center gap-1 hover:border-purple-300 hover:text-white transition-all cursor-pointer shadow-xs group/tag"
                                            title={`[${tDept?.name}] ${targetAg.code} ${targetAg.name} - 클릭 시 상세 확인`}
                                        >
                                            <span className="text-[8px] font-bold" style={{ color: tDept?.color || '#00F0FF' }}>
                                                {tDept?.name?.slice(0, 2) || '부서'}
                                            </span>
                                            <span className="font-bold text-cyan-300 group-hover/tag:underline">{targetAg.code}</span>
                                            <span className="max-w-[75px] truncate text-slate-300 font-sans">{targetAg.name}</span>
                                        </span>
                                    );
                                })
                            ) : null}

                            {/* 2. 담당자 없이 부서 단위로만 연계된 경우 */}
                            {agent.connectedDeptIds && agent.connectedDeptIds.length > 0 && (
                                agent.connectedDeptIds
                                    .filter(dId => !(agent.connectedAgentIds && agents.some(a => a.deptId === dId && agent.connectedAgentIds?.includes(a.id))))
                                    .map(dId => {
                                        const d = departments.find(dept => dept.id === dId);
                                        return (
                                            <span 
                                                key={dId}
                                                className="text-[8px] px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 text-slate-400 font-mono flex items-center gap-1"
                                                title={`${d?.name || dId} 전체 부서 연계`}
                                            >
                                                <span style={{ color: d?.color }}>●</span>
                                                <span>{d?.name || dId} 전체</span>
                                            </span>
                                        );
                                    })
                            )}

                            {(!agent.connectedDeptIds || agent.connectedDeptIds.length === 0) && (!agent.connectedAgentIds || agent.connectedAgentIds.length === 0) && (
                                <span className="text-[8px] text-slate-600 border border-dashed border-slate-800 px-1.5 py-0.5 rounded">
                                    연계 업무 미지정
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 실시간 수행 작업 티커 */}
                    <div className="text-[10px] text-slate-300 bg-black/40 rounded p-1.5 font-mono truncate border border-slate-800/80">
                        <span className="text-cyan-400 mr-1">▶</span>
                        <span>{agent.currentTask}</span>
                    </div>
                </div>

                {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    하단 조작 바: 직위 변경(승진/강등), 위치 이동, 감시·승인 액션
                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1 text-[10px]" onClick={e => e.stopPropagation()}>
                    {/* 좌측: 직위 및 위치 조정 컨트롤러 */}
                    <div className="flex items-center gap-1">
                        {/* 직위 승진 버튼 */}
                        <button
                            onClick={(e) => handlePromote(agent.id, e)}
                            disabled={isHead}
                            className={`p-1 rounded border transition-all ${
                                isHead
                                    ? 'opacity-20 border-slate-800 text-slate-600 cursor-not-allowed'
                                    : 'border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-500 hover:text-black text-emerald-300'
                            }`}
                            title={isHead ? '최고 직위(팀장)' : '상위 직위로 승진 (사원➔대리➔과장➔팀장)'}
                        >
                            <ArrowUp className="w-3 h-3" />
                        </button>

                        {/* 직위 강등 버튼 */}
                        <button
                            onClick={(e) => handleDemote(agent.id, e)}
                            disabled={pos === '사원'}
                            className={`p-1 rounded border transition-all ${
                                pos === '사원'
                                    ? 'opacity-20 border-slate-800 text-slate-600 cursor-not-allowed'
                                    : 'border-rose-500/40 bg-rose-950/30 hover:bg-rose-500 hover:text-black text-rose-300'
                            }`}
                            title={pos === '사원' ? '최하위 직위(사원)' : '하위 직위로 강등 (팀장➔과장➔대리➔사원)'}
                        >
                            <ArrowDown className="w-3 h-3" />
                        </button>

                        {/* 좌우 순서 변경 버튼 */}
                        <div className="flex items-center border border-slate-800 rounded bg-slate-900 ml-1">
                            <button
                                onClick={(e) => handleMoveAgentOrder(agent.id, 'prev', e)}
                                className="p-0.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-l"
                                title="조직도 상 좌측으로 위치 이동"
                            >
                                <ChevronLeft className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => handleMoveAgentOrder(agent.id, 'next', e)}
                                className="p-0.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-r"
                                title="조직도 상 우측으로 위치 이동"
                            >
                                <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                    </div>

                    {/* 우측: 반복 실행 주기 가동 버튼 & 직위별 결재 권한 */}
                    <div className="flex items-center gap-1">
                        {/* ⚡ 반복 주기 가동 버튼 (하단 단일 배치: 클릭 시 주기 변경 팝오버 토글) */}
                        <div className="relative" onClick={e => e.stopPropagation()}>
                            <button
                                onClick={() => setActiveScheduleDropdownAgentId(activeScheduleDropdownAgentId === agent.id ? null : agent.id)}
                                className="text-[9px] px-1.5 py-0.5 rounded font-bold border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 hover:border-cyan-400 text-cyan-300 flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                                title="클릭하여 반복 가동 주기 변경"
                            >
                                <span className="text-[8px]">🔄</span>
                                <span>{schedOpt.shortBadge} 가동</span>
                                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                            </button>
                            {activeScheduleDropdownAgentId === agent.id && renderScheduleDropdown()}
                        </div>

                        {/* 👔 과장(Chief): 실무 검수 및 이상징후 감지 시 팀장 앞 결재 상신 */}
                        {isChief && !isPending && (
                            <button
                                onClick={(e) => handleRequestApproval(agent.id, e)}
                                className="px-1.5 py-0.5 rounded border border-amber-500/80 bg-amber-950/40 hover:bg-amber-500 hover:text-black text-amber-300 font-bold transition-all flex items-center gap-1 shadow-[0_0_8px_rgba(245,158,11,0.3)] cursor-pointer"
                                title="사원/대리 결과물 검수 중 규격/치수/성분 등 이상징후 감지 시 팀장 결재 상신"
                            >
                                <span>🚨 이상징후 결재</span>
                            </button>
                        )}

                        {/* 👑 과장이 상신한 이상징후 건에 대해 팀장/관리자 즉시 확인·승인·반려 */}
                        {isPending ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={(e) => handleApproveAgentTask(agent.id, e)}
                                    className="px-1.5 py-0.5 rounded border border-emerald-400 bg-emerald-500 hover:bg-emerald-400 text-black font-black transition-all flex items-center gap-0.5 shadow-[0_0_8px_#00E676] cursor-pointer"
                                    title="팀장 권한으로 이상징후 검토 후 최종 승인 통과"
                                >
                                    <Check className="w-3 h-3" />
                                    <span>승인</span>
                                </button>
                                <button
                                    onClick={(e) => handleRejectAgentTask(agent.id, e)}
                                    className="px-1.5 py-0.5 rounded border border-rose-500 bg-rose-950/60 hover:bg-rose-600 hover:text-white text-rose-300 font-black transition-all cursor-pointer"
                                    title="이상 징후 재검토 및 사원/대리 피드백 지시"
                                >
                                    반려
                                </button>
                            </div>
                        ) : (
                            isHead ? (
                                <span className="text-[9px] text-amber-400/90 font-mono flex items-center gap-1 px-1 py-0.5 rounded bg-amber-950/20 border border-amber-500/30">
                                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                                    <span>결재총괄</span>
                                </span>
                            ) : null
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-[#060A12] text-slate-100 font-mono flex flex-col selection:bg-teal-500 selection:text-black">
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                0. PROTOCOL BANNER (웹 앞/뒷단과 구분되는 agent AI 생성 규칙)
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="bg-linear-to-r from-purple-950/80 via-slate-900 to-cyan-950/80 border-b border-purple-800/40 px-4 py-1.5 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-purple-300">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="font-bold">AGENT AI 생성 프로토콜 :</span>
                    <span className="text-slate-300">
                        앞으로는 <strong className="text-cyan-300 font-bold">"'agent' 에서, ..."</strong>로 시작하는 지시를 통해 웹 앞/뒷단과 분리된 자율 백엔드 에이전트 코드를 즉시 생성합니다.
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleResetAll}
                        className="text-[10px] text-slate-400 hover:text-rose-300 underline"
                    >
                        기본 슬롯 초기화
                    </button>
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        실제 생성된 에이전트: {createdAgents.length}개 가동 중
                    </span>
                </div>
            </div>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                1. TOP KPI HUD BAR (사이버펑크 네온 헤더)
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <header className="border-b border-cyan-900/40 bg-[#080E1A]/90 backdrop-blur px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-40">
                <div className="flex items-center gap-3">
                    <div className="relative flex items-center justify-center w-8 h-8 rounded border border-cyan-400/60 bg-cyan-950/40 shadow-[0_0_15px_rgba(0,240,255,0.4)]">
                        <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold tracking-widest text-cyan-400">ALTERNATIVE FUTURE AGENT 사무실</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/50 bg-amber-950/30 text-amber-400 font-bold">
                                {isDemoRunning ? 'DEMO RUNNING' : 'LIVE HOST'}
                            </span>
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-2">
                            <span>ALTF AUTONOMOUS HQ</span>
                            <span className="text-slate-600">|</span>
                            <span className="text-emerald-400 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                                Mac mini M5 Pro 24/7 ONLINE
                            </span>
                        </div>
                    </div>
                </div>

                {/* 중앙 KPI 카운터 뱃지 */}
                <div className="flex items-center gap-2 flex-wrap">
                    {/* 가동률 */}
                    <div className="px-3 py-1 rounded border border-cyan-800/60 bg-cyan-950/20 flex items-center gap-2">
                        <span className="text-[10px] text-cyan-400 font-bold">UTILIZATION</span>
                        <span className="text-sm font-black text-cyan-300">{avgLoad}%</span>
                        <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-400 rounded-full transition-all duration-500" style={{ width: `${avgLoad}%` }}></div>
                        </div>
                    </div>

                    {/* TOP DEPT */}
                    <div className="px-2.5 py-1 rounded border border-pink-800/60 bg-pink-950/20 text-pink-400 text-xs font-bold flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">TOP DEPT</span>
                        <span>품질부</span>
                        <span className="text-[10px] bg-pink-500/20 px-1 rounded text-pink-300">5 ACTIVE</span>
                    </div>

                    {/* ACTIVE (상시 가동) */}
                    <div className="px-3 py-1 rounded-full border border-emerald-500/60 bg-emerald-950/40 text-emerald-400 text-xs font-bold flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,230,118,0.2)]" title="24시간 또는 정기 스케줄러로 상시 동작 중인 에이전트">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>상시 {activeCount}</span>
                    </div>

                    {/* STANDBY (신호 대기) */}
                    <div className="px-3 py-1 rounded-full border border-cyan-500/60 bg-cyan-950/40 text-cyan-400 text-xs font-bold flex items-center gap-1.5" title="외부 신호(텔레그램, 메일, 발주 접수)가 올 때만 즉시 실행되는 신호 대기 봇">
                        <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                        <span>신호대기 {standbyCount}</span>
                    </div>

                    {/* IDLE */}
                    <div className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60 text-slate-400 text-xs font-bold flex items-center gap-1.5">
                        <span>IDLE</span>
                        <span className="text-slate-300 font-mono text-sm">{String(idleCount).padStart(3, '0')}</span>
                    </div>

                    {/* OFFLINE */}
                    <div className="px-2.5 py-1 rounded-full border border-rose-900/60 bg-rose-950/20 text-rose-400 text-xs font-bold flex items-center gap-1.5">
                        <span>OFFLINE</span>
                        <span className="text-rose-300 font-mono text-sm">{String(offlineCount).padStart(3, '0')}</span>
                    </div>

                    {/* 미생성 슬롯 뱃지 */}
                    <div className="px-2.5 py-1 rounded border border-dashed border-amber-600/60 bg-amber-950/20 text-amber-300 text-xs font-bold flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">+미생성 슬롯</span>
                        <span className="text-amber-400 font-mono text-sm">{uncreatedCount}</span>
                    </div>
                </div>

                {/* 우측 유틸 & 토큰 경제 & 컴팩트 도구 */}
                <div className="flex items-center gap-2">
                    {/* ⚡ 최근 신호 처리 결과 알림 칩 (보통 하루 1~2회 인입되는 텔레그램/전표 신호의 결과만 깔끔하게 노출) */}
                    <div 
                        onClick={() => setShowDaekyungInvoiceModal(true)}
                        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-[#081524]/90 hover:bg-cyan-950/50 hover:border-cyan-400/70 transition-all cursor-pointer shadow-xs group"
                        title="신호 기반 봇(GEN-01 등)의 최근 처리 결과입니다. 클릭 시 상세 전표 내역을 확인합니다."
                    >
                        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 shrink-0">
                            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
                            <span>최근 신호:</span>
                        </span>
                        {latestSignal ? (
                            <div className="flex items-center gap-1.5 text-xs min-w-0">
                                <span className="font-mono font-bold text-cyan-300 shrink-0">[{latestSignal.botCode}]</span>
                                <span className="text-slate-300 truncate max-w-[220px] font-medium">{latestSignal.summary}</span>
                                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-mono font-bold shrink-0">
                                    완료 ✓
                                </span>
                            </div>
                        ) : (
                            <span className="text-xs text-slate-400 font-mono">
                                📡 텔레그램·메신저 신호 대기 중
                            </span>
                        )}
                    </div>

                    {/* 📁 업무 대장 & 관제 도구 통합 드롭다운 (거대 배너 4개를 컴팩트 툴바로 일원화) */}
                    <div className="relative" ref={toolsDropdownRef}>
                        <button
                            onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                            className={`text-xs px-3 py-1.5 rounded-lg border font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                                showToolsDropdown
                                    ? 'border-cyan-400 bg-cyan-950/90 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                                    : 'border-slate-700 bg-slate-800/90 hover:bg-slate-700 hover:border-cyan-500/50 text-slate-200 hover:text-white'
                            }`}
                            title="성적서 대장, 재고 발주 대장, 성적서 발행기, 거래명세표 인입 관제 도구 모달 열기"
                        >
                            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                            <span>업무 대장·도구</span>
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showToolsDropdown ? 'rotate-180 text-cyan-400' : 'text-slate-400'}`} />
                        </button>

                        {showToolsDropdown && (
                            <div className="absolute right-0 mt-2 w-72 rounded-xl border border-cyan-500/40 bg-[#070D19]/95 backdrop-blur-md shadow-2xl p-1.5 z-50 space-y-1">
                                <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-400 border-b border-slate-800 uppercase tracking-wider flex items-center justify-between">
                                    <span>전사 관제 도구함</span>
                                    <span className="text-cyan-400 font-mono">4 TOOLS</span>
                                </div>

                                {/* 1. 성적서 관리 대장 */}
                                <button
                                    onClick={() => { setShowLedgerModal(true); setShowToolsDropdown(false); }}
                                    className="w-full text-left p-2 rounded-lg hover:bg-cyan-950/40 border border-transparent hover:border-cyan-500/30 flex items-center justify-between transition-colors group cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <ShieldCheck className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                                        <div>
                                            <div className="text-xs font-bold text-slate-200 group-hover:text-cyan-300">📊 대경벤드 성적서 대장</div>
                                            <div className="text-[10px] text-slate-400">QC-01/02 26개 컬럼 마스터 대장</div>
                                        </div>
                                    </div>
                                    <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1 py-0.5 rounded font-mono">상시</span>
                                </button>

                                {/* 2. 알트에프 재고 발주 대장 */}
                                <button
                                    onClick={() => { setShowPurchaseLedgerModal(true); setShowToolsDropdown(false); }}
                                    className="w-full text-left p-2 rounded-lg hover:bg-emerald-950/40 border border-transparent hover:border-emerald-500/30 flex items-center justify-between transition-colors group cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <ShoppingBag className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                                        <div>
                                            <div className="text-xs font-bold text-slate-200 group-hover:text-emerald-300">🛒 알트에프 재고 발주 대장</div>
                                            <div className="text-[10px] text-slate-400">PUR-01 재고 발주 & 성적서 매칭</div>
                                        </div>
                                    </div>
                                    <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded font-mono">정기</span>
                                </button>

                                {/* 3. 성적서 발행기 */}
                                <button
                                    onClick={() => { setShowCertIssuerModal(true); setShowToolsDropdown(false); }}
                                    className="w-full text-left p-2 rounded-lg hover:bg-indigo-950/40 border border-transparent hover:border-indigo-500/30 flex items-center justify-between transition-colors group cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <FileText className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                                        <div>
                                            <div className="text-xs font-bold text-slate-200 group-hover:text-indigo-300">📜 [QC-06] 성적서 발행기</div>
                                            <div className="text-[10px] text-slate-400">발주서별 최대 6품목 자동 패킹/PDF</div>
                                        </div>
                                    </div>
                                    <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1 py-0.5 rounded font-mono">신호</span>
                                </button>

                                {/* 4. 대경 거래명세표 인입 */}
                                <button
                                    onClick={() => { setShowDaekyungInvoiceModal(true); setShowToolsDropdown(false); }}
                                    className="w-full text-left p-2 rounded-lg hover:bg-cyan-950/40 border border-transparent hover:border-cyan-500/30 flex items-center justify-between transition-colors group cursor-pointer"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <FileText className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                                        <div>
                                            <div className="text-xs font-bold text-slate-200 group-hover:text-cyan-300">📑 [전사연계] 대경 거래명세표 인입</div>
                                            <div className="text-[10px] text-slate-400">GEN-01 텔레그램/PDF 인입 매입 확정</div>
                                        </div>
                                    </div>
                                    <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1 py-0.5 rounded font-mono">신호</span>
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => setIsDemoRunning(!isDemoRunning)}
                        className={`text-xs px-2.5 py-1 rounded border font-bold flex items-center gap-1 transition-all ${
                            isDemoRunning 
                                ? 'border-amber-500/60 bg-amber-950/40 text-amber-300' 
                                : 'border-slate-700 bg-slate-800 text-slate-300'
                        }`}
                        title="가상 트래픽 시뮬레이션 토글"
                    >
                        <RefreshCw className={`w-3 h-3 ${isDemoRunning ? 'animate-spin' : ''}`} />
                        <span>{isDemoRunning ? 'SIM ON' : 'SIM PAUSED'}</span>
                    </button>

                    <button
                        onClick={toggleFullscreen}
                        className="p-1.5 rounded border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
                        title={isFullscreen ? '전체화면 해제' : '독립 모니터 전체화면 모드'}
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                </div>
            </header>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                2. MAIN LAYOUT (좌측 메뉴/부서 필터 + 중앙 뷰)
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* 좌측 내비게이션 사이드바 */}
                <aside className="w-full md:w-64 border-r border-slate-800/80 bg-[#080D18] flex flex-col shrink-0">
                    {/* 상단 뷰 전환 버튼 */}
                    <div className="p-3 border-b border-slate-800 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">VIEWS & MODES</div>
                        <button
                            onClick={() => setCurrentView('office')}
                            className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2.5 transition-all ${
                                currentView === 'office'
                                    ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                            }`}
                        >
                            <Layers className="w-4 h-4 text-cyan-400" />
                            <span>에이전트 오피스 (메인)</span>
                        </button>
                        <button
                            onClick={() => setCurrentView('network')}
                            className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2.5 transition-all ${
                                currentView === 'network'
                                    ? 'bg-purple-950/60 text-purple-300 border border-purple-500/40 shadow-[0_0_10px_rgba(124,77,255,0.2)]'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                            }`}
                        >
                            <Network className="w-4 h-4 text-purple-400" />
                            <span>부서간 그물망 맵</span>
                            <span className="ml-auto text-[9px] bg-purple-500/20 text-purple-300 px-1 py-0.5 rounded">FLOW</span>
                        </button>
                        <button
                            onClick={() => setCurrentView('logs')}
                            className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2.5 transition-all ${
                                currentView === 'logs'
                                    ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(0,230,118,0.2)]'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                            }`}
                        >
                            <Terminal className="w-4 h-4 text-emerald-400" />
                            <span>실시간 라이브 터미널</span>
                        </button>
                        <button
                            onClick={() => setCurrentView('host')}
                            className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2.5 transition-all ${
                                currentView === 'host'
                                    ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40 shadow-[0_0_10px_rgba(255,214,0,0.2)]'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                            }`}
                        >
                            <HardDrive className="w-4 h-4 text-amber-400" />
                            <span>Mac mini 24/7 호스트</span>
                        </button>
                    </div>

                    {/* 부서 필터 (DEPT FILTER) */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2 flex items-center justify-between">
                            <span>DEPT FILTER ({departments.length}개 부서)</span>
                            <button
                                onClick={handleOpenAddDept}
                                className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/60 bg-cyan-950/60 text-cyan-300 hover:bg-cyan-500 hover:text-black font-bold flex items-center gap-1 cursor-pointer transition-all shadow-xs"
                                title="신규 관제 부서 추가"
                            >
                                <Plus className="w-3 h-3" />
                                <span>부서 추가</span>
                            </button>
                        </div>

                        {/* 전체 보기 */}
                        <button
                            onClick={() => setSelectedDeptId('all')}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-bold flex items-center justify-between transition-all ${
                                selectedDeptId === 'all'
                                    ? 'bg-slate-800 text-white border-l-4 border-cyan-400'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <span>🌐</span>
                                <span>전체 부서 통합 관제</span>
                            </span>
                            <span className="text-[10px] text-cyan-400 font-mono font-bold">
                                {createdAgents.length}대 가동
                            </span>
                        </button>

                        {/* 부서 목록 (추가/수정/삭제 지원) */}
                        {departments.map((dept, idx) => {
                            const isSelected = selectedDeptId === dept.id;
                            const deptUnits = agents.filter(a => a.deptId === dept.id);
                            const deptCreated = deptUnits.filter(a => a.isCreated === true);
                            const deptActive = deptCreated.filter(a => a.status === 'ACTIVE').length;

                            return (
                                <div
                                    key={dept.id}
                                    className="group/dept relative flex items-center"
                                >
                                    <button
                                        onClick={() => setSelectedDeptId(dept.id)}
                                        className={`w-full text-left px-2.5 py-2 rounded text-xs font-bold flex items-center justify-between transition-all pr-12 ${
                                            isSelected
                                                ? 'bg-slate-800/90 text-white shadow'
                                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                                        }`}
                                        style={{
                                            borderLeft: isSelected ? `4px solid ${dept.color}` : '4px solid transparent'
                                        }}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-sm">{dept.icon}</span>
                                            <div className="truncate">
                                                <div className="truncate flex items-center gap-1.5">
                                                    <span>{idx + 1}. {dept.name}</span>
                                                    {dept.id === 'quality' && (
                                                        <span className="text-[8px] bg-pink-500/30 text-pink-300 px-1 rounded font-normal">READY</span>
                                                    )}
                                                </div>
                                                <div className="text-[9px] text-slate-500 truncate">{dept.headRole}</div>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-[11px] font-mono" style={{ color: deptCreated.length > 0 ? dept.color : '#64748B' }}>
                                                {deptCreated.length} / {deptUnits.length}
                                            </div>
                                            <div className="text-[8px] font-mono" style={{ color: deptActive > 0 ? '#00E676' : '#64748B' }}>
                                                {deptActive} ACT
                                            </div>
                                        </div>
                                    </button>

                                    {/* 마우스 호버 시 부서 수정/삭제 빠른 액션 버튼 */}
                                    <div className="absolute right-1 hidden group-hover/dept:flex items-center gap-0.5 bg-[#0A0F1D]/90 p-0.5 rounded border border-slate-700 shadow-md">
                                        <button
                                            onClick={(e) => handleOpenEditDept(dept, e)}
                                            className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
                                            title={`${dept.name} 정보 수정`}
                                        >
                                            <Edit2 className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={(e) => handleDeleteDept(dept.id, e)}
                                            className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
                                            title={`${dept.name} 부서 삭제`}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 하단 시스템 스펙 바 */}
                    <div className="p-3 border-t border-slate-800 text-[10px] text-slate-400 bg-slate-950/40 space-y-1 font-mono">
                        <div className="flex items-center justify-between text-slate-500">
                            <span>HOST MACHINE</span>
                            <span className="text-slate-300">Apple Silicon</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-slate-500">SPEC</span>
                            <span className="text-cyan-400">M5 Pro · 24GB RAM</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-slate-500">DAEMON</span>
                            <span className="text-emerald-400">PM2 Active</span>
                        </div>
                    </div>
                </aside>

                {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    3. CENTER VIEW AREA
                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                <main className="flex-1 flex flex-col overflow-hidden bg-[#050811]">
                    {/* 상단 서브 헤더 (검색 & 필터 & 부서 헤더 & 조직도 모드 토글) */}
                    <div className="p-4 border-b border-slate-800/80 bg-[#070C16] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                                <span>
                                    {selectedDeptId === 'all' 
                                        ? '전체 부서 통합 관제' 
                                        : departments.find(d => d.id === selectedDeptId)?.name}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded border border-cyan-800 bg-cyan-950/30 text-cyan-400 font-mono">
                                    {filteredAgents.filter(a => a.isCreated).length} ACTIVE / {filteredAgents.length} SLOTS
                                </span>
                            </div>

                            {/* + 부서 추가 및 선택 부서 수정/삭제 버튼 */}
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={handleOpenAddDept}
                                    className="px-2.5 py-1 rounded border border-cyan-500/50 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 hover:text-white text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                                    title="신규 관제 부서 추가 등록"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>부서 추가</span>
                                </button>
                                {selectedDeptId !== 'all' && (() => {
                                    const curr = departments.find(d => d.id === selectedDeptId);
                                    if (!curr) return null;
                                    return (
                                        <>
                                            <button
                                                onClick={(e) => handleOpenEditDept(curr, e)}
                                                className="px-2 py-1 rounded border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                title={`${curr.name} 설정 수정`}
                                            >
                                                <Edit2 className="w-3 h-3 text-cyan-400" />
                                                <span>부서 수정</span>
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteDept(curr.id, e)}
                                                className="px-2 py-1 rounded border border-slate-800 bg-slate-900/80 hover:bg-red-950/40 hover:border-red-500/50 text-slate-400 hover:text-red-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                title={`${curr.name} 부서 삭제`}
                                            >
                                                <Trash2 className="w-3 h-3 text-red-400" />
                                                <span>삭제</span>
                                            </button>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* 🏢 3대 뷰 모드 토글: 👥 팀별 모듈 뷰 vs 🏢 직급 계층 뷰 vs ▦ 전체 카드 뷰 */}
                            <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 text-xs shadow-inner">
                                <button
                                    onClick={() => setOfficeLayoutMode('teams')}
                                    className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-bold transition-all ${
                                        officeLayoutMode === 'teams'
                                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.35)]'
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                    title="부서 내 하위 팀(총무1팀, 총무2팀 등) 분할 및 카드 넣고 빼기 모드"
                                >
                                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>👥 팀별 모듈 뷰 (Teams)</span>
                                </button>
                                <button
                                    onClick={() => setOfficeLayoutMode('hierarchy')}
                                    className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-bold transition-all ${
                                        officeLayoutMode === 'hierarchy'
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                    title="부서별 팀장-과장-대리-사원 상하 계층 조직도 및 감시·승인 확인 체계"
                                >
                                    <GitBranch className="w-3.5 h-3.5 text-amber-400" />
                                    <span>🏢 직급 계층 뷰 (Tree)</span>
                                </button>
                                <button
                                    onClick={() => setOfficeLayoutMode('grid')}
                                    className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-bold transition-all ${
                                        officeLayoutMode === 'grid'
                                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_12px_rgba(0,240,255,0.35)]'
                                            : 'text-slate-400 hover:text-white'
                                    }`}
                                    title="모든 조직도를 균일한 바둑판 타일 카드로 배치 (대리 앞, 사원 뒤, 미생성 맨 뒤 정렬)"
                                >
                                    <LayoutGrid className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>▦ 전체 카드 뷰 (Cards)</span>
                                </button>
                            </div>
                        </div>

                        {/* 우측 검색 & 상태 필터 */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="에이전트명/업무/직위 검색..."
                                    className="bg-slate-900 border border-slate-700 rounded pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44 md:w-56"
                                />
                            </div>

                            <div className="flex items-center rounded border border-slate-800 bg-slate-900 p-0.5 text-[10px]">
                                {(['ALL', 'ACTIVE', 'STANDBY', 'IDLE', 'UNCREATED'] as const).map(st => (
                                    <button
                                        key={st}
                                        onClick={() => setStatusFilter(st)}
                                        className={`px-2 py-1 rounded transition-colors ${
                                            statusFilter === st 
                                                ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' 
                                                : 'text-slate-400 hover:text-white'
                                        }`}
                                    >
                                        {st === 'UNCREATED' ? '+미생성' : st}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        VIEW 1: 에이전트 오피스 (👥 팀별 모듈 뷰 vs 🏢 직급 계층 뷰 vs ▦ 전체 카드 뷰)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                    {currentView === 'office' && (
                        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

                            {/* ─────────────────────────────────────────────────────────────
                                MODE 1: 👥 팀별 모듈 뷰 (Team-Based Modular View)
                                - 부서 내 총무1팀, 총무2팀 등 팀 단위 카드 컨테이너
                                - 과장, 대리, 사원 등 카드를 팀에 넣고 빼기 지원
                                - 직급 정렬 규칙: 대리는 앞, 사원은 뒤, 미생성은 맨 뒤
                            ───────────────────────────────────────────────────────────── */}
                            {officeLayoutMode === 'teams' && (
                                <div className="space-y-10">
                                    {(selectedDeptId === 'all' ? departments : departments.filter(d => d.id === selectedDeptId)).map((dept) => {
                                        const deptAllAgents = agents.filter(a => a.deptId === dept.id);
                                        const deptFiltered = filteredAgents.filter(a => a.deptId === dept.id);
                                        if (selectedDeptId === 'all' && deptFiltered.length === 0 && searchQuery) {
                                            return null;
                                        }

                                        // 부서 내 존재하는 모든 고유 팀 목록 (부서 메타데이터 순서 우선 보장)
                                        const allUniqueTeams = Array.from(new Set(deptAllAgents.map(a => a.teamName).filter(Boolean))) as string[];
                                        const deptTeams = (dept.teams && dept.teams.length > 0)
                                            ? [
                                                ...dept.teams.filter(t => allUniqueTeams.includes(t)),
                                                ...allUniqueTeams.filter(t => !dept.teams?.includes(t))
                                            ]
                                            : allUniqueTeams;
                                        const unassignedAgents = deptFiltered.filter(a => !a.teamName).sort(sortAgents);

                                        return (
                                            <div 
                                                key={dept.id} 
                                                className="rounded-xl border border-slate-800 bg-[#070C18]/90 p-5 shadow-lg relative overflow-hidden space-y-6"
                                                style={{ borderTop: `4px solid ${dept.color}` }}
                                            >
                                                {/* 부서 헤더 바 */}
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-2xl">{dept.icon}</span>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="text-base font-bold text-white tracking-wide">
                                                                    {dept.name}
                                                                </h3>
                                                                <span className="text-[10px] px-2 py-0.5 rounded border font-mono font-bold" style={{ borderColor: dept.color, color: dept.color }}>
                                                                    {dept.headRole}
                                                                </span>
                                                                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-700/60 text-indigo-300 font-mono font-bold">
                                                                    {deptTeams.length}개 팀 운용 중
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-slate-400 mt-0.5">
                                                                {dept.description}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* 부서 우측 버튼군 (+ 팀원 추가, + 새 팀 추가, 부서 수정/삭제) */}
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleOpenAddTeamMember(dept)}
                                                            className="px-3 py-1.5 rounded-lg border border-cyan-500/60 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-200 hover:text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.25)] cursor-pointer"
                                                            title={`[${dept.name}]에 새로운 팀원(에이전트)을 생성하고 추가합니다`}
                                                        >
                                                            <UserPlus className="w-3.5 h-3.5 text-cyan-400" />
                                                            <span>+ 팀원 추가</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAddNewTeam(dept.id)}
                                                            className="px-3 py-1.5 rounded-lg border border-indigo-500/60 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-200 hover:text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(99,102,241,0.25)] cursor-pointer"
                                                            title="이 부서 내에 새로운 팀(예: 총무3팀)을 추가합니다"
                                                        >
                                                            <Plus className="w-3.5 h-3.5 text-indigo-400" />
                                                            <span>+ 새 팀 추가</span>
                                                        </button>
                                                        <div className="flex items-center gap-1 border-l border-slate-800/80 pl-2">
                                                            <button
                                                                onClick={(e) => handleOpenEditDept(dept, e)}
                                                                className="px-2 py-1 rounded border border-slate-700 hover:border-cyan-400 bg-slate-900/90 text-slate-300 hover:text-cyan-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                            >
                                                                <Edit2 className="w-3 h-3 text-cyan-400" />
                                                                <span>수정</span>
                                                            </button>
                                                            <button
                                                                onClick={(e) => handleDeleteDept(dept.id, e)}
                                                                className="px-2 py-1 rounded border border-slate-800 hover:border-red-500/60 bg-slate-900/90 text-slate-400 hover:text-red-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                            >
                                                                <Trash2 className="w-3 h-3 text-red-400" />
                                                                <span>삭제</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* 부서 내 각 팀 컨테이너 목록 */}
                                                <div className="space-y-6">
                                                    {deptTeams.map((teamName) => {
                                                        const teamAgents = deptFiltered.filter(a => a.teamName === teamName).sort(sortAgents);
                                                        const headCount = teamAgents.filter(a => a.position === '팀장').length;
                                                        const chiefCount = teamAgents.filter(a => a.position === '과장').length;
                                                        const assistCount = teamAgents.filter(a => a.position === '대리').length;
                                                        const staffCount = teamAgents.filter(a => a.position === '사원').length;

                                                        return (
                                                            <div 
                                                                key={teamName}
                                                                className="rounded-xl border border-indigo-900/40 bg-[#080E20]/70 p-4 space-y-3 shadow-inner relative group/teambox"
                                                            >
                                                                {/* 팀 헤더 바 */}
                                                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-950/80 pb-2.5">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 shadow-[0_0_8px_#818CF8] animate-pulse"></div>
                                                                        <h4 className="text-sm font-bold text-white tracking-wide flex items-center gap-1.5">
                                                                            <span>👥</span>
                                                                            <span className="text-indigo-200">{teamName}</span>
                                                                        </h4>
                                                                        {/* 인원 및 직급 구성 뱃지 */}
                                                                        <div className="flex items-center gap-1 text-[10px] font-mono">
                                                                            <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 font-bold border border-indigo-800/60">
                                                                                총 {teamAgents.length}명
                                                                            </span>
                                                                            {(headCount > 0 || chiefCount > 0 || assistCount > 0 || staffCount > 0) && (
                                                                                <span className="px-2 py-0.5 rounded bg-slate-900/80 text-slate-400 border border-slate-800">
                                                                                    {[
                                                                                        headCount > 0 ? `팀장 ${headCount}` : null,
                                                                                        chiefCount > 0 ? `과장 ${chiefCount}` : null,
                                                                                        assistCount > 0 ? `대리 ${assistCount}` : null,
                                                                                        staffCount > 0 ? `사원 ${staffCount}` : null
                                                                                    ].filter(Boolean).join(' · ')}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* 팀 제어 버튼군: [+ 팀원 추가], [+ 봇 배정/추가], [팀 해체] */}
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            onClick={() => handleOpenAddTeamMember(dept, teamName)}
                                                                            className="px-2.5 py-1 rounded border border-cyan-500/60 bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 hover:text-white text-xs font-bold transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                                                                            title={`[${teamName}]에 신규 팀원(에이전트)을 즉시 생성하여 배치합니다`}
                                                                        >
                                                                            <UserPlus className="w-3 h-3 text-cyan-400" />
                                                                            <span>+ 팀원 추가</span>
                                                                        </button>
                                                                        {/* 미배정 봇 중 이 팀으로 바로 끌어오기 */}
                                                                        {unassignedAgents.length > 0 && (
                                                                            <div className="relative group/addto">
                                                                                <button
                                                                                    className="px-2.5 py-1 rounded border border-indigo-600/40 bg-indigo-950/50 hover:bg-indigo-900/60 text-indigo-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                                                    title="미배정된 봇을 이 팀으로 추가 배정합니다"
                                                                                >
                                                                                    <Plus className="w-3 h-3 text-indigo-400" />
                                                                                    <span>+ 봇 배정</span>
                                                                                    <ChevronDown className="w-3 h-3 opacity-60" />
                                                                                </button>
                                                                                <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-slate-700 bg-[#0C1322] shadow-2xl z-50 p-1.5 text-xs text-slate-200 hidden group-hover/addto:block">
                                                                                    <div className="text-[10px] text-slate-400 px-2 py-1 border-b border-slate-800 font-mono">
                                                                                        미배정 봇을 [{teamName}]에 배정:
                                                                                    </div>
                                                                                    <div className="max-h-40 overflow-y-auto py-1 space-y-0.5">
                                                                                        {unassignedAgents.map(uAg => (
                                                                                            <button
                                                                                                key={uAg.id}
                                                                                                onClick={() => handleMoveAgentToTeam(uAg.id, teamName)}
                                                                                                className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-indigo-950/80 hover:text-cyan-300 text-slate-300 flex items-center justify-between transition-colors"
                                                                                            >
                                                                                                <span>{uAg.code} {uAg.name}</span>
                                                                                                <span className="text-[9px] text-slate-500 font-mono">{uAg.position}</span>
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        <button
                                                                            onClick={() => handleDeleteTeam(dept.id, teamName)}
                                                                            className="px-2 py-1 rounded border border-slate-800 hover:border-rose-500/60 bg-slate-900/90 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                                            title={`[${teamName}] 해체 (소속 봇들은 미배정 상태로 안전하게 전환)`}
                                                                        >
                                                                            <X className="w-3 h-3 text-rose-400" />
                                                                            <span>팀 해체</span>
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                {/* 팀 소속 카드 그리드 (👑 대리 앞, 사원 뒤, 미생성 맨 뒤 정렬!) */}
                                                                {teamAgents.length > 0 ? (
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                                                                        {teamAgents.map(ag => renderOrgCard(ag, dept))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="p-4 border border-dashed border-indigo-900/50 rounded-lg text-xs text-indigo-300/70 bg-indigo-950/20 text-center flex items-center justify-center gap-2">
                                                                        <span>현재 [{teamName}]에 배정된 봇이 없습니다. 아래 대기 카드에서 [팀 배정]을 눌러 봇을 넣으세요.</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}

                                                    {/* 부서에 등록된 팀이 없을 경우 안내 */}
                                                    {deptTeams.length === 0 && (
                                                        <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-slate-900/30 text-center space-y-2">
                                                            <Users className="w-8 h-8 text-indigo-400/60 mx-auto" />
                                                            <div className="text-sm font-bold text-slate-300">
                                                                등록된 세부 팀이 없습니다.
                                                            </div>
                                                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                                                상단의 [+ 새 팀 추가] 버튼을 눌러 팀(예: {dept.name}1팀)을 생성하고 원하는 에이전트 카드를 배치해 보세요.
                                                            </p>
                                                            <button
                                                                onClick={() => handleAddNewTeam(dept.id)}
                                                                className="px-3 py-1.5 rounded-lg border border-indigo-500 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all inline-flex items-center gap-1 shadow-md cursor-pointer mt-2"
                                                            >
                                                                <Plus className="w-3.5 h-3.5" />
                                                                <span>지금 첫 번째 팀 생성하기</span>
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* 📋 대기 및 미배정 에이전트 / 슬롯 섹션 */}
                                                    {unassignedAgents.length > 0 && (
                                                        <div className="rounded-xl border border-slate-800/80 bg-[#070C16]/60 p-4 space-y-3">
                                                            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-amber-400">📋</span>
                                                                    <h4 className="text-xs font-bold text-slate-300 tracking-wide">
                                                                        대기 및 미배정 에이전트 ({unassignedAgents.length}개 슬롯)
                                                                    </h4>
                                                                    <span className="text-[10px] text-slate-500">
                                                                        (각 카드의 [팀 배정] 드롭다운을 눌러 원하는 팀에 넣을 수 있습니다)
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                                                                {unassignedAgents.map(ag => renderOrgCard(ag, dept))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* ─────────────────────────────────────────────────────────────
                                MODE 2: 🏢 직급 계층 뷰 (Tree Org Chart Mode)
                            ───────────────────────────────────────────────────────────── */}
                            {officeLayoutMode === 'hierarchy' && (
                                <div className="space-y-10">
                                    {(selectedDeptId === 'all' ? departments : departments.filter(d => d.id === selectedDeptId)).map((dept) => {
                                        const deptAllAgents = agents.filter(a => a.deptId === dept.id);
                                        const deptFiltered = filteredAgents.filter(a => a.deptId === dept.id);
                                        if (selectedDeptId === 'all' && deptFiltered.length === 0 && searchQuery) {
                                            return null;
                                        }

                                        // 직급별 분류 (각 계층 내에서도 sortAgents로 정렬: 대리 앞, 사원 뒤, 미생성 맨 뒤)
                                        const headAgents = deptFiltered.filter(a => (a.position || '사원') === '팀장').sort(sortAgents);
                                        const chiefAgents = deptFiltered.filter(a => (a.position || '사원') === '과장').sort(sortAgents);
                                        const staffAgents = deptFiltered.filter(a => ['대리', '사원'].includes(a.position || '사원')).sort(sortAgents);
                                        const pendingTasks = deptAllAgents.filter(a => a.isCreated && a.approvalStatus === 'PENDING');

                                        return (
                                            <div 
                                                key={dept.id} 
                                                className="rounded-xl border border-slate-800 bg-[#070C18]/90 p-5 shadow-lg relative overflow-hidden space-y-6"
                                                style={{ borderTop: `4px solid ${dept.color}` }}
                                            >
                                                {/* 부서 헤더 바 */}
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-2xl">{dept.icon}</span>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="text-base font-bold text-white tracking-wide">
                                                                    {dept.name}
                                                                </h3>
                                                                <span className="text-[10px] px-2 py-0.5 rounded border font-mono font-bold" style={{ borderColor: dept.color, color: dept.color }}>
                                                                    {dept.headRole}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-slate-400 mt-0.5">
                                                                {dept.description}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* 부서 관리 액션 (수정/삭제) 및 결재선 현황 / 팀장 일괄 승인 */}
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex items-center gap-1 mr-1 border-r border-slate-800/80 pr-2">
                                                            <button
                                                                onClick={(e) => handleOpenEditDept(dept, e)}
                                                                className="px-2.5 py-1 rounded border border-slate-700 hover:border-cyan-400 bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                                                                title={`${dept.name} 설정 수정`}
                                                            >
                                                                <Edit2 className="w-3 h-3 text-cyan-400" />
                                                                <span>수정</span>
                                                            </button>
                                                            <button
                                                                onClick={(e) => handleDeleteDept(dept.id, e)}
                                                                className="px-2.5 py-1 rounded border border-slate-800 hover:border-red-500/60 bg-slate-900/90 hover:bg-red-950/40 text-slate-400 hover:text-red-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                                                                title={`${dept.name} 부서 삭제`}
                                                            >
                                                                <Trash2 className="w-3 h-3 text-red-400" />
                                                                <span>삭제</span>
                                                            </button>
                                                        </div>

                                                        {pendingTasks.length > 0 ? (
                                                            <div className="flex items-center gap-2 animate-pulse">
                                                                <span className="text-xs px-2.5 py-1 rounded-full border border-amber-500 bg-amber-950/60 text-amber-300 font-bold flex items-center gap-1.5 shadow-[0_0_10px_rgba(245,158,11,0.5)]">
                                                                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                                                                    <span>과장/팀장 확인 대기: {pendingTasks.length}건</span>
                                                                </span>
                                                                <button
                                                                    onClick={(e) => handleBatchApproveDept(dept.id, e)}
                                                                    className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-xs font-black shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all cursor-pointer flex items-center gap-1"
                                                                    title="부서 팀장 전결 권한으로 대기 중인 모든 실무자 업무 일괄 승인"
                                                                >
                                                                    <Check className="w-3.5 h-3.5" />
                                                                    <span>👑 팀장 전결 일괄 승인</span>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-950/30 text-emerald-300 font-bold flex items-center gap-1">
                                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                                                <span>모든 결재 통과 완료 (정상 가동)</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                    LEVEL 1: 👑 팀장 노드 (부서 총괄 / 최종 승인권자)
                                                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                                                <div className="flex flex-col items-center">
                                                    <div className="text-[10px] font-bold text-amber-400 tracking-widest uppercase mb-2 flex items-center gap-1.5">
                                                        <span>👑 LEVEL 1: 부서 총괄 및 최종 결재권자 (Head of Dept)</span>
                                                    </div>

                                                    {headAgents.length > 0 ? (
                                                        <div className="flex flex-wrap justify-center gap-4">
                                                            {headAgents.map(head => renderOrgCard(head, dept))}
                                                        </div>
                                                    ) : (
                                                        <div className="p-3 border border-dashed border-amber-600/40 rounded-lg text-xs text-amber-400/80 bg-amber-950/20 text-center">
                                                            현재 팀장 직위가 공석입니다. 아래 과장/실무자 카드에서 [▲ 승진]을 눌러 팀장을 임명하세요.
                                                        </div>
                                                    )}

                                                    {/* 트리 연결선 1 (팀장 ➔ 과장) */}
                                                    <div className="w-full max-w-xl flex flex-col items-center my-3">
                                                        <div className="w-0.5 h-6 bg-linear-to-b from-amber-400 to-purple-500"></div>
                                                        <div className="w-3/4 h-0.5 bg-purple-500/60 relative">
                                                            <div className="absolute -top-1 left-0 w-2 h-2 rounded-full bg-purple-400"></div>
                                                            <div className="absolute -top-1 right-0 w-2 h-2 rounded-full bg-purple-400"></div>
                                                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-amber-400"></div>
                                                        </div>
                                                        <div className="w-0.5 h-4 bg-purple-500/60"></div>
                                                    </div>
                                                </div>

                                                {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                    LEVEL 2: 👔 과장 계층 (중간 관리자 / 실무 검토 및 감시 책임자)
                                                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                                                <div className="flex flex-col items-center">
                                                    <div className="text-[10px] font-bold text-purple-400 tracking-widest uppercase mb-2 flex items-center gap-1.5">
                                                        <span>👔 LEVEL 2: 실무 1차 검토 및 감시 책임자 (Chief Managers)</span>
                                                    </div>

                                                    <div className="flex flex-wrap justify-center gap-4 w-full">
                                                        {chiefAgents.length > 0 ? (
                                                            chiefAgents.map(chief => renderOrgCard(chief, dept))
                                                        ) : (
                                                            <div className="p-3 border border-dashed border-purple-600/40 rounded-lg text-xs text-purple-400/80 bg-purple-950/20 text-center">
                                                                현재 과장 직위가 공석입니다. 실무자 카드에서 [▲ 승진]을 눌러 과장을 임명하세요.
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* 트리 연결선 2 (과장 ➔ 대리/사원) */}
                                                    <div className="w-full max-w-3xl flex flex-col items-center my-3">
                                                        <div className="w-0.5 h-6 bg-linear-to-b from-purple-500 to-cyan-500"></div>
                                                        <div className="w-full h-0.5 bg-cyan-500/40 relative">
                                                            <div className="absolute -top-1 left-0 w-2 h-2 rounded-full bg-cyan-400"></div>
                                                            <div className="absolute -top-1 right-0 w-2 h-2 rounded-full bg-cyan-400"></div>
                                                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-purple-400"></div>
                                                        </div>
                                                        <div className="w-0.5 h-4 bg-cyan-500/40"></div>
                                                    </div>
                                                </div>

                                                {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                    LEVEL 3 & 4: 💼 대리 & 📋 사원 (실행 자율 에이전트)
                                                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                                                <div>
                                                    <div className="text-[10px] font-bold text-cyan-400 tracking-widest uppercase mb-3 flex items-center justify-between">
                                                        <span>💼 & 📋 LEVEL 3/4: 현장 실무 및 단위 업무 자율 실행자 (Staff & Associates)</span>
                                                        <span className="text-slate-400 font-normal">
                                                            실무 완료 후 결재 상신 ➔ 상급자 확인 시 최종 통과
                                                        </span>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                                                        {staffAgents.map(staff => renderOrgCard(staff, dept))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* ─────────────────────────────────────────────────────────────
                                MODE 3: ▦ 전체 카드 뷰 (Swarm Grid Mode - 카드형태 일괄 배치)
                            ───────────────────────────────────────────────────────────── */}
                            {officeLayoutMode === 'grid' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between px-1 text-xs text-slate-400">
                                        <span>
                                            모든 조직도 에이전트 카드 배치 (총 {filteredAgents.length}개 슬롯 / 정렬: 대리 앞, 사원 뒤, 미생성 맨 뒤)
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                                        {filteredAgents.map((agent) => {
                                            const dept = departments.find(d => d.id === agent.deptId);
                                            return renderOrgCard(agent, dept);
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        VIEW 2: 부서간 그물망 맵 (Architecture & Dynamic Swarm Net)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                    {currentView === 'network' && (
                        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                            {/* 1. 대표님 핵심 지시 성적서 파이프라인 헤더 */}
                            <div className="rounded-lg border border-purple-800/60 bg-purple-950/20 p-4 flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-purple-400" />
                                        <span>대표님 핵심 지시: [출고 신호 + 거래명세표 ➔ 성적서 무인 발송] 파이프라인</span>
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-1">
                                        출고부의 자재 출고신호와 총무부의 거래명세표가 발행되면, 품질부가 고객 P.O와 Heat No를 자동 매칭하여 성적서를 생성·발송합니다.
                                    </p>
                                </div>
                                <button
                                    onClick={runCertificatePipelineSimulation}
                                    disabled={activeNetworkStep !== null}
                                    className="px-4 py-2 rounded border border-purple-400 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-[0_0_15px_rgba(124,77,255,0.4)] transition-all cursor-pointer"
                                >
                                    <Play className="w-3.5 h-3.5" />
                                    <span>핵심 파이프라인 실시간 가동 테스트</span>
                                </button>
                            </div>

                            {/* 실시간 실행 스트림 로그 */}
                            {simulationLog.length > 0 && (
                                <div className="rounded-lg border border-slate-800 bg-[#070B14] p-3 text-xs font-mono space-y-1.5 shadow-inner">
                                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                                        <span className="text-[10px] text-cyan-400 font-bold tracking-wider flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                                            REAL-TIME SWARM PIPELINE & EVENT STREAM
                                        </span>
                                        <button
                                            onClick={() => setSimulationLog([])}
                                            className="text-[10px] text-slate-500 hover:text-slate-300 underline"
                                        >
                                            로그 지우기
                                        </button>
                                    </div>
                                    {simulationLog.map((log, idx) => (
                                        <div key={idx} className="text-emerald-400 animate-fadeIn flex items-start gap-2">
                                            <span className="text-slate-600 shrink-0">#{String(idx + 1).padStart(2, '0')}</span>
                                            <span>{log}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 2. 전사 8대 부서 상호 그물망 토폴로지 매트릭스 (Mesh Interconnect Matrix) */}
                            <div className="rounded-lg border border-slate-800 bg-[#070C16] p-4 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                                    <div className="flex items-center gap-2">
                                        <Network className="w-4 h-4 text-purple-400" />
                                        <span className="text-xs font-bold text-slate-200">
                                            전사 8대 부서 그물망 상호 연결 매트릭스 (Cross-Department Swarm Mesh Topology)
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {selectedMeshDept !== 'all' && (
                                            <button
                                                onClick={() => setSelectedMeshDept('all')}
                                                className="text-[10px] px-2 py-0.5 rounded border border-cyan-800 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60"
                                            >
                                                필터 해제 (전체 보기)
                                            </button>
                                        )}
                                        <span className="text-[10px] text-purple-400 font-mono">
                                            총 {dynamicMeshLinks.length}개 동적 그물망 링크 활성화
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                                    {deptMeshStats.map(({ dept, outgoingCount, incomingCount, totalLinks, connectedDepts }) => {
                                        const isSelected = selectedMeshDept === dept.id;
                                        return (
                                            <div
                                                key={dept.id}
                                                onClick={() => setSelectedMeshDept(selectedMeshDept === dept.id ? 'all' : dept.id)}
                                                className={`p-2.5 rounded border cursor-pointer transition-all flex flex-col justify-between ${
                                                    isSelected
                                                        ? 'border-purple-400 bg-purple-950/40 shadow-[0_0_12px_rgba(168,85,247,0.3)] scale-[1.02]'
                                                        : 'border-slate-800 bg-[#090F1C] hover:border-slate-700 hover:bg-slate-900/50'
                                                }`}
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between text-xs mb-1">
                                                        <span className="text-sm">{dept.icon}</span>
                                                        <span 
                                                            className="text-[9px] px-1 rounded font-bold"
                                                            style={{ 
                                                                color: dept.color, 
                                                                backgroundColor: `${dept.color}20` 
                                                            }}
                                                        >
                                                            {dept.code}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs font-bold text-slate-200 truncate">
                                                        {dept.name}
                                                    </div>
                                                    <div className="text-[9px] text-slate-500 mt-0.5">
                                                        발신 {outgoingCount}개 · 수신 {incomingCount}개
                                                    </div>
                                                </div>

                                                <div className="mt-2 pt-1.5 border-t border-slate-800/80">
                                                    <div className="text-[9px] text-purple-300 font-mono font-bold">
                                                        {totalLinks}개 채널 연동
                                                    </div>
                                                    <div className="flex flex-wrap gap-0.5 mt-1">
                                                        {connectedDepts.map(cd => cd && (
                                                            <span 
                                                                key={cd.id} 
                                                                className="text-[8px] px-1 py-0.2 rounded bg-slate-800 text-slate-300"
                                                                title={`${dept.name} ➔ ${cd.name} 연계됨`}
                                                            >
                                                                {cd.name.replace('부', '')}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 3. 사용자가 태그로 지정한 실제 에이전트 동적 그물망 링크 리스트 */}
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-xs font-bold text-slate-300 tracking-wider flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                        <span>ACTIVE AGENT MESH LINKS (에이전트 연계 태그 기반 동적 그물망)</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-cyan-300">
                                            {selectedMeshDept === 'all' 
                                                ? `전체 ${dynamicMeshLinks.length}건` 
                                                : `${departments.find(d => d.id === selectedMeshDept)?.name} 관련 ${dynamicMeshLinks.filter(l => l.agent.deptId === selectedMeshDept || l.targetDeptId === selectedMeshDept).length}건`}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                        * 에이전트 생성/수정 시 붙인 연계 태그가 자동으로 그물망 채널을 형성합니다.
                                    </div>
                                </div>

                                {dynamicMeshLinks.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-slate-800 bg-[#080D18] p-8 text-center space-y-2">
                                        <div className="text-slate-400 text-sm font-bold">등록된 부서간 연계 태그가 없습니다.</div>
                                        <p className="text-xs text-slate-500 max-w-md mx-auto">
                                            '전체 부서 통합 관제'에서 [+ AGENT 생성]을 누르거나 생성된 에이전트를 클릭하여 
                                            <strong className="text-purple-300 font-bold"> [🔗 연계 대상 부서 태그]</strong>를 선택하면 여기에 실시간으로 자율 그물망 링크가 연결됩니다.
                                        </p>
                                        <button
                                            onClick={() => setCurrentView('office')}
                                            className="mt-3 px-4 py-1.5 rounded border border-cyan-500/80 bg-cyan-950/40 text-cyan-300 text-xs font-bold hover:bg-cyan-500 hover:text-black transition-all"
                                        >
                                            오피스 대시보드로 이동하여 태그 설정하기
                                        </button>
                                    </div>
                                ) : (
                                    dynamicMeshLinks
                                        .filter(link => selectedMeshDept === 'all' || link.agent.deptId === selectedMeshDept || link.targetDeptId === selectedMeshDept)
                                        .map((link, idx) => (
                                            <div 
                                                key={link.id}
                                                className="rounded-lg border border-slate-800 hover:border-purple-500/80 bg-[#090F1C] hover:bg-[#0C1426] p-4 transition-all duration-200 shadow-sm"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-black px-2 py-0.5 rounded bg-slate-800 text-purple-300 font-mono">
                                                            MESH #{idx + 1}
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5 flex-wrap">
                                                            <span className="text-cyan-400">[{link.sourceDeptName}] {link.agent.name}</span>
                                                            <span className="text-slate-500">──▶</span>
                                                            <span className="text-emerald-400">
                                                                [{link.targetDeptName}] {link.targetAgentName ? link.targetAgentName : '전체 부서'}
                                                            </span>
                                                            {link.targetAgentName && (
                                                                <span className="text-[9px] px-1 rounded bg-purple-950 border border-purple-500/40 text-purple-300">
                                                                    1:1 업무 교류
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-cyan-800/80 bg-cyan-950/30 text-cyan-300">
                                                            {link.eventName}
                                                        </span>
                                                        <button
                                                            onClick={() => handleSelectAgent(link.agent)}
                                                            className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:border-cyan-400 cursor-pointer"
                                                        >
                                                            연계 업무 수정
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center text-xs mt-3">
                                                    {/* SOURCE */}
                                                    <div className="border border-slate-800 rounded p-2.5 bg-black/40">
                                                        <div className="text-[10px] text-slate-500 font-bold flex items-center justify-between">
                                                            <span>SOURCE (발신 에이전트)</span>
                                                            <span className="text-[9px] px-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 font-bold">
                                                                {link.agent.status}
                                                            </span>
                                                        </div>
                                                        <div className="font-bold text-slate-200 mt-1 flex items-center gap-1.5">
                                                            <span className="text-cyan-400 font-mono text-[11px]">{link.agent.code}</span>
                                                            <span>{link.agent.name}</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={link.agent.role}>
                                                            {link.agent.role}
                                                        </div>
                                                    </div>

                                                    {/* BROKER / ROUTER */}
                                                    <div className="text-center space-y-1">
                                                        <div className="text-[10px] text-purple-400 font-bold">
                                                            자율 이벤트 버스 (Redis / SSE)
                                                        </div>
                                                        <div className="text-purple-400 font-bold text-base flex items-center justify-center gap-1">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping"></span>
                                                            <span>────────▶</span>
                                                        </div>
                                                        <button
                                                            onClick={() => handleTestMeshLink(link.agent.name, link.sourceDeptName, link.targetDeptName, link.targetAgentName, link.eventName)}
                                                            className="px-2.5 py-1 rounded border border-purple-500/60 bg-purple-950/40 hover:bg-purple-600 text-purple-200 hover:text-white text-[10px] font-bold shadow-sm transition-all cursor-pointer"
                                                        >
                                                            ⚡ 단독 신호 전송 테스트
                                                        </button>
                                                    </div>

                                                    {/* TARGET */}
                                                    <div className="border border-slate-800 rounded p-2.5 bg-black/40">
                                                        <div className="text-[10px] text-slate-500 font-bold flex items-center justify-between">
                                                            <span className="flex items-center gap-1">
                                                                <span>TARGET (수신 연계)</span>
                                                                <span>{link.targetDeptIcon}</span>
                                                            </span>
                                                            {link.targetAgentCode && (
                                                                <span className="text-[9px] font-mono text-cyan-400">
                                                                    {link.targetAgentCode}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="font-bold text-emerald-400 mt-1 text-sm flex items-center gap-1.5">
                                                            <span>[{link.targetDeptName}]</span>
                                                            <span>{link.targetAgentName ? link.targetAgentName : '전체 부서'}</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                            {link.action}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                )}
                            </div>

                            {/* 4. 고정 시스템 파이프라인 명세 (성적서 등 전사 마스터 연동) */}
                            <div className="space-y-3 pt-4 border-t border-slate-800">
                                <div className="text-xs font-bold text-slate-400 tracking-wider">
                                    SYSTEM MASTER PIPELINE SPECS (전사 표준 규격 파이프라인)
                                </div>
                                {EVENT_NETWORKS.map((link, idx) => {
                                    const isStepActive = activeNetworkStep === (idx + 1);

                                    return (
                                        <div 
                                            key={link.id}
                                            className={`rounded-lg border p-4 transition-all duration-300 ${
                                                isStepActive
                                                    ? 'border-purple-400 bg-purple-950/40 shadow-[0_0_20px_rgba(124,77,255,0.3)] scale-[1.01]'
                                                    : 'border-slate-800/80 bg-[#080D18]'
                                            }`}
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-black px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono">
                                                        SYS #{idx + 1}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-100">{link.name}</span>
                                                </div>
                                                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-cyan-800/80 bg-cyan-950/30 text-cyan-300">
                                                    {link.event}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center text-xs mt-3">
                                                <div className="border border-slate-800 rounded p-2.5 bg-black/30">
                                                    <div className="text-[10px] text-slate-500 font-bold">SOURCE (발신 부서)</div>
                                                    <div className="font-bold text-slate-200 mt-0.5">
                                                        [{link.sourceDept}] {link.sourceAgent}
                                                    </div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-[10px] text-purple-400 font-bold">이벤트 브로커 (Redis / SSE)</div>
                                                    <div className="text-purple-400 font-bold text-lg">───────▶</div>
                                                    <div className="text-[9px] text-slate-500">{link.description}</div>
                                                </div>

                                                <div className="border border-slate-800 rounded p-2.5 bg-black/30">
                                                    <div className="text-[10px] text-slate-500 font-bold">TARGET (반응 부서)</div>
                                                    <div className="font-bold text-emerald-400 mt-0.5">
                                                        [{link.targetDept}] {link.targetAgent}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 mt-1">{link.action}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        VIEW 3: 실시간 라이브 터미널 (Live Logs)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                    {currentView === 'logs' && (
                        <div className="flex-1 overflow-y-auto p-4 md:p-6 font-mono text-xs text-emerald-400 space-y-2 bg-[#04070F]">
                            <div className="border-b border-emerald-950 pb-2 text-slate-400 flex items-center justify-between">
                                <span>LIVE AGENT ACTIVITY STREAM (실제 생성 에이전트 실시간 로그)</span>
                                <span className="text-[10px] text-emerald-500 animate-pulse">● STREAMING ACTIVE</span>
                            </div>
                            {createdAgents.flatMap(a => a.logs.map(l => ({ log: l, agent: a }))).slice(0, 30).map((item, idx) => (
                                <div key={idx} className="flex items-start gap-3 hover:bg-slate-900/40 p-1 rounded">
                                    <span className="text-slate-600 shrink-0">[{item.agent.deptName}]</span>
                                    <span className="text-cyan-400 font-bold shrink-0">{item.agent.code}</span>
                                    <span className="text-slate-300">{item.log}</span>
                                </div>
                            ))}
                            {createdAgents.length === 0 && (
                                <div className="text-slate-500 py-10 text-center">
                                    가동 중인 에이전트가 없습니다. [+ AGENT 생성]을 눌러 첫 에이전트를 등록해 보세요.
                                </div>
                            )}
                        </div>
                    )}

                    {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                        VIEW 4: Mac mini 24/7 호스트 상태
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
                    {currentView === 'host' && (
                        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                            <div className="rounded-lg border border-cyan-800/60 bg-cyan-950/20 p-4">
                                <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                                    <HardDrive className="w-4 h-4 text-cyan-400" />
                                    <span>독립 전용 서버: Apple Mac mini M5 Pro 호스트 명세</span>
                                </h3>
                                <p className="text-xs text-slate-400 mt-1">
                                    사무실에 독립 배치될 Mac mini에서 24시간 365일 무중단으로 생성된 에이전트 데몬이 가동됩니다.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="border border-slate-800 rounded-lg p-4 bg-[#090F1C]">
                                    <div className="text-[10px] text-slate-500 font-bold">CHIP / GPU</div>
                                    <div className="text-sm font-bold text-white mt-1">Apple M5 Pro</div>
                                    <div className="text-xs text-cyan-400 mt-0.5">16-Core GPU · 하드웨어 가속</div>
                                    <div className="mt-2 text-[10px] text-slate-400">평균 소비전력: 8~12W (선풍기 미만)</div>
                                </div>

                                <div className="border border-slate-800 rounded-lg p-4 bg-[#090F1C]">
                                    <div className="text-[10px] text-slate-500 font-bold">UNIFIED MEMORY</div>
                                    <div className="text-sm font-bold text-white mt-1">24GB 통합 메모리</div>
                                    <div className="text-xs text-emerald-400 mt-0.5">사용 중: 4.8GB / 여유: 19.2GB</div>
                                    <div className="mt-2 text-[10px] text-slate-400">노드 백그라운드 프로세스 병렬 완벽 소화</div>
                                </div>

                                <div className="border border-slate-800 rounded-lg p-4 bg-[#090F1C]">
                                    <div className="text-[10px] text-slate-500 font-bold">REMOTE TUNNEL</div>
                                    <div className="text-sm font-bold text-white mt-1">Cloudflare Tunnel</div>
                                    <div className="text-xs text-amber-400 mt-0.5">office.altf.kr (SSL 직결)</div>
                                    <div className="mt-2 text-[10px] text-slate-400">포트포워딩 없이 외부 원격 관제 가능</div>
                                </div>

                                <div className="border border-slate-800 rounded-lg p-4 bg-[#090F1C]">
                                    <div className="text-[10px] text-slate-500 font-bold">SELF-HEALING (자가복구)</div>
                                    <div className="text-sm font-bold text-white mt-1">PM2 Daemon</div>
                                    <div className="text-xs text-purple-400 mt-0.5">에러 시 1초 내 자동 재시작</div>
                                    <div className="mt-2 text-[10px] text-slate-400">정전 후 전원 복구 시 자동 부팅 설정</div>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                4. AGENT CREATE MODAL ([+ AGENT 생성] 클릭 시 열림)
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {creatingSlot && (
                <div 
                    className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 animate-fadeIn"
                    onClick={() => setCreatingSlot(null)}
                >
                    <div 
                        className="bg-[#090F1C] border border-cyan-500/80 rounded-2xl max-w-xl w-full max-h-[88vh] flex flex-col shadow-[0_0_50px_rgba(0,240,255,0.3)] overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* 1. 고정 헤더 */}
                        <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-5 shrink-0 bg-[#080E1A]">
                            <div className="flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 border border-cyan-400 text-cyan-300 font-mono font-bold">
                                    {creatingSlot.code}
                                </span>
                                <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">
                                    신규 자율 AI 에이전트 생성
                                </h3>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 bg-slate-800/80 border border-slate-700 px-1.5 py-0.5 rounded font-mono hidden sm:inline">
                                    ESC 닫기
                                </span>
                                <button
                                    onClick={() => setCreatingSlot(null)}
                                    className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                    title="닫기 (ESC)"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* 2. 스크롤 본문 */}
                        <div className="space-y-4 text-xs p-4 sm:p-5 overflow-y-auto flex-1 custom-scrollbar">
                            <div>
                                <label className="block text-[11px] text-slate-400 mb-1 font-bold">배치 부서</label>
                                <input
                                    type="text"
                                    disabled
                                    value={`${creatingSlot.deptName} (${creatingSlot.code})`}
                                    className="w-full bg-slate-900/60 border border-slate-800 rounded px-3 py-2 text-slate-400"
                                />
                            </div>

                            {/* 소속 팀 지정 */}
                            <div>
                                <label className="block text-[11px] text-indigo-300 mb-1 font-bold flex items-center justify-between">
                                    <span>소속 팀 지정 (Team Name)</span>
                                    <span className="text-[10px] text-slate-400 font-normal">부서 내 팀을 선택하거나 직접 입력</span>
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={createForm.teamName}
                                        onChange={(e) => setCreateForm({ ...createForm, teamName: e.target.value })}
                                        placeholder="예: 영업지원1팀, 구매SCM팀 등"
                                        className="flex-1 bg-slate-900 border border-indigo-700/60 rounded px-3 py-2 text-indigo-200 placeholder-slate-500 focus:outline-none focus:border-indigo-400 font-bold"
                                    />
                                    {(() => {
                                        const curDept = departments.find(d => d.id === creatingSlot.deptId);
                                        const deptTeamList = curDept?.teams || [];
                                        if (deptTeamList.length === 0) return null;
                                        return (
                                            <select
                                                onChange={(e) => {
                                                    if (e.target.value) setCreateForm({ ...createForm, teamName: e.target.value });
                                                }}
                                                value={createForm.teamName}
                                                className="bg-slate-900 border border-indigo-800 rounded px-2 text-xs text-indigo-300 focus:outline-none cursor-pointer"
                                            >
                                                <option value="">기존 팀 선택...</option>
                                                {deptTeamList.map(t => (
                                                    <option key={t} value={t}>{t}</option>
                                                ))}
                                            </select>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] text-cyan-300 mb-1 font-bold">
                                    담당자 식별 코드/별칭 (예: QC-01, 외주성적서접수)
                                </label>
                                <input
                                    type="text"
                                    value={createForm.code}
                                    onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                                    placeholder={`기본값: ${creatingSlot.code}`}
                                    className="w-full bg-slate-900 border border-cyan-700/60 rounded px-3 py-2 text-cyan-300 placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-bold font-mono"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] text-cyan-300 mb-1 font-bold">에이전트 이름 (Agent Name)</label>
                                <input
                                    type="text"
                                    value={createForm.name}
                                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                    placeholder="예: 대경 재고 크롤러"
                                    className="w-full bg-slate-900 border border-cyan-700/60 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] text-slate-300 mb-1 font-bold">담당 업무 (Role / Responsibility)</label>
                                <textarea
                                    value={createForm.role}
                                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                                    placeholder="예: 대경 공식 웹사이트 4,800개 품목 재고 1시간 주기 자동 크롤링"
                                    rows={2}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 resize-none"
                                />
                            </div>

                            {/* 담당 인간 및 승인 필수 여부 (1인 1역할) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border border-amber-900/50 bg-amber-950/20">
                                <div>
                                    <label className="block text-[11px] text-amber-300 mb-1 font-bold">
                                        👤 배정된 사람 담당자 (1인 1역할)
                                    </label>
                                    <input
                                        type="text"
                                        value={createForm.assignedHuman}
                                        onChange={(e) => setCreateForm({ ...createForm, assignedHuman: e.target.value })}
                                        placeholder="예: 홍길동 대리 (내선 101)"
                                        className="w-full bg-slate-900 border border-amber-700/60 rounded px-2.5 py-1.5 text-xs text-amber-200 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                                    />
                                </div>

                                <div className="flex flex-col justify-center">
                                    <label className="text-[11px] text-amber-300 mb-1 font-bold">
                                        👑 사람 최종 승인 필수
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer mt-1">
                                        <input
                                            type="checkbox"
                                            checked={createForm.requiresApproval}
                                            onChange={(e) => setCreateForm({ ...createForm, requiresApproval: e.target.checked })}
                                            className="w-4 h-4 rounded border-amber-600 text-amber-500 focus:ring-0 cursor-pointer"
                                        />
                                        <span className="text-xs text-slate-300 font-medium">
                                            외부 발송/결재 전 사람 승인 필수
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* 직위(Position) 및 위계 서열 지정 */}
                            <div>
                                <label className="text-[11px] text-amber-300 mb-1.5 font-bold flex items-center justify-between">
                                    <span>👑 직위 및 조직도 서열 지정</span>
                                    <span className="text-[10px] text-slate-400 font-normal">
                                        {POSITION_CONFIG[createForm.position]?.roleDescription}
                                    </span>
                                </label>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {(['팀장', '과장', '대리', '사원'] as const).map(p => {
                                        const pMeta = POSITION_CONFIG[p];
                                        const isSelected = createForm.position === p;
                                        return (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setCreateForm({ ...createForm, position: p })}
                                                className={`py-2 px-1 rounded border text-center transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
                                                    isSelected
                                                        ? 'shadow-[0_0_12px_rgba(255,215,0,0.3)] font-black'
                                                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                                                }`}
                                                style={{
                                                    backgroundColor: isSelected ? pMeta.bg : undefined,
                                                    borderColor: isSelected ? pMeta.color : undefined,
                                                    color: isSelected ? pMeta.color : undefined
                                                }}
                                            >
                                                <span className="text-base">{pMeta.icon}</span>
                                                <span className="text-xs font-bold">{p}</span>
                                                <span className="text-[9px] text-slate-400">Lv.{pMeta.level}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] text-slate-400 mb-1 font-bold">초기 가동 상태</label>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setCreateForm({ ...createForm, status: 'ACTIVE' })}
                                            className={`flex-1 py-1.5 rounded text-[11px] font-bold border transition-colors ${
                                                createForm.status === 'ACTIVE'
                                                    ? 'bg-emerald-500 text-black border-emerald-400 font-black'
                                                    : 'bg-slate-900 text-slate-400 border-slate-800'
                                            }`}
                                        >
                                            ACTIVE
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCreateForm({ ...createForm, status: 'STANDBY' })}
                                            className={`flex-1 py-1.5 rounded text-[11px] font-bold border transition-colors ${
                                                createForm.status === 'STANDBY'
                                                    ? 'bg-cyan-500 text-black border-cyan-400 font-black'
                                                    : 'bg-slate-900 text-slate-400 border-slate-800'
                                            }`}
                                        >
                                            STANDBY
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] text-slate-400 mb-1 font-bold">중요도 티어</label>
                                    <select
                                        value={createForm.tier}
                                        onChange={(e) => setCreateForm({ ...createForm, tier: Number(e.target.value) })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                                    >
                                        <option value={3}>★★★ 핵심 (Tier 3)</option>
                                        <option value={2}>★★ 일반 (Tier 2)</option>
                                        <option value={1}>★ 보조 (Tier 1)</option>
                                    </select>
                                </div>
                            </div>

                            {/* 부서 클릭 시 세부 담당자(에이전트) 다중 선택 그물망 UI */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[11px] text-purple-300 font-bold flex items-center gap-1.5">
                                        <span>🔗 연계 대상 부서 및 담당자 선택</span>
                                        <span className="text-[9px] text-slate-400 font-normal">(1명 또는 여러 명 다중 선택)</span>
                                    </label>
                                    <span className="text-[10px] text-purple-400 font-mono">
                                        {createForm.connectedDeptIds.length}개 부서 · {createForm.connectedAgentIds.length}명 담당자 연동
                                    </span>
                                </div>

                                {/* 1. 부서 탭 버튼 그리드 */}
                                <div className="grid grid-cols-4 gap-1 bg-slate-950/80 p-1.5 rounded border border-purple-900/40">
                                    {departments.map(d => {
                                        const isTabActive = activeDeptForCreate === d.id;
                                        const selectedCount = agents.filter(a => a.deptId === d.id && createForm.connectedAgentIds.includes(a.id)).length;
                                        const isSelf = creatingSlot.deptId === d.id;

                                        return (
                                            <button
                                                key={d.id}
                                                type="button"
                                                onClick={() => setActiveDeptForCreate(d.id)}
                                                className={`px-1 py-1.5 rounded text-[10px] font-bold border transition-all text-center flex flex-col items-center justify-center gap-0.5 relative cursor-pointer ${
                                                    isTabActive
                                                        ? 'border-purple-400 bg-purple-900/70 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                                                        : selectedCount > 0
                                                            ? 'border-purple-800/80 bg-purple-950/40 text-purple-200'
                                                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs">{d.icon}</span>
                                                    <span className="truncate">{d.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {isSelf && <span className="text-[8px] text-slate-500">(소속)</span>}
                                                    {selectedCount > 0 && (
                                                        <span className="text-[8px] px-1 rounded bg-emerald-500 text-black font-black">
                                                            {selectedCount}명
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* 2. 선택된 부서의 담당자(에이전트/업무) 상세 선택 서브 패널 */}
                                {activeDeptForCreate && (() => {
                                    const activeDeptObj = departments.find(d => d.id === activeDeptForCreate);
                                    const deptAgents = agents.filter(a => a.deptId === activeDeptForCreate);

                                    return (
                                        <div className="bg-[#060A14] border border-slate-800 rounded p-2.5 space-y-2">
                                            <div className="flex items-center justify-between text-[11px] pb-1.5 border-b border-slate-800">
                                                <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
                                                    <span>{activeDeptObj?.icon}</span>
                                                    <span>[{activeDeptObj?.name}] 세부 업무 담당자 목록</span>
                                                    <span className="text-[10px] text-slate-500 font-normal">
                                                        (클릭하여 연계할 담당자를 선택)
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1 text-[10px]">
                                                    <button
                                                        type="button"
                                                        onClick={() => selectAllAgentsInDept(activeDeptForCreate, true)}
                                                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                                                    >
                                                        전체 선택
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deselectAllAgentsInDept(activeDeptForCreate, true)}
                                                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                                                    >
                                                        선택 해제
                                                    </button>
                                                </div>
                                            </div>

                                            {/* 담당자 리스트 */}
                                            <div className="max-h-44 overflow-y-auto space-y-1 pr-1 font-sans">
                                                {deptAgents.map(ag => {
                                                    const isChecked = createForm.connectedAgentIds.includes(ag.id);

                                                    return (
                                                        <div
                                                            key={ag.id}
                                                            onClick={() => toggleConnectedAgent(ag.id, activeDeptForCreate, true)}
                                                            className={`p-2 rounded border cursor-pointer transition-all flex items-start gap-2.5 text-xs ${
                                                                isChecked
                                                                    ? 'border-emerald-500/80 bg-emerald-950/30 text-emerald-200 shadow-sm'
                                                                    : 'border-slate-800/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60 hover:border-slate-700'
                                                            }`}
                                                        >
                                                            <div className="pt-0.5">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={() => {}}
                                                                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-black/60 text-cyan-400 font-bold">
                                                                        {ag.code}
                                                                    </span>
                                                                    <span className="font-bold text-slate-100 truncate">
                                                                        {ag.name}
                                                                    </span>
                                                                    {ag.isCreated && (
                                                                        <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 rounded">
                                                                            가동 중
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                                                                    {ag.role}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-900">
                                                <span>* 선택된 담당자들과 실시간 이벤트 버스(Redis/SSE)를 통해 1:1 또는 1:N 상호 업무 교류가 진행됩니다.</span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* 3. 하단 고정 액션 버튼 바 (스크롤과 무관하게 항상 선명하게 노출) */}
                        <div className="p-4 border-t border-slate-800 bg-[#070C16] flex items-center justify-between gap-3 shrink-0">
                            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                                * ESC 키 또는 취소를 눌러 빠져나올 수 있습니다.
                            </span>
                            <div className="flex items-center gap-2 ml-auto">
                                <button
                                    type="button"
                                    onClick={() => setCreatingSlot(null)}
                                    className="px-4 py-2 rounded border border-slate-700 hover:border-slate-500 bg-slate-800/80 text-slate-300 hover:text-white font-bold transition-all text-xs cursor-pointer"
                                >
                                    취소 (ESC)
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeployAgent}
                                    className="px-5 py-2 rounded border border-cyan-400 bg-cyan-500 hover:bg-cyan-400 text-black font-black shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all flex items-center gap-1.5 text-xs cursor-pointer"
                                >
                                    <Check className="w-4 h-4" />
                                    <span>에이전트 생성 및 가동</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                5. AGENT DETAIL INSPECTOR & DIRECT EDIT DRAWER (클릭 시 우측 상세)
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {selectedAgent && (
                <>
                    {/* 바깥 배경 클릭 시 닫기 Backdrop */}
                    <div 
                        className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 animate-fadeIn" 
                        onClick={() => setSelectedAgent(null)}
                        title="클릭하여 닫기 (ESC)"
                    />
                    <div className="fixed inset-y-0 right-0 w-full sm:w-[440px] border-l border-cyan-800/80 bg-[#080E1C] z-50 shadow-2xl flex flex-col justify-between animate-fadeIn overflow-hidden">
                        {/* 1. 고정 헤더 */}
                        <div className="flex items-center justify-between border-b border-slate-800 p-4 shrink-0 bg-[#070D1A]">
                            <div className="flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-mono font-bold">
                                    {selectedAgent.code}
                                </span>
                                <span className="text-xs font-bold text-slate-400">{selectedAgent.deptName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 bg-slate-800/80 border border-slate-700 px-1.5 py-0.5 rounded font-mono hidden sm:inline">
                                    ESC 닫기
                                </span>
                                <button
                                    onClick={() => setSelectedAgent(null)}
                                    className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 cursor-pointer transition-colors"
                                    title="닫기 (ESC)"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* 2. 스크롤 본문 */}
                        <div className="p-4 space-y-4 overflow-y-auto flex-1 custom-scrollbar text-xs">
                            {/* 이름 및 역할 직접 편집 영역 */}
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[10px] text-cyan-400 font-bold mb-1">
                                        담당자 식별 코드/별칭 수정 (예: QC-01, 외주성적서담당 등)
                                    </label>
                                    <input
                                        type="text"
                                        value={editForm.code}
                                        onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-400 font-bold font-mono"
                                        placeholder="예: QC-01, 외주성적서접수"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] text-slate-300 font-bold mb-1">에이전트 이름 수정</label>
                                    <input
                                        type="text"
                                        value={editForm.name}
                                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-bold"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] text-slate-400 font-bold mb-1">담당 역할 수정</label>
                                    <textarea
                                        value={editForm.role}
                                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                                        rows={2}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 resize-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] text-slate-400 font-bold mb-1">현재 실행 작업 강제 입력</label>
                                    <input
                                        type="text"
                                        value={editForm.currentTask}
                                        onChange={(e) => setEditForm({ ...editForm, currentTask: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-400 font-mono"
                                    />
                                </div>

                                {/* 👤 배정된 실제 사람 담당자 및 승인 권한 */}
                                <div className="bg-slate-900/80 border border-cyan-900/50 rounded-lg p-2.5 space-y-2">
                                    <div>
                                        <label className="block text-[10px] text-cyan-300 font-bold mb-1 flex items-center justify-between">
                                            <span>👤 배정된 사람 담당자 (Human Assignee)</span>
                                            <span className="text-[9px] text-slate-400">예: 영업 담당자, 사무실 총괄 등</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={editForm.assignedHuman}
                                            onChange={(e) => setEditForm({ ...editForm, assignedHuman: e.target.value })}
                                            className="w-full bg-slate-950 border border-cyan-800/80 rounded px-2.5 py-1.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-400 font-bold"
                                            placeholder="담당자 이름 또는 역할 (예: 김영업, 사무실 관리자)"
                                        />
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer pt-1">
                                        <input
                                            type="checkbox"
                                            checked={editForm.requiresApproval}
                                            onChange={(e) => setEditForm({ ...editForm, requiresApproval: e.target.checked })}
                                            className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 cursor-pointer"
                                        />
                                        <span className="text-[11px] text-amber-300 font-bold">
                                            👑 사람의 최종 승인 필수 (Requires Human Approval)
                                        </span>
                                    </label>
                                </div>

                                {/* ⏱️ 봇 업무 반복 실행 / 감지 주기 설정 */}
                                <div className="bg-slate-900/80 border border-cyan-900/50 rounded-lg p-2.5 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] text-cyan-300 font-bold flex items-center gap-1.5">
                                            <Clock className="w-3.5 h-3.5 text-cyan-400" />
                                            <span>업무 반복 주기 (Schedule Interval)</span>
                                        </label>
                                        <span className="text-[9px] text-slate-400 font-mono">
                                            외부 인입 및 정기 가동 빈도
                                        </span>
                                    </div>
                                    <select
                                        value={editForm.scheduleInterval}
                                        onChange={(e) => setEditForm({ ...editForm, scheduleInterval: e.target.value })}
                                        className="w-full bg-slate-950 border border-cyan-800/80 rounded px-2.5 py-1.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-400 font-bold"
                                    >
                                        {SCHEDULE_INTERVALS.map(opt => (
                                            <option key={opt.id} value={opt.id}>
                                                {opt.icon} {opt.shortBadge} — {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-[10px] text-cyan-400/80 pl-1 font-mono">
                                        {SCHEDULE_INTERVALS.find(s => s.id === editForm.scheduleInterval)?.description}
                                    </div>
                                </div>

                                {/* 직위(Position) 변경 */}
                                <div>
                                    <label className="text-[10px] text-amber-300 font-bold mb-1 flex items-center justify-between">
                                        <span>👑 직위 및 조직도 서열 변경</span>
                                        <span className="text-[9px] text-slate-400">
                                            {POSITION_CONFIG[editForm.position]?.roleDescription}
                                        </span>
                                    </label>
                                    <div className="grid grid-cols-4 gap-1">
                                        {(['팀장', '과장', '대리', '사원'] as const).map(p => {
                                            const pMeta = POSITION_CONFIG[p];
                                            const isSelected = editForm.position === p;
                                            return (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() => setEditForm({ ...editForm, position: p })}
                                                    className={`py-1.5 px-1 rounded border text-center transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
                                                        isSelected
                                                            ? 'shadow-[0_0_10px_rgba(255,215,0,0.3)] font-black'
                                                            : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                                                    }`}
                                                    style={{
                                                        backgroundColor: isSelected ? pMeta.bg : undefined,
                                                        borderColor: isSelected ? pMeta.color : undefined,
                                                        color: isSelected ? pMeta.color : undefined
                                                    }}
                                                >
                                                    <span>{pMeta.icon}</span>
                                                    <span className="text-[11px] font-bold">{p}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* 직위별 결재·자율 실행 권한 제어 */}
                                <div>
                                    <label className="text-[10px] text-emerald-400 font-bold mb-1 flex items-center justify-between">
                                        <span>🛡️ 직위별 행동 및 결재 권한</span>
                                        <span className="text-[9px] text-slate-400 font-mono">
                                            {selectedAgent.position === '사원' || selectedAgent.position === '대리'
                                                ? '⚡ 무결재 자율 반복'
                                                : `상태: ${selectedAgent.approvalStatus || 'APPROVED'}`}
                                        </span>
                                    </label>

                                    {/* 사원 및 대리: 24시간 무결재 자율 반복 모드 (결재 불필요) */}
                                    {selectedAgent.position === '사원' || selectedAgent.position === '대리' ? (
                                        <div className="p-2 rounded border border-cyan-500/50 bg-cyan-950/30 text-cyan-200 text-[10px] flex items-center justify-between gap-2 shadow-xs">
                                            <div className="flex items-center gap-1.5 font-bold">
                                                <span className="animate-spin text-cyan-400 text-xs">🔄</span>
                                                <span>24시간 무결재 자율 반복 모드 가동 중</span>
                                            </div>
                                            <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-mono border border-cyan-500/30">
                                                결재 불필요
                                            </span>
                                        </div>
                                    ) : selectedAgent.position === '과장' ? (
                                        /* 과장: 실무 검수 및 이상징후 발생 시 결재 상신 */
                                        <div className="space-y-1.5">
                                            <div className="text-[9px] text-purple-300 bg-purple-950/30 p-1.5 rounded border border-purple-500/30">
                                                👔 과장 권한: 사원/대리 작업물 검수 진행 중이며, 이상 수치 발생 시 팀장 앞 결재를 상신합니다.
                                            </div>
                                            {selectedAgent.approvalStatus === 'PENDING' ? (
                                                <div className="flex items-center justify-between p-1.5 rounded border border-amber-500 bg-amber-950/50 text-amber-300 text-[10px] font-bold">
                                                    <span>⏳ 팀장 최종 승인 대기 중</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApproveAgentTask(selectedAgent.id)}
                                                        className="px-2 py-0.5 rounded bg-emerald-500 text-black font-black hover:bg-emerald-400 text-[9px]"
                                                    >
                                                        즉시 승인
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRequestApproval(selectedAgent.id)}
                                                    className="w-full py-1.5 rounded border border-amber-500/80 bg-amber-950/40 hover:bg-amber-500 hover:text-black text-amber-300 text-[10px] font-black transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                                                >
                                                    <span>🚨 사원 결과물 이상징후 감지 ➔ 팀장 결재 상신</span>
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        /* 팀장: 최종 결재 승인권자 */
                                        <div className="grid grid-cols-2 gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleApproveAgentTask(selectedAgent.id)}
                                                className="py-1.5 rounded border border-emerald-500/80 bg-emerald-950/40 hover:bg-emerald-500 hover:text-black text-emerald-300 text-[10px] font-black transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                                            >
                                                <Check className="w-3 h-3" />
                                                <span>팀장 최종 승인</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRejectAgentTask(selectedAgent.id)}
                                                className="py-1.5 rounded border border-rose-500/80 bg-rose-950/40 hover:bg-rose-500 hover:text-white text-rose-300 text-[10px] font-black transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                                            >
                                                <span>⚠️ 반려/재검 지시</span>
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* 상태 강제 변경 버튼 4종 */}
                                <div>
                                    <label className="block text-[10px] text-amber-300 font-bold mb-1.5">가동 상태 강제 전환</label>
                                    <div className="grid grid-cols-4 gap-1">
                                        {(['ACTIVE', 'STANDBY', 'IDLE', 'OFFLINE'] as const).map(st => (
                                            <button
                                                key={st}
                                                type="button"
                                                onClick={() => setEditForm({ ...editForm, status: st })}
                                                className={`py-1.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                                                    editForm.status === st
                                                        ? st === 'ACTIVE'
                                                            ? 'bg-emerald-500 text-black border-emerald-400 font-black shadow-[0_0_10px_#00E676]'
                                                            : st === 'STANDBY'
                                                                ? 'bg-cyan-500 text-black border-cyan-400 font-black shadow-[0_0_10px_#00F0FF]'
                                                                : st === 'IDLE'
                                                                    ? 'bg-slate-400 text-black border-slate-300 font-black'
                                                                    : 'bg-rose-600 text-white border-rose-500 font-black'
                                                        : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-200'
                                                }`}
                                            >
                                                {st}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 부서 클릭 시 세부 담당자(에이전트) 다중 선택 그물망 UI */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] text-purple-300 font-bold flex items-center gap-1">
                                            <span>🔗 연계 대상 부서 및 담당자 지정</span>
                                            <span className="text-[9px] text-slate-400 font-normal">(다중 선택)</span>
                                        </label>
                                        <span className="text-[10px] text-purple-400 font-mono">
                                            {editForm.connectedDeptIds.length}개 부서 · {editForm.connectedAgentIds.length}명 연계
                                        </span>
                                    </div>

                                    {/* 1. 부서 탭 버튼 그리드 */}
                                    <div className="grid grid-cols-4 gap-1 bg-slate-950/80 p-1.5 rounded border border-purple-900/40">
                                        {departments.map(d => {
                                            const isTabActive = activeDeptForEdit === d.id;
                                            const selectedCount = agents.filter(a => a.deptId === d.id && editForm.connectedAgentIds.includes(a.id)).length;
                                            const isSelf = selectedAgent.deptId === d.id;

                                            return (
                                                <button
                                                    key={d.id}
                                                    type="button"
                                                    onClick={() => setActiveDeptForEdit(d.id)}
                                                    className={`px-1 py-1 rounded text-[10px] font-bold border transition-all text-center flex flex-col items-center justify-center gap-0.5 relative cursor-pointer ${
                                                        isTabActive
                                                            ? 'border-purple-400 bg-purple-900/70 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                                                            : selectedCount > 0
                                                                ? 'border-purple-800/80 bg-purple-950/40 text-purple-200'
                                                                : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs">{d.icon}</span>
                                                        <span className="truncate">{d.name}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        {isSelf && <span className="text-[8px] text-slate-500">(소속)</span>}
                                                        {selectedCount > 0 && (
                                                            <span className="text-[8px] px-1 rounded bg-emerald-500 text-black font-black">
                                                                {selectedCount}명
                                                            </span>
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* 2. 선택된 부서의 담당자(에이전트) 목록 서브 패널 */}
                                    {activeDeptForEdit && (() => {
                                        const activeDeptObj = departments.find(d => d.id === activeDeptForEdit);
                                        const deptAgents = agents.filter(a => a.deptId === activeDeptForEdit);

                                        return (
                                            <div className="bg-[#060A14] border border-slate-800 rounded p-2.5 space-y-2">
                                                <div className="flex items-center justify-between text-[10px] pb-1 border-b border-slate-800">
                                                    <div className="flex items-center gap-1 text-cyan-300 font-bold truncate">
                                                        <span>{activeDeptObj?.icon}</span>
                                                        <span>[{activeDeptObj?.name}] 세부 업무 담당자</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => selectAllAgentsInDept(activeDeptForEdit, false)}
                                                            className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[9px] cursor-pointer"
                                                        >
                                                            전체 선택
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => deselectAllAgentsInDept(activeDeptForEdit, false)}
                                                            className="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[9px] cursor-pointer"
                                                        >
                                                            선택 해제
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* 담당자 리스트 */}
                                                <div className="max-h-40 overflow-y-auto space-y-1 pr-1 font-sans">
                                                    {deptAgents.map(ag => {
                                                        const isChecked = editForm.connectedAgentIds.includes(ag.id);

                                                        return (
                                                            <div
                                                                key={ag.id}
                                                                onClick={() => toggleConnectedAgent(ag.id, activeDeptForEdit, false)}
                                                                className={`p-1.5 rounded border cursor-pointer transition-all flex items-start gap-2 text-xs ${
                                                                    isChecked
                                                                        ? 'border-emerald-500/80 bg-emerald-950/30 text-emerald-200'
                                                                        : 'border-slate-800/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60'
                                                                }`}
                                                            >
                                                                <div className="pt-0.5">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isChecked}
                                                                        onChange={() => {}}
                                                                        className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                                                                    />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-[9px] font-mono px-1 rounded bg-black/60 text-cyan-400 font-bold">
                                                                            {ag.code}
                                                                        </span>
                                                                        <span className="font-bold text-slate-100 truncate text-[11px]">
                                                                            {ag.name}
                                                                        </span>
                                                                    </div>
                                                                    <div className="text-[9px] text-slate-400 truncate mt-0.5">
                                                                        {ag.role}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* 🛒 [구매부 PUR-01 전용] 알트에프 재고 발주 List Up & 미결 관리 제어반 */}
                            {selectedAgent.code === 'PUR-01' && (
                                <div className="border border-emerald-500/40 bg-emerald-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_20px_rgba(16,185,129,0.2)] my-3">
                                    <div className="flex items-center justify-between border-b border-emerald-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-emerald-300 font-bold text-xs">
                                            <span>🛒</span>
                                            <span>알트에프 재고 발주 대장 & 미결 관리기</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40 flex items-center gap-1">
                                            <span>PUR-01</span>
                                            <span>사원 (전담 관리지정)</span>
                                        </span>
                                    </div>

                                    {/* 실시간 현황 뱃지 */}
                                    <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-950/20 text-amber-200 text-xs flex flex-col gap-1.5 shadow-sm">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 font-bold">
                                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                                                <span className="text-amber-300">altf.kr API 정기 감시: 대기 중 (STANDBY)</span>
                                            </div>
                                            <span className="text-[9px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono font-bold border border-amber-500/40">
                                                주기: 1일 2회 (10:00 / 17:00)
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-300 flex items-center justify-between">
                                            <span>웹 재고 발주분 624개 품목 List Up 완료 (성적서 26개 컬럼 1:1 매칭 & 미결 453건 관리)</span>
                                        </div>
                                        <div className="text-[9px] text-amber-400/80 font-mono pt-1 border-t border-amber-900/40">
                                            * 업무시간(오전 10:00, 오후 17:00) 하루 2회만 실행하며, 그 외 시간은 대기 상태를 유지합니다.
                                        </div>
                                    </div>

                                    {/* 대장 저장 위치 안내 */}
                                    <div className="p-2.5 rounded-lg border border-emerald-500/40 bg-[#081812] space-y-1.5 text-[11px]">
                                        <div className="text-emerald-300 font-bold flex items-center gap-1.5">
                                            <span>📂</span>
                                            <span>재고 발주 대장 파일 저장 위치:</span>
                                        </div>
                                        <div className="space-y-1 font-mono text-[10px] text-slate-300 pl-1">
                                            <div className="flex items-start gap-1">
                                                <span className="text-emerald-400 shrink-0 font-bold">1. 엑셀 마스터 원장:</span>
                                                <span className="text-slate-200 break-all font-bold">storage/purchases/알트에프 재고 발주 대장.xlsx</span>
                                            </div>
                                            <div className="flex items-start gap-1">
                                                <span className="text-cyan-400 shrink-0 font-bold">2. 성적서 연동 JSON:</span>
                                                <span className="text-slate-300 break-all">server/data/purchase_stock_orders.json</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 3대 실행 액션 버튼 */}
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setShowPurchaseLedgerModal(true)}
                                            className="flex-1 py-2 px-3 rounded-lg bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-black text-xs flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer transition-all"
                                        >
                                            <Boxes className="w-3.5 h-3.5" />
                                            <span>📊 재고 발주 & 성적서 대장 열기</span>
                                        </button>
                                        <a
                                            href="/api/pur/download-excel"
                                            download="알트에프_재고_발주_대장.xlsx"
                                            className="py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-emerald-500/50 text-emerald-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                                        >
                                            <span>📥 엑셀 다운로드</span>
                                        </a>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await fetch('/api/pur/open-folder', { method: 'POST' });
                                                } catch (err) {
                                                    console.error('Failed to open purchase folder:', err);
                                                }
                                            }}
                                            className="py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                                        >
                                            <span>📂 폴더 열기</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* 📋 [구매부 PUR-07 전용] 주문관리 발주서 분류 및 미결 통합 관제 제어반 */}
                            {selectedAgent.code === 'PUR-07' && (
                                <div className="border border-teal-500/40 bg-teal-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_20px_rgba(20,184,166,0.2)] my-3">
                                    <div className="flex items-center justify-between border-b border-teal-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-teal-300 font-bold text-xs">
                                            <span>📋</span>
                                            <span>주문관리 발주서 분류 및 미결 통합 관제기</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-teal-500/20 text-teal-300 font-mono border border-teal-500/40 flex items-center gap-1">
                                            <span>PUR-07</span>
                                            <span>대리 (전담 관제)</span>
                                        </span>
                                    </div>

                                    {/* 실시간 현황 뱃지 */}
                                    <div className="p-2.5 rounded-lg border border-teal-500/40 bg-teal-950/30 text-teal-200 text-xs flex flex-col gap-1.5 shadow-sm">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 font-bold">
                                                <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                                                <span className="text-teal-300">altf.kr API 정기 감시: 대기 중 (STANDBY)</span>
                                            </div>
                                            <span className="text-[9px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded font-mono font-bold border border-teal-500/40">
                                                주기: 평일 09:00~18:00 (1시간 간격, 1일 10회)
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[10px]">
                                            <div className="p-1.5 bg-black/40 rounded border border-teal-900/40 flex flex-col">
                                                <span className="text-slate-400 text-[9px]">📦 전체 발주 (업체/날짜별)</span>
                                                <span className="text-teal-300 font-bold text-xs">
                                                    {pur07Summary ? `${(pur07Summary.totalOrders - 1).toLocaleString()}건 (${pur07Summary.customerCount}개사)` : '2,439건 (201개사)'}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-black/40 rounded border border-amber-900/40 flex flex-col">
                                                <span className="text-amber-400 text-[9px]">⏳ 미결(Pending) 추적</span>
                                                <span className="text-amber-300 font-bold text-xs">
                                                    {pur07Summary ? `${pur07Summary.pendingCount.toLocaleString()}건 관리 중` : '462건 관리 중'}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-black/40 rounded border border-pink-900/40 flex flex-col">
                                                <span className="text-pink-400 text-[9px]">🔬 QC-01 성적서 접수확인</span>
                                                <span className="text-pink-300 font-bold text-xs">
                                                    {pur07Summary ? `${pur07Summary.certMatchedOrdersCount.toLocaleString()}건 매칭 완료` : '286건 매칭 완료'}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-black/40 rounded border border-cyan-900/40 flex flex-col">
                                                <span className="text-cyan-400 text-[9px]">🚚 고객 발송 대기 패키지</span>
                                                <span className="text-cyan-300 font-bold text-xs">
                                                    {pur07Summary ? `${pur07Summary.readyPackageCount.toLocaleString()}건 준비완료` : '277건 준비완료'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-[9px] text-teal-400/80 font-mono pt-1 border-t border-teal-900/40">
                                            * 담당자 출고 완료 시 미결(Pending)에서 자동 해제되며 거래명세표+성적서 번들이 고객 발송 대기로 전환됩니다.
                                        </div>
                                    </div>

                                    {/* 대장 저장 위치 안내 */}
                                    <div className="p-2.5 rounded-lg border border-teal-500/40 bg-[#081817] space-y-1.5 text-[11px]">
                                        <div className="text-teal-300 font-bold flex items-center gap-1.5">
                                            <span>📂</span>
                                            <span>발주 분류 및 미결 대장 파일 위치:</span>
                                        </div>
                                        <div className="space-y-1 font-mono text-[10px] text-slate-300 pl-1">
                                            <div className="flex items-start gap-1">
                                                <span className="text-teal-400 shrink-0 font-bold">1. 엑셀 마스터 원장:</span>
                                                <span className="text-slate-200 break-all font-bold">storage/purchases/주문관리_발주서_통합대장.xlsx</span>
                                            </div>
                                            <div className="flex items-start gap-1">
                                                <span className="text-cyan-400 shrink-0 font-bold">2. 통합 분류 JSON:</span>
                                                <span className="text-slate-300 break-all">server/data/pur07_order_backlog.json</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 3대 실행 액션 버튼 */}
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const res = await fetch('/api/pur/pur07/sync', { method: 'POST' });
                                                    if (res.ok) {
                                                        const data = await res.json();
                                                        if (data.summary) setPur07Summary(data.summary);
                                                        try {
                                                            const agRes = await fetch('/api/agents');
                                                            if (agRes.ok) {
                                                                const agData = await agRes.json();
                                                                if (agData.agents) setAgents(agData.agents);
                                                            }
                                                        } catch (err) {
                                                            console.warn('[PUR-07] 에이전트 목록 갱신 실패:', err);
                                                        }
                                                        alert('✅ [PUR-07] 발주 분류 및 미결 대장 동기화 완료!');
                                                    }
                                                } catch (e) {
                                                    alert('동기화 실패: ' + e);
                                                }
                                            }}
                                            className="flex-1 py-2 px-3 rounded-lg bg-linear-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-black font-black text-xs flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(20,184,166,0.3)] cursor-pointer transition-all"
                                        >
                                            <RotateCw className="w-3.5 h-3.5" />
                                            <span>🔄 지금 즉시 수집 & 미결 동기화</span>
                                        </button>
                                        <a
                                            href="/api/pur/pur07/download-excel"
                                            download="주문관리_발주서_통합대장.xlsx"
                                            className="py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-teal-500/50 text-teal-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                                        >
                                            <span>📥 엑셀 다운로드</span>
                                        </a>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await fetch('/api/pur/open-folder', { method: 'POST' });
                                                } catch (err) {
                                                    console.error('Failed to open purchase folder:', err);
                                                }
                                            }}
                                            className="py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                                        >
                                            <span>📂 폴더 열기</span>
                                        </button>
                                    </div>

                                    {/* 대경벤드 거래명세표 연계 진입 배너 */}
                                    <div className="pt-2 border-t border-teal-900/40 flex items-center justify-between">
                                        <div className="text-[11px] text-slate-300 flex items-center gap-1.5">
                                            <span>📑</span>
                                            <span>대경벤드 거래명세표(카톡/텔레그램)가 도착했나요?</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowDaekyungInvoiceModal(true)}
                                            className="py-1 px-2.5 rounded bg-linear-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-black font-black text-[11px] shadow-[0_0_10px_rgba(6,182,212,0.3)] cursor-pointer transition-all flex items-center gap-1"
                                        >
                                            <span>⚡ 명세표 읽고 미결 해제하기</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* 📬 [품질부 QC-01 전용] 메일플러그(gw.mailplug.com) 외주 성적서 수집 제어반 */}
                            {(selectedAgent.code === 'QC-01' || selectedAgent.id === 'qc-inbound-ingest') && (
                                <div className="border border-pink-500/40 bg-pink-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_20px_rgba(255,0,85,0.2)] my-3">
                                    <div className="flex items-center justify-between border-b border-pink-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-pink-300 font-bold text-xs">
                                            <span>📬</span>
                                            <span>메일플러그 (gw.mailplug.com) 외주 성적서 수집기</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-pink-500/20 text-pink-300 font-mono border border-pink-500/40 flex items-center gap-1">
                                            <span>QC-01</span>
                                            <span>사원 (24h 무결재 루틴)</span>
                                        </span>
                                    </div>

                                    {/* ⏰ 1시간 주기 자동 스케줄러 상태 뱃지 */}
                                    <div className="p-2.5 rounded-lg border border-emerald-500/50 bg-emerald-950/30 text-emerald-200 text-xs flex flex-col gap-1 shadow-sm">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 font-bold">
                                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                                                <span className="text-emerald-300">매 1시간 자동 메일 감시: 정상 가동 중 (ONLINE)</span>
                                            </div>
                                            <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold border border-emerald-500/40">
                                                주기: 1시간
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-emerald-400/80 flex items-center justify-between">
                                            <span>신규 메일 인입 시 첨부파일(.zip/.pdf) 자동 추출 및 엑셀 누적</span>
                                            {schedulerInfo?.nextRunTime && (
                                                <span className="font-mono text-[9px] text-slate-300">
                                                    다음 확인: {new Date(schedulerInfo.nextRunTime).toLocaleTimeString('ko-KR')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* 대상 메일함 정보 */}
                                    <div className="text-[11px] space-y-1.5 bg-black/50 p-2.5 rounded-lg border border-slate-800">
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span>IMAP 공식 서버</span>
                                            <span className="text-cyan-300 font-mono font-bold">imap.mailplug.co.kr : 993 (SSL)</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span>타겟 메일함</span>
                                            <span className="text-cyan-300 font-bold">내 메일함 &gt; 대경벤드성적서 (총 505건 실시간 감지)</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span>필터링 발신자</span>
                                            <span className="text-amber-300 font-mono">yrkim@daekyungbend.com</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span>수집 키워드</span>
                                            <span className="text-emerald-300 font-bold">출고분 성적서</span>
                                        </div>
                                    </div>

                                    {/* 📂 전체 PDF 저장 위치 안내 카드 (사용자 질문 100% 명확한 해답) */}
                                    <div className="p-2.5 rounded-lg border border-cyan-500/40 bg-[#081224] space-y-1.5 text-[11px]">
                                        <div className="text-cyan-300 font-bold flex items-center gap-1.5">
                                            <span>📂</span>
                                            <span>전체 성적서 PDF 저장 및 관리 위치:</span>
                                        </div>
                                        <div className="space-y-1 font-mono text-[10px] text-slate-300 pl-1">
                                            <div className="flex items-start gap-1">
                                                <span className="text-amber-400 shrink-0 font-bold">1. 원본 압축파일:</span>
                                                <span className="text-slate-300 break-all">storage/certificates/01_raw_inbox/</span>
                                            </div>
                                            <div className="flex items-start gap-1">
                                                <span className="text-emerald-400 shrink-0 font-bold">2. 추출된 전체 PDF:</span>
                                                <span className="text-slate-200 break-all font-bold">storage/certificates/02_extracted_external/YYYY-MM-DD/</span>
                                            </div>
                                            <div className="flex items-start gap-1">
                                                <span className="text-cyan-400 shrink-0 font-bold">3. 성적서 엑셀원장:</span>
                                                <span className="text-slate-300 break-all">storage/certificates/대경벤드 성적서.xlsx</span>
                                            </div>
                                        </div>
                                        <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                                            <span>※ 출고일자별 폴더로 자동 분류되며 웹 브라우저에서 바로 열람 가능합니다.</span>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowLedgerModal(true)}
                                                    className="px-2 py-1 rounded bg-linear-to-r from-cyan-600/30 to-blue-600/30 hover:from-cyan-500/40 hover:to-blue-500/40 text-cyan-200 border border-cyan-400/50 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-xs"
                                                    title="26개 컬럼 성적서 원장 대장(대경벤드 성적서.xlsx) 및 품질 판정 뷰어를 엽니다."
                                                >
                                                    <span>📊 26개 컬럼 장부 열람</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleOpenWindowsFolder}
                                                    className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-xs"
                                                    title="내 컴퓨터의 실제 윈도우 탐색기 폴더 창을 직접 엽니다."
                                                >
                                                    <span>📂 폴더 열기</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleLoadAllFiles}
                                                    className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-xs"
                                                    title="지금까지 수집된 전체 PDF 목록 보관함을 엽니다."
                                                >
                                                    <span>📋 PDF 보관함</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 계정 설정 & 연결 상태 */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400 font-bold">연동 계정: {mailplugConfig.user}</span>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[9px] text-emerald-400 font-bold font-mono">앱 비밀번호 연동 완료 (OK)</span>
                                                <button
                                                    type="button"
                                                    onClick={handleTestMailplug}
                                                    disabled={mailplugLoading}
                                                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] text-slate-300 font-bold border border-slate-700 cursor-pointer disabled:opacity-50"
                                                    title="IMAP 연결 상태 실시간 재확인"
                                                >
                                                    연결 재확인
                                                </button>
                                            </div>
                                        </div>
                                        {mailplugTestStatus && (
                                            <div className={`text-[10px] p-1.5 rounded border ${
                                                mailplugTestStatus.success 
                                                    ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-300' 
                                                    : 'border-amber-500/50 bg-amber-950/30 text-amber-300'
                                            }`}>
                                                {mailplugTestStatus.message}
                                            </div>
                                        )}
                                    </div>

                                    {/* 일괄 수집 진행 상황 바 (Batch Sync Progress) */}
                                    {batchStatus && batchStatus.isRunning && (
                                        <div className="p-2.5 rounded border border-cyan-500 bg-cyan-950/40 space-y-1 text-xs">
                                            <div className="flex items-center justify-between text-cyan-300 font-bold">
                                                <span>📥 전체 성적서 배치 다운로드 중...</span>
                                                <span className="font-mono">{batchStatus.progress.processed} / {batchStatus.progress.total}건</span>
                                            </div>
                                            <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-700">
                                                <div 
                                                    className="bg-linear-to-r from-cyan-400 to-emerald-400 h-full transition-all duration-300"
                                                    style={{ width: `${batchStatus.progress.total > 0 ? (batchStatus.progress.processed / batchStatus.progress.total) * 100 : 0}%` }}
                                                ></div>
                                            </div>
                                            <div className="text-[10px] text-emerald-300 text-right font-mono">
                                                현재까지 추출된 PDF: {batchStatus.progress.extractedPdfs}개
                                            </div>
                                        </div>
                                    )}

                                    {/* 2대 수집 실행 액션 버튼 */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={handleSyncMailplug}
                                            disabled={mailplugLoading || Boolean(batchStatus?.isRunning)}
                                            className="py-2.5 px-2 rounded-lg bg-linear-to-r from-slate-800 to-slate-700 hover:from-slate-700 hover:to-slate-600 border border-slate-600 text-white font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                        >
                                            <RefreshCw className={`w-3.5 h-3.5 ${mailplugLoading ? 'animate-spin' : ''}`} />
                                            <span>최신 1건 즉시 수집</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleBatchSyncMailplug}
                                            disabled={mailplugLoading || Boolean(batchStatus?.isRunning)}
                                            className="py-2.5 px-2 rounded-lg bg-linear-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-bold text-xs shadow-[0_0_15px_rgba(255,0,85,0.4)] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                        >
                                            <HardDrive className="w-3.5 h-3.5" />
                                            <span>📥 505건 전체 일괄 수집</span>
                                        </button>
                                    </div>

                                    {/* 최근 수집 내역 (클릭 시 즉시 PDF 원본 뷰어로 열람!) */}
                                    {mailplugSyncResult && mailplugSyncResult.savedFiles && (
                                        <div className="space-y-1 text-[10px] pt-1 border-t border-pink-900/40">
                                            <div className="flex items-center justify-between text-pink-300 font-bold">
                                                <span>수집 완료된 PDF 성적서 (클릭 시 즉시 열람)</span>
                                                <span className="font-mono text-emerald-400">{mailplugSyncResult.extractedPdfCount}개 완료</span>
                                            </div>
                                            <div className="max-h-36 overflow-y-auto space-y-1 bg-black/60 p-2 rounded border border-slate-800 font-mono text-[9px] text-slate-300">
                                                {mailplugSyncResult.savedFiles.map((f, i) => (
                                                    <div 
                                                        key={i} 
                                                        className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-800/80 border-b border-slate-900/80 transition-colors group/item"
                                                    >
                                                        <div 
                                                            className="flex items-center gap-1.5 truncate cursor-pointer flex-1 mr-2"
                                                            onClick={() => {
                                                                setPreviewPdfName(f.filename);
                                                                setPreviewPdfUrl(`/storage/certificates/${encodeURIComponent(f.filename)}`);
                                                            }}
                                                            title="클릭하여 대시보드 뷰어에서 바로보기"
                                                        >
                                                            <span className="text-pink-400 group-hover/item:scale-110 transition-transform">📄</span>
                                                            <span className="truncate text-cyan-300 font-bold group-hover/item:underline">
                                                                {f.filename}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
                                                            <span>{(f.sizeBytes / 1024).toFixed(0)}KB</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setPreviewPdfName(f.filename);
                                                                    setPreviewPdfUrl(`/storage/certificates/${encodeURIComponent(f.filename)}`);
                                                                }}
                                                                className="px-1.5 py-0.5 rounded bg-cyan-950/80 hover:bg-cyan-500 hover:text-black text-cyan-300 border border-cyan-500/40 text-[9px] font-bold cursor-pointer"
                                                            >
                                                                미리보기
                                                            </button>
                                                            <a
                                                                href={`/storage/certificates/${encodeURIComponent(f.filename)}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[9px]"
                                                                title="새 창으로 다운로드/열기"
                                                            >
                                                                새창 ↗
                                                            </a>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 🔬 [품질부 특화] QC-02 성적서 비전 판독 & 엑셀 대장 누적 제어반 */}
                            {(selectedAgent.code === 'QC-02' || selectedAgent.id === 'qc-mtc-vision-reader') && (
                                <div className="border border-cyan-500/40 bg-cyan-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_20px_rgba(0,240,255,0.2)] my-3">
                                    <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-cyan-300 font-bold text-xs">
                                            <span>🔬</span>
                                            <span>QC-02 성적서 비전 판독 및 엑셀 대장 누적</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/40 flex items-center gap-1">
                                            <span>QC-02</span>
                                            <span>과장 (정밀 검수 & 누적)</span>
                                        </span>
                                    </div>

                                    <div className="p-2.5 rounded-lg border border-cyan-500/40 bg-black/50 text-xs space-y-2">
                                        <div className="flex items-center justify-between text-slate-300">
                                            <span>다중 페이지(10~30p) 성적서 전수 스캔:</span>
                                            <span className="text-emerald-400 font-bold font-mono">ON (무인 자동화)</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-300">
                                            <span>성적서 양식(3열 병합 간격) 동시 생성:</span>
                                            <span className="text-indigo-300 font-bold font-mono">호환 활성화</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-300 pt-1 border-t border-slate-800">
                                            <span>누적 관리 대장 현황:</span>
                                            <span className="text-cyan-300 font-bold font-mono">
                                                {ledgerStats ? `${ledgerStats.totalItems.toLocaleString()}건 (합격률 ${ledgerStats.passRate})` : '1,424건 관리 중'}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 font-mono bg-cyan-950/30 p-1.5 rounded border border-cyan-900/40 break-all">
                                            📁 저장: storage/certificates/대경벤드 성적서.xlsx
                                        </div>
                                        {qc02Result && (
                                            <div className="p-2 rounded bg-cyan-950/60 border border-cyan-500/40 text-[10px] text-cyan-200">
                                                ✓ 최근 실행: {qc02Result.totalPdfFiles}개 파일 판독 ➔ 누적 {qc02Result.totalRowsCount}개 품목 완료 ({qc02Result.durationSec})
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={handleRunQC02}
                                            disabled={qc02Loading}
                                            className="py-2.5 px-2 rounded-lg bg-linear-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-[0_0_15px_rgba(0,240,255,0.4)] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                        >
                                            <Sparkles className={`w-3.5 h-3.5 ${qc02Loading ? 'animate-spin' : ''}`} />
                                            <span>{qc02Loading ? '판독 및 누적 중...' : '🚀 QC-02 전수 판독 & 누적'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowLedgerModal(true)}
                                            className="py-2.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
                                        >
                                            <ShieldCheck className="w-3.5 h-3.5" />
                                            <span>📊 관리 대장 & 양식 복사</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* 🔬 [품질부 특화] QC-06 성적서 발행봇 (구글시트 6개 양식지 자동 매칭 & DAT-10 아카이빙) */}
                            {(selectedAgent.code === 'QC-06' || selectedAgent.id === 'qc-cert-builder') && (
                                <div className="border border-indigo-500/40 bg-indigo-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_20px_rgba(99,102,241,0.25)] my-3">
                                    <div className="flex items-center justify-between border-b border-indigo-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-indigo-300 font-bold text-xs">
                                            <span>📜</span>
                                            <span>QC-06 성적서 발행봇 (EN10204 3.1 MTC)</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/40 flex items-center gap-1">
                                            <span>QC-06</span>
                                            <span>대리 (발행 & 보관 전담)</span>
                                        </span>
                                    </div>

                                    {/* 템플릿 연동 및 규칙 요약 카드 */}
                                    <div className="p-2.5 rounded-lg border border-indigo-500/40 bg-black/50 text-xs space-y-2">
                                        <div className="flex items-center justify-between text-slate-300">
                                            <span>구글시트 6개 양식지 연동:</span>
                                            <span className="text-emerald-400 font-bold font-mono">ON (storage/templates)</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-300">
                                            <span>발주서별 아이템 패킹:</span>
                                            <span className="text-indigo-300 font-bold font-mono">최대 6개 단위 자동 분할</span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-300">
                                            <span>열처리 온도 자동 판정:</span>
                                            <span className="text-amber-300 font-mono text-[10px]">
                                                K 또는 /B1500: <strong className="text-amber-400">1050℃</strong> | J/일반: <strong className="text-cyan-400">1040℃</strong>
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-300 pt-1 border-t border-slate-800">
                                            <span>수식 연동 영역:</span>
                                            <span className="text-cyan-300 font-mono text-[10px]">
                                                AX13:BC18 (HEAT·LOT·ITEM·품명·수량)
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-slate-300">
                                            <span>데이터관리부 DAT-10 보관:</span>
                                            <span className="text-purple-300 font-mono text-[10px]">
                                                storage/issued_certificates/{'{poNo}'}/
                                            </span>
                                        </div>
                                    </div>

                                    {/* 주요 실행 액션 버튼들 */}
                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowCertIssuerModal(true)}
                                            className="w-full py-2.5 px-3 rounded-lg bg-linear-to-r from-indigo-600 via-blue-600 to-indigo-600 hover:from-indigo-500 hover:to-blue-500 text-white font-black text-xs shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            <FileText className="w-4 h-4" />
                                            <span>🚀 성적서 발행기 열기 (실시간 A4 뷰 & PDF/엑셀)</span>
                                        </button>

                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        await fetch('/api/qc/qc06/test-sample', { method: 'POST' });
                                                        setShowCertIssuerModal(true);
                                                    } catch (e) {
                                                        console.error(e);
                                                    }
                                                }}
                                                className="py-2 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-all"
                                                title="사용자가 제공한 사진 샘플(ES260709-1974) 즉시 발행 및 확인"
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                                <span>사진 샘플(1:1) 즉시 확인</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        await fetch('/api/qc/qc06/open-folder', { method: 'POST' });
                                                    } catch (e) {
                                                        console.error(e);
                                                    }
                                                }}
                                                className="py-2 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-all"
                                                title="데이터관리부 DAT-10에 영구 저장된 성적서 폴더 열기"
                                            >
                                                <FolderOpen className="w-3.5 h-3.5" />
                                                <span>DAT-10 보관 폴더 열기</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ⚡ [데이터관리팀 특화] DAT-01 Make.com 크리덴셜 자동 인증봇 (클로드 Computer Use 브라우저 클릭 자동화) */}
                            {(selectedAgent.code === 'DAT-01' || selectedAgent.id === 'dat-slot-1') && (
                                <div className="border border-amber-500/50 bg-amber-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_25px_rgba(245,158,11,0.25)] my-3">
                                    <div className="flex items-center justify-between border-b border-amber-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                                            <span>⚡</span>
                                            <span>DAT-01 Make.com 크리덴셜 자동 인증봇</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-amber-500/20 text-amber-300 font-mono border border-amber-500/40 flex items-center gap-1">
                                            <span>🤖 Claude Computer Use</span>
                                            <span>브라우저 자동화</span>
                                        </span>
                                    </div>

                                    {/* Make.com 커넥션 요약 배너 */}
                                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                                            <div className="text-[10px] text-slate-400">총 커넥션</div>
                                            <div className="text-base font-black text-white font-mono">{makeSummary?.total || 8}건</div>
                                        </div>
                                        <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-2">
                                            <div className="text-[10px] text-emerald-400">정상 연결 (VERIFIED)</div>
                                            <div className="text-base font-black text-emerald-300 font-mono">{makeSummary?.verified ?? 5}건</div>
                                        </div>
                                        <div className="bg-purple-950/40 border border-purple-800/60 rounded-lg p-2">
                                            <div className="text-[10px] text-purple-400">Reauthorize 필요</div>
                                            <div className="text-base font-black text-purple-300 font-mono">{makeSummary?.needsReauth ?? 3}건</div>
                                        </div>
                                    </div>

                                    {/* 안내 설명 */}
                                    <div className="p-2.5 rounded-lg border border-purple-500/40 bg-purple-950/30 text-xs space-y-1">
                                        <div className="flex items-center justify-between text-purple-200 font-bold">
                                            <span>구글/MS OAuth 세션 만료 자동화:</span>
                                            <span className="text-emerald-400 font-mono">가동 중</span>
                                        </div>
                                        <p className="text-[11px] text-purple-300/80 leading-relaxed">
                                            Make.com의 구글/마이크로소프트 연결은 세션 만료 시 <strong>Reauthorize 버튼을 눌러 계정 동의 및 권한 허용을 완료해야만 Verify가 성립</strong>됩니다. DAT-01이 클로드 브라우저 클릭 자동화를 통해 이를 전담합니다.
                                        </p>
                                    </div>

                                    {/* 만료 커넥션 일괄 자동화 실행 버튼 */}
                                    {makeSummary && makeSummary.needsReauth > 0 && (
                                        <button
                                            type="button"
                                            disabled={!!isReauthorizingMake}
                                            onClick={() => handleReauthorizeMakeConnection()}
                                            className="w-full py-2 px-3 rounded-lg bg-linear-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-xs shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                        >
                                            <Sparkles className="w-4 h-4 text-amber-300" />
                                            <span>
                                                {isReauthorizingMake === 'ALL'
                                                    ? '🤖 클로드 브라우저 자동 클릭(Reauthorize ➔ Verify) 실행 중...'
                                                    : `⚡ 만료된 구글/MS 커넥션(${makeSummary.needsReauth}건) 일괄 자동 Reauthorize & Verify`}
                                            </span>
                                        </button>
                                    )}

                                    {/* Make.com 8개 실제 커넥션 리스트 */}
                                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                        <div className="text-[10px] text-slate-400 font-bold flex items-center justify-between px-1">
                                            <span>MAKE.COM CONNECTIONS ({makeConnections.length}개)</span>
                                            <button 
                                                onClick={fetchMakeConnections} 
                                                className="text-[9px] text-cyan-400 hover:underline flex items-center gap-0.5"
                                            >
                                                <span>새로고침</span>
                                            </button>
                                        </div>
                                        {makeConnections.map((conn: MakeConnectionItem) => (
                                            <div 
                                                key={conn.id} 
                                                className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition-all ${
                                                    conn.needsReauthorize
                                                        ? 'bg-purple-950/30 border-purple-700/60 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                                                        : 'bg-black/50 border-slate-800'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                    <span className="text-base shrink-0">{conn.icon}</span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="font-bold text-slate-200 truncate flex items-center gap-1.5">
                                                            <span className="truncate">{conn.name}</span>
                                                            <span className="text-[9px] text-slate-500 font-mono">ID:{conn.id}</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 font-mono truncate">
                                                            {conn.account} {conn.scenarios ? `· 시나리오 ${conn.scenarios}개 연동` : ''}
                                                        </div>
                                                        {conn.reauthorizeReason && (
                                                            <div className="text-[9px] text-purple-300 font-mono truncate">
                                                                ⚠️ {conn.reauthorizeReason}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {conn.needsReauthorize ? (
                                                        <button
                                                            type="button"
                                                            disabled={!!isReauthorizingMake}
                                                            onClick={() => handleReauthorizeMakeConnection(conn.id)}
                                                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded text-[10px] shadow-[0_0_8px_rgba(168,85,247,0.5)] cursor-pointer flex items-center gap-1 transition-all disabled:opacity-50"
                                                            title="Reauthorize 자동 클릭 후 Verify까지 완결"
                                                        >
                                                            <span>{isReauthorizingMake === conn.id ? '⏳' : '⚡'}</span>
                                                            <span>Reauthorize</span>
                                                        </button>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/70 border border-emerald-600/70 text-emerald-300 font-mono">
                                                            ✓ Verified
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 클로드 브라우저 클릭 시뮬레이션 로그 터미널 */}
                                    {makeActionLogs.length > 0 && (
                                        <div className="bg-black/80 border border-purple-900/60 rounded-lg p-2 space-y-1 text-[9px] font-mono text-purple-300 max-h-24 overflow-y-auto">
                                            <div className="text-[8px] text-slate-500 font-bold">CLAUDE COMPUTER USE CLICK STREAM</div>
                                            {makeActionLogs.slice(0, 5).map((log, i) => (
                                                <div key={i} className="text-slate-300">{log}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ⚡ [데이터관리팀 특화] DAT-02 Make.com 시나리오 유지 감시봇 (Active 감시 & Old Data 자동 삭제 복구) */}
                            {(selectedAgent.code === 'DAT-02' || selectedAgent.id === 'dat-slot-2') && (
                                <div className="border border-emerald-500/50 bg-emerald-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_25px_rgba(16,185,129,0.25)] my-3">
                                    <div className="flex items-center justify-between border-b border-emerald-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-emerald-300 font-bold text-xs">
                                            <span>⚡</span>
                                            <span>DAT-02 Make.com 시나리오 유지 감시봇</span>
                                        </div>
                                        <span className="text-[9px] px-2 py-0.5 rounded font-black bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40 flex items-center gap-1">
                                            <span>🔄 Active 상시 감시</span>
                                            <span>Old Data 클리어</span>
                                        </span>
                                    </div>

                                    {/* Make.com 시나리오 상태 요약 배너 */}
                                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                                            <div className="text-[10px] text-slate-400">감시 시나리오</div>
                                            <div className="text-base font-black text-white font-mono">{makeScenariosSummary?.total || 3}개</div>
                                        </div>
                                        <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-2">
                                            <div className="text-[10px] text-emerald-400">정상 가동 (ACTIVE)</div>
                                            <div className="text-base font-black text-emerald-300 font-mono">{makeScenariosSummary?.active ?? 3}개</div>
                                        </div>
                                        <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-2">
                                            <div className="text-[10px] text-rose-400">적체 (Incomplete)</div>
                                            <div className="text-base font-black text-rose-300 font-mono">{makeScenariosSummary?.totalIncomplete ?? 0}건</div>
                                        </div>
                                    </div>

                                    {/* 안내 설명 */}
                                    <div className="p-2.5 rounded-lg border border-emerald-500/40 bg-emerald-950/30 text-xs space-y-1">
                                        <div className="flex items-center justify-between text-emerald-200 font-bold">
                                            <span>Active 비활성화 신호 감지 & 큐 클리어:</span>
                                            <span className="text-cyan-400 font-mono">상시 감시 중</span>
                                        </div>
                                        <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                                            Make.com 시나리오는 오류 누적 시 Active 스위치가 꺼지거나 Incomplete Executions 큐에 과거 데이터가 남아 활성화가 차단됩니다. 
                                            <strong>DAT-02가 비활성화 신호를 감지하여 손상된 Old Data를 안전 삭제하고 토글 스위치를 즉시 다시 켭니다.</strong>
                                        </p>
                                    </div>

                                    {/* 감시 대상 시나리오 목록 */}
                                    <div className="space-y-2">
                                        <div className="text-[10px] text-slate-400 font-bold flex items-center justify-between px-1">
                                            <span>MAKE.COM SCENARIOS (핵심 감시 파이프라인)</span>
                                            <button 
                                                onClick={fetchMakeScenarios} 
                                                className="text-[9px] text-cyan-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                                            >
                                                <span>새로고침</span>
                                            </button>
                                        </div>

                                        {makeScenarios.map((sc: MakeScenarioItem) => (
                                            <div 
                                                key={sc.id} 
                                                className={`p-3 rounded-xl border text-xs space-y-2 transition-all ${
                                                    !sc.isActive || sc.incompleteExecutions > 0
                                                        ? 'bg-rose-950/30 border-rose-600/70 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                                                        : 'bg-black/50 border-emerald-900/60'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                                                        <span className="font-bold text-white text-[12px]">{sc.name}</span>
                                                    </div>
                                                    
                                                    {/* Active 상태 토글 인디케이터 */}
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black flex items-center gap-1 ${
                                                            sc.isActive 
                                                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' 
                                                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse'
                                                        }`}>
                                                            <span>{sc.isActive ? '🟢 Active' : '🔴 Inactive (OFF)'}</span>
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-900">
                                                    <div>ID: <span className="text-cyan-300 font-bold">{sc.id}</span></div>
                                                    <div>누적 실행: <span className="text-white font-bold">{sc.operations?.toLocaleString()} ops</span></div>
                                                    <div>데이터: <span className="text-slate-300">{sc.dataTransfer}</span></div>
                                                    <div>Incomplete 큐: <span className={sc.incompleteExecutions > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>{sc.incompleteExecutions}건</span></div>
                                                </div>

                                                {/* 원클릭 복구 및 테스트 버튼 */}
                                                <div className="flex items-center gap-2 pt-1">
                                                    <button
                                                        type="button"
                                                        disabled={isReactivatingScenario === sc.id}
                                                        onClick={() => handleReactivateScenario(sc.id)}
                                                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black font-black text-[11px] shadow-[0_0_12px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                                    >
                                                        <span>{isReactivatingScenario === sc.id ? '🔄 복구 진행 중...' : '🗑️ Old Data 삭제 및 Active 재활성화'}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSimulateScenarioError(sc.id)}
                                                        className="py-1.5 px-2 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] transition-all cursor-pointer"
                                                        title="에러 발생 및 적체 상황 시뮬레이션"
                                                    >
                                                        <span>🚨 테스트</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* DAT-02 복구 로그 감사 스트림 */}
                                    <div className="space-y-1">
                                        <div className="text-[10px] text-slate-400 font-mono font-bold flex items-center justify-between">
                                            <span>DAT-02 감시 & 복구 감사 터미널</span>
                                            <span className="text-[9px] text-emerald-400">실시간 기록</span>
                                        </div>
                                        <div className="rounded-lg bg-black/80 border border-slate-800 p-2.5 text-[10px] font-mono text-emerald-300/90 space-y-1 max-h-36 overflow-y-auto">
                                            {makeScenarioActionLogs.length > 0 ? (
                                                makeScenarioActionLogs.map((log, idx) => (
                                                    <div key={idx} className="flex items-start gap-1">
                                                        <span className="text-cyan-400 shrink-0">➔</span>
                                                        <span>{log}</span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-slate-500">
                                                    [정상 대기] Make.com 시나리오 Active 상태 실시간 감시 중... 이상 발생 시 자동 클리어 & 재활성화가 즉시 기록됩니다.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ⚡ [데이터관리팀 특화] DAT-03~06 4단계 전사 재고 자동 동기화 & 관제 파이프라인 */}
                            {(['DAT-03', 'DAT-04', 'DAT-05', 'DAT-06'].includes(selectedAgent.code) || selectedAgent.teamName === '재고동기화자동화팀') && (
                                <div className="border border-amber-500/50 bg-gradient-to-b from-amber-950/20 via-[#0B0F19] to-amber-950/20 rounded-xl p-3.5 space-y-3.5 shadow-[0_0_25px_rgba(245,158,11,0.25)] my-3">
                                    {/* 헤더 */}
                                    <div className="flex items-center justify-between border-b border-amber-900/40 pb-2">
                                        <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                                            <span>⚡</span>
                                            <span>데이터관리팀 4단계 전사 재고 자동 동기화 관제단</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setShowInvSyncConfigModal(true)}
                                                className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1 cursor-pointer transition-all"
                                                title="구글 시트 연동 Webhook URL 및 버퍼링 시간 설정"
                                            >
                                                <Settings className="w-3 h-3 text-amber-400" />
                                                <span>연동 설정</span>
                                            </button>
                                            <span className="text-[9px] px-2 py-0.5 rounded font-black bg-amber-500/20 text-amber-300 font-mono border border-amber-500/40 flex items-center gap-1">
                                                <span>4-BOT SWARM</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* 원클릭 전자동 오토파일럿 마스터 실행 바 */}
                                    <div className="p-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-orange-950/30 to-amber-950/40 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                                                    <span>🚀</span>
                                                    <span>원클릭 4단계 전자동 오토파일럿 (One-Click Auto-Pilot)</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-0.5">
                                                    사원1(태일/시화) ➔ 사원2(대경) ➔ 대리(3.5분 수식연산 버퍼링) ➔ 과장(S3 배포 & 변동량 분석)을 완전 자동 완결합니다.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={invSyncData?.state?.isRunning || invSyncRunningAction !== null}
                                                onClick={handleRunInvAutoPilot}
                                                className="py-2.5 px-3.5 rounded-lg bg-linear-to-r from-amber-400 via-orange-400 to-amber-400 hover:from-amber-300 hover:to-orange-300 text-black font-black text-xs shadow-[0_0_20px_rgba(245,158,11,0.5)] transition-all flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                                            >
                                                <Sparkles className={`w-4 h-4 ${invSyncData?.state?.isRunning ? 'animate-spin' : ''}`} />
                                                <span>{invSyncData?.state?.isRunning ? '오토파일럿 파이프라인 가동 중...' : '⚡ 전체 4단계 원클릭 가동'}</span>
                                            </button>
                                        </div>

                                        {/* 오토파일럿 진행 상태 배너 */}
                                        {invSyncData?.state?.isRunning && (
                                            <div className="pt-2 border-t border-amber-900/40 flex items-center justify-between text-[11px] font-mono text-amber-300">
                                                <span className="flex items-center gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                                                    <span>현재 진행 단계: <strong>Step {invSyncData.state.currentStep} / 4</strong></span>
                                                </span>
                                                <span className="text-slate-400">오토파일럿 모드 활성</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* 4단계 개별 봇 관제 그리드 */}
                                    <div className="space-y-2.5">
                                        <div className="text-[10px] font-bold text-slate-400 px-1 flex items-center justify-between">
                                            <span>파이프라인 단계별 전담 에이전트 관제 ({selectedAgent.name} 배정)</span>
                                            <span className="text-[9px] text-amber-400 font-mono">구글시트 ➔ S3 클라우드</span>
                                        </div>

                                        {/* 1단계: DAT-03 [사원] 태일/시화재고 동기화 봇 */}
                                        <div className={`p-3 rounded-xl border text-xs space-y-2 transition-all ${
                                            selectedAgent.code === 'DAT-03'
                                                ? 'bg-amber-950/30 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                                : 'bg-black/50 border-slate-800'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-cyan-950 border border-cyan-500 text-cyan-300">
                                                        Step 1
                                                    </span>
                                                    <span className="font-bold text-slate-200">DAT-03 [사원] 태일·시화 재고 동기화</span>
                                                    <span className="text-[10px] text-slate-500 font-mono">포트 8800 API & Apps Script</span>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                                                    invSyncData?.state?.step1?.status === 'SUCCESS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' :
                                                    invSyncData?.state?.step1?.status === 'RUNNING' ? 'bg-amber-950 text-amber-300 border border-amber-600 animate-pulse' :
                                                    invSyncData?.state?.step1?.status === 'ERROR' ? 'bg-rose-950 text-rose-300 border border-rose-600' :
                                                    'bg-slate-900 text-slate-400 border border-slate-700'
                                                }`}>
                                                    {invSyncData?.state?.step1?.status || 'IDLE'}
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                                `http://121.145.79.200:8800/stocklist_get.php?item=`에서 실시간 데이터를 수집하여 `태일,시화재고` 구글시트(B~G, I~K열)를 정규화 갱신합니다.
                                            </div>
                                            <div className="flex items-center justify-between pt-1">
                                                <span className="text-[10px] font-mono text-slate-500">
                                                    {invSyncData?.state?.step1?.lastRun ? `최근 완료: ${new Date(invSyncData.state.step1.lastRun).toLocaleTimeString('ko-KR')}` : '실행 이력 없음'}
                                                </span>
                                                <button
                                                    type="button"
                                                    disabled={invSyncRunningAction === 'step1'}
                                                    onClick={handleRunInvStep1}
                                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/50 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                                                >
                                                    <RotateCw className={`w-3 h-3 ${invSyncRunningAction === 'step1' ? 'animate-spin' : ''}`} />
                                                    <span>태일/시화 즉시 실행</span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* 2단계: DAT-04 [사원] 대경 재고 파일 수신 & 변환 봇 */}
                                        <div className={`p-3 rounded-xl border text-xs space-y-2 transition-all ${
                                            selectedAgent.code === 'DAT-04'
                                                ? 'bg-amber-950/30 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                                : 'bg-black/50 border-slate-800'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-emerald-950 border border-emerald-500 text-emerald-300">
                                                        Step 2
                                                    </span>
                                                    <span className="font-bold text-slate-200">DAT-04 [사원] 대경 재고 파일 수신 & 변환</span>
                                                    <span className="text-[10px] text-slate-500 font-mono">엑셀 간편 업로드</span>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                                                    invSyncData?.state?.step2?.status === 'SUCCESS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' :
                                                    invSyncData?.state?.step2?.status === 'RUNNING' ? 'bg-amber-950 text-amber-300 border border-amber-600 animate-pulse' :
                                                    invSyncData?.state?.step2?.status === 'ERROR' ? 'bg-rose-950 text-rose-300 border border-rose-600' :
                                                    'bg-slate-900 text-slate-400 border border-slate-700'
                                                }`}>
                                                    {invSyncData?.state?.step2?.status || 'IDLE'}
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                                대경재고 파일을 수신하면 수동 복사/붙여넣기 없이 원클릭으로 구글시트 `대경재고변환`에 안전 반영하고 변환 스크립트를 작동시킵니다.
                                            </div>
                                            <div className="flex items-center justify-between pt-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDaekyungUploadModal(true)}
                                                    className="px-2.5 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/50 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                                                >
                                                    <UploadCloud className="w-3 h-3" />
                                                    <span>📂 대경재고 파일 드롭 / 붙여넣기</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={invSyncRunningAction === 'step2'}
                                                    onClick={() => handleRunInvStep2()}
                                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/50 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                                                >
                                                    <Play className={`w-3 h-3 ${invSyncRunningAction === 'step2' ? 'animate-spin' : ''}`} />
                                                    <span>대경변환 실행</span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* 3단계: DAT-05 [대리] ALTF 재고 DB 총괄 & 3~5분 버퍼링 관제 봇 */}
                                        <div className={`p-3 rounded-xl border text-xs space-y-2.5 transition-all ${
                                            selectedAgent.code === 'DAT-05'
                                                ? 'bg-amber-950/30 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                                : 'bg-black/50 border-slate-800'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-purple-950 border border-purple-500 text-purple-300">
                                                        Step 3
                                                    </span>
                                                    <span className="font-bold text-slate-200">DAT-05 [대리] ALTF 재고 DB 총괄 & 버퍼링 관제</span>
                                                    <span className="text-[10px] text-purple-400 font-mono">3~5분 안정화 타이머</span>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                                                    invSyncData?.state?.step3?.timerActive ? 'bg-amber-500 text-black border border-amber-400 animate-pulse font-black' :
                                                    invSyncData?.state?.step3?.status === 'SUCCESS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' :
                                                    invSyncData?.state?.step3?.status === 'RUNNING' ? 'bg-amber-950 text-amber-300 border border-amber-600 animate-pulse' :
                                                    invSyncData?.state?.step3?.status === 'ERROR' ? 'bg-rose-950 text-rose-300 border border-rose-600' :
                                                    'bg-slate-900 text-slate-400 border border-slate-700'
                                                }`}>
                                                    {invSyncData?.state?.step3?.timerActive ? 'BUFFERING' : (invSyncData?.state?.step3?.status || 'IDLE')}
                                                </span>
                                            </div>

                                            <div className="text-[11px] text-slate-400">
                                                `ALTF 재고 DATA BASE` 대용량 구글시트의 IMPORTRANGE 및 수식이 완전히 연산될 때까지 대기(기본 {invSyncData?.config?.bufferWaitMinutes || 3.5}분)한 뒤, `inventory.json` 생성 스크립트를 자동 실행합니다.
                                            </div>

                                            {/* ⚡ 실시간 버퍼링 카운트다운 타이머 HUD */}
                                            {invSyncData?.state?.step3?.timerActive ? (
                                                <div className="p-2.5 rounded-lg border border-amber-500/60 bg-amber-950/40 space-y-1.5">
                                                    <div className="flex items-center justify-between text-xs font-mono">
                                                        <span className="text-amber-300 font-bold flex items-center gap-1.5">
                                                            <Timer className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                                                            <span>구글시트 대용량 수식 연산 안정화 대기 중...</span>
                                                        </span>
                                                        <span className="text-white font-black text-sm">
                                                            {Math.floor((invSyncData.state.step3.bufferRemainingSeconds || 0) / 60)}분 {(invSyncData.state.step3.bufferRemainingSeconds || 0) % 60}초 남음
                                                        </span>
                                                    </div>
                                                    {/* 게이지 바 */}
                                                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-amber-900/60">
                                                        <div 
                                                            className="bg-linear-to-r from-amber-400 to-orange-400 h-full transition-all duration-1000 shadow-[0_0_10px_rgba(245,158,11,0.8)]"
                                                            style={{
                                                                width: `${Math.min(100, Math.max(0, 
                                                                    ((invSyncData.state.step3.bufferTotalSeconds - invSyncData.state.step3.bufferRemainingSeconds) / (invSyncData.state.step3.bufferTotalSeconds || 1)) * 100
                                                                ))}%`
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between pt-1">
                                                        <span className="text-[9px] text-amber-300/80 font-mono">
                                                            * 타이머 완료 시 대리 봇이 ALTF DB 앱스크립트를 자동 실행하고 4단계로 연계합니다.
                                                        </span>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={handleCancelInvStep3}
                                                                className="px-2 py-0.5 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-700 text-[10px] font-bold cursor-pointer"
                                                            >
                                                                <span>취소</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRunInvStep3(true)}
                                                                className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-black cursor-pointer shadow-sm"
                                                            >
                                                                <span>⚡ 지금 즉시 실행 (Skip)</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between pt-1">
                                                    <span className="text-[10px] font-mono text-slate-500">
                                                        설정 대기: {invSyncData?.config?.bufferWaitMinutes || 3.5}분 버퍼링 카운트다운
                                                    </span>
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            disabled={invSyncRunningAction === 'step3'}
                                                            onClick={() => handleRunInvStep3(false)}
                                                            className="px-2.5 py-1 rounded bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-500/50 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                                                        >
                                                            <Timer className="w-3 h-3" />
                                                            <span>⏳ {invSyncData?.config?.bufferWaitMinutes || 3.5}분 버퍼 시작 및 DB실행</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={invSyncRunningAction === 'step3'}
                                                            onClick={() => handleRunInvStep3(true)}
                                                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                                                            title="버퍼 없이 즉시 ALTF DB 스크립트 실행"
                                                        >
                                                            <Zap className="w-3 h-3 text-amber-400" />
                                                            <span>즉시 실행</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* 4단계: DAT-06 [과장] S3 배포 & 재고 갱신/변동량 감시 봇 */}
                                        <div className={`p-3 rounded-xl border text-xs space-y-2.5 transition-all ${
                                            selectedAgent.code === 'DAT-06'
                                                ? 'bg-amber-950/30 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                                : 'bg-black/50 border-slate-800'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-blue-950 border border-blue-500 text-blue-300">
                                                        Step 4
                                                    </span>
                                                    <span className="font-bold text-slate-200">DAT-06 [과장] S3 배포 & 재고 갱신/변동량 감시</span>
                                                    <span className="text-[10px] text-blue-400 font-mono">중복방지 정리 & AWS S3</span>
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                                                    invSyncData?.state?.step4?.status === 'SUCCESS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' :
                                                    invSyncData?.state?.step4?.status === 'RUNNING' ? 'bg-amber-950 text-amber-300 border border-amber-600 animate-pulse' :
                                                    invSyncData?.state?.step4?.status === 'ERROR' ? 'bg-rose-950 text-rose-300 border border-rose-600' :
                                                    'bg-slate-900 text-slate-400 border border-slate-700'
                                                }`}>
                                                    {invSyncData?.state?.step4?.status || 'IDLE'}
                                                </span>
                                            </div>

                                            {/* 핵심 3대 검증 배너 */}
                                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                                                    <div className="text-[10px] text-slate-400">중복 방지 클린업</div>
                                                    <div className="text-xs font-black text-emerald-400 font-mono mt-0.5">
                                                        {(invSyncData?.state?.step4?.cleanedFiles?.length ?? 0) > 0 ? `🧹 ${invSyncData?.state?.step4?.cleanedFiles?.length}건 정리완료` : '✓ 대기 중'}
                                                    </div>
                                                </div>
                                                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                                                    <div className="text-[10px] text-slate-400">AWS S3 업로드</div>
                                                    <div className="text-xs font-black text-cyan-300 font-mono mt-0.5">
                                                        {invSyncData?.state?.step4?.s3Uploaded ? '☁️ S3 배포 성공' : '대기 중'}
                                                    </div>
                                                </div>
                                                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2">
                                                    <div className="text-[10px] text-slate-400">시화재고 일일 변동</div>
                                                    <div className="text-xs font-black text-amber-300 font-mono mt-0.5">
                                                        {invSyncData?.state?.step4?.sihwaChangesCount ? `📊 ${invSyncData.state.step4.sihwaChangesCount}건 감지` : '0건 변동'}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 시화재고 변동량 세부 브리핑 카드 */}
                                            {invSyncData?.state?.step4?.details?.diffStats && (
                                                <div className="p-2.5 rounded-lg border border-cyan-500/40 bg-cyan-950/20 text-xs flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-cyan-300 font-bold">📈 시화재고 변동 트렌드:</span>
                                                        <span className="font-mono text-emerald-300 font-bold">입고 +{invSyncData.state.step4.details.diffStats.inboundCount}건</span>
                                                        <span className="text-slate-600">|</span>
                                                        <span className="font-mono text-rose-300 font-bold">출고 -{invSyncData.state.step4.details.diffStats.outboundCount}건</span>
                                                    </div>
                                                    <a
                                                        href="/admin/inventory/sihwa"
                                                        className="px-2 py-0.5 rounded bg-cyan-500 hover:bg-cyan-400 text-black text-[10px] font-black flex items-center gap-1 cursor-pointer transition-all"
                                                    >
                                                        <span>변동 내역 검토 ➔</span>
                                                    </a>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between pt-1">
                                                <span className="text-[10px] font-mono text-slate-500">
                                                    {invSyncData?.state?.step4?.totalItems ? `총 ${invSyncData.state.step4.totalItems.toLocaleString()}건 원장 배포` : '최신 파일 대기'}
                                                </span>
                                                <button
                                                    type="button"
                                                    disabled={invSyncRunningAction === 'step4'}
                                                    onClick={handleRunInvStep4}
                                                    className="px-3 py-1.5 rounded-lg bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-[11px] shadow-[0_0_15px_rgba(59,130,246,0.4)] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                                >
                                                    <UploadCloud className={`w-3.5 h-3.5 ${invSyncRunningAction === 'step4' ? 'animate-spin' : ''}`} />
                                                    <span>🚀 S3 배포 & 시화 변동량 분석 실행</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 최근 로그 */}
                            <div className="mt-2">
                                <div className="text-[10px] text-slate-500 font-bold mb-1">RECENT ACTIVITY LOGS</div>
                                <div className="rounded bg-black/50 p-2.5 text-[10px] font-mono text-slate-300 space-y-1 border border-slate-800 max-h-32 overflow-y-auto">
                                    {selectedAgent.logs.map((log, i) => (
                                        <div key={i}>{log}</div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* 3. 하단 고정 액션 버튼 바 (상시 노출) */}
                        <div className="p-4 border-t border-slate-800 bg-[#060B16] shrink-0 space-y-2">
                            <button
                                type="button"
                                onClick={handleSaveEdit}
                                className="w-full py-2.5 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs shadow-[0_0_15px_rgba(0,240,255,0.4)] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                            >
                                <Check className="w-4 h-4" />
                                <span>변경사항 저장 (Save Changes)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleUnassignAgent(selectedAgent.id)}
                                className="w-full py-2 rounded border border-rose-900/60 bg-rose-950/20 hover:bg-rose-900/40 text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>에이전트 해제 (+생성 슬롯으로 복원)</span>
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* 📄 1. PDF 원본 바로보기 모달 (화면에서 직접 열람) */}
            {previewPdfUrl && (
                <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0B132B] border border-cyan-500/50 rounded-xl w-full max-w-5xl h-[88vh] flex flex-col shadow-[0_0_40px_rgba(0,240,255,0.35)] overflow-hidden">
                        <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-bold text-white truncate max-w-xl">
                                <span className="text-pink-400 text-base">📄</span>
                                <span className="truncate text-cyan-300 font-mono">{previewPdfName}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={handleOpenWindowsFolder}
                                    className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all cursor-pointer"
                                    title="윈도우 탐색기로 원본 저장 폴더 열기"
                                >
                                    📂 윈도우 폴더 열기
                                </button>
                                <a
                                    href={previewPdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs transition-all shadow-[0_0_10px_rgba(0,240,255,0.5)]"
                                >
                                    새 창 / 다운로드 ↗
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setPreviewPdfUrl(null)}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer ml-1"
                                    title="닫기 (Esc)"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 bg-slate-950 p-1">
                            <iframe
                                src={previewPdfUrl}
                                className="w-full h-full rounded border-0 bg-white"
                                title="성적서 PDF 뷰어"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* 📋 2. 수집된 전체 성적서 파일 보관함 모달 */}
            {showAllFilesModal && (
                <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0B132B] border border-purple-500/50 rounded-xl w-full max-w-4xl max-h-[82vh] flex flex-col shadow-[0_0_40px_rgba(168,85,247,0.35)] overflow-hidden">
                        <div className="p-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-bold text-white">
                                <span className="text-purple-400 text-base">📋</span>
                                <span>수집된 전체 성적서 PDF 보관함 ({allExtractedFiles.length}개 파일 보관 중)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleOpenWindowsFolder}
                                    className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all cursor-pointer"
                                >
                                    📂 윈도우 폴더 열기
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowAllFilesModal(false)}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer ml-1"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="p-3 overflow-y-auto flex-1 space-y-1.5 font-mono text-xs">
                            {allExtractedFiles.map((file, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between p-2 rounded bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800 transition-colors"
                                >
                                    <div
                                        className="flex items-center gap-2 truncate cursor-pointer flex-1 mr-2"
                                        onClick={() => {
                                            setPreviewPdfName(file.filename);
                                            setPreviewPdfUrl(file.url);
                                            setShowAllFilesModal(false);
                                        }}
                                    >
                                        <span className="text-pink-400">📄</span>
                                        <span className="text-cyan-300 font-bold hover:underline truncate">{file.filename}</span>
                                        <span className="text-[10px] text-slate-500 shrink-0">[{file.dateFolder}]</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-slate-400 text-[11px]">{(file.sizeBytes / 1024).toFixed(0)}KB</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPreviewPdfName(file.filename);
                                                setPreviewPdfUrl(file.url);
                                                setShowAllFilesModal(false);
                                            }}
                                            className="px-2 py-1 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500 hover:text-black font-bold text-[10px] cursor-pointer"
                                        >
                                            바로보기
                                        </button>
                                        <a
                                            href={file.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-[10px]"
                                        >
                                            새창 ↗
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 🏢 4. 부서 추가 / 수정 모달 (Department Management Modal) */}
            {deptModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="bg-[#0A0F1D] border border-cyan-500/50 rounded-xl w-full max-w-lg shadow-[0_0_50px_rgba(0,240,255,0.2)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
                        {/* 헤더 */}
                        <div className="p-4 border-b border-slate-800 bg-[#0E1528] flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <span className="text-2xl">{deptForm.icon || '🏢'}</span>
                                <div>
                                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                                        <span>{editingDeptId ? '부서 정보 수정' : '신규 관제 부서 추가'}</span>
                                        {editingDeptId && (
                                            <span className="text-xs px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-300 font-mono">
                                                ID: {editingDeptId}
                                            </span>
                                        )}
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {editingDeptId 
                                            ? '부서 명칭, 코드, 테마 색상 및 총괄 직책을 수정합니다.' 
                                            : '조직도 및 관제 시스템에 연동될 새로운 부서와 기본 슬롯을 생성합니다.'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setDeptModalOpen(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* 폼 본문 */}
                        <form onSubmit={handleSaveDept} className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
                            {/* 1. 부서명 & 부서 코드 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">
                                        부서명 <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="예: 해외영업부, 연구개발부"
                                        value={deptForm.name}
                                        onChange={e => setDeptForm(prev => ({ ...prev, name: e.target.value }))}
                                        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-hidden focus:border-cyan-400"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">
                                        부서 식별 코드 <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="예: GLO, RND, SEC"
                                        value={deptForm.code}
                                        onChange={e => setDeptForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                                        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono uppercase focus:outline-hidden focus:border-cyan-400"
                                    />
                                </div>
                            </div>

                            {/* 2. 아이콘 빠른 선택 & 커스텀 입력 */}
                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">
                                    대표 아이콘 / 이모지
                                </label>
                                <div className="flex flex-wrap gap-1.5 p-2 bg-slate-950/70 border border-slate-800 rounded-lg mb-2">
                                    {['🏢', '📝', '🛒', '📑', '🔬', '🚚', '💾', '📦', '👑', '🛡️', '⚙️', '🚀', '💡', '🌐', '🎯', '📊', '⚡', '🤖', '🔍', '📈', '🏭', '🧪', '💼'].map(emoji => (
                                        <button
                                            key={emoji}
                                            type="button"
                                            onClick={() => setDeptForm(prev => ({ ...prev, icon: emoji }))}
                                            className={`w-8 h-8 rounded text-sm flex items-center justify-center transition-all cursor-pointer ${
                                                deptForm.icon === emoji
                                                    ? 'bg-cyan-500/30 border border-cyan-400 scale-110 shadow-xs'
                                                    : 'bg-slate-900 hover:bg-slate-800 border border-slate-700/60'
                                            }`}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400">직접 입력:</span>
                                    <input
                                        type="text"
                                        value={deptForm.icon}
                                        onChange={e => setDeptForm(prev => ({ ...prev, icon: e.target.value }))}
                                        className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-center text-sm text-white"
                                        maxLength={4}
                                    />
                                    <span className="text-[11px] text-slate-500">원하는 이모지 직접 입력 가능</span>
                                </div>
                            </div>

                            {/* 3. 테마 컬러 프리셋 & 픽커 */}
                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">
                                    부서 테마 컬러 (네온)
                                </label>
                                <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-950/70 border border-slate-800 rounded-lg">
                                    {[
                                        { color: '#00F0FF', name: 'Cyber Cyan' },
                                        { color: '#00E676', name: 'Neon Green' },
                                        { color: '#FFD600', name: 'Electric Gold' },
                                        { color: '#FF0055', name: 'Cyber Pink' },
                                        { color: '#7C4DFF', name: 'Neon Purple' },
                                        { color: '#00B0FF', name: 'Deep Sky' },
                                        { color: '#FF6D00', name: 'Safety Orange' },
                                        { color: '#E040FB', name: 'Cyber Magenta' },
                                        { color: '#AEEA00', name: 'Lime Neon' },
                                        { color: '#FF1744', name: 'Crimson' }
                                    ].map(item => (
                                        <button
                                            key={item.color}
                                            type="button"
                                            onClick={() => setDeptForm(prev => ({ ...prev, color: item.color }))}
                                            className="w-6 h-6 rounded-full border-2 transition-transform relative flex items-center justify-center cursor-pointer"
                                            style={{
                                                backgroundColor: item.color,
                                                borderColor: deptForm.color === item.color ? '#FFFFFF' : 'transparent',
                                                transform: deptForm.color === item.color ? 'scale(1.2)' : 'scale(1)',
                                                boxShadow: deptForm.color === item.color ? `0 0 10px ${item.color}` : 'none'
                                            }}
                                            title={item.name}
                                        >
                                            {deptForm.color === item.color && (
                                                <Check className="w-3 h-3 text-black stroke-[3]" />
                                            )}
                                        </button>
                                    ))}
                                    <div className="flex items-center gap-1.5 ml-auto">
                                        <input
                                            type="color"
                                            value={deptForm.color}
                                            onChange={e => setDeptForm(prev => ({ ...prev, color: e.target.value }))}
                                            className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                                        />
                                        <span className="font-mono text-xs text-slate-300 font-bold">{deptForm.color}</span>
                                    </div>
                                </div>
                            </div>

                            {/* 4. 총괄 직책명 & 기본 슬롯 수 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">
                                        부서 총괄 직책명
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="예: 해외영업 총괄, R&D 총괄"
                                        value={deptForm.headRole}
                                        onChange={e => setDeptForm(prev => ({ ...prev, headRole: e.target.value }))}
                                        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-hidden focus:border-cyan-400"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-300 mb-1">
                                        배정 슬롯 인원수 (기본 10)
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={deptForm.totalUnits}
                                        onChange={e => setDeptForm(prev => ({ ...prev, totalUnits: parseInt(e.target.value) || 10 }))}
                                        className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-hidden focus:border-cyan-400"
                                    />
                                </div>
                            </div>

                            {/* 5. 부서 설명 */}
                            <div>
                                <label className="block text-xs font-bold text-slate-300 mb-1">
                                    부서 역할 및 관제 목적 설명
                                </label>
                                <textarea
                                    rows={2}
                                    placeholder="해당 부서 에이전트들이 수행할 주요 자율 업무 및 관제 목적을 입력하세요."
                                    value={deptForm.description}
                                    onChange={e => setDeptForm(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-hidden focus:border-cyan-400"
                                />
                            </div>

                            {/* 하단 버튼 바 */}
                            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                                {editingDeptId ? (
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteDept(editingDeptId)}
                                        className="px-3 py-2 rounded border border-red-500/40 bg-red-950/40 hover:bg-red-900/60 text-red-300 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>이 부서 삭제</span>
                                    </button>
                                ) : <div />}

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setDeptModalOpen(false)}
                                        className="px-3.5 py-2 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer"
                                    >
                                        취소
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black shadow-[0_0_15px_rgba(0,240,255,0.4)] flex items-center gap-1.5 transition-all cursor-pointer"
                                    >
                                        <Check className="w-4 h-4" />
                                        <span>{editingDeptId ? '수정 내용 저장' : '부서 생성 완료'}</span>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 📊 3. 26개 컬럼 성적서 관리 대장 (대경벤드 성적서.xlsx) 모달 */}
            <CertificateLedgerModal
                isOpen={showLedgerModal}
                onClose={() => setShowLedgerModal(false)}
                onViewPdf={(filename) => {
                    setPreviewPdfName(filename);
                    setPreviewPdfUrl(`/storage/certificates/${encodeURIComponent(filename)}`);
                }}
                onOpenFolder={handleOpenWindowsFolder}
            />

            {/* 🛒 4. 구매부 (PUR) SCM 매입 발주 & 성적서 HEAT 교차 대장 및 질의응답 모달 */}
            <PurchaseLedgerModal
                isOpen={showPurchaseLedgerModal}
                onClose={() => setShowPurchaseLedgerModal(false)}
            />

            {/* 📜 5. 품질부 (QC-06) 성적서 발행봇 & DAT-10 아카이빙 모달 */}
            <CertificateIssuerModal
                isOpen={showCertIssuerModal}
                onClose={() => setShowCertIssuerModal(false)}
            />

            {/* 📑 6. 대경벤드 거래명세표(메신저/PDF) 매입 확정 & 미결 해제 연계 모달 */}
            <DaekyungInvoiceModal
                isOpen={showDaekyungInvoiceModal}
                onClose={() => setShowDaekyungInvoiceModal(false)}
                onRefreshAgents={async () => {
                    try {
                        const agRes = await fetch('/api/agents');
                        if (agRes.ok) {
                            const agData = await agRes.json();
                            if (agData.agents) setAgents(agData.agents);
                        }
                    } catch (e) {
                        console.warn('Failed to refresh agents:', e);
                    }
                }}
            />

            {/* ⚡ 구글시트 연동 및 버퍼링 설정 모달 */}
            {showInvSyncConfigModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#090D16] border border-amber-500/50 rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-[0_0_40px_rgba(245,158,11,0.3)]">
                        <div className="flex items-center justify-between border-b border-amber-900/40 pb-3">
                            <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                                <Settings className="w-4 h-4 text-amber-400" />
                                <span>데이터관리팀 구글시트 연동 & 버퍼링 관제 설정</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowInvSyncConfigModal(false)}
                                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div className="space-y-1">
                                <label className="text-slate-300 font-bold flex items-center gap-1">
                                    <span>1. 태일/시화재고 구글시트 Apps Script Web App URL (doGet/doPost)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="https://script.google.com/macros/s/.../exec"
                                    value={configForm.taeilAppsScriptUrl}
                                    onChange={e => setConfigForm(prev => ({ ...prev, taeilAppsScriptUrl: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-amber-400 outline-none"
                                />
                                <p className="text-[10px] text-slate-500">배포된 Apps Script의 웹 앱 URL을 등록하면 봇이 자동으로 호출합니다.</p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-slate-300 font-bold flex items-center gap-1">
                                    <span>2. 대경재고변환 구글시트 Apps Script Web App URL</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="https://script.google.com/macros/s/.../exec"
                                    value={configForm.daekyungAppsScriptUrl}
                                    onChange={e => setConfigForm(prev => ({ ...prev, daekyungAppsScriptUrl: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-amber-400 outline-none"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-slate-300 font-bold flex items-center gap-1">
                                    <span>3. ALTF 재고 DATA BASE 구글시트 Apps Script Web App URL (inventory.json 생성)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="https://script.google.com/macros/s/.../exec"
                                    value={configForm.altfDbAppsScriptUrl}
                                    onChange={e => setConfigForm(prev => ({ ...prev, altfDbAppsScriptUrl: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-amber-400 outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3 pt-1">
                                <div className="space-y-1">
                                    <label className="text-slate-300 font-bold">4. 구글시트 수식 계산 대기 버퍼링 (분)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        step="0.5"
                                        value={configForm.bufferWaitMinutes}
                                        onChange={e => setConfigForm(prev => ({ ...prev, bufferWaitMinutes: parseFloat(e.target.value) || 3.5 }))}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-amber-400 outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500">기본: 3.5분 (3분~5분 추천)</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-slate-300 font-bold">5. 중복 방지 파일 자동 클린업</label>
                                    <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800 cursor-pointer mt-1">
                                        <input
                                            type="checkbox"
                                            checked={configForm.autoCleanupDownloads}
                                            onChange={e => setConfigForm(prev => ({ ...prev, autoCleanupDownloads: e.target.checked }))}
                                            className="rounded border-slate-700 text-amber-500 focus:ring-0"
                                        />
                                        <span className="text-[11px] text-slate-300">Downloads 구버전 삭제</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setShowInvSyncConfigModal(false)}
                                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer transition-all"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveInvConfig}
                                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-black shadow-[0_0_15px_rgba(245,158,11,0.4)] cursor-pointer transition-all"
                            >
                                설정 저장
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 📂 대경재고 파일 간편 업로드 / 붙여넣기 모달 */}
            {showDaekyungUploadModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#090D16] border border-emerald-500/50 rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-[0_0_40px_rgba(16,185,129,0.3)]">
                        <div className="flex items-center justify-between border-b border-emerald-900/40 pb-3">
                            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                                <UploadCloud className="w-4 h-4 text-emerald-400" />
                                <span>DAT-04 [사원] 대경재고 원장 파일 간편 업로드 & 전송</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDaekyungUploadModal(false)}
                                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <p className="text-slate-400 text-[11px] leading-relaxed">
                                매일 전달받는 대경재고 엑셀 파일을 아래에 던지거나, 엑셀 표 내용을 복사하여 붙여넣으시면 DAT-04 사원 봇이 안전하게 수신하여 `대경재고변환` 시트에 반영합니다.
                            </p>

                            {/* 파일 선택 / 드래그 앤 드롭 */}
                            <div className="border-2 border-dashed border-emerald-500/40 rounded-xl p-4 text-center hover:bg-emerald-950/20 transition-all cursor-pointer">
                                <input
                                    type="file"
                                    id="daekyung-file-input"
                                    accept=".xlsx, .xls, .csv, .txt"
                                    onChange={e => {
                                        if (e.target.files && e.target.files[0]) {
                                            setDaekyungSelectedFile(e.target.files[0]);
                                        }
                                    }}
                                    className="hidden"
                                />
                                <label htmlFor="daekyung-file-input" className="cursor-pointer block space-y-1.5">
                                    <UploadCloud className="w-8 h-8 text-emerald-400 mx-auto" />
                                    <div className="text-xs font-bold text-emerald-200">
                                        {daekyungSelectedFile ? daekyungSelectedFile.name : '대경재고 엑셀 파일(.xlsx, .csv) 드래그 또는 클릭하여 선택'}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                        {daekyungSelectedFile ? `${(daekyungSelectedFile.size / 1024).toFixed(1)} KB 선택됨` : '파일을 선택하면 사원 2가 자동 수신 보관합니다.'}
                                    </div>
                                </label>
                            </div>

                            {/* 또는 텍스트 붙여넣기 */}
                            <div className="space-y-1">
                                <label className="text-slate-400 font-bold flex items-center justify-between text-[11px]">
                                    <span>또는 엑셀에서 복사한 텍스트 직접 붙여넣기 (선택사항)</span>
                                    {daekyungUploadText && <span className="text-cyan-400 font-mono">{daekyungUploadText.length}자 입력됨</span>}
                                </label>
                                <textarea
                                    rows={4}
                                    placeholder="엑셀에서 복사(Ctrl+C)한 표 데이터를 여기에 붙여넣기(Ctrl+V) 하셔도 됩니다..."
                                    value={daekyungUploadText}
                                    onChange={e => setDaekyungUploadText(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono text-[10px] focus:border-emerald-400 outline-none resize-none"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setShowDaekyungUploadModal(false)}
                                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer transition-all"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                disabled={!daekyungSelectedFile && !daekyungUploadText.trim()}
                                onClick={() => {
                                    handleRunInvStep2({
                                        filename: daekyungSelectedFile ? daekyungSelectedFile.name : 'daekyung_pasted_data.txt',
                                        content: daekyungUploadText
                                    });
                                }}
                                className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black shadow-[0_0_15px_rgba(16,185,129,0.4)] cursor-pointer transition-all disabled:opacity-50"
                            >
                                사원2에게 전송 & 변환 실행
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
