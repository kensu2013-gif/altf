const fs = require('fs');
let c = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8');

const regex1 = /\s*let targetStockByTurnover = [\s\S]*?sizeNum >= 100\) targetStockByTurnover = Math\.min\(targetStockByTurnover, 300\);\s*}/g;
c = c.replace(regex1, '');

c = c.replace(/\s+targetStockByTurnover:\s*0,/g, '');
c = c.replace(/,\s*targetStockByTurnover/g, '');

fs.writeFileSync('src/pages/admin/SihwaInventory.tsx', c);
console.log('Cleaned targetStockByTurnover');
