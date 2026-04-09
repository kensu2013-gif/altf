const XLSX = require('xlsx');
const fs = require('fs');

try {
    const workbook = XLSX.readFile('./알트에프 거래처.xlsx');
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);
    console.log(data.slice(0, 5));
    fs.writeFileSync('./src/data/customers_raw.json', JSON.stringify(data, null, 2));
    console.log('Saved to src/data/customers_raw.json');
} catch (e) {
    console.error(e);
}
