const fs = require('fs');
let c = fs.readFileSync('src/pages/admin/SihwaInventory.tsx', 'utf8');

// Replace duplicate bg-purple mapping
c = c.replace(/\s*row\.healthGrade === 'A' \? 'bg-purple-100 text-purple-700' :/g, '');

// Replace duplicate text mapping
c = c.replace(/\{row\.healthGrade === 'A' \? 'A급' :\s*row\.healthGrade === 'A' \? 'A급' :/g, "{row.healthGrade === 'A' ? 'A급' :");

fs.writeFileSync('src/pages/admin/SihwaInventory.tsx', c);
console.log('Cleaned duplicates');
