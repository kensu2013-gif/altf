import http from 'http';
import fs from 'fs';

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/my/quotations',
  method: 'GET'
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
     let success = false;
     try {
       const parsed = JSON.parse(data);
       success = true;
     } catch(e) {}
     
     if (success) {
        console.log("Quotations fetched. Length:", JSON.parse(data).length);
        fs.writeFileSync('./inspect-out-local.json', data);
     } else {
        console.log("Failed. Status:", res.statusCode, "Body:", data);
     }
  });
});

req.on('error', e => {
  console.error("HTTP Error:", e.message);
});
req.end();
