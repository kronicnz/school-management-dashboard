const http = require("http");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_ENV_PATH = path.join(__dirname, ".env.local");
const EDGE_RUNTIME_ENV_PATH = path.join(__dirname, "supabase", ".temp", "start-secrets", "supabase_edge_runtime_school-management-system", "env", "docker.env");
const ADMIN_EMAIL = "shaneb@ris.school.nz";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];
const PORT = 3000;
const rootEnv = parseEnvFile(ROOT_ENV_PATH);
const credentials = {
  client_id: rootEnv.FINANCE_GOOGLE_CLIENT_ID,
  client_secret: rootEnv.FINANCE_GOOGLE_CLIENT_SECRET,
};

if (!credentials.client_id || !credentials.client_secret) {
  throw new Error(`Missing FINANCE_GOOGLE_CLIENT_ID or FINANCE_GOOGLE_CLIENT_SECRET in ${ROOT_ENV_PATH}`);
}

const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  `http://127.0.0.1:${PORT}/callback`
);

console.log("Finance OAuth client ID:", credentials.client_id);
console.log("Requested Gmail scopes:");
SCOPES.forEach((scope) => console.log("  - " + scope));

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
  login_hint: ADMIN_EMAIL,
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get("code");

  if (code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Success!</h1><p>You can close this window and return to the terminal.</p>");
    server.close();
    handleCallback(code);
    return;
  }

  res.writeHead(400);
  res.end("No code received");
});

server.listen(PORT, () => {
  console.log("Listening on port " + PORT);
  console.log("Opening browser...");
  try {
    execSync('start "" "' + authUrl + '"');
  } catch {
    console.log("\nOpen this URL manually in your browser:");
    console.log(authUrl);
  }
  console.log("\nAfter clicking 'Allow', you'll be redirected.");
  console.log("The script will capture the code automatically.\n");
});

async function handleCallback(code) {
  console.log("Exchanging code for tokens...");
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  console.log("Access token:", tokens.access_token ? "Got it" : "Missing");
  console.log("Refresh token:", tokens.refresh_token ? "Got it" : "Missing");

  try {
    const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
    console.log("Granted token scopes:");
    String(tokenInfo.scopes || tokenInfo.scope || "").split(/\s+/).filter(Boolean).forEach((scope) => {
      console.log("  - " + scope);
    });
  } catch (error) {
    console.error("Could not read token scopes:", error.message);
  }

  const tokenPath = "C:/Users/Shane/Downloads/finance-google-token.json";
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log("Token saved to:", tokenPath);

  persistFinanceEnv(credentials, tokens);

  console.log("\nTesting Gmail API...");
  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const res = await gmail.users.labels.list({ userId: "me" });
    const labels = res.data.labels ?? [];
    console.log("Labels found:", labels.length);
    labels.slice(0, 10).forEach((label) => {
      console.log("  - " + label.name);
    });
    console.log("\n========================================");
    console.log("FINANCE GOOGLE REFRESH TOKEN:");
    console.log("========================================");
    console.log(tokens.refresh_token || "(missing refresh token)");
    console.log("========================================\n");
  } catch (error) {
    console.error("Error:", error.message);
  }
}

function persistFinanceEnv(credentials, tokens) {
  const lines = [
    `FINANCE_GOOGLE_CLIENT_ID=${credentials.client_id}`,
    `FINANCE_GOOGLE_CLIENT_SECRET=${credentials.client_secret}`,
    `FINANCE_GOOGLE_REFRESH_TOKEN=${tokens.refresh_token || ""}`,
    `FINANCE_GOOGLE_ACCESS_TOKEN=${tokens.access_token || ""}`,
  ];

  updateEnvFile(ROOT_ENV_PATH, lines);
  updateEnvFile(EDGE_RUNTIME_ENV_PATH, lines);

  console.log("Root env updated:", ROOT_ENV_PATH);
  console.log("Edge runtime env updated:", EDGE_RUNTIME_ENV_PATH);
}

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function updateEnvFile(filePath, newLines) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${newLines.join("\n")}\n`);
    return;
  }

  const existing = fs.readFileSync(filePath, "utf8");
  const entries = new Map();

  for (const line of existing.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;

    entries.set(trimmed.slice(0, equalsIndex).trim(), trimmed.slice(equalsIndex + 1));
  }

  for (const line of newLines) {
    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 0) continue;
    entries.set(line.slice(0, equalsIndex), line.slice(equalsIndex + 1));
  }

  const preserved = existing.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) return line;

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!entries.has(key)) return line;
    return `${key}=${entries.get(key)}`;
  });

  for (const [key, value] of entries) {
    if (!preserved.some((line) => line.trim().startsWith(`${key}=`))) {
      preserved.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filePath, `${preserved.join("\n")}\n`);
}
