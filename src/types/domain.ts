export type PlanId = string;

export type MembershipRole = "owner" | "admin" | "operator" | "viewer";

export type JobStatus = "queued" | "running" | "success" | "error" | "cancelled";

export type JobLogLevel = "info" | "warn" | "error" | "success" | "step";

export type MigrationModuleType =
  | "self_hosted_migration"
  | "cloud_to_self_hosted"
  | "clean_install"
  | "settings_update"
  | "schema_compare"
  | "db_compare"
  | "structure_export"
  | "setup_automated_backup"
  | "supabase_upgrade"
  | "ai_seeder"
  | "prod_to_local"
  | "edge_functions_migrator"
  | "infra_inspector";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
};

export type AppUser = {
  id: string;
  email: string;
  name: string;
  workspace: Workspace;
  role: MembershipRole;
  plan: PlanId;
  monthlyJobLimit: number;
  parallelJobLimit: number;
};

export type JobLogEntry = {
  id: string;
  level: JobLogLevel;
  message: string;
  createdAt: string;
};

export type JobSummary = {
  module: MigrationModuleType;
  source?: string;
  target?: string;
  targetInstance?: string;
  domains?: string[];
  schemas?: string[];
  flags?: string[];
  runnerMode: "dry-run" | "legacy";
  requiresCredentialResubmission?: boolean;
};

export type JobRun = {
  id: string;
  workspaceId: string;
  createdBy: string;
  type: MigrationModuleType;
  title: string;
  status: JobStatus;
  summary: JobSummary;
  logs: JobLogEntry[];
  errorMessage?: string;
  usageUnits: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type HealthMonitor = {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  status: "pending" | "up" | "down" | "paused";
  lastCheckedAt?: string;
  createdAt: string;
};

export type HealthEvent = {
  id: string;
  monitorId: string;
  status: "up" | "down";
  responseTimeMs?: number;
  errorMessage?: string;
  createdAt: string;
};

export type JobRequestInput = {
  type: MigrationModuleType;
  sourceHost?: string;
  sourcePass?: string;
  targetHost?: string;
  targetPass?: string;
  // Studio (dashboard) basic auth şifresi; boş bırakılırsa motor güvenli bir şifre üretir.
  dashboardPass?: string;
  targetInstance?: string;
  studioDomain?: string; // Maps to Instance 1
  apiDomain?: string;    // Maps to Instance 1
  studioDomain2?: string;
  apiDomain2?: string;
  studioDomain3?: string;
  apiDomain3?: string;
  siteUrl?: string;
  cloudDbUrl?: string;
  cloudApiUrl?: string;
  cloudServiceKey?: string;
  schemaFilter?: string;
  getSSL?: boolean;
  certbotEmail?: string;
  setupBackup?: boolean;
  migrateStorage?: boolean;
  continueOnMinorErrors?: boolean;
  skipInstall?: boolean;
  dryRun?: boolean;
  // Kaynaktaki JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY değerlerini hedefe taşı; böylece
  // müşterinin mevcut uygulamalarındaki anahtarlar taşıma sonrası çalışmaya devam eder.
  preserveSourceKeys?: boolean;
  // Hedefte önceki çalışmanın checkpoint'i varsa tamamlanmış ağır adımları atla.
  resume?: boolean;
  cleanupOnFailure?: boolean;
  skipData?: boolean;
  settingsUpdates?: Record<string, string>;
  
  // S3 Backup specific fields
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  cronSchedule?: string;
  
  // Data masking
  anonymizeData?: boolean;
  
  // Edge Migrator specific
  migrateSecrets?: boolean;

  // Upgrade
  targetVersion?: string;

  // AI Seeder
  targetTable?: string;
  rowCount?: number;
  prompt?: string;
};

export type JobEvent =
  | { type: "snapshot"; payload: JobRun }
  | { type: "job"; payload: JobRun }
  | { type: "log"; payload: JobLogEntry };
