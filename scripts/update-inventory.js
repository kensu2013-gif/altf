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

        if (arr.length > 0) {
            const keys = Object.keys(arr[0]);
            fs.writeFileSync(path.join(__dirname, 'debug_keys.txt'), JSON.stringify(keys, null, 2));
        }

        console.log(`Fetched ${arr.length} items. Mapping...`);

        // Debug: Find first item with stock and log it
        const stockItem = arr.find(r => r.ready_qty != 0 || r.sh_qty != 0);
        if (stockItem) {
            console.log('DEBUG RAW STOCK ITEM:', JSON.stringify({
                id: stockItem.sku_key || stockItem.id,
                ready_qty: stockItem.ready_qty,
                type_ready: typeof stockItem.ready_qty,
                sh_qty: stockItem.sh_qty,
                type_sh: typeof stockItem.sh_qty
            }, null, 2));
        }

        const processed = arr.map(row => {
            // Raw Keys Mapping without Decryption
            const id = row.id || row.sku_key;
            const name = row.name || row.item;
            
            const parsed = parseSku(id || '');
            const thickness = parsed.thickness || row.thickness;
            const size = parsed.size || row.size;
            const material = parsed.material || row.material;
            const priceVal = row.unitPrice || row.final_price || row.price;
            const stockVal = row.currentStock || row.ready_qty;
            const status = row.stockStatus;
            const location = row.location;
            const maker = row.maker;
            const locStockRaw = row.locationStock;

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

            // LocationStock Logic
            // User confirmed: ready_qty = Yangsan, sh_qty = Sihwa
            // Fallback to camelCase fields if raw snake_case keys are missing (to prevent zeroing out already-processed JSONs)
            let shQty = 0;
            if (row.sh_qty !== undefined && row.sh_qty !== null && row.sh_qty !== '') {
                shQty = Number(row.sh_qty);
            } else if (row.shQty !== undefined) {
                shQty = Number(row.shQty);
            } else if (row.locationStock && row.locationStock['시화'] !== undefined) {
                shQty = Number(row.locationStock['시화']);
            }

            let ysQty = 0;
            if (row.ready_qty !== undefined && row.ready_qty !== null && row.ready_qty !== '') {
                ysQty = Number(row.ready_qty);
            } else if (row.locationStock && row.locationStock['양산'] !== undefined) {
                ysQty = Number(row.locationStock['양산']);
            } else if (row.currentStock !== undefined) {
                // In already-processed JSON, ysQty equals currentStock - shQty
                ysQty = Math.max(0, (Number(row.currentStock) || 0) - shQty);
            }

            // Recalculate Total Stock as the sum
            const currentStock = shQty + ysQty;

            // Stock logic preservation
            let stockStatus = status;
            if (!stockStatus || stockStatus === 'undefined') {
                stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
            }

            const isBusan = row.location1 === '부산' || (row.location1 && String(row.location1).includes('부산'));

            let locationStock = {};
            // Force explicit keys for the UI
            if (isBusan) {
                if (shQty > 0) locationStock['부산'] = shQty;
            } else {
                if (shQty > 0) locationStock['시화'] = shQty;
            }
            if (ysQty > 0) locationStock['양산'] = ysQty;

            // Fallback: If total > 0 but locationStock empty (e.g. data missing but Stock present?), assign all to 'Main'?
            if (currentStock > 0 && Object.keys(locationStock).length === 0) {
                locationStock['Main'] = currentStock;
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
                location: location || '',
                maker: maker || '',
                locationStock,
                location1: row.location1,
                maker1: row.maker1,
                shQty: isBusan ? 0 : shQty,
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
        process.exit(1);
    }
}

updateInventory();
