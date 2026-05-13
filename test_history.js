import { loadDbFromS3 } from './s3-db.js';
loadDbFromS3().then(db => {
    const history = db.inventoryHistory.find(h => h.date === '2026-05-11');
    if (history) {
        console.log(JSON.stringify(history, null, 2));
    } else {
        console.log("No history found for 2026-05-11");
    }
}).catch(console.error);
