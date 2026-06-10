import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import os from 'os';

// Configure dotenv to read .env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const INVENTORY_URL = 'https://altf-web-data-prod.s3.ap-northeast-2.amazonaws.com/public/inventory/inventory.json';
const OUTPUT_PATH = path.join(__dirname, '../public/api/inventory/inventory.json');

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

// --- Main Execution ---

async function updateInventory() {
    // Determine user's Downloads directory
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
            console.log(`[update-inventory] No local file found in Downloads. Fetching from S3: ${INVENTORY_URL}...`);
            const response = await fetch(INVENTORY_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
            rawData = await response.json();
        }

        let arr = [];
        if (Array.isArray(rawData)) {
            arr = rawData;
        } else if (rawData && Array.isArray(rawData.items)) {
            arr = rawData.items;
        } else {
            console.warn('Unknown data structure, attempting to use as is if array, else empty');
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
            const thickness = row.thickness;
            const size = row.size;
            const material = row.material;
            const priceVal = row.unitPrice || row.final_price || row.price;
            const stockVal = row.currentStock || row.ready_qty;
            const status = row.stockStatus;
            const location = row.location;
            const maker = row.maker;
            const locStockRaw = row.locationStock;

            // Safe Parsing

            const unitPrice = Number(priceVal) || 0;

            // LocationStock Logic
            let locationStock = {};
            if (row.locationStock && typeof row.locationStock === 'object' && Object.keys(row.locationStock).length > 0) {
                locationStock = { ...row.locationStock };
            }

            // Parse Sihwa stock (shQty) safely supporting both shQty and sh_qty
            const shQty = row.shQty !== undefined ? Number(row.shQty) : (Number(row.sh_qty) || 0);
            
            // Parse Yangsan stock (ysQty) safely supporting both ready_qty and currentStock
            const ysQty = row.ready_qty !== undefined ? Number(row.ready_qty) : (row.currentStock !== undefined ? Number(row.currentStock) : 0);

            // If locationStock is empty/missing, fallback to parsing shQty and ysQty
            if (Object.keys(locationStock).length === 0) {
                if (shQty > 0) locationStock['시화'] = shQty;
                if (ysQty > 0) locationStock['양산'] = ysQty;
            }

            // Recalculate Total Stock from locationStock if available, else fallback to currentStock
            let currentStock = 0;
            if (Object.keys(locationStock).length > 0) {
                currentStock = Object.values(locationStock).reduce((sum, q) => sum + Number(q), 0);
            } else {
                currentStock = row.currentStock !== undefined ? Number(row.currentStock) : (shQty + ysQty);
            }

            // Stock logic preservation
            let stockStatus = status;
            if (!stockStatus || stockStatus === 'undefined') {
                stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
            }

            const basePriceVal = row.base_price !== undefined ? row.base_price : row.basePrice;
            const ratePctVal = row.rate_pct !== undefined ? row.rate_pct : row.ratePct;

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
                // Pass others if needed
                // markingWaitQty removed
                location1: row.location1,
                maker1: row.maker1,
                shQty: shQty,
                marking_wait_qty: Number(row.marking_wait_qty) || 0,
                base_price: basePriceVal !== undefined ? Number(basePriceVal) : undefined,
                rate_pct: ratePctVal !== undefined ? Number(ratePctVal) : undefined
            };
        });

        if (processed.length > 0) {
            fs.writeFileSync(path.join(__dirname, 'debug_values.txt'), JSON.stringify(processed[0], null, 2));
        }

        const jsonContent = JSON.stringify(processed, null, 2);
        const outputDir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(OUTPUT_PATH, jsonContent, 'utf-8');

        console.log(`✅ Successfully updated ${OUTPUT_PATH}`);
        console.log(`Total records: ${processed.length}`);

    } catch (error) {
        console.error('❌ Failed to update inventory:', error);
        process.exit(1);
    }
}

updateInventory();
