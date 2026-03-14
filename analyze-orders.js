import fs from 'fs';

const orders = JSON.parse(fs.readFileSync('./live-orders.json', 'utf8'));

for (const o of orders) {
    console.log(`Order ID: ${o.id}, PO: ${o.poNumber}, Customer: ${o.customerName}`);
    console.log(`  Items: ${o.items?.length}`);
    if (o.po_items) console.log(`  PO Items: ${o.po_items?.length}`);
    
    // Look for missing 472 item #4, 546 discrepancy, 274 missing item
    if (o.id.includes('472') || (o.poNumber || '').includes('472')) {
        console.log("  >>> Found 472!");
        if (o.items) o.items.forEach((item, idx) => console.log(`    Item ${idx+1}: ${item.name} ${item.size} - Qty: ${item.quantity}`));
    }
    if (o.id.includes('546') || (o.poNumber || '').includes('546')) {
        console.log("  >>> Found 546!");
    }
    if (o.id.includes('274') || (o.poNumber || '').includes('274')) {
        console.log("  >>> Found 274!");
        if (o.items) o.items.forEach((item, idx) => console.log(`    Item ${idx+1}: ${item.name} ${item.size} - Qty: ${item.quantity}`));
    }
}
