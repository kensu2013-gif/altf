@echo off
chcp 65001 > nul
title ALTF AI Agent Office Launcher

echo ======================================================
echo   🤖 ALTF B2B AI Agent Office 원클릭 자동 실행기
echo ======================================================
echo.

cd /d "%~dp0"

:: 1. Node.js 설치 여부 확인
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org 에서 Node.js를 먼저 설치해 주세요.
    pause
    exit /b
)

:: 2. node_modules 확인 및 자동 의존성 설치
if not exist "node_modules\" (
    echo [알림] 필수 라이브러리가 없어 설치를 진행합니다 (npm install)...
    call npm install
    if %errorlevel% neq 0 (
        echo [오류] npm install 중 문제가 발생했습니다.
        pause
        exit /b
    )
)

:: 3. Agent Office 통합 런처 구동 (백엔드 + 프론트엔드 + 브라우저 자동 오픈)
echo [시작] 백엔드 API 서버와 대시보드 UI를 구동하고 브라우저를 엽니다...
echo.
call npm run agent

pause
