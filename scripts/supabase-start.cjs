const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const EDGE_RUNTIME_ENV_PATH = path.join(ROOT, "supabase", ".temp", "start-secrets", "supabase_edge_runtime_school-management-system", "env", "docker.env");

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

const env = { ...process.env, ...parseEnvFile(ENV_PATH) };

function writeEdgeRuntimeEnvFile(filePath, envObject) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = Object.entries(envObject)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `${key}=${value}`);

  fs.writeFileSync(filePath, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8");
}

writeEdgeRuntimeEnvFile(EDGE_RUNTIME_ENV_PATH, env);

const child = spawn("supabase", ["start"], {
  cwd: ROOT,
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
