import { loadDbFromS3 } from './s3-db.js';
loadDbFromS3().then(db => {
    const orders11 = db.orders.filter(o => o.createdAt.includes('2026-05-11') || (o.adminResponse?.deliveryDate || '').includes('2026-05-11'));
    console.log(`Found ${orders11.length} orders for 2026-05-11`);
    orders11.forEach(o => {
        console.log(`Order ${o.id}: Status=${o.status}, Customer=${o.customerName || o.payload?.customer?.company_name}, Items=${o.items?.length}`);
    });
}).catch(console.error);
