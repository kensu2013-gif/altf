import { useState, useMemo, useEffect } from 'react';
import { Users, MapPin, Building2, TrendingUp, Search, Contact, Activity, AlertTriangle, Trash2, Edit2, Plus, BarChart2, AlertCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useInventory } from '../../hooks/useInventory';
import type { Product } from '../../types';

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

const stripCorp = (name: string) => {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '')
               .replace(/[^a-zA-Z0-9가-힣]/g, '')
               .trim();
};

export default function Customers() {
    const user = useStore(state => state.auth.user);
    const token = useStore(state => state.auth.token);
    const orders = useStore(state => state.orders);
    const setOrders = useStore(state => state.setOrders);
    const [customersList, setCustomersList] = useState<Customer[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
    const [activeTab, setActiveTab] = useState<'MASTER' | 'ANALYTICS' | 'BI_ANALYTICS'>('MASTER');
    
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
        allItems: [string, {qty: number; amount: number}][];
    } | null>(null);

    const fetchCustomers = async () => {
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                headers: { 'x-requester-role': user?.role || 'GUEST' }
            });
            if (res.ok) {
                const data = await res.json();
                setCustomersList(data.filter((c: Customer) => !c.isDeleted));
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const loadInit = async () => {
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                    headers: { 'x-requester-role': user?.role || 'GUEST' }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) {
                        setCustomersList(data.filter((c: Customer) => !c.isDeleted));
                    }
                }
                
                // Fetch Orders to ensure BI Engine survives Hard Refresh (F5)
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json'
                };
                if (token) headers['Authorization'] = `Bearer ${token}`;
                if (user?.id) headers['x-requester-id'] = user.id;
                if (user?.role) headers['x-requester-role'] = user.role;

                const ordersRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/my/orders?limit=2000`, { headers });
                if (ordersRes.ok) {
                    const ordersData = await ordersRes.json();
                    if (isMounted && Array.isArray(ordersData)) {
                        setOrders(ordersData);
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
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/action/purge`, {
                method: 'POST',
                headers: { 'x-requester-role': user?.role || 'GUEST' }
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
            const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-requester-role': user?.role || 'GUEST'
                },
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
            if (editingCustomer.id) {
                // UPDATE
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers/${editingCustomer.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-requester-role': user?.role || 'GUEST'
                    },
                    body: JSON.stringify(editingCustomer)
                });
                if (res.ok) {
                    const saved = await res.json();
                    setCustomersList(prev => prev.map(c => c.id === saved.id ? saved : c));
                    setIsModalOpen(false);
                }
            } else {
                // CREATE
                const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-requester-role': user?.role || 'GUEST'
                    },
                    body: JSON.stringify(editingCustomer)
                });
                if (res.ok) {
                    const saved = await res.json();
                    setCustomersList(prev => [saved, ...prev]);
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
        const regionMap: Record<string, { totalAmount: number; totalQty: number; items: Record<string, {qty: number; amount: number}>; missingCustomers: Set<string> }> = {};
        
        orders.forEach(o => {
            if (o.status === 'CANCELLED' || o.status === 'WITHDRAWN') return;
            if ((o.customerName || '').includes('서울재고')) return;
            
            const cleanOrderName = stripCorp(o.customerName);
            const customer = customersList.find(c => {
                const cleanCrm = stripCorp(c.companyName);
                if (!cleanOrderName || !cleanCrm) return false;
                return cleanCrm === cleanOrderName || (cleanOrderName.length > 1 && cleanCrm.includes(cleanOrderName));
            });
            const region = customer?.region || 'CRM 미등록/예외';
            
            if (!regionMap[region]) {
                regionMap[region] = { totalAmount: 0, totalQty: 0, items: {}, missingCustomers: new Set() };
            }
            if (!customer) {
                regionMap[region].missingCustomers.add(o.customerName);
            }

            regionMap[region].totalAmount += o.totalAmount;
            
            o.items?.forEach(item => {
                const itemKey = `${item.name}-${item.thickness}-${item.size}`;
                const quantity = item.quantity || 0;
                const unitPrice = item.unitPrice || 0;

                regionMap[region].totalQty += quantity;
                
                if (!regionMap[region].items[itemKey]) {
                    regionMap[region].items[itemKey] = {qty: 0, amount: 0};
                }
                regionMap[region].items[itemKey].qty += quantity;
                regionMap[region].items[itemKey].amount += (quantity * unitPrice);
            });
        });

        // Convert to sorted array
        const results = Object.keys(regionMap).map(k => {
            const allItems = Object.entries(regionMap[k].items)
                .sort((a,b) => b[1].qty - a[1].qty);
                
            return {
                region: k,
                ...regionMap[k],
                topItems: allItems.slice(0, 10), // For dashboard compact view
                allItems, // Store all for modal
                missingArray: Array.from(regionMap[k].missingCustomers)
            };
        }).sort((a,b) => b.totalQty - a.totalQty);

        return results;
    }, [orders, customersList]);

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

                const basePrice = item.base_price || product?.base_price || product?.unitPrice || unitPrice || 0;
                
                let costPrice = unitPrice; // Fallback to 0 margin
                
                if (itemExt.supplierPriceOverride && itemExt.supplierPriceOverride > 0) {
                    costPrice = itemExt.supplierPriceOverride;
                } else if (item.supplierRate !== undefined && item.supplierRate > 0) {
                    costPrice = Math.round((basePrice * (100 - item.supplierRate) / 100) / 10) * 10;
                } else if (product) {
                    // Try to infer from inventory record (ONLY trust actual active rates, NOT generic rate_pct)
                    const rate = product.rate_act2 || product.rate_act || 0;
                    if (rate > 0) {
                        costPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                    }
                }

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
            
            const topMarginItems = [...allItems]
                .sort((a,b) => (b[1].amount - b[1].cost) - (a[1].amount - a[1].cost))
                .slice(0, 5);
                
            const topVolumeItems = [...allItems]
                .sort((a,b) => b[1].count - a[1].count)
                .slice(0, 5);

            return {
                clusterName: k,
                ...clusterMap[k],
                topMarginItems,
                topVolumeItems,
            };
        }).sort((a,b) => b.totalAmount - a.totalAmount);

        return results;
    }, [orders, customersList, inventoryMap]);

    const totalBiRevenue = useMemo(() => {
        return biAnalytics.reduce((acc, c) => acc + c.totalAmount, 0);
    }, [biAnalytics]);

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
                    지역/품목별 실판매 분석 (Analytics)
                </button>
                <button 
                    onClick={() => setActiveTab('BI_ANALYTICS')}
                    className={`px-5 py-2.5 rounded-t-lg font-bold transition-all flex items-center gap-1.5 ${activeTab === 'BI_ANALYTICS' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'}`}
                >
                    <TrendingUp className="w-4 h-4"/>
                    심화 BI 마진/허브 분석 (Strategy)
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
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                            <BarChart2 className="w-7 h-7 text-indigo-600" />
                            판매 배관 지역 점유율 (CRM Cross Analytics)
                        </h1>
                        <p className="text-slate-500 text-[15px] mt-1 tracking-tight">
                            접수된 주문건의 상호명을 CRM 고객 명부와 크로스체크하여 "어느 지역으로 어떤 자재가 집중되고 있는지"를 분석합니다.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {analytics.map((reg) => (
                            <div key={reg.region} className={`rounded-xl border flex flex-col h-full ${reg.region === 'CRM 미등록/예외' ? 'bg-amber-50/50 border-amber-200 shadow-sm' : 'bg-white border-slate-200 shadow-sm'} overflow-hidden`}>
                                <div className={`px-4 py-3 flex items-center justify-between border-b ${reg.region === 'CRM 미등록/예외' ? 'border-amber-100 bg-amber-50' : 'border-slate-100 bg-slate-50/80'}`}>
                                    <h3 className="font-bold flex items-center gap-1.5 text-base truncate">
                                        {reg.region === 'CRM 미등록/예외' ? <AlertCircle className="w-4 h-4 text-amber-500"/> : <MapPin className="w-4 h-4 text-indigo-500"/>}
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
                                            <span className="text-slate-300 font-normal">기준: 판매량</span>
                                        </h4>
                                        <ul className="space-y-1.5">
                                            {reg.topItems.map(([itemKey, stats], i) => (
                                                <li key={itemKey} className="flex flex-col text-[11px] bg-slate-50/50 rounded p-1.5 border border-slate-100">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="font-bold text-slate-700 flex items-center gap-1.5 truncate">
                                                            <span className="w-4 h-4 rounded bg-slate-200 text-slate-500 flex items-center justify-center text-[9px] font-bold shrink-0">{i+1}</span>
                                                            <span className="truncate" title={itemKey}>{itemKey}</span>
                                                        </span>
                                                        <span className="font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">{stats.qty.toLocaleString()}개</span>
                                                    </div>
                                                    <div className="flex items-center justify-end gap-2 text-[9px] text-slate-400">
                                                        <span>평균단가: {stats.qty > 0 ? Math.round(stats.amount/stats.qty).toLocaleString() : 0}원</span>
                                                        <span className="text-slate-500 font-bold">매출: {stats.amount.toLocaleString()}원</span>
                                                    </div>
                                                </li>
                                            ))}
                                            {reg.topItems.length === 0 && <li className="text-slate-400 text-xs py-2 text-center">판매된 아이템이 없습니다.</li>}
                                        </ul>
                                    </div>

                                    {reg.region === 'CRM 미등록/예외' && reg.missingArray.length > 0 && (
                                        <div className="bg-amber-100/50 rounded flex-col p-2.5 border border-amber-200 mt-2">
                                            <h4 className="text-[10px] font-bold text-amber-700 mb-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> CRM 등재 요망 상호명</h4>
                                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar pr-1">
                                                {reg.missingArray.map(m => (
                                                    <button 
                                                        key={m} 
                                                        onClick={() => {
                                                            setEditingCustomer({ companyName: m, region: '경기도' });
                                                            setActiveTab('MASTER');
                                                            setIsModalOpen(true);
                                                        }}
                                                        className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded hover:bg-amber-500 hover:text-white transition-colors text-left truncate max-w-[120px]"
                                                        title={`${m} - 클릭하여 즉시 CRM 추가하기`}
                                                    >
                                                        {m} +
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

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
                                        {/* High Margin Items */}
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                            <h4 className="text-[12px] font-black text-indigo-700 mb-3 uppercase tracking-widest flex items-center justify-between border-b border-slate-100 pb-2">
                                                <span>🏆 주력 매입 추천 (순마진 랭킹)</span>
                                                <span className="text-slate-400 font-bold">기준: 남긴이윤액</span>
                                            </h4>
                                            <ul className="space-y-3">
                                                {cluster.topMarginItems.map(([itemKey, stats], i) => {
                                                    const itemMargin = stats.amount - stats.cost;
                                                    const mPct = stats.amount > 0 ? (itemMargin / stats.amount) * 100 : 0;
                                                    return (
                                                        <li key={`margin-${itemKey}`} className="flex flex-col text-[12px] bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className="font-bold text-slate-800 flex items-start gap-2 leading-tight pr-2">
                                                                    <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span>
                                                                    <span className="mt-0.5">{itemKey}</span>
                                                                </span>
                                                                <div className="text-right">
                                                                    <div className="font-black text-indigo-600 whitespace-nowrap">+{itemMargin.toLocaleString()}원</div>
                                                                    <div className="text-[10px] font-bold text-indigo-400 mt-0.5">총 {stats.qty.toLocaleString()}개 / {stats.count.toLocaleString()}회 공급</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex justify-between items-center text-[11px] text-slate-500 bg-white px-2 py-1.5 rounded border border-slate-100">
                                                                <span>건당 평균마진: {stats.qty > 0 ? Math.round(itemMargin/stats.qty).toLocaleString() : 0}원</span>
                                                                <span className="font-black text-slate-600">이익률 {mPct.toFixed(1)}%</span>
                                                            </div>
                                                        </li>
                                                    );
                                                })}
                                                {cluster.topMarginItems.length === 0 && <li className="text-center text-xs text-slate-400 py-4 font-bold">집계할 데이터가 없습니다.</li>}
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
                                            <td className="px-4 py-3 font-bold text-slate-700">{itemKey}</td>
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
        </div>
    );
}
