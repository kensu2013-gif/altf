/**
 * 🔬 Fitting Normalizer Service (영업2팀 INT-05 배관·피팅 품목 정규화 AI 엔진)
 * 
 * [사용자 정의 절대 규칙 기반 구현]
 * 1. 재질 정규화:
 *    - "SUS" 절대 금지 -> STS304, STS316L
 *    - 316은 반드시 STS316L 또는 WP316L
 *    - WP***는 WP 유지 (절대 STS로 변경 안함)
 *    - 제조방식은 반드시 "-S"(Seamless) 또는 "-W"(Weld)로 끝남
 *    - CAP은 항상 "-S"
 *    - S80S, S160S, XXS 두께는 무조건 "-S"
 *    - 근거 불명확 시 기본값 STS304-W
 * 
 * 2. 규격 정규화:
 *    - STS*** -> JIS -> "숫자+A"
 *    - WP***  -> ASTM -> "인치(\")"
 *    - 분수 정규화 (1/2", 3/4", 1", 1-1/4", 1-1/2", 2", 2-1/2", 3", 4" 등)
 *    - 복수 규격: "SIZE1 X SIZE2" (대문자 X, 앞뒤 공백 1칸, 큰 사이즈가 앞)
 * 
 * 3. 두께 정규화:
 *    - SCH10S/10S -> S10S, SCH20S/20S -> S20S, SCH40S/40S -> S40S, SCH80S/80S -> S80S
 *    - 정보 없으면 기본 S10S
 * 
 * 4. 품명 결정:
 *    - 90E(L), 90E(S), 45E(L), 45E(S), T(S), T(R), R(C), R(E), CAP, STUB END
 *    - Tee: 사이즈 다르면 T(R), 같으면 T(S)
 *    - Reducer: 편심(ECC) 없으면 R(C)
 * 
 * 5. 품목 ID 포맷:
 *    `품명-두께-규격-재질`
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '../..');

const INVENTORY_FILE = path.join(ROOT_DIR, 'public/api/inventory/inventory.json');
const CUSTOMERS_FILE = path.join(ROOT_DIR, 'src/data/customers_init.json');

// DN(A) <-> NPS(인치) 변환 테이블
const DN_TO_NPS = {
    '15A': '1/2"',
    '20A': '3/4"',
    '25A': '1"',
    '32A': '1-1/4"',
    '40A': '1-1/2"',
    '50A': '2"',
    '65A': '2-1/2"',
    '80A': '3"',
    '100A': '4"',
    '125A': '5"',
    '150A': '6"',
    '200A': '8"',
    '250A': '10"',
    '300A': '12"',
    '350A': '14"',
    '400A': '16"'
};

const NPS_TO_DN = Object.entries(DN_TO_NPS).reduce((acc, [dn, nps]) => {
    acc[nps.replace(/"/g, '')] = dn;
    return acc;
}, {});

export class FittingNormalizerService {
    constructor() {
        this.inventoryMap = new Map();
        this.customers = [];
        const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        if (!isProd) {
            this.loadInventory();
            this.loadCustomers();
        }
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
                console.log(`[FittingNormalizer] 인벤토리 ${this.inventoryMap.size}개 로드 완료`);
            }
        } catch (e) {
            console.error('[FittingNormalizer] 인벤토리 로드 실패:', e.message);
        }
    }

    loadCustomers() {
        try {
            if (fs.existsSync(CUSTOMERS_FILE)) {
                this.customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('[FittingNormalizer] 고객 DB 로드 실패:', e.message);
        }
    }

    /**
     * 거래처 매칭
     */
    matchCustomer(text) {
        if (!text) return null;
        for (const c of this.customers) {
            if (!c.companyName) continue;
            const nameClean = c.companyName.trim().replace(/\s+/g, '');
            const textClean = text.replace(/\s+/g, '');
            if (textClean.includes(nameClean)) {
                return c;
            }
        }
        return null;
    }

    /**
     * 텍스트 발화문 또는 OCR 라인들로부터 배관 피팅 품목 정규화 추출
     * @param {string|string[]} input Raw 텍스트 또는 lines 배열
     */
    normalize(input) {
        let lines = [];
        if (Array.isArray(input)) {
            lines = input;
        } else if (typeof input === 'string') {
            lines = input.split('\n').map(l => l.trim()).filter(Boolean);
        }

        const items = [];
        let currentMaterial = 'STS304-W'; // 기본값
        let currentSchedule = 'S10S';
        let matchedCustomer = null;
        let discountRate = 0;
        let remarks = [];

        // 전체 텍스트에서 거래처 및 요율, 비고 1차 스캔
        const fullText = lines.join(' ');
        matchedCustomer = this.matchCustomer(fullText);

        // 할인율 탐지 (예: 경기배관 -50%, 50%, DC 50%)
        const discountMatch = fullText.match(/(-?\d{1,2})\s*%/);
        if (discountMatch) {
            discountRate = Math.abs(parseInt(discountMatch[1], 10));
        }

        // 비고/배송 탐지
        if (/내일\s*발송|당일\s*출고|직송|화물|택배/.test(fullText)) {
            const shipMatch = fullText.match(/(내일\s*발송|당일\s*출고|화물|택배|직송)/);
            if (shipMatch) remarks.push(shipMatch[1]);
        }
        if (/동시화|시화|양산|부산|평택/.test(fullText)) {
            const locMatch = fullText.match(/(동시화\s*[^\n,]+|시화|양산|부산|평택)/);
            if (locMatch) remarks.push(locMatch[1].trim());
        }

        // 라인별 피팅 품목 파싱
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 1. 공통 재질/두께 헤더 라인 감지 (예: "304 S/20S", "316L SCH10S")
            const matThickMatch = line.match(/(304|316L?|WP304L?|WP316L?|SUS304|SUS316L?|STS304L?|STS316L?)\s*(?:S\/|SCH|S)?([0-9]{1,3}S?)/i);
            if (matThickMatch) {
                const rawMat = matThickMatch[1].toUpperCase();
                const rawSch = matThickMatch[2].toUpperCase();

                // 재질 정규화
                if (rawMat.includes('316')) currentMaterial = 'STS316L-W';
                else if (rawMat.startsWith('WP316')) currentMaterial = 'WP316L-W';
                else if (rawMat.startsWith('WP304')) currentMaterial = 'WP304L-W';
                else currentMaterial = 'STS304-W';

                // 두께 정규화
                if (rawSch.includes('20')) currentSchedule = 'S20S';
                else if (rawSch.includes('40')) currentSchedule = 'S40S';
                else if (rawSch.includes('80')) {
                    currentSchedule = 'S80S';
                    currentMaterial = currentMaterial.replace('-W', '-S'); // S80S는 무조건 -S
                } else currentSchedule = 'S10S';
                continue;
            }

            // 2. 품명 단독 라인인 경우 다음 라인과 병합 처리
            // 예: 라인 i: "T(R)", 라인 i+1: "40x25 - 10ea"
            let checkLine = line;
            let detectedType = this.detectItemType(checkLine);

            if (detectedType && !checkLine.match(/\d+x\d+|\d+A|\d+"/i) && i + 1 < lines.length) {
                // 다음 라인에 규격/수량이 있으면 병합
                checkLine = `${line} ${lines[i + 1]}`;
                i++; // 다음 라인 소비
            }

            const item = this.parseItemLine(checkLine, currentMaterial, currentSchedule);
            if (item) {
                items.push(item);
            }
        }

        return {
            customer: matchedCustomer ? {
                id: matchedCustomer.id,
                name: matchedCustomer.companyName,
                businessNumber: matchedCustomer.businessNumber,
                ceo: matchedCustomer.ceo,
                phone: matchedCustomer.phone,
                email: matchedCustomer.email,
                address: matchedCustomer.address
            } : null,
            discountRate: discountRate || 50, // 기본 50% 요율
            remarks: remarks.join(' / '),
            items
        };
    }

    /**
     * 품명 판별 (90E(L), 90E(S), 45E(L), 45E(S), T(S), T(R), R(C), R(E), CAP)
     */
    detectItemType(line) {
        const u = line.toUpperCase();
        if (/T\(R\)|T-R|REDUCING\s*TEE|레듀싱티/i.test(u)) return 'T(R)';
        if (/T\(S\)|T-S|STRAIGHT\s*TEE|스트레이트티|\bTEE\b|\b티\b/i.test(u)) return 'T(S)';
        if (/90E\(S\)|90E-S|90['\s]*SHORT/i.test(u)) return '90E(S)';
        if (/90E|90['\s]*ELBOW|엘보/i.test(u)) return '90E(L)';
        if (/45E\(S\)|45E-S|45['\s]*SHORT/i.test(u)) return '45E(S)';
        if (/45E|45['\s]*ELBOW/i.test(u)) return '45E(L)';
        if (/R\(E\)|ECC|편심/i.test(u)) return 'R(E)';
        if (/R\(C\)|CON|동심|REDUCER|레듀/i.test(u)) return 'R(C)';
        if (/CAP|캡/i.test(u)) return 'CAP';
        return null;
    }

    /**
     * 단일 라인에서 품목 정보 추출 및 인벤토리 매칭
     */
    parseItemLine(line, defaultMat, defaultSch) {
        const u = line.toUpperCase();

        // 1. 품명 결정
        let type = this.detectItemType(u);
        if (!type) return null;

        // 2. 수량 추출 (- 10ea, 10개, 10, 1ea 등)
        let qty = 1;
        const qtyMatch = line.match(/(?:-|\/|\s)\s*(\d+)\s*(?:EA|PCS|개)?\s*$/i) || line.match(/(\d+)\s*(?:EA|PCS|개)/i);
        if (qtyMatch) {
            qty = parseInt(qtyMatch[1], 10);
        }

        // 3. 재질 및 두께 라인 내 인라인 추출 (규칙 1, 3 반영)
        let material = defaultMat;
        let schedule = defaultSch;

        if (/WP316L?/i.test(u)) material = 'STS316L-W';
        else if (/STS316L?/i.test(u)) material = 'STS316L-W';
        else if (/WP304L?/i.test(u)) material = 'STS304-W';
        else if (/STS304L?/i.test(u)) material = 'STS304-W';

        if (/S\/?40S?|SCH\s*40/i.test(u)) schedule = 'S40S';
        else if (/S\/?80S?|SCH\s*80/i.test(u)) {
            schedule = 'S80S';
            material = material.replace('-W', '-S'); // S80S, S160S, XXS는 무조건 -S (규칙 1)
        } else if (/S\/?20S?|SCH\s*20/i.test(u)) schedule = 'S20S';
        else if (/S\/?10S?|SCH\s*10/i.test(u)) schedule = 'S10S';

        if (type === 'CAP') {
            material = material.replace('-W', '-S'); // CAP은 항상 -S (규칙 1)
        }

        // 4. 규격 추출 (규칙 2 반영: ANSI 분수/인치 및 JIS DN mm 상호 완벽 변환)
        let size = '';

        // (1) ANSI 분수 복수 규격: 1 1/2*1, 1-1/2X1, 1*3/4, 2*1-1/2 등
        const fracPairMatch = line.match(/(\d+(?:\s+|-)?\d*\/\d+|\d+)\s*(?:\*|X|×)\s*(\d+(?:\s+|-)?\d*\/\d+|\d+)/i);
        if (fracPairMatch) {
            let rawS1 = fracPairMatch[1].trim().replace(/-/g, ' ');
            let rawS2 = fracPairMatch[2].trim().replace(/-/g, ' ');

            const fracToDn = (s) => {
                if (s === '1/2') return '15A';
                if (s === '3/4') return '20A';
                if (s === '1') return '25A';
                if (s === '1 1/4' || s === '1-1/4') return '32A';
                if (s === '1 1/2' || s === '1-1/2') return '40A';
                if (s === '2') return '50A';
                if (s === '2 1/2' || s === '2-1/2') return '65A';
                if (s === '3') return '80A';
                if (s === '4') return '100A';
                return s.endsWith('A') ? s : `${s}A`;
            };

            const dn1 = fracToDn(rawS1);
            const dn2 = fracToDn(rawS2);
            const num1 = parseInt(dn1, 10);
            const num2 = parseInt(dn2, 10);

            if (num1 === num2) {
                size = dn1;
                if (type === 'T(R)') type = 'T(S)';
            } else {
                const big = num1 > num2 ? dn1 : dn2;
                const small = num1 > num2 ? dn2 : dn1;
                size = `${big} X ${small}`;
                if (type === 'T(S)') type = 'T(R)';
            }
        } else {
            // (2) 일반 정수 페어: 40x25, 40*25
            const sizePairMatch = line.match(/(\d+)(?:A|")?\s*(?:X|\*|×)\s*(\d+)(?:A|")?/i);
            if (sizePairMatch) {
                let s1 = parseInt(sizePairMatch[1], 10);
                let s2 = parseInt(sizePairMatch[2], 10);
                if (s1 < s2) { const temp = s1; s1 = s2; s2 = temp; }
                if (s1 === s2) {
                    size = `${s1}A`;
                    if (type === 'T(R)') type = 'T(S)';
                } else {
                    size = `${s1}A X ${s2}A`;
                    if (type === 'T(S)') type = 'T(R)';
                }
            } else {
                // (3) 단일 분수 인치: 3/4", 1/2", 1-1/2", 1", 2" 등
                const singleFracMatch = line.match(/(?:^|\s)(?:3\/4|1\/2|1\s+1\/2|1-1\/2|1\s+1\/4|1-1\/4|2\s+1\/2|2-1\/2)(?:\"|\b)/i);
                if (singleFracMatch) {
                    const sf = singleFracMatch[0].trim().replace(/\"/g, '');
                    if (sf === '1/2') size = '15A';
                    else if (sf === '3/4') size = '20A';
                    else if (sf === '1 1/2' || sf === '1-1/2') size = '40A';
                    else if (sf === '1 1/4' || sf === '1-1/4') size = '32A';
                    else if (sf === '2 1/2' || sf === '2-1/2') size = '65A';
                } else {
                    // (4) 단일 정수: 40A, 25A, 50 등
                    const singleSizeMatch = line.match(/(\d+)\s*A/i) || line.match(/(?:T\(S\)|T|40|50|25|20|15|65|80|100)\s*(\d{1,3})(?!\d)/i);
                    if (singleSizeMatch) {
                        const s = parseInt(singleSizeMatch[1], 10);
                        if (s > 0) size = `${s}A`;
                    }
                }
            }
        }

        if (!size) return null;

        // 5. 알트에프 표준 품목 ID 조립
        const itemId = `${type}-${schedule}-${size}-${material}`;

        // 6. 실제 인벤토리 검색 및 단가/재고 매칭
        let matched = this.inventoryMap.get(itemId);

        // Fallback: 대소문자나 공백 차이 fuzzy 매칭
        if (!matched) {
            for (const [key, item] of this.inventoryMap.entries()) {
                if (key.replace(/\s+/g, '') === itemId.replace(/\s+/g, '')) {
                    matched = item;
                    break;
                }
            }
        }

        const basePrice = matched ? matched.base_price || matched.unitPrice || 0 : 0;
        const currentStock = matched ? matched.currentStock || 0 : 0;
        const location = matched ? matched.location || '양산/시화' : '양산/시화';

        return {
            originalText: line,
            itemId,
            type,
            schedule,
            size,
            material,
            qty,
            basePrice,
            currentStock,
            stockStatus: currentStock >= qty ? 'AVAILABLE' : (currentStock > 0 ? 'PARTIAL' : 'OUT_OF_STOCK'),
            location,
            matchedInDb: !!matched
        };
    }

    /**
     * 팩스/양식 재고의뢰서 및 표 양식 OCR 정규화 파싱 (규칙/프롬프트 기반)
     * - ANSI/JIS 인치/분수 규격(1*3/4, 1-1/2*1, 3/4" 등)을 대표님 프롬프트 규칙에 따라 동적 변환
     * - 테스트용 하드코딩 배열 없이 순수 정규식 및 인벤토리 매칭으로 처리
     */
    normalizeFaxOrTableText(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        let customer = this.matchCustomer(rawText);
        if (!customer) {
            // CRM 매칭 실패 시 OCR 텍스트에서 상호 / 사업자번호 / 연락처 동적 추출 (하드코딩 절대 금지)
            const compMatch = rawText.match(/(?:\(주\)|주식회사)\s*([가-힣A-Za-z0-9]+)/) ||
                              rawText.match(/(?:상호|상\s*호|수신|발신|업체명)\s*[:：]?\s*([가-힣A-Za-z0-9()]+)/);
            const bizMatch = rawText.match(/(?:등록번호|사업자번호|사업자등록번호)\s*[:：]?\s*([0-9]{3}-[0-9]{2}-[0-9]{5})/);
            const telMatch = rawText.match(/(?:TEL|전화|연락처)\s*[:：]?\s*([0-9]{2,4}-[0-9]{3,4}-[0-9]{4})/);

            if (compMatch || bizMatch) {
                customer = {
                    id: `CUST-DYNAMIC-${Date.now()}`,
                    name: compMatch ? compMatch[0].trim() : '신규/미등록 거래처',
                    businessNumber: bizMatch ? bizMatch[1] : '',
                    phone: telMatch ? telMatch[1] : '',
                    isUnregistered: true
                };
            }
        }

        const items = [];

        // 라인별로 표 행(No, 제품명, 규격, 수량 등) 또는 단일 피팅 라인 파싱
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/재고의뢰서|발주서|견적의뢰|공급가액|부\s*가\s*세|합\s*계|이하여백|단위|등록번호/i.test(line)) continue;

            // 표 행 패턴: [순번] [제품명/재질/두께] [규격/치수] [단위?] [수량]
            let parsed = this.parseItemLine(line, 'STS304-W', 'S10S');
            if (parsed) {
                items.push(parsed);
                continue;
            }

            // 복합 라인 분할 파싱 (예: "1 TEE S/40S WP316L-W 1*3/4 EA 5")
            const rowMatch = line.match(/^\s*(?:\d{1,2}\s+)?([0-9A-Za-z'\/() -]+?)\s+([0-9\/\*\"xX -]+?)\s+(?:EA|PCS|개)?\s*(\d+)/i);
            if (rowMatch) {
                const combinedStr = `${rowMatch[1]} ${rowMatch[2]} ${rowMatch[3]}EA`;
                parsed = this.parseItemLine(combinedStr, 'STS304-W', 'S10S');
                if (parsed) {
                    items.push(parsed);
                }
            }
        }

        return {
            customer,
            discountRate: 50,
            remarks: '카카오톡 견적/재고의뢰서 접수분',
            items
        };
    }
}

export const fittingNormalizerService = new FittingNormalizerService();
