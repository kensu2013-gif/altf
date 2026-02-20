import { Badge } from '../ui/Badge';
import type { Product } from '../../types';

interface ProductTableProps {
    data: Product[];
    selectedIds: string[];
    visibleLocations?: string[]; // Optional: if provided, only show these locations
    onToggleSelect: (id: string) => void;
    onToggleAll: (ids: string[]) => void;
}

export function ProductTable({ data, selectedIds, onToggleSelect, visibleLocations = [] }: Omit<ProductTableProps, 'onToggleAll'>) {

    // Helper to check if a specific location is selected for an item
    const isLocationSelected = (itemId: string, location: string) => {
        const compositeId = `${itemId}|${location}`;
        return selectedIds.includes(compositeId);
    };

    return (
        <div className="w-full h-full flex flex-col bg-white">
            <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 text-gray-800 border-y border-gray-200 sticky top-0 z-10">
                        <tr>
                            <th className="w-[50px] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <span className="text-[13px] font-extrabold text-slate-900">선택</span>
                            </th>
                            <th className="w-[4%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <span className="text-[13px] font-extrabold text-slate-900">No.</span>
                            </th>
                            <th className="w-[8%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">품명</span>
                                    <span className="text-[12px] font-bold text-gray-500">ITEM</span>
                                </div>
                            </th>
                            <th className="w-[10%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">두께</span>
                                    <span className="text-[12px] font-bold text-gray-500">THICKNESS</span>
                                </div>
                            </th>
                            <th className="w-[8%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">규격</span>
                                    <span className="text-[12px] font-bold text-gray-500">SIZE</span>
                                </div>
                            </th>
                            <th className="w-[12%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">재질</span>
                                    <span className="text-[12px] font-bold text-gray-500">MATERIAL</span>
                                </div>
                            </th>
                            <th className="w-[10%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">재고</span>
                                    <span className="text-[12px] font-bold text-gray-500">STOCK</span>
                                </div>
                            </th>
                            <th className="w-[8%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">상태</span>
                                    <span className="text-[12px] font-bold text-gray-500">STAT</span>
                                </div>
                            </th>

                            {/* Location Column - No Filter Buttons */}
                            <th className="w-[10%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">위치</span>
                                    <span className="text-[12px] font-bold text-gray-500">LOCATION</span>
                                </div>
                            </th>

                            <th className="w-[10%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">제조사</span>
                                    <span className="text-[12px] font-bold text-gray-500">MAKER</span>
                                </div>
                            </th>
                            <th className="w-[7%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">수량</span>
                                    <span className="text-[12px] font-bold text-gray-500">QTY</span>
                                </div>
                            </th>
                            <th className="w-[8%] px-2 py-3 text-center border-r border-gray-200 bg-gray-50">
                                <div className="flex flex-col items-center justify-center leading-tight">
                                    <span className="text-base font-extrabold text-slate-900">출고단가</span>
                                    <span className="text-[12px] font-bold text-gray-500">PRICE</span>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan={12} className="px-4 py-12 text-center text-slate-400 text-sm">
                                    검색 결과가 없습니다.
                                </td>
                            </tr>
                        ) : (
                            data.map((item, index) => {
                                const now = item; // Alias
                                const price = now.unitPrice;
                                const locStock = now.locationStock;

                                return (
                                    <tr
                                        key={item.id}
                                        className={`hover:bg-blue-50/50 transition-colors cursor-pointer border-b border-gray-100 text-[15px] ${selectedIds.includes(item.id) ? "bg-blue-50" : "bg-white"}`}
                                        onClick={() => onToggleSelect(item.id)}
                                    >
                                        <td className="px-2 py-3 text-center border-r border-gray-100" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(item.id)}
                                                onChange={() => onToggleSelect(item.id)}
                                                className="w-5 h-5 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                                                aria-label={`Select ${item.name}`}
                                            />
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100 font-bold text-slate-500">
                                            {index + 1}
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100 font-bold text-slate-800">
                                            {item.name}
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100 text-slate-600 font-medium">
                                            {item.thickness}
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100 text-slate-600 font-medium">
                                            {item.size}
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100">
                                            <span className="text-slate-600 font-bold">
                                                {item.material}
                                            </span>
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100 font-bold text-slate-800 text-[15px]">
                                            {item.currentStock === 0 ? (
                                                <span className="text-red-300">-</span>
                                            ) : (
                                                item.currentStock.toLocaleString()
                                            )}
                                        </td>
                                        <td className="px-2 py-3 text-center border-r border-gray-100">
                                            {item.stockStatus === 'AVAILABLE' && (
                                                <Badge className="bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100">출고가능</Badge>
                                            )}
                                            {item.stockStatus === 'CHECK_LEAD_TIME' && (
                                                <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100">납기확인</Badge>
                                            )}
                                            {item.stockStatus === 'OUT_OF_STOCK' && (
                                                <Badge color="slate" className="text-slate-500 border border-slate-200 bg-slate-50">재고없음</Badge>
                                            )}
                                        </td>

                                        {/* Location Column */}
                                        <td className="px-2 py-3 border-r border-gray-100 text-xs text-slate-500 align-middle">
                                            <div className="flex flex-col gap-1 items-center" onClick={(e) => e.stopPropagation()}>
                                                {(locStock && Object.keys(locStock).length > 0) ? (
                                                    Object.entries(locStock)
                                                        .filter(([loc]) => {
                                                            if (visibleLocations.length > 0) {
                                                                return visibleLocations.includes(loc);
                                                            }
                                                            return true;
                                                        })
                                                        .map(([loc, qty]) => {
                                                            const isSelected = isLocationSelected(item.id, loc);
                                                            return (
                                                                <button
                                                                    key={loc}
                                                                    onClick={() => onToggleSelect(`${item.id}|${loc}`)}
                                                                    className={`
                                                                    w-full text-center font-bold px-1 py-1 rounded text-[12px] border transition-all
                                                                    ${isSelected
                                                                            ? "bg-teal-600 text-white border-teal-600 shadow-sm ring-1 ring-teal-200"
                                                                            : "text-slate-700 bg-slate-50 border-slate-200 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700"}
                                                                `}
                                                                >
                                                                    {loc} : {qty.toLocaleString()}
                                                                </button>
                                                            );
                                                        })
                                                ) : (item.markingWaitQty && item.markingWaitQty > 0) ? (
                                                    <span className="text-purple-600 font-bold">공정중</span>
                                                ) : (
                                                    <span className="text-slate-400">-</span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Maker Column - Plain Text */}
                                        <td className="px-2 py-3 text-center border-r border-gray-100">
                                            <span className={`text-[13px] font-bold font-mono ${(!item.maker || item.maker === '-') && item.markingWaitQty && item.markingWaitQty > 0 ? "text-purple-600" : "text-slate-700"}`}>
                                                {(!item.maker || item.maker === '-') && item.markingWaitQty && item.markingWaitQty > 0 ? '대경' : item.maker}
                                            </span>
                                        </td>

                                        <td className="px-2 py-3 text-center border-r border-gray-100" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="number"
                                                min="1"
                                                className="w-12 text-center text-sm font-bold text-slate-900 border border-slate-200 rounded focus:border-teal-500 outline-none p-1"
                                                defaultValue={1}
                                                aria-label="Quantity"
                                            />
                                        </td>
                                        <td className="px-2 py-3 text-center font-bold text-slate-900 font-mono group-hover:text-teal-600 transition-colors">
                                            {price.toLocaleString()}
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div >
    );
}
