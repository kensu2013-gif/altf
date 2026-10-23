/**
 * 🛡️ Daily Database Snapshot & Backup Service (일일 데이터베이스 백업 및 안전 복원 서비스)
 * 
 * [목적]
 * 1. 데이터 유실을 100% 방지하기 위해 매일 자정(KST) 및 주요 변경(휴지통 비우기 등) 전
 *    S3 원격 저장소(`database/backups/`) 및 로컬 디렉토리(`server/data/backups/`)에 일일 백업 지점을 자동 생성.
 * 2. 실수로 영구 삭제나 장애가 발생하더라도, 과거 원하는 날짜의 백업 지점에서 원클릭으로 견적서/발주서를 즉시 복원.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');
const LOCAL_BACKUP_DIR = path.join(ROOT_DIR, 'server/data/backups');

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'altf-web-data-prod';
const S3_BACKUP_PREFIX = 'database/backups/';

function hasAwsCredentials() {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-2'
});

async function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function getKoreaDateStr(d = new Date()) {
    const kstOffset = 9 * 60 * 60 * 1000;
    const kst = new Date(d.getTime() + kstOffset);
    return kst.toISOString().split('T')[0];
}

function getKoreaTimestampStr(d = new Date()) {
    const kstOffset = 9 * 60 * 60 * 1000;
    const kst = new Date(d.getTime() + kstOffset);
    const date = kst.toISOString().split('T')[0];
    const time = kst.toISOString().split('T')[1].slice(0, 8).replace(/:/g, '');
    return `${date}_${time}`;
}

export class DailyBackupService {
    constructor() {
        this.schedulerTimer = null;
        this.ensureLocalDir();
    }

    ensureLocalDir() {
        try {
            if (!fs.existsSync(LOCAL_BACKUP_DIR)) {
                fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
            }
        } catch (e) {
            console.error('[BackupService] 로컬 백업 디렉토리 생성 실패:', e.message);
        }
    }

    /**
     * 신규 데이터베이스 백업 지점 생성
     * @param {Object} db 현재 메모리 DB 객체
     * @param {string} reason 백업 사유 ('DAILY_SCHEDULED' | 'MANUAL_USER_REQUEST' | 'PRE_PURGE_SAFETY')
     * @param {string} customTag 임의 식별 태그 (선택)
     */
    async createSnapshot(db, reason = 'DAILY_SCHEDULED', customTag = '') {
        try {
            this.ensureLocalDir();
            const now = new Date();
            const dateStr = getKoreaDateStr(now);
            const tsStr = getKoreaTimestampStr(now);

            let backupId;
            if (reason === 'DAILY_SCHEDULED') {
                backupId = `db_backup_${dateStr}`;
            } else if (reason === 'PRE_PURGE_SAFETY') {
                backupId = `db_backup_pre_purge_${tsStr}`;
            } else {
                backupId = customTag ? `db_backup_${customTag}_${tsStr}` : `db_backup_manual_${tsStr}`;
            }

            const fileName = `${backupId}.json`;
            const localFilePath = path.join(LOCAL_BACKUP_DIR, fileName);
            const s3Key = `${S3_BACKUP_PREFIX}${fileName}`;

            // 견적서 및 발주서 삭제 현황 통계 산출
            const quotes = Array.isArray(db.quotations) ? db.quotations : [];
            const orders = Array.isArray(db.orders) ? db.orders : [];
            const activeQuotes = quotes.filter(q => !q.isDeleted && !q.isPermanentlyDeleted).length;
            const trashedQuotes = quotes.filter(q => q.isDeleted && !q.isPermanentlyDeleted).length;

            const payload = {
                metadata: {
                    backupId,
                    fileName,
                    date: dateStr,
                    timestamp: now.toISOString(),
                    reason,
                    stats: {
                        totalUsers: (db.users || []).length,
                        totalQuotes: quotes.length,
                        activeQuotes,
                        trashedQuotes,
                        totalOrders: orders.length,
                        totalAgents: (db.agents || []).length,
                        totalDeletedTombstones: (db.deletedQuotationIds || []).length
                    }
                },
                db
            };

            const jsonStr = JSON.stringify(payload, null, 2);

            // 1. 로컬 백업 저장
            fs.writeFileSync(localFilePath, jsonStr, 'utf8');
            console.log(`[BackupService] 💾 로컬 백업 지점 생성 완료: ${localFilePath} (${(Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(2)} MB)`);

            // 2. S3 원격 버킷 백업 업로드
            if (hasAwsCredentials()) {
                try {
                    const putCommand = new PutObjectCommand({
                        Bucket: BUCKET_NAME,
                        Key: s3Key,
                        Body: jsonStr,
                        ContentType: 'application/json',
                        Metadata: {
                            reason,
                            date: dateStr,
                            totalQuotes: String(quotes.length)
                        }
                    });
                    await s3Client.send(putCommand);
                    console.log(`[BackupService] ☁️ S3 원격 백업 지점 안전 보관 완료: s3://${BUCKET_NAME}/${s3Key}`);
                } catch (s3Err) {
                    console.warn(`[BackupService] S3 백업 업로드 주의 (로컬 백업은 안전 유지됨):`, s3Err.message);
                }
            }

            return {
                success: true,
                backupId,
                fileName,
                date: dateStr,
                reason,
                stats: payload.metadata.stats
            };
        } catch (err) {
            console.error('[BackupService] 백업 생성 실패:', err);
            throw err;
        }
    }

    /**
     * 사용 가능한 백업 지점 목록 조회
     */
    async listSnapshots() {
        this.ensureLocalDir();
        const map = new Map();

        // 1. 로컬 파일 목록 탐색
        try {
            if (fs.existsSync(LOCAL_BACKUP_DIR)) {
                const files = fs.readdirSync(LOCAL_BACKUP_DIR).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    try {
                        const filePath = path.join(LOCAL_BACKUP_DIR, file);
                        const stat = fs.statSync(filePath);
                        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        const meta = content.metadata || {};
                        map.set(file, {
                            backupId: meta.backupId || file.replace('.json', ''),
                            fileName: file,
                            date: meta.date || stat.mtime.toISOString().split('T')[0],
                            timestamp: meta.timestamp || stat.mtime.toISOString(),
                            reason: meta.reason || 'LEGACY_LOCAL',
                            sizeBytes: stat.size,
                            sizeMb: (stat.size / 1024 / 1024).toFixed(2),
                            stats: meta.stats || null,
                            locations: ['local']
                        });
                    } catch (e) {
                        // ignore corrupt file
                    }
                }
            }
        } catch (e) {
            console.error('[BackupService] 로컬 백업 목록 조회 오류:', e.message);
        }

        // 2. S3 원격 버킷 탐색
        if (hasAwsCredentials()) {
            try {
                const listCommand = new ListObjectsV2Command({
                    Bucket: BUCKET_NAME,
                    Prefix: S3_BACKUP_PREFIX
                });
                const s3Res = await s3Client.send(listCommand);
                for (const item of (s3Res.Contents || [])) {
                    const fileName = path.basename(item.Key);
                    if (!fileName.endsWith('.json')) continue;

                    if (map.has(fileName)) {
                        map.get(fileName).locations.push('s3');
                    } else {
                        map.set(fileName, {
                            backupId: fileName.replace('.json', ''),
                            fileName,
                            date: item.LastModified?.toISOString()?.split('T')[0] || '',
                            timestamp: item.LastModified?.toISOString() || '',
                            reason: 'S3_REMOTE',
                            sizeBytes: item.Size || 0,
                            sizeMb: ((item.Size || 0) / 1024 / 1024).toFixed(2),
                            stats: null,
                            locations: ['s3']
                        });
                    }
                }
            } catch (s3Err) {
                console.warn('[BackupService] S3 백업 목록 조회 주의:', s3Err.message);
            }
        }

        const list = Array.from(map.values());
        list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        return list;
    }

    /**
     * 특정 백업 지점 데이터 읽기
     */
    async getSnapshotData(backupIdOrFileName) {
        this.ensureLocalDir();
        const fileName = backupIdOrFileName.endsWith('.json') ? backupIdOrFileName : `${backupIdOrFileName}.json`;
        const localPath = path.join(LOCAL_BACKUP_DIR, fileName);

        if (fs.existsSync(localPath)) {
            try {
                return JSON.parse(fs.readFileSync(localPath, 'utf8'));
            } catch (e) {
                console.warn('[BackupService] 로컬 백업 파싱 실패, S3 시도:', e.message);
            }
        }

        if (hasAwsCredentials()) {
            const s3Key = `${S3_BACKUP_PREFIX}${fileName}`;
            const getCommand = new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key
            });
            const res = await s3Client.send(getCommand);
            const str = await streamToString(res.Body);
            return JSON.parse(str);
        }

        throw new Error(`백업 지점을 찾을 수 없습니다: ${backupIdOrFileName}`);
    }

    /**
     * 특정 백업 지점에서 견적서 또는 전체 DB 복원
     * @param {Object} currentDb 현재 메모리 db
     * @param {string} backupId 복원할 백업 지점 ID
     * @param {Object} options { target: 'all' | 'quotations' | 'specific_quote', quoteId?: string }
     */
    async restoreSnapshot(currentDb, backupId, options = { target: 'quotations' }) {
        console.log(`[BackupService] 🔄 백업 복원 요청 시작: [${backupId}], 대상: ${options.target}`);
        
        // 1. 복원 전 현재 상태를 안전 스냅샷으로 자동 백업 (안전제일)
        await this.createSnapshot(currentDb, 'PRE_RESTORE_SAFETY');

        const snapshotData = await this.getSnapshotData(backupId);
        const backupDb = snapshotData.db || snapshotData;

        if (options.target === 'specific_quote' && options.quoteId) {
            const backupQuote = (backupDb.quotations || []).find(q => q.id === options.quoteId);
            if (!backupQuote) {
                throw new Error(`백업 지점 [${backupId}]에 견적서 [${options.quoteId}]가 존재하지 않습니다.`);
            }
            // 현재 DB에 복원
            const existingIdx = (currentDb.quotations || []).findIndex(q => q.id === options.quoteId);
            delete backupQuote.isDeleted;
            delete backupQuote.isPermanentlyDeleted;
            delete backupQuote.deletedAt;

            if (existingIdx >= 0) {
                currentDb.quotations[existingIdx] = backupQuote;
            } else {
                currentDb.quotations.unshift(backupQuote);
            }

            // 묘비 목록에서 제거
            if (Array.isArray(currentDb.deletedQuotationIds)) {
                currentDb.deletedQuotationIds = currentDb.deletedQuotationIds.filter(id => id !== options.quoteId);
            }

            console.log(`[BackupService] ✅ 단일 견적서 [${options.quoteId}] 백업 복원 완료`);
            return { success: true, restoredQuoteId: options.quoteId };
        }

        if (options.target === 'quotations') {
            const restoredQuotes = backupDb.quotations || [];
            currentDb.quotations = restoredQuotes;
            console.log(`[BackupService] ✅ 견적서 대장 전체 (${restoredQuotes.length}건) 복원 완료`);
            return { success: true, restoredCount: restoredQuotes.length };
        }

        if (options.target === 'all') {
            Object.assign(currentDb, backupDb);
            console.log(`[BackupService] ✅ 전체 데이터베이스 롤백 복원 완료`);
            return { success: true, mode: 'FULL_DB_RESTORE' };
        }

        throw new Error(`지원하지 않는 복원 모드입니다: ${options.target}`);
    }

    /**
     * 일일 자동 백업 스케줄러 시작 (매일 자정 및 부팅 시 1회 점검)
     * @param {Function} getDbFn 현재 DB 참조를 반환하는 함수
     */
    startDailySchedule(getDbFn) {
        const checkAndRunDaily = async () => {
            try {
                const db = getDbFn();
                if (!db || !db.quotations) return;

                const todayStr = getKoreaDateStr(new Date());
                const expectedFileName = `db_backup_${todayStr}.json`;
                const localPath = path.join(LOCAL_BACKUP_DIR, expectedFileName);

                if (!fs.existsSync(localPath)) {
                    console.log(`[BackupService] ⏰ 오늘(${todayStr}) 자 일일 자동 백업 지점을 생성합니다.`);
                    await this.createSnapshot(db, 'DAILY_SCHEDULED');
                }
            } catch (e) {
                console.error('[BackupService] 일일 백업 스케줄러 실행 중 오류:', e.message);
            }
        };

        // 1. 기동 5초 후 오늘 백업 존재 여부 점검 및 즉시 생성
        setTimeout(checkAndRunDaily, 5000);

        // 2. 1시간마다 주기적으로 점검 (자정이 지나면 새 백업 지점 자동 생성)
        this.schedulerTimer = setInterval(checkAndRunDaily, 60 * 60 * 1000);
        console.log('[BackupService] 🛡️ 일일 자동 데이터베이스 백업 스케줄러가 활성화되었습니다. (주기: 1시간 검사, 매일 1회 정기 백업)');
    }
}

export const dailyBackupService = new DailyBackupService();
