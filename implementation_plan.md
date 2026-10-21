# ALTF B2B AI Agent Office 자동화 시스템 구현 계획서 (Implementation Plan)

본 문서는 `docs/agent-office/ALTF_OFFICE_DEV_PROMPTS.md`에 명시된 8대 원칙과 0단계~7단계 로드맵에 기반하여 작성된 기술 구현 계획서입니다.
현재 단계는 **[로컬 안전 테스트 모드 (Local Test Mode)]**로 동작하며, 실제 운영 환경(Mac 상시 서버, Render, S3, 메일플러그 실제 발송)으로 전환하기 전까지 모든 테스트는 격리된 로컬 Mock/Fixture와 단일 원장 안전 규칙 하에 진행됩니다.

---

## 🛡️ [공통 원칙 & 로컬 테스트 가이드라인]

1. **절대 추정 금지 (No Hallucinated Data)**: 성적서 데이터(HEAT, LOT, 화학성분, 기계적성질)는 마스터(`certificates.json`)에 없으면 절대 임의 기본값으로 채우지 않고 즉시 중단 및 `qc_missing_alerts.json` 경보를 남깁니다.
2. **단일 원장 원칙 (Single Source of Truth)**: 서비스 코드가 `data/db.json`을 fs로 직접 열어 덮어쓰지 않습니다. `local-api-server.js`의 `/api/agent/*` 또는 주입된 원장 인터페이스(`ledgerClient.js`)를 통해서만 변경합니다.
3. **발송 단일 게이트 (Single Dispatch Gate)**: 봇이 개별적으로 이메일/카카오/팩스를 발송하지 않고 `dispatchGate.js` 큐에 넣은 후 역할별 승인(SALES / OFFICE)을 받아야만 발송됩니다.
4. **로컬 격리 테스트**: 로컬 개발 중 실제 메일/카카오/팩스가 고객에게 오발송되지 않도록 `.env`의 `TEST_RECIPIENT_EMAIL` 및 모의(Mock) 어댑터를 사용합니다.

---

## 🎯 0단계: 기반 정비 구현 계획 (현재 착수)

### 0-A. 성적서 기본값 대체 제거 (`certificateIssuer.js`)
* **목적**: 매칭 실패 시 임의로 들어가던 하드코딩 값(`SD34285`, `JCQ4366`, `(주)태양밴드`, `A202610150`, 304 화학성분 기본값)을 제거하여 위조/부정확 발행 원천 차단.
* **로직 변경**:
  1. `findMasterCertData(lotNo, heatNo, poNo, description)` 검사:
     - LOT 일치 항목이 복수일 경우 첫 번째 항목을 임의 선택하지 않고 `AMBIGUOUS`로 처리
     - 미발견 시 `NOT_FOUND`
     - 1건 정확 일치 시 `MATCHED`
  2. `issueCertificatesForOutbound` & `issueCertificatesForPo`:
     - 모든 품목 라인에 대해 매칭 검증을 수행하고 하나라도 `NOT_FOUND` 또는 `AMBIGUOUS`가 발생하면 PDF/엑셀 파일 생성을 즉시 중단.
     - 반환 객체: `{ success: false, reason: 'MISSING_OR_AMBIGUOUS_CERTIFICATE', missingLines: [...] }`
     - `server/data/qc_missing_alerts.json`에 경보 객체 저장 (일시, 출고번호/PO, 라인정보, 누락사유).
     - 고객명 또는 출고번호 누락 시 기본값 주입 대신 즉시 `Error` throw.
* **검증 계획**:
  - 없는 LOT(`NON_EXISTENT_LOT_9999`)로 출고 발행 요청 시 PDF 생성 중단 및 `missingLines` 반환 확인.
  - 존재하는 실제 LOT(`YR-26-07015` 등) 요청 시 정상 PDF/엑셀 생성 확인.
  - 소스코드 전체에서 `SD34285`, `JCQ4366` 기본값 주입 0건 확인.

### 0-B. 단일 원장 원칙 및 에이전트 API (`ledgerClient.js`)
* **목적**: 봇들이 로컬 파일을 임의로 덮어써서 웹 메모리 원장과 불일치하는 문제 해결.
* **로직 변경**:
  1. `local-api-server.js`에 `/api/agent/*` 엔드포인트 구현:
     - `GET /api/agent/orders` (필터: since, status, route)
     - `GET /api/agent/orders/:id`
     - `PATCH /api/agent/orders/:id/lines/:lineId` (라인 상태 전이 및 keys 갱신)
     - `POST /api/agent/orders/:id/events` (주문 이력 추가)
     - 인증 가드: `Authorization: Bearer ${process.env.AGENT_SERVICE_TOKEN}`
  2. `server/services/ledgerClient.js` 모듈 작성:
     - 단일 프로세스 환경에서는 `local-api-server.js`의 `db` 객체 및 `updateDb()` 직접 바인딩
     - 외부/분리 프로세스 환경에서는 `fetch('/api/agent/...')` 호출
  3. `daekyungInvoiceService.js`, `purchaseBacklogBotService.js`, `purchaseService.js` 내 직접 `fs.writeFileSync(db.json)`을 `ledgerClient` 함수로 교체.

### 0-C. 주문 라인 경로(S/D/M)·상태·연결키 스키마 (`lineStateMachine.js`)
* **목적**: 주문 라인 단위로 공급 경로(S: 시화재고, D: 대경직송, M: 제작) 및 진행 상태 추적.
* **로직 변경**:
  1. `src/types/index.ts` 및 주문 라인 스키마에 `route`, `lineStatus`, `keys`, `certRequired` 필드 추가.
  2. `server/services/lineStateMachine.js` 작성: 허용된 상태 전이만 승인하고 유효하지 않은 전이는 차단.
  3. `AdminOrderDetail.tsx`에 라인별 경로 뱃지 및 상태 뱃지 표시.

### 0-D. 발송 게이트와 승인 대기열 (`dispatchGate.js`)
* **목적**: 고객/매입처 발송을 단일 게이트웨이로 통합하고 승인 프로세스 강제.
* **로직 변경**:
  1. `server/services/dispatchGate.js` 작성: 큐 저장(`PENDING_APPROVAL`), 승인(`approve`), 반려(`reject`), 중복 발송 차단.
  2. 관리자 웹 화면에 '승인 대기함' 탭/모달 연동.

---

## 🚀 1단계~7단계 개발 로드맵 요약
- **1단계**: 접수함(`intake`) 구축, 카카오 i 오픈빌더 웹훅 수신, 대표메일 수집 일반화, `itemNormalizer.js` 표준품목 변환, 견적 초안 자동 등록
- **2단계**: 견적 회신 자동화 (1회용 모바일 토큰 링크, PDF 회신, 미주문 팔로업 알림)
- **3단계**: 발주서 접수 ➔ 초안 등록(PUR-11) ➔ 대조(PUR-12) ➔ S/D/M 경로 제안(PUR-13) ➔ 대경 매입발주(D/M) & 대경 회신 한줄 기록(PUR-14)
- **4단계**: 대경 직송 명세서 정밀 연동 ➔ 성적서 매칭(QC-12) ➔ 거래명세표 생성(GEN-01) ➔ 서류 패키지(GEN-03) 승인 대기
- **5단계**: 시화 재고 출고지시(LOG-11) ➔ 포장완료(LOG-12) ➔ MES Mock 연동(LOG-13) ➔ 시화 성적서 발행(QC-06)
- **6단계**: 실행 이력 DB화, 에이전트 오피스 지표 실데이터 계산, 미처리/지연 감시(EXE-11)
- **7단계**: 24시간 사무실 서버 이전 가이드, worker.js 분리, PM2 프로세스 매니저, 헬스체크
