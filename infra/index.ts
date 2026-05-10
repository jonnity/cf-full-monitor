import alchemy from "alchemy";
import { Worker } from "alchemy/cloudflare";

// Run: tsx infra/index.ts          → deploy / update
//      tsx infra/index.ts --destroy → tear down

const CRONS = ["0 * * * *"]; // every hour

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable "${name}" is not set`);
  return value;
}

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
const isDestroy = process.argv.includes("--destroy");

const app = await alchemy("cf-full-monitor", {
  phase: isDestroy ? "destroy" : "up",
  // Provide ALCHEMY_STATE_PASSWORD to encrypt secrets stored in .alchemy/ state files.
  password: process.env.ALCHEMY_STATE_PASSWORD,
});

await Worker("cf-full-monitor", {
  name: "cf-full-monitor",
  entrypoint: new URL("../src/index.ts", import.meta.url).pathname,
  crons: CRONS,
  // Bindings: string → plain_text, alchemy.secret() → secret_text
  bindings: {
    TARGET_SCRIPT_NAME: "oogiri-doc-server",
    CLOUDFLARE_ACCOUNT_ID: alchemy.secret(accountId),
    CLOUDFLARE_API_TOKEN: alchemy.secret(apiToken),
    DISCORD_WEBHOOK_URL: alchemy.secret(requireEnv("DISCORD_WEBHOOK_URL")),
    TARGET_D1_DB_ID: alchemy.secret(requireEnv("TARGET_D1_DB_ID")),
  },
});

await app.finalize();
