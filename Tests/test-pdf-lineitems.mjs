import fs from 'node:fs';

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv('.env.local'), ...loadEnv('.env') };
const messageId = process.argv[2] ?? '1a02da2be602fd0d';

// --- Gmail auth ---
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: env.FINANCE_GOOGLE_CLIENT_ID,
    client_secret: env.FINANCE_GOOGLE_CLIENT_SECRET,
    refresh_token: env.FINANCE_GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }).toString(),
});
const tokenJson = await tokenRes.json();
if (!tokenJson.access_token) {
  console.log('token failed', JSON.stringify(tokenJson).slice(0, 400));
  process.exit(1);
}
const gmailAuth = { Authorization: `Bearer ${tokenJson.access_token}` };

const message = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, { headers: gmailAuth }).then((r) => r.json());

function findPdf(part) {
  if (!part) return null;
  if (part.body?.attachmentId && String(part.mimeType).includes('pdf')) return part;
  for (const child of part.parts ?? []) {
    const found = findPdf(child);
    if (found) return found;
  }
  return null;
}

const pdfPart = findPdf(message.payload);
if (!pdfPart) {
  console.log('no pdf attachment');
  process.exit(1);
}
const attachment = await fetch(
  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${pdfPart.body.attachmentId}`,
  { headers: gmailAuth },
).then((r) => r.json());
const pdfBase64 = attachment.data;
fs.writeFileSync('debug-invoice.pdf', Buffer.from(pdfBase64, 'base64'));
console.log('pdf saved: debug-invoice.pdf', pdfBase64.length, 'base64 chars');

// --- Gemini ---
const SCHEMA = {
  type: 'object',
  properties: {
    invoiceNumber: { type: 'string' },
    invoiceDate: { type: 'string' },
    dueDate: { type: 'string' },
    grossTotal: { type: 'number' },
    taxTotal: { type: 'number' },
    subtotal: { type: 'number' },
    supplierName: { type: 'string' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitAmount: { type: 'number' },
          lineAmount: { type: 'number' },
          taxType: { type: 'string' },
          accountCode: { type: 'string' },
        },
      },
    },
  },
};

async function gemini(model, prompt, opts = {}) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.FINANCE_GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }] }],
        generationConfig: {
          // NOTE: responseMimeType/responseSchema are intentionally omitted by default.
          // They are what makes the model skip the line item table.
          ...(opts.json ? { responseMimeType: 'application/json', responseSchema: SCHEMA } : {}),
          ...(opts.jsonMimeOnly ? { responseMimeType: 'application/json' } : {}),
          temperature: 0.1,
          topP: 0.9,
        },
      }),
    },
  );
  const body = await res.json();
  if (!res.ok) return { error: `${res.status} ${JSON.stringify(body?.error?.message ?? body).slice(0, 200)}` };
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const meta = {
    finishReason: body?.candidates?.[0]?.finishReason,
    outTokens: body?.usageMetadata?.candidatesTokenCount,
  };
  if (opts.json || opts.jsonMimeOnly) {
    try {
      return { json: JSON.parse(text), meta };
    } catch {
      return { raw: text, meta };
    }
  }
  return { text, meta };
}

const TABLE_PROMPT = `Transcribe the itemised line table on this invoice.

Read it by COLUMNS, not by running text:
- One visual row = one line item.
- description comes ONLY from the column headed Description / Item / Details, including the full text of that cell if it wraps to a second line.
- Ignore every other column: Item ID, Category, Type, UoM (Hrs, Km, Ea, Each, Pc), tax code (S15, GST15), account code. None of these belong in a description.
- quantity, unitAmount and lineAmount come from their own columns.
- Skip summary rows (Subtotal, GST, Tax, Total, Balance Due) and footers.

The printed GST-exclusive subtotal is 872.10. Your lineAmount values must add up to 872.10.

Return JSON with a "lineItems" array where each entry is {description, quantity, unitAmount, lineAmount, taxType}.`;

console.log('\n=== A: table-only prompt + strict responseSchema, gemini-3.5-flash-lite ===');
console.log(JSON.stringify(await gemini('gemini-3.5-flash-lite', TABLE_PROMPT, { json: true }), null, 2));

console.log('\n=== A2: table-only prompt, JSON requested in the prompt, NO responseSchema ===');
console.log(JSON.stringify(await gemini('gemini-3.5-flash-lite', `${TABLE_PROMPT}

Respond with ONLY a JSON object of this exact shape, no other text and no code fence:
{"lineItems":[{"description":"","quantity":0,"unitAmount":0,"lineAmount":0,"taxType":"INPUT2"}]}`, {}), null, 2));

console.log('\n=== A3: same as A2 but with responseMimeType json and NO responseSchema ===');
console.log(JSON.stringify(await gemini('gemini-3.5-flash-lite', `${TABLE_PROMPT}

Respond with ONLY a JSON object of this exact shape, no other text and no code fence:
{"lineItems":[{"description":"","quantity":0,"unitAmount":0,"lineAmount":0,"taxType":"INPUT2"}]}`, { jsonMimeOnly: true }), null, 2));

console.log('\n=== C: plain text dump of the PDF (no schema) ===');
const dump = await gemini('gemini-3.5-flash-lite', 'Return the full text of this document exactly as printed, preserving line breaks. Output only the text.');
console.log((dump.text ?? dump.error ?? '').slice(0, 3000));

console.log('\n=== D: table read without the JSON schema (free-form) ===');
const free = await gemini('gemini-3.5-flash-lite', 'List every row of the invoice line item table. For each row give: description, quantity, unit price, amount. Read the columns correctly - the UoM and Item ID columns are NOT part of the description. Output as a simple list.');
console.log((free.text ?? free.error ?? '').slice(0, 3000));
