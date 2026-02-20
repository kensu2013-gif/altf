import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
    console.log(`Fetching inventory from ${INVENTORY_URL}...`);
    try {
        const response = await fetch(INVENTORY_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

        const rawData = await response.json();

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
            // User confirmed: ready_qty = Yangsan, sh_qty = Sihwa
            const shQty = Number(row.sh_qty) || 0;
            const ysQty = Number(row.ready_qty) || 0;

            // Recalculate Total Stock as the sum
            const currentStock = shQty + ysQty;

            // Stock logic preservation
            let stockStatus = status;
            if (!stockStatus || stockStatus === 'undefined') {
                stockStatus = currentStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK';
            }

            let locationStock = {};
            // Force explicit keys for the UI
            if (shQty > 0) locationStock['시화'] = shQty;
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
                // Pass others if needed
                // markingWaitQty removed
                location1: row.location1,
                maker1: row.maker1,
                shQty: Number(row.sh_qty) || 0,
                marking_wait_qty: Number(row.marking_wait_qty) || 0,

                // Supplier fields
                base_price: Number(row.base_price) || 0,
                rate_pct: Number(row.rate_pct) || 0,
                rate_act: Number(row.rate_act) || 0,
                rate_act2: Number(row.rate_act2) || 0
            };
        });

        if (processed.length > 0) {
            fs.writeFileSync(path.join(__dirname, 'debug_values.txt'), JSON.stringify(processed[0], null, 2));
        }

        const jsonContent = JSON.stringify(processed, null, 2);
        fs.writeFileSync(OUTPUT_PATH, jsonContent, 'utf-8');

        console.log(`✅ Successfully updated ${OUTPUT_PATH}`);
        console.log(`Total records: ${processed.length}`);

    } catch (error) {
        console.error('❌ Failed to update inventory:', error);
        process.exit(1);
    }
}

updateInventory();
