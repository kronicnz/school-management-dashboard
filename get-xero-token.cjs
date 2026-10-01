const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_ENV_PATH = path.join(__dirname, ".env.local");
const EDGE_RUNTIME_ENV_PATH = path.join(__dirname, "supabase", ".temp", "start-secrets", "supabase_edge_runtime_school-management-system", "env", "docker.env");
const ADMIN_EMAIL = "shaneb@ris.school.nz";
const PORT = 3000;
const REDIRECT_URI = rootEnvValue(ROOT_ENV_PATH, "XERO_REDIRECT_URI") || `http://localhost:${PORT}/callback`;
const TOKEN_URL = "https://identity.xero.com/connect/token";
const AUTH_URL = "https://login.xero.com/identity/connect/authorize";

const DEFAULT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "accounting.transactions",
  "accounting.transactions.read",
  "accounting.invoices",
  "accounting.invoices.read",
  "accounting.contacts",
  "accounting.contacts.read",
  "accounting.settings",
  "accounting.settings.read",
].join(" ");
const SCOPES = rootEnvValue(ROOT_ENV_PATH, "XERO_SCOPES") || DEFAULT_SCOPES;

const rootEnv = parseEnvFile(ROOT_ENV_PATH);
const credentials = {
  client_id: rootEnv.XERO_CLIENT_ID,
  client_secret: rootEnv.XERO_CLIENT_SECRET,
  tenant_id: rootEnv.XERO_TENANT_ID,
};

if (!credentials.client_id || !credentials.client_secret) {
  throw new Error(`Missing XERO_CLIENT_ID or XERO_CLIENT_SECRET in ${ROOT_ENV_PATH}`);
}

const authUrl = new URL(AUTH_URL);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", credentials.client_id);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("state", `xero-${Date.now()}`);
authUrl.searchParams.set("prompt", "consent");

console.log("Xero client ID:", credentials.client_id);
console.log("Redirect URI:", REDIRECT_URI);
console.log("Requested scopes:");
SCOPES.split(/\s+/).filter(Boolean).forEach((scope) => console.log("  - " + scope));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization failed</h1><p>${escapeHtml(error)}</p>`);
    server.close();
    console.error("Authorization error:", error);
    return;
  }

  if (code) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Success!</h1><p>You can close this window and return to the terminal.</p>");
    server.close();
    handleCallback(code).catch((callbackError) => {
      console.error("Callback error:", callbackError);
    });
    return;
  }

  res.writeHead(400, { "Content-Type": "text/html" });
  res.end("<h1>No code received</h1><p>Complete the Xero consent flow to continue.</p>");
});

server.listen(PORT, () => {
  console.log("Listening on port " + PORT);
  console.log("Opening browser...");
  try {
    execSync(`start "" "${authUrl.toString()}"`);
  } catch {
    console.log("\nOpen this URL manually in your browser:");
    console.log(authUrl.toString());
  }
  console.log("\nAfter clicking 'Allow', you'll be redirected.");
  console.log("The script will capture the code automatically.\n");
});

async function handleCallback(code) {
  console.log("Exchanging code for tokens...");
  const tokens = await exchangeCodeForTokens(code);

  console.log("Access token:", tokens.access_token ? "Got it" : "Missing");
  console.log("Refresh token:", tokens.refresh_token ? "Got it" : "Missing");

  const tokenPath = "C:/Users/Shane/Downloads/xero-token.json";
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log("Token saved to:", tokenPath);

  const tenantId = await resolveTenantId(tokens.access_token, credentials.tenant_id);
  persistXeroEnv({ ...credentials, tenant_id: tenantId }, tokens);

  if (tokens.access_token) {
    try {
      const connections = await fetch("https://api.xero.com/connections", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/json",
        },
      });

      if (connections.ok) {
        const data = await connections.json();
        console.log("\nConnected tenants:");
        (Array.isArray(data) ? data : []).forEach((entry) => {
          console.log(`  - ${entry.tenantName || entry.tenantId} (${entry.tenantId})`);
        });
      } else {
        console.log("Could not list Xero tenants:", await connections.text());
      }
    } catch (error) {
      console.error("Could not inspect Xero connections:", error.message);
    }
  }

  console.log("\n========================================");
  console.log("XERO REFRESH TOKEN:");
  console.log("========================================");
  console.log(tokens.refresh_token || "(missing refresh token)");
  console.log("========================================\n");
}

async function resolveTenantId(accessToken, preferredTenantId) {
  try {
    const response = await fetch("https://api.xero.com/connections", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return preferredTenantId || null;
    }

    const connections = await response.json();
    if (!Array.isArray(connections) || connections.length === 0) {
      return preferredTenantId || null;
    }

    if (preferredTenantId) {
      const matched = connections.find((entry) => entry && entry.tenantId === preferredTenantId);
      if (matched && matched.tenantId) {
        return matched.tenantId;
      }
    }

    return connections[0]?.tenantId || preferredTenantId || null;
  } catch {
    return preferredTenantId || null;
  }
}

async function exchangeCodeForTokens(code) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  return response.json();
}

function persistXeroEnv(credentials, tokens) {
  const lines = [
    `XERO_CLIENT_ID=${credentials.client_id}`,
    `XERO_CLIENT_SECRET=${credentials.client_secret}`,
    `XERO_REFRESH_TOKEN=${tokens.refresh_token || ""}`,
    `XERO_ACCESS_TOKEN=${tokens.access_token || ""}`,
    credentials.tenant_id ? `XERO_TENANT_ID=${credentials.tenant_id}` : null,
  ].filter(Boolean);

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

function rootEnvValue(filePath, key) {
  const env = parseEnvFile(filePath);
  const value = env[key];
  return value && value.trim() ? value.trim() : null;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
