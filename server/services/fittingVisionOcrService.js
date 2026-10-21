/**
 * 👁️ Fitting Vision OCR Service (영업2팀 INT-03/INT-05 비전 OCR & 프롬프트 학습 엔진)
 * 
 * [사용자 정의 프롬프트 및 도메인 규칙 완벽 주입]
 * 1. 재질 규칙:
 *    - "SUS" 절대 금지 -> STS304, STS316L
 *    - 316은 반드시 STS316L 또는 WP316L
 *    - WP***는 WP 유지 (절대 STS로 임의 변환 금지)
 *    - 제조방식은 반드시 "-S"(Seamless) 또는 "-W"(Weld)로 끝남
 *    - CAP은 항상 "-S"
 *    - S80S, S160S, XXS 두께는 무조건 "-S"
 *    - 근거 불명확 시 기본값 STS304-W
 * 
 * 2. 규격 규칙:
 *    - STS*** -> JIS -> "숫자+A" (예: 25A, 40A X 25A)
 *    - WP***  -> ASTM -> "인치(\")" 또는 정규화된 JIS 호칭경 "A"
 *    - 분수 정규화 (1/2"->15A, 3/4"->20A, 1"->25A, 1-1/4"->32A, 1-1/2"->40A, 2"->50A 등)
 *    - 복수 규격: "SIZE1 X SIZE2" (대문자 X, 큰 사이즈가 앞)
 * 
 * 3. 두께 규칙:
 *    - SCH10S/10S -> S10S, SCH20S/20S -> S20S, SCH40S/40S -> S40S, SCH80S/80S -> S80S
 *    - 정보 없으면 기본 S10S
 * 
 * 4. 품명 결정:
 *    - 90E(L), 90E(S), 45E(L), 45E(S), T(S), T(R), R(C), R(E), CAP, STUB END
 *    - Tee: 직경 다르면 T(R), 같으면 T(S)
 *    - Reducer: 편심(ECC)이면 R(E), 동심(CON)/기본이면 R(C)
 * 
 * 5. 알트에프 표준 품목 ID:
 *    `품명-두께-규격-재질`
 */

import fs from 'fs';
import path from 'path';
import { fittingNormalizerService } from './fittingNormalizerService.js';

export const FITTING_OCR_SYSTEM_PROMPT = `당신은 스테인리스 배관·피팅 전문 유통사 "알트에프(ALTF)"의 견적의뢰서/발주서 전담 AI 판독 엔진입니다.
제공된 이미지(팩스, 견적의뢰서, 발주서, 손글씨 또는 표 양식)에서 거래처 정보와 배관 피팅 품목들을 정확하게 판독하여 지정된 JSON 구조로 반환하십시오.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[절대 준수 도메인 규칙 및 분류 체계]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 재질 (Material) 규칙:
   - "SUS" 표기는 업계 구어이므로 시스템 표준에 절대 쓰지 않습니다. (SUS304 -> STS304-W, SUS316 -> STS316L-W)
   - 316 계열은 반드시 "STS316L" 또는 "WP316L"로 판독합니다.
   - 원문에 WP***(ASTM 규격) 표기가 있다면 반드시 "WP" 접두사를 유지합니다. (예: WP316L-W)
   - 제조방식 접미사는 반드시 "-S"(Seamless, 심리스/무계목) 또는 "-W"(Welded, 용접)로 끝납니다.
   - CAP(캡) 품목은 무조건 "-S"입니다.
   - S80S, S160S, XXS 등 고압/후육 두께는 무조건 "-S"입니다.
   - 재질 표기가 누락되었거나 불분명하면 기본값은 "STS304-W"입니다.

2. 두께 (Schedule) 규칙:
   - SCH10S, 10S, #10 -> "S10S"
   - SCH20S, 20S, #20 -> "S20S"
   - SCH40S, 40S, #40, S/40S -> "S40S"
   - SCH80S, 80S, #80, S/80S -> "S80S"
   - 두께 표기가 없으면 기본값은 "S10S"입니다.

3. 품명 (Type) 결정 규칙:
   - 90도 엘보: Long Radius는 "90E(L)", Short Radius는 "90E(S)". (원문에 90'ELBOW 또는 ELBOW만 있으면 90E(L))
   - 45도 엘보: Long Radius는 "45E(L)", Short Radius는 "45E(S)".
   - 티(Tee): 모관과 지관의 규격이 다르면 "T(R)" (Reducing Tee), 같으면 "T(S)" (Straight Tee). 원문에 TEE만 적혀있어도 규격이 1*3/4이면 T(R), 1*1이면 T(S).
   - 레듀샤(Reducer): 편심(ECC, ECC-R/D)이면 "R(E)", 동심(CON, CON-R/D) 또는 특별한 표기가 없으면 "R(C)".
   - 캡: "CAP"
   - 랩조인트/스텁엔드: "STUB END"

4. 규격 (Size) 변환 규칙:
   - 인치/분수 표기를 대한민국 배관 표준 호칭경(JIS DN "A")으로 정확히 환산합니다.
     · 1/2" -> 15A
     · 3/4" -> 20A
     · 1" -> 25A
     · 1-1/4" (1 1/4") -> 32A
     · 1-1/2" (1 1/2") -> 40A
     · 2" -> 50A
     · 2-1/2" (2 1/2") -> 65A
     · 3" -> 80A
     · 4" -> 100A
     · 5" -> 125A
     · 6" -> 150A
     · 8" -> 200A
   - 복수 규격(티, 레듀샤 등): 반드시 "큰사이즈 X 작은사이즈" (대문자 X, 앞뒤 공백 1칸).
     예: 1*3/4 -> "25A X 20A"
     예: 1 1/2*1 -> "40A X 25A"
     예: 1*1 -> "25A" (동일 규격은 단일 규격으로 표기)

5. 알트에프 표준 품목 ID (itemId):
   \`품명-두께-규격-재질\`
   예: T(R)-S40S-25A X 20A-STS316L-W
   예: T(S)-S40S-25A-STS316L-W
   예: R(E)-S40S-25A X 20A-STS316L-W
   예: 90E(L)-S40S-20A-STS316L-W
   예: R(C)-S40S-40A X 25A-STS316L-W

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[반환 형식]
반드시 다음 JSON 포맷만 순수하게 출력하십시오 (추가 설명이나 마크다운 백틱 제외 가능):
{
  "customer": {
    "name": "상호명 또는 업체명 (미발견 시 null)",
    "businessNumber": "사업자등록번호 (000-00-00000 포맷, 미발견 시 null)",
    "phone": "전화번호",
    "fax": "팩스번호"
  },
  "remarks": "문서 상단/하단 참고사항 (예: 팩스 재고의뢰서 접수분)",
  "items": [
    {
      "originalText": "해당 행 원본 텍스트",
      "type": "T(R)",
      "schedule": "S40S",
      "size": "25A X 20A",
      "material": "STS316L-W",
      "itemId": "T(R)-S40S-25A X 20A-STS316L-W",
      "qty": 5
    }
  ]
}`;

export class FittingVisionOcrService {
    /**
     * 이미지 파일을 비전 LLM 또는 로컬 OCR로 정밀 판독
     * @param {Buffer|string} imageInput 이미지 버퍼 또는 로컬 파일 경로
     * @param {string} mimeType 이미지 MIME 타입 (image/jpeg, image/png 등)
     */
    async recognizeAndNormalize(imageInput, mimeType = 'image/jpeg') {
        let base64Data = '';
        let imageBuffer = null;

        if (Buffer.isBuffer(imageInput)) {
            imageBuffer = imageInput;
            base64Data = imageInput.toString('base64');
        } else if (typeof imageInput === 'string' && fs.existsSync(imageInput)) {
            imageBuffer = fs.readFileSync(imageInput);
            base64Data = imageBuffer.toString('base64');
        }

        // 1. Google Gemini Vision API 시도 (토큰 활용 고정밀 판독)
        if (process.env.GEMINI_API_KEY && base64Data) {
            try {
                console.log('[FittingVisionOCR] Google Gemini Vision API 호출 중... (대표님 프롬프트 주입)');
                const result = await this.callGeminiVision(process.env.GEMINI_API_KEY, base64Data, mimeType);
                if (result && result.items && result.items.length > 0) {
                    return this.enrichItemsWithInventory(result);
                }
            } catch (err) {
                console.warn('[FittingVisionOCR] Gemini Vision 호출 실패, 차순위/로컬 엔진 전환:', err.message);
            }
        }

        // 2. OpenAI GPT-4o Vision API 시도
        if (process.env.OPENAI_API_KEY && base64Data) {
            try {
                console.log('[FittingVisionOCR] OpenAI GPT-4o Vision 호출 중...');
                const result = await this.callOpenAiVision(process.env.OPENAI_API_KEY, base64Data, mimeType);
                if (result && result.items && result.items.length > 0) {
                    return this.enrichItemsWithInventory(result);
                }
            } catch (err) {
                console.warn('[FittingVisionOCR] OpenAI Vision 호출 실패:', err.message);
            }
        }

        // 3. Anthropic Claude Vision API 시도
        if (process.env.ANTHROPIC_API_KEY && base64Data) {
            try {
                console.log('[FittingVisionOCR] Anthropic Claude 3.5 Sonnet Vision 호출 중...');
                const result = await this.callClaudeVision(process.env.ANTHROPIC_API_KEY, base64Data, mimeType);
                if (result && result.items && result.items.length > 0) {
                    return this.enrichItemsWithInventory(result);
                }
            } catch (err) {
                console.warn('[FittingVisionOCR] Claude Vision 호출 실패:', err.message);
            }
        }

        // 4. 로컬 무중단 Tesseract OCR + 프롬프트 룰 기반 파서 (Zero-Failure Fallback)
        console.log('[FittingVisionOCR] 로컬 Tesseract + 정규화 룰 기반 엔진으로 판독 실행');
        return await this.fallbackLocalOcr(imageBuffer || imageInput);
    }

    /**
     * Gemini Vision 호출
     */
    async callGeminiVision(apiKey, base64Data, mimeType) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
        const body = {
            systemInstruction: {
                parts: [{ text: FITTING_OCR_SYSTEM_PROMPT }]
            },
            contents: [
                {
                    parts: [
                        { text: '첨부된 견적의뢰서/발주서 이미지를 판독하여 알트에프 표준 JSON 규격으로 반환하십시오.' },
                        {
                            inlineData: {
                                mimeType: mimeType || 'image/jpeg',
                                data: base64Data
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
            }
        };

        const fetch = (await import('node-fetch')).default;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini Vision HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return JSON.parse(text);
    }

    /**
     * OpenAI Vision 호출
     */
    async callOpenAiVision(apiKey, base64Data, mimeType) {
        const url = 'https://api.openai.com/v1/chat/completions';
        const body = {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: FITTING_OCR_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: '첨부된 견적의뢰서/발주서 이미지를 판독하여 알트에프 표준 JSON 규격으로 반환하십시오.' },
                        {
                            type: 'image_url',
                            image_url: { url: `data:${mimeType};base64,${base64Data}` }
                        }
                    ]
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1
        };

        const fetch = (await import('node-fetch')).default;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenAI Vision HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        return JSON.parse(content);
    }

    /**
     * Anthropic Claude Vision 호출
     */
    async callClaudeVision(apiKey, base64Data, mimeType) {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        const response = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            system: FITTING_OCR_SYSTEM_PROMPT,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType || 'image/jpeg',
                                data: base64Data
                            }
                        },
                        {
                            type: 'text',
                            text: '첨부된 견적의뢰서/발주서 이미지를 판독하여 알트에프 표준 JSON 규격으로 반환하십시오.'
                        }
                    ]
                }
            ]
        });

        const textBlock = response.content.find(b => b.type === 'text');
        if (!textBlock) throw new Error('No text block in Claude Vision response');
        const raw = textBlock.text.trim();
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        return JSON.parse(raw.slice(start, end + 1));
    }

    /**
     * 로컬 Tesseract OCR 폴백
     */
    async fallbackLocalOcr(imageSource) {
        try {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker('kor+eng');
            const ocrRet = await worker.recognize(imageSource);
            await worker.terminate();

            const extractedText = ocrRet.data?.text || '';
            console.log(`[FittingVisionOCR] 로컬 OCR 추출 완료 (${extractedText.length}자)`);

            let normalized = fittingNormalizerService.normalize(extractedText);
            if (!normalized.items || normalized.items.length === 0) {
                normalized = fittingNormalizerService.normalizeFaxOrTableText(extractedText);
            }
            return normalized;
        } catch (e) {
            console.error('[FittingVisionOCR] 로컬 OCR 폴백 실패:', e.message);
            return {
                customer: null,
                discountRate: 50,
                remarks: 'OCR 판독 오류',
                items: []
            };
        }
    }

    /**
     * 추출된 품목들을 실제 ALTF 인벤토리 DB(단가, 재고 수량, 창고 위치)와 교차 검증 매칭
     */
    enrichItemsWithInventory(parsedResult) {
        const enrichedItems = (parsedResult.items || []).map(item => {
            const itemId = item.itemId || `${item.type}-${item.schedule}-${item.size}-${item.material}`;
            const qty = item.qty || 1;

            let matched = fittingNormalizerService.inventoryMap.get(itemId);
            if (!matched) {
                for (const [key, inv] of fittingNormalizerService.inventoryMap.entries()) {
                    if (key.replace(/\s+/g, '') === itemId.replace(/\s+/g, '')) {
                        matched = inv;
                        break;
                    }
                }
            }

            // WP -> STS 호환 매칭 (한국 피팅 재고 DB는 대경/태일 JIS STS 기준 등록)
            if (!matched && item.material && item.material.startsWith('WP')) {
                const altMat = item.material.replace(/^WP/, 'STS');
                const altId = `${item.type}-${item.schedule}-${item.size}-${altMat}`;
                matched = fittingNormalizerService.inventoryMap.get(altId);
                if (!matched) {
                    for (const [key, inv] of fittingNormalizerService.inventoryMap.entries()) {
                        if (key.replace(/\s+/g, '') === altId.replace(/\s+/g, '')) {
                            matched = inv;
                            break;
                        }
                    }
                }
            }

            const basePrice = matched ? matched.base_price || matched.unitPrice || 0 : 0;
            const currentStock = matched ? matched.currentStock || 0 : 0;
            const location = matched ? matched.location || '양산/시화' : '양산/시화';

            return {
                originalText: item.originalText || `${item.type} ${item.schedule} ${item.material} ${item.size}`,
                itemId,
                type: item.type,
                schedule: item.schedule,
                size: item.size,
                material: item.material,
                qty,
                basePrice,
                currentStock,
                stockStatus: currentStock >= qty ? 'AVAILABLE' : (currentStock > 0 ? 'PARTIAL' : 'OUT_OF_STOCK'),
                location,
                matchedInDb: !!matched
            };
        });

        // 거래처 CRM 마스터 매칭 보완
        let customer = parsedResult.customer;
        if (customer && customer.name) {
            const crmCustomer = fittingNormalizerService.matchCustomer(customer.name);
            if (crmCustomer) {
                customer = {
                    id: crmCustomer.id,
                    name: crmCustomer.companyName,
                    businessNumber: crmCustomer.businessNumber || customer.businessNumber,
                    ceo: crmCustomer.ceo,
                    phone: crmCustomer.phone || customer.phone,
                    email: crmCustomer.email,
                    address: crmCustomer.address
                };
            }
        }

        return {
            customer,
            discountRate: parsedResult.discountRate || 50,
            remarks: parsedResult.remarks || '비전 OCR 자동 판독 견적건',
            items: enrichedItems
        };
    }
}

export const fittingVisionOcrService = new FittingVisionOcrService();
