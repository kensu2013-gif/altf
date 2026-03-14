import fs from 'fs';
const orders = JSON.parse(fs.readFileSync('./live-orders.json', 'utf8'));
const order274 = orders.find(o => o.poNumber === 'ES260204-274' || o.id === 'PO-20260304-TAEIL-029');

console.log(`PO Number: ${order274.poNumber}, ID: ${order274.id}`);
console.log(`Current items: ${order274.items.length}`);
if (order274.payload && order274.payload.items) {
    console.log(`Original payload items: ${order274.payload.items.length}`);
    const originalNames = order274.payload.items.map(i => i.item_name + ' ' + i.size).join(', ');
    console.log("Original items:", originalNames);
    
    // Find missing
    const missing = order274.payload.items.filter(oi => !order274.items.some(ci => (ci.name === oi.item_name || ci.name === oi.name) && ci.size === oi.size));
    
    console.log("Missing completely from current items:", missing.map(i => i.item_name + ' ' + i.size));
} else {
    console.log("No payload found.");
}

// Let's also check if there are any comments orphaned anywhere? Or if the item is just marked isDeleted=true in `po_items`?
