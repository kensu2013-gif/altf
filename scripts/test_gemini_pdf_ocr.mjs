import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

async function testPdfOcr() {
    // Find any certificate PDF to test inline PDF parsing
    const files = fs.readdirSync('storage/certificates').filter(f => f.endsWith('.pdf') && !f.startsWith('._'));
    if (files.length === 0) {
        console.log('No test PDF found');
        return;
    }

    const testFile = files[0];
    console.log('Testing with file:', testFile);
    const pdfBuf = fs.readFileSync(`storage/certificates/${testFile}`);
    // Just slice first 500KB to stay within quick test limits
    const base64Data = pdfBuf.toString('base64');

    const prompt = '이 문서는 배관 자재 시험 성적서(MTC) 또는 거래명세표입니다. 문서에 적힌 번호, 일자, 공급자, 공급받는자, 품목 1~2개 및 합계를 JSON으로 추출하십시오.';
    const models = ['gemini-3.5-flash', 'gemini-3.8-flash'];

    for (const model of models) {
        try {
            console.log(`Sending PDF to model: ${model}...`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
                                        mimeType: 'application/pdf',
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
                })
            });

            console.log(`Status: ${res.status}`);
            if (res.ok) {
                const data = await res.json();
                console.log('Gemini Parsed Output:\n', data.candidates?.[0]?.content?.parts?.[0]?.text);
                return;
            } else {
                const err = await res.text();
                console.log('Error:', err.substring(0, 300));
            }
        } catch (e) {
            console.error('Fetch error:', e.message);
        }
    }
}

testPdfOcr().then(() => process.exit(0));
