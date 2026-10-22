import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log('Gemini API Key:', apiKey ? 'Loaded (' + apiKey.slice(0, 7) + '...)' : 'MISSING');

const imagePath = '/Users/hyunjincho/.gemini/antigravity-ide/brain/5cefecd1-1582-4359-ae3f-2c5cdf0fb9e4/.user_uploaded/media_1792679845219.jpg';
const base64Data = fs.readFileSync(imagePath).toString('base64');
console.log('Base64 length:', base64Data.length);

const prompt = `너는 대한민국 배관 자재 유통 및 (주)대경벤드 거래명세표 전문 AI 파서야.
첨부된 거래명세표 스캔 이미지를 읽고, 아래 JSON 구조로 정확히 반환해줘:
{
  "invoiceNo": "전표번호 (예: No:0014- 2/ 2)",
  "invoiceDate": "YYYY-MM-DD",
  "customerName": "공급받는자 상호 (예: 알트에프(ALT.F))",
  "poNumbers": ["비고란의 발주번호 목록 (예: ES261012-2824)"],
  "items": [
    {
      "itemNo": 17,
      "name": "품명",
      "material": "재질",
      "spec": "규격",
      "quantity": 15,
      "unit": "단위",
      "unitPrice": 19230,
      "amount": 288450,
      "poNo": "ES261012-2824",
      "remarks": "서울재고"
    }
  ],
  "pricing": {
    "subtotal": 8362220,
    "vat": 836222,
    "grandTotal": 9198442
  }
}
[매우 중요한 규칙]
1. 하단 표의 공급가액(subtotal), 부가세(vat), 합계(grandTotal)를 절대로 누락하지 말고 정수 숫자로 반환해.
2. 비고란의 'ES261012-2824' 같은 발주번호는 반드시 poNumbers 및 각 품목의 poNo에 포함시켜.
3. 오직 유효한 JSON 문자열만 출력해.`;

const models = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

for (const model of models) {
    try {
        console.log(`Calling ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg',
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
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        console.log(`Status for ${model}: ${res.status}`);
        if (!res.ok) {
            const err = await res.text();
            console.log(`Error for ${model}:`, err.slice(0, 200));
            continue;
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            const parsed = JSON.parse(text);
            console.log('🎉 SUCCESS WITH MODEL:', model);
            console.log('Invoice No:', parsed.invoiceNo);
            console.log('Invoice Date:', parsed.invoiceDate);
            console.log('PO Numbers:', parsed.poNumbers);
            console.log('Pricing:', parsed.pricing);
            console.log('Items Count:', parsed.items?.length);
            console.log('First 2 Items:', parsed.items?.slice(0, 2));
            break;
        }
    } catch (e) {
        console.error(`Error for ${model}:`, e.message);
    }
}
