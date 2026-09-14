const http = require("http");
const { google } = require("googleapis");
const fs = require("fs");
const { execSync } = require("child_process");

const CREDENTIALS_PATH = "C:/Users/Shane/Downloads/client_secret_1004047589689-3o0rm2l1mue4adcvnf6aoh086eu4c7i6.apps.googleusercontent.com.json";
const ADMIN_EMAIL = "shaneb@ris.school.nz";
const SCOPES = ["https://www.googleapis.com/auth/admin.directory.user.readonly"];
const PORT = 3000;
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")).web;

const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  "http://localhost:3000/callback"
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
  login_hint: ADMIN_EMAIL,
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
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
