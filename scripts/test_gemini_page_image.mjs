import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

async function testPageOcr() {
    // Check if tmp_ocr has any png or create one
    let imgPath = null;
    const tmpDir = 'storage/tmp_ocr';
    if (fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png'));
        if (files.length > 0) imgPath = `${tmpDir}/${files[0]}`;
    }

    if (!imgPath) {
        console.log('No tmp image found, creating dummy test prompt');
        return;
    }

    console.log('Testing with image:', imgPath);
    const buf = fs.readFileSync(imgPath);
    const base64 = buf.toString('base64');

    const prompt = `이 이미지는 한국 대경벤드 거래명세표입니다. 
다음 JSON 규격으로 파싱해 주십시오:
{
  "invoiceNo": "전표번호 (예: 0014- 2/ 2)",
  "date": "YYYY-MM-DD",
  "supplierName": "(주)대경벤드",
  "items": [
    {
      "itemNo": 17,
      "name": "TEE",
      "material": "STS 316L-W",
      "spec": "S/10S ERW 40A * 15A",
      "qty": 15,
      "unitPrice": 19230,
      "amount": 288450,
      "poNo": "ES261012-2824"
    }
  ],
  "totals": {
    "totalQty": 336,
    "supplyPrice": 8362220,
    "vat": 836222,
    "grandTotal": 9198442
  }
}`;

    const models = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
    for (const model of models) {
        try {
            console.log(`Calling ${model}...`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt },
                                { inlineData: { mimeType: 'image/png', data: base64 } }
                            ]
                        }
                    ],
                    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
                }),
                signal: AbortSignal.timeout(10000)
            });

            console.log(`${model} status:`, res.status);
            if (res.ok) {
                const data = await res.json();
                console.log('Result:\n', data.candidates?.[0]?.content?.parts?.[0]?.text);
                return;
            } else {
                console.log(await res.text());
            }
        } catch (e) {
            console.error(e.message);
        }
    }
}

testPageOcr().then(() => process.exit(0));
