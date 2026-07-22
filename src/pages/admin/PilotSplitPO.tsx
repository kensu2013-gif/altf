import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useInventoryIndex } from '../../hooks/useInventoryIndex';
import type { LineItem, SplitDelivery, Order } from '../../types';
import type { DocumentPayload } from '../../types/document';
import { 
  Trash2, 
  Plus, 
  FileText, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Building, 
  AlertTriangle,
  RotateCcw,
  Layers,
  Save,
  Search,
  GripVertical,
  Send
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PreviewModal } from '../../components/ui/PreviewModal';
import { renderDocumentHTML } from '../../lib/documentTemplate';
import { formatCurrency } from '../../lib/utils';
import { AdminOrderDetail } from './components/AdminOrderDetail';

// 공급처 타입 정의
interface Supplier {
  id: string;
  company_name: string;
  contact_name: string;
  tel: string;
  email: string;
  address: string;
  note?: string;
  default_rate?: number; // [NEW] 기본 매입 요율 (%)
}

// CRM 고객 타입 정의
interface CrmCustomer {
  id?: string;
  isDeleted?: boolean;
  companyName?: string;
  company_name?: string;
  contactName?: string;
  contact_name?: string;
  phone?: string;
  tel?: string;
  email?: string;
  address?: string;
  ceo?: string;
  businessNumber?: string;
}

// 기본 대경벤드 프리셋
const DEFAULT_SUPPLIER: Supplier = {
  id: 'daekyung',
  company_name: '(주)대경벤드',
  contact_name: '정호근 과장',
  tel: '055-364-1800',
  email: 'dksales@daekyungbend.com',
  address: '경상남도 양산시 어실로 115',
  note: '기본 매입처',
  default_rate: 47
};

function generateSupplierId() {
  return `sup-${new Date().getTime()}`;
}

export default function PilotSplitPO() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedOrderId = searchParams.get('orderId') || '';
  const [isSuppliersFolded, setIsSuppliersFolded] = useState(true);
  const [emailSendingStatus, setEmailSendingStatus] = useState<Record<string, boolean>>({});
  const [printEndCustomerOptions, setPrintEndCustomerOptions] = useState<Record<string, boolean>>({});

  // 1. 로컬호스트 접근 제어 가드 (배포 시 운영 접근 차단)
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const { orders, setOrders, updateOrder, inventory } = useStore();
  const { findProduct } = useInventoryIndex(inventory);

  const user = useStore(state => state.auth.user);
  const token = useStore(state => state.auth.token);

  // === CRM 실시간 주문 연동 ===
  useEffect(() => {
    if (!user || !token) return;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-requester-id': user.id || '',
      'x-requester-role': user.role || ''
    };
    const endpoint = `${import.meta.env.VITE_API_URL || ''}/api/my/orders?limit=2000`;
    
    fetch(endpoint, { headers, cache: 'no-store' })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch orders');
      })
      .then(data => {
        if (Array.isArray(data)) {
          setOrders(data);
        }
      })
      .catch(err => console.error('CRM 실시간 연동 실패:', err));
  }, [user, token, setOrders]);

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
    note: '',
    default_rate: 45
  });

  // === CRM 거래처 목록 로드 및 검색 ===
  const [crmCustomers, setCrmCustomers] = useState<CrmCustomer[]>([]);
  const [crmSearchQuery, setCrmSearchQuery] = useState('');
  const [showCrmDropdown, setShowCrmDropdown] = useState(false);

  useEffect(() => {
    if (!token) return;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'x-requester-role': user?.role || 'GUEST'
    };
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/customers`, { headers })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch CRM customers');
      })
      .then(data => {
        if (Array.isArray(data)) {
          // 유효한 고객만 필터링
          const filtered = data.filter(c => !c.isDeleted && (c.companyName || c.company_name));
          setCrmCustomers(filtered);
        }
      })
      .catch(err => console.error('CRM 거래처 로드 실패:', err));
  }, [token, user]);

  const filteredCrmCustomers = useMemo(() => {
    if (!crmSearchQuery.trim()) return [];
    const query = crmSearchQuery.toLowerCase();
    return crmCustomers.filter(c => {
      const name = (c.companyName || c.company_name || '').toLowerCase();
      const contact = (c.contactName || c.contact_name || '').toLowerCase();
      const bizNo = (c.businessNumber || '').toLowerCase();
      return name.includes(query) || contact.includes(query) || bizNo.includes(query);
    }).slice(0, 10);
  }, [crmCustomers, crmSearchQuery]);

  const handleSelectCrmCustomer = (c: CrmCustomer) => {
    setNewSupplier({
      company_name: c.companyName || c.company_name || '',
      contact_name: c.contactName || c.contact_name || '',
      tel: c.phone || c.tel || '',
      email: c.email || '',
      address: c.address || '',
      note: `CRM 연동 등록 (대표: ${c.ceo || ''}, 등록번호: ${c.businessNumber || ''})`
    });
    setCrmSearchQuery('');
    setShowCrmDropdown(false);
  };

  const handleAddSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplier.company_name) return;

    const supplier: Supplier = {
      ...newSupplier,
      id: generateSupplierId()
    };

    setSuppliers(prev => [...prev, supplier]);
    setActiveSupplierIds(prev => [...prev, supplier.id]);
    setNewSupplier({
      company_name: '',
      contact_name: '',
      tel: '',
      email: '',
      address: '',
      note: '',
      default_rate: 45
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
      setActiveSupplierIds(prev => prev.filter(sId => sId !== id));
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

  // 3. 대상 주문 선택 (하위 분할 주문서는 제외)
  const selectableOrders = useMemo(() => {
    return orders.filter(o => !o.isDeleted && o.status !== 'CANCELLED' && !o.isSplitPoSubOrder);
  }, [orders]);

  const currentOrder = useMemo(() => {
    return selectableOrders.find(o => o.id === selectedOrderId);
  }, [selectableOrders, selectedOrderId]);

  // 품목 분할을 위한 확장 타입 정의
  interface SplitLineItem extends LineItem {
    parentId?: string; // 원래 품목의 ID
    isSplit?: boolean; // 분할된 가상 품목 여부
  }

  // 로컬에서 관리할 품목 리스트 상태
  const [localItems, setLocalItems] = useState<SplitLineItem[]>([]);

  // 4. 드래그 앤 드롭 품목 할당 상태 관리
  // Key: LineItem ID, Value: Supplier ID
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  // 중복 선택(Multi-select) 품목 ID 리스트
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  // 매입 발주 상세 모달 제어용 상태
  const [selectedOrderDetailOrder, setSelectedOrderDetailOrder] = useState<Order | null>(null);
  const [detailInitialMode, setDetailInitialMode] = useState<'CUSTOMER' | 'SUPPLIER'>('SUPPLIER');

  // 활성화된 제조회사(공급사) 카드 목록 상태 (우측 노출 제어용)
  const [activeSupplierIds, setActiveSupplierIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pilot_active_suppliers');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load active suppliers', e);
    }
    try {
      const savedSup = localStorage.getItem('pilot_suppliers');
      if (savedSup) {
        const parsed = JSON.parse(savedSup) as Supplier[];
        return parsed.map(s => s.id);
      }
    } catch {
      // ignore
    }
    return [DEFAULT_SUPPLIER.id];
  });

  // activeSupplierIds 로컬 저장 유지
  useEffect(() => {
    localStorage.setItem('pilot_active_suppliers', JSON.stringify(activeSupplierIds));
  }, [activeSupplierIds]);

  // 부모 발주 번호가 없을 때 기존 웹의 규칙(날짜 + 현재 생성 NO)에 따라 신규 자동 발급하는 헬퍼
  const generateParentPoNumber = (): string => {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yy}${mm}${dd}`; // e.g. 260716

    const highestIdx = orders
      .filter(o => o.poNumber?.startsWith(`ES${todayStr}-`))
      .map(o => parseInt(o.poNumber!.split('-')[1], 10))
      .filter(n => !isNaN(n))
      .reduce((max, cur) => Math.max(max, cur), 0);

    const nextSeq = String(highestIdx + 1).padStart(3, '0');
    return `ES${todayStr}-${nextSeq}`;
  };

  // 렌더링 단계에서 상태 동기화 (useEffect cascading render 경고 방지)
  const [prevSelectedOrderId, setPrevSelectedOrderId] = useState<string>('');
  if (selectedOrderId !== prevSelectedOrderId) {
    setPrevSelectedOrderId(selectedOrderId);
    setSelectedItemIds([]);

    if (currentOrder) {
      const restoredAssignments: Record<string, string> = {};
      const restoredItems: SplitLineItem[] = [];
      const loadedSuppliers: Supplier[] = [];

      // 1. splitDeliveries 내역이 이미 존재하는 경우
      if (currentOrder.splitDeliveries && currentOrder.splitDeliveries.length > 0) {
        currentOrder.splitDeliveries.forEach(d => {
          if (d.supplier && d.supplier.id) {
            loadedSuppliers.push(d.supplier);
          }
          if (Array.isArray(d.items)) {
            d.items.forEach(item => {
              const matchedPoItem = d.po_items?.find(pi => (pi.parentId || pi.id) === (item.parentId || item.id));
              const product = findProduct(item);
              const restoredRate = matchedPoItem?.supplierRate ?? item.supplierRate ?? d.supplier?.default_rate ?? product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? item.discountRate ?? 72;
              const restoredOverride = matchedPoItem?.supplierPriceOverride ?? item.supplierPriceOverride;

              restoredItems.push({
                ...item,
                supplierRate: restoredRate,
                supplierPriceOverride: restoredOverride
              } as SplitLineItem);
              restoredAssignments[item.id] = d.supplier.id;
            });
          }
        });

        // 원본 items 중 splitDeliveries에 포함되지 않고 누락된 품목이 있다면
        const rawItems = currentOrder.items || [];
        rawItems.forEach(orig => {
          const isRestored = restoredItems.some(it => it.id === orig.id || it.parentId === orig.id);
          if (!isRestored) {
            restoredItems.push(orig as SplitLineItem);
          }
        });
      } 
      // 2. splitDeliveries는 없으나 단일 supplierInfo(유성벤드 등)가 작성된 발주서 주문의 경우
      else if (currentOrder.supplierInfo && currentOrder.supplierInfo.company_name) {
        const supInfo = currentOrder.supplierInfo;
        const supId = supInfo.id || `sup-${supInfo.company_name.replace(/[\s()]/g, '')}`;
        const singleSupplier: Supplier = {
          id: supId,
          company_name: supInfo.company_name,
          contact_name: supInfo.contact_name || '',
          tel: supInfo.tel || '',
          email: supInfo.email || '',
          address: supInfo.address || '',
          note: supInfo.note || '',
          default_rate: 45
        };
        loadedSuppliers.push(singleSupplier);

        const rawItems = currentOrder.items || [];
        rawItems.forEach(orig => {
          restoredItems.push(orig as SplitLineItem);
          restoredAssignments[orig.id] = supId;
        });
      } 
      // 3. 완전히 새로운 미지정 주문서인 경우
      else {
        (currentOrder.items || []).forEach(orig => {
          restoredItems.push(orig as SplitLineItem);
        });
      }

      // 누락된 매입처가 있다면 suppliers 목록에 추가/갱신
      if (loadedSuppliers.length > 0) {
        setSuppliers(prev => {
          const next = [...prev];
          loadedSuppliers.forEach(ls => {
            const idx = next.findIndex(s => s.id === ls.id || s.company_name === ls.company_name);
            if (idx === -1) {
              next.push(ls);
            } else {
              next[idx] = { ...next[idx], ...ls };
            }
          });
          return next;
        });
      }

      // ⭐ [핵심 픽스] 저장된 모든 매입처 카드 ID를 activeSupplierIds에 100% 강제 활성화 (대경벤드 기본 포함)
      setActiveSupplierIds(prev => {
        const set = new Set<string>(prev);
        set.add(DEFAULT_SUPPLIER.id); // 대경벤드는 항상 켬
        loadedSuppliers.forEach(ls => {
          if (ls.id) set.add(ls.id);
        });
        return Array.from(set);
      });

      setLocalItems(restoredItems);
      setAssignments(restoredAssignments);
      console.log("[SplitPO] Restored split PO assignments & forced active supplier cards for order:", selectedOrderId);
    } else {
      setAssignments({});
      setLocalItems([]);
    }
  }

  // 드래그 중인 아이템 ID 트래킹
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggingItemId(itemId);
    
    // 만약 드래그하는 품목이 이미 다중 선택된 상태라면, 선택된 모든 품목의 ID 리스트를 JSON으로 실어서 전달
    const dragIds = selectedItemIds.includes(itemId)
      ? selectedItemIds
      : [itemId];

    e.dataTransfer.setData('application/json', JSON.stringify(dragIds));
    e.dataTransfer.setData('text/plain', itemId); // fallback 하위 호환
  };

  const handleDragEnd = () => {
    setDraggingItemId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // drop 이벤트를 받기 위해 필수
  };

  const handleDrop = (e: React.DragEvent, supplierId: string) => {
    e.preventDefault();
    try {
      const jsonStr = e.dataTransfer.getData('application/json');
      if (jsonStr) {
        const dragIds = JSON.parse(jsonStr) as string[];
        if (Array.isArray(dragIds) && dragIds.length > 0) {
          setAssignments(prev => {
            const next = { ...prev };
            dragIds.forEach(id => {
              next[id] = supplierId;
            });
            return next;
          });
          // 드롭이 완료된 품목들의 다중선택 해제
          setSelectedItemIds(prev => prev.filter(id => !dragIds.includes(id)));
          setDraggingItemId(null);
          return;
        }
      }
    } catch (err) {
      console.error('Failed to parse multiple DND item IDs', err);
    }

    // Fallback: 단일 품목 드롭 처리
    const itemId = e.dataTransfer.getData('text/plain') || draggingItemId;
    if (itemId) {
      setAssignments(prev => ({
        ...prev,
        [itemId]: supplierId
      }));
      setSelectedItemIds(prev => prev.filter(id => id !== itemId));
    }
    setDraggingItemId(null);
  };

  // 전체 되돌리기 (할당 초기화) 핸들러
  const handleResetAll = () => {
    if (!currentOrder) return;
    if (window.confirm('현재 주문서의 모든 분할 및 할당 내역을 초기화하고 원본 상태로 되돌리시겠습니까?')) {
      setAssignments({});
      setSelectedItemIds([]);
      setLocalItems(currentOrder.items || []);
    }
  };

  // 모든 발주 전송 상태를 발송 전(poSent: false)으로 리셋하는 핸들러 (테스트 편의성 제공)
  const handleResetPoSentStatus = async () => {
    if (!currentOrder || !currentOrder.splitDeliveries || currentOrder.splitDeliveries.length === 0) {
      alert('현재 주문서에 발송된 매입처 내역이 없습니다.');
      return;
    }
    if (!window.confirm('현재 주문서의 모든 매입처 발주 상태를 [발송 전]으로 강제 리셋하시겠습니까?\n(발주 완료 버튼이 다시 초록색 작성/송부 단추로 돌아갑니다.)')) {
      return;
    }

    const resetSplitDeliveries = currentOrder.splitDeliveries.map(d => ({
      ...d,
      poSent: false
    }));

    try {
      await updateOrder(currentOrder.id, {
        splitDeliveries: resetSplitDeliveries
      });
      alert('모든 매입처의 발주 상태가 [발송 전]으로 성공적으로 초기화되었습니다.');
    } catch (err) {
      console.error(err);
      alert('초기화 중 오류가 발생했습니다.');
    }
  };

  // 품목 수량 분할 핸들러
  const handleSplitLineItem = (item: SplitLineItem) => {
    const origId = item.parentId || item.id;
    
    if (item.quantity <= 1) {
      alert('더 이상 분할할 수 없습니다. (최소 수량: 1개)');
      return;
    }

    const splitQtyStr = prompt(`현재 항목의 수량은 ${item.quantity}개입니다. 몇 개를 떼어내어 새 항목으로 만드시겠습니까?`, '1');
    if (splitQtyStr === null) return; // 취소

    const splitQty = parseInt(splitQtyStr, 10);
    if (isNaN(splitQty) || splitQty <= 0 || splitQty >= item.quantity) {
      alert(`유효하지 않은 수량입니다. 1개 이상, ${item.quantity - 1}개 이하로 입력해주세요.`);
      return;
    }

    // 1. 기존 품목 수량 깎기
    setLocalItems(prev => prev.map(it => {
      if (it.id === item.id) {
        return { ...it, quantity: it.quantity - splitQty };
      }
      return it;
    }));

    // 2. 새 분할 품목 추가
    const newSplitItem: SplitLineItem = {
      ...item,
      id: `${origId}_split_${Date.now()}`,
      parentId: origId,
      isSplit: true,
      quantity: splitQty
    };

    setLocalItems(prev => [...prev, newSplitItem]);
  };

  // 분할된 가상 품목 삭제 및 수량 복원 핸들러
  const handleRemoveSplitItem = (item: SplitLineItem) => {
    if (!item.isSplit || !item.parentId) return;

    setLocalItems(prev => {
      let foundOriginal = false;
      const updated = prev.map(it => {
        if (it.id === item.parentId) {
          foundOriginal = true;
          return { ...it, quantity: it.quantity + item.quantity };
        }
        return it;
      });

      if (!foundOriginal) {
        const related = updated.find(it => it.parentId === item.parentId || it.id === item.parentId);
        if (related) {
          related.quantity += item.quantity;
        }
      }

      return updated.filter(it => it.id !== item.id);
    });

    // 관련 상태 삭제
    setAssignments(prev => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    setSelectedItemIds(prev => prev.filter(id => id !== item.id));
  };

  // 수량 직접 입력 변경 핸들러
  const handleQuantityChange = (itemId: string, newQty: number) => {
    if (newQty < 0) return;
    setLocalItems(prev => prev.map(it => {
      if (it.id === itemId) {
        return { ...it, quantity: newQty };
      }
      return it;
    }));
  };



  // 다중 선택 개별 토글 핸들러
  const handleToggleSelectItem = (itemId: string) => {
    setSelectedItemIds(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  // 다중 선택 전체 토글 핸들러
  const handleToggleAllUnassigned = () => {
    if (selectedItemIds.length === unassignedItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(unassignedItems.map(item => item.id));
    }
  };

  // 5. 발주서 생성 미리보기 모달 데이터
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // 원본 품목별 원래 주문 수량 매핑
  const originalQuantities = useMemo(() => {
    if (!currentOrder) return {};
    const map: Record<string, number> = {};
    (currentOrder.items || []).forEach(item => {
      map[item.id] = item.quantity;
    });
    return map;
  }, [currentOrder]);

  // 현재 쪼개진 품목들의 원래 ID 기준 수량 합계
  const currentSplitSums = useMemo(() => {
    const map: Record<string, number> = {};
    if (currentOrder) {
      (currentOrder.items || []).forEach(item => {
        map[item.id] = 0;
      });
      localItems.forEach(item => {
        const origId = item.parentId || item.id;
        if (map[origId] !== undefined) {
          map[origId] += item.quantity;
        } else {
          map[origId] = item.quantity;
        }
      });
    }
    return map;
  }, [localItems, currentOrder]);

  // 수량 불일치 품목 목록
  const quantityMismatches = useMemo(() => {
    const mismatches: { itemId: string; name: string; original: number; current: number }[] = [];
    if (!currentOrder) return mismatches;

    (currentOrder.items || []).forEach(item => {
      const origQty = originalQuantities[item.id] || 0;
      const curQty = currentSplitSums[item.id] || 0;
      if (origQty !== curQty) {
        mismatches.push({
          itemId: item.id,
          name: [item.name, item.thickness, item.size, item.material].filter(Boolean).join('-'),
          original: origQty,
          current: curQty
        });
      }
    });
    return mismatches;
  }, [originalQuantities, currentSplitSums, currentOrder]);

  // 미지정(Unassigned) 상태의 아이템 목록 (좌측 대기 리스트용)
  const unassignedItems = useMemo(() => {
    if (!currentOrder) return [];
    const items = localItems || [];
    return items.filter(item => !assignments[item.id]);
  }, [localItems, assignments, currentOrder]);

  // 공급사별 할당된 아이템 집계 및 매입가 계산
  const supplierAggregations = useMemo(() => {
    if (!currentOrder) return {};

    const items = localItems || [];
    const result: Record<string, { items: LineItem[]; totalAmount: number }> = {};

    suppliers.forEach(s => {
      result[s.id] = { items: [], totalAmount: 0 };
    });

    items.forEach(item => {
      const supplierId = assignments[item.id];
      if (!supplierId) return; // 미지정 품목은 공급사 집계에서 제외
      if (!result[supplierId]) {
        result[supplierId] = { items: [], totalAmount: 0 };
      }

      // 공급처 정보 및 품목 인벤토리 조인으로 매입단가 계산
      const supplier = suppliers.find(s => s.id === supplierId);
      const product = findProduct(item);
      const basePrice = product?.base_price ?? item.base_price ?? product?.unitPrice ?? item.unitPrice ?? 0;
      
      // 우선순위: 품목 지정 요율 > 지정 공급처 기본 매입요율 > 인벤토리 요율 > 매출 할인율 > 기본 72%
      const rate = item.supplierRate ?? supplier?.default_rate ?? product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? item.discountRate ?? 72;
      
      let supplierPrice = item.supplierPriceOverride;
      if (supplierPrice === undefined) {
        supplierPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
      }

      const totalItemAmount = supplierPrice * item.quantity;

      // 원본 매출 발주의 금액 정합성 매핑
      const origItem = (currentOrder.items || []).find(oi => oi.id === (item.parentId || item.id));
      const origUnitPrice = origItem ? origItem.unitPrice : item.unitPrice;
      const origBasePrice = origItem ? (origItem.base_price ?? origItem.unitPrice) : (item.base_price ?? item.unitPrice);
      const origDiscountRate = origItem ? origItem.discountRate : item.discountRate;

      const hasManualOverride = item.supplierPriceOverride !== undefined;
      result[supplierId].items.push({
        ...item,
        unitPrice: origUnitPrice, // 최종 판매가 보존 (매출)
        base_price: origBasePrice, // 기준단가 보존 (매출)
        discountRate: origDiscountRate, // 매출 할인율 보존
        amount: origUnitPrice * item.quantity, // 매출 총합 보존
        supplierRate: rate, // 매입 요율 정보 명시
        supplierPriceOverride: hasManualOverride ? item.supplierPriceOverride : undefined // 수동 단가 수정 시에만 고정단가 락 적용
      });
      result[supplierId].totalAmount += totalItemAmount;
    });

    return result;
  }, [currentOrder, localItems, assignments, suppliers, findProduct]);

  // 제조회사 노출 토글 핸들러
  const handleToggleSupplierActive = (supplierId: string) => {
    if (supplierId === 'daekyung') return; // 대경벤드는 토글 불가

    const isActive = activeSupplierIds.includes(supplierId);

    if (isActive) {
      // 끄는 경우: 할당된 아이템이 있는지 확인
      const agg = supplierAggregations[supplierId];
      if (agg && agg.items.length > 0) {
        if (!window.confirm(`'${suppliers.find(s => s.id === supplierId)?.company_name}' 카드에 이미 할당된 품목(${agg.items.length}건)이 있습니다.\n카드를 제외하면 할당된 품목들은 모두 '미지정'으로 되돌아갑니다. 제외하시겠습니까?`)) {
          return;
        }
        // 할당 해제
        setAssignments(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(itemId => {
            if (next[itemId] === supplierId) {
              delete next[itemId];
            }
          });
          return next;
        });
      }
      setActiveSupplierIds(prev => prev.filter(id => id !== supplierId));
    } else {
      // 켜는 경우
      setActiveSupplierIds(prev => [...prev, supplierId]);
    }
  };

  // 개별 공급사 발주서 PDF 미리보기 빌드
  const handlePreviewPO = (supplier: Supplier) => {
    if (!currentOrder) return;

    if (quantityMismatches.length > 0) {
      alert(`수량이 맞지 않는 품목이 있습니다. 원래 주문 수량과 동일하게 맞춘 후 진행해주세요.\n\n${quantityMismatches.map(m => `- ${m.name}: 원래 ${m.original}개이나 현재 분할 합계 ${m.current}개`).join('\n')}`);
      return;
    }

    const agg = supplierAggregations[supplier.id];
    if (!agg || agg.items.length === 0) {
      alert('할당된 발주 품목이 없습니다.');
      return;
    }

    const showEndCustomer = supplier.id === 'daekyung' ? true : !!printEndCustomerOptions[supplier.id];

    // 문서 템플릿용 페이로드 구성
    const docPayload: DocumentPayload = {
      document_type: 'PURCHASE_ORDER',
      meta: {
        doc_no: `${currentOrder.poNumber || 'ES-PILOT'}-${supplier.company_name.replace('(주)', '').trim()}`,
        created_at: new Date().toISOString(),
        channel: 'WEB',
        title: `[알트에프 파일럿] ${supplier.company_name} 발주서`,
        end_customer: currentOrder.poEndCustomer || currentOrder.customerName,
        hide_end_customer: !showEndCustomer
      },
      supplier: {
        company_name: supplier.company_name,
        contact_name: supplier.contact_name,
        tel: supplier.tel,
        email: supplier.email,
        address: supplier.address,
        note: (currentOrder.supplierInfo?.note && currentOrder.supplierInfo.note.trim()) ? currentOrder.supplierInfo.note : (supplier.note || '')
      },
      customer: {
        company_name: '알트에프 (파일럿 분할발주)',
        contact_name: '파일럿 테스터',
        tel: '051-303-3751',
        email: 'altf@altf.kr',
        address: '부산시 사상구 낙동대로1330번길 67'
      },
      items: agg.items.map((item, idx) => ({
        no: idx + 1,
        item_name: item.name || '',
        thickness: item.thickness || '',
        size: item.size || '',
        material: item.material || '',
        spec: `${item.thickness || ''} ${item.size || ''} ${item.material || ''}`.trim(),
        qty: item.quantity,
        unit_price: item.unitPrice,
        amount: agg.items[idx].amount || (item.unitPrice * item.quantity),
        note: item.note || ''
      })),
      totals: {
        total_amount: agg.totalAmount,
        currency: 'KRW',
        vat_amount: Math.round(agg.totalAmount * 0.1),
        final_amount: Math.round(agg.totalAmount * 1.1)
      }
    };

    const html = renderDocumentHTML(docPayload);
    setPreviewHtml(html);
    setPreviewModalOpen(true);
  };

  // 개별 공급사에게 분할 발주서 이메일 전송 (Webhook 송신)
  const handleSendEmailWebhook = async (supplier: Supplier, deliveryInfo?: SplitDelivery) => {
    if (!currentOrder) return;

    if (quantityMismatches.length > 0) {
      alert(`수량이 맞지 않는 품목이 있습니다. 원래 주문 수량과 동일하게 맞춘 후 진행해주세요.\n\n${quantityMismatches.map(m => `- ${m.name}: 원래 ${m.original}개이나 현재 분할 합계 ${m.current}개`).join('\n')}`);
      return;
    }

    const targetItems = deliveryInfo ? deliveryInfo.items : supplierAggregations[supplier.id]?.items;
    if (!targetItems || targetItems.length === 0) {
      alert('할당된 발주 품목이 없습니다.');
      return;
    }

    const targetEmail = supplier.email || "dksales@daekyungbend.com";
    const confirmMsg = `[분할 발주서 이메일 전송]\n\n수신처: ${supplier.company_name} (${targetEmail})\n\n이대로 분할 발주서 메일 발송 신호를 전송하시겠습니까?`;
    if (!window.confirm(confirmMsg)) return;

    setEmailSendingStatus(prev => ({ ...prev, [supplier.id]: true }));

    try {
      const parentPoNo = (currentOrder.poNumber || '').trim() || 'ES-PILOT';
      // 대경벤드는 무조건 본래 번호, 그 외는 대경벤드를 제외한 활성 공급사들의 순서대로 1, 2, 3...
      const finalPoNumber = (() => {
        if (deliveryInfo?.poNumber) {
          return deliveryInfo.poNumber.trim();
        }
        if (supplier.id === 'daekyung') {
          return parentPoNo;
        }
        const activeSuppliers = suppliers.filter(sup => {
          const a = supplierAggregations[sup.id];
          return a && a.items.length > 0;
        });
        const nonDaekyungSuppliers = activeSuppliers.filter(sup => sup.id !== 'daekyung');
        const nonDaekyungIdx = nonDaekyungSuppliers.findIndex(sup => sup.id === supplier.id);
        if (nonDaekyungIdx !== -1) {
          return `${parentPoNo}-${nonDaekyungIdx + 1}`;
        }
        return parentPoNo;
      })().trim();
      const docTitle = deliveryInfo?.poTitle || `[분할발주] ${supplier.company_name} - ${finalPoNumber}`;
      const totalAmount = deliveryInfo ? deliveryInfo.totalAmount : (supplierAggregations[supplier.id]?.totalAmount || 0);

      const showEndCustomer = supplier.id === 'daekyung' ? true : !!printEndCustomerOptions[supplier.id];

      // 문서 템플릿용 페이로드 구성
      const docPayload: DocumentPayload = {
        document_type: 'PURCHASE_ORDER',
        meta: {
          doc_no: finalPoNumber,
          created_at: new Date().toISOString(),
          channel: 'WEB',
          title: docTitle,
          end_customer: currentOrder.poEndCustomer || currentOrder.customerName,
          hide_end_customer: !showEndCustomer
        },
        supplier: {
          company_name: supplier.company_name,
          contact_name: supplier.contact_name,
          tel: supplier.tel,
          email: supplier.email,
          address: supplier.address,
          note: (currentOrder.supplierInfo?.note && currentOrder.supplierInfo.note.trim()) ? currentOrder.supplierInfo.note : (supplier.note || '')
        },
        customer: {
          company_name: '알트에프 (파일럿 분할발주)',
          contact_name: user?.contactName || '파일럿 관리자',
          tel: '051-303-3751',
          email: 'altf@altf.kr',
          address: '부산시 사상구 낙동대로1330번길 67'
        },
        items: targetItems.map((item, idx) => ({
          no: idx + 1,
          item_name: item.name || '',
          thickness: item.thickness || '',
          size: item.size || '',
          material: item.material || '',
          spec: `${item.thickness || ''} ${item.size || ''} ${item.material || ''}`.trim(),
          qty: item.quantity,
          unit_price: item.unitPrice || 0,
          amount: item.amount || ((item.unitPrice || 0) * item.quantity),
          note: item.note || ''
        })),
        totals: {
          total_amount: totalAmount,
          currency: 'KRW',
          vat_amount: Math.round(totalAmount * 0.1),
          final_amount: Math.round(totalAmount * 1.1)
        }
      };

      const htmlContent = renderDocumentHTML(docPayload);

      // Webhook Payload 조립
      const webhookPayload = {
        event: "purchase_order_sent",
        data: {
          orderId: `${currentOrder.id}-sub-${supplier.id}`,
          parentOrderId: currentOrder.id,
          isSplitPoSubOrder: true,
          supplier: {
            company_name: supplier.company_name,
            contact_name: supplier.contact_name,
            tel: supplier.tel,
            email: targetEmail
          },
          buyer: {
            company_name: currentOrder.buyerInfo?.company_name || '알트에프',
            contact_name: currentOrder.buyerInfo?.contact_name || user?.contactName || '조현진 대표',
            tel: currentOrder.buyerInfo?.tel || user?.phone || '051-303-3751',
            email: currentOrder.buyerInfo?.email || user?.email || 'altf@altf.kr',
            address: currentOrder.buyerInfo?.address || user?.address || '부산시 사상구 낙동대로1330번길 67'
          },
          shipping: { memo: currentOrder.memo || '' },
          email: {
            from: "ALTF@ALTF.KR",
            bcc: "AIRSPACE@ALTF.KR",
            to: targetEmail,
            subject: `[매입발주] ALTF -> ${supplier.company_name} (PO: ${finalPoNumber})`,
            attachmentName: `${finalPoNumber}_${supplier.company_name.replace('(주)', '').trim()}.html`
          },
          htmlContent: htmlContent,
          attachmentUrl: null,
          attachmentBase64: null,
          attachmentMimeType: "text/html"
        }
      };

      // Webhook 전송
      const response = await fetch("https://hook.us2.make.com/hyb2pdm95pae17a8f96sqyexj82lyhnw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload)
      });

      if (response.ok || response.type === 'opaque') {
        alert(`${supplier.company_name}향 분할 발주서 이메일 전송이 완료되었습니다.`);
        
        // 부모의 splitDeliveries 상태에 전송 완료 결과 반영
        await handleSubOrderUpdate(`${currentOrder.id}-sub-${supplier.id}`, {
          poSent: true,
          status: 'SHIPPED',
          poNumber: finalPoNumber,
          totalAmount: totalAmount,
          po_items: targetItems.map(item => ({
            ...item,
            poSent: true,
            vendorName: supplier.company_name
          }))
        });
      } else {
        throw new Error("웹훅 호출 실패: " + response.statusText);
      }
    } catch (err) {
      console.error("이메일 웹훅 발송 실패:", err);
      alert("이메일 전송 중 오류가 발생했습니다.");
    } finally {
      setEmailSendingStatus(prev => ({ ...prev, [supplier.id]: false }));
    }
  };

  // === CRM 데이터 최종 반영 및 저장 ===
  const handleSaveToCRM = async () => {
    if (!currentOrder) return;

    if (quantityMismatches.length > 0) {
      alert(`수량이 맞지 않는 품목이 있습니다. 원래 주문 수량과 동일하게 맞춘 후 진행해주세요.\n\n${quantityMismatches.map(m => `- ${m.name}: 원래 ${m.original}개이나 현재 분할 합계 ${m.current}개`).join('\n')}`);
      return;
    }

    const hasAnyAssignment = Object.values(assignments).some(v => !!v);
    if (!hasAnyAssignment) {
      alert('할당된 공급처가 없습니다. 최소 한 개 품목 이상 공급처를 지정해 주세요.');
      return;
    }

    if (!window.confirm('아이템별 분할 발주를 최종 저장하시겠습니까?')) {
      return;
    }

    // 부모 주문 번호가 없거나 기본 플레이스홀더인 경우 신규 발급
    let parentPoNo = currentOrder.poNumber;
    let parentPoUpdated = false;
    if (!parentPoNo || parentPoNo === 'ES-PILOT' || parentPoNo.trim() === '') {
      parentPoNo = generateParentPoNumber();
      parentPoUpdated = true;
      console.log("[SplitPO] Auto-generating parent poNumber for CRM sync:", parentPoNo);
    }

    // SplitDelivery Payload 빌드
    const activeSuppliersWithItems = suppliers.filter(s => {
      const agg = supplierAggregations[s.id];
      return agg && agg.items.length > 0;
    });

    const parentNote = currentOrder.supplierInfo?.note;

    const splitDeliveries: SplitDelivery[] = activeSuppliersWithItems.map((s) => {
      const agg = supplierAggregations[s.id];
      const effectiveNote = (parentNote && parentNote.trim()) ? parentNote : (s.note || '');
      const supplierWithNote = {
        ...s,
        note: effectiveNote
      };

      // 매출금액(salesAmount) 계산: 원래 수주 단가 * 분할 수량
      const salesAmount = agg.items.reduce((acc, item) => {
        const origItem = currentOrder.items.find(oi => oi.id === (((item as SplitLineItem).parentId) || item.id));
        const salesPrice = origItem?.unitPrice || 0;
        return acc + (salesPrice * item.quantity);
      }, 0);

      // 대경벤드는 무조건 본래 번호, 그 외는 대경벤드를 제외한 활성 공급사들의 순서대로 1, 2, 3...
      const finalPoNumber = (() => {
        if (s.id === 'daekyung') {
          return parentPoNo;
        }
        const nonDaekyungSuppliers = activeSuppliersWithItems.filter(sup => sup.id !== 'daekyung');
        const nonDaekyungIdx = nonDaekyungSuppliers.findIndex(sup => sup.id === s.id);
        if (nonDaekyungIdx !== -1) {
          return `${parentPoNo}-${nonDaekyungIdx + 1}`;
        }
        return parentPoNo;
      })().trim();

      const poItems = agg.items.map(item => {
        const product = findProduct(item);
        const defaultRate = item.supplierRate ?? s.default_rate ?? product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? item.discountRate ?? 72;
        return {
          ...item,
          supplierRate: defaultRate,
          transactionIssued: false
        };
      });

      return {
        supplier: supplierWithNote,
        items: agg.items,
        po_items: poItems, // 매입 품목도 최초 저장 시점에 명시적으로 보존!
        totalAmount: agg.totalAmount, // 매입 합계
        salesAmount: salesAmount, // 매출 합계
        poSent: false,
        poNumber: finalPoNumber,
        poTitle: `[분할발주] ${s.company_name} - ${finalPoNumber}`,
        status: 'PENDING',
        sentAt: new Date().toISOString()
      };
    });

    try {
      // 1. 부모 주문서에 분할 내역 저장 (발주 번호가 새로 구성되었으면 함께 저장)
      const parentUpdates: Partial<Order> = {
        splitDeliveries: splitDeliveries
      };
      if (parentPoUpdated) {
        parentUpdates.poNumber = parentPoNo;
      }
      await updateOrder(currentOrder.id, parentUpdates);

      // 3. 상태 리로드를 위해 CRM 실시간 주문 연동 다시 수행
      const token = useStore.getState().auth.token;
      const requesterHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-requester-id': user?.id || '',
        'x-requester-role': user?.role || ''
      };
      const endpoint = `${import.meta.env.VITE_API_URL || ''}/api/my/orders?limit=2000`;
      const refreshRes = await fetch(endpoint, { headers: requesterHeaders, cache: 'no-store' });
      if (refreshRes.ok) {
        const freshOrders = await refreshRes.json();
        if (Array.isArray(freshOrders)) {
          setOrders(freshOrders);
        }
      }

      alert("분할 배치 내역이 안전하게 저장되었습니다.");
    } catch (e) {
      console.error(e);
      alert("서버 저장 도중 문제가 발생했습니다. 관리자에게 문의하세요.");
    }
  };

  // 모달 안에서 발주서 수정/전송 완료 시, 부모의 splitDeliveries 상태에 하위 매입 발주 상세 내역을 동기화하여 저장하는 함수 (하위 주문서 신규 생성 금지)
  const handleSubOrderUpdate = async (orderId: string, updates: Partial<Order>) => {
    if (!currentOrder) return;

    // 하위 매입처 ID 추출
    const supplierId = orderId.split('-sub-')[2] || orderId.split('-sub-')[1];
    if (!supplierId || !currentOrder.splitDeliveries) return;

    const isSent = updates.poSent || updates.status === 'SHIPPED' || updates.status === 'COMPLETED';

    // 부모 주문의 splitDeliveries 내부 정보 동적 업데이트
    const nextSplitDeliveries = currentOrder.splitDeliveries.map(d => {
      if (d.supplier.id === supplierId) {
        const nextSupplier = updates.supplierInfo ? {
          ...d.supplier,
          ...updates.supplierInfo
        } : d.supplier;

        return {
          ...d,
          supplier: nextSupplier,
          poSent: isSent,
          poNumber: updates.poNumber || d.poNumber,
          totalAmount: updates.totalAmount !== undefined ? updates.totalAmount : d.totalAmount, // 모달에서 확정된 실제 매입액 반영
          // 사용자가 매입 품목 명칭/수량/단가를 오버라이드한 경우를 대비해 갱신된 items 및 po_items 병합 상속
          items: updates.items || d.items,
          po_items: updates.po_items || d.po_items,
          sentAt: isSent ? (d.sentAt || new Date().toISOString()) : d.sentAt
        };
      }
      return d;
    });

    console.log("[SplitPO] Syncing sub-order updates back to parent splitDeliveries without creating sub-order rows:", supplierId);

    const updatedNote = updates.supplierInfo?.note;
    const parentUpdates: Partial<Order> = {
      splitDeliveries: nextSplitDeliveries
    };

    if (updatedNote !== undefined) {
      // 자식 매입발주서 상세조정에서 Note가 수정되었을 때 부모 및 다른 자식의 note도 양방향 연동
      parentUpdates.supplierInfo = {
        ...(currentOrder.supplierInfo || {
          company_name: '(주)대경벤드',
          contact_name: '정호근 과장',
          tel: '055-364-1800',
          email: 'dksales@daekyungbend.com',
          address: '경상남도 양산시 어실로 115'
        }),
        note: updatedNote
      };
      parentUpdates.splitDeliveries = nextSplitDeliveries.map(d => ({
        ...d,
        supplier: {
          ...d.supplier,
          note: updatedNote
        }
      }));
    }

    // 1. 부모 주문 데이터베이스에 반영
    await updateOrder(currentOrder.id, parentUpdates);

    // 2. 부모 컴포넌트의 로컬 localItems 상태에도 수정된 요율과 단가 덮어씌워 갱신하기 (DND 보드와 상세조정 모달 동기화)
    if (updates.po_items) {
      setLocalItems(prevItems => {
        return prevItems.map(item => {
          if (assignments[item.id] === supplierId) {
            const matchedPoItem = updates.po_items?.find(pi => (pi.parentId || pi.id) === (item.parentId || item.id));
            if (matchedPoItem) {
              return {
                ...item,
                supplierRate: matchedPoItem.supplierRate ?? item.supplierRate,
                supplierPriceOverride: matchedPoItem.supplierPriceOverride !== undefined ? matchedPoItem.supplierPriceOverride : item.supplierPriceOverride
              };
            }
          }
          return item;
        });
      });
    }

    // 3. 만약 모달이 계속 열려 있다면, 모달에 전달되는 selectedOrderDetailOrder 상태도 동기화하여 덮어쓰기
    setSelectedOrderDetailOrder(prev => {
      if (!prev) return null;
      return {
        ...prev,
        poSent: isSent,
        poNumber: updates.poNumber || prev.poNumber,
        status: isSent ? 'SHIPPED' : prev.status,
        items: updates.items || prev.items,
        po_items: updates.po_items || prev.po_items,
      } as unknown as Order;
    });
  };

  /* [숨김 처리] handleExportConsole 미사용으로 인한 주석 처리
  const handleExportConsole = () => {
    if (!currentOrder) return;

    if (quantityMismatches.length > 0) {
      alert(`수량이 맞지 않는 품목이 있습니다. 원래 주문 수량과 동일하게 맞춘 후 진행해주세요.\n\n${quantityMismatches.map(m => `- ${m.name}: 원래 {m.original}개이나 현재 분할 합계 {m.current}개`).join('\n')}`);
      return;
    }
    
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
  */

  return (
    <div className="flex-1 bg-slate-50 text-slate-800 p-6 min-h-screen overflow-auto">
      {/* 뒤로가기 / 헤더 */}
      <div className="max-w-[1500px] mx-auto space-y-6">
        
        {/* 상단 헤더 영역 - 세련된 화이트 카드 */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl border border-teal-100 shadow-inner">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
                주문접수 - 분할 매입 발주 관리
                <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-bold">
                  {isLocal ? 'LOCAL DEVELOPMENT' : 'PILOT BETA'}
                </span>
              </h1>
              <p className="text-slate-500 text-xs mt-0.5">
                대경벤드 품절 제품 및 수주 목록을 여러 매입처로 분할하여 발주를 진행하며, 개별 매입 발주서들을 확정합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* 주문관리 바로가기 버튼 */}
            <Button
              onClick={() => navigate('/admin/orders')}
              className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 flex items-center gap-1.5 font-bold py-2.5 px-3.5 rounded-xl text-xs shadow-sm"
              title="주문관리 화면으로 돌아가기"
            >
              <span>📋 주문관리 바로가기</span>
            </Button>

            {/* 주문 선택 드롭다운 */}
            <select
              value={selectedOrderId}
              onChange={(e) => setSearchParams({ orderId: e.target.value })}
              className="bg-white border border-slate-300 text-slate-700 text-xs rounded-xl px-3.5 py-2.5 focus:border-teal-500 focus:outline-none min-w-[280px] shadow-sm font-bold"
            >
              <option value="">-- 분할 발주할 주문서 선택 --</option>
              {selectableOrders.map(o => (
                <option key={o.id} value={o.id}>
                  {o.poNumber || '번호없음'} | {o.customerName} ({o.items?.length || 0}개 품목)
                </option>
              ))}
            </select>

            {currentOrder && (
              <>
                {/* 전체 초기화 버튼 */}
                <Button
                  variant="outline"
                  onClick={handleResetAll}
                  className="border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900 flex items-center gap-1.5 font-bold py-2.5 px-3 rounded-xl text-xs"
                  title="할당 내역 전체 초기화"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>할당 초기화</span>
                </Button>

                {/* 발송 상태 리셋 버튼 */}
                <Button
                  variant="outline"
                  onClick={handleResetPoSentStatus}
                  className="border-amber-300 text-amber-600 hover:bg-amber-50 flex items-center gap-1.5 font-bold py-2.5 px-3 rounded-xl text-xs"
                  title="모든 공급사 발송 전으로 리셋"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>발송 상태 리셋</span>
                </Button>

                {/* 최종 데이터 콘솔 출력 버튼 (디버그용) - 숨김 처리
                <Button
                  variant="outline"
                  onClick={handleExportConsole}
                  className="border-indigo-300 text-indigo-600 hover:bg-indigo-50 flex items-center gap-1.5 font-bold py-2.5 px-3 rounded-xl text-xs"
                  title="최종 분할 발주 JSON 데이터 콘솔 출력"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>콘솔 출력</span>
                </Button>
                */}

                {/* 분할 내역 저장 버튼 */}
                <Button
                  onClick={handleSaveToCRM}
                  className="bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5 font-bold py-2.5 px-4 rounded-xl text-xs shadow-sm shadow-teal-600/10"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>분할 저장 & 반영</span>
                </Button>
              </>
            )}

          </div>
        </div>

        {/* 수량 오류 얼럿 */}
        {quantityMismatches.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 text-red-700 shadow-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
            <div className="text-xs space-y-1">
              <p className="font-extrabold text-sm text-red-800">⚠️ 발주 품목 수량 불일치 감지</p>
              <p className="text-red-600">일부 품목의 분할 수량 합계가 원래 수주서(주문서)의 수량과 일치하지 않습니다. 수량을 동일하게 맞춰야 CRM 반영이 가능합니다.</p>
              <ul className="list-disc list-inside mt-2 space-y-1 font-mono text-[11px] text-red-700 bg-red-100/50 p-2 rounded-lg border border-red-200">
                {quantityMismatches.map((m, idx) => (
                  <li key={idx}>
                    {m.name}: 원래 {m.original}개이나 현재 분할 합계 {m.current}개
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 1. 공급처 관리 섹션 - 세련된 화이트 보드 */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
            <h2 className="text-xs font-bold text-slate-500 tracking-wide uppercase flex items-center gap-2">
              <Building className="w-4 h-4 text-slate-400" />
              매입처/공급사 관리 ({suppliers.length}개 공급처 등록)
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsSuppliersFolded(!isSuppliersFolded)}
                className="text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors border border-slate-200 px-2 py-1 rounded"
              >
                {isSuppliersFolded ? '펼치기' : '접기'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextVal = !showAddSupplier;
                  setShowAddSupplier(nextVal);
                  if (nextVal) setIsSuppliersFolded(false);
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                신규 공급처 추가
              </button>
            </div>
          </div>

          {!isSuppliersFolded && (
            <>

          {showAddSupplier && (
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 mb-4 shadow-inner space-y-4 relative">
              {/* CRM 연동 검색기 */}
              <div className="relative border-b border-slate-200 pb-4">
                <label className="text-xs text-teal-700 font-extrabold mb-1.5 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  CRM 거래처 검색 (검색어 입력 후 자동 대입)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="업체명, 담당자명 또는 사업자번호로 검색해 보세요..."
                    value={crmSearchQuery}
                    onChange={(e) => {
                      setCrmSearchQuery(e.target.value);
                      setShowCrmDropdown(true);
                    }}
                    onFocus={() => setShowCrmDropdown(true)}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none shadow-sm"
                  />
                  {crmSearchQuery && (
                    <button
                      type="button"
                      onClick={() => { setCrmSearchQuery(''); setShowCrmDropdown(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-655 text-xs font-bold"
                    >
                      초기화
                    </button>
                  )}
                </div>

                {/* CRM 검색 결과 드롭다운 */}
                {showCrmDropdown && filteredCrmCustomers.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-auto divide-y divide-slate-100">
                    {filteredCrmCustomers.map(c => {
                      const name = c.companyName || c.company_name || '';
                      const contact = c.contactName || c.contact_name || '';
                      const cPhone = c.phone || c.tel || '';
                      const cAddress = c.address || '';
                      
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCrmCustomer(c)}
                          className="w-full text-left p-3 hover:bg-teal-50/50 transition-colors flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <p className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5">
                              {name}
                              {c.ceo && <span className="text-[10px] text-slate-400 font-normal">대표: {c.ceo}</span>}
                            </p>
                            <p className="text-[11px] text-slate-555 truncate mt-0.5" title={cAddress}>{cAddress || '주소 정보 없음'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-slate-700 font-bold">{contact || '담당자미정'}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{cPhone}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                
                {showCrmDropdown && crmSearchQuery && filteredCrmCustomers.length === 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-4 text-center text-slate-450 text-xs">
                    일치하는 CRM 거래처를 찾을 수 없습니다.
                  </div>
                )}
              </div>

              {/* 기존 수동 입력 및 최종 등록 폼 */}
              <form onSubmit={handleAddSupplier} className="gap-4 grid grid-cols-1 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 block font-bold">회사명 (필수)</label>
                  <input
                    type="text"
                    required
                    placeholder="예: 유성벤드"
                    value={newSupplier.company_name}
                    onChange={e => setNewSupplier(prev => ({ ...prev, company_name: e.target.value }))}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 block font-bold">담당자</label>
                  <input
                    type="text"
                    placeholder="예: 홍길동 대리"
                    value={newSupplier.contact_name}
                    onChange={e => setNewSupplier(prev => ({ ...prev, contact_name: e.target.value }))}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 block font-bold">연락처</label>
                  <input
                    type="text"
                    placeholder="예: 010-1234-5678"
                    value={newSupplier.tel}
                    onChange={e => setNewSupplier(prev => ({ ...prev, tel: e.target.value }))}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 block font-bold">이메일</label>
                  <input
                    type="email"
                    placeholder="example@mail.com"
                    value={newSupplier.email}
                    onChange={e => setNewSupplier(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 block font-bold">기본 매입 요율 (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="예: 45"
                    value={newSupplier.default_rate ?? 45}
                    onChange={e => setNewSupplier(prev => ({ ...prev, default_rate: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none font-semibold text-teal-700"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs text-slate-500 block font-bold">주소</label>
                  <input
                    type="text"
                    placeholder="회사 상세 주소"
                    value={newSupplier.address}
                    onChange={e => setNewSupplier(prev => ({ ...prev, address: e.target.value }))}
                    className="w-full bg-white border border-slate-350 rounded-lg p-2 text-sm text-slate-800 focus:border-teal-500 outline-none"
                  />
                </div>
                <div className="md:col-span-3 flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddSupplier(false);
                      setCrmSearchQuery('');
                      setShowCrmDropdown(false);
                    }}
                    className="border-slate-300 text-slate-500 hover:bg-slate-100 px-4 py-1.5 text-xs font-bold"
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-1.5 text-xs font-bold"
                  >
                    등록 완료
                  </Button>
                </div>
              </form>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {suppliers.map(s => (
              <div
                key={s.id}
                className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-2 min-w-[240px] relative group hover:border-slate-300 transition-colors shadow-sm"
              >
                {s.id !== 'daekyung' && (
                  <button
                    onClick={() => handleDeleteSupplier(s.id)}
                    className="absolute top-3 right-3 text-slate-400 hover:text-red-655 transition-colors opacity-0 group-hover:opacity-100"
                    title="공급사 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
                    {s.company_name}
                    {s.id === 'daekyung' && (
                      <span className="text-[9px] bg-teal-100 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded font-black">
                        DEFAULT
                      </span>
                    )}
                    <span className="text-[9px] bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                      매입 {s.default_rate ?? 45}%
                    </span>
                  </h3>
                  <p className="text-slate-500 text-xs mt-0.5 flex items-center gap-1">
                    <User className="w-3 h-3 text-slate-400" /> {s.contact_name || '-'}
                  </p>
                </div>
                <div className="text-[11px] text-slate-555 space-y-0.5 border-t border-slate-200 pt-2">
                  <p className="flex items-center gap-1"><Phone className="w-2.5 h-2.5 text-slate-400" /> {s.tel || '-'}</p>
                  <p className="flex items-center gap-1"><Mail className="w-2.5 h-2.5 text-slate-400" /> {s.email || '-'}</p>
                  <p className="truncate flex items-center gap-1" title={s.address}><MapPin className="w-2.5 h-2.5 text-slate-400" /> {s.address || '-'}</p>
                </div>
              </div>
            ))}
          </div>
          </>
          )}
        </div>

        {/* 2. 메인 워크스페이스 (DND 보드) */}
        {!currentOrder ? (
          <div className="text-center py-20 bg-white border border-dashed border-slate-300 rounded-3xl shadow-sm">
            <AlertTriangle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-extrabold text-slate-700">선택된 주문서가 없습니다</h3>
            <p className="text-slate-500 text-sm mt-1">
              상단의 드롭다운을 열어 분할 발주를 진행할 CRM 주문서를 로드해 주세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* 제조회사 카드 노출 필터 바 */}
            <div className="lg:col-span-12 bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-start gap-6 text-xs font-bold shadow-sm">
              <div className="flex items-center gap-2 shrink-0">
                <Building className="w-4 h-4 text-teal-655" />
                <span className="text-slate-700 text-sm font-black">노출할 제조사 보관함 선택:</span>
              </div>
              <div className="flex flex-wrap gap-4">
                {suppliers.map(s => (
                  <label key={s.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={activeSupplierIds.includes(s.id)}
                      disabled={s.id === 'daekyung'}
                      onChange={() => handleToggleSupplierActive(s.id)}
                      className="accent-teal-600 w-3.5 h-3.5 rounded border-slate-350"
                    />
                    <span className={s.id === 'daekyung' ? 'text-slate-400 font-extrabold' : 'text-slate-750 font-extrabold'}>
                      {s.company_name}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* 좌측: 발주 아이템 리스트 (DnD 소스) */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  {unassignedItems.length > 0 && (
                    <input
                      type="checkbox"
                      checked={unassignedItems.length > 0 && selectedItemIds.length === unassignedItems.length}
                      onChange={handleToggleAllUnassigned}
                      className="accent-teal-600 w-3.5 h-3.5 rounded border-slate-350 cursor-pointer"
                      title="전체 선택 / 해제"
                    />
                  )}
                  <h2 className="font-extrabold text-sm tracking-wide text-slate-800 uppercase">
                    미지정 품목 ({unassignedItems.length})
                  </h2>
                </div>
                {selectedItemIds.length > 0 && (
                  <span className="text-[10px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-bold">
                    {selectedItemIds.length}개 선택됨
                  </span>
                )}
              </div>

              <div className="space-y-2.5 max-h-[650px] overflow-auto pr-1">
                {unassignedItems.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50">
                    모든 품목의 매입처가 지정되었습니다.
                  </div>
                ) : (
                  unassignedItems.map(item => {
                    const product = findProduct(item);
                    const dkStock = product?.locationStock?.['대경'] || product?.locationStock?.['양산'] || 0;
                    const isDkOutOfStock = dkStock === 0;

                    const origId = item.parentId || item.id;
                    const hasMismatch = originalQuantities[origId] !== currentSplitSums[origId];

                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        onDragEnd={handleDragEnd}
                        onClick={(e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest('input[type="number"]') || target.closest('button')) {
                            return;
                          }
                          handleToggleSelectItem(item.id);
                        }}
                        className={`bg-white border transition-all rounded-xl p-2.5 hover:border-teal-500 hover:shadow-md flex items-center justify-between gap-3 relative ${
                          draggingItemId === item.id 
                            ? 'opacity-45 border-teal-300 bg-teal-50/20 shadow-inner' 
                            : hasMismatch
                              ? 'border-red-300 shadow-[0_0_8px_rgba(239,68,68,0.08)] bg-red-50/30'
                              : 'border-slate-200'
                        } ${selectedItemIds.includes(item.id) ? 'border-teal-500 bg-teal-50/5 shadow-[0_0_8px_rgba(20,184,166,0.06)]' : ''}`}
                      >
                        {/* 좌측: 드래그 핸들 & 체크박스 & 품목명 & 대경 재고 상태 */}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {/* 드래그 핸들용 아이콘 */}
                          <div className="text-slate-400 shrink-0 cursor-grab active:cursor-grabbing hover:text-teal-650" title="드래그하여 오른쪽 매입처 카드로 이동">
                            <GripVertical className="w-4 h-4" />
                          </div>

                          {/* 개별 선택 체크박스 */}
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(item.id)}
                            readOnly
                            className="accent-teal-600 w-3.5 h-3.5 rounded border-slate-350 shrink-0 pointer-events-none"
                          />

                          <div className="min-w-0 flex-1">
                            <h4 className="font-semibold text-slate-700 text-xs leading-normal truncate min-w-0" title={[item.name, item.thickness, item.size, item.material].filter(Boolean).join('-')}>
                              {[item.name, item.thickness, item.size, item.material].filter(Boolean).join('-')}
                            </h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {isDkOutOfStock ? (
                                <span className="text-[8px] bg-red-50 text-red-650 border border-red-100 px-1 py-0.5 rounded font-bold shrink-0">
                                  대경품절
                                </span>
                              ) : (
                                <span className="text-[8px] bg-teal-50 text-teal-700 border border-teal-100 px-1 py-0.5 rounded font-bold shrink-0">
                                  대경재고 {dkStock}개
                                </span>
                              )}
                              {hasMismatch && (
                                <span className="text-[8px] text-red-655 bg-red-50 border border-red-200 px-1 py-0.5 rounded font-black shrink-0">
                                  수량오류 ({currentSplitSums[origId]}/{originalQuantities[origId]})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 우측: 수량 조절 및 분할 제어 */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* 수량 조절 */}
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              min="0"
                              value={item.quantity}
                              onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value, 10) || 0)}
                              className="w-10 px-1 py-0.5 text-right bg-slate-50 border border-slate-300 rounded font-mono font-bold text-slate-700 text-[10px] focus:ring-1 focus:ring-teal-500 outline-none"
                            />
                            <span className="text-slate-450 text-[10px] font-bold">개</span>
                          </div>
                          
                          {/* 분할 제어 */}
                          {!item.isSplit ? (
                            <button
                              onClick={() => handleSplitLineItem(item)}
                              disabled={item.quantity <= 1}
                              className="px-1.5 py-0.5 text-[9px] bg-slate-50 hover:bg-slate-100 text-slate-655 rounded border border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                              title="수량 분할"
                            >
                              분할
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRemoveSplitItem(item)}
                              className="p-1 text-slate-400 hover:text-red-655 hover:bg-slate-100 rounded transition-colors"
                              title="분할 품목 삭제 (수량 원본 반환)"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 우측: 공급처별 드롭 보관함 (DnD 타겟) */}
            <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              {suppliers.filter(s => activeSupplierIds.includes(s.id)).map(s => {
                const agg = supplierAggregations[s.id] || { items: [], totalAmount: 0 };
                const isOver = draggingItemId && assignments[draggingItemId] !== s.id;
                const deliveryInfo = currentOrder?.splitDeliveries?.find(d => d.supplier.id === s.id);

                // 예상/실제 발주 번호 계산
                const parentPoNo = (currentOrder?.poNumber || '').trim() || 'ES-PILOT';
                const finalPoNumber = agg.items.length > 0
                  ? (() => {
                      if (deliveryInfo?.poNumber) {
                        return deliveryInfo.poNumber.trim();
                      }
                      if (s.id === 'daekyung') {
                        return parentPoNo;
                      }
                      const activeSuppliers = suppliers.filter(sup => {
                        const a = supplierAggregations[sup.id];
                        return a && a.items.length > 0;
                      });
                      const nonDaekyungSuppliers = activeSuppliers.filter(sup => sup.id !== 'daekyung');
                      const nonDaekyungIdx = nonDaekyungSuppliers.findIndex(sup => sup.id === s.id);
                      if (nonDaekyungIdx !== -1) {
                        return `${parentPoNo}-${nonDaekyungIdx + 1}`;
                      }
                      return parentPoNo;
                    })().trim()
                  : '';

                return (
                  <div
                    key={s.id}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, s.id)}
                    className={`border-2 rounded-2xl p-5 flex flex-col min-h-[340px] transition-all relative shadow-sm ${
                      isOver 
                        ? 'border-dashed border-teal-500 bg-teal-50/50 shadow-md scale-[1.01]' 
                        : 'border-slate-200 bg-white hover:border-slate-350'
                    }`}
                  >
                    {/* 공급사 제목 */}
                    <div className="flex items-start justify-between border-b border-slate-150 pb-3 mb-4">
                      <div>
                        <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5 flex-wrap">
                          <span>{s.company_name}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-655 px-2 py-0.5 rounded-full font-mono font-bold">
                            {agg.items.length}건
                          </span>
                          {finalPoNumber && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-extrabold border shadow-sm ${
                              deliveryInfo?.poSent
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-250'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`} title={deliveryInfo?.poSent ? '매입 발송이 완료된 PO 번호입니다' : '발송 시 할당될 예상 PO 번호입니다'}>
                              {deliveryInfo?.poSent ? '발송' : '예정'} PO: {finalPoNumber}
                            </span>
                          )}
                        </h3>
                        <p className="text-slate-500 text-[10px] mt-0.5 font-semibold">{s.contact_name || '담당자 미정'} | {s.tel || '연락처 미정'}</p>
                      </div>

                      {agg.items.length > 0 && (() => {
                        const displayAmount = deliveryInfo?.totalAmount ?? agg.totalAmount;
                        return (
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 font-bold">매입 예상가</p>
                            <p className="font-extrabold text-sm font-mono text-teal-600">
                              {formatCurrency(displayAmount)}
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* 보관함 내 품목 리스트 */}
                    <div className="flex-1 space-y-2 max-h-[220px] overflow-auto pr-1">
                      {agg.items.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-400 text-xs py-10 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                          여기에 아이템을 드롭하세요
                        </div>
                      ) : (
                        agg.items.map(item => {
                          const origId = (item as SplitLineItem).parentId || item.id;
                          const hasMismatch = originalQuantities[origId] !== currentSplitSums[origId];

                          return (
                            <div
                              key={item.id}
                              className={`bg-slate-50 border rounded-xl p-2.5 flex items-center justify-between gap-3 text-xs transition-colors hover:border-slate-300 ${
                                hasMismatch ? 'border-red-300 bg-red-50/20' : 'border-slate-200'
                              }`}
                            >
                              {/* 좌측: 품목 스펙 정보 & 수량오류 경보 */}
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <p className="font-semibold text-slate-700 truncate min-w-0" title={[item.name, item.thickness, item.size, item.material].filter(Boolean).join('-')}>
                                  {[item.name, item.thickness, item.size, item.material].filter(Boolean).join('-')}
                                </p>
                                {hasMismatch && (
                                  <span className="text-[9px] text-red-655 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded font-black shrink-0">
                                    ⚠️ 수량오류
                                  </span>
                                )}
                              </div>

                              {/* 우측: 수량 조절 및 분할/되돌리기 제어 */}
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-0.5">
                                  <input
                                    type="number"
                                    min="0"
                                    value={item.quantity}
                                    onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value, 10) || 0)}
                                    className="w-10 px-1 py-0.5 text-right bg-white border border-slate-300 rounded font-mono font-bold text-slate-700 text-[10px] focus:ring-1 focus:ring-teal-500 outline-none"
                                  />
                                  <span className="text-slate-450 text-[10px] font-bold">개</span>
                                </div>

                                {/* 분할 버튼 */}
                                {!(item as SplitLineItem).isSplit ? (
                                  <button
                                    onClick={() => handleSplitLineItem(item as SplitLineItem)}
                                    disabled={item.quantity <= 1}
                                    className="px-1.5 py-0.5 text-[9px] bg-white hover:bg-slate-100 text-slate-650 rounded border border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                                    title="수량 분할"
                                  >
                                    분할
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleRemoveSplitItem(item as SplitLineItem)}
                                    className="p-1 text-slate-450 hover:text-red-655 hover:bg-slate-200 rounded transition-colors"
                                    title="분할 품목 삭제 (수량 원본 반환)"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}

                                {/* 되돌리기 버튼 활성화 (공급처 할당 취소) */}
                                <button
                                  onClick={() => {
                                    setAssignments(prev => {
                                      const next = { ...prev };
                                      delete next[item.id];
                                      return next;
                                    });
                                  }}
                                  className="p-1 text-slate-500 hover:text-teal-650 hover:bg-slate-200 rounded transition-colors"
                                  title="할당 해제 (미지정으로 복구)"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* 하단 제어 */}
                    {agg.items.length > 0 && (
                      <div className="border-t border-slate-150 pt-3 mt-4">
                        {/* 요청고객사 출력 토글 스위치 */}
                        <div className="mb-2.5 flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`print-customer-${s.id}`}
                            className="w-3.5 h-3.5 cursor-pointer accent-teal-600 rounded"
                            checked={s.id === 'daekyung' ? true : (printEndCustomerOptions[s.id] ?? false)}
                            disabled={s.id === 'daekyung'}
                            onChange={(e) => {
                              setPrintEndCustomerOptions(prev => ({
                                ...prev,
                                [s.id]: e.target.checked
                              }));
                            }}
                          />
                          <label htmlFor={`print-customer-${s.id}`} className={`text-[10px] font-extrabold cursor-pointer select-none ${s.id === 'daekyung' ? 'text-indigo-650' : 'text-slate-600'}`}>
                            요청고객사 출력 {s.id === 'daekyung' && <span className="text-[9px] text-indigo-400 font-normal">(대경벤드는 필수)</span>}
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                        {/* 1. 미리보기 / 보기 버튼 (상시 노출) */}
                        <Button
                          variant="outline"
                          onClick={() => handlePreviewPO(s)}
                          className="border-slate-300 text-[10px] text-slate-750 hover:bg-slate-100 py-1.5 flex items-center gap-1 w-[31%] justify-center font-extrabold rounded-xl shrink-0"
                        >
                          <FileText className="w-3 h-3 text-teal-600" />
                          <span>{deliveryInfo?.poSent ? '보기' : '미리보기'}</span>
                        </Button>

                        {/* 2. 메일 전송 버튼 (발송 전에는 메일전송 버튼, 발송 후에는 메일완료 배지) */}
                        {deliveryInfo?.poSent ? (
                          <div className="py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-[10px] font-black flex items-center justify-center gap-1 shadow-sm w-[31%]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>메일완료</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleSendEmailWebhook(s, deliveryInfo)}
                            disabled={emailSendingStatus[s.id]}
                            className="text-[10px] font-extrabold py-1.5 px-2 rounded-xl flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm cursor-pointer w-[31%] disabled:opacity-50"
                            title="메일 바로 전송 (Webhook)"
                          >
                            <Mail className="w-3 h-3" />
                            <span>메일전송</span>
                          </button>
                        )}

                        {/* 3. 상세조정 버튼 (상시 노출, 발송 완료 여부와 관계없이 조회/작성 가능) */}
                        <button
                          onClick={async () => {
                            if (!currentOrder) return;
                            const hasSavedDelivery = currentOrder.splitDeliveries?.some(d => d.supplier.id === s.id);
                            if (!hasSavedDelivery) {
                              alert("먼저 상단의 '분할 저장 & 반영' 버튼을 클릭하여 분할 내역을 서버에 저장해 주세요.");
                              return;
                            }

                            // 부모 주문 번호가 없거나 기본 플레이스홀더인 경우 신규 발급
                            let parentPoNo = (currentOrder.poNumber || '').trim();
                            if (!parentPoNo || parentPoNo === 'ES-PILOT' || parentPoNo.trim() === '') {
                              parentPoNo = generateParentPoNumber().trim();
                              // 즉시 부모 주문서의 poNumber 동기화 저장
                              await updateOrder(currentOrder.id, { poNumber: parentPoNo });
                              console.log("[SplitPO] Auto-generated and updated parent poNumber on send click:", parentPoNo);
                            }

                            // 배송지/바이어 정보 복사 및 폴백 바인딩 (접속 유저 정보로 확실하게 보완)
                            const buyerInfoData = {
                              company_name: currentOrder.buyerInfo?.company_name || '알트에프',
                              contact_name: currentOrder.buyerInfo?.contact_name || user?.contactName || '조현진 대표',
                              tel: currentOrder.buyerInfo?.tel || user?.phone || '051-303-3751',
                              email: currentOrder.buyerInfo?.email || user?.email || 'altf@altf.kr',
                              address: currentOrder.buyerInfo?.address || user?.address || '부산시 사상구 낙동대로1330번길 67'
                            };

                            const deliveryInfo = currentOrder.splitDeliveries?.find(d => d.supplier.id === s.id);

                            // 가상 하위 주문서 매입 품목 빌드 (약정 요율 동적 복사 및 기저 저장 내역 보존 적용)
                            const poItems = agg.items.map((item) => {
                              const savedItem = deliveryInfo?.items?.find(di => (di.parentId || di.id) === (item.parentId || item.id))
                                || deliveryInfo?.po_items?.find(di => (di.parentId || di.id) === (item.parentId || item.id));

                              const product = findProduct(item);
                              const defaultRate = savedItem?.supplierRate ?? item.supplierRate ?? product?.rate_act2 ?? product?.rate_act ?? product?.rate_pct ?? 0;
                              const priceOverride = savedItem?.supplierPriceOverride ?? item.supplierPriceOverride;

                              return {
                                ...item,
                                supplierRate: defaultRate,
                                supplierPriceOverride: priceOverride,
                                poSent: deliveryInfo?.poSent || savedItem?.poSent || false,
                                transactionIssued: savedItem?.transactionIssued || false
                              };
                            });

                            // 대경벤드는 무조건 본래 번호, 그 외는 대경벤드를 제외한 활성 공급사들의 순서대로 1, 2, 3...
                            const finalPoNumber = (() => {
                              if (deliveryInfo?.poNumber) {
                                return deliveryInfo.poNumber.trim();
                              }
                              if (s.id === 'daekyung') {
                                return parentPoNo;
                              }
                              const activeSuppliers = suppliers.filter(sup => {
                                const a = supplierAggregations[sup.id];
                                return a && a.items.length > 0;
                              });
                              const nonDaekyungSuppliers = activeSuppliers.filter(sup => sup.id !== 'daekyung');
                              const nonDaekyungIdx = nonDaekyungSuppliers.findIndex(sup => sup.id === s.id);
                              if (nonDaekyungIdx !== -1) {
                                return `${parentPoNo}-${nonDaekyungIdx + 1}`;
                              }
                              return parentPoNo;
                            })().trim();

                            // 가상 하위 주문서 조립 (아직 DB에 생성되지 않은 가상의 임시 주문서)
                            const virtualSubOrder: Order = {
                              id: `${currentOrder.id}-sub-${s.id}`,
                              parentId: currentOrder.id,
                              isSplitPoSubOrder: true,
                              poNumber: finalPoNumber,
                              poSent: deliveryInfo?.poSent || false,
                              customerName: currentOrder.customerName,
                              poEndCustomer: currentOrder.poEndCustomer || currentOrder.customerName,
                              items: agg.items, // 매출 품목
                              po_items: poItems, // 매입 품목
                              supplierInfo: {
                                id: s.id,
                                company_name: s.company_name,
                                contact_name: s.contact_name,
                                tel: s.tel,
                                email: s.email,
                                address: s.address,
                                note: (deliveryInfo?.supplier?.note && deliveryInfo.supplier.note.trim())
                                  ? deliveryInfo.supplier.note
                                  : ((currentOrder.supplierInfo?.note && currentOrder.supplierInfo.note.trim())
                                    ? currentOrder.supplierInfo.note
                                    : (s.note || ''))
                              },
                              buyerInfo: buyerInfoData, // 배송지 정보 탑재
                              status: deliveryInfo?.poSent ? 'SHIPPED' : 'PENDING',
                              memo: currentOrder.memo || '', // 부모 주문서 비고를 그대로 연동(복사)하여 상속
                              createdAt: new Date().toISOString(),
                              createdBy: user?.id || 'SYSTEM'
                            } as unknown as Order;

                            setSelectedOrderDetailOrder(virtualSubOrder);
                            setDetailInitialMode('SUPPLIER');
                          }}
                          className={`text-[10px] font-extrabold py-1.5 px-2 rounded-xl flex items-center justify-center gap-1 transition-colors shadow-sm cursor-pointer w-[31%] ${
                            deliveryInfo?.poSent
                              ? 'bg-orange-500 hover:bg-orange-600 text-white'
                              : 'bg-teal-600 hover:bg-teal-700 text-white'
                          }`}
                        >
                          <Send className="w-3 h-3" />
                          <span>{deliveryInfo?.poSent ? '상세조회' : '상세조정'}</span>
                        </button>
                      </div>
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
      {previewModalOpen && (
        <PreviewModal
          onClose={() => {
            setPreviewModalOpen(false);
            setPreviewHtml(null);
          }}
          htmlContent={previewHtml || ''}
          docType="ORDER"
        />
      )}

      {/* 매입 발주 상세 작성 및 송부 모달 */}
      {selectedOrderDetailOrder && (
        <AdminOrderDetail
          order={selectedOrderDetailOrder}
          onClose={() => setSelectedOrderDetailOrder(null)}
          onUpdate={handleSubOrderUpdate}
          initialMode={detailInitialMode}
        />
      )}
    </div>
  );
}
