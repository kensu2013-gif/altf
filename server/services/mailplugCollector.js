/**
 * QC-01 : Mailplug (메일플러그) 외주 성적서 실제 연동 수집 서비스
 * - 메일플러그 imap.mailplug.co.kr (포트 993 SSL) 네이티브 TLS IMAP 통신
 * - LOGIN 프로토콜 지원 및 Modified UTF-7 메일함 디코딩
 * - 타겟 메일함: 대경벤드성적서 (총 505건 실시간 감지)
 * - 발신자: yrkim@daekyungbend.com
 * - 전체 PDF 일괄 수집 (Batch Sync) 및 매 1시간 주기 자동 감시 스케줄러
 */

import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { certificateParserService } from './certificateParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const CONFIG_PATH = path.join(ROOT_DIR, 'server/data/mailplug_config.json');
const HISTORY_PATH = path.join(ROOT_DIR, 'server/data/mailplug_history.json');
const SYNCED_UIDS_PATH = path.join(ROOT_DIR, 'server/data/synced_mail_uids.json');
const CERTIFICATES_STORAGE_DIR = path.join(ROOT_DIR, 'storage/certificates');

// MIME 헤더 디코딩 (ks_c_5601-1987 / euc-kr / utf-8)
export function decodeMimeWord(str) {
    if (!str) return '';
    return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
        try {
            if (encoding.toUpperCase() === 'B') {
                const buf = Buffer.from(text, 'base64');
                const cs = charset.toLowerCase().replace(/ks_c_5601.*|euckr/i, 'euc-kr');
                return iconv.decode(buf, cs);
            } else if (encoding.toUpperCase() === 'Q') {
                const buf = Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary');
                const cs = charset.toLowerCase().replace(/ks_c_5601.*|euckr/i, 'euc-kr');
                return iconv.decode(buf, cs);
            }
        } catch {
            return text;
        }
        return text;
    });
}

// Modified UTF-7 디코딩 헬퍼 (대경벤드성적서 등 한글 폴더명)
function decodeUtf7(str) {
    return str.replace(/&([^-]*)-/g, (match, b64) => {
        if (!b64) return '&';
        const buffer = Buffer.from(b64.replace(/,/g, '/'), 'base64');
        return buffer.swap16().toString('utf16le');
    });
}

function encodeUtf7(str) {
    if (str === '대경벤드성적서') return '&swCsvbyktNzBMcgBwRw-';
    return str;
}

export class MailplugCollectorService {
    constructor() {
        this.schedulerTimer = null;
        this.nextScheduledTime = null;
        this.isBatchRunning = false;
        this.batchProgress = { total: 0, processed: 0, extractedPdfs: 0, status: 'IDLE' };
        this.ensureDirectories();
    }

    ensureDirectories() {
        [CERTIFICATES_STORAGE_DIR, path.dirname(CONFIG_PATH)].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    getConfig() {
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            }
        } catch {}
        return {
            host: 'imap.mailplug.co.kr',
            port: 993,
            secure: true,
            user: 'altf@altf.kr',
            password: '',
            targetMailbox: '대경벤드성적서',
            filterSender: 'daekyungbend.com',
            filterSubject: '출고분 성적서',
            autoSyncIntervalHours: 1,
            lastSyncTime: null
        };
    }

    saveConfig(newConfig) {
        const current = this.getConfig();
        const merged = { ...current, ...newConfig };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
        return merged;
    }

    getSyncedUids() {
        try {
            if (fs.existsSync(SYNCED_UIDS_PATH)) {
                return JSON.parse(fs.readFileSync(SYNCED_UIDS_PATH, 'utf8'));
            }
        } catch {}
        return [];
    }

    markUidSynced(uid, meta = {}) {
        const list = this.getSyncedUids();
        if (!list.some(item => (typeof item === 'object' ? item.uid === uid : item === uid))) {
            list.push({ uid, date: new Date().toISOString(), ...meta });
            fs.writeFileSync(SYNCED_UIDS_PATH, JSON.stringify(list, null, 2), 'utf8');
        }
    }

    getHistory() {
        try {
            if (fs.existsSync(HISTORY_PATH)) {
                return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
            }
        } catch {}
        return [];
    }

    recordHistory(entry) {
        const history = this.getHistory();
        history.unshift({
            id: `mail_${Date.now()}`,
            timestamp: new Date().toISOString(),
            ...entry
        });
        if (history.length > 200) history.length = 200;
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
    }

    // 1. 실제 메일플러그 IMAP 연결 및 로그인 테스트
    async testConnection(configOverride = null) {
        const config = configOverride || this.getConfig();

        if (!config.password) {
            return {
                success: false,
                connected: false,
                message: '앱 비밀번호가 입력되지 않았습니다.'
            };
        }

        return new Promise((resolve) => {
            const socket = tls.connect(config.port, config.host, { timeout: 15000 }, () => {});

            let buffer = '';
            let step = 0;
            const mailboxes = [];
            let totalMails = 0;

            const timeoutId = setTimeout(() => {
                socket.destroy();
                resolve({
                    success: false,
                    connected: false,
                    message: '메일플러그 서버 응답 시간 초과 (15초 타임아웃)'
                });
            }, 15000);

            socket.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\r\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (step === 0 && line.includes('OK IMAP4 ready')) {
                        step = 1;
                        const passEscaped = config.password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                        socket.write(`A01 LOGIN "${config.user}" "${passEscaped}"\r\n`);
                    } else if (step === 1 && line.startsWith('A01')) {
                        if (line.includes('OK')) {
                            step = 2;
                            socket.write('A02 LIST "" "*"\r\n');
                        } else {
                            clearTimeout(timeoutId);
                            socket.end();
                            resolve({
                                success: false,
                                connected: false,
                                message: `로그인 실패: ${line} (앱 비밀번호 확인 필요)`
                            });
                            return;
                        }
                    } else if (step === 2) {
                        if (line.startsWith('* LIST')) {
                            const match = line.match(/"([^"]+)"$/);
                            if (match) {
                                mailboxes.push(decodeUtf7(match[1]));
                            }
                        } else if (line.startsWith('A02 OK')) {
                            step = 3;
                            const boxCode = encodeUtf7(config.targetMailbox || '대경벤드성적서');
                            socket.write(`A03 SELECT "${boxCode}"\r\n`);
                        }
                    } else if (step === 3) {
                        if (line.includes('EXISTS')) {
                            const countMatch = line.match(/\* (\d+) EXISTS/);
                            if (countMatch) totalMails = parseInt(countMatch[1], 10);
                        } else if (line.startsWith('A03 OK')) {
                            clearTimeout(timeoutId);
                            socket.write('A04 LOGOUT\r\n');
                            socket.end();

                            resolve({
                                success: true,
                                connected: true,
                                user: config.user,
                                host: config.host,
                                targetMailbox: config.targetMailbox,
                                totalMails,
                                mailboxes,
                                message: `메일플러그(${config.user}) 실제 연동 성공! [${config.targetMailbox}: 총 ${totalMails}건 메일 실시간 감지]`
                            });
                            return;
                        }
                    }
                }
            });

            socket.on('error', (err) => {
                clearTimeout(timeoutId);
                resolve({
                    success: false,
                    connected: false,
                    error: err.message,
                    message: `소켓 연결 오류: ${err.message}`
                });
            });
        });
    }

    // 2. 메일함 내 모든 메일 목록(메타데이터) 조회
    async fetchAllMailHeaders() {
        const config = this.getConfig();
        if (!config.password) return [];

        return new Promise((resolve) => {
            const socket = tls.connect(config.port, config.host, { timeout: 30000 }, () => {});
            let buffer = '';
            let step = 0;
            const mails = [];

            const timeoutId = setTimeout(() => {
                socket.destroy();
                resolve(mails);
            }, 30000);

            socket.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\r\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (step === 0 && line.includes('OK IMAP4 ready')) {
                        step = 1;
                        const passEscaped = config.password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                        socket.write(`A01 LOGIN "${config.user}" "${passEscaped}"\r\n`);
                    } else if (step === 1 && line.startsWith('A01 OK')) {
                        step = 2;
                        socket.write('A02 SELECT "&swCsvbyktNzBMcgBwRw-"\r\n');
                    } else if (step === 2 && line.startsWith('A02 OK')) {
                        step = 3;
                        socket.write('A03 FETCH 1:* (UID ENVELOPE)\r\n');
                    } else if (step === 3) {
                        if (line.startsWith('* ') && line.includes('FETCH')) {
                            const match = line.match(/\* (\d+) FETCH \(UID (\d+) ENVELOPE \("([^"]+)" "(.*?)" \(\(/);
                            if (match) {
                                const seq = parseInt(match[1], 10);
                                const uid = parseInt(match[2], 10);
                                const dateStr = match[3];
                                const subjectRaw = match[4];
                                const subject = decodeMimeWord(subjectRaw);
                                mails.push({ seq, uid, dateStr, subject });
                            }
                        } else if (line.startsWith('A03 OK')) {
                            clearTimeout(timeoutId);
                            socket.write('A04 LOGOUT\r\n');
                            socket.end();
                            resolve(mails);
                            return;
                        }
                    }
                }
            });

            socket.on('error', () => {
                clearTimeout(timeoutId);
                resolve(mails);
            });
        });
    }

    // 3. 특정 메일의 첨부파일(ZIP 또는 PDF) 다운로드 및 압축 해제 (ZIP 파일은 즉시 폐기하고 PDF만 보관)
    async downloadAndExtractAttachment(seq, uid, emailSubject, emailDate) {
        const config = this.getConfig();
        if (!config.password) return { success: false, reason: 'No password' };

        return new Promise((resolve) => {
            const socket = tls.connect(config.port, config.host, { timeout: 60000 }, () => {});
            let step = 0;
            let buffer = Buffer.alloc(0);
            let isFetchingBody = false;
            let bodyBuffer = Buffer.alloc(0);

            const timeoutId = setTimeout(() => {
                socket.destroy();
                resolve({ success: false, reason: 'Attachment download timeout (60s)' });
            }, 60000);

            socket.on('data', (data) => {
                if (!isFetchingBody) {
                    buffer = Buffer.concat([buffer, data]);
                    const text = buffer.toString('utf8');

                    if (step === 0 && text.includes('OK IMAP4 ready')) {
                        step = 1;
                        buffer = Buffer.alloc(0);
                        const passEscaped = config.password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                        socket.write(`A01 LOGIN "${config.user}" "${passEscaped}"\r\n`);
                    } else if (step === 1 && text.includes('A01 OK')) {
                        step = 2;
                        buffer = Buffer.alloc(0);
                        socket.write('A02 SELECT "&swCsvbyktNzBMcgBwRw-"\r\n');
                    } else if (step === 2 && text.includes('A02 OK')) {
                        step = 3;
                        buffer = Buffer.alloc(0);
                        isFetchingBody = true;
                        // 첨부파일 파트 (BODY.PEEK[2])
                        socket.write(`A03 FETCH ${seq} (BODY.PEEK[2])\r\n`);
                    }
                } else {
                    bodyBuffer = Buffer.concat([bodyBuffer, data]);
                    const str = bodyBuffer.toString('latin1');
                    if (str.includes('A03 OK')) {
                        clearTimeout(timeoutId);
                        isFetchingBody = false;
                        socket.write('A04 LOGOUT\r\n');
                        socket.end();

                        try {
                            const headerEnd = str.indexOf('\r\n');
                            const cleanBase64 = str.substring(
                                headerEnd + 2,
                                str.lastIndexOf(') \r\nA03 OK') > 0 ? str.lastIndexOf(') \r\nA03 OK') : str.lastIndexOf('\r\nA03 OK')
                            ).replace(/\r\n/g, '').trim();

                            const fileBuffer = Buffer.from(cleanBase64, 'base64');
                            if (fileBuffer.length < 100) {
                                resolve({ success: false, reason: 'Invalid or empty attachment buffer' });
                                return;
                            }

                            const extractedFiles = [];

                            // ZIP 파일 여부 확인 (PK 시그니처 0x50, 0x4B)
                            if (fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b) {
                                // ZIP 파일은 디스크에 저장하지 않고 메모리 상에서 바로 압축 해제! (압축파일은 즉시 폐기)
                                const zip = new AdmZip(fileBuffer);
                                const entries = zip.getEntries();

                                entries.forEach(entry => {
                                    // 디렉토리는 무시
                                    if (entry.isDirectory) return;

                                    let properName = entry.entryName;
                                    if (entry.rawEntryName) {
                                        try {
                                            properName = iconv.decode(entry.rawEntryName, 'cp949');
                                        } catch {}
                                    }
                                    
                                    // 경로 구분자 제거 (순수 파일명만 취득)
                                    properName = path.basename(properName);

                                    // 오직 PDF 파일만 storage/certificates에 바로 저장
                                    if (properName.toLowerCase().endsWith('.pdf')) {
                                        const outPath = path.join(CERTIFICATES_STORAGE_DIR, properName);
                                        fs.writeFileSync(outPath, entry.getData());
                                        extractedFiles.push({
                                            filename: properName,
                                            path: outPath,
                                            sizeBytes: entry.header.size,
                                            sourceZip: null, // 압축파일은 폐기됨
                                            emailSubject,
                                            date: emailDate
                                        });
                                        console.log(`[QC-01 Collector] ZIP 해제 -> PDF 보관 완료: ${properName} (ZIP 원본은 폐기됨)`);
                                    }
                                });
                            } else if (fileBuffer.slice(0, 4).toString() === '%PDF') {
                                // 단일 PDF 파일인 경우 (압축 없이 온 메일)
                                const safeSubject = emailSubject.replace(/[\\/:*?"<>|]/g, '_').trim();
                                const pdfName = `${safeSubject}.pdf`;
                                const outPath = path.join(CERTIFICATES_STORAGE_DIR, pdfName);
                                fs.writeFileSync(outPath, fileBuffer);
                                extractedFiles.push({
                                    filename: pdfName,
                                    path: outPath,
                                    sizeBytes: fileBuffer.length,
                                    sourceZip: null,
                                    emailSubject,
                                    date: emailDate
                                });
                                console.log(`[QC-01 Collector] 단일 PDF 첨부파일 저장 완료: ${pdfName}`);
                            }

                            this.markUidSynced(uid, {
                                emailSubject,
                                extractedCount: extractedFiles.length
                            });

                            // 추출된 PDF가 있으면 26개 컬럼 엑셀 원장 및 품질 검사 즉시 자동 실행
                            if (extractedFiles.length > 0) {
                                certificateParserService.parseAndSyncAll().catch(e => {
                                    console.error('[QC-01 Collector] Auto-parse error:', e.message);
                                });
                            }

                            resolve({
                                success: true,
                                uid,
                                extractedFiles
                            });
                        } catch (err) {
                            resolve({ success: false, reason: err.message });
                        }
                    }
                }
            });

            socket.on('error', (err) => {
                clearTimeout(timeoutId);
                resolve({ success: false, reason: err.message });
            });
        });
    }

    // 4. 최신 메일 1건 실시간 동기화 (기존 호환 & 스케줄러용)
    async syncNow() {
        const config = this.getConfig();
        if (!config.password) {
            return await this.syncSampleData();
        }

        const allMails = await this.fetchAllMailHeaders();
        const filtered = allMails.filter(m => m.subject.includes('성적서') || m.subject.includes('출고분'));

        if (filtered.length === 0) {
            return {
                success: true,
                message: '수집할 성적서 메일이 없습니다.',
                extractedPdfCount: 0,
                savedFiles: []
            };
        }

        // 최신 메일부터 확인
        const latest = filtered[filtered.length - 1];
        const syncedUids = this.getSyncedUids().map(u => (typeof u === 'object' ? u.uid : u));

        if (syncedUids.includes(latest.uid)) {
            return {
                success: true,
                alreadySynced: true,
                message: `최신 성적서(UID ${latest.uid}: ${latest.subject})는 이미 최신 상태로 보관되어 있습니다.`,
                extractedPdfCount: 0,
                savedFiles: []
            };
        }

        const result = await this.downloadAndExtractAttachment(latest.seq, latest.uid, latest.subject, latest.dateStr);

        this.saveConfig({ lastSyncTime: new Date().toISOString() });

        if (result.success) {
            this.recordHistory({
                type: 'REAL_IMAP_COLLECTED',
                uid: latest.uid,
                subject: latest.subject,
                extractedPdfCount: result.extractedFiles.length,
                files: result.extractedFiles
            });

            return {
                success: true,
                isRealConnected: true,
                totalMailboxCount: allMails.length,
                fetchedMails: 1,
                extractedPdfCount: result.extractedFiles.length,
                savedFiles: result.extractedFiles,
                message: `메일플러그 최신 메일(UID ${latest.uid}: ${latest.subject}) 수집 완료! [PDF ${result.extractedFiles.length}개 추출]`
            };
        }

        return {
            success: false,
            message: `다운로드 실패: ${result.reason}`
        };
    }

    // 5. [전체 PDF 일괄 수집] 메일함 내 과거 전체 성적서 메일 배치 수집 (Batch Sync)
    async syncAllBatch(batchLimit = 30) {
        if (this.isBatchRunning) {
            return {
                success: false,
                isAlreadyRunning: true,
                message: '이미 전체 일괄 수집(Batch Sync) 작업이 백그라운드에서 진행 중입니다.',
                progress: this.batchProgress
            };
        }

        const config = this.getConfig();
        if (!config.password) {
            return { success: false, message: '앱 비밀번호가 설정되지 않았습니다.' };
        }

        this.isBatchRunning = true;
        const allMails = await this.fetchAllMailHeaders();
        const targetMails = allMails.filter(m => m.subject.includes('성적서') || m.subject.includes('출고분')).reverse(); // 최신순부터

        const syncedUids = this.getSyncedUids().map(u => (typeof u === 'object' ? u.uid : u));
        const pendingMails = targetMails.filter(m => !syncedUids.includes(m.uid));

        const toProcess = pendingMails.slice(0, batchLimit);
        this.batchProgress = {
            total: toProcess.length,
            processed: 0,
            extractedPdfs: 0,
            status: 'RUNNING'
        };

        // 비동기 백그라운드 배치 실행
        (async () => {
            console.log(`[QC-01 Batch] 전체 성적서 일괄 수집 시작: 대상 ${toProcess.length}건 (최신순)...`);
            const collectedFiles = [];

            for (const mail of toProcess) {
                try {
                    console.log(`[QC-01 Batch] 메일 수집 중: [Seq ${mail.seq}, UID ${mail.uid}] ${mail.subject}`);
                    const res = await this.downloadAndExtractAttachment(mail.seq, mail.uid, mail.subject, mail.dateStr);
                    if (res.success && res.extractedFiles) {
                        this.batchProgress.extractedPdfs += res.extractedFiles.length;
                        collectedFiles.push(...res.extractedFiles);
                    }
                } catch (e) {
                    console.error(`[QC-01 Batch] 메일 UID ${mail.uid} 처리 중 오류:`, e.message);
                }
                this.batchProgress.processed += 1;
            }

            this.batchProgress.status = 'COMPLETED';
            this.isBatchRunning = false;
            this.saveConfig({ lastSyncTime: new Date().toISOString() });

            this.recordHistory({
                type: 'BATCH_SYNC_COMPLETED',
                processedMails: toProcess.length,
                extractedPdfs: this.batchProgress.extractedPdfs,
                files: collectedFiles.slice(0, 50)
            });

            console.log(`[QC-01 Batch] 전체 성적서 수집 완료! 총 ${this.batchProgress.extractedPdfs}개 PDF 아카이빙 완료.`);
        })();

        return {
            success: true,
            isBatchStarted: true,
            totalTargets: toProcess.length,
            totalAvailable: targetMails.length,
            alreadySyncedCount: syncedUids.length,
            message: `메일플러그 대경벤드 성적서 ${toProcess.length}건 배치 수집을 시작했습니다. (전체 대상: ${targetMails.length}건)`
        };
    }

    getBatchStatus() {
        return {
            isRunning: this.isBatchRunning,
            progress: this.batchProgress,
            storagePaths: {
                certificatesDir: CERTIFICATES_STORAGE_DIR
            }
        };
    }

    // 6. 1시간 주기 자동 메일 확인 스케줄러 (매시간 자동 감시)
    startHourlyScheduler() {
        if (this.schedulerTimer) return;
        const ONE_HOUR_MS = 60 * 60 * 1000;
        this.nextScheduledTime = new Date(Date.now() + ONE_HOUR_MS).toISOString();
        console.log(`[QC-01 Mailplug] 1시간 주기 자동 메일 감시 스케줄러 시작! (다음 점검: ${this.nextScheduledTime})`);

        this.schedulerTimer = setInterval(async () => {
            try {
                const config = this.getConfig();
                if (config.password) {
                    console.log(`[QC-01 Auto-Scheduler] [${new Date().toLocaleTimeString('ko-KR')}] 1시간 주기 자동 메일 감시 실행...`);
                    const result = await this.syncNow();
                    console.log(`[QC-01 Auto-Scheduler] 수집 결과:`, result.message);
                }
                this.nextScheduledTime = new Date(Date.now() + ONE_HOUR_MS).toISOString();
            } catch (err) {
                console.error('[QC-01 Auto-Scheduler] 에러:', err.message);
            }
        }, ONE_HOUR_MS);
    }

    getSchedulerStatus() {
        return {
            isActive: !!this.schedulerTimer,
            interval: '1시간 (60분)',
            nextRunTime: this.nextScheduledTime,
            lastSyncTime: this.getConfig().lastSyncTime || null
        };
    }

    stopHourlyScheduler() {
        if (this.schedulerTimer) {
            clearInterval(this.schedulerTimer);
            this.schedulerTimer = null;
            this.nextScheduledTime = null;
        }
    }

    async syncSampleData() {
        return {
            success: true,
            isSimulation: true,
            fetchedMails: 1,
            extractedPdfCount: 0,
            savedFiles: [],
            message: '연결 설정 대기 중'
        };
    }
}

export const mailplugService = new MailplugCollectorService();
// 서버 시작과 동시에 1시간 주기 자동 스케줄러 가동
mailplugService.startHourlyScheduler();
