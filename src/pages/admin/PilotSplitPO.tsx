import { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useInventoryIndex } from '../../hooks/useInventoryIndex';
import type { LineItem, Order } from '../../types';
import { 
  ArrowLeftRight, 
  Trash2, 
  Plus, 
  FileText, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Building, 
  Download, 
  CheckCircle2, 
  AlertTriangle,
  RotateCcw,
  Layers
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PreviewModal } from '../../components/ui/PreviewModal';
import { renderDocumentHTML } from '../../lib/documentTemplate';
import { formatCurrency } from '../../lib/utils';

// 공급처 타입 정의
interface Supplier {
  id: string;
  company_name: string;
  contact_name: string;
  tel: string;
  email: string;
  address: string;
  note?: string;
}

// 기본 대경벤드 프리셋
const DEFAULT_SUPPLIER: Supplier = {
  id: 'daekyung',
  company_name: '(주)대경벤드',
  contact_name: '정호근 과장',
  tel: '055-364-1800',
  email: 'dksales@daekyungbend.com',
  address: '경상남도 양산시 어실로 115',
  note: '기본 매입처'
};

export default function PilotSplitPO() {
  // 1. 로컬호스트 접근 제어 가드 (배포 시 운영 접근 차단)
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocal) {
    return <Navigate to="/search" replace />;
  }

  const { orders, inventory } = useStore();
  const { findProduct } = useInventoryIndex(inventory);

  // 2. 동적 공급처 리스트 관리 (localStorage 연동)
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    try {
      const saved = localStorage.getItem('pilot_suppliers');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load pilot suppliers', e);
    }
    return [DEFAULT_SUPPLIER];
  });

  useEffect(() => {
    localStorage.setItem('pilot_suppliers', JSON.stringify(suppliers));
  }, [suppliers]);

  // 공급처 신규 추가 상태
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState<Omit<Supplier, 'id'>>({
    company_name: '',
    contact_name: '',
    tel: '',
    email: '',
    address: '',
    note: ''
  });

  const handleAddSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplier.company_name) return;

    const supplier: Supplier = {
      ...newSupplier,
      id: `sup-${Date.now()}`
    };

    setSuppliers(prev => [...prev, supplier]);
    setNewSupplier({
      company_name: '',
      contact_name: '',
      tel: '',
      email: '',
      address: '',
      note: ''
    });
    setShowAddSupplier(false);
  };

  const handleDeleteSupplier = (id: string) => {
    if (id === 'daekyung') {
      alert('대경벤드는 기본 공급처이므로 삭제할 수 없습니다.');
      return;
    }
    if (window.confirm('해당 공급처를 정말 삭제하시겠습니까? (할당되어 있던 모든 품목은 대경벤드로 리셋됩니다)')) {
      setSuppliers(prev => prev.filter(s => s.id !== id));
      // 할당 리셋
      setAssignments(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(itemId => {
          if (next[itemId] === id) {
            next[itemId] = 'daekyung';
          }
        });
        return next;
      });
    }
  };

  // 3. 대상 주문 선택
  const selectableOrders = useMemo(() => {
    return orders.filter(o => !o.isDeleted && o.status !== 'CANCELLED');
  }, [orders]);

  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  
  const currentOrder = useMemo(() => {
    return selectableOrders.find(o => o.id === selectedOrderId);
  }, [selectableOrders, selectedOrderId]);

  // 4. 드래그 앤 드롭 품목 할당 상태 관리
  // Key: LineItem ID, Value: Supplier ID
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  // 주문 선택 시 할당 기본값 세팅 (모두 대경벤드로 초기화)
  useEffect(() => {
    if (currentOrder) {
      const initial: Record<string, string> = {};
      const items = currentOrder.items || [];
      items.forEach(item => {
        initial[item.id] = 'daekyung';
      });
      setAssignments(initial);
    } else {
      setAssignments({});
    }
  }, [currentOrder]);

  // 드래그 중인 아이템 ID 트래킹
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggingItemId(itemId);
    e.dataTransfer.setData('text/plain', itemId);
  };

  const handleDragEnd = () => {
    setDraggingItemId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // drop 이벤트를 받기 위해 필수
  };

  const handleDrop = (e: React.DragEvent, supplierId: string) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('text/plain') || draggingItemId;
    if (itemId) {
      setAssignments(prev => ({
        ...prev,
        [itemId]: supplierId
      }));
    }
    setDraggingItemId(null);
  };

  // 5. 발주서 생성 미리보기 모달 데이터
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // 공급사별 할당된 아이템 집계 및 매입가 계산
  const supplierAggregations = useMemo(() => {
    if (!currentOrder) return {};

    const items = currentOrder.items || [];
    const result: Record<string, { items: LineItem[]; totalAmount: number }> = {};

    suppliers.forEach(s => {
      result[s.id] = { items: [], totalAmount: 0 };
    });

    items.forEach(item => {
      const supplierId = assignments[item.id] || 'daekyung';
      if (!result[supplierId]) {
        result[supplierId] = { items: [], totalAmount: 0 };
      }

      // 품목 인벤토리 조인으로 매입단가 계산
      const product = findProduct(item);
      const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? 0;
      const rate = item.supplierRate ?? product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
      
      let supplierPrice = item.supplierPriceOverride;
      if (supplierPrice === undefined) {
        supplierPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
      }

      const totalItemAmount = supplierPrice * item.quantity;

      result[supplierId].items.push({
        ...item,
        unitPrice: supplierPrice, // 발주서에는 매입가 표기
        amount: totalItemAmount
      });
      result[supplierId].totalAmount += totalItemAmount;
    });

    return result;
  }, [currentOrder, assignments, suppliers, findProduct]);

  // 개별 공급사 발주서 PDF 미리보기 빌드
  const handlePreviewPO = (supplier: Supplier) => {
    if (!currentOrder) return;
    const agg = supplierAggregations[supplier.id];
    if (!agg || agg.items.length === 0) {
      alert('할당된 발주 품목이 없습니다.');
      return;
    }

    // 문서 템플릿용 페이로드 구성
    const docPayload = {
      poNumber: `${currentOrder.poNumber || 'ES-PILOT'}-${supplier.company_name.replace('(주)', '').trim()}`,
      poTitle: `[알트에프 파일럿] ${supplier.company_name} 발주서`,
      createdAt: new Date().toISOString(),
      items: agg.items,
      supplierInfo: {
        company_name: supplier.company_name,
        contact_name: supplier.contact_name,
        tel: supplier.tel,
        email: supplier.email,
        address: supplier.address
      },
      buyerInfo: {
        company_name: '알트에프 (파일럿 분할발주)',
        contact_name: '파일럿 테스터',
        tel: '051-303-3751',
        email: 'altf@altf.kr',
        address: '부산시 사상구 낙동대로1330번길 67'
      },
      memo: `[파일럿] 복수 매입처 분할 발주 테스트건입니다.\n${supplier.note || ''}`
    };

    // renderDocumentHTML은 AdminOrderDetail에서 사용하는 전역 문서 서식 함수입니다.
    const html = renderDocumentHTML('PO', docPayload);
    setPreviewHtml(html);
    setPreviewModalOpen(true);
  };

  const handleExportConsole = () => {
    if (!currentOrder) return;
    
    const finalData = {
      orderId: currentOrder.id,
      poNumber: currentOrder.poNumber,
      customerName: currentOrder.customerName,
      splitDeliveries: suppliers.map(s => {
        const agg = supplierAggregations[s.id];
        return {
          supplier: s,
          items: agg?.items || [],
          totalAmount: agg?.totalAmount || 0
        };
      }).filter(s => s.items.length > 0)
    };

    console.log('=== [파일럿 분할 발주 최종 JSON 데이터] ===');
    console.log(JSON.stringify(finalData, null, 2));
    alert('최종 분할 발주 JSON 데이터가 브라우저 콘솔(F12)에 정상 출력되었습니다. 파일럿 검증을 위해 사용하세요.');
  };

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 p-6 min-h-screen overflow-auto">
      {/* 뒤로가기 / 헤더 */}
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 text-teal-400 rounded-xl border border-teal-500/20">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                분할 매입 발주 파일럿
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-bold">
                  PILOT (LOCALHOST ONLY)
                </span>
              </h1>
              <p className="text-slate-400 text-xs mt-0.5">
                대경벤드 품절 제품 및 대기분을 드래그하여 다중 매입처로 안전하게 분할 발주서를 발행합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:border-teal-500 focus:outline-none min-w-[280px]"
            >
              <option value="">-- 분할 발주할 주문서 선택 --</option>
              {selectableOrders.map(o => (
                <option key={o.id} value={o.id}>
                  {o.poNumber || '번호없음'} | {o.customerName} ({o.items?.length || 0}개 품목)
                </option>
              ))}
            </select>

            <Button
              variant="outline"
              disabled={!currentOrder}
              onClick={handleExportConsole}
              className="border-slate-800 text-slate-300 hover:bg-slate-900 flex items-center gap-2 font-bold py-2.5"
            >
              <ArrowLeftRight className="w-4 h-4 text-teal-400" />
              <span>최종 데이터 출력 (Console)</span>
            </Button>
          </div>
        </div>

        {/* 1. 공급처 관리 섹션 */}
        <div className="bg-slate-900/60 border border-slate-900 rounded-2xl p-5 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-400 tracking-wide uppercase flex items-center gap-2">
              <Building className="w-4 h-4 text-slate-500" />
              매입처/공급사 관리 ({suppliers.length}개 공급처 등록)
            </h2>
            <button
              onClick={() => setShowAddSupplier(!showAddSupplier)}
              className="flex items-center gap-1.5 text-xs font-bold text-teal-400 hover:text-teal-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 공급처 추가
            </button>
          </div>

          {showAddSupplier && (
            <form onSubmit={handleAddSupplier} className="bg-slate-950 p-4 rounded-xl border border-slate-800 gap-4 grid grid-cols-1 md:grid-cols-3 mb-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block">회사명 (필수)</label>
                <input
                  type="text"
                  required
                  placeholder="예: B금속"
                  value={newSupplier.company_name}
                  onChange={e => setNewSupplier(prev => ({ ...prev, company_name: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 focus:border-teal-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block">담당자</label>
                <input
                  type="text"
                  placeholder="예: 홍길동 대리"
                  value={newSupplier.contact_name}
                  onChange={e => setNewSupplier(prev => ({ ...prev, contact_name: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 focus:border-teal-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block">연락처</label>
                <input
                  type="text"
                  placeholder="예: 010-1234-5678"
                  value={newSupplier.tel}
                  onChange={e => setNewSupplier(prev => ({ ...prev, tel: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 focus:border-teal-500 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block">이메일</label>
                <input
                  type="email"
                  placeholder="example@mail.com"
                  value={newSupplier.email}
                  onChange={e => setNewSupplier(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 focus:border-teal-500 outline-none"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs text-slate-400 block">주소</label>
                <input
                  type="text"
                  placeholder="회사 상세 주소"
                  value={newSupplier.address}
                  onChange={e => setNewSupplier(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 focus:border-teal-500 outline-none"
                />
              </div>
              <div className="md:col-span-3 flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddSupplier(false)}
                  className="border-slate-800 text-slate-400 hover:bg-slate-900 px-4 py-1.5 text-xs"
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-1.5 text-xs"
                >
                  등록 완료
                </Button>
              </div>
            </form>
          )}

          <div className="flex flex-wrap gap-3">
            {suppliers.map(s => (
              <div
                key={s.id}
                className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2 min-w-[240px] relative group"
              >
                {s.id !== 'daekyung' && (
                  <button
                    onClick={() => handleDeleteSupplier(s.id)}
                    className="absolute top-3 right-3 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="공급사 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <div>
                  <h3 className="font-bold text-white text-sm flex items-center gap-1.5">
                    {s.company_name}
                    {s.id === 'daekyung' && (
                      <span className="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded font-black">
                        DEFAULT
                      </span>
                    )}
                  </h3>
                  <p className="text-slate-400 text-xs mt-0.5 flex items-center gap-1">
                    <User className="w-3 h-3" /> {s.contact_name || '-'}
                  </p>
                </div>
                <div className="text-[11px] text-slate-500 space-y-0.5 border-t border-slate-900 pt-2">
                  <p className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" /> {s.tel || '-'}</p>
                  <p className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" /> {s.email || '-'}</p>
                  <p className="truncate flex items-center gap-1" title={s.address}><MapPin className="w-2.5 h-2.5" /> {s.address || '-'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. 메인 워크스페이스 (DND 보드) */}
        {!currentOrder ? (
          <div className="text-center py-20 bg-slate-900/20 border border-dashed border-slate-800 rounded-3xl">
            <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-300">선택된 주문서가 없습니다</h3>
            <p className="text-slate-500 text-sm mt-1">
              상단의 드롭다운을 열어 분할 발주 테스트를 시작할 주문서를 불러와 주세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* 좌측: 발주 아이템 리스트 (DnD 소스) */}
            <div className="lg:col-span-4 bg-slate-900/40 border border-slate-900 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="font-bold text-sm tracking-wide text-white uppercase flex items-center gap-2">
                  <Layers className="w-4 h-4 text-teal-400" />
                  발주 대상 아이템 ({currentOrder.items?.length || 0})
                </h2>
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                  드래그 가능
                </span>
              </div>

              <div className="space-y-3 max-h-[650px] overflow-auto pr-1">
                {(currentOrder.items || []).map(item => {
                  const product = findProduct(item);
                  const dkStock = product?.locationStock?.['대경'] || product?.locationStock?.['양산'] || 0;
                  const isDkOutOfStock = dkStock === 0;

                  const currentAssignee = suppliers.find(s => s.id === (assignments[item.id] || 'daekyung'));

                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragEnd={handleDragEnd}
                      className={`bg-slate-950 border transition-all rounded-xl p-4 cursor-grab active:cursor-grabbing hover:border-slate-700 flex flex-col gap-2 relative ${
                        draggingItemId === item.id ? 'opacity-40 border-teal-500/50 shadow-inner' : 'border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-white text-base leading-snug">{item.name}</h4>
                          <p className="text-xs text-slate-400 mt-1">
                            {item.thickness} | {item.size} | {item.material}
                          </p>
                        </div>
                        <span className="text-sm font-black font-mono text-slate-200">
                          {item.quantity}개
                        </span>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-900 pt-2.5 mt-1 text-xs">
                        <div className="flex items-center gap-1.5">
                          {isDkOutOfStock ? (
                            <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-bold">
                              대경품절 (타공급처 권장)
                            </span>
                          ) : (
                            <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded font-bold">
                              대경재고 {dkStock}개 있음
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500">지정된 매입처</p>
                          <p className="font-bold text-teal-400 text-[11px] truncate max-w-[120px]">
                            {currentAssignee?.company_name}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 우측: 공급처별 드롭 보관함 (DnD 타겟) */}
            <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              {suppliers.map(s => {
                const agg = supplierAggregations[s.id] || { items: [], totalAmount: 0 };
                const isOver = draggingItemId && assignments[draggingItemId] !== s.id;

                return (
                  <div
                    key={s.id}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, s.id)}
                    className={`border-2 rounded-2xl p-5 flex flex-col min-h-[340px] transition-all relative ${
                      isOver 
                        ? 'border-dashed border-teal-500 bg-teal-500/5 shadow-[0_0_20px_rgba(20,184,166,0.15)] scale-[1.01]' 
                        : 'border-slate-900 bg-slate-900/35 hover:border-slate-800'
                    }`}
                  >
                    {/* 공급사 제목 */}
                    <div className="flex items-start justify-between border-b border-slate-800/80 pb-3 mb-4">
                      <div>
                        <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                          {s.company_name}
                          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
                            {agg.items.length}건
                          </span>
                        </h3>
                        <p className="text-slate-500 text-[11px] mt-0.5">{s.contact_name || '담당자미정'} | {s.tel || '연락처미정'}</p>
                      </div>

                      {agg.items.length > 0 && (
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500">매입 예상가</p>
                          <p className="font-black text-xs font-mono text-teal-400">
                            {formatCurrency(agg.totalAmount)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* 보관함 내 품목 리스트 */}
                    <div className="flex-1 space-y-2 max-h-[220px] overflow-auto pr-1">
                      {agg.items.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-600 text-xs py-10 border border-dashed border-slate-900 rounded-xl">
                          여기에 아이템을 드롭하세요
                        </div>
                      ) : (
                        agg.items.map(item => (
                          <div
                            key={item.id}
                            className="bg-slate-950 border border-slate-900 rounded-lg p-2.5 flex items-center justify-between text-xs"
                          >
                            <div>
                              <p className="font-bold text-slate-200">{item.name}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {item.thickness} | {item.size} | {item.material}
                              </p>
                            </div>
                            <div className="text-right flex items-center gap-3">
                              <span className="font-mono text-slate-400 font-bold">{item.quantity}개</span>
                              <button
                                onClick={() => {
                                  // 대경벤드로 복구
                                  setAssignments(prev => ({
                                    ...prev,
                                    [item.id]: 'daekyung'
                                  }));
                                }}
                                className="text-slate-600 hover:text-red-400 transition-colors"
                                title="할당 해제 (대경으로 복귀)"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* 하단 제어 */}
                    {agg.items.length > 0 && (
                      <div className="border-t border-slate-800/80 pt-3 mt-4 flex items-center justify-between">
                        <Button
                          variant="outline"
                          onClick={() => handlePreviewPO(s)}
                          className="border-slate-800 text-[11px] hover:bg-slate-900 py-1.5 flex items-center gap-1.5 w-full justify-center font-bold"
                        >
                          <FileText className="w-3.5 h-3.5 text-teal-400" />
                          <span>발주서 PDF 미리보기</span>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>

      {/* 미리보기 모달 */}
      <PreviewModal
        isOpen={previewModalOpen}
        onClose={() => {
          setPreviewModalOpen(false);
          setPreviewHtml(null);
        }}
        html={previewHtml || ''}
      />
    </div>
  );
}
