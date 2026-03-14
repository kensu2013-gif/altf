import { readFileSync, writeFileSync } from 'fs';

function main() {
    const data = readFileSync('./data/db.json', 'utf8');
    const db = JSON.parse(data);
    
    console.log("=== Order 472 (Customer: 경남배관) ===");
    const order472 = db.orders.find(o => o.id.includes('472'));
    if (order472) {
        console.log("Order 472 found. Items mapping:");
        console.log(order472.items.map(i => ({ no: i.no, item_id: i.item_id, itemStatus: i.status || 'null', pendingRemoved: i.isPendingRemoved })));
    } else {
        console.log("Order 472 not found.");
    }

    console.log("\n=== Order 546 (Customer: 티에스밸브) ===");
    const order546 = db.orders.find(o => o.id.includes('546'));
    if (order546) {
        console.log("Order 546 found. Status:", order546.status, "Sales:", order546.isSalesInvoiceIssued, "Purchase:", order546.isPurchaseInvoiceIssued);
    } else {
        console.log("Order 546 not found.");
    }

    console.log("\n=== Order 274 (Customer: 한창엔지니어링) ===");
    const order274 = db.orders.find(o => o.id.includes('274'));
    if (order274) {
        console.log("Order 274 found. Items mapping:");
        console.log(order274.items.map(i => ({ no: i.no, item_id: i.item_id, spec: i.spec, pendingRemoved: i.isPendingRemoved })));
    } else {
        console.log("Order 274 not found.");
    }
}

main();
