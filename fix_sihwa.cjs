const fs = require('fs');
let c = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8');

c = c.replace(
    '재고 건전성 등급 분포 (A~E)',
    '재고 건전성 등급 분포 (A~E) <span className="text-xs text-slate-400 font-normal ml-1">(총 {analyzedInventory.filter(r => r.healthGrade !== \'N\').length}개 품목)</span>'
);
c = c.replace(
    'const pct = total > 0 ? Math.round(count / total * 100) : 0;',
    'const pct = total > 0 ? (count / total * 100).toFixed(1) : 0;'
);
c = c.replace(
    '<span className="text-[11px] font-bold w-28 text-slate-600 shrink-0">\n                                {labels[grade]}\n                            </span>',
    `<span className="text-[11px] font-bold w-28 text-slate-600 shrink-0 flex justify-between pr-2">
                                <span>{labels[grade]}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{pct}%</span>
                            </span>`
);

// Tabs and headings
c = c.replace('AI 요약보기 (Action Items)', 'AI 요약보기 (발주 추천)');
c = c.replace('재고 건전성 진단\n                          {/* 악성재고 경고 배지 */}\n                          {healthDiagnosis.deadStockItems.length > 0 &&', '악성·과잉 재고 진단\n                          {healthDiagnosis.totalIssueCount > 0 &&');
c = c.replace('{healthDiagnosis.deadStockItems.length}', '{healthDiagnosis.totalIssueCount}');
c = c.replace('🩺 재고 건전성 진단 탭', '🩺 악성·과잉 재고 진단 탭');

c = c.replace('부진재고 (체화)', '정체재고 (장기 미판매)');
c = c.replace('D등급이면서 잔여일 90일 이상 재고<br/>(악성재고 전환 주의 대상)', 'D등급이면서 90일 이상 정체된 재고<br/>(악성재고 전환 주의)');

c = c.replace('🐌 부진재고 상세', '🐌 정체재고 상세 (장기 미판매)');
c = c.replace('D등급이면서 잔여일 90일~180일 품목', 'D등급이면서 잔여일 90일~180일 품목 (악성재고 전환 주의)');

// Fix safeStock logic and remove getTargetStockByHealthGrade
c = c.replace(
`function getTargetStockByHealthGrade(grade: string, monthlyAvgSales: number): number {
    const multiplier =
        grade === 'A' ? 2.0 :
        grade === 'B' ? 1.5 :
        grade === 'C' ? 1.0 : 0;
    return multiplier > 0
        ? Math.max(10, Math.ceil(monthlyAvgSales * multiplier / 10) * 10)
        : 0;
}

/**`, `/**`);

c = c.replace(`        targetStockByHealthGrade: number;`, ``);
c = c.replace(/targetStockByHealthGrade: 0,/g, '');

c = c.replace(
`            // REQUIREMENT 3: INCLUDE PENDING ORDERS as effective stock
            const effectiveStock = row.shQty + row.pendingOrderQty; 

            let statusCategory = 'IDLE'; 
            let statusLabel = '대기/데이터없음';

            if (row.salesVolume > 0 && safeStock > 0) {
                if (effectiveStock <= 0) {
                    if (row.ysQty <= 0) {
                        if (row.salesVolume > 100 && row.salesFreq >= 10) {
                            statusCategory = 'CRITICAL';
                            statusLabel = '🚨 선발주 요망 (매입결품)';
                        } else {
                            // Exclude from urgent pre-order if volume/freq not enough, demote to normal order
                            statusCategory = 'WARNING';
                            statusLabel = '⚠️ 일반 발주 필요 (재고부족)';
                        }
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 일반 발주 (대경재고 활용)';
                    }
                } else if (effectiveStock < safeStock) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 적정재고 미달 (재고부족)';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                 statusCategory = 'SAFE';
                 statusLabel = '✅ 미활동 보유품';
            }`,
`            // [NEW] 대경재고(양산) 연동 적정재고 타이트닝 로직
            const monthlyAvgSalesForDaekyung = row.salesVolume / 12;
            if (row.ysQty > 0 && monthlyAvgSalesForDaekyung > 0) {
                const monthsOfDaekyungStock = row.ysQty / monthlyAvgSalesForDaekyung;
                if (monthsOfDaekyungStock >= 3) {
                    safeStock = Math.ceil((safeStock * 0.3) / 10) * 10;
                } else if (monthsOfDaekyungStock >= 1) {
                    safeStock = Math.ceil((safeStock * 0.5) / 10) * 10;
                }
            }

            // REQUIREMENT 3: INCLUDE PENDING ORDERS as effective stock
            const effectiveStock = row.shQty + row.pendingOrderQty;`);

// Fix deficit logic and status mapping
c = c.replace(
`            // === 신규 건전성 등급 평가 로직 (100점 만점 복합 점수제) ===
            const compositeScore = calcCompositeScore(row);
            const healthGrade = getHealthGradeFromScore(compositeScore, effectiveStock, row.salesVolume, row.quoteCount);
            
            // 등급별 목표재고 및 과잉재고 편입 산출
            const targetStockByHealthGrade = getTargetStockByHealthGrade(healthGrade, row.salesVolume / 12);
            const excessCategory = getExcessActionLabel(healthGrade);
            const isExcessStock = row.shQty > targetStockByHealthGrade * 2 || daysOnHand > 180;
            const isDeadStock = healthGrade === 'E';

            if (healthGrade === 'E') {
                statusCategory = 'DEAD';
                statusLabel = '☠️ 처분 대상 (악성재고)';
            } else if (isExcessStock) {
                statusCategory = 'EXCESS';
                statusLabel = \`📦 과잉재고 (\${getExcessActionLabel(healthGrade)})\`;
            } else if (healthGrade === 'D' || healthGrade === 'N') {
                statusCategory = 'SAFE';
                statusLabel = '🟡 미발주 대상 (D/N등급)';
            } else if (targetStockByHealthGrade > 0) {
                if (effectiveStock <= 0) {
                    // 선발주 요망(CRITICAL) 조건: 대경 재고가 없으면서, A/B급 핵심 품목이거나 일정 수준 이상 팔리는 품목
                    if (row.ysQty <= 0 && (healthGrade === 'A' || healthGrade === 'B' || (row.salesVolume >= 30 && row.salesFreq >= 5))) {
                        statusCategory = 'CRITICAL';
                        statusLabel = '🚨 선발주 요망 (매입결품)';
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 일반 발주 필요 (재고부족)';
                    }
                } else if (effectiveStock < targetStockByHealthGrade) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 적정재고 미달 (재고부족)';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                statusCategory = 'SAFE';
                statusLabel = '✅ 미활동 보유품';
            }

            const finalDeficit = Math.max(0, targetStockByHealthGrade - effectiveStock);

            return {
                ...row,
                compositeScore,
                healthGrade,
                targetStockByHealthGrade,
                excessCategory,
                safeStock,
                deficit: finalDeficit,`,
`            // === 신규 건전성 등급 평가 로직 (100점 만점 복합 점수제) ===
            const compositeScore = calcCompositeScore(row);
            const healthGrade = getHealthGradeFromScore(compositeScore, effectiveStock, row.salesVolume, row.quoteCount);
            
            // 과잉재고 판단 (안전재고의 2.5배 이상 또는 180일 초과)
            const excessCategory = getExcessActionLabel(healthGrade);
            const isExcessStock = row.shQty > safeStock * 2.5 || daysOnHand > 180;
            const isDeadStock = healthGrade === 'E';

            let statusCategory = 'IDLE'; 
            let statusLabel = '대기/데이터없음';

            if (healthGrade === 'E') {
                statusCategory = 'DEAD';
                statusLabel = '☠️ 처분 대상 (악성재고)';
            } else if (isExcessStock) {
                statusCategory = 'EXCESS';
                statusLabel = \`📦 과잉재고 (\${excessCategory})\`;
            } else if (healthGrade === 'D' || healthGrade === 'N') {
                statusCategory = 'SAFE';
                statusLabel = '🟡 미발주 대상 (D/N등급)';
            } else if (safeStock > 0) {
                if (effectiveStock <= 0) {
                    // 선발주 요망(CRITICAL) 조건: 대경 재고가 없으면서, A/B급 핵심 품목이거나 일정 수준 이상 팔리는 품목
                    if (row.ysQty <= 0 && (healthGrade === 'A' || healthGrade === 'B' || (row.salesVolume >= 30 && row.salesFreq >= 5))) {
                        statusCategory = 'CRITICAL';
                        statusLabel = '🚨 선발주 요망 (매입결품)';
                    } else {
                        statusCategory = 'WARNING';
                        statusLabel = '⚠️ 일반 발주 필요 (재고부족)';
                    }
                } else if (effectiveStock < safeStock) {
                    statusCategory = 'WARNING';
                    statusLabel = '⚠️ 적정재고 미달 (재고부족)';
                } else {
                    statusCategory = 'SAFE';
                    statusLabel = '✅ 적정 유지중';
                }
            } else if (row.shQty > 0 || row.ysQty > 0) {
                statusCategory = 'SAFE';
                statusLabel = '✅ 미활동 보유품';
            }

            const finalDeficit = Math.max(0, safeStock - effectiveStock);

            return {
                ...row,
                compositeScore,
                healthGrade,
                excessCategory,
                safeStock,
                deficit: finalDeficit,`);


// Fix table UI turnoverGrade -> healthGrade
c = c.replace('<th className="px-5 py-3 text-center">회전율</th>', '<th className="px-5 py-3 text-center">건전성 등급</th>');
c = c.replace('<th className="px-5 py-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort(\'turnoverRate\')}>회전율 {sortConfig.key===\'turnoverRate\' && (sortConfig.direction===\'asc\'?\'↑\':\'↓\')}</th>', '<th className="px-5 py-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort(\'healthGrade\')}>건전성 등급 {sortConfig.key===\'healthGrade\' && (sortConfig.direction===\'asc\'?\'↑\':\'↓\')}</th>');

const badgeHtml = `<span className={\`text-xs font-black px-2 py-0.5 rounded-full \${
                                                                            row.healthGrade === 'A' ? 'bg-emerald-100 text-emerald-700' :
                                                                            row.healthGrade === 'B' ? 'bg-blue-100 text-blue-700' :
                                                                            row.healthGrade === 'C' ? 'bg-amber-100 text-amber-700' :
                                                                            row.healthGrade === 'D' ? 'bg-orange-100 text-orange-600' :
                                                                            row.healthGrade === 'E' ? 'bg-rose-100 text-rose-600' :
                                                                            'bg-slate-100 text-slate-400'
                                                                        }\`}>
                                                                            {row.healthGrade === 'A' ? 'A급' :
                                                                             row.healthGrade === 'B' ? 'B급' :
                                                                             row.healthGrade === 'C' ? 'C급' :
                                                                             row.healthGrade === 'D' ? 'D급' :
                                                                             row.healthGrade === 'E' ? 'E급' : 'N급'}
                                                                        </span>`;

const turnoverBadgePattern = /<span className=\{\`text-xs font-black px-2 py-0\.5 rounded-full \$\{\n\s*row\.turnoverGrade[\s\S]*?<\/span>/g;

c = c.replace(turnoverBadgePattern, badgeHtml);

fs.writeFileSync('src/pages/admin/SihwaInventory.tsx', c);
console.log('done!');
