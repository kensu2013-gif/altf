const fs = require('fs');
const content = fs.readFileSync('src/hooks/useInventory.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
    if (line.includes('`')) {
        console.log(`Line ${i + 1}: ${line}`);
    }
});
