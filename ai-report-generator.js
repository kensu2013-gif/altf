import Anthropic from '@anthropic-ai/sdk';

const PERIOD_LABEL = {
    weekly: '주간(최근 1주일)',
    monthly: '월간(최근 1개월)',
    quarterly: '분기(최근 3개월)',
    semiannual: '반기(최근 6개월)',
};

const SYSTEM_PROMPT = `당신은 철강 파이프/피팅 유통업체 ALTF의 경영 분석 AI 비서입니다.
아래 제공되는 견적/발주/재고/거래처 트렌드 집계 데이터(JSON)를 바탕으로, 경영진(MASTER 권한자)이
다음에 무엇을 더 깊이 파고들지 스스로 판단할 수 있도록 "탐구의 출발점" 역할을 하는 리포트를 작성하세요.

규칙:
1. 반드시 제공된 숫자 데이터에 근거해서만 서술하고, 데이터에 없는 사실을 추측하여 단정하지 마세요.
2. 재고 데이터(inventoryTrend, inventoryActionAnalysis)는 담당자가 수동으로 확정(confirm)할 때만 쌓이는
   불규칙 스냅샷입니다. confirmedDaysInRange/windowSnapCount가 적을수록 표본이 부족하다는 점을 반드시
   감안한 신중한 표현을 쓰세요.
3. 견적/발주/재고/업체 트렌드를 개별 요약하는 데 그치지 말고, 트렌드 간 상관관계나 모순
   (예: 견적은 느는데 발주는 주는 경우, 특정 업체 발주 급감과 재고 급증이 겹치는 경우)을 짚어내세요.
4. regionTrend(권역별 견적/발주)는 이미 화면에 표/막대그래프로 표시됩니다. 숫자를 다시 나열하지 말고
   "왜 그런지, 무엇을 뜻하는지"에 집중하세요. unmatchedQuotationShare/unmatchedOrderShare가 높을수록
   (CRM에 매칭되지 않은 비중이 크다는 뜻) 권역별 해석의 신뢰도가 낮다는 점을 반드시 언급하세요.
5. trendSeries.buckets는 오래된 구간부터 최신 구간 순서의 시계열입니다. 이번 기간 대 직전 기간의
   단일 비교가 아니라, 여러 구간에 걸친 방향성(가속/둔화/방향전환)을 짚어 향후 흐름을 가늠하게 하세요.
6. inventoryActionAnalysis.items는 이미 품목별로 RESTOCK(재구매 추천)/STABLE(재고 유지)/
   EXCESS(과잉재고 주의)/DEAD_STOCK_CANDIDATE(처분 검토)로 분류되어 표로 표시됩니다. 표 내용을
   반복 서술하지 말고, 그 중 사업적으로 가장 중요한 1~2개 품목을 짚어 "왜 지금 그 판단이 중요한지"
   근거를 제시하세요.
7. 마지막에는 향후 1~2개월간 준비해야 할 방향을 3~5개의 실행 가능한 제안으로 제시하세요. 가능하면
   inventoryActionAnalysis에서 나온 구체적인 품목명이나 regionTrend의 권역명을 인용해 추상적이지
   않게 작성하세요.
8. 반드시 아래 JSON 스키마로만 응답하세요. 마크다운 코드블록이나 설명 문장 없이 순수 JSON만 출력하세요.

{
  "summary": "전체 요약 2~3문장",
  "sections": [
    {"title":"견적 트렌드","content":"..."},
    {"title":"발주 트렌드","content":"..."},
    {"title":"재고 트렌드","content":"..."},
    {"title":"업체 트렌드","content":"..."},
    {"title":"권역별 동향","content":"..."},
    {"title":"추세 모멘텀","content":"..."},
    {"title":"트렌드 간 교차 분석","content":"..."}
  ],
  "recommendations": ["...", "...", "..."]
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
    const { quotationTrend: q, orderTrend: o, inventoryTrend: inv, supplierTrend: s, regionTrend: rg, trendSeries: ts, inventoryActionAnalysis: act } = metrics;

    const qCount = q?.count || 0;
    const qAmount = q?.totalAmount || 0;
    const qAmtPct = q?.amountChangePct ?? 0;
    const qCountPct = q?.countChangePct ?? 0;

    const oCount = o?.count || 0;
    const oAmount = o?.totalAmount || 0;
    const oSupplierAmt = o?.totalSupplierAmount || 0;
    const oMargin = o?.estimatedMargin || (oAmount - oSupplierAmt);
    const oMarginPct = oAmount > 0 ? ((oMargin / oAmount) * 100).toFixed(1) : 0;
    const oAmtPct = o?.amountChangePct ?? 0;

    // 1. 요약 작성
    const summary = `${periodLabel} 동안 총 ${qCount}건(${formatWon(qAmount)})의 견적 요청과 ${oCount}건(${formatWon(oAmount)})의 발주가 체결되었습니다. ` +
        `발주 총액은 전 기간 대비 ${oAmtPct >= 0 ? '+' : ''}${oAmtPct}%, 견적 총액은 ${qAmtPct >= 0 ? '+' : ''}${qAmtPct}% 변동하였으며, ` +
        `추정 마진은 약 ${formatWon(oMargin)}(마진율 약 ${oMarginPct}%) 수준을 기록하였습니다.`;

    // 2. 섹션 작성
    const sections = [];

    // 견적 섹션
    const topQCust = (q?.topCustomers || []).map(c => `${c.name}(${formatWon(c.amount)})`).join(', ') || '내역 없음';
    sections.push({
        title: '견적 트렌드',
        content: `• 총 견적 건수: ${qCount}건 (전기 대비 ${qCountPct >= 0 ? '+' : ''}${qCountPct}%)\n` +
            `• 총 견적 금액: ${formatWon(qAmount)} (전기 대비 ${qAmtPct >= 0 ? '+' : ''}${qAmtPct}%)\n` +
            `• 평균 견적 단가: ${formatWon(q?.avgAmount || 0)}\n` +
            `• 주요 견적 고객사: ${topQCust}`,
    });

    // 발주 섹션
    const topOCust = (o?.topCustomers || []).map(c => `${c.name}(${formatWon(c.amount)})`).join(', ') || '내역 없음';
    sections.push({
        title: '발주 트렌드',
        content: `• 총 발주 건수: ${oCount}건 (전기 대비 ${o?.countChangePct >= 0 ? '+' : ''}${o?.countChangePct || 0}%)\n` +
            `• 총 발주 매출: ${formatWon(oAmount)} (매입원가: ${formatWon(oSupplierAmt)})\n` +
            `• 예상 영업마진: 약 ${formatWon(oMargin)} (마진율 ${oMarginPct}%)\n` +
            `• 주요 매출 고객사: ${topOCust}`,
    });

    // 재고 섹션
    const invDays = inv?.confirmedDaysInRange || 0;
    const dropItems = (inv?.topDropItems || []).map(i => `${i.name}(-${i.change}개)`).join(', ') || '변동 없음';
    const surgeItems = (inv?.topSurgeItems || []).map(i => `${i.name}(+${i.change}개)`).join(', ') || '변동 없음';
    sections.push({
        title: '재고 트렌드',
        content: `• 재고 확정 일수: ${invDays}일 확정 스냅샷 기록\n` +
            `• 총 출고 누적: ${Number(inv?.totalOutbound || 0).toLocaleString()}개 / 총 입고 누적: ${Number(inv?.totalInbound || 0).toLocaleString()}개\n` +
            `• 주요 출고(감소) 품목: ${dropItems}\n` +
            `• 주요 입고(증가) 품목: ${surgeItems}\n` +
            `※ ${inv?._note || '재고는 수동 확정 스냅샷 기준입니다.'}`,
    });

    // 업체 섹션
    const topSuppliers = (s?.topSuppliers || []).map(sup => `${sup.name}(${formatWon(sup.amount)})`).join(', ') || '내역 없음';
    const newSuppliers = (s?.newSuppliers || []).join(', ') || '없음';
    const droppingSuppliers = (s?.droppingSuppliers || []).join(', ') || '없음';
    sections.push({
        title: '업체(공급사) 트렌드',
        content: `• 주요 공급 매입처: ${topSuppliers}\n` +
            `• 신규 거래 공급사: ${newSuppliers}\n` +
            `• 거래 중단/미발생 공급사: ${droppingSuppliers}`,
    });

    // 권역별 동향
    const qRegions = (rg?.quotationByRegion || []).slice(0, 3).map(r => `${r.region}(${formatWon(r.amount)})`).join(', ') || '내역 없음';
    const oRegions = (rg?.orderByRegion || []).slice(0, 3).map(r => `${r.region}(${formatWon(r.amount)})`).join(', ') || '내역 없음';
    const qUnmatchedShare = rg?.unmatchedQuotationShare ?? 0;
    const oUnmatchedShare = rg?.unmatchedOrderShare ?? 0;
    const unmatchedNote = (qUnmatchedShare > 15 || oUnmatchedShare > 15)
        ? ` ※ 견적 ${qUnmatchedShare}%, 발주 ${oUnmatchedShare}%가 "${rg?.unmatchedLabel || 'CRM 미등록/예외'}"로 분류되어 있어 권역별 해석의 신뢰도가 제한적입니다.`
        : '';
    sections.push({
        title: '권역별 동향',
        content: `• 견적 상위 권역: ${qRegions}\n` +
            `• 발주 상위 권역: ${oRegions}${unmatchedNote}`,
    });

    // 추세 모멘텀 (최근 N구간 시계열)
    const buckets = ts?.buckets || [];
    let momentum = '추세 시계열 데이터가 부족합니다.';
    if (buckets.length >= 2) {
        const first = buckets[0];
        const last = buckets[buckets.length - 1];
        const qMomentumPct = first.quotationAmount > 0
            ? (((last.quotationAmount - first.quotationAmount) / first.quotationAmount) * 100).toFixed(1)
            : (last.quotationAmount > 0 ? '100' : '0');
        const oMomentumPct = first.orderAmount > 0
            ? (((last.orderAmount - first.orderAmount) / first.orderAmount) * 100).toFixed(1)
            : (last.orderAmount > 0 ? '100' : '0');
        momentum = `최근 ${buckets.length}개 구간(${first.periodKey} ~ ${last.periodKey}) 기준, 견적 금액은 ${qMomentumPct >= 0 ? '+' : ''}${qMomentumPct}%, ` +
            `발주 금액은 ${oMomentumPct >= 0 ? '+' : ''}${oMomentumPct}% 변동했습니다. ` +
            `${Number(oMomentumPct) > 0 && Number(qMomentumPct) > 0 ? '두 지표 모두 상승세로, 단일 기간 비교보다 신뢰도 높은 성장 신호입니다.' : Number(oMomentumPct) < 0 && Number(qMomentumPct) < 0 ? '두 지표 모두 하락세로, 일시적 변동이 아닌 추세적 둔화 가능성을 점검해야 합니다.' : '견적과 발주 방향이 엇갈리고 있어 전환 단계의 병목을 살펴볼 필요가 있습니다.'}`;
    }
    sections.push({ title: '추세 모멘텀', content: momentum });

    // 트렌드 간 교차 분석
    let crossAnalysis = '';
    if (qCount > 0 && oCount === 0) {
        crossAnalysis = `견적 문의(${qCount}건)는 활발히 유입되었으나 실제 발주 전환(${oCount}건)이 지연되고 있습니다. 고객사의 단가 검토 기간이 길어지거나 경쟁사 대비 견적 경쟁력 점검이 필요합니다.`;
    } else if (qCount === 0 && oCount === 0) {
        crossAnalysis = `해당 기간 내 신규 등록된 견적 및 발주 데이터가 미미합니다. 비수기 시즌이거나 거래처별 수기 거래건의 시스템 등록 현황을 재점검할 필요가 있습니다.`;
    } else {
        const convRate = qCount > 0 ? ((oCount / qCount) * 100).toFixed(1) : '100';
        crossAnalysis = `견적 대비 발주 전환율은 약 ${convRate}% 수준입니다. ${oAmtPct >= 0 ? '매출 성장세와 더불어 ' : '매출 조정 국면에서 '}주요 매입처(${topSuppliers.split(',')[0] || '공급사'})와의 원가 협상을 통해 ${oMarginPct}% 마진율을 방어하는 운영 전략이 주효합니다.`;
    }
    sections.push({
        title: '트렌드 간 교차 분석',
        content: crossAnalysis,
    });

    // 3. 추천 액션 아이템
    const recommendations = [
        `주요 견적 및 발주 상위 고객사(${topOCust.split('(')[0] || '핵심 거래처'})에 대한 집중 팔로업 및 단가 리텐션 관리`,
        invDays > 0 ? `출고 빈도가 높은 상위 품목(${dropItems.split('(')[0] || '다빈도 규격'})의 안전재고 확보 및 납기 단축` : '정확한 수급 분석을 위해 주 1회 이상 대경재고 확정 스냅샷 등록 권장',
        `신규 및 주력 공급사와의 정기 매입 단가 검토를 통한 목표 마진율(${Math.max(10, Math.round(Number(oMarginPct) || 12))}% 이상) 유지 관리`,
    ];

    if (act && !act.insufficientData) {
        const restockItem = (act.items || []).find(i => i.category === 'RESTOCK');
        const deadStockItem = (act.items || []).find(i => i.category === 'DEAD_STOCK_CANDIDATE');
        const restockCount = (act.items || []).filter(i => i.category === 'RESTOCK').length;
        const deadStockCount = (act.items || []).filter(i => i.category === 'DEAD_STOCK_CANDIDATE').length;
        if (restockItem) {
            recommendations.push(`재구매 검토: ${restockItem.name} 등 ${restockCount}개 품목이 최근 수요 대비 재고 소진 임박(약 ${restockItem.daysOnHand ?? '?'}일분) 상태입니다.`);
        }
        if (deadStockItem) {
            recommendations.push(`처분/재고 정리 검토: ${deadStockItem.name} 등 ${deadStockCount}개 품목이 최근 출고가 정체되어 재고 자산으로 묶여 있습니다.`);
        }
    }

    return {
        aiSummary: summary,
        aiSections: sections,
        aiRecommendations: recommendations,
        model: 'Antigravity AI Analytics Engine (Local-Native)',
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
        aiSections: parsed.sections,
        aiRecommendations: parsed.recommendations,
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
        aiSections: parsed.sections,
        aiRecommendations: parsed.recommendations,
        model: response.model,
        tokenUsage: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
        },
    };
}

export async function generateAiReport(period, metrics) {
    // 1. Gemini API Key 확인 및 호출 시도
    if (process.env.GEMINI_API_KEY) {
        try {
            console.log('[AI Report] Generating report using Google Gemini API...');
            return await generateViaGemini(process.env.GEMINI_API_KEY, period, metrics);
        } catch (geminiErr) {
            console.warn('[AI Report] Gemini API call failed, falling back:', geminiErr.message);
        }
    }

    // 2. Anthropic API Key 확인 및 호출 시도
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            console.log('[AI Report] Generating report using Anthropic Claude API...');
            return await generateViaClaude(process.env.ANTHROPIC_API_KEY, period, metrics);
        } catch (claudeErr) {
            console.warn('[AI Report] Claude API call failed, falling back:', claudeErr.message);
        }
    }

    // 3. Fallback: 로컬 스마트 통계 분석 엔진으로 즉시 안전하게 생성
    console.log('[AI Report] Generating report using Antigravity Local Analytics Engine (Zero Failure Fallback)...');
    return generateLocalRuleBasedReport(period, metrics);
}

