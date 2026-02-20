
import http from 'http';
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
});
server.listen(3002, () => {
    console.log('Test server listening on port 3002');
});
