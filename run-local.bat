@echo off
echo ===================================================
echo  Starting ALTF Local Development Environment...
echo ===================================================

echo 1. Starting API Server on Port 3001...
start cmd /k "title API Server (Port 3001) && npm run api"

echo 2. Starting Vite Frontend Server on Port 5173...
start cmd /k "title Vite Frontend (Port 5173) && npm run dev"

echo ===================================================
echo  Both servers have been launched in separate windows!
echo  - Frontend: http://localhost:5173
echo  - API: http://localhost:3001
echo ===================================================
pause
