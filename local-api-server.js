import http from 'http';
import aromanize from 'aromanize';
import crypto from 'crypto';
import zlib from 'zlib';

const PORT = process.env.PORT || 3001;

// --- Persistence Setup ---
import { loadDbFromS3, saveDbToS3, uploadFileToS3, getInventoryFromS3, getPresignedUrlToS3 } from './s3-db.js';

import multer from 'multer';

// Internal Multer setup for raw HTTP
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
}).single('file');

// Initial Data Structure
let db = {
    users: [],
    quotations: [],
    orders: [],
    loginLogs: []
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
            console.log(`[API] Loaded data from S3: ${db.users.length} users, ${db.quotations.length} quotes, ${db.orders.length} orders, ${db.loginLogs.length} logs`);
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

// Initialize
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
            const key = parsed.pathname.slice(1); // remove leading slash

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

            // Check memory cache first
            if (!inventoryCache.gzippedData || (now - inventoryCache.timestamp) > CACHE_TTL) {
                console.log('[API] Cache miss. Fetching inventory from S3...');
                const inventoryData = await getInventoryFromS3();

                const rawJson = JSON.stringify(inventoryData);
                inventoryCache.rawData = Buffer.from(rawJson, 'utf-8');
                inventoryCache.gzippedData = zlib.gzipSync(inventoryCache.rawData);
                inventoryCache.timestamp = now;
            } else {
                console.log('[API] Cache hit. Serving inventory from memory.');
            }

            const acceptEncoding = req.headers['accept-encoding'] || '';

            // Serve Gzip if supported by browser
            if (acceptEncoding.includes('gzip')) {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Encoding': 'gzip',
                    'Cache-Control': 'public, max-age=300'
                });
                res.end(inventoryCache.gzippedData);
            } else {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=300'
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

                const user = db.users.find(u => u.email === email && u.password === password);

                if (user) {
                    if (user.role !== 'MASTER' && user.status !== 'APPROVED') {
                        console.log(`[API] Login failed: User ${email} is pending approval`);
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'PENDING_APPROVAL' }));
                        return;
                    }
                    // Update lastLoginAt
                    user.lastLoginAt = Date.now();
                    
                    // Return user without password
                    const { password, ...userWithoutPassword } = user;
                    console.log(`[API] Login success: ${email}`);

                    // Generate a new unique token for this login session
                    const loginToken = crypto.randomUUID();

                    // Find all existing sessions for this user
                    const userSessions = [];
                    for (const [existingToken, session] of activeSessions.entries()) {
                        if (session.userId === user.id) {
                            userSessions.push({ token: existingToken, ...session });
                        }
                    }

                    // Enforce 2-device limit: If there are already 2 or more, remove the oldest until we have space for the new one (so 1 remaining)
                    if (userSessions.length >= 2) {
                        // Sort by lastSeen (ascending = oldest first)
                        userSessions.sort((a, b) => a.lastSeen - b.lastSeen);
                        // Calculate how many we need to remove to leave exactly 1 session (so adding the new one makes it 2)
                        const overLimitCount = userSessions.length - 1;
                        for (let i = 0; i < overLimitCount; i++) {
                            const oldestSession = userSessions[i];
                            activeSessions.delete(oldestSession.token);
                            console.log(`[API] Device limit reached. Cleared oldest session for user ${email}`);
                        }
                    }

                    // Store new session
                    activeSessions.set(loginToken, {
                        userId: user.id,
                        email: user.email,
                        companyName: user.companyName,
                        role: user.role,
                        lastSeen: Date.now(),
                        activity: 'Logging in...',
                        ip: req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'Unknown'
                    });

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
                    // Keep only last 1000 logs
                    if (db.loginLogs.length > 1000) db.loginLogs.shift();
                    
                    // Save to S3
                    await saveData();

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // Send token along with user data
                    res.end(JSON.stringify({ user: userWithoutPassword, token: loginToken }));
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
                const dbUser = db.users.find(u => u.id === session.userId);
                if (dbUser) {
                    // To avoid spamming S3 on every heartbeat, only save if it's been more than 5 minutes
                    const lastLogin = dbUser.lastLoginAt || 0;
                    if (now - lastLogin > 5 * 60 * 1000) {
                        dbUser.lastLoginAt = now;
                        await saveData();
                    }
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
                    await saveData();
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
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin') {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        const now = Date.now();
        const activeList = [];

        for (const [token, session] of activeSessions.entries()) {
            if (now - session.lastSeen <= SESSION_TIMEOUT_MS) {
                activeList.push(session);
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(activeList));
        return;
    }

    // GET /api/admin/login-logs
    if (req.method === 'GET' && url.pathname === '/api/admin/login-logs') {
        const requesterRole = req.headers['x-requester-role'];
        if (requesterRole !== 'MASTER' && requesterRole !== 'admin') {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        // Return the last 200 logs, sorted by descending timestamp
        const logs = [...db.loginLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(logs));
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
                await saveData(); // <--- SAVE
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
        req.on('end', async () => {
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

                    // Save original state for rollback
                    const originalState = { ...db.users[index] };
                    db.users[index] = { ...db.users[index], ...updates };

                    try {
                        await saveData(); // <--- SAVE
                        console.log(`[API] Updated user ${id}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(db.users[index]));
                    } catch (saveError) {
                        // Rollback on S3 save failure
                        db.users[index] = originalState;
                        throw saveError;
                    }

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
        const index = db.users.findIndex(u => u.id === id);
        if (index !== -1) {
            db.users.splice(index, 1);
            await saveData(); // <--- SAVE
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
        req.on('end', async () => {
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
                    customerNumber: data.customerNumber || '',
                    customerInfo: data.customerInfo,
                    status: data.status || 'SUBMITTED',
                    createdAt: new Date().toISOString(),
                    memo: data.memo, // Save Inquiry Memo
                    attachments: data.attachments || []
                };

                db.quotations.unshift(newQuote); // Add to beginning
                await saveData(); // <--- SAVE
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
            const managedQuotes = db.quotations.filter(q => 
                q.userId === requesterId ||
                managedUserIds.includes(q.userId) || 
                (q.manager && q.manager.id === requesterId) ||
                q.managerId === requesterId
            );
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(managedQuotes));
        } else {
            // MASTER or unknown: Return All
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(db.quotations));
        }

        return;
    }

    // PATCH /api/my/quotations/:id (Update Quotation)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/quotations/')) {
        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);
                const index = db.quotations.findIndex(q => q.id === id);

                if (index !== -1) {
                    db.quotations[index] = { ...db.quotations[index], ...updates };
                    await saveData();
                    console.log(`[API] Updated quotation ${id}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(db.quotations[index]));
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
                const custName = data.customerName || (data.customer && data.customer.company_name) || '';

                const newId = generateId('PO', data.userId, custName, db.orders);

                const newOrder = {
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

                db.orders.unshift(newOrder);
                await saveData(); // <--- SAVE
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
            const managedOrders = db.orders.filter(o => 
                o.userId === requesterId ||
                managedUserIds.includes(o.userId) || 
                (o.manager && o.manager.id === requesterId) ||
                o.managerId === requesterId
            );
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
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);
                const index = db.orders.findIndex(o => o.id === id);

                if (index !== -1) {
                    // Update the order in memory
                    db.orders[index] = { ...db.orders[index], ...updates };
                    await saveData(); // <--- SAVE
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

    // POST /api/admin/orders/:id/retract (Retract Order to Quote)
    if (req.method === 'POST' && url.pathname.startsWith('/api/admin/orders/') && url.pathname.endsWith('/retract')) {
        const id = url.pathname.split('/')[4];
        const orderIndex = db.orders.findIndex(o => o.id === id);

        if (orderIndex !== -1) {
            const order = db.orders[orderIndex];
            
            // Construct a Quote object from the Order back to SUBMITTED status
            const newQuote = {
                ...order,
                id: (order.meta && order.meta.linkedQuoteId) ? order.meta.linkedQuoteId : (order.poNumber || order.id), // Re-use Original Quote ID if possible
                status: 'SUBMITTED', // '견적접수' state
                document_type: 'QUOTATION'
            };

            // Remove order from db.orders
            db.orders.splice(orderIndex, 1);

            // Add or update in db.quotations
            const quoteIndex = db.quotations.findIndex(q => q.id === newQuote.id);
            if (quoteIndex !== -1) {
                // If the quote already existed, overwrite it to bring it back to SUBMITTED with the latest order details
                db.quotations[quoteIndex] = { ...db.quotations[quoteIndex], ...newQuote };
            } else {
                db.quotations.unshift(newQuote);
            }

            try {
                await saveData();
                console.log(`[API] Retracted order ${id} to quote ${newQuote.id}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, quote: newQuote }));
            } catch (e) {
                console.error(e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server Error saving data' }));
            }
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Order not found' }));
        }
        return;
    }

    // PATCH /api/my/quotations/:id (Update Quotation)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/quotations/')) {
        const id = url.pathname.split('/').pop();
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const updates = JSON.parse(body);
                const index = db.quotations.findIndex(q => q.id === id);

                if (index !== -1) {
                    // Update the quotation in memory
                    db.quotations[index] = { ...db.quotations[index], ...updates };
                    await saveData(); // <--- SAVE
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
            await saveData(); // <--- SAVE
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
            await saveData(); // <--- SAVE
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
