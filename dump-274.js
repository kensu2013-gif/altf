import fs from 'fs';
const orders = JSON.parse(fs.readFileSync('./live-orders.json', 'utf8'));
const order274 = orders.find(o => o.poNumber === 'ES260204-274' || o.id === 'PO-20260304-TAEIL-029');

fs.writeFileSync('./order274-dump.json', JSON.stringify(order274, null, 2));
