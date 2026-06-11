import type { JobRequestInput, JobSummary } from "@/types/domain";

const SECRET_KEY_PATTERN = /(pass|password|secret|token|key|credential|authorization|cloudDbUrl|serviceRole)/i;

const CONNECTION_PASSWORD_PATTERN = /(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/gi;

export function maskSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return maskLogLine(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => maskSecrets(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (SECRET_KEY_PATTERN.test(key)) return [key, "[redacted]"];
        return [key, maskSecrets(entry)];
      })
    );
  }

  return value;
}

export function maskLogLine(message: string) {
  return String(message)
    .replace(CONNECTION_PASSWORD_PATTERN, "$1[redacted]$3")
    .replace(/(SERVICE_ROLE_KEY|ANON_KEY|JWT_SECRET|POSTGRES_PASSWORD|DASHBOARD_PASSWORD|SECRET_KEY_BASE|VAULT_ENC_KEY)=([^\s]+)/gi, "$1=[redacted]")
    .replace(/(password|secret|token|service[_-]?key|root[_-]?pass)\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]");
}

export function buildSafeSummary(input: JobRequestInput, runnerMode: "dry-run" | "legacy"): JobSummary {
  const domains = [
    input.studioDomain, input.apiDomain,
    input.studioDomain2, input.apiDomain2,
    input.studioDomain3, input.apiDomain3,
    input.siteUrl
  ]
    .filter(Boolean)
    .map(value => String(value));

  const schemas = String(input.schemaFilter || "")
    .split(",")
    .map(schema => schema.trim())
    .filter(Boolean);

  const flags = [
    input.getSSL ? "SSL" : "",
    input.setupBackup ? "Backup transfer" : "",
    input.migrateStorage ? "Storage transfer" : "",
    input.continueOnMinorErrors ? "Minor errors allowed" : "",
    input.skipInstall ? "Skip install" : "",
    input.dryRun ? "Dry run" : ""
  ].filter(Boolean);

  return {
    module: input.type,
    source: input.sourceHost ? normalizeHost(input.sourceHost) : input.cloudDbUrl ? "Supabase Cloud DB" : undefined,
    target: input.targetHost ? normalizeHost(input.targetHost) : undefined,
    targetInstance: input.targetInstance || "1",
    domains,
    schemas,
    flags,
    runnerMode
  };
}

function normalizeHost(host: string) {
  return host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export function assertNoPersistedSecrets(summary: JobSummary) {
  const serialized = JSON.stringify(summary);
  const suspicious = [
    "BEGIN PRIVATE KEY",
    "service_role",
    "postgresql://postgres:",
    "JWT_SECRET",
    "POSTGRES_PASSWORD"
  ];

  if (suspicious.some(token => serialized.includes(token))) {
    throw new Error("Sanitized job summary contains a secret-like value.");
  }
}
