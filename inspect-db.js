import { loadDbFromS3, saveDbToS3 } from './s3-db.js';

async function main() {
    console.log("Loading DB...");
    const db = await loadDbFromS3();
    
    console.log("=== Order 472 (Customer: 경남배관) ===");
    const order472 = db.orders.find(o => o.id.includes('472') || (o.customerName && o.customerName.includes('경남배관') && o.id.includes('472')));
    if (order472) {
        console.log("Order 472 ID:", order472.id);
        console.log("Items:", JSON.stringify(order472.items.map(i => ({ no: i.no, spec: i.spec, order_qty: i.order_qty, qty: i.qty, missingParam: i.missingParam || 'none', isPendingRemoved: i.isPendingRemoved, status: i.status })), null, 2));
    } else {
        // Just search by 472
        const p472 = db.orders.find(o => o.id.includes('472'));
        if (p472) {
             console.log("Found 472:", p472.id, "Customer:", p472.customerName);
             console.log("Items length:", p472.items?.length);
        } else {
             console.log("Order 472 not found by ID. Searching by customer '경남배관'...");
             const kn = db.orders.filter(o => o.customerName && o.customerName.includes('경남배관'));
             console.log("Found", kn.length, "orders for 경남배관");
             if (kn.length > 0) {
                 console.log("IDs:", kn.map(k => k.id).join(', '));
             }
        }
    }

    console.log("\n=== Order 546 (Customer: 티에스밸브) ===");
    const p546 = db.orders.find(o => o.id.includes('546'));
    if (p546) {
        console.log("Found 546:", p546.id, "Status:", p546.status);
        console.log("isSalesInvoiceIssued:", p546.isSalesInvoiceIssued, "isPurchaseInvoiceIssued:", p546.isPurchaseInvoiceIssued);
    } else {
        console.log("Order 546 not found.");
    }

    console.log("\n=== Order 274 (Customer: 한창엔지니어링) ===");
    const p274 = db.orders.find(o => o.id.includes('274'));
    if (p274) {
        console.log("Found 274:", p274.id);
        console.log("Items:", JSON.stringify(p274.items.map(i => ({ no: i.no, spec: i.spec, isPendingRemoved: i.isPendingRemoved, comments: i.comments?.length || 0 })), null, 2));
    } else {
        console.log("Order 274 not found.");
    }
}

main().catch(console.error);
