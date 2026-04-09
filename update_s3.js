import fs from 'fs';
import { loadDbFromS3, saveDbToS3 } from './s3-db.js';

async function update() {
    console.log("Loading S3 DB...");
    const db = await loadDbFromS3();
    
    console.log("Loading Local Customers...");
    const customersJson = JSON.parse(fs.readFileSync('./data/customers.json', 'utf8'));
    
    console.log(`Loaded ${customersJson.length} customers.`);
    db.customers = customersJson;
    
    console.log("Saving back to S3...");
    await saveDbToS3(db);
    console.log("Done.");
}

update().catch(console.error);
