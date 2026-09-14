const { OAuth2Client } = require("google-auth-library");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");

const CREDENTIALS_PATH = "C:/Users/Shane/Downloads/client_secret_1004047589689-3o0rm2l1mue4adcvnf6aoh086eu4c7i6.apps.googleusercontent.com.json";
const TOKEN_PATH = "C:/Users/Shane/Downloads/google-workspace-token.json";
const ADMIN_EMAIL = "shaneb@ris.school.nz";
const SCOPES = ["https://www.googleapis.com/auth/admin.directory.user.readonly"];

function getCredentials() {
  const content = fs.readFileSync(CREDENTIALS_PATH, "utf8");
  const credentials = JSON.parse(content).web;
  return credentials;
}

function main() {
  const credentials = getCredentials();
  const client = new OAuth2Client(
    credentials.client_id,
    credentials.client_secret,
    "http://localhost:54321/auth/v1/callback"
  );

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost:54321");
    const code = url.searchParams.get("code");

    if (code) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <head><title>Authentication Complete</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #4CAF50;">✓ Authentication Successful</h1>
            <p>You can close this window now.</p>
          </body>
        </html>
      `);

      server.close();
      exchangeCode(client, code);
    } else {
      res.writeHead(400);
      res.end("Error: No code received");
    }
  });

  server.listen(54321, () => {
    console.log("✓ Local server started on port 54321");
    console.log("✓ Opening browser for Google authentication...\n");

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
      login_hint: ADMIN_EMAIL,
    });

    console.log("If browser doesn't open, visit this URL manually:");
    console.log(authUrl);
    console.log("");

    const opener = process.platform === "darwin"
      ? { command: "open", args: [authUrl] }
      : process.platform === "win32"
        ? { command: "rundll32", args: ["url.dll,FileProtocolHandler", authUrl] }
        : { command: "xdg-open", args: [authUrl] };

    const child = spawn(opener.command, opener.args, {
      stdio: "ignore",
      detached: true,
    });

    child.unref();
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error("Port 54321 is already in use. Please close any existing auth servers and try again.");
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });
}

async function exchangeCode(client, code) {
  try {
    console.log("✓ Exchanging code for tokens...");
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    console.log("✓ Access token obtained");
    console.log("✓ Refresh token:", tokens.refresh_token ? "Available" : "Not available");
    console.log("✓ Token expires:", new Date(tokens.expiry_date || 0).toLocaleString());

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`✓ Token saved to: ${TOKEN_PATH}\n`);

    await testSync(client, tokens.access_token);
  } catch (error) {
    console.error("✗ Error exchanging code:", error.message);
    process.exit(1);
  }
}

async function testSync(client, accessToken) {
  try {
    console.log("Testing sync with Google Workspace API...");
    console.log("========================================\n");

    const { google } = require("googleapis");
    const directory = google.admin({ version: "directory_v1", auth: client });

    console.log("Fetching users from Accounts/Automated/Students...");
    const res = await directory.users.list({
      customer: "my_customer",
      orgUnitPath: "Accounts/Automated/Students",
      maxResults: 100,
    });

    const users = res.data.users || [];
    console.log(`✓ Found ${users.length} users in the organization unit\n`);

    if (users.length > 0) {
      console.log("Sample users:");
      users.slice(0, 10).forEach((u) => {
        const attrs = u.customAttributes || [];
        const room = attrs.find(a => a.key === "RoomNumber")?.value || "N/A";
        const year = attrs.find(a => a.key === "YearGroup")?.value || "N/A";
        console.log(`  - ${u.primaryEmail}`);
        console.log(`    Name: ${u.name?.givenName} ${u.name?.familyName}`);
        console.log(`    Room: ${room} | Year: ${year}`);
      });

      if (users.length > 10) {
        console.log(`  ... and ${users.length - 10} more`);
      }
    } else {
      console.log("No users found. Check your org unit path and permissions.");
    }

    console.log("\n✓ Sync test complete!");
    console.log("✓ You can now run the sync function with this access token.");
    console.log("\nTo use this token in the sync function, set:");
    console.log(`GOOGLE_ACCESS_TOKEN=${accessToken}`);
  } catch (error) {
    console.error("✗ Error testing sync:", error.message);
    process.exit(1);
  }
}

main();
