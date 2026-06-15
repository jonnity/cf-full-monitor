import type {
  Env,
  EnvironmentConfig,
  GraphQLResponse,
  QueryData,
  R2OpsGroup,
  MetricsResult,
  TimeRange,
} from "./types";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const LIMITS = {
  workers: { requests: 100_000 },
  d1: {
    readRows: 5_000_000,
    writeRows: 100_000,
    storageBytes: 5 * 1024 ** 3,
  },
  r2: {
    classAOps: 1_000_000,
    classBOps: 10_000_000,
    storageBytes: 10 * 1024 ** 3,
  },
  do: { requests: 1_000_000, durationGBs: 400_000 },
} as const;

const ALERT_THRESHOLD = 0.8;

// Cloudflare R2 pricing: Class A = mutating ops, Class B = read ops
const R2_CLASS_A_ACTIONS = new Set([
  "CreateBucket",
  "DeleteBucket",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
  "PutObject",
  "CopyObject",
  "DeleteObject",
  "DeleteObjects",
  "CreateMultipartUpload",
  "CompleteMultipartUpload",
  "UploadPart",
  "CopyPart",
  "AbortMultipartUpload",
  "ListObjects",
  "ListObjectsV2",
  "ListBuckets",
  "ListMultipartUploads",
  "ListParts",
]);

function buildTimeRange(): TimeRange {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return {
    dayStart: `${today}T00:00:00Z`,
    now: now.toISOString(),
    monthStart: `${today.slice(0, 7)}-01`,
    today,
    oneHourAgo: new Date(now.getTime() - 3_600_000).toISOString(),
  };
}

const MONITOR_QUERY = `
  query MonitorQuery(
    $accountId: String!
    $scriptName: String!
    $dbId: String!
    $dayStart: String!
    $monthStart: String!
    $today: String!
    $now: String!
    $oneHourAgo: String!
  ) {
    viewer {
      accounts(filter: { accountTag: $accountId }) {
        workersToday: workersInvocationsAdaptive(
          limit: 10000
          filter: {
            scriptName: $scriptName
            datetime_geq: $dayStart
            datetime_leq: $now
          }
        ) {
          sum { requests errors }
        }
        workersLastHour: workersInvocationsAdaptive(
          limit: 10000
          filter: {
            scriptName: $scriptName
            datetime_geq: $oneHourAgo
            datetime_leq: $now
          }
        ) {
          sum { requests errors }
        }
        d1Today: d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: {
            databaseId: $dbId
            datetime_geq: $dayStart
            datetime_leq: $now
          }
        ) {
          sum { readQueries writeQueries }
        }
        r2OpsMonth: r2OperationsAdaptiveGroups(
          limit: 10000
          filter: {
            date_geq: $monthStart
            date_leq: $today
          }
        ) {
          dimensions { actionType }
          sum { requests }
        }
        r2Storage: r2StorageAdaptiveGroups(
          limit: 1
          filter: {
            date_geq: $monthStart
            date_leq: $today
          }
        ) {
          max { payloadSize }
        }
        doMonth: durableObjectsInvocationsAdaptiveGroups(
          limit: 10000
          filter: {
            date_geq: $monthStart
            date_leq: $today
          }
        ) {
          sum { requests wallTime }
        }
      }
    }
  }
`;

async function runGraphQLQuery(
  token: string,
  variables: Record<string, string>
): Promise<QueryData> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: MONITOR_QUERY, variables }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as GraphQLResponse<QueryData>;
  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }

  return json.data;
}

async function fetchD1StorageBytes(
  accountId: string,
  token: string,
  dbId: string
): Promise<number> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/d1/database/${dbId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return 0;
  const json = (await res.json()) as {
    result?: { file_size?: number };
  };
  return json.result?.file_size ?? 0;
}

function classifyR2Ops(groups: R2OpsGroup[]): {
  classAOps: number;
  classBOps: number;
} {
  let classAOps = 0;
  let classBOps = 0;
  for (const g of groups) {
    const action = g.dimensions?.actionType ?? "";
    if (R2_CLASS_A_ACTIONS.has(action)) {
      classAOps += g.sum.requests;
    } else {
      classBOps += g.sum.requests;
    }
  }
  return { classAOps, classBOps };
}

async function collectMetrics(
  accountId: string,
  token: string,
  envConfig: EnvironmentConfig
): Promise<MetricsResult> {
  const times = buildTimeRange();
  const variables = {
    accountId,
    scriptName: envConfig.scriptName,
    dbId: envConfig.d1DbId,
    dayStart: times.dayStart,
    monthStart: times.monthStart,
    today: times.today,
    now: times.now,
    oneHourAgo: times.oneHourAgo,
  };

  const [data, d1StorageBytes] = await Promise.all([
    runGraphQLQuery(token, variables),
    fetchD1StorageBytes(accountId, token, envConfig.d1DbId),
  ]);

  const account = data.viewer.accounts[0];
  if (!account) throw new Error("No account data returned from GraphQL");

  const workersTodayRequests = account.workersToday.reduce(
    (s, g) => s + g.sum.requests,
    0
  );
  const workersLastHourErrors = account.workersLastHour.reduce(
    (s, g) => s + g.sum.errors,
    0
  );

  const d1ReadRows = account.d1Today.reduce((s, g) => s + g.sum.readQueries, 0);
  const d1WriteRows = account.d1Today.reduce(
    (s, g) => s + g.sum.writeQueries,
    0
  );

  const { classAOps, classBOps } = classifyR2Ops(account.r2OpsMonth);
  const r2StorageBytes = account.r2Storage.reduce(
    (max, g) => Math.max(max, g.max.payloadSize),
    0
  );

  const doRequests = account.doMonth.reduce((s, g) => s + g.sum.requests, 0);
  // wallTime is in μs; convert to GB-s assuming 128 MB DO memory
  const doWallTimeUs = account.doMonth.reduce((s, g) => s + g.sum.wallTime, 0);
  const doDurationGBs = (doWallTimeUs / 1_000_000) * (128 / 1_024);

  return {
    workers: { requests: workersTodayRequests, errorsLastHour: workersLastHourErrors },
    d1: { readRows: d1ReadRows, writeRows: d1WriteRows, storageBytes: d1StorageBytes },
    r2: { classAOps, classBOps, storageBytes: r2StorageBytes },
    durableObjects: { requests: doRequests, durationGBs: doDurationGBs },
  };
}

// ---- Formatting helpers ----

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

interface UsageLine {
  text: string;
  isAlert: boolean;
}

function usageLine(
  label: string,
  value: number,
  limit: number,
  displayFn: (n: number) => string = fmt
): UsageLine {
  const pct = limit > 0 ? value / limit : 0;
  const icon = pct >= ALERT_THRESHOLD ? "🔴" : pct >= 0.5 ? "🟡" : "🟢";
  const text = `${icon} **${label}**: ${displayFn(value)} / ${displayFn(limit)} (${(pct * 100).toFixed(1)}%)`;
  return { text, isAlert: pct >= ALERT_THRESHOLD };
}

function buildDiscordPayload(label: string, metrics: MetricsResult): object {
  const { workers, d1, r2, durableObjects } = metrics;

  const errorIcon = workers.errorsLastHour > 0 ? "🔴" : "🟢";
  const errorLine: UsageLine = {
    text: `${errorIcon} **Worker 5xx (last 1h)**: ${fmt(workers.errorsLastHour)}`,
    isAlert: workers.errorsLastHour > 0,
  };

  const lines: UsageLine[] = [
    usageLine("Workers Requests (today)", workers.requests, LIMITS.workers.requests),
    errorLine,
    usageLine("D1 Read Rows (today)", d1.readRows, LIMITS.d1.readRows),
    usageLine("D1 Write Rows (today)", d1.writeRows, LIMITS.d1.writeRows),
    usageLine("D1 Storage", d1.storageBytes, LIMITS.d1.storageBytes, fmtBytes),
    usageLine("R2 Class A Ops (month)", r2.classAOps, LIMITS.r2.classAOps),
    usageLine("R2 Class B Ops (month)", r2.classBOps, LIMITS.r2.classBOps),
    usageLine("R2 Storage", r2.storageBytes, LIMITS.r2.storageBytes, fmtBytes),
    usageLine("DO Requests (month)", durableObjects.requests, LIMITS.do.requests),
    usageLine("DO Duration GB-s (month)", durableObjects.durationGBs, LIMITS.do.durationGBs),
  ];

  const isAlert = lines.some((l) => l.isAlert);
  const color = isAlert ? 0xff0000 : 0x00cc66;

  return {
    embeds: [
      {
        title: `📊 Cloudflare Free Tier Monitor [${label}]`,
        description: lines.map((l) => l.text).join("\n"),
        color,
        footer: {
          text: `Checked at ${new Date().toUTCString()}`,
        },
      },
    ],
  };
}

function buildErrorPayload(label: string, err: unknown): object {
  const message = err instanceof Error ? err.message : String(err);
  return {
    embeds: [
      {
        title: `❌ cf-full-monitor [${label}]: Fetch Error`,
        description: `\`\`\`\n${message}\n\`\`\``,
        color: 0xff0000,
        footer: { text: new Date().toUTCString() },
      },
    ],
  };
}

async function sendDiscord(webhookUrl: string, payload: object): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}`);
  }
}

// For counters that periodically reset (daily/monthly), if curr < prev a reset occurred.
// In that case compare against 0 so post-reset usage (e.g. 2000 after reset from 5000) is detected.
function counterBaseline(prev: number, curr: number): number {
  return curr < prev ? 0 : prev;
}

function hasIncreased(prev: MetricsResult | null, curr: MetricsResult): boolean {
  if (!prev) return true;
  return (
    curr.workers.requests > counterBaseline(prev.workers.requests, curr.workers.requests) ||
    curr.workers.errorsLastHour > counterBaseline(prev.workers.errorsLastHour, curr.workers.errorsLastHour) ||
    curr.d1.readRows > counterBaseline(prev.d1.readRows, curr.d1.readRows) ||
    curr.d1.writeRows > counterBaseline(prev.d1.writeRows, curr.d1.writeRows) ||
    curr.d1.storageBytes > prev.d1.storageBytes ||
    curr.r2.classAOps > counterBaseline(prev.r2.classAOps, curr.r2.classAOps) ||
    curr.r2.classBOps > counterBaseline(prev.r2.classBOps, curr.r2.classBOps) ||
    curr.r2.storageBytes > prev.r2.storageBytes ||
    curr.durableObjects.requests > counterBaseline(prev.durableObjects.requests, curr.durableObjects.requests) ||
    curr.durableObjects.durationGBs > counterBaseline(prev.durableObjects.durationGBs, curr.durableObjects.durationGBs)
  );
}

async function runForEnvironment(
  accountId: string,
  token: string,
  envConfig: EnvironmentConfig,
  kv: KVNamespace
): Promise<void> {
  const kvKey = `metrics:${envConfig.label}`;
  let payload: object | null = null;

  try {
    const [metrics, prev] = await Promise.all([
      collectMetrics(accountId, token, envConfig),
      kv.get<MetricsResult>(kvKey, "json"),
    ]);

    await kv.put(kvKey, JSON.stringify(metrics));

    if (hasIncreased(prev, metrics)) {
      payload = buildDiscordPayload(envConfig.label, metrics);
    }
  } catch (err) {
    payload = buildErrorPayload(envConfig.label, err);
  }

  if (payload) {
    await sendDiscord(envConfig.webhookUrl, payload);
  }
}

function parseEnvironmentConfigs(env: Env): EnvironmentConfig[] {
  return env.ENVIRONMENT_NAMES.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      const prefix = name.toUpperCase();
      const scriptName = env[`${prefix}_SCRIPT_NAME`] as string | undefined;
      const d1DbId = env[`${prefix}_D1_DB_ID`] as string | undefined;
      const webhookUrl = env[`${prefix}_DISCORD_WEBHOOK_URL`] as string | undefined;
      if (!scriptName || !d1DbId || !webhookUrl) {
        throw new Error(
          `Missing bindings for environment "${name}". ` +
          `Expected: ${prefix}_SCRIPT_NAME, ${prefix}_D1_DB_ID, ${prefix}_DISCORD_WEBHOOK_URL`
        );
      }
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      return { label, scriptName, d1DbId, webhookUrl };
    });
}

// ---- Entrypoint ----

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const configs = parseEnvironmentConfigs(env);
    await Promise.all(
      configs.map((config) =>
        runForEnvironment(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN, config, env.METRICS_KV)
      )
    );
  },
} satisfies ExportedHandler<Env>;
