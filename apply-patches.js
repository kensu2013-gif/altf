import fs from 'fs';
import https from 'https';

const API_URL = 'https://altf-api.onrender.com/api/my/orders/';
const headers = {
    'Content-Type': 'application/json',
    'x-requester-id': 'admin',
    'x-requester-role': 'MASTER'
};

const orders = JSON.parse(fs.readFileSync('./live-orders.json', 'utf8'));

const order472 = orders.find(o => o.poNumber === 'ES260305-472' || o.id === 'PO-20260305-TAEIL-007');
const order546 = orders.find(o => o.poNumber === 'ES260310-546' || o.id === 'PO-20260310-TAEIL-017');

function patchOrder(orderId, payload) {
    return new Promise((resolve, reject) => {
        const req = https.request(API_URL + orderId, { method: 'PATCH', headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
    });
}

async function run() {
    // 1. Patch 472
    if (order472) {
        const missing = order472.items.find(item => item.name.includes('45E(L)') && item.amount === 1227360); // Qty=3 
        // wait, let's just find the one that is missing!
        const missingInPo = order472.items.filter(item => !order472.po_items.some(poi => poi.id === item.id));
        if (missingInPo.length > 0) {
            const newPoItems = [...order472.po_items];
            const origIndex = order472.items.findIndex(i => i.id === missingInPo[0].id);
            newPoItems.splice(origIndex, 0, {...missingInPo[0], poSent: true, vendorName: order472.supplierInfo?.company_name || ''});
            
            console.log("Patching 472:", await patchOrder(order472.id, { po_items: newPoItems }));
        }
    }

    // 2. Patch 546
    if (order546) {
        const newPoItems = order546.po_items.map(poi => ({ ...poi, transactionIssued: true }));
        console.log("Patching 546:", await patchOrder(order546.id, { po_items: newPoItems }));
    }
}
run();
