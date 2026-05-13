const fs = require('fs');
let prev = fs.readFileSync('previous.tsx', 'utf8').split('\n');
let curr = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8').split('\n');

let pl = prev.find(l => l.includes('N: 0,   //'));
let cl = curr.find(l => l.includes('N: 0,   //'));

function p(s) {
    return s.replace(/[^a-zA-Z0-9\{\}\;\(\)\=\<\>\+\-\*\/\[\]\|\&\:\,\.\'\"_]/g, '');
}

console.log('pl:', pl);
console.log('cl:', cl);
console.log('p(pl):', p(pl));
console.log('p(cl):', p(cl));
console.log('equal:', p(pl) === p(cl));
