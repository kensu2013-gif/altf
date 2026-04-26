const fs = require('fs');
let c = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8');

c = c.replace(
    'deadStockItems: inventory.filter(r => r.healthGrade === \'E\'),',
    'deadStockItems: inventory.filter(r => r.healthGrade === \'E\'),\n        totalIssueCount: inventory.filter(r => r.healthGrade === \'E\').length + inventory.filter(r => r.excessCategory !== null).length,'
);

c = c.replace(
    'type SortKey = \'id\' | \'salesFreq\' | \'salesVolume\' | \'deficit\' | \'shQty\' | \'ysQty\' | \'pendingOrderQty\' | \'recentPurchasePrice\' | \'turnoverRate\' | \'daysOnHand\' | \'safeStock\';',
    'type SortKey = \'id\' | \'salesFreq\' | \'salesVolume\' | \'deficit\' | \'shQty\' | \'ysQty\' | \'pendingOrderQty\' | \'recentPurchasePrice\' | \'turnoverRate\' | \'healthGrade\' | \'daysOnHand\' | \'safeStock\';'
);

fs.writeFileSync('src/pages/admin/SihwaInventory.tsx', c);
console.log('done!');
