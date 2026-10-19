/**
 * 🤖 ALTF Agent Office Auto Launcher
 * 새 컴퓨터 또는 기존 컴퓨터 어디서든 단일 명령(npm run agent)으로
 * 1) 백엔드 로컬 API 서버 (Port 3001)
 * 2) 프론트엔드 Vite 개발 서버 (Port 5173)
 * 3) 브라우저 자동 오픈 (http://localhost:5173/admin/agents)
 * 을 한 번에 구동합니다.
 */

import { spawn, exec } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const API_PORT = 3001;
const VITE_PORT = 5173;
const TARGET_URL = `http://localhost:${VITE_PORT}/agent-office`;

console.log('\n======================================================');
console.log('🚀 [ALTF] AI Agent Office 자동 환경 구축 및 구동 시작');
console.log('======================================================\n');

// 1. 포트 확인 헬퍼
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/`, () => {
            resolve(true); // 포트 열려있음
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// 2. 브라우저 오픈 헬퍼
function openBrowser(url) {
    console.log(`🌐 [Browser] 대시보드 자동 열기: ${url}`);
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} ${url}`);
}

async function start() {
    let apiProc = null;
    let viteProc = null;

    // A. 백엔드 API 서버 (Port 3001) 확인 및 구동
    const isApiRunning = await checkPort(API_PORT);
    if (isApiRunning) {
        console.log(`✅ [Backend API] 포트 ${API_PORT}에서 이미 실행 중입니다. (기존 서버 재사용)`);
    } else {
        console.log(`📦 [Backend API] 로컬 API 서버 구동 중... (Port ${API_PORT})`);
        apiProc = spawn(process.platform === 'win32' ? 'node.exe' : 'node', ['local-api-server.js'], {
            cwd: ROOT_DIR,
            stdio: 'inherit',
            shell: true
        });
    }

    // B. 프론트엔드 Vite 서버 (Port 5173) 확인 및 구동
    const isViteRunning = await checkPort(VITE_PORT);
    if (isViteRunning) {
        console.log(`✅ [Frontend UI] 포트 ${VITE_PORT}에서 이미 실행 중입니다.`);
    } else {
        console.log(`🎨 [Frontend UI] Vite 개발 서버 구동 중... (Port ${VITE_PORT})`);
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        viteProc = spawn(npxCmd, ['vite', '--port', String(VITE_PORT), '--host'], {
            cwd: ROOT_DIR,
            stdio: 'inherit',
            shell: true
        });
    }

    // C. 프론트엔드가 열릴 때까지 폴링 후 브라우저 오픈
    console.log('⏳ [Ready Check] 서버 초기화 대기 중...');
    let attempts = 0;
    const checkInterval = setInterval(async () => {
        attempts++;
        const ready = await checkPort(VITE_PORT);
        if (ready || attempts > 20) {
            clearInterval(checkInterval);
            console.log('\n======================================================');
            console.log(`✨ [성공] AI Agent Office 대시보드가 준비되었습니다!`);
            console.log(`👉 접속 주소: ${TARGET_URL}`);
            console.log('======================================================\n');
            openBrowser(TARGET_URL);
        }
    }, 1000);

    // 프로세스 종료 시 하위 프로세스 정리
    const cleanup = () => {
        console.log('\n🛑 [종료] 서버 프로세스를 정리합니다...');
        if (apiProc) apiProc.kill();
        if (viteProc) viteProc.kill();
        process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

start();
