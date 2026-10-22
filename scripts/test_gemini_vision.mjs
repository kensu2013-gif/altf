import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log('Testing Gemini API with key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'NONE');

async function testGemini() {
    const models = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
    for (const model of models) {
        try {
            console.log(`Trying model: ${model}...`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Hello, reply with JSON: {"status": "ok", "model": "' + model + '"}' }] }],
                    generationConfig: { responseMimeType: 'application/json' }
                })
            });
            console.log(`Status for ${model}:`, res.status);
            if (res.ok) {
                const data = await res.json();
                console.log(`Response text:`, data.candidates?.[0]?.content?.parts?.[0]?.text);
                return model;
            } else {
                const errText = await res.text();
                console.log(`Error body:`, errText.substring(0, 250));
            }
        } catch (e) {
            console.error(`Fetch error for ${model}:`, e.message);
        }
    }
}

testGemini().then(m => {
    console.log('Working model:', m);
    process.exit(0);
});
