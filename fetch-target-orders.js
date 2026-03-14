import fs from 'fs';
import fetch from 'node-fetch';

async function fetchOrder(orderIdPattern) {
    const API_URL = 'https://altf-api.onrender.com/api/my/orders';
    const headers = {
        'x-requester-id': 'admin@altf.kr',
        'x-requester-role': 'MASTER',
        'Content-Type': 'application/json'
    };
    try {
        const response = await fetch(API_URL, { headers });
        const orders = await response.json();
        const found = orders.find(o => o.poNumber?.includes(orderIdPattern) || o.id.includes(orderIdPattern) || o.customerName?.includes(orderIdPattern));
        if (found) {
            fs.writeFileSync(`order-${orderIdPattern}.json`, JSON.stringify(found, null, 2));
            console.log(`Saved order ${orderIdPattern} to order-${orderIdPattern}.json`);
        } else {
            console.log(`Order ${orderIdPattern} not found.`);
        }
    } catch (e) {
        console.error(e);
    }
}

fetchOrder('552');
fetchOrder('554');
