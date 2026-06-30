# Task List: ALTF B2B 원툴 협업 포털 구축

- `[ ]` **Phase 0 — 버그 수정 및 기본 인프라**
  - `[ ]` DB 발주 상태 대문자 일괄 변환 마이그레이션 스크립트 작성 및 실행
  - `[ ]` `local-api-server.js` 발주 생성 시 `po_items` 추가 및 대문자 `status` 처리
  - `[ ]` 고객용 발주 응답 필터링 함수(`sanitizeOrderForCustomer`) 구현
  - `[ ]` 발주 생성 시 담당자 정보(`managerIds`) 동적 연결
  - `[ ]` 견적 생성 시 `customerInfo` 스냅샷 추가
  - `[ ]` `src/types/index.ts` 및 `document.ts` 신규 인터페이스(Certificate, Notification, ThreadMessage 등) 정의

- `[ ]` **Phase 1 — 실시간 알림 인프라 (SSE & Webhook)**
  - `[ ]` `local-api-server.js`에 `GET /api/sse` 엔드포인트 개설
  - `[ ]` 스마트 알림 엔진(`smartNotify`) 구현 및 인앱 알림 DB 수록
  - `[ ]` 기존 저장/수정 시점들에 `smartNotify()` 호출 연동
  - `[ ]` 프론트엔드 SSE 연동 및 `NotificationToast.tsx` 토스트 알림 컴포넌트 추가
  - `[ ]` 어드민 담당자 관리 페이지(`Managers.tsx`)에 Telegram Chat ID 필드 추가
  - `[ ]` n8n 텔레그램 연동 알림 라우터 워크플로우 정의

- `[ ]` **Phase 2 — 고객 공정 트래커**
  - `[ ]` `src/lib/processTracker.ts` 공정 변환 라이브러리 추가
  - `[ ]` `src/components/ui/OrderProcessTracker.tsx` 공정 단계 비주얼 스텝퍼 구현
  - `[ ]` `src/pages/admin/Pending.tsx` 담당자 코멘트에 `isVisibleToCustomer` 체크박스 연동
  - `[ ]` 공정 단계 변경 시 실시간 SSE 발송 연동

- `[ ]` **Phase 3 — 고객 포털 및 스레드 메신저**
  - `[ ]` `/my/dashboard` 홈 대시보드 페이지 추가
  - `[ ]` `/my/orders` 고객 발주 현황 목록/상세 화면 추가 (스텝퍼 컴포넌트 임베드)
  - `[ ]` `/my/documents` 서류함 페이지 및 `/my/notifications` 알림 센터 추가
  - `[ ]` 견적/발주 상세에 실시간 채팅 스레드 UI 패널 연동

- `[ ]` **Phase 4 — 서류 관리 및 이메일 자동 연동**
  - `[ ]` `/admin/certificates` 성적서 업로드 및 관리 어드민 페이지 추가
  - `[ ]` 성적서/거래명세표 발행 시 Resend API 활용 자동 이메일 발송
