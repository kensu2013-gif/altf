import { useState, useMemo, useEffect } from 'react';
import { Users, MapPin, Building2, TrendingUp, Search, Contact, Activity, AlertTriangle, Trash2, Edit2, Plus, BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import type { Product, Quotation } from '../../types';

interface Customer {
    id: string;
    companyName: string;
    ceo: string;
    businessNumber: string;
    address: string;
    region: string;
    salesType: string;
    industry: string;
    items: string;
    contactName: string;
    phone: string;
    email: string;
    isDeleted?: boolean;
}

// ── 업체별 인텔리전스 카드 타입 ──────────────────────────────
interface CompanyIntelCard {
  companyName: string;
  region: string;
  ceo: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;

  // 거래 요약
  totalOrders: number;           // 전체 발주 건수
  totalAmount: number;           // 전체 누적 매출
  totalQty: number;              // 전체 누적 수량
  totalCost: number;             // 추정 매입 원가
  avgOrderAmount: number;        // 건당 평균 발주액
  marginRate: number;            // 추정 마진율 (%)

  // 견적 전환
  quoteCount: number;            // 견적 요청 건수
  quoteAnswered: number;         // 견적 답변 건수
  orderFromQuote: number;        // 견적 기반 발주 건수
  conversionRate: number;        // 전환율 (%)

  // 월별 매출 (최근 12개월)
  monthlyData: {
    month: string;               // "YYYY-MM"
    amount: number;
    qty: number;
    orderCount: number;
  }[];

  // 주력 품목
  topItems: {
    itemKey: string;
    qty: number;
    amount: number;
    cost: number;
    orderCount: number;          // 이 품목이 포함된 주문 건수
    lastOrderDate: string;
  }[];

  // 거래 활동
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number;
  avgOrderIntervalDays: number;  // 평균 발주 주기 (일)
  predictedNextOrder: string;    // 예상 다음 발주일

  // 전략 등급
  status: 'NEW' | 'GROWTH' | 'STABLE' | 'CHURN_RISK' | 'DORMANT';
  ltv: number;                   // LTV: 연환산 매출 (12개월 기준)
  marketingAction: string;
  marketingTargetItems: string[]; // 추가 제안 가능한 품목
}

// 마케팅 타겟 판단 기준
const CHURN_RISK_DAYS = 45;    // 최근 N일 내 주문 없으면 이탈 위험
const DORMANT_DAYS = 90;       // N일 이상 무주문이면 휴면
const GROWTH_RATE_THRESHOLD = 1.3; // 이전 대비 30% 이상 성장

const stripCorp = (name: string) => {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '')
               .replace(/[^a-zA-Z0-9가-힣]/g, '')
               .trim();
};

const isInvalidCustomer = (c: Customer) => {
    const noAddr = !c.address || c.address.trim() === '';
    const noContact = !c.contactName || c.contactName.trim() === '';
    const noPhone = !c.phone || c.phone.trim() === '';
    const noEmail = !c.email || c.email.trim() === '';
    return noAddr && noContact && noPhone && noEmail;
};

import { getSharedMaterialColor } from '../../lib/productUtils';

const getMaterialColor = getSharedMaterialColor;

interface ResolveOrderType {
    po_items?: Array<{
        productId?: string | null;
        name?: string | null;
        supplierPriceOverride?: number | null;
        supplierRate?: number | null;
    }>;
}

interface ResolveItemType {
    productId?: string | null;
    item_id?: string | null;
    name?: string | null;
    base_price?: number | null;
    supplierPriceOverride?: number | null;
    supplierRate?: number | null;
}

interface ResolveProductType {
    base_price?: number;
    unitPrice?: number;
    rate_act2?: number;
    rate_act?: number;
    rate_pct?: number;
}

const resolveItemCost = (o: ResolveOrderType, itemExt: ResolveItemType, product: ResolveProductType | undefined | null, unitPrice: number): number => {
    const id = itemExt.productId || itemExt.item_id || '';
    const basePrice = (itemExt.base_price && itemExt.base_price > 0) 
        ? itemExt.base_price 
        : (product?.base_price ?? product?.unitPrice ?? 0);
    
    let costPrice = Math.round((unitPrice * 0.9) / 10) * 10;
    
    // [FIX] Read from po_items if available, since supplier data is managed there.
    const poItem = o.po_items?.find((p) => p.productId === id && p.name === itemExt.name);
    const override = poItem?.supplierPriceOverride ?? itemExt.supplierPriceOverride;
    const sRate = poItem?.supplierRate ?? itemExt.supplierRate;

    if (override != null && override > 0) {
        costPrice = override;
    } else if (sRate != null && sRate > 0) {
        costPrice = Math.round((basePrice * (100 - sRate) / 100) / 10) * 10;
    } else if (product) {
        const rate = product.rate_act2 || product.rate_act || product.rate_pct || 0;
        if (rate > 0) {
            costPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
        }
    }
    return costPrice;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolveOrderDate = (o: any): Date => {
    const parseDateStr = (yy: string, mm: string, dd: string) => {
        const year = yy.length === 2 ? `20${yy}` : yy;
        return new Date(`${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T12:00:00Z`); // Noon UTC avoids TZ shifts
    };

    // 1. Check poNumber or id for YYYYMMDD or YYMMDD
    const identifiers = [o.poNumber, o.id].filter(Boolean);
    for (const str of identifiers) {
        if (typeof str !== 'string') continue;
        
        // Match YYYYMMDD (e.g. PO-20260422-1016)
        let m = str.match(/\D(20\d{6})(-|$)/);
        if (m) return parseDateStr(m[1].slice(0, 4), m[1].slice(4, 6), m[1].slice(6, 8));
        
        // Match YYMMDD (e.g. ES260422-1016 or O-GYEON-260315-001)
        m = str.match(/\D(\d{6})(-|$)/);
        if (m) return parseDateStr(m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6));
    }

    // 2. Try to parse Korean date from payload.meta.created_at
    const kDateStr = o.payload?.meta?.created_at;
    if (typeof kDateStr === 'string') {
        const kDateMatch = kDateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
        if (kDateMatch) return parseDateStr(kDateMatch[1], kDateMatch[2], kDateMatch[3]);
    }
    
    // 3. Fallback to createdAt, shifted to Noon UTC to prevent month boundary timezone issues
    const d = new Date(o.createdAt || new Date());
    if (!isNaN(d.getTime())) {
        return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00Z`);
    }
    return new Date();
};

export default function Customers() {
    const user = useStore(state => state.auth.user);
    const token = useStore(state => state.auth.token);
    const orders = useStore(state => state.orders);
    const setOrders = useStore(state => state.setOrders);
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [customersList, setCustomersList] = useState<Customer[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
    const [activeTab, setActiveTab] = useState<'MASTER' | 'ANALYTICS' | 'COMPANY_ANALYTICS' | 'BI_ANALYTICS' | 'STRATEGY_ANALYTICS' | 'COMPANY_CARD' | 'ACTION_INTEL'>('MASTER');

    // ── ACTION INTEL 탭 전용 State ──────────────────────────────
    const [intelSubView, setIntelSubView] = useState<'urgent' | 'prep' | 'strategy' | 'growth' | 'inventory'>('urgent');
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
    const [intelRegion, setIntelRegion] = useState<string>('ALL');
    const [intelCardItemSort, setIntelCardItemSort] = useState<'amount' | 'qty' | 'freq'>('amount'); // renamed from cardItemSort to avoid conflict

    const toggleCard = (id: string) => {
        setExpandedCards(prev => {
            const next = new Set(prev);
            if (next.has(id)) { next.clear(); }
            else { next.clear(); next.add(id); }
            return next;
        });
    };

    const [analyticsSortBy, setAnalyticsSortBy] = useState<'qty' | 'amount' | 'margin'>('qty');
    const [expandedStrategyGroups, setExpandedStrategyGroups] = useState<Record<string, boolean>>({
        CHURN_RISK: true, GROWTH: true, STABLE: false, NEW: true, DORMANT: false
    });
    const [strategyPeriod, setStrategyPeriod] = useState<30 | 90 | 180 | 365>(30);
    const [strategySearchTerm, setStrategySearchTerm] = useState('');
    const [strategySelectedRegion, setStrategySelectedRegion] = useState<string>('ALL');
    
    // COMPANY_CARD states
    const [companyCardSortBy, setCompanyCardSortBy] = useState<'amount' | 'qty' | 'orders' | 'conversion'>('amount');
    const [companyCardRegion, setCompanyCardRegion] = useState<string>('ALL');
    const [companyCardPeriod, setCompanyCardPeriod] = useState<string>('ALL');
    const [companyCardSearch, setCompanyCardSearch] = useState<string>('');
    const [companyCardExpanded, setCompanyCardExpanded] = useState<Record<string, boolean>>({});
    const [cardItemSortBy, setCardItemSortBy] = useState<'qty' | 'amount' | 'freq'>('amount');
    
    // Inventory mapped for cost inference
    const { inventory } = useInventory();
    const inventoryMap = useMemo(() => {
        const map = new Map<string, Product>();
        inventory.forEach((p: Product) => map.set(p.id, p));
        return map;
    }, [inventory]);
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);

    // Analytics Modal State
    const [analyticsModalRegion, setAnalyticsModalRegion] = useState<{
        region: string;
        totalQty: number;
        totalAmount: number;
        allItems: [string, {qty: number; amount: number; cost: number; material: string}][];
    } | null>(null);

    const fetchCustomers = async () => {
        try {
            const headers: Record<string, string> = { 'x-requester-role': user?.role || 'GUEST' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, { headers });
            if (res.ok) {
                const data = await res.json();
                setCustomersList(data.filter((c: Customer) => !c.isDeleted && !isInvalidCustomer(c)));
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const loadInit = async () => {
            try {
                const headers: Record<string, string> = { 'x-requester-role': user?.role || 'GUEST' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) {
                        setCustomersList(data.filter((c: Customer) => !c.isDeleted && !isInvalidCustomer(c)));
                    }
                }
                
                // Fetch Orders to ensure BI Engine survives Hard Refresh (F5)
                const orderHeaders: Record<string, string> = {
                    'Content-Type': 'application/json'
                };
                if (token) orderHeaders['Authorization'] = `Bearer ${token}`;
                if (user?.id) orderHeaders['x-requester-id'] = user.id;
                if (user?.role) orderHeaders['x-requester-role'] = user.role;

                const ordersRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/orders?limit=2000`, { headers: orderHeaders });
                const quotesRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/quotations?limit=2000`, { headers: orderHeaders });
                if (ordersRes.ok) {
                    const ordersData = await ordersRes.json();
                    if (isMounted && Array.isArray(ordersData)) {
                        setOrders(ordersData);
                    }
                }
                if (quotesRes.ok) {
                    const quotesData = await quotesRes.json();
                    if (isMounted && Array.isArray(quotesData)) {
                        setQuotations(quotesData);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };
        loadInit();
        return () => { isMounted = false; };
    }, [user?.role, user?.id, token, setOrders]);

    const handlePurge = async () => {
        if (!window.confirm("정말 [이메일, 연락처, 주소, 담당자명] 중 하나라도 누락된 업체와 중복 데이터를 싹 지우시겠습니까?\n이 작업은 즉시 S3 데이터베이스에 반영되며 복구할 수 없습니다.")) return;
        try {
            const headers: Record<string, string> = { 'x-requester-role': user?.role || 'GUEST' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/action/purge`, {
                method: 'POST',
                headers
            });
            if (res.ok) {
                const data = await res.json();
                alert(`정화 완료!\n기존 ${data.originalCount}업체 -> 정예화 후 ${data.newCount}업체로 리셋되었습니다.`);
                fetchCustomers();
            } else {
                alert('권한이 없거나 오류가 발생했습니다.');
            }
        } catch(e) {
            console.error(e);
            alert('오류가 발생했습니다.');
        }
    };

    const handleDelete = async (id: string, companyName: string) => {
        if (!window.confirm(`[${companyName}]을(를) 정말 삭제하시겠습니까?`)) return;
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-requester-role': user?.role || 'GUEST'
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ isDeleted: true })
            });
            if (res.ok) {
                setCustomersList(prev => prev.filter(c => c.id !== id));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSaveForm = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingCustomer) return;
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-requester-role': user?.role || 'GUEST'
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            if (editingCustomer.id) {
                // UPDATE
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${editingCustomer.id}`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify(editingCustomer)
                });
                if (res.ok) {
                    const saved = await res.json();
                    if (!isInvalidCustomer(saved)) {
                        setCustomersList(prev => prev.map(c => c.id === saved.id ? saved : c));
                    } else {
                        setCustomersList(prev => prev.filter(c => c.id !== saved.id));
                    }
                    setIsModalOpen(false);
                }
            } else {
                // CREATE
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(editingCustomer)
                });
                if (res.ok) {
                    const saved = await res.json();
                    if (!isInvalidCustomer(saved)) {
                        setCustomersList(prev => [saved, ...prev]);
                    }
                    setIsModalOpen(false);
                }
            }
        } catch(e) {
            console.error(e);
            alert('저장 중 오류가 발생했습니다.');
        }
    };

    const regions = useMemo(() => {
        const set = new Set<string>();
        customersList.forEach(c => c.region && set.add(c.region));
        return ['경기도', '경상도', ...Array.from(set).filter(r => r !== '경기도' && r !== '경상도')].sort();
    }, [customersList]);

    const filtered = useMemo(() => {
        let list = customersList;
        if (selectedRegion !== 'ALL') {
            list = list.filter(c => c.region === selectedRegion);
        }
        if (searchTerm) {
            const low = searchTerm.toLowerCase();
            list = list.filter(c => 
                (c.companyName && c.companyName.toLowerCase().includes(low)) ||
                (c.address && c.address.toLowerCase().includes(low)) ||
                (c.contactName && c.contactName.toLowerCase().includes(low))
            );
        }
        
        // 주문 빈도수 계산
        const freqs: Record<string, number> = {};
        orders.forEach(o => {
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return;
            if ((o.customerName || '').includes('서울재고')) return;
            const stripped = stripCorp(o.customerName);
            freqs[stripped] = (freqs[stripped] || 0) + 1;
        });

        // 빈도수가 높은 업체를 위로 정렬
        return [...list].sort((a, b) => {
            const freqA = freqs[stripCorp(a.companyName)] || 0;
            const freqB = freqs[stripCorp(b.companyName)] || 0;
            return freqB - freqA;
        });
    }, [searchTerm, selectedRegion, customersList, orders]);

    const stats = useMemo(() => {
        return {
            total: customersList.length,
            "경기도": customersList.filter(c => c.region === '경기도').length,
            "경상도": customersList.filter(c => c.region === '경상도').length,
            etc: customersList.filter(c => c.region !== '경기도' && c.region !== '경상도').length
        };
    }, [customersList]);

    // Analytics Engine
    const analytics = useMemo(() => {
        const regionMap: Record<string, { totalAmount: number; totalCost: number; totalQty: number; items: Record<string, {qty: number; amount: number; cost: number; material: string}>; missingCustomers: Map<string, string> }> = {};
        
        orders.forEach(o => {
            const oExt = o as typeof o & { isDeleted?: boolean; poEndCustomer?: string; payload?: { customer?: { company_name?: string } } };
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN' || oExt.isDeleted) return;

            // Exclude ALL internal stock orders (e.g. 서울재고)
            const fullCustomerName = (oExt.poEndCustomer || oExt.payload?.customer?.company_name || o.customerName || '').toLowerCase();
            if (fullCustomerName.includes('서울재고') || fullCustomerName.includes('시화재고') || fullCustomerName.includes('재고입고') || fullCustomerName.includes('stock')) return;
            
            const cleanOrderName = stripCorp(o.customerName);
            const customer = customersList.find(c => {
                const cleanCrm = stripCorp(c.companyName);
                if (!cleanOrderName || !cleanCrm) return false;
                return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
            });
            const region = customer?.region || 'CRM 미등록/예외';
            
            if (!regionMap[region]) {
                regionMap[region] = { totalAmount: 0, totalCost: 0, totalQty: 0, items: {}, missingCustomers: new Map() };
            }
            if (!customer && cleanOrderName) {
                const existing = regionMap[region].missingCustomers.get(cleanOrderName);
                if (!existing || (!existing.includes('(주)') && o.customerName.includes('(주)'))) {
                    regionMap[region].missingCustomers.set(cleanOrderName, o.customerName);
                }
            }

            o.items?.forEach(item => {
                const itemExt = item as typeof item & { item_id?: string, supplierPriceOverride?: number, isDeleted?: boolean, material?: string };
                if (itemExt.isDeleted) return; 

                const quantity = item.quantity || 0;
                if (quantity <= 0) return;
                const unitPrice = item.unitPrice || 0;

                const id = itemExt.productId || itemExt.item_id || '';
                const product = inventoryMap.get(id);

                const materialInfo = product?.material || itemExt.material || '';
                const matString = materialInfo ? `-${materialInfo}` : '';
                const itemKey = `${item.name}-${item.thickness}-${item.size}${matString}`;
                
                const costPrice = resolveItemCost(o, itemExt, product, unitPrice);

                const itemAmount = quantity * unitPrice;
                const itemCost = quantity * costPrice;

                regionMap[region].totalQty += quantity;
                regionMap[region].totalAmount += itemAmount;
                regionMap[region].totalCost += itemCost;
                
                if (!regionMap[region].items[itemKey]) {
                    regionMap[region].items[itemKey] = {qty: 0, amount: 0, cost: 0, material: materialInfo};
                }
                regionMap[region].items[itemKey].qty += quantity;
                regionMap[region].items[itemKey].amount += itemAmount;
                regionMap[region].items[itemKey].cost += itemCost;
            });
        });

        // Convert to sorted array
        const results = Object.keys(regionMap)
            .filter(k => k !== 'CRM 미등록/예외')
            .map(k => {
                let allItems = Object.entries(regionMap[k].items);
                if (analyticsSortBy === 'amount') {
                    allItems = allItems.sort((a,b) => b[1].amount - a[1].amount);
                } else if (analyticsSortBy === 'margin') {
                    allItems = allItems.sort((a,b) => (b[1].amount - b[1].cost) - (a[1].amount - a[1].cost));
                } else {
                    allItems = allItems.sort((a,b) => b[1].qty - a[1].qty);
                }
                
                return {
                    region: k,
                    ...regionMap[k],
                    topItems: allItems.slice(0, 10), // For dashboard compact view
                    allItems, // Store all for modal
                    missingArray: Array.from(regionMap[k].missingCustomers.values())
                };
            }).sort((a,b) => {
                const REGION_ORDER = ['경기도', '경상도', '전라도', '충청도'];
                const idxA = REGION_ORDER.indexOf(a.region);
                const idxB = REGION_ORDER.indexOf(b.region);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                
                if (analyticsSortBy === 'amount') return b.totalAmount - a.totalAmount;
                if (analyticsSortBy === 'margin') return (b.totalAmount - b.totalCost) - (a.totalAmount - a.totalCost);
                return b.totalQty - a.totalQty;
            });

        return results;
    }, [orders, customersList, inventoryMap, analyticsSortBy]);

    // Strategic BI Analytics Engine
    const biAnalytics = useMemo(() => {
        const clusterMap: Record<string, {
            totalAmount: number;
            totalCost: number;
            totalQty: number;
            items: Record<string, { qty: number; amount: number; cost: number; count: number }>;
        }> = {};

        const getCluster = (region: string, address: string) => {
            if (address.includes('여수') || region === '전라도') return '여수/전라권 (석유/화학)';
            if (address.includes('울산') || region === '경상도') return '울산/경상권 (조선/중공업)';
            if (address.includes('서울') || address.includes('경기') || region === '경기도') return '경기/서울권 (반도체/신도심)';
            return '충청권 및 기타 주요산단';
        };

        orders.forEach(o => {
            // Exclude cancelled/withdrawn or soft-deleted orders
            const oExt = o as typeof o & { 
                isDeleted?: boolean; 
                poEndCustomer?: string; 
                payload?: { customer?: { company_name?: string } }; 
            };
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN' || oExt.isDeleted) return;
            
            // Rigorous check to exclude ALL internal stock orders (e.g. 서울재고)
            const fullCustomerName = (oExt.poEndCustomer || oExt.payload?.customer?.company_name || o.customerName || '').toLowerCase();
            if (fullCustomerName.includes('서울재고') || fullCustomerName.includes('시화재고') || fullCustomerName.includes('재고입고') || fullCustomerName.includes('stock')) return;
            
            const cleanOrderName = stripCorp(o.customerName);
            const customer = customersList.find(c => {
                const cleanCrm = stripCorp(c.companyName);
                if (!cleanOrderName || !cleanCrm) return false;
                return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
            });
            const region = customer?.region || '미분류';
            const address = customer?.address || '';
            const cluster = getCluster(region, address);
            
            if (!clusterMap[cluster]) {
                clusterMap[cluster] = { totalAmount: 0, totalCost: 0, totalQty: 0, items: {} };
            }

            o.items?.forEach(item => {
                const itemExt = item as typeof item & { item_id?: string, supplierPriceOverride?: number, isDeleted?: boolean };
                if (itemExt.isDeleted) return; // Skip line items that were individually removed
                
                const itemKey = `${item.name}-${item.thickness}-${item.size}`;
                const quantity = item.quantity || 0;
                if (quantity <= 0) return; // Skip items with no actual sale volume
                
                const unitPrice = item.unitPrice || 0;
                
                
                // Safely use itemExt for legacy/dynamic fields
                const id = itemExt.productId || itemExt.item_id || '';
                const product = inventoryMap.get(id);

                const costPrice = resolveItemCost(o, itemExt, product, unitPrice);

                const itemAmount = quantity * unitPrice;
                const itemCost = quantity * costPrice;

                clusterMap[cluster].totalQty += quantity;
                clusterMap[cluster].totalAmount += itemAmount;
                clusterMap[cluster].totalCost += itemCost;
                
                if (!clusterMap[cluster].items[itemKey]) {
                    clusterMap[cluster].items[itemKey] = {qty: 0, amount: 0, cost: 0, count: 0};
                }
                clusterMap[cluster].items[itemKey].qty += quantity;
                clusterMap[cluster].items[itemKey].amount += itemAmount;
                clusterMap[cluster].items[itemKey].cost += itemCost;
                clusterMap[cluster].items[itemKey].count += 1;
            });
        });

        const results = Object.keys(clusterMap).map(k => {
            const allItems = Object.entries(clusterMap[k].items);
            
            const topRevenueItems = [...allItems]
                .sort((a,b) => b[1].amount - a[1].amount)
                .slice(0, 5);
                
            const topVolumeItems = [...allItems]
                .sort((a,b) => b[1].count - a[1].count)
                .slice(0, 5);

            return {
                clusterName: k,
                ...clusterMap[k],
                topRevenueItems,
                topVolumeItems,
            };
        }).sort((a,b) => b.totalAmount - a.totalAmount);

        return results;
    }, [orders, customersList, inventoryMap]);

    // 1. Company Analytics Engine (지역/거래처별 판매분석)
    const companyAnalytics = useMemo(() => {
        const regionMap: Record<string, {
            region: string;
            totalQty: number;
            totalAmount: number;
            companies: Record<string, {
                companyName: string;
                totalQty: number;
                totalAmount: number;
                totalCost: number;
                items: Record<string, {qty: number, amount: number, cost: number, material: string}>;
            }>
        }> = {};

        orders.forEach(o => {
            const oExt = o as typeof o & { isDeleted?: boolean; poEndCustomer?: string; payload?: { customer?: { company_name?: string } } };
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN' || oExt.isDeleted) return;

            const fullCustomerName = (oExt.poEndCustomer || oExt.payload?.customer?.company_name || o.customerName || '').toLowerCase();
            if (fullCustomerName.includes('서울재고') || fullCustomerName.includes('시화재고') || fullCustomerName.includes('재고입고') || fullCustomerName.includes('stock')) return;
            
            const cleanOrderName = stripCorp(o.customerName);
            const customer = customersList.find(c => {
                const cleanCrm = stripCorp(c.companyName);
                if (!cleanOrderName || !cleanCrm) return false;
                return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
            });
            const region = customer?.region || '미분류/기타';
            const companyName = customer?.companyName || o.customerName || '미확인 업체';

            if (!regionMap[region]) {
                regionMap[region] = { region, totalQty: 0, totalAmount: 0, companies: {} };
            }
            if (!regionMap[region].companies[companyName]) {
                regionMap[region].companies[companyName] = { companyName, totalQty: 0, totalAmount: 0, totalCost: 0, items: {} };
            }

            o.items?.forEach(item => {
                const itemExt = item as typeof item & { item_id?: string, isDeleted?: boolean, material?: string };
                if (itemExt.isDeleted) return;

                const quantity = item.quantity || 0;
                if (quantity <= 0) return;
                const unitPrice = item.unitPrice || 0;

                const id = itemExt.productId || itemExt.item_id || '';
                const product = inventoryMap.get(id);

                const materialInfo = product?.material || itemExt.material || '';
                const matString = materialInfo ? `-${materialInfo}` : '';
                const itemKey = `${item.name}-${item.thickness}-${item.size}${matString}`;
                
                const costPrice = resolveItemCost(o, itemExt, product, unitPrice);

                const itemAmount = quantity * unitPrice;
                const itemCost = quantity * costPrice;

                regionMap[region].totalQty += quantity;
                regionMap[region].totalAmount += itemAmount;
                
                const comp = regionMap[region].companies[companyName];
                comp.totalQty += quantity;
                comp.totalAmount += itemAmount;
                comp.totalCost += itemCost;
                
                if (!comp.items[itemKey]) {
                    comp.items[itemKey] = {qty: 0, amount: 0, cost: 0, material: materialInfo};
                }
                comp.items[itemKey].qty += quantity;
                comp.items[itemKey].amount += itemAmount;
                comp.items[itemKey].cost += itemCost;
            });
        });

        return Object.values(regionMap).map(r => {
            const sortedCompanies = Object.values(r.companies).map(c => {
                const allItems = Object.entries(c.items);
                let sortedItems = allItems;
                if (analyticsSortBy === 'amount') {
                    sortedItems = sortedItems.sort((a,b) => b[1].amount - a[1].amount);
                } else if (analyticsSortBy === 'margin') {
                    sortedItems = sortedItems.sort((a,b) => (b[1].amount - b[1].cost) - (a[1].amount - a[1].cost));
                } else {
                    sortedItems = sortedItems.sort((a,b) => b[1].qty - a[1].qty);
                }
                return { ...c, topItems: sortedItems.slice(0, 3) };
            }).sort((a, b) => {
                if (analyticsSortBy === 'amount') return b.totalAmount - a.totalAmount;
                if (analyticsSortBy === 'margin') return (b.totalAmount - b.totalCost) - (a.totalAmount - a.totalCost);
                return b.totalQty - a.totalQty;
            });
            return { ...r, sortedCompanies };
        }).sort((a, b) => {
            const REGION_ORDER = ['경기도', '경상도', '전라도', '충청도'];
            const idxA = REGION_ORDER.indexOf(a.region);
            const idxB = REGION_ORDER.indexOf(b.region);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return b.totalAmount - a.totalAmount;
        });
    }, [orders, customersList, inventoryMap, analyticsSortBy]);

    // 2. Strategy Analytics Engine (심화 BI 업체별 전략 분석)
    const strategyAnalytics = useMemo(() => {
        const now = new Date();
        const recentDaysAgo = new Date(now.getTime() - (strategyPeriod * 24 * 60 * 60 * 1000));
        const previousDaysAgo = new Date(now.getTime() - (strategyPeriod * 2 * 24 * 60 * 60 * 1000));

        const compMap: Record<string, {
            companyName: string;
            region: string;
            recentAmount: number;
            previousAmount: number;
            recentQty: number;
            previousQty: number;
            totalAmount: number;
            lastOrderDate: Date | null;
            firstOrderDate: Date | null;
        }> = {};

        orders.forEach(o => {
            const oExt = o as typeof o & { isDeleted?: boolean; poEndCustomer?: string; payload?: { customer?: { company_name?: string } } };
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN' || oExt.isDeleted) return;

            const fullCustomerName = (oExt.poEndCustomer || oExt.payload?.customer?.company_name || o.customerName || '').toLowerCase();
            if (fullCustomerName.includes('서울재고') || fullCustomerName.includes('시화재고') || fullCustomerName.includes('재고입고') || fullCustomerName.includes('stock')) return;
            
            const cleanOrderName = stripCorp(o.customerName);
            const customer = customersList.find(c => {
                const cleanCrm = stripCorp(c.companyName);
                if (!cleanOrderName || !cleanCrm) return false;
                return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
            });
            const companyName = customer?.companyName || o.customerName || '미확인 업체';
            const region = customer?.region || '미분류';

            if (!compMap[companyName]) {
                compMap[companyName] = { 
                    companyName, region, recentAmount: 0, previousAmount: 0, 
                    recentQty: 0, previousQty: 0, totalAmount: 0,
                    lastOrderDate: null, firstOrderDate: null
                };
            }

            const orderDate = new Date(o.createdAt || new Date());
            const comp = compMap[companyName];

            if (!comp.lastOrderDate || orderDate > comp.lastOrderDate) comp.lastOrderDate = orderDate;
            if (!comp.firstOrderDate || orderDate < comp.firstOrderDate) comp.firstOrderDate = orderDate;

            let orderAmount = 0;
            let orderQty = 0;
            o.items?.forEach(i => {
                orderAmount += (i.quantity || 0) * (i.unitPrice || 0);
                orderQty += (i.quantity || 0);
            });

            comp.totalAmount += orderAmount;
            if (orderDate >= recentDaysAgo) {
                comp.recentAmount += orderAmount;
                comp.recentQty += orderQty;
            } else if (orderDate >= previousDaysAgo && orderDate < recentDaysAgo) {
                comp.previousAmount += orderAmount;
                comp.previousQty += orderQty;
            }
        });

        // Determine Status
        return Object.values(compMap)
            .filter(c => c.totalAmount > 0)
            .map(c => {
                let status: 'NEW' | 'GROWTH' | 'STABLE' | 'CHURN_RISK' | 'DORMANT' = 'STABLE';
                let action = '안정적 거래 유지 중. 추가 취급품목 제안 가능';

                // To prevent noise from tiny orders (e.g. comparing 50,000 to 100,000), set a minimum threshold
                const MIN_THRESHOLD = 500000;

                if (c.firstOrderDate && c.firstOrderDate >= recentDaysAgo) {
                    status = 'NEW';
                    action = '신규 유입 - 온보딩 케어 및 정기 발주 유도';
                } else if (!c.lastOrderDate || c.lastOrderDate < previousDaysAgo) {
                    status = 'DORMANT';
                    action = '장기 미발주 - 프로모션 및 단가 할인 재제안';
                } else if (c.recentAmount === 0 && c.previousAmount > MIN_THRESHOLD) {
                    status = 'CHURN_RISK';
                    action = `이탈 징후 🚨 - 최근 ${strategyPeriod}일 무발주. 긴급 컨택 요망`;
                } else if (c.recentAmount > 0 && c.previousAmount > MIN_THRESHOLD && c.recentAmount <= c.previousAmount * 0.5) {
                    status = 'CHURN_RISK';
                    action = `매출 급감 🚨 - 이전 동기 대비 발주 반토막. 경쟁사 유입 의심`;
                } else if (c.recentAmount >= c.previousAmount * 1.3 && c.previousAmount > MIN_THRESHOLD) {
                    status = 'GROWTH';
                    action = '매출 성장 📈 - 우수 고객 혜택 안내 및 점유율 굳히기';
                }

                // Growth rate
                let growthRate = 0;
                if (c.previousAmount > 0) {
                    growthRate = ((c.recentAmount - c.previousAmount) / c.previousAmount) * 100;
                } else if (c.recentAmount > 0) {
                    growthRate = 100; // Infinity treated as 100% just for display context if prev is 0
                }

                return { ...c, status, action, growthRate };
            }).sort((a,b) => {
                // sort by totalAmount descending by default
                return b.totalAmount - a.totalAmount;
            });

    }, [orders, customersList, strategyPeriod]);

    const companyIntelCards = useMemo((): CompanyIntelCard[] => {
      // ── Step 1: 업체별 전체 집계 ─────────────────────────────
      const cardMap: Record<string, {
        companyName: string;
        region: string;
        ceo: string;
        address: string;
        contactName: string;
        phone: string;
        email: string;
        orders: typeof orders;                    // 이 업체의 주문 배열
        totalAmount: number;
        totalQty: number;
        totalCost: number;
        quoteCount: number;
        quoteAnswered: number;
        orderFromQuote: number;
        confirmedOrders: number;                  // COMPLETED 건수
        monthlyMap: Record<string, { amount: number; qty: number; orderCount: number }>;
        itemMap: Record<string, { qty: number; amount: number; cost: number; orderCount: number; lastOrderDate: string }>;
        orderDates: Date[];
      }> = {};

      quotations.forEach(q => {
        if ((q.status as string) === 'TRASH' || q.isDeleted) return;
        const custName = q.customerName || (q.customerInfo ? (q.customerInfo.companyName || (q.customerInfo as Record<string, unknown>).company_name as string) : '');
        const cleanOrderName = stripCorp(custName);
        const customer = customersList.find(c => {
          const cleanCrm = stripCorp(c.companyName);
          if (!cleanOrderName || !cleanCrm) return false;
          return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
        });

        const companyName = customer ? customer.companyName : (cleanOrderName || '미확인 업체');
        if (!cardMap[companyName]) {
          cardMap[companyName] = {
            companyName,
            region: customer?.region || '미분류',
            ceo: customer?.ceo || '',
            address: customer?.address || '',
            contactName: customer?.contactName || '',
            phone: customer?.phone || '',
            email: customer?.email || '',
            orders: [],
            totalAmount: 0,
            totalQty: 0,
            totalCost: 0,
            quoteCount: 0,
            quoteAnswered: 0,
            orderFromQuote: 0,
            confirmedOrders: 0,
            monthlyMap: {},
            itemMap: {},
            orderDates: [],
          };
        }
        cardMap[companyName].quoteCount += 1;
        if (q.status === 'PROCESSED' || q.status === 'COMPLETED') cardMap[companyName].quoteAnswered += 1;
        if (q.status === 'COMPLETED') cardMap[companyName].orderFromQuote += 1;
      });

      orders.forEach(o => {
        const oExt = o as typeof o & {
          isDeleted?: boolean;
          poEndCustomer?: string;
          payload?: { customer?: { company_name?: string } };
        };

        if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN' || oExt.isDeleted) return;

        // 날짜 필터 적용
        const orderDate = new Date(o.createdAt || new Date());
        const year = orderDate.getFullYear();
        const month = orderDate.getMonth() + 1;
        const currentYear = new Date().getFullYear();

        if (companyCardPeriod !== 'ALL') {
          if (companyCardPeriod.startsWith('LAST_')) {
            const days = parseInt(companyCardPeriod.replace('LAST_', '').replace('_DAYS', ''));
            const cutoffDate = new Date(now.getTime() - days * 86400000);
            if (orderDate < cutoffDate) return;
          } else if (companyCardPeriod === 'THIS_YEAR' && year !== currentYear) return;
          else if (companyCardPeriod === 'H1' && (year !== currentYear || month > 6)) return;
          else if (companyCardPeriod === 'H2' && (year !== currentYear || month < 7)) return;
          else if (companyCardPeriod === 'Q1' && (year !== currentYear || month > 3)) return;
          else if (companyCardPeriod === 'Q2' && (year !== currentYear || month < 4 || month > 6)) return;
          else if (companyCardPeriod === 'Q3' && (year !== currentYear || month < 7 || month > 9)) return;
          else if (companyCardPeriod === 'Q4' && (year !== currentYear || month < 10)) return;
          else if (companyCardPeriod.startsWith('M')) {
            const m = parseInt(companyCardPeriod.substring(1));
            if (year !== currentYear || month !== m) return;
          }
        }

        // 내부 재고 주문 제외
        const fullCustomerName = (
          oExt.poEndCustomer || oExt.payload?.customer?.company_name || o.customerName || ''
        ).toLowerCase();
        if (
          fullCustomerName.includes('서울재고') ||
          fullCustomerName.includes('시화재고') ||
          fullCustomerName.includes('재고입고') ||
          fullCustomerName.includes('stock')
        ) return;

        const cleanOrderName = stripCorp(o.customerName);
        const customer = customersList.find(c => {
          const cleanCrm = stripCorp(c.companyName);
          if (!cleanOrderName || !cleanCrm) return false;
          return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
        });

        const companyName = customer?.companyName || o.customerName || '미확인 업체';
        const region = customer?.region || '미분류';

        if (!cardMap[companyName]) {
          cardMap[companyName] = {
            companyName,
            region,
            ceo: customer?.ceo || '',
            address: customer?.address || '',
            contactName: customer?.contactName || '',
            phone: customer?.phone || '',
            email: customer?.email || '',
            orders: [],
            totalAmount: 0,
            totalQty: 0,
            totalCost: 0,
            quoteCount: 0,
            quoteAnswered: 0,
            orderFromQuote: 0,
            confirmedOrders: 0,
            monthlyMap: {},
            itemMap: {},
            orderDates: [],
          };
        }

        const card = cardMap[companyName];
        card.orders.push(o);

        // 견적 vs 발주 카운트 (status 기반)
        const statusLower = (o.status || '').toLowerCase();
        if (statusLower === 'completed' || statusLower === 'confirmed') {
          card.confirmedOrders += 1;
        }

        // 날짜
        card.orderDates.push(orderDate);

        // 월별 집계
        const monthKey = orderDate.toISOString().slice(0, 7); // "YYYY-MM"
        if (!card.monthlyMap[monthKey]) {
          card.monthlyMap[monthKey] = { amount: 0, qty: 0, orderCount: 0 };
        }
        card.monthlyMap[monthKey].orderCount += 1;

        // 아이템 집계
        o.items?.forEach(item => {
          const itemExt = item as typeof item & {
            item_id?: string;
            supplierPriceOverride?: number;
            isDeleted?: boolean;
            material?: string;
          };
          if (itemExt.isDeleted) return;

          const quantity = item.quantity || 0;
          if (quantity <= 0) return;

          const unitPrice = item.unitPrice || 0;
          const id = itemExt.productId || itemExt.item_id || '';
          const product = inventoryMap.get(id);
          const materialInfo = product?.material || itemExt.material || '';
          const matString = materialInfo ? `-${materialInfo}` : '';
          const itemKey = `${item.name}-${item.thickness}-${item.size}${matString}`;

          // '주문관리' (QuoteItemRow.tsx) 와 매입가 계산 로직을 100% 동일하게 동기화
          const costPrice = resolveItemCost(o, itemExt, product, unitPrice);

          const itemAmount = quantity * unitPrice;
          const itemCost = quantity * costPrice;

          card.totalQty += quantity;
          card.totalAmount += itemAmount;
          card.totalCost += itemCost;
          card.monthlyMap[monthKey].amount += itemAmount;
          card.monthlyMap[monthKey].qty += quantity;

          if (!card.itemMap[itemKey]) {
            card.itemMap[itemKey] = { qty: 0, amount: 0, cost: 0, orderCount: 0, lastOrderDate: '' };
          }
          card.itemMap[itemKey].qty += quantity;
          card.itemMap[itemKey].amount += itemAmount;
          card.itemMap[itemKey].cost += itemCost;
          card.itemMap[itemKey].orderCount += 1;
          card.itemMap[itemKey].lastOrderDate = orderDate.toISOString().split('T')[0];
        });
      });

      // ── Step 2: 카드 객체 변환 ──────────────────────────────────
      const now = new Date();

      // 최근 12개월 라벨 생성
      const last12Months: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        last12Months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }

      return Object.values(cardMap)
        .filter(c => c.totalAmount > 0)
        .map(c => {
          const sortedDates = c.orderDates.sort((a, b) => a.getTime() - b.getTime());
          const firstOrderDate = sortedDates[0]?.toISOString().split('T')[0] || null;
          const lastOrderDate = sortedDates[sortedDates.length - 1]?.toISOString().split('T')[0] || null;
          const daysSinceLastOrder = lastOrderDate
            ? Math.floor((now.getTime() - new Date(lastOrderDate).getTime()) / 86400000)
            : 9999;

          // 평균 발주 주기 계산
          let avgOrderIntervalDays = 0;
          if (sortedDates.length > 1) {
            const intervals: number[] = [];
            for (let i = 1; i < sortedDates.length; i++) {
              intervals.push(
                Math.floor((sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / 86400000)
              );
            }
            avgOrderIntervalDays = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
          }

          // 예상 다음 발주일
          const predictedNextOrder = lastOrderDate && avgOrderIntervalDays > 0
            ? new Date(new Date(lastOrderDate).getTime() + avgOrderIntervalDays * 86400000)
                .toISOString().split('T')[0]
            : '예측 불가';

          // 견적 전환율
          const totalOrderCount = c.orders.length;
          const conversionRate = c.quoteCount > 0
            ? parseFloat(((c.orderFromQuote / c.quoteCount) * 100).toFixed(1))
            : 0;

          // LTV: 최근 12개월 매출 합산 → 연환산
          const recentYear = last12Months.reduce((sum, m) => sum + (c.monthlyMap[m]?.amount || 0), 0);
          const ltv = recentYear;

          // 마진율
          const marginRate = c.totalAmount > 0
            ? parseFloat((((c.totalAmount - c.totalCost) / c.totalAmount) * 100).toFixed(1))
            : 0;

          // 평균 발주액
          const avgOrderAmount = totalOrderCount > 0
            ? Math.round(c.totalAmount / totalOrderCount)
            : 0;

          // 월별 데이터 (최근 12개월)
          const monthlyData = last12Months.map(m => ({
            month: m,
            amount: c.monthlyMap[m]?.amount || 0,
            qty: c.monthlyMap[m]?.qty || 0,
            orderCount: c.monthlyMap[m]?.orderCount || 0,
          }));

          // 주력 품목 TOP 10
          const topItems = Object.entries(c.itemMap)
            .sort((a, b) => b[1].amount - a[1].amount)
            .slice(0, 10)
            .map(([itemKey, stats]) => ({ itemKey, ...stats }));

          // 타겟 마케팅 품목 (발주량 많은데 아직 안 주문한 주요 품목)
          const alreadyOrderedKeys = new Set(topItems.map(i => i.itemKey));
          const marketingTargetItems = [
            '90E(L)-S10S-50A-STS304-W', '90E(L)-S10S-25A-STS304-W',
            'T(S)-S10S-32A-STS304-W', 'CAP-S10S-32A-STS304-S',
            'T(R)-S10S-40A X 25A-STS304-W', 'R(C)-S10S-50A X 40A-STS304-W',
          ].filter(k => !alreadyOrderedKeys.has(k)).slice(0, 3);

          // 전략 상태
          let status: CompanyIntelCard['status'] = 'STABLE';
          let marketingAction = '안정적 거래 유지. 추가 취급 품목 제안 적기';
          if (daysSinceLastOrder > DORMANT_DAYS) {
            status = 'DORMANT';
            marketingAction = `장기 휴면 ${daysSinceLastOrder}일 — 단가 할인 프로모션 재제안 필요`;
          } else if (daysSinceLastOrder > CHURN_RISK_DAYS) {
            status = 'CHURN_RISK';
            marketingAction = `이탈 위험 ${daysSinceLastOrder}일 무발주 — 긴급 컨택 요망 🚨`;
          } else if (firstOrderDate && new Date(firstOrderDate) >= new Date(now.getTime() - 30 * 86400000)) {
            status = 'NEW';
            marketingAction = '신규 업체 — 정기 발주 유도 및 추천 품목 제안';
          } else {
            const recentMonth = c.monthlyMap[last12Months[last12Months.length - 1]]?.amount || 0;
            const prevMonth = c.monthlyMap[last12Months[last12Months.length - 2]]?.amount || 0;
            if (recentMonth >= prevMonth * GROWTH_RATE_THRESHOLD && prevMonth > 0) {
              status = 'GROWTH';
              marketingAction = '매출 성장 📈 — 우수 고객 혜택 안내 및 점유율 굳히기';
            }
          }

          return {
            companyName: c.companyName, region: c.region, ceo: c.ceo,
            address: c.address, contactName: c.contactName,
            phone: c.phone, email: c.email,
            totalOrders: totalOrderCount, totalAmount: c.totalAmount,
            totalQty: c.totalQty, totalCost: c.totalCost,
            avgOrderAmount, marginRate,
            quoteCount: c.quoteCount, quoteAnswered: c.quoteAnswered, orderFromQuote: c.orderFromQuote, conversionRate,
            monthlyData, topItems,
            firstOrderDate, lastOrderDate, daysSinceLastOrder,
            avgOrderIntervalDays, predictedNextOrder,
            status, ltv, marketingAction, marketingTargetItems,
          };
        })
        .sort((a, b) => b.totalAmount - a.totalAmount);

    }, [orders, quotations, customersList, inventoryMap, companyCardPeriod]);

    const totalBiRevenue = useMemo(() => {
        return biAnalytics.reduce((acc, c) => acc + c.totalAmount, 0);
    }, [biAnalytics]);

    const navigateToCompanyCard = (companyName: string, period?: string) => {
        setActiveTab('COMPANY_CARD');
        setCompanyCardSearch(companyName);
        setCompanyCardRegion('ALL');
        if (period) setCompanyCardPeriod(period);
        setCompanyCardExpanded(prev => ({ ...prev, [companyName]: true }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };


  // ── ACTION INTELLIGENCE ENGINE ───────────────────────────────
const actionIntel = useMemo(() => {
  const now = new Date();
  const CHURN_RISK_DAYS = 45;
  const DORMANT_DAYS    = 90;

  // ── 업체별 집계 ─────────────────────────────────────────
  const compMap: Record<string, {
    companyName: string;
    region:      string;
    contactName: string;
    phone:       string;
    email:       string;
    address:     string;
    totalAmount: number;
    totalCost:   number;
    totalQty:    number;
    totalOrders: number;
    quoteOrders: number;
    confirmedOrders: number;
    itemMap:  Record<string, { qty: number; amount: number; cost: number; orderCount: number; lastDate: string }>;
    monthMap: Record<string, { amount: number; qty: number; orderCount: number }>;
    orderDates: Date[];
    lastOrderDate:  Date | null;
    firstOrderDate: Date | null;
  }> = {};

  orders.forEach(o => {
    const oExt = o as typeof o & {
      isDeleted?: boolean;
      poEndCustomer?: string;
      payload?: { customer?: { company_name?: string } };
    };
    if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN' || oExt.isDeleted) return;

    const fullCust = (
      oExt.poEndCustomer || oExt.payload?.customer?.company_name || o.customerName || ''
    ).toLowerCase();
    if (
      fullCust.includes('서울재고') || fullCust.includes('시화재고') ||
      fullCust.includes('재고입고') || fullCust.includes('stock')
    ) return;

    const cleanOrderName = stripCorp(o.customerName);
    const customer = customersList.find(c => {
      const cleanCrm = stripCorp(c.companyName);
      if (!cleanOrderName || !cleanCrm) return false;
      return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
    });

    const companyName = customer?.companyName || o.customerName || '미확인 업체';
    const region      = customer?.region      || '미분류';

    if (!compMap[companyName]) {
      compMap[companyName] = {
        companyName, region,
        contactName: customer?.contactName || '',
        phone:       customer?.phone       || '',
        email:       customer?.email       || '',
        address:     customer?.address     || '',
        totalAmount: 0, totalCost: 0, totalQty: 0,
        totalOrders: 0, quoteOrders: 0, confirmedOrders: 0,
        itemMap: {}, monthMap: {}, orderDates: [],
        lastOrderDate: null, firstOrderDate: null,
      };
    }

    const card = compMap[companyName];
    card.totalOrders += 1;

    const statusL = (o.status || '').toLowerCase();
    if (statusL === 'quote' || statusL === 'pending') card.quoteOrders    += 1;
    if (statusL === 'completed' || statusL === 'shipping' || statusL === 'processing') card.confirmedOrders += 1;

    const orderDate = resolveOrderDate(o);
    card.orderDates.push(orderDate);
    if (!card.lastOrderDate  || orderDate > card.lastOrderDate)  card.lastOrderDate  = orderDate;
    if (!card.firstOrderDate || orderDate < card.firstOrderDate) card.firstOrderDate = orderDate;

    const monthKey = orderDate.toISOString().slice(0, 7);
    if (!card.monthMap[monthKey]) card.monthMap[monthKey] = { amount: 0, qty: 0, orderCount: 0 };
    card.monthMap[monthKey].orderCount += 1;

    o.items?.forEach(item => {
      const itemExt = item as typeof item & {
        item_id?: string; supplierPriceOverride?: number;
        isDeleted?: boolean; material?: string;
      };
      if (itemExt.isDeleted) return;
      const qty = item.quantity || 0;
      if (qty <= 0) return;

      const unitPrice  = item.unitPrice || 0;
      const id         = itemExt.productId || itemExt.item_id || '';
      const product    = inventoryMap.get(id);
      const matInfo    = product?.material || itemExt.material || '';
      const itemKey    = `${item.name}-${item.thickness}-${item.size}${matInfo ? `-${matInfo}` : ''}`;
      const costPrice = resolveItemCost(o, itemExt, product, unitPrice);

      const itemAmt  = qty * unitPrice;
      const itemCost = qty * costPrice;

      card.totalAmount += itemAmt;
      card.totalCost   += itemCost;
      card.totalQty    += qty;
      card.monthMap[monthKey].amount += itemAmt;
      card.monthMap[monthKey].qty    += qty;

      if (!card.itemMap[itemKey]) {
        card.itemMap[itemKey] = { qty: 0, amount: 0, cost: 0, orderCount: 0, lastDate: '' };
      }
      card.itemMap[itemKey].qty        += qty;
      card.itemMap[itemKey].amount     += itemAmt;
      card.itemMap[itemKey].cost       += itemCost;
      card.itemMap[itemKey].orderCount += 1;
      card.itemMap[itemKey].lastDate    = orderDate.toISOString().split('T')[0];
    });
  });

  // ── 최근 12개월 키 ───────────────────────────────────────
  const last12: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // ── 카드 변환 ────────────────────────────────────────────
  const cards = Object.values(compMap)
    .filter(c => c.totalAmount > 0)
    .map(c => {
      const sorted     = [...c.orderDates].sort((a, b) => a.getTime() - b.getTime());
      const lastOrder  = c.lastOrderDate;
      const firstOrder = c.firstOrderDate;
      const daysSince  = lastOrder
        ? Math.floor((now.getTime() - lastOrder.getTime()) / 86400000) : 9999;

      // 평균 주기
      let avgInterval = 0;
      if (sorted.length > 1) {
        const diffs: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          diffs.push(Math.floor((sorted[i].getTime() - sorted[i-1].getTime()) / 86400000));
        }
        avgInterval = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }

      const predictedNext = lastOrder && avgInterval > 0
        ? new Date(lastOrder.getTime() + avgInterval * 86400000).toISOString().split('T')[0]
        : null;

      const convRate = c.totalOrders > 0
        ? parseFloat(((c.confirmedOrders / c.totalOrders) * 100).toFixed(1)) : 0;
      const marginRate = c.totalAmount > 0
        ? parseFloat((((c.totalAmount - c.totalCost) / c.totalAmount) * 100).toFixed(1)) : 0;
      const avgOrderAmt = c.totalOrders > 0
        ? Math.round(c.totalAmount / c.totalOrders) : 0;
      const ltv12 = last12.reduce((s, m) => s + (c.monthMap[m]?.amount || 0), 0);

      // 월별 데이터
      const monthlyData = last12.map(m => ({
        month: m.slice(5) + '월',
        amount: c.monthMap[m]?.amount || 0,
        qty:    c.monthMap[m]?.qty    || 0,
        orderCount: c.monthMap[m]?.orderCount || 0,
      }));

      // 주력 품목 TOP 10
      const topItems = Object.entries(c.itemMap)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 10)
        .map(([key, val]) => ({ itemKey: key, ...val, marginPct: val.amount > 0 ? ((val.amount - val.cost) / val.amount * 100) : 0 }));

      // 전략 상태 판정
      let status: 'CHURN_RISK' | 'DORMANT' | 'GROWTH' | 'NEW' | 'STABLE' = 'STABLE';
      const recentMonthAmt = c.monthMap[last12[11]]?.amount || 0;
      const prevMonthAmt   = c.monthMap[last12[10]]?.amount || 0;

      if (daysSince > DORMANT_DAYS) {
        status = 'DORMANT';
      } else if (daysSince > CHURN_RISK_DAYS) {
        status = 'CHURN_RISK';
      } else if (firstOrder && now.getTime() - firstOrder.getTime() < 30 * 86400000) {
        status = 'NEW';
      } else if (recentMonthAmt >= prevMonthAmt * 1.3 && prevMonthAmt > 500000) {
        status = 'GROWTH';
      }

      // 긴급도 점수 (0~100)
      let urgencyScore = 0;
      if (status === 'CHURN_RISK') urgencyScore = 90 - daysSince;
      else if (status === 'DORMANT') urgencyScore = 20;
      else if (status === 'GROWTH') urgencyScore = -10;

      // 성장률
      const growthRate = prevMonthAmt > 0
        ? parseFloat(((recentMonthAmt - prevMonthAmt) / prevMonthAmt * 100).toFixed(1)) : 0;

      // 마케팅 액션 문구
      const marketingAction =
        status === 'CHURN_RISK' ? `${daysSince}일 무발주 — 오늘 긴급 컨택 필수 🚨` :
        status === 'DORMANT'    ? `장기 휴면 ${daysSince}일 — 단가 할인 프로모션 재제안` :
        status === 'NEW'        ? '신규 업체 — 정기 발주 유도 + 추천 품목 제안' :
        status === 'GROWTH'     ? `전월 대비 +${growthRate}% 성장 — Upsell 황금 타이밍 📈` :
        '안정적 거래 유지 — 추가 품목 제안 적기';

      // 제안 품목 (아직 안 주문한 주력 아이템)
      const orderedKeys = new Set(topItems.map(i => i.itemKey));
      const suggestItems = [
        '90E(L)-S10S-50A-STS304-W','90E(L)-S10S-25A-STS304-W',
        'T(S)-S10S-32A-STS304-W','CAP-S10S-32A-STS304-S',
        'T(R)-S10S-40A X 25A-STS304-W','R(C)-S10S-50A X 40A-STS304-W',
      ].filter(k => !orderedKeys.has(k)).slice(0, 3);

      return {
        companyName: c.companyName, region: c.region,
        contactName: c.contactName, phone: c.phone,
        email: c.email, address: c.address,
        totalAmount: c.totalAmount, totalCost: c.totalCost, totalQty: c.totalQty,
        totalOrders: c.totalOrders, convRate, marginRate, avgOrderAmt, ltv12,
        daysSince, avgInterval, predictedNext,
        firstOrderDate: firstOrder?.toISOString().split('T')[0] || null,
        lastOrderDate:  lastOrder?.toISOString().split('T')[0]  || null,
        status, growthRate, urgencyScore, marketingAction, suggestItems,
        monthlyData, topItems,
      };
    });

  // ── 서브뷰별 필터 ────────────────────────────────────────
  const byStatus = (s: string) => cards.filter(c => c.status === s);
  const urgentCards   = cards.filter(c => c.status === 'CHURN_RISK' || c.status === 'DORMANT')
                             .sort((a, b) => b.daysSince - a.daysSince);
  const growthCards   = byStatus('GROWTH').sort((a, b) => b.growthRate - a.growthRate);
  const newCards      = byStatus('NEW').sort((a, b) => b.totalAmount - a.totalAmount);
  const stableCards   = byStatus('STABLE').sort((a, b) => b.totalAmount - a.totalAmount);
  const urgentCount   = urgentCards.length;

  // 오늘 할 일 우선순위 사이드바 데이터
  const sidebarActions = [
    ...urgentCards.slice(0, 3).map(c => ({
      icon: '🚨', label: `${c.companyName} 즉시 컨택`,
      desc: `${c.daysSince}일 무발주. ${c.phone || '번호 없음'}`,
      tag: 'D-day 초과', tagColor: 'rose' as const, sub: 'urgent',
    })),
    {
      icon: '💰', label: '대경 볼륨 네고 발주 묶기',
      desc: '33개 부족 품목 2천만원 이상 묶기 가능. 절감 약 80~150만원',
      tag: '이번 주 내', tagColor: 'amber' as const, sub: 'prep',
    },
    {
      icon: '📦', label: '시화재고 목표 달성',
      desc: '목표 2.5억 대비 현재 2.07억. 0.43억 부족',
      tag: '이번 달 내', tagColor: 'amber' as const, sub: 'inventory',
    },
    ...growthCards.slice(0, 2).map(c => ({
      icon: '📈', label: `${c.companyName} Upsell 제안`,
      desc: `+${c.growthRate}% 성장 중. 미주문 품목 ${c.suggestItems.length}개 있음`,
      tag: '기회 포착', tagColor: 'green' as const, sub: 'growth',
    })),
  ].slice(0, 7);

  return {
    cards, urgentCards, growthCards, newCards, stableCards,
    urgentCount, sidebarActions, last12,
  };
}, [orders, customersList, inventoryMap]);

    if (user?.role !== 'MASTER' && user?.role?.toLowerCase() !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center h-full pt-20 text-slate-500">
                <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
                <h1 className="text-2xl font-bold text-slate-800">접근 권한 없음</h1>
                <p className="mt-2">알트에프 거래처(CRM) 원장 관리는 최고 관리자(MASTER) 권한만 접근할 수 있습니다.</p>
            </div>
        );
    }



    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-20">
            {/* TABS */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button 
                    onClick={() => setActiveTab('MASTER')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all ${activeTab === 'MASTER' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                >
                    <Users className="w-4 h-4 inline mr-2"/>
                    전사 거래처 8도 원장 (Master)
                </button>
                <button 
                    onClick={() => setActiveTab('ANALYTICS')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all ${activeTab === 'ANALYTICS' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                >
                    <BarChart2 className="w-4 h-4 inline mr-2"/>
                    지역/품목별 실판매 분석
                </button>
                <button 
                    onClick={() => setActiveTab('COMPANY_ANALYTICS')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all ${activeTab === 'COMPANY_ANALYTICS' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-500 hover:bg-amber-50 hover:text-amber-600'}`}
                >
                    <BarChart2 className="w-4 h-4 inline mr-2"/>
                    지역/거래처별 판매분석
                </button>
                <button 
                    onClick={() => setActiveTab('BI_ANALYTICS')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all flex items-center gap-1.5 ${activeTab === 'BI_ANALYTICS' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'}`}
                >
                    <TrendingUp className="w-4 h-4"/>
                    단순 마진/허브 분석
                </button>
                <button 
                    onClick={() => setActiveTab('STRATEGY_ANALYTICS')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all flex items-center gap-1.5 ${activeTab === 'STRATEGY_ANALYTICS' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-500 hover:bg-sky-50 hover:text-sky-600'}`}
                >
                    <TrendingUp className="w-4 h-4"/>
                    지역별/업체 전략 분석
                </button>
                <button
                  onClick={() => setActiveTab('COMPANY_CARD')}
                  className={`px-5 py-2.5 rounded-t-lg font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'COMPANY_CARD'
                      ? 'bg-violet-600 text-white shadow-md'
                      : 'text-slate-500 hover:bg-violet-50 hover:text-violet-600'
                  }`}
                >
                  <Contact className="w-4 h-4" />
                  업체별 인텔리전스 카드
                </button>
                <button
  onClick={() => setActiveTab('ACTION_INTEL')}
  className={`px-5 py-2.5 rounded-t-lg font-bold transition-all flex items-center gap-1.5
    ${activeTab === 'ACTION_INTEL'
      ? 'bg-linear-to-r from-rose-600 to-violet-600 text-white shadow-md'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
    }`}
>
  <Activity className="w-4 h-4" />
  Action Intelligence
  {/* 이탈위험 badge — 항상 표시 */}
  {actionIntel.urgentCount > 0 && (
    <span className="ml-1 bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
      {actionIntel.urgentCount}
    </span>
  )}
</button>
            </div>

            {activeTab === 'MASTER' && (
                <>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                                <Users className="w-7 h-7 text-indigo-600" />
                                지역별 전사 거래처 마스터 관리
                            </h1>
                            <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                                고품질 CRM 에코시스템 유지를 위해 필요 정보가 누락된 데이터는 빠르게 정화하세요.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={handlePurge}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                깡통 데이터 일괄 삭제
                            </button>
                            <button 
                                onClick={() => { setEditingCustomer({ region: '경기도' }); setIsModalOpen(true); }}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md transition-colors flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                새 거래처 추가
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-linear-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><Building2 className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><Users className="w-4 h-4"/>총 거래망 유지</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats.total}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>

                        <div className="bg-linear-to-br from-teal-500 to-emerald-600 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><MapPin className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><MapPin className="w-4 h-4"/>경기도권 (시화 배송망)</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats['경기도']}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>

                        <div className="bg-linear-to-br from-sky-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><MapPin className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><MapPin className="w-4 h-4"/>경상도권 (부산 배송망)</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats['경상도']}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>

                        <div className="bg-linear-to-br from-slate-600 to-slate-800 rounded-2xl p-5 shadow-lg text-white flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -mr-4 -mt-4 p-4 opacity-10 transform group-hover:scale-110 transition-transform"><Activity className="w-24 h-24" /></div>
                            <h3 className="font-bold flex items-center gap-2 opacity-90"><TrendingUp className="w-4 h-4"/>충청/전라/강원 기타</h3>
                            <p className="text-4xl font-black mt-2 z-10">{stats.etc}<span className="text-lg font-bold opacity-80 ml-1">업체</span></p>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-600 mr-2">지역(8도) 필터링:</span>
                                <select 
                                    title="지역 필터링"
                                    value={selectedRegion}
                                    onChange={(e) => setSelectedRegion(e.target.value)}
                                    className="bg-white border text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-indigo-500 shadow-sm"
                                >
                                    <option value="ALL">전국 지도 (전체)</option>
                                    {regions.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            
                            <div className="flex items-center gap-2 w-full md:w-auto relative">
                                <Search className="w-4 h-4 absolute left-3 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="상호명, 주소, 담당자 검색..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="bg-white border pl-9 text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-indigo-500 w-full md:w-72 shadow-inner"
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="px-5 py-3">지역구분</th>
                                        <th className="px-5 py-3">업체명 (대표자)</th>
                                        <th className="px-5 py-3">사업자 번호</th>
                                        <th className="px-5 py-3">배송/주소지</th>
                                        <th className="px-5 py-3">연락처/담당망</th>
                                        <th className="px-5 py-3 text-center">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filtered.slice(0, 300).map(c => {
                                        const missingEmail = !c.email || c.email.trim() === '';
                                        const missingBizNo = !c.businessNumber || c.businessNumber.trim() === '';

                                        return (
                                        <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                                            <td className="px-5 py-3 font-medium">
                                                {c.region === '경기도' && <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold">경기도권</span>}
                                                {c.region === '경상도' && <span className="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold">경상도권</span>}
                                                {c.region === '충청도' && <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-xs font-bold">충청도권</span>}
                                                {c.region === '전라도' && <span className="bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full text-xs font-bold">전라도권</span>}
                                                {c.region === '강원도' && <span className="bg-cyan-100 text-cyan-700 px-2.5 py-1 rounded-full text-xs font-bold">강원도권</span>}
                                                {c.region === '제주도' && <span className="bg-fuchsia-100 text-fuchsia-700 px-2.5 py-1 rounded-full text-xs font-bold">제주도권</span>}
                                                {!['경기도', '경상도', '충청도', '전라도', '강원도', '제주도'].includes(c.region || '') && (
                                                    <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full text-xs font-bold">{c.region || '미분류'}</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 font-bold text-slate-800">{c.companyName} <span className="text-[10px] text-slate-400 font-normal ml-1">({c.ceo || '-'})</span></td>
                                            <td className="px-5 py-3">
                                                <div className="flex gap-1">
                                                    {missingBizNo ? (
                                                        <span className="bg-rose-50 text-rose-500 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-bold">사업자누락</span>
                                                    ) : (
                                                        <span className="text-slate-400 text-xs font-mono">{c.businessNumber}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600 text-[13px] hover:text-indigo-600 cursor-pointer max-w-[200px] truncate" title={c.address}>
                                                <MapPin className="w-3.5 h-3.5 inline mr-1 text-slate-400"/>
                                                {c.address ? c.address : <span className="text-rose-400 text-[10px] font-bold border border-rose-200 px-1 py-0.5 rounded bg-rose-50">주소누락</span>}
                                            </td>
                                            <td className="px-5 py-3 text-slate-700 font-bold border-l border-slate-50 bg-slate-50/50">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="flex items-center gap-1.5">
                                                        <Contact className="w-3.5 h-3.5 text-indigo-400"/>
                                                        {c.contactName || <span className="text-rose-400 text-[10px] font-bold border border-rose-200 px-1 py-0.5 rounded bg-rose-50">담당자누락</span>}
                                                        ({c.phone || <span className="text-rose-400 text-[10px] font-bold border border-rose-200 px-1 py-0.5 rounded bg-rose-50">번호누락</span>})
                                                    </span>
                                                    {missingEmail ? (
                                                        <span className="bg-rose-50 text-rose-500 border border-rose-200 px-2 py-0.5 mt-0.5 rounded text-[10px] font-bold w-fit ml-5">이메일누락</span>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-500 font-normal ml-5">{c.email}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button 
                                                        onClick={() => { setEditingCustomer(c); setIsModalOpen(true); }}
                                                        className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all outline-none"
                                                        title="수정"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(c.id, c.companyName)}
                                                        className="p-1.5 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all outline-none"
                                                        title="삭제"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        )
                                    })}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-5 py-12 text-center text-slate-400 font-medium">검색된 정보가 없습니다.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'ANALYTICS' && (
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                                <BarChart2 className="w-7 h-7 text-indigo-600" />
                                판매 배관 지역 점유율 (CRM Cross Analytics)
                            </h1>
                            <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                                접수된 주문건의 상호명을 CRM 고객 명부와 크로스체크하여 "어느 지역으로 어떤 자재가 집중되고 있는지"를 분석합니다.
                            </p>
                        </div>
                        <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-inner">
                            <button 
                                onClick={() => setAnalyticsSortBy('qty')}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${analyticsSortBy === 'qty' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >수량 많은순</button>
                            <button 
                                onClick={() => setAnalyticsSortBy('amount')}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${analyticsSortBy === 'amount' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >매출액 많은순</button>
                            <button 
                                onClick={() => setAnalyticsSortBy('margin')}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${analyticsSortBy === 'margin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >순이익 높은순</button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        {analytics.map((reg) => (
                            <div key={reg.region} className={`rounded-xl border flex flex-col h-full bg-white border-slate-200 shadow-sm overflow-hidden`}>
                                <div className={`px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/80`}>
                                    <h3 className="font-bold flex items-center gap-1.5 text-base truncate">
                                        <MapPin className="w-4 h-4 text-indigo-500"/>
                                        {reg.region} 
                                    </h3>
                                    <span className="text-[10px] font-bold text-slate-500 bg-white border px-1.5 py-0.5 rounded shadow-sm shrink-0">배관 총 {reg.totalQty.toLocaleString()}개 유통</span>
                                </div>
                                <div className="p-4 flex flex-col flex-1 gap-4">
                                    <div className="flex justify-between items-end border-b border-dashed border-slate-200 pb-2">
                                         <div className="text-[11px] font-bold text-slate-400 tracking-wider">누적 매출원액</div>
                                         <div className="font-black text-slate-800 text-lg">₩{reg.totalAmount.toLocaleString()}</div>
                                    </div>
                                    
                                    <div className="flex-1">
                                        <h4 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider flex justify-between items-center">
                                            Top 베스트셀러 배관
                                            <span className="text-slate-400 font-normal">
                                                {analyticsSortBy === 'qty' ? '기준: 판매량' : analyticsSortBy === 'amount' ? '기준: 누적 매출' : '기준: 순이익'}
                                            </span>
                                        </h4>
                                        <ul className="space-y-1.5">
                                            {reg.topItems.map(([itemKey, stats], i) => (
                                                <li key={itemKey} className="flex flex-col text-[11px] bg-slate-50/50 rounded p-1.5 border border-slate-100">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="font-bold text-slate-700 flex items-center gap-1.5 truncate">
                                                            <span className="w-4 h-4 rounded bg-slate-200 text-slate-500 flex items-center justify-center text-[9px] font-bold shrink-0">{i+1}</span>
                                                            <span className="truncate" title={itemKey}>
                                                                {stats.material && itemKey.endsWith(`-${stats.material}`) ? itemKey.slice(0, -(stats.material.length + 1)) : itemKey}
                                                            </span>
                                                            {stats.material && (
                                                                <span className={`px-1.5 py-0.5 text-[9px] border rounded transition-all font-bold shrink-0 ${getMaterialColor(stats.material)}`}>
                                                                    {stats.material}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">{stats.qty.toLocaleString()}개</span>
                                                    </div>
                                                    <div className="flex items-center justify-end gap-2 text-[9px] text-slate-400">
                                                        <span>평균단가: {stats.qty > 0 ? Math.round(stats.amount/stats.qty).toLocaleString() : 0}원</span>
                                                        <span className="text-slate-500 font-bold">매출: {stats.amount.toLocaleString()}원</span>
                                                        {analyticsSortBy === 'margin' && (
                                                            <span className="text-emerald-600 font-bold">수익: {(stats.amount - stats.cost).toLocaleString()}원</span>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                            {reg.topItems.length === 0 && <li className="text-slate-400 text-xs py-2 text-center">판매된 아이템이 없습니다.</li>}
                                        </ul>
                                    </div>



                                    {reg.allItems.length > 10 && (
                                        <button 
                                            onClick={() => setAnalyticsModalRegion(reg)}
                                            className="w-full mt-2 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-100 transition-colors flex items-center justify-center gap-1"
                                        >
                                            <BarChart2 className="w-3.5 h-3.5" />
                                            자세히 보기 (총 {reg.allItems.length}개 품목)
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {analytics.length === 0 && (
                            <div className="col-span-full py-20 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                                분석할 발주 이력이 아직 없습니다.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* NEW COMPANY ANALYTICS TAB */}
            {activeTab === 'COMPANY_ANALYTICS' && (
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-black text-amber-600 flex items-center gap-2">
                                <BarChart2 className="w-7 h-7 text-amber-500" />
                                지역/거래처별 판매분석 (Company Analytics)
                            </h1>
                            <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                                권역별 우수 업체를 한눈에 파악하고 각 거래처의 주력 취급 품목 랭킹을 추적합니다.
                            </p>
                        </div>
                        <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-inner">
                            <button 
                                onClick={() => setAnalyticsSortBy('qty')}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${analyticsSortBy === 'qty' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >수량 많은순</button>
                            <button 
                                onClick={() => setAnalyticsSortBy('amount')}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${analyticsSortBy === 'amount' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >매출액 많은순</button>
                            <button 
                                onClick={() => setAnalyticsSortBy('margin')}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${analyticsSortBy === 'margin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >순이익 높은순</button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {companyAnalytics.map((reg) => (
                            <div key={`comp-reg-${reg.region}`} className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                                <div className="flex items-center gap-2 mb-4">
                                    <MapPin className="w-5 h-5 text-indigo-600"/>
                                    <h2 className="text-lg font-black text-slate-800">{reg.region}</h2>
                                    <span className="text-xs font-bold text-slate-500 bg-white border px-2 py-0.5 rounded shadow-sm">그룹 누적: ₩{reg.totalAmount.toLocaleString()}</span>
                                </div>
                                <div className="space-y-4">
                                    {reg.sortedCompanies.map((comp, i) => (
                                        <div key={comp.companyName} onClick={() => navigateToCompanyCard(comp.companyName, 'LAST_30_DAYS')} className="bg-white border text-left border-slate-200 rounded-lg p-3 shadow-sm hover:shadow-md hover:border-violet-400 transition-all cursor-pointer">
                                            <div className="flex justify-between items-center mb-2 pb-2 border-b border-dashed border-slate-100">
                                                <div className="font-bold text-slate-800 text-[15px] flex items-center gap-2">
                                                    <span className="w-5 h-5 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs">{i+1}</span>
                                                    {comp.companyName}
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[13px] font-black text-indigo-600">₩{comp.totalAmount.toLocaleString()}</div>
                                                    <div className="text-[10px] text-slate-400 font-bold">{comp.totalQty.toLocaleString()}개 발주</div>
                                                </div>
                                            </div>
                                            <div className="flex gap-2 text-[10px]">
                                                {comp.topItems.map(([itemKey, stats]) => (
                                                    <div key={itemKey} className="bg-slate-50 border border-slate-100 px-2 py-1 rounded text-slate-600 flex-1 truncate" title={itemKey}>
                                                        <span className="font-bold">{stats.material && itemKey.endsWith(`-${stats.material}`) ? itemKey.slice(0, -(stats.material.length + 1)) : itemKey}</span>
                                                        {stats.material && <span className={`ml-1 px-1 rounded text-[8px] ${getMaterialColor(stats.material)}`}>{stats.material}</span>}
                                                        <div className="mt-0.5 text-indigo-400 font-bold">{stats.qty}개 (₩{stats.amount.toLocaleString()})</div>
                                                    </div>
                                                ))}
                                                {comp.topItems.length === 0 && <span className="text-slate-400">품목 정보 없음</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {reg.sortedCompanies.length === 0 && <div className="text-center text-slate-400 text-sm py-4">거래처 데이터가 없습니다.</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* NEW STRATEGY ANALYTICS TAB */}
            {activeTab === 'STRATEGY_ANALYTICS' && (
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-black text-sky-600 flex items-center gap-2">
                                <TrendingUp className="w-7 h-7 text-sky-500" />
                                지역별/업체 전략 분석 (Regional/Strategic Action)
                            </h1>
                            <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                                선택된 지역 및 기간(예: 최근 {strategyPeriod}일 vs 이전 동기)의 매출 증감 추이를 비교하여 업체의 활동 상태를 진단합니다.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                title="지역 필터링"
                                value={strategySelectedRegion}
                                onChange={(e) => setStrategySelectedRegion(e.target.value)}
                                className="bg-white border text-slate-700 border-slate-300 rounded font-bold text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-sky-500 shadow-sm"
                            >
                                <option value="ALL">전국 지도 (전체)</option>
                                {regions.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>

                            <select
                                title="전략 분석 기간 선택"
                                value={strategyPeriod}
                                onChange={(e) => setStrategyPeriod(Number(e.target.value) as 30 | 90 | 180 | 365)}
                                className="bg-white border text-slate-700 border-slate-300 rounded font-bold text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-sky-500 shadow-sm"
                            >
                                <option value={30}>1개월 비교 (단기)</option>
                                <option value={90}>3개월 비교 (분기)</option>
                                <option value={180}>6개월 비교 (반기)</option>
                                <option value={365}>1년 비교 (장기)</option>
                            </select>

                            <div className="flex items-center gap-2 w-full md:w-auto relative">
                                <Search className="w-4 h-4 absolute left-3 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="상호명 검색..."
                                    value={strategySearchTerm}
                                    onChange={e => setStrategySearchTerm(e.target.value)}
                                    className="bg-white border pl-9 text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:border-sky-500 w-full md:w-64 shadow-inner"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-10">
                        {
                            (['CHURN_RISK', 'GROWTH', 'STABLE', 'NEW', 'DORMANT'] as const).map((statusKey) => {
                                const searchRegex = new RegExp(strategySearchTerm.replace(/ /g, ''), 'i');
                                const companiesInGroup = strategyAnalytics.filter(c => 
                                    c.status === statusKey &&
                                    (strategySearchTerm === '' || searchRegex.test(c.companyName.replace(/ /g, ''))) &&
                                    (strategySelectedRegion === 'ALL' || c.region === strategySelectedRegion)
                                );
                                if (companiesInGroup.length === 0) return null;

                                let groupTitle = '';
                                let groupColor = '';
                                let groupIcon = null;

                                if (statusKey === 'CHURN_RISK') {
                                    groupTitle = '이탈 징후 및 매출 급감 위험군';
                                    groupColor = 'text-rose-700 bg-rose-50 border-rose-200';
                                    groupIcon = '🚨';
                                } else if (statusKey === 'GROWTH') {
                                    groupTitle = '매출 급등 및 우수 성장군';
                                    groupColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
                                    groupIcon = '📈';
                                } else if (statusKey === 'STABLE') {
                                    groupTitle = '안정적 거래 유지 업체';
                                    groupColor = 'text-slate-700 bg-slate-50 border-slate-200';
                                    groupIcon = '⚖️';
                                } else if (statusKey === 'NEW') {
                                    groupTitle = '신규 유입 (온보딩 및 초기 관리)';
                                    groupColor = 'text-indigo-700 bg-indigo-50 border-indigo-200';
                                    groupIcon = '🆕';
                                } else if (statusKey === 'DORMANT') {
                                    groupTitle = '장기 휴면 (재컨택 요망)';
                                    groupColor = 'text-amber-700 bg-amber-50 border-amber-200';
                                    groupIcon = '💤';
                                }

                                const isExpanded = expandedStrategyGroups[statusKey] !== false;

                                return (
                                    <div key={statusKey} className="space-y-3">
                                        <button 
                                            onClick={() => setExpandedStrategyGroups(prev => ({ ...prev, [statusKey]: !isExpanded }))}
                                            className={`w-full flex items-center justify-between p-2.5 rounded-lg border shadow-sm transition-all hover:brightness-95 ${groupColor}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-base font-black flex items-center gap-1.5 tracking-tight">
                                                    <span>{groupIcon}</span>
                                                    {groupTitle}
                                                </h2>
                                                <div className="font-bold bg-white/70 px-2 py-0.5 rounded shadow-inner text-[11px]">
                                                    총 {companiesInGroup.length}개 
                                                </div>
                                            </div>
                                            <div className="p-1 rounded bg-white/50 text-slate-600">
                                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                            </div>
                                        </button>

                                        {isExpanded && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                            {companiesInGroup.map((comp) => {
                                                const isAlert = comp.status === 'CHURN_RISK';
                                                const isGood = comp.status === 'GROWTH' || comp.status === 'NEW';
                                                return (
                                                    <div key={comp.companyName} onClick={() => navigateToCompanyCard(comp.companyName, 'LAST_30_DAYS')} className={`cursor-pointer rounded-xl border bg-white shadow-sm overflow-hidden flex flex-col hover:shadow-md hover:border-violet-400 transition-shadow ${isAlert ? 'border-rose-300 ring-2 ring-rose-100 hover:ring-rose-200' : isGood ? 'border-emerald-200 ring-1 ring-emerald-50' : 'border-slate-200'}`}>
                                                        <div className={`px-3 py-2 border-b flex justify-between items-center ${isAlert ? 'bg-rose-50/30' : isGood ? 'bg-emerald-50/30' : 'bg-slate-50/30'}`}>
                                                            <div className="truncate pr-2">
                                                                <h3 className="font-black text-slate-800 text-[13px] truncate">{comp.companyName}</h3>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <div className="text-[11px] font-black text-slate-700 font-mono">{(Math.round(comp.totalAmount / 10000)).toLocaleString()}만원</div>
                                                            </div>
                                                        </div>
                                                        <div className="p-3 grid grid-cols-2 gap-2 flex-1 relative">
                                                            <div className="bg-slate-50 p-1.5 rounded border border-slate-100 flex flex-col justify-center">
                                                                <div className="text-[9px] text-slate-400 font-bold flex justify-between">
                                                                    <span>최근30</span>
                                                                    <span className="text-indigo-400">{comp.recentQty}건</span>
                                                                </div>
                                                                <div className="font-black text-slate-800 text-[12px] font-mono leading-none mt-0.5">{(Math.round(comp.recentAmount / 10000)).toLocaleString()}만원</div>
                                                            </div>
                                                            <div className="bg-slate-50 p-1.5 rounded border border-slate-100 flex flex-col justify-center">
                                                                <div className="text-[9px] text-slate-400 font-bold flex justify-between">
                                                                    <span>이전30</span>
                                                                    <span className="text-slate-400">{comp.previousQty}건</span>
                                                                </div>
                                                                <div className="font-black text-slate-600 text-[12px] font-mono leading-none mt-0.5">{(Math.round(comp.previousAmount / 10000)).toLocaleString()}만원</div>
                                                            </div>
                                                            
                                                            <div className="col-span-2 flex items-center justify-between text-[10px] font-bold pt-1 pb-1">
                                                                <span className="text-slate-400">증감추세:</span>
                                                                <span className={`px-1.5 py-0.5 rounded shadow-xs ${comp.growthRate > 0 ? 'bg-emerald-100/80 text-emerald-700' : comp.growthRate < 0 ? 'bg-rose-100/80 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                                                    {comp.growthRate > 0 ? '▲' : comp.growthRate < 0 ? '▼' : '-'} 
                                                                    {' '}{Math.abs(comp.growthRate).toFixed(0)}%
                                                                </span>
                                                            </div>

                                                            <div className="col-span-2">
                                                                <div className={`text-[10px] tracking-tight font-bold leading-[1.2] p-1.5 rounded shadow-inner ${isAlert ? 'bg-rose-50/50 text-rose-600 border border-rose-100' : isGood ? 'bg-emerald-50/50 text-emerald-600 border border-emerald-100' : 'bg-slate-50/50 text-slate-500 border border-slate-100'}`}>
                                                                    {comp.action}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        )}
                                    </div>
                                );
                            })
                        }

                        {strategyAnalytics.length === 0 && (
                            <div className="py-20 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                                분석할 발주 이력이 아직 없습니다.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* NEW BI ANALYTICS TAB */}
            {activeTab === 'BI_ANALYTICS' && (
                <div className="space-y-6">
                    <div>
                        <h1 className="text-2xl font-black text-rose-800 flex items-center gap-2">
                            <TrendingUp className="w-7 h-7 text-rose-600" />
                            전략 산업 허브 BI (Business Intelligence) 분석
                        </h1>
                        <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                            기존 8도 행정구역 대신 실무 물류망(여수/울산/경기) 중심으로 묶고, 단순 매출액이 아닌 '매입 원가 대비 순마진액'을 교차 분석하여 재고 및 매입 단가 전략을 수립합니다.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-5">
                        {biAnalytics.map((cluster) => {
                            return (
                                <div key={cluster.clusterName} className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden flex flex-col h-full ring-1 ring-black/5 transition-shadow hover:shadow-xl">
                                    {/* Header */}
                                    <div className="bg-linear-to-br from-indigo-50 to-white px-4 py-4 border-b border-indigo-100">
                                        <h3 className="font-black text-[15px] text-slate-800 flex items-center gap-1.5 mb-3 leading-tight">
                                            <Building2 className="w-4 h-4 text-indigo-500 shrink-0" />
                                            {cluster.clusterName}
                                        </h3>
                                        <div className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm flex flex-col items-center justify-center relative">
                                            <div className="absolute top-2 right-2 text-[9px] font-black text-white bg-indigo-500 px-1.5 py-0.5 rounded shadow-sm">
                                                점유 {totalBiRevenue > 0 ? ((cluster.totalAmount / totalBiRevenue) * 100).toFixed(1) : 0}%
                                            </div>
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">총 누적 매출</div>
                                            <div className="text-xl font-black text-slate-800 tracking-tight">₩{cluster.totalAmount.toLocaleString()}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="p-5 flex flex-col flex-1 gap-6 bg-slate-50/50">
                                        {/* High Revenue Items */}
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                            <h4 className="text-[12px] font-black text-indigo-700 mb-3 uppercase tracking-widest flex items-center justify-between border-b border-slate-100 pb-2">
                                                <span>🏆 주력 매입 추천 (매출액 랭킹)</span>
                                                <span className="text-slate-400 font-bold">기준: 누적 매출액</span>
                                            </h4>
                                            <ul className="space-y-3">
                                                {cluster.topRevenueItems.map(([itemKey, stats], i) => {
                                                    const itemMargin = stats.amount - stats.cost;
                                                    const mPct = stats.amount > 0 ? (itemMargin / stats.amount) * 100 : 0;
                                                    return (
                                                        <li key={`rev-${itemKey}`} className="flex flex-col text-[12px] bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className="font-bold text-slate-800 flex items-start gap-2 leading-tight pr-2">
                                                                    <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span>
                                                                    <span className="mt-0.5">{itemKey}</span>
                                                                </span>
                                                                <div className="text-right">
                                                                    <div className="font-black text-indigo-600 whitespace-nowrap">₩{stats.amount.toLocaleString()}</div>
                                                                    <div className="text-[10px] font-bold text-indigo-400 mt-0.5">총 {stats.qty.toLocaleString()}개 / {stats.count.toLocaleString()}회 출고</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex justify-between items-center text-[11px] text-slate-500 bg-white px-2 py-1.5 rounded border border-slate-100">
                                                                <span>추정 마진: {itemMargin > 0 ? itemMargin.toLocaleString() : 0}원</span>
                                                                <span className={`font-black ${itemMargin <= 0 ? 'text-slate-400' : 'text-slate-600'}`}>이익률 {mPct.toFixed(1)}%</span>
                                                            </div>
                                                        </li>
                                                    );
                                                })}
                                                {cluster.topRevenueItems.length === 0 && <li className="text-center text-xs text-slate-400 py-4 font-bold">집계할 데이터가 없습니다.</li>}
                                            </ul>
                                        </div>

                                        {/* High Volume Low Margin Items */}
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                            <h4 className="text-[12px] font-black text-amber-600 mb-3 uppercase tracking-widest flex items-center justify-between border-b border-slate-100 pb-2">
                                                <span>🎯 단가 협상 타겟 (판매빈도 랭킹)</span>
                                                <span className="text-slate-400 font-bold">기준: 출고 횟수</span>
                                            </h4>
                                            <ul className="space-y-3">
                                                {cluster.topVolumeItems.map(([itemKey, stats], i) => {
                                                    const itemMargin = stats.amount - stats.cost;
                                                    const mPct = stats.amount > 0 ? (itemMargin / stats.amount) * 100 : 0;
                                                    return (
                                                        <li key={`vol-${itemKey}`} className="flex flex-col text-[12px] bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className="font-bold text-slate-800 flex items-start gap-2 pr-2 leading-tight">
                                                                    <span className="w-5 h-5 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span>
                                                                    <span className="mt-0.5">{itemKey}</span>
                                                                </span>
                                                                <div className="text-right">
                                                                    <div className="font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded whitespace-nowrap">{stats.count.toLocaleString()}회 출고</div>
                                                                    <div className="text-[10px] font-bold text-amber-500/80 mt-1">누적 {stats.qty.toLocaleString()}개</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex justify-between items-center text-[11px] text-slate-500 bg-white px-2 py-1.5 rounded border border-slate-100">
                                                                <span>누적 매출: {stats.amount.toLocaleString()}원</span>
                                                                <span className={`font-black ${mPct < 15 ? 'text-rose-500' : 'text-slate-600'}`}>이익률 {mPct.toFixed(1)}%</span>
                                                            </div>
                                                        </li>
                                                    );
                                                })}
                                                {cluster.topVolumeItems.length === 0 && <li className="text-center text-xs text-slate-400 py-4 font-bold">집계할 데이터가 없습니다.</li>}
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── 업체별 인텔리전스 카드 탭 ──────────────────────────── */}
            {activeTab === 'COMPANY_CARD' && (
              <div className="space-y-6">

                {/* 헤더 */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-black text-violet-700 flex items-center gap-2">
                      <Contact className="w-7 h-7 text-violet-500" />
                      업체별 인텔리전스 카드 (CRM Deep Analytics)
                    </h1>
                    <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                      업체별 월별 매출 흐름 · 주력 품목 · 견적 전환율 · 이탈 예측까지 타겟 마케팅에 필요한 모든 지표를 한 카드에.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 기간 필터 */}
                    <select
                      title="기간 필터"
                      value={companyCardPeriod}
                      onChange={e => setCompanyCardPeriod(e.target.value)}
                      className="bg-white border text-slate-700 border-slate-300 rounded font-bold text-sm px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      <option value="ALL">전체 기간</option>
                      <option value="LAST_30_DAYS">최근 1개월 (30일)</option>
                      <option value="LAST_90_DAYS">최근 3개월 (90일)</option>
                      <option value="LAST_180_DAYS">최근 6개월 (180일)</option>
                      <option value="LAST_365_DAYS">최근 1년 (365일)</option>
                      <option value="THIS_YEAR">올해 전체</option>
                      <option value="H1">상반기</option>
                      <option value="H2">하반기</option>
                      <option value="Q1">1분기</option>
                      <option value="Q2">2분기</option>
                      <option value="Q3">3분기</option>
                      <option value="Q4">4분기</option>
                      <option value="M1">1월</option>
                      <option value="M2">2월</option>
                      <option value="M3">3월</option>
                      <option value="M4">4월</option>
                      <option value="M5">5월</option>
                      <option value="M6">6월</option>
                      <option value="M7">7월</option>
                      <option value="M8">8월</option>
                      <option value="M9">9월</option>
                      <option value="M10">10월</option>
                      <option value="M11">11월</option>
                      <option value="M12">12월</option>
                    </select>
                    {/* 지역 필터 */}
                    <select
                      title="지역 필터"
                      value={companyCardRegion}
                      onChange={e => setCompanyCardRegion(e.target.value)}
                      className="bg-white border text-slate-700 border-slate-300 rounded font-bold text-sm px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      <option value="ALL">지역: 전국</option>
                      {regions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {/* 정렬 */}
                    <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-inner">
                      {(['amount', 'qty', 'orders', 'conversion'] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => setCompanyCardSortBy(s)}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                            companyCardSortBy === s ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {s === 'amount' ? '매출순' : s === 'qty' ? '수량순' : s === 'orders' ? '거래건수' : '전환율'}
                        </button>
                      ))}
                    </div>
                    {/* 검색 */}
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="업체명 검색..."
                        value={companyCardSearch}
                        onChange={e => setCompanyCardSearch(e.target.value)}
                        className="bg-white border pl-9 text-slate-700 border-slate-300 rounded font-medium text-sm px-4 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 w-52 shadow-inner"
                      />
                    </div>
                  </div>
                </div>

                {/* 요약 메트릭 4개 */}
                {(() => {
                  const visibleCards = companyIntelCards.filter(c =>
                    (companyCardRegion === 'ALL' || c.region === companyCardRegion) &&
                    (!companyCardSearch || c.companyName.toLowerCase().includes(companyCardSearch.toLowerCase()))
                  );
                  const totalRevenue = visibleCards.reduce((s, c) => s + c.totalAmount, 0);
                  const churnRisk = visibleCards.filter(c => c.status === 'CHURN_RISK').length;
                  const avgConversion = visibleCards.length > 0
                    ? (visibleCards.reduce((s, c) => s + c.conversionRate, 0) / visibleCards.length).toFixed(1)
                    : '0';
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: '분석 대상 업체', value: `${visibleCards.length}개`, sub: '발주 이력 있는 업체', color: 'border-violet-400' },
                        { label: '총 매출', value: `${totalRevenue.toLocaleString()}원`, sub: '내부 재고 제외', color: 'border-indigo-400' },
                        { label: '이탈 위험 업체', value: `${churnRisk}개`, sub: `${CHURN_RISK_DAYS}일+ 무발주`, color: 'border-rose-400' },
                        { label: '평균 전환율', value: `${avgConversion}%`, sub: '견적→발주 전환', color: 'border-emerald-400' },
                      ].map(m => (
                        <div key={m.label} className={`bg-white rounded-xl border-l-4 ${m.color} border border-slate-200 p-4 shadow-sm`}>
                          <div className="text-xs text-slate-400 font-bold mb-1">{m.label}</div>
                          <div className="text-xl font-black text-slate-800">{m.value}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{m.sub}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* 업체 카드 그리드 */}
                <div className="space-y-3">
                  {(() => {
                    const cards = companyIntelCards
                      .filter(c =>
                        (companyCardRegion === 'ALL' || c.region === companyCardRegion) &&
                        (!companyCardSearch || c.companyName.toLowerCase().includes(companyCardSearch.toLowerCase()))
                      )
                      .sort((a, b) => {
                        if (companyCardSortBy === 'amount')     return b.totalAmount - a.totalAmount;
                        if (companyCardSortBy === 'qty')        return b.totalQty - a.totalQty;
                        if (companyCardSortBy === 'orders')     return b.totalOrders - a.totalOrders;
                        if (companyCardSortBy === 'conversion') return b.conversionRate - a.conversionRate;
                        return 0;
                      });

                    if (cards.length === 0) {
                      return (
                        <div className="py-20 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                          분석할 업체 데이터가 없습니다.
                        </div>
                      );
                    }

                    return cards.map((card, idx) => {
                      const isExpanded = !!companyCardExpanded[card.companyName];
                      const isAlert = card.status === 'CHURN_RISK' || card.status === 'DORMANT';
                      const isGood = card.status === 'GROWTH' || card.status === 'NEW';

                      // 월별 히트맵 최대값 (색상 강도 기준)
                      const maxMonthlyAmount = Math.max(...card.monthlyData.map(m => m.amount), 1);

                      return (
                        <div
                          key={card.companyName}
                          className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${
                            isAlert ? 'border-rose-300 ring-2 ring-rose-100' :
                            isGood  ? 'border-emerald-200 ring-1 ring-emerald-50' :
                            'border-slate-200'
                          }`}
                        >
                          {/* ── 카드 헤더 (항상 표시) ── */}
                          <button
                            onClick={() => setCompanyCardExpanded(prev => ({ ...prev, [card.companyName]: !isExpanded }))}
                            className="w-full text-left"
                          >
                            <div className={`px-5 py-4 flex items-center justify-between gap-4 ${
                              isAlert ? 'bg-rose-50/30' : isGood ? 'bg-emerald-50/30' : 'bg-slate-50/30'
                            }`}>
                              <div className="flex items-center gap-3 min-w-0">
                                {/* 순위 */}
                                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                                  idx < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                                }`}>{idx + 1}</span>

                                {/* 이름 + 지역 */}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-black text-slate-800 text-base">{card.companyName}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      card.region === '경기도' ? 'bg-emerald-100 text-emerald-700' :
                                      card.region === '경상도' ? 'bg-indigo-100 text-indigo-700' :
                                      card.region === '충청도' ? 'bg-amber-100 text-amber-700' :
                                      card.region === '전라도' ? 'bg-rose-100 text-rose-700' :
                                      'bg-slate-100 text-slate-600'
                                    }`}>{card.region}</span>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                      card.status === 'CHURN_RISK' ? 'bg-rose-200 text-rose-700' :
                                      card.status === 'DORMANT'    ? 'bg-amber-200 text-amber-700' :
                                      card.status === 'GROWTH'     ? 'bg-emerald-200 text-emerald-700' :
                                      card.status === 'NEW'        ? 'bg-blue-200 text-blue-700' :
                                      'bg-slate-100 text-slate-500'
                                    }`}>
                                      {card.status === 'CHURN_RISK' ? '🚨 이탈위험' :
                                       card.status === 'DORMANT'    ? '💤 휴면' :
                                       card.status === 'GROWTH'     ? '📈 성장' :
                                       card.status === 'NEW'        ? '🆕 신규' : '⚖️ 안정'}
                                    </span>
                                  </div>
                                  <div className="text-xs text-slate-400 mt-0.5">
                                    {card.contactName} {card.phone && `· ${card.phone}`}
                                  </div>
                                </div>
                              </div>

                              {/* 핵심 숫자 4개 */}
                              <div className="flex items-center gap-6 shrink-0">
                                <div className="text-right hidden sm:block">
                                  <div className="text-[10px] text-slate-400 font-bold">누적 매출</div>
                                  <div className="font-black text-slate-800 text-base">
                                    {card.totalAmount.toLocaleString()}원
                                  </div>
                                </div>
                                <div className="text-right hidden md:block">
                                  <div className="text-[10px] text-slate-400 font-bold">거래 건수</div>
                                  <div className="font-black text-indigo-600 text-base">{card.totalOrders}건</div>
                                </div>
                                <div className="text-right hidden md:block">
                                  <div className="text-[10px] text-slate-400 font-bold">전환율</div>
                                  <div className={`font-black text-base ${
                                    card.conversionRate >= 70 ? 'text-emerald-600' :
                                    card.conversionRate >= 40 ? 'text-amber-500' : 'text-rose-500'
                                  }`}>{card.conversionRate}%</div>
                                </div>
                                <div className="text-right hidden lg:block">
                                  <div className="text-[10px] text-slate-400 font-bold">마지막 발주</div>
                                  <div className={`font-black text-sm ${
                                    card.daysSinceLastOrder > CHURN_RISK_DAYS ? 'text-rose-500' : 'text-slate-700'
                                  }`}>{card.daysSinceLastOrder}일 전</div>
                                </div>
                                <div className={`p-2 rounded-lg bg-white/60 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                  <ChevronDown className="w-5 h-5" />
                                </div>
                              </div>
                            </div>
                          </button>

                          {/* ── 카드 상세 (펼쳤을 때) ── */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 bg-white">
                              <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">

                                {/* 왼쪽: 기본 정보 + 핵심 KPI */}
                                <div className="space-y-4">
                                  {/* 연락처 정보 */}
                                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-3">거래처 기본 정보</div>
                                    <div className="space-y-1.5 text-[13px]">
                                      {card.address && (
                                        <div className="flex items-start gap-2 text-slate-600">
                                          <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                                          <span className="leading-tight">{card.address}</span>
                                        </div>
                                      )}
                                      {card.email && (
                                        <div className="flex items-center gap-2 text-slate-500">
                                          <span className="w-3.5 h-3.5 text-slate-400">@</span>
                                          <span>{card.email}</span>
                                        </div>
                                      )}
                                      <div className="flex items-center gap-2 text-slate-500">
                                        <Activity className="w-3.5 h-3.5 text-slate-400" />
                                        <span>첫 거래: {card.firstOrderDate || '없음'}</span>
                                      </div>
                                      <div className="flex items-center gap-2 text-slate-500">
                                        <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                                        <span>평균 주기: {card.avgOrderIntervalDays > 0 ? `${card.avgOrderIntervalDays}일` : '측정불가'}</span>
                                      </div>
                                      {card.avgOrderIntervalDays > 0 && (
                                        <div className={`flex items-center gap-2 font-bold ${
                                          card.predictedNextOrder < new Date().toISOString().split('T')[0]
                                            ? 'text-rose-500' : 'text-indigo-600'
                                        }`}>
                                          <span className="w-3.5 text-center">→</span>
                                          <span>예상 다음 발주: {card.predictedNextOrder}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* KPI 격자 */}
                                  <div className="grid grid-cols-2 gap-2">
                                    {[
                                      { label: '총 발주 수량', value: `${card.totalQty.toLocaleString()}개`, color: 'text-indigo-600' },
                                      { label: '평균 발주액', value: `${Math.round(card.avgOrderAmount / 10000).toLocaleString()}만원`, color: 'text-slate-700' },
                                      { label: '마진율', value: `${card.marginRate}%`, color: card.marginRate >= 20 ? 'text-emerald-600' : card.marginRate >= 10 ? 'text-amber-500' : 'text-rose-500' },
                                      { label: '연간 LTV', value: `${Math.round(card.ltv / 10000).toLocaleString()}만원`, color: 'text-violet-600' },
                                      { label: '견적 요청', value: `${card.quoteCount}건`, color: 'text-slate-600' },
                                      { label: '견적 답변', value: `${card.quoteAnswered}건`, color: 'text-blue-600' },
                                      { label: '발주 전환', value: `${card.orderFromQuote}건`, color: 'text-emerald-600' },
                                      { label: '총 발주(주문)', value: `${card.totalOrders}건`, color: 'text-indigo-600' },
                                    ].map(kpi => (
                                      <div key={kpi.label} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                        <div className="text-[10px] text-slate-400 font-bold mb-0.5">{kpi.label}</div>
                                        <div className={`text-sm font-black ${kpi.color}`}>{kpi.value}</div>
                                      </div>
                                    ))}
                                  </div>

                                  {/* 전환율 게이지 */}
                                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-[11px] font-black text-slate-500">견적→발주 전환율</span>
                                      <span className={`text-base font-black ${
                                        card.conversionRate >= 70 ? 'text-emerald-600' :
                                        card.conversionRate >= 40 ? 'text-amber-500' : 'text-rose-500'
                                      }`}>{card.conversionRate}%</span>
                                    </div>
                                    <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all w-pct-${Math.round(Math.min(card.conversionRate, 100) / 5) * 5} ${
                                          card.conversionRate >= 70 ? 'bg-emerald-500' :
                                          card.conversionRate >= 40 ? 'bg-amber-400' : 'bg-rose-400'
                                        }`}
                                      />
                                    </div>
                                    <div className="flex justify-between text-[9px] text-slate-400 mt-1">
                                      <span>낮음</span><span>40%</span><span>70%</span><span>높음</span>
                                    </div>
                                  </div>

                                  {/* 마케팅 액션 */}
                                  <div className={`rounded-xl p-3 border text-[12px] font-bold leading-relaxed ${
                                    isAlert ? 'bg-rose-50 border-rose-200 text-rose-700' :
                                    isGood  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                                    'bg-slate-50 border-slate-200 text-slate-600'
                                  }`}>
                                    {card.marketingAction}
                                    {card.marketingTargetItems.length > 0 && (
                                      <div className="mt-2 pt-2 border-t border-current/20">
                                        <span className="text-[10px] opacity-70">추가 제안 품목: </span>
                                        {card.marketingTargetItems.map(item => (
                                          <span key={item} className="inline-block text-[10px] bg-white/60 px-1.5 py-0.5 rounded mr-1 mt-0.5 font-mono">{item}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 가운데: 월별 매출 히트맵 */}
                                <div className="space-y-4">
                                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 h-full">
                                    <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-4">
                                      월별 매출 흐름 (최근 12개월)
                                    </div>
                                    <div className="space-y-2">
                                      {card.monthlyData.map(m => {
                                        const pct = maxMonthlyAmount > 0 ? (m.amount / maxMonthlyAmount) * 100 : 0;
                                        const isCurrentMonth = m.month === new Date().toISOString().slice(0, 7);
                                        return (
                                          <div key={m.month} className="flex items-center gap-2">
                                            <span className={`text-[11px] font-mono w-14 shrink-0 ${
                                              isCurrentMonth ? 'font-black text-violet-600' : 'text-slate-400'
                                            }`}>{m.month.slice(5)}월</span>
                                            <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden relative">
                                              <div
                                                className={`h-full rounded transition-all w-pct-${Math.round(pct / 5) * 5} ${
                                                  pct >= 80 ? 'bg-violet-500' :
                                                  pct >= 50 ? 'bg-indigo-400' :
                                                  pct >= 20 ? 'bg-indigo-200' :
                                                  pct > 0   ? 'bg-slate-200' : 'bg-transparent'
                                                }`}
                                              />
                                              {m.amount > 0 && (
                                                <span className="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-slate-600">
                                                  {m.orderCount}건
                                                </span>
                                              )}
                                            </div>
                                            <span className="text-[11px] font-mono text-right w-16 shrink-0 text-slate-600">
                                              {m.amount > 0 ? `${m.amount.toLocaleString()}원` : '—'}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {/* 합계 */}
                                    <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between text-[12px]">
                                      <span className="text-slate-500 font-bold">12개월 합계</span>
                                      <span className="font-black text-violet-700">
                                        {card.ltv.toLocaleString()}원
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* 오른쪽: 주력 품목 TOP 10 */}
                                <div className="space-y-4">
                                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                                        주력 품목 TOP {Math.min(card.topItems.length, 10)}
                                      </div>
                                      <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 gap-0.5">
                                        {(['amount', 'qty', 'freq'] as const).map(s => (
                                          <button
                                            key={s}
                                            onClick={e => { e.stopPropagation(); setCardItemSortBy(s); }}
                                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${
                                              cardItemSortBy === s ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                          >
                                            {s === 'amount' ? '매출' : s === 'qty' ? '수량' : '빈도'}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      {[...card.topItems]
                                        .sort((a, b) =>
                                          cardItemSortBy === 'amount' ? b.amount - a.amount :
                                          cardItemSortBy === 'qty'    ? b.qty - a.qty :
                                          b.orderCount - a.orderCount
                                        )
                                        .slice(0, 10)
                                        .map((item, i) => {
                                          const itemMargin = item.amount - item.cost;
                                          const mPct = item.amount > 0 ? (itemMargin / item.amount * 100).toFixed(0) : '0';
                                          return (
                                            <div key={item.itemKey} className="bg-white rounded-lg p-2.5 border border-slate-100 hover:border-violet-200 transition-colors">
                                              <div className="flex items-start gap-2">
                                                <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5 ${
                                                  i < 3 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'
                                                }`}>{i + 1}</span>
                                                <div className="flex-1 min-w-0">
                                                  <div className="text-[11px] font-bold text-slate-700 leading-tight truncate" title={item.itemKey}>
                                                    {item.itemKey}
                                                  </div>
                                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 rounded">
                                                      {item.qty.toLocaleString()}개
                                                    </span>
                                                    <span className="text-[10px] text-slate-500">
                                                      {item.amount.toLocaleString()}원
                                                    </span>
                                                    <span className="text-[10px] text-amber-600">
                                                      {item.orderCount}회 발주
                                                    </span>
                                                    <span className={`text-[10px] font-bold ${
                                                      Number(mPct) >= 20 ? 'text-emerald-600' :
                                                      Number(mPct) >= 10 ? 'text-amber-500' : 'text-rose-400'
                                                    }`}>마진 {mPct}%</span>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </div>
                                </div>

                              </div>
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* MODAL (ADD / EDIT) */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                {editingCustomer?.id ? <Edit2 className="w-5 h-5 text-indigo-600"/> : <Plus className="w-5 h-5 text-indigo-600"/>}
                                {editingCustomer?.id ? '거래처 정보 수정' : '신규 CRM 거래처 등록'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-800 text-2xl font-light">&times;</button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            <form id="customerForm" onSubmit={handleSaveForm} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">업체명 (상호) *</label>
                                        <input title="업체명 (상호)" placeholder="예: (주)알트에프" required value={editingCustomer?.companyName || ''} onChange={e => setEditingCustomer(p => ({...p, companyName: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">대표자명</label>
                                        <input title="대표자명" placeholder="예: 홍길동" value={editingCustomer?.ceo || ''} onChange={e => setEditingCustomer(p => ({...p, ceo: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">사업자등록번호 * (중복금지)</label>
                                        <input title="사업자등록번호" required placeholder="000-00-00000" value={editingCustomer?.businessNumber || ''} onChange={e => setEditingCustomer(p => ({...p, businessNumber: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">권역 (8도 분류) *</label>
                                        <select title="권역 분류" required value={editingCustomer?.region || '경기도'} onChange={e => setEditingCustomer(p => ({...p, region: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                                            <option value="경기도">경기도 (시화배송망)</option>
                                            <option value="경상도">경상도 (부산배송망)</option>
                                            <option value="충청도">충청도</option>
                                            <option value="전라도">전라도</option>
                                            <option value="강원도">강원도</option>
                                            <option value="제주도">제주도</option>
                                            <option value="기타">기타 / 직접입력안됨</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">배송 주소지 *</label>
                                        <input title="배송 주소지" placeholder="예: 경기도 시흥시 공단1대로..." required value={editingCustomer?.address || ''} onChange={e => setEditingCustomer(p => ({...p, address: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">담당자명 *</label>
                                        <input title="담당자명" placeholder="예: 김철수 과장" required value={editingCustomer?.contactName || ''} onChange={e => setEditingCustomer(p => ({...p, contactName: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">연락처 (전화번호) *</label>
                                        <input title="연락처" placeholder="예: 010-0000-0000" required value={editingCustomer?.phone || ''} onChange={e => setEditingCustomer(p => ({...p, phone: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">업무 이메일 *</label>
                                        <input title="업무 이메일" placeholder="예: info@company.com" required type="email" value={editingCustomer?.email || ''} onChange={e => setEditingCustomer(p => ({...p, email: e.target.value}))} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 rounded-b-2xl">
                            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">취소</button>
                            <button type="submit" form="customerForm" className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm shadow-md transition-colors">저장하기</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ANALYTICS DETAILS MODAL */}
            {analyticsModalRegion && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-60 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-2xl">
                            <div>
                                <h2 className="text-xl font-black flex items-center gap-2 text-slate-800">
                                    <BarChart2 className="w-6 h-6 text-indigo-600"/>
                                    {analyticsModalRegion.region} 상세 분석 (Top 30)
                                </h2>
                                <p className="text-xs text-slate-500 mt-1">이 권역에서 유통된 전체 배관 품목 지표입니다.</p>
                            </div>
                            <button onClick={() => setAnalyticsModalRegion(null)} className="text-slate-400 hover:text-slate-800 p-2 rounded-full hover:bg-slate-200 transition-colors">
                                <span className="sr-only">닫기</span>
                                &times;
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 custom-scrollbar">
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm border-l-4 border-l-indigo-500">
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">총 누적 매출</div>
                                    <div className="text-2xl font-black text-slate-800">₩{analyticsModalRegion.totalAmount.toLocaleString()}</div>
                                </div>
                                <div className="bg-white p-4 rounded-xl border border-teal-100 shadow-sm border-l-4 border-l-teal-500">
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">총 유통 수량</div>
                                    <div className="text-2xl font-black text-slate-800">{analyticsModalRegion.totalQty.toLocaleString()}개</div>
                                </div>
                            </div>

                            <table className="w-fulltext-sm text-left">
                                <thead className="text-[11px] text-slate-500 uppercase bg-slate-100/80 sticky top-0 z-10 backdrop-blur-sm">
                                    <tr>
                                        <th className="px-4 py-3 font-bold rounded-tl-lg">순위</th>
                                        <th className="px-4 py-3 font-bold">배관 규격 (Item)</th>
                                        <th className="px-4 py-3 font-bold text-right">평균 단가</th>
                                        <th className="px-4 py-3 font-bold text-right">유통량(개)</th>
                                        <th className="px-4 py-3 font-bold text-right rounded-tr-lg">지역 매출액</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {analyticsModalRegion.allItems.slice(0, 30).map(([itemKey, stats], idx) => (
                                        <tr key={itemKey} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/30 transition-colors group">
                                            <td className="px-4 py-3">
                                                <span className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-black ${idx < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                    {idx + 1}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-bold text-slate-700 flex items-center gap-1.5">
                                                <span>{stats.material && itemKey.endsWith(`-${stats.material}`) ? itemKey.slice(0, -(stats.material.length + 1)) : itemKey}</span>
                                                {stats.material && (
                                                    <span className={`px-1.5 py-0.5 text-[9px] border rounded transition-all font-bold shrink-0 ${getMaterialColor(stats.material)}`}>
                                                        {stats.material}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-500 fontFamily-mono text-xs">
                                                {stats.qty > 0 ? Math.round(stats.amount/stats.qty).toLocaleString() : 0}원
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded text-xs">{stats.qty.toLocaleString()}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-800 text-sm">
                                                ₩{stats.amount.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                    {analyticsModalRegion.allItems.length > 30 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-3 text-center text-xs text-slate-400 font-bold bg-slate-50">
                                                ... 외 {analyticsModalRegion.allItems.length - 30}개 품목이 더 있습니다.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
            {activeTab === 'ACTION_INTEL' && (
  <div className="flex gap-0 h-full animate-in fade-in duration-300">

    {/* ── 왼쪽: 오늘 할 일 사이드바 ── */}
    <aside className="w-72 shrink-0 border-r border-slate-200 bg-slate-50/50 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-rose-500" />
          <span className="text-xs font-black text-rose-600 uppercase tracking-widest">오늘 할 일 우선순위</span>
        </div>
        {/* 긴급도 점수 */}
        <div className="flex items-center gap-3 bg-slate-100 rounded-xl p-3">
          <div className="flex-1">
            <div className="text-[10px] text-slate-400 font-bold">긴급도 점수</div>
            <div className="text-2xl font-black text-amber-500">
              {actionIntel.urgentCount > 0 ? Math.min(50 + actionIntel.urgentCount * 15, 99) : 42}점
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              {actionIntel.urgentCount > 0 ? '즉시 조치 필요' : '양호'}
            </div>
          </div>
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="18" fill="none" stroke="#e2e8f0" strokeWidth="5"/>
            <circle cx="24" cy="24" r="18" fill="none"
              stroke={actionIntel.urgentCount > 0 ? '#f59e0b' : '#22c55e'} strokeWidth="5"
              strokeDasharray="113.1"
              strokeDashoffset={113.1 * (1 - Math.min((actionIntel.urgentCount > 0 ? 50 + actionIntel.urgentCount * 15 : 42) / 100, 0.99))}
              strokeLinecap="round" transform="rotate(-90 24 24)"
            />
          </svg>
        </div>
      </div>

      {/* 액션 리스트 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {actionIntel.sidebarActions.map((action, i) => (
          <button
            key={i}
            onClick={() => setIntelSubView(action.sub as 'urgent' | 'prep' | 'strategy' | 'growth' | 'inventory')}
            className={`w-full text-left p-3 rounded-xl border transition-all hover:shadow-sm hover:translate-x-0.5 ${
              action.tagColor === 'rose'  ? 'border-rose-200 bg-rose-50/50 hover:bg-rose-50' :
              action.tagColor === 'green' ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50' :
              'border-amber-200 bg-amber-50/50 hover:bg-amber-50'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0 mt-0.5">{action.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-800 mb-1 leading-tight">{action.label}</div>
                <div className="text-[10px] text-slate-500 leading-snug">{action.desc}</div>
                <span className={`inline-block mt-1.5 text-[9px] font-black px-2 py-0.5 rounded-full ${
                  action.tagColor === 'rose'  ? 'bg-rose-100 text-rose-600' :
                  action.tagColor === 'green' ? 'bg-emerald-100 text-emerald-600' :
                  'bg-amber-100 text-amber-600'
                }`}>{action.tag}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </aside>

    {/* ── 오른쪽: 서브뷰 ── */}
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* 서브뷰 탭 바 */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-200 bg-white shrink-0">
        {([
          { key: 'urgent',    label: '🚨 지금 당장', color: 'rose'    },
          { key: 'prep',      label: '📦 준비할 것',  color: 'amber'   },
          { key: 'strategy',  label: '🎯 전략 타겟',  color: 'blue'    },
          { key: 'growth',    label: '📈 성장 관리',  color: 'green'   },
          { key: 'inventory', label: '📊 재고 연동',  color: 'violet'  },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => { setIntelSubView(tab.key); setExpandedCards(new Set()); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              intelSubView === tab.key
                ? tab.color === 'rose'   ? 'bg-rose-600 text-white shadow-sm' :
                  tab.color === 'amber'  ? 'bg-amber-500 text-white shadow-sm' :
                  tab.color === 'blue'   ? 'bg-blue-600 text-white shadow-sm' :
                  tab.color === 'green'  ? 'bg-emerald-600 text-white shadow-sm' :
                  'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {tab.label}
            {tab.key === 'urgent' && actionIntel.urgentCount > 0 && (
              <span className="bg-white/30 text-white text-[9px] font-black px-1.5 rounded-full">
                {actionIntel.urgentCount}
              </span>
            )}
          </button>
        ))}

        {/* 지역 필터 */}
        <select
          title="지역 필터"
          value={intelRegion}
          onChange={e => setIntelRegion(e.target.value)}
          className="ml-auto bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-xs px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-sm"
        >
          <option value="ALL">전국</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* ── 서브뷰 콘텐츠 ── */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50/30">

        {/* 서브뷰 헤더 */}
        <div className={`rounded-xl p-4 mb-4 border flex items-center gap-3 ${
          intelSubView === 'urgent'    ? 'bg-rose-50 border-rose-200' :
          intelSubView === 'prep'      ? 'bg-amber-50 border-amber-200' :
          intelSubView === 'strategy'  ? 'bg-blue-50 border-blue-200' :
          intelSubView === 'growth'    ? 'bg-emerald-50 border-emerald-200' :
          'bg-violet-50 border-violet-200'
        }`}>
          <div className="text-3xl">
            {intelSubView === 'urgent' ? '🚨' : intelSubView === 'prep' ? '📦' :
             intelSubView === 'strategy' ? '🎯' : intelSubView === 'growth' ? '📈' : '📊'}
          </div>
          <div>
            <div className={`text-sm font-black ${
              intelSubView === 'urgent'   ? 'text-rose-700' :
              intelSubView === 'prep'     ? 'text-amber-700' :
              intelSubView === 'strategy' ? 'text-blue-700' :
              intelSubView === 'growth'   ? 'text-emerald-700' :
              'text-violet-700'
            }`}>
              {intelSubView === 'urgent'   ? '오늘 안 하면 손실이 확정됩니다' :
               intelSubView === 'prep'     ? '이번 주~달 안에 준비하면 경쟁력이 올라갑니다' :
               intelSubView === 'strategy' ? '집중 투자하면 점유율을 확대할 수 있습니다' :
               intelSubView === 'growth'   ? '잘 되고 있는 곳 — 이탈 방지 + Upsell 타이밍' :
               '회전율 × 수요 × 발주 타이밍을 한 화면에'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              업체 카드를 클릭하면 월별 분석 · 주력 품목 · 실행 액션이 펼쳐집니다
            </div>
          </div>
        </div>

        {/* ── 카드 그리드 ── */}
        {(() => {
          // 서브뷰별 표시 데이터
          const viewCards = (() => {
            let base = intelSubView === 'urgent'   ? actionIntel.urgentCards :
                       intelSubView === 'growth'   ? actionIntel.growthCards :
                       intelSubView === 'prep'     ? [...actionIntel.stableCards, ...actionIntel.newCards] :
                       intelSubView === 'strategy' ? actionIntel.cards.filter(c =>
                         c.status !== 'CHURN_RISK' && c.status !== 'DORMANT') :
                       actionIntel.cards;
            if (intelRegion !== 'ALL') base = base.filter(c => c.region === intelRegion);
            return base.slice(0, 50);
          })();

          if (viewCards.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Activity className="w-12 h-12 mb-3 opacity-30" />
                <div className="font-bold">해당 조건의 업체가 없습니다</div>
              </div>
            );
          }

          return (
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
              {viewCards.map(card => {
                const isExpanded  = expandedCards.has(card.companyName);
                const isUrgent    = card.status === 'CHURN_RISK';
                const isDormant   = card.status === 'DORMANT';
                const isGrowth    = card.status === 'GROWTH';
                const isNew       = card.status === 'NEW';
                const maxMonthAmt = Math.max(...card.monthlyData.map(m => m.amount), 1);
                const topItemsSorted = [...card.topItems].sort((a, b) =>
                  intelCardItemSort === 'qty'  ? b.qty - a.qty :
                  intelCardItemSort === 'freq' ? b.orderCount - a.orderCount :
                  b.amount - a.amount
                );

                return (
                  <div
                    key={card.companyName}
                    className={`bg-white rounded-2xl border overflow-hidden transition-all cursor-pointer
                      ${isUrgent  ? 'border-rose-300 ring-2 ring-rose-100 hover:ring-rose-200' :
                        isDormant ? 'border-amber-300 ring-1 ring-amber-50' :
                        isGrowth  ? 'border-emerald-200 ring-1 ring-emerald-50' :
                        isNew     ? 'border-blue-200 ring-1 ring-blue-50' :
                        'border-slate-200 hover:border-slate-300'}
                      ${isExpanded ? 'shadow-lg ring-2 ring-indigo-200 col-span-full' : 'hover:shadow-md hover:-translate-y-0.5'}
                    `}
                    onClick={() => toggleCard(card.companyName)}
                  >
                    {/* ── 카드 헤더 ── */}
                    <div className={`px-5 py-4 ${
                      isUrgent ? 'bg-rose-50/40' : isGrowth ? 'bg-emerald-50/30' : 'bg-slate-50/30'
                    }`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0 mr-3">
                          <h3 className="font-black text-slate-800 text-base leading-tight">{card.companyName}</h3>
                          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                            {card.contactName && <span>{card.contactName}</span>}
                            {card.phone && <span className="font-mono">{card.phone}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                            isUrgent  ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                            isDormant ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                            isGrowth  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                            isNew     ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                            'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>
                            {isUrgent ? '🚨 이탈위험' : isDormant ? '💤 휴면' :
                             isGrowth ? '📈 성장중' : isNew ? '🆕 신규' : '⚖️ 안정'}
                          </span>
                          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">
                            {card.region}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {/* KPI 4칸 */}
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: '누적 매출', value: `${Math.round(card.totalAmount / 10000).toLocaleString()}만원`, color: 'text-indigo-600' },
                          { label: '거래 건수', value: `${card.totalOrders}건`, color: 'text-teal-600' },
                          { label: '전환율',    value: `${card.convRate}%`,
                            color: card.convRate >= 80 ? 'text-emerald-600' : card.convRate >= 50 ? 'text-amber-500' : 'text-rose-500' },
                          { label: '마진율',    value: `${card.marginRate}%`,
                            color: card.marginRate >= 22 ? 'text-emerald-600' : card.marginRate >= 15 ? 'text-blue-600' : 'text-amber-500' },
                        ].map(kpi => (
                          <div key={kpi.label} className="bg-white rounded-lg p-2 text-center border border-slate-100">
                            <div className="text-[9px] font-bold text-slate-400 mb-1">{kpi.label}</div>
                            <div className={`text-sm font-black ${kpi.color}`}>{kpi.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 미니 히트맵 */}
                    <div className="px-5 py-3 flex items-end gap-1 h-[52px]">
                      {card.monthlyData.map((m, i) => {
                        const pct  = maxMonthAmt > 0 ? (m.amount / maxMonthAmt) * 100 : 0;
                        const isNow = i === 11;
                        const hClass = pct >= 90 ? 'h-8' : pct >= 75 ? 'h-7' : pct >= 60 ? 'h-6' : pct >= 45 ? 'h-5' : pct >= 30 ? 'h-4' : pct >= 15 ? 'h-3' : pct > 0 ? 'h-2' : 'h-1';
                        const bgClass = isNow
                          ? (pct > 30 ? 'bg-indigo-600' : 'bg-indigo-400')
                          : (isUrgent && pct > 30 ? 'bg-rose-300' : pct > 60 ? 'bg-indigo-300' : pct > 20 ? 'bg-indigo-200' : 'bg-slate-100');
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                            <div
                              title={`${m.month} ${Math.round(m.amount / 10000).toLocaleString()}만원 ${m.orderCount}건`}
                              className={`w-full rounded-t ${hClass} ${bgClass}`}
                            />
                            <span className="text-[7px] text-slate-300">{m.month.slice(0, 2)}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* 마케팅 액션 줄 */}
                    <div className={`px-5 py-3 border-t flex items-center justify-between gap-3 ${
                      isUrgent ? 'bg-rose-50/50 border-rose-100' :
                      isGrowth ? 'bg-emerald-50/50 border-emerald-100' :
                      'bg-slate-50/50 border-slate-100'
                    }`}>
                      <div className={`text-xs font-bold flex-1 leading-tight ${
                        isUrgent ? 'text-rose-700' : isGrowth ? 'text-emerald-700' : 'text-slate-600'
                      }`}>
                        {card.marketingAction}
                      </div>
                      <button
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all shrink-0
                          ${isUrgent
                            ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-600 hover:text-white'
                            : isGrowth
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-600 hover:text-white'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-indigo-600 hover:text-white hover:border-indigo-600'
                          }`}
                        onClick={e => e.stopPropagation()}
                      >
                        {isUrgent ? '즉시 컨택 →' : isGrowth ? 'Upsell 제안 →' : '상세 분석 →'}
                      </button>
                    </div>

                    {/* ── 확장 상세 패널 ── */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">

                          {/* 왼쪽: 기본 정보 + KPI */}
                          <div className="space-y-4">
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">거래처 정보</div>
                              <div className="space-y-1.5 text-xs text-slate-600">
                                {card.address && <div className="flex items-start gap-1.5"><MapPin className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />{card.address}</div>}
                                {card.email   && <div className="text-slate-400">@ {card.email}</div>}
                                <div className="pt-2 border-t border-slate-200 space-y-1">
                                  <div className="flex justify-between"><span className="text-slate-400">첫 거래</span><span className="font-bold">{card.firstOrderDate || '없음'}</span></div>
                                  <div className="flex justify-between"><span className="text-slate-400">마지막 발주</span><span className={`font-bold ${card.daysSince > 45 ? 'text-rose-500' : 'text-slate-700'}`}>{card.daysSince}일 전</span></div>
                                  <div className="flex justify-between"><span className="text-slate-400">평균 주기</span><span className="font-bold">{card.avgInterval > 0 ? `${card.avgInterval}일` : '측정불가'}</span></div>
                                  {card.predictedNext && <div className="flex justify-between"><span className="text-slate-400">예상 다음 발주</span><span className={`font-bold ${card.predictedNext < new Date().toISOString().split('T')[0] ? 'text-rose-500' : 'text-indigo-600'}`}>{card.predictedNext}</span></div>}
                                </div>
                              </div>
                            </div>

                            {/* KPI 격자 */}
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { l: '총 발주금액',    v: `${Math.round(card.ltv12 / 10000).toLocaleString()}만원`,  c:'text-violet-600' },
                                { l: '건당 평균', v: `${Math.round(card.avgOrderAmt / 10000).toLocaleString()}만원`, c:'text-slate-700' },
                                { l: '전환율',    v: `${card.convRate}%`,
                                  c: card.convRate>=80?'text-emerald-600':card.convRate>=50?'text-amber-500':'text-rose-500'},
                                { l: '마진율',    v: `${card.marginRate}%`,
                                  c: card.marginRate>=22?'text-emerald-600':card.marginRate>=15?'text-blue-600':'text-amber-500'},
                              ].map(kpi => (
                                <div key={kpi.l} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100 text-center">
                                  <div className="text-[9px] text-slate-400 font-bold mb-0.5">{kpi.l}</div>
                                  <div className={`text-sm font-black ${kpi.c}`}>{kpi.v}</div>
                                </div>
                              ))}
                            </div>

                            {/* 전환율 바 */}
                            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black text-slate-500">견적→발주 전환율</span>
                                <span className={`text-sm font-black ${card.convRate>=80?'text-emerald-600':card.convRate>=50?'text-amber-500':'text-rose-500'}`}>
                                  {card.convRate}%
                                </span>
                              </div>
                              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${['w-0', 'w-1/12', 'w-1/6', 'w-1/4', 'w-1/3', 'w-5/12', 'w-1/2', 'w-7/12', 'w-2/3', 'w-3/4', 'w-5/6', 'w-11/12', 'w-full'][Math.round((Math.max(0, Math.min(card.convRate, 100)) / 100) * 12)]} ${card.convRate>=80?'bg-emerald-500':card.convRate>=50?'bg-amber-400':'bg-rose-400'}`} />
                              </div>
                            </div>

                            {/* 제안 품목 */}
                            {card.suggestItems.length > 0 && (
                              <div className="bg-indigo-50 rounded-xl p-3 border border-indigo-100">
                                <div className="text-[10px] font-black text-indigo-600 mb-2">추가 제안 가능 품목</div>
                                {card.suggestItems.map(item => (
                                  <div key={item} className="text-[10px] font-mono bg-white px-2 py-1 rounded border border-indigo-100 mb-1 text-indigo-700 font-bold truncate">{item}</div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 가운데: 월별 바차트 */}
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-4">월별 매출 흐름 (최근 12개월)</div>
                            <div className="space-y-2">
                              {card.monthlyData.map((m, i) => {
                                const pct = maxMonthAmt > 0 ? (m.amount / maxMonthAmt) * 100 : 0;
                                const isNow = i === 11;
                                const wIndex = Math.max(0, Math.min(12, Math.round((pct / 100) * 12)));
                                const wClass = ['w-0', 'w-1/12', 'w-1/6', 'w-1/4', 'w-1/3', 'w-5/12', 'w-1/2', 'w-7/12', 'w-2/3', 'w-3/4', 'w-5/6', 'w-11/12', 'w-full'][wIndex];
                                return (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className={`text-[10px] font-mono w-8 shrink-0 text-right ${isNow ? 'font-black text-indigo-600' : 'text-slate-400'}`}>
                                      {m.month}
                                    </span>
                                    <div className="flex-1 h-5 bg-slate-200 rounded overflow-hidden relative">
                                      <div
                                        className={`h-full rounded transition-all ${wClass} ${
                                          pct >= 80 ? (isUrgent ? 'bg-rose-400' : 'bg-indigo-500') :
                                          pct >= 50 ? (isUrgent ? 'bg-rose-300' : 'bg-indigo-400') :
                                          pct >= 20 ? 'bg-indigo-200' :
                                          pct > 0 ? 'bg-slate-300' : 'bg-transparent'
                                        }`}
                                      />
                                      {m.orderCount > 0 && (
                                        <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-slate-600">
                                          {m.orderCount}건
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-600 w-14 text-right shrink-0">
                                      {m.amount > 0 ? `${Math.round(m.amount / 10000).toLocaleString()}만원` : '—'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between text-xs">
                              <span className="text-slate-400 font-bold">12개월 합계</span>
                              <span className="font-black text-indigo-600">{Math.round(card.ltv12 / 10000).toLocaleString()}만원</span>
                            </div>
                          </div>

                          {/* 오른쪽: 주력 품목 TOP */}
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                            <div className="flex items-center justify-between mb-3">
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">주력 품목 TOP {Math.min(topItemsSorted.length, 10)}</div>
                              <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
                                {(['amount', 'qty', 'freq'] as const).map(s => (
                                  <button key={s}
                                    onClick={e => { e.stopPropagation(); setIntelCardItemSort(s); }}
                                    className={`px-2 py-1 text-[9px] font-bold transition-all ${intelCardItemSort === s ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-slate-600'}`}
                                  >
                                    {s === 'amount' ? '매출' : s === 'qty' ? '수량' : '빈도'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {topItemsSorted.slice(0, 10).map((item, i) => (
                                <div key={item.itemKey} className="bg-white rounded-lg p-2.5 border border-slate-100 hover:border-indigo-200 transition-colors">
                                  <div className="flex items-start gap-2">
                                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black shrink-0 mt-0.5 ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{i+1}</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[10px] font-bold text-slate-700 truncate leading-tight" title={item.itemKey}>{item.itemKey}</div>
                                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                        <span className="text-[9px] text-indigo-600 font-bold bg-indigo-50 px-1.5 rounded">{item.qty.toLocaleString()}개</span>
                                        <span className="text-[9px] text-slate-500">{Math.round(item.amount / 10000).toLocaleString()}만원</span>
                                        <span className="text-[9px] text-amber-600">{item.orderCount}회</span>
                                        <span className={`text-[9px] font-bold ${item.marginPct>=20?'text-emerald-600':item.marginPct>=10?'text-amber-500':'text-rose-500'}`}>
                                          마진{item.marginPct.toFixed(0)}%
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  </div>
)}
        </div>
    );
}