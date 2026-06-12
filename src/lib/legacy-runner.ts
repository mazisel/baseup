import { createHmac, randomBytes } from "node:crypto";
import type { JobLogEntry, JobRequestInput } from "@/types/domain";

type LogFn = (jobId: string, level: JobLogEntry["level"], message: string) => Promise<void> | void;

const LEGACY_CONNECT_TIMEOUT_MS = 10_000;

export class LegacyBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyBridgeUnavailableError";
  }
}

const STREAMING_ENDPOINTS: Partial<Record<JobRequestInput["type"], string>> = {
  self_hosted_migration: "/api/migrate",
  cloud_to_self_hosted: "/api/migrate-from-cloud",
  clean_install: "/api/clean-install",
  settings_update: "/api/update-settings",
  setup_automated_backup: "/api/setup-backup",
  supabase_upgrade: "/api/upgrade-supabase",
  ai_seeder: "/api/ai-seed",
  prod_to_local: "/api/clone-local",
  edge_functions_migrator: "/api/migrate-edge",
  infra_inspector: "/api/inspect-infra"
};

const JSON_ENDPOINTS: Partial<Record<JobRequestInput["type"], string>> = {
  schema_compare: "/api/compare-schema",
  db_compare: "/api/compare-db",
  structure_export: "/api/export-structure-sql"
};

export async function runLegacyBridgeJob(jobId: string, input: JobRequestInput, addLog: LogFn) {
  const baseUrl = process.env.LEGACY_WEBAPP_URL;
  if (!baseUrl) throw new Error("LEGACY_WEBAPP_URL tanımlı değil.");

  await addLog(jobId, "step", "Legacy taşıma motoru (bridge) başlatıldı");
  await addLog(jobId, "info", `Hedef ortam: ${baseUrl}`);
  await assertLegacyReachable(baseUrl);

  if (STREAMING_ENDPOINTS[input.type]) {
    await runStreamingLegacyJob(jobId, baseUrl, STREAMING_ENDPOINTS[input.type], input, addLog);
    return;
  }

  if (JSON_ENDPOINTS[input.type]) {
    await runJsonLegacyJob(jobId, baseUrl, JSON_ENDPOINTS[input.type], input, addLog);
    return;
  }

  throw new Error(`Desteklenmeyen modül: ${input.type}`);
}

async function runStreamingLegacyJob(
  jobId: string,
  baseUrl: string,
  endpoint: string | undefined,
  input: JobRequestInput,
  addLog: LogFn
) {
  if (!endpoint) throw new Error("Legacy endpoint bulunamadı.");

  const legacySessionId = `saas_${jobId}`;
  const body = buildLegacyBody(input, legacySessionId);

  const response = await fetchWithTimeout(new URL(endpoint, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }, LEGACY_CONNECT_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Legacy endpoint HTTP ${response.status}`);
  }

  await addLog(jobId, "info", "İşlem legacy sunucusu tarafından kabul edildi, canlı kayıtlar bekleniyor...");
  await readLegacySse(jobId, new URL(`/api/logs/${legacySessionId}`, baseUrl), addLog);
}

async function runJsonLegacyJob(
  jobId: string,
  baseUrl: string,
  endpoint: string | undefined,
  input: JobRequestInput,
  addLog: LogFn
) {
  if (!endpoint) throw new Error("Legacy endpoint bulunamadı.");

  const response = await fetchWithTimeout(new URL(endpoint, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildLegacyBody(input, `saas_${jobId}`))
  }, LEGACY_CONNECT_TIMEOUT_MS);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false || data?.error) {
    throw new Error(data?.error || `Legacy endpoint HTTP ${response.status}`);
  }

  await addLog(jobId, "success", "Legacy analiz tamamlandı.");
  await addLog(jobId, "info", JSON.stringify(data).slice(0, 1800));
}

// Docker pull katman ilerlemesi ("a1b2c3 Downloading 114.3MB" gibi) saniyede onlarca
// satır üretir: job_events tablosunu şişirir ve Supabase Realtime'ı boğar. Bu satırlar
// işlevsel bilgi taşımadığı için loglanmaz; pull başlangıç/bitiş mesajları geçer.
const DOCKER_PULL_PROGRESS_PATTERN = /^[0-9a-f]{10,12}:?\s+(Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/i;

function isNoiseLogLine(message: string) {
  return DOCKER_PULL_PROGRESS_PATTERN.test(message.trim());
}

async function readLegacySse(jobId: string, url: URL, addLog: LogFn) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "text/event-stream"
    }
  }, LEGACY_CONNECT_TIMEOUT_MS);

  if (!response.ok || !response.body) {
    throw new Error(`Legacy log stream açılamadı: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find(item => item.startsWith("data:"));
      if (!line) continue;

      const payload = JSON.parse(line.replace(/^data:\s*/, ""));
      if (payload.type === "done") return;
      if (payload.type === "error") throw new Error(payload.msg || "Legacy job hata verdi.");

      const level = normalizeLegacyLevel(payload.type || payload.level);
      if (payload.msg && !isNoiseLogLine(payload.msg)) await addLog(jobId, level, payload.msg);
    }
  }
}

async function assertLegacyReachable(baseUrl: string) {
  await fetchWithTimeout(new URL("/", baseUrl), {}, LEGACY_CONNECT_TIMEOUT_MS);
}

async function fetchWithTimeout(url: URL, init: RequestInit = {}, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    throw new LegacyBridgeUnavailableError(buildLegacyConnectionMessage(url.origin, error));
  } finally {
    clearTimeout(timeout);
  }
}

function buildLegacyConnectionMessage(baseUrl: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "bağlantı kurulamadı";
  const hint = baseUrl.includes("172.17.0.1")
    ? "Portainer env içindeki LEGACY_WEBAPP_URL eski host adresine bakıyor. Compose içindeki legacy servisi kullanmak için LEGACY_WEBAPP_URL değerini kaldırın veya http://legacy:4567 yapın."
    : "Legacy servisin aynı Docker stack içinde çalıştığını ve LEGACY_WEBAPP_URL değerinin doğru olduğunu kontrol edin.";

  return `Legacy taşıma motoruna ulaşılamıyor (${baseUrl}). ${hint} Teknik detay: ${detail}`;
}

function buildLegacyBody(input: JobRequestInput, sessionId: string) {
  const env = generateSupabaseEnv(input.dashboardPass);

  switch (input.type) {
    case "self_hosted_migration":
      return {
        sourceHost: input.sourceHost,
        sourcePass: input.sourcePass,
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        studioDomain: input.studioDomain,
        apiDomain: input.apiDomain,
        studioDomain2: input.studioDomain2,
        apiDomain2: input.apiDomain2,
        studioDomain3: input.studioDomain3,
        apiDomain3: input.apiDomain3,
        siteUrl: input.siteUrl,
        env,
        sessionId,
        getSSL: input.getSSL,
        setupBackup: input.setupBackup,
        certbotEmail: input.certbotEmail,
        continueOnMinorErrors: input.continueOnMinorErrors,
        preserveSourceKeys: input.preserveSourceKeys,
        resume: input.resume,
        cleanupOnFailure: input.cleanupOnFailure,
        targetInstance: input.targetInstance || "1",
        anonymizeData: input.anonymizeData,
        migrateData: input.migrateData,
        schemaOnly: input.skipData === true,
        skipData: input.skipData
      };
    case "cloud_to_self_hosted":
      return {
        cloudUrl: input.cloudDbUrl,
        cloudApiUrl: input.cloudApiUrl,
        cloudServiceKey: input.cloudServiceKey,
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        studioDomain: input.studioDomain,
        apiDomain: input.apiDomain,
        studioDomain2: input.studioDomain2,
        apiDomain2: input.apiDomain2,
        studioDomain3: input.studioDomain3,
        apiDomain3: input.apiDomain3,
        env,
        sessionId,
        getSSL: input.getSSL,
        certbotEmail: input.certbotEmail,
        skipInstall: input.skipInstall,
        migrateStorage: input.migrateStorage,
        targetInstance: input.targetInstance || "1",
        anonymizeData: input.anonymizeData,
        migrateData: input.migrateData,
        schemaOnly: input.skipData === true,
        skipData: input.skipData
      };
    case "clean_install":
      return {
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        studioDomain: input.studioDomain,
        apiDomain: input.apiDomain,
        studioDomain2: input.studioDomain2,
        apiDomain2: input.apiDomain2,
        studioDomain3: input.studioDomain3,
        apiDomain3: input.apiDomain3,
        siteUrl: input.siteUrl,
        env,
        sessionId,
        getSSL: input.getSSL,
        certbotEmail: input.certbotEmail,
        targetInstance: input.targetInstance || "1"
      };
    case "settings_update":
      return {
        host: input.targetHost,
        password: input.targetPass,
        sessionId,
        targetInstance: input.targetInstance || "1",
        studioDomain: input.studioDomain,
        apiDomain: input.apiDomain,
        studioDomain2: input.studioDomain2,
        apiDomain2: input.apiDomain2,
        studioDomain3: input.studioDomain3,
        apiDomain3: input.apiDomain3,
        siteUrl: input.siteUrl,
        getSSL: input.getSSL,
        certbotEmail: input.certbotEmail,
        envUpdates: input.settingsUpdates || {}
      };
    case "schema_compare":
      return {
        server1Host: input.sourceHost,
        server1Password: input.sourcePass,
        server2Host: input.targetHost,
        server2Password: input.targetPass,
        schemaFilter: input.schemaFilter || "public",
        includeRls: true,
        rlsSyncDirection: "bidirectional",
        recreateMismatchedPolicies: false
      };
    case "db_compare":
      return {
        source: input.cloudDbUrl
          ? { type: "url", url: input.cloudDbUrl }
          : { type: "ssh", host: input.sourceHost, pass: input.sourcePass, instance: "1" },
        target: { type: "ssh", host: input.targetHost, pass: input.targetPass, instance: input.targetInstance || "1" }
      };
    case "structure_export":
      return {
        host: input.sourceHost,
        password: input.sourcePass,
        schemaFilter: input.schemaFilter
      };
    case "setup_automated_backup":
      return {
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        targetInstance: input.targetInstance || "1",
        s3AccessKey: input.s3AccessKey,
        s3SecretKey: input.s3SecretKey,
        s3Bucket: input.s3Bucket,
        s3Region: input.s3Region,
        s3Endpoint: input.s3Endpoint,
        cronSchedule: input.cronSchedule,
        sessionId
      };
    case "supabase_upgrade":
      return {
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        targetInstance: input.targetInstance || "1",
        targetVersion: input.targetVersion || "latest",
        sessionId
      };
    case "ai_seeder":
      return {
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        targetInstance: input.targetInstance || "1",
        targetTable: input.targetTable,
        rowCount: input.rowCount || 10,
        prompt: input.prompt,
        sessionId
      };
    case "prod_to_local":
      return {
        sourceHost: input.sourceHost,
        sourcePass: input.sourcePass,
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        anonymizeData: true, // Forced
        sessionId
      };
    case "edge_functions_migrator":
      return {
        sourceHost: input.sourceHost,
        sourcePass: input.sourcePass,
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        targetInstance: input.targetInstance || "1",
        migrateSecrets: input.migrateSecrets || false,
        sessionId
      };
    case "infra_inspector":
      return {
        targetHost: input.targetHost,
        targetPass: input.targetPass,
        targetInstance: input.targetInstance || "1",
        sessionId
      };
  }
}

function generateSupabaseEnv(dashboardPass?: string) {
  const jwtSecret = randomBytes(32).toString("hex");

  return {
    POSTGRES_PASSWORD: randomBytes(20).toString("hex"),
    JWT_SECRET: jwtSecret,
    ANON_KEY: generateJwt("anon", jwtSecret),
    SERVICE_ROLE_KEY: generateJwt("service_role", jwtSecret),
    // Kullanıcı Studio şifresi girdiyse onu kullan; boşsa güvenli bir şifre üret.
    DASHBOARD_PASSWORD: dashboardPass?.trim() || randomBytes(12).toString("base64").replace(/[/+=]/g, "").slice(0, 16),
    SECRET_KEY_BASE: randomBytes(48).toString("base64").replace(/\n/g, ""),
    VAULT_ENC_KEY: randomBytes(16).toString("hex"),
    PG_META_CRYPTO_KEY: randomBytes(16).toString("hex"),
    LOGFLARE_PUBLIC_ACCESS_TOKEN: randomBytes(32).toString("hex"),
    LOGFLARE_PRIVATE_ACCESS_TOKEN: randomBytes(32).toString("hex")
  };
}

function generateJwt(role: "anon" | "service_role", secret: string) {
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    role,
    iss: "supabase",
    iat: 1768218500,
    exp: 2083578500
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function normalizeLegacyLevel(level: string): JobLogEntry["level"] {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  if (level === "success") return "success";
  if (level === "step") return "step";
  return "info";
}
