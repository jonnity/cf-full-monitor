export interface Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  // Comma-separated list of environment names, e.g. "staging,prod"
  // Each name N must have N_SCRIPT_NAME, N_D1_DB_ID, N_DISCORD_WEBHOOK_URL bindings.
  ENVIRONMENT_NAMES: string;
  METRICS_KV: KVNamespace;
  [key: string]: string | KVNamespace;
}

export interface EnvironmentConfig {
  label: string;
  scriptName: string;
  d1DbId: string;
  webhookUrl: string;
}

export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

// GraphQL node types
export interface WorkersGroup {
  sum: { requests: number; errors: number };
}

export interface D1Group {
  sum: { readQueries: number; writeQueries: number };
}

export interface R2OpsGroup {
  dimensions: { actionType: string };
  sum: { requests: number };
}

export interface R2StorageGroup {
  max: { payloadSize: number };
}

export interface DOGroup {
  sum: {
    requests: number;
  };
}

export interface DODurationGroup {
  sum: {
    duration: number; // GB-s (billed Durable Objects duration)
  };
}

export interface AccountData {
  workersToday: WorkersGroup[];
  workersLastHour: WorkersGroup[];
  d1Today: D1Group[];
  r2OpsMonth: R2OpsGroup[];
  r2Storage: R2StorageGroup[];
  doMonth: DOGroup[];
  doDurationMonth: DODurationGroup[];
}

export interface QueryData {
  viewer: {
    accounts: AccountData[];
  };
}

export interface MetricsResult {
  workers: {
    requests: number;
    errorsLastHour: number;
  };
  d1: {
    readRows: number;
    writeRows: number;
    storageBytes: number;
  };
  r2: {
    classAOps: number;
    classBOps: number;
    storageBytes: number;
  };
  durableObjects: {
    requests: number;
    durationGBs: number;
  };
}

export interface TimeRange {
  dayStart: string;   // ISO timestamp: start of today UTC
  now: string;        // ISO timestamp: current time
  monthStart: string; // YYYY-MM-DD: first of current month
  today: string;      // YYYY-MM-DD: today
  oneHourAgo: string; // ISO timestamp: 1 hour ago
}
