import fs from 'fs';
const data = JSON.parse(fs.readFileSync('./data/db.json', 'utf8'));
let out = '';
for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) {
        const matches = data[key].filter(o => JSON.stringify(o).includes('한창엔지니어링') || JSON.stringify(o).includes('한창'));
        for (const m of matches) {
            out += `Found in ${key}: ID=${m.id}, Date=${m.createdAt}\n`;
            if (m.items) {
                 m.items.forEach(i => out += `  - ${i.name} ${i.size} Qty: ${i.quantity}\n`);
            }
        }
    }
}
fs.writeFileSync('./hanchang-out.txt', out);
