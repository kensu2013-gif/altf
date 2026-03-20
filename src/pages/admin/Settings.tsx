import { useState } from 'react';
import { useStore, type CustomPriceRecord } from '../../store/useStore';
import type { LineItem, Quotation, Order } from '../../types';
import { Database, Loader2, CheckCircle2 } from 'lucide-react';

export default function AdminSettings() {
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<string | null>(null);
    const saveCustomPrices = useStore(state => state.saveCustomPrices);
    const user = useStore(state => state.auth.user);

    const handleSyncHistoricalPrices = async () => {
        if (!confirm('시스템 전체 데이터(견적/발주서)를 스캔하여 미연동 품목 가격 정보를 불러옵니다. 진행하시겠습니까?')) return;
        setIsSyncing(true);
        setSyncResult(null);
        try {
            const apiUrl = import.meta.env.VITE_API_URL || '';
            const headers = {
                'Authorization': `Bearer ${useStore.getState().auth.token}`,
                'Content-Type': 'application/json'
            };

            // Fetch Quotes
            const quotesRes = await fetch(`${apiUrl}/api/my/quotations?limit=5000`, { headers });
            const quotesData = quotesRes.ok ? await quotesRes.json() : [];

            // Fetch Orders
            const ordersEndpoint = user?.role === 'MASTER' ? '/api/admin/orders' : '/api/my/orders';
            const ordersRes = await fetch(`${apiUrl}${ordersEndpoint}?limit=5000`, { headers });
            const ordersData = ordersRes.ok ? await ordersRes.json() : [];

            let foundCount = 0;
            const records: CustomPriceRecord[] = [];

            const processItems = (items: LineItem[]) => {
                if (!items) return;
                items.forEach(item => {
                    if (!item.productId && item.name) {
                        const specKey = [item.name, item.thickness, item.size, item.material].filter(Boolean).join('-').trim();
                        
                        // 이미 현재 customPrices에 저장된 단가가 있다면 덮어쓰지 않음 보호 (유지)
                        if (useStore.getState().customPrices[specKey]) return;
                        
                        // 이번 스캔 중 중복으로 들어온 최신 기록이 이미 배열에 있으면 무시 ( API가 최신순으로 반환하므로 첫 번째가 가장 최신 )
                        if (records.some(r => r.id === specKey)) return;

                        const spOverride = item.supplierPriceOverride || 0;
                        const bp = item.base_price || 0;
                        const sRate = item.supplierRate ?? 0;

                        if (specKey && (item.unitPrice > 0 || spOverride > 0 || bp > 0)) { 
                            const salesPrice = item.unitPrice || 0;
                            let purchasePrice = spOverride;
                            
                            // If SupplierPriceOverride not found, try to calculate from basePrice and supplierRate
                            if (purchasePrice === 0 && bp > 0 && item.supplierRate !== undefined) {
                                purchasePrice = Math.round((bp * (100 - sRate) / 100) / 10) * 10;
                            }

                            if (salesPrice > 0 || purchasePrice > 0) {
                                records.push({
                                    id: specKey,
                                    name: item.name,
                                    thickness: item.thickness || '',
                                    size: item.size || '',
                                    material: item.material || '',
                                    salesPrice,
                                    purchasePrice,
                                    updatedAt: new Date().toISOString(),
                                    updatedBy: user?.email || 'admin_sync'
                                });
                                foundCount++;
                            }
                        }
                    }
                });
            };

            if (Array.isArray(quotesData)) quotesData.forEach((q: Quotation) => processItems(q.items));
            if (Array.isArray(ordersData)) ordersData.forEach((o: Order) => processItems(o.items || []));

            if (records.length > 0) {
                saveCustomPrices(records);
            }
            
            setSyncResult(`총 ${foundCount}건의 미연동 품목 기록을 스캔하여 추천단가 사전에 반영했습니다.`);
            
        } catch (e) {
            console.error(e);
            setSyncResult('오류가 발생했습니다. 개발자 도구를 확인하세요.');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800">설정</h1>
                <p className="text-slate-500 text-sm mt-1">시스템 기본 설정을 확인합니다.</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100">
                <div className="p-6 space-y-4">
                    <h3 className="font-bold text-slate-900">관리자 정보</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingItem label="수신 이메일" value="altf@altf.kr" readonly />
                        <SettingItem label="알림 설정" value="이메일, 카카오톡" readonly />
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <h3 className="font-bold text-slate-900">브랜드 설정</h3>
                    <div className="flex items-center gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Primary Color</label>
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-teal-600 shadow-lg shadow-teal-500/20 ring-2 ring-offset-2 ring-teal-600"></div>
                                <div>
                                    <p className="font-mono text-sm font-bold text-slate-700">Teal 600</p>
                                    <p className="text-xs text-slate-400">#0d9488</p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Secondary Color</label>
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-slate-900 shadow-lg shadow-slate-900/20 ring-2 ring-offset-2 ring-slate-900"></div>
                                <div>
                                    <p className="font-mono text-sm font-bold text-slate-700">Slate 900</p>
                                    <p className="text-xs text-slate-400">#0f172a</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <Database className="w-5 h-5 text-indigo-600" />
                        데이터 관리 (Data Management)
                    </h3>
                    <p className="text-sm text-slate-500">과거 데이터를 정리하거나 동기화합니다.</p>
                    
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <h4 className="font-bold text-slate-800 text-sm mb-2">과거 미연동 단가(Custom Price) 일괄 불러오기</h4>
                        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                            시스템에 저장된 모든 과거 견적서와 발주서를 스캔하여, 수기로 입력하셨던 제품(인벤토리에 없는 제품)의 판매/매입 단가 기록을 찾습니다.<br/>
                            찾아낸 기록들은 <b>"스마트 추천단가"</b> 사전에 통합되어, 앞으로 견적/발주 작성 시 자동으로 불러와집니다. (기존 저장된 추천단가는 최신 데이터로 덮어씌워집니다)
                        </p>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleSyncHistoricalPrices}
                                disabled={isSyncing}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                            >
                                {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                {isSyncing ? '데이터 스캔 중...' : '과거 단가 기록 스캔 및 동기화'}
                            </button>
                            {syncResult && (
                                <div className="text-sm font-bold flex items-center gap-1.5 text-teal-700 bg-teal-50 px-3 py-1.5 rounded-md border border-teal-100">
                                    <CheckCircle2 className="w-4 h-4" />
                                    {syncResult}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingItem({ label, value, readonly = false }: { label: string, value: string, readonly?: boolean }) {
    return (
        <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">{label}</label>
            <input
                type="text"
                value={value}
                readOnly={readonly}
                title={label}
                className={`w-full px-4 py-2 rounded-lg border border-slate-200 text-sm ${readonly ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-900'}`}
            />
        </div>
    )
}
