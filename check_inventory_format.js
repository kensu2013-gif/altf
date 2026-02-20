
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const inventoryPath = path.join(__dirname, 'public/api/inventory/inventory.json');

try {
    const data = fs.readFileSync(inventoryPath, 'utf8');
    const inventory = JSON.parse(data);

    // Search for T(S) 50A STS316L-W
    const targets = inventory.filter(item =>
        item.name === 'T(S)' &&
        item.size === '50A' &&
        item.material.includes('STS316L')
    );

    console.log("Matching Items (T(S) 50A):");
    console.log(JSON.stringify(targets, null, 2));

    // Also check for 125A X 80A
    const reducers = inventory.filter(item =>
        item.name === 'T(R)' &&
        item.thickness === 'S40S' &&
        item.material === 'STS316L-W'
    );
    console.log("\nMatching Reducers (T(R) S40S STS316L-W):");
    console.log(JSON.stringify(reducers.slice(0, 5), null, 2));

} catch (err) {
    console.error(err);
}
