import type { JobLogEntry, JobRequestInput } from "@/types/domain";

type LogFn = (jobId: string, level: JobLogEntry["level"], message: string) => void;

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

  addLog(jobId, "step", "Legacy taşıma motoru (bridge) başlatıldı");
  addLog(jobId, "info", `Hedef ortam: ${baseUrl}`);

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
  const response = await fetch(new URL(endpoint, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Legacy endpoint HTTP ${response.status}`);
  }

  addLog(jobId, "info", "İşlem legacy sunucusu tarafından kabul edildi, canlı kayıtlar (log stream) bekleniyor...");
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

  const response = await fetch(new URL(endpoint, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildLegacyBody(input, `saas_${jobId}`))
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false || data?.error) {
    throw new Error(data?.error || `Legacy endpoint HTTP ${response.status}`);
  }

  addLog(jobId, "success", "Legacy analiz tamamlandı.");
  addLog(jobId, "info", JSON.stringify(data).slice(0, 1800));
}

async function readLegacySse(jobId: string, url: URL, addLog: LogFn) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/event-stream"
    }
  });

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
      if (payload.msg) addLog(jobId, level, payload.msg);
    }
  }
}

function buildLegacyBody(input: JobRequestInput, sessionId: string) {
  const env = {
    POSTGRES_PASSWORD: "",
    JWT_SECRET: "",
    ANON_KEY: "",
    SERVICE_ROLE_KEY: "",
    DASHBOARD_PASSWORD: ""
  };

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
        targetInstance: input.targetInstance || "1",
        anonymizeData: input.anonymizeData
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
        anonymizeData: input.anonymizeData
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

function normalizeLegacyLevel(level: string): JobLogEntry["level"] {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  if (level === "success") return "success";
  if (level === "step") return "step";
  return "info";
}
