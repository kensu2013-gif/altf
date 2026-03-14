import fs from 'fs';

const orders = JSON.parse(fs.readFileSync('./live-orders.json', 'utf8'));
let out = '';

for (const o of orders) {
    out += `Order ID: ${o.id}, PO: ${o.poNumber}, Customer: ${o.customerName}\n`;
    out += `  Items: ${o.items?.length}\n`;
    if (o.po_items) out += `  PO Items: ${o.po_items?.length}\n`;
    
    if (o.id.includes('472') || (o.poNumber || '').includes('472')) {
        out += "  >>> Found 472!\n";
        if (o.items) o.items.forEach((item, idx) => out += `    Item ${idx+1}: ${item.name} ${item.size} - Qty: ${item.quantity}\n`);
    }
    if (o.id.includes('546') || (o.poNumber || '').includes('546')) {
        out += "  >>> Found 546!\n";
    }
    if (o.id.includes('274') || (o.poNumber || '').includes('274')) {
        out += "  >>> Found 274!\n";
        if (o.items) o.items.forEach((item, idx) => out += `    Item ${idx+1}: ${item.name} ${item.size} - Qty: ${item.quantity}\n`);
    }
}

fs.writeFileSync('./analysis.txt', out);
