const http = require("http");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CREDENTIALS_PATH = "C:/Users/Shane/Downloads/client_secret_1004047589689-3o0rm2l1mue4adcvnf6aoh086eu4c7i6.apps.googleusercontent.com.json";
const ROOT_ENV_PATH = path.join(__dirname, ".env.local");
const EDGE_RUNTIME_ENV_PATH = path.join(__dirname, "supabase", ".temp", "start-secrets", "supabase_edge_runtime_school-management-system", "env", "docker.env");
const ADMIN_EMAIL = "shaneb@ris.school.nz";
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly",
];
const PORT = 3000;
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")).web;

const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  `http://127.0.0.1:${PORT}/callback`
);

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
    res.end("<h1>Success!</h1><p>You can close this window and go back to the terminal.</p>");
    server.close();
    handleCallback(code);
  } else {
    res.writeHead(400);
    res.end("No code received");
  }
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

  const tokenPath = "C:/Users/Shane/Downloads/google-workspace-token.json";
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log("Token saved to:", tokenPath);

  persistSyncEnv(credentials, tokens);

  console.log("\nTesting Admin SDK...");
  try {
    const directory = google.admin({ version: "directory_v1", auth: oauth2Client });
    const res = await directory.users.list({
      customer: "my_customer",
      orgUnitPath: "Accounts/Automated/Students",
      maxResults: 10,
    });
    const users = res.data.users ?? [];
    console.log("Users found:", users.length);
    users.forEach((u) => {
      console.log("  - " + u.primaryEmail + " (" + u.name?.givenName + " " + u.name?.familyName + ")");
    });
    if (users.length > 0) {
      console.log("\n========================================");
      console.log("REFRESH TOKEN (for sync function):");
      console.log("========================================");
      console.log(tokens.refresh_token);
      console.log("========================================\n");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

function persistSyncEnv(credentials, tokens) {
  const lines = [
    `GOOGLE_CLIENT_ID=${credentials.client_id}`,
    `GOOGLE_CLIENT_SECRET=${credentials.client_secret}`,
    `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token || ""}`,
    `GOOGLE_ACCESS_TOKEN=${tokens.access_token || ""}`,
  ];

  fs.writeFileSync(ROOT_ENV_PATH, `${lines.join("\n")}\n`);
  updateEnvFile(EDGE_RUNTIME_ENV_PATH, lines);
  console.log("Root env updated:", ROOT_ENV_PATH);
  console.log("Edge runtime env updated:", EDGE_RUNTIME_ENV_PATH);
}

function updateEnvFile(filePath, newLines) {
  if (!fs.existsSync(filePath)) return;

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
