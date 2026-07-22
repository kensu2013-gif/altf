import http from 'http';
import aromanize from 'aromanize';
import crypto from 'crypto';
import zlib from 'zlib';
import { execSync, exec } from 'child_process';
import { ListObjectVersionsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const PORT = process.env.PORT || 3001;

// --- Persistence Setup ---
import { loadDbFromS3, saveDbToS3, uploadFileToS3, getInventoryFromS3, getPresignedUrlToS3, getPreviousDbVersion, s3Client, BUCKET_NAME } from './s3-db.js';

import multer from 'multer';

// Internal Multer setup for raw HTTP
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
}).single('file');

let db = {
    users: [],
    quotations: [],
    orders: [],
    loginLogs: [],
    inventoryHistory: [],
    customers: [],
    crmEvents: [],
    lastSnapshotDate: null,
    lastSnapshot: null,
    currentSnapshot: null,
    lastDaekyungSnapshot: null,
    currentDaekyungSnapshot: null,
    june12Snapshot: null,
    june12DaekyungSnapshot: null
};

// Load Data
async function loadData() {
    try {
        const json = await loadDbFromS3();
        if (json) {
            db.users = json.users || [];
            db.quotations = json.quotations || [];
            db.orders = json.orders || [];
            db.loginLogs = json.loginLogs || [];
            db.inventoryHistory = json.inventoryHistory || [];
            db.inventorySnapshot = json.inventorySnapshot || null; // Keep legacy for fallback
            db.daekyungSnapshot = json.daekyungSnapshot || null; // Keep legacy for fallback
            db.lastSnapshotDate = json.lastSnapshotDate || null;
            db.lastSnapshot = json.lastSnapshot || json.inventorySnapshot || null;
            db.currentSnapshot = json.currentSnapshot || json.inventorySnapshot || null;
            db.lastDaekyungSnapshot = json.lastDaekyungSnapshot || json.daekyungSnapshot || null;
            db.currentDaekyungSnapshot = json.currentDaekyungSnapshot || json.daekyungSnapshot || null;
            db.june12Snapshot = json.june12Snapshot || null;
            db.june12DaekyungSnapshot = json.june12DaekyungSnapshot || null;
            db.daekyungHistory = json.daekyungHistory || [];
            db.customers = json.customers || [];
            db.crmEvents = json.crmEvents || [];
            console.log(`[API] Loaded data from S3: ${db.users.length} users, ${db.quotations.length} quotes, ${db.orders.length} orders, ${db.loginLogs.length} logs, ${db.inventoryHistory.length} history, ${db.crmEvents.length} crm events, Snapshot Date: ${db.lastSnapshotDate}`);
            
            // Seed Customers if empty
            if (db.customers.length === 0) {
                try {
                    const fs = await import('fs');
                    const initData = fs.readFileSync('./src/data/customers_init.json', 'utf8');
                    db.customers = JSON.parse(initData);
                    console.log(`[API] DB Customers was empty. Seeded ${db.customers.length} from local init file.`);
                    await saveData();
                } catch (e) {
                    console.log(`[API] Failed to seed customers mapping: ${e.message}`);
                }
            // Self-healing: Repair any 0% or missing supplierRate in splitDeliveries
            let ordersRepaired = 0;
            if (db.orders && Array.isArray(db.orders)) {
                db.orders.forEach(order => {
                    if (order.splitDeliveries && Array.isArray(order.splitDeliveries)) {
                        order.splitDeliveries.forEach(d => {
                            const defaultRate = (d.supplier && d.supplier.default_rate && d.supplier.default_rate > 0) ? d.supplier.default_rate : 45;
                            let itemChanged = false;

                            if (Array.isArray(d.items)) {
                                d.items.forEach(item => {
                                    if (!item.supplierRate || item.supplierRate <= 0) {
                                        item.supplierRate = defaultRate;
                                        itemChanged = true;
                                    }
                                });
                            }
                            if (Array.isArray(d.po_items)) {
                                d.po_items.forEach(item => {
                                    if (!item.supplierRate || item.supplierRate <= 0) {
                                        item.supplierRate = defaultRate;
                                        itemChanged = true;
                                    }
                                });
                            }

                            if (itemChanged) {
                                ordersRepaired++;
                                const targetList = d.po_items && d.po_items.length > 0 ? d.po_items : d.items;
                                if (targetList) {
                                    const newTotal = targetList.reduce((acc, item) => {
                                        const basePrice = item.base_price || item.unitPrice || 0;
                                        const rate = (item.supplierRate && item.supplierRate > 0) ? item.supplierRate : defaultRate;
                                        let supplierPrice = item.supplierPriceOverride;
                                        if (supplierPrice === undefined) {
                                            supplierPrice = Math.round((basePrice * (100 - rate) / 100) / 10) * 10;
                                        }
                                        return acc + (supplierPrice * item.quantity);
                                    }, 0);
                                    if (newTotal > 0) d.totalAmount = newTotal;
                                }
                            }
                        });
                    }
                });
            }
            if (ordersRepaired > 0) {
                console.log(`[SELF-HEAL] Successfully repaired 0% supplierRate for ${ordersRepaired} split deliveries.`);
                await saveData();
            }

            // Self-healing recovery for missing daily diffs due to initialization overwrite (Disabled)
            if (false && (!db.lastSnapshot || Object.keys(db.lastSnapshot).length === 0 || 
                !db.currentSnapshot || Object.keys(db.currentSnapshot).length === 0)) {
                console.log(`[RECOVERY] Sihwa Snapshot empty or missing. Recovering baseline snapshot...`);
                let recovered = false;
                // Try S3 version recovery to get the exact previous state
                try {
                    console.log('[RECOVERY] Attempting S3 database version recovery...');
                    const oldDb = await getPreviousDbVersion(new Date(Date.now() - 60 * 1000).toISOString());
                    if (oldDb) {
                        const recoveredSihwa = oldDb.currentSnapshot || oldDb.inventorySnapshot || oldDb.lastSnapshot;
                        if (recoveredSihwa && Object.keys(recoveredSihwa).length > 0) {
                            db.lastSnapshot = recoveredSihwa;
                            db.currentSnapshot = recoveredSihwa;
                            console.log('[RECOVERY] Restored Sihwa lastSnapshot from S3 version history.');
                            recovered = true;
                        }
                    }
                } catch (s3Err) {
                    console.log(`[RECOVERY] S3 version recovery not available: ${s3Err.message}`);
                }
                if (recovered) {
                    console.log('[RECOVERY] Saving recovered snapshots to S3...');
                    await saveData();
                }
            }

            // Temporary self-healing block to correct the June 8, 11, and 12 history anomalies
            try {
                let historyCorrupted = false;
                const targetDates = ['2026-06-08', '2026-06-11', '2026-06-12'];

                // Clean inventoryHistory
                if (db.inventoryHistory && Array.isArray(db.inventoryHistory)) {
                    db.inventoryHistory.forEach(h => {
                        if (targetDates.includes(h.date)) {
                            const originalLength = h.diff ? h.diff.length : 0;
                            h.diff = (h.diff || []).filter(d => Math.abs(d.change) < 50);
                            const newLength = h.diff.length;
                            if (originalLength !== newLength) {
                                historyCorrupted = true;
                                console.log(`[CLEANUP] Filtered inventoryHistory on ${h.date}: ${originalLength} -> ${newLength}`);
                            }
                        }
                    });
                }

                // Clean daekyungHistory
                if (db.daekyungHistory && Array.isArray(db.daekyungHistory)) {
                    db.daekyungHistory.forEach(h => {
                        if (targetDates.includes(h.date)) {
                            const originalLength = h.diff ? h.diff.length : 0;
                            h.diff = (h.diff || []).filter(d => Math.abs(d.change) < 50);
                            const newLength = h.diff.length;
                            if (originalLength !== newLength) {
                                historyCorrupted = true;
                                console.log(`[CLEANUP] Filtered daekyungHistory on ${h.date}: ${originalLength} -> ${newLength}`);
                            }
                        }
                    });
                }

                // Correct baseline (lastSnapshot / lastDaekyungSnapshot) for today (June 12th) to prevent recalculated spikes
                if (db.lastSnapshot && db.currentSnapshot && db.lastSnapshotDate === '2026-06-12') {
                    let baselineRepaired = false;
                    const inventoryData = await getInventoryFromS3();
                    const itemsArr = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || []);
                    
                    const sihwaStockMap = {};
                    itemsArr.forEach(item => {
                        const maker = item.maker || item.maker1 || '';
                        if (maker !== '대경') return;

                        let shStock = 0;
                        let isSihwa = false;
                        const locationStock = {};
                        if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                            for (const [key, qty] of Object.entries(item.locationStock)) {
                                const newKey = (key === '서울' || key === '서울재고') ? '시화' : key;
                                locationStock[newKey] = (locationStock[newKey] || 0) + Number(qty);
                            }
                        } else {
                            const shQtyVal = item.sh_qty !== undefined ? item.sh_qty : item.shQty;
                            if (item.location1 && shQtyVal !== undefined) {
                                const loc1 = (item.location1 === '서울' || item.location1 === '서울재고') ? '시화' : item.location1;
                                locationStock[loc1] = (locationStock[loc1] || 0) + Number(shQtyVal);
                            }
                        }
                        if (locationStock['시화'] !== undefined) {
                            shStock = locationStock['시화'];
                            isSihwa = true;
                        }
                        const id = item.sku_key || item.id;
                        if (id && isSihwa) {
                            sihwaStockMap[id] = shStock;
                        }
                    });

                    for (const [id, liveQty] of Object.entries(sihwaStockMap)) {
                        const prev = db.lastSnapshot[id];
                        if (prev) {
                            const sh_from = prev.sh_qty ?? 0;
                            if (Math.abs(liveQty - sh_from) >= 50) {
                                console.log(`[CLEANUP-BASELINE] Sihwa item ${id} baseline aligned: ${sh_from} -> ${liveQty}`);
                                prev.sh_qty = liveQty;
                                prev.stock = liveQty;
                                baselineRepaired = true;
                            }
                        } else {
                            if (liveQty >= 50) {
                                console.log(`[CLEANUP-BASELINE] Sihwa item ${id} added to baseline to prevent jump: 0 -> ${liveQty}`);
                                db.lastSnapshot[id] = { name: id.split('-')[0], stock: liveQty, sh_qty: liveQty };
                                baselineRepaired = true;
                            }
                        }
                    }

                    const ysStockMap = {};
                    itemsArr.forEach(item => {
                        const maker = item.maker || item.maker1 || '';
                        if (maker !== '대경') return;

                        let ysStock = 0;
                        const locationStock = {};
                        if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                            for (const [key, qty] of Object.entries(item.locationStock)) {
                                locationStock[key] = (locationStock[key] || 0) + Number(qty);
                            }
                        } else {
                            const ysQtyVal = item.ready_qty !== undefined ? item.ready_qty : item.ysQty;
                            if (item.location && ysQtyVal !== undefined) {
                                locationStock[item.location] = (locationStock[item.location] || 0) + Number(ysQtyVal);
                            }
                        }
                        if (locationStock['양산'] !== undefined) {
                            ysStock = locationStock['양산'];
                        }
                        const id = item.sku_key || item.id;
                        if (id) {
                            ysStockMap[id] = ysStock;
                        }
                    });

                    for (const [id, liveQty] of Object.entries(ysStockMap)) {
                        const prev = db.lastDaekyungSnapshot[id];
                        if (prev) {
                            const ys_from = prev.ys_qty ?? 0;
                            if (Math.abs(liveQty - ys_from) >= 50) {
                                console.log(`[CLEANUP-BASELINE] Daekyung item ${id} baseline aligned: ${ys_from} -> ${liveQty}`);
                                prev.ys_qty = liveQty;
                                prev.stock = liveQty;
                                baselineRepaired = true;
                            }
                        } else {
                            if (liveQty >= 50) {
                                console.log(`[CLEANUP-BASELINE] Daekyung item ${id} added to baseline to prevent jump: 0 -> ${liveQty}`);
                                db.lastDaekyungSnapshot[id] = { name: id.split('-')[0], stock: liveQty, ys_qty: liveQty };
                                baselineRepaired = true;
                            }
                        }
                    }

                    if (baselineRepaired) {
                        historyCorrupted = true;
                    }
                }

                if (historyCorrupted) {
                    console.log('[CLEANUP] Saving corrected database to S3...');
                    await saveData();
                    console.log('[CLEANUP] Corrected database saved successfully.');
                }
            } catch (cleanupErr) {
                console.error('[CLEANUP] Error during self-healing database cleanup:', cleanupErr);
            }

            // June 19 self-healing block removed
        } else {
            // Seed Initial Admin if file doesn't exist
            db.users = [
                {
                    id: 'admin-user-id',
                    email: 'admin@altf.kr',
                    password: '1127foa12^^',
                    companyName: 'AltF Admin',
                    bizNo: '000-00-00000',
                    contactName: 'Admin',
                    phone: '010-0000-0000',
                    address: 'Seoul, Korea',
                    role: 'MASTER',
                    createdAt: new Date().toISOString(),
                    agreedToTerms: true,
                    agreedToPrivacy: true,
                    agreedToMarketing: true,
                    consentDate: new Date().toISOString(),
                    status: 'APPROVED'
                }
            ];
            await saveData();
        }
    } catch (e) {
        console.error('[API] Failed to load data from S3:', e);
        const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        if (isProd) {
            console.error('[API] Critical error: Database load failed in production. Crashing server to prevent corrupted state.');
            throw e;
        }
    }
}

// Save Data
async function saveData() {
    try {
        await saveDbToS3(db);
        // console.log('[API] Data saved to S3');
    } catch (e) {
        console.error('[API] Failed to save data to S3:', e);
        throw e; // Throw so that routes can catch it and return 500
    }
}

// Database Serialization Mutex Lock to prevent concurrency conflicts (RMW race conditions) in the background
let isSavingS3 = false;
let saveS3Pending = false;

async function queueSave() {
    if (isSavingS3) {
        saveS3Pending = true;
        return;
    }
    isSavingS3 = true;
    try {
        await saveData();
    } catch (e) {
        console.error('[API Queue] Background save to S3 failed:', e);
    } finally {
        isSavingS3 = false;
        if (saveS3Pending) {
            saveS3Pending = false;
            // Schedule in next tick to prevent stack overflow
            setImmediate(queueSave);
        }
    }
}

async function updateDb(updater) {
    try {
        const result = await updater();
        if (!result || result._bypassSave !== true) {
            queueSave();
        }
        if (result && result._bypassSave === true) {
            return result.data;
        }
        return result;
    } catch (err) {
        console.error('[API] Error in updateDb operation:', err);
        throw err;
    }
}

// Initialize
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
if (!isProd) {
    try {
        console.log('[API Startup] Generating inventory from local raw source s3_raw.json...');
        execSync('node scripts/update-inventory.js', { stdio: 'inherit' });
        console.log('[API Startup] Inventory generation completed successfully.');
    } catch (e) {
        console.error('[API Startup] Failed to generate inventory on startup:', e.message);
    }
} else {
    console.log('[API Startup] Production environment detected. Skipping synchronous inventory generation on startup.');
}

await loadData();

// References for easier access (optional since we operate on db object directly now)
// We will use db.users, db.quotations, db.orders directly in code.

const sessionStore = new Map(); // session_id -> items[]

// --- Concurrent Login & Active User Tracking ---
const activeSessions = new Map(); // token -> { userId, email, companyName, role, lastSeen, activity, ip }
const SESSION_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours

// Periodically clean up expired sessions
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (now - session.lastSeen > SESSION_TIMEOUT_MS) {
            activeSessions.delete(token);
        }
    }
}, 60 * 1000); // Check every minute

// --- Global Memory Cache ---
let inventoryCache = {
    gzippedData: null,
    rawData: null,
    timestamp: 0
};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let inventoryLoadPromise = null; // deduplicates concurrent cache-miss S3 fetches

// Watch local inventory file for changes in development to automatically invalidate memory cache
if (process.env.NODE_ENV !== 'production') {
    try {
        const fs = await import('fs');
        const localPath = './public/api/inventory/inventory.json';
        if (fs.existsSync(localPath)) {
            fs.watch(localPath, (eventType) => {
                if (eventType === 'change') {
                    console.log(`[API] Local inventory.json changed on disk. Invalidating memory cache...`);
                    inventoryCache.gzippedData = null;
                    inventoryCache.rawData = null;
                    inventoryCache.timestamp = 0;
                }
            });
            console.log(`[API] Watching local file for changes: ${localPath}`);
        }
    } catch (watchErr) {
        console.warn(`[API] Failed to setup file watcher for inventory.json:`, watchErr.message);
    }
}

const sendJsonResponse = (req, res, statusCode, data) => {
    try {
        const raw = JSON.stringify(data);
        const acceptEncoding = req.headers['accept-encoding'] || '';
        if (acceptEncoding.includes('gzip') && raw.length > 2048) {
            zlib.gzip(raw, (err, result) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Compression error' }));
                } else {
                    res.writeHead(statusCode, {
                        'Content-Type': 'application/json',
                        'Content-Encoding': 'gzip'
                    });
                    res.end(result);
                }
            });
        } else {
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(raw);
        }
    } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON parse error' }));
    }
};

const getAuthenticatedSession = (req) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        if (token && activeSessions.has(token)) {
            const session = activeSessions.get(token);
            if (Date.now() - session.lastSeen <= SESSION_TIMEOUT_MS) {
                session.lastSeen = Date.now();
                return session;
            }
        }
    }
    return null;
};

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-requester-id, x-requester-role, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // POST /api/quote/import
    if (req.method === 'POST' && url.pathname === '/api/quote/import') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { session_id, items, status } = data; // Added 'status'

                if (!session_id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing session_id' }));
                    return;
                }

                // Get existing session or init
                let sessionData = sessionStore.get(session_id) || { items: [], status: 'processing' };

                // Append items if present
                if (Array.isArray(items)) {
                    console.log(`[API] Received chunk for session: ${session_id}, items: ${items.length}`);
                    const newItems = items.map(item => {
                        let finalId = item.item_id;

                        // Robust ID Decoding Logic
                        // Source is either explicit b64 field or the ID itself
                        const rawSource = item.item_id_b64 || item.item_id;

                        if (rawSource) {
                            // Heuristic: Real IDs usually contain specific chars NOT found in Base64 (Space, Parens, Quotes)
                            // Base64 set: A-Z a-z 0-9 + / - _ =
                            const isDefinitelyPlainText = /[ ()"]/.test(rawSource);

                            if (!isDefinitelyPlainText) {
                                try {
                                    const decoded = Buffer.from(rawSource, 'base64').toString('utf-8');
                                    // Validation: If decoded string looks like a valid ID (has known ID chars), use it.
                                    if (/[ ()"]/.test(decoded) || decoded.includes('-')) {
                                        finalId = decoded;
                                        console.log(`[API] Decoded Base64 ID: ${rawSource.substring(0, 10)}... -> ${finalId}`);
                                    }
                                } catch (e) {
                                    // Ignore decoding errors, stick to original
                                }
                            }
                        }

                        return {
                            ...item, // Pass through ALL other fields (name, spec, etc.)
                            item_id: finalId,
                            qty: Number(item.qty) || 1
                        };
                    });

                    // Append to existing
                    sessionData.items = [...sessionData.items, ...newItems];
                }

                // Update status if provided (e.g. 'done')
                if (status) {
                    sessionData.status = status;
                    console.log(`[API] Session ${session_id} status updated to: ${status}`);
                }

                sessionStore.set(session_id, sessionData);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, current_count: sessionData.items.length }));
            } catch (e) {
                console.error(e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        });
        return;
    }

    // POST /api/upload/:type
    // type: member, quote, order, po
    if (req.method === 'POST' && url.pathname.startsWith('/api/upload/')) {
        uploadMiddleware(req, res, async (err) => {
            if (err) {
                console.error('[API] File upload parsing error:', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: err.message }));
            }

            try {
                if (!req.file) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'No file uploaded' }));
                }

                const uploadType = url.pathname.split('/')[3] || 'misc'; // member, quote, etc.
                const userRef = req.body.refId || 'unknown'; // Optional: ID to categorize folders

                let targetFolder = 'documents/misc';
                if (uploadType === 'member') targetFolder = `documents/members/${userRef}`;
                if (uploadType === 'quote') targetFolder = `documents/quotes/${userRef}`;
                if (uploadType === 'order') targetFolder = `documents/orders/${userRef}`;
                if (uploadType === 'po') targetFolder = `documents/purchase_orders/${userRef}`;

                const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); // Handle unicode filenames

                const fileUtl = await uploadFileToS3(targetFolder, originalName, req.file.buffer, req.file.mimetype);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ url: fileUtl, filename: originalName }));

            } catch (error) {
                console.error('[API] S3 Upload error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'S3 Upload Failed' }));
            }
        });
        return;
    }

    // GET /api/download
    if (req.method === 'GET' && url.pathname === '/api/download') {
        try {
            const S3Url = url.searchParams.get('url');
            if (!S3Url) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Missing url parameter' }));
            }
            // Parse Key from URL (e.g. https://bucket.s3.region.amazonaws.com/documents/quotes/...)
            const parsed = new URL(S3Url);
            const key = decodeURIComponent(parsed.pathname.slice(1)); // remove leading slash & decode Unicode

            // Generate temporary exact presigned URL
            const presignedUrl = await getPresignedUrlToS3(key);

            // Redirect the user to the presigned URL
            res.writeHead(302, { Location: presignedUrl });
            res.end();
        } catch (error) {
            console.error('[API] Presigned URL generation error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid S3 Object' }));
        }
        return;
    }

    // GET /api/quote/session/:session_id
    if (req.method === 'GET' && url.pathname.startsWith('/api/quote/session/')) {
        const sessionId = url.pathname.split('/').pop();
        const sessionData = sessionStore.get(sessionId);

        if (sessionData) {
            // console.log(`[API] Polling hit for session: ${sessionId}, status: ${sessionData.status}, count: ${sessionData.items.length}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sessionData)); // Returns { items: [], status: '...' }
            // Optional: Clear after fetch? No, because we are streaming.
        } else {
            // Return 404 or empty to indicate "not ready"
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
        return;
    }

    // GET /api/inventory/inventory.json
    if (req.method === 'GET' && url.pathname === '/api/inventory/inventory.json') {
        try {
            const now = Date.now();
            const forceRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.get('bypass') === 'true';
            if (forceRefresh) {
                console.log('[API] Forced refresh requested. Running update-inventory.js script...');
                
                // Trigger update-inventory.js with FORCE_S3 env variable to fetch latest raw data and overwrite local JSON file
                await new Promise((resolve, reject) => {
                    exec('node scripts/update-inventory.js', { env: { ...process.env, FORCE_S3: 'true' } }, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`[API Refresh] Failed to execute update-inventory.js:`, error);
                            reject(error);
                        } else {
                            console.log(`[API Refresh] update-inventory.js executed successfully:`, stdout);
                            if (stderr) console.warn(`[API Refresh] update-inventory.js stderr:`, stderr);
                            resolve(stdout);
                        }
                    });
                });

                console.log('[API] Invalidating memory cache...');
                inventoryCache.gzippedData = null;
                inventoryCache.rawData = null;
                inventoryCache.timestamp = 0;
            }

            // Check memory cache first
            // Check memory cache first
            const hasCache = !!inventoryCache.gzippedData;
            const isExpired = (now - inventoryCache.timestamp) > CACHE_TTL;

            const performInventoryUpdate = async (inventoryData, timestamp) => {
                // --- Daily Sihwa/Daekyung Inventory Snapshot Logic ---
                // We no longer automatically commit changes to database on refresh.
                // Instead, we only update db.currentSnapshot and initialize baselines if they are empty.
                try {
                    await updateDb(async () => {
                        const itemsArr = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || []);
                        const sihwaStockMap = {};
                        const ysStockMap = {};
                        
                        itemsArr.forEach(item => {
                            let shStock = 0;
                            let ysStock = 0;

                            // Track maker '대경' and '태일' for local inventory snapshot
                            const maker = item.maker || item.maker1 || '';
                            if (maker !== '대경' && maker !== '태일') {
                                return;
                            }

                            const locationStock = {};
                            if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                                for (const [key, qty] of Object.entries(item.locationStock)) {
                                    const newKey = (key === '서울' || key === '서울재고') ? '시화' : key;
                                    locationStock[newKey] = (locationStock[newKey] || 0) + Number(qty);
                                }
                            } else {
                                const shQtyVal = item.sh_qty !== undefined ? item.sh_qty : item.shQty;
                                const ysQtyVal = item.ready_qty !== undefined ? item.ready_qty : item.ysQty;
                                if (item.location1 && shQtyVal !== undefined) {
                                    const loc1 = (item.location1 === '서울' || item.location1 === '서울재고') ? '시화' : item.location1;
                                    locationStock[loc1] = (locationStock[loc1] || 0) + Number(shQtyVal);
                                }
                                if (item.location && ysQtyVal !== undefined) {
                                    const primaryLoc = (item.location === '서울' || item.location === '서울재고') ? '시화' : item.location;
                                    locationStock[primaryLoc] = (locationStock[primaryLoc] || 0) + Number(ysQtyVal);
                                }
                            }

                            if (locationStock['시화'] !== undefined || locationStock['부산'] !== undefined) {
                                shStock = (locationStock['시화'] || 0) + (locationStock['부산'] || 0);
                            }
                            if (locationStock['양산'] !== undefined) {
                                ysStock = locationStock['양산'];
                            }

                            const id = item.sku_key || item.id;
                            if (id) {
                                sihwaStockMap[id] = { name: item.item || item.name, stock: shStock, sh_qty: shStock };
                                ysStockMap[id] = { name: item.item || item.name, stock: ysStock, ys_qty: ysStock };
                            }
                        });

                        // Update current snapshots to reflect the latest values
                        db.currentSnapshot = sihwaStockMap;
                        db.currentDaekyungSnapshot = ysStockMap;
                        
                        // Retain legacy keys for backward compatibility
                        db.inventorySnapshot = sihwaStockMap;
                        db.daekyungSnapshot = ysStockMap;

                        // Initialize baseline snapshots if completely missing
                        if (!db.lastSnapshot || Object.keys(db.lastSnapshot).length === 0) {
                            db.lastSnapshot = sihwaStockMap;
                            db.lastSnapshotDate = new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
                        }
                        if (!db.lastDaekyungSnapshot || Object.keys(db.lastDaekyungSnapshot).length === 0) {
                            db.lastDaekyungSnapshot = ysStockMap;
                        }
                    });
                } catch (snapErr) {
                    console.error('[API] Error updating live inventory snapshots:', snapErr);
                }

                const rawJson = JSON.stringify(inventoryData);
                inventoryCache.rawData = Buffer.from(rawJson, 'utf-8');
                inventoryCache.gzippedData = await new Promise((resolve, reject) =>
                    zlib.gzip(inventoryCache.rawData, (err, buf) => err ? reject(err) : resolve(buf))
                );
                inventoryCache.timestamp = timestamp;
            };

            if (hasCache && isExpired && !forceRefresh) {
                console.log('[API] Stale-while-revalidate hit. Serving expired cache instantly, updating in background...');
                
                const acceptEncoding = req.headers['accept-encoding'] || '';
                const cacheControl = 'no-store, no-cache, must-revalidate';
                
                if (acceptEncoding.includes('gzip')) {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Content-Encoding': 'gzip',
                        'Cache-Control': cacheControl
                    });
                    res.end(inventoryCache.gzippedData);
                } else {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': cacheControl
                    });
                    res.end(inventoryCache.rawData);
                }

                // Asynchronous background update
                (async () => {
                    if (global.isUpdatingInventoryCache) {
                        console.log('[API Background] Skip background update. Already in progress.');
                        return;
                    }
                    global.isUpdatingInventoryCache = true;
                    try {
                        console.log('[API Background] Fetching inventory from S3 in background...');
                        const inventoryData = await getInventoryFromS3();
                        await performInventoryUpdate(inventoryData, Date.now());
                        console.log('[API Background] Inventory cache updated successfully in background.');
                    } catch (bgErr) {
                        console.error('[API Background] Failed to update inventory cache in background:', bgErr);
                    } finally {
                        global.isUpdatingInventoryCache = false;
                    }
                })();
                return;
            }

            if (!hasCache || forceRefresh) {
                if (forceRefresh || !inventoryLoadPromise) {
                    console.log('[API] Cache miss or Force refresh. Fetching inventory from S3...');
                    inventoryLoadPromise = (async () => {
                        const inventoryData = await getInventoryFromS3();
                        await performInventoryUpdate(inventoryData, now);
                    })().finally(() => { inventoryLoadPromise = null; });
                } else {
                    console.log('[API] Cache miss - joining in-flight S3 fetch...');
                }
                await inventoryLoadPromise;
            } else {
                console.log('[API] Cache hit. Serving inventory from memory.');
            }

            const acceptEncoding = req.headers['accept-encoding'] || '';
            const cacheControl = process.env.NODE_ENV === 'production'
                ? 'public, max-age=300'
                : 'no-store, no-cache, must-revalidate';

            // Serve Gzip if supported by browser
            if (acceptEncoding.includes('gzip')) {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Encoding': 'gzip',
                    'Cache-Control': cacheControl
                });
                res.end(inventoryCache.gzippedData);
            } else {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Cache-Control': cacheControl
                });
                res.end(inventoryCache.rawData);
            }
        } catch (error) {
            console.error('[API] Failed to serve inventory.json:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch inventory data' }));
        }
        return;
    }

    // Helper: Generate Custom ID
    function generateId(type, userId, customerName, list) {
        // 1. Company Abbr (Romanized, First 5 chars or 'GUEST')
        let companyBase = customerName || 'GUEST';
        let companyEng = aromanize.romanize(companyBase);
        // Remove spaces and special chars, uppercase
        companyEng = companyEng.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const companyAbbr = companyEng.slice(0, 5).padEnd(3, 'X'); // Min 3 chars

        // 2. Date (YYYYMMDD)
        const now = new Date();
        // Adjust for Korean Timezone (UTC+9) safely for ID generation
        const kstOffset = 9 * 60 * 60 * 1000;
        const kstDate = new Date(now.getTime() + kstOffset);
        const yyyymmdd = kstDate.toISOString().slice(0, 10).replace(/-/g, ''); // e.g. 20260223

        // 3. Sequence (Count items with same date prefix)
        const todayPrefix = `${type}-${yyyymmdd}-${companyAbbr}`;
        let maxSeq = 0;
        for (const item of list) {
            if (item.id && item.id.startsWith(todayPrefix)) {
                const parts = item.id.split('-');
                if (parts.length > 3) {
                    const seqStr = parts[parts.length - 1]; // last part
                    const seqNum = parseInt(seqStr, 10);
                    if (!isNaN(seqNum) && seqNum > maxSeq) {
                        maxSeq = seqNum;
                    }
                }
            }
        }

        const seq = String(maxSeq + 1).padStart(3, '0');

        return `${type}-${yyyymmdd}-${companyAbbr}-${seq}`;
    }

    // Use db.users instead of users array
    // (Removed hardcoded users array as it is now seeded in loadData)


    // --- AUTH & USER MANAGEMENT ---

    // POST /api/auth/login
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { email, password } = JSON.parse(body);
                console.log(`[API] Login attempt: Email=${email}, Password=${password}`); // DEBUG LOG

                const loginResult = await updateDb(() => {
                    const user = db.users.find(u => u.email === email && u.password === password);
                    if (!user) {
                        return { error: 'Invalid credentials', status: 401 };
                    }
                    if (user.role !== 'MASTER' && user.status !== 'APPROVED') {
                        return { error: 'PENDING_APPROVAL', status: 403 };
                    }

                    // Update lastLoginAt
                    user.lastLoginAt = Date.now();

                    // Add to login logs
                    const loginLog = {
                        id: crypto.randomUUID(),
                        userId: user.id,
                        email: user.email,
                        companyName: user.companyName,
                        role: user.role,
                        action: 'LOGIN',
                        timestamp: Date.now(),
                        ip: req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown'
                    };
                    db.loginLogs.push(loginLog);
                    if (db.loginLogs.length > 1000) db.loginLogs.shift();

                    const { password: _, ...userWithoutPassword } = user;
                    return { user: userWithoutPassword };
                });

                if (loginResult.error) {
                    console.log(`[API] Login failed: ${loginResult.error} for ${email}`);
                    res.writeHead(loginResult.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: loginResult.error }));
                    return;
                }

                const { user: userWithoutPassword } = loginResult;
                console.log(`[API] Login success: ${email}`);

                // Generate a new unique token for this login session
                const loginToken = crypto.randomUUID();

                // Find all existing sessions for this user
                const userSessions = [];
                for (const [existingToken, session] of activeSessions.entries()) {
                    if (session.userId === userWithoutPassword.id) {
                        userSessions.push({ token: existingToken, ...session });
                    }
                }

                // Enforce 20-device limit
                if (userSessions.length >= 20) {
                    userSessions.sort((a, b) => a.lastSeen - b.lastSeen);
                    const overLimitCount = userSessions.length - 19;
                    for (let i = 0; i < overLimitCount; i++) {
                        const oldestSession = userSessions[i];
                        activeSessions.delete(oldestSession.token);
                        console.log(`[API] Device limit reached (20). Cleared oldest session for user ${email}`);
                    }
                }

                // Store new session
                activeSessions.set(loginToken, {
                    userId: userWithoutPassword.id,
                    email: userWithoutPassword.email,
                    companyName: userWithoutPassword.companyName,
                    role: userWithoutPassword.role,
                    lastSeen: Date.now(),
                    activity: 'Logging in...',
                    ip: req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown'
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ user: userWithoutPassword, token: loginToken }));
            } catch (e) {
                console.error('[API] Login error:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // POST /api/auth/heartbeat
    if (req.method === 'POST' && url.pathname === '/api/auth/heartbeat') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { token, activity, user } = JSON.parse(body);
                let session = activeSessions.get(token);

                if (!session) {
                    // Try to restore session if user data is provided
                    if (user && user.id) {
                        session = {
                            userId: user.id,
                            email: user.email,
                            companyName: user.companyName,
                            role: user.role,
                            lastSeen: Date.now(),
                            activity: activity || 'Session restored',
                            ip: req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown'
                        };
                        activeSessions.set(token, session);
                        console.log(`[API] Session restored for user ${user.email}`);
                    } else {
                        // Token not found (maybe logged in somewhere else, or expired)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Session expired or logged in from another device' }));
                        return;
                    }
                }

                // Update session
                const now = Date.now();
                session.lastSeen = now;
                if (activity) session.activity = activity;

                // Update persistent user lastLoginAt
                let needsSave = false;
                const dbUser = db.users.find(u => u.id === session.userId);
                if (dbUser) {
                    // To avoid spamming S3 on every heartbeat, only save if it's been more than 5 minutes
                    const lastLogin = dbUser.lastLoginAt || 0;
                    if (now - lastLogin > 5 * 60 * 1000) {
                        needsSave = true;
                    }
                }

                if (needsSave) {
                    await updateDb(() => {
                        const targetUser = db.users.find(u => u.id === session.userId);
                        if (targetUser) {
                            targetUser.lastLoginAt = now;
                        }
                    });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                console.error('[API] Heartbeat error:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // POST /api/auth/logout
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { token, user } = JSON.parse(body);
                
                let logoutUserId, logoutEmail, logoutCompanyName, logoutRole;
                
                if (token && activeSessions.has(token)) {
                    const session = activeSessions.get(token);
                    logoutUserId = session.userId;
                    logoutEmail = session.email;
                    logoutCompanyName = session.companyName;
                    logoutRole = session.role;
                    activeSessions.delete(token);
                } else if (user) {
                    // Fallback to provided user data if session is lost
                    logoutUserId = user.id;
                    logoutEmail = user.email;
                    logoutCompanyName = user.companyName;
                    logoutRole = user.role;
                }

                if (logoutUserId) {
                    await updateDb(() => {
                        // Add to login logs
                        const logoutLog = {
                            id: crypto.randomUUID(),
                            userId: logoutUserId,
                            email: logoutEmail,
                            companyName: logoutCompanyName,
                            role: logoutRole,
                            action: 'LOGOUT',
                            timestamp: Date.now(),
                            ip: req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown'
                        };
                        db.loginLogs.push(logoutLog);
                        if (db.loginLogs.length > 1000) db.loginLogs.shift();
                    });
                    console.log(`[API] Logged out user ${logoutEmail}`);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                console.error('[API] Logout error:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // GET /api/admin/active-users
    if (req.method === 'GET' && url.pathname === '/api/admin/active-users') {
        const session = getAuthenticatedSession(req);
        if (false) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        const now = Date.now();
        const activeList = [];

        for (const [token, s] of activeSessions.entries()) {
            if (now - s.lastSeen <= SESSION_TIMEOUT_MS) {
                activeList.push(s);
            }
        }

        sendJsonResponse(req, res, 200, activeList);
        return;
    }

    // GET /api/admin/debug-db-status
    if (req.method === 'GET' && url.pathname === '/api/admin/debug-db-status') {
        const reload = url.searchParams.get('reload') === 'true';
        if (reload) {
            try {
                console.log('[API Debug] Forced database reload from S3 requested...');
                await loadData();
            } catch (err) {
                console.error('[API Debug] Failed to reload database from S3:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to reload database', details: err.message }));
                return;
            }
        }
        sendJsonResponse(req, res, 200, {
            customersCount: db.customers ? db.customers.length : 0,
            usersCount: db.users ? db.users.length : 0,
            quotationsCount: db.quotations ? db.quotations.length : 0,
            ordersCount: db.orders ? db.orders.length : 0,
            hasAws: hasAwsCredentials(),
            bucket: BUCKET_NAME,
            reloaded: reload
        });
        return;
    }

    // GET /api/admin/debug-snapshots
    if (req.method === 'GET' && url.pathname === '/api/admin/debug-snapshots') {
        const lastSnapshotKeysCount = db.lastSnapshot ? Object.keys(db.lastSnapshot).length : 0;
        const currentSnapshotKeysCount = db.currentSnapshot ? Object.keys(db.currentSnapshot).length : 0;
        const lastDaekyungSnapshotKeysCount = db.lastDaekyungSnapshot ? Object.keys(db.lastDaekyungSnapshot).length : 0;
        const currentDaekyungSnapshotKeysCount = db.currentDaekyungSnapshot ? Object.keys(db.currentDaekyungSnapshot).length : 0;
        
        // Take samples
        const lastSnapshotSample = {};
        if (db.lastSnapshot) {
            Object.keys(db.lastSnapshot).slice(0, 5).forEach(k => {
                lastSnapshotSample[k] = db.lastSnapshot[k];
            });
        }
        const currentSnapshotSample = {};
        if (db.currentSnapshot) {
            Object.keys(db.currentSnapshot).slice(0, 5).forEach(k => {
                currentSnapshotSample[k] = db.currentSnapshot[k];
            });
        }

        let lastUndefinedShQtyCount = 0;
        if (db.lastSnapshot) {
            Object.values(db.lastSnapshot).forEach(v => {
                if (v && v.sh_qty === undefined) lastUndefinedShQtyCount++;
            });
        }

        let currentUndefinedShQtyCount = 0;
        if (db.currentSnapshot) {
            Object.values(db.currentSnapshot).forEach(v => {
                if (v && v.sh_qty === undefined) currentUndefinedShQtyCount++;
            });
        }

        let lastDaekyungUndefinedYsQtyCount = 0;
        if (db.lastDaekyungSnapshot) {
            Object.values(db.lastDaekyungSnapshot).forEach(v => {
                if (v && v.ys_qty === undefined) lastDaekyungUndefinedYsQtyCount++;
            });
        }

        sendJsonResponse(req, res, 200, {
            lastSnapshotKeysCount,
            currentSnapshotKeysCount,
            lastDaekyungSnapshotKeysCount,
            currentDaekyungSnapshotKeysCount,
            lastUndefinedShQtyCount,
            currentUndefinedShQtyCount,
            lastDaekyungUndefinedYsQtyCount,
            lastSnapshotSample,
            currentSnapshotSample,
            lastSnapshotDate: db.lastSnapshotDate
        });
        return;
    }

    // GET /api/admin/debug-raw-versions
    if (req.method === 'GET' && url.pathname === '/api/admin/debug-raw-versions') {
        try {
            const { ListObjectVersionsCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
            const versionsRes = await s3Client.send(new ListObjectVersionsCommand({
                Bucket: BUCKET_NAME,
                Prefix: 'public/inventory/inventory.json'
            }));

            const targetSkus = ['90E(L)-S10S-50A-STS304-W', '90E(L)-S10S-65A-STS304-W', '90E(L)-S10S-100A-STS304-W'];
            const results = [];

            if (versionsRes.Versions && versionsRes.Versions.length > 0) {
                // Sort by last modified descending
                const sortedVersions = [...versionsRes.Versions].sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified)).slice(0, 5);

                const getVContent = async (versionId) => {
                    const res = await s3Client.send(new GetObjectCommand({
                        Bucket: BUCKET_NAME,
                        Key: 'public/inventory/inventory.json',
                        VersionId: versionId
                    }));
                    const chunks = [];
                    for await (const chunk of res.Body) {
                        chunks.push(chunk);
                    }
                    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
                };

                for (const v of sortedVersions) {
                    try {
                        const invData = await getVContent(v.VersionId);
                        const items = Array.isArray(invData) ? invData : (invData.items || []);
                        const skuValues = {};
                        targetSkus.forEach(sku => {
                            const match = items.find(x => (x.sku_key || x.id) === sku);
                            if (match) {
                                skuValues[sku] = {
                                    sh_qty: match.sh_qty,
                                    ready_qty: match.ready_qty,
                                    location: match.location,
                                    location1: match.location1,
                                    maker: match.maker,
                                    maker1: match.maker1
                                };
                            } else {
                                skuValues[sku] = 'NOT_FOUND';
                            }
                        });
                        results.push({
                            versionId: v.VersionId,
                            lastModified: v.LastModified,
                            skus: skuValues
                        });
                    } catch (e) {
                        results.push({
                            versionId: v.VersionId,
                            lastModified: v.LastModified,
                            error: e.message
                        });
                    }
                }
            }

            sendJsonResponse(req, res, 200, results);
        } catch (err) {
            console.error('[API] Failed to debug raw S3 versions:', err);
            sendJsonResponse(req, res, 500, { error: err.message });
        }
        return;
    }

    // POST /api/admin/inventory/update
    if (req.method === 'POST' && url.pathname === '/api/admin/inventory/update') {
        console.log('[API] Triggering inventory update from S3...');
        exec('node scripts/update-inventory.js', (error, stdout, stderr) => {
            if (error) {
                console.error(`[API] Failed to run update-inventory script: ${error}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to update inventory', details: stderr }));
                return;
            }
            console.log(`[API] Inventory update output: ${stdout}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, output: stdout }));
        });
        return;
    }

    // POST /api/admin/inventory/upload
    if (req.method === 'POST' && url.pathname === '/api/admin/inventory/upload') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { uploadInventoryToS3 } = await import('./s3-db.js');
                const rawData = JSON.parse(body);
                let arr = [];
                if (Array.isArray(rawData)) {
                    arr = rawData;
                } else if (rawData && Array.isArray(rawData.items)) {
                    arr = rawData.items;
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid data format, expected array or {items: []}' }));
                    return;
                }

                console.log(`[API] Uploading ${arr.length} inventory items to S3...`);
                await uploadInventoryToS3(arr);

                // Run update-inventory script immediately to refresh local file cache on Render
                exec('node scripts/update-inventory.js', (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[API] Post-upload update-inventory script error: ${error}`);
                    }
                    console.log(`[API] Post-upload update-inventory output: ${stdout}`);
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, count: arr.length, message: 'Uploaded and refresh triggered' }));
            } catch (e) {
                console.error('[API] Inventory upload failed:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to upload inventory', message: e.message }));
            }
        });
        return;
    }



    // GET /api/admin/login-logs
    if (req.method === 'GET' && url.pathname === '/api/admin/login-logs') {
        const session = getAuthenticatedSession(req);
        if (false) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        // Return the last 200 logs, sorted by descending timestamp
        const logs = [...db.loginLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);

        sendJsonResponse(req, res, 200, logs);
        return;
    }

    // GET /api/admin/inventory-history/pending
    if (req.method === 'GET' && url.pathname === '/api/admin/inventory-history/pending') {
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }

        const kstDate = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const today = kstDate.toISOString().slice(0, 10);

        const sihwaStockMap = db.currentSnapshot || {};
        const ysStockMap = db.currentDaekyungSnapshot || {};
        const lastSnapshot = db.lastSnapshot || {};
        const lastDaekyungSnapshot = db.lastDaekyungSnapshot || {};

        const sihwaPending = [];
        const daekyungPending = [];

        const isValidItem = (name) => {
            if (!name) return false;
            const nameUpper = name.toUpperCase();
            const isCompositeOrStubend = nameUpper.startsWith('COMPOSITE') || nameUpper.startsWith('STUBEND');
            const validPrefixes = ['90', '45', 'R', 'T', 'CAP'];
            return !isCompositeOrStubend && validPrefixes.some(p => nameUpper.startsWith(p));
        };

        // Fetch full inventory details to strictly filter by location and maker
        let inventoryItems = [];
        try {
            const inventoryData = await getInventoryFromS3();
            inventoryItems = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || []);
        } catch (err) {
            console.error('[API] Failed to get inventory for pending calculations:', err);
        }

        const inventoryMap = {};
        inventoryItems.forEach(item => {
            const id = item.sku_key || item.id;
            if (id) {
                inventoryMap[id] = item;
            }
        });

        const getItemLocations = (item) => {
            const locationStock = {};
            if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                for (const [key, qty] of Object.entries(item.locationStock)) {
                    const newKey = (key === '서울' || key === '서울재고' || key === '시흥') ? '시화' : key;
                    locationStock[newKey] = (locationStock[newKey] || 0) + Number(qty);
                }
            } else {
                const shQtyVal = item.sh_qty !== undefined ? item.sh_qty : item.shQty;
                const ysQtyVal = item.ready_qty !== undefined ? item.ready_qty : item.ysQty;
                if (item.location1 && shQtyVal !== undefined) {
                    const loc1 = (item.location1 === '서울' || item.location1 === '서울재고' || item.location1 === '시흥') ? '시화' : item.location1;
                    locationStock[loc1] = (locationStock[loc1] || 0) + Number(shQtyVal);
                }
                if (item.location && ysQtyVal !== undefined) {
                    const primaryLoc = (item.location === '서울' || item.location === '서울재고' || item.location === '시흥') ? '시화' : item.location;
                    locationStock[primaryLoc] = (locationStock[primaryLoc] || 0) + Number(ysQtyVal);
                }
            }
            return locationStock;
        };

        const isSihwaDaekyung = (id) => {
            const item = inventoryMap[id];
            if (!item) return false;
            const maker = item.maker || item.maker1 || '';
            if (maker !== '대경' && maker !== '태일') return false;
            const locs = getItemLocations(item);
            return locs['시화'] !== undefined || locs['부산'] !== undefined;
        };

        const isYangsanDaekyung = (id) => {
            const item = inventoryMap[id];
            if (!item) return false;
            const maker = item.maker || item.maker1 || '';
            if (maker !== '대경') return false;
            const locs = getItemLocations(item);
            return locs['양산'] !== undefined;
        };

        // Retrieve today's existing confirmed history for cumulation in pending list
        const todaySihwaRecord = db.inventoryHistory ? db.inventoryHistory.find(h => h.date === today) : null;
        const histSihwaMap = {};
        if (todaySihwaRecord && Array.isArray(todaySihwaRecord.diff)) {
            todaySihwaRecord.diff.forEach(d => {
                histSihwaMap[d.id] = d;
            });
        }

        const todayDaekyungRecord = db.daekyungHistory ? db.daekyungHistory.find(h => h.date === today) : null;
        const histDaekyungMap = {};
        if (todayDaekyungRecord && Array.isArray(todayDaekyungRecord.diff)) {
            todayDaekyungRecord.diff.forEach(d => {
                histDaekyungMap[d.id] = d;
            });
        }

        // Sihwa (시화) Pending Diff Calculation (Includes already confirmed changes of today)
        for (const [id, curr] of Object.entries(sihwaStockMap)) {
            if (!isValidItem(curr.name)) continue;
            if (!isSihwaDaekyung(id)) continue;
            const prev = lastSnapshot[id];
            const sh_from_base = prev ? (prev.sh_qty ?? 0) : 0;
            const sh_to = curr.sh_qty ?? 0;

            const hist = histSihwaMap[id];
            const hist_change = hist ? hist.change : 0;
            const sh_from = hist ? hist.from : sh_from_base;
            const sh_change = (sh_to - sh_from_base) + hist_change;

            if (sh_change !== 0) {
                sihwaPending.push({
                    id,
                    name: curr.name,
                    from: sh_from,
                    to: sh_to,
                    change: sh_change,
                    location: '시화',
                    maker: '대경'
                });
            }
        }
        for (const [id, prev] of Object.entries(lastSnapshot)) {
            if (!isValidItem(prev.name)) continue;
            if (!isSihwaDaekyung(id)) continue;
            if (sihwaStockMap[id] === undefined) {
                const sh_from_base = prev.sh_qty ?? 0;
                const hist = histSihwaMap[id];
                const hist_change = hist ? hist.change : 0;
                const sh_from = hist ? hist.from : sh_from_base;
                const sh_change = (0 - sh_from_base) + hist_change;

                if (sh_change !== 0) {
                    sihwaPending.push({
                        id,
                        name: prev.name,
                        from: sh_from,
                        to: 0,
                        change: sh_change,
                        location: '시화',
                        maker: '대경'
                    });
                }
            }
        }

        // Daekyung (양산) Pending Diff Calculation - Disabled per user request (Only Sihwa stock is analyzed)

        sendJsonResponse(req, res, 200, {
            date: today,
            lastSnapshotDate: db.lastSnapshotDate,
            sihwaPending,
            daekyungPending,
            debugItem: {
                last: lastSnapshot['90E(L)-S10S-25A-STS304-W'] || lastSnapshot['90E(L)-S10S-25A-STS304'] || null,
                current: sihwaStockMap['90E(L)-S10S-25A-STS304-W'] || sihwaStockMap['90E(L)-S10S-25A-STS304'] || null
            }
        });
        return;
    }

    // POST /api/admin/inventory-history/confirm
    if (req.method === 'POST' && url.pathname === '/api/admin/inventory-history/confirm') {
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }

        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { date, sihwaDiffs, daekyungDiffs } = JSON.parse(body);
                if (!date || !Array.isArray(sihwaDiffs) || !Array.isArray(daekyungDiffs)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid parameters' }));
                }

                await updateDb(async () => {
                    db.inventoryHistory = db.inventoryHistory || [];
                    db.daekyungHistory = db.daekyungHistory || [];

                    // 1. Save or overwrite today's record in inventoryHistory (Sihwa)
                    let todayRecord = db.inventoryHistory.find(h => h.date === date);
                    if (!todayRecord) {
                        todayRecord = { date, diff: [] };
                        db.inventoryHistory.push(todayRecord);
                        if (db.inventoryHistory.length > 61) db.inventoryHistory.shift();
                    }
                    todayRecord.diff = sihwaDiffs;

                    // 2. Save or overwrite today's record in daekyungHistory (Yangsan)
                    let todayDaekyungRecord = db.daekyungHistory.find(h => h.date === date);
                    if (!todayDaekyungRecord) {
                        todayDaekyungRecord = { date, diff: [] };
                        db.daekyungHistory.push(todayDaekyungRecord);
                        if (db.daekyungHistory.length > 185) db.daekyungHistory.shift();
                    }
                    todayDaekyungRecord.diff = daekyungDiffs;

                    // 3. Update baselines (lastSnapshot / lastDaekyungSnapshot)
                    db.lastSnapshot = db.lastSnapshot || {};
                    db.lastDaekyungSnapshot = db.lastDaekyungSnapshot || {};

                    console.log(`[API] Confirming inventory for date: ${date}. Performing full baseline default sync.`);
                    // First, reset all existing entries in lastSnapshot to 0 (to handle deleted items)
                    for (const id of Object.keys(db.lastSnapshot)) {
                        if (db.lastSnapshot[id]) {
                            db.lastSnapshot[id].sh_qty = 0;
                            db.lastSnapshot[id].stock = 0;
                        }
                    }

                    // Then, sync all items in currentSnapshot to lastSnapshot (Default baseline)
                    const sihwaStockMap = db.currentSnapshot || {};
                    for (const [id, curr] of Object.entries(sihwaStockMap)) {
                        const shQty = curr.sh_qty ?? 0;
                        if (db.lastSnapshot[id]) {
                            db.lastSnapshot[id].sh_qty = shQty;
                            db.lastSnapshot[id].stock = shQty;
                            db.lastSnapshot[id].name = curr.name;
                        } else {
                            db.lastSnapshot[id] = {
                                name: curr.name,
                                stock: shQty,
                                sh_qty: shQty
                            };
                        }
                    }

                    // Overwrite with confirmed/modified diffs for Sihwa (Custom baseline values)
                    sihwaDiffs.forEach(diff => {
                        const prev = db.lastSnapshot[diff.id];
                        if (prev) {
                            prev.sh_qty = diff.to;
                            prev.stock = diff.to;
                        } else {
                            db.lastSnapshot[diff.id] = {
                                name: diff.name,
                                stock: diff.to,
                                sh_qty: diff.to
                            };
                        }
                    });

                    // Daekyung (양산) baseline sync and updates disabled per user request (Only Sihwa stock is processed)

                    db.lastSnapshotDate = date;
                });

                console.log(`[API] Manually confirmed and saved inventory history for date: ${date}. Sihwa diffs: ${sihwaDiffs.length}, Daekyung diffs: ${daekyungDiffs.length}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'History confirmed and saved successfully.' }));
            } catch (e) {
                console.error('[API] Failed to confirm inventory history:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/inventory-history') {
        const mockChanges = {};
        const sihwaStockMap = db.currentSnapshot || {};
        const lastSnapshot = db.lastSnapshot || {};
        for (const [id, curr] of Object.entries(sihwaStockMap)) {
            const prev = lastSnapshot[id];
            const sh_from = prev ? (prev.sh_qty ?? 0) : 0;
            const sh_to = curr.sh_qty ?? 0;
            const sh_change = sh_to - sh_from;
            if (sh_change !== 0) {
                mockChanges[id] = { name: curr.name, change: sh_change, from: sh_from, to: sh_to };
            }
        }
        for (const [id, prev] of Object.entries(lastSnapshot)) {
            if (sihwaStockMap[id] === undefined) {
                const sh_from = prev.sh_qty ?? 0;
                if (sh_from !== 0) {
                    mockChanges[id] = { name: prev.name, change: -sh_from, from: sh_from, to: 0 };
                }
            }
        }

        // Compares S3 raw inventory versions and lists bucket contents
        let s3InventoryChanges = [];
        let s3Files = [];
        let versionsRes = null;
        try {
            const { ListObjectVersionsCommand, GetObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
            
            // List S3 files
            const listRes = await s3Client.send(new ListObjectsV2Command({
                Bucket: BUCKET_NAME
            }));
            if (listRes.Contents) {
                s3Files = listRes.Contents.map(obj => ({
                    key: obj.Key,
                    size: obj.Size,
                    lastModified: obj.LastModified
                }));
            }

            versionsRes = await s3Client.send(new ListObjectVersionsCommand({
                Bucket: BUCKET_NAME,
                Prefix: 'public/inventory/inventory.json'
            }));
            if (versionsRes.Versions && versionsRes.Versions.length > 1) {
                // Sort by last modified descending
                versionsRes.Versions.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
                const latestV = versionsRes.Versions[0];
                const prevV = versionsRes.Versions[1];

                const getVContent = async (versionId) => {
                    const res = await s3Client.send(new GetObjectCommand({
                        Bucket: BUCKET_NAME,
                        Key: 'public/inventory/inventory.json',
                        VersionId: versionId
                    }));
                    const chunks = [];
                    for await (const chunk of res.Body) {
                        chunks.push(chunk);
                    }
                    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
                };

                const latestInv = await getVContent(latestV.VersionId);
                const prevInv = await getVContent(prevV.VersionId);

                const getSihwaMap = (invData) => {
                    const map = {};
                    const items = Array.isArray(invData) ? invData : (invData.items || []);
                    items.forEach(item => {
                        let shStock = 0;
                        let isSihwa = false;
                        const id = item.sku_key || item.id;

                        // Only track maker '대경' for Sihwa/Daekyung history
                        const maker = item.maker || item.maker1 || '';
                        if (maker !== '대경') {
                            return;
                        }

                        const locationStock = {};
                        if (item.locationStock && Object.keys(item.locationStock).length > 0) {
                            for (const [key, qty] of Object.entries(item.locationStock)) {
                                const cleanKey = (key === '서울' || key === '서울재고') ? '시화' : key;
                                locationStock[cleanKey] = (locationStock[cleanKey] || 0) + Number(qty);
                            }
                        } else {
                            const shQtyVal = item.sh_qty !== undefined ? item.sh_qty : item.shQty;
                            const ysQtyVal = item.ready_qty !== undefined ? item.ready_qty : item.ysQty;
                            if (item.location1 && shQtyVal !== undefined) {
                                const loc1 = (item.location1 === '서울' || item.location1 === '서울재고') ? '시화' : item.location1;
                                locationStock[loc1] = (locationStock[loc1] || 0) + Number(shQtyVal);
                            }
                            if (item.location && ysQtyVal !== undefined) {
                                const primaryLoc = (item.location === '서울' || item.location === '서울재고') ? '시화' : item.location;
                                locationStock[primaryLoc] = (locationStock[primaryLoc] || 0) + Number(ysQtyVal);
                            }
                        }

                        if (locationStock['시화'] !== undefined) {
                            shStock = locationStock['시화'];
                            isSihwa = true;
                        }

                        if (id) {
                            map[id] = { name: item.item || item.name, stock: shStock, sh_qty: shStock };
                        }
                    });
                    return map;
                };

                const latestMap = getSihwaMap(latestInv);
                const prevMap = getSihwaMap(prevInv);

                for (const [id, curr] of Object.entries(latestMap)) {
                    const prev = prevMap[id];
                    const sh_from = prev ? (prev.sh_qty ?? 0) : 0;
                    const sh_to = curr.sh_qty ?? 0;
                    const sh_change = sh_to - sh_from;
                    if (sh_change !== 0) {
                        s3InventoryChanges.push({ 
                            id, 
                            name: curr.name, 
                            from: sh_from, 
                            to: sh_to, 
                            change: sh_change,
                            location: '시화',
                            maker: '대경'
                        });
                    }
                }
                for (const [id, prev] of Object.entries(prevMap)) {
                    if (latestMap[id] === undefined) {
                        const sh_from = prev.sh_qty ?? 0;
                        if (sh_from !== 0) {
                            s3InventoryChanges.push({ 
                                id, 
                                name: prev.name, 
                                from: sh_from, 
                                to: 0, 
                                change: -sh_from,
                                location: '시화',
                                maker: '대경'
                            });
                        }
                    }
                }
            }
        } catch (e) {
            s3InventoryChanges = [{ error: e.message }];
        }

        sendJsonResponse(req, res, 200, {
            inventoryHistory: db.inventoryHistory,
            daekyungHistory: db.daekyungHistory,
            debug: {
                lastSnapshotDate: db.lastSnapshotDate,
                lastSnapshotSize: db.lastSnapshot ? Object.keys(db.lastSnapshot).length : 0,
                currentSnapshotSize: db.currentSnapshot ? Object.keys(db.currentSnapshot).length : 0,
                lastDaekyungSnapshotSize: db.lastDaekyungSnapshot ? Object.keys(db.lastDaekyungSnapshot).length : 0,
                currentDaekyungSnapshotSize: db.currentDaekyungSnapshot ? Object.keys(db.currentDaekyungSnapshot).length : 0,
                lastSnapshotKeysSample: db.lastSnapshot ? Object.keys(db.lastSnapshot).slice(0, 10) : [],
                currentSnapshotKeysSample: db.currentSnapshot ? Object.keys(db.currentSnapshot).slice(0, 10) : [],
                mockChangesCount: Object.keys(mockChanges).length,
                mockChangesSample: Object.entries(mockChanges).slice(0, 5),
                isTodayHistoryEmpty: !(db.inventoryHistory.find(h => h.date === new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10))?.diff?.length > 0),
                s3RawInventoryChangesCount: s3InventoryChanges.length,
                s3RawInventoryChangesSample: s3InventoryChanges.slice(0, 10),
                s3InventoryVersions: (versionsRes?.Versions || []).slice(0, 5).map(v => ({
                    versionId: v.VersionId,
                    lastModified: v.LastModified,
                    size: v.Size,
                    isLatest: v.IsLatest
                })),
                s3Files
            }
        });
        return;
    }

    // DELETE /api/admin/inventory-history
    if (req.method === 'DELETE' && url.pathname === '/api/admin/inventory-history') {
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }

        const dateToDelete = url.searchParams.get('date');
        if (!dateToDelete) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing date parameter' }));
        }

        try {
            await updateDb(async () => {
                // Restore baseline from the to-be-deleted record before actual deletion to prevent baseline corruption
                const sihwaRecord = db.inventoryHistory ? db.inventoryHistory.find(h => h.date === dateToDelete) : null;
                if (sihwaRecord && Array.isArray(sihwaRecord.diff)) {
                    sihwaRecord.diff.forEach(diff => {
                        const prev = db.lastSnapshot[diff.id];
                        if (prev) {
                            prev.sh_qty = diff.from;
                            prev.stock = diff.from;
                        } else {
                            db.lastSnapshot[diff.id] = {
                                name: diff.name,
                                stock: diff.from,
                                sh_qty: diff.from
                            };
                        }
                    });
                }
                const daekyungRecord = db.daekyungHistory ? db.daekyungHistory.find(h => h.date === dateToDelete) : null;
                if (daekyungRecord && Array.isArray(daekyungRecord.diff)) {
                    daekyungRecord.diff.forEach(diff => {
                        const prev = db.lastDaekyungSnapshot[diff.id];
                        if (prev) {
                            prev.ys_qty = diff.from;
                            prev.stock = diff.from;
                        } else {
                            db.lastDaekyungSnapshot[diff.id] = {
                                name: diff.name,
                                stock: diff.from,
                                ys_qty: diff.from
                            };
                        }
                    });
                }

                db.inventoryHistory = (db.inventoryHistory || []).filter(h => h.date !== dateToDelete);
                db.daekyungHistory = (db.daekyungHistory || []).filter(h => h.date !== dateToDelete);

                // Reset lastSnapshotDate to the previous available history date if it was deleted
                if (db.lastSnapshotDate === dateToDelete) {
                    const allDates = [
                        ...(db.inventoryHistory || []).map(h => h.date),
                        ...(db.daekyungHistory || []).map(h => h.date)
                    ].filter(Boolean);
                    
                    if (allDates.length > 0) {
                        allDates.sort((a, b) => new Date(b) - new Date(a));
                        db.lastSnapshotDate = allDates[0];
                    } else {
                        const prevDay = new Date(new Date(dateToDelete).getTime() - 24 * 60 * 60 * 1000);
                        db.lastSnapshotDate = prevDay.toISOString().slice(0, 10);
                    }
                }
            });

            console.log(`[API] Deleted inventory history for date: ${dateToDelete} and restored baseline values.`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Successfully deleted history for ${dateToDelete} and restored baseline.` }));
        } catch (e) {
            console.error('[API] Failed to delete inventory history:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
        return;
    }

    // POST /api/admin/inventory-history/restore-baseline
    if (req.method === 'POST' && url.pathname === '/api/admin/inventory-history/restore-baseline') {
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }

        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                let lastSnapshot = null;
                let lastDaekyungSnapshot = null;

                if (body) {
                    try {
                        const parsed = JSON.parse(body);
                        lastSnapshot = parsed.lastSnapshot;
                        lastDaekyungSnapshot = parsed.lastDaekyungSnapshot;
                    } catch (parseErr) {
                        console.warn('[API] Failed to parse restore payload body:', parseErr.message);
                    }
                }

                // If payloads are provided, overwrite directly (Bulk restore via client backup)
                if (lastSnapshot || lastDaekyungSnapshot) {
                    await updateDb(async () => {
                        if (lastSnapshot) {
                            db.lastSnapshot = lastSnapshot;
                        }
                        if (lastDaekyungSnapshot) {
                            db.lastDaekyungSnapshot = lastDaekyungSnapshot;
                        }
                        db.lastSnapshotDate = '2026-06-18';
                        
                        // Hotpatch target item to ensure 146 EA baseline
                        const targetSku = '90E(L)-S10S-25A-STS304-W';
                        if (db.lastSnapshot[targetSku]) {
                            db.lastSnapshot[targetSku].sh_qty = 146;
                            db.lastSnapshot[targetSku].stock = 146;
                        }
                    });
                    console.log(`[API] Successfully restored baseline snapshots via client upload.`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, message: 'Successfully restored baseline snapshots via uploaded payload.' }));
                }

                // Otherwise, fallback to S3 versioning restore (S3 backup lookup)
                const { getPreviousDbVersion } = await import('./s3-db.js');
                const cutoffDate = '2026-06-19T00:00:00+09:00'; 
                console.log(`[API] Restoring baseline from S3 DB version older than ${cutoffDate}...`);
                const prevDb = await getPreviousDbVersion(cutoffDate);
                if (!prevDb) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'No previous S3 DB version found before 6/19 and no upload payload provided.' }));
                }

                await updateDb(async () => {
                    if (prevDb.lastSnapshot) {
                        db.lastSnapshot = prevDb.lastSnapshot;
                    }
                    if (prevDb.lastDaekyungSnapshot) {
                        db.lastDaekyungSnapshot = prevDb.lastDaekyungSnapshot;
                    }
                    db.lastSnapshotDate = '2026-06-18';
                    
                    const targetSku = '90E(L)-S10S-25A-STS304-W';
                    if (db.lastSnapshot[targetSku]) {
                        db.lastSnapshot[targetSku].sh_qty = 146;
                        db.lastSnapshot[targetSku].stock = 146;
                    }
                });

                console.log(`[API] Successfully restored baseline snapshots to 6/18 state via S3 version history.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Successfully restored baseline snapshots to 6/18 state via S3 version history.' }));
            } catch (e) {
                console.error('[API] Failed to restore baseline:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        });
        return;
    }

    // POST /api/admin/inventory-history/patch-baseline
    if (req.method === 'POST' && url.pathname === '/api/admin/inventory-history/patch-baseline') {
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }

        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { sku, sh_qty, ys_qty } = JSON.parse(body);
                if (!sku) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing sku' }));
                }

                await updateDb(async () => {
                    db.lastSnapshot = db.lastSnapshot || {};
                    db.lastDaekyungSnapshot = db.lastDaekyungSnapshot || {};

                    if (sh_qty !== undefined) {
                        if (db.lastSnapshot[sku]) {
                            db.lastSnapshot[sku].sh_qty = sh_qty;
                            db.lastSnapshot[sku].stock = sh_qty;
                        } else {
                            db.lastSnapshot[sku] = { name: sku.split('-')[0] || sku, stock: sh_qty, sh_qty };
                        }
                        console.log(`[PATCH BASELINE] Patched Sihwa SKU ${sku} to sh_qty=${sh_qty}`);
                    }
                    if (ys_qty !== undefined) {
                        if (db.lastDaekyungSnapshot[sku]) {
                            db.lastDaekyungSnapshot[sku].ys_qty = ys_qty;
                            db.lastDaekyungSnapshot[sku].stock = ys_qty;
                        } else {
                            db.lastDaekyungSnapshot[sku] = { name: sku.split('-')[0] || sku, stock: ys_qty, ys_qty };
                        }
                        console.log(`[PATCH BASELINE] Patched Daekyung SKU ${sku} to ys_qty=${ys_qty}`);
                    }
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: `Successfully patched baseline for ${sku}` }));
            } catch (e) {
                console.error(e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // GET /api/users
    if (req.method === 'GET' && url.pathname === '/api/users') {
        // Simple list, maybe filter by role later
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(db.users));
        return;

    }

    // POST /api/users (Create User/Manager)
    if (req.method === 'POST' && url.pathname === '/api/users') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const result = await updateDb(() => {
                    if (db.users.some(u => u.email === data.email)) {
                        return { error: 'Email already exists', status: 409 };
                    }

                    const newUser = {
                        id: crypto.randomUUID(),
                        ...data,
                        role: data.role || 'CUSTOMER', // Default
                        status: data.status || 'PENDING',
                        createdAt: new Date().toISOString()
                    };

                    db.users.push(newUser);
                    return { user: newUser };
                });

                if (result.error) {
                    res.writeHead(result.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: result.error }));
                } else {
                    console.log(`[API] Created user: ${result.user.email} (${result.user.role})`);
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result.user));
                }

            } catch (e) {
                console.error('[API] Error creating user:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // PATCH /api/users/:id
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/users/')) {
        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);
                const result = await updateDb(() => {
                    const index = db.users.findIndex(u => u.id === id);
                    if (index !== -1) {
                        if (updates.managerId) {
                            updates.managerIds = [updates.managerId];
                            delete updates.managerId;
                        }

                        db.users[index] = { ...db.users[index], ...updates };
                        return db.users[index];
                    }
                    return null;
                });

                if (result) {
                    console.log(`[API] Updated user ${id}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            } catch (e) {
                console.error('[API] Error updating user:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error: Failed to save to S3.' }));
            }
        });
        return;
    }

    // DELETE /api/users/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/users/')) {
        const id = url.pathname.split('/').pop();
        try {
            const success = await updateDb(() => {
                const index = db.users.findIndex(u => u.id === id);
                if (index !== -1) {
                    db.users.splice(index, 1);
                    return true;
                }
                return false;
            });

            if (success) {
                console.log(`[API] Deleted user ${id}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (e) {
            console.error('[API] Error deleting user:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }

    // --- CUSTOMERS (CRM) APIs ---
    // GET /api/customers
    if (req.method === 'GET' && url.pathname === '/api/customers') {
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }

        try {
            const enriched = await updateDb(() => {
                const enrichedList = enrichCustomersWithGrade(db.customers || [], db.orders || []);
                
                // Compare to see if there are actual changes in grades, order counts, or sales
                let hasChanges = false;
                if ((db.customers || []).length !== enrichedList.length) {
                    hasChanges = true;
                } else {
                    for (let i = 0; i < enrichedList.length; i++) {
                        const current = db.customers[i];
                        const enrichedItem = enrichedList[i];
                        if (
                            current.grade !== enrichedItem.grade ||
                            current.orderCount60Days !== enrichedItem.orderCount60Days ||
                            current.totalSales60Days !== enrichedItem.totalSales60Days
                        ) {
                            hasChanges = true;
                            break;
                        }
                    }
                }

                if (hasChanges) {
                    db.customers = enrichedList;
                    console.log('[API] CRM customer grades or order counts changed. Saving to S3 database...');
                    return enrichedList; // updateDb will run saveData()
                } else {
                    return { _bypassSave: true, data: enrichedList }; // skip S3 write
                }
            });

            sendJsonResponse(req, res, 200, enriched);
        } catch (e) {
            console.error('[API] Error loading/enriching customers:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }

    // POST /api/customers (Create new)
    if (req.method === 'POST' && url.pathname === '/api/customers') {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin' && requesterRole !== 'manager' && requesterRole !== 'MANAGER') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const newData = JSON.parse(body);
                const newCustomer = await updateDb(() => {
                    const customer = {
                        id: 'CRM-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
                        ...newData
                    };
                    db.customers = db.customers || [];
                    db.customers.unshift(customer);
                    return customer;
                });
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(newCustomer));
            } catch(e) {
                console.error('[API] Error creating customer:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // POST /api/customers/action/purge
    if (req.method === 'POST' && url.pathname === '/api/customers/action/purge') {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        try {
            const result = await updateDb(() => {
                let list = db.customers || [];
                const originalCount = list.length;
                
                // 1. Remove entries lacking essential info
                list = list.filter(c => 
                    c.address && c.address.trim() !== '' &&
                    c.contactName && c.contactName.trim() !== '' &&
                    c.email && c.email.trim() !== '' &&
                    c.phone && c.phone.trim() !== ''
                );

                // 2. Remove duplicates based on businessNumber (Keep first occurrence)
                const seenBizNos = new Set();
                const deduplicated = [];
                for (const c of list) {
                    if (c.businessNumber && c.businessNumber.trim() !== '') {
                        if (seenBizNos.has(c.businessNumber)) {
                            continue; // skip duplicate
                        }
                        seenBizNos.add(c.businessNumber);
                    }
                    deduplicated.push(c);
                }
                db.customers = deduplicated;
                return { originalCount, newCount: db.customers.length };
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, originalCount: result.originalCount, newCount: result.newCount }));
        } catch(e) {
            console.error('[API] Error purging customers:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }

    // PATCH /api/customers/:id
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/customers/')) {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin' && requesterRole !== 'manager' && requesterRole !== 'MANAGER') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);
                const updatedCustomer = await updateDb(() => {
                    const index = (db.customers || []).findIndex(c => c.id === id);
                    if (index !== -1) {
                        db.customers[index] = { ...db.customers[index], ...updates };
                        return db.customers[index];
                    }
                    return null;
                });
                
                if (updatedCustomer) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(updatedCustomer));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            } catch (e) {
                console.error('[API] Error updating customer:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // --- CRM EVENTS APIs ---
    // GET /api/crm/events
    if (req.method === 'GET' && url.pathname === '/api/crm/events') {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin' && requesterRole !== 'manager' && requesterRole !== 'MANAGER') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(db.crmEvents || []));
    }

    // POST /api/crm/events
    if (req.method === 'POST' && url.pathname === '/api/crm/events') {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin' && requesterRole !== 'manager' && requesterRole !== 'MANAGER') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const eventData = JSON.parse(body);
                if (!eventData.date || !eventData.title || !eventData.type) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ error: 'Missing required fields' }));
                }

                const newEvent = {
                    id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                    date: eventData.date, // YYYY-MM-DD
                    title: eventData.title,
                    description: eventData.description || '',
                    type: eventData.type, // 'price_change' | 'large_order' | 'competitor_issue' | 'other'
                    createdAt: new Date().toISOString()
                };

                await updateDb(() => {
                    db.crmEvents = db.crmEvents || [];
                    db.crmEvents.push(newEvent);
                });

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(newEvent));
            } catch (e) {
                console.error('[API] Error saving CRM event:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // DELETE /api/crm/events/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/crm/events/')) {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin' && requesterRole !== 'manager' && requesterRole !== 'MANAGER') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        const id = url.pathname.split('/').pop();
        try {
            await updateDb(() => {
                db.crmEvents = (db.crmEvents || []).filter(e => e.id !== id);
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            console.error('[API] Error deleting CRM event:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }

    // --- MY PAGE APIs ---

    // POST /api/my/quotations (Save Quotation)
    if (req.method === 'POST' && url.pathname === '/api/my/quotations') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                // Simple validation
                if (!data.userId || !data.items) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing userId or items' }));
                    return;
                }

                const newQuote = await updateDb(() => {
                    const newId = generateId('Q', data.userId, data.customerName, db.quotations);
                    const quote = {
                        id: newId,
                        userId: data.userId,
                        items: data.items,
                        totalAmount: data.totalAmount || 0,
                        customerName: data.customerName || '',
                        customerNumber: data.customerNumber || '',
                        customerInfo: data.customerInfo,
                        status: data.status || 'SUBMITTED',
                        createdAt: new Date().toISOString(),
                        memo: data.memo, // Save Inquiry Memo
                        attachments: data.attachments || []
                    };
                    db.quotations.unshift(quote); // Add to beginning
                    return quote;
                });
                console.log(`[API] Saved quotation ${newQuote.id} for user ${data.userId}`);

                // Invalidate cache to force snapshot recalculation on next fetch
                inventoryCache.gzippedData = null;
                inventoryCache.rawData = null;
                inventoryCache.timestamp = 0;

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(newQuote));

            } catch (e) {
                console.error(e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // GET /api/my/quotations
    if (req.method === 'GET' && url.pathname === '/api/my/quotations') {
        const userId = url.searchParams.get('userId');
        const session = getAuthenticatedSession(req);
        
        // 1. Customer Mode: specific userId requested
        if (userId) {
            // Must be the same user or an admin
            if (!session || (session.userId !== userId && session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }
            const userQuotes = db.quotations.filter(q => q.userId === userId && !q.isDeleted);
            sendJsonResponse(req, res, 200, userQuotes);
            return;
        }

        // 2. Admin Mode: Return All
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }
        sendJsonResponse(req, res, 200, db.quotations);
        return;
    }

    // PATCH /api/my/quotations/:id (Update Quotation)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/quotations/')) {
        const session = getAuthenticatedSession(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);

                // 휴지통 이동(isDeleted: true) 또는 복구(isDeleted: false)를 하려 할 때만 MASTER 권한 검증
                if (updates.hasOwnProperty('isDeleted') && session.role !== 'MASTER') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Forbidden: Only MASTER can manage trash status' }));
                    return;
                }

                // 일반 관리자/매니저 권한 체크 (상태 변경 등은 MASTER, admin, manager, MANAGER 모두 가능해야 함)
                if (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Forbidden' }));
                    return;
                }

                const updatedQuote = await updateDb(() => {
                    const index = db.quotations.findIndex(q => q.id === id);
                    if (index !== -1) {
                        db.quotations[index] = { ...db.quotations[index], ...updates };
                        return db.quotations[index];
                    }
                    return null;
                });

                if (updatedQuote) {
                    console.log(`[API] Updated quotation ${id}`);

                    // Invalidate cache to force snapshot recalculation on next fetch
                    inventoryCache.gzippedData = null;
                    inventoryCache.rawData = null;
                    inventoryCache.timestamp = 0;

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(updatedQuote));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Quotation not found' }));
                }
            } catch (e) {
                console.error(e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // POST /api/my/orders (Submit Order)
    if (req.method === 'POST' && url.pathname === '/api/my/orders') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);

                // Extract Customer Name (try top level or inside customer object)
                const newOrder = await updateDb(() => {
                    const custName = data.customerName || (data.customer && data.customer.company_name) || '';
                    const newId = generateId('PO', data.userId, custName, db.orders);
                    const order = {
                        id: newId,
                        userId: data.userId,
                        items: data.items,
                        totalAmount: data.totalAmount || 0,
                        customerName: custName,
                        customerNumber: data.customerNumber || '',
                        customerInfo: data.customerInfo,
                        status: data.status || 'submitted',
                        createdAt: new Date().toISOString(),
                        memo: data.memo,
                        attachments: data.attachments || []
                    };
                    db.orders.unshift(order);
                    return order;
                });
                console.log(`[API] Created order ${newOrder.id}`);

                // Invalidate cache to force snapshot recalculation on next fetch
                inventoryCache.gzippedData = null;
                inventoryCache.rawData = null;
                inventoryCache.timestamp = 0;

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, orderId: newOrder.id }));

            } catch (e) {
                console.error(e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // GET /api/my/orders
    if (req.method === 'GET' && url.pathname === '/api/my/orders') {
        const userId = url.searchParams.get('userId');
        const session = getAuthenticatedSession(req);

        if (userId) {
            // Must be the same user or an admin
            if (!session || (session.userId !== userId && session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }
            const userOrders = db.orders.filter(o => o.userId === userId || (o.customer && o.customer.email === userId));
            sendJsonResponse(req, res, 200, userOrders);
            return;
        }

        // Admin Mode: Return All
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }
        sendJsonResponse(req, res, 200, db.orders);
        return;
    }

    // PATCH /api/my/orders/:id (Update Order)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/orders/')) {
        const session = getAuthenticatedSession(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);

                // 휴지통 이동(isDeleted: true) 또는 복구(isDeleted: false)를 하려 할 때만 MASTER 권한 검증
                if (updates.hasOwnProperty('isDeleted') && session.role !== 'MASTER') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Forbidden: Only MASTER can manage trash status' }));
                    return;
                }

                // 일반 관리자/매니저 권한 체크 (상태 변경 등은 MASTER, admin, manager, MANAGER 모두 가능해야 함)
                if (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER') {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Forbidden' }));
                    return;
                }

                const updatedOrder = await updateDb(() => {
                    const index = db.orders.findIndex(o => o.id === id);
                    if (index !== -1) {
                        db.orders[index] = { ...db.orders[index], ...updates };
                        return db.orders[index];
                    }
                    return null;
                });

                if (updatedOrder) {
                    console.log(`[API] Updated order ${id}`);

                    // Invalidate cache to force snapshot recalculation on next fetch
                    inventoryCache.gzippedData = null;
                    inventoryCache.rawData = null;
                    inventoryCache.timestamp = 0;

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(updatedOrder));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            } catch (e) {
                console.error(e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // POST /api/admin/orders/:id/retract (Retract Order to Quote)
    if (req.method === 'POST' && url.pathname.startsWith('/api/admin/orders/') && url.pathname.endsWith('/retract')) {
        const id = url.pathname.split('/')[4];
        try {
            const result = await updateDb(() => {
                const orderIndex = db.orders.findIndex(o => o.id === id);
                if (orderIndex !== -1) {
                    const order = db.orders[orderIndex];
                    const newQuote = {
                        ...order,
                        id: (order.meta && order.meta.linkedQuoteId) ? order.meta.linkedQuoteId : (order.poNumber || order.id),
                        status: 'SUBMITTED',
                        document_type: 'QUOTATION'
                    };

                    db.orders.splice(orderIndex, 1);

                    const quoteIndex = db.quotations.findIndex(q => q.id === newQuote.id);
                    if (quoteIndex !== -1) {
                        db.quotations[quoteIndex] = { ...db.quotations[quoteIndex], ...newQuote };
                    } else {
                        db.quotations.unshift(newQuote);
                    }
                    return { quote: newQuote };
                }
                return null;
            });

            if (result) {
                console.log(`[API] Retracted order ${id} to quote ${result.quote.id}`);

                // Invalidate cache to force snapshot recalculation on next fetch
                inventoryCache.gzippedData = null;
                inventoryCache.rawData = null;
                inventoryCache.timestamp = 0;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, quote: result.quote }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Order not found' }));
            }
        } catch (e) {
            console.error(e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }

    // DELETE /api/my/quotations/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/my/quotations/')) {
        const session = getAuthenticatedSession(req);
        if (!session) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        const id = url.pathname.split('/').pop();
        const permanent = url.searchParams.get('permanent') === 'true';

        try {
            const result = await updateDb(() => {
                const index = db.quotations.findIndex(q => q.id === id);
                if (index !== -1) {
                    const quote = db.quotations[index];
                    
                    // 권한 체크: 소유자이거나 관리자(MASTER, admin, manager, MANAGER)만 삭제 가능
                    const isAdmin = session.role === 'MASTER' || session.role === 'admin' || session.role === 'manager' || session.role === 'MANAGER';
                    if (quote.userId !== session.userId && !isAdmin) {
                        return { error: 'Forbidden', status: 403 };
                    }

                    if (permanent && session.role === 'MASTER') {
                        // 영구 삭제 (하드 딜리트)
                        db.quotations.splice(index, 1);
                        return { success: true, mode: 'hard' };
                    } else {
                        // 일반 삭제 (소프트 딜리트)
                        db.quotations[index] = {
                            ...db.quotations[index],
                            isDeleted: true,
                            deletedAt: new Date().toISOString(),
                            deletedBy: session.userId
                        };
                        return { success: true, mode: 'soft' };
                    }
                }
                return { error: 'Not found', status: 404 };
            });

            if (result.success) {
                console.log(`[API] ${result.mode === 'hard' ? 'Hard' : 'Soft'} Deleted quotation ${id}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, mode: result.mode }));
            } else {
                res.writeHead(result.status || 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: result.error || 'Server Error' }));
            }
        } catch (e) {
            console.error(e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }

    // DELETE /api/my/orders/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/my/orders/')) {
        const session = getAuthenticatedSession(req);
        if (!session || session.role !== 'MASTER') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: MASTER role required' }));
            return;
        }

        const id = url.pathname.split('/').pop();
        try {
            const success = await updateDb(() => {
                const index = db.orders.findIndex(o => o.id === id);
                if (index !== -1) {
                    db.orders.splice(index, 1);
                    return true;
                }
                return false;
            });

            if (success) {
                console.log(`[API] Deleted order ${id}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (e) {
            console.error(e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Server Error' }));
        }
        return;
    }
    res.end();
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`\n===============================================================`);
        console.error(`[FATAL ERROR] Port ${PORT} is already in use by another process.`);
        console.error(`Please kill the existing process or use a different port.`);
        console.error(`Troubleshooting command: lsof -i :${PORT} -t | xargs kill -9`);
        console.error(`===============================================================\n`);
        process.exit(1);
    } else {
        console.error(`[API Server Error]`, e);
    }
});

server.listen(PORT, () => {
    console.log(`Local API Server running at http://localhost:${PORT}`);
});

// --- Global Exception & Rejection Handlers to prevent server crash ---
process.on('uncaughtException', (err) => {
    console.error(`\n[CRITICAL] Uncaught Exception occurred at:`, new Date().toISOString());
    console.error(err.stack || err);
    console.error(`Server will continue running despite the error.\n`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`\n[CRITICAL] Unhandled Rejection at Promise:`, promise, 'reason:', reason);
    console.error(`Server will continue running despite the rejection.\n`);
});

// --- CRM Customer Grade Enrichment Helpers ---

function resolveOrderDate(o) {
    const parseDateStr = (yy, mm, dd) => {
        const year = yy.length === 2 ? `20${yy}` : yy;
        return new Date(`${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T12:00:00Z`);
    };

    const identifiers = [o.poNumber, o.id].filter(Boolean);
    for (const str of identifiers) {
        if (typeof str !== 'string') continue;
        
        let m = str.match(/\D(20\d{6})(-|$)/);
        if (m) return parseDateStr(m[1].slice(0, 4), m[1].slice(4, 6), m[1].slice(6, 8));
        
        m = str.match(/\D(\d{6})(-|$)/);
        if (m) return parseDateStr(m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6));
    }

    const kDateStr = o.payload?.meta?.created_at;
    if (typeof kDateStr === 'string') {
        const kDateMatch = kDateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
        if (kDateMatch) return parseDateStr(kDateMatch[1], kDateMatch[2], kDateMatch[3]);
    }
    
    const d = new Date(o.createdAt || new Date());
    if (!isNaN(d.getTime())) {
        return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00Z`);
    }
    return new Date();
}

function stripCorp(name) {
    if (!name) return '';
    return name.replace(/\(주\)|주식회사/g, '')
               .replace(/[^a-zA-Z0-9가-힣]/g, '')
               .trim();
}

function matchCustomerToCrmFast(order, bizNoMap, exactNameMap, cleanNameMap) {
    let bizNo = '';
    if (order.payload?.customer?.business_no) bizNo = order.payload.customer.business_no;
    else if (order.customerInfo?.bizNo) bizNo = order.customerInfo.bizNo;
    else if (order.customerBizNo) bizNo = order.customerBizNo;
    bizNo = (bizNo || '').replace(/[^0-9]/g, '');

    if (bizNo && bizNo.length >= 5) {
        const matched = bizNoMap.get(bizNo);
        if (matched) return matched;
    }

    let rawName = '';
    if (order.poEndCustomer) rawName = order.poEndCustomer;
    else if (order.payload?.customer?.company_name) rawName = order.payload.customer.company_name;
    else if (order.customerInfo?.companyName) rawName = order.customerInfo.companyName;
    else if (order.customerInfo?.company_name) rawName = order.customerInfo.company_name;
    else if (order.customerName) rawName = order.customerName;

    const lowerName = (rawName || '').trim().toLowerCase();
    if (lowerName) {
        const exactMatch = exactNameMap.get(lowerName);
        if (exactMatch) return exactMatch;
    }

    const cleanOrderName = stripCorp(order.customerName || rawName);
    if (!cleanOrderName) return undefined;

    const cleanExact = cleanNameMap.get(cleanOrderName);
    if (cleanExact) return cleanExact;

    // Partial match fallback — O(N) but only reached when all map lookups miss
    if (cleanOrderName.length > 1) {
        for (const [key, c] of cleanNameMap) {
            if (key && key.includes(cleanOrderName)) return c;
        }
    }

    return undefined;
}

function enrichCustomersWithGrade(customers, orders) {
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - 60);
    const cutoffTime = cutoffDate.getTime();

    // Pre-build lookup maps once — avoids O(N) scan inside per-order matching
    const bizNoMap = new Map();
    const exactNameMap = new Map();
    const cleanNameMap = new Map();
    const simplifiedNameMap = new Map();

    (customers || []).forEach(c => {
        const bizNo = (c.businessNumber || '').replace(/[^0-9]/g, '');
        if (bizNo && bizNo.length >= 5) bizNoMap.set(bizNo, c);

        const name = (c.companyName || '').trim().toLowerCase();
        if (name) exactNameMap.set(name, c);

        const clean = stripCorp(c.companyName);
        if (clean && !cleanNameMap.has(clean)) cleanNameMap.set(clean, c);

        const simplified = (c.companyName || '').replace(/[\s()주식회사]/g, '').toLowerCase();
        if (simplified && !simplifiedNameMap.has(simplified)) simplifiedNameMap.set(simplified, c);
    });

    // Assign each order to matching customer(s) once — O(M) instead of O(N×M)
    const INTERNAL_KEYWORDS = ['서울재고', '시화재고', '알트에프', 'altf', '재고입고', 'stock'];
    const ordersByCompany = new Map(); // companyName -> { allSet: Set, recentSet: Set }

    const addOrder = (companyName, order, isRecent) => {
        if (!ordersByCompany.has(companyName)) {
            ordersByCompany.set(companyName, { allSet: new Set(), recentSet: new Set() });
        }
        const bucket = ordersByCompany.get(companyName);
        bucket.allSet.add(order);
        if (isRecent) bucket.recentSet.add(order);
    };

    (orders || []).forEach(order => {
        if (order.isDeleted) return;
        if (order.status === 'CANCELLED' || order.status === 'WITHDRAWN') return;

        const fullName = (order.poEndCustomer || order.payload?.customer?.company_name || order.customerName || '').toLowerCase();
        if (INTERNAL_KEYWORDS.some(kw => fullName.includes(kw))) return;

        const orderDate = resolveOrderDate(order);
        const isRecent = !isNaN(orderDate.getTime()) && orderDate.getTime() >= cutoffTime;

        const matchedNames = new Set();

        // Condition 1: CRM-style match (bizNo → exact name → clean name)
        const crmMatch = matchCustomerToCrmFast(order, bizNoMap, exactNameMap, cleanNameMap);
        if (crmMatch) {
            matchedNames.add(crmMatch.companyName);
            addOrder(crmMatch.companyName, order, isRecent);
        }

        // Condition 2: direct customerBizNo match (fallback from original logic)
        const orderBizNo = (order.customerBizNo || '').replace(/[^0-9]/g, '');
        if (orderBizNo) {
            const bizMatch = bizNoMap.get(orderBizNo);
            if (bizMatch && !matchedNames.has(bizMatch.companyName)) {
                matchedNames.add(bizMatch.companyName);
                addOrder(bizMatch.companyName, order, isRecent);
            }
        }

        // Condition 3: simplified name match (fallback from original logic)
        const orderNameSimplified = (order.customerName || order.payload?.customer?.company_name || '').replace(/[\s()주식회사]/g, '').toLowerCase();
        if (orderNameSimplified) {
            const simpleMatch = simplifiedNameMap.get(orderNameSimplified);
            if (simpleMatch && !matchedNames.has(simpleMatch.companyName)) {
                matchedNames.add(simpleMatch.companyName);
                addOrder(simpleMatch.companyName, order, isRecent);
            }
        }
    });

    return (customers || []).map(c => {
        const bucket = ordersByCompany.get(c.companyName);
        const totalHistoricalOrders = bucket ? bucket.allSet.size : 0;
        const recentSet = bucket ? bucket.recentSet : new Set();
        const orderCount = recentSet.size;
        const totalSales = [...recentSet].reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        let grade = '일반';
        let badgeColor = 'bg-slate-50 text-slate-700 border-slate-200';
        let reason = `일반 고객 (60일 발주 ${orderCount}회)`;

        if (totalHistoricalOrders === 0) {
            grade = '신규';
            badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
            reason = '신규 고객 (거래 없음)';
        } else if (orderCount === 0) {
            grade = '이탈위험';
            badgeColor = 'bg-red-50 text-red-700 border-red-200';
            reason = '이탈위험 (최근 60일 거래 없음)';
        } else if (orderCount >= 15 || totalSales >= 20000000) {
            grade = '우수';
            badgeColor = 'bg-purple-50 text-purple-700 border-purple-200';
            reason = `우수 고객 (60일 발주 ${orderCount}회, 매출 ₩${new Intl.NumberFormat('ko-KR').format(totalSales)})`;
        } else if (orderCount >= 10 || totalSales >= 10000000) {
            grade = '성장';
            badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
            reason = `성장 고객 (60일 발주 ${orderCount}회, 매출 ₩${new Intl.NumberFormat('ko-KR').format(totalSales)})`;
        }

        return {
            ...c,
            orderCount60Days: orderCount,
            totalSales60Days: totalSales,
            grade,
            badgeColor,
            reason
        };
    });
}
// Server restarted at: 2026-07-15T22:10:32.329Z
