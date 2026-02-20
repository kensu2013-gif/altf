import http from 'http';
import aromanize from 'aromanize';
import crypto from 'crypto';

const PORT = process.env.PORT || 3001;

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
                    createdAt: new Date().toISOString(),
                    memo: data.memo // Save Inquiry Memo
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

    // PATCH /api/my/orders/:id (Update Order)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/orders/')) {
        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const updates = JSON.parse(body);
                const index = db.orders.findIndex(o => o.id === id);

                if (index !== -1) {
                    // Update the order in memory
                    db.orders[index] = { ...db.orders[index], ...updates };
                    saveData(); // <--- SAVE
                    console.log(`[API] Updated order ${id}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(db.orders[index]));

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
