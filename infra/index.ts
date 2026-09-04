import alchemy from "alchemy";
import { Worker, KVNamespace } from "alchemy/cloudflare";

// Run: tsx infra/index.ts          → deploy / update
//      tsx infra/index.ts --destroy → tear down

const CRONS = ["0 * * * *"]; // every hour

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable "${name}" is not set`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
const environmentNames = requireEnv("ENVIRONMENT_NAMES");
const isDestroy = process.argv.includes("--destroy");

const app = await alchemy("cf-full-monitor", {
  phase: isDestroy ? "destroy" : "up",
  // Provide ALCHEMY_STATE_PASSWORD to encrypt secrets stored in .alchemy/ state files.
  password: process.env.ALCHEMY_STATE_PASSWORD,
});

// Build per-environment bindings from ENVIRONMENT_NAMES
const envBindings = Object.fromEntries(
  environmentNames
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((name) => {
      const prefix = name.toUpperCase();
      // ZONE_ID/HOSTNAME are optional: they enable the HTTP status 5xx check
      // (httpRequestsAdaptiveGroups) for this environment when both are set.
      const zoneId = optionalEnv(`${prefix}_ZONE_ID`);
      const hostname = optionalEnv(`${prefix}_HOSTNAME`);
      return [
        [`${prefix}_SCRIPT_NAME`, requireEnv(`${prefix}_SCRIPT_NAME`)],
        [`${prefix}_D1_DB_ID`, alchemy.secret(requireEnv(`${prefix}_D1_DB_ID`))],
        [`${prefix}_DISCORD_WEBHOOK_URL`, alchemy.secret(requireEnv(`${prefix}_DISCORD_WEBHOOK_URL`))],
        ...(zoneId ? [[`${prefix}_ZONE_ID`, zoneId] as const] : []),
        ...(hostname ? [[`${prefix}_HOSTNAME`, hostname] as const] : []),
      ];
    })
);

const metricsKV = await KVNamespace("cf-monitor-metrics");

await Worker("cf-full-monitor", {
  name: "cf-full-monitor",
  entrypoint: new URL("../src/index.ts", import.meta.url).pathname,
  crons: CRONS,
  bindings: {
    CLOUDFLARE_ACCOUNT_ID: alchemy.secret(accountId),
    CLOUDFLARE_API_TOKEN: alchemy.secret(apiToken),
    ENVIRONMENT_NAMES: environmentNames,
    METRICS_KV: metricsKV,
    ...envBindings,
  },
});

await app.finalize();
