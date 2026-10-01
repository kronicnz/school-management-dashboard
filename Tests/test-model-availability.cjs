const fs = require('fs');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv('.env.local'), ...loadEnv('.env') };
const key = env.FINANCE_GEMINI_API_KEY || env.GEMINI_API_KEY;
if (!key) {
  console.log('No API key found');
  process.exit(1);
}

const models = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.0-flash',
  'gemini-3.0-pro',
  'gemini-flash-latest',
  'gemini-pro-latest',
];

(async () => {
  for (const model of models) {
    const started = Date.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
            generationConfig: { maxOutputTokens: 16 },
          }),
        },
      );
      const text = await res.text();
      let detail = '';
      try {
        const j = JSON.parse(text);
        detail = j?.error?.message?.slice(0, 60) ?? '';
      } catch {}
      console.log(
        `${res.status === 200 ? 'OK  ' : 'FAIL'} ${model.padEnd(26)} ${String(Date.now() - started).padStart(6)}ms  ${detail}`,
      );
    } catch (e) {
      console.log(`FAIL ${model.padEnd(26)} ${e.message}`);
    }
  }
})();
