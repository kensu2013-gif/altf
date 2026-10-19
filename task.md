# Task List: ALTF B2B AI Agent Office & CRM 시스템

## 1. [진행 중] 품질부 (QC-01) 외주 성적서 자동 수집 & 검사 AI 에이전트
- `[x]` **메일플러그(Mailplug) 실제 IMAP 통신 엔진 구축**
  - 메일플러그 `imap.mailplug.co.kr:993` SSL TLS 소켓 통신 구현
  - 앱 비밀번호(`Bq%G%Jo(P)&hdX7fsxX7`) 보안 환경설정 연동 (`server/data/mailplug_config.json`)
  - 한글 메일함 `대경벤드성적서` (`&swCsvbyktNzBMcgBwRw-`) 및 MIME 헤더 한글 디코딩
  - 505건 메일 실시간 감지 및 배치 수집(Batch Sync) API 구축
- `[x]` **1시간 주기 백그라운드 자동 수집 스케줄러**
  - 서버 시작 시 매 1시간마다 신규 성적서 메일 자동 점검 (`startHourlyScheduler`)
- `[x]` **직급별 자율 행동 및 결재 프로세스 확립**
  - 사원(Lv.1), 대리(Lv.2): 무결재 100% 자율 수집 및 루틴 반복 (`AUTO_RUNNING`)
  - 과장(Lv.3): 이상치/오차 발생 시만 선별 검사 및 결재 상신 (`PENDING`)
  - 팀장(Lv.4): 최종 승인권자
- `[x]` **ZIP 압축 파일 즉시 폐기 & PDF 단일 보관 체계**
  - 첨부파일(.zip)은 디스크에 저장하지 않고 메모리 버퍼(`new AdmZip(fileBuffer)`)에서 즉시 압축 해제
  - CP949 한글 파일명 복원하여 `storage/certificates/` 루트에 순수 `.pdf`로만 저장
  - 압축파일(.zip)은 100% 버려지고 디스크에 남지 않음
  - `storage/certificates/대경벤드 성적서.xlsx` 에 26개 컬럼 장부 자동 누적 기록
- `[x]` **AI Agent Office 대시보드 UI 연동**
  - `src/pages/admin/AgentOfficeDashboard.tsx` 내 QC-01 전용 수집 카드 & 인스펙터 패널
  - 윈도우 파일 탐색기 열기 버튼 (`POST /api/certificates/open-folder`)
  - 실시간 PDF 인라인 미리보기 모달 뷰어 & 전체 파일 보관함 모달
- `[x]` **다른 컴퓨터 연속 작업 환경 자동화**
  - 윈도우 원클릭 런처: `start-agent-office.bat` (더블클릭 시 백엔드+프론트엔드+브라우저 자동 오픈)
  - 통합 실행 스크립트: `npm run agent` (`scripts/start-agent-office.js`)
  - 규칙 등록: `AGENTS.md`에 `"agent 계속 하자"` 키워드 자동 인지 및 연속 작업 복원 룰 탑재
- `[ ]` **[다음 작업 예정] 성적서 본문 OCR/텍스트 파싱 & 발주서 스펙 자동 매칭**
  - PDF 성적서 내부 텍스트 추출 (HEAT No, LOT No, 화학성분 C, Si, Mn, P, S, 인장강도 T.S, 항복강도 Y.S)
  - 알트에프 발주서 데이터와의 품목/규격 일치 여부 판정

---

## 2. [완료] CRM Flow Chart 대시보드 및 이벤트 시스템
- `[x]` `local-api-server.js`에 `crmEvents` 데이터 초기화, S3 저장 로직 추가
- `[x]` `local-api-server.js`에 `GET /api/crm/events`, `POST /api/crm/events`, `DELETE /api/crm/events/:id` API 추가
- `[x]` `src/pages/admin/Customers.tsx`에 `'FLOW_CHART'` 탭 추가 및 라우팅 추가
- `[x]` `src/components/admin/FlowChartDashboard.tsx` 신규 컴포넌트 개발 (SVG 매출 추세 차트, 이벤트 등록 및 맵핑, 재고 매출 연동, 지역 및 신규/이탈 업체 분석 모듈 통합)
- `[x]` 컴파일 및 정적 분석 정합성 검증 완료
