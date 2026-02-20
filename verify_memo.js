import http from 'http';

function postQuotation(memo) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            userId: 'test-user-' + Date.now(),
            customerName: 'Test Customer',
            items: [],
            totalAmount: 1000,
            memo: memo
        });

        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/my/quotations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    resolve(JSON.parse(body));
                } else {
                    reject(`POST failed: ${res.statusCode} ${body}`);
                }
            });
        });

        req.on('error', (e) => reject(`POST error: ${e.message}`));
        req.write(data);
        req.end();
    });
}

async function verify() {
    const memo = 'Test Memo ' + Date.now();
    try {
        console.log('Sending Quotation with Memo:', memo);
        const result = await postQuotation(memo);
        console.log('Response:', result);

        if (result.memo === memo) {
            console.log('SUCCESS: Memo persisted in response.');
        } else {
            console.error('FAILURE: Memo NOT found in response. Server might need restart.');
        }

    } catch (e) {
        console.error('Verification Failed:', e);
    }
}

verify();
