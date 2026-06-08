import { useInventory } from '../../hooks/useInventory';
import { RefreshCw, Database } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ItemIntelligenceCard } from './components/ItemIntelligenceCard';
import { useState } from 'react';
import type { Product } from '../../types';

export default function AdminInventory() {
    // Use the hook which handles SWR fetching and data mapping automatically
    const { inventory, lastModified, isLoading, isValidating } = useInventory();
    const [selectedItem, setSelectedItem] = useState<{ id: string, name: string } | null>(null);

    // Search filters state
    const [itemName, setItemName] = useState('');
    const [thickness, setThickness] = useState('');
    const [size, setSize] = useState('');
    const [material, setMaterial] = useState('');
    const [location, setLocation] = useState('');
    const [maker, setMaker] = useState('');

    const isBusy = isLoading || isValidating;

    const handleRefresh = () => {
        window.location.reload(); // Simple brute force refresh for admin to be sure
    };

    // Flatten inventory to separate Yangsan and Sihwa stocks
    const flatInventory: Product[] = [];
    inventory.forEach((item) => {
        // 1. Yangsan Stock Row (or default location)
        const primaryLoc = item.location || '';
        const primaryMaker = item.maker || '';
        const primaryStock = item.ready_qty !== undefined ? Number(item.ready_qty) : (Number(item.currentStock) || 0);

        flatInventory.push({
            ...item,
            uniqueKey: `${item.id}-primary`,
            location: primaryLoc,
            maker: primaryMaker,
            currentStock: primaryStock,
            stockStatus: primaryStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
        });

        // 2. Sihwa Stock Row (secondary location)
        const hasSecondary = (item.location1 && item.location1.trim() !== '') || 
                              (item.sh_qty !== undefined && Number(item.sh_qty) > 0) ||
                              (item.shQty !== undefined && Number(item.shQty) > 0);

        if (hasSecondary) {
            const secLoc = (item.location1 === '서울' || item.location1 === '서울재고') ? '시화' : (item.location1 || '시화');
            const secMaker = item.maker1 || item.maker || '';
            const secStock = item.sh_qty !== undefined ? Number(item.sh_qty) : (item.shQty !== undefined ? Number(item.shQty) : 0);

            flatInventory.push({
                ...item,
                uniqueKey: `${item.id}-secondary`,
                location: secLoc,
                maker: secMaker,
                currentStock: secStock,
                stockStatus: secStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
            });
        }
    });

    // Count non-empty filter inputs
    const filledCount = [itemName, thickness, size, material, location, maker].filter(val => val.trim() !== '').length;

    // Filter items with exact match (===)
    const filteredInventory = flatInventory.filter(item => {
        if (itemName.trim() !== '' && item.name.trim().toUpperCase() !== itemName.trim().toUpperCase()) {
            return false;
        }
        if (thickness.trim() !== '' && item.thickness.trim().toUpperCase() !== thickness.trim().toUpperCase()) {
            return false;
        }
        if (size.trim() !== '' && item.size.trim().toUpperCase() !== size.trim().toUpperCase()) {
            return false;
        }
        if (material.trim() !== '' && item.material.trim().toUpperCase() !== material.trim().toUpperCase()) {
            return false;
        }
        if (location.trim() !== '' && (item.location || '').trim().toUpperCase() !== location.trim().toUpperCase()) {
            return false;
        }
        if (maker.trim() !== '' && (item.maker || '').trim().toUpperCase() !== maker.trim().toUpperCase()) {
            return false;
        }
        return true;
    });

    const displayInventory = filledCount >= 2 ? filteredInventory : flatInventory.slice(0, 100);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Database className="w-6 h-6 text-teal-600" />
                        재고 데이터 (Raw Inventory)
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        AWS S3에 저장된 인벤토리 파일(inventory.json)의 원본 데이터입니다.
                    </p>
                </div>
                <Button
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="flex items-center gap-2"
                    variant="outline"
                >
                    <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                    데이터 새로고침
                </Button>
            </div>

            {/* Search Filters Card */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                        <span>🔍 상세 검색 필터</span>
                        <span className="text-xs font-normal text-slate-400">
                            (입력한 항목과 정확히 일치하는 재고 데이터를 검색합니다)
                        </span>
                    </h3>
                    {filledCount > 0 && (
                        <button
                            onClick={() => {
                                setItemName('');
                                setThickness('');
                                setSize('');
                                setMaterial('');
                                setLocation('');
                                setMaker('');
                            }}
                            className="text-xs text-red-500 hover:text-red-700 font-bold transition-colors"
                        >
                            필터 초기화
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">품목명 (ITEM)</label>
                        <input
                            type="text"
                            value={itemName}
                            onChange={(e) => setItemName(e.target.value)}
                            placeholder="예: 90E(L)"
                            className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">두께 (THICKNESS)</label>
                        <input
                            type="text"
                            value={thickness}
                            onChange={(e) => setThickness(e.target.value)}
                            placeholder="예: S10S"
                            className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">규격 (SIZE)</label>
                        <input
                            type="text"
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            placeholder="예: 80A"
                            className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">재질 (MATERIAL)</label>
                        <input
                            type="text"
                            value={material}
                            onChange={(e) => setMaterial(e.target.value)}
                            placeholder="예: STS304-W"
                            className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">위치 (LOCATION)</label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="예: 시화"
                            className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 block">제조사 (MAKER)</label>
                        <input
                            type="text"
                            value={maker}
                            onChange={(e) => setMaker(e.target.value)}
                            placeholder="예: 대경"
                            className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
                        />
                    </div>
                </div>

                {/* Status Message Banner */}
                {filledCount < 2 ? (
                    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between">
                        <span>⚠️ 필터를 작동시키려면 **최소 2개 이상의 검색 조건**을 입력해 주세요. (현재 입력됨: {filledCount}개)</span>
                        <span className="opacity-70 font-mono text-[10px]">미충족 시 전체 목록 중 100개만 표시됩니다</span>
                    </div>
                ) : (
                    <div className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 flex items-center justify-between animate-in fade-in duration-300">
                        <span>✅ 상세 검색 필터가 적용되었습니다. 검색 매칭 항목: **{filteredInventory.length}개**</span>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase whitespace-nowrap sticky top-0">
                            <tr>
                                <th className="px-4 py-3 font-bold">ID</th>
                                <th className="px-4 py-3 font-bold">품목명 (Name)</th>
                                <th className="px-4 py-3 font-bold">두께 (Thickness)</th>
                                <th className="px-4 py-3 font-bold">규격 (Size)</th>
                                <th className="px-4 py-3 font-bold">재질 (Material)</th>
                                <th className="px-4 py-3 font-bold text-right">단가 (Price)</th>
                                <th className="px-4 py-3 font-bold text-right">재고 (Stock)</th>
                                <th className="px-4 py-3 font-bold text-center">상태 (Status)</th>
                                <th className="px-4 py-3 font-bold">위치 (Location)</th>
                                <th className="px-4 py-3 font-bold">제조사 (Maker)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {displayInventory.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                                        {isBusy ? '데이터를 불러오는 중입니다...' : '조건에 매칭되는 재고 데이터가 없습니다.'}
                                    </td>
                                </tr>
                            ) : (
                                displayInventory.map((item) => {
                                    const price = item.unitPrice;
                                    return (
                                        <tr key={item.uniqueKey || item.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedItem({ id: item.id, name: item.name })}>
                                            <td className="px-4 py-3 font-mono text-slate-400">{item.id.slice(0, 8)}...</td>
                                            <td className="px-4 py-3 font-bold text-slate-800">
                                                {item.name}
                                            </td>
                                            <td className="px-4 py-3">
                                                {item.thickness}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">
                                                {item.size}
                                            </td>
                                            <td className="px-4 py-3">
                                                {item.material}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {price.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">
                                                {item.currentStock.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.stockStatus === 'AVAILABLE' ? 'bg-teal-100 text-teal-700' :
                                                    item.stockStatus === 'CHECK_LEAD_TIME' ? 'bg-orange-100 text-orange-700' :
                                                        'bg-red-100 text-red-700'
                                                    }`}>
                                                    {item.stockStatus}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-500">
                                                {item.location || '-'}
                                            </td>
                                            <td className="px-4 py-3 text-slate-500">
                                                {item.maker || '-'}
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between">
                    <span>
                        {filledCount >= 2 
                            ? `검색 결과: 총 ${displayInventory.length}개 품목 표시`
                            : `전체 ${flatInventory.length}개 품목 중 100개 표시`
                        }
                    </span>
                    <span>
                        데이터 출처(S3) 기준 일시: {lastModified ? new Date(lastModified).toLocaleString('ko-KR') : '확인 중...'} 
                        {' '}(웹 새로고침: {new Date().toLocaleTimeString()})
                    </span>
                </div>
            </div>

            {selectedItem && (
                <ItemIntelligenceCard
                    productId={selectedItem.id}
                    productName={selectedItem.name}
                    onClose={() => setSelectedItem(null)}
                />
            )}
        </div>
    );
}
