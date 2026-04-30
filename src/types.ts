export interface Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  TARGET_SCRIPT_NAME: string;
  TARGET_D1_DB_ID: string;
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
    wallTime: number; // milliseconds
  };
}

export interface AccountData {
  workersToday: WorkersGroup[];
  workersLastHour: WorkersGroup[];
  d1Today: D1Group[];
  r2OpsMonth: R2OpsGroup[];
  r2Storage: R2StorageGroup[];
  doMonth: DOGroup[];
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
