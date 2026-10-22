import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

import { daekyungInvoiceService } from '../server/services/daekyungInvoiceService.js';
import { invoiceArchiveService } from '../server/services/invoiceArchiveService.js';

console.log('--- 🚀 3-WAY MATCH & ARCHIVE END-TO-END TEST ---');

// 1. Simulate 2824 Page 2 invoice object
const sampleInvoice = {
    invoiceNo: 'No:0014- 2/ 2',
    invoiceDate: '2026-10-22',
    customerName: '알트에프(ALT.F)',
    poNumbers: ['ES261012-2824'],
    items: [
        { itemNo: 17, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 40A * 15A', quantity: 15, unit: 'EA', unitPrice: 19230, amount: 288450, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 18, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 40A * 20A', quantity: 15, unit: 'EA', unitPrice: 19230, amount: 288450, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 19, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 100A * 40A', quantity: 2, unit: 'EA', unitPrice: 66580, amount: 133160, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 20, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 125A * 50A', quantity: 2, unit: 'EA', unitPrice: 93770, amount: 187540, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 21, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 125A * 65A', quantity: 2, unit: 'EA', unitPrice: 93770, amount: 187540, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 22, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 150A * 50A', quantity: 2, unit: 'EA', unitPrice: 119830, amount: 239660, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 23, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 150A * 80A', quantity: 2, unit: 'EA', unitPrice: 119830, amount: 239660, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 24, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 150A * 100A', quantity: 2, unit: 'EA', unitPrice: 119830, amount: 239660, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 25, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 200A * 125A', quantity: 2, unit: 'EA', unitPrice: 241060, amount: 482120, poNo: 'ES261012-2824', remarks: '서울재고' },
        { itemNo: 26, type: 'PRODUCT', name: 'TEE', spec: 'STS 316L-W S/10S ERW 200A * 150A', quantity: 2, unit: 'EA', unitPrice: 241060, amount: 482120, poNo: 'ES261012-2824', remarks: '서울재고' }
    ],
    pricing: {
        totalSupplyPrice: 8362220,
        freightPrice: 0,
        subtotal: 8362220,
        vat: 836222,
        grandTotal: 9198442
    },
    rawText: '대경벤드 2824 거래명세서 2페이지',
    fileName: '대경벤드_거래명세표_2824_P2.pdf',
    pdfBuffer: Buffer.from('%PDF-1.4 Mock Invoice Content for Testing')
};

async function run() {
    // 2. Dispatch
    const dispatchRes = await daekyungInvoiceService.processAndDispatch(sampleInvoice, 'SYSTEM_TEST');
    console.log('✅ Dispatch Result:');
    console.log('- Pricing:', dispatchRes.pricing);
    console.log('- CrossCheck:', dispatchRes.crossCheck?.statusText);

    // 3. Search Archive
    console.log('\n--- 🔍 TESTING ARCHIVE SEARCH ---');
    const q1 = invoiceArchiveService.searchArchive('2026-10-22 거래명세표 찾아줘');
    console.log(`Query '2026-10-22 거래명세표 찾아줘' Result Count:`, q1.length);
    if (q1[0]) {
        console.log(`- Date: ${q1[0].date}, No: ${q1[0].invoiceNo}, GrandTotal: ${q1[0].pricing?.grandTotal?.toLocaleString()}원`);
        console.log(`- Stored Invoice: ${q1[0].invoiceFile?.path}`);
        console.log(`- Matched Certs Count: ${q1[0].certificates?.length}`);
    }

    const q2 = invoiceArchiveService.searchArchive('2824 성적서 찾아줘');
    console.log(`\nQuery '2824 성적서 찾아줘' Result Count:`, q2.length);
    if (q2[0]) {
        console.log(`- PO: ${q2[0].poNumbers?.join(', ')}, Cert Status: ${q2[0].matchResult?.summaryMessage}`);
    }

    // 4. Verify supplier_invoices.json pricing
    const invPath = path.join(ROOT_DIR, 'server/data/supplier_invoices.json');
    const invoices = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    const matched = invoices.find(i => i.invoiceNo === sampleInvoice.invoiceNo && i.invoiceDate === sampleInvoice.invoiceDate);
    console.log('\n--- 📋 SUPPLIER INVOICE RECORD VERIFICATION ---');
    console.log(`Record in supplier_invoices.json:`);
    console.log(`- Grand Total: ${matched?.pricing?.grandTotal?.toLocaleString()}원 (Expected: 9,198,442원)`);
    console.log(`- Subtotal: ${matched?.pricing?.subtotal?.toLocaleString()}원`);
    console.log(`- VAT: ${matched?.pricing?.vat?.toLocaleString()}원`);
    console.log(`- Status: ${matched?.accounting?.status}`);
}

run().catch(console.error);
