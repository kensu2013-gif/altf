import './server/polyfills.js';
import http from 'http';
import aromanize from 'aromanize';
import crypto from 'crypto';
import zlib from 'zlib';
import { execSync, exec } from 'child_process';
import { ListObjectVersionsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const PORT = process.env.PORT || 3001;

// --- Persistence Setup ---
import { loadDbFromS3, saveDbToS3, uploadFileToS3, getInventoryFromS3, getPresignedUrlToS3, getPreviousDbVersion, s3Client, BUCKET_NAME } from './s3-db.js';
import { aggregateAllTrends, getPeriodRange } from './report-aggregation.js';
import { generateAiReport } from './ai-report-generator.js';
import { buildCustomerMatchIndex, matchCustomerToCrmFast } from './customer-matching.js';
import { computeDocumentSimilaritySummary } from './similarity-engine.js';
import { mailplugService } from './server/services/mailplugCollector.js';
import { certificateParserService } from './server/services/certificateParser.js';
import { purchaseStockOrderService } from './server/services/purchaseService.js';
import { purchaseBacklogBotService } from './server/services/purchaseBacklogBotService.js';
import { certificateIssuerService } from './server/services/certificateIssuer.js';
import { daekyungInvoiceService } from './server/services/daekyungInvoiceService.js';
import { telegramBotService } from './server/services/telegramBotService.js';
import { makeCredentialService } from './server/services/makeCredentialService.js';
import { makeScenarioService } from './server/services/makeScenarioService.js';
import { inventorySyncService } from './server/services/inventorySyncService.js';
import { kakaoBotService } from './server/services/kakaoBotService.js';
import { sleQuoteReviewService } from './server/services/sleQuoteReviewService.js';
import { ledgerClient } from './server/services/ledgerClient.js';
import { agentControlManager } from './server/services/agentControlManager.js';

import multer from 'multer';

// Internal Multer setup for raw HTTP
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
}).single('file');

const DEFAULT_AI_REPORT_SCHEDULE = () => ({
    weekly: { lastGeneratedAt: null, lastPeriodKey: null, failedAttempts: 0 },
    monthly: { lastGeneratedAt: null, lastPeriodKey: null, failedAttempts: 0 },
    quarterly: { lastGeneratedAt: null, lastPeriodKey: null, failedAttempts: 0 },
    semiannual: { lastGeneratedAt: null, lastPeriodKey: null, failedAttempts: 0 },
});

let db = {
    users: [],
    quotations: [],
    orders: [],
    loginLogs: [],
    inventoryHistory: [],
    customers: [],
    crmEvents: [],
    aiReports: [],
    aiReportSchedule: DEFAULT_AI_REPORT_SCHEDULE(),
    agents: [],
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
            db.aiReports = json.aiReports || [];
            db.aiReportSchedule = json.aiReportSchedule || DEFAULT_AI_REPORT_SCHEDULE();
            db.agents = json.agents || [];
            db.departments = json.departments || [];

            // Local fallback seed for agents if empty
            if (db.agents.length === 0) {
                try {
                    const fs = await import('fs');
                    const localAgentPath = './server/data/agents.json';
                    if (fs.existsSync(localAgentPath)) {
                        db.agents = JSON.parse(fs.readFileSync(localAgentPath, 'utf8'));
                        console.log(`[API] Loaded ${db.agents.length} agents from local backup file.`);
                    }
                } catch (e) {
                    console.log(`[API] Local agents file check note: ${e.message}`);
                }
            }

            // Local fallback seed for departments if empty
            if (db.departments.length === 0) {
                try {
                    const fs = await import('fs');
                    const localDeptPath = './server/data/departments.json';
                    if (fs.existsSync(localDeptPath)) {
                        db.departments = JSON.parse(fs.readFileSync(localDeptPath, 'utf8'));
                        console.log(`[API] Loaded ${db.departments.length} departments from local backup file.`);
                    }
                } catch (e) {
                    console.log(`[API] Local departments file check note: ${e.message}`);
                }
            }

            console.log(`[API] Loaded data from S3: ${db.users.length} users, ${db.quotations.length} quotes, ${db.orders.length} orders, ${db.agents.length} agents, ${db.departments.length} departments, Snapshot Date: ${db.lastSnapshotDate}`);
            
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

            // Seed read-only test user if not exists
            const testUserEmail = 'test1234@test.com';
            const hasTestUser = db.users.some(u => u.email === testUserEmail);
            if (!hasTestUser) {
                const newTestUser = {
                    id: crypto.randomUUID(),
                    email: testUserEmail,
                    password: '1234',
                    companyName: 'AltF ViewOnly Partner',
                    bizNo: '000-00-00000',
                    contactName: '뷰어',
                    phone: '010-0000-0000',
                    address: 'Seoul, Korea',
                    role: 'MANAGER',
                    createdAt: new Date().toISOString(),
                    agreedToTerms: true,
                    agreedToPrivacy: true,
                    agreedToMarketing: true,
                    consentDate: new Date().toISOString(),
                    status: 'APPROVED'
                };
                db.users.push(newTestUser);
                console.log(`[API] Seeded View-Only Test User: ${testUserEmail}`);
                await saveData();
            }

            // Seed kensu2000@naver.com user if not exists or approved
            const kensuUserEmail = 'kensu2000@naver.com';
            const existingKensu = db.users.find(u => u.email === kensuUserEmail);
            if (!existingKensu) {
                const newKensuUser = {
                    id: crypto.randomUUID(),
                    email: kensuUserEmail,
                    password: '1234',
                    companyName: 'AltF Partner (kensu2000)',
                    bizNo: '000-00-00000',
                    contactName: 'kensu2000',
                    phone: '010-0000-0000',
                    address: 'Seoul, Korea',
                    role: 'CUSTOMER',
                    createdAt: new Date().toISOString(),
                    agreedToTerms: true,
                    agreedToPrivacy: true,
                    agreedToMarketing: true,
                    consentDate: new Date().toISOString(),
                    status: 'APPROVED'
                };
                db.users.push(newKensuUser);
                console.log(`[API] Seeded User: ${kensuUserEmail}`);
                await saveData();
            } else if (existingKensu.status !== 'APPROVED') {
                existingKensu.status = 'APPROVED';
                console.log(`[API] Approved User: ${kensuUserEmail}`);
                await saveData();
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
                },
                {
                    id: crypto.randomUUID(),
                    email: 'test1234@test.com',
                    password: '1234',
                    companyName: 'AltF ViewOnly Partner',
                    bizNo: '000-00-00000',
                    contactName: '뷰어',
                    phone: '010-0000-0000',
                    address: 'Seoul, Korea',
                    role: 'MANAGER',
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

// Save Data with Ironclad Anti-Deletion & Multi-Entity Safety Merge Guard
async function saveData() {
    try {
        // [안전 장치 1]: S3 원격 데이터와 로컬 메모리를 실시간 대조하여,
        // 사람이 명시적으로 삭제한 내역이 아닌 발주서 및 견적서의 임의 누락/유실을 100% 원천 차단
        try {
            const remoteDb = await loadDbFromS3();
            if (remoteDb) {
                // 1. 발주서(orders) 유실 방지 가드
                if (Array.isArray(remoteDb.orders) && Array.isArray(db.orders)) {
                    // 비정상적인 대량 누락 감지 방어벽 (데이터 전멸 사고 방지)
                    if (remoteDb.orders.length > 50 && db.orders.length < 10) {
                        console.error(`🚨 [CRITICAL GUARD] 로컬 발주서 수(${db.orders.length})가 원격 수(${remoteDb.orders.length}) 대비 비정상적으로 적습니다. 저장을 중단하고 원격 데이터를 보호 복구합니다.`);
                        db.orders = remoteDb.orders;
                    } else {
                        const localOrderIds = new Set(db.orders.map(o => o.id));
                        const localPoNumbers = new Set(db.orders.map(o => o.poNumber).filter(Boolean));
                        const localOrderNos = new Set(db.orders.map(o => o.orderNo).filter(Boolean));

                        // 원격에는 존재하지만 로컬에 없는 주문 검출 (ID, poNumber, orderNo 종합 검증)
                        const missingFromLocal = remoteDb.orders.filter(ro => {
                            if (localOrderIds.has(ro.id)) return false;
                            if (ro.poNumber && localPoNumbers.has(ro.poNumber)) return false;
                            if (ro.orderNo && localOrderNos.has(ro.orderNo)) return false;
                            return true;
                        });

                        if (missingFromLocal.length > 0) {
                            console.log(`🛡️ [Safety Merge Guard] S3에 존재하는 최신 발주서 ${missingFromLocal.length}건을 로컬 메모리에 자동 보존 병합합니다.`);
                            db.orders = [...missingFromLocal, ...db.orders];
                        }
                    }
                }

                // 2. 견적서(quotations) 유실 방지 가드
                if (Array.isArray(remoteDb.quotations) && Array.isArray(db.quotations)) {
                    if (remoteDb.quotations.length > 50 && db.quotations.length < 10) {
                        console.error(`🚨 [CRITICAL GUARD] 로컬 견적서 수(${db.quotations.length})가 원격 수(${remoteDb.quotations.length}) 대비 비정상적으로 적습니다. 저장을 중단하고 원격 데이터를 보호 복구합니다.`);
                        db.quotations = remoteDb.quotations;
                    } else {
                        const localQuoteIds = new Set(db.quotations.map(q => q.id));
                        const missingQuotes = remoteDb.quotations.filter(rq => !localQuoteIds.has(rq.id));

                        if (missingQuotes.length > 0) {
                            console.log(`🛡️ [Safety Merge Guard] S3에 존재하는 최신 견적서 ${missingQuotes.length}건을 로컬 메모리에 자동 보존 병합합니다.`);
                            db.quotations = [...missingQuotes, ...db.quotations];
                        }
                    }
                }
            }
        } catch (mergeErr) {
            console.warn('[Safety Merge Guard] Warning during S3 verification:', mergeErr.message);
        }

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

// 카카오톡 견적 생성 시 db.quotations 실시간 반영 훅
kakaoBotService.onQuotationCreated = (draftQuote) => {
    try {
        if (!db.quotations) db.quotations = [];
        const idx = db.quotations.findIndex(q => q.id === draftQuote.id);
        if (idx === -1) {
            db.quotations.unshift(draftQuote);
        } else {
            db.quotations[idx] = { ...db.quotations[idx], ...draftQuote };
        }
        queueSave();
        console.log(`[API] ⚡ 카카오 견적서 db.quotations 실시간 동기화 완료: ${draftQuote.id} (${draftQuote.status || 'SUBMITTED'})`);
    } catch (e) {
        console.error('[API] 카카오 견적서 동기화 오류:', e.message);
    }
};

kakaoBotService.onQuotationUpdated = (updatedQuote) => {
    try {
        if (!db.quotations) db.quotations = [];
        const idx = db.quotations.findIndex(q => q.id === updatedQuote.id);
        if (idx !== -1) {
            const wasDeleted = db.quotations[idx].isDeleted;
            db.quotations[idx] = { 
                ...db.quotations[idx], 
                ...updatedQuote,
                isDeleted: updatedQuote.isDeleted !== undefined ? updatedQuote.isDeleted : wasDeleted
            };
            queueSave();
            console.log(`[API] ⚡ 카카오 견적서 상태 업데이트 동기화: ${updatedQuote.id} (${updatedQuote.status})`);
        }
    } catch (e) {
        console.error('[API] 카카오 견적서 업데이트 동기화 오류:', e.message);
    }
};

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
ledgerClient.bindInternalContext({ db, updateDb });

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

// --- AI Business Report Scheduler (weekly/monthly/quarterly/semiannual, MASTER only) ---
const AI_REPORT_PERIODS = ['weekly', 'monthly', 'quarterly', 'semiannual'];
const AI_REPORT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 시간당 체크 — 트리거일이 지나가도 최대 1시간 내 감지
const AI_REPORT_MAX_FAILED_ATTEMPTS = 5;

function isAiReportTriggerDay(period, kstNow) {
    // kstNow는 Date.now()+9h로 보정된 값이므로, 서버 로컬 타임존과 무관하게 정확한 KST 달력값을 얻으려면
    // 반드시 UTC getter를 사용해야 한다(로컬 getter를 쓰면 서버가 UTC가 아닌 타임존일 때 어긋남).
    const day = kstNow.getUTCDay();      // 0=일 ... 1=월
    const date = kstNow.getUTCDate();
    const month = kstNow.getUTCMonth();  // 0-indexed
    switch (period) {
        case 'weekly': return day === 1;                                  // 매주 월요일
        case 'monthly': return date === 1;                                // 매월 1일
        case 'quarterly': return date === 1 && [0, 3, 6, 9].includes(month);   // 1/4/7/10월 1일
        case 'semiannual': return date === 1 && [0, 6].includes(month);        // 1/7월 1일
        default: return false;
    }
}

async function checkAndGenerateAiReports() {
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000); // 기존 프론트 KST 보정 패턴과 동일
    for (const period of AI_REPORT_PERIODS) {
        try {
            const { periodKey, rangeStart, rangeEnd } = getPeriodRange(period, kstNow);
            const sched = db.aiReportSchedule?.[period] || {};
            if (sched.lastPeriodKey === periodKey) continue; // 이미 생성됨(재시작해도 중복 방지)
            if (!isAiReportTriggerDay(period, kstNow)) continue; // 아직 트리거일 아님

            console.log(`[AI Report] Generating ${period} report for ${periodKey}...`);
            const metrics = await aggregateAllTrends(db, period, kstNow);

            let patch;
            try {
                const aiResult = await generateAiReport(period, metrics);
                patch = { status: 'SUCCESS', ...aiResult };
            } catch (aiErr) {
                console.error(`[AI Report] Claude API call failed for ${period}/${periodKey}:`, aiErr);
                patch = { status: 'FAILED', errorMessage: String(aiErr?.message || aiErr) };
            }

            await updateDb(() => {
                db.aiReports = db.aiReports || [];
                db.aiReports.unshift({
                    id: `rpt_${period}_${periodKey}_${crypto.randomUUID()}`,
                    period,
                    periodKey,
                    rangeStart,
                    rangeEnd,
                    generatedAt: new Date().toISOString(),
                    metrics,
                    ...patch,
                });
                if (db.aiReports.length > 200) db.aiReports.length = 200; // 무한 증가 방지

                db.aiReportSchedule = db.aiReportSchedule || DEFAULT_AI_REPORT_SCHEDULE();
                const s = db.aiReportSchedule[period] || { failedAttempts: 0 };
                if (patch.status === 'SUCCESS') {
                    db.aiReportSchedule[period] = { lastGeneratedAt: new Date().toISOString(), lastPeriodKey: periodKey, failedAttempts: 0 };
                } else {
                    s.failedAttempts = (s.failedAttempts || 0) + 1;
                    // 연속 실패 시 해당 주기는 포기(무한 재시도로 API 비용/에러 로그 낭비 방지) — 수동 트리거로만 복구 가능
                    if (s.failedAttempts >= AI_REPORT_MAX_FAILED_ATTEMPTS) s.lastPeriodKey = periodKey;
                    db.aiReportSchedule[period] = s;
                }
            });
        } catch (err) {
            console.error(`[AI Report] Unexpected error while processing ${period}:`, err);
        }
    }
}

// 부팅 30초 후 1회(재시작 중 놓친 기간을 즉시 캐치업) + 이후 매시간 체크
setTimeout(() => { checkAndGenerateAiReports().catch(e => console.error('[AI Report] Catch-up run failed:', e)); }, 30 * 1000);
setInterval(() => { checkAndGenerateAiReports().catch(e => console.error('[AI Report] Scheduled run failed:', e)); }, AI_REPORT_CHECK_INTERVAL_MS);

// --- Global Memory Cache ---
let inventoryCache = {
    gzippedData: null,
    rawData: null,
    parsedData: null,
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
                    inventoryCache.parsedData = null;
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

// Non-intrusive in-memory rate limiter for login brute-force protection
const loginFailures = new Map(); // key -> { count, lockedUntil, firstAttempt }
const checkLoginRateLimit = (key) => {
    const now = Date.now();
    const entry = loginFailures.get(key);
    if (!entry) return true;
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return false;
    }
    if (entry.lockedUntil && now >= entry.lockedUntil) {
        loginFailures.delete(key);
        return true;
    }
    return true;
};
const recordLoginFailure = (key) => {
    const now = Date.now();
    const entry = loginFailures.get(key) || { count: 0, firstAttempt: now };
    if (now - entry.firstAttempt > 60000) {
        entry.count = 1;
        entry.firstAttempt = now;
        delete entry.lockedUntil;
    } else {
        entry.count++;
    }
    if (entry.count >= 10) {
        entry.lockedUntil = now + 30000; // 30 seconds cooldown
    }
    loginFailures.set(key, entry);
};
const clearLoginFailure = (key) => {
    loginFailures.delete(key);
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

const parseBody = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        try {
            resolve(body ? JSON.parse(body) : {});
        } catch {
            resolve({});
        }
    });
});

const server = http.createServer(async (req, res) => {
    // Global body size limit protection against DoS memory exhaustion (25MB limit)
    let receivedBytes = 0;
    const MAX_BODY_BYTES = 25 * 1024 * 1024;
    req.on('data', chunk => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_BODY_BYTES) {
            req.destroy();
            if (!res.headersSent) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload Too Large' }));
            }
        }
    });

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-requester-id, x-requester-role, Authorization, x-agent-service-token');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // Read-only user (test1234@test.com) restriction middleware
    const session = getAuthenticatedSession(req);
    if (session && session.email === 'test1234@test.com') {
        const isWriteMethod = !['GET', 'OPTIONS'].includes(req.method);
        const isHeartbeatOrLogout = ['/api/auth/heartbeat', '/api/auth/logout'].includes(url.pathname);
        if (isWriteMethod && !isHeartbeatOrLogout) {
            console.log(`[ReadOnly Block] Prevented ${req.method} ${url.pathname} for user ${session.email}`);
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '수정 및 입력 권한이 없습니다. (읽기 전용 계정)' }));
            return;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🏢 B2B AI AGENTS PERSISTENCE ENDPOINTS (다른 컴퓨터에서도 연속 작업 지원)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname === '/api/agents') {
        if (req.method === 'GET') {
            try {
                const fs = await import('fs');
                const localAgentPath = './server/data/agents.json';
                if (fs.existsSync(localAgentPath)) {
                    db.agents = JSON.parse(fs.readFileSync(localAgentPath, 'utf8'));
                }
            } catch (readErr) {
                console.warn('[API] Could not refresh agents from file:', readErr.message);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                success: true,
                agents: db.agents || []
            }));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const agentList = Array.isArray(data) ? data : (data.agents || []);
                    db.agents = agentList;

                    // 1. 로컬 백업 저장 (S3 연결 여부와 무관하게 즉시 보존)
                    try {
                        const fs = await import('fs');
                        const dataDir = './server/data';
                        if (!fs.existsSync(dataDir)) {
                            fs.mkdirSync(dataDir, { recursive: true });
                        }
                        fs.writeFileSync('./server/data/agents.json', JSON.stringify(agentList, null, 2), 'utf8');
                    } catch (fsErr) {
                        console.error('[API] Local agents.json write error:', fsErr.message);
                    }

                    // 2. S3 DB 비동기 큐 동기화
                    queueSave();

                    // 3. 🎛️ 에이전트 제어 관리자(대시보드 통제 우선권) 실시간 리로드 & 브로드캐스트
                    try {
                        agentControlManager.reloadAgents(agentList);
                    } catch (ctrlErr) {
                        console.warn('[API] AgentControlManager reload warning:', ctrlErr.message);
                    }

                    console.log(`[API] Successfully saved ${agentList.length} agents to DB & local backup.`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, count: agentList.length }));
                    return;
                } catch (e) {
                    console.error('[API] Save agents failed:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    // 🎛️ 단일 에이전트 상태/주기 직접 제어 API (대시보드 즉시 반영)
    if (url.pathname === '/api/agents/control' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { code, id, status, scheduleInterval } = JSON.parse(body || '{}');
                const targetKey = code || id;
                if (!targetKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'agent code or id is required' }));
                    return;
                }

                const result = agentControlManager.updateAgentConfig(targetKey, {
                    ...(status !== undefined ? { status } : {}),
                    ...(scheduleInterval !== undefined ? { scheduleInterval } : {})
                });

                // db.agents 및 S3 큐 동기화
                db.agents = agentControlManager.agentsCache;
                queueSave();

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, agent: result.agent }));
                return;
            } catch (e) {
                console.error('[API] Agent control failed:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🏛️ B2B AGENT LEDGER API (단일 원장 API: 0-B 규격)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname.startsWith('/api/agent/orders')) {
        const token = req.headers['x-agent-service-token'] || 
                      (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : null);
        const validToken = process.env.AGENT_SERVICE_TOKEN || 'altf-agent-token-2026-secure';
        const session = getAuthenticatedSession(req);
        const isMaster = session && (session.role === 'MASTER' || session.role === 'admin' || session.role === 'manager' || session.role === 'MANAGER');
        const isAgentAuth = (token && token === validToken) || isMaster;

        if (!isAgentAuth) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid Agent Service Token' }));
            return;
        }

        // 1. GET /api/agent/orders : 주문 목록 조회 (필터링 지원)
        if (req.method === 'GET' && url.pathname === '/api/agent/orders') {
            try {
                let orders = db.orders || [];
                const status = url.searchParams.get('status');
                const customerName = url.searchParams.get('customerName');
                const limit = url.searchParams.get('limit');

                if (status) orders = orders.filter(o => o.status === status);
                if (customerName) {
                    const q = customerName.toLowerCase();
                    orders = orders.filter(o => (o.customerName || '').toLowerCase().includes(q));
                }
                if (limit) orders = orders.slice(0, Number(limit));

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, count: orders.length, orders }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 2. POST /api/agent/orders : 신규 주문 등록
        if (req.method === 'POST' && url.pathname === '/api/agent/orders') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const orderData = JSON.parse(body);
                    const newOrder = await ledgerClient.createOrder(orderData);
                    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, order: newOrder }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // 3. GET /api/agent/orders/:id : 단일 주문 상세
        const orderIdMatch = url.pathname.match(/^\/api\/agent\/orders\/([^\/]+)$/);
        if (req.method === 'GET' && orderIdMatch) {
            const orderId = decodeURIComponent(orderIdMatch[1]);
            const order = await ledgerClient.getOrder(orderId);
            if (!order) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `Order not found: ${orderId}` }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, order }));
            return;
        }

        // 4. PATCH /api/agent/orders/:id/lines/:lineId : 주문 품목 라인 수정 (S/D/M, lineStatus, lotNo 등)
        const lineMatch = url.pathname.match(/^\/api\/agent\/orders\/([^\/]+)\/lines\/([^\/]+)$/);
        if (req.method === 'PATCH' && lineMatch) {
            const orderId = decodeURIComponent(lineMatch[1]);
            const lineId = decodeURIComponent(lineMatch[2]);
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const updates = payload.updates || payload;
                    const meta = payload.meta || {};
                    const result = await ledgerClient.updateOrderLine(orderId, lineId, updates, meta);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(err.message.includes('not found') ? 404 : 500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }

        // 5. POST /api/agent/orders/:id/events : 주문 감사 이벤트 추가
        const eventMatch = url.pathname.match(/^\/api\/agent\/orders\/([^\/]+)\/events$/);
        if (req.method === 'POST' && eventMatch) {
            const orderId = decodeURIComponent(eventMatch[1]);
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const eventData = JSON.parse(body || '{}');
                    const result = await ledgerClient.appendOrderEvent(orderId, eventData);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (err) {
                    res.writeHead(err.message.includes('not found') ? 404 : 500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            return;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🏢 B2B DEPARTMENTS PERSISTENCE ENDPOINTS (부서 추가/수정/삭제 관리)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname === '/api/departments') {
        if (req.method === 'GET') {
            try {
                const fs = await import('fs');
                const localDeptPath = './server/data/departments.json';
                if (fs.existsSync(localDeptPath)) {
                    db.departments = JSON.parse(fs.readFileSync(localDeptPath, 'utf8'));
                }
            } catch (readErr) {
                console.warn('[API] Could not refresh departments from file:', readErr.message);
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                success: true,
                departments: db.departments || []
            }));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const deptList = Array.isArray(data) ? data : (data.departments || []);
                    db.departments = deptList;

                    // 1. 로컬 백업 저장
                    try {
                        const fs = await import('fs');
                        const dataDir = './server/data';
                        if (!fs.existsSync(dataDir)) {
                            fs.mkdirSync(dataDir, { recursive: true });
                        }
                        fs.writeFileSync('./server/data/departments.json', JSON.stringify(deptList, null, 2), 'utf8');
                    } catch (fsErr) {
                        console.error('[API] Local departments.json write error:', fsErr.message);
                    }

                    // 2. S3 DB 비동기 큐 동기화
                    queueSave();

                    console.log(`[API] Successfully saved ${deptList.length} departments to DB & local backup.`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, count: deptList.length }));
                    return;
                } catch (e) {
                    console.error('[API] Save departments failed:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🤖 QC-02 AGENT API : MTC 비전 판독 및 다중 페이지 성적서 대장 누적
    if (url.pathname.startsWith('/api/qc/qc02')) {
        // 1. POST /api/qc/qc02/run : QC-02 에이전트 실행 (누적 모드)
        if (req.method === 'POST' && url.pathname === '/api/qc/qc02/run') {
            try {
                const parseResult = await certificateParserService.runQC02Agent({ incremental: true });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(parseResult));
                return;
            } catch (err) {
                console.error('[API] QC-02 execution failed:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 2. GET /api/qc/qc02/status : QC-02 처리 상태 및 통계 조회
        if (req.method === 'GET' && url.pathname === '/api/qc/qc02/status') {
            try {
                const status = certificateParserService.getQC02Status();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, ...status }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }
    }

    // 🔬 QC CERTIFICATE LEDGER API (대경벤드 성적서.xlsx 및 구글시트 100% 호환)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname.startsWith('/api/certificates')) {
        const certJsonPath = './server/data/certificates.json';
        const certExcelPath = './storage/certificates/대경벤드 성적서.xlsx';

        // 1. GET /api/certificates : 26개 컬럼 장부 및 이상치 품질 통계 조회
        if (req.method === 'GET' && url.pathname === '/api/certificates') {
            try {
                const ledger = certificateParserService.getLedgerData();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ 
                    success: true, 
                    count: ledger.count, 
                    stats: ledger.stats,
                    rows: ledger.rows 
                }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 2. POST /api/certificates/parse-all : 전체 보관 PDF 일괄 파싱 및 엑셀/JSON 동기화
        if (req.method === 'POST' && url.pathname === '/api/certificates/parse-all') {
            try {
                const parseResult = await certificateParserService.parseAndSyncAll();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(parseResult));
                return;
            } catch (err) {
                console.error('[API] Parse all certificates failed:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 3. GET /api/certificates/stats : 품질 검사 통계 및 이상치 목록
        if (req.method === 'GET' && url.pathname === '/api/certificates/stats') {
            try {
                const ledger = certificateParserService.getLedgerData();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, stats: ledger.stats }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 4. GET /api/certificates/download-excel : '대경벤드 성적서.xlsx' 다운로드
        if (req.method === 'GET' && url.pathname === '/api/certificates/download-excel') {
            try {
                const fs = await import('fs');
                if (!fs.existsSync(certExcelPath)) {
                    // 없으면 즉시 동기화 실행
                    await certificateParserService.parseAndSyncAll();
                }
                const fileBuffer = fs.readFileSync(certExcelPath);
                res.writeHead(200, {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': 'attachment; filename="daekyung_bend_certificates.xlsx"',
                    'Content-Length': fileBuffer.length
                });
                res.end(fileBuffer);
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // 5. POST /api/certificates : 행 수동 추가 / 수정
        if (req.method === 'POST' && url.pathname === '/api/certificates') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const fs = await import('fs');
                    const xlsx = await import('xlsx');
                    const data = JSON.parse(body);
                    const newRows = Array.isArray(data) ? data : (data.rows ? data.rows : [data]);

                    let currentRows = [];
                    if (fs.existsSync(certJsonPath)) {
                        currentRows = JSON.parse(fs.readFileSync(certJsonPath, 'utf8'));
                    }

                    const updatedRows = [...currentRows, ...newRows];
                    fs.writeFileSync(certJsonPath, JSON.stringify(updatedRows, null, 2), 'utf8');

                    const sheetHeaders = [
                        '일 자', 'Customer', '공급처', 'P.O No', 'CERT-No',
                        'Spec MATERIAL', 'Spec INSPECTION', 'HEAT No', 'LOT No', 'ITEM No',
                        'DESCRIPTION', 'Q\'TY', 'MATERIAL', 'C', 'Si', 'Mn', 'P', 'S',
                        'Ni', 'Cr', 'Mo', 'Y.S', 'T.S', 'E.L', '외관/치수', 'PDF 원본링크'
                    ];

                    const excelData = [
                        sheetHeaders,
                        ...updatedRows.map(r => [
                            r.issueDate, r.customer, r.supplier, r.poNo, r.certNo,
                            r.specMaterial, r.specInspection, r.heatNo, r.lotNo, r.itemNo,
                            r.description, r.qty, r.material, r.chemC, r.chemSi, r.chemMn,
                            r.chemP, r.chemS, r.chemNi, r.chemCr, r.chemMo, r.mechYs,
                            r.mechTs, r.mechEl, r.dimensionVi, r.pdfUrl
                        ])
                    ];

                    const wb = xlsx.utils.book_new();
                    const ws = xlsx.utils.aoa_to_sheet(excelData);
                    xlsx.utils.book_append_sheet(wb, ws, '대경벤드성적서');
                    xlsx.writeFile(wb, certExcelPath);

                    console.log(`[API] Successfully synced ${updatedRows.length} certificate rows to JSON & Excel.`);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, count: updatedRows.length, added: newRows.length }));
                    return;
                } catch (e) {
                    console.error('[API] Save certificates failed:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📬 QC-01 MAILPLUG COLLECTOR API (메일플러그 대경벤드성적서 연동)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname.startsWith('/api/qc/mailplug')) {
        // GET /api/qc/mailplug/status
        if (req.method === 'GET' && url.pathname === '/api/qc/mailplug/status') {
            try {
                const config = mailplugService.getConfig();
                const history = mailplugService.getHistory();
                // 비밀번호 마스킹 처리
                const safeConfig = {
                    ...config,
                    password: config.password ? '********' : ''
                };
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    config: safeConfig,
                    lastSync: config.lastSyncTime,
                    historyCount: history.length,
                    recentHistory: history.slice(0, 5)
                }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // POST /api/qc/mailplug/config
        if (req.method === 'POST' && url.pathname === '/api/qc/mailplug/config') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const saved = mailplugService.saveConfig(data);
                    const safeSaved = { ...saved, password: saved.password ? '********' : '' };
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, config: safeSaved }));
                    return;
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // POST /api/qc/mailplug/sync (실시간 수집 실행)
        if (req.method === 'POST' && url.pathname === '/api/qc/mailplug/sync') {
            try {
                const result = await mailplugService.syncNow();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, result }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // POST /api/qc/mailplug/test (IMAP 연결 테스트)
        if (req.method === 'POST' && url.pathname === '/api/qc/mailplug/test') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    let configOverride = null;
                    if (body) {
                        try { configOverride = JSON.parse(body); } catch {}
                    }
                    const testResult = await mailplugService.testConnection(configOverride);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(testResult));
                    return;
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // POST /api/qc/mailplug/sync-all (전체 PDF 일괄 수집 Batch Sync)
        if (req.method === 'POST' && url.pathname === '/api/qc/mailplug/sync-all') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    let limit = 30;
                    if (body) {
                        try {
                            const parsed = JSON.parse(body);
                            if (parsed.limit) limit = parsed.limit;
                        } catch {}
                    }
                    const batchResult = await mailplugService.syncAllBatch(limit);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(batchResult));
                    return;
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // GET /api/qc/mailplug/batch-status (일괄 수집 진행 상황)
        if (req.method === 'GET' && url.pathname === '/api/qc/mailplug/batch-status') {
            try {
                const status = mailplugService.getBatchStatus();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, ...status }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }

        // GET /api/qc/mailplug/scheduler-status (1시간 주기 자동 스케줄러 상태)
        if (req.method === 'GET' && url.pathname === '/api/qc/mailplug/scheduler-status') {
            try {
                const sched = mailplugService.getSchedulerStatus();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, ...sched }));
                return;
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📂 CERTIFICATE EXPLORER API (윈도우 탐색기 폴더 열기 & 전체 PDF 파일 목록)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname === '/api/certificates/open-folder' && req.method === 'POST') {
        try {
            const { exec } = await import('child_process');
            const path = await import('path');
            const targetDir = path.resolve('./storage/certificates');
            const openCmd = process.platform === 'win32' 
                ? `explorer.exe "${targetDir}"` 
                : process.platform === 'darwin' 
                    ? `open "${targetDir}"` 
                    : `xdg-open "${targetDir}"`;
            exec(openCmd);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, path: targetDir, message: '성적서 저장 폴더가 열렸습니다.' }));
            return;
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
            return;
        }
    }

    if (url.pathname === '/api/certificates/files-list' && req.method === 'GET') {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const baseDir = path.resolve('./storage/certificates');
            const fileList = [];

            if (fs.existsSync(baseDir)) {
                const files = fs.readdirSync(baseDir);
                for (const f of files) {
                    if (f.toLowerCase().endsWith('.pdf')) {
                        const fullFile = path.join(baseDir, f);
                        const stat = fs.statSync(fullFile);
                        fileList.push({
                            filename: f,
                            sizeBytes: stat.size,
                            updatedAt: stat.mtime.toISOString(),
                            url: `/storage/certificates/${encodeURIComponent(f)}`
                        });
                    }
                }
            }

            // 최신 수정순 정렬
            fileList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, count: fileList.length, files: fileList }));
            return;
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
            return;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📂 CERTIFICATE PDF FILE SERVING (성적서 원본 바로보기 및 다운로드)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (url.pathname.startsWith('/storage/certificates/') || url.pathname.startsWith('/api/certificates/files/')) {
        try {
            const fs = await import('fs');
            const path = await import('path');
            
            // Clean requested relative path
            let relativePath = url.pathname.replace('/api/certificates/files/', '').replace('/storage/certificates/', '');
            relativePath = decodeURIComponent(relativePath);
            
            const baseDir = path.resolve('./storage/certificates');
            const targetFilePath = path.join(baseDir, path.basename(relativePath));

            if (!fs.existsSync(targetFilePath) || !fs.statSync(targetFilePath).isFile()) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '요청한 성적서 파일을 찾을 수 없습니다.', requested: relativePath }));
                return;
            }

            const ext = path.extname(targetFilePath).toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === '.pdf') contentType = 'application/pdf';
            else if (ext === '.zip') contentType = 'application/zip';
            else if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

            const stat = fs.statSync(targetFilePath);
            const encodedFilename = encodeURIComponent(path.basename(targetFilePath));

            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stat.size,
                'Content-Disposition': `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
            });

            const stream = fs.createReadStream(targetFilePath);
            stream.pipe(res);
            return;
        } catch (fileErr) {
            console.error('[API] File serve error:', fileErr);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: fileErr.message }));
            return;
        }
    }

    // ==========================================
    // 🛒 구매부 PUR-01 : 알트에프 재고 발주 List Up 전용 REST API
    // ==========================================
    if (url.pathname.startsWith('/api/pur/')) {
        // 1. GET /api/pur/summary : 구매부 현황 지표 요약
        if (req.method === 'GET' && url.pathname === '/api/pur/summary') {
            try {
                const summary = purchaseStockOrderService.getSummary();
                sendJsonResponse(req, res, 200, { success: true, ...summary });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 2. POST /api/pur/sync : 웹 알트에프 재고 발주 신호 감지 & List Up 및 QC 성적서 매칭
        if (req.method === 'POST' && url.pathname === '/api/pur/sync') {
            try {
                const result = purchaseStockOrderService.listUpStockOrders(db.orders);
                sendJsonResponse(req, res, 200, {
                    success: true,
                    totalItems: result.items.length,
                    summary: result.summary,
                    message: `알트에프 재고 발주 ${result.items.length}개 품목 List Up 및 성적서 매칭 완료!`
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 3. GET /api/pur/stock-orders (또는 /api/pur/matches 호환) : 재고 발주 ⟷ 성적서 대장 목록
        if (req.method === 'GET' && (url.pathname === '/api/pur/stock-orders' || url.pathname === '/api/pur/matches')) {
            try {
                const urlParams = new URLSearchParams(url.search);
                const statusFilter = urlParams.get('status') || 'ALL';
                const search = (urlParams.get('search') || '').toLowerCase().trim();

                const filtered = purchaseStockOrderService.getStockOrders({
                    status: statusFilter,
                    search
                });

                sendJsonResponse(req, res, 200, {
                    success: true,
                    total: filtered.length,
                    items: filtered
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 4. GET /api/pur/download-excel : '알트에프 재고 발주 대장.xlsx' 다운로드
        if (req.method === 'GET' && url.pathname === '/api/pur/download-excel') {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const excelPath = path.resolve('./storage/purchases/알트에프 재고 발주 대장.xlsx');

                if (!fs.existsSync(excelPath)) {
                    purchaseStockOrderService.listUpStockOrders(db.orders);
                }

                if (!fs.existsSync(excelPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '엑셀 파일이 존재하지 않습니다.' }));
                    return;
                }

                const stat = fs.statSync(excelPath);
                const filename = encodeURIComponent('알트에프_재고_발주_대장.xlsx');

                res.writeHead(200, {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Length': stat.size,
                    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`
                });

                const stream = fs.createReadStream(excelPath);
                stream.pipe(res);
                return;
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
                return;
            }
        }

        // 5. POST /api/pur/open-folder : 구매부 보관함 폴더(storage/purchases) 탐색기 열기
        if (req.method === 'POST' && url.pathname === '/api/pur/open-folder') {
            try {
                const path = await import('path');
                const targetDir = path.resolve('./storage/purchases');
                const isWin = process.platform === 'win32';
                const isMac = process.platform === 'darwin';

                let cmd = '';
                if (isWin) cmd = `explorer "${targetDir}"`;
                else if (isMac) cmd = `open "${targetDir}"`;
                else cmd = `xdg-open "${targetDir}"`;

                exec(cmd, (err) => {
                    if (err) {
                        console.error('[PUR-01] 폴더 열기 오류:', err.message);
                    }
                });

                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: `구매부 보관함 폴더 열기 완료: ${targetDir}`,
                    folderPath: targetDir
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 6. GET /api/pur/scheduler-status : 하루 1회 altf.kr 감지 스케줄러 상태 및 다음 동기화 시각
        if (req.method === 'GET' && url.pathname === '/api/pur/scheduler-status') {
            try {
                const status = purchaseStockOrderService.getSchedulerStatus();
                sendJsonResponse(req, res, 200, {
                    success: true,
                    ...status
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 7. POST /api/pur/scheduler-trigger : altf.kr API 호출 즉시 감지 & 재고 발주 대장 수동 갱신
        if (req.method === 'POST' && url.pathname === '/api/pur/scheduler-trigger') {
            try {
                const result = await purchaseStockOrderService.syncFromAltfApi(true);
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: 'altf.kr API 호출 감지 및 재고 발주 대장 즉시 동기화 완료!',
                    ...result
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // ==========================================
        // 🛒 구매부 PUR-07 : 주문관리 발주서 분류 및 미결 통합 관제 REST API
        // ==========================================
        // 8. GET /api/pur/pur07/summary : 발주 분류 요약 & 미결/패키징 현황
        if (req.method === 'GET' && url.pathname === '/api/pur/pur07/summary') {
            try {
                const summary = purchaseBacklogBotService.cache.summary || purchaseBacklogBotService.classifyAndSyncBacklog(db.orders).summary;
                sendJsonResponse(req, res, 200, { success: true, summary });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 9. GET /api/pur/pur07/backlog : 미결 목록 및 필터링 조회
        if (req.method === 'GET' && url.pathname === '/api/pur/pur07/backlog') {
            try {
                const urlParams = new URLSearchParams(url.search);
                const customer = urlParams.get('customer') || '';
                const date = urlParams.get('date') || '';
                const status = urlParams.get('status') || 'ALL';
                const search = urlParams.get('search') || '';
                const limit = parseInt(urlParams.get('limit') || '100', 10);
                const offset = parseInt(urlParams.get('offset') || '0', 10);

                const data = purchaseBacklogBotService.getBacklog({ customer, date, status, search, limit, offset });
                sendJsonResponse(req, res, 200, { success: true, ...data });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 10. POST /api/pur/pur07/sync : 발주서 수동 즉시 동기화
        if (req.method === 'POST' && url.pathname === '/api/pur/pur07/sync') {
            try {
                const result = purchaseBacklogBotService.classifyAndSyncBacklog(db.orders);
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: 'PUR-07 발주 분류 및 미결 대장 동기화 완료!',
                    summary: result.summary
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 11. POST /api/pur/pur07/fulfill : 사무실 담당자 출고 완료 처리 (미결 해제 및 서류 패키징)
        if (req.method === 'POST' && url.pathname === '/api/pur/pur07/fulfill') {
            try {
                const body = await parseBody(req);
                const { orderId, operatorName } = body || {};
                if (!orderId) {
                    sendJsonResponse(req, res, 400, { success: false, error: 'orderId is required' });
                    return;
                }
                const result = purchaseBacklogBotService.fulfillOrder(orderId, operatorName || '사무실 관리자');
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: `발주번호 [${orderId}] 출고 완료 처리 (미결 해제 및 거래명세표/성적서 고객 발송 준비 완료)`,
                    ...result
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 12. GET /api/pur/pur07/packages : 고객 발송 대기 패키지 목록 (출고 완료 + 성적서 + 거래명세표 매칭)
        if (req.method === 'GET' && url.pathname === '/api/pur/pur07/packages') {
            try {
                const packages = purchaseBacklogBotService.cache.readyPackages || [];
                sendJsonResponse(req, res, 200, { success: true, count: packages.length, packages });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 13. GET /api/pur/pur07/scheduler-status : 9시-18시 1시간 주기 스케줄러 상태
        if (req.method === 'GET' && url.pathname === '/api/pur/pur07/scheduler-status') {
            try {
                const status = purchaseBacklogBotService.getSchedulerStatus();
                sendJsonResponse(req, res, 200, { success: true, ...status });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 14. GET /api/pur/pur07/download-excel : '주문관리_발주서_통합대장.xlsx' 다운로드
        if (req.method === 'GET' && url.pathname === '/api/pur/pur07/download-excel') {
            try {
                const excelPath = path.join(ROOT_DIR, 'storage/purchases/주문관리_발주서_통합대장.xlsx');
                if (!fs.existsSync(excelPath)) {
                    purchaseBacklogBotService.exportToExcel();
                }
                const stat = fs.statSync(excelPath);
                res.writeHead(200, {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Length': stat.size,
                    'Content-Disposition': 'attachment; filename*=UTF-8\'\'%EC%A3%BC%EB%AC%B8%EA%B4%80%EB%A6%AC_%EB%B0%9C%EC%A3%BC%EC%84%9C_%ED%86%B5%ED%95%A9%EB%8C%80%EC%9E%A5.xlsx'
                });
                fs.createReadStream(excelPath).pipe(res);
                return;
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
                return;
            }
        }
    }

    // ==========================================
    // 📑 대경벤드 거래명세표(메신저/PDF) 파싱 & 전사 연계 (총무/구매/품질/출고)
    // ==========================================
    if (url.pathname.startsWith('/api/inbound/daekyung-invoice/') || url.pathname.startsWith('/api/inbound/telegram/')) {
        // 1. GET /api/inbound/daekyung-invoice/list : 매입 전표 목록 조회
        if (req.method === 'GET' && url.pathname === '/api/inbound/daekyung-invoice/list') {
            sendJsonResponse(req, res, 200, {
                success: true,
                count: daekyungInvoiceService.invoices.length,
                invoices: daekyungInvoiceService.invoices
            });
            return;
        }

        // 2. POST /api/inbound/daekyung-invoice/simulate : 사진/샘플 기반 즉시 연계 시뮬레이션
        if (req.method === 'POST' && url.pathname === '/api/inbound/daekyung-invoice/simulate') {
            try {
                const body = await parseBody(req);
                const sampleId = body?.sampleId || '0031';

                let sampleData;
                if (sampleId === '0015') {
                    sampleData = {
                        id: 'DKB-INV-SAMPLE-0015',
                        fileName: '20261019_대경벤드_거래명세서_0015.pdf',
                        invoiceNo: '0015- 1/ 1',
                        invoiceDate: '2026-10-19',
                        supplier: {
                            name: '(주)대경벤드',
                            bizNo: '606-81-75098',
                            ceo: '김학철',
                            address: '경남 양산시 어실로 115'
                        },
                        buyer: {
                            name: '알트에프(ALT.F)',
                            bizNo: '838-05-01054',
                            ceo: '조현진',
                            address: '부산광역시 사상구 낙동대로 1330번길 67'
                        },
                        items: [
                            {
                                itemNo: 1,
                                type: 'PRODUCT',
                                name: '45E(S)',
                                rawLine: '45E(S) STS 304-W S/20S ERW 300A',
                                quantity: 2,
                                unit: 'EA',
                                unitPrice: 237830,
                                amount: 475660,
                                poNo: 'ES261019-2915',
                                remarks: '국제밸브앤드피팅 910660201847ES261019-2915'
                            }
                        ],
                        itemCount: 1,
                        poNumbers: ['ES261019-2915'],
                        pricing: {
                            totalSupplyPrice: 475660,
                            freightPrice: 0,
                            subtotal: 475660,
                            vat: 47566,
                            grandTotal: 523226
                        }
                    };
                } else {
                    sampleData = {
                        id: 'DKB-INV-SAMPLE-0031',
                        fileName: '20261019_대경벤드_거래명세서_0031.pdf',
                        invoiceNo: '0031- 1/ 1',
                        invoiceDate: '2026-10-19',
                        supplier: {
                            name: '(주)대경벤드',
                            bizNo: '606-81-75098',
                            ceo: '김학철',
                            address: '경남 양산시 어실로 115'
                        },
                        buyer: {
                            name: '알트에프(ALT.F)',
                            bizNo: '838-05-01054',
                            ceo: '조현진',
                            address: '부산광역시 사상구 낙동대로 1330번길 67'
                        },
                        items: [
                            {
                                itemNo: 1,
                                type: 'PRODUCT',
                                name: '45E(L)',
                                rawLine: '45E(L) STS 304-W S/10S ERW 100A',
                                quantity: 17,
                                unit: 'EA',
                                unitPrice: 23460,
                                amount: 398820,
                                poNo: 'ES261019-2924',
                                remarks: '서울재고 발주분 ES261019-2924'
                            },
                            {
                                itemNo: 2,
                                type: 'FREIGHT',
                                name: '운임',
                                spec: '운송료',
                                quantity: 1,
                                unit: '건',
                                unitPrice: 4000,
                                amount: 4000,
                                poNo: 'ES261019-2924',
                                remarks: '서울재고 발주분 박조나단님 910660201850'
                            }
                        ],
                        itemCount: 2,
                        poNumbers: ['ES261019-2924'],
                        pricing: {
                            totalSupplyPrice: 398820,
                            freightPrice: 4000,
                            subtotal: 402820,
                            vat: 40282,
                            grandTotal: 443102
                        }
                    };
                }

                const result = await daekyungInvoiceService.processAndDispatch(sampleData, 'SIMULATION');
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: `전표 [No:${sampleData.invoiceNo}] 매입 확정 및 전사 4개 부서 자율 연계 완료!`,
                    ...result
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 3. POST /api/inbound/daekyung-invoice/upload : 실제 거래명세서 PDF 파일 업로드 및 파싱
        if (req.method === 'POST' && url.pathname === '/api/inbound/daekyung-invoice/upload') {
            uploadMiddleware(req, res, async (err) => {
                if (err) {
                    sendJsonResponse(req, res, 400, { success: false, error: err.message });
                    return;
                }
                try {
                    if (!req.file || !req.file.buffer) {
                        sendJsonResponse(req, res, 400, { success: false, error: 'PDF 파일이 첨부되지 않았습니다.' });
                        return;
                    }
                    const parsed = await daekyungInvoiceService.parsePdfBuffer(req.file.buffer, originalName);
                    const invoiceList = Array.isArray(parsed) ? parsed : [parsed];
                    const results = [];
                    for (const inv of invoiceList) {
                        const r = await daekyungInvoiceService.processAndDispatch(inv, 'WEB_UPLOAD');
                        results.push(r);
                    }
                    sendJsonResponse(req, res, 200, {
                        success: true,
                        count: results.length,
                        message: `대경벤드 거래명세서 [${invoiceList.map(i => i.invoiceNo).join(', ')}] 총 ${results.length}건 파싱 및 전사 연계 완료!`,
                        results,
                        ...results[0]
                    });
                } catch (parseErr) {
                    sendJsonResponse(req, res, 500, { success: false, error: 'PDF 파싱 실패: ' + parseErr.message });
                }
            });
            return;
        }

        // 4. GET /api/inbound/telegram/status : 텔레그램 봇 연동 상태
        if (req.method === 'GET' && url.pathname === '/api/inbound/telegram/status') {
            sendJsonResponse(req, res, 200, {
                success: true,
                ...telegramBotService.getStatus()
            });
            return;
        }

        // 5. POST /api/inbound/telegram/config : 텔레그램 봇 토큰 및 롱폴링 설정
        if (req.method === 'POST' && url.pathname === '/api/inbound/telegram/config') {
            try {
                const body = await parseBody(req);
                const { botToken, chatId, action } = body || {};
                if (botToken !== undefined || chatId !== undefined) {
                    telegramBotService.setConfig({ botToken, chatId });
                }
                if (action === 'START_POLLING') {
                    telegramBotService.startPolling();
                } else if (action === 'STOP_POLLING') {
                    telegramBotService.stopPolling();
                }
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: '텔레그램 봇 설정이 저장되었습니다.',
                    ...telegramBotService.getStatus()
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }
    }

    // ==========================================
    // ⚡ DAT-01 : Make.com 크리덴셜 및 Reauthorize/Verify 자동화 REST API
    // ==========================================
    if (url.pathname.startsWith('/api/make/')) {
        // 1. GET /api/make/connections : 전체 커넥션 및 요약 상태 조회
        if (req.method === 'GET' && url.pathname === '/api/make/connections') {
            const connections = makeCredentialService.getConnections();
            const summary = makeCredentialService.getStatusSummary();
            sendJsonResponse(req, res, 200, {
                success: true,
                summary,
                connections
            });
            return;
        }

        // 2. POST /api/make/reauthorize : 특정 커넥션 또는 전체 만료 커넥션 Reauthorize & Verify 자동화 실행
        if (req.method === 'POST' && url.pathname === '/api/make/reauthorize') {
            try {
                const body = await parseBody(req);
                const { connectionId, all } = body || {};

                if (all) {
                    const result = await makeCredentialService.reauthorizeAllPending();
                    sendJsonResponse(req, res, 200, result);
                } else if (connectionId) {
                    const result = await makeCredentialService.executeReauthorizeAndVerify(connectionId);
                    sendJsonResponse(req, res, 200, result);
                } else {
                    sendJsonResponse(req, res, 400, { success: false, error: 'connectionId 또는 all:true 파라미터가 필요합니다.' });
                }
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 3. GET /api/make/scenarios : 전체 시나리오 상태 및 DAT-02 감시 요약 조회
        if (req.method === 'GET' && url.pathname === '/api/make/scenarios') {
            const scenarios = makeScenarioService.getScenarios();
            const summary = makeScenarioService.getStatusSummary();
            sendJsonResponse(req, res, 200, {
                success: true,
                summary,
                scenarios
            });
            return;
        }

        // 4. POST /api/make/scenarios/reactivate : Incomplete Executions(Old Data) 삭제 및 Active 재활성화
        if (req.method === 'POST' && url.pathname === '/api/make/scenarios/reactivate') {
            try {
                const body = await parseBody(req);
                const { scenarioId } = body || {};
                const result = await makeScenarioService.reactivateScenario(scenarioId || '2312923', { clearOldData: true });
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 5. POST /api/make/scenarios/simulate-error : 시나리오 비활성화 및 Old Data 적체 시뮬레이션
        if (req.method === 'POST' && url.pathname === '/api/make/scenarios/simulate-error') {
            try {
                const body = await parseBody(req);
                const { scenarioId } = body || {};
                const result = await makeScenarioService.simulateDisruption(scenarioId || '2312923');
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }
    }

    // ==========================================
    // 🟡 영업2팀 INT-02~05 : 카카오톡 채널 다이렉트 견적 입수봇 (Make.com 우회/0원 직통)
    // ==========================================
    if (url.pathname.startsWith('/api/kakao')) {
        // 1. POST /api/kakao/skill : 카카오 i 오픈빌더 스킬 서버 직통 수신 (v2.0 응답)
        if (req.method === 'POST' && (url.pathname === '/api/kakao/skill' || url.pathname === '/api/kakao/webhook')) {
            try {
                const body = await parseBody(req);
                console.log(`[KakaoBot] 스킬 웹훅 수신: utterance="${body?.userRequest?.utterance || ''}", hasMedia=${!!(body?.userRequest?.params?.media || body?.action?.params?.secureimage)}`);
                const responsePayload = await kakaoBotService.handleSkillRequest(body);
                sendJsonResponse(req, res, 200, responsePayload);
            } catch (err) {
                console.error('[KakaoBot] 스킬 처리 실패:', err.message);
                // 카카오 타임아웃/오류 방지용 비상 fallback v2.0 응답
                sendJsonResponse(req, res, 200, {
                    version: '2.0',
                    template: {
                        outputs: [
                            {
                                simpleText: {
                                    text: '알트에프 견적 접수 시스템입니다.\n메시지가 접수되었으며 담당자가 확인 중입니다.'
                                }
                            }
                        ]
                    }
                });
            }
            return;
        }

        // 2. GET /api/kakao/status : 카카오 직통 봇 연결 상태 및 접수 통계
        if (req.method === 'GET' && url.pathname === '/api/kakao/status') {
            const status = kakaoBotService.getStatus();
            sendJsonResponse(req, res, 200, status);
            return;
        }

        // 3. GET /api/kakao/intakes : 수신된 카카오톡 견적 요청 목록
        if (req.method === 'GET' && url.pathname === '/api/kakao/intakes') {
            const urlParams = new URLSearchParams(url.search);
            const limit = parseInt(urlParams.get('limit') || '50', 10);
            const offset = parseInt(urlParams.get('offset') || '0', 10);
            const data = kakaoBotService.getIntakes({ limit, offset });
            sendJsonResponse(req, res, 200, { success: true, ...data });
            return;
        }

        // 4. POST /api/kakao/test : 카카오톡 전송 시뮬레이션 테스트
        if (req.method === 'POST' && url.pathname === '/api/kakao/test') {
            try {
                const body = await parseBody(req);
                const mockPayload = {
                    userRequest: {
                        utterance: body.utterance || '20A 90E(L) SCH40 50개 단가 부탁드립니다',
                        params: body.imageUrl ? { media: body.imageUrl } : {},
                        user: { id: body.userId || 'test_kakao_user_01' }
                    },
                    action: {
                        params: body.imageUrl ? { secureimage: body.imageUrl } : {}
                    }
                };
                const result = await kakaoBotService.handleSkillRequest(mockPayload);
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: '카카오톡 모의 견적 접수 시뮬레이션 성공!',
                    mockPayload,
                    kakaoResponse: result
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 5. GET /api/kakao/users : 카카오톡 ID 매핑 사용자 대장 조회
        if (req.method === 'GET' && url.pathname === '/api/kakao/users') {
            sendJsonResponse(req, res, 200, { success: true, users: kakaoBotService.users || [] });
            return;
        }

        // 6. POST /api/kakao/users : 신규 카카오톡 ID 매핑 등록/수정
        if (req.method === 'POST' && url.pathname === '/api/kakao/users') {
            try {
                const body = await parseBody(req);
                const saved = kakaoBotService.registerUser(body);
                sendJsonResponse(req, res, 200, { success: true, message: '카카오톡 고객 매칭 정보가 등록되었습니다.', user: saved });
            } catch (err) {
                sendJsonResponse(req, res, 400, { success: false, error: err.message });
            }
            return;
        }

        // 7. POST /api/kakao/dispatch-quote : Make.com 웹훅 또는 Solapi로 정식 견적서 발송
        if (req.method === 'POST' && url.pathname === '/api/kakao/dispatch-quote') {
            try {
                const body = await parseBody(req);
                const result = await kakaoBotService.dispatchQuotation(body);
                
                // db.quotations 상태도 'PROCESSED'로 즉시 동기화
                if (result.success && body.quotationId) {
                    const qIdx = (db.quotations || []).findIndex(q => q.id === body.quotationId);
                    if (qIdx >= 0) {
                        db.quotations[qIdx].status = 'PROCESSED';
                        db.quotations[qIdx].dispatchStatus = 'SENT';
                        db.quotations[qIdx].dispatchedAt = new Date().toISOString();
                        queueSave();
                    }
                }
                
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 8. GET /api/kakao/sla-benchmark : 과거 견적서 기반 회신 소요 시간(SLA) 벤치마크 및 이상치 분석
        if (req.method === 'GET' && url.pathname === '/api/kakao/sla-benchmark') {
            try {
                const benchmark = sleQuoteReviewService.calculateSlaBenchmark(db.quotations || []);
                sendJsonResponse(req, res, 200, { success: true, benchmark });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 9. POST /api/kakao/event-push : 0원 카카오 i 오픈빌더 챗봇 이벤트 푸시 발송
        if (req.method === 'POST' && url.pathname === '/api/kakao/event-push') {
            try {
                const body = await parseBody(req);
                const result = await sleQuoteReviewService.dispatchKakaoEventPush(body);
                
                // db.quotations 및 draftQuotations 상태도 'PROCESSED'(답변완료)로 즉시 전환
                if (body.quotationId) {
                    const qIdx = (db.quotations || []).findIndex(q => q.id === body.quotationId);
                    if (qIdx >= 0) {
                        db.quotations[qIdx].status = 'PROCESSED';
                        db.quotations[qIdx].dispatchStatus = 'SENT';
                        db.quotations[qIdx].dispatchedAt = new Date().toISOString();
                        queueSave();
                    }
                    const dq = kakaoBotService.draftQuotations.find(q => q.id === body.quotationId);
                    if (dq) {
                        dq.status = 'PROCESSED';
                        dq.dispatchStatus = 'SENT';
                        dq.dispatchedAt = new Date().toISOString();
                        kakaoBotService.saveData();
                    }
                }
                
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 10. DELETE /api/kakao/clear-test-data : 카카오 봇 인메모리 테스트 큐 초기화 (실제 db.quotations 보존)
        if ((req.method === 'DELETE' || req.method === 'POST') && url.pathname === '/api/kakao/clear-test-data') {
            try {
                // 1) kakaoBotService 인스턴스 초기화 (봇 내부 테스트 큐만 초기화)
                const result = kakaoBotService.clearTestData();

                // 2) 실제 db.quotations는 사람이 직접 삭제하기 전까지 보존 (임의 삭제 방지)
                sendJsonResponse(req, res, 200, { success: true, message: '카카오 봇 테스트 큐가 초기화되었습니다. (실제 견적서는 안전하게 보존됩니다)' });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }
    }

    // ==========================================
    // ⚡ 데이터관리팀 DAT-03~06 : 4단계 전사 재고 자동 동기화 & S3/변동량 관제 파이프라인
    // ==========================================
    if (url.pathname.startsWith('/api/dat/inventory-sync')) {
        // 1. GET /api/dat/inventory-sync/status
        if (req.method === 'GET' && url.pathname === '/api/dat/inventory-sync/status') {
            const data = inventorySyncService.getStatus();
            sendJsonResponse(req, res, 200, { success: true, ...data });
            return;
        }

        // 2. POST /api/dat/inventory-sync/config
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/config') {
            try {
                const body = await parseBody(req);
                const result = inventorySyncService.saveConfig(body);
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 3. POST /api/dat/inventory-sync/step1 : 사원1 태일/시화 실행
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/step1') {
            try {
                const result = await inventorySyncService.runStep1TaeilSihwa();
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 4. POST /api/dat/inventory-sync/step2 : 사원2 대경재고 파일 수신/변환
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/step2') {
            try {
                const body = await parseBody(req);
                const result = await inventorySyncService.runStep2Daekyung(body);
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 4-1. POST /api/dat/inventory-sync/dual-step1-2 : 사원(DAT-03 태일/시화, DAT-04 대경) 동시 병렬 실행
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/dual-step1-2') {
            try {
                const body = await parseBody(req);
                const result = await inventorySyncService.runSimultaneousDualSync(body);
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 5. POST /api/dat/inventory-sync/step3 : 대리 3~5분 버퍼링 & ALTF DB 실행
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/step3') {
            try {
                const body = await parseBody(req);
                const skipBuffer = body?.skipBuffer === true;
                const result = await inventorySyncService.startStep3BufferAndAltfDb(skipBuffer);
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 6. POST /api/dat/inventory-sync/cancel-step3 : 대리 버퍼링 취소
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/cancel-step3') {
            const result = inventorySyncService.cancelStep3Buffer();
            sendJsonResponse(req, res, 200, result);
            return;
        }

        // 7. POST /api/dat/inventory-sync/step4 : 과장 S3 배포 & 중복파일 정리 & 변동량 분석 (DAT-05 SUCCESS 및 결과물 실물 검수)
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/step4') {
            try {
                const body = await parseBody(req);
                const result = await inventorySyncService.runStep4DeployAndAnalyzeDiff(body || {});
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 8. POST /api/dat/inventory-sync/run-all : 4단계 전자동 오토파일럿
        if (req.method === 'POST' && url.pathname === '/api/dat/inventory-sync/run-all') {
            try {
                const body = await parseBody(req);
                const result = await inventorySyncService.runAutoPilot(body || {});
                sendJsonResponse(req, res, 200, result);
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }
    }

    // ==========================================
    // 🔬 품질부 QC-06 : 성적서 발행봇 & DAT-10 아카이빙 REST API
    // ==========================================
    if (url.pathname.startsWith('/api/qc/qc06/')) {
        // 1. GET /api/qc/qc06/orders : 성적서 발행 대상 발주서 목록 조회
        if (req.method === 'GET' && url.pathname === '/api/qc/qc06/orders') {
            try {
                const orders = (db.orders || []).map(o => ({
                    poNumber: o.poNumber || o.id,
                    customerName: o.targetCustomerName || o.customerName || '고객사',
                    itemCount: (o.items || []).length,
                    createdAt: o.createdAt || '',
                    items: (o.items || []).map(it => ({
                        description: it.productId || it.name || '',
                        qty: it.quantity || 1,
                        specMaterial: it.material || 'STS304',
                        heatNo: it.heatNo || ''
                    }))
                }));
                sendJsonResponse(req, res, 200, { success: true, count: orders.length, orders });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 2. GET /api/qc/qc06/issued-list : 발행된 성적서 대장 목록 (DAT-10 보관 인덱스)
        if (req.method === 'GET' && url.pathname === '/api/qc/qc06/issued-list') {
            try {
                const urlParams = new URLSearchParams(url.search);
                const poFilter = (urlParams.get('poNo') || '').trim();
                let list = certificateIssuerService.getIssuedList();
                if (poFilter) {
                    list = list.filter(r => r.poNo?.toUpperCase() === poFilter.toUpperCase());
                }
                sendJsonResponse(req, res, 200, { success: true, count: list.length, items: list });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 3. POST /api/qc/qc06/issue : 발주서 기반 성적서 자동 분할 발행 (6개 아이템 단위 / 엑셀+PDF+DAT-10 아카이빙)
        if (req.method === 'POST' && url.pathname === '/api/qc/qc06/issue') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { poNo, customer, certNo } = data;
                    if (!poNo) {
                        return sendJsonResponse(req, res, 400, { success: false, error: '발주번호(poNo)가 필요합니다.' });
                    }
                    const result = await certificateIssuerService.issueCertificatesForPo(poNo, { customer, certNo });
                    sendJsonResponse(req, res, 200, {
                        success: true,
                        message: `발주번호 ${poNo} 성적서 ${result.count}건 발행 완료 (PDF/엑셀 DAT-10 아카이빙 완료)`,
                        ...result
                    });
                } catch (err) {
                    sendJsonResponse(req, res, 500, { success: false, error: err.message });
                }
            });
            return;
        }

        // 4. POST /api/qc/qc06/test-sample : 첨부 사진 샘플(ES260709-1974) 즉시 발행 테스트
        if (req.method === 'POST' && url.pathname === '/api/qc/qc06/test-sample') {
            try {
                const result = await certificateIssuerService.issueCertificatesForPo('ES260709-1974', {
                    customer: '월드원플랜에탈',
                    certNo: 'YR-26-07015'
                });
                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: '첨부 사진 샘플(ES260709-1974) 성적서 발행 성공!',
                    ...result
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 4-1. POST /api/qc/qc06/test-outbound-sample : 3번째 사진 실데이터(A202610150 - (주)태양밴드, JCQ4366, STS316L) 즉시 발행 테스트
        if (req.method === 'POST' && url.pathname === '/api/qc/qc06/test-outbound-sample') {
            try {
                const sampleOutbound = {
                    outboundNo: 'A202610150',
                    customer: '(주)태양밴드',
                    customerContact: '동신유니온',
                    customerPhone: '032-561-3800~2',
                    requestDate: '2026-10-19',
                    destination: '시흥유통상가 26동 125호 동신유니온',
                    location: '시흥 ALT F',
                    marking: '기본마킹',
                    remark: '-52%\n기존 출고 316L T(R) 32x15 반품후 납품.',
                    items: [
                        {
                            lineNo: '1 - 1',
                            altfLotNo: 'DKB260313108',
                            lotNo: 'JCQ4366',
                            vendorLot: 'JCQ4366',
                            itemType: 'R(C)',
                            productType: 'R(C)',
                            standardType: 'KS',
                            method: 'ERW',
                            material: 'STS316L',
                            size: '32A x 15A',
                            schedule: 'S/10S',
                            length: '0L',
                            qty: 2,
                            deliveryDate: '2026-10-19',
                            location: '시흥 ALT F'
                        }
                    ]
                };

                const result = await certificateIssuerService.issueCertificatesForOutbound(sampleOutbound, {
                    certNo: 'YR-26-07015'
                });

                sendJsonResponse(req, res, 200, {
                    success: true,
                    message: '3번째 사진(A202610150 - (주)태양밴드) 재고출고분 성적서 발행 성공! (업체LOT JCQ4366 ➔ SD34285 매칭)',
                    ...result
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 4-2. POST /api/qc/qc06/issue-outbound : 출고지시서(재고 출고분) 기반 성적서 자동 분할 발행
        if (req.method === 'POST' && url.pathname === '/api/qc/qc06/issue-outbound') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const outboundOrder = data.outboundOrder || data;
                    if (!outboundOrder || (!outboundOrder.outboundNo && !outboundOrder.poNo && !outboundOrder.id)) {
                        return sendJsonResponse(req, res, 400, { success: false, error: '출고지시서 번호(outboundNo)가 필요합니다.' });
                    }
                    const result = await certificateIssuerService.issueCertificatesForOutbound(outboundOrder, {
                        certNo: data.certNo
                    });
                    sendJsonResponse(req, res, 200, {
                        success: true,
                        message: `출고지시서 ${outboundOrder.outboundNo || outboundOrder.id} 재고출고 성적서 ${result.count}건 발행 완료`,
                        ...result
                    });
                } catch (err) {
                    sendJsonResponse(req, res, 500, { success: false, error: err.message });
                }
            });
            return;
        }

        // 5. GET /api/qc/qc06/download-pdf/:fileName : 성적서 PDF 서빙/인라인 미리보기
        if (req.method === 'GET' && url.pathname.startsWith('/api/qc/qc06/download-pdf')) {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const urlParams = new URLSearchParams(url.search);
                const poNo = (urlParams.get('poNo') || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
                let fileName = path.basename(decodeURIComponent(url.pathname.replace('/api/qc/qc06/download-pdf/', '').replace('/api/qc/qc06/download-pdf', '')));
                if (!fileName) fileName = (urlParams.get('file') || '').trim();

                const filePath = path.resolve(`./storage/issued_certificates/${poNo}/${fileName}`);
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'PDF 파일을 찾을 수 없습니다.', filePath }));
                    return;
                }

                const stat = fs.statSync(filePath);
                const encodedFilename = encodeURIComponent(fileName);
                res.writeHead(200, {
                    'Content-Type': 'application/pdf',
                    'Content-Length': stat.size,
                    'Content-Disposition': `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
                });
                fs.createReadStream(filePath).pipe(res);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // 6. GET /api/qc/qc06/download-excel/:fileName : 성적서 엑셀 다운로드
        if (req.method === 'GET' && url.pathname.startsWith('/api/qc/qc06/download-excel')) {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const urlParams = new URLSearchParams(url.search);
                const poNo = (urlParams.get('poNo') || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
                let fileName = path.basename(decodeURIComponent(url.pathname.replace('/api/qc/qc06/download-excel/', '').replace('/api/qc/qc06/download-excel', '')));
                if (!fileName) fileName = (urlParams.get('file') || '').trim();

                const filePath = path.resolve(`./storage/issued_certificates/${poNo}/${fileName}`);
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '엑셀 파일을 찾을 수 없습니다.', filePath }));
                    return;
                }

                const stat = fs.statSync(filePath);
                const encodedFilename = encodeURIComponent(fileName);
                res.writeHead(200, {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Length': stat.size,
                    'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
                });
                fs.createReadStream(filePath).pipe(res);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // 7. POST /api/qc/qc06/open-folder : DAT-10 성적서 보관소 폴더 열기
        if (req.method === 'POST' && url.pathname === '/api/qc/qc06/open-folder') {
            try {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    const data = JSON.parse(body || '{}');
                    const path = await import('path');
                    const poNo = (data.poNo || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
                    const targetDir = poNo 
                        ? path.resolve(`./storage/issued_certificates/${poNo}`)
                        : path.resolve('./storage/issued_certificates');

                    const isWin = process.platform === 'win32';
                    const isMac = process.platform === 'darwin';
                    const cmd = isWin ? `explorer "${targetDir}"` : isMac ? `open "${targetDir}"` : `xdg-open "${targetDir}"`;

                    exec(cmd, (err) => {
                        if (err) console.error('[DAT-10] 성적서 폴더 열기 오류:', err.message);
                    });

                    sendJsonResponse(req, res, 200, {
                        success: true,
                        message: `DAT-10 보관소 폴더 열기: ${targetDir}`,
                        folderPath: targetDir
                    });
                });
            } catch (err) {
                sendJsonResponse(req, res, 500, { success: false, error: err.message });
            }
            return;
        }

        // 8. POST /api/qc/qc06/open-excel : 사용자 PC에서 MS Excel 프로그램으로 즉시 열기 & 수정
        if (req.method === 'POST' && url.pathname === '/api/qc/qc06/open-excel') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const pathModule = await import('path');
                    const data = JSON.parse(body || '{}');
                    const { poNo, excelPath, fileName } = data;
                    let targetPath = excelPath;
                    if (!targetPath && poNo && fileName) {
                        const cleanPo = poNo.replace(/[^a-zA-Z0-9_\-]/g, '_');
                        targetPath = `./storage/issued_certificates/${cleanPo}/${fileName}`;
                    }
                    if (!targetPath) {
                        return sendJsonResponse(req, res, 400, { success: false, error: '엑셀 파일 정보가 필요합니다.' });
                    }
                    const resolvedPath = pathModule.resolve(targetPath);
                    const result = certificateIssuerService.openExcelFile(resolvedPath);
                    sendJsonResponse(req, res, 200, { success: true, ...result, path: resolvedPath });
                } catch (err) {
                    sendJsonResponse(req, res, 500, { success: false, error: err.message });
                }
            });
            return;
        }
    }

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
            const rawUrl = url.searchParams.get('url');
            if (!rawUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Missing url parameter' }));
            }

            // 1. Google Drive, Docs 또는 외부 CDN 링크는 S3 파싱 없이 원본 주소로 즉시 안전 리다이렉트
            if (
                rawUrl.includes('drive.google.com') ||
                rawUrl.includes('docs.google.com') ||
                rawUrl.includes('googleusercontent.com') ||
                (!rawUrl.includes('amazonaws.com') && !rawUrl.startsWith('/'))
            ) {
                res.writeHead(302, { Location: rawUrl });
                return res.end();
            }

            // 2. S3 Object Key 파싱 (e.g. https://bucket.s3.region.amazonaws.com/documents/quotes/...)
            const parsed = new URL(rawUrl, 'https://altf.kr');
            const key = decodeURIComponent(parsed.pathname.slice(1)); // remove leading slash & decode Unicode

            // Security check: Block dangerous path traversal and direct database / backup access
            const normalizedKey = key.replace(/\\/g, '/').toLowerCase();
            if (
                normalizedKey.startsWith('database/') ||
                normalizedKey.includes('db.json') ||
                normalizedKey.includes('..') ||
                normalizedKey.endsWith('.bak') ||
                normalizedKey.endsWith('.env')
            ) {
                console.warn(`[Security Alert] Blocked unauthorized download attempt for key: ${key}`);
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                return res.end(JSON.stringify({ error: '접근이 제한된 파일입니다.' }));
            }

            // Generate temporary exact presigned URL with correct MIME content-type (png, jpg, pdf, etc.)
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

    // 📄 GET /api/quote/pdf 또는 /q/:id : 초단축 공식 견적서 PDF 파일 직통 스트리밍 (스마트폰 즉시 열람 및 저장/전달)
    const isShortQuoteUrl = url.pathname.startsWith('/q/') || url.pathname === '/q';
    if (req.method === 'GET' && (url.pathname === '/api/quote/pdf' || isShortQuoteUrl)) {
        let quoteId = url.searchParams.get('id');
        if (!quoteId && url.pathname.startsWith('/q/')) {
            quoteId = decodeURIComponent(url.pathname.substring(3).trim());
        }

        let quote = (db.quotations || []).find(q => q.id === quoteId);
        if (!quote) {
            quote = kakaoBotService.draftQuotations.find(q => q.id === quoteId);
        }

        if (!quote) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`견적번호(${quoteId || '미지정'})를 찾을 수 없습니다. 고객센터(051-303-3751)로 문의해 주세요.`);
            return;
        }

        try {
            console.log(`[PDF Server] 📄 견적서 ${quoteId} 공식 PDF 실시간 스트리밍 요청 수신`);
            const fs = await import('fs');
            const path = await import('path');
            const storageDir = path.resolve('./storage/quotations');
            if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

            const cachedPdfPath = path.join(storageDir, `${quoteId.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
            let pdfBuffer = null;

            if (fs.existsSync(cachedPdfPath)) {
                pdfBuffer = fs.readFileSync(cachedPdfPath);
            } else {
                const artifacts = await kakaoBotService.generateOfficialQuotationArtifacts(quote);
                if (artifacts?.pdfBuffer) {
                    pdfBuffer = artifacts.pdfBuffer;
                    fs.writeFileSync(cachedPdfPath, pdfBuffer);
                }
            }

            if (!pdfBuffer) {
                throw new Error('PDF 생성에 실패하였습니다.');
            }

            const downloadFilename = `알트에프_공식견적서_${quoteId}.pdf`;
            const encodedFilename = encodeURIComponent(downloadFilename);
            const isViewOnly = url.searchParams.get('view') === '1';
            const dispositionType = isViewOnly ? 'inline' : 'attachment';

            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `${dispositionType}; filename*=UTF-8''${encodedFilename}`,
                'Content-Length': pdfBuffer.length,
                'Cache-Control': 'public, max-age=604800' // 7일 캐싱
            });
            res.end(pdfBuffer);
            return;
        } catch (pdfErr) {
            console.error('[PDF Server] PDF 스트리밍 실패:', pdfErr);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`PDF 생성 중 오류가 발생했습니다: ${pdfErr.message}`);
            return;
        }
    }

    // 📄 GET /quote/view : 비로그인 고객 모바일 직통 정식 견적서 웹 뷰어 & 인쇄
    if (req.method === 'GET' && url.pathname === '/quote/view') {
        const quoteId = url.searchParams.get('id');
        let quote = (db.quotations || []).find(q => q.id === quoteId);
        if (!quote) {
            quote = kakaoBotService.draftQuotations.find(q => q.id === quoteId);
        }

        if (!quote) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html><head><meta charset="utf-8"><title>견적서를 찾을 수 없습니다</title></head>
                <body style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h2>⚠️ 요청하신 견적서를 찾을 수 없습니다.</h2>
                    <p>견적번호(${quoteId || '미지정'})가 정확한지 확인해 주시거나 고객센터(051-303-3751)로 문의해 주세요.</p>
                </body></html>
            `);
            return;
        }

        const custName = quote.customerName || quote.customerInfo?.companyName || '고객사';
        const contactName = quote.customerInfo?.contactName || '담당자 귀하';
        const totalAmount = quote.totalAmount || 0;
        const vat = Math.round(totalAmount * 0.1);
        const grandTotal = totalAmount + vat;
        const items = quote.items || [];
        const dateStr = quote.createdAt ? new Date(quote.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('ko-KR');

        const rowsHtml = items.map((it, idx) => {
            const spec = it.spec || `${it.name || '배관자재'} ${it.thickness || ''} ${it.size || ''} ${it.material || ''}`.trim();
            const qty = it.quantity || it.qty || 1;
            const unitPrice = it.userUnitPrice || it.unitPrice || 0;
            const amount = it.amount || (unitPrice * qty);
            return `
                <tr>
                    <td style="text-align:center; padding:8px; border:1px solid #cbd5e1;">${idx + 1}</td>
                    <td style="padding:8px; border:1px solid #cbd5e1; font-weight:bold;">${spec}</td>
                    <td style="text-align:center; padding:8px; border:1px solid #cbd5e1;">${it.material || 'STS'}</td>
                    <td style="text-align:right; padding:8px; border:1px solid #cbd5e1; font-weight:bold;">${qty.toLocaleString()}</td>
                    <td style="text-align:center; padding:8px; border:1px solid #cbd5e1;">EA</td>
                    <td style="text-align:right; padding:8px; border:1px solid #cbd5e1;">₩${unitPrice.toLocaleString()}</td>
                    <td style="text-align:right; padding:8px; border:1px solid #cbd5e1; font-weight:bold; color:#0f172a;">₩${amount.toLocaleString()}</td>
                    <td style="text-align:center; padding:8px; border:1px solid #cbd5e1; font-size:11px; color:#059669;">당일출고</td>
                </tr>
            `;
        }).join('');

        const attachImgUrl = quote.attachments?.[0]?.url || quote.attachments?.[0]?.data || null;

        const html = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>견적서 - ${quote.id} (${custName})</title>
            <style>
                @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
                * { box-sizing: border-box; }
                body { 
                    margin: 0; 
                    padding: 0; 
                    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
                    background-color: #f1f5f9;
                    color: #1e293b;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .floating-bar {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    background: rgba(15, 23, 42, 0.95);
                    backdrop-filter: blur(8px);
                    color: white;
                    padding: 12px 20px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    z-index: 1000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                }
                .btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 9px 16px;
                    border-radius: 8px;
                    font-weight: bold;
                    font-size: 13px;
                    text-decoration: none;
                    cursor: pointer;
                    border: none;
                    transition: all 0.2s;
                }
                .btn-primary { background: #2563eb; color: white; }
                .btn-primary:hover { background: #1d4ed8; }
                .btn-call { background: #10b981; color: white; }
                .btn-call:hover { background: #059669; }
                .page {
                    width: 100%;
                    max-width: 820px;
                    margin: 70px auto 40px;
                    background: white;
                    padding: 40px;
                    border-radius: 8px;
                    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
                }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th { background: #f8fafc; font-weight: bold; }
                .seal-stamp {
                    position: absolute;
                    right: 15px;
                    bottom: 5px;
                    width: 65px;
                    height: 65px;
                    pointer-events: none;
                }
                @media print {
                    .floating-bar { display: none !important; }
                    body { background: white; }
                    .page { margin: 0; padding: 15mm; max-width: none; box-shadow: none; border-radius: 0; }
                }
                @media screen and (max-width: 640px) {
                    .page { padding: 20px 14px; margin-top: 60px; }
                    .floating-bar { padding: 10px 14px; }
                    .btn { padding: 7px 12px; font-size: 12px; }
                    table { font-size: 11px; }
                }
            </style>
        </head>
        <body>
            <div class="floating-bar">
                <div style="font-weight:bold; font-size:14px; display:flex; align-items:center; gap:8px;">
                    <span style="background:#2563eb; padding:2px 8px; border-radius:4px; font-size:11px;">AltF</span>
                    <span>정식 직인 견적서</span>
                </div>
                <div style="display:flex; gap:8px;">
                    <a href="tel:051-303-3751" class="btn btn-call">📞 051-303-3751 문의</a>
                    <button onclick="window.print()" class="btn btn-primary">📥 PDF 저장 / 인쇄</button>
                </div>
            </div>

            <div class="page">
                <div style="text-align:center; margin-bottom: 25px; border-bottom: 3px double #0f172a; padding-bottom: 12px;">
                    <h1 style="margin:0; font-size:26px; letter-spacing:8px; color:#0f172a;">견 적 서</h1>
                    <span style="font-size:12px; letter-spacing:3px; color:#64748b;">QUOTATION</span>
                </div>

                <div style="display:flex; justify-content:space-between; margin-bottom: 20px; flex-wrap:wrap; gap:16px;">
                    <!-- 수신처 (고객사) -->
                    <div style="flex:1; min-width:280px; border:1px solid #cbd5e1; border-radius:6px; padding:14px; background:#fafafa;">
                        <div style="font-size:11px; color:#64748b; margin-bottom:4px;">견적번호: <strong>${quote.id}</strong></div>
                        <div style="font-size:11px; color:#64748b; margin-bottom:10px;">견적일자: ${dateStr}</div>
                        <div style="font-size:18px; font-weight:800; color:#0f172a; margin-bottom:6px;">
                            ${custName} <span style="font-size:14px; font-weight:normal; color:#64748b;">귀하</span>
                        </div>
                        <div style="font-size:12px; color:#475569; line-height:1.6;">
                            • 담당자: ${contactName}<br>
                            • 공급조건: 화물 / 택배 / 상차도<br>
                            • 유효기간: 견적일로부터 7일간
                        </div>
                    </div>

                    <!-- 공급자 (알트에프) -->
                    <div style="flex:1; min-width:280px; border:1px solid #cbd5e1; border-radius:6px; padding:14px; position:relative; background:#fff;">
                        <table style="width:100%; border:none; font-size:12px; line-height:1.5;">
                            <tr><td style="width:70px; color:#64748b; padding:2px 0;">등록번호</td><td style="font-weight:bold; color:#0f172a;">890-38-01079</td></tr>
                            <tr><td style="color:#64748b; padding:2px 0;">상　　호</td><td style="font-weight:bold; color:#0f172a;">알트에프(주)</td></tr>
                            <tr><td style="color:#64748b; padding:2px 0;">대 표 자</td><td style="font-weight:bold; color:#0f172a;">조 현 진</td></tr>
                            <tr><td style="color:#64748b; padding:2px 0;">사업장소재지</td><td style="font-size:11px;">부산시 사상구 삼락동 / 시흥시 시화유통상가</td></tr>
                            <tr><td style="color:#64748b; padding:2px 0;">전화 / 팩스</td><td style="font-weight:bold; color:#2563eb;">051-303-3751 <span style="color:#64748b; font-weight:normal;">/ 051-303-3752</span></td></tr>
                            <tr><td style="color:#64748b; padding:2px 0;">업태 / 종목</td><td style="font-size:11px;">도소매, 전자상거래 / 배관자재, 피팅, 플랜지</td></tr>
                        </table>
                        <!-- 알트에프 빨간 원형 직인 날인 -->
                        <div class="seal-stamp">
                            <svg viewBox="0 0 100 100" width="65" height="65" style="opacity:0.85;">
                                <circle cx="50" cy="50" r="46" stroke="#dc2626" stroke-width="4" fill="none" />
                                <circle cx="50" cy="50" r="42" stroke="#dc2626" stroke-width="1.5" fill="none" />
                                <text x="50" y="42" font-size="16" font-family="'Pretendard', sans-serif" font-weight="900" fill="#dc2626" text-anchor="middle">알트에프</text>
                                <text x="50" y="66" font-size="16" font-family="'Pretendard', sans-serif" font-weight="900" fill="#dc2626" text-anchor="middle">주식회사</text>
                                <text x="50" y="84" font-size="11" font-family="'Pretendard', sans-serif" font-weight="bold" fill="#dc2626" text-anchor="middle">인</text>
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- 합계 금액 바 -->
                <div style="background:#0f172a; color:white; padding:12px 18px; border-radius:6px; display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <div style="font-size:13px; font-weight:500;">견적 총 합계금액 (VAT 포함)</div>
                    <div style="font-size:20px; font-weight:900; color:#38bdf8;">₩${grandTotal.toLocaleString()}원</div>
                </div>

                <!-- 품목 상세 테이블 -->
                <div style="overflow-x:auto; margin-bottom:20px;">
                    <table style="border:1px solid #cbd5e1;">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:2px solid #94a3b8;">
                                <th style="padding:10px 6px; border:1px solid #cbd5e1; width:35px; text-align:center;">No</th>
                                <th style="padding:10px 8px; border:1px solid #cbd5e1; text-align:left;">품목 및 규격 (Item & Spec)</th>
                                <th style="padding:10px 6px; border:1px solid #cbd5e1; width:55px; text-align:center;">재질</th>
                                <th style="padding:10px 6px; border:1px solid #cbd5e1; width:50px; text-align:right;">수량</th>
                                <th style="padding:10px 6px; border:1px solid #cbd5e1; width:40px; text-align:center;">단위</th>
                                <th style="padding:10px 8px; border:1px solid #cbd5e1; width:85px; text-align:right;">단가</th>
                                <th style="padding:10px 8px; border:1px solid #cbd5e1; width:95px; text-align:right;">금액(공급가)</th>
                                <th style="padding:10px 6px; border:1px solid #cbd5e1; width:65px; text-align:center;">출고상태</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                        <tfoot>
                            <tr style="background:#f8fafc; font-weight:bold;">
                                <td colspan="3" style="text-align:center; padding:10px; border:1px solid #cbd5e1;">합 계 (TOTAL)</td>
                                <td style="text-align:right; padding:10px; border:1px solid #cbd5e1;">${items.reduce((s, it) => s + (it.quantity || it.qty || 1), 0).toLocaleString()}</td>
                                <td style="text-align:center; padding:10px; border:1px solid #cbd5e1;">EA</td>
                                <td style="text-align:right; padding:10px; border:1px solid #cbd5e1; font-size:11px; color:#64748b;">공급가 합계</td>
                                <td style="text-align:right; padding:10px; border:1px solid #cbd5e1; font-size:14px; color:#0f172a;">₩${totalAmount.toLocaleString()}</td>
                                <td style="text-align:center; padding:10px; border:1px solid #cbd5e1; font-size:11px; color:#059669;">VAT 별도</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <!-- 특기사항 및 납기 안내 -->
                <div style="border:1px solid #e2e8f0; border-radius:6px; padding:14px; font-size:12px; color:#475569; line-height:1.7; background:#fafafa; margin-bottom:20px;">
                    <strong>[납기 및 특기사항]</strong><br>
                    • <strong>예상 납기:</strong> 전 품목 재고 보유 (오후 3시 이전 발주 시 당일/익일 즉시 출고)<br>
                    • <strong>입금 계좌:</strong> 기업은행 051-303-3751 (예금주: 알트에프 주식회사)<br>
                    • <strong>기타 사항:</strong> 정식 밀시트(MTC 성적서)는 제품 출고 시 전자문서로 함께 자동 발급됩니다.<br>
                    • <strong>견적 및 출고 문의:</strong> 알트에프 영업부 <strong>051-303-3751</strong> (월~금 08:30 ~ 18:00)
                </div>

                ${attachImgUrl ? `
                <div style="margin-top:25px; border-top:1px dashed #cbd5e1; padding-top:15px;">
                    <div style="font-size:12px; font-weight:bold; color:#475569; margin-bottom:8px;">📎 고객 의뢰 원본 첨부사진</div>
                    <img src="${attachImgUrl}" style="max-width:100%; height:auto; border-radius:6px; border:1px solid #e2e8f0;" alt="의뢰서 사진" />
                </div>
                ` : ''}
            </div>
        </body>
        </html>
        `;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
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
                inventoryCache.parsedData = null;
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
                        return { _bypassSave: true };
                    });
                } catch (snapErr) {
                    console.error('[API] Error updating live inventory snapshots:', snapErr);
                }

                inventoryCache.parsedData = inventoryData;
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
                
                const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
                const rateLimitKey = `${clientIp}_${email || ''}`;
                if (!checkLoginRateLimit(rateLimitKey)) {
                    console.warn(`[Security Alert] Rate limit triggered for login attempt: ${email} from ${clientIp}`);
                    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '로그인 시도가 너무 많습니다. 30초 후 다시 시도해주세요.' }));
                    return;
                }

                console.log(`[API] Login attempt: Email=${email}`);

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
                    recordLoginFailure(rateLimitKey);
                    console.log(`[API] Login failed: ${loginResult.error} for ${email}`);
                    res.writeHead(loginResult.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: loginResult.error }));
                    return;
                }

                clearLoginFailure(rateLimitKey);
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
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
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
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

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
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

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
        const session = getAuthenticatedSession(req);
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin' && session.role !== 'manager' && session.role !== 'MANAGER')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

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

        // Fetch full inventory details to strictly filter by location and maker (reuse in-memory cache for speed)
        let inventoryItems = [];
        try {
            if (inventoryCache.parsedData) {
                const cached = inventoryCache.parsedData;
                inventoryItems = Array.isArray(cached) ? cached : (cached.items || []);
            } else {
                const inventoryData = await getInventoryFromS3();
                inventoryCache.parsedData = inventoryData;
                inventoryItems = Array.isArray(inventoryData) ? inventoryData : (inventoryData.items || []);
            }
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
        // Sanitize response: Never expose plaintext password to client
        const sanitizedUsers = (db.users || []).map(({ password, ...rest }) => rest);
        sendJsonResponse(req, res, 200, sanitizedUsers);
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
                        attachments: data.attachments || [],
                        source: data.source || 'WEB',
                        similarity: computeDocumentSimilaritySummary({
                            id: newId,
                            customerName: data.customerName || '',
                            customerInfo: data.customerInfo,
                            items: data.items,
                            createdAt: new Date().toISOString()
                        }, db.quotations)
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
        const headerRole = req.headers['x-requester-role'] || '';
        const isAdminRole = (session && (session.role === 'MASTER' || session.role === 'admin' || session.role === 'manager' || session.role === 'MANAGER')) ||
                            (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER');

        if (!isAdminRole) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        let dbQuotesChanged = false;
        for (const draft of (kakaoBotService.draftQuotations || [])) {
            // 카카오 초안이 소프트 삭제된 경우 복원하지 않음
            if (draft.isDeleted) continue;

            const idx = db.quotations.findIndex(q => q.id === draft.id);
            if (idx === -1) {
                db.quotations.unshift(draft);
                dbQuotesChanged = true;
            } else {
                // 이미 db.quotations에서 삭제된 경우 덮어쓰지 않음
                if (db.quotations[idx].isDeleted) {
                    continue;
                }
                if (draft.attachments && draft.attachments.length > 0 && (!db.quotations[idx].attachments || db.quotations[idx].attachments.length === 0)) {
                    db.quotations[idx].attachments = draft.attachments;
                    dbQuotesChanged = true;
                }
                if (draft.status && db.quotations[idx].status === 'DRAFT') {
                    db.quotations[idx].status = draft.status;
                    dbQuotesChanged = true;
                }
                if (draft.botUserKey && !db.quotations[idx].botUserKey) {
                    db.quotations[idx].botUserKey = draft.botUserKey;
                    db.quotations[idx].isKakaoRegistered = draft.isKakaoRegistered;
                    db.quotations[idx].kakaoUser = draft.kakaoUser;
                    dbQuotesChanged = true;
                }
            }
        }
        if (dbQuotesChanged) {
            try { saveData(); } catch (e) {}
        }

        const combinedQuotes = [...db.quotations];
        sendJsonResponse(req, res, 200, combinedQuotes);
        return;
    }

    // PATCH /api/my/quotations/:id (Update Quotation)
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/my/quotations/')) {
        let session = getAuthenticatedSession(req);
        const headerRole = req.headers['x-requester-role'] || '';
        const headerId = req.headers['x-requester-id'] || '';
        if (!session && (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER')) {
            session = { userId: headerId || 'admin-header', role: headerRole, email: 'admin@altf.kr' };
        }
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

                // 휴지통 이동(isDeleted: true) 또는 복구(isDeleted: false) 권한 검증: 관리자 권한 허용
                const isAdmin = ['MASTER', 'admin', 'manager', 'MANAGER'].includes(session.role);
                if (updates.hasOwnProperty('isDeleted') && !isAdmin) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Forbidden: Only administrators can manage trash status' }));
                    return;
                }

                const targetQuoteIndex = db.quotations.findIndex(q => q.id === id);
                if (targetQuoteIndex === -1) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Quotation not found' }));
                    return;
                }

                const targetQuote = db.quotations[targetQuoteIndex];
                const isOwner = targetQuote.userId === session.userId || targetQuote.customerNumber === session.userId;

                if (!isAdmin && !isOwner) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Forbidden' }));
                    return;
                }

                // kakaoBotService 동기화
                if (updates.hasOwnProperty('isDeleted') && typeof kakaoBotService.markQuotationDeleted === 'function') {
                    kakaoBotService.markQuotationDeleted(id, !!updates.isDeleted);
                }

                const updatedQuote = await updateDb(() => {
                    const finalQuote = { ...db.quotations[targetQuoteIndex], ...updates };
                    if (updates.items && Array.isArray(updates.items)) {
                        finalQuote.similarity = computeDocumentSimilaritySummary(finalQuote, db.quotations);
                    }
                    db.quotations[targetQuoteIndex] = finalQuote;
                    return db.quotations[targetQuoteIndex];
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

    // GET /api/my/orders (also alias /api/orders)
    if (req.method === 'GET' && (url.pathname === '/api/my/orders' || url.pathname === '/api/orders')) {
        const userId = url.searchParams.get('userId');
        let session = getAuthenticatedSession(req);
        const headerRole = req.headers['x-requester-role'] || '';
        const headerId = req.headers['x-requester-id'] || '';

        // Fallback: Support x-requester-role header when session token is expired or reset on restart
        if (!session && (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER')) {
            session = { userId: headerId || 'admin-header', role: headerRole, email: 'admin@altf.kr' };
        }

        if (userId) {
            // Must be the same user or an admin
            const isAuthorizedUser = session && (session.userId === userId || session.role === 'MASTER' || session.role === 'admin' || session.role === 'manager' || session.role === 'MANAGER');
            const isAuthorizedHeader = (headerId === userId) || (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER');

            if (!isAuthorizedUser && !isAuthorizedHeader) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }
            const userOrders = db.orders.filter(o => o.userId === userId || (o.customer && o.customer.email === userId));
            sendJsonResponse(req, res, 200, userOrders);
            return;
        }

        // Admin Mode: Return All
        const isAdminRole = (session && (session.role === 'MASTER' || session.role === 'admin' || session.role === 'manager' || session.role === 'MANAGER')) ||
                            (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER');

        if (!isAdminRole) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }
        sendJsonResponse(req, res, 200, db.orders);
        return;
    }

    // PATCH /api/my/orders/:id (Update Order, also alias /api/orders/:id)
    if (req.method === 'PATCH' && (url.pathname.startsWith('/api/my/orders/') || url.pathname.startsWith('/api/orders/'))) {
        let session = getAuthenticatedSession(req);
        const headerRole = req.headers['x-requester-role'] || '';
        const headerId = req.headers['x-requester-id'] || '';

        // Fallback: Support x-requester-role header
        if (!session && (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER')) {
            session = { userId: headerId || 'admin-header', role: headerRole, email: 'admin@altf.kr' };
        }

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

                    // 임의 영구 삭제 방지: splice 대신 RETRACTED 상태 및 isDeleted 보존
                    db.orders[orderIndex] = {
                        ...order,
                        status: 'RETRACTED',
                        isDeleted: true,
                        retractedAt: new Date().toISOString(),
                        retractedBy: session ? session.userId : 'system',
                        linkedQuoteId: newQuote.id
                    };

                    const quoteIndex = db.quotations.findIndex(q => q.id === newQuote.id);
                    if (quoteIndex !== -1) {
                        db.quotations[quoteIndex] = { ...db.quotations[quoteIndex], ...newQuote, isDeleted: false };
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
        let session = getAuthenticatedSession(req);
        const headerRole = req.headers['x-requester-role'] || '';
        const headerId = req.headers['x-requester-id'] || '';
        if (!session && (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER')) {
            session = { userId: headerId || 'admin-header', role: headerRole, email: 'admin@altf.kr' };
        }
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

                    // 사람이 실제로 삭제 버튼을 누른 경우에만 삭제 처리
                    // 영구 삭제 요청이 오더라도 원본 증적 유실 방지를 위해 splice 완전 파기 대신 소프트 삭제 + 감사 기록 보존
                    db.quotations[index] = {
                        ...db.quotations[index],
                        isDeleted: true,
                        isPermanentlyDeleted: permanent ? true : false,
                        deletedAt: new Date().toISOString(),
                        deletedBy: {
                            id: session.userId,
                            email: session.email,
                            role: session.role
                        },
                        deleteReason: permanent ? 'HUMAN_EXPLICIT_PERMANENT_DELETE' : 'HUMAN_EXPLICIT_DELETE'
                    };

                    if (typeof kakaoBotService.markQuotationDeleted === 'function') {
                        kakaoBotService.markQuotationDeleted(id, true);
                    }
                    return { success: true, mode: permanent ? 'hard_protected' : 'soft' };
                }
                return { error: 'Not found', status: 404 };
            });

            if (result.success) {
                console.log(`[API] [Human Action] Deleted quotation ${id} (Mode: ${result.mode}) by ${session.email}`);
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
        let session = getAuthenticatedSession(req);
        const headerRole = req.headers['x-requester-role'] || '';
        const headerId = req.headers['x-requester-id'] || '';
        if (!session && (headerRole === 'MASTER' || headerRole === 'admin' || headerRole === 'manager' || headerRole === 'MANAGER')) {
            session = { userId: headerId || 'admin-header', role: headerRole, email: 'admin@altf.kr' };
        }
        if (!session || (session.role !== 'MASTER' && session.role !== 'admin')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: MASTER or admin role required' }));
            return;
        }

        const id = url.pathname.split('/').pop();
        try {
            const success = await updateDb(() => {
                const index = db.orders.findIndex(o => o.id === id);
                if (index !== -1) {
                    // [사람의 명시적 삭제]: 임의 splice 파기 대신 소프트 삭제 + 감사 기록 보존
                    db.orders[index] = {
                        ...db.orders[index],
                        isDeleted: true,
                        deletedAt: new Date().toISOString(),
                        deletedBy: {
                            id: session.userId,
                            email: session.email,
                            role: session.role
                        },
                        deleteReason: 'HUMAN_EXPLICIT_DELETE'
                    };
                    return true;
                }
                return false;
            });

            if (success) {
                console.log(`[API] [Human Action] Soft-deleted order ${id} with audit trail by ${session.email}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, mode: 'soft' }));
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

    // GET /api/admin/ai-reports?period=weekly&limit=20
    if (req.method === 'GET' && url.pathname === '/api/admin/ai-reports') {
        const session = getAuthenticatedSession(req);
        if (!session || session.role !== 'MASTER') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: MASTER role required' }));
            return;
        }
        const period = url.searchParams.get('period');
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        let list = db.aiReports || [];
        if (period) list = list.filter(r => r.period === period);
        sendJsonResponse(req, res, 200, { reports: list.slice(0, limit) });
        return;
    }

    // POST /api/admin/ai-reports/generate — 운영/디버깅용 수동 트리거 (자동 생성이 기본이며 이건 백필용)
    if (req.method === 'POST' && url.pathname === '/api/admin/ai-reports/generate') {
        const session = getAuthenticatedSession(req);
        if (!session || session.role !== 'MASTER') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: MASTER role required' }));
            return;
        }
        let body = '';
        req.on('data', c => body += c.toString());
        req.on('end', async () => {
            try {
                const { period, asOfDate } = JSON.parse(body || '{}');
                if (!AI_REPORT_PERIODS.includes(period)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid period' }));
                    return;
                }
                const targetDate = asOfDate ? new Date(asOfDate) : new Date();
                const metrics = await aggregateAllTrends(db, period, targetDate);
                const aiResult = await generateAiReport(period, metrics);
                const report = await updateDb(() => {
                    db.aiReports = db.aiReports || [];
                    // 동일한 period + periodKey 리포트가 이미 있다면 최신 분석본으로 교체
                    db.aiReports = db.aiReports.filter(r => !(r.period === period && r.periodKey === metrics.periodKey));
                    const rpt = {
                        id: `rpt_${period}_${metrics.periodKey}_${crypto.randomUUID()}`,
                        period,
                        periodKey: metrics.periodKey,
                        rangeStart: metrics.rangeStart,
                        rangeEnd: metrics.rangeEnd,
                        generatedAt: new Date().toISOString(),
                        status: 'SUCCESS',
                        metrics,
                        ...aiResult,
                    };
                    db.aiReports.unshift(rpt);
                    if (db.aiReports.length > 200) db.aiReports.length = 200;
                    return rpt;
                });
                sendJsonResponse(req, res, 200, { report });
            } catch (e) {
                console.error('[AI Report] Manual generate failed:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server Error', detail: String(e?.message || e) }));
            }
        });
        return;
    }

    // DELETE /api/admin/ai-reports?id=... 또는 /api/admin/ai-reports?all=true (또는 period=...)
    if (req.method === 'DELETE' && (url.pathname === '/api/admin/ai-reports' || url.pathname.startsWith('/api/admin/ai-reports/'))) {
        const session = getAuthenticatedSession(req);
        if (!session || session.role !== 'MASTER') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: MASTER role required' }));
            return;
        }
        let reportId = url.searchParams.get('id');
        const isAll = url.searchParams.get('all') === 'true';
        const targetPeriod = url.searchParams.get('period');

        if (!reportId && url.pathname.startsWith('/api/admin/ai-reports/')) {
            reportId = decodeURIComponent(url.pathname.replace('/api/admin/ai-reports/', ''));
        }

        if (isAll) {
            await updateDb(() => {
                if (targetPeriod) {
                    db.aiReports = (db.aiReports || []).filter(r => r.period !== targetPeriod);
                } else {
                    db.aiReports = [];
                }
            });
            console.log(`[AI Report] Deleted ${targetPeriod ? targetPeriod : 'all'} reports from DB`);
            sendJsonResponse(req, res, 200, { success: true, message: 'Deleted reports successfully' });
            return;
        }

        if (!reportId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing report id' }));
            return;
        }
        await updateDb(() => {
            const beforeCount = (db.aiReports || []).length;
            db.aiReports = (db.aiReports || []).filter(r => r.id !== reportId);
            const afterCount = db.aiReports.length;
            console.log(`[AI Report] Deleted report ${reportId}: ${beforeCount} -> ${afterCount}`);
        });
        sendJsonResponse(req, res, 200, { success: true, deletedId: reportId });
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

function enrichCustomersWithGrade(customers, orders) {
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - 60);
    const cutoffTime = cutoffDate.getTime();

    // Pre-build lookup maps once — avoids O(N) scan inside per-order matching
    const { bizNoMap, exactNameMap, cleanNameMap, simplifiedNameMap } = buildCustomerMatchIndex(customers);

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
