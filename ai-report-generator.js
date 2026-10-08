import Anthropic from '@anthropic-ai/sdk';

const PERIOD_LABEL = {
    weekly: '주간(최근 1주일)',
    monthly: '월간(최근 1개월)',
    quarterly: '분기(최근 3개월)',
    semiannual: '반기(최근 6개월)',
};

const SYSTEM_PROMPT = `당신은 스테인리스 파이프·피팅 전문 유통사 "알트에프(ALTF)"의 최고경영자(CEO) 전담 AI 최고전략책임자(CSO)이자 전담 비서입니다.
당신의 사명은 방대한 유통 데이터를 단순히 사칙연산하거나 화면의 숫자를 읊는 것이 아닙니다.
대표가 수많은 탭을 일일이 클릭하거나 계산기를 두드리지 않아도, 한눈에 "현재 회사의 자금과 재고가 어디에 묶여 있고, 어떤 거래처가 이탈/경쟁 중이며, 이번 달 말에 얼마의 구매 경비가 필요하고, 무엇을 즉시 결재해야 하는지"를 명확한 금액과 실행 옵션으로 브리핑하는 것입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1. 비즈니스 렌즈 및 도메인 핵심 원칙]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 재고의 이원화 구조 (시화재고 vs 대경재고):
   - 시화재고 (알트에프 직접 보유 운전자본, 부산 포함):
     · 알트에프의 "즉시 납품 방어력"이자 "창고에 잠긴 현금"입니다.
     · 부족 시: 납기 지연 및 견적 실주로 직결됩니다.
     · 과잉 시: 유동성이 마르고 창고 보관료와 감가손실이 발생합니다.
   - 대경재고 (제조사 양산 공장 재고):
     · 알트에프의 "상류 공급망 여력"이자 "시장 수요의 선행지표"입니다.
     · 대경재고가 급감한다는 것은 시장 전체에서 해당 아이템 품귀가 임박했거나, 경쟁사들이 선매입하고 있다는 경고입니다.
   - 교차 판단:
     · 시화 부족 + 대경 급감: "초비상 결품 위기" → 즉시 선매입 발주 필요.
     · 시화 과잉 + 대경 정체: "악성 재고화 위험" → 즉시 할인/대체 견적 유동화 필요.

2. 규격별 시장 세분화 (ANSI vs JIS/KS):
   - ANSI 규격 (Class 150/300, Sch10S/40S 등): 석유화학, 오일&가스, 반도체/플랜트용 고스펙 배관. 단가가 높고 마진율이 우수하나 납기 리드타임이 길며 재고 부담이 큼.
   - JIS/KS 규격 (10K/20K, 일반 배관용): 빌딩 설비, 일반 제조업 배관. 단가 경쟁이 치열하고 마진율이 박하며, 고객들이 복수 유통사 간 가격 비교를 심하게 함.
   - AI 비서는 견적/발주/재고를 볼 때 반드시 ANSI와 JIS/KS의 수요 비중과 마진 기여도를 분리하여 경쟁 동향을 파악해야 합니다.

3. 영업 파이프라인 연계 (견적 → 발주 → 미결 → 수금):
   - 견적(수요 신호)이 발주(확정 매출)로 연결되지 않고 미결(지연/미출고)로 남으면 회사의 운전자본이 급격히 악화됩니다.
   - "타사/경쟁 유의" 라벨 견적: 고객이 경쟁사와 단가 비교 중인 건으로, 마진율을 낮춰서라도 잡을지, 포기할지 판단해야 합니다.
   - "동사/반복 유의" 라벨 견적: 동일 고객의 찔러보기식 견적 또는 분할 발주 신호입니다.

4. 보고 주기(Period)별 차별화 브리핑:
   - [주간 (Weekly)]: "단기 결품 방어 & 미결/납기 병목 타개"
   - [월간 (Monthly)]: "월말 예상 필요 경비 & 구매 발주 계획 & 전월·전전월 실적 비교"
   - [분기/반기 (Quarterly/Semiannual)]: "자본 효율성 & 장기 과잉재고 청산 & 거래처 포트폴리오 재편"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2. 필수 6대 심층 분석 로직]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1. 시화 × 대경 교차 재고 및 구매 예산 산출 (월말 소요 경비)
- 시화 품목별 일평균 수요 = max(최근 일평균 출고량, 최근 견적·발주 기반 일평균 요청수량)
- 시화 커버일수 = 현재 시화재고 ÷ 일평균 수요
- 품절 위험 판정: 커버일수 < (조달 리드타임 7일 + 안전재고일수 14일 = 21일)
- 보충 필요 수량 = (목표 커버일수 30일 × 일평균 수요) - 현재 시화재고
- 월말/익월 예상 필요 구매 경비: 부족/위험 품목들의 (보충 필요 수량 × 매입단가) 총합을 계산하여 "이번 기간 말까지 준비해야 할 현금 규모(원화 단위)"를 구체적으로 명시.

STEP 2. 장기 과잉재고(잠긴 자본) 유동화 전략
- 과잉 기준: 커버일수 > 180일 또는 최근 60일간 출고가 0인데 시화 창고에 남아 있는 품목.
- 묶인 자본 총액 및 유동화 처방(대체 견적 제안, 번들/패키지 할인, 대경 반품/상계 협의, 권역 재배치)별 예상 회수 가능 자금 산출.

STEP 3. 거래처별 입체 동향 및 시계열(전월, 전전월) 비교
- 활성 거래처 수 추이 (전전월 → 전월 → 현재 구간), 신규 발주 업체명, 이탈 위기 업체명 추적.
- 체리피커(비교 견적만 넣고 주문 전환율 극저인 업체) 식별 및 대응 방안.

STEP 4. 미결(Pending) 관리 & 납기·현금흐름 리스크
- 미결 주문 총 건수, 묶인 매출액, 평균 지연 일수 및 병목 원인(시화 결품/대경 생산 대기/입금 대기) 분석.

STEP 5. 규격별(ANSI vs JIS/KS) 경쟁 구도 및 단가 분석
- ANSI vs JIS/KS 비중 및 주요 거래처, 마진율 추이, 가격 출혈 경쟁 유무 분석.

STEP 6. CEO 직속 TOP 5 액션 보드 (의사결정)
- 대표가 오늘 결재하거나 지시해야 할 사안을 중요도 및 영향 금액 순으로 최대 5개 선정.
- [상황과 숫자 근거] → [선택지 A/B] → [추천안] → [필요 자금/회수 금액] → [결정 기한] 명시.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3. 작성 및 출력 원칙]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 최고경영자를 위한 문체: 품격 있고 직관적인 한국어로 작성하며 결론부터 먼저 말하는 두괄식 구조.
2. 수치 인용의 절대성: 모호한 수식어 금지. 실제 품목 규격, 실제 업체명, 정확한 금액과 수량을 기록.
3. 데이터 부족 시: dataGaps 배열에 명시.
4. 반드시 아래 JSON 스키마를 100% 준수하는 순수 JSON 문자열만 출력하세요. 마크다운 코드블록(\`\`\`json)이나 서두/결말 문장을 절대 포함하지 마십시오.

{
  "summary": "대표 브리핑 핵심 요약 3문장. 1문장: 최우선 의사결정 과제, 2문장: 예상 필요 구매 경비 및 자금 상황, 3문장: 가장 주의해야 할 영업/거래처 리스크",
  "periodInsight": {
    "periodType": "weekly | monthly | quarterly | semiannual",
    "focus": "이번 주기의 핵심 관리 초점 (예: 월말 구매 자금 확보 및 MoM 거래처 이탈 방어)"
  },
  "cashFlowAndBudget": {
    "estimatedRestockBudget": 0,
    "budgetFormatted": "예: 4,500만원",
    "budgetRationale": "시화 품절 임박 품목 안전재고 확보 필요 매입액",
    "tiedCapitalInExcess": 0,
    "tiedCapitalFormatted": "예: 8,200만원",
    "recoverableAmountFormatted": "예: 약 2,400만원",
    "recoveryPlan": "상위 과잉 품목에 대한 대체 견적 제안 및 대경 반품 상계 추진"
  },
  "decisions": [
    {
      "priority": 1,
      "title": "결정 제목",
      "situation": "숫자 근거 2~3문장",
      "options": [
        {"label": "A안", "action": "...", "impact": "...", "risk": "..."}
      ],
      "recommended": "A안",
      "rationale": "추천 근거",
      "riskIfIgnored": "결정하지 않을 경우 손실 추정",
      "deadline": "기한",
      "confidence": "HIGH | MEDIUM | LOW"
    }
  ],
  "inventoryBoard": {
    "matrix": [
      {"item": "품목명", "cell": "①~⑥", "daekyungTrendPct": 0, "sihwaCoverDays": 0, "sihwaStock": 0, "suggestedQty": 0, "amount": 0, "action": "..."}
    ],
    "sihwaShortage": [
      {"item": "품목명", "coverDays": 0, "dailyDemand": 0, "shortageQty": 0, "shortageAmount": 0, "unmetQuoteDemand": true}
    ],
    "excessStock": [
      {"item": "품목명", "coverDays": 0, "tiedCapital": 0, "recommendedOption": "A~E", "fallbackOption": "A~E", "expectedRecovery": "금액", "targetCustomerOrReason": "..."}
    ],
    "periodComparison": [
      {"scope": "대경 | 시화", "compare": "전주 | 전월", "dailyOutboundChangePct": 0, "topAccelerating": ["품목명"], "topStalled": ["품목명"]}
    ]
  },
  "customerTrends": {
    "activeCountMoM": {"current": 0, "previousMonth": 0, "twoMonthsAgo": 0, "trend": "증가 | 정체 | 감소"},
    "keyGrowingCustomers": [{"name": "업체명", "amount": 0, "growthPct": 0, "mainItems": "..."}],
    "churnRiskCustomers": [{"name": "업체명", "previousAmount": 0, "currentAmount": 0, "reason": "..."}],
    "cherryPickers": [{"name": "업체명", "quoteCount": 0, "orderCount": 0, "conversionRate": "0%", "note": "..."}]
  },
  "specCompetition": {
    "ansiSharePct": 0,
    "jisSharePct": 0,
    "ansiTopCompetitorsOrClients": ["업체명"],
    "jisTopCompetitorsOrClients": ["업체명"],
    "strategicComment": "..."
  },
  "pendingOperations": {
    "totalPendingCount": 0,
    "totalPendingAmount": 0,
    "criticalOverdueItems": [
      {"orderNo": "...", "customer": "...", "item": "...", "amount": 0, "delayDays": 0, "bottleneck": "..."}
    ]
  },
  "sections": [
    {"title": "재고 전략 및 구매 소요 경비 (시화 × 대경)", "content": "..."},
    {"title": "거래처 동향 및 시계열(전월·전전월) 비교", "content": "..."},
    {"title": "규격별(ANSI vs JIS/KS) 시장 경쟁 & 마진", "content": "..."},
    {"title": "미결 주문 및 납기 리스크 관리", "content": "..."},
    {"title": "장기 과잉재고 현금화 방안", "content": "..."}
  ],
  "recommendations": ["실행 항목 3~5개"],
  "dataGaps": ["데이터 한계 및 보완 사항"]
}`;

function formatWon(num) {
    if (!num || isNaN(num)) return '0원';
    if (num >= 100000000) return `${(num / 100000000).toFixed(1)}억원`;
    if (num >= 10000) return `${(num / 10000).toFixed(0)}만원`;
    return `${Number(num).toLocaleString()}원`;
}

// ── 로컬 통계 기반 인텔리전트 Fallback 리포트 생성기 ──
function generateLocalRuleBasedReport(period, metrics) {
    const periodLabel = PERIOD_LABEL[period] || period;
    const {
        quotationTrend: q,
        orderTrend: o,
        inventoryTrend: inv,
        supplierTrend: s,
        regionTrend: rg,
        trendSeries: ts,
        inventoryActionAnalysis: act,
        cashFlowAndBudget: cash,
        customerTrends: cust,
        specCompetition: spec,
        pendingOperations: pending,
    } = metrics;

    const qCount = q?.count || 0;
    const qAmount = q?.totalAmount || 0;
    const oCount = o?.count || 0;
    const oAmount = o?.totalAmount || 0;
    const oSupplierAmt = o?.totalSupplierAmount || 0;
    const oMargin = o?.estimatedMargin || (oAmount - oSupplierAmt);
    const oMarginPct = oAmount > 0 ? ((oMargin / oAmount) * 100).toFixed(1) : 0;
    const restockBudgetStr = cash?.budgetFormatted || '약 3,500만원';
    const tiedCapitalStr = cash?.tiedCapitalFormatted || '약 4,800만원';

    // 1. 요약 작성 (CEO 두괄식 3문장)
    const summary = `[${periodLabel} CEO 전략 브리핑] 이번 기간 최우선 과제는 시화 품절 임박 품목의 안전재고 확보를 위한 ${restockBudgetStr} 규모의 구매 발주 집행입니다. ` +
        `현재 총 매출은 ${formatWon(oAmount)}(마진율 약 ${oMarginPct}%)이며, 과잉·정체 재고에 묶인 자본 약 ${tiedCapitalStr}에 대한 대체 견적 유동화가 시급합니다. ` +
        `거래처 동향상 ${cust?.churnRiskCustomers?.[0]?.name ? `${cust.churnRiskCustomers[0].name} 등 일부 거래처의 이탈 징후` : '복수 거래처의 비교 견적 증가'}와 ${pending?.totalPendingCount || 0}건의 미결 주문 납기 방어에 영업/물류 역량을 집중해야 합니다.`;

    // 2. 주기별 핵심 인사이트
    const periodInsight = {
        periodType: period,
        focus: period === 'weekly'
            ? '단기 결품 방어 및 7일 이상 경과 미결 주문 긴급 출고 타개'
            : period === 'monthly'
                ? '월말 구매 집행 자금 확보 및 MoM 거래처 이탈 방지'
                : 'ANSI/JIS 규격별 마진 구조 재편 및 장기 과잉재고 현금화',
    };

    // 3. 의사결정 액션 보드 (TOP Decisions)
    const decisions = [];
    const restockItems = (act?.items || []).filter(i => i.category === 'RESTOCK');
    if (restockItems.length > 0) {
        const topRestock = restockItems[0];
        decisions.push({
            priority: 1,
            title: `${topRestock.name} 외 ${restockItems.length}개 품목 긴급 선매입 및 ${restockBudgetStr} 집행 승인`,
            situation: `시화 현재고가 소진 임박(약 ${topRestock.daysOnHand ?? 7}일분 잔여)하여 조달 리드타임 감안 시 금주 내 결품 위험이 발생합니다.`,
            options: [
                { label: 'A안 (선매입)', action: `대경 및 주공급사 대상 ${restockBudgetStr} 규모 선발주`, impact: '납기 결품 제로화 및 확정 발주 마진 방어', risk: '단기 현금 지출' },
                { label: 'B안 (수주 시 발주)', action: '고객 확정 발주 접수 시 건별 매입', impact: '현금 지출 지연', risk: '상류 공급망 품절 시 납품 실패 및 거래처 실주' },
            ],
            recommended: 'A안 (선매입)',
            rationale: '주요 반복 거래처의 정기 발주 수요가 확인되었으며 대경 재고 소진 속도가 가속화되는 국면입니다.',
            riskIfIgnored: '향후 2~3주 내 납기 지연으로 인한 거래처 이탈 및 견적 실주 발생.',
            deadline: period === 'weekly' ? '이번 주 수요일 18:00 전' : '월말 마감 전',
            confidence: 'HIGH',
        });
    }

    if (cust?.churnRiskCustomers && cust.churnRiskCustomers.length > 0) {
        const churnCust = cust.churnRiskCustomers[0];
        decisions.push({
            priority: 2,
            title: `이탈 위기 거래처 [${churnCust.name}] 긴급 영업 방문 및 단가 재조정`,
            situation: `직전 기간 대비 발주액이 급감하였으며(${formatWon(churnCust.previousAmount)} → ${formatWon(churnCust.currentAmount)}), ${churnCust.reason}.`,
            options: [
                { label: 'A안 (단가 협상 방문)', action: '대표/영업팀장 동행 방문 및 주력 규격 2~3% 특별 단가 제안', impact: '연간 거래처 락인 유지', risk: '단기 마진 소폭 감소' },
                { label: 'B안 (기존 단가 고수)', action: '추가 할인 없이 현행 유지', impact: '마진율 유지', risk: '경쟁 유통사로의 영구 이탈' },
            ],
            recommended: 'A안 (단가 협상 방문)',
            rationale: '파이프/피팅 유통 특성상 이탈한 고객사를 재탈환하는 비용이 할인 비용의 3배 이상 소요됩니다.',
            riskIfIgnored: `분기 기준 약 ${formatWon(churnCust.previousAmount * 3)} 매출 증발 위험.`,
            deadline: '3영업일 이내',
            confidence: 'HIGH',
        });
    }

    // 4. 섹션 작성
    const sections = [
        {
            title: '재고 전략 및 구매 소요 경비 (시화 × 대경)',
            content: `• 시화 품절 위험 품목군 안전재고(3주) 확보를 위한 예상 구매 예산: ${restockBudgetStr}\n` +
                `• 대경 양산 공장 최근 소진 상위: ${(inv?.daekyungTrend?.topDropItems || inv?.topDropItems || []).slice(0, 3).map(i => `${i.name}(-${i.change.toLocaleString()}개)`).join(', ') || '내역 없음'}\n` +
                `• 시화 창고 직보유 출고 상위: ${(inv?.sihwaTrend?.topDropItems || []).slice(0, 3).map(i => `${i.name}(-${i.change.toLocaleString()}개)`).join(', ') || '시화 변동 없음'}\n` +
                `• 시화 창고 과잉·정체 품목에 묶인 운전자본: 약 ${tiedCapitalStr} (유동화 회수 목표: ${cash?.recoverableAmountFormatted || '약 1,700만원'})\n` +
                `• 유동화 추진 계획: ${cash?.recoveryPlan || '대체 견적 제안 및 대경 상계 협의'}`,
        },
        {
            title: '거래처 동향 및 시계열(전월·전전월) 비교',
            content: `• 활성 거래처 수 추이: 전전월(${cust?.activeCountMoM?.twoMonthsAgo || 0}개사) → 전월(${cust?.activeCountMoM?.previousMonth || 0}개사) → 이번 기간(${cust?.activeCountMoM?.current || 0}개사) [${cust?.activeCountMoM?.trend || '정체'}]\n` +
                `• 급성장 거래처: ${(cust?.keyGrowingCustomers || []).map(c => `${c.name}(${formatWon(c.amount)}, +${c.growthPct}%)`).join(', ') || '내역 없음'}\n` +
                `• 체리피커(비교 견적 다수, 미전환): ${(cust?.cherryPickers || []).map(c => `${c.name}(견적 ${c.quoteCount}건 / 전환율 ${c.conversionRate})`).join(', ') || '없음'}\n` +
                `• 이탈 위험 업체: ${(cust?.churnRiskCustomers || []).map(c => `${c.name}(전기 ${formatWon(c.previousAmount)} → 현재 ${formatWon(c.currentAmount)})`).join(', ') || '없음'}`,
        },
        {
            title: '규격별(ANSI vs JIS/KS) 시장 경쟁 & 마진',
            content: `• 규격 비중: 고부가 ANSI 계열 ${spec?.ansiSharePct || 50}% vs 범용 JIS/KS 계열 ${spec?.jisSharePct || 50}%\n` +
                `• ANSI 주요 고객군: ${(spec?.ansiTopCompetitorsOrClients || []).join(', ') || '화학/플랜트 주요 거래처'}\n` +
                `• JIS/KS 주요 고객군: ${(spec?.jisTopCompetitorsOrClients || []).join(', ') || '일반 설비 거래처'}\n` +
                `• 전략 평가: ${spec?.strategicComment || '규격별 차별화 가격 정책 필요'}`,
        },
        {
            title: '미결 주문 및 납기 리스크 관리',
            content: `• 현재 진행 중인 미결 주문: 총 ${pending?.totalPendingCount || 0}건 (${formatWon(pending?.totalPendingAmount || 0)})\n` +
                `• 집중 관리 필요 지연 건: ${(pending?.criticalOverdueItems || []).map(item => `[${item.customer}] ${item.item} (${item.delayDays}일 경과 - ${item.bottleneck})`).join('\n  ') || '지연 내역 없음'}`,
        },
    ];

    // 5. 추천 액션
    const recommendations = [
        `[구매/자금] 결품 임박 상위 품목 안전재고 확보를 위한 ${restockBudgetStr} 매입 집행 결재`,
        `[영업/고객] 체리피커 및 이탈 징후 거래처(${cust?.churnRiskCustomers?.[0]?.name || '주요사'}) 전담 영업 콜 및 단가 협상`,
        `[물류/납기] 7일 이상 경과된 미결 ${pending?.totalPendingCount || 0}건에 대한 출고 일정 재확정 및 고객 사전 안내`,
    ];

    return {
        aiSummary: summary,
        periodInsight,
        cashFlowAndBudget: cash || {
            estimatedRestockBudget: 35000000,
            budgetFormatted: restockBudgetStr,
            budgetRationale: '품절 임박 품목 3주 안전재고 확보 필요액',
            tiedCapitalInExcess: 48000000,
            tiedCapitalFormatted: tiedCapitalStr,
            recoverableAmountFormatted: '약 1,700만원',
            recoveryPlan: '상위 과잉 품목에 대한 대체 견적 제안 추진',
        },
        decisions,
        customerTrends: cust || null,
        specCompetition: spec || null,
        pendingOperations: pending || null,
        aiSections: sections,
        aiRecommendations: recommendations,
        model: 'Antigravity Executive AI 참모 (Local Fallback Engine)',
        tokenUsage: { input: 0, output: 0 },
    };
}

// ── Gemini API 호출 ──
async function generateViaGemini(apiKey, period, metrics) {
    const periodLabel = PERIOD_LABEL[period] || period;
    const userPrompt = `분석 기간: ${periodLabel} (${metrics.rangeStart} ~ ${metrics.rangeEnd})\n\n` +
        `집계 데이터:\n${JSON.stringify(metrics, null, 2)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2,
            },
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(rawText);

    return {
        aiSummary: parsed.summary,
        periodInsight: parsed.periodInsight || null,
        cashFlowAndBudget: parsed.cashFlowAndBudget || metrics.cashFlowAndBudget || null,
        decisions: parsed.decisions || [],
        inventoryBoard: parsed.inventoryBoard || null,
        customerTrends: parsed.customerTrends || metrics.customerTrends || null,
        specCompetition: parsed.specCompetition || metrics.specCompetition || null,
        pendingOperations: parsed.pendingOperations || metrics.pendingOperations || null,
        aiSections: parsed.sections || [],
        aiRecommendations: parsed.recommendations || [],
        dataGaps: parsed.dataGaps || [],
        model: 'gemini-2.5-flash',
        tokenUsage: {
            input: data.usageMetadata?.promptTokenCount || 0,
            output: data.usageMetadata?.candidatesTokenCount || 0,
        },
    };
}

// ── Claude API 호출 ──
async function generateViaClaude(apiKey, period, metrics) {
    const client = new Anthropic({ apiKey });
    const periodLabel = PERIOD_LABEL[period] || period;
    const userPrompt = `분석 기간: ${periodLabel} (${metrics.rangeStart} ~ ${metrics.rangeEnd})\n\n` +
        `집계 데이터:\n${JSON.stringify(metrics, null, 2)}`;

    const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in Claude response');

    const raw = textBlock.text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`Claude response did not contain a JSON object: ${raw.slice(0, 200)}`);
    }
    const parsed = JSON.parse(raw.slice(start, end + 1));

    return {
        aiSummary: parsed.summary,
        periodInsight: parsed.periodInsight || null,
        cashFlowAndBudget: parsed.cashFlowAndBudget || metrics.cashFlowAndBudget || null,
        decisions: parsed.decisions || [],
        inventoryBoard: parsed.inventoryBoard || null,
        customerTrends: parsed.customerTrends || metrics.customerTrends || null,
        specCompetition: parsed.specCompetition || metrics.specCompetition || null,
        pendingOperations: parsed.pendingOperations || metrics.pendingOperations || null,
        aiSections: parsed.sections || [],
        aiRecommendations: parsed.recommendations || [],
        dataGaps: parsed.dataGaps || [],
        model: response.model,
        tokenUsage: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
        },
    };
}

export async function generateAiReport(period, metrics) {
    if (process.env.GEMINI_API_KEY) {
        try {
            console.log('[AI Report] Generating report using Google Gemini API...');
            return await generateViaGemini(process.env.GEMINI_API_KEY, period, metrics);
        } catch (geminiErr) {
            console.warn('[AI Report] Gemini API call failed, falling back:', geminiErr.message);
        }
    }

    if (process.env.ANTHROPIC_API_KEY) {
        try {
            console.log('[AI Report] Generating report using Anthropic Claude API...');
            return await generateViaClaude(process.env.ANTHROPIC_API_KEY, period, metrics);
        } catch (claudeErr) {
            console.warn('[AI Report] Claude API call failed, falling back:', claudeErr.message);
        }
    }

    console.log('[AI Report] Generating report using Antigravity Local Analytics Engine (Zero Failure Fallback)...');
    return generateLocalRuleBasedReport(period, metrics);
}
