/**
 * 📊 요율점검 봇 (SLE-07 / Rate Review & History Recommendation Agent)
 * 
 * [원칙 및 대전제]:
 * 1. 시스템 전체의 요율 로직을 임의로 훼손하거나 수정하지 않고,
 *    뒷단의 잘 만들어진 시스템(inventory.json 품목코드, base_price, rate_pct, unitPrice)을 100% 신뢰하고 이용합니다.
 * 2. 통상적인 시스템 기준 기본값:
 *    - ERW(용접, -W): 50% (또는 inventory.json 등록 요율)
 *    - SMLS(심리스, -S): 25%
 * 3. 최근 해당 업체의 견적/발주 이력 요율을 자동 검색하고 비교/추천합니다.
 * 4. 발화 텍스트(txt)에 영업자 또는 고객의 명시적 요율 변경 요청(예: "52%", "-48%", "DC 55%")이 있을 때만,
 *    이를 사유와 함께 시스템에 기록하고 해당 요율을 적용하여 견적서를 작성합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');
const INVENTORY_FILE = path.join(ROOT_DIR, 'public/api/inventory/inventory.json');

export class RateReviewService {
    constructor() {
        this.inventoryMap = new Map();
        this.loadInventory();
    }

    loadInventory() {
        try {
            if (fs.existsSync(INVENTORY_FILE)) {
                const raw = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
                for (const item of raw) {
                    if (item.id) {
                        this.inventoryMap.set(item.id.trim(), item);
                    }
                }
            }
        } catch (e) {
            console.error('[RateReviewService] 인벤토리 로드 실패:', e.message);
        }
    }

    /**
     * 1. 텍스트 내 영업자/고객의 명시적 요율 변경 요청 감지
     * @param {string} text 원문 텍스트 (카카오 발화문, 메모 등)
     * @returns {Object|null} { requestedRate: number, reason: string }
     */
    parseExplicitRateRequest(text = '') {
        if (!text || typeof text !== 'string') return null;

        const clean = text.trim();
        // 1) "-52%", "요율 52%", "52프로", "50%적용", "DC 55%", "단가 48%"
        const rateMatch = clean.match(/(?:[-~]?\s*([0-9]{1,2})\s*(?:%|프로|요율))|(?:(?:요율|DC|할인|단가)\s*[-~:]?\s*([0-9]{1,2}))/i);

        if (rateMatch) {
            const rawRate = parseInt(rateMatch[1] || rateMatch[2], 10);
            if (rawRate >= 10 && rawRate <= 90) {
                return {
                    requestedRate: rawRate,
                    reason: `영업자/고객 텍스트 명시적 요율 변경 요청 (-${rawRate}%)`
                };
            }
        }

        return null;
    }

    /**
     * 2. 품목코드 기준 시스템 표준 요율 및 단가 산출
     * - inventory.json에 rate_pct가 있으면 그 값을 신뢰
     * - 없으면 SMLS(-S)는 25%, ERW(-W)는 50% 디폴트 준수
     */
    getSystemItemRate(item) {
        const itemId = item.itemId || item.productId || `${item.type || item.name}-${item.schedule || item.thickness}-${item.size}-${item.material}`;
        const matched = this.inventoryMap.get(itemId);

        // inventory.json에 명시된 기본 요율
        let systemRate = matched?.rate_pct;
        const isSmls = (item.material && item.material.endsWith('-S')) || 
                      (item.schedule && ['S80S', 'S160S', 'XXS'].includes(item.schedule)) || 
                      (item.type === 'CAP');

        if (systemRate === undefined || systemRate === null || systemRate === 0) {
            // 통상적인 시스템 디폴트: SMLS는 25%, ERW는 50%
            systemRate = isSmls ? 25 : 50;
        }

        const basePrice = (matched && matched.base_price > 0) ? matched.base_price : (item.basePrice || item.base_price || 0);
        const unitPrice = (matched && matched.unitPrice > 0) 
            ? matched.unitPrice 
            : Math.round(basePrice * (1 - systemRate / 100));

        return {
            itemId,
            isSmls,
            systemRate,
            basePrice,
            unitPrice,
            matchedInDb: !!matched
        };
    }

    /**
     * 3. 해당 거래처의 최근 견적서 및 발주서 요율 이력 검색
     * @param {string} customerName 고객사명
     * @param {Array} quotationHistory 전체 견적서 배열
     * @param {Array} orderHistory 전체 발주서/주문서 배열
     */
    findCustomerRateHistory(customerName, quotationHistory = [], orderHistory = []) {
        if (!customerName) return { recentQuoteRate: null, recentOrderRate: null, historySamples: [] };

        const targetNameClean = customerName.replace(/\s+/g, '').replace(/주식회사|\(주\)/g, '');
        const historySamples = [];

        // 1) 견적서 이력 검색 (최근 순)
        for (const q of (quotationHistory || [])) {
            if (q.isDeleted) continue;
            const qName = (q.customerName || q.customerInfo?.name || q.customerInfo?.companyName || '').replace(/\s+/g, '').replace(/주식회사|\(주\)/g, '');
            if (qName && (qName.includes(targetNameClean) || targetNameClean.includes(qName))) {
                const sampleItem = (q.items || [])[0];
                const rate = sampleItem?.discountRate !== undefined ? sampleItem.discountRate : q.discountRate;
                if (rate !== undefined && rate !== null) {
                    historySamples.push({
                        type: 'QUOTATION',
                        id: q.id,
                        date: q.createdAt?.slice(0, 10) || '최근',
                        rate: Number(rate),
                        itemCount: q.items?.length || 0,
                        totalAmount: q.totalAmount || 0
                    });
                    if (historySamples.length >= 3) break;
                }
            }
        }

        // 2) 발주서/주문서 이력 검색
        for (const o of (orderHistory || [])) {
            const oName = (o.customerName || o.customerInfo?.name || o.customerInfo?.companyName || '').replace(/\s+/g, '').replace(/주식회사|\(주\)/g, '');
            if (oName && (oName.includes(targetNameClean) || targetNameClean.includes(oName))) {
                const sampleItem = (o.items || [])[0];
                const rate = sampleItem?.discountRate !== undefined ? sampleItem.discountRate : o.discountRate;
                if (rate !== undefined && rate !== null) {
                    historySamples.push({
                        type: 'ORDER',
                        id: o.id,
                        date: o.orderDate?.slice(0, 10) || o.createdAt?.slice(0, 10) || '최근',
                        rate: Number(rate),
                        itemCount: o.items?.length || 0,
                        totalAmount: o.totalAmount || 0
                    });
                    if (historySamples.length >= 5) break;
                }
            }
        }

        const recentQuoteRate = historySamples.find(h => h.type === 'QUOTATION')?.rate ?? null;
        const recentOrderRate = historySamples.find(h => h.type === 'ORDER')?.rate ?? null;

        return {
            recentQuoteRate,
            recentOrderRate,
            historySamples
        };
    }

    /**
     * 4. [핵심] 품목별 최종 요율 및 단가 판정 (흔들림 없는 견적 작성)
     * - 영업자/고객 텍스트에 명시적 요청이 있을 때: 그 요율 적용 및 사유 기록
     * - 명시적 요청이 없을 때: 시스템 품목별 기준 요율(SMLS 25%, ERW 50% 등) 엄격 적용
     * - 최근 거래 이력 요율을 검토 리포트에 추천 형태로 함께 제공
     */
    evaluateQuotationRates({
        items = [],
        customerName = '',
        rawUtterance = '',
        quotationHistory = [],
        orderHistory = []
    }) {
        // 1) 텍스트 내 명시적 요율 변경 지시 확인
        const explicitRequest = this.parseExplicitRateRequest(rawUtterance);

        // 2) 해당 고객사 최근 거래 요율 이력 조회
        const history = this.findCustomerRateHistory(customerName, quotationHistory, orderHistory);

        // 3) 품목별 요율 및 단가 계산
        let totalAmount = 0;
        const processedItems = items.map((it, idx) => {
            const sys = this.getSystemItemRate(it);
            const qty = Number(it.qty !== undefined ? it.qty : (it.quantity || 1));

            // 최종 적용 요율 결정
            let finalRate = sys.systemRate; // 기본은 시스템 표준 (SMLS 25, ERW 50)
            let rateSource = `시스템 표준 요율 (${sys.isSmls ? '심리스 SMLS -25%' : '용접 ERW -50%'})`;

            if (explicitRequest) {
                // 명시적 요청이 있는 경우만 예외적으로 덮어씀
                finalRate = explicitRequest.requestedRate;
                rateSource = explicitRequest.reason;
            }

            const basePrice = sys.basePrice > 0 ? sys.basePrice : (it.basePrice || it.base_price || 0);
            const unitPrice = Math.round(basePrice * (1 - finalRate / 100));
            const amount = unitPrice * qty;
            totalAmount += amount;

            return {
                id: it.id || `item-${Date.now()}-${idx}`,
                productId: sys.itemId,
                itemId: sys.itemId,
                name: it.type || it.name,
                thickness: it.schedule || it.thickness,
                size: it.size,
                material: it.material,
                quantity: qty,
                unitPrice,
                userUnitPrice: unitPrice,
                amount,
                base_price: basePrice,
                basePrice,
                discountRate: finalRate,
                rateSource,
                currentStock: it.currentStock !== undefined ? it.currentStock : 999,
                location: it.location || '양산',
                maker: it.maker || '대경',
                stockStatus: it.stockStatus || 'AVAILABLE',
                isVerified: true,
                isSelected: true
            };
        });

        // 4) 요율점검 봇(SLE-07) 심사 리포트
        const report = {
            hasExplicitRequest: !!explicitRequest,
            explicitReason: explicitRequest ? explicitRequest.reason : '명시적 요율 요청 없음 (시스템 표준 요율 유지)',
            recentHistoryRate: history.recentQuoteRate || history.recentOrderRate || null,
            historySamples: history.historySamples,
            isConsistent: !explicitRequest || (explicitRequest.requestedRate === history.recentQuoteRate),
            summaryMessage: explicitRequest 
                ? `⚠️ [SLE-07 요율점검봇] ${explicitRequest.reason} ➔ 견적서 반영 완료`
                : `✅ [SLE-07 요율점검봇] 시스템 표준 요율(SMLS 25%, ERW 50%)을 흔들림 없이 정상 적용함`
        };

        return {
            items: processedItems,
            totalAmount,
            rateReport: report
        };
    }
}

export const rateReviewService = new RateReviewService();
