import https from 'https';
import fs from 'fs';

const API_URL = 'https://altf-api.onrender.com/api/my/orders';

const options = {
    headers: {
        'Content-Type': 'application/json',
        'x-requester-id': 'admin',
        'x-requester-role': 'MASTER'
    }
};

https.get(API_URL, options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        try {
            const orders = JSON.parse(data);
            console.log(`Fetched ${orders.length} orders.`);
            
            const targetOrders = orders.filter(o => 
                o.poNumber?.includes('472') || 
                o.id.includes('472') || 
                o.poNumber?.includes('546') || 
                o.id.includes('546') ||
                o.poNumber?.includes('274') || 
                o.id.includes('274') ||
                o.customerName?.includes('경남배관') ||
                o.customerName?.includes('티에스밸브') ||
                o.customerName?.includes('한창엔지니어링') ||
                (o.payload?.customer?.contact_name || '').includes('경남배관') ||
                (o.payload?.customer?.company_name || '').includes('경남배관')
            );
            
            console.log(`Found ${targetOrders.length} target orders.`);
            fs.writeFileSync('./live-orders.json', JSON.stringify(targetOrders, null, 2));
            console.log('Saved to live-orders.json');
        } catch(e) {
            console.error('Error parsing JSON:', e.message);
        }
    });

}).on('error', (e) => {
    console.error(e);
});
