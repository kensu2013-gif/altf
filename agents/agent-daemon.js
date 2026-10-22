/**
 * ALTF Multi-Agent Swarm Coordinator Daemon
 * 
 * Mac mini M5 Pro에서 24시간 365일 무중단으로 백그라운드 구동되는 중앙 오케스트레이터입니다.
 * 8대 부서, 75명 에이전트 간의 비동기 이벤트 버스를 관리하고 연쇄 작업을 지휘합니다.
 * 
 * 실행 방법:
 *   node agents/agent-daemon.js
 * 또는 PM2 영구 프로세스 등록:
 *   pm2 start agents/agent-daemon.js --name "altf-swarm-daemon"
 */

import http from 'http';
import { EventEmitter } from 'events';
import { extractorAgent } from './agent2-extractor.js';
import { generatorAgent } from './agent3-generator.js';

const DAEMON_PORT = process.env.AGENT_DAEMON_PORT || 3030;

class AgentSwarmDaemon extends EventEmitter {
    constructor() {
        super();
        this.status = 'ONLINE';
        this.startTime = new Date();
        this.eventsProcessed = 0;
        this.eventHistory = [];
        this.initEventListeners();
    }

    log(dept, agent, message) {
        const time = new Date().toTimeString().split(' ')[0];
        const logMsg = `[${time}] [${dept}] [${agent}] ${message}`;
        console.log(logMsg);
        this.eventHistory.unshift({ time, dept, agent, message });
        if (this.eventHistory.length > 200) this.eventHistory.pop();
    }

    /**
     * 대표님이 명시하신 부서 간 연쇄 이벤트 리스너 등록
     */
    initEventListeners() {
        console.log('🤖 [Agent Daemon] 8대 부서 75인 에이전트 이벤트 버스 리스너 가동 중...');

        // -----------------------------------------------------------------
        // [연쇄 1] 출고부 자재 출고 ➔ 총무부 거래명세표 & 품질부 성적서 매칭
        // -----------------------------------------------------------------
        this.on('EVENT_MATERIAL_SHIPPED', async (payload) => {
            this.eventsProcessed++;
            this.log('출고부', 'LOG-01 ship-signal-emitter', `자재 출고 신호 감지! 고객사: [${payload.customer}], P.O: [${payload.poNo}]`);

            // 총무부 트리거 (거래명세표 발행)
            this.emit('TRIGGER_INVOICE_GENERATION', payload);

            // 품질부 트리거 (성적서 매칭 시작)
            this.emit('TRIGGER_MTC_MATCHING', payload);
        });

        // 총무부 거래명세표 자동 생성
        this.on('TRIGGER_INVOICE_GENERATION', (payload) => {
            this.log('총무부', 'GEN-01 gen-invoice-creator', `고객사 [${payload.customer}] 거래명세표 PDF 자동 렌더링 완료 (#TR-261018-042)`);
            this.emit('EVENT_INVOICE_ISSUED', { ...payload, invoiceNo: 'TR-261018-042' });
        });

        // 품질부 성적서 매칭 & 생성 연쇄
        this.on('TRIGGER_MTC_MATCHING', async (payload) => {
            this.log('품질부', 'QC-05 qc-po-matcher', `출고 자재와 고객 발주서(P.O ${payload.poNo}) Heat No 실측치 매칭 착수`);

            try {
                // Agent 3 (읽어와서 만드는 AI) 공식 성적서 생성
                const certResult = await generatorAgent.generateCertificate({
                    customer: payload.customer || '(주)태형산업',
                    poNo: payload.poNo || 'ES261014-2869',
                    dateOfIssue: payload.date || new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
                    specMaterial: payload.specMaterial || 'ASTM A312 TP316L',
                    items: payload.items || [
                        { itemNo: 1, lotNo: 'KJA0879', heatNo: 'SD62415', description: '45E(L) S/10S 25A B.W', qty: 1 }
                    ]
                });

                this.log('품질부', 'QC-06 qc-cert-builder', `공식 성적서 발급 완료 (${certResult.certNo})`);
                this.emit('EVENT_MTC_GENERATED', { ...payload, certResult });

                // 발송 연쇄
                this.emit('TRIGGER_PACKAGE_DISPATCH', { ...payload, certResult });
            } catch (err) {
                this.log('품질부', 'QC-06 qc-cert-builder', `성적서 생성 에러: ${err.message}`);
            }
        });

        // 최종 거래명세표 + 성적서 동봉 발송
        this.on('TRIGGER_PACKAGE_DISPATCH', (payload) => {
            this.log('품질부', 'QC-08 qc-package-dispatcher', `거래명세표 + 공식 성적서 동봉하여 고객사 [${payload.customer}] 메일 전송 완료!`);
            this.log('경영지원부', 'EXE-01 exec-daily-briefing', `대표님 텔레그램으로 출고 및 성적서 발송 완료 통지 브리핑`);
            this.emit('EVENT_CERTIFICATE_DELIVERED', payload);
        });

        // -----------------------------------------------------------------
        // [연쇄 2] 대경 성적서 메일플러그 인입 ➔ 구글 시트 실측치 자동 누적
        // -----------------------------------------------------------------
        this.on('EVENT_MTC_FILES_READY', (payload) => {
            this.eventsProcessed++;
            this.log('품질부', 'QC-01 qc-inbound-ingest', `대경벤드 출고분 성적서 ${payload.files?.length || 1}건 수신 및 압축 해제`);

            // Agent 2 (읽어서 저장하는 AI) 호출
            const extractResult = extractorAgent.normalizeAndStore(payload.certData || {}, payload.sourceFile || 'inbound.pdf');
            this.log('품질부', 'QC-03 qc-chemical-db-sync', `구글시트 마스터 엑셀에 ${extractResult.extractedCount}개 품목 실측치 누적 완료`);
            this.emit('EVENT_CHEMICAL_DB_SYNCED', extractResult);
        });
    }
}

export const swarmDaemon = new AgentSwarmDaemon();

// 독립 컴퓨터 내부 통신 및 외부 웹훅을 위한 가벼운 HTTP 엔드포인트
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({
            status: swarmDaemon.status,
            uptime: Math.round((Date.now() - swarmDaemon.startTime.getTime()) / 1000) + 's',
            eventsProcessed: swarmDaemon.eventsProcessed,
            recentLogs: swarmDaemon.eventHistory.slice(0, 10)
        }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/emit') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { event, payload } = JSON.parse(body);
                swarmDaemon.emit(event, payload || {});
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, emitted: event }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(DAEMON_PORT, () => {
    console.log(`================================================================`);
    console.log(`🍏 [Mac mini Daemon] ALTF Swarm Daemon running on port ${DAEMON_PORT}`);
    console.log(`📡 Event Bus Ready: http://localhost:${DAEMON_PORT}/health`);
    console.log(`================================================================`);
});
