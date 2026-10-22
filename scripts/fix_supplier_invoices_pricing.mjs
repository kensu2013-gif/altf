import fs from 'fs';

const path = 'server/data/supplier_invoices.json';
if (fs.existsSync(path)) {
    const invoices = JSON.parse(fs.readFileSync(path, 'utf8'));
    let fixedCount = 0;
    for (const inv of invoices) {
        if (inv.pricing) {
            const subtotal = inv.pricing.subtotal || 0;
            let vat = inv.pricing.vat || 0;
            let grandTotal = inv.pricing.grandTotal || 0;

            if (subtotal > 0 && (grandTotal === 0 || !grandTotal)) {
                if (vat === 0) vat = Math.round(subtotal * 0.1);
                grandTotal = subtotal + vat;
                inv.pricing.vat = vat;
                inv.pricing.grandTotal = grandTotal;
                fixedCount++;
            }
        }
    }
    fs.writeFileSync(path, JSON.stringify(invoices, null, 2), 'utf8');
    console.log(`✅ Fixed ${fixedCount} historical invoice pricing records in supplier_invoices.json`);
}
