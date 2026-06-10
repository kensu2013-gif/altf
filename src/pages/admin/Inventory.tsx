import { useState } from 'react';
import { useInventory } from '../../hooks/useInventory';
import { RefreshCw, Database } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export default function AdminInventory() {
    // Use the hook which handles SWR fetching and data mapping automatically
    const { inventory, isLoading, isValidating, refresh } = useInventory();
    const [isRefreshing, setIsRefreshing] = useState(false);

    const isBusy = isLoading || isValidating || isRefreshing;

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refresh();
        } catch (err) {
            console.error('[AdminInventory] Refresh failed:', err);
            alert('재고 데이터를 새로고침하는 중 오류가 발생했습니다.');
        } finally {
            setIsRefreshing(false);
        }
    };

    // Effect removed as useInventory hook handles fetching on mount

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

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase whitespace-nowrap">
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
                            {inventory.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                                        {isBusy ? '데이터를 불러오는 중입니다...' : '재고 데이터가 없습니다.'}
                                    </td>
                                </tr>
                            ) : (
                                // Limit display to 100 items to prevent crashing browser with 13,000+ items
                                inventory.slice(0, 100).map((item) => {
                                    const price = item.unitPrice;
                                    return (
                                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
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
                    <span>총 {inventory.length}개 품목 중 100개 표시</span>
                    <span>마지막 업데이트: {new Date().toLocaleTimeString()}</span>
                </div>
            </div>
        </div>
    );
}
