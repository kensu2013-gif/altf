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
- `[x]` **다른 컴퓨터 연속 작업 환경 자동화 (Cross-Machine Continuity)**
  - 윈도우 원클릭 런처: `start-agent-office.bat` (더블클릭 시 백엔드+프론트엔드+브라우저 자동 오픈)
  - 통합 실행 스크립트: `npm run agent` (`scripts/start-agent-office.js` ➔ `http://localhost:5173/agent-office` 자동 실행)
  - 규칙 등록: `AGENTS.md`에 `"agent 수정하자"`, `"에이전트 수정하자"`, `"agent 준비"` 등 연속 작업 자동 인지 및 상태 복원 룰 탑재
  - 서버 핵심 데이터 Git 영구 동기화: `server/data/agents.json`, `server/data/departments.json`, `server/data/certificates.json` (1,424건 마스터), `server/data/mailplug_config.json` 일괄 저장
- `[x]` **전체 통합부서 관제 부서 CRUD (추가 / 수정 / 삭제) 시스템 구축**
  - 부서 정적 상수를 동적 반응형 상태 `departments`로 전면 전환
  - 백엔드 REST API `GET /api/departments`, `POST /api/departments` 및 `server/data/departments.json` 영구 백업 연동
  - 신규 부서 추가: 부서명, 코드, 23종 이모지 픽커, 10종 네온 컬러 프리셋, 총괄 직책, 슬롯 수 입력 시 자동 슬롯 생성
  - 부서 정보 수정: 부서명/코드/컬러/직책 수정 시 소속 에이전트 자동 일괄 동기화
  - 부서 삭제: 소속 에이전트 및 연계 그물망 태그 안전 삭제, 관제 뷰 자동 리셋
  - 사이드바 호버 퀵 액션, 중앙 서브헤더 및 계층형 조직도 헤더 바에 수정/삭제 직관적 배치
- `[x]` **성적서 본문 파싱 & 26개 컬럼 장부 자동 누적 & 이상치 검출 엔진 구축**
  - `server/services/certificateParser.js` 신규 구현: `PDFParse` 기반 전 페이지 텍스트/표 스트림 파싱
  - HEAT No, LOT No, 품목(Description), 수량, 화학성분(C, Si, Mn, P, S, Ni, Cr, Mo), 기계적 성질(Y.S, T.S, E.L), 외관/치수 추출 완료
  - 한국산업표준(KS B 1543, KS D 3576) 및 ASTM A312 TP304/TP316L 공차 규격 기반 이상치(Outlier) 자동 판정 엔진 탑재 (PASS / WARN / FAIL)
  - `storage/certificates/대경벤드 성적서.xlsx` 및 `server/data/certificates.json` 자동 동기화 (총 1,424개 품목 100% 매핑 완료)
  - `mailplugCollector.js` 연동: 신규 성적서 다운로드 즉시 26개 컬럼 장부 자동 파싱 및 엑셀 누적
  - `src/components/admin/CertificateLedgerModal.tsx` 26개 컬럼 인터랙티브 대형 데이터 그리드 뷰어 및 엑셀 다운로드(`GET /api/certificates/download-excel`) 연동 완료
- `[x]` **QC-02 (MTC 비전 판독 에이전트) 및 2개 시트(3열 병합 양식 호환) 엑셀 생성 체계 구축**
  - `runQC02Agent`: 10~30장 이상의 다중 페이지 및 대용량 PDF 증분(Incremental Upsert) 누적 판독 지원
  - `storage/certificates/대경벤드 성적서.xlsx` 내 2개 시트 동시 생성:
    - Sheet 1: `대경벤드성적서` (표준 26개 컬럼 마스터 대장)
    - Sheet 2: `성적서양식_복사용(3열병합호환)` (화학/기계 성질 3열 병합 간격 매칭)
  - `POST /api/qc/qc02/run` 및 `GET /api/qc/qc02/status` API 연동
  - 모달 상단 `📋 양식 복사 (3열 병합)` 원클릭 클립보드 복사 지원 (엑셀 `성적서 양식.xlsx`에 바로 붙여넣기 가능)
  - `server/data/agents.json` 내 QC-02 에이전트 실시간 지표(Task 처리수, 활성 상태) 자동 동기화
- `[x]` **발주서(PO) ⟷ 외주 성적서 교차 대조 자동화 & 구매부 SCM 파이프라인 구축 완료**
  - 알트에프 발주서 데이터베이스(`db.orders` 1,537건, 7,030개 발주품목)와 QC 성적서(`certificates.json` 1,469건) P.O No 및 규격 1:1 자동 매칭
  - `server/services/purchaseService.js` 신규 구현: 알트에프 재고 구매분(`isStockOrder`) 417건 자동 필터링, 매입발주 대장(`purchase_orders.json`) 및 교차 대장(`purchase_qc_matches.json`) 구축
  - 발주번호별 입고 완료 / 부분입고 / 미결(Pending) 실시간 상태 판정 및 상급자 통보 체계 확립

---

## 3. [완료] 구매부 (PUR-01) 알트에프 재고 발주 List Up & QC 성적서 1:1 매칭 에이전트
- `[x]` **PUR-01 (사원 / 알트에프 재고 발주 List Up 봇 - Lv.1 자율 루틴)**:
  - `altf.kr` 웹에서 알트에프 재고로 구매한 발주 신호 실시간 감지 (30분 주기 스케줄러 자동 가동)
  - 발주번호별(`poNo`), 아이템별(`itemNo`)로 완전 자동 List Up (총 624개 재고 발주품목)
  - QC-01 외주 성적서 List와 1:1 정밀 규격 대조 및 성적서 번호(`certNo`), `heatNo`, `lotNo` 매핑
  - 입고 상태 판정: 입고완료 159건, 부분입고 12건, 잔여 미결 453건 실시간 추적
- `[x]` **QC-01과 100% 동일한 26개 컬럼 엑셀 마스터 원장 자동 생성**:
  - 파일 위치: `storage/purchases/알트에프 재고 발주 대장.xlsx`
  - 발주일자, 입고일자, Customer, 공급처, P.O No, CERT-No, Spec MAT/INSP, HEAT No, LOT No, ITEM No, DESCRIPTION, 발주수량, 입고수량, 미결수량, 입고상태, 화학성분(C/Si/Mn/P/S/Ni/Cr/Mo), 기계적성질, PDF 링크 26개 컬럼 완전 일치
- `[x]` **REST API & 대시보드 UI 연동**:
  - `GET /api/pur/summary`, `GET /api/pur/stock-orders`, `POST /api/pur/sync`, `GET /api/pur/download-excel`, `POST /api/pur/open-folder` 연동
  - 불필요한 질의응답(QNA) 전면 제거 ➔ 오직 **알트에프 재고 발주 & 성적서 1:1 매칭 대장** 전문 뷰어로 직관적 개편
  - Agent Office 대시보드 상단 서브헤더 및 PUR-01 인스펙터 패널 연동 완료

---

## 2. [완료] CRM Flow Chart 대시보드 및 이벤트 시스템
- `[x]` `local-api-server.js`에 `crmEvents` 데이터 초기화, S3 저장 로직 추가
- `[x]` `local-api-server.js`에 `GET /api/crm/events`, `POST /api/crm/events`, `DELETE /api/crm/events/:id` API 추가
- `[x]` `src/pages/admin/Customers.tsx`에 `'FLOW_CHART'` 탭 추가 및 라우팅 추가
- `[x]` `src/components/admin/FlowChartDashboard.tsx` 신규 컴포넌트 개발 (SVG 매출 추세 차트, 이벤트 등록 및 맵핑, 재고 매출 연동, 지역 및 신규/이탈 업체 분석 모듈 통합)
- `[x]` 컴파일 및 정적 분석 정합성 검증 완료
