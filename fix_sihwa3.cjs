const fs = require('fs');
let c = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8');

c = c.replace(
`            // 등급별 목표재고 산출
            const monthlyAvgSales = row.salesVolume / 12;
            let targetStockByHealthGrade = getTargetStockByHealthGrade(healthGrade, monthlyAvgSales);

            if (!isNaN(sizeNum)) {
                if (sizeNum >= 400) targetStockByHealthGrade = Math.min(targetStockByHealthGrade, 30);
                else if (sizeNum >= 300) targetStockByHealthGrade = Math.min(targetStockByHealthGrade, 50);
                else if (sizeNum >= 200) targetStockByHealthGrade = Math.min(targetStockByHealthGrade, 80);
                else if (sizeNum >= 150) targetStockByHealthGrade = Math.min(targetStockByHealthGrade, 150);
                else if (sizeNum >= 100) targetStockByHealthGrade = Math.min(targetStockByHealthGrade, 300);
            }

            // 악성재고: E급만
            const isDeadStock = healthGrade === 'E';

            // 과잉재고: E급 제외, 목표재고의 1.5배 초과
            const isExcessStock = !isDeadStock
                && targetStockByHealthGrade > 0
                && row.shQty > (targetStockByHealthGrade * 1.5)
                && row.recentPurchasePrice > 0;`,
`            // 악성재고: E급만
            const isDeadStock = healthGrade === 'E';

            // 과잉재고: E급 제외, 목표재고(safeStock)의 1.5배 초과
            const isExcessStock = !isDeadStock
                && safeStock > 0
                && row.shQty > (safeStock * 1.5)
                && row.recentPurchasePrice > 0;`
);

c = c.replace(
`            } else if (targetStockByHealthGrade > 0) {
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

            const finalDeficit = Math.max(0, targetStockByHealthGrade - effectiveStock);`,
`            } else if (safeStock > 0) {
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

            const finalDeficit = Math.max(0, safeStock - effectiveStock);`
);

c = c.replace(
`                targetStockByHealthGrade,`,
``
);

fs.writeFileSync('src/pages/admin/SihwaInventory.tsx', c);
console.log('done!');
