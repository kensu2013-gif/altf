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

## 4. [완료] 구매부 (PUR-07) 주문관리 발주서 분류·미결 관제 & 서류 번들링 에이전트
- `[x]` **PUR-07 (대리 / 주문관리 발주서 분류 및 미결 통합 관제봇)**:
  - `altf.kr` 뒷단 주문관리의 모든 발주서(`db.orders` 실서버 연동 2,439건 활성/총 2,440건, 11,204개 품목) 수집 및 201개 거래처별, 날짜별 자동 분류/저장
  - 각 발주 품목에 대응하는 매입발주서(`PUR-PO-...`) 동시 생성 및 매입처(대경벤드 등) 연계 관리
  - 미결 리스트(Backlog Pending: 462건) 24시간 실시간 추적 및 관리
- `[x]` **영업시간(09:00 ~ 18:00) 매 1시간 주기 API 자동 호출 스케줄러**:
  - 평일 09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00 (1일 10회) 자동 감지
  - 그 외 영업시간 외/주말은 대기 상태(STANDBY) 유지
- `[x]` **사무실 출고 완료 연동 & 거래명세표·성적서 자동 1:1 매칭 (고객 발송 패키징)**:
  - 실제 사무실 담당자가 출고 완료(`fulfillOrder`) 처리 시 미결(Pending)에서 즉시 해제
  - 발주번호 기반 품질부 성적서(`certificates.json` 1,469건 / QC-01) 접수 여부 확인 (286건 매칭 완료)
  - 거래명세표(`STMT-...`)와 성적서 PDF를 1:1 결합한 고객사 발송 준비 완료 패키지(`READY_TO_DISPATCH` 277건) 자동 번들링
- `[x]` **영구 백업 및 엑셀 마스터 대장 자동 생성**:
  - `server/data/pur07_order_backlog.json` 및 `storage/purchases/주문관리_발주서_통합대장.xlsx` 2개 시트(미결리스트 / 고객발송준비) 생성
- `[x]` **REST API & AI Agent Office 대시보드 연동**:
  - `GET /api/pur/pur07/summary`, `GET /api/pur/pur07/backlog`, `POST /api/pur/pur07/sync`, `POST /api/pur/pur07/fulfill`, `GET /api/pur/pur07/packages`, `GET /api/pur/pur07/scheduler-status`, `GET /api/pur/pur07/download-excel`
  - Agent Office 인스펙터 패널 내 PUR-07 전용 네온 제어반 실시간 통계 연동 완료

---

## 2. [완료] CRM Flow Chart 대시보드 및 이벤트 시스템
- `[x]` `local-api-server.js`에 `crmEvents` 데이터 초기화, S3 저장 로직 추가
- `[x]` `local-api-server.js`에 `GET /api/crm/events`, `POST /api/crm/events`, `DELETE /api/crm/events/:id` API 추가
- `[x]` `src/pages/admin/Customers.tsx`에 `'FLOW_CHART'` 탭 추가 및 라우팅 추가
- `[x]` `src/components/admin/FlowChartDashboard.tsx` 신규 컴포넌트 개발 (SVG 매출 추세 차트, 이벤트 등록 및 맵핑, 재고 매출 연동, 지역 및 신규/이탈 업체 분석 모듈 통합)
- `[x]` 컴파일 및 정적 분석 정합성 검증 완료

---

## 5. [완료] 대경벤드 거래명세표(메신저/PDF) 매입 확정 & 전사 자율 연계 (총무/구매/품질/출고)
- `[x]` **대경벤드 거래명세서 다중 페이지 PDF 정밀 파서 개발 (`server/services/daekyungInvoiceService.js`)**:
  - `PDFParse` 스트림 기반 일자, 전표번호(No:0031, No:0015), 공급자/공급받는자 사업자등록번호 파싱
  - 테이블 내 품목(45E, 90E, T, R, CAP 등), 규격(S/10S, S/20S), 재질(STS304-W 등), 수량, 단가, 공급가액, 운임 자동 계산
  - 비고란 P.O 번호(`ES261019-2924`, `ES261019-2915`) 및 서울재고/고객사(국제밸브앤드피팅 등) 자동 식별
- `[x]` **4대 부서 동시 자율 연계 트리거 (Cross-Department Dispatcher)**:
  - 📑 **총무부 (GEN-01/GEN-04)**: 대경벤드 매입 확정 전표 생성, 공급가액/부가세(10%)/총액 계산, `server/data/supplier_invoices.json` 장부 자동 누적
  - 🛒 **구매부 (PUR-07/PUR-01)**: `storage/purchases/알트에프 재고 발주 대장.xlsx` 엑셀에서 P.O No 행 자동 탐색 ➔ 입고일자/입고수량 갱신, 미결수량 0 차감, 상태 '입고완료(대경발송)'로 엑셀 실시간 저장
  - 🔬 **품질부 (QC-01/QC-02/QC-08/QC-09)**: 대경 성적서 DB(1,469개)와 품목 규격 사전 교차 조회 및 성적서 누락 시 경보 발령
  - 🚚 **출고부 (LOG-01/LOG-03)**: 시화 물류센터 서울재고 입고 하차 검수 대기 or 고객사 직배송 운송 상태 자동 전이
- `[x]` **텔레그램 메신저 봇 수신 엔진 구축 (`server/services/telegramBotService.js`)**:
  - Telegram Bot API 롱폴링 수신 지원 (메신저에서 PDF 포워딩/전달 시 1초 만에 자동 감지)
  - 파싱 및 전사 연계 처리 후 텔레그램 채팅방으로 상세 분석 보고서 즉시 회신
- `[x]` **AI Agent Office 대시보드 UI 및 전용 모달 구축 (`src/components/admin/DaekyungInvoiceModal.tsx`)**:
  - 상단 글로벌 서브헤더 및 PUR-07 제어반 내 `[📑 대경 거래명세표 인입]` 버튼 신설
  - PDF 드래그앤드롭 업로드, 텔레그램 봇 토큰 설정 및 가동 토글
  - 사진으로 제공된 2개 전표(No.0031 서울재고분, No.0015 고객직배분) 원클릭 즉시 시뮬레이션 버튼 탑재
  - 4대 부서 파이프라인 실시간 결과 카드 및 누적 매입 확정 장부 테이블 제공

---

## 6. [완료] 총무부·품질부·데이터관리부 공급망 번들링 & 거래처 마스터 연계 체계
- `[x]` **총무부 (GEN-10) 웹 거래처 관리 담당봇 신규 생성**:
  - `altf.kr` 웹 CRM 데이터베이스(1,265개 거래처)에서 대표자, 사업자등록번호, 전화번호, 팩스번호, 이메일 주소, 담당자 정보 실시간 수집 및 정제
  - 총무부 10번째 에이전트로 등록 완료 (`departments.json` 총무부 정원 10명으로 확대)
- `[x]` **총무부 (GEN-03) 거래명세표·성적서 동시 발송 준비봇 활성화**:
  - 웹 발주서 양식에서 매출 거래명세표(`STMT-...`)와 품질부 매칭 성적서(`YR-26-...`)를 1:1 결합하여 고객 발송 직전 서류 패키지(`READY_TO_DISPATCH` 353건) 번들링
  - 출고 완료 후 총무팀장 및 영업부에 즉시 일괄 보고 체계 확립
- `[x]` **데이터관리부 (DAT-10) 전사 공급망 통합 원장 분석봇 구축**:
  - 발주서(PO 2,440건), 발주번호, 아이템(11,204개), 품질부 성적서(1,469건), 매입/매출 거래명세표 및 거래처 정보를 단일 마스터 원장으로 자동 종합
  - 경영지원부(EXE)의 일일 결산, 마진율 추적, 현금흐름 레이더, 고객 이탈 분석을 위한 사전 정제 데이터 파이프라인 구축 완료
