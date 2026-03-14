import fs from 'fs';

const orders = JSON.parse(fs.readFileSync('./live-orders.json', 'utf8'));

const order472 = orders.find(o => o.poNumber === 'ES260305-472' || o.id === 'PO-20260305-TAEIL-007');
const order546 = orders.find(o => o.poNumber === 'ES260310-546' || o.id === 'PO-20260310-TAEIL-017');
const order274 = orders.find(o => o.poNumber === 'ES260204-274' || o.id === 'PO-20260304-TAEIL-029');

let out = '';
out += "--- 472 ---\n";
const missingInPo = order472.items.filter(item => !order472.po_items.some(poi => poi.id === item.id));
out += "Missing in PO items for 472:\n" + missingInPo.map(i => i.name + ' ' + i.size).join('\n') + '\n';

out += "--- 274 ---\n";
const missingInPo274 = order274.items.filter(item => !order274.po_items.some(poi => poi.id === item.id));
out += "Missing in PO items for 274:\n" + missingInPo274.map(i => i.name + ' ' + i.size).join('\n') + '\n';

out += "--- 546 ---\n";
order546.po_items.forEach(poi => {
    out += `  ${poi.name} ${poi.size}: transactionIssued=${poi.transactionIssued}\n`;
});
out += `546 status: ${order546.status}, poSent: ${order546.poSent}\n`;

fs.writeFileSync('./patch-analysis.txt', out);
