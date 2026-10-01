const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const keyMatch = env.match(/FINANCE_GEMINI_API_KEY=(.+)/);
const apiKey = keyMatch ? keyMatch[1].trim() : '';

// Test multimodal PDF extraction with different models
// Create a minimal valid PDF
const pdfContent = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  '4 0 obj<</Length 44>>stream\n' +
  'BT /F1 24 Tf 100 700 Td (Invoice INV-TEST) Tj ET\n' +
  'endstream\n' +
  'endobj\n' +
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
  'xref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\n0000000195 00000 n\n0000000290 00000 n\n' +
  'trailer<</Size 6/Root 1 0 R>>\nstartxref\n387\n%%EOF\n'
);
const pdfBase64 = pdfContent.toString('base64');

async function testMultimodal(model, label) {
  console.log(`\n=== Testing ${label} (${model}) with PDF ===`);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: 'Extract all text content from this invoice PDF. Return only the extracted text.' },
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: pdfBase64,
            },
          },
        ],
      }],
      generationConfig: {
        responseMimeType: 'text/plain',
      },
    }),
  });
  const data = await res.json();
  const ok = res.ok;
  if (ok) {
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(`  HTTP ${res.status} OK => ${text?.slice(0, 200)}`);
  } else {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
    console.log(`  HTTP ${res.status} FAIL => ${msg}`);
  }
}

(async () => {
  await testMultimodal('gemini-3.5-flash-lite', 'OCR model (user config)');
  await testMultimodal('gemini-3.5-flash', 'Review model (user config)');
  await testMultimodal('gemini-3.6-flash', 'Default fallback');
  await testMultimodal('gemini-1.5-pro', 'Test deprecated model');
})().catch(console.error);
