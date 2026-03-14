import Tesseract from 'tesseract.js';
import fs from 'fs';

const imagePath = 'C:\\Users\\USER-PC\\.gemini\\antigravity\\brain\\c3c3cd69-5abc-4e65-988d-cb6d90b33f25\\media__1773503405747.png';

console.log("Starting OCR for Korean text on:", imagePath);

Tesseract.recognize(
  imagePath,
  'kor+eng',
  { logger: m => console.log(m.status, m.progress) }
).then(({ data: { text } }) => {
  console.log("================ OCR TEXT ================");
  console.log(text);
  fs.writeFileSync('./ocr-274.txt', text);
  console.log("==========================================");
}).catch(err => {
    console.error("OCR ERROR", err);
});
