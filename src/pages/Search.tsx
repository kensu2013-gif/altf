import { useState, useMemo, useEffect, Component, useDeferredValue, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useInventory } from '../hooks/useInventory';
import { useDebounce } from '../hooks/useDebounce';
import { ProductTable } from '../components/search/ProductTable';
import { Button } from '../components/ui/Button';
import { THICKNESS_OPTS, LOCATIONS } from '../lib/constants';
// Security imports removed

import {
    Search as SearchIcon,
    Filter,

    CheckCircle,
    RotateCcw,
    MapPin,
    Plus,
    X,
    FileUp,
    FileText,
    Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

import { CalmPageShell } from '../components/ui/CalmPageShell';
import { MaterialFilter } from '../components/search/MaterialFilter';
import { PixelRobotLoader } from '../components/ui/PixelRobotLoader';
import { STANDARD_SYSTEMS, type StandardSystem } from '../lib/productUtils';
import type { LineItem } from '../types';

// Anti-Gravity: Error Boundary to prevent White Screen
class InventoryErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error in Inventory Table:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 text-center bg-red-50 rounded-xl border border-red-100">
                    <h3 className="text-lg font-bold text-red-800 mb-2">테이블 렌더링 오류</h3>
                    <p className="text-sm text-red-600">데이터를 표시하는 도중 문제가 발생했습니다. (데이터 로드 실패)</p>
                    <button onClick={() => this.setState({ hasError: false })} className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-bold">
                        재시도
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

const ITEM_CATEGORIES = [
    // Flange removed
    // ...
    {
        label: "엘보 (ELBOW)",
        value: "ELBOW",
        keywords: ["ELBOW", "E/L", "45E", "90E"],
        subs: [
            { label: "90° 롱(LONG)", value: "90E(L)" },
            { label: "90° 숏(SHORT)", value: "90E(S)" },
            { label: "45° 롱(LONG)", value: "45E(L)" },
            { label: "45° 숏(SHORT)", value: "45E(S)" },
        ]
    },
    {
        label: "티 (TEE)",
        value: "TEE",
        keywords: ["TEE"],
        subs: [
            { label: "동일(STRAIGHT)", value: "T(S)" },
            { label: "이종(REDUCING)", value: "R" },
        ]
    },
    {
        label: "레듀샤 (REDUCER)",
        value: "REDUCER",
        keywords: ["REDUCER", "C.R", "E.R"],
        subs: [
            { label: "동심(CON)", value: "R(C)" },
            { label: "편심(ECC)", value: "R(E)" },
        ]
    },
    {
        label: "캡 (CAP)",
        value: "CAP",
        keywords: ["CAP"],
        subs: []
    }
];

// ... (Rest of initial constants)

interface MockImportedItem {
    item: string;
    // Added optional fields for flexibility with AI response
    name?: string;
    spec: string;
    size: string;
    thickness: string;
    material: string;
    qty: number;
    unit_price?: number;
    price?: number;
    item_id?: string;
    item_id_b64?: string; // Webhook payload for Strict Matching
    marking_wait_qty?: number;
}

export default function Search() {
    const navigate = useNavigate();
    const { addItem, quotation, logout, inventory, fetchInventory } = useStore();
    const { isLoading, error: loadError } = useInventory(); // Using hook to ensure data is fetched

    // --- State Management ---
    const location = useLocation();

    // --- Persistence Logic ---
    const STORAGE_KEY = 'search_page_state';

    // 1. Initial State Loader
    // 1. Initial State Loader
    const initialState = useMemo(() => {
        // If "Return" flag is set, try to load from storage
        if (location.state?.returnToSearch) {
            try {
                const saved = sessionStorage.getItem(STORAGE_KEY);
                if (saved) {
                    return JSON.parse(saved);
                }
            } catch (e) {
                console.error("Failed to load search state", e);
            }
        }
        // Default: Reset (AI Upload Mode)
        return {
            mode: 'UPLOAD',
            system: 'KS',
            selectedCategory: '',
            selectedNameFilters: [],
            query: '',
            selectedThicknesses: [],
            selectedMaterials: [],
            selectedSizes: [],
            sizeSearchQuery: '',
            selectedLocations: ['시화', '양산']
        };
    }, [location.state, STORAGE_KEY]);

    // --- State Management ---
    const [mode, setMode] = useState<'SEARCH' | 'UPLOAD'>(initialState.mode);
    const [system, setSystem] = useState<StandardSystem>(initialState.system);

    // Filter States
    const [selectedCategory, setSelectedCategory] = useState<string>(initialState.selectedCategory);
    const [activeTab, setActiveTab] = useState(initialState.selectedCategory); // Sync logic handled in effect
    const [selectedNameFilters, setSelectedNameFilters] = useState<string[]>(initialState.selectedNameFilters);
    const [query, setQuery] = useState(initialState.query);
    const [selectedThicknesses, setSelectedThicknesses] = useState<string[]>(initialState.selectedThicknesses);
    const [selectedMaterials, setSelectedMaterials] = useState<string[]>(initialState.selectedMaterials);
    const [selectedSizes, setSelectedSizes] = useState<string[]>(initialState.selectedSizes);
    const [sizeSearchQuery, setSizeSearchQuery] = useState(initialState.sizeSearchQuery);
    const [selectedLocations, setSelectedLocations] = useState<string[]>(initialState.selectedLocations);

    // Performance Optimization: Debounce Size Search Query
    const debouncedSizeQuery = useDebounce(sizeSearchQuery, 300);

    // 2. State Saver (Effect)
    useEffect(() => {
        const stateToSave = {
            mode,
            system,
            selectedCategory,
            selectedNameFilters,
            query,
            selectedThicknesses,
            selectedMaterials,
            selectedSizes,
            sizeSearchQuery,
            selectedLocations
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    }, [mode, system, selectedCategory, selectedNameFilters, query, selectedThicknesses, selectedMaterials, selectedSizes, sizeSearchQuery, selectedLocations]);

    // UI States
    // const [showMaterialGuide] = useState(false); // Unused
    // Guide Logic: Pulse Thickness if Material selected but Thickness empty
    const showThicknessGuide = selectedMaterials.length > 0 && selectedThicknesses.length === 0;

    // Guide Logic: Pulse Material if Thickness selected but Material empty
    const showMaterialGuide = selectedThicknesses.length > 0 && selectedMaterials.length === 0;

    const [visibleCount, setVisibleCount] = useState(100);
    const [notification, setNotification] = useState<string | null>(null);

    // Selection & Cart
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [defaultQty, setDefaultQty] = useState(1);

    // File Upload States
    const [isDragging, setIsDragging] = useState(false);
    const [attachedFile, setAttachedFile] = useState<File | null>(null);
    const [uploadStatus, setUploadStatus] = useState<'IDLE' | 'PROCESSING' | 'DONE'>('IDLE');



    // --- Effects ---

    // Initial Fetch if empty
    useEffect(() => {
        if (inventory.length === 0) {
            fetchInventory();
        }
    }, [inventory.length, fetchInventory]);

    // Reset pagination when filters change
    useEffect(() => {
        setVisibleCount(100);
        setSelectedIds([]); // Clear selection on filter change to avoid confusion
    }, [selectedCategory, selectedNameFilters, query, selectedThicknesses, selectedMaterials, selectedSizes, selectedLocations]);

    // --- Filter Logic ---

    // Performance Optimization: Defer the category state for heavy filtering
    const deferredCategory = useDeferredValue(selectedCategory);

    // Performance Optimization: Debounce Search Query
    const debouncedQuery = useDebounce(query, 300); // 300ms delay

    // 1. Base Filter (Name & System) - Level 1
    const baseFilteredData = useMemo(() => {
        if (!inventory) return [];

        let filtered = inventory;

        // Category Filter (Using Deferred Value)
        if (deferredCategory) {
            const categoryDef = ITEM_CATEGORIES.find(c => c.value === deferredCategory);
            if (categoryDef) {
                if (selectedNameFilters.length > 0) {
                    // Specific Subs
                    filtered = filtered.filter(item => selectedNameFilters.some(sub => item.name.includes(sub)));
                } else {
                    // Broad Category Match
                    filtered = filtered.filter(item => categoryDef.keywords.some(k => item.name.includes(k)));
                }
            }
        }

        // Search Query (Using Debounced Value)
        if (debouncedQuery) {
            const q = debouncedQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.name.toLowerCase().includes(q) ||
                item.size.toLowerCase().includes(q) ||
                item.material.toLowerCase().includes(q) ||
                (item.maker && item.maker.toLowerCase().includes(q))
            );
        }

        return filtered;
    }, [inventory, deferredCategory, selectedNameFilters, debouncedQuery]);

    // 2. Available Options Derivation (Based on Level 1)
    const availableSizes = useMemo(() => {
        // User Logic: Only show available specs if Thickness AND Material are selected
        if (selectedThicknesses.length === 0 || selectedMaterials.length === 0) {
            return [];
        }

        const sizes = new Set<string>();
        // Only show sizes that exist in the currently filtered set (Name/Category)
        baseFilteredData.forEach(item => {
            // Check Thickness Filter logic inside? 
            // Better: Filter by Thickness/Material first?
            // "Available Sizes" usually means "Sizes available for current Name & Material & Thickness"
            // But if we haven't selected Material yet, show all sizes?

            // To prevent massive lists, let's filter by Thickness if selected
            if (selectedThicknesses.length > 0 && !selectedThicknesses.includes(item.thickness)) return;
            if (selectedMaterials.length > 0 && !selectedMaterials.includes(item.material)) return;

            // Plaintext check stock
            if (item.currentStock > 0) {
                sizes.add(item.size);
            }
        });

        // Sort sizes naturally (10A, 15A ... 100A, 125A etc)
        const sorted = Array.from(sizes).sort((a, b) => {
            // Simple localeCompare or custom numeric sort
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });

        // Filter by Size Search Query (Debounced)
        if (debouncedSizeQuery) {
            return sorted.filter(s => s.toLowerCase().includes(debouncedSizeQuery.toLowerCase()));
        }
        return sorted;
    }, [baseFilteredData, selectedThicknesses, selectedMaterials, debouncedSizeQuery]);

    // 3. Final Filter (Apply all attributes)
    const sizedData = useMemo(() => {
        let filteredData = baseFilteredData;

        // Thickness
        if (selectedThicknesses.length > 0) {
            filteredData = filteredData.filter(item => selectedThicknesses.includes(item.thickness));
        }

        // Material
        if (selectedMaterials.length > 0) {
            filteredData = filteredData.filter(item => selectedMaterials.includes(item.material));
        }

        // Size
        if (selectedSizes.length > 0) {
            // Plaintext logic
            filteredData = filteredData.filter(item => {
                const size = item.size;
                return selectedSizes.includes(size);
            });
        }

        // Stock Visibility Logic:
        // If NO size search query is active, only show IN-STOCK items.
        // If size search IS active, show ALL items (including 0 stock) to allow quoting.
        if (!sizeSearchQuery) {
            filteredData = filteredData.filter(item => item.currentStock > 0);
        }

        // Size Search Query
        if (sizeSearchQuery) {
            const q = sizeSearchQuery.toLowerCase();
            filteredData = filteredData.filter(item => item.size.toLowerCase().includes(q));
        }

        // Location (Metadata, Plaintext)
        // Check if ANY of the selected locations have stock
        if (selectedLocations.length > 0 && selectedLocations.length < LOCATIONS.length) {
            filteredData = filteredData.filter(item => {
                // Check if item has stock in selected locations
                if (item.locationStock) {
                    return selectedLocations.some(loc => {
                        const qty = item.locationStock?.[loc];
                        return qty !== undefined && qty > 0;
                    });
                }

                // Fallback to location string
                if (!item.location) return false;
                return selectedLocations.some(loc => (item.location as string).includes(loc));
            });
        }

        return filteredData;

    }, [baseFilteredData, selectedThicknesses, selectedMaterials, selectedSizes, selectedLocations, sizeSearchQuery]);

    // Derived Table Data (Pagination)
    const tableData = useMemo(() => {
        return sizedData.slice(0, visibleCount);
    }, [sizedData, visibleCount]);

    // Unique key for table re-rendering
    const filterHash = JSON.stringify({
        selectedCategory,
        selectedNameFilters,
        selectedThicknesses,
        selectedMaterials,
        query,
        system,
        sizeSearchQuery
    });

    // --- Handlers ---

    const handleSystemChange = (val: StandardSystem) => {
        setSystem(val);
        // Reset filters on system change
        setSelectedMaterials([]);
        setSelectedThicknesses([]);
        setSelectedSizes([]);
        setSelectedNameFilters([]);
        setSizeSearchQuery('');
    };

    const handleCategoryClick = (cat: typeof ITEM_CATEGORIES[0]) => {
        // Reset secondary filters regardless of toggle on/off
        setSelectedMaterials([]);
        setSelectedThicknesses([]);
        setSelectedSizes([]);
        setSizeSearchQuery('');

        if (selectedCategory === cat.value) {
            // Toggle off
            setSelectedCategory('');
            setActiveTab('');
            setSelectedNameFilters([]);
        } else {
            setSelectedCategory(cat.value);
            setActiveTab(cat.value);
            setSelectedNameFilters([]); // Reset subs
        }
    };

    const handleResetAll = () => {
        setSelectedCategory('');
        setActiveTab('');
        setSelectedNameFilters([]);
        setQuery('');
        setSelectedThicknesses([]);
        setSelectedMaterials([]);
        setSelectedSizes([]);
        setSelectedIds([]);
        setSizeSearchQuery('');
    };

    const handleToggleThickness = (t: string) => {
        setSelectedThicknesses(prev =>
            prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
        );
    };

    const handleToggleMaterial = (m: string) => {
        setSelectedMaterials(prev =>
            prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
        );
    };

    const handleToggleSize = (s: string) => {
        setSelectedSizes(prev =>
            prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
        );
    };

    const handleToggleLocation = (l: string) => {
        setSelectedLocations(prev =>
            prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]
        );
    };

    const handleSubOptionToggle = (val: string) => {
        setSelectedNameFilters(prev =>
            prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
        );
    };

    // Selection Logic
    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            return [...prev, id];
        });
    };

    const handleAddToCart = () => {
        let addedCount = 0;
        selectedIds.forEach(compositeId => {
            // Handle composite IDs for location selection: "ITEM_ID|LOCATION"
            const [itemId, locationKey] = compositeId.split('|');

            const product = inventory.find(p => p.id === itemId);
            if (!product) return;

            // Determine specific location/stock if selected via button
            let finalLocation = product.location;
            let finalStock = product.currentStock;

            // Simplified request object for handler
            const req = {
                loc: locationKey || null
            };

            if (req.loc) {
                finalLocation = req.loc;
                // Plaintext logic
                const stockMap = product.locationStock as Record<string, number>;
                finalStock = stockMap ? (stockMap[req.loc] || 0) : 0;
            }

            const lineItem: LineItem = {
                id: crypto.randomUUID(), // Always new ID
                productId: product.id,
                name: product.name,
                thickness: product.thickness,
                size: product.size,
                material: product.material,
                quantity: defaultQty,
                unitPrice: Number(product.unitPrice),
                amount: Number(product.unitPrice) * defaultQty,
                isVerified: true,
                stockStatus: product.stockStatus,
                location: finalLocation, // Plaintext
                maker: product.maker,     // Plaintext
                currentStock: finalStock, // Uses specific stock if selected
                locationStock: product.locationStock,
                marking_wait_qty: product.marking_wait_qty
            };

            addItem(lineItem);
            addedCount++;
        });

        setSelectedIds([]);
        setNotification(`${addedCount}개 품목이 견적서에 추가되었습니다.`);
        setTimeout(() => setNotification(null), 3000);
    };

    // --- File Upload Logic ---
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setAttachedFile(e.target.files[0]);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setAttachedFile(e.dataTransfer.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const handleRemoveFile = () => setAttachedFile(null);

    // Paste Support
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (mode !== 'UPLOAD') return;
            if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
                const file = e.clipboardData.files[0];
                setAttachedFile(file);
                // Optional: Show toast or feedback?
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [mode]);

    const handleStartAnalysis = async () => {
        if (!attachedFile) return;
        setUploadStatus('PROCESSING');

        // 1. Generate Session ID
        const sessionId = crypto.randomUUID();

        // 2. Prepare Payload
        const formData = new FormData();
        formData.append('file', attachedFile);
        formData.append('session_id', sessionId);
        formData.append('callback_url', 'https://callosal-loni-formulable.ngrok-free.dev/api/quote/import');

        try {
            // 3. Send to Make.com Webhook
            const response = await fetch('https://hook.us2.make.com/f1555ljwq6oovx8ug7ghux3y9mmfsx8m', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Upload Failed');

            // 4. Start Polling
            pollResults(sessionId);
        } catch (error) {
            console.error(error);
            setUploadStatus('IDLE');
            setNotification('업로드 중 오류가 발생했습니다.');
        }
    };

    const pollResults = async (sessionId: string) => {
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes (1s * 120)
        let lastItemCount = 0;
        let silenceTimer = 0;

        const interval = setInterval(async () => {
            attempts++;
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL}/api/quote/session/${sessionId}`);
                if (res.ok) {
                    const data = await res.json();
                    const currentCount = data.items ? data.items.length : 0;

                    if (currentCount > lastItemCount) {
                        // New items arrived!
                        lastItemCount = currentCount;
                        silenceTimer = 0; // Reset silence timer
                        setNotification(`${currentCount}개 항목 발견... 분석 중`);
                    } else if (currentCount === lastItemCount && currentCount > 0) {
                        // No new items, but we have some. Increment silence timer.
                        silenceTimer++;
                        setNotification(`${currentCount}개 항목 발견... (${5 - silenceTimer}초 후 완료)`);
                    }

                    // Condition: We have items AND 5 seconds of silence
                    if (currentCount > 0 && silenceTimer >= 5) {
                        clearInterval(interval);
                        processMatchedItems(data.items);
                        return;
                    }
                }
            } catch (e) {
                console.error("Polling error", e);
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                setUploadStatus('IDLE');
                setNotification('분석 시간이 초과되었습니다 (관리자에 문의하세요.).');
            }
        }, 1000); // Poll every 1 second
    };

    const processMatchedItems = (items: MockImportedItem[]) => {
        let addedCount = 0;

        items.forEach(importedItem => {
            let matchedProduct: typeof inventory[0] | undefined;
            let pName = '';
            let pSize = '';
            let pThickness = '';
            let pMaterial = '';

            // 1. Strict Match using Base64 ID (Primary Method)
            if (importedItem.item_id_b64) {
                try {
                    // Decode Base64 (e.g., "NDVFKEwpLVMxMFMtNiItV1AzMDRMLVc=" -> "45E(L)-S10S-6"-WP304L-W")
                    const decodedId = atob(importedItem.item_id_b64);

                    // Strict Match in Inventory
                    matchedProduct = inventory.find(p => p.id === decodedId);

                    // Fallback Parsing (only if product not found, for display purposes)
                    if (!matchedProduct) {
                        const parts = decodedId.split('-');
                        if (parts.length >= 4) {
                            pName = parts[0];
                            pThickness = parts[1];
                            pSize = parts[2];
                            pMaterial = parts.slice(3).join('-'); // Handle material needing dash? usually last part
                        }
                    }

                } catch (e) {
                    console.error("Base64 match failed", e);
                }
            }

            // 2. Legacy / Fallback Match (If no ID or ID match failed)
            if (!matchedProduct) {
                // Adapter for response format
                pName = pName || (importedItem.item || importedItem.name || '') + (importedItem.spec ? ' ' + importedItem.spec : '');
                pSize = pSize || importedItem.size || '';
                pThickness = pThickness || importedItem.thickness || '';
                pMaterial = pMaterial || importedItem.material || '';

                // Plaintext Search
                matchedProduct = inventory.find(p =>
                    p.name.includes(importedItem.item || '') &&
                    p.size === pSize &&
                    p.material === pMaterial
                );
            }

            const requestedQty = Number(importedItem.qty || 1);

            if (matchedProduct) {
                // Found in Inventory
                const aiPrice = Number(importedItem.unit_price || importedItem.price || 0);
                const finalPrice = aiPrice > 0 ? aiPrice : matchedProduct.unitPrice;

                // --- Stock Status Logic with Marking Wait Qty ---
                const currentStock = matchedProduct.currentStock;
                const totalAvailable = currentStock;

                let status: 'AVAILABLE' | 'OUT_OF_STOCK' | 'CHECK_LEAD_TIME' = 'OUT_OF_STOCK';

                if (totalAvailable >= requestedQty) {
                    status = 'AVAILABLE';
                } else if (totalAvailable > 0) {
                    // Partial available -> In this specific user request, they didn't specify partial logic explicitly 
                    // other than "Inventory > Order = Available". 
                    // If Inventory < Order, usually it's Check Lead Time or Partial. 
                    // Defaulting to CHECK_LEAD_TIME for transparent warning if not full.
                    status = 'CHECK_LEAD_TIME';
                } else {
                    status = 'OUT_OF_STOCK';
                }

                const lineItem: LineItem = {
                    id: crypto.randomUUID(),
                    productId: matchedProduct.id,
                    name: matchedProduct.name,
                    thickness: matchedProduct.thickness,
                    size: matchedProduct.size,
                    material: matchedProduct.material,
                    quantity: requestedQty,
                    unitPrice: Number(finalPrice),
                    amount: Number(finalPrice) * requestedQty,
                    isVerified: true,
                    stockStatus: status,
                    location: matchedProduct.location,
                    maker: matchedProduct.maker,
                    currentStock: matchedProduct.currentStock,
                    locationStock: matchedProduct.locationStock,
                    marking_wait_qty: matchedProduct.marking_wait_qty || Number(importedItem.marking_wait_qty || 0)
                };

                addItem(lineItem);
                addedCount++;
            } else {
                // No Match logic (Fallback)
                const rawPrice = Number(importedItem.unit_price || importedItem.price || 0);

                const lineItem: LineItem = {
                    id: crypto.randomUUID(),
                    productId: null,
                    name: pName.trim() || 'Unknown Item',
                    thickness: pThickness,
                    size: pSize,
                    material: pMaterial,
                    quantity: requestedQty,
                    unitPrice: rawPrice,
                    amount: rawPrice * requestedQty,
                    isVerified: false,
                    stockStatus: 'OUT_OF_STOCK',
                    location: '-',
                    maker: '-',
                    currentStock: 0,

                };
                addItem(lineItem);
                addedCount++;
            }
        });

        setUploadStatus('DONE');
        setNotification(`${addedCount}개 품목 분석 완료! 견적서에서 확인하세요.`);
        setTimeout(() => {
            navigate('/quote');
        }, 1500);
    };

    // --- Render Helpers ---

    // Strict Display Logic: Only show results if Category, Thickness AND Material are selected
    const canShowResults = !!selectedCategory && selectedThicknesses.length > 0 && selectedMaterials.length > 0;

    return (
        <CalmPageShell>
            {/* Header Content */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between mb-8"
            >
                <div>
                    <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">
                        제품 찾아보기 <span className="text-teal-600"></span>
                    </h1>
                    <p className="text-slate-500 mt-2 font-medium">원하는 조건을 선택하거나 파일을 업로드하여 검색하세요.</p>
                </div>

                <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                    <button
                        onClick={() => setMode('UPLOAD')}
                        className={cn(
                            "px-4 py-2 rounded-lg font-bold transition-all duration-300 flex items-center gap-2 text-sm",
                            mode === 'UPLOAD'
                                ? "bg-teal-50 text-teal-700 shadow-sm ring-1 ring-teal-200"
                                : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/50"
                        )}
                    >
                        <FileUp className="w-4 h-4" />
                        AI가 검색하기
                    </button>
                    <div className="w-px h-6 bg-slate-300/50 mx-1"></div>
                    <button
                        onClick={() => setMode('SEARCH')}
                        className={cn(
                            "px-6 py-2 rounded-lg font-bold transition-all duration-300 relative",
                            mode === 'SEARCH'
                                ? "bg-teal-50 text-teal-700 shadow-sm ring-1 ring-teal-200"
                                : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/50"
                        )}
                    >
                        직접 검색하기
                    </button>
                </div>
            </motion.div>

            <AnimatePresence mode="wait">
                {mode === 'SEARCH' ? (
                    <motion.div
                        key="search-mode"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="space-y-8 pb-32"
                    >
                        {/* System Selection */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.2 }}
                            className="flex flex-col items-center gap-2"
                        >
                            <div className="flex bg-white/60 backdrop-blur-md p-1.5 rounded-xl border border-white/40 shadow-sm flex items-center gap-1 ring-1 ring-slate-200/50">
                                {Object.values(STANDARD_SYSTEMS).map((sys) => (
                                    <button
                                        key={sys.value}
                                        onClick={() => handleSystemChange(sys.value)}
                                        className={cn(
                                            "px-6 py-2 rounded-lg text-sm font-extrabold transition-all duration-300 border",
                                            system === sys.value
                                                ? "bg-teal-50 text-teal-700 shadow-sm border-teal-200 scale-105 z-10"
                                                : "bg-transparent text-slate-500 border-transparent hover:text-slate-900 hover:bg-slate-100/50"
                                        )}
                                    >
                                        {sys.label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium">
                                규격 체계를 선택하면, 재질·규격 표기가 자동으로 맞춰집니다.
                            </p>
                        </motion.div>

                        {/* 1. Item Category */}
                        <div className="flex flex-col items-center gap-4">
                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">품목 선택</h3>

                            {/* Main Categories */}
                            <div className="flex flex-wrap items-center justify-center gap-3">
                                <motion.button
                                    whileHover={{ scale: 1.05, y: -2 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={handleResetAll}
                                    className={cn(
                                        "px-6 py-2.5 rounded-full text-sm font-bold transition-all border shadow-sm",
                                        activeTab === '' && selectedCategory === '' && selectedNameFilters.length === 0
                                            ? "bg-teal-600 border-teal-600 text-white shadow-teal-500/30"
                                            : "bg-white/70 backdrop-blur-sm border-white/40 text-slate-600 hover:bg-white hover:text-teal-600 hover:border-teal-200"
                                    )}
                                >
                                    모든 제품
                                </motion.button>
                                {ITEM_CATEGORIES.map(cat => {
                                    const isActive = selectedCategory === cat.value || activeTab === cat.value;
                                    return (
                                        <motion.button
                                            key={cat.label}
                                            whileHover={{ scale: 1.05, y: -2 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => handleCategoryClick(cat)}
                                            className={cn(
                                                "px-6 py-2.5 rounded-full text-sm font-bold transition-all border shadow-sm",
                                                isActive
                                                    ? "bg-teal-600 border-teal-600 text-white shadow-teal-500/30"
                                                    : "bg-white/70 backdrop-blur-sm border-white/40 text-slate-600 hover:bg-white hover:text-teal-600 hover:border-teal-200"
                                            )}
                                        >
                                            {cat.label}
                                        </motion.button>
                                    );
                                })}
                            </div>

                            {/* Sub Options */}
                            <AnimatePresence>
                                {selectedCategory && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, height: 'auto', scale: 1 }}
                                        exit={{ opacity: 0, height: 0, scale: 0.95 }}
                                        transition={{ duration: 0.25, ease: "easeOut" }}
                                        className="flex flex-wrap gap-2 p-4 bg-white/50 backdrop-blur-md rounded-2xl border border-white/30 mt-2 shadow-sm overflow-hidden"
                                    >
                                        {ITEM_CATEGORIES.find(c => c.value === selectedCategory)?.subs.map(sub => (
                                            <button
                                                key={sub.value}
                                                onClick={() => handleSubOptionToggle(sub.value)}
                                                className={cn(
                                                    "px-4 py-1.5 rounded-full text-xs font-bold transition-all border",
                                                    selectedNameFilters.includes(sub.value)
                                                        ? "bg-teal-600 border-teal-600 text-white shadow-md"
                                                        : "bg-white border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50"
                                                )}
                                            >
                                                {sub.label}
                                            </button>
                                        ))}
                                        <span className="text-xs text-slate-400 self-center ml-2">※ 중복 선택 가능</span>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* 2. Filters & Input */}
                        <div className="filters-container">
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="bg-white/65 backdrop-blur-xl border border-white/40 p-8 rounded-3xl shadow-lg shadow-slate-200/50 space-y-6 ring-1 ring-white/50"
                            >
                                {/* Search Input */}
                                <div className="relative max-w-2xl">
                                    <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 h-5 w-5" />
                                    <input
                                        type="text"
                                        placeholder='예) 45E(L)-S40S-4"-WP304L-W'
                                        className="w-full h-11 pl-12 pr-4 rounded-lg border border-slate-300 bg-white focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none text-sm font-medium transition-shadow placeholder:text-slate-500 text-slate-900"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                    />
                                </div>

                                <div className="border-t border-slate-200 my-4" />

                                <div className="flex flex-col gap-6">
                                    {/* Thickness */}
                                    <div className={cn("space-y-2 relative transition-all duration-300",
                                        showThicknessGuide && "p-4 -m-4 bg-rose-50/80 rounded-2xl border border-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse ring-2 ring-rose-400 ring-offset-2 ring-offset-white"
                                    )}>
                                        {showThicknessGuide && (
                                            <div className="absolute -top-2 -right-1 z-10 animate-bounce">
                                                <span className="bg-pink-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                                    두께 선택 필수
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between">
                                            <label className="text-base font-extrabold text-slate-700 uppercase flex items-center gap-1">
                                                <Filter className="w-5 h-5 pointer-events-none" /> 두께 (SCH)
                                            </label>
                                            <button onClick={() => setSelectedThicknesses([])} className="ml-auto px-2 py-0.5 rounded text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center gap-1">
                                                <RotateCcw className="w-3 h-3" /> 초기화
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {THICKNESS_OPTS.map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => handleToggleThickness(opt)}
                                                    className={cn("px-3 py-1.5 text-xs font-medium border rounded-md transition-all",
                                                        selectedThicknesses.includes(opt)
                                                            ? "bg-teal-600 border-teal-600 text-white ring-1 ring-teal-200"
                                                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                                                    )}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Material Filter */}
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                        <MaterialFilter
                                            selectedMaterials={selectedMaterials}
                                            onToggleMaterial={handleToggleMaterial}
                                            productName={activeTab}
                                            system={system}
                                            onReset={() => setSelectedMaterials([])}
                                            showGuide={showMaterialGuide}
                                            selectedThicknesses={selectedThicknesses}
                                        />
                                    </div>

                                    {/* Size Filter */}
                                    <AnimatePresence>
                                        {(activeTab || selectedThicknesses.length > 0) && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="space-y-3 pt-2"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <label className="text-base font-extrabold text-slate-700 uppercase flex items-center gap-1">
                                                        <CheckCircle className="w-5 h-5" /> 가용 규격 (재고 보유)
                                                    </label>
                                                    <button onClick={() => setSelectedSizes([])} className="ml-2 px-2 py-0.5 rounded text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center gap-1">
                                                        <RotateCcw className="w-3 h-3" /> 초기화
                                                    </button>
                                                    <div className="relative">
                                                        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-teal-500 w-3.5 h-3.5" />
                                                        <input
                                                            type="text"
                                                            placeholder="규격 검색"
                                                            className="h-8 pl-8 pr-3 text-xs font-bold bg-teal-50 border border-teal-200 rounded-full focus:bg-white focus:ring-1 focus:ring-teal-500 outline-none w-32 text-teal-700 placeholder:text-teal-400 transition-all shadow-sm"
                                                            value={sizeSearchQuery}
                                                            onChange={(e) => setSizeSearchQuery(e.target.value)}
                                                        />
                                                    </div>
                                                    <span className="text-[11px] text-slate-500 font-medium animate-pulse">
                                                        ← 사이즈를 직접 입력하면 제품을 추가해서 견적을 받을 수 있어요.
                                                    </span>
                                                </div>

                                                {availableSizes.length === 0 ? (
                                                    <p className="text-xs text-slate-500 italic">현재 선택된 조건에 맞는 재고가 없습니다.</p>
                                                ) : (
                                                    <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar space-y-4">
                                                        {(() => {
                                                            const filteredSizes = availableSizes.filter(s => s.toLowerCase().includes(sizeSearchQuery.toLowerCase()));

                                                            // Grouping Logic
                                                            const groups: Record<string, string[]> = {};
                                                            const singles: string[] = [];

                                                            filteredSizes.forEach(size => {
                                                                if (size.includes(' X ')) {
                                                                    const major = size.split(' X ')[0];
                                                                    if (!groups[major]) groups[major] = [];
                                                                    groups[major].push(size);
                                                                } else {
                                                                    singles.push(size);
                                                                }
                                                            });

                                                            // Sort group keys numerically
                                                            const sortedGroupKeys = Object.keys(groups).sort((a, b) =>
                                                                a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
                                                            );

                                                            const renderButton = (size: string) => (
                                                                <button
                                                                    key={size}
                                                                    onClick={() => handleToggleSize(size)}
                                                                    className={cn("px-3 py-1.5 text-xs font-mono font-medium border rounded-md transition-all h-fit",
                                                                        selectedSizes.includes(size)
                                                                            ? "bg-teal-600 border-teal-600 text-white ring-1 ring-teal-200"
                                                                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                                                                    )}
                                                                >
                                                                    {size}
                                                                </button>
                                                            );

                                                            return (
                                                                <>
                                                                    {/* Singles (Standard Sizes) */}
                                                                    {singles.length > 0 && (
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {singles.map(renderButton)}
                                                                        </div>
                                                                    )}

                                                                    {/* Groups (Reducers etc) */}
                                                                    {sortedGroupKeys.map(major => (
                                                                        <div key={major} className="space-y-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{major} 계열</span>
                                                                                <div className="h-px bg-slate-100 flex-1"></div>
                                                                            </div>
                                                                            <div className="flex flex-wrap gap-2 pl-2">
                                                                                {groups[major].map(renderButton)}
                                                                            </div>
                                                                        </div>
                                                                    ))}

                                                                    {singles.length === 0 && sortedGroupKeys.length === 0 && (
                                                                        <p className="text-xs text-slate-400">검색 결과가 없습니다.</p>
                                                                    )}
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Location */}
                                    <div className="space-y-2">
                                        <label className="text-base font-extrabold text-slate-700 uppercase flex items-center gap-1">
                                            <MapPin className="w-5 h-5" /> 창고 (LOCATION)
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {LOCATIONS.map(opt => (
                                                <button
                                                    key={opt}
                                                    onClick={() => handleToggleLocation(opt)}
                                                    className={cn("px-3 py-1.5 text-xs font-medium border rounded-md transition-all",
                                                        selectedLocations.includes(opt)
                                                            ? "bg-teal-50 border-teal-500 text-teal-700 ring-1 ring-teal-100"
                                                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                                                    )}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>

                        {/* Search Results Header & Actions */}
                        {canShowResults && (
                            <div className="flex items-center justify-between mt-8 mb-4">
                                <h3 className="text-lg font-bold text-slate-900">검색 결과 ({sizedData.length})</h3>

                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                                        <span className="text-xs font-bold text-slate-500">기본 수량:</span>
                                        <input
                                            type="number"
                                            min={1}
                                            value={defaultQty}
                                            onChange={(e) => setDefaultQty(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="w-16 text-center font-bold text-sm outline-none text-slate-900"
                                            title="기본 수량"
                                        />
                                    </div>
                                    <Button
                                        onClick={handleAddToCart}
                                        disabled={selectedIds.length === 0}
                                        className={cn(
                                            "font-bold transition-all shadow-sm flex items-center gap-2",
                                            selectedIds.length > 0 ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-slate-100 text-slate-300"
                                        )}
                                    >
                                        <Plus className="w-4 h-4" />
                                        <span>선택 항목 추가 ({selectedIds.length})</span>
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Loading / Error States / Hints */}
                        {isLoading && (
                            <div className="text-sm text-slate-500 bg-white/70 border border-slate-200 rounded-lg px-4 py-3 mb-4">
                                재고 데이터를 불러오는 중입니다...
                            </div>
                        )}

                        {loadError && (
                            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
                                {loadError}
                            </div>
                        )}

                        {/* Inventory Table */}
                        {!isLoading && !loadError && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="space-y-4"
                            >
                                {/* Results Section with Gating */}
                                {canShowResults ? (
                                    /* SHOW RESULTS */
                                    <>
                                        {/* Table */}
                                        {/* Table UI - Always Rendered with Error Boundary */}
                                        <InventoryErrorBoundary>
                                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px] flex flex-col">
                                                {/* Table Header / Toolbar could go here if needed */}
                                                <ProductTable
                                                    key={filterHash}
                                                    data={tableData}
                                                    selectedIds={selectedIds}
                                                    onToggleSelect={handleToggleSelect}
                                                />
                                            </div>
                                        </InventoryErrorBoundary>

                                        {/* Load More Button */}
                                        {sizedData.length > tableData.length && (
                                            <div className="flex justify-center pt-4">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setVisibleCount(prev => prev + 200)}
                                                    className="w-full max-w-xs border-slate-300 text-slate-600 hover:bg-slate-50"
                                                >
                                                    더 보기 ({tableData.length} / {sizedData.length})
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    /* FALLBACK / GUIDE */
                                    /* FALLBACK / GUIDE */
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="text-center py-20 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200"
                                    >
                                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-sm mb-4">
                                            <SearchIcon className="w-8 h-8 text-slate-300" />
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-700 mb-2">검색 조건을 선택해주세요</h3>
                                        <p className="text-slate-500 text-sm">
                                            원활한 검색을 위해 <span className="font-bold text-teal-600">품목 + 두께 + 재질</span>을<br />모두 선택하시면 결과가 표시됩니다.
                                        </p>
                                    </motion.div>
                                )}
                            </motion.div>
                        )}

                        {/* Sticky Bottom Action Bar */}
                        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-white/40 p-4 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-[100] flex items-center justify-between">
                            <div className="max-w-[1240px] mx-auto w-full flex items-center justify-between px-4">
                                <button
                                    onClick={() => {
                                        logout();
                                        navigate('/');
                                    }}
                                    className="text-slate-500 hover:text-red-600 font-extrabold text-lg underline decoration-slate-300 hover:decoration-red-200 transition-all"
                                >
                                    그만하기
                                </button>

                                <div className="flex items-center gap-4">
                                    <span className="text-slate-400 text-sm hidden sm:inline">
                                        현재 견적서에 <b className="text-teal-600">{quotation.items.length}</b>개 품목이 담겨있습니다.
                                    </span>

                                    <Button
                                        onClick={() => navigate('/quote')}
                                        disabled={false}
                                        size="lg"
                                        className="min-w-[140px] font-bold text-base shadow-md bg-teal-800 hover:bg-teal-900 text-white"
                                    >
                                        견적서 확인하기
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    /* UPLOAD MODE UI */
                    <motion.div
                        key="upload-mode"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="max-w-xl mx-auto py-12"
                    >
                        <input
                            type="file"
                            id="file-upload"
                            className="hidden"
                            onChange={handleFileSelect}
                            accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
                        />
                        {uploadStatus !== 'IDLE' ? (
                            <div
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center transition-colors bg-white",
                                    uploadStatus === 'DONE' ? "border-green-300 bg-green-50" : "border-slate-300"
                                )}
                            >
                                {uploadStatus === 'PROCESSING' && (
                                    <PixelRobotLoader />
                                )}
                                {uploadStatus === 'DONE' && (
                                    <div className="w-full">
                                        <PixelRobotLoader mode="SUCCESS" />
                                    </div>
                                )}
                            </div>
                        ) : attachedFile ? (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-lg mx-auto">
                                <div className="flex items-start justify-between mb-8">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-teal-50 rounded-xl flex items-center justify-center border border-teal-100">
                                            <FileText className="w-7 h-7 text-teal-600" />
                                        </div>
                                        <div className="text-left">
                                            <h3 className="font-bold text-slate-900 text-lg line-clamp-1 break-all">{attachedFile.name}</h3>
                                            <p className="text-sm font-medium text-slate-500 mt-1">{(attachedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleRemoveFile}
                                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                                        title="파일 삭제"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    <Button
                                        onClick={handleStartAnalysis}
                                        size="lg"
                                        className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg h-14 shadow-md shadow-teal-200"
                                    >
                                        AI로 분석 시작하기
                                    </Button>
                                    <p className="text-center text-xs text-slate-400">
                                        버튼을 누르면 문서 내용을 자동으로 분석합니다.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <label
                                htmlFor="file-upload"
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center transition-all cursor-pointer bg-white group min-h-[400px]",
                                    isDragging ? "border-teal-500 bg-teal-50/50 scale-[1.01]" : "border-slate-300 hover:border-teal-400 hover:bg-slate-50/50"
                                )}
                            >
                                <div className={cn("w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors shadow-sm", isDragging ? "bg-teal-100" : "bg-white border border-slate-100 group-hover:border-teal-100 group-hover:bg-teal-50")}>
                                    <Upload className={cn("w-10 h-10 transition-colors", isDragging ? "text-teal-600" : "text-slate-300 group-hover:text-teal-500")} />
                                </div>
                                <h3 className="text-2xl font-bold text-slate-900 mb-3">구매 목록 업로드</h3>
                                <p className="text-slate-500 text-base mb-10 leading-relaxed max-w-sm mx-auto">
                                    이미지(jpg,png,jpeg,gif)등 파일을 이곳에 드래그하거나<br />
                                    <span className="text-teal-600 font-bold underline decoration-teal-300 underline-offset-4">클릭하여 선택</span>해주세요.
                                </p>
                                <div className="inline-flex px-8 py-4 rounded-xl bg-teal-600 text-white font-bold text-lg shadow-lg shadow-teal-200 group-hover:bg-teal-700 group-hover:shadow-teal-300 group-hover:-translate-y-0.5 transition-all">
                                    사진파일 선택하기
                                </div>
                            </label>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Notification Toast */}
            <AnimatePresence>
                {notification && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, x: "-50%" }}
                        animate={{ opacity: 1, y: 0, x: "-50%" }}
                        exit={{ opacity: 0, y: 20, x: "-50%" }}
                        className="fixed bottom-40 left-1/2 bg-slate-900/90 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3 z-[110] backdrop-blur"
                    >
                        <CheckCircle className="w-5 h-5 text-teal-400" />
                        <span className="text-sm font-medium">{notification}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </CalmPageShell>
    );
}
