const fs = require('fs');
let c = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8');

c = c.replace(
    '        key: \'id\' | \'salesFreq\' | \'salesVolume\' | \'deficit\' | \'shQty\' | \'ysQty\' | \'pendingOrderQty\' | \'recentPurchasePrice\' | \'turnoverRate\' | \'daysOnHand\' | \'safeStock\', ',
    '        key: \'id\' | \'salesFreq\' | \'salesVolume\' | \'deficit\' | \'shQty\' | \'ysQty\' | \'pendingOrderQty\' | \'recentPurchasePrice\' | \'turnoverRate\' | \'daysOnHand\' | \'safeStock\' | \'healthGrade\', '
);

c = c.replace(
    'const handleSort = (key: \'id\' | \'salesFreq\' | \'salesVolume\' | \'deficit\' | \'shQty\' | \'ysQty\' | \'pendingOrderQty\' | \'recentPurchasePrice\' | \'turnoverRate\' | \'daysOnHand\' | \'safeStock\') => {',
    'const handleSort = (key: \'id\' | \'salesFreq\' | \'salesVolume\' | \'deficit\' | \'shQty\' | \'ysQty\' | \'pendingOrderQty\' | \'recentPurchasePrice\' | \'turnoverRate\' | \'daysOnHand\' | \'safeStock\' | \'healthGrade\') => {'
);

fs.writeFileSync('src/pages/admin/SihwaInventory.tsx', c);
console.log('done!');
