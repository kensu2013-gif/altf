# ALTF Office 자동화 개발 프롬프트 (Antigravity 적용용)

> 사용법
> 1. 각 단계의 프롬프트를 작업할 때마다 **[공통 컨텍스트]를 맨 앞에 붙여서** Antigravity에 전달합니다.
> 2. `[확인 필요]` 표시는 사장님(또는 담당자)이 작업 전에 결정하거나 외부에서 확인해야 하는 항목입니다. 확인 후 프롬프트의 해당 줄을 실제 값으로 바꿔 넣으세요.
> 3. 한 번에 한 단계씩 진행하고, 각 단계의 **완료 기준**을 직접 확인한 뒤 다음 단계로 넘어갑니다.

---

## 확정된 결정 사항 (2026-10-20)

| 항목 | 결정 |
|---|---|
| 고객·영업자 접수 플랫폼 | 카카오톡 채널(이미 존재, 챗봇 미구축) |
| 메일 | 회사 대표메일 사용(메일플러그) |
| MES | 출고번호·LOT API 개발 중 → 인터페이스를 먼저 만들고 개발 완료 후 연결 |
| 승인 권한 | 견적 승인 = 담당 영업자 / 주문 확정·서류 발송 승인 = 사무실 담당자 |
| 운영 형태 | 지금은 로컬 개발 → 완성 후 상시 가동 서버 컴퓨터에서 24시간 운영 |

## 작업 전에 결정해야 할 항목

| # | 항목 | 추천 |
|---|---|---|
| D1 | 사내 알림(창고·사무실)도 카카오로 보낼지 | 처음에는 **텔레그램 유지**(이미 동작함, 무료, 파일 전송 자유). 카카오는 고객·영업자 접수용으로 집중 |
| D2 | 업무 DB를 어디에 둘지 | **운영 웹(Render + S3) 하나만 원장으로 사용**하고, 사무실 서버는 API로만 읽고 쓰는 작업자 역할 |
| D3 | 카카오 웹훅을 받을 곳 | **Render(이미 HTTPS 공개 주소)** 에서 받고 대기열에 저장 → 사무실 서버가 가져가서 처리. 사무실 서버가 꺼져 있어도 메시지가 유실되지 않습니다 |
| D4 | 24시간 서버 OS | Mac mini(현재 사용 중)라면 성적서 PDF를 Chrome 변환으로 통일하고 양식 결과를 검증. Windows라면 Excel 변환 사용 가능하지만 로그인 세션 유지가 필요 |

---

## [공통 컨텍스트] — 모든 프롬프트 앞에 붙이기

```
너는 ALTF(스테인리스 배관 피팅 유통사)의 사내 자동화 시스템을 개발한다.
저장소: altf-kr-web-skeleton (React+Vite 프론트, Node 단일 서버 local-api-server.js, 운영은 Render + S3)

[업무 사실]
- 주문 라인은 3가지 공급 경로가 있고 한 주문 안에 섞여 들어온다.
  D(대경 직송): 매입발주서 → 대경 유선 회신(재고) → 대경이 고객에게 직배송 → 대경 거래명세표 수신 → 대경 성적서 메일 수신 → 다음날 고객에게 명세표+성적서 송부
  M(제작): D와 같으나 대경 회신이 '제작'이고 납기가 길다
  S(시화 재고): MES에 등록해 출고 → 과거 대경 LOT/HEAT 기준으로 성적서를 우리가 발행 → 거래명세표 발행
- 회사 표준 품목 표기는 웹 재고 키 형식이다. 예: 45E(L)-S10S-50A-STS304-W
  모든 외부 입력(고객 발주서, 대경 파일, MES)은 이 표기로 변환된 뒤에만 업무 로직에 들어간다.
- 승인 권한: 견적 발송 = 담당 영업자, 주문 확정·고객 서류 발송 = 사무실 담당자.

[절대 규칙]
1. 성적서 데이터(HEAT, LOT, 화학성분, 기계적 성질)는 절대 기본값·추정값으로 채우지 않는다. 찾지 못하면 발행을 중단하고 경보를 남긴다.
2. 업무 데이터(견적, 주문, 라인 상태)는 운영 원장 하나에만 쓴다. 서비스 코드가 data/db.json이나 엑셀 대장 파일을 직접 열어 덮어쓰는 방식은 새로 만들지 않는다. local-api-server.js의 updateDb()를 거치거나 그 위에 만든 API를 호출한다.
3. 고객·매입처로 나가는 모든 발송은 '발송 게이트' 하나를 통해서만 한다. 각 봇이 개별적으로 메일/카톡을 보내지 않는다.
4. 확신이 낮은 판단(품목 변환, 문서-주문 연결, 경로 판정)은 자동 확정하지 않고 사람 확인 대기열로 보낸다.
5. 코드에 특정 고객명, 발주번호, LOT 번호를 테스트용으로 하드코딩하지 않는다. 테스트 데이터는 별도 fixture 파일로 둔다.
6. 비밀값(메일 비밀번호, 카카오 키, 텔레그램 토큰)은 .env에만 두고 코드·JSON에 쓰지 않는다.
7. agents.json의 metrics/tasksToday 같은 표시값은 실제 처리 기록에서 계산한다. 고정값을 새로 넣지 않는다.

[작업 방식]
- 변경 전 관련 파일을 읽고 기존 스타일(주석 밀도, 이름 규칙)을 따른다.
- 끝나면 변경 파일 목록, 주요 로직, 직접 확인한 검증 결과(명령과 출력)를 보고한다. 검증하지 못한 부분은 그렇다고 명시한다.
```

---

## 0단계 — 기반 정비

### 0-A. 성적서 기본값 대체 제거 (최우선)

```
[목표] 성적서를 찾지 못했을 때 임의 값으로 발행되는 동작을 없애고, 누락을 경보로 바꾼다.

[현재 코드]
- server/services/certificateIssuer.js
  - findMasterCertData(lotNo, heatNo, poNo, description): LOT → PO+품명 → HEAT 순으로 server/data/certificates.json 검색
  - issueCertificatesForOutbound(): 매칭 실패 시 heatNo 'SD34285', lotNo 'JCQ4366', 화학성분 기본값(304: C 0.023, Ni 8.09 등), 고객 '(주)태양밴드', outboundNo 'A202610150' 등을 대신 채움 (약 1140~1200행)
  - issueCertificatesForPo()도 같은 패턴이 있는지 확인할 것

[할 일]
1. 두 발행 함수에서 성적서 데이터의 모든 기본값 대체를 제거한다.
2. 라인별로 매칭 결과를 MATCHED / NOT_FOUND / AMBIGUOUS(후보 2개 이상)로 분류한다.
3. 하나라도 NOT_FOUND 또는 AMBIGUOUS면 해당 출고 건 발행을 중단하고 { success:false, missingLines:[...] }를 반환한다. 부분 발행 옵션은 만들지 않는다.
4. 누락 내역을 server/data/qc_missing_alerts.json(또는 원장 API가 생기면 그쪽)에 기록하고 QC-13 성적서 누락 경보 로그를 남긴다.
5. 고객명, 출고번호가 없으면 예외를 던진다(기본값 금지).
6. findMasterCertData가 LOT 일치 항목이 여러 개일 때 첫 번째를 그냥 반환하는지 확인하고, 복수면 AMBIGUOUS로 처리한다.

[완료 기준]
- certificates.json에 없는 LOT로 출고 발행을 호출하면 PDF/엑셀이 생성되지 않고 missingLines가 반환된다.
- 존재하는 LOT로 호출하면 기존과 동일한 결과물이 생성된다(기존 발행본 1건과 값 비교).
- 코드 전체에서 'SD34285', 'JCQ4366' 검색 결과가 fixture 외에는 0건.
```

### 0-B. 단일 원장 원칙 — 봇의 파일 직접 쓰기 제거

```
[목표] 봇이 바꾼 상태가 운영 웹 주문관리에 그대로 보이게 한다.

[현재 문제]
- 운영 웹은 Render에서 DB를 메모리에 올리고 S3에 저장한다(s3-db.js, local-api-server.js의 updateDb/queueSave).
- 로컬은 AWS 키가 없어 data/db.json 복사본으로 동작한다.
- 아래 서비스들이 data/db.json을 fs로 직접 읽고 덮어쓴다 → 웹 서버 메모리와 어긋나고 다음 저장 시 덮어써진다.
  - server/services/daekyungInvoiceService.js (DB_JSON_PATH, syncPurchaseOrderBacklog)
  - server/services/purchaseBacklogBotService.js (fulfillOrder 등 DB_PATH)
  - server/services/purchaseService.js (확인 필요)
- 'altf.kr API 호출'이라고 로그에 쓰지만 실제로는 로컬 파일을 읽는다.

[할 일]
1. local-api-server.js에 에이전트 전용 API를 추가한다. 인증은 서비스 토큰(.env AGENT_SERVICE_TOKEN, Authorization: Bearer)으로 한다.
   - GET  /api/agent/orders?since=ISO&status=...
   - GET  /api/agent/orders/:id
   - PATCH /api/agent/orders/:id/lines/:lineId   (라인 상태·연결키만 변경 가능, 0-C 스키마)
   - POST /api/agent/orders/:id/events          (이력 추가)
   모든 쓰기는 updateDb()를 통해서만 한다.
2. 서비스들이 db를 직접 읽고 쓰는 부분을 '원장 클라이언트' 모듈(server/services/ledgerClient.js)로 교체한다.
   - 같은 프로세스 안에서 돌 때는 db 객체 접근 함수를 주입받고,
   - 별도 서버(사무실 서버)에서 돌 때는 AGENT_API_BASE_URL로 HTTP 호출한다.
3. 엑셀 대장(알트에프 재고 발주 대장.xlsx 등)은 원장에서 생성하는 '출력물'로만 취급한다(원장 → 엑셀). 엑셀을 읽어 원장을 바꾸는 흐름은 남기지 않는다.
4. 로그 문구의 'altf.kr API'는 실제 호출일 때만 쓴다.

[완료 기준]
- 로컬에서 대경 명세서 처리 후, 웹 주문관리 화면을 새로고침하면 해당 주문의 상태 변경이 보인다.
- grep으로 services 폴더에서 writeFileSync(.*db.json) 결과가 0건.
- 서비스 토큰 없이 /api/agent/* 호출 시 401.
```

### 0-C. 주문 라인 경로·상태·연결키 스키마

```
[목표] 한 주문 안에 섞인 시화/대경직송/제작 라인을 라인 단위로 추적한다.

[현재] src/types/index.ts의 Order, 주문 items에는 경로·라인 상태가 없다. 주문 상태는 COMPLETED/SHIPPED/CANCELLED뿐이다. splitDeliveries(매입처별 분할)가 일부 존재한다.

[할 일]
1. 주문 라인(items[])에 아래 필드를 추가한다(기존 데이터는 비어 있어도 동작해야 함).
   lineId: string                       // 주문 내 고유, 기존 item.id 재사용 가능
   route: 'S' | 'D' | 'M' | null        // 시화재고 / 대경직송 / 제작
   routeConfirmedBy?: { name, at }
   lineStatus: 'RECEIVED' | 'CONFIRMED' | 'ROUTED'
             | 'PICK_REQUESTED' | 'PACKED' | 'MES_SHIPPED'           // S 경로
             | 'SUPPLIER_PO_SENT' | 'SUPPLIER_CONFIRMED' | 'IN_PRODUCTION' | 'DIRECT_SHIPPED'  // D/M 경로
             | 'STATEMENT_READY' | 'CERT_READY' | 'PACKAGED' | 'SENT' | 'SETTLED'
   keys: {
     customerPoNo?, supplierPoNo?(ES...), supplierStatementNo?,
     mesOutboundNo?, lotNo?, heatNo?, certId?, shipmentId?
   }
   certRequired: boolean (기본 true, 운임/DC 등 비품목 라인은 false)
2. 주문에 events[] 이력 배열 추가: { at, actor('bot:QC-12' | 'user:이름'), type, lineIds, detail }
3. 출고 묶음(shipment) 개념 추가: 같은 고객·같은 날 출고된 라인 묶음. 거래명세표·성적서 패키지는 shipment 단위로 만든다.
   주문 하위 shipments[]: { shipmentId, lineIds, route, shippedAt, statementId?, packageStatus }
4. 상태 전이 규칙 함수(server/services/lineStateMachine.js)를 만든다. 허용되지 않은 전이는 거부하고 이유를 반환한다.
   주문 전체 종료 조건 = 모든 certRequired 라인이 SENT 이상.
5. 운임/DC/빈 품명 라인은 isNonProductLine=true, certRequired=false로 표시하는 판별 함수를 만든다.
6. 관리자 주문 상세(src/pages/admin/components/AdminOrderDetail.tsx)에 라인별 경로/상태 배지를 '읽기 전용'으로 표시한다(편집 UI는 3단계에서).

[완료 기준]
- 기존 주문 데이터를 불러와도 오류 없이 화면이 열린다.
- 상태 전이 함수 단위 테스트: 허용/거부 케이스 각 5개 이상 통과.
```

### 0-D. 발송 게이트와 승인 대기열

```
[목표] 고객·매입처로 나가는 모든 발송을 하나의 모듈과 하나의 승인 화면으로 모은다.

[할 일]
1. server/services/dispatchGate.js
   - enqueue({ channel: 'EMAIL'|'FAX'|'KAKAO_LINK'|'TELEGRAM_INTERNAL', to, subject, body, attachments[], orderId, shipmentId, kind: 'QUOTE'|'SUPPLIER_PO'|'DOC_PACKAGE'|'CERT_REQUEST'|'NOTICE', approverRole: 'SALES'|'OFFICE'|null })
   - approverRole이 있으면 상태 PENDING_APPROVAL, 없으면 바로 발송(사내 알림만 해당)
   - approve(id, user) / reject(id, user, reason)
   - 발송 결과(성공/실패/재시도 횟수)를 기록하고 주문 events에 남긴다.
   - 같은 shipment의 DOC_PACKAGE가 이미 SENT면 중복 발송을 막는다.
2. 메일 발송: 회사 대표메일(메일플러그 SMTP). 
   [확인 필요] 메일플러그 SMTP 호스트/포트/인증 방식 → .env MAIL_SMTP_HOST, MAIL_SMTP_PORT, MAIL_USER, MAIL_PASS
   - 발신 주소는 대표메일, 회신 주소(Reply-To)는 담당 영업자 메일
   - 보낸 메일 사본을 보낸편지함에 남기는지 확인(IMAP APPEND 필요 여부)
3. 팩스: 이번 단계에서는 어댑터 인터페이스만 만들고 'NOT_CONFIGURED'로 대기시킨다.
4. 카카오: 이번 단계에서는 인터페이스만. 실제 연결은 1·2단계.
5. 텔레그램 사내 알림: 기존 telegramBotService.sendMessage 재사용.
6. 관리자 화면에 '승인 대기함' 페이지 추가: 역할별 필터(영업자는 자기 담당 견적만, 사무실 담당자는 주문·서류). 첨부 미리보기, 승인/반려 버튼.

[완료 기준]
- 테스트 수신 주소로 첨부 PDF 메일이 실제 발송된다.
- 승인 전에는 발송되지 않고, 승인 후 1회만 발송된다(두 번 승인 눌러도 1회).
- 발송 실패 시 대기함에 실패 사유가 보인다.
```

---

## 1단계 — 접수 창구 하나로 모으기 (카카오 채널 + 대표메일)

### 1-A. 접수함과 카카오 채널 챗봇 수신

```
[목표] 카카오톡 채널과 대표메일로 들어온 모든 요청을 '접수함' 하나에 모은다.

[구조]
- 카카오 웹훅은 Render(운영 서버, HTTPS 공개 주소)에서 받는다. 받은 즉시 접수함에 저장하고 짧은 응답("접수되었습니다, 담당자가 확인 후 회신드립니다")을 반환한다.
- 실제 판독·처리는 사무실 서버 작업자가 접수함을 가져가서 한다(서버가 꺼져 있어도 유실 없음).

[할 일]
1. 원장에 intake(접수함) 컬렉션 추가:
   { intakeId, receivedAt, channel: 'KAKAO'|'EMAIL'|'FAX'|'MANUAL', sender: { kakaoUserKey?, email?, phone?, name? },
     forwardedBy?: 영업자(영업자가 대신 전달한 경우), text, attachments[{ fileName, mime, storageKey }],
     status: 'NEW'|'CLASSIFIED'|'LINKED'|'NEEDS_HUMAN'|'DONE', docType?, customerId?, assignedSalesId?, linkedQuoteId?, linkedOrderId? }
2. POST /api/intake/kakao : 카카오 i 오픈빌더 스킬 요청을 받는 엔드포인트
   [확인 필요] 오픈빌더에서 봇 생성 후 기존 채널과 연결, 스킬 서버 URL 등록
   [확인 필요] 스킬 응답 제한 시간(약 5초) — 저장만 하고 즉시 응답할 것. 처리 결과를 같은 대화로 늦게 보내려면 '콜백' 기능 사용 신청이 필요한지 확인
   [확인 필요] 사용자가 보낸 사진/파일을 챗봇이 받을 수 있는 방식(이미지 전송 플러그인 등)과 파일(엑셀/PDF) 수신 가능 여부. 파일을 못 받으면 "대표메일로 보내주세요" 안내 + 메일 접수로 흡수
   - 요청 서명/검증 방법을 확인해 위조 요청을 막는다.
3. 영업자 등록: 영업자가 카카오 채널에서 '영업자 인증'(사번/전화번호 + 관리자 승인)을 하면 kakaoUserKey ↔ 영업자 매핑을 저장한다.
   영업자가 고객에게 받은 파일을 채널로 보내면 forwardedBy=영업자로 접수되고, 메시지에 고객명/요율을 적을 수 있다. 예: "태형산업 52%" / "태형산업 최근요율"
4. 대표메일 수신: server/services/mailplugCollector.js는 현재 '대경벤드성적서' 메일함과 특정 발신자만 읽는다.
   - 대표메일 INBOX 전체를 읽는 수집기로 일반화한다(메일함·발신자 필터는 설정값으로).
   - 대경 성적서 메일은 기존 처리로 계속 보내고, 그 외 메일은 intake로 저장한다.
   - 이미 처리한 메일 UID는 기존 synced_mail_uids.json 방식처럼 중복 방지.
5. 관리자 '접수함' 화면: 채널 아이콘, 받은 시각, 고객, 담당자, 문서종류, 상태, 첨부 미리보기.

[완료 기준]
- 카카오 채널에서 테스트 메시지·사진을 보내면 접수함에 1건씩 생긴다.
- 대표메일로 엑셀 첨부 메일을 보내면 접수함에 생기고, 대경 성적서 메일은 기존 성적서 수집으로 처리된다.
```

### 1-B. 문서 분류·판독·표준화

```
[목표] 접수된 사진/엑셀/PDF를 '표준 품목 라인'으로 바꾼다.

[현재]
- 웹 사진 판독은 Make 시나리오로 보내 결과를 받는다(src/services/orderService.ts, src/pages/Search.tsx 등에서 호출).
- 표준화(유사도) 로직이 있다: data-similarity-engine, scripts/verify_and_backup_similarity.js, computeDocumentSimilaritySummary.
- 재고/단가 데이터는 Google Apps Script가 가공한 inventory.json(/api/inventory/inventory.json).

[할 일]
1. docType 분류: QUOTE_REQUEST / CUSTOMER_PO / SUPPLIER_STATEMENT / CERTIFICATE / INQUIRY / CLAIM / OTHER
   - 1차: 규칙(메일 제목·파일명·발신자·키워드), 2차: 판독 결과 기반. 확신 낮으면 NEEDS_HUMAN.
2. 판독기 어댑터(server/services/docReader/):
   - excelReader: 시트에서 품명/규격/재질/수량/단가 열 자동 탐지
   - pdfReader: 텍스트 PDF는 pdf-parse, 스캔 PDF·사진은 기존 Make 판독 경로를 서버에서 호출하는 어댑터로 재사용
   [확인 필요] Make 시나리오의 웹훅 URL과 응답 형식. 서버에서 호출해도 되는지(호출량/요금)
   - 결과 형식은 하나로 통일: rawLines[{ rawText, name?, size?, thickness?, material?, qty?, unitPrice?, unit? }]
3. 표준화 서비스(server/services/itemNormalizer.js):
   - 입력: rawLine → 출력: { standardKey, confidence, candidates[3] }
   - 기존 유사도 엔진 규칙을 재사용하고 새 규칙을 만들지 않는다.
   - confidence 기준 미만이면 라인을 NEEDS_HUMAN으로 표시(자동 확정 금지).
   - 사람이 고친 결과(rawText → standardKey)를 학습 사전으로 저장해 다음부터 자동 적용.
4. 웹과 봇이 같은 표준화 서비스를 쓰도록 한다(웹 사진 판독 후 정규화도 이 서비스를 호출).

[완료 기준]
- 과거 실제 고객 발주서 엑셀 5개, PDF 5개, 사진 5개로 테스트: 라인 추출률과 표준화 정확도를 표로 보고.
- 확신 낮은 라인은 반드시 사람 확인으로 분류된다.
```

### 1-C. 담당 배정, 영업자 비서, 견적 초안 자동 등록

```
[목표] 접수된 견적요청이 담당 영업자에게 바로 전달되고, 웹 뒷단에 견적 초안이 자동으로 생성되게 한다.
(지금 사무실이 '앞단에서 고객인 척 견적 문의를 입력'하는 일을 없앤다.)

[할 일]
1. 거래처 식별: 발신 이메일 도메인, 카카오 사용자, 영업자가 적은 고객명 → 거래처 마스터(db.customers, 1,265건)와 매칭.
   - 이름 비교 시 공백·(주)·주식회사·㈜ 제거 후 비교. 사업자번호가 있으면 최우선.
   - 확신 낮으면 NEEDS_HUMAN.
2. 담당 배정: 거래처 마스터의 담당 영업자. 없으면 forwardedBy 영업자, 그것도 없으면 사무실 대기.
3. 요율 결정(SLE-07 요율 관리):
   - 영업자가 요율을 적었으면 그 값
   - '최근요율'이면 해당 거래처의 최근 견적/주문에서 품목군(품명+재질) 별 최근 할인율
   - 없으면 거래처 등급 기본 요율, 그것도 없으면 비워두고 영업자에게 질문
   [확인 필요] 기존 웹 견적에서 요율이 저장되는 필드(items[].discountRate / userUnitPrice / base_price)와 단가 계산식을 그대로 재사용할 것. 새 계산식을 만들지 말 것.
4. 견적 초안 생성: 기존 POST /api/my/quotations와 같은 구조로 db.quotations에 저장한다.
   - source: 'KAKAO' | 'EMAIL' | 'FAX', intakeId 연결, status: 'DRAFT_BY_BOT'
   - 각 라인에 재고 상태(시화 재고/대경 재고/없음)와 납기 제안(EST-02) 표시
5. 영업자 알림: 카카오(또는 결정 D1에 따라 텔레그램)로 "태형산업 견적 초안 12품목, 요율 52%, 확인하기 링크" 전송.

[완료 기준]
- 영업자가 카카오 채널에 고객 발주서 사진 + "태형산업 52%"를 보내면, 웹 관리자 견적 목록에 초안이 생기고 영업자에게 알림이 온다.
```

---

## 2단계 — 견적 회신 자동화

```
[목표] 견적 답변 후 '앞단으로 돌아가 각 채널로 견적서를 다시 보내는' 일을 없앤다.

[할 일]
1. 견적 상세(관리자 뒷단)에서 영업자가 '승인' → 기존 견적서 PDF 생성(est-quote-doc) → dispatchGate.enqueue(kind:'QUOTE', approverRole:null(이미 승인됨))
2. 회신 채널은 원래 접수 채널을 따른다:
   - EMAIL: 원래 메일에 회신(In-Reply-To 헤더 유지), PDF 첨부
   - KAKAO: 견적 확인 링크 전송
     [확인 필요] 같은 대화방 회신(챗봇 콜백) vs 알림톡(템플릿 승인, 비즈메시지 발송 대행사 계약 필요). 알림톡은 파일 첨부가 안 되므로 '웹 견적 보기/주문하기' 링크 버튼으로 전달
   - FAX: 4단계 이후
3. 견적 보기 링크: 로그인 없이 볼 수 있는 일회성 토큰 링크(만료 기간 설정). 페이지에 'PDF 다운로드'와 '이 견적으로 주문하기' 버튼 → 고객이 웹으로 자연스럽게 유입.
4. 견적 상태 SENT, 발송 시각 기록 → 견적 응답 시간(접수→발송) 계산 가능.
5. SLE-08 팔로업: 발송 후 D+2, D+7 미주문 건을 담당 영업자에게 알림(고객에게 자동 발송하지 않음).

[완료 기준]
- 메일로 들어온 견적요청에 승인 1번으로 원래 메일 스레드에 PDF 회신이 간다.
- 같은 견적을 두 번 승인해도 한 번만 발송된다.
```

---

## 3단계 — 발주서 접수, 경로 분할, 매입발주

```
[목표] 고객 발주서가 들어오면 주문 등록 초안 → 사무실 확정 → 라인별 경로 분할 → 매입발주까지 이어지게 한다.

[할 일]
1. PUR-11 발주서 등록봇: docType=CUSTOMER_PO인 접수 건 → 1-B 판독/표준화 → 주문 초안(status:'DRAFT_BY_BOT')
   - 고객 PO 번호를 keys.customerPoNo에 저장
2. PUR-12 대조: 같은 거래처의 최근 30일 견적과 비교. 품목·수량·단가 차이를 라인별로 표시. 견적이 없으면 최근 요율과 비교만 표시.
   - 연결되면 order.linkedQuoteId 기록(현재 2,439건 중 3건만 연결되어 있음)
3. PUR-13 경로 제안: 라인별로
   - 시화 재고 충분 → S, 대경 재고 있음 → D, 둘 다 없음 → M
   - 제안만 하고 사무실 담당자가 확정(routeConfirmedBy 기록). 한 주문에 S/D/M 혼합 가능.
4. 사무실 담당자 '주문 확정' 화면: 초안 + 대조 결과 + 경로 제안을 한 화면에서 수정·확정. 확정 시 lineStatus CONFIRMED→ROUTED.
5. 확정 후 자동 실행:
   - S 라인 → 5단계 출고지시(이 단계에서는 이벤트만 기록)
   - D/M 라인 → 기존 매입발주서 생성 로직(PilotSplitPO / splitDeliveries 흐름)을 사용해 매입처별 발주서 생성 → dispatchGate(kind:'SUPPLIER_PO', approverRole:'OFFICE')
6. PUR-14 대경 회신 기록: 대경과 통화 후 담당자가 카카오/텔레그램으로 한 줄 입력
   예: "ES261020-3011 재고 내일직송" / "ES261020-3011 3번라인 제작 11/05"
   → 해당 라인 SUPPLIER_CONFIRMED 또는 IN_PRODUCTION + 예정일 기록. 해석 불가하면 되물음.
7. 웹 사진 판독으로 '견적인 척 → 주문인 척' 등록하던 우회 흐름은, 이 화면에서 '주문 초안 직접 생성'으로 대체한다.

[완료 기준]
- 실제 과거 발주서(대경+시화 혼합) 1건으로: 초안 생성 → 경로 확정 → 대경 매입발주서 승인 대기 → 승인 후 발송까지 확인.
```

---

## 4단계 — 대경 직송·제작 서류 체인 (D/M 경로)

```
[목표] 대경 거래명세표와 성적서가 들어오면 버튼 없이 고객 서류 패키지가 완성되어 사무실 승인 대기함에 올라오게 한다.

[현재 코드]
- server/services/daekyungInvoiceService.js: 명세서 파싱 → 매입 기록 → 발주 대장 엑셀 갱신 → 성적서 존재 확인. 
  주문 매칭이 PO 번호 뒤 4자리 비교(ord.poNumber.endsWith(p.slice(-4)))로 되어 있음 → 오매칭 위험.
- telegramBotService.js: 명세서 PDF 수신. 텍스트 명령에 '2918', '동양' 하드코딩.
- mailplugCollector.js / certificateParser.js: 대경 성적서 수집·판독 → certificates.json
- gen-statement-dispatcher / pur-split-balancer: 번들링 로직 일부

[할 일]
1. 대경 명세서 수신 경로를 텔레그램 + 대표메일 + (카카오) 모두로 확장(접수함 docType=SUPPLIER_STATEMENT).
2. 주문 연결 규칙 교체: 전체 매입발주번호(ES...) 일치 + 품목 표준키 + 수량으로 라인 매칭. 하나라도 불일치하면 NEEDS_HUMAN.
3. 매칭된 라인 → DIRECT_SHIPPED, keys.supplierStatementNo 기록, shipment 생성(같은 명세서 = 같은 shipment).
4. QC-12 성적서 매칭: 해당 라인의 supplierPoNo + 품명 + 규격으로 certificates.json에서 HEAT/LOT 확정 → CERT_READY.
   - 성적서가 아직 없으면 대기. 명세서 수신 후 [설정값: 24시간] 지나도 없으면 QC-13이 대경 담당자에게 보낼 '성적서 요청 메일' 초안을 발송 게이트(approverRole:'OFFICE')에 올리고 사무실에 경보.
5. GEN-01 매출 거래명세표: shipment 단위로 자동 생성 → STATEMENT_READY.
6. GEN-03 패키지: shipment의 모든 certRequired 라인이 CERT_READY이고 명세표가 준비되면 → PACKAGED → dispatchGate(kind:'DOC_PACKAGE', approverRole:'OFFICE', 수신자: 거래처 서류 수신 메일/팩스)
   - 발송 예정 시각 기본값: 직송 다음날 오전 [확인 필요: 시각]
7. 텔레그램 하드코딩(2918/동양) 제거, 명령은 일반화("ES261020-3011 상태").

[완료 기준]
- 과거 대경 명세서 PDF + 해당 성적서 PDF를 넣으면, 사람 조작 없이 승인 대기함에 '명세표+성적서' 패키지 1건이 생긴다.
- 성적서 1건을 빼고 넣으면 패키지가 생기지 않고 누락 경보와 요청 메일 초안이 생긴다.
```

---

## 5단계 — 시화 재고 출고와 MES 연동 (S 경로)

```
[목표] 시화 라인이 확정되면 창고가 바로 알고, 포장·MES 출고 후 성적서와 명세표가 자동으로 준비되게 한다.

[MES 상태] 출고번호·LOT API는 개발 중이다. 이번 단계는 인터페이스와 모의(mock) 구현으로 먼저 완성하고, API가 나오면 어댑터만 교체한다.

[할 일]
1. LOG-11 출고지시: S 라인 ROUTED → 창고 담당자에게 알림(결정 D1 채널)
   내용: 주문번호, 고객, 품목(표준 표기), 수량, 랙 위치(mat-location-tracker 데이터가 있으면), 출고 예정일
   → PICK_REQUESTED
2. LOG-12 포장 완료: 창고 담당자가 "완료" 버튼 또는 사진 회신 → PACKED (부분 포장 시 라인별)
3. MES 어댑터(server/services/mesAdapter.js):
   interface: getOutbounds(since) → [{ mesOutboundNo, outboundDate, customer, lines:[{ itemCode, qty, vendorLot, altfLotNo, heatNo? }] }]
   - mock 구현: fixture JSON 파일
   [확인 필요] MES API 개발사에 요청할 응답 필드: 출고번호, 출고일, 거래처(사업자번호 포함), 품목코드(가능하면 표준 표기 또는 매핑 가능한 코드), 수량, 대경 LOT, 알트에프 LOT, HEAT
4. LOG-13 MES 출고 연동: MES 출고 건을 원장 S 라인과 매칭(거래처 + 품목 + 수량 + 날짜) → MES_SHIPPED, keys.mesOutboundNo/lotNo 기록. 불확실하면 NEEDS_HUMAN.
5. QC-06 시화 성적서: 0-A에서 고친 issueCertificatesForOutbound로 LOT 기반 발행 → CERT_READY. 찾지 못하면 중단·경보(대체 없음).
6. 이후 명세표·패키지·발송은 4단계와 동일(shipment 단위).

[완료 기준]
- mock MES 데이터로 S 라인 3개 주문을 처리: 출고지시 알림 → 포장완료 → MES 매칭 → 성적서 발행 → 패키지 승인 대기까지 사람 입력은 '포장 완료' 1번.
- LOT가 마스터에 없는 라인이 섞이면 해당 shipment는 패키지가 생기지 않고 경보가 뜬다.
```

---

## 6단계 — 흐름 감시와 에이전트 오피스 실데이터화

```
[목표] 멈춘 일을 매일 알려주고, 에이전트 오피스 화면이 실제 처리 기록을 보여주게 한다.

[현재] server/data/agents.json의 metrics/tasksToday는 고정값이다. 82개 봇 중 실제 구현 9개. agents/agent-daemon.js는 존재하지 않는 파일(agent2-extractor.js, agent3-generator.js)을 import해서 실행되지 않는다.

[할 일]
1. 봇 실행 기록 테이블: { botId, startedAt, endedAt, result: OK|HANDED_TO_HUMAN|ERROR, orderId?, intakeId? }
   agents 화면의 지표는 이 기록에서 계산(오늘 처리 수, 사람 이관 수, 오류 수, 평균 처리 시간).
2. 구현되지 않은 봇은 화면에서 '미구현' 상태로 구분 표시.
3. agent-daemon.js: 실제로 쓰지 않으면 제거하거나, 사무실 서버 작업자 프로세스(아래 7단계)로 대체.
4. EXE-11 흐름 감시(매일 08:00, 14:00):
   - 접수 후 2시간 미배정 / 견적 초안 후 4시간 미승인
   - 주문 확정 후 매입발주 미발송 / 매입발주 후 1영업일 대경 회신 미입력
   - 직송 후 24시간 성적서 없음 / 패키지 승인 대기 1영업일 초과
   - 출고지시 후 당일 포장완료 없음 / 포장완료 후 MES 출고 없음
   → 담당자별로 묶어서 알림, 대표에게 요약.
5. 일일 브리핑(EXE-01)에 '사람 이관 비율' 포함 → 자동화 수준을 측정하는 핵심 지표.

[완료 기준]
- 일부러 멈춘 테스트 주문 3건이 감시 보고에 정확히 잡힌다.
- agents 화면의 숫자가 실행 기록과 일치한다.
```

---

## 7단계 — 24시간 사무실 서버 이전

```
[목표] 상시 가동 서버 컴퓨터에서 접수·처리 작업자를 24시간 운영한다.

[구조]
- 운영 웹 + 원장 DB + 카카오 웹훅 수신: Render + S3 (현재 그대로)
- 사무실 서버: 작업자(worker) 프로세스. 접수함 처리, 메일 수집, 텔레그램, 판독, 성적서 발행, MES 연동, 발송 게이트 실행.
  원장은 /api/agent/* 로만 읽고 쓴다(0-B).

[할 일]
1. 작업자 진입점 분리: worker.js (local-api-server.js의 스케줄러·봇 부분을 떼어냄). 웹 서버와 동시에 같은 작업이 두 번 돌지 않도록 RUN_WORKERS 환경변수로 제어.
2. 작업 중복 실행 방지: 접수함/발송 대기열 항목을 가져갈 때 '잠금(lease)' 필드 사용.
3. pm2 설정 파일(ecosystem.config.cjs): worker, (필요시) 로컬 관리 화면. 자동 재시작, 로그 회전.
4. 헬스체크: 작업자가 5분마다 Render에 heartbeat → 15분 이상 끊기면 대표 텔레그램/카카오로 경보(Render 쪽에서 감지).
5. 파일 저장: 성적서·명세표·수신 원본은 S3에 저장하고 로컬은 캐시로만 사용.
6. 성적서 PDF 엔진 통일:
   [확인 필요 D4] Mac이면 Chrome 헤드리스 변환으로 통일하고 기존 Excel 변환본과 시각 비교(직인·도장 이미지 포함). Windows면 Excel 변환 유지 가능하나 로그인 세션 필요.
7. 운영 체크리스트 문서(docs/agent-office/SERVER_RUNBOOK.md) 작성: 설치, .env 목록(값 제외), 재시작, 백업 복구, 장애 시 수동 전환 방법.

[완료 기준]
- 서버 전원을 껐다 켜면 사람 조작 없이 작업자가 다시 올라오고, 꺼져 있던 동안 들어온 카카오/메일 접수가 처리된다.
- 작업자를 강제 종료하면 15분 안에 경보가 온다.
```
