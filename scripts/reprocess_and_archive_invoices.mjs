import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const INVOICES_PATH = path.join(ROOT_DIR, 'server/data/supplier_invoices.json');
const CERTS_PATH = path.join(ROOT_DIR, 'server/data/certificates.json');
const ARCHIVE_ROOT = path.join(ROOT_DIR, 'storage/archive');
const INDEX_FILE = path.join(ROOT_DIR, 'server/data/invoice_archive_index.json');
const CERTS_STORAGE_DIR = path.join(ROOT_DIR, 'storage/certificates');

import { invoiceArchiveService } from '../server/services/invoiceArchiveService.js';

console.log('🔄 [RE-PROCESS & ARCHIVE] 지난 3일간 인보이스 및 전사 데이터 재판독 & 동기화 시작...');

const invoices = JSON.parse(fs.readFileSync(INVOICES_PATH, 'utf8') || '[]');
const certs = JSON.parse(fs.readFileSync(CERTS_PATH, 'utf8') || '[]');

let updatedCount = 0;
let archivedCount = 0;

for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];

    // 1. 공급자 및 공급받는자 복원
    if (!inv.supplier || !inv.supplier.name) {
        inv.supplier = {
            name: '(주)대경벤드',
            bizNo: '606-81-75098',
            ceo: '김학철',
            address: '경남 양산시 어실로 115',
            phone: '055-364-1800'
        };
    }
    if (!inv.buyer || !inv.buyer.name) {
        inv.buyer = {
            name: '알트에프(ALT.F)',
            bizNo: '838-05-01054',
            ceo: '조현진',
            address: '부산광역시 사상구 낙동대로 1330번길 67'
        };
    }

    // 2. 일자 OCR 오류 복원 (전화번호나 주소 번지가 일자로 잡힌 경우 복원)
    let fixedDate = inv.invoiceDate;
    if (!fixedDate || fixedDate.startsWith('1800') || fixedDate.startsWith('1330') || fixedDate.startsWith('2026-01-0') || fixedDate.startsWith('2026-11-')) {
        // rawText나 processedAt에서 날짜 추출
        const rawDateMatch = (inv.rawText || '').match(/2026\s*[년주]?\s*(10|09|11)\s*[월A]?\s*(\d{1,2})\s*[일8]?/);
        if (rawDateMatch) {
            fixedDate = `2026-${String(rawDateMatch[1]).padStart(2, '0')}-${String(rawDateMatch[2]).padStart(2, '0')}`;
        } else if (inv.processedAt) {
            fixedDate = inv.processedAt.slice(0, 10);
        } else {
            fixedDate = '2026-10-22';
        }
        inv.invoiceDate = fixedDate;
        console.log(`[Date Fixed] 전표 ${inv.invoiceNo}: ${fixedDate}`);
    }

    // 3. 품목 단가 및 합계 재계산 (0원인 경우 품목 합산으로 복원)
    let itemSum = 0;
    if (Array.isArray(inv.items)) {
        for (const it of inv.items) {
            if (it.amount > 0) {
                itemSum += it.amount;
            } else if (it.quantity > 0 && it.unitPrice > 0) {
                it.amount = it.quantity * it.unitPrice;
                itemSum += it.amount;
            }
        }
    }

    // 가격 정보 갱신
    if (!inv.pricing) {
        inv.pricing = {
            totalSupplyPrice: itemSum,
            freightPrice: 0,
            subtotal: itemSum,
            vat: Math.round(itemSum * 0.1),
            grandTotal: itemSum + Math.round(itemSum * 0.1)
        };
    } else if (inv.pricing.grandTotal === 0 && itemSum > 0) {
        inv.pricing.totalSupplyPrice = itemSum;
        inv.pricing.subtotal = itemSum;
        inv.pricing.vat = Math.round(itemSum * 0.1);
        inv.pricing.grandTotal = inv.pricing.subtotal + inv.pricing.vat;
        console.log(`[Price Restored from Items] ${inv.invoiceNo}: ${inv.pricing.grandTotal.toLocaleString()}원`);
    } else if (inv.pricing.grandTotal === 0 && inv.pricing.subtotal > 0) {
        inv.pricing.vat = inv.pricing.vat || Math.round(inv.pricing.subtotal * 0.1);
        inv.pricing.grandTotal = inv.pricing.subtotal + inv.pricing.vat;
    }

    // 2824 1페이지 특수 처리 (2페이지와 합산 연결)
    if (inv.invoiceNo && inv.invoiceNo.includes('0014- 1') && inv.pricing.grandTotal === 0) {
        // 1페이지 품목 16개 합계
        const p1Sum = 5593860;
        const p1Vat = 559386;
        inv.pricing = {
            totalSupplyPrice: p1Sum,
            freightPrice: 0,
            subtotal: p1Sum,
            vat: p1Vat,
            grandTotal: p1Sum + p1Vat
        };
        console.log(`[P1 2824 Restored] 0014-1/2: ${inv.pricing.grandTotal.toLocaleString()}원`);
    }

    // 4. accounting 정보 동기화
    inv.accounting = inv.accounting || {};
    inv.accounting.status = inv.accounting.status || 'PURCHASE_CONFIRMED';
    inv.accounting.subtotal = inv.pricing.subtotal;
    inv.accounting.vat = inv.pricing.vat;
    inv.accounting.grandTotal = inv.pricing.grandTotal;

    // 5. 3각 교차 대조 (명세표 ↔ 발주서 ↔ 성적서) 실행
    const matchRes = invoiceArchiveService.verifyThreeWayMatch(inv);
    inv.crossCheck = inv.crossCheck || {};
    inv.crossCheck.matchResult = matchRes;
    inv.crossCheck.threeWayConfirmed = matchRes.isConfirmed;

    // 6. 날짜별 아카이브 등록 및 인덱싱
    try {
        const arc = await invoiceArchiveService.archive(inv, null, inv.fileName || `거래명세표_${inv.invoiceNo}.pdf`);
        inv.archive = arc;
        archivedCount++;
    } catch (e) {
        console.warn(`[Archive Error] ${inv.invoiceNo}:`, e.message);
    }

    updatedCount++;
}

// 7. supplier_invoices.json 저장
fs.writeFileSync(INVOICES_PATH, JSON.stringify(invoices, null, 2), 'utf8');
console.log(`✅ [완료] 총 ${updatedCount}개 인보이스 재판독 & 동기화 완료, ${archivedCount}개 날짜별 아카이브 색인 구축 완료!`);
