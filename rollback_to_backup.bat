@echo off
chcp 65001 > nul
echo ===================================================
echo [복구 스크립트] 2026-09-08 백업 복구 지점으로 원복합니다...
echo ===================================================

echo 1. 백업 파일 덮어쓰기 복원 중...
copy /Y "backup_restore_point_20260908\local-api-server.js" "local-api-server.js"
copy /Y "backup_restore_point_20260908\s3-db.js" "s3-db.js"
if exist "backup_restore_point_20260908\db.json" (
    copy /Y "backup_restore_point_20260908\db.json" "data\db.json"
)
if exist "backup_restore_point_20260908\inventory.json" (
    copy /Y "backup_restore_point_20260908\inventory.json" "public\api\inventory\inventory.json"
)

echo 2. Git 복구 지점(restore-point-20260908) 확인...
git checkout main
git reset --hard restore-point-20260908

echo ===================================================
echo [복구 완료] 모든 코드 및 데이터가 변경 전 상태로 완벽히 복구되었습니다.
echo ===================================================
pause
