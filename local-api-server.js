import http from 'http';
import aromanize from 'aromanize';
import crypto from 'crypto';
import { exec } from 'child_process';
import { ListObjectVersionsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from './s3-db.js';
const DB_KEY = 'database/db.json';

const PORT = 3001;

// --- Persistence Setup ---
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial Data Structure
let db = {
    users: [],
    quotations: [],
    orders: []
};

// Load Data
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const fileData = fs.readFileSync(DATA_FILE, 'utf8');
            const json = JSON.parse(fileData);
            db.users = json.users || [];
            db.quotations = json.quotations || [];
            db.orders = json.orders || [];
            console.log(`[API] Loaded data: ${db.users.length} users, ${db.quotations.length} quotes, ${db.orders.length} orders`);
        } else {
            // Seed Initial Admin if file doesn't exist
            db.users = [
                {
                    id: 'admin-user-id',
                    email: 'admin@altf.kr',
                    password: 'admin1234!',
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
            saveData();
        }
    } catch (e) {
        console.error('[API] Failed to load data:', e);
    }
}

// Save Data
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
        // console.log('[API] Data saved');
    } catch (e) {
        console.error('[API] Failed to save data:', e);
    }
}

// Initialize
loadData();

// References for easier access (optional since we operate on db object directly now)
// We will use db.users, db.quotations, db.orders directly in code.

const sessionStore = new Map(); // session_id -> items[]


const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requester-id, x-requester-role');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

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

    // GET /api/admin/db-versions
    if (req.method === 'GET' && url.pathname === '/api/admin/db-versions') {
        try {
            console.log('[API] Listing S3 database versions...');
            const command = new ListObjectVersionsCommand({
                Bucket: BUCKET_NAME,
                Prefix: DB_KEY
            });
            const response = await s3Client.send(command);
            const versions = (response.Versions || []).map(v => ({
                versionId: v.VersionId,
                lastModified: v.LastModified,
                isLatest: v.IsLatest,
                size: v.Size
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(versions));
        } catch (e) {
            console.error('[API] Failed to list DB versions:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to list DB versions', message: e.message }));
        }
        return;
    }

    // POST /api/admin/db-restore
    if (req.method === 'POST' && url.pathname === '/api/admin/db-restore') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { versionId } = JSON.parse(body);
                if (!versionId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing versionId' }));
                    return;
                }

                console.log(`[API] Restoring DB version: ${versionId}`);
                
                // 1. Fetch target version from S3
                const getCommand = new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: DB_KEY,
                    VersionId: versionId
                });
                const s3Res = await s3Client.send(getCommand);
                
                const streamToString = (stream) =>
                    new Promise((resolve, reject) => {
                        const chunks = [];
                        stream.on('data', (chunk) => chunks.push(chunk));
                        stream.on('error', reject);
                        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                    });
                
                const bodyContent = await streamToString(s3Res.Body);
                const restoredDb = JSON.parse(bodyContent);

                // 2. Validate DB Structure
                if (!restoredDb.users || !restoredDb.orders) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid DB structure in target version' }));
                    return;
                }

                // 3. Put this content as the latest version in S3
                const putCommand = new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: DB_KEY,
                    Body: JSON.stringify(restoredDb, null, 2),
                    ContentType: 'application/json'
                });
                await s3Client.send(putCommand);
                console.log('[API] Restored version written to S3 as latest.');

                // 4. Update memory & local file
                db = restoredDb;
                saveData();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Database restored successfully',
                    users: db.users.length,
                    orders: db.orders.length,
                    quotes: db.quotations.length
                }));
            } catch (e) {
                console.error('[API] Restore error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Restore failed', message: e.message }));
            }
        });
        return;
    }

    // POST /api/quote/import
    if (req.method === 'POST' && url.pathname === '/api/quote/import') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
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

    // GET /api/quote/session/:session_id
    if (req.method === 'GET' && url.pathname.startsWith('/api/quote/session/')) {
        const sessionId = url.pathname.split('/').pop();
        const sessionData = sessionStore.get(sessionId);

        if (sessionData) {
            console.log(`[API] Polling hit for session: ${sessionId}, status: ${sessionData.status}, count: ${sessionData.items.length}`);
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
        const filePath = path.join(__dirname, 'public/api/inventory/inventory.json');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            fs.createReadStream(filePath).pipe(res);
        } else {
            const fallbackPath = path.join(__dirname, 'src/data/mock_inventory.json');
            if (fs.existsSync(fallbackPath)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                fs.createReadStream(fallbackPath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Inventory file not found' }));
            }
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
        const companyAbbr = companyEng.slice(0, 5);

        // 2. Date (YYMMDD)
        const now = new Date();
        const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, ''); // 260210

        // 3. Sequence (Count items with same date prefix)
        // Simple mock approach: filter list for IDs containing current date or just list length + 1
        const seq = String(list.length + 1).padStart(3, '0');

        return `${type}-${companyAbbr}-${yymmdd}-${seq}`;
    }

    // Use db.users instead of users array
    // (Removed hardcoded users array as it is now seeded in loadData)


    // --- AUTH & USER MANAGEMENT ---

    // POST /api/auth/login
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { email, password } = JSON.parse(body);
                console.log(`[API] Login attempt: Email=${email}, Password=${password}`); // DEBUG LOG

                const user = db.users.find(u => u.email === email && u.password === password);

                if (user) {
                    if (user.role !== 'MASTER' && user.status !== 'APPROVED') {
                        console.log(`[API] Login failed: User ${email} is pending approval`);
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'PENDING_APPROVAL' }));
                        return;
                    }
                    // Return user without password
                    const { password, ...userWithoutPassword } = user;
                    console.log(`[API] Login success: ${email}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ user: userWithoutPassword }));
                } else {
                    console.log(`[API] Login failed: Invalid credentials for ${email}`);
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid credentials' }));
                }
            } catch (e) {
                console.error('[API] Login error:', e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
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
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (db.users.some(u => u.email === data.email)) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Email already exists' }));
                    return;
                }

                const newUser = {
                    id: crypto.randomUUID(),
                    ...data,
                    role: data.role || 'CUSTOMER', // Default
                    status: data.status || 'PENDING',
                    createdAt: new Date().toISOString()
                };

                db.users.push(newUser);
                saveData(); // <--- SAVE
                console.log(`[API] Created user: ${newUser.email} (${newUser.role})`);

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(newUser));

            } catch (e) {
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
        req.on('end', () => {
            try {
                const updates = JSON.parse(body);
                const index = db.users.findIndex(u => u.id === id);
                if (index !== -1) {
                    // Handle legacy managerId update for backward compatibility if needed, 
                    // but primarily we expect 'managerIds' now or we map managerId to managerIds.
                    if (updates.managerId) {
                        updates.managerIds = [updates.managerId];
                        delete updates.managerId;
                    }

                    db.users[index] = { ...db.users[index], ...updates };
                    saveData(); // <--- SAVE
                    console.log(`[API] Updated user ${id}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(db.users[index]));

                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Server Error' }));
            }
        });
        return;
    }

    // DELETE /api/users/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/users/')) {
        const id = url.pathname.split('/').pop();
        const index = db.users.findIndex(u => u.id === id);
        if (index !== -1) {
            db.users.splice(index, 1);
            saveData(); // <--- SAVE
            console.log(`[API] Deleted user ${id}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));

        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
        return;
    }

    // --- MY PAGE APIs ---

    // POST /api/my/quotations (Save Quotation)
    if (req.method === 'POST' && url.pathname === '/api/my/quotations') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // Simple validation
                if (!data.userId || !data.items) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing userId or items' }));
                    return;
                }

                const newId = generateId('Q', data.userId, data.customerName, db.quotations);

                const newQuote = {
                    id: newId,
                    userId: data.userId,
                    items: data.items,
                    totalAmount: data.totalAmount || 0,
                    customerName: data.customerName || '',
                    status: 'SUBMITTED',
                    createdAt: new Date().toISOString()
                };

                db.quotations.unshift(newQuote); // Add to beginning
                saveData(); // <--- SAVE
                console.log(`[API] Saved quotation ${newId} for user ${data.userId}`);

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
        const requesterId = req.headers['x-requester-id'];
        const requesterRole = req.headers['x-requester-role'];

        // 1. Customer Mode: specific userId requested
        if (userId) {
            const userQuotes = db.quotations.filter(q => q.userId === userId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(userQuotes));
            return;
        }

        // 2. Admin Mode: List All (Scoped)
        if (requesterRole === 'MANAGER' && requesterId) {
            // Filter: Only customers assigned to this manager (Check if requesterId is in user.managerIds)
            const managedUserIds = db.users.filter(u =>
                (u.managerIds && u.managerIds.includes(requesterId)) ||
                (u.managerId === requesterId) // Backwards compatibility
            ).map(u => u.id);
            const managedQuotes = db.quotations.filter(q => managedUserIds.includes(q.userId));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(managedQuotes));
        } else {
            // MASTER or unknown: Return All
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(db.quotations));
        }

        return;
    }

    // POST /api/my/orders (Submit Order)
    if (req.method === 'POST' && url.pathname === '/api/my/orders') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);

                // Extract Customer Name (try top level or inside customer object)
                const custName = data.customerName || (data.customer && data.customer.company_name) || '';

                const newId = generateId('O', data.userId, custName, db.orders);

                const newOrder = {
                    id: newId,
                    ...data,
                    status: 'submitted',
                    createdAt: new Date().toISOString()
                };

                db.orders.unshift(newOrder);
                saveData(); // <--- SAVE
                console.log(`[API] Created order ${newId}`);

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
        const requesterId = req.headers['x-requester-id'];
        const requesterRole = req.headers['x-requester-role'];

        if (userId) {
            const userOrders = db.orders.filter(o => o.userId === userId || (o.customer && o.customer.email === userId));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(userOrders));
            return;
        }

        // Admin Mode: List All (Scoped)
        if (requesterRole === 'MANAGER' && requesterId) {
            const managedUserIds = db.users.filter(u =>
                (u.managerIds && u.managerIds.includes(requesterId)) ||
                (u.managerId === requesterId)
            ).map(u => u.id);
            const managedOrders = db.orders.filter(o => managedUserIds.includes(o.userId));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(managedOrders));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(db.orders));
        }

        return;
    }

    // PATCH /api/my/quotations/:id (Update Quotation)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/quotations/')) {
        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const updates = JSON.parse(body);
                const index = db.quotations.findIndex(q => q.id === id);

                if (index !== -1) {
                    // Update the quotation in memory
                    db.quotations[index] = { ...db.quotations[index], ...updates };
                    saveData(); // <--- SAVE
                    console.log(`[API] Updated quotation ${id}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(db.quotations[index]));

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

    // DELETE /api/my/quotations/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/my/quotations/')) {
        const id = url.pathname.split('/').pop();
        const index = db.quotations.findIndex(q => q.id === id);

        if (index !== -1) {
            db.quotations.splice(index, 1);
            saveData(); // <--- SAVE
            console.log(`[API] Deleted quotation ${id}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));

        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
        return;
    }

    // DELETE /api/my/orders/:id
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/my/orders/')) {
        const id = url.pathname.split('/').pop();
        const index = db.orders.findIndex(o => o.id === id);

        if (index !== -1) {
            db.orders.splice(index, 1);
            saveData(); // <--- SAVE
            console.log(`[API] Deleted order ${id}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));

        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
        return;
    }
    res.end();
});

server.listen(PORT, () => {
    console.log(`Local API Server running at http://localhost:${PORT}`);
});
