import { readFileSync, writeFileSync } from 'fs';
function main() {
    const data = readFileSync('./data/db.json', 'utf8');
    const db = JSON.parse(data);
    
    let res = { keys: Object.keys(db) };
    
    for (const key of Object.keys(db)) {
        if (Array.isArray(db[key])) {
            const matches = db[key].filter(i => JSON.stringify(i).includes('546'));
            if (matches.length > 0) {
                 res[key + '_matches'] = matches.map(m => m.id || "no_id");
            }
        }
    }
    
    writeFileSync('./inspect-out-local.json', JSON.stringify(res, null, 2));
}
main();
