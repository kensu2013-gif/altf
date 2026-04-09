const XLSX = require('xlsx');
const fs = require('fs');

const files = fs.readdirSync('.').filter(f => f.includes('data.xlsx') && !f.startsWith('._'));
console.log("Found:", files);

const workbook = XLSX.readFile(files[0]);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);
console.log("Columns:", Object.keys(data[0] || {}));
console.log("Sample:", data[0]);
