import fs from 'fs';
const data = JSON.parse(fs.readFileSync('./data/db.json', 'utf8'));

const order274Local = data.orders?.find(o => o.poNumber === 'ES260204-274' || o.id === 'PO-20260304-TAEIL-029' || (o.poNumber || '').includes('274'));

if (order274Local) {
    console.log("Found 274 in local db.json");
    console.log(`Local Items count: ${order274Local.items?.length}`);
    console.log(`Local PO Items count: ${order274Local.po_items?.length}`);
    fs.writeFileSync('./order274-local.json', JSON.stringify(order274Local, null, 2));
} else {
    // maybe it's in a different file? How about we use jq/grep?
    console.log("Not found in local db.json orders array.");
    
    // search all keys
    for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
             const m = data[key].find(o => JSON.stringify(o).includes('274'));
             if (m) console.log("Found in key:", key, "id:", m.id);
        }
    }
}
