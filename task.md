# Task List: ALTF CRM Flow Chart 대시보드 및 이벤트 시스템 구축

- `[x]` **CRM Flow Chart 대시보드 및 이벤트 시스템**
  - `[x]` `local-api-server.js`에 `crmEvents` 데이터 초기화, S3 저장 로직 추가
  - `[x]` `local-api-server.js`에 `GET /api/crm/events`, `POST /api/crm/events`, `DELETE /api/crm/events/:id` API 추가
  - `[x]` `src/pages/admin/Customers.tsx`에 `'FLOW_CHART'` 탭 추가 및 라우팅 추가
  - `[x]` `src/components/admin/FlowChartDashboard.tsx` 신규 컴포넌트 개발 (SVG 매출 추세 차트, 이벤트 등록 및 맵핑, 재고 매출 연동, 지역 및 신규/이탈 업체 분석 모듈 통합)
  - `[x]` 개발 완료 후 `npx tsc --noEmit` 및 `npx eslint .` 컴파일 및 정적 분석 정합성 검증 완료
