// Confirms the "Invoices to process" -> "Invoices processed" label swap really happened
// on the source message, by reading the message's labels back from Gmail.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const MESSAGE_ID = process.env.MESSAGE_ID;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !MESSAGE_ID) {
  console.log("SKIP  missing Gmail credentials or message id");
  Deno.exit(0);
}

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  }).toString(),
});
const tokenJson = await tokenRes.json();
if (!tokenJson?.access_token) {
  console.log("SKIP  could not refresh Google token:", JSON.stringify(tokenJson).slice(0, 300));
  Deno.exit(0);
}
const accessToken = tokenJson.access_token;

const labelsRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const labelsJson = await labelsRes.json();
const labelById = new Map((labelsJson?.labels ?? []).map((l) => [l.id, l.name]));

const msgRes = await fetch(
  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${MESSAGE_ID}?format=full`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const msg = await msgRes.json();
if (msg?.error) {
  console.log("SKIP  Gmail message read failed:", JSON.stringify(msg.error).slice(0, 300));
  Deno.exit(0);
}
const names = (msg?.labelIds ?? []).map((id) => labelById.get(id) ?? id);

console.log("labels on the message:");
for (const name of names) console.log(`  ${name}`);

const hasProcessed = names.includes("Invoices processed");
const stillPending = names.includes("Invoices to process");

console.log(`\n${hasProcessed ? "PASS" : "FAIL"}  the message carries "Invoices processed"`);
console.log(`${!stillPending ? "PASS" : "FAIL"}  the message no longer carries "Invoices to process"`);

Deno.exit(hasProcessed && !stillPending ? 0 : 1);
