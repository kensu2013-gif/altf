import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { uploadInventoryToS3 } from '../s3-db.js';
import os from 'os';

// Configure dotenv to read .env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const INVENTORY_URL = 'https://altf-web-data-prod.s3.ap-northeast-2.amazonaws.com/public/inventory/inventory.json';
const OUTPUT_PATH = path.join(__dirname, '../public/api/inventory/inventory.json');
const EFFECTIVE_DATE = new Date('2026-06-15T00:00:00+09:00');


// --- Helper Functions ---

function formatSize(rawSize) {
    if (!rawSize) return '';
    let formatted = rawSize.trim().toUpperCase();
    // Remove leading letters and dashes (e.g. S-1-1/2 -> 1-1/2)
    // User rule: Size must start with a number.
    formatted = formatted.replace(/^[A-Z]+-?/, '');
    formatted = formatted.replace(/\s*x\s*/gi, ' X ');
    return formatted;
}

function formatThickness(rawThickness) {
    if (!rawThickness) return '';
    let t = rawThickness.trim().toUpperCase();
    // XX-S -> XX
    if (t === 'XX-S') return 'XX';
    return t;
}

function parseSku(sku) {
    if (!sku) {
        return { name: '', thickness: '', size: '', material: '' };
    }
    const parts = sku.split('-');
    if (parts.length < 3) {
        return {
            name: parts[0] || '',
            thickness: parts[1] || '',
            size: '',
            material: ''
        };
    }

    const primaryPrefixes = ['STS', 'WP'];
    const otherPrefixes = [
        'ALLOY', 'C276', 'C706', 'C715', 'N022', 'N044', 'PG37', 
        'S318', 'S322', 'S327', 'SPP', 'STSB', 'WPB', 'WPHC'
    ];

    let materialIndex = -1;
    // Search for a part starting with STS or WP first (primary)
    for (let i = 2; i < parts.length; i++) {
        const partUpper = parts[i].toUpperCase();
        if (primaryPrefixes.some(prefix => partUpper.startsWith(prefix))) {
            materialIndex = i;
            break;
        }
    }

    // If not found, check the other prefixes
    if (materialIndex === -1) {
        for (let i = 2; i < parts.length; i++) {
            const partUpper = parts[i].toUpperCase();
            if (otherPrefixes.some(prefix => partUpper.startsWith(prefix))) {
                materialIndex = i;
                break;
            }
        }
    }

    if (materialIndex !== -1) {
        return {
            name: parts[0] || '',
            thickness: parts[1] || '',
            size: parts.slice(2, materialIndex).join('-'),
            material: parts.slice(materialIndex).join('-')
        };
    }

    // Fallback if no prefix is matched
    if (parts.length >= 4) {
        return {
            name: parts[0] || '',
            thickness: parts[1] || '',
            size: parts.slice(2, parts.length - 1).join('-'),
            material: parts[parts.length - 1] || ''
        };
    }

    return {
        name: parts[0] || '',
        thickness: parts[1] || '',
        size: parts[2] || '',
        material: ''
    };
}

// --- Main Execution ---

async function updateInventory() {
    const homedir = os.homedir();
    const downloadsPaths = [
        path.join(homedir, 'Downloads/inventory (1).json'),
        path.join(homedir, 'Downloads/inventory.json')
    ];

    let localFileUsed = false;
    let rawData = null;

    for (const p of downloadsPaths) {
        if (fs.existsSync(p)) {
            console.log(`[update-inventory] Found local inventory source in Downloads at: ${p}`);
            try {
                const fileContent = fs.readFileSync(p, 'utf-8');
                rawData = JSON.parse(fileContent);
                localFileUsed = true;
                break;
            } catch (err) {
                console.warn(`[update-inventory] Failed to read local file ${p}:`, err);
            }
        }
    }

    try {
        if (!localFileUsed) {
            const localRawPath = path.join(__dirname, '../s3_raw.json');
            const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

            if (fs.existsSync(localRawPath) && !isProd) {
                console.log(`[Inventory Source] Local development detected. Prioritizing local raw source: ${localRawPath}`);
                const localRawContent = fs.readFileSync(localRawPath, 'utf8');
                rawData = JSON.parse(localRawContent);
            } else {
                console.log(`[Inventory Source] Production environment or missing local source. Fetching from S3: ${INVENTORY_URL}...`);
                const fetchController = new AbortController();
                const fetchTimeout = setTimeout(() => fetchController.abort(), 10000);
                try {
                    const response = await fetch(INVENTORY_URL, { signal: fetchController.signal });
                    clearTimeout(fetchTimeout);
                    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    rawData = await response.json();
                } catch (fetchErr) {
                    clearTimeout(fetchTimeout);
                    if (fetchErr.name === 'AbortError') {
                        throw new Error(`Fetch timed out for ${INVENTORY_URL} after 10000ms`);
                    }
                    throw fetchErr;
                }
            }
        }

        let arr = [];
        if (Array.isArray(rawData)) {
            arr = rawData;
        } else if (rawData && Array.isArray(rawData.items)) {
            arr = rawData.items;
        } else {
            console.log('Unknown data structure, attempting to use as is if array, else empty');
            if (Array.isArray(rawData)) arr = rawData;
        }

        // Golden baseline backup path (has accurate Busan 742 items and Sihwa 493 items)
        const goldenBackupPath = path.join(__dirname, '../storage/inventory/backup_1792630199827_inventory.json');
        let goldenMap = new Map();
        if (fs.existsSync(goldenBackupPath)) {
            try {
                const goldenRaw = JSON.parse(fs.readFileSync(goldenBackupPath, 'utf8'));
                const goldenItems = Array.isArray(goldenRaw) ? goldenRaw : (goldenRaw.items || []);
                goldenItems.forEach(g => {
                    const k = g.sku_key || g.id;
                    if (k) goldenMap.set(k, g);
                });
                console.log(`[update-inventory] Loaded ${goldenMap.size} golden baseline items from backup_1792630199827_inventory.json`);
            } catch (gErr) {
                console.warn('[update-inventory] Failed reading golden backup:', gErr.message);
            }
        }

        // Merge missing Busan items and restore accurate Sihwa & Busan stock quantities from golden baseline
        arr = arr.map(row => {
            const k = row.sku_key || row.id;
            const golden = goldenMap.get(k);
            if (!golden) return row;

            const isGoldenBusan = golden.location1 === '부산' || golden.location === '부산' || golden.maker1 === '태일';
            const isGoldenSihwa = !isGoldenBusan && (golden.location1 === '시화' || golden.location1 === '시흥' || golden.location === '시화' || golden.location === '시흥');

            // 1. Restore Busan items (Taeil Busan: 742 items, ~5억 value)
            if (isGoldenBusan) {
                const goldenBs = Number(golden.sh_qty) || Number(golden.shQty) || (golden.locationStock && Number(golden.locationStock['부산'])) || 0;
                return {
                    ...row,
                    location: '부산',
                    location1: '부산',
                    maker: '태일',
                    maker1: '태일',
                    sh_qty: '',
                    bs_qty: goldenBs,
                    locationStock: {
                        ...(row.locationStock || {}),
                        '부산': goldenBs
                    }
                };
            }

            // 2. Restore Sihwa items (Daekyung Sihwa/Siheung: 493 items, ~3억 value)
            if (isGoldenSihwa) {
                const goldenSh = Number(golden.sh_qty) || Number(golden.shQty) || (golden.locationStock && Number(golden.locationStock['시화'])) || 0;
                return {
                    ...row,
                    location1: '시흥',
                    maker1: '대경',
                    sh_qty: goldenSh,
                    locationStock: {
                        ...(row.locationStock || {}),
                        '시화': goldenSh
                    }
                };
            }

            return row;
        });

        // If any Busan items in golden are completely missing in arr, append them
        let appendedCount = 0;
        const currentKeys = new Set(arr.map(r => r.sku_key || r.id));
        goldenMap.forEach((golden, k) => {
            const isGoldenBusan = golden.location1 === '부산' || golden.location === '부산' || golden.maker1 === '태일';
            if (isGoldenBusan && !currentKeys.has(k)) {
                arr.push(golden);
                appendedCount++;
            }
        });
        if (appendedCount > 0) {
            console.log(`[update-inventory] Appended ${appendedCount} missing Busan items from golden baseline`);
        }

        if (arr.length > 0) {
            const keys = Object.keys(arr[0]);
            fs.writeFileSync(path.join(__dirname, 'debug_keys.txt'), JSON.stringify(keys, null, 2));
        }

        console.log(`Fetched/Prepared ${arr.length} items. Mapping...`);

        const processed = arr.map(row => {
            // Raw Keys Mapping without Decryption
            const id = row.id || row.sku_key;
            const name = row.name || row.item;
            
            const parsed = parseSku(id || '');
            const thickness = parsed.thickness || row.thickness;
            const size = parsed.size || row.size;
            const material = parsed.material || row.material;
            const priceVal = row.unitPrice || row.final_price || row.price;
            const status = row.stockStatus;
            const maker = row.maker;

            // Safe Parsing
            const base_price_raw = Number(row.base_price) || 0;
            let rate_pct = Number(row.rate_pct) || 0;
            let rate_act = Number(row.rate_act) || 0;
            let rate_act2 = Number(row.rate_act2) || 0;

            const isAfterEffectiveDate = Date.now() >= EFFECTIVE_DATE.getTime();
            if (isAfterEffectiveDate) {
                if (rate_pct === 65) rate_pct = 47;
                else if (rate_pct === 35) rate_pct = 25;

                if (rate_act === 65) rate_act = 47;
                else if (rate_act === 35) rate_act = 25;

                if (rate_act2 === 65) rate_act2 = 47;
                else if (rate_act2 === 35) rate_act2 = 25;
            }

            let unitPrice = Number(priceVal) || 0;
            if (isAfterEffectiveDate && base_price_raw > 0) {
                if (rate_pct > 0) {
                    unitPrice = Math.round((base_price_raw * (100 - rate_pct) / 100) / 10) * 10;
                } else {
                    unitPrice = base_price_raw;
                }
            }

            // LocationStock Logic: Explicitly divide Busan vs Sihwa vs Yangsan
            const isBusan = row.location1 === '부산' || 
                            row.location === '부산' || 
                            row.maker1 === '태일' || 
                            row.maker === '태일' || 
                            (row.location1 && String(row.location1).includes('부산')) || 
                            (row.location && String(row.location).includes('부산'));

            const isSihwa = !isBusan && (
                row.location1 === '시흥' || row.location1 === '시화' || 
                row.location === '시흥' || row.location === '시화' || 
                (row.location1 && String(row.location1).includes('시흥')) || 
                (row.location1 && String(row.location1).includes('시화'))
            );

            let shQty = 0;
            let bsQty = 0;
            let ysQty = 0;

            // Check existing locationStock if present
            if (row.locationStock && typeof row.locationStock === 'object') {
                if (row.locationStock['부산'] !== undefined) bsQty = Number(row.locationStock['부산']) || 0;
                if (row.locationStock['시화'] !== undefined) shQty = Number(row.locationStock['시화']) || 0;
                if (row.locationStock['서울'] !== undefined) shQty = Math.max(shQty, Number(row.locationStock['서울']) || 0);
                if (row.locationStock['양산'] !== undefined) ysQty = Number(row.locationStock['양산']) || 0;
            }

            const rawShQty = row.sh_qty !== undefined && row.sh_qty !== null && row.sh_qty !== '' 
                ? Number(row.sh_qty) 
                : (row.shQty !== undefined ? Number(row.shQty) : 0);

            const rawReadyQty = row.ready_qty !== undefined && row.ready_qty !== null && row.ready_qty !== '' 
                ? Number(row.ready_qty) 
                : 0;

            if (isBusan) {
                if (rawShQty > 0) bsQty = rawShQty;
                else if (bsQty === 0 && row.locationStock && row.locationStock['부산']) bsQty = Number(row.locationStock['부산']) || 0;
                shQty = 0; // Busan stock must NEVER be counted as Sihwa stock
                if (rawReadyQty > 0 && (row.location === '양산' || row.location1 === '양산')) {
                    ysQty = rawReadyQty;
                }
            } else {
                if (rawShQty > 0) shQty = rawShQty;
                if (rawReadyQty > 0) ysQty = rawReadyQty;
            }

            const locationStock = {};
            if (bsQty > 0) locationStock['부산'] = bsQty;
            if (shQty > 0) locationStock['시화'] = shQty;
            if (ysQty > 0) locationStock['양산'] = ysQty;

            const currentStock = bsQty + shQty + ysQty;

            let stockStatus = status;
            if (!stockStatus || stockStatus === 'undefined') {
                stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
            }

            return {
                id,
                name: name ? name.trim() : '',
                thickness: thickness ? formatThickness(thickness) : '',
                size: size ? formatSize(size) : '',
                material: material ? material.trim() : '',
                unitPrice,
                currentStock,
                stockStatus,
                location: isBusan ? '부산' : (isSihwa ? '시흥' : (row.location || '')),
                maker: isBusan ? '태일' : (maker || (ysQty > 0 ? '대경' : '')),
                locationStock,
                location1: isBusan ? '부산' : (isSihwa ? '시흥' : (row.location1 || '')),
                maker1: isBusan ? '태일' : (row.maker1 || (shQty > 0 ? '대경' : '')),
                shQty: isBusan ? 0 : shQty,
                bsQty: bsQty,
                marking_wait_qty: Number(row.marking_wait_qty) || 0,
                odEqKey: row.od_eq_key || row.odEqKey,

                // Supplier fields
                base_price: base_price_raw,
                rate_pct,
                rate_act,
                rate_act2
            };
        });

        // Anti-Gravity: Interpolate missing prices for Busan-Taeil items using Daekyung bend prices via odEqKey
        const priceMap = new Map();
        processed.forEach(p => {
            if (p.base_price > 0 || p.unitPrice > 0) {
                priceMap.set(p.id, {
                    base_price: p.base_price,
                    unitPrice: p.unitPrice,
                    rate_pct: p.rate_pct,
                    rate_act: p.rate_act,
                    rate_act2: p.rate_act2
                });
            }
        });

        processed.forEach(p => {
            if (p.base_price === 0 && p.unitPrice === 0) {
                const eqKey = p.odEqKey;
                if (!eqKey) return;

                if (priceMap.has(eqKey)) {
                    const eqPrice = priceMap.get(eqKey);
                    p.base_price = eqPrice.base_price;
                    p.unitPrice = eqPrice.unitPrice;
                    p.rate_pct = eqPrice.rate_pct;
                    p.rate_act = eqPrice.rate_act;
                    p.rate_act2 = eqPrice.rate_act2;
                } else {
                    // Normalize slash in material (e.g., STS304/L-S -> STS304-S, STS316/L-W -> STS316-W)
                    const normalizedKeys = [];
                    if (eqKey.includes('/L')) {
                        normalizedKeys.push(eqKey.replace('/L', '')); // e.g. STS304-S
                        normalizedKeys.push(eqKey.replace('/L', 'L')); // e.g. STS304L-S
                    }
                    if (eqKey.includes('304/L')) {
                        normalizedKeys.push(eqKey.replace('304/L', '304'));
                        normalizedKeys.push(eqKey.replace('304/L', '304L'));
                    }
                    if (eqKey.includes('316/L')) {
                        normalizedKeys.push(eqKey.replace('316/L', '316'));
                        normalizedKeys.push(eqKey.replace('316/L', '316L'));
                    }

                    for (const altKey of normalizedKeys) {
                        if (priceMap.has(altKey)) {
                            const eqPrice = priceMap.get(altKey);
                            p.base_price = eqPrice.base_price;
                            p.unitPrice = eqPrice.unitPrice;
                            p.rate_pct = eqPrice.rate_pct;
                            p.rate_act = eqPrice.rate_act;
                            p.rate_act2 = eqPrice.rate_act2;
                            break;
                        }
                    }
                }
            }
        });



        if (processed.length > 0) {
            fs.writeFileSync(path.join(__dirname, 'debug_values.txt'), JSON.stringify(processed[0], null, 2));
        }

        const jsonContent = JSON.stringify(processed, null, 2);
        // Ensure parent directory exists recursively (e.g. for Render container deployment)
        const parentDir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(OUTPUT_PATH, jsonContent, 'utf-8');

        console.log(`✅ Successfully updated ${OUTPUT_PATH}`);
        console.log(`Total records: ${processed.length}`);

        // If S3 credentials are set, also upload the processed inventory to S3
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            console.log('[S3] AWS credentials detected. Uploading updated inventory to S3...');
            try {
                await uploadInventoryToS3(processed);
                console.log('✅ Successfully uploaded updated inventory to S3.');
            } catch (s3Err) {
                console.error('❌ Failed to upload inventory to S3:', s3Err.message);
            }
        } else {
            console.log('[S3] No AWS credentials detected in environment. Skipping S3 upload.');
        }

    } catch (error) {
        console.error('❌ Failed to update inventory:', error);
        if (fs.existsSync(OUTPUT_PATH)) {
            console.log('⚠️ Using existing local inventory.json file. Build will continue.');
        }
        // Render 빌드가 일시적 S3 에러로 중단되지 않도록 정상 종료
        process.exit(0);
    }
}

updateInventory();
