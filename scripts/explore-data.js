import fs from 'fs';

const INVENTORY_URL = 'https://altf-web-data-prod.s3.ap-northeast-2.amazonaws.com/public/inventory/inventory.json';

async function exploreData() {
    console.log('Fetching...');
    const res = await fetch(INVENTORY_URL);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items;

    console.log(`Total Items: ${items.length}`);

    let countShQty = 0;
    let countLoc1 = 0;
    let countMaker1 = 0;
    let examples = [];

    items.forEach(item => {
        const sh = Number(item.sh_qty || 0);
        const loc1 = item.location1;
        const mak1 = item.maker1;

        if (sh > 0 || loc1 || mak1) {
            if (sh > 0) countShQty++;
            if (loc1) countLoc1++;
            if (mak1) countMaker1++;

            if (examples.length < 5) {
                examples.push({
                    sku: item.sku_key,
                    ready: item.ready_qty,
                    sh_qty: item.sh_qty,
                    loc: item.location,
                    loc1: item.location1,
                    mak: item.maker,
                    mak1: item.maker1,
                    od_eq: item.od_eq_key
                });
            }
        }
    });

    console.log(`Items with sh_qty > 0: ${countShQty}`);
    console.log(`Items with location1: ${countLoc1}`);
    console.log(`Items with maker1: ${countMaker1}`);
    console.log('Examples:', JSON.stringify(examples, null, 2));
}

exploreData();
