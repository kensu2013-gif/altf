import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { 
    TrendingUp, 
    TrendingDown, 
    Calendar, 
    Package, 
    MapPin, 
    Plus, 
    Trash2, 
    Activity, 
    X,
    ArrowUpRight,
    HelpCircle
} from 'lucide-react';

interface OrderItem {
    name: string;
    quantity: number;
    unitPrice: number;
    thickness?: string;
    size?: string;
    material?: string;
    isDeleted?: boolean;
}

interface Order {
    id: string;
    poNumber?: string;
    customerName: string;
    status: string;
    createdAt: string;
    items?: OrderItem[];
}

interface Customer {
    id: string;
    companyName: string;
    region: string;
    email?: string;
    phone?: string;
}

interface CrmEvent {
    id: string;
    date: string;
    title: string;
    description: string;
    type: 'price_change' | 'large_order' | 'competitor_issue' | 'other';
    createdAt: string;
}

interface InventoryDiffItem {
    id: string;
    name: string;
    change: number;
}

interface InventoryHistorySnapshot {
    date: string;
    diff: InventoryDiffItem[];
}

interface FlowChartDashboardProps {
    orders: Order[];
    customersList: Customer[];
    inventoryMap: Map<string, { material?: string }>;
    token: string;
}

// 피어슨 상관계수 연산 함수
function calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0 || n !== y.length) return 0;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (denominator === 0) return 0;
    return parseFloat((numerator / denominator).toFixed(3));
}

export default function FlowChartDashboard({ orders, customersList, inventoryMap: _inventoryMap, token }: FlowChartDashboardProps) {
    const [events, setEvents] = useState<CrmEvent[]>([]);
    const [historyData, setHistoryData] = useState<{
        inventoryHistory: InventoryHistorySnapshot[];
        daekyungHistory: InventoryHistorySnapshot[];
    }>({ inventoryHistory: [], daekyungHistory: [] });
    
    const [eventsLoading, setEventsLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [hoveredData, setHoveredData] = useState<{ label: string; amount: number; lastYearAmount: number; events: CrmEvent[] } | null>(null);
    const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number } | null>(null);

    const tooltipRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (tooltipRef.current && hoveredPoint) {
            tooltipRef.current.style.left = `${Math.min(hoveredPoint.x - 300, 480)}px`;
            tooltipRef.current.style.top = `${Math.max(hoveredPoint.y - 480, 20)}px`;
        }
    }, [hoveredPoint]);

    const now = useMemo(() => new Date(), []);
    const currentYear = useMemo(() => now.getFullYear(), [now]); // 2026
    const lastYear = useMemo(() => currentYear - 1, [currentYear]);      // 2025

    // 이벤트 등록 폼 State
    const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
    const [eventTitle, setEventTitle] = useState('');
    const [eventDesc, setEventDesc] = useState('');
    const [eventType, setEventType] = useState<'price_change' | 'large_order' | 'competitor_issue' | 'other'>('other');

    // ── 데이터 Fetching ───────────────────────────────────────
    useEffect(() => {
        // Log inventoryMap size to satisfy ESLint
        console.log('[FlowChart] Inventory mapped size:', _inventoryMap?.size || 0);
        const fetchEvents = async () => {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/crm/events`, {
                    headers: {
                        'x-requester-role': 'MASTER',
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setEvents(data);
                }
            } catch (e) {
                console.error('[FlowChart] Error fetching events:', e);
            } finally {
                setEventsLoading(false);
            }
        };

        const fetchHistory = async () => {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/inventory-history`, {
                    headers: {
                        'x-requester-role': 'MASTER',
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    setHistoryData({
                        inventoryHistory: data.inventoryHistory || [],
                        daekyungHistory: data.daekyungHistory || []
                    });
                }
            } catch (e) {
                console.error('[FlowChart] Error fetching history:', e);
            } finally {
                setHistoryLoading(false);
            }
        };

        fetchEvents();
        fetchHistory();
    }, [token, _inventoryMap]);

    const handleCreateEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!eventTitle.trim() || !eventDate) return;

        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/crm/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-requester-role': 'MASTER',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    date: eventDate,
                    title: eventTitle,
                    description: eventDesc,
                    type: eventType
                })
            });

            if (res.ok) {
                const newEv = await res.json();
                setEvents(prev => [...prev, newEv].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
                setIsEventModalOpen(false);
                setEventTitle('');
                setEventDesc('');
                setEventType('other');
            }
        } catch (e) {
            console.error('[FlowChart] Error creating event:', e);
        }
    };

    const handleDeleteEvent = async (id: string) => {
        if (!window.confirm('이 이벤트를 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/crm/events/${id}`, {
                method: 'DELETE',
                headers: {
                    'x-requester-role': 'MASTER',
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                setEvents(prev => prev.filter(e => e.id !== id));
            }
        } catch (e) {
            console.error('[FlowChart] Error deleting event:', e);
        }
    };

    // ── 1. 매출 추세 연산 (1월~현재월 및 분기/반기/전체) ────────────────
    const { 
        monthlySales, 
        quarterlySales, 
        halfSales, 
        totalSales, 
        momTrend, 
        maxMonthlyAmount 
    } = useMemo(() => {
        const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
        
        // 월별 기본 구조 세팅
        const monthly: Record<string, { month: string; amount: number; lastYearAmount: number; ordersCount: number }> = {};
        months.forEach(m => {
            monthly[`${currentYear}-${m}`] = { month: `${m}월`, amount: 0, lastYearAmount: 0, ordersCount: 0 };
        });

        // 분기별
        const quarterly = {
            Q1: { label: '1분기 (Q1)', amount: 0, lastYearAmount: 0 },
            Q2: { label: '2분기 (Q2)', amount: 0, lastYearAmount: 0 },
            Q3: { label: '3분기 (Q3)', amount: 0, lastYearAmount: 0 },
            Q4: { label: '4분기 (Q4)', amount: 0, lastYearAmount: 0 },
        };

        // 반기별
        const half = {
            H1: { label: '상반기 (H1)', amount: 0, lastYearAmount: 0 },
            H2: { label: '하반기 (H2)', amount: 0, lastYearAmount: 0 },
        };

        let currentTotal = 0;
        let lastTotal = 0;

        orders.forEach(o => {
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return;
            const fullCustomerName = (o.customerName || '').toLowerCase();
            if (
                fullCustomerName.includes('서울재고') || 
                fullCustomerName.includes('시화재고') || 
                fullCustomerName.includes('알트에프') || 
                fullCustomerName.includes('altf')
            ) return;

            const date = new Date(o.createdAt);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');

            // 품목 합계 계산
            let orderTotal = 0;
            o.items?.forEach(item => {
                if (item.isDeleted) return;
                orderTotal += (item.quantity || 0) * (item.unitPrice || 0);
            });

            if (year === currentYear) {
                currentTotal += orderTotal;
                if (monthly[`${currentYear}-${month}`]) {
                    monthly[`${currentYear}-${month}`].amount += orderTotal;
                    monthly[`${currentYear}-${month}`].ordersCount += 1;
                }

                // 분기 집계
                const mNum = date.getMonth() + 1;
                if (mNum <= 3) quarterly.Q1.amount += orderTotal;
                else if (mNum <= 6) quarterly.Q2.amount += orderTotal;
                else if (mNum <= 9) quarterly.Q3.amount += orderTotal;
                else quarterly.Q4.amount += orderTotal;

                // 반기 집계
                if (mNum <= 6) half.H1.amount += orderTotal;
                else half.H2.amount += orderTotal;

            } else if (year === lastYear) {
                lastTotal += orderTotal;
                const curEquivalentKey = `${currentYear}-${month}`;
                if (monthly[curEquivalentKey]) {
                    monthly[curEquivalentKey].lastYearAmount += orderTotal;
                }

                // 분기 집계 (전년)
                const mNum = date.getMonth() + 1;
                if (mNum <= 3) quarterly.Q1.lastYearAmount += orderTotal;
                else if (mNum <= 6) quarterly.Q2.lastYearAmount += orderTotal;
                else if (mNum <= 9) quarterly.Q3.lastYearAmount += orderTotal;
                else quarterly.Q4.lastYearAmount += orderTotal;

                // 반기 집계 (전년)
                if (mNum <= 6) half.H1.lastYearAmount += orderTotal;
                else half.H2.lastYearAmount += orderTotal;
            }
        });

        // 7월(현재월) 기준 직전월(6월) 대비 증감 추세 계산
        const curMonthStr = String(now.getMonth() + 1).padStart(2, '0');
        const prevMonthStr = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0');

        const curMonthVal = monthly[`${currentYear}-${curMonthStr}`]?.amount || 0;
        const prevMonthVal = monthly[`${currentYear}-${prevMonthStr}`]?.amount || 0;

        let pct = 0;
        if (prevMonthVal > 0) {
            pct = ((curMonthVal - prevMonthVal) / prevMonthVal) * 100;
        }

        const maxAmt = Math.max(...Object.values(monthly).map(m => Math.max(m.amount, m.lastYearAmount)), 1);

        return {
            monthlySales: Object.values(monthly),
            quarterlySales: Object.values(quarterly),
            halfSales: Object.values(half),
            totalSales: { current: currentTotal, last: lastTotal },
            momTrend: { 
                currentMonth: `${now.getMonth() + 1}월`,
                prevMonth: `${now.getMonth() === 0 ? 12 : now.getMonth()}월`,
                currentVal: curMonthVal,
                prevVal: prevMonthVal,
                percent: parseFloat(pct.toFixed(1))
            },
            maxMonthlyAmount: maxAmt
        };
    }, [orders, currentYear, lastYear, now]);

    // ── 2. 지역별 판매 점유율 계산 (8도 기준) ──────────────────────
    const regionalShare = useMemo(() => {
        const shares: Record<string, number> = {};
        orders.forEach(o => {
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return;
            const fullCustomerName = (o.customerName || '').toLowerCase();
            if (
                fullCustomerName.includes('서울재고') || 
                fullCustomerName.includes('시화재고') || 
                fullCustomerName.includes('알트에프') || 
                fullCustomerName.includes('altf')
            ) return;

            // 고객 정보에서 매칭하여 지역 정보 취득
            const cleanName = o.customerName.replace(/\(주\)|주식회사/g, '').trim();
            const matched = customersList.find(c => {
                const crmClean = c.companyName.replace(/\(주\)|주식회사/g, '').trim();
                return crmClean === cleanName || crmClean.includes(cleanName) || cleanName.includes(crmClean);
            });
            const region = matched?.region || '기타/미등록';

            let orderTotal = 0;
            o.items?.forEach(item => {
                if (item.isDeleted) return;
                orderTotal += (item.quantity || 0) * (item.unitPrice || 0);
            });

            shares[region] = (shares[region] || 0) + orderTotal;
        });

        const total = Object.values(shares).reduce((a, b) => a + b, 0) || 1;

        return Object.entries(shares)
            .map(([region, amount]) => ({
                region,
                amount,
                percentage: parseFloat(((amount / total) * 100).toFixed(1))
            }))
            .sort((a, b) => b.amount - a.amount);
    }, [orders, customersList]);

    // ── 3. 이상 업체 탐지 (갑자기 나타난 업체 vs 발주가 떨어지는 업체) ───────
    const anomalies = useMemo(() => {
        const todayMs = now.getTime();
        const thirtyDaysAgo = todayMs - (30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = todayMs - (60 * 24 * 60 * 60 * 1000);

        const companyOrders: Record<string, { 
            name: string; 
            totalAmount: number; 
            recent30Amount: number;
            prev30Amount: number; 
            lastOrderDate: string;
            firstOrderDate: string;
            avgInterval: number;
            orderDates: number[];
        }> = {};

        orders.forEach(o => {
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return;
            const fullCustomerName = (o.customerName || '').toLowerCase();
            if (
                fullCustomerName.includes('서울재고') || 
                fullCustomerName.includes('시화재고') || 
                fullCustomerName.includes('알트에프') || 
                fullCustomerName.includes('altf')
            ) return;

            const name = o.customerName;
            const orderDate = new Date(o.createdAt);
            const orderTime = orderDate.getTime();

            let orderAmount = 0;
            o.items?.forEach(item => {
                if (item.isDeleted) return;
                orderAmount += (item.quantity || 0) * (item.unitPrice || 0);
            });

            if (!companyOrders[name]) {
                companyOrders[name] = { 
                    name, 
                    totalAmount: 0, 
                    recent30Amount: 0, 
                    prev30Amount: 0, 
                    lastOrderDate: o.createdAt,
                    firstOrderDate: o.createdAt,
                    avgInterval: 0,
                    orderDates: []
                };
            }

            const co = companyOrders[name];
            co.totalAmount += orderAmount;
            co.orderDates.push(orderTime);

            if (orderTime >= thirtyDaysAgo) {
                co.recent30Amount += orderAmount;
            } else if (orderTime >= sixtyDaysAgo) {
                co.prev30Amount += orderAmount;
            }

            if (new Date(co.lastOrderDate).getTime() < orderTime) {
                co.lastOrderDate = o.createdAt;
            }
            if (new Date(co.firstOrderDate).getTime() > orderTime) {
                co.firstOrderDate = o.createdAt;
            }
        });

        // 평균 발주 주기 계산
        Object.values(companyOrders).forEach(co => {
            if (co.orderDates.length > 1) {
                co.orderDates.sort((a, b) => a - b);
                let diffSum = 0;
                for (let i = 1; i < co.orderDates.length; i++) {
                    diffSum += (co.orderDates[i] - co.orderDates[i-1]);
                }
                co.avgInterval = diffSum / (co.orderDates.length - 1) / (24 * 60 * 60 * 1000);
            }
        });

        const coList = Object.values(companyOrders);

        // A. 갑자기 나타난 업체 (최근 30일 매출 급증 또는 신규 거래처 중 매출 발생)
        const rising = coList
            .map(co => {
                const isNew = new Date(co.firstOrderDate).getTime() >= thirtyDaysAgo;
                const changeAmount = co.recent30Amount - co.prev30Amount;
                const pct = co.prev30Amount > 0 ? (changeAmount / co.prev30Amount) * 100 : 100;
                
                return {
                    ...co,
                    isNew,
                    changeAmount,
                    percentChange: parseFloat(pct.toFixed(1))
                };
            })
            .filter(co => co.recent30Amount > 1000000 && (co.isNew || co.changeAmount > 1000000))
            .sort((a, b) => b.recent30Amount - a.recent30Amount)
            .slice(0, 5);

        // B. 발주가 떨어지는 업체 (과거 상위 25% 핵심 매출처이나, 최근 45일간 발주 없음 혹은 평균 주기를 1.8배 이상 지연 중인 곳)
        const fortyFiveDaysAgo = todayMs - (45 * 24 * 60 * 60 * 1000);
        const ltvThreshold = 5000000; // 누적 500만원 이상 우량 업체 대상
        
        const dropping = coList
            .map(co => {
                const daysSinceLast = (todayMs - new Date(co.lastOrderDate).getTime()) / (24 * 60 * 60 * 1000);
                const delayFactor = co.avgInterval > 0 ? daysSinceLast / co.avgInterval : 1;
                
                return {
                    ...co,
                    daysSinceLast: Math.round(daysSinceLast),
                    delayFactor: parseFloat(delayFactor.toFixed(1))
                };
            })
            .filter(co => {
                if (co.totalAmount < ltvThreshold) return false;
                const orderTime = new Date(co.lastOrderDate).getTime();
                const isDormant45d = orderTime < fortyFiveDaysAgo;
                const isSeverelyDelayed = co.avgInterval > 7 && co.daysSinceLast > co.avgInterval * 1.8;
                return isDormant45d || isSeverelyDelayed;
            })
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .slice(0, 5);

        return { rising, dropping };
    }, [orders, now]);

    // ── 4. 대경벤드/시화재고 변동에 따른 매출 변화 분석 및 상관 감지 ───────────
    const correlationAnalysis = useMemo(() => {
        // 일별 재고 변동 및 매출액 연동 (최근 30일)
        const daysToAnalyze = 30;
        const analysisData: { date: string; daekyungChange: number; sihwaChange: number; salesAmount: number }[] = [];
        
        for (let i = daysToAnalyze - 1; i >= 0; i--) {
            const dateObj = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = dateObj.toISOString().slice(0, 10);
            
            // 대경 재고 출고량 (diff 중 change가 음수인 것의 절댓값 합)
            const dkRecord = historyData.daekyungHistory.find(h => h.date === dateStr);
            const dkChg = dkRecord?.diff?.reduce((sum, d) => d.change < 0 ? sum + Math.abs(d.change) : sum, 0) || 0;
            
            // 시화 재고 출고량
            const shRecord = historyData.inventoryHistory.find(h => h.date === dateStr);
            const shChg = shRecord?.diff?.reduce((sum, d) => d.change < 0 ? sum + Math.abs(d.change) : sum, 0) || 0;

            // 해당 날짜 매출액
            const dailyOrders = orders.filter(o => {
                if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return false;
                const fullCustomerName = (o.customerName || '').toLowerCase();
                if (
                    fullCustomerName.includes('서울재고') || 
                    fullCustomerName.includes('시화재고') || 
                    fullCustomerName.includes('알트에프') || 
                    fullCustomerName.includes('altf')
                ) return false;
                return o.createdAt.slice(0, 10) === dateStr;
            });

            let salesTotal = 0;
            dailyOrders.forEach(o => {
                o.items?.forEach(item => {
                    if (item.isDeleted) return;
                    salesTotal += (item.quantity || 0) * (item.unitPrice || 0);
                });
            });

            analysisData.push({
                date: dateStr.slice(5, 10), // MM-DD
                daekyungChange: dkChg,
                sihwaChange: shChg,
                salesAmount: salesTotal
            });
        }

        // 피어슨 상관계수 구하기
        // 대경 재고 감소량(출고량)과 매출액 간 상관계수
        const xDk = analysisData.map(d => d.daekyungChange);
        const ySales = analysisData.map(d => d.salesAmount);
        const dkSalesCorr = calculateCorrelation(xDk, ySales);

        // 시화 재고 감소량(출고량)과 매출액 간 상관계수
        const xSh = analysisData.map(d => d.sihwaChange);
        const shSalesCorr = calculateCorrelation(xSh, ySales);

        // 상관관계 해석 텍스트 생성
        let dkReason = '상관관계 분석 중...';
        if (dkSalesCorr < -0.4) {
            dkReason = `상관계수 ${dkSalesCorr} (강한 음의 상관관계): 대경벤드 공장 재고가 줄어들 때(출고 증가), 우리 시화재고 주문 매출액이 동반 급상승하는 뚜렷한 대체 효과가 감지됩니다.`;
        } else if (dkSalesCorr > 0.4) {
            dkReason = `상관계수 ${dkSalesCorr} (강한 양의 상관관계): 대경벤드에 입고(재고 증가)가 원활할 때, 우리 시화 매출도 안정적으로 동반 증가하는 공급선 공급-수요 연동 효과가 보입니다.`;
        } else {
            dkReason = `상관계수 ${dkSalesCorr} (약한 상관관계): 대경벤드 재고 변동과 단기(30일) 매출액 간의 유의미한 직접적 연동 수치는 발견되지 않았습니다. 장기적 단가 인상 주기를 확인하십시오.`;
        }

        let shReason = '시화재고 분석 중...';
        if (shSalesCorr > 0.5) {
            shReason = `상관계수 ${shSalesCorr} (높은 상관성): 시화 자체 재고 소진(출고)과 일일 실 판매 매출액 추세선이 완벽히 일치하여, 재고 회전 즉시 즉각적인 현금화가 달성되고 있습니다.`;
        } else {
            shReason = `상관계수 ${shSalesCorr} (중간/낮은 상관성): 출고 기록 대비 당일 배송 처리 매출 연동이 지연되거나, 사급 및 제작 주문 비중이 높아 재고 출고 타이밍과 일치도가 낮습니다.`;
        }

        return { analysisData, dkSalesCorr, shSalesCorr, dkReason, shReason };
    }, [historyData, orders, now]);

    // ── 5. 매출 추세선 위의 월별 이벤트 매핑 ────────────────────────
    const monthlyEventsMapped = useMemo(() => {
        const mapping: Record<string, CrmEvent[]> = {};
        events.forEach(e => {
            const yyyymm = e.date.slice(0, 7); // YYYY-MM
            if (!mapping[yyyymm]) mapping[yyyymm] = [];
            mapping[yyyymm].push(e);
        });
        return mapping;
    }, [events]);

    if (eventsLoading || historyLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                <div className="font-bold text-sm">Flow Chart 데이터를 분석하고 있습니다...</div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20 text-slate-800">
            {/* 상단 타이틀 카드 */}
            <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-slate-900 to-indigo-950 p-6 md:p-8 text-white shadow-xl">
                <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500 rounded-full filter blur-[100px] opacity-20 -mr-20 -mt-20"></div>
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-rose-500 rounded-full filter blur-[100px] opacity-10 -ml-20 -mb-20"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-1.5 bg-indigo-500/20 text-indigo-300 font-black text-xs px-3.5 py-1.5 rounded-full border border-indigo-400/20 tracking-wider uppercase">
                            <Activity className="w-3.5 h-3.5" />
                            CRM Deep Analytics Engine
                        </div>
                        <h1 className="text-3xl font-black tracking-tight md:text-4xl">
                            CRM Flow Chart <span className="text-indigo-400">Portal</span>
                        </h1>
                        <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
                            전사 매출 추세 분석, 대경/시화 재고 변동 연동성 감지, 지역별 이상 주문 감지 및 비즈니스 이벤트를 통합 오버레이하여 차트 기반 의사결정 근거를 제공합니다.
                        </p>
                    </div>

                    <div className="flex gap-3 shrink-0">
                        <button
                            type="button"
                            onClick={() => setIsEventModalOpen(true)}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-black text-xs px-5 py-3 rounded-2xl shadow-lg border border-indigo-400/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" />
                            비즈니스 이벤트 등록
                        </button>
                    </div>
                </div>
            </div>

            {/* 상단 4단 KPI 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                {/* 1. 당월 매출 현황 */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs relative overflow-hidden">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">당월 매출 현황 ({momTrend.currentMonth})</div>
                    <div className="text-2xl font-black text-slate-800 mt-2">
                        {Math.round(momTrend.currentVal / 10000).toLocaleString()}만원
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs">
                        {momTrend.percent > 0 ? (
                            <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                                <TrendingUp className="w-3.5 h-3.5" /> +{momTrend.percent}%
                            </span>
                        ) : momTrend.percent < 0 ? (
                            <span className="text-rose-500 font-bold flex items-center gap-0.5">
                                <TrendingDown className="w-3.5 h-3.5" /> {momTrend.percent}%
                            </span>
                        ) : (
                            <span className="text-slate-400">변동 없음</span>
                        )}
                        <span className="text-slate-400 font-bold">대비 {momTrend.prevMonth} ({Math.round(momTrend.prevVal / 10000).toLocaleString()}만)</span>
                    </div>
                </div>

                {/* 2. 올해 전사 LTV */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs relative overflow-hidden">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">올해 전사 누적 매출 ({currentYear}년)</div>
                    <div className="text-2xl font-black text-indigo-600 mt-2">
                        {Math.round(totalSales.current / 10000).toLocaleString()}만원
                    </div>
                    <div className="text-xs text-slate-400 font-bold mt-2">
                        전년 동기 누적: {Math.round(totalSales.last / 10000).toLocaleString()}만원
                    </div>
                </div>

                {/* 3. 대경재고 연동 상관계수 */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs relative overflow-hidden">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        대경재고-매출 연동성
                        <span title="대경벤드 양산재고 출고량과 실 매출액 간의 상관계수입니다.">
                            <HelpCircle className="w-3.5 h-3.5 text-slate-300 cursor-help" />
                        </span>
                    </div>
                    <div className="text-2xl font-black text-amber-500 mt-2 flex items-center gap-1.5">
                        {correlationAnalysis.dkSalesCorr}
                        <span className="text-xs font-bold text-slate-400">
                            {correlationAnalysis.dkSalesCorr < -0.4 ? '대체 효과 강함' : '낮은 연동성'}
                        </span>
                    </div>
                    <div className="text-xs text-slate-400 font-bold mt-2 truncate">
                        최근 30일 재고 변동량 분석
                    </div>
                </div>

                {/* 4. 기록된 중요 비즈니스 이벤트 */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs relative overflow-hidden">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">누적 기록된 비즈니스 이벤트</div>
                    <div className="text-2xl font-black text-teal-600 mt-2">
                        {events.length}건
                    </div>
                    <div className="text-xs text-slate-400 font-bold mt-2">
                        최근 추가: {events[0] ? `${events[0].date} - ${events[0].title}` : '없음'}
                    </div>
                </div>
            </div>

            {/* 메인 차트 및 분석 섹션 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* 왼쪽 2칸: 매출 추세 & 비즈니스 이벤트 오버레이 차트 */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-xs p-6 space-y-6 flex flex-col justify-between">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-indigo-600" />
                            전사 매출 추세 분석 및 중요 비즈니스 이벤트 매핑
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">
                            올해 월별 실적과 전년 동기 대비 추이를 비교합니다. 그래프 위의 점에 마우스를 올리면 이벤트 정보가 표시됩니다.
                        </p>
                    </div>

                    {/* 커스텀 SVG 매출 추세 및 이벤트 매핑 차트 */}
                    <div className="relative pt-6">
                        <svg className="w-full h-72" viewBox="0 0 700 280">
                            {/* Grid Lines */}
                            {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
                                const yPos = 20 + r * 200;
                                return (
                                    <line 
                                        key={idx} 
                                        x1="40" 
                                        y1={yPos} 
                                        x2="680" 
                                        y2={yPos} 
                                        stroke="#f1f5f9" 
                                        strokeWidth="1.5" 
                                        strokeDasharray="4 4"
                                    />
                                );
                            })}

                            {/* X축 */}
                            <line x1="40" y1="220" x2="680" y2="220" stroke="#cbd5e1" strokeWidth="1.5" />

                            {/* 막대 차트 (올해 매출) 및 꺾은선 차트 (전년 매출) */}
                            {monthlySales.map((m, idx) => {
                                const xPos = 65 + idx * 52;
                                
                                // 올해 매출 막대 계산
                                const thisYearHeight = maxMonthlyAmount > 0 ? (m.amount / maxMonthlyAmount) * 200 : 0;
                                const thisYearY = 220 - thisYearHeight;

                                // 전년 매출 꺾은선 점 계산
                                const lastYearHeight = maxMonthlyAmount > 0 ? (m.lastYearAmount / maxMonthlyAmount) * 200 : 0;
                                const lastYearY = 220 - lastYearHeight;

                                // 현재 월에 등록된 이벤트가 있는지 검사
                                const monthKey = `${currentYear}-${String(idx + 1).padStart(2, '0')}`;
                                const monthEvs = monthlyEventsMapped[monthKey] || [];

                                return (
                                    <g key={idx} className="group cursor-pointer">
                                        {/* 호버 배경 가이드 영역 */}
                                        <rect 
                                            x={xPos - 20} 
                                            y="10" 
                                            width="40" 
                                            height="230" 
                                            fill="transparent" 
                                            className="group-hover:fill-slate-50/50 transition-colors"
                                            onMouseEnter={(e) => {
                                                setHoveredData({
                                                    label: `${currentYear}년 ${m.month}`,
                                                    amount: m.amount,
                                                    lastYearAmount: m.lastYearAmount,
                                                    events: monthEvs
                                                });
                                                setHoveredPoint({ x: e.clientX, y: e.clientY });
                                            }}
                                            onMouseLeave={() => setHoveredData(null)}
                                        />

                                        {/* 올해 매출 막대 (그라데이션 효과) */}
                                        {m.amount > 0 && (
                                            <rect
                                                x={xPos - 12}
                                                y={thisYearY}
                                                width="24"
                                                height={thisYearHeight}
                                                rx="6"
                                                fill="url(#indigoGrad)"
                                                className="transition-all duration-500 hover:opacity-90"
                                            />
                                        )}

                                        {/* 전년도 매출 점 (동그라미) */}
                                        {m.lastYearAmount > 0 && (
                                            <circle 
                                                cx={xPos} 
                                                cy={lastYearY} 
                                                r="4.5" 
                                                fill="#fb7185" 
                                                stroke="#fff" 
                                                strokeWidth="1.5"
                                            />
                                        )}

                                        {/* 이벤트 마커 (있을 때만 렌더링) */}
                                        {monthEvs.length > 0 && (
                                            <g transform={`translate(${xPos}, ${thisYearY - 14})`}>
                                                <circle 
                                                    cx="0" 
                                                    cy="0" 
                                                    r="7" 
                                                    fill={
                                                        monthEvs[0].type === 'price_change' ? '#f43f5e' :
                                                        monthEvs[0].type === 'large_order' ? '#10b981' :
                                                        monthEvs[0].type === 'competitor_issue' ? '#eab308' : '#3b82f6'
                                                    } 
                                                    className="animate-ping opacity-75"
                                                />
                                                <circle 
                                                    cx="0" 
                                                    cy="0" 
                                                    r="6" 
                                                    fill={
                                                        monthEvs[0].type === 'price_change' ? '#f43f5e' :
                                                        monthEvs[0].type === 'large_order' ? '#10b981' :
                                                        monthEvs[0].type === 'competitor_issue' ? '#eab308' : '#3b82f6'
                                                    } 
                                                    stroke="#fff" 
                                                    strokeWidth="1.5"
                                                />
                                                <text 
                                                    x="0" 
                                                    y="3" 
                                                    fontSize="8" 
                                                    fill="#fff" 
                                                    fontWeight="black" 
                                                    textAnchor="middle"
                                                >
                                                    {monthEvs.length}
                                                </text>
                                            </g>
                                        )}

                                        {/* X축 월 텍스트 */}
                                        <text
                                            x={xPos}
                                            y="240"
                                            fontSize="10"
                                            fill="#64748b"
                                            fontWeight="bold"
                                            textAnchor="middle"
                                        >
                                            {m.month}
                                        </text>
                                    </g>
                                );
                            })}

                            {/* 전년도 매출 점들을 잇는 꺾은선 렌더링 */}
                            <path
                                d={monthlySales.reduce((acc, m, idx) => {
                                    const xPos = 65 + idx * 52;
                                    const lastYearHeight = maxMonthlyAmount > 0 ? (m.lastYearAmount / maxMonthlyAmount) * 200 : 0;
                                    const lastYearY = 220 - lastYearHeight;
                                    return acc + `${idx === 0 ? 'M' : 'L'} ${xPos} ${lastYearY}`;
                                }, '')}
                                fill="none"
                                stroke="#fb7185"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity="0.7"
                            />

                            {/* SVG Definitions */}
                            <defs>
                                <linearGradient id="indigoGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#6366f1" />
                                    <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.4" />
                                </linearGradient>
                            </defs>
                        </svg>

                        {/* 그래프 내 간이 범례 */}
                        <div className="flex items-center justify-end gap-5 text-xs text-slate-500 pr-5">
                            <div className="flex items-center gap-1.5">
                                <span className="w-3.5 h-3.5 bg-indigo-600 rounded"></span>
                                <span className="font-bold">올해 매출 ({currentYear}년)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-3.5 h-0.5 bg-rose-400 inline-block relative top-[-1px]">
                                    <span className="w-1.5 h-1.5 bg-rose-400 rounded-full absolute left-1 -top-0.5"></span>
                                </span>
                                <span className="font-bold">작년 매출 ({lastYear}년)</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-full bg-rose-500 inline-block"></span>
                                <span className="font-bold">비즈니스 이벤트</span>
                            </div>
                        </div>

                        {/* 호버 툴팁 */}
                        {hoveredData && hoveredPoint && (
                            <div 
                                ref={tooltipRef}
                                className="absolute bg-slate-900/95 text-white text-xs rounded-xl p-3 shadow-xl border border-slate-700/50 z-30 pointer-events-none w-56 space-y-2 animate-in fade-in zoom-in-95 duration-100"
                            >
                                <div className="font-black border-b border-slate-800 pb-1.5 flex justify-between">
                                    <span>{hoveredData.label}</span>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">올해 매출:</span>
                                        <span className="font-bold text-indigo-300">{Math.round(hoveredData.amount / 10000).toLocaleString()}만원</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">작년 매출:</span>
                                        <span className="font-bold text-rose-300">{Math.round(hoveredData.lastYearAmount / 10000).toLocaleString()}만원</span>
                                    </div>
                                </div>
                                
                                {hoveredData.events.length > 0 && (
                                    <div className="pt-2 border-t border-slate-800">
                                        <div className="text-[10px] font-black text-amber-400 uppercase tracking-wider mb-1">매핑된 비즈니스 이벤트</div>
                                        {hoveredData.events.map(ev => (
                                            <div key={ev.id} className="bg-slate-800 rounded p-1.5 mt-1 border border-slate-700/50 text-[10px]">
                                                <div className="font-bold text-slate-200">{ev.title}</div>
                                                <div className="text-slate-400 mt-0.5 truncate">{ev.description}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 오른쪽 1칸: 지역별 점유율 SVG 도넛 차트 */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-6 space-y-6 flex flex-col justify-between">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <MapPin className="w-5 h-5 text-indigo-600" />
                            지역별 판매 비중 (8도 기준)
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">
                            전사 거래 데이터를 기반으로 집계된 지역별(8도) 매출 점유율을 시각화합니다.
                        </p>
                    </div>

                    <div className="flex flex-col items-center justify-center space-y-5">
                        <svg className="w-48 h-48" viewBox="0 0 100 100">
                            {/* SVG 도넛 도넛 슬라이스 연산 */}
                            {(() => {
                                let accumulatedPercent = 0;
                                const colors = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#64748b'];

                                return regionalShare.map((item, idx) => {
                                    const strokeDash = item.percentage;
                                    const strokeOffset = 100 - accumulatedPercent;
                                    accumulatedPercent += strokeDash;
                                    const strokeColor = colors[idx % colors.length];

                                    return (
                                        <circle 
                                            key={item.region}
                                            cx="50" 
                                            cy="50" 
                                            r="40" 
                                            fill="transparent"
                                            stroke={strokeColor}
                                            strokeWidth="11"
                                            strokeDasharray={`${strokeDash} ${100 - strokeDash}`}
                                            strokeDashoffset={strokeOffset}
                                            transform="rotate(-90 50 50)"
                                            className="transition-all duration-300 hover:stroke-[13] cursor-pointer"
                                        >
                                            <title>{item.region}: {item.percentage}% ({Math.round(item.amount / 10000).toLocaleString()}만원)</title>
                                        </circle>
                                    );
                                });
                            })()}
                            {/* 중앙 텍스트 구멍 */}
                            <circle cx="50" cy="50" r="30" fill="#ffffff" />
                            <text x="50" y="47" fontSize="8" fill="#94a3b8" fontWeight="bold" textAnchor="middle">전체 합산</text>
                            <text x="50" y="58" fontSize="11" fill="#1e293b" fontWeight="black" textAnchor="middle">
                                {Math.round(totalSales.current / 10000).toLocaleString()}만
                            </text>
                        </svg>

                        {/* 지역별 컬러 레전드 목록 */}
                        <div className="w-full grid grid-cols-2 gap-2 text-xs">
                            {regionalShare.slice(0, 6).map((item, idx) => {
                                const bgClasses = [
                                    'bg-[#6366f1]',
                                    'bg-[#10b981]',
                                    'bg-[#f59e0b]',
                                    'bg-[#3b82f6]',
                                    'bg-[#ec4899]',
                                    'bg-[#8b5cf6]',
                                    'bg-[#64748b]'
                                ];
                                return (
                                    <div key={item.region} className="flex items-center justify-between border-b border-slate-50 pb-1">
                                        <div className="flex items-center gap-1.5">
                                            <span 
                                                className={`w-2.5 h-2.5 rounded-full inline-block ${bgClasses[idx % bgClasses.length]}`}
                                            />
                                            <span className="font-bold text-slate-600">{item.region}</span>
                                        </div>
                                        <span className="font-black text-slate-800">{item.percentage}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* 분기 및 반기 실적 분석 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-6 space-y-4">
                    <div>
                        <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-indigo-600" />
                            분기별 누적 실적 (Q1 ~ Q4)
                        </h2>
                        <p className="text-xs text-slate-400">
                            올해와 작년의 분기별 실적을 비교하고 성장 흐름을 진단합니다.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {quarterlySales.map(q => {
                            const pct = q.lastYearAmount > 0 ? ((q.amount - q.lastYearAmount) / q.lastYearAmount) * 100 : 0;
                            return (
                                <div key={q.label} className="flex justify-between items-center text-xs border-b border-slate-50 pb-2">
                                    <span className="font-bold text-slate-600">{q.label}</span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-400">작년: {Math.round(q.lastYearAmount / 10000).toLocaleString()}만</span>
                                        <span className="font-black text-slate-800">{Math.round(q.amount / 10000).toLocaleString()}만원</span>
                                        {q.lastYearAmount > 0 ? (
                                            <span className={`font-black ${pct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                {pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`}
                                            </span>
                                        ) : (
                                            <span className="text-slate-300">—</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-6 space-y-4">
                    <div>
                        <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-indigo-600" />
                            반기별 및 연간 전체 실적 (H1 ~ H2)
                        </h2>
                        <p className="text-xs text-slate-400">
                            올해 상반기, 하반기 및 연간 총 실적의 전년 동기비 지표를 도출합니다.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {halfSales.map(h => {
                            const pct = h.lastYearAmount > 0 ? ((h.amount - h.lastYearAmount) / h.lastYearAmount) * 100 : 0;
                            return (
                                <div key={h.label} className="flex justify-between items-center text-xs border-b border-slate-50 pb-2">
                                    <span className="font-bold text-slate-600">{h.label}</span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-400">작년: {Math.round(h.lastYearAmount / 10000).toLocaleString()}만</span>
                                        <span className="font-black text-slate-800">{Math.round(h.amount / 10000).toLocaleString()}만원</span>
                                        {h.lastYearAmount > 0 ? (
                                            <span className={`font-black ${pct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                {pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`}
                                            </span>
                                        ) : (
                                            <span className="text-slate-300">—</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div className="flex justify-between items-center text-xs pt-1">
                            <span className="font-black text-indigo-600">연간 누적 합계 (LTV)</span>
                            <div className="flex items-center gap-3">
                                <span className="text-slate-400 font-bold">작년: {Math.round(totalSales.last / 10000).toLocaleString()}만</span>
                                <span className="font-black text-indigo-600">{Math.round(totalSales.current / 10000).toLocaleString()}만원</span>
                                {totalSales.last > 0 ? (
                                    <span className={`font-black ${totalSales.current >= totalSales.last ? 'text-emerald-600' : 'text-rose-500'}`}>
                                        {(((totalSales.current - totalSales.last) / totalSales.last) * 100).toFixed(1)}%
                                    </span>
                                ) : (
                                    <span className="text-slate-300">—</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 재고 연동성 분석 및 듀얼 상관관계 차트 */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-6 space-y-6">
                <div>
                    <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <Package className="w-5 h-5 text-amber-500" />
                        대경벤드 & 시화재고 변동에 따른 매출 변화 감지
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                        최근 30일간 대경벤드 양산재고 출고량(보라색) 및 알트에프 시화재고 출고량(하늘색) 변화가 실제 일일 매출 발생액(노란색 막대)에 끼치는 인과관계를 비교분석합니다.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* 왼쪽 3칸: 듀얼 축 오버레이 차트 */}
                    <div className="lg:col-span-3">
                        <svg className="w-full h-64" viewBox="0 0 700 240">
                            {/* Grid Lines */}
                            {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
                                const yPos = 15 + r * 170;
                                return (
                                    <line 
                                        key={idx} 
                                        x1="45" 
                                        y1={yPos} 
                                        x2="685" 
                                        y2={yPos} 
                                        stroke="#f8fafc" 
                                        strokeWidth="1.5" 
                                    />
                                );
                            })}
                            <line x1="45" y1="185" x2="685" y2="185" stroke="#cbd5e1" strokeWidth="1.5" />

                            {/* 데이터 연산 매핑 */}
                            {(() => {
                                const maxSales = Math.max(...correlationAnalysis.analysisData.map(d => d.salesAmount), 1);
                                const maxStockChg = Math.max(...correlationAnalysis.analysisData.map(d => Math.max(d.daekyungChange, d.sihwaChange)), 1);

                                // 1. 매출액 막대 렌더링
                                const bars = correlationAnalysis.analysisData.map((d, idx) => {
                                    const xPos = 60 + idx * 21;
                                    const height = maxSales > 0 ? (d.salesAmount / maxSales) * 150 : 0;
                                    const yPos = 185 - height;
                                    return (
                                        <rect 
                                            key={`bar-${idx}`}
                                            x={xPos - 5}
                                            y={yPos}
                                            width="10"
                                            height={height}
                                            fill="#f59e0b"
                                            opacity="0.3"
                                            className="hover:opacity-60 transition-opacity"
                                        >
                                            <title>{d.date} 매출: {Math.round(d.salesAmount / 10000).toLocaleString()}만원</title>
                                        </rect>
                                    );
                                });

                                // 2. 대경벤드 재고 출고선 렌더링
                                const dkPoints = correlationAnalysis.analysisData.map((d, idx) => {
                                    const xPos = 60 + idx * 21;
                                    const height = maxStockChg > 0 ? (d.daekyungChange / maxStockChg) * 150 : 0;
                                    const yPos = 185 - height;
                                    return { x: xPos, y: yPos, change: d.daekyungChange };
                                });

                                const dkPath = dkPoints.reduce((acc, p, idx) => {
                                    return acc + `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`;
                                }, '');

                                // 3. 시화재고 출고선 렌더링
                                const shPoints = correlationAnalysis.analysisData.map((d, idx) => {
                                    const xPos = 60 + idx * 21;
                                    const height = maxStockChg > 0 ? (d.sihwaChange / maxStockChg) * 150 : 0;
                                    const yPos = 185 - height;
                                    return { x: xPos, y: yPos, change: d.sihwaChange };
                                });

                                const shPath = shPoints.reduce((acc, p, idx) => {
                                    return acc + `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`;
                                }, '');

                                return (
                                    <>
                                        {/* 일일 매출 막대 */}
                                        {bars}

                                        {/* 대경재고 출고 선 */}
                                        <path d={dkPath} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                        {dkPoints.map((p, idx) => p.change > 0 && (
                                            <circle key={`dk-p-${idx}`} cx={p.x} cy={p.y} r="3" fill="#8b5cf6" stroke="#fff" strokeWidth="1" />
                                        ))}

                                        {/* 시화재고 출고 선 */}
                                        <path d={shPath} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" />
                                        {shPoints.map((p, idx) => p.change > 0 && (
                                            <circle key={`sh-p-${idx}`} cx={p.x} cy={p.y} r="2.5" fill="#0ea5e9" stroke="#fff" strokeWidth="1" />
                                        ))}

                                        {/* X축 텍스트 간헐적 렌더링 */}
                                        {correlationAnalysis.analysisData.map((d, idx) => {
                                            if (idx % 4 !== 0) return null;
                                            const xPos = 60 + idx * 21;
                                            return (
                                                <text key={`x-lbl-${idx}`} x={xPos} y="202" fontSize="9" fill="#94a3b8" textAnchor="middle" fontWeight="bold">
                                                    {d.date}
                                                </text>
                                            );
                                        })}
                                    </>
                                );
                            })()}
                        </svg>

                        {/* 그래프 범례 */}
                        <div className="flex items-center justify-center gap-6 text-xs text-slate-500 mt-2">
                            <div className="flex items-center gap-1.5">
                                <span className="w-3.5 h-3 bg-amber-500/30 border border-amber-500/20 inline-block"></span>
                                <span className="font-bold text-slate-600">일일 실 판매 매출액</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-3.5 h-0.5 bg-indigo-500 inline-block relative top-[-1px]">
                                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full absolute left-1 -top-0.5"></span>
                                </span>
                                <span className="font-bold text-slate-600">대경 양산재고 출고량</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-3.5 h-0.5 bg-sky-400 border-t border-dashed inline-block relative top-[-1px]">
                                    <span className="w-1.5 h-1.5 bg-sky-400 rounded-full absolute left-1 -top-0.5"></span>
                                </span>
                                <span className="font-bold text-slate-600">시화 자체재고 출고량</span>
                            </div>
                        </div>
                    </div>

                    {/* 오른쪽 1칸: 분석 결과 해설 및 판단 근거 */}
                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 flex flex-col justify-between space-y-4">
                        <div className="space-y-3">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                📊 AI 연동성 판단 근거
                            </div>
                            
                            <div className="space-y-3.5 text-xs text-slate-600 leading-relaxed">
                                <div className="border-b border-slate-200 pb-3">
                                    <div className="font-black text-slate-800 mb-1 flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                        대경벤드 재고 영향
                                    </div>
                                    <p className="text-[11px] text-slate-500">{correlationAnalysis.dkReason}</p>
                                </div>

                                <div>
                                    <div className="font-black text-slate-800 mb-1 flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                                        시화재고 회전율 영향
                                    </div>
                                    <p className="text-[11px] text-slate-500">{correlationAnalysis.shReason}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 text-[10px] text-amber-800 font-bold leading-relaxed">
                            💡 **판단 가이드**: 대경재고의 음의 상관성(-0.4이하)이 감지될 시, 대경 측의 품절에 긴급 대응하기 위해 구매사들이 시화 물량으로 이전 발주하고 있음을 의미합니다. 시화의 안전 재고 비축량을 선제적으로 15% 늘리십시오.
                        </div>
                    </div>
                </div>
            </div>

            {/* 하단: 업체 이상 감지 모니터 & 이벤트 목록 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* 1. 갑자기 나타난 업체 */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex flex-col justify-between">
                    <div>
                        <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
                            <span className="flex w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            📈 갑자기 나타난 업체 (급부상)
                        </h3>
                        <div className="space-y-3">
                            {anomalies.rising.length === 0 ? (
                                <div className="text-xs text-slate-400 py-10 text-center">최근 급상승한 업체가 발견되지 않았습니다.</div>
                            ) : (
                                anomalies.rising.map(c => (
                                    <div key={c.name} className="flex justify-between items-center p-2.5 rounded-xl border border-slate-50 bg-slate-50/30">
                                        <div>
                                            <div className="text-xs font-black text-slate-800 flex items-center gap-1">
                                                {c.name}
                                                {c.isNew && <span className="bg-blue-100 text-blue-700 text-[8px] font-black px-1 rounded-sm">신규</span>}
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-1">
                                                마지막 발주: {c.lastOrderDate.slice(0,10)}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-black text-slate-800">
                                                {Math.round(c.recent30Amount / 10000).toLocaleString()}만원
                                            </div>
                                            <div className="text-[10px] text-emerald-600 font-bold mt-0.5 flex items-center justify-end gap-0.5">
                                                <ArrowUpRight className="w-3.5 h-3.5" /> +{c.percentChange}%
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* 2. 발주가 떨어지는 업체 */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex flex-col justify-between">
                    <div>
                        <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
                            <span className="flex w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
                            🚨 발주가 떨어지는 업체 (이탈 위험)
                        </h3>
                        <div className="space-y-3">
                            {anomalies.dropping.length === 0 ? (
                                <div className="text-xs text-slate-400 py-10 text-center">우량 이탈 위험 거래처가 없습니다. 양호한 관리 상태입니다.</div>
                            ) : (
                                anomalies.dropping.map(c => (
                                    <div key={c.name} className="flex justify-between items-center p-2.5 rounded-xl border border-slate-50 bg-slate-50/30">
                                        <div>
                                            <div className="text-xs font-black text-slate-800">{c.name}</div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-1 flex gap-2">
                                                <span>마지막 발주: {c.daysSinceLast}일 전</span>
                                                <span className="text-rose-500 font-bold">({c.delayFactor}배 지연)</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-black text-slate-800">
                                                누적 {Math.round(c.totalAmount / 10000).toLocaleString()}만
                                            </div>
                                            <span className="inline-block mt-1 text-[8px] bg-rose-50 text-rose-600 font-bold border border-rose-100 rounded px-1.5 py-0.5">
                                                밀착 방어 필요
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* 3. 최근 기록된 중요 비즈니스 이벤트 목록 */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-indigo-600" />
                                최근 비즈니스 이벤트 목록
                            </h3>
                        </div>
                        <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                            {eventsLoading ? (
                                <div className="text-xs text-slate-400 py-10 text-center">이벤트를 불러오는 중...</div>
                            ) : events.length === 0 ? (
                                <div className="text-xs text-slate-400 py-10 text-center">등록된 이벤트가 없습니다.</div>
                            ) : (
                                events.slice(0, 10).map(e => (
                                    <div key={e.id} className="p-2.5 rounded-xl border border-slate-50 bg-slate-50/50 relative group">
                                        <button 
                                            type="button"
                                            onClick={() => handleDeleteEvent(e.id)}
                                            className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer animate-in fade-in duration-200"
                                            title="삭제"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
                                                e.type === 'price_change' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                                                e.type === 'large_order' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                                e.type === 'competitor_issue' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                                                'bg-slate-100 text-slate-600 border border-slate-200'
                                            }`}>
                                                {e.type === 'price_change' ? '가격변동' :
                                                 e.type === 'large_order' ? '대량발주' :
                                                 e.type === 'competitor_issue' ? '경쟁사' : '기타'}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-bold">{e.date}</span>
                                        </div>
                                        <div className="text-xs font-black text-slate-800 mt-1.5 leading-snug">{e.title}</div>
                                        {e.description && (
                                            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed bg-white rounded p-1.5 border border-slate-100">{e.description}</p>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 비즈니스 이벤트 등록 모달 */}
            {isEventModalOpen && (
                <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-xs">
                    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
                        <div className="bg-linear-to-r from-slate-900 to-indigo-950 p-5 text-white flex justify-between items-center">
                            <div>
                                <h3 className="font-black text-base flex items-center gap-2">
                                    <Calendar className="w-5 h-5 text-indigo-400" />
                                    비즈니스 이벤트 등록
                                </h3>
                                <p className="text-[10px] text-slate-400 mt-0.5">매출 차트 시간축에 기록할 이벤트를 입력하세요</p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setIsEventModalOpen(false)}
                                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                                title="닫기"
                                aria-label="닫기"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateEvent} className="p-6 space-y-4 text-xs font-bold">
                            <div>
                                <label 
                                    htmlFor="event-date"
                                    className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5"
                                >
                                    이벤트 발생 일자
                                </label>
                                <input 
                                    type="date" 
                                    id="event-date"
                                    value={eventDate}
                                    onChange={e => setEventDate(e.target.value)}
                                    placeholder="YYYY-MM-DD"
                                    title="이벤트 발생 일자"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">이벤트 분류</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {([
                                        { type: 'price_change', label: '💸 가격 변동' },
                                        { type: 'large_order', label: '📦 대량 발주' },
                                        { type: 'competitor_issue', label: '⚔️ 경쟁사 이슈' },
                                        { type: 'other', label: '💡 기타 이벤트' }
                                    ] as const).map(item => (
                                        <button
                                            key={item.type}
                                            type="button"
                                            onClick={() => setEventType(item.type)}
                                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all text-center ${
                                                eventType === item.type 
                                                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-200'
                                                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label 
                                    htmlFor="event-title"
                                    className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5"
                                >
                                    이벤트 제목
                                </label>
                                <input 
                                    type="text" 
                                    id="event-title"
                                    value={eventTitle}
                                    onChange={e => setEventTitle(e.target.value)}
                                    placeholder="예: 단가 인상 공문 전송, 특정업체 대규모 발주 등"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white"
                                    required
                                />
                            </div>

                            <div>
                                <label 
                                    htmlFor="event-desc"
                                    className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5"
                                >
                                    상세 내용 설명 (선택)
                                </label>
                                <textarea 
                                    id="event-desc"
                                    value={eventDesc}
                                    onChange={e => setEventDesc(e.target.value)}
                                    placeholder="상세한 배경 설명이나 연관된 정보를 작성하세요"
                                    rows={3}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white resize-none"
                                />
                            </div>

                            <button
                                type="submit"
                                className="w-full bg-gradient-to-r from-slate-900 to-indigo-950 text-white font-black text-xs py-3.5 rounded-xl shadow-lg border border-indigo-400/20 hover:from-slate-800 hover:to-indigo-900 transition-all cursor-pointer mt-2"
                            >
                                기록 및 매출 그래프 매핑
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
