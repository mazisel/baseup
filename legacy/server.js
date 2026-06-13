const express = require('express');
const crypto = require('crypto');
const { Client: SshClient } = require('ssh2');
const { Client: PgClient } = require('pg');
const path = require('path');

function getInstanceDir(id) {
  return id === '1' || !id ? '/root/supabase' : `/root/supabase-${id}`;
}

function getInstancePorts(id) {
  const offset = (parseInt(id) || 1) - 1;
  return {
    POSTGRES_PORT: 5432 + offset,
    POOLER_PROXY_PORT_TRANSACTION: 6543 + offset,
    KONG_HTTP_PORT: 8000 + offset,
    KONG_HTTPS_PORT: 8443 + offset,
    SMTP_PORT: 2500 + offset,
    STUDIO_PORT: 3000 + offset
  };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE için aktif bağlantılar
const sseClients = new Map();
const sseHistory = new Map();
const sseCleanupTimers = new Map();
const SSE_HISTORY_LIMIT = 1000;
const SSE_HISTORY_TTL_MS = 60 * 60 * 1000;
const SSH_READY_TIMEOUT = 30000;
const SSH_KEEPALIVE_INTERVAL = 15000;
const SSH_KEEPALIVE_COUNT_MAX = 6;
const SSH_RETRY_DELAYS = [2000, 5000, 10000, 15000, 30000];

function formatSsePayload(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function cacheSsePayload(sessionId, payload) {
  if (!sessionId) return;
  const history = sseHistory.get(sessionId) || [];
  history.push(payload);
  if (history.length > SSE_HISTORY_LIMIT) {
    history.splice(0, history.length - SSE_HISTORY_LIMIT);
  }
  sseHistory.set(sessionId, history);

  const existingTimer = sseCleanupTimers.get(sessionId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    sseHistory.delete(sessionId);
    sseCleanupTimers.delete(sessionId);
  }, SSE_HISTORY_TTL_MS);
  sseCleanupTimers.set(sessionId, timer);
}

function writeSse(sessionId, payload, options = {}) {
  if (options.cache !== false) cacheSsePayload(sessionId, payload);
  const clients = sseClients.get(sessionId) || [];
  const line = formatSsePayload(payload);
  clients.forEach(client => client.write(line));
}

function closeSseSession(sessionId, payload) {
  if (payload) writeSse(sessionId, payload);
  const clients = sseClients.get(sessionId) || [];
  clients.forEach(client => {
    try { client.end(); } catch (_) { /* no-op */ }
  });
  sseClients.delete(sessionId);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatSshError(err) {
  const message = String(err?.message || 'SSH bağlantısı başarısız');
  const code = String(err?.code || '').trim();
  if (!code || message.includes(code)) return message;
  return `${message} (${code})`;
}

function isTransientSshError(err) {
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || '').toLowerCase();
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  return [
    'read econnreset',
    'connection reset',
    'connection lost',
    'socket hang up',
    'timed out',
    'timeout',
    'handshake',
    'no response from server'
  ].some(pattern => message.includes(pattern));
}

function getSshConnectOptions(host, password) {
  return {
    host,
    port: 22,
    username: 'root',
    password,
    readyTimeout: SSH_READY_TIMEOUT,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX
  };
}

function parseServiceStatusRows(output) {
  return String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const idx = line.indexOf('|');
      return idx > 0 ? { name: line.slice(0, idx), status: line.slice(idx + 1) } : null;
    })
    .filter(Boolean);
}

// ─── SSH Helper ────────────────────────────────────────────────
const SSH_HARD_TIMEOUT = 45000; // 45s — TCP connect + SSH handshake dahil toplam süre

function sshExecAttempt(host, password, command) {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    let output = '';
    let errOutput = '';
    let settled = false;
    let ready = false;
    let execStarted = false;

    // Hard timeout: TCP bağlantısı sessizce düşürülürse readyTimeout çalışmaz,
    // bu yüzden tüm denemeyi 45 saniyeyle sınırlıyoruz.
    const hardTimer = setTimeout(() => {
      if (settled) return;
      try { conn.end(); } catch (_) { /* no-op */ }
      const err = new Error(`SSH bağlantısı zaman aşımına uğradı (${SSH_HARD_TIMEOUT / 1000}s) — sunucu erişilemez olabilir`);
      err.code = 'ETIMEDOUT';
      safeReject(err);
    }, SSH_HARD_TIMEOUT);

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      resolve(value);
    };

    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (err && typeof err === 'object') {
        err.sshReady = ready;
        err.sshExecStarted = execStarted;
      }
      try { conn.end(); } catch (_) { /* no-op */ }
      reject(err);
    };

    conn.on('ready', () => {
      ready = true;
      conn.exec(command, (err, stream) => {
        if (err) return safeReject(err);
        execStarted = true;
        stream.on('data', d => output += d.toString());
        stream.stderr.on('data', d => errOutput += d.toString());
        stream.on('close', () => {
          try { conn.end(); } catch (_) { /* no-op */ }
          safeResolve({ output, err: errOutput });
        });
        stream.on('error', safeReject);
      });
    }).on('error', safeReject).connect(getSshConnectOptions(host, password));
  });
}

async function sshExec(host, password, command, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || SSH_RETRY_DELAYS.length));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[SSH] Deneme ${attempt}/${maxAttempts} → ${host} (komut: ${command.substring(0, 60)})`);
      return await sshExecAttempt(host, password, command);
    } catch (err) {
      console.log(`[SSH] Deneme ${attempt} başarısız: ${err.message}`);
      const canRetry = isTransientSshError(err)
        && (options.retryAfterExecStarted || !err?.sshExecStarted)
        && attempt < maxAttempts;
      if (!canRetry) throw err;
      console.log(`[SSH] ${SSH_RETRY_DELAYS[Math.min(attempt, SSH_RETRY_DELAYS.length - 1)]}ms sonra tekrar denenecek...`);
      await delay(SSH_RETRY_DELAYS[Math.min(attempt, SSH_RETRY_DELAYS.length - 1)] || SSH_RETRY_DELAYS[SSH_RETRY_DELAYS.length - 1]);
    }
  }
}

function sshExecStreamAttempt(host, password, command, sessionId) {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    const sendLog = (msg, type = 'log') => {
      writeSse(sessionId, { type, msg });
      console.log(`[SSH ${type.toUpperCase()}] ${msg.substring(0, 200)}${msg.length > 200 ? '...' : ''}`);
    };
    let settled = false;
    let ready = false;
    let execStarted = false;

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      if (err && typeof err === 'object') {
        err.sshReady = ready;
        err.sshExecStarted = execStarted;
      }
      try { conn.end(); } catch (_) { /* no-op */ }
      reject(err);
    };

    conn.on('ready', () => {
      ready = true;
      sendLog('🔗 SSH bağlantısı kuruldu');
      conn.exec(command, (err, stream) => {
        if (err) return safeReject(err);
        execStarted = true;
        stream.on('data', d => sendLog(d.toString().trim()));
        stream.stderr.on('data', d => sendLog(d.toString().trim(), 'warn'));
        stream.on('close', code => {
          try { conn.end(); } catch (_) { /* no-op */ }
          sendLog(code === 0 ? '✅ Tamamlandı' : `⚠️ Çıkış kodu: ${code}`, code === 0 ? 'success' : 'warn');
          safeResolve(code);
        });
        stream.on('error', safeReject);
      });
    }).on('error', safeReject).connect(getSshConnectOptions(host, password));
  });
}

async function sshExecStream(host, password, command, sessionId, options = {}) {
  const sendLog = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const stepLabel = options.stepLabel || 'Bu adım';
  const maxAttempts = Math.max(1, Number(options.maxAttempts || SSH_RETRY_DELAYS.length));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sshExecStreamAttempt(host, password, command, sessionId);
    } catch (err) {
      const message = formatSshError(err);
      const transient = isTransientSshError(err);
      const canRetry = transient
        && (options.retryAfterExecStarted || !err?.sshExecStarted)
        && attempt < maxAttempts;
      if (canRetry) {
        sendLog(`⚠️ SSH bağlantısı koptu: ${message}. ${stepLabel} yeniden deneniyor (${attempt}/${maxAttempts})`, 'warn');
        await delay(SSH_RETRY_DELAYS[Math.min(attempt, SSH_RETRY_DELAYS.length - 1)] || SSH_RETRY_DELAYS[SSH_RETRY_DELAYS.length - 1]);
        continue;
      }
      if (transient && options.allowContinueOnTransientError) {
        sendLog(`⚠️ ${stepLabel} sırasında geçici SSH hatası oluştu: ${message}. Bu adım atlanarak devam ediliyor.`, 'warn');
        return Number.isFinite(options.continueResult) ? options.continueResult : 0;
      }
      sendLog(`❌ SSH Hatası: ${message}`, 'error');
      throw err;
    }
  }
}

// ─── JWT Üretici ───────────────────────────────────────────────
function generateJWT(role, secret) {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    role, iss: 'supabase', iat: 1768218500, exp: 2083578500
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function shellEscape(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function quoteQualifiedName(schemaName, tableName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

const SELF_HOSTED_MIGRATION_STAGES = {
  checking_source: 'Kaynak sunucu ön kontrolü',
  checking_target: 'Hedef sunucu ön kontrolü',
  creating_backup: 'Kaynak yedekleri oluşturuluyor',
  transferring_files: 'Dosyalar hedef sunucuya aktarılıyor',
  restoring_database: 'Veritabanı geri yükleniyor',
  restoring_storage: 'Storage geri yükleniyor',
  starting_services: 'Hedef servisler başlatılıyor',
  verifying: 'Son doğrulama yapılıyor'
};

const TARGET_MIN_FREE_DISK_GB = 10;
const TARGET_MIN_RAM_GB = 2;

function emitMigrationStage(log, stageKey) {
  const label = SELF_HOSTED_MIGRATION_STAGES[stageKey] || stageKey;
  log(`Aşama: ${stageKey} — ${label}`, 'step');
}

function buildSourcePreflightCommand(targetHost) {
  return `
set +e
emit() { printf 'PREFLIGHT|%s|%s\\n' "$1" "$2"; }

if command -v docker >/dev/null 2>&1; then
  emit PASS "Kaynak sunucuda Docker komutu var"
else
  emit FAIL "Kaynak sunucuda Docker kurulu değil"
fi

if docker info >/dev/null 2>&1; then
  emit PASS "Kaynak sunucuda Docker çalışıyor"
else
  emit FAIL "Kaynak sunucuda Docker çalışmıyor veya root Docker'a erişemiyor"
fi

SRC_DIR=""
for d in /root/supabase /home/supabase /opt/supabase /var/supabase /srv/supabase; do
  if [ -f "$d/docker/.env" ] || [ -f "$d/docker/docker-compose.yml" ]; then
    SRC_DIR="$d"
    break
  fi
done

if [ -n "$SRC_DIR" ]; then
  emit PASS "Kaynak Supabase kurulumu bulundu: $SRC_DIR"
  if [ -f "$SRC_DIR/docker/.env" ]; then
    emit PASS "Kaynak .env dosyası mevcut"
  else
    emit FAIL "Kaynak Supabase .env dosyası bulunamadı"
  fi
else
  emit FAIL "Kaynak sunucuda Supabase kurulumu bulunamadı"
fi

if docker ps --format '{{.Names}}' | grep -qx 'supabase-db'; then
  emit PASS "Kaynak supabase-db container çalışıyor"
else
  emit FAIL "Kaynak supabase-db container çalışmıyor"
fi

BAD_CONTAINERS=$(docker ps -a --format '{{.Names}}|{{.Status}}' 2>/dev/null | grep -Ei '^supabase|realtime|storage|auth|kong' | grep -Eiv 'Up|healthy' | head -n 8)
if [ -z "$BAD_CONTAINERS" ]; then
  emit PASS "Kaynak Supabase container durumları sağlıklı görünüyor"
else
  emit WARN "Kaynakta sağlıksız/durmuş container olabilir: $(printf '%s' "$BAD_CONTAINERS" | tr '\\n' '; ')"
fi

export TARGET_HOST=${shellEscape(targetHost || '')}
if [ -n "$TARGET_HOST" ] && timeout 8 bash -lc 'echo > /dev/tcp/"$TARGET_HOST"/22' >/dev/null 2>&1; then
  emit PASS "Kaynak sunucudan hedef SSH portuna erişiliyor"
else
  emit FAIL "Kaynak ve hedef sunucu arasında SSH erişimi yok"
fi
`;
}

function buildTargetPreflightCommand(targetInstance) {
  const instanceId = targetInstance || '1';
  const tgtDir = getInstanceDir(instanceId);
  const ports = getInstancePorts(instanceId);
  const requiredPorts = [
    ports.POSTGRES_PORT,
    ports.POOLER_PROXY_PORT_TRANSACTION,
    ports.KONG_HTTP_PORT,
    ports.KONG_HTTPS_PORT,
    ports.SMTP_PORT,
    ports.STUDIO_PORT
  ];

  return `
set +e
emit() { printf 'PREFLIGHT|%s|%s\\n' "$1" "$2"; }

FREE_KB=$(df -Pk / 2>/dev/null | awk 'NR==2 {print $4}')
FREE_GB=$((FREE_KB / 1024 / 1024))
if [ "$FREE_GB" -ge ${TARGET_MIN_FREE_DISK_GB} ]; then
  emit PASS "Hedef disk alanı yeterli: \${FREE_GB}GB boş"
else
  emit FAIL "Hedefte yeterli disk alanı yok: \${FREE_GB}GB boş (en az ${TARGET_MIN_FREE_DISK_GB}GB önerilir)"
fi

MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)
MEM_GB=$((MEM_KB / 1024 / 1024))
if [ "$MEM_GB" -ge ${TARGET_MIN_RAM_GB} ]; then
  emit PASS "Hedef RAM yeterli: \${MEM_GB}GB"
else
  emit FAIL "Hedefte yeterli RAM yok: \${MEM_GB}GB (en az ${TARGET_MIN_RAM_GB}GB önerilir)"
fi

if command -v docker >/dev/null 2>&1; then
  emit PASS "Hedef sunucuda Docker komutu var"
  if docker info >/dev/null 2>&1; then
    emit PASS "Hedef sunucuda Docker çalışıyor"
  else
    emit FAIL "Hedef sunucuda Docker komutları çalıştırılamıyor"
  fi
else
  emit WARN "Hedef sunucuda Docker kurulu değil; kurulum adımında otomatik kurulacak"
fi

BUSY_PORTS=""
for port in ${requiredPorts.join(' ')}; do
  if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"; then
    BUSY_PORTS="$BUSY_PORTS $port"
  fi
done
if [ -z "$BUSY_PORTS" ]; then
  emit PASS "Hedefte Supabase için gerekli instance portları boş"
else
  emit FAIL "Hedefte gerekli portlar dolu:\$BUSY_PORTS"
fi

if [ -f ${shellEscape(`${tgtDir}/docker/docker-compose.yml`)} ]; then
  if command -v docker >/dev/null 2>&1 && (cd ${shellEscape(`${tgtDir}/docker`)} && docker compose config >/dev/null 2>&1); then
    emit WARN "Hedefte mevcut compose dosyası var; kurulum sırasında yedeklenip güncellenecek"
  else
    emit FAIL "Hedefte eski/uyumsuz compose dosyası var"
  fi
else
  emit PASS "Hedefte mevcut Supabase compose dosyası yok"
fi
`;
}

async function runPreflightCheck(title, host, password, command, log) {
  const result = await sshExec(host, password, command);
  const findings = String(result.output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('PREFLIGHT|'))
    .map(line => {
      const [, status, ...messageParts] = line.split('|');
      return {
        status,
        message: messageParts.join('|')
      };
    });

  if (!findings.length) {
    throw new Error(`${title} ön kontrol çıktısı okunamadı`);
  }

  const failures = [];
  for (const finding of findings) {
    if (finding.status === 'PASS') {
      log(`✅ ${finding.message}`, 'success');
    } else if (finding.status === 'WARN') {
      log(`⚠️ ${finding.message}`, 'warn');
    } else {
      failures.push(finding.message);
      log(`❌ ${finding.message}`, 'error');
    }
  }

  if (failures.length) {
    throw new Error(`${title} ön kontrol başarısız: ${failures.join(' | ')}`);
  }
}

function classifyMigrationFailure(message) {
  const text = String(message || '').toLowerCase();
  if (/ssh|handshake|timeout|timed out|econn|no response|bağlan/.test(text)) return 'Bağlantı hatası';
  if (/preflight|ön kontrol|disk|ram|port|docker|compose|supabase kurulumu|\.env/.test(text)) return 'Ön kontrol hatası';
  if (/pg_dump|dump|scp|kopya|transfer|storage|volume|env yaz/.test(text)) return 'Veri aktarım hatası';
  if (/restore|psql|container|restart|unhealthy|health|kong|auth|realtime|studio|api|endpoint/.test(text)) return 'Restore sonrası hata';
  return 'Bilinmeyen hata';
}

function logMigrationFailureGuidance(log, stageKey, err, targetInstance) {
  const message = err instanceof Error ? err.message : String(err);
  const stageLabel = SELF_HOSTED_MIGRATION_STAGES[stageKey] || stageKey;
  const errorClass = classifyMigrationFailure(message);
  const tgtDir = getInstanceDir(targetInstance);

  log(`Hata sınıfı: ${errorClass}`, 'error');
  log(`İşlem şu aşamada durdu: ${stageKey} — ${stageLabel}`, 'error');
  log('Kaynak sunucu silinmedi/değiştirilmedi. DNS migration tamamen doğrulanmadan değiştirilmemeli.', 'warn');

  if (['transferring_files', 'restoring_database', 'restoring_storage', 'starting_services', 'verifying'].includes(stageKey)) {
    log(`Hedefte yarım kalan servisleri durdurmak için: cd ${tgtDir}/docker && docker compose down`, 'warn');
    log(`Volume/veri silme gerekiyorsa önce manuel yedek alın; ardından hedefte ${tgtDir}/docker/volumes dizinini bilinçli olarak temizleyin.`, 'warn');
  }

  log('Rollback: DNS eski sunucuda kalmalı veya eski sunucuya geri çevrilmeli; kaynak Supabase çalışır durumda bırakıldı.', 'warn');
}

function isBlankSecret(value) {
  return !String(value || '').trim();
}

function generateSupabaseEnvDefaults(existingEnv = {}) {
  const env = { ...existingEnv };

  if (isBlankSecret(env.JWT_SECRET)) {
    env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }
  if (isBlankSecret(env.POSTGRES_PASSWORD)) {
    env.POSTGRES_PASSWORD = crypto.randomBytes(20).toString('hex');
  }
  if (isBlankSecret(env.ANON_KEY)) {
    env.ANON_KEY = generateJWT('anon', env.JWT_SECRET);
  }
  if (isBlankSecret(env.SERVICE_ROLE_KEY)) {
    env.SERVICE_ROLE_KEY = generateJWT('service_role', env.JWT_SECRET);
  }
  if (isBlankSecret(env.DASHBOARD_PASSWORD)) {
    env.DASHBOARD_PASSWORD = crypto.randomBytes(12).toString('base64').replace(/[/+=]/g, '').substring(0, 16);
  }
  if (isBlankSecret(env.SECRET_KEY_BASE)) {
    env.SECRET_KEY_BASE = crypto.randomBytes(48).toString('base64').replace(/\n/g, '');
  }
  if (isBlankSecret(env.VAULT_ENC_KEY)) {
    env.VAULT_ENC_KEY = crypto.randomBytes(16).toString('hex');
  }
  if (isBlankSecret(env.PG_META_CRYPTO_KEY)) {
    env.PG_META_CRYPTO_KEY = crypto.randomBytes(16).toString('hex');
  }
  if (isBlankSecret(env.LOGFLARE_PUBLIC_ACCESS_TOKEN)) {
    env.LOGFLARE_PUBLIC_ACCESS_TOKEN = crypto.randomBytes(32).toString('hex');
  }
  if (isBlankSecret(env.LOGFLARE_PRIVATE_ACCESS_TOKEN)) {
    env.LOGFLARE_PRIVATE_ACCESS_TOKEN = crypto.randomBytes(32).toString('hex');
  }

  return env;
}

function buildEnvSecretValidationCommand(envPath) {
  const requiredKeys = [
    'POSTGRES_PASSWORD',
    'JWT_SECRET',
    'ANON_KEY',
    'SERVICE_ROLE_KEY',
    'DASHBOARD_PASSWORD',
    'SECRET_KEY_BASE',
    'VAULT_ENC_KEY',
    'PG_META_CRYPTO_KEY',
    'LOGFLARE_PUBLIC_ACCESS_TOKEN',
    'LOGFLARE_PRIVATE_ACCESS_TOKEN'
  ];

  return `
ENV_FILE=${shellEscape(envPath)}
missing=""
for key in ${requiredKeys.join(' ')}; do
  value=$(grep -E "^$key=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '[:space:]"')
  if [ -z "$value" ]; then
    missing="$missing $key"
  fi
done
if [ -n "$missing" ]; then
  echo "❌ .env kritik secret değerleri boş:$missing"
  exit 11
fi
echo ".env kritik secret kontrolü tamam"
`;
}

function normalizeExpression(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const from = start + startMarker.length;
  const end = text.indexOf(endMarker, from);
  return end === -1 ? text.slice(from) : text.slice(from, end);
}

function parseSchemaFilter(raw) {
  return Array.from(new Set(
    String(raw || '')
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
  ));
}

function validateSchemaNames(schemaNames) {
  const identifierPattern = /^[A-Za-z_][A-Za-z0-9_$]*$/;
  const invalidName = schemaNames.find(name => !identifierPattern.test(name));
  if (invalidName) {
    throw new Error(`Geçersiz schema adı: "${invalidName}". Sadece harf, rakam, _ ve $ kullanılabilir.`);
  }
  return schemaNames;
}

function buildSchemaDumpCommand(schemaNames) {
  const args = [
    'pg_dump',
    '-U', 'supabase_admin',
    '-d', 'postgres',
    '--schema-only',
    '--no-owner',
    '--no-privileges'
  ];
  schemaNames.forEach(schemaName => {
    args.push(`--schema=${schemaName}`);
  });
  return args.join(' ');
}

function buildBucketDumpCommand() {
  return [
    'pg_dump',
    '-U', 'supabase_admin',
    '-d', 'postgres',
    '--data-only',
    '--inserts',
    '--column-inserts',
    '--no-owner',
    '--no-privileges',
    '--table=storage.buckets'
  ].join(' ');
}

function extractBucketInsertStatements(bucketDumpText) {
  const insertPattern = /^INSERT INTO\s+(?:"storage"|storage)\.(?:"buckets"|buckets)\b/i;
  return Array.from(new Set(
    String(bucketDumpText || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => insertPattern.test(line))
      .map(line => `${line.replace(/;\s*$/, '')} ON CONFLICT (id) DO NOTHING;`)
  ));
}

function buildSchemaSnapshotSql(schemaNames) {
  const schemaFilterClause = schemaNames.length
    ? `AND n.nspname = ANY (ARRAY[${schemaNames.map(sqlLiteral).join(', ')}])`
    : '';

  return `WITH target_schemas AS (
    SELECT n.nspname
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND n.nspname !~ '^pg_temp_'
      AND n.nspname !~ '^pg_toast_temp_'
      ${schemaFilterClause}
  ),
  tables AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      CASE c.relkind
        WHEN 'p' THEN 'partitioned'
        ELSE 'table'
      END AS table_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN (SELECT nspname FROM target_schemas)
  ),
  columns AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attnum AS ordinal_position,
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS expression,
      COALESCE(a.attidentity, '') AS identity_kind,
      COALESCE(a.attgenerated, '') AS generated_kind
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND n.nspname IN (SELECT nspname FROM target_schemas)
  )
  SELECT json_build_object(
    'schemas', COALESCE((
      SELECT json_agg(nspname ORDER BY nspname)
      FROM target_schemas
    ), '[]'::json),
    'tables', COALESCE((
      SELECT json_agg(json_build_object(
        'schema', schema_name,
        'table', table_name,
        'kind', table_kind
      ) ORDER BY schema_name, table_name)
      FROM tables
    ), '[]'::json),
    'columns', COALESCE((
      SELECT json_agg(json_build_object(
        'schema', schema_name,
        'table', table_name,
        'position', ordinal_position,
        'column', column_name,
        'type', data_type,
        'notNull', not_null,
        'expression', expression,
        'identity', identity_kind,
        'generated', generated_kind
      ) ORDER BY schema_name, table_name, ordinal_position)
      FROM columns
    ), '[]'::json)
  )::text;`;
}

function buildRlsSnapshotSql(schemaNames) {
  const schemaFilterClause = schemaNames.length
    ? `AND n.nspname = ANY (ARRAY[${schemaNames.map(sqlLiteral).join(', ')}])`
    : '';

  return `WITH target_schemas AS (
    SELECT n.nspname
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND n.nspname !~ '^pg_temp_'
      AND n.nspname !~ '^pg_toast_temp_'
      ${schemaFilterClause}
  ),
  tables AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN (SELECT nspname FROM target_schemas)
  ),
  policies AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      p.polname AS policy_name,
      p.polpermissive AS permissive,
      CASE p.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
        ELSE 'ALL'
      END AS command,
      COALESCE((
        SELECT json_agg(COALESCE(r.rolname, 'PUBLIC') ORDER BY COALESCE(r.rolname, 'PUBLIC'))
        FROM unnest(p.polroles) AS role_id
        LEFT JOIN pg_roles r ON r.oid = role_id
      ), '[]'::json) AS roles,
      COALESCE(pg_get_expr(p.polqual, p.polrelid), '') AS using_expression,
      COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') AS with_check_expression
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN (SELECT nspname FROM target_schemas)
  )
  SELECT json_build_object(
    'tables', COALESCE((
      SELECT json_agg(json_build_object(
        'schema', schema_name,
        'table', table_name,
        'rlsEnabled', rls_enabled,
        'rlsForced', rls_forced
      ) ORDER BY schema_name, table_name)
      FROM tables
    ), '[]'::json),
    'policies', COALESCE((
      SELECT json_agg(json_build_object(
        'schema', schema_name,
        'table', table_name,
        'name', policy_name,
        'permissive', permissive,
        'command', command,
        'roles', roles,
        'usingExpression', using_expression,
        'withCheckExpression', with_check_expression
      ) ORDER BY schema_name, table_name, policy_name)
      FROM policies
    ), '[]'::json)
  )::text;`;
}

function normalizeSchemaSnapshot(payload) {
  const tableRows = Array.isArray(payload?.tables) ? payload.tables : [];
  const columnRows = Array.isArray(payload?.columns) ? payload.columns : [];
  const schemaRows = Array.isArray(payload?.schemas) ? payload.schemas : [];
  const tablesByKey = new Map();

  tableRows.forEach(row => {
    const schemaName = String(row.schema || '');
    const tableName = String(row.table || '');
    const key = `${schemaName}.${tableName}`;
    tablesByKey.set(key, {
      schema: schemaName,
      table: tableName,
      kind: String(row.kind || 'table'),
      columns: [],
      columnsByName: new Map()
    });
  });

  columnRows.forEach(row => {
    const schemaName = String(row.schema || '');
    const tableName = String(row.table || '');
    const key = `${schemaName}.${tableName}`;
    if (!tablesByKey.has(key)) {
      tablesByKey.set(key, {
        schema: schemaName,
        table: tableName,
        kind: 'table',
        columns: [],
        columnsByName: new Map()
      });
    }
    const table = tablesByKey.get(key);
    const column = {
      schema: schemaName,
      table: tableName,
      column: String(row.column || ''),
      position: Number(row.position || 0),
      type: String(row.type || ''),
      notNull: Boolean(row.notNull),
      expression: normalizeExpression(row.expression),
      identity: String(row.identity || ''),
      generated: String(row.generated || '')
    };
    table.columns.push(column);
    table.columnsByName.set(column.column, column);
  });

  const tables = Array.from(tablesByKey.values())
    .map(table => ({
      ...table,
      columns: [...table.columns].sort((a, b) => a.position - b.position)
    }))
    .sort((a, b) => {
      if (a.schema !== b.schema) return a.schema.localeCompare(b.schema);
      return a.table.localeCompare(b.table);
    });

  return {
    schemas: Array.from(new Set([
      ...schemaRows.map(s => String(s || '')),
      ...tables.map(table => table.schema)
    ].filter(Boolean))).sort(),
    tables,
    tablesByKey: new Map(tables.map(table => [`${table.schema}.${table.table}`, table])),
    tableCount: tables.length,
    columnCount: columnRows.length
  };
}

function normalizeRoleList(value) {
  const rawRoles = Array.isArray(value)
    ? value
    : (value === undefined || value === null ? [] : [value]);

  return Array.from(new Set(
    rawRoles
      .map(role => String(role ?? '').trim())
      .filter(Boolean)
      .map(role => role.toUpperCase() === 'PUBLIC' ? 'PUBLIC' : role)
  )).sort((leftRole, rightRole) => leftRole.localeCompare(rightRole));
}

function normalizeRlsSnapshot(payload) {
  const tableRows = Array.isArray(payload?.tables) ? payload.tables : [];
  const policyRows = Array.isArray(payload?.policies) ? payload.policies : [];
  const tablesByKey = new Map();

  tableRows.forEach(row => {
    const schemaName = String(row.schema || '');
    const tableName = String(row.table || '');
    const key = `${schemaName}.${tableName}`;
    tablesByKey.set(key, {
      schema: schemaName,
      table: tableName,
      rlsEnabled: Boolean(row.rlsEnabled),
      rlsForced: Boolean(row.rlsForced),
      policies: [],
      policiesByName: new Map()
    });
  });

  policyRows.forEach(row => {
    const schemaName = String(row.schema || '');
    const tableName = String(row.table || '');
    const key = `${schemaName}.${tableName}`;

    if (!tablesByKey.has(key)) {
      tablesByKey.set(key, {
        schema: schemaName,
        table: tableName,
        rlsEnabled: false,
        rlsForced: false,
        policies: [],
        policiesByName: new Map()
      });
    }

    const table = tablesByKey.get(key);
    const policy = {
      schema: schemaName,
      table: tableName,
      name: String(row.name || ''),
      permissive: row.permissive !== false,
      command: String(row.command || 'ALL').toUpperCase(),
      roles: normalizeRoleList(row.roles),
      usingExpression: normalizeExpression(row.usingExpression),
      withCheckExpression: normalizeExpression(row.withCheckExpression)
    };

    table.policies.push(policy);
    table.policiesByName.set(policy.name, policy);
  });

  const tables = Array.from(tablesByKey.values())
    .map(table => ({
      ...table,
      policies: [...table.policies].sort((leftPolicy, rightPolicy) => leftPolicy.name.localeCompare(rightPolicy.name))
    }))
    .sort((leftTable, rightTable) => {
      if (leftTable.schema !== rightTable.schema) return leftTable.schema.localeCompare(rightTable.schema);
      return leftTable.table.localeCompare(rightTable.table);
    });

  return {
    tables,
    tablesByKey: new Map(tables.map(table => [`${table.schema}.${table.table}`, table])),
    tableCount: tables.length,
    enabledTableCount: tables.filter(table => table.rlsEnabled).length,
    forcedTableCount: tables.filter(table => table.rlsForced).length,
    policyCount: policyRows.length
  };
}

async function fetchSchemaSnapshot(host, password, schemaNames) {
  const sql = buildSchemaSnapshotSql(schemaNames);
  const sqlB64 = Buffer.from(sql, 'utf8').toString('base64');
  const result = await sshExec(host, password, `
    DB_STATUS=$(docker inspect --format='{{.State.Status}}' supabase-db 2>/dev/null || echo "not_found")
    echo "__DB_STATUS__=$DB_STATUS"
    if [ "$DB_STATUS" = "running" ]; then
      ERR_FILE="/tmp/schema_compare_$$.log"
      echo "__SCHEMA_JSON_START__"
      printf '%s' ${shellEscape(sqlB64)} | base64 -d | docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -Atq 2>"$ERR_FILE"
      STATUS=$?
      printf '\\n'
      echo "__SCHEMA_JSON_END__"
      echo "__QUERY_STATUS__=$STATUS"
      if [ "$STATUS" -ne 0 ]; then
        echo "__SCHEMA_ERR_START__"
        cat "$ERR_FILE" 2>/dev/null || true
        echo "__SCHEMA_ERR_END__"
      fi
      rm -f "$ERR_FILE"
    fi
  `);

  const out = result.output || '';
  const dbStatus = ((out.match(/__DB_STATUS__=(.+)/) || [])[1] || '').trim();
  if (dbStatus !== 'running') {
    throw new Error(`supabase-db container çalışmıyor veya bulunamadı (${dbStatus || 'unknown'})`);
  }

  const queryStatus = Number((out.match(/__QUERY_STATUS__=(\d+)/) || [])[1] || NaN);
  if (!Number.isInteger(queryStatus) || queryStatus !== 0) {
    const errText = extractSection(out, '__SCHEMA_ERR_START__', '__SCHEMA_ERR_END__').trim();
    throw new Error(errText || result.err || 'Şema metadatası alınamadı');
  }

  const jsonText = extractSection(out, '__SCHEMA_JSON_START__', '__SCHEMA_JSON_END__').trim();
  if (!jsonText) {
    throw new Error('Şema karşılaştırma verisi boş döndü');
  }

  return normalizeSchemaSnapshot(JSON.parse(jsonText));
}

async function fetchRlsSnapshot(host, password, schemaNames) {
  const sql = buildRlsSnapshotSql(schemaNames);
  const sqlB64 = Buffer.from(sql, 'utf8').toString('base64');
  const result = await sshExec(host, password, `
    DB_STATUS=$(docker inspect --format='{{.State.Status}}' supabase-db 2>/dev/null || echo "not_found")
    echo "__DB_STATUS__=$DB_STATUS"
    if [ "$DB_STATUS" = "running" ]; then
      ERR_FILE="/tmp/rls_compare_$$.log"
      echo "__RLS_JSON_START__"
      printf '%s' ${shellEscape(sqlB64)} | base64 -d | docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -Atq 2>"$ERR_FILE"
      STATUS=$?
      printf '\\n'
      echo "__RLS_JSON_END__"
      echo "__QUERY_STATUS__=$STATUS"
      if [ "$STATUS" -ne 0 ]; then
        echo "__RLS_ERR_START__"
        cat "$ERR_FILE" 2>/dev/null || true
        echo "__RLS_ERR_END__"
      fi
      rm -f "$ERR_FILE"
    fi
  `);

  const out = result.output || '';
  const dbStatus = ((out.match(/__DB_STATUS__=(.+)/) || [])[1] || '').trim();
  if (dbStatus !== 'running') {
    throw new Error(`supabase-db container çalışmıyor veya bulunamadı (${dbStatus || 'unknown'})`);
  }

  const queryStatus = Number((out.match(/__QUERY_STATUS__=(\d+)/) || [])[1] || NaN);
  if (!Number.isInteger(queryStatus) || queryStatus !== 0) {
    const errText = extractSection(out, '__RLS_ERR_START__', '__RLS_ERR_END__').trim();
    throw new Error(errText || result.err || 'RLS metadatası alınamadı');
  }

  const jsonText = extractSection(out, '__RLS_JSON_START__', '__RLS_JSON_END__').trim();
  if (!jsonText) {
    throw new Error('RLS karşılaştırma verisi boş döndü');
  }

  return normalizeRlsSnapshot(JSON.parse(jsonText));
}

function formatRlsStateSummary(table) {
  return `${table.rlsEnabled ? 'RLS ENABLED' : 'RLS DISABLED'} • ${table.rlsForced ? 'FORCE ON' : 'FORCE OFF'}`;
}

function formatPolicySummary(policy) {
  const roles = policy.roles.length ? policy.roles.join(', ') : 'PUBLIC';
  const parts = [
    policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE',
    `FOR ${policy.command}`,
    `TO ${roles}`
  ];

  if (policy.usingExpression) {
    parts.push(`USING ${policy.usingExpression}`);
  }
  if (policy.withCheckExpression) {
    parts.push(`WITH CHECK ${policy.withCheckExpression}`);
  }

  return parts.join(' • ');
}

function formatPolicySideLabel(serverNumber) {
  return `Sunucu ${serverNumber}`;
}

function buildPolicyDifferenceDetails(sourcePolicy, targetPolicy, { sourceLabel, targetLabel }) {
  const details = [];

  if (sourcePolicy.permissive !== targetPolicy.permissive) {
    details.push({
      field: 'AS',
      source: `${sourceLabel}: ${sourcePolicy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`,
      target: `${targetLabel}: ${targetPolicy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`
    });
  }

  if (sourcePolicy.command !== targetPolicy.command) {
    details.push({
      field: 'FOR',
      source: `${sourceLabel}: ${sourcePolicy.command}`,
      target: `${targetLabel}: ${targetPolicy.command}`
    });
  }

  if (!rolesEqual(sourcePolicy.roles, targetPolicy.roles)) {
    details.push({
      field: 'TO',
      source: `${sourceLabel}: ${sourcePolicy.roles.length ? sourcePolicy.roles.join(', ') : 'PUBLIC'}`,
      target: `${targetLabel}: ${targetPolicy.roles.length ? targetPolicy.roles.join(', ') : 'PUBLIC'}`
    });
  }

  if (normalizeExpression(sourcePolicy.usingExpression) !== normalizeExpression(targetPolicy.usingExpression)) {
    details.push({
      field: 'USING',
      source: `${sourceLabel}: ${sourcePolicy.usingExpression || 'YOK'}`,
      target: `${targetLabel}: ${targetPolicy.usingExpression || 'YOK'}`
    });
  }

  if (normalizeExpression(sourcePolicy.withCheckExpression) !== normalizeExpression(targetPolicy.withCheckExpression)) {
    details.push({
      field: 'WITH CHECK',
      source: `${sourceLabel}: ${sourcePolicy.withCheckExpression || 'YOK'}`,
      target: `${targetLabel}: ${targetPolicy.withCheckExpression || 'YOK'}`
    });
  }

  return details;
}

function formatColumnSummary(column) {
  const parts = [column.type];
  if (column.generated) {
    parts.push(`GENERATED ALWAYS AS (${column.expression || '?'}) STORED`);
  } else if (column.identity === 'a') {
    parts.push('GENERATED ALWAYS AS IDENTITY');
  } else if (column.identity === 'd') {
    parts.push('GENERATED BY DEFAULT AS IDENTITY');
  } else if (column.expression) {
    parts.push(`DEFAULT ${column.expression}`);
  }
  parts.push(column.notNull ? 'NOT NULL' : 'NULLABLE');
  return parts.join(' ');
}

function isSequenceDefault(column) {
  return !column.identity
    && !column.generated
    && /^nextval\(/i.test(normalizeExpression(column.expression));
}

function inferIdentityClause(column) {
  if (column.identity === 'a') return 'GENERATED ALWAYS AS IDENTITY';
  if (column.identity === 'd') return 'GENERATED BY DEFAULT AS IDENTITY';
  if (isSequenceDefault(column) && /^(smallint|integer|bigint)\b/i.test(column.type)) {
    return 'GENERATED BY DEFAULT AS IDENTITY';
  }
  return '';
}

function buildColumnDefinition(column, { includeNotNull = true } = {}) {
  const pieces = [`${quoteIdentifier(column.column)} ${column.type}`];
  if (column.generated) {
    pieces.push(`GENERATED ALWAYS AS (${column.expression}) STORED`);
  } else if (inferIdentityClause(column)) {
    pieces.push(inferIdentityClause(column));
  } else if (column.expression) {
    pieces.push(`DEFAULT ${column.expression}`);
  }
  if (includeNotNull && column.notNull) {
    pieces.push('NOT NULL');
  }
  return pieces.join(' ');
}

function buildCreateTableStatements(table) {
  if (table.kind !== 'table') {
    return {
      statements: [
        `-- ${quoteQualifiedName(table.schema, table.table)} ${table.kind} tipinde. CREATE TABLE SQL'i manuel gözden geçirilmelidir.`
      ],
      manualReview: true
    };
  }

  return {
    statements: [
      `CREATE TABLE ${quoteQualifiedName(table.schema, table.table)} (\n${table.columns.map(column => `  ${buildColumnDefinition(column)}`).join(',\n')}\n);`
    ],
    manualReview: false
  };
}

function buildAddColumnStatements(schemaName, tableName, column) {
  const qualifiedTable = quoteQualifiedName(schemaName, tableName);
  const qualifiedColumn = quoteIdentifier(column.column);
  const deferNotNull = column.notNull && !column.generated && !column.identity && !column.expression;
  const statements = [
    `ALTER TABLE ${qualifiedTable} ADD COLUMN ${buildColumnDefinition(column, { includeNotNull: !deferNotNull })};`
  ];

  let warning = '';
  if (deferNotNull) {
    warning = 'Tabloda veri varsa önce kolonu doldurup sonra NOT NULL uygulayın.';
    statements.push(`-- ${qualifiedColumn} için mevcut satırlara uygun değerleri yazdıktan sonra aşağıdaki satırı çalıştırın.`);
    statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} SET NOT NULL;`);
  }

  return { statements, warning };
}

function buildAlterColumnStatements(schemaName, tableName, currentColumn, targetColumn) {
  const qualifiedTable = quoteQualifiedName(schemaName, tableName);
  const qualifiedColumn = quoteIdentifier(currentColumn.column);
  const currentExpression = normalizeExpression(currentColumn.expression);
  const targetExpression = normalizeExpression(targetColumn.expression);
  const statements = [];
  let warning = '';
  let manualReview = false;

  if (currentColumn.generated || targetColumn.generated) {
    manualReview = true;
    warning = 'Generated column farkı otomatik güvenli SQL ile çözülemedi; manuel kolon yeniden oluşturma gerekebilir.';
    statements.push(`-- ${qualifiedTable}.${qualifiedColumn} generated column tanımı farklı. Kolonu manuel yeniden oluşturmanız gerekebilir.`);
    return { statements, warning, manualReview };
  }

  if (currentColumn.type !== targetColumn.type) {
    statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} TYPE ${targetColumn.type} USING ${qualifiedColumn}::${targetColumn.type};`);
  }

  if (currentColumn.identity !== targetColumn.identity) {
    if (currentColumn.identity) {
      statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} DROP IDENTITY IF EXISTS;`);
    }
    if (targetColumn.identity === 'a') {
      statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} ADD GENERATED ALWAYS AS IDENTITY;`);
    } else if (targetColumn.identity === 'd') {
      statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} ADD GENERATED BY DEFAULT AS IDENTITY;`);
    }
  } else if (!targetColumn.identity && currentExpression !== targetExpression) {
    if (/^nextval\(/i.test(targetExpression)) {
      statements.push(`-- ${qualifiedTable}.${qualifiedColumn} sequence-backed default kullanıyor. Gerekirse uygun sequence ya da IDENTITY ile manuel hizalayın.`);
      manualReview = true;
      warning = 'Sequence-backed default farkı manuel kontrol gerektirir.';
    } else if (targetExpression) {
      statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} SET DEFAULT ${targetExpression};`);
    } else {
      statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} DROP DEFAULT;`);
    }
  }

  if (currentColumn.notNull !== targetColumn.notNull) {
    statements.push(`ALTER TABLE ${qualifiedTable} ALTER COLUMN ${qualifiedColumn} ${targetColumn.notNull ? 'SET' : 'DROP'} NOT NULL;`);
  }

  if (!statements.length) {
    statements.push(`-- ${qualifiedTable}.${qualifiedColumn} için fark algılandı fakat güvenli otomatik SQL üretilemedi. Manuel gözden geçirin.`);
    manualReview = true;
    warning = 'Bu kolon için fark var ancak otomatik SQL üretilemedi.';
  }

  return { statements, warning, manualReview };
}

function columnsEqual(leftColumn, rightColumn) {
  return leftColumn.type === rightColumn.type
    && leftColumn.notNull === rightColumn.notNull
    && leftColumn.identity === rightColumn.identity
    && leftColumn.generated === rightColumn.generated
    && normalizeExpression(leftColumn.expression) === normalizeExpression(rightColumn.expression);
}

function addSqlAction(actions, title, statements) {
  if (!statements || !statements.length) return;
  actions.push(`-- ${title}\n${statements.join('\n')}`);
}

function ensureSchemaStatements(createdSchemas, schemaName) {
  if (!schemaName || createdSchemas.has(schemaName)) return [];
  createdSchemas.add(schemaName);
  return [`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)};`];
}

function emptyComparisonSql(serverNumber) {
  return `-- Sunucu ${serverNumber} tarafında uygulanacak ek SQL bulunmadı.`;
}

function formatComparisonSql(actions, serverNumber) {
  return actions.length ? actions.join('\n\n') : emptyComparisonSql(serverNumber);
}

function mergeComparisonSql(primarySql, secondarySql, serverNumber) {
  const emptySql = emptyComparisonSql(serverNumber);
  const parts = [primarySql, secondarySql]
    .map(text => String(text || '').trim())
    .filter(text => text && text !== emptySql);

  return parts.length ? parts.join('\n\n') : emptySql;
}

function formatPolicyRoleList(roles) {
  const targetRoles = roles.length ? roles : ['PUBLIC'];
  return targetRoles
    .map(role => role === 'PUBLIC' ? 'PUBLIC' : quoteIdentifier(role))
    .join(', ');
}

function buildCreatePolicyStatements(policy) {
  const lines = [
    `CREATE POLICY ${quoteIdentifier(policy.name)}`,
    `  ON ${quoteQualifiedName(policy.schema, policy.table)}`,
    `  AS ${policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`,
    `  FOR ${policy.command}`,
    `  TO ${formatPolicyRoleList(policy.roles)}`
  ];

  if (policy.usingExpression) {
    lines.push(`  USING (${policy.usingExpression})`);
  }
  if (policy.withCheckExpression) {
    lines.push(`  WITH CHECK (${policy.withCheckExpression})`);
  }

  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex]};`;
  return [lines.join('\n')];
}

function buildDropPolicyStatements(policy) {
  return [`DROP POLICY IF EXISTS ${quoteIdentifier(policy.name)} ON ${quoteQualifiedName(policy.schema, policy.table)};`];
}

function buildReplacePolicyStatements(policy) {
  return [
    ...buildDropPolicyStatements(policy),
    ...buildCreatePolicyStatements(policy)
  ];
}

function rolesEqual(leftRoles, rightRoles) {
  if (leftRoles.length !== rightRoles.length) return false;
  return leftRoles.every((role, index) => role === rightRoles[index]);
}

function policiesEqual(leftPolicy, rightPolicy) {
  return leftPolicy.permissive === rightPolicy.permissive
    && leftPolicy.command === rightPolicy.command
    && rolesEqual(leftPolicy.roles, rightPolicy.roles)
    && normalizeExpression(leftPolicy.usingExpression) === normalizeExpression(rightPolicy.usingExpression)
    && normalizeExpression(leftPolicy.withCheckExpression) === normalizeExpression(rightPolicy.withCheckExpression);
}

function compareSchemaSnapshots(server1Snapshot, server2Snapshot) {
  const differences = [];
  const server1SqlParts = [];
  const server2SqlParts = [];
  const createdOnServer1 = new Set();
  const createdOnServer2 = new Set();
  const allTableKeys = Array.from(new Set([
    ...server1Snapshot.tablesByKey.keys(),
    ...server2Snapshot.tablesByKey.keys()
  ])).sort();

  allTableKeys.forEach(tableKey => {
    const server1Table = server1Snapshot.tablesByKey.get(tableKey);
    const server2Table = server2Snapshot.tablesByKey.get(tableKey);

    if (server1Table && !server2Table) {
      const createTable = buildCreateTableStatements(server1Table);
      const statements = [
        ...ensureSchemaStatements(createdOnServer2, server1Table.schema),
        ...createTable.statements
      ];
      addSqlAction(server2SqlParts, `${server1Table.schema}.${server1Table.table} tablosunu Sunucu 2'de oluştur`, statements);
      differences.push({
        type: 'table_missing',
        schema: server1Table.schema,
        table: server1Table.table,
        presentOn: 'Sunucu 1',
        missingOn: 'Sunucu 2',
        runOn: 'Sunucu 2',
        warning: createTable.manualReview ? 'Partitioned tablo olduğu için SQL manuel kontrol gerektirir.' : ''
      });
      return;
    }

    if (!server1Table && server2Table) {
      const createTable = buildCreateTableStatements(server2Table);
      const statements = [
        ...ensureSchemaStatements(createdOnServer1, server2Table.schema),
        ...createTable.statements
      ];
      addSqlAction(server1SqlParts, `${server2Table.schema}.${server2Table.table} tablosunu Sunucu 1'de oluştur`, statements);
      differences.push({
        type: 'table_missing',
        schema: server2Table.schema,
        table: server2Table.table,
        presentOn: 'Sunucu 2',
        missingOn: 'Sunucu 1',
        runOn: 'Sunucu 1',
        warning: createTable.manualReview ? 'Partitioned tablo olduğu için SQL manuel kontrol gerektirir.' : ''
      });
      return;
    }

    const allColumnNames = Array.from(new Set([
      ...server1Table.columns.map(column => column.column),
      ...server2Table.columns.map(column => column.column)
    ])).sort();

    allColumnNames.forEach(columnName => {
      const server1Column = server1Table.columnsByName.get(columnName);
      const server2Column = server2Table.columnsByName.get(columnName);

      if (server1Column && !server2Column) {
        const addColumn = buildAddColumnStatements(server1Table.schema, server1Table.table, server1Column);
        addSqlAction(server2SqlParts, `${server1Table.schema}.${server1Table.table}.${columnName} kolonunu Sunucu 2'ye ekle`, addColumn.statements);
        differences.push({
          type: 'column_missing',
          schema: server1Table.schema,
          table: server1Table.table,
          column: columnName,
          presentOn: 'Sunucu 1',
          missingOn: 'Sunucu 2',
          runOn: 'Sunucu 2',
          server1Definition: formatColumnSummary(server1Column),
          warning: addColumn.warning
        });
        return;
      }

      if (!server1Column && server2Column) {
        const addColumn = buildAddColumnStatements(server2Table.schema, server2Table.table, server2Column);
        addSqlAction(server1SqlParts, `${server2Table.schema}.${server2Table.table}.${columnName} kolonunu Sunucu 1'e ekle`, addColumn.statements);
        differences.push({
          type: 'column_missing',
          schema: server2Table.schema,
          table: server2Table.table,
          column: columnName,
          presentOn: 'Sunucu 2',
          missingOn: 'Sunucu 1',
          runOn: 'Sunucu 1',
          server2Definition: formatColumnSummary(server2Column),
          warning: addColumn.warning
        });
        return;
      }

      if (columnsEqual(server1Column, server2Column)) {
        return;
      }

      const syncServer1 = buildAlterColumnStatements(server1Table.schema, server1Table.table, server1Column, server2Column);
      const syncServer2 = buildAlterColumnStatements(server2Table.schema, server2Table.table, server2Column, server1Column);

      addSqlAction(server1SqlParts, `${server1Table.schema}.${server1Table.table}.${columnName} kolonunu Sunucu 2 tanımına yaklaştır`, syncServer1.statements);
      addSqlAction(server2SqlParts, `${server2Table.schema}.${server2Table.table}.${columnName} kolonunu Sunucu 1 tanımına yaklaştır`, syncServer2.statements);

      differences.push({
        type: 'column_mismatch',
        schema: server1Table.schema,
        table: server1Table.table,
        column: columnName,
        runOn: 'Sunucu 1 ve Sunucu 2',
        server1Definition: formatColumnSummary(server1Column),
        server2Definition: formatColumnSummary(server2Column),
        warning: syncServer1.warning || syncServer2.warning || '',
        manualReview: Boolean(syncServer1.manualReview || syncServer2.manualReview)
      });
    });
  });

  const tablesOnlyInServer1 = differences.filter(diff => diff.type === 'table_missing' && diff.missingOn === 'Sunucu 2').length;
  const tablesOnlyInServer2 = differences.filter(diff => diff.type === 'table_missing' && diff.missingOn === 'Sunucu 1').length;
  const columnsOnlyInServer1 = differences.filter(diff => diff.type === 'column_missing' && diff.missingOn === 'Sunucu 2').length;
  const columnsOnlyInServer2 = differences.filter(diff => diff.type === 'column_missing' && diff.missingOn === 'Sunucu 1').length;
  const columnDefinitionDiffs = differences.filter(diff => diff.type === 'column_mismatch').length;
  const manualReviewItems = differences.filter(diff => diff.manualReview).length;

  return {
    differences,
    summary: {
      tablesOnlyInServer1,
      tablesOnlyInServer2,
      columnsOnlyInServer1,
      columnsOnlyInServer2,
      columnDefinitionDiffs,
      manualReviewItems,
      totalDifferences: differences.length,
      server1TableCount: server1Snapshot.tableCount,
      server2TableCount: server2Snapshot.tableCount,
      server1ColumnCount: server1Snapshot.columnCount,
      server2ColumnCount: server2Snapshot.columnCount
    },
    server1Sql: formatComparisonSql(server1SqlParts, 1),
    server2Sql: formatComparisonSql(server2SqlParts, 2)
  };
}

function compareRlsSnapshots(server1Snapshot, server2Snapshot, options = {}) {
  const differences = [];
  const server1SqlParts = [];
  const server2SqlParts = [];
  const syncDirection = options.syncDirection || 'bidirectional';
  const recreateMismatchedPolicies = Boolean(options.recreateMismatchedPolicies);
  const isDirectional = syncDirection === 'server1_to_server2' || syncDirection === 'server2_to_server1';
  const sourceServerNumber = syncDirection === 'server2_to_server1' ? 2 : 1;
  const targetServerNumber = syncDirection === 'server2_to_server1' ? 1 : 2;
  const sourceLabel = formatPolicySideLabel(sourceServerNumber);
  const targetLabel = formatPolicySideLabel(targetServerNumber);
  const allTableKeys = Array.from(new Set([
    ...server1Snapshot.tablesByKey.keys(),
    ...server2Snapshot.tablesByKey.keys()
  ])).sort();

  const pushServerSql = (serverNumber, title, statements) => {
    if (serverNumber === 1) {
      addSqlAction(server1SqlParts, title, statements);
      return;
    }
    addSqlAction(server2SqlParts, title, statements);
  };

  allTableKeys.forEach(tableKey => {
    const server1Table = server1Snapshot.tablesByKey.get(tableKey);
    const server2Table = server2Snapshot.tablesByKey.get(tableKey);

    // Tablo yoksa schema compare zaten bu farkı ayrıca raporlar.
    if (!server1Table || !server2Table) {
      return;
    }

    if (!isDirectional) {
      if (server1Table.rlsEnabled && !server2Table.rlsEnabled) {
        pushServerSql(
          2,
          `${tableKey} için RLS'i Sunucu 2'de etkinleştir`,
          [`ALTER TABLE ${quoteQualifiedName(server1Table.schema, server1Table.table)} ENABLE ROW LEVEL SECURITY;`]
        );
        differences.push({
          type: 'rls_enabled_missing',
          schema: server1Table.schema,
          table: server1Table.table,
          presentOn: 'Sunucu 1',
          missingOn: 'Sunucu 2',
          runOn: 'Sunucu 2',
          server1Definition: formatRlsStateSummary(server1Table),
          server2Definition: formatRlsStateSummary(server2Table)
        });
      } else if (!server1Table.rlsEnabled && server2Table.rlsEnabled) {
        pushServerSql(
          1,
          `${tableKey} için RLS'i Sunucu 1'de etkinleştir`,
          [`ALTER TABLE ${quoteQualifiedName(server2Table.schema, server2Table.table)} ENABLE ROW LEVEL SECURITY;`]
        );
        differences.push({
          type: 'rls_enabled_missing',
          schema: server1Table.schema,
          table: server1Table.table,
          presentOn: 'Sunucu 2',
          missingOn: 'Sunucu 1',
          runOn: 'Sunucu 1',
          server1Definition: formatRlsStateSummary(server1Table),
          server2Definition: formatRlsStateSummary(server2Table)
        });
      }

      if (server1Table.rlsForced && !server2Table.rlsForced) {
        pushServerSql(
          2,
          `${tableKey} için FORCE RLS'i Sunucu 2'de etkinleştir`,
          [`ALTER TABLE ${quoteQualifiedName(server1Table.schema, server1Table.table)} FORCE ROW LEVEL SECURITY;`]
        );
        differences.push({
          type: 'rls_force_missing',
          schema: server1Table.schema,
          table: server1Table.table,
          presentOn: 'Sunucu 1',
          missingOn: 'Sunucu 2',
          runOn: 'Sunucu 2',
          server1Definition: formatRlsStateSummary(server1Table),
          server2Definition: formatRlsStateSummary(server2Table)
        });
      } else if (!server1Table.rlsForced && server2Table.rlsForced) {
        pushServerSql(
          1,
          `${tableKey} için FORCE RLS'i Sunucu 1'de etkinleştir`,
          [`ALTER TABLE ${quoteQualifiedName(server2Table.schema, server2Table.table)} FORCE ROW LEVEL SECURITY;`]
        );
        differences.push({
          type: 'rls_force_missing',
          schema: server1Table.schema,
          table: server1Table.table,
          presentOn: 'Sunucu 2',
          missingOn: 'Sunucu 1',
          runOn: 'Sunucu 1',
          server1Definition: formatRlsStateSummary(server1Table),
          server2Definition: formatRlsStateSummary(server2Table)
        });
      }
    } else {
      const sourceTable = sourceServerNumber === 1 ? server1Table : server2Table;
      const targetTable = targetServerNumber === 1 ? server1Table : server2Table;

      if (sourceTable.rlsEnabled !== targetTable.rlsEnabled) {
        pushServerSql(
          targetServerNumber,
          `${tableKey} için RLS durumunu ${sourceLabel}'e göre hizala`,
          [`ALTER TABLE ${quoteQualifiedName(targetTable.schema, targetTable.table)} ${sourceTable.rlsEnabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`]
        );
        differences.push({
          type: 'rls_enabled_sync',
          schema: targetTable.schema,
          table: targetTable.table,
          presentOn: sourceTable.rlsEnabled ? sourceLabel : targetLabel,
          missingOn: sourceTable.rlsEnabled ? targetLabel : sourceLabel,
          runOn: targetLabel,
          action: sourceTable.rlsEnabled ? 'ENABLE' : 'DISABLE',
          server1Definition: formatRlsStateSummary(server1Table),
          server2Definition: formatRlsStateSummary(server2Table)
        });
      }

      if (sourceTable.rlsForced !== targetTable.rlsForced) {
        pushServerSql(
          targetServerNumber,
          `${tableKey} için FORCE RLS durumunu ${sourceLabel}'e göre hizala`,
          [`ALTER TABLE ${quoteQualifiedName(targetTable.schema, targetTable.table)} ${sourceTable.rlsForced ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;`]
        );
        differences.push({
          type: 'rls_force_sync',
          schema: targetTable.schema,
          table: targetTable.table,
          presentOn: sourceTable.rlsForced ? sourceLabel : targetLabel,
          missingOn: sourceTable.rlsForced ? targetLabel : sourceLabel,
          runOn: targetLabel,
          action: sourceTable.rlsForced ? 'FORCE' : 'NO FORCE',
          server1Definition: formatRlsStateSummary(server1Table),
          server2Definition: formatRlsStateSummary(server2Table)
        });
      }
    }

    const allPolicyNames = Array.from(new Set([
      ...server1Table.policies.map(policy => policy.name),
      ...server2Table.policies.map(policy => policy.name)
    ])).sort();

    allPolicyNames.forEach(policyName => {
      const server1Policy = server1Table.policiesByName.get(policyName);
      const server2Policy = server2Table.policiesByName.get(policyName);

      if (!isDirectional) {
        if (server1Policy && !server2Policy) {
          pushServerSql(
            2,
            `${tableKey}.${policyName} policy'sini Sunucu 2'ye ekle`,
            buildCreatePolicyStatements(server1Policy)
          );
          differences.push({
            type: 'policy_missing',
            schema: server1Policy.schema,
            table: server1Policy.table,
            policy: server1Policy.name,
            presentOn: 'Sunucu 1',
            missingOn: 'Sunucu 2',
            runOn: 'Sunucu 2',
            server1Definition: formatPolicySummary(server1Policy)
          });
          return;
        }

        if (!server1Policy && server2Policy) {
          pushServerSql(
            1,
            `${tableKey}.${policyName} policy'sini Sunucu 1'e ekle`,
            buildCreatePolicyStatements(server2Policy)
          );
          differences.push({
            type: 'policy_missing',
            schema: server2Policy.schema,
            table: server2Policy.table,
            policy: server2Policy.name,
            presentOn: 'Sunucu 2',
            missingOn: 'Sunucu 1',
            runOn: 'Sunucu 1',
            server2Definition: formatPolicySummary(server2Policy)
          });
          return;
        }

        if (!policiesEqual(server1Policy, server2Policy)) {
          differences.push({
            type: 'policy_mismatch',
            schema: server1Policy.schema,
            table: server1Policy.table,
            policy: server1Policy.name,
            runOn: 'Manuel kontrol',
            server1Definition: formatPolicySummary(server1Policy),
            server2Definition: formatPolicySummary(server2Policy),
            differenceDetails: buildPolicyDifferenceDetails(server1Policy, server2Policy, {
              sourceLabel: 'Sunucu 1',
              targetLabel: 'Sunucu 2'
            }),
            warning: 'Policy tanımı farklı. Güvenli otomatik SQL üretilmedi; gerekirse yön seçip hedefte DROP/CREATE POLICY üretebilirsiniz.',
            manualReview: true
          });
        }
        return;
      }

      const sourcePolicy = sourceServerNumber === 1 ? server1Policy : server2Policy;
      const targetPolicy = targetServerNumber === 1 ? server1Policy : server2Policy;

      if (sourcePolicy && !targetPolicy) {
        pushServerSql(
          targetServerNumber,
          `${tableKey}.${policyName} policy'sini ${targetLabel}'de ${sourceLabel}'e göre oluştur`,
          buildCreatePolicyStatements(sourcePolicy)
        );
        differences.push({
          type: 'policy_missing',
          schema: sourcePolicy.schema,
          table: sourcePolicy.table,
          policy: sourcePolicy.name,
          presentOn: sourceLabel,
          missingOn: targetLabel,
          runOn: targetLabel,
          server1Definition: server1Policy ? formatPolicySummary(server1Policy) : '',
          server2Definition: server2Policy ? formatPolicySummary(server2Policy) : ''
        });
        return;
      }

      if (!sourcePolicy && targetPolicy) {
        const diff = {
          type: 'policy_extra',
          schema: targetPolicy.schema,
          table: targetPolicy.table,
          policy: targetPolicy.name,
          presentOn: targetLabel,
          missingOn: sourceLabel,
          runOn: recreateMismatchedPolicies ? targetLabel : 'Manuel kontrol',
          server1Definition: server1Policy ? formatPolicySummary(server1Policy) : '',
          server2Definition: server2Policy ? formatPolicySummary(server2Policy) : ''
        };

        if (recreateMismatchedPolicies) {
          pushServerSql(
            targetServerNumber,
            `${tableKey}.${policyName} policy'sini ${targetLabel}'den kaldır`,
            buildDropPolicyStatements(targetPolicy)
          );
          diff.warning = `Kaynakta olmayan policy ${targetLabel} üzerinde DROP POLICY ile kaldırılacak.`;
        } else {
          diff.warning = `Policy ${targetLabel} tarafında ekstra. Hedefi kaynağa eşitlemek için opsiyonel DROP/CREATE modunu açabilirsiniz.`;
          diff.manualReview = true;
        }

        differences.push(diff);
        return;
      }

      if (!policiesEqual(sourcePolicy, targetPolicy)) {
        const differenceDetails = buildPolicyDifferenceDetails(sourcePolicy, targetPolicy, {
          sourceLabel,
          targetLabel
        });
        const diff = {
          type: 'policy_mismatch',
          schema: sourcePolicy.schema,
          table: sourcePolicy.table,
          policy: sourcePolicy.name,
          runOn: recreateMismatchedPolicies ? targetLabel : 'Manuel kontrol',
          server1Definition: server1Policy ? formatPolicySummary(server1Policy) : '',
          server2Definition: server2Policy ? formatPolicySummary(server2Policy) : '',
          differenceDetails
        };

        if (recreateMismatchedPolicies) {
          pushServerSql(
            targetServerNumber,
            `${tableKey}.${policyName} policy'sini ${targetLabel}'de ${sourceLabel}'e göre yeniden oluştur`,
            buildReplacePolicyStatements(sourcePolicy)
          );
          diff.warning = `Hedef policy ${targetLabel} üzerinde DROP/CREATE POLICY ile ${sourceLabel}'e göre hizalanacak.`;
        } else {
          diff.warning = `Policy tanımı ${sourceLabel} ve ${targetLabel} arasında farklı. Alan bazlı farklar aşağıda listelendi; otomatik hizalama için opsiyonel DROP/CREATE modunu açabilirsiniz.`;
          diff.manualReview = true;
        }

        differences.push(diff);
      }
    });
  });

  const rlsEnabledOnlyInServer1 = differences.filter(diff => (
    ['rls_enabled_missing', 'rls_enabled_sync'].includes(diff.type) && diff.presentOn === 'Sunucu 1'
  )).length;
  const rlsEnabledOnlyInServer2 = differences.filter(diff => (
    ['rls_enabled_missing', 'rls_enabled_sync'].includes(diff.type) && diff.presentOn === 'Sunucu 2'
  )).length;
  const rlsForcedOnlyInServer1 = differences.filter(diff => (
    ['rls_force_missing', 'rls_force_sync'].includes(diff.type) && diff.presentOn === 'Sunucu 1'
  )).length;
  const rlsForcedOnlyInServer2 = differences.filter(diff => (
    ['rls_force_missing', 'rls_force_sync'].includes(diff.type) && diff.presentOn === 'Sunucu 2'
  )).length;
  const policiesOnlyInServer1 = differences.filter(diff => (
    ['policy_missing', 'policy_extra'].includes(diff.type) && diff.presentOn === 'Sunucu 1'
  )).length;
  const policiesOnlyInServer2 = differences.filter(diff => (
    ['policy_missing', 'policy_extra'].includes(diff.type) && diff.presentOn === 'Sunucu 2'
  )).length;
  const policyDefinitionDiffs = differences.filter(diff => diff.type === 'policy_mismatch').length;
  const manualReviewItems = differences.filter(diff => diff.manualReview).length;

  return {
    differences,
    summary: {
      rlsEnabledOnlyInServer1,
      rlsEnabledOnlyInServer2,
      rlsForcedOnlyInServer1,
      rlsForcedOnlyInServer2,
      policiesOnlyInServer1,
      policiesOnlyInServer2,
      policyDefinitionDiffs,
      manualReviewItems,
      totalDifferences: differences.length,
      server1RlsTableCount: server1Snapshot.tableCount,
      server2RlsTableCount: server2Snapshot.tableCount,
      server1RlsEnabledCount: server1Snapshot.enabledTableCount,
      server2RlsEnabledCount: server2Snapshot.enabledTableCount,
      server1PolicyCount: server1Snapshot.policyCount,
      server2PolicyCount: server2Snapshot.policyCount
    },
    server1Sql: formatComparisonSql(server1SqlParts, 1),
    server2Sql: formatComparisonSql(server2SqlParts, 2)
  };
}

function mergeComparisonResults(primaryComparison, secondaryComparison) {
  return {
    differences: [
      ...(primaryComparison.differences || []),
      ...(secondaryComparison.differences || [])
    ],
    summary: {
      ...(primaryComparison.summary || {}),
      ...(secondaryComparison.summary || {}),
      manualReviewItems: Number(primaryComparison.summary?.manualReviewItems || 0) + Number(secondaryComparison.summary?.manualReviewItems || 0),
      totalDifferences: Number(primaryComparison.summary?.totalDifferences || 0) + Number(secondaryComparison.summary?.totalDifferences || 0)
    },
    server1Sql: mergeComparisonSql(primaryComparison.server1Sql, secondaryComparison.server1Sql, 1),
    server2Sql: mergeComparisonSql(primaryComparison.server2Sql, secondaryComparison.server2Sql, 2)
  };
}

// ─── API ENDPOINT'LERİ ─────────────────────────────────────────

// 1. Kaynak sunucuya bağlan, .env oku
app.post('/api/fetch-env', async (req, res) => {
  const { host, password } = req.body;
  try {
    // ─── Kaynak sunucu doğrulama kontrolleri ─────────────────────
    const checkResult = await sshExec(host, password, `
      echo "=CHECK_START="
      # Docker kurulu mu?
      if command -v docker &>/dev/null; then
        echo "DOCKER_OK=$(docker --version | head -1)"
      else
        echo "DOCKER_MISSING"
      fi
      # docker daemon çalışıyor mu?
      if docker info &>/dev/null 2>&1; then
        echo "DOCKER_RUNNING=yes"
      else
        echo "DOCKER_RUNNING=no"
      fi
      # supabase-db container var mı ve çalışıyor mu?
      DB_STATUS=$(docker inspect --format='{{.State.Status}}' supabase-db 2>/dev/null || echo "not_found")
      echo "DB_CONTAINER=$DB_STATUS"
      # Supabase servislerinden en az biri çalışıyor mu?
      SUPA_COUNT=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c 'supabase' || echo "0")
      echo "SUPABASE_CONTAINERS=$SUPA_COUNT"
      # Hangi supabase container'ları çalışıyor?
      SUPA_NAMES=$(docker ps --format '{{.Names}}' 2>/dev/null | grep 'supabase' | tr '\\n' ',' || echo "none")
      echo "SUPABASE_NAMES=$SUPA_NAMES"
      echo "=CHECK_END="
    `);

    const out = checkResult.output;
    const checks = [];
    let canProceed = true;

    if (out.includes('DOCKER_MISSING')) {
      checks.push({ key: 'docker', status: 'error', msg: 'Docker kurulu değil' });
      canProceed = false;
    } else {
      const dockerVer = (out.match(/DOCKER_OK=(.+)/) || [])[1] || 'Docker';
      checks.push({ key: 'docker', status: 'ok', msg: dockerVer.trim() });
    }

    if (out.includes('DOCKER_RUNNING=no')) {
      checks.push({ key: 'daemon', status: 'error', msg: 'Docker daemon çalışmıyor (systemctl start docker)' });
      canProceed = false;
    } else if (out.includes('DOCKER_RUNNING=yes')) {
      checks.push({ key: 'daemon', status: 'ok', msg: 'Docker daemon çalışıyor' });
    }

    const dbStatus = (out.match(/DB_CONTAINER=(.+)/) || [])[1] || 'not_found';
    if (dbStatus === 'running') {
      checks.push({ key: 'db', status: 'ok', msg: 'supabase-db container çalışıyor ✓' });
    } else if (dbStatus === 'not_found') {
      checks.push({ key: 'db', status: 'error', msg: 'supabase-db container bulunamadı — bu Supabase sunucusu mu?' });
      canProceed = false;
    } else {
      checks.push({ key: 'db', status: 'warn', msg: `supabase-db durumu: ${dbStatus} (çalışmıyor olabilir)` });
      canProceed = false;
    }

    const supaCount = parseInt((out.match(/SUPABASE_CONTAINERS=(\d+)/) || [])[1] || '0', 10);
    const supaNames = (out.match(/SUPABASE_NAMES=(.+)/) || [])[1] || 'none';
    if (supaCount > 0) {
      checks.push({ key: 'services', status: 'ok', msg: `${supaCount} Supabase servisi aktif: ${supaNames.trim().replace(/,$/, '')}` });
    } else {
      checks.push({ key: 'services', status: 'warn', msg: 'Hiç Supabase container çalışmıyor — bu kaynak sunucu mu?' });
    }

    // Kontrol başarısız → kurulum önerisiyle hata dön
    if (!canProceed) {
      return res.json({
        success: false,
        checks,
        canInstall: true,
        error: 'Bu sunucu geçerli bir Supabase kaynağı değil. Lütfen doğru sunucuyu girdiğinizden emin olun.'
      });
    }

    // ─── .env dosyasını oku ───────────────────────────────────────
    const result = await sshExec(host, password,
      `for f in /root/supabase/docker/.env /home/supabase/docker/.env ~/supabase/docker/.env /opt/supabase/docker/.env /var/supabase/docker/.env /srv/supabase/docker/.env; do
         if [ -f "$f" ]; then cat "$f"; echo "ENV_PATH=$f"; exit 0; fi;
       done;
       FOUND=$(find / -maxdepth 6 -name ".env" -path "*/supabase/docker/.env" 2>/dev/null | head -1);
       if [ -n "$FOUND" ]; then cat "$FOUND"; echo "ENV_PATH=$FOUND"; else echo "ENV_NOT_FOUND"; fi`
    );
    if (result.output.trim() === 'ENV_NOT_FOUND' || result.output.includes('ENV_NOT_FOUND')) {
      return res.json({ success: false, checks, canInstall: true, error: '.env dosyası bulunamadı. Supabase kurulu ancak .env eksik olabilir.' });
    }
    // Parse .env
    const env = {};
    result.output.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const key = trimmed.substring(0, idx).trim();
          const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
          env[key] = val;
        }
      }
    });
    res.json({ success: true, checks, env });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 2. Yeni secret'lar üret
app.post('/api/generate-secrets', (req, res) => {
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const anonKey = generateJWT('anon', jwtSecret);
  const serviceRoleKey = generateJWT('service_role', jwtSecret);
  const secrets = {
    POSTGRES_PASSWORD: crypto.randomBytes(20).toString('hex'),
    JWT_SECRET: jwtSecret,
    ANON_KEY: anonKey,
    SERVICE_ROLE_KEY: serviceRoleKey,
    DASHBOARD_PASSWORD: crypto.randomBytes(12).toString('base64').replace(/[/+=]/g, '').substring(0, 16),
    SECRET_KEY_BASE: crypto.randomBytes(48).toString('base64').replace(/\n/g, ''),
    VAULT_ENC_KEY: crypto.randomBytes(16).toString('hex'),       // 32 char
    PG_META_CRYPTO_KEY: crypto.randomBytes(16).toString('hex'), // 32 char
    LOGFLARE_PUBLIC_ACCESS_TOKEN: crypto.randomBytes(32).toString('hex'),
    LOGFLARE_PRIVATE_ACCESS_TOKEN: crypto.randomBytes(32).toString('hex'),
  };
  res.json({ success: true, secrets });
});

// 2.5 İki Supabase sunucusunun şemasını karşılaştır
app.post('/api/compare-schema', async (req, res) => {
  const {
    server1Host,
    server1Password,
    server2Host,
    server2Password,
    schemaFilter,
    includeRls,
    rlsSyncDirection,
    recreateMismatchedPolicies
  } = req.body || {};

  if (!server1Host || !server1Password || !server2Host || !server2Password) {
    return res.json({ success: false, error: 'İki sunucu için de host ve root şifresi gerekli.' });
  }

  try {
    const schemaNames = parseSchemaFilter(schemaFilter);
    const includeRlsCompare = Boolean(includeRls);
    const effectiveRlsSyncDirection = ['bidirectional', 'server1_to_server2', 'server2_to_server1'].includes(rlsSyncDirection)
      ? rlsSyncDirection
      : 'bidirectional';
    const allowPolicyRecreate = includeRlsCompare && effectiveRlsSyncDirection !== 'bidirectional' && Boolean(recreateMismatchedPolicies);
    const jobs = [
      fetchSchemaSnapshot(server1Host, server1Password, schemaNames),
      fetchSchemaSnapshot(server2Host, server2Password, schemaNames)
    ];

    if (includeRlsCompare) {
      jobs.push(
        fetchRlsSnapshot(server1Host, server1Password, schemaNames),
        fetchRlsSnapshot(server2Host, server2Password, schemaNames)
      );
    }

    const [server1Snapshot, server2Snapshot, server1RlsSnapshot, server2RlsSnapshot] = await Promise.all(jobs);

    let comparison = compareSchemaSnapshots(server1Snapshot, server2Snapshot);
    if (includeRlsCompare) {
      const rlsComparison = compareRlsSnapshots(server1RlsSnapshot, server2RlsSnapshot, {
        syncDirection: effectiveRlsSyncDirection,
        recreateMismatchedPolicies: allowPolicyRecreate
      });
      comparison = mergeComparisonResults(comparison, rlsComparison);
    }
    const comparedSchemas = Array.from(new Set([
      ...schemaNames,
      ...server1Snapshot.schemas,
      ...server2Snapshot.schemas
    ])).sort();

    res.json({
      success: true,
      comparedSchemas,
      includeRls: includeRlsCompare,
      rlsSyncDirection: effectiveRlsSyncDirection,
      recreateMismatchedPolicies: allowPolicyRecreate,
      scope: includeRlsCompare
        ? `Tablolar, kolonlar, veri tipleri, default, identity, not-null ile birlikte RLS açık/force durumları ve policy tanımları karşılaştırıldı. RLS sync modu: ${effectiveRlsSyncDirection === 'server1_to_server2' ? 'Sunucu 1 → Sunucu 2' : effectiveRlsSyncDirection === 'server2_to_server1' ? 'Sunucu 2 → Sunucu 1' : 'çift yönlü rapor'}. Policy yeniden oluşturma: ${allowPolicyRecreate ? 'açık' : 'kapalı'}.`
        : 'Tablolar, kolonlar, veri tipleri, default, identity ve not-null farkları karşılaştırıldı.',
      ...comparison
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 2.6 Kaynak sunucudan verisiz yapı SQL'i dışa aktar
app.post('/api/export-structure-sql', async (req, res) => {
  const {
    sourceHost,
    sourcePassword,
    schemaFilter,
    includeBuckets
  } = req.body || {};

  if (!sourceHost || !sourcePassword) {
    return res.json({ success: false, error: 'Kaynak host ve root şifresi gerekli.' });
  }

  try {
    const schemaNames = validateSchemaNames(parseSchemaFilter(schemaFilter));
    const shouldIncludeBuckets = includeBuckets !== false;
    const schemaDumpCommand = buildSchemaDumpCommand(schemaNames);
    const bucketDumpCommand = shouldIncludeBuckets ? buildBucketDumpCommand() : 'printf ""';

    const result = await sshExec(sourceHost, sourcePassword, `
      DB_STATUS=$(docker inspect --format='{{.State.Status}}' supabase-db 2>/dev/null || echo "not_found")
      echo "__DB_STATUS__=$DB_STATUS"
      if [ "$DB_STATUS" = "running" ]; then
        SCHEMA_ERR_FILE="/tmp/schema_export_$$.log"
        BUCKET_ERR_FILE="/tmp/bucket_export_$$.log"

        echo "__STRUCTURE_SQL_START__"
        docker exec supabase-db sh -lc ${shellEscape(schemaDumpCommand)} 2>"$SCHEMA_ERR_FILE"
        SCHEMA_STATUS=$?
        printf '\\n'
        echo "__STRUCTURE_SQL_END__"
        echo "__SCHEMA_STATUS__=$SCHEMA_STATUS"
        if [ "$SCHEMA_STATUS" -ne 0 ]; then
          echo "__SCHEMA_ERR_START__"
          cat "$SCHEMA_ERR_FILE" 2>/dev/null || true
          echo "__SCHEMA_ERR_END__"
        fi

        echo "__BUCKET_SQL_START__"
        docker exec supabase-db sh -lc ${shellEscape(bucketDumpCommand)} 2>"$BUCKET_ERR_FILE"
        BUCKET_STATUS=$?
        printf '\\n'
        echo "__BUCKET_SQL_END__"
        echo "__BUCKET_STATUS__=$BUCKET_STATUS"
        if [ "$BUCKET_STATUS" -ne 0 ]; then
          echo "__BUCKET_ERR_START__"
          cat "$BUCKET_ERR_FILE" 2>/dev/null || true
          echo "__BUCKET_ERR_END__"
        fi

        rm -f "$SCHEMA_ERR_FILE" "$BUCKET_ERR_FILE"
      fi
    `);

    const output = String(result.output || '');
    const dbStatus = ((output.match(/__DB_STATUS__=(.+)/) || [])[1] || '').trim();
    if (dbStatus !== 'running') {
      throw new Error(`supabase-db container çalışmıyor veya bulunamadı (${dbStatus || 'unknown'})`);
    }

    const schemaStatus = Number((output.match(/__SCHEMA_STATUS__=(\d+)/) || [])[1] || NaN);
    if (!Number.isInteger(schemaStatus) || schemaStatus !== 0) {
      const schemaErr = extractSection(output, '__SCHEMA_ERR_START__', '__SCHEMA_ERR_END__').trim();
      throw new Error(schemaErr || result.err || 'Şema dump alınamadı');
    }

    const structureSql = extractSection(output, '__STRUCTURE_SQL_START__', '__STRUCTURE_SQL_END__').trim();
    if (!structureSql) {
      throw new Error('Şema dump çıktısı boş döndü');
    }

    let bucketStatements = [];
    let bucketWarning = '';
    if (shouldIncludeBuckets) {
      const bucketStatus = Number((output.match(/__BUCKET_STATUS__=(\d+)/) || [])[1] || NaN);
      const bucketErr = extractSection(output, '__BUCKET_ERR_START__', '__BUCKET_ERR_END__').trim();
      const bucketDump = extractSection(output, '__BUCKET_SQL_START__', '__BUCKET_SQL_END__').trim();
      const bucketDumpMissingTable = /no matching tables were found|relation .*storage\.buckets.* does not exist/i.test(bucketErr);

      if (Number.isInteger(bucketStatus) && bucketStatus === 0) {
        bucketStatements = extractBucketInsertStatements(bucketDump);
      } else if (bucketDumpMissingTable) {
        bucketWarning = 'storage.buckets tablosu kaynakta bulunamadı, bucket SQL bölümü eklenmedi.';
      } else {
        bucketWarning = bucketErr || 'Bucket SQL alınamadı. Şema SQL yine de üretildi.';
      }
    }

    const sqlSections = [
      '-- Supabase structure export (data excluded)',
      `-- Generated at: ${new Date().toISOString()}`,
      `-- Source host: ${sourceHost}`,
      `-- Schema scope: ${schemaNames.length ? schemaNames.join(', ') : 'all schemas visible to pg_dump'}`,
      '',
      structureSql
    ];

    if (shouldIncludeBuckets) {
      if (bucketStatements.length) {
        sqlSections.push(
          '',
          '-- Storage buckets metadata (object dosyalari dahil degildir)',
          ...bucketStatements
        );
      } else {
        sqlSections.push(
          '',
          '-- Storage buckets metadata: kaynakta bucket kaydi bulunamadi.'
        );
      }
    }

    res.json({
      success: true,
      sql: sqlSections.join('\n'),
      summary: {
        schemaScope: schemaNames.length ? schemaNames.join(', ') : 'Tum schema\'lar',
        bucketStatementCount: bucketStatements.length,
        bucketWarning
      }
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 3. SSE - migration log stream
app.get('/api/logs/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  if (!sseClients.has(sessionId)) sseClients.set(sessionId, []);
  sseClients.get(sessionId).push(res);
  (sseHistory.get(sessionId) || []).forEach(payload => {
    res.write(formatSsePayload(payload));
  });
  req.on('close', () => {
    const clients = sseClients.get(sessionId) || [];
    sseClients.set(sessionId, clients.filter(c => c !== res));
  });
});

// 3.5 Supabase kurulum endpoint'i (kurulu değilse)
app.post('/api/install-supabase', async (req, res) => {
  const { host, password, sessionId, continueOnMinorErrors, targetInstance } = req.body;
  res.json({ success: true, message: 'Kurulum başlatıldı' });

  const tgtDir = getInstanceDir(targetInstance);

  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      const installStreamOptions = (stepLabel) => continueOnMinorErrors
        ? { stepLabel, retryAfterExecStarted: true, maxAttempts: 5 }
        : { stepLabel };
      if (continueOnMinorErrors) {
        log('⚙️ Kurulum adımları idempotent olduğu için geçici SSH kopmalarında güvenli retry yapılacak.', 'warn');
      }
      step('ADIM 1/3 — Sistem güncelleniyor ve bağımlılıklar kuruluyor');
      await sshExecStream(host, password,
        `export DEBIAN_FRONTEND=noninteractive &&
         dpkg --configure -a 2>/dev/null || true &&
         apt-get --fix-broken install -y -qq >/dev/null 2>&1 || true &&
         apt-get update -qq &&
         apt-get install -y -qq git curl nginx certbot python3-certbot-nginx apache2-utils &&
         if ! command -v docker &>/dev/null; then
           curl -fsSL https://get.docker.com | sh &&
           systemctl enable docker &&
           systemctl start docker &&
           echo "Docker kuruldu: $(docker --version)"
         else
           echo "Docker zaten mevcut: $(docker --version)"
         fi`,
        sessionId,
        installStreamOptions('Kurulumun sistem hazırlığı adımı')
      );

      step('ADIM 2/3 — Supabase self-hosted reposu klonlanıyor');
      await sshExecStream(host, password,
        `mkdir -p ${tgtDir} &&
         cd ${tgtDir} &&
         if [ ! -d docker ]; then
           rm -rf .git docker */ 2>/dev/null;
           git clone -q --depth 1 https://github.com/supabase/supabase.git . &&
           echo "Supabase klonlandı"
         else
           echo "Supabase dizini zaten mevcut"
         fi`,
        sessionId,
        installStreamOptions('Supabase reposu klonlama adımı')
      );

      step('ADIM 3/3 — Varsayılan .env şablonu oluşturuluyor');
      await sshExecStream(host, password,
        `if [ ! -f ${tgtDir}/docker/.env ]; then
           cp ${tgtDir}/docker/.env.example ${tgtDir}/docker/.env 2>/dev/null ||
           curl -fsSo ${tgtDir}/docker/.env https://raw.githubusercontent.com/supabase/supabase/master/docker/.env.example &&
           echo ".env şablonu oluşturuldu"
         else
           echo ".env zaten mevcut, kullanılacak"
         fi`,
        sessionId,
        installStreamOptions('.env şablonu oluşturma adımı')
      );

      log('\n✅ Supabase kurulumu tamamlandı!', 'success');
      log('ℹ️  Secrets alanları bir sonraki adımda otomatik oluşturulacak.', 'warn');
      closeSseSession(sessionId, { type: 'done' });

    } catch (err) {
      log(`❌ Kurulum Hatası: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 4. Migration başlat
app.post('/api/migrate', async (req, res) => {
  const {
    sourceHost, sourcePass,
    targetHost, targetPass,
    studioDomain, apiDomain, siteUrl,
    env, sessionId,
    getSSL,
    setupBackup,   // true → Kaynaktaki rclone ve cron yedeklerini taşı
    certbotEmail,  // Let's Encrypt için e-posta
    schemaOnly: requestedSchemaOnly, // true → sadece şema + bucket tanımları, false → tam veri
    skipData,
    continueOnMinorErrors,
    preserveSourceKeys,  // true → kaynak JWT/ANON/SERVICE_ROLE anahtarlarını koru
    resume,              // true → checkpoint varsa tamamlanmış ağır adımları atla
    cleanupOnFailure,    // true → hata olursa hedefteki yarım stack'i temizle
    targetInstance
  } = req.body;
  
  const schemaOnly = Boolean(requestedSchemaOnly || skipData);
  const tgtDir = getInstanceDir(targetInstance);

  res.json({ success: true, message: 'Migration başlatıldı' });

  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    let currentStage = 'checking_source';
    let skipToServices = false; // resume: restore tamamlandıysa ağır adımları atla
    const setStage = (stageKey) => {
      currentStage = stageKey;
      emitMigrationStage(log, stageKey);
    };

    try {
      const ts = Date.now();
      const escapedTargetPass = String(targetPass || '').replace(/'/g, "'\\''");
      const escapedTargetHost = shellEscape(targetHost || '');
      const optionalStreamOptions = (stepLabel) => continueOnMinorErrors
        ? { stepLabel, allowContinueOnTransientError: true, continueResult: 0 }
        : { stepLabel };
      let sourceRepoCommit = null;
      let sourceRepoRef = null;
      let sourceRepoDir = null;
      let sourceStorageImage = null;
      let sourceServiceImages = {};
      let sourceStorageMigrationsExists = false;
      let sourceStorageMigrationsCount = null;

      if (continueOnMinorErrors) {
        log('⚙️ Geçici SSH sorunlarında opsiyonel adımlar uyarı verip atlanacak.', 'warn');
      }

      // ─── Zorunlu preflight ────────────────────────────────────────
      setStage('checking_source');
      log('🔍 Kaynak sunucu ön kontrolü başlatıldı');
      await runPreflightCheck(
        'Kaynak sunucu',
        sourceHost,
        sourcePass,
        buildSourcePreflightCommand(targetHost),
        log
      );

      setStage('checking_target');
      log('🔍 Hedef sunucu ön kontrolü başlatıldı');
      await runPreflightCheck(
        'Hedef sunucu',
        targetHost,
        targetPass,
        buildTargetPreflightCommand(targetInstance),
        log
      );

      // ─── Kaynak Supabase sürüm/commit tespiti (best effort) ──────
      log('🔎 Kaynak Supabase sürümü tespit ediliyor...');
      try {
        const versionProbe = await sshExec(sourceHost, sourcePass, `
          for d in /root/supabase /home/supabase /opt/supabase /var/supabase /srv/supabase; do
            if [ -d "$d/.git" ] && [ -d "$d/docker" ]; then
              echo "SUPABASE_REPO_DIR=$d"
              git -C "$d" rev-parse HEAD 2>/dev/null | sed 's/^/SUPABASE_REPO_COMMIT=/'
              git -C "$d" describe --tags --always 2>/dev/null | sed 's/^/SUPABASE_REPO_REF=/'
              break
            fi
          done
          docker inspect supabase-storage --format 'SUPABASE_STORAGE_IMAGE={{.Config.Image}}' 2>/dev/null || true
          for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Ei 'supabase|realtime'); do
            svc=$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null)
            img=$(docker inspect "$c" --format '{{.Config.Image}}' 2>/dev/null)
            [ -n "$svc" ] && [ -n "$img" ] && echo "SVC_IMAGE:$svc=$img"
          done
        `);

        const probeOut = (versionProbe.output || '').trim();
        sourceRepoDir = ((probeOut.match(/SUPABASE_REPO_DIR=(.+)/) || [])[1] || '').trim() || null;
        sourceRepoRef = ((probeOut.match(/SUPABASE_REPO_REF=(.+)/) || [])[1] || '').trim() || null;
        sourceStorageImage = ((probeOut.match(/SUPABASE_STORAGE_IMAGE=(.+)/) || [])[1] || '').trim() || null;
        for (const svcMatch of probeOut.matchAll(/^SVC_IMAGE:([A-Za-z0-9_-]+)=(.+)$/gm)) {
          const svc = (svcMatch[1] || '').trim();
          const img = (svcMatch[2] || '').trim();
          if (svc && img) sourceServiceImages[svc] = img;
        }

        const detectedCommit = ((probeOut.match(/SUPABASE_REPO_COMMIT=([0-9a-fA-F]{7,40})/) || [])[1] || '').trim();
        if (detectedCommit) sourceRepoCommit = detectedCommit;

        if (sourceRepoCommit) {
          log(`📌 Kaynak Supabase repo commit: ${sourceRepoCommit.slice(0, 12)}${sourceRepoRef ? ` (${sourceRepoRef})` : ''}`);
          if (sourceRepoDir) log(`📁 Kaynak repo yolu: ${sourceRepoDir}`);
        } else {
          log('⚠️ Kaynak repo commit tespit edilemedi — hedefte varsayılan Supabase sürümü kurulacak.', 'warn');
        }
        if (sourceStorageImage) log(`📦 Kaynak storage image: ${sourceStorageImage}`);
        const detectedSvcCount = Object.keys(sourceServiceImages).length;
        if (detectedSvcCount) log(`🔎 Kaynak servis sürümleri tespit edildi: ${detectedSvcCount} servis`);
      } catch (e) {
        log(`⚠️ Kaynak sürüm tespiti başarısız (non-kritik): ${e.message}`, 'warn');
      }

      // Kaynak API anahtarlarını koru (opsiyonel): JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY
      // kaynaktan taşınır; böylece müşterinin mevcut uygulamalarındaki anahtarlar geçerli kalır.
      if (preserveSourceKeys) {
        try {
          const srcEnvDir = sourceRepoDir || '/root/supabase';
          const keyProbe = await sshExec(sourceHost, sourcePass,
            `grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' ${srcEnvDir}/docker/.env 2>/dev/null || true`
          );
          const parsedKeys = {};
          for (const kline of String(keyProbe.output || '').split('\n')) {
            const km = kline.match(/^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=(.*)$/);
            if (km) parsedKeys[km[1]] = km[2].trim().replace(/^["']|["']$/g, '');
          }
          if (parsedKeys.JWT_SECRET && parsedKeys.ANON_KEY && parsedKeys.SERVICE_ROLE_KEY) {
            env.JWT_SECRET = parsedKeys.JWT_SECRET;
            env.ANON_KEY = parsedKeys.ANON_KEY;
            env.SERVICE_ROLE_KEY = parsedKeys.SERVICE_ROLE_KEY;
            log('🔑 Kaynak API anahtarları korunuyor (JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY) — mevcut uygulamalarınız aynı anahtarlarla çalışmaya devam edecek.', 'success');
          } else {
            log('⚠️ Kaynak API anahtarları okunamadı; hedefte yeni anahtarlar üretilecek. Mevcut uygulamalarınızdaki ANON_KEY/SERVICE_ROLE_KEY değerlerini güncellemeniz gerekebilir.', 'warn');
          }
        } catch (e) {
          log(`⚠️ Kaynak anahtar okuma hatası (non-kritik): ${e.message}`, 'warn');
        }
      }

      // ─── Schema-only modunda storage.migrations geçmişini ayrıca doğrula ───
      if (schemaOnly) {
        try {
          const storageMigProbe = await sshExec(sourceHost, sourcePass,
            `docker exec supabase-db psql -U supabase_admin -d postgres -Atqc "select case when to_regclass('storage.migrations') is null then 'MISSING' else (select count(*)::text from storage.migrations) end" 2>/dev/null || echo "MISSING"`
          );
          const probeLines = (storageMigProbe.output || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
          const last = probeLines[probeLines.length - 1] || 'MISSING';
          if (last !== 'MISSING' && /^\d+$/.test(last)) {
            sourceStorageMigrationsExists = true;
            sourceStorageMigrationsCount = Number(last);
            log(`🧾 Kaynak storage.migrations satır sayısı: ${sourceStorageMigrationsCount}`);
          } else {
            log('⚠️ Kaynakta storage.migrations tablosu bulunamadı (schema-only storage migration geçmişi taşınamayacak).', 'warn');
          }
        } catch (e) {
          log(`⚠️ storage.migrations kaynağı doğrulanamadı (non-kritik): ${e.message}`, 'warn');
        }
      }

      // ADIM 1: PostgreSQL Dump ─── KRİTİK
      // Checkpoint/resume: önceki çalışma restore'u bitirdiyse ağır adımları atla.
      if (resume) {
        try {
          const cp = await sshExec(targetHost, targetPass, `cat ${tgtDir}/.baseup_checkpoint 2>/dev/null || true`);
          if (String(cp.output || '').includes('restore_done')) {
            skipToServices = true;
            log('⏩ Checkpoint bulundu: veritabanı geri yükleme tamamlanmış. Yedekleme/aktarım/restore adımları atlanıp doğrudan servis başlatmaya geçiliyor.', 'success');
            // Hedefteki gerçek .env değerlerini kullan ki doğrulama ve final loglar tutarlı olsun
            try {
              const effEnv = await sshExec(targetHost, targetPass, `grep -E '^(DASHBOARD_PASSWORD|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' ${tgtDir}/docker/.env 2>/dev/null || true`);
              for (const eline of String(effEnv.output || '').split('\n')) {
                const em = eline.match(/^(DASHBOARD_PASSWORD|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=(.*)$/);
                if (em) env[em[1]] = em[2].trim().replace(/^["']|["']$/g, '');
              }
            } catch (effErr) {
              log(`⚠️ Hedef .env okunamadı (non-kritik): ${effErr.message}`, 'warn');
            }
          } else {
            log('ℹ️ Geçerli bir checkpoint bulunamadı (restore tamamlanmamış); taşıma baştan çalıştırılıyor.', 'warn');
          }
        } catch (cpErr) {
          log(`⚠️ Checkpoint okunamadı, baştan çalıştırılıyor: ${cpErr.message}`, 'warn');
        }
      }

      if (!skipToServices) {
      setStage('creating_backup');
      const dumpFlag = schemaOnly ? '--schema-only' : '';
      const dumpLabel = schemaOnly ? 'Şema (tablo yapısı) yedekleniyor' : 'Tam veritabanı yedekleniyor';
      step(`ADIM 1/6 — ${dumpLabel}`);
      log(schemaOnly ? '📐 Sadece şema kopyalanacak — veriler aktarılmayacak' : '📦 Tüm veriler dahil kopyalanıyor', 'warn');

      const dumpCode = await sshExecStream(sourceHost, sourcePass,
        `docker exec supabase-db pg_dump -U supabase_admin ${dumpFlag} --no-owner --no-privileges postgres > /tmp/supabase_pgdump_${ts}.sql 2>/tmp/pgdump_stderr_${ts}.log && [ -s /tmp/supabase_pgdump_${ts}.sql ] && echo "Dump boyutu: $(ls -lh /tmp/supabase_pgdump_${ts}.sql | awk '{print $5}')" && if [ -s /tmp/pgdump_stderr_${ts}.log ]; then echo "⚠️ pg_dump uyarıları:"; cat /tmp/pgdump_stderr_${ts}.log; fi`,
        sessionId
      );
      if (dumpCode !== 0) throw new Error(`Database dump alınamadı veya dump dosyası boş (exit: ${dumpCode}). "supabase-db" container'ı çalışıyor mu?`);

      // Şema modunda bucket tanımlarını ayrıca al (opsiyonel)
      if (schemaOnly) {
        log('🪣 Bucket tanımları ve storage meta ayrıca alınıyor...', 'warn');
        try {
          const bucketDumpCode = await sshExecStream(sourceHost, sourcePass,
            `docker exec supabase-db pg_dump -U supabase_admin --data-only \
	              -t storage.buckets \
	              postgres > /tmp/supabase_buckets_${ts}.sql 2>/dev/null && \
	            echo "Bucket dump: $(ls -lh /tmp/supabase_buckets_${ts}.sql | awk '{print $5}')"`,
            sessionId,
            optionalStreamOptions('Bucket dump alma adımı')
          );
          if (bucketDumpCode !== 0) log('⚠️ Bucket dump alınamadı, atlanıyor (non-kritik).', 'warn');
        } catch (e) {
          log(`⚠️ Bucket dump alınamadı (non-kritik, atlanıyor): ${e.message}`, 'warn');
        }

        // storage.migrations geçmişi schema-only modunda kritik hale gelebilir
        if (sourceStorageMigrationsExists) {
          const storageMigDumpCode = await sshExecStream(sourceHost, sourcePass,
            `docker exec supabase-db pg_dump -U supabase_admin --data-only -t storage.migrations postgres > /tmp/supabase_storage_migrations_${ts}.sql 2>/dev/null && \
	             echo "Storage migrations dump: $(ls -lh /tmp/supabase_storage_migrations_${ts}.sql | awk '{print $5}')"`,
            sessionId
          );
          if (storageMigDumpCode !== 0) {
            throw new Error(`Schema-only modunda storage.migrations dump alınamadı (exit: ${storageMigDumpCode}). Bu dump olmadan storage servisi migration çakışmasına girebilir.`);
          }
        }
      }

      // ADIM 2: Storage yedekle ─── OPSİYONEL
      if (!schemaOnly) {
        step('ADIM 2/6 — Storage yedekleniyor');
        try {
          const storCode = await sshExecStream(sourceHost, sourcePass,
            `if [ -d /root/supabase/docker/volumes/storage ]; then tar -czf /tmp/supabase_storage_${ts}.tar.gz -C /root/supabase/docker/volumes storage/ && echo "Storage: $(ls -lh /tmp/supabase_storage_${ts}.tar.gz | awk '{print $5}')"; else echo "Storage dizini yok, atlanıyor"; fi`,
            sessionId,
            optionalStreamOptions('Storage yedekleme adımı')
          );
          if (storCode !== 0) log('⚠️ Storage yedeklenemedi — migration devam ediyor ama dosyalar aktarılmayacak.', 'warn');
        } catch (e) {
          log(`⚠️ Storage yedekleme hatası (non-kritik): ${e.message}`, 'warn');
        }
      } else {
        step('ADIM 2/6 — Storage atlandı (şema modu)');
        log('ℹ️ Storage dosyaları şema modunda kopyalanmıyor', 'warn');
      }

      // ADIM 3: Hedef sunucu kurulum ─── KRİTİK
      step('ADIM 3/6 — Hedef sunucuya Docker + Nginx + Supabase kuruluyor');
      const pinnedInstallBlock = sourceRepoCommit && /^[0-9a-fA-F]{7,40}$/.test(sourceRepoCommit)
        ? `if [ ! -d .git ]; then
             rm -rf .git docker */ 2>/dev/null;
             git clone -q --depth 1 https://github.com/supabase/supabase.git . && echo "Supabase repo klonlandı";
           else
             echo "Supabase repo mevcut: $(git rev-parse --short HEAD)";
           fi &&
           (git fetch -q --depth 1 origin ${sourceRepoCommit} || git fetch -q --tags --prune origin) &&
           git checkout -q -f ${sourceRepoCommit} &&
           echo "Kaynak commit checkout edildi: $(git rev-parse --short HEAD)"`
        : `if [ ! -d docker ]; then rm -rf .git docker */ 2>/dev/null; git clone -q --depth 1 https://github.com/supabase/supabase.git . && echo "Supabase klonlandı"; else echo "Supabase zaten mevcut"; fi`;
      const installCode = await sshExecStream(targetHost, targetPass,
        `export DEBIAN_FRONTEND=noninteractive &&
         dpkg --configure -a 2>/dev/null || true &&
         apt-get --fix-broken install -y -qq >/dev/null 2>&1 || true &&
         apt-get update -qq &&
         apt-get install -y -qq git curl nginx certbot python3-certbot-nginx apache2-utils &&
         if ! command -v docker &>/dev/null; then curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker && echo "Docker kuruldu"; else echo "Docker mevcut: $(docker --version)"; fi &&
         mkdir -p ${tgtDir} && cd ${tgtDir} &&
         ${pinnedInstallBlock} &&
         if [ -f ${tgtDir}/docker/docker-compose.yml ]; then
           cp ${tgtDir}/docker/docker-compose.yml ${tgtDir}/docker/docker-compose.yml.bak &&
           sed -i -E "s/container_name:[[:space:]]*supabase-/container_name: supabase-${targetInstance}-/g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/kong:#image: kong:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/imgproxy:#image: darthsim/imgproxy:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/postgrest:#image: postgrest/postgrest:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/vector:#image: timberio/vector:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/#image: supabase/#g" ${tgtDir}/docker/docker-compose.yml &&
           awk '/container_name: supabase-.*-storage/ { in_storage=1 } in_storage && /environment:/ { print; print "      WORKERS: 1"; print "      STORAGE_WORKERS: 1"; print "      GLOBAL_CONCURRENCY: 1"; in_storage=0; next; } { print }' ${tgtDir}/docker/docker-compose.yml > ${tgtDir}/docker/docker-compose.yml.tmp && mv ${tgtDir}/docker/docker-compose.yml.tmp ${tgtDir}/docker/docker-compose.yml &&
           echo "Compose image normalizasyonu uygulandı (ECR -> varsayılan registry)";
         else
           echo "docker-compose.yml bulunamadı, image normalizasyonu atlandı";
         fi`,
        sessionId,
        continueOnMinorErrors ? { stepLabel: 'Hedef sunucu kurulumu', retryAfterExecStarted: true, maxAttempts: 5 } : { stepLabel: 'Hedef sunucu kurulumu' }
      );
      if (installCode !== 0) throw new Error(`Hedef sunucu kurulumu başarısız (exit: ${installCode}). İnternet bağlantısı veya disk alanı kontrol edin.`);

      // ─── ADIM 3.1: Image parity — kaynaktaki gerçek servis sürümlerini hedefe sabitle ───
      // sourceRepoCommit her zaman tespit edilemez; edilse bile kaynak, commit'in belirttiğinden
      // daha yeni image pull etmiş olabilir. Çalışan image'ları docker-compose.override.yml ile
      // birebir sabitlemek storage/auth/realtime migration sürüm uyuşmazlığını (crash-loop) kökten önler.
      // Sadece restore edilen dump'a karşı migration çalıştıran app-tier servisleri sabitle.
      // db ve config-dosyası tabanlı altyapı servisleri (vector, analytics, kong, studio, meta,
      // imgproxy, functions, pooler) klonlanan repo'nun kendi sürümünü kullanmalı; bunları kaynağa
      // sabitlemek compose-config ↔ image uyuşmazlığı yaratır (ör. vector.yml eski vector image'ında patlar
      // ve depends_on zinciri yüzünden tüm "docker compose up" çöker).
      const PIN_ALLOWED_SERVICES = new Set(['storage', 'auth', 'realtime']);
      const normalizeSourceImage = (img) => String(img)
        .replace(/^public\.ecr\.aws\/supabase\/kong:/, 'kong:')
        .replace(/^public\.ecr\.aws\/supabase\/imgproxy:/, 'darthsim/imgproxy:')
        .replace(/^public\.ecr\.aws\/supabase\/postgrest:/, 'postgrest/postgrest:')
        .replace(/^public\.ecr\.aws\/supabase\/vector:/, 'timberio/vector:')
        .replace(/^public\.ecr\.aws\/supabase\//, 'supabase/');
      const pinEntries = Object.entries(sourceServiceImages)
        .filter(([svc, img]) => PIN_ALLOWED_SERVICES.has(svc) && img)
        .map(([svc, img]) => [svc, normalizeSourceImage(img)]);
      const skippedPinServices = Object.keys(sourceServiceImages).filter(svc => !PIN_ALLOWED_SERVICES.has(svc));

      if (pinEntries.length) {
        step('ADIM 3.1/6 — Kaynak sürümleri hedefe sabitleniyor (image parity)');
        const overrideYaml = 'services:\n' +
          pinEntries.map(([svc, img]) => `  ${svc}:\n    image: ${img}\n`).join('');
        const overrideB64 = Buffer.from(overrideYaml, 'utf8').toString('base64');
        try {
          const overrideCode = await sshExecStream(targetHost, targetPass,
            `echo '${overrideB64}' | base64 -d > ${tgtDir}/docker/docker-compose.override.yml && echo "Image parity override yazıldı (${pinEntries.length} servis)"`,
            sessionId,
            optionalStreamOptions('Image parity override yazma')
          );
          if (overrideCode === 0) {
            log(`📌 ${pinEntries.length} servis kaynak sürümüne sabitlendi (docker-compose.override.yml):`);
            pinEntries.forEach(([svc, img]) => log(`   • ${svc}: ${img}`));
            if (skippedPinServices.length) log(`ℹ️ Standart olmayan servis(ler) sabitlenmedi: ${skippedPinServices.join(', ')}`, 'warn');
          } else {
            log('⚠️ Image parity override yazılamadı — klonlanan (varsayılan) sürümlerle devam edilecek.', 'warn');
          }
        } catch (e) {
          log(`⚠️ Image parity override hatası (non-kritik): ${e.message}`, 'warn');
        }
      } else {
        log('⚠️ Kaynak servis sürümleri tespit edilemedi — image parity atlanıyor, varsayılan sürümler kullanılacak.', 'warn');
      }

      // ADIM 4: .env ve Nginx ─── KRİTİK (.env) / OPSİYONEL (nginx)
      step('ADIM 4/6 — Yeni .env ve Nginx config yükleniyor');
      const envContent = buildEnvFile(env, studioDomain, apiDomain, siteUrl);
      const nginxContent = buildNginxConf(studioDomain, apiDomain, env.DASHBOARD_PASSWORD || '', targetInstance);

      // .env yaz — KRİTİK
      const escapedEnv = envContent.replace(/'/g, "'\\''");
      const envSecretValidationCommand = buildEnvSecretValidationCommand(`${tgtDir}/docker/.env`);
      const envWriteCode = await sshExecStream(targetHost, targetPass,
        `mkdir -p ${tgtDir}/docker && printf '%s' '${escapedEnv}' > ${tgtDir}/docker/.env && echo ".env yazıldı ($(wc -l < ${tgtDir}/docker/.env) satır)"`,
        sessionId
      );
      if (envWriteCode !== 0) throw new Error(`.env yazılamadı (exit: ${envWriteCode}). Disk dolu mu?`);
      const envSecretValidationCode = await sshExecStream(targetHost, targetPass, envSecretValidationCommand, sessionId);
      if (envSecretValidationCode !== 0) {
        throw new Error(`.env kritik secret kontrolü başarısız (exit: ${envSecretValidationCode}). POSTGRES_PASSWORD/JWT/SERVICE_ROLE değerleri boş olamaz.`);
      }

      // Nginx config — OPSİYONEL
      try {
        const escapedNginx = nginxContent.replace(/'/g, "'\\''");
        const nginxCode = await sshExecStream(targetHost, targetPass,
          `mkdir -p /etc/nginx/ssl &&
           for d in '${studioDomain}' '${apiDomain}'; do
             [ -z "$d" ] && continue;
             crt="/etc/nginx/ssl/$d.crt";
             key="/etc/nginx/ssl/$d.key";
             if [ ! -s "$crt" ] || [ ! -s "$key" ]; then
               openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -keyout "$key" -out "$crt" -subj "/CN=$d" >/dev/null 2>&1 || true;
             fi;
           done &&
           printf '%s' '${escapedNginx}' > /etc/nginx/sites-available/supabase-${targetInstance} &&
           ln -sf /etc/nginx/sites-available/supabase-${targetInstance} /etc/nginx/sites-enabled/supabase-${targetInstance} &&
           rm -f /etc/nginx/sites-enabled/default &&
           nginx -t &&
           (systemctl reload nginx || systemctl restart nginx) &&
           echo "Nginx yapılandırıldı"`,
          sessionId,
          optionalStreamOptions('Nginx yapılandırma adımı')
        );
        if (nginxCode !== 0) log('⚠️ Nginx yapılandırılamadı — elle kontrol edin: nginx -t', 'warn');
      } catch (e) {
        log(`⚠️ Nginx hatası (non-kritik): ${e.message}`, 'warn');
      }

      // htpasswd — OPSİYONEL
      try {
        const dashPass = env.DASHBOARD_PASSWORD || 'admin123';
        const htCode = await sshExecStream(targetHost, targetPass,
          `htpasswd -cb /etc/nginx/.htpasswd admin '${dashPass}' && echo "htpasswd oluşturuldu"`,
          sessionId,
          optionalStreamOptions('Studio htpasswd oluşturma adımı')
        );
        if (htCode !== 0) log('⚠️ htpasswd oluşturulamadı — Studio giriş koruması çalışmayabilir.', 'warn');
      } catch (e) {
        log(`⚠️ htpasswd hatası (non-kritik): ${e.message}`, 'warn');
      }

      // ADIM 5: Dump'ı kopyala ─── KRİTİK
      setStage('transferring_files');
      step('ADIM 5/6 — Veritabanı hedef sunucuya aktarılıyor');
      log('💾 DB dump hedef sunucuya kopyalanıyor (bu biraz sürebilir)...');

      const scpCode = await sshExecStream(sourceHost, sourcePass,
        `sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/supabase_pgdump_${ts}.sql root@${escapedTargetHost}:/tmp/ 2>&1 || \
	         (apt-get install -y -qq sshpass && sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/supabase_pgdump_${ts}.sql root@${escapedTargetHost}:/tmp/) && \
	         src_size=$(stat -c%s /tmp/supabase_pgdump_${ts}.sql) &&
	         tgt_size=$(sshpass -p '${escapedTargetPass}' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${escapedTargetHost} "stat -c%s /tmp/supabase_pgdump_${ts}.sql") &&
	         [ "$src_size" = "$tgt_size" ] &&
	         [ "$tgt_size" -gt 0 ] &&
	         echo "DB dump kopyalandı ve boyut doğrulandı (\${tgt_size} byte)"`,
        sessionId
      );
      if (scpCode !== 0) throw new Error(`Dump transfer edilemedi veya eksik aktarıldı (exit: ${scpCode}). Kaynak → hedef arası SSH erişimi var mı?`);

      // Storage kopyala — OPSİYONEL
      if (!schemaOnly) {
        try {
          await sshExecStream(sourceHost, sourcePass,
            `if [ -f /tmp/supabase_storage_${ts}.tar.gz ]; then apt-get install -y -qq sshpass 2>/dev/null; sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/supabase_storage_${ts}.tar.gz root@${escapedTargetHost}:/tmp/ && echo "Storage kopyalandı"; else echo "Storage dosyası yok, atlanıyor"; fi`,
            sessionId,
            optionalStreamOptions('Storage kopyalama adımı')
          );
        } catch (e) {
          log(`⚠️ Storage kopyalanamadı (non-kritik): ${e.message}`, 'warn');
        }
      }

      // Bucket dump kopyala — OPSİYONEL
      if (schemaOnly) {
        try {
          const bucketScpCode = await sshExecStream(sourceHost, sourcePass,
            `if [ -f /tmp/supabase_buckets_${ts}.sql ]; then apt-get install -y -qq sshpass 2>/dev/null; sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/supabase_buckets_${ts}.sql root@${escapedTargetHost}:/tmp/ && echo "Bucket dump kopyalandı"; else echo "Bucket dump yok, atlanıyor"; fi`,
            sessionId,
            optionalStreamOptions('Bucket dump kopyalama adımı')
          );
          if (bucketScpCode !== 0) log('⚠️ Bucket dump hedefe kopyalanamadı (non-kritik).', 'warn');
        } catch (e) {
          log(`⚠️ Bucket dump kopyalanamadı (non-kritik): ${e.message}`, 'warn');
        }

        if (sourceStorageMigrationsExists) {
          const storageMigScpCode = await sshExecStream(sourceHost, sourcePass,
            `if [ -f /tmp/supabase_storage_migrations_${ts}.sql ]; then \
	               apt-get install -y -qq sshpass 2>/dev/null; \
	               sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/supabase_storage_migrations_${ts}.sql root@${escapedTargetHost}:/tmp/ && \
	               echo "Storage migrations dump kopyalandı"; \
	             else \
	               echo "storage.migrations dump dosyası bulunamadı"; \
               exit 2; \
             fi`,
            sessionId
          );
          if (storageMigScpCode !== 0) {
            throw new Error(`storage.migrations dump hedefe kopyalanamadı (exit: ${storageMigScpCode}). Schema-only modunda storage migration geçmişi eksik kalır.`);
          }
        }
      }

      // Hedefte DB başlat ve restore et ─── KRİTİK
      // supabase_admin = tek superuser — sahiplik değişiklikleri için gerekli
      const superPsql = `docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres`;
      const superPsqlStdin = `docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres`;
      const superPsqlStrict = `docker exec supabase-${targetInstance}-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres`;
      const superPsqlStrictStdin = `docker exec -i supabase-${targetInstance}-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres`;
      const storageRestore = schemaOnly
        ? `echo "Şema modu: storage geri yükleme atlandı"`
        : `if [ -f /tmp/supabase_storage_${ts}.tar.gz ]; then mkdir -p ${tgtDir}/docker/volumes && rm -rf ${tgtDir}/docker/volumes/storage && tar -xzf /tmp/supabase_storage_${ts}.tar.gz -C ${tgtDir}/docker/volumes/ && echo "Storage geri yüklendi"; fi`;

      const bucketRestore = schemaOnly
        ? `if [ -f /tmp/supabase_buckets_${ts}.sql ]; then ${superPsqlStrictStdin} < /tmp/supabase_buckets_${ts}.sql && echo "Bucket tanımları yüklendi"; else echo "Bucket dump yok, atlanıyor"; fi`
        : `echo "Tam veri modu: bucket'lar zaten yüklendi"`;
      const storageMigrationsRestore = (schemaOnly && sourceStorageMigrationsExists)
        ? `if [ -f /tmp/supabase_storage_migrations_${ts}.sql ]; then \
             ${superPsqlStrict} -c "TRUNCATE TABLE storage.migrations;" && \
             ${superPsqlStrictStdin} < /tmp/supabase_storage_migrations_${ts}.sql && \
             echo "Storage migration geçmişi yüklendi"; \
           else \
             echo "storage.migrations dump yok"; \
             exit 3; \
           fi`
        : `echo "Storage migration geçmişi importu gerekmiyor"`;

      setStage('restoring_database');
      const restoreCode = await sshExecStream(targetHost, targetPass,
         `psql_prep() { n=0; while true; do "$@"; rc=$?; if [ $rc -eq 0 ]; then return 0; fi; n=$((n+1)); if [ $n -ge 5 ]; then return $rc; fi; echo "⚠️ psql hata (exit $rc, deneme $n/5) — DB konteynerinin toparlanması bekleniyor..."; w=0; until docker exec supabase-${targetInstance}-db pg_isready -U postgres >/dev/null 2>&1; do w=$((w+1)); if [ $w -ge 40 ]; then echo "❌ DB konteyneri 120 sn içinde geri gelmedi"; return $rc; fi; sleep 3; done; sleep 2; done; };
	         cd ${tgtDir}/docker &&
		         if [ -f docker-compose.yml ]; then
		           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/kong:#image: kong:#g" docker-compose.yml &&
		           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/imgproxy:#image: darthsim/imgproxy:#g" docker-compose.yml &&
		           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/postgrest:#image: postgrest/postgrest:#g" docker-compose.yml &&
		           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/vector:#image: timberio/vector:#g" docker-compose.yml &&
		           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/#image: supabase/#g" docker-compose.yml;
		         fi &&
             ${envSecretValidationCommand}
		         echo "🛠 Restore hazırlık motoru: v2 (init-marker + dayanıklı psql retry)" &&
		         echo "Önceki compose servisleri durduruluyor (temiz restore için)..." &&
		         (docker compose down -v --remove-orphans >/dev/null 2>&1 || true) &&
		         echo "Eski DB verisi temizleniyor (yeni POSTGRES_PASSWORD ile sıfırdan init için)..." &&
		         rm -rf ${tgtDir}/docker/volumes/db/data &&
		         docker compose up -d --quiet-pull --no-deps db &&
	         echo "DB başlatılıyor (ilk init birkaç dakika sürebilir)..." &&
	         db_ready=0 &&
	         stable=0 &&
	         for i in $(seq 1 120); do
	           if docker exec supabase-${targetInstance}-db pg_isready -U postgres >/dev/null 2>&1 && docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -Atc "select 1" >/dev/null 2>&1; then
	             if docker logs supabase-${targetInstance}-db 2>&1 | grep -Eq "PostgreSQL init process complete|Skipping initialization"; then db_ready=1; break; fi;
	             stable=$((stable+1));
	             if [ $stable -ge 12 ]; then db_ready=1; break; fi;
	           else
	             stable=0;
	           fi;
	           sleep 3;
	         done &&
	         if [ "$db_ready" -ne 1 ]; then
	           echo "❌ DB 360 saniye içinde hazır olmadı (ilk init tamamlanmadı) veya supabase_admin parola doğrulaması başarısız. Container logları:";
	           docker logs --tail 50 supabase-${targetInstance}-db 2>&1;
	           exit 9;
	         fi &&
	         echo "DB hazır, supabase_admin girişi doğrulandı ✅" &&
	         echo "Uyumluluk rolleri hazırlanıyor..." &&
	         psql_prep docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_realtime_admin') THEN CREATE ROLE supabase_realtime_admin NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mcp_readonly') THEN CREATE ROLE mcp_readonly NOLOGIN; END IF; END \\$\\$;" &&
	         echo "Hedef postgres veritabanı sıfırlanıyor..." &&
	         psql_prep docker exec supabase-${targetInstance}-db psql -U supabase_admin -d template1 -c "DROP DATABASE IF EXISTS postgres WITH (FORCE);" &&
	         psql_prep docker exec supabase-${targetInstance}-db psql -U supabase_admin -d template1 -c "CREATE DATABASE postgres OWNER supabase_admin;" &&
	         echo "Hedef postgres veritabanı yeniden oluşturuldu" &&
	         ${superPsqlStdin} < /tmp/supabase_pgdump_${ts}.sql 2>/tmp/psql_restore_${ts}.log;
	         psql_exit=$?;
	         echo "psql exit: \${psql_exit}" &&
	         if [ "\${psql_exit}" -ne 0 ]; then
	           if [ -f /tmp/psql_restore_${ts}.log ]; then
	             echo "❌ psql restore hatası (son 120 satır):";
	             tail -n 120 /tmp/psql_restore_${ts}.log 2>/dev/null;
	           else
	             echo "❌ Restore başlamadan önceki hazırlık adımı başarısız oldu (rol oluşturma / DB sıfırlama). Yukarıdaki psql hatasına bakın.";
	           fi;
	           echo "🔎 Otomatik teşhis (exit \${psql_exit}):";
	           docker inspect -f "container: RestartCount={{.RestartCount}} Status={{.State.Status}} OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}}" supabase-${targetInstance}-db 2>/dev/null;
	           echo "— Bellek durumu:"; free -m 2>/dev/null | head -3;
	           echo "— OOM/kill kayıtları (dmesg):"; dmesg 2>/dev/null | grep -iE "out of memory|killed process|oom" | tail -n 5; true;
	           echo "— Son DB container logları:"; docker logs --tail 25 supabase-${targetInstance}-db 2>&1;
	           exit \${psql_exit};
	         fi &&
	         if [ -s /tmp/psql_restore_${ts}.log ]; then
	           echo "⚠️ psql restore uyarıları (son 40 satır):" &&
	           tail -n 40 /tmp/psql_restore_${ts}.log;
	         fi &&
	         echo "DB dump geri yüklendi" &&
	         echo "Kritik şemalar doğrulanıyor..." &&
	         docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -Atc "SELECT string_agg(nspname, ',') FROM pg_namespace WHERE nspname IN ('auth','storage','extensions','realtime')" | grep -q 'auth' &&
         echo "Realtime tenants temizleniyor..." &&
	         docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -c "DROP TABLE IF EXISTS realtime.tenants CASCADE;" &&
         echo "DB restore doğrulandı ✅" &&
         ${storageRestore} &&
         ${storageMigrationsRestore} &&
         ${bucketRestore}`,
        sessionId
      );
      if (restoreCode !== 0) throw new Error(`DB restore başarısız (exit: ${restoreCode}). "docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres" komutu ile manuel kontrol edin.`);
      if (!schemaOnly) {
        setStage('restoring_storage');
        log('✅ Storage geri yükleme restore adımı içinde tamamlandı');
      }

      // Schema-only modunda storage.migrations gerçekten geldi mi doğrula
      if (schemaOnly && sourceStorageMigrationsExists && Number.isInteger(sourceStorageMigrationsCount)) {
        try {
          const targetStorageMigCheck = await sshExec(targetHost, targetPass,
            `docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -Atqc "select count(*) from storage.migrations" 2>/dev/null`
          );
          const targetCount = Number((targetStorageMigCheck.output || '').trim().split('\n').filter(Boolean).pop() || NaN);
          if (!Number.isInteger(targetCount)) {
            throw new Error('Hedef storage.migrations satır sayısı okunamadı');
          }
          log(`🧾 Hedef storage.migrations satır sayısı: ${targetCount}`);
          if (targetCount !== sourceStorageMigrationsCount) {
            throw new Error(`storage.migrations satır sayısı eşleşmiyor (kaynak: ${sourceStorageMigrationsCount}, hedef: ${targetCount}). Supabase Storage başlatılmadan durduruldu.`);
          }
          log('✅ storage.migrations geçmişi doğrulandı');
        } catch (e) {
          throw new Error(`storage.migrations doğrulaması başarısız: ${e.message}`);
        }
      }

      // ─── Post-restore: Schema Sahiplik ve İzin Düzeltmesi ────────
      // pg_dump --no-owner ile restore edilen nesneler postgres'e ait
      // Supabase servisleri kendi admin rolleriyle bağlanır ve izin hatası alır
      step('Schema sahiplikleri ve izinleri düzeltiliyor');
      log('🔧 auth, storage, realtime, extensions şema sahiplikleri düzeltiliyor...');

      // SQL'i base64 ile kodla — SSH/shell escaping sorunlarını tamamen önler
      const permFixSql = [
        // ═══ Auth schema ═══
        `ALTER SCHEMA auth OWNER TO supabase_auth_admin;`,
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='auth' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `    BEGIN`,
        `      IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      ELSE EXECUTE format('ALTER TABLE auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      END IF;`,
        `    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Sahiplik (%): %', r.relkind, r.relname; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='auth' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP`,
        `    BEGIN EXECUTE format('ALTER TYPE auth.%I OWNER TO supabase_auth_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT p.oid::regprocedure::text as funcdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'auth' LOOP`,
        `    BEGIN EXECUTE 'ALTER FUNCTION ' || r.funcdef || ' OWNER TO supabase_auth_admin'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='auth' AND tablename='schema_migrations') THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20221208132122') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  -- Bazı dump'larda oauth_clients tablosu eksik kolonlu/yarım gelebiliyor; migration'ın sağlıklı yeniden yaratabilmesi için düşür`,
        `  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='oauth_clients')`,
        `     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='oauth_clients' AND column_name='client_id') THEN`,
        `    BEGIN EXECUTE 'DROP TABLE auth.oauth_clients CASCADE'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  -- Şema hedef duruma zaten geldiyse migration versiyonunu hizala`,
        `  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='oauth_clients')`,
        `     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='oauth_clients' AND column_name='client_id') THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20250731150234') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  IF EXISTS (`,
        `       SELECT 1`,
        `       FROM pg_constraint c`,
        `       JOIN pg_class t ON t.oid = c.conrelid`,
        `       JOIN pg_namespace n ON n.oid = t.relnamespace`,
        `       WHERE n.nspname='auth' AND t.relname='oauth_authorizations' AND c.conname='oauth_authorizations_nonce_length'`,
        `     ) THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20251104100000') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  IF EXISTS (`,
        `       SELECT 1`,
        `       FROM pg_constraint c`,
        `       JOIN pg_class t ON t.oid = c.conrelid`,
        `       JOIN pg_namespace n ON n.oid = t.relnamespace`,
        `       WHERE n.nspname='auth' AND t.relname='sessions' AND c.conname='sessions_scopes_length'`,
        `     ) THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20251111201300') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `END $fix$;`,
        `GRANT ALL ON SCHEMA auth TO supabase_auth_admin;`,
        `GRANT USAGE ON SCHEMA auth TO postgres, supabase_admin;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA auth TO supabase_auth_admin;`,
        // Spesifik kritik fonksiyonların sahipliği mutlaka değişmeli
        `ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;`,
        `ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;`,
        // ═══ Storage schema ═══
        `CREATE SCHEMA IF NOT EXISTS storage_vectors AUTHORIZATION supabase_storage_admin;`,
        `ALTER SCHEMA storage OWNER TO supabase_storage_admin;`,
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='storage' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `    BEGIN`,
        `      IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      ELSE EXECUTE format('ALTER TABLE storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      END IF;`,
        `    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Sahiplik (%): %', r.relkind, r.relname; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='storage' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP`,
        `    BEGIN EXECUTE format('ALTER TYPE storage.%I OWNER TO supabase_storage_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT p.oid::regprocedure::text as funcdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'storage' LOOP`,
        `    BEGIN EXECUTE 'ALTER FUNCTION ' || r.funcdef || ' OWNER TO supabase_storage_admin'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `END $fix$;`,
        `GRANT ALL ON SCHEMA storage TO supabase_storage_admin;`,
        `GRANT USAGE ON SCHEMA storage TO postgres, supabase_admin;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO supabase_storage_admin;`,
        `GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO anon, authenticated, service_role;`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON ROUTINES TO anon, authenticated, service_role;`,
        // ═══ Realtime schema ═══
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='realtime') THEN`,
        `    ALTER SCHEMA realtime OWNER TO supabase_realtime_admin;`,
        `    FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='realtime' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `      BEGIN`,
        `        IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        ELSE EXECUTE format('ALTER TABLE realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        END IF;`,
        `      EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `    END LOOP;`,
        `    FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='realtime' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP`,
        `      BEGIN EXECUTE format('ALTER TYPE realtime.%I OWNER TO supabase_realtime_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `    END LOOP;`,
        `  END IF;`,
        `END $fix$;`,
        `GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;`,
        `GRANT USAGE ON SCHEMA realtime TO postgres, supabase_admin;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA realtime TO supabase_realtime_admin;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA realtime TO supabase_realtime_admin;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA realtime TO supabase_realtime_admin;`,
        // ═══ Extensions schema ═══
        `DO $fix$ BEGIN`,
        `  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='extensions') THEN`,
        `    ALTER SCHEMA extensions OWNER TO supabase_admin;`,
        `    GRANT ALL ON SCHEMA extensions TO supabase_admin, postgres;`,
        `    GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;`,
        `  END IF;`,
        `END $fix$;`,
        // ═══ Supabase Functions schema ═══
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_functions_admin')`,
        `     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_functions') THEN`,
        `    ALTER SCHEMA supabase_functions OWNER TO supabase_functions_admin;`,
        `    FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='supabase_functions' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `      BEGIN`,
        `        IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        ELSE EXECUTE format('ALTER TABLE supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        END IF;`,
        `      EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `    END LOOP;`,
        `    GRANT ALL ON SCHEMA supabase_functions TO supabase_functions_admin;`,
        `  END IF;`,
        `END $fix$;`,
        // ═══ Public schema grants ═══
        `GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;`,
      ].join('\n');
      const permFixB64 = Buffer.from(permFixSql).toString('base64');

      const permFixCode = await sshExecStream(targetHost, targetPass,
        `echo '${permFixB64}' | base64 -d > /tmp/fix_perms.sql && ${superPsqlStdin} < /tmp/fix_perms.sql 2>&1 && echo "Schema sahiplikleri düzeltildi ✅"`,
        sessionId
      );
      if (permFixCode !== 0) {
        log('⚠️ İzin düzeltme tamamlanamadı — servisler sorun yaşayabilir. Manuel kontrol edin.', 'warn');
      }

      // ─── Sahiplik Doğrulaması ────────────────────────────────────
      log('🔍 auth.users tablosu sahipliği doğrulanıyor...');
      try {
        const ownerCheck = await sshExec(targetHost, targetPass,
          `${superPsql} -Atc "SELECT tableowner FROM pg_tables WHERE schemaname='auth' AND tablename='users'"`
        );
        const owner = (ownerCheck.output || '').trim().split('\n').pop().trim();
        log(`📋 auth.users sahibi: ${owner}`);
        if (owner !== 'supabase_auth_admin') {
          log('⚠️ auth.users sahibi hâlâ yanlış! Manuel fix deneniyor...', 'warn');
          // Son çare: doğrudan ALTER komutları
          const manualFix = await sshExecStream(targetHost, targetPass,
            `${superPsql} -c "ALTER SCHEMA auth OWNER TO supabase_auth_admin; ALTER SCHEMA storage OWNER TO supabase_storage_admin; ALTER TYPE IF EXISTS auth.factor_type OWNER TO supabase_auth_admin; ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin; ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;" -c "DO \\$\\$fix\\$\\$ DECLARE r RECORD; BEGIN FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND relkind IN ('r','v','m','S','f','p') LOOP BEGIN EXECUTE 'ALTER TABLE auth.' || quote_ident(r.relname) || ' OWNER TO supabase_auth_admin'; EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP; FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND relkind IN ('r','v','m','S','f','p') LOOP BEGIN EXECUTE 'ALTER TABLE storage.' || quote_ident(r.relname) || ' OWNER TO supabase_storage_admin'; EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP; FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='auth' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP BEGIN EXECUTE 'ALTER TYPE auth.' || quote_ident(r.typname) || ' OWNER TO supabase_auth_admin'; EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP; END \\$\\$fix\\$\\$;" && echo "Manuel fix tamamlandı"`,
            sessionId
          );
          // Son durum kontrol
          const recheck = await sshExec(targetHost, targetPass,
            `${superPsql} -Atc "SELECT tableowner FROM pg_tables WHERE schemaname='auth' AND tablename='users'"`
          );
          const newOwner = (recheck.output || '').trim().split('\n').pop().trim();
          log(`📋 Yeni auth.users sahibi: ${newOwner}`);
          if (newOwner !== 'supabase_auth_admin') {
            log('❌ auth.users sahipliği değiştirilemedi! Loglara bakın.', 'error');
          } else {
            log('✅ auth.users sahipliği düzeltildi!', 'success');
          }
        } else {
          log('✅ auth.users sahipliği doğru: supabase_auth_admin');
        }

        const factorTypeOwnerCheck = await sshExec(targetHost, targetPass,
          `${superPsql} -Atc "SELECT COALESCE((SELECT pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='auth' AND t.typname='factor_type' LIMIT 1), 'MISSING')"`
        );
        const factorTypeOwner = (factorTypeOwnerCheck.output || '').trim().split('\n').pop().trim();
        log(`📋 auth.factor_type sahibi: ${factorTypeOwner}`);
        if (factorTypeOwner !== 'MISSING' && factorTypeOwner !== 'supabase_auth_admin') {
          log('⚠️ auth.factor_type sahibi yanlış, düzeltiliyor...', 'warn');
          const factorFixCode = await sshExecStream(targetHost, targetPass,
            `${superPsql} -v ON_ERROR_STOP=1 -c "ALTER TYPE auth.factor_type OWNER TO supabase_auth_admin;"`,
            sessionId
          );
          if (factorFixCode !== 0) {
            throw new Error(`auth.factor_type sahipliği düzeltilemedi (exit: ${factorFixCode})`);
          }
          const factorRecheck = await sshExec(targetHost, targetPass,
            `${superPsql} -Atc "SELECT pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='auth' AND t.typname='factor_type' LIMIT 1"`
          );
          const factorOwnerAfter = (factorRecheck.output || '').trim().split('\n').pop().trim();
          if (factorOwnerAfter !== 'supabase_auth_admin') {
            throw new Error(`auth.factor_type sahibi beklenen role çekilemedi (mevcut: ${factorOwnerAfter || 'unknown'})`);
          }
          log('✅ auth.factor_type sahipliği düzeltildi');
        }
      } catch (e) {
        throw new Error(`Sahiplik doğrulama başarısız: ${e.message}`);
      }

      } // ── skipToServices: ağır blok (yedek/aktarım/restore) sonu ──

      // Restore tamamlandı; bir sonraki resume için checkpoint yaz (servisler henüz başlamadı).
      try {
        await sshExec(targetHost, targetPass, `mkdir -p ${tgtDir} && printf 'restore_done\n' > ${tgtDir}/.baseup_checkpoint`);
      } catch (cpWriteErr) {
        log(`⚠️ Checkpoint yazılamadı (non-kritik): ${cpWriteErr.message}`, 'warn');
      }

      // ADIM 6: Tüm servisler ─── OPSİYONEL (DB zaten ayakta)
      setStage('starting_services');
      step('ADIM 6/6 — Tüm servisler başlatılıyor');
      try {
        const upCode = await sshExecStream(targetHost, targetPass,
          `cd ${tgtDir}/docker &&
		           if [ -f docker-compose.yml ]; then
		             sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/kong:#image: kong:#g" docker-compose.yml &&
		             sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/imgproxy:#image: darthsim/imgproxy:#g" docker-compose.yml &&
		             sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/postgrest:#image: postgrest/postgrest:#g" docker-compose.yml &&
		             sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/vector:#image: timberio/vector:#g" docker-compose.yml &&
		             sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/#image: supabase/#g" docker-compose.yml;
		           fi &&
		           docker compose up -d --quiet-pull &&
	           sleep 10 &&
	           docker ps --format "table {{.Names}}\t{{.Status}}"`,
          sessionId
        );
        if (upCode !== 0) throw new Error(`docker compose up -d başarısız (exit: ${upCode})`);
      } catch (e) {
        if (continueOnMinorErrors && isTransientSshError(e)) {
          log(`⚠️ docker compose sırasında SSH bağlantısı koptu: ${formatSshError(e)}`, 'warn');
          log('🔄 Servisler arka planda kalkmış olabilir; tekrar bağlanıp durum doğrulanıyor...', 'warn');
          await delay(15000);
          try {
            const recoveryProbe = await sshExec(targetHost, targetPass,
              `docker ps -a --format '{{.Names}}|{{.Status}}' | grep -E '^(supabase-${targetInstance}-db|supabase-${targetInstance}-kong|supabase-${targetInstance}-rest|supabase-${targetInstance}-auth|supabase-${targetInstance}-studio|supabase-${targetInstance}-storage|.*supabase-realtime)\\|' || true`
            );
            const recoveredRows = parseServiceStatusRows(recoveryProbe.output || '');
            if (recoveredRows.length > 0) {
              log(`✅ SSH koptu ama ${recoveredRows.length} servis kaydı görüldü; sağlık kontrolüyle devam ediliyor`, 'warn');
            } else {
              throw new Error('compose sonrası hiçbir Supabase servisi tespit edilemedi');
            }
          } catch (recoveryErr) {
            throw new Error(`Docker compose toparlama doğrulaması başarısız: ${recoveryErr.message}`);
          }
        } else {
        throw new Error(`Docker compose hatası: ${e.message}`);
        }
      }

      // Auth/Realtime migration ledger'larını çalışan image'lara göre hizala
      step('ADIM 6.1/6 — Auth ve Realtime migration ledger senkronizasyonu');
      const migrationLedgerSyncCode = await sshExecStream(targetHost, targetPass,
        `cd ${tgtDir}/docker &&
         AUTH_ID=$(docker compose ps -q auth 2>/dev/null || true) &&
         if [ -n "$AUTH_ID" ]; then
           AUTH_VERS=$(docker exec "$AUTH_ID" sh -lc "ls -1 /usr/local/etc/auth/migrations 2>/dev/null" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
           if [ -z "$AUTH_VERS" ]; then
             AUTH_IMG=$(docker inspect -f '{{.Config.Image}}' "$AUTH_ID" 2>/dev/null || true);
             if [ -z "$AUTH_IMG" ]; then AUTH_IMG="supabase/gotrue:v2.184.0"; fi;
             AUTH_VERS=$(docker run --rm --entrypoint sh "$AUTH_IMG" -lc "ls -1 /usr/local/etc/auth/migrations 2>/dev/null" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
           fi;
           if [ -n "$AUTH_VERS" ]; then
             for v in $AUTH_VERS; do
               docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "INSERT INTO auth.schema_migrations(version) VALUES (\${v}) ON CONFLICT (version) DO NOTHING;" >/dev/null;
             done;
             echo "Auth schema_migrations senkronize edildi";
           else
             echo "Auth migration listesi okunamadı veya boş (atlanıyor)";
           fi
         else
           echo "auth container bulunamadı (auth sync atlandı)";
         fi &&
         RT_ID=$(docker compose ps -q realtime 2>/dev/null || true) &&
         if [ -n "$RT_ID" ]; then
           RT_BOOT_VERS=$(docker exec "$RT_ID" sh -lc "ls -1 /app/lib/realtime-*/priv/repo/migrations 2>/dev/null" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
           if [ -z "$RT_BOOT_VERS" ]; then
             RT_IMG=$(docker inspect -f '{{.Config.Image}}' "$RT_ID" 2>/dev/null || true);
             if [ -z "$RT_IMG" ]; then RT_IMG="supabase/realtime:v2.68.0"; fi;
             RT_BOOT_VERS=$(docker run --rm --entrypoint sh "$RT_IMG" -lc "ls -1 /app/lib/realtime-*/priv/repo/migrations 2>/dev/null" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
           fi;
           if [ -n "$RT_BOOT_VERS" ]; then
             RT_BOOT_CSV=$(printf '%s\n' "$RT_BOOT_VERS" | paste -sd, -);
             docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "DO \\$\\$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='_realtime') THEN CREATE TABLE IF NOT EXISTS _realtime.schema_migrations (version bigint PRIMARY KEY, inserted_at timestamp(0) without time zone); INSERT INTO _realtime.schema_migrations(version) SELECT v::bigint FROM regexp_split_to_table('$RT_BOOT_CSV', ',') v ON CONFLICT (version) DO NOTHING; END IF; END \\$\\$;";
             echo "_Realtime schema_migrations senkronize edildi";
           else
             echo "_Realtime migration listesi okunamadı veya boş (atlanıyor)";
           fi;
           RT_VERS=$(docker exec "$RT_ID" /app/bin/realtime eval 'Realtime.Tenants.Migrations.migrations() |> Enum.map(fn {v, _} -> v end) |> Enum.each(&IO.puts/1)' 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
           if [ -z "$RT_VERS" ]; then
             RT_VERS=$(docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -Atc "SELECT version FROM realtime.schema_migrations ORDER BY 1" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
           fi;
           if [ -n "$RT_VERS" ]; then
             RT_CSV=$(printf '%s\n' "$RT_VERS" | paste -sd, -);
             docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "DO \\$\\$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='realtime') THEN CREATE TABLE IF NOT EXISTS realtime.schema_migrations (version bigint PRIMARY KEY, inserted_at timestamp(0) without time zone); INSERT INTO realtime.schema_migrations(version) SELECT v::bigint FROM regexp_split_to_table('$RT_CSV', ',') v ON CONFLICT (version) DO NOTHING; END IF; END \\$\\$;";
             echo "Realtime schema_migrations senkronize edildi";
           else
             echo "Realtime migration listesi okunamadı veya boş (atlanıyor)";
           fi
         else
           echo "realtime container bulunamadı (realtime sync atlandı)";
         fi &&
         docker compose restart auth realtime &&
         sleep 12 &&
         docker compose ps auth realtime`,
        sessionId
      );
      if (migrationLedgerSyncCode !== 0) {
        throw new Error(`Auth/Realtime migration ledger senkronizasyonu başarısız (exit: ${migrationLedgerSyncCode})`);
      }

      // Kritik servisler gerçekten ayakta mı? (restart loop / unhealthy kontrolü)
      setStage('verifying');
      const criticalServices = [
        `supabase-${targetInstance}-db`,
        `supabase-${targetInstance}-kong`,
        `supabase-${targetInstance}-rest`,
        `supabase-${targetInstance}-auth`,
        `supabase-${targetInstance}-studio`,
        `supabase-${targetInstance}-storage`
      ];
      let lastStatusRows = [];
      let attemptedAuthTypeOwnerFix = false;
      let attemptedAuthOauthClientsFix = false;
      let attemptedAuthNonceConstraintFix = false;
      const attemptedAuthDuplicateMigrationFixes = new Set();
      let attemptedRealtimeBootLedgerFix = false;
      const attemptedRealtimeBootMigrationFixes = new Set();
      let attemptedRealtimeTenantLedgerFix = false;
      const attemptedRealtimeTenantMigrationFixes = new Set();
      let attemptedStorageImagePinFix = false;
      const estimateUpSeconds = (status) => {
        if (!status) return null;
        const s = String(status);
        let m = s.match(/Up (\d+) seconds?/i);
        if (m) return parseInt(m[1], 10);
        m = s.match(/Up (\d+) minutes?/i);
        if (m) return parseInt(m[1], 10) * 60;
        m = s.match(/Up (\d+) hours?/i);
        if (m) return parseInt(m[1], 10) * 3600;
        if (/Up About a minute/i.test(s)) return 60;
        if (/Up Less than a second/i.test(s)) return 1;
        return null;
      };
      for (let attempt = 1; attempt <= 15; attempt++) {
        const statusProbe = await sshExec(targetHost, targetPass,
          `docker ps -a --format '{{.Names}}|{{.Status}}' | grep -E '^(supabase-${targetInstance}-db|supabase-${targetInstance}-kong|supabase-${targetInstance}-rest|supabase-${targetInstance}-auth|supabase-${targetInstance}-studio|supabase-${targetInstance}-storage|.*supabase-realtime)\\|' || true;
           echo '---RC---';
           for n in $(docker ps -a --format '{{.Names}}' | grep -E '^(supabase-${targetInstance}-db|supabase-${targetInstance}-kong|supabase-${targetInstance}-rest|supabase-${targetInstance}-auth|supabase-${targetInstance}-studio|supabase-${targetInstance}-storage|.*supabase-realtime)'); do
             echo "RC:$n=$(docker inspect -f '{{.RestartCount}}' "$n" 2>/dev/null || echo 0)";
           done`
        );
        const probeRaw = statusProbe.output || '';
        lastStatusRows = parseServiceStatusRows(probeRaw.split('---RC---')[0]);
        const restartCounts = new Map();
        for (const rcMatch of probeRaw.matchAll(/^RC:(.+?)=(\d+)$/gm)) {
          restartCounts.set((rcMatch[1] || '').trim(), parseInt(rcMatch[2], 10) || 0);
        }

        const byName = new Map(lastStatusRows.map(r => [r.name, r.status]));
        const missing = criticalServices.filter(s => !byName.has(s));
        const realtimeRows = lastStatusRows.filter(r => /supabase-realtime/i.test(r.name));
        const missingRealtime = realtimeRows.length === 0;
        const bad = lastStatusRows.filter(r => /Restarting|Exited|Dead/i.test(r.status) || /\(unhealthy\)/i.test(r.status));
        // Crash-loop tespiti: "Up Xs (health: starting)" görünüp bad'e düşmeyen ama sürekli
        // yeniden başlayan (RestartCount yüksek) container'ları da bad say — yoksa 15 deneme boşa beklenir.
        for (const r of lastStatusRows) {
          const rc = restartCounts.get(r.name) || 0;
          if (rc >= 3 && !/\(healthy\)/i.test(r.status) && !bad.some(b => b.name === r.name)) {
            bad.push(r);
            log(`🔁 ${r.name} crash-loop tespit edildi (RestartCount=${rc})`, 'warn');
          }
        }
        const pending = lastStatusRows.filter(r => /\(health: starting\)/i.test(r.status));

        log(`🩺 Servis sağlık kontrolü ${attempt}/15`);
        lastStatusRows.forEach(r => { const rc = restartCounts.get(r.name) || 0; log(`   • ${r.name}: ${r.status}${rc > 0 ? ` [restarts: ${rc}]` : ''}`); });
        if (missing.length) log(`⚠️ Eksik servis(ler): ${missing.join(', ')}`, 'warn');
        if (missingRealtime) log('⚠️ realtime container bulunamadı', 'warn');

        if (bad.length) {
          const realtimeOnlyUnhealthy = bad.every(svc => /supabase-realtime/i.test(svc.name) && /\(unhealthy\)/i.test(svc.status || ''));
          if (realtimeOnlyUnhealthy) {
            const realtimeSvc = bad.find(svc => /supabase-realtime/i.test(svc.name));
            const upSecs = estimateUpSeconds(realtimeSvc?.status);
            try {
              const rtRecentLogsRaw = await sshExec(targetHost, targetPass, `docker logs --since=70s ${realtimeSvc.name} 2>&1 || true`);
              const rtRecentLogs = rtRecentLogsRaw.output || '';
              const hasCriticalRealtimeErrors = /(MigrationsFailedToRun|duplicate_function|duplicate_table|duplicate_column|SQLSTATE 42P07|SQLSTATE 42723|SQLSTATE 42710|SQLSTATE 42701|\[fatal\])/i.test(rtRecentLogs);
              const hasRealtimeReadySignal = /(Tenant set-up successfully|Migrations already up)/i.test(rtRecentLogs)
                || /HEAD \/api\/tenants\/realtime-dev\/health[\s\S]*Sent 200/i.test(rtRecentLogs);
              if (!hasCriticalRealtimeErrors && (hasRealtimeReadySignal || (upSecs !== null && upSecs < 95)) && attempt < 6) {
                log(`ℹ️ realtime geçici unhealthy görünüyor (uptime≈${upSecs ?? 'unknown'}s), kritik log yok; tekrar kontrol edilecek`, 'warn');
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
              }
            } catch (_) { /* no-op */ }
          }

          const authRow = bad.find(svc => svc.name === `supabase-${targetInstance}-auth`);
          if (authRow) {
            try {
              const authLogsRaw = await sshExec(targetHost, targetPass, `docker logs --tail=160 supabase-${targetInstance}-auth 2>&1 || true`);
              const authLogs = authLogsRaw.output || '';
              if (!attemptedAuthTypeOwnerFix && /must be owner of type/i.test(authLogs)) {
                attemptedAuthTypeOwnerFix = true;
                log('⚠️ auth migration hatası: TYPE owner problemi tespit edildi, otomatik düzeltme deneniyor...', 'warn');
                const ownerFixCode = await sshExecStream(targetHost, targetPass,
                  `cat <<'SQL' | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 >/dev/null
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    ALTER SCHEMA auth OWNER TO supabase_auth_admin;
    FOR r IN
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='auth' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_'
    LOOP
      BEGIN EXECUTE format('ALTER TYPE auth.%I OWNER TO supabase_auth_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  END IF;
END $$;
SQL
                   cd ${tgtDir}/docker &&
                   docker compose restart auth realtime &&
                   sleep 10`,
                  sessionId
                );
                if (ownerFixCode === 0) {
                  log('✅ TYPE owner otomatik düzeltmesi uygulandı, servisler tekrar kontrol ediliyor');
                  continue;
                }
              }

              if (!attemptedAuthOauthClientsFix && /migrations\/20250731150234_add_oauth_clients_table\.up\.sql/i.test(authLogs) && /column "client_id" does not exist/i.test(authLogs)) {
                attemptedAuthOauthClientsFix = true;
                log('⚠️ auth migration hatası: oauth_clients şema drift tespit edildi, otomatik düzeltme deneniyor...', 'warn');
                const oauthClientsFixCode = await sshExecStream(targetHost, targetPass,
                  `cat <<'SQL' | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='auth' AND table_name='oauth_clients'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='oauth_clients' AND column_name='client_id'
  ) THEN
    EXECUTE 'DROP TABLE auth.oauth_clients CASCADE';
  END IF;
END $$;
SQL
                   cd ${tgtDir}/docker &&
                   docker compose restart auth &&
                   sleep 10`,
                  sessionId
                );
                if (oauthClientsFixCode === 0) {
                  log('✅ oauth_clients otomatik düzeltmesi uygulandı, auth tekrar kontrol ediliyor');
                  continue;
                }
              }

              if (!attemptedAuthNonceConstraintFix && /migrations\/20251104100000_add_nonce_to_oauth_authorizations\.up\.sql/i.test(authLogs) && /oauth_authorizations_nonce_length/i.test(authLogs) && /already exists/i.test(authLogs)) {
                attemptedAuthNonceConstraintFix = true;
                log('⚠️ auth migration hatası: nonce constraint zaten var, migration ledger senkronizasyonu deneniyor...', 'warn');
                const nonceFixCode = await sshExecStream(targetHost, targetPass,
                  `cat <<'SQL' | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='auth' AND tablename='schema_migrations')
     AND EXISTS (
       SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname='auth' AND t.relname='oauth_authorizations' AND c.conname='oauth_authorizations_nonce_length'
     ) THEN
    INSERT INTO auth.schema_migrations("version")
    VALUES ('20251104100000')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
SQL
                   cd ${tgtDir}/docker &&
                   docker compose restart auth &&
                   sleep 10`,
                  sessionId
                );
                if (nonceFixCode === 0) {
                  log('✅ nonce constraint migration ledger senkronizasyonu uygulandı, auth tekrar kontrol ediliyor');
                  continue;
                }
              }

              const duplicateMigrationMatch = authLogs.match(/migrations\/([0-9]{14})_[^/\s]+\.up\.sql[\s\S]*?(already exists|duplicate_object|duplicate_table|duplicate_column|SQLSTATE 42710|SQLSTATE 42P07|SQLSTATE 42701)/i);
              if (duplicateMigrationMatch) {
                const migrationVersion = duplicateMigrationMatch[1];
                if (migrationVersion && !attemptedAuthDuplicateMigrationFixes.has(migrationVersion)) {
                  attemptedAuthDuplicateMigrationFixes.add(migrationVersion);
                  log(`⚠️ auth migration duplicate-object hatası tespit edildi (${migrationVersion}), schema_migrations hizalanıyor...`, 'warn');
                  const duplicateFixCode = await sshExecStream(targetHost, targetPass,
                    `cat <<'SQL' | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='auth' AND tablename='schema_migrations') THEN
    INSERT INTO auth.schema_migrations("version")
    VALUES (${migrationVersion})
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
SQL
                     cd ${tgtDir}/docker &&
                     docker compose restart auth &&
                     sleep 10`,
                    sessionId
                  );
                  if (duplicateFixCode === 0) {
                    log(`✅ auth schema_migrations hizalaması tamamlandı (${migrationVersion}), auth tekrar kontrol ediliyor`);
                    continue;
                  }
                }
              }
            } catch (_) { /* no-op */ }
          }

          const realtimeRow = bad.find(svc => /supabase-realtime/i.test(svc.name));
          if (realtimeRow) {
            try {
              const realtimeLogsRaw = await sshExec(targetHost, targetPass, `docker logs --tail=220 ${realtimeRow.name} 2>&1 || true`);
              const realtimeLogs = realtimeLogsRaw.output || '';

              if (!attemptedRealtimeBootLedgerFix
                && /Realtime\.Repo\.Migrations\.CreateTenants/i.test(realtimeLogs)
                && /duplicate_table/i.test(realtimeLogs)
                && /relation "tenants" already exists/i.test(realtimeLogs)) {
                attemptedRealtimeBootLedgerFix = true;
                log('⚠️ realtime migration hatası: tenants duplicate_table tespit edildi, _realtime migration ledger hizalanıyor...', 'warn');
                const realtimeLedgerFixCode = await sshExecStream(targetHost, targetPass,
                  `cd ${tgtDir}/docker &&
                   RT_ID=$(docker compose ps -q realtime 2>/dev/null || true) &&
                   if [ -z "$RT_ID" ]; then
                     echo "realtime container bulunamadı";
                     exit 1;
                   fi &&
                   RT_BOOT_VERS=$(docker exec "$RT_ID" sh -lc "ls -1 /app/lib/realtime-*/priv/repo/migrations 2>/dev/null" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true) &&
                   if [ -z "$RT_BOOT_VERS" ]; then
                     RT_IMG=$(docker inspect -f '{{.Config.Image}}' "$RT_ID" 2>/dev/null || true);
                     if [ -z "$RT_IMG" ]; then RT_IMG="supabase/realtime:v2.68.0"; fi;
                     RT_BOOT_VERS=$(docker run --rm --entrypoint sh "$RT_IMG" -lc "ls -1 /app/lib/realtime-*/priv/repo/migrations 2>/dev/null" 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
                   fi &&
                   if [ -z "$RT_BOOT_VERS" ]; then RT_BOOT_VERS="20210706140551"; fi &&
                   RT_BOOT_CSV=$(printf '%s\\n' "$RT_BOOT_VERS" | paste -sd, -) &&
                   cat <<SQL | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS _realtime;
  CREATE TABLE IF NOT EXISTS _realtime.schema_migrations (
    version bigint PRIMARY KEY,
    inserted_at timestamp(0) without time zone
  );
END $$;
INSERT INTO _realtime.schema_migrations(version)
SELECT v::bigint
FROM regexp_split_to_table('$RT_BOOT_CSV', ',') v
ON CONFLICT (version) DO NOTHING;
SQL
                   docker compose restart realtime &&
                   sleep 12`,
                  sessionId
                );
                if (realtimeLedgerFixCode === 0) {
                  log('✅ realtime _realtime.schema_migrations hizalaması tamamlandı, servis tekrar kontrol ediliyor');
                  continue;
                }
              }

              const realtimeBootDupMatch = realtimeLogs.match(/== Running ([0-9]{14}) Realtime\.Repo\.Migrations\.[\s\S]*?(duplicate_table|duplicate_function|already exists|SQLSTATE 42P07|SQLSTATE 42723|SQLSTATE 42710)/i);
              if (realtimeBootDupMatch) {
                const migrationVersion = realtimeBootDupMatch[1];
                if (migrationVersion && !attemptedRealtimeBootMigrationFixes.has(migrationVersion)) {
                  attemptedRealtimeBootMigrationFixes.add(migrationVersion);
                  log(`⚠️ realtime boot migration duplicate-object hatası tespit edildi (${migrationVersion}), _realtime.schema_migrations hizalanıyor...`, 'warn');
                  const realtimeDuplicateFixCode = await sshExecStream(targetHost, targetPass,
                    `cat <<'SQL' | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS _realtime;
  CREATE TABLE IF NOT EXISTS _realtime.schema_migrations (
    version bigint PRIMARY KEY,
    inserted_at timestamp(0) without time zone
  );
  INSERT INTO _realtime.schema_migrations(version)
  VALUES (${migrationVersion})
  ON CONFLICT DO NOTHING;
END $$;
SQL
                     cd ${tgtDir}/docker &&
                     docker compose restart realtime &&
                     sleep 10`,
                    sessionId
                  );
                  if (realtimeDuplicateFixCode === 0) {
                    log(`✅ realtime _realtime.schema_migrations hizalaması tamamlandı (${migrationVersion}), realtime tekrar kontrol ediliyor`);
                    continue;
                  }
                }
              }

              if (!attemptedRealtimeTenantLedgerFix
                && /MigrationsFailedToRun|Realtime\.Tenants\.Migrations/i.test(realtimeLogs)
                && /(duplicate_table|duplicate_function|duplicate_column|already exists|SQLSTATE 42P07|SQLSTATE 42723|SQLSTATE 42710|SQLSTATE 42701)/i.test(realtimeLogs)) {
                attemptedRealtimeTenantLedgerFix = true;
                log('⚠️ realtime tenant migration duplicate-object hatası tespit edildi, realtime.schema_migrations ledger senkronizasyonu deneniyor...', 'warn');
                const realtimeTenantLedgerFixCode = await sshExecStream(targetHost, targetPass,
                  `cd ${tgtDir}/docker &&
                   RT_ID=$(docker compose ps -q realtime 2>/dev/null || true) &&
                   if [ -z "$RT_ID" ]; then
                     echo "realtime container bulunamadı";
                     exit 1;
                   fi &&
                   RT_VERS=$(docker exec "$RT_ID" /app/bin/realtime eval 'Realtime.Tenants.Migrations.migrations() |> Enum.map(fn {v, _} -> v end) |> Enum.each(&IO.puts/1)' 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true) &&
                   if [ -z "$RT_VERS" ]; then
                     echo "Realtime tenant migration listesi okunamadı";
                     exit 1;
                   fi &&
                   RT_CSV=$(printf '%s\\n' "$RT_VERS" | paste -sd, -) &&
                   cat <<SQL | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.schema_migrations (
  version bigint PRIMARY KEY,
  inserted_at timestamp(0) without time zone
);
INSERT INTO realtime.schema_migrations(version)
SELECT v::bigint
FROM regexp_split_to_table('$RT_CSV', ',') v
ON CONFLICT (version) DO NOTHING;
SQL
                   docker compose restart realtime &&
                   sleep 12`,
                  sessionId
                );
                if (realtimeTenantLedgerFixCode === 0) {
                  log('✅ realtime.schema_migrations ledger senkronizasyonu tamamlandı, realtime tekrar kontrol ediliyor');
                  continue;
                }
              }

              const realtimeTenantDupMatch = realtimeLogs.match(/== Running ([0-9]{14}) Realtime\.Tenants\.Migrations\.[\s\S]*?(duplicate_table|duplicate_function|duplicate_column|already exists|SQLSTATE 42P07|SQLSTATE 42723|SQLSTATE 42710|SQLSTATE 42701)/i);
              if (realtimeTenantDupMatch) {
                const migrationVersion = realtimeTenantDupMatch[1];
                if (migrationVersion && !attemptedRealtimeTenantMigrationFixes.has(migrationVersion)) {
                  attemptedRealtimeTenantMigrationFixes.add(migrationVersion);
                  log(`⚠️ realtime tenant migration duplicate-object hatası tespit edildi (${migrationVersion}), realtime.schema_migrations hizalanıyor...`, 'warn');
                  const realtimeTenantVersionFixCode = await sshExecStream(targetHost, targetPass,
                    `cat <<'SQL' | docker exec -i supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS realtime;
  CREATE TABLE IF NOT EXISTS realtime.schema_migrations (
    version bigint PRIMARY KEY,
    inserted_at timestamp(0) without time zone
  );
  INSERT INTO realtime.schema_migrations(version)
  VALUES (${migrationVersion})
  ON CONFLICT DO NOTHING;
END $$;
SQL
                     cd ${tgtDir}/docker &&
                     docker compose restart realtime &&
                     sleep 10`,
                    sessionId
                  );
                  if (realtimeTenantVersionFixCode === 0) {
                    log(`✅ realtime.schema_migrations hizalaması tamamlandı (${migrationVersion}), realtime tekrar kontrol ediliyor`);
                    continue;
                  }
                }
              }
            } catch (_) { /* no-op */ }
          }

          // ─── Storage migration self-heal: kaynak storage sürümüne sabitle ───
          const storageRow = bad.find(svc => svc.name === `supabase-${targetInstance}-storage`);
          if (storageRow && !attemptedStorageImagePinFix) {
            try {
              const storageLogsRaw = await sshExec(targetHost, targetPass, `docker logs --tail=120 supabase-${targetInstance}-storage 2>&1 || true`);
              const storageLogs = storageLogsRaw.output || '';
              const hasStorageMigrationConflict = /Migration failed|migrations_name_key|duplicate key value violates unique constraint|has a different hash|different hash/i.test(storageLogs);
              if (hasStorageMigrationConflict) {
                attemptedStorageImagePinFix = true;
                const pinImg = normalizeSourceImage(sourceStorageImage || sourceServiceImages.storage || '');
                if (pinImg) {
                  log(`⚠️ storage migration uyuşmazlığı tespit edildi — kaynak storage sürümüne (${pinImg}) sabitlenip yeniden oluşturuluyor...`, 'warn');
                  const mergedImages = { ...sourceServiceImages };
                  mergedImages.storage = sourceStorageImage || sourceServiceImages.storage;
                  const healPinEntries = Object.entries(mergedImages)
                    .filter(([svc, img]) => PIN_ALLOWED_SERVICES.has(svc) && img)
                    .map(([svc, img]) => [svc, normalizeSourceImage(img)]);
                  const healOverrideYaml = 'services:\n' + healPinEntries.map(([svc, img]) => `  ${svc}:\n    image: ${img}\n`).join('');
                  const healOverrideB64 = Buffer.from(healOverrideYaml, 'utf8').toString('base64');
                  const storageHealCode = await sshExecStream(targetHost, targetPass,
                    `cd ${tgtDir}/docker &&
                     echo '${healOverrideB64}' | base64 -d > docker-compose.override.yml &&
                     docker compose up -d --quiet-pull --force-recreate --no-deps storage &&
                     sleep 12 &&
                     docker compose ps storage`,
                    sessionId
                  );
                  if (storageHealCode === 0) {
                    log('✅ storage kaynak sürümüne sabitlendi ve yeniden oluşturuldu, tekrar kontrol ediliyor');
                    continue;
                  }
                  log('⚠️ storage sürüm sabitleme denemesi başarısız oldu', 'warn');
                } else {
                  log('❌ storage migration uyuşmazlığı var ama kaynak storage sürümü tespit edilemedi — otomatik sabitlenemiyor. Kaynakta `docker inspect supabase-storage --format "{{.Config.Image}}"` çalıştırıp çıkan sürümü hedefte docker-compose.override.yml ile storage image olarak sabitleyin.', 'warn');
                }
              }
            } catch (_) { /* no-op */ }
          }

          for (const svc of bad.slice(0, 3)) {
            try {
              const svcLogs = await sshExec(targetHost, targetPass, `docker logs --tail=80 ${svc.name} 2>&1 || true`);
              const tailLines = (svcLogs.output || '').trim().split('\n').filter(Boolean).slice(-12);
              tailLines.forEach(line => log(`[${svc.name}] ${line}`, 'warn'));
            } catch (_) { /* no-op */ }
          }
          throw new Error(`Kritik servis restart/unhealthy durumda: ${bad.map(b => `${b.name} (${b.status})`).join(', ')}`);
        }

        if (!missing.length && !missingRealtime && !pending.length) {
          log('✅ Kritik servisler ayakta görünüyor');
          break;
        }

        if (attempt === 15) {
          throw new Error(`Kritik servisler hazır duruma gelemedi. Son durum: ${lastStatusRows.map(r => `${r.name}=${r.status}`).join(' | ')}`);
        }

        await new Promise(resolve => setTimeout(resolve, 10000));
      }

      // ─── ADIM 6.2: Realtime tenant migration ledger reconciliation ───
      // Tenant migration listesi yalnızca realtime tam ayağa kalkınca `realtime eval` ile okunabiliyor;
      // ADIM 6.1'de erken çağrıldığı için boş dönüp atlanabiliyor. Restore edilen DB'de `realtime` şeması
      // dolu ama `realtime.schema_migrations` ledger'ı eksik olduğunda realtime tenant migration'larını
      // yeniden çalıştırıp duplicate_object (ör. trigger "tr_check_filters" already exists) hatası verir.
      // Döngü sonrası (realtime ayaktayken) ledger'ı image'ın migration listesiyle dolduruyoruz.
      try {
        const realtimeTenantReconcileCode = await sshExecStream(targetHost, targetPass,
          `cd ${tgtDir}/docker &&
           RT_ID=$(docker compose ps -q realtime | head -n 1) &&
           if [ -z "\${RT_ID}" ]; then echo "realtime container yok (tenant ledger reconciliation atlanıyor)"; exit 0; fi;
           RT_VERS="";
           for i in 1 2 3 4 5 6; do
             RT_VERS=$(docker exec "\${RT_ID}" /app/bin/realtime eval 'Realtime.Tenants.Migrations.migrations() |> Enum.map(fn {v, _} -> v end) |> Enum.each(&IO.puts/1)' 2>/dev/null | grep -Eo '^[0-9]{14}' | sort -u || true);
             if [ -n "\${RT_VERS}" ]; then break; fi;
             echo "Realtime tenant migration listesi henüz okunamadı (deneme \${i}/6), bekleniyor...";
             sleep 5;
           done;
           if [ -z "\${RT_VERS}" ]; then echo "⚠️ Realtime tenant migration listesi alınamadı — ledger reconciliation atlanıyor"; exit 0; fi;
           RT_CSV=$(printf '%s\\n' "\${RT_VERS}" | paste -sd, -);
           docker exec supabase-${targetInstance}-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS realtime.schema_migrations (version bigint PRIMARY KEY, inserted_at timestamp(0) without time zone)" -c "INSERT INTO realtime.schema_migrations(version) SELECT v::bigint FROM regexp_split_to_table('\${RT_CSV}', ',') v ON CONFLICT (version) DO NOTHING" &&
           echo "Realtime tenant ledger senkronize edildi ($(printf '%s\\n' "\${RT_VERS}" | grep -c .) versiyon)" &&
           docker compose restart realtime &&
           sleep 15 &&
           echo "✅ Realtime tenant ledger reconciliation tamamlandı"`,
          sessionId,
          optionalStreamOptions('Realtime tenant ledger reconciliation')
        );
        if (realtimeTenantReconcileCode === 0) {
          log('✅ Realtime tenant migration ledger reconciliation tamamlandı');
        } else {
          log('⚠️ Realtime tenant ledger reconciliation tamamlanamadı — log doğrulaması devreye girecek', 'warn');
        }
      } catch (e) {
        log(`⚠️ Realtime tenant ledger reconciliation hatası (non-kritik): ${e.message}`, 'warn');
      }

      // Realtime migration loop hatalarını ayrıca doğrula
      const realtimeLogCheckCode = await sshExecStream(targetHost, targetPass,
        `cd ${tgtDir}/docker &&
         sleep 8 &&
         RT_ID=$(docker compose ps -q realtime | head -n 1) &&
         [ -n "\${RT_ID}" ] &&
         RT_STATUS=$(docker compose ps realtime --format '{{.Status}}' | head -n 1) &&
         echo "Realtime durumu: \${RT_STATUS}" &&
         echo "\${RT_STATUS}" | grep -Eiq 'up|healthy' &&
         RT_RESTARTS_1=$(docker inspect -f '{{.RestartCount}}' "\${RT_ID}") &&
         RT_STARTED_AT=$(docker inspect -f '{{.State.StartedAt}}' "\${RT_ID}") &&
         RT_UP_SECS=$(( $(date +%s) - $(date -d "\${RT_STARTED_AT}" +%s) )) &&
         if [ "\${RT_UP_SECS}" -lt 90 ]; then
           sleep $((90-\${RT_UP_SECS}));
         else
           sleep 15;
         fi &&
         RT_STATUS_2=$(docker compose ps realtime --format '{{.Status}}' | head -n 1) &&
         echo "Realtime durumu (stabilite): \${RT_STATUS_2}" &&
         echo "\${RT_STATUS_2}" | grep -Eiq 'up|healthy' &&
         RT_RESTARTS_2=$(docker inspect -f '{{.RestartCount}}' "\${RT_ID}") &&
         if [ "\${RT_RESTARTS_2}" != "\${RT_RESTARTS_1}" ]; then
           echo "❌ Realtime restart count arttı (\${RT_RESTARTS_1} -> \${RT_RESTARTS_2})";
           exit 7;
         fi &&
         if docker logs --since=30s "\${RT_ID}" 2>&1 | grep -E 'MigrationsFailedToRun|duplicate_function|duplicate_table|duplicate_column|SQLSTATE 42P07|SQLSTATE 42723|SQLSTATE 42710|SQLSTATE 42701'; then
           echo "❌ Realtime migration hatası devam ediyor";
           exit 7;
         fi &&
         echo "✅ Realtime log kontrolü temiz"`,
        sessionId
      );
      if (realtimeLogCheckCode !== 0) {
        throw new Error(`Realtime log doğrulaması başarısız (exit: ${realtimeLogCheckCode}).`);
      }

      // SSL ─── OPSİYONEL
      if (getSSL) {
        step('SSL Sertifikaları alınıyor');
        const sslEmail = certbotEmail || `admin@${apiDomain.split('.').slice(-2).join('.')}`;
        log(`📧 Let's Encrypt e-postası: ${sslEmail}`);
        try {
          const sslCode = await sshExecStream(targetHost, targetPass,
            `certbot --nginx -d ${studioDomain} -d ${apiDomain} --non-interactive --agree-tos -m ${sslEmail} --redirect 2>&1 && (systemctl reload nginx || systemctl restart nginx) && echo "SSL sertifikaları alındı!"`,
            sessionId,
            optionalStreamOptions('SSL sertifika alma adımı')
          );
          if (sslCode !== 0) {
            log(`⚠️ SSL sertifikası alınamadı (exit: ${sslCode}). DNS henüz yayılmamış olabilir.`, 'warn');
            log('ℹ️ Manuel almak için: certbot --nginx -d ' + studioDomain + ' -d ' + apiDomain, 'warn');
          }
        } catch (sslErr) {
          log(`⚠️ SSL Hatası: ${sslErr.message}`, 'warn');
          log('ℹ️ SSL olmadan devam ediliyor — migration başarıyla tamamlandı.', 'warn');
        }
      }

      // ADIM 7: Yedekleme Aktarımı (rclone + cron) ─── OPSİYONEL
      if (setupBackup) {
        step('ADIM 7/7 — Yedekleme (Google Drive) Aktarılıyor');
        try {
          // 1. Kaynakta rclone config ve backup.sh var mı?
          const bkpCheck = await sshExec(sourceHost, sourcePass, `if [ -f /root/.config/rclone/rclone.conf ] && [ -f /root/supabase/backup.sh ]; then echo "OK"; else echo "MISSING"; fi`);

          if (bkpCheck.output.includes('MISSING')) {
            log('⚠️ Kaynak sunucuda rclone yapılandırması veya backup.sh bulunamadı, yedekleme aktarılamıyor.', 'warn');
          } else {
            // 2. Hedefte rclone kur
            log('📦 Hedef sunucuya rclone kuruluyor...');
            await sshExecStream(targetHost, targetPass, `curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip && unzip -o rclone-current-linux-amd64.zip && cd rclone-*-linux-amd64 && cp rclone /usr/bin/ && chown root:root /usr/bin/rclone && chmod 755 /usr/bin/rclone && mkdir -p /root/.config/rclone`, sessionId);

            // 3. Konfigürasyonları ve scripti taşı
            log('🔐 rclone yapılandırması ve yedek betiği kopyalanıyor...');
            await sshExecStream(sourceHost, sourcePass, `sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /root/.config/rclone/rclone.conf root@${targetHost}:/root/.config/rclone/`, sessionId);
            await sshExecStream(sourceHost, sourcePass, `sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /root/supabase/backup.sh root@${targetHost}:/root/supabase/`, sessionId);

            // 4. IP'ye göre DRIVE_FOLDER değişkenini güncelle ve crontab'a ekle
            log('⏰ Zamanlanmış görev (cronjob) ayarlanıyor...');
            await sshExecStream(targetHost, targetPass, `
              sed -i 's/DRIVE_FOLDER=.*/DRIVE_FOLDER="SupabaseBackups_${targetHost}"/' /root/supabase/backup.sh &&
              chmod +x /root/supabase/backup.sh &&
              if ! crontab -l 2>/dev/null | grep -q "backup.sh"; then
                (crontab -l 2>/dev/null; echo "0 3 * * * /root/supabase/backup.sh >> /var/log/supabase_backup.log 2>&1") | crontab -
              fi && echo "✅ Yedekleme kurulumu tamam (${targetHost} adıyla)"
            `, sessionId);
            log(`☁️ Yedekler artık Drive'da "SupabaseBackups_${targetHost}" klasörüne alınacak.`, 'success');
          }
        } catch (bkpErr) {
          log(`⚠️ Yedekleme kurulum hatası: ${bkpErr.message}`, 'warn');
        }
      }

      // Studio girişi uçtan uca doğrulama: nginx (htpasswd) ve Kong (.env) katmanları
      // farklı şifre beklerse kullanıcı hiçbir şifreyle giremez. Test et, gerekirse eşitle.
      try {
        const dashPassShell = String(env.DASHBOARD_PASSWORD || '').replace(/'/g, "'\\''");
        const verifyCode = await sshExecStream(targetHost, targetPass,
          `code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 20 -u 'admin:${dashPassShell}' "https://localhost/" -H "Host: ${studioDomain}");
           echo "Studio giriş testi: HTTP $code";
           if [ "$code" = "401" ] || [ "$code" = "403" ]; then
             echo "Kimlik katmanları uyumsuz görünüyor; htpasswd hedefteki .env ile eşitleniyor...";
             EFF=$(grep "^DASHBOARD_PASSWORD=" ${tgtDir}/docker/.env 2>/dev/null | tail -n 1 | cut -d= -f2-);
             if [ -n "$EFF" ]; then htpasswd -b /etc/nginx/.htpasswd admin "$EFF" >/dev/null 2>&1 && (systemctl reload nginx >/dev/null 2>&1 || true); fi;
             code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 20 -u "admin:$EFF" "https://localhost/" -H "Host: ${studioDomain}");
             echo "Studio giriş testi (eşitleme sonrası): HTTP $code";
           fi;
           case "$code" in 200|301|302|303|307|308) exit 0;; *) exit 7;; esac`,
          sessionId,
          optionalStreamOptions('Studio giriş doğrulama adımı')
        );
        if (verifyCode === 0) {
          log('🔐 Studio giriş doğrulaması başarılı: admin + aşağıdaki şifre kabul edildi', 'success');
        } else {
          log('⚠️ Studio giriş doğrulaması BAŞARISIZ — aşağıdaki şifre çalışmayabilir. Sunucuda kontrol edin: grep DASHBOARD ' + tgtDir + '/docker/.env', 'warn');
        }
      } catch (verifyErr) {
        log(`⚠️ Studio giriş doğrulaması yapılamadı (non-kritik): ${verifyErr.message}`, 'warn');
      }

      // Başarı: checkpoint'i temizle ki sonraki taşıma yanlışlıkla adım atlamasın.
      try { await sshExec(targetHost, targetPass, `rm -f ${tgtDir}/.baseup_checkpoint`); } catch (cpClrErr) { log(`⚠️ Checkpoint temizlenemedi (non-kritik): ${cpClrErr.message}`, 'warn'); }

      log('\n✅ MİGRATION BAŞARIYLA TAMAMLANDI!', 'success');
      log(`🌐 Studio: https://${studioDomain}`, 'success');
      log(`🔌 API:    https://${apiDomain}`, 'success');
      log(`👤 Dashboard Kullanıcı: admin / ${env.DASHBOARD_PASSWORD}`, 'success');

      // Done sinyali — env + domain bilgilerini gönder
      closeSseSession(sessionId, { type: 'done', env, studioDomain, apiDomain });

    } catch (err) {
      log(`❌ Kritik Hata: ${err.message}`, 'error');
      logMigrationFailureGuidance(log, currentStage, err, targetInstance);
      if (cleanupOnFailure) {
        log('🧹 Otomatik temizlik açık: hedefteki yarım Supabase stack\'i kaldırılıyor...', 'warn');
        try {
          await sshExecStream(targetHost, targetPass,
            `cd ${tgtDir}/docker 2>/dev/null && (docker compose down -v --remove-orphans >/dev/null 2>&1 || true); rm -rf ${tgtDir}/docker/volumes/db/data 2>/dev/null; rm -f ${tgtDir}/.baseup_checkpoint 2>/dev/null; echo "Temizlik tamamlandı"`,
            sessionId,
            { stepLabel: 'Başarısızlık sonrası temizlik' }
          );
          log('🧹 Hedef temizlendi; bir sonraki çalıştırma sıfırdan başlayacak.', 'warn');
        } catch (cleanupErr) {
          log(`⚠️ Temizlik sırasında hata (elle kontrol gerekebilir): ${cleanupErr.message}`, 'warn');
        }
      }
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 5. Sıfırdan Supabase Kurulumu (Clean Install)
app.post('/api/clean-install', async (req, res) => {
  const {
    targetHost, targetPass,
    studioDomain, apiDomain, siteUrl,
    env, sessionId,
    getSSL, certbotEmail, targetInstance
  } = req.body;
  
  const tgtDir = getInstanceDir(targetInstance);

  res.json({ success: true, message: 'Kurulum başlatıldı' });

  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      // ─── Bağlantı ön-testi ────────────────────────────────────────
      log('🔍 Hedef sunucu bağlantısı test ediliyor...');
      try {
        const tgtTest = await sshExec(targetHost, targetPass, 'echo OK');
        if (!tgtTest.output.includes('OK')) throw new Error('SSH yanıt vermedi');
        log('✅ Hedef sunucu bağlantısı tamam');
      } catch (e) {
        throw new Error(`Hedef sunucuya bağlanılamadı: ${e.message}`);
      }

      // ADIM 1: Kurulum
      step('ADIM 1/4 — Hedef sunucuya Docker + Nginx + Supabase kuruluyor');
      const installCode = await sshExecStream(targetHost, targetPass,
        `export DEBIAN_FRONTEND=noninteractive &&
         dpkg --configure -a 2>/dev/null || true &&
         apt-get --fix-broken install -y -qq >/dev/null 2>&1 || true &&
         apt-get update -qq &&
         apt-get install -y -qq git curl nginx certbot python3-certbot-nginx apache2-utils &&
         if ! command -v docker &>/dev/null; then curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker && echo "Docker kuruldu"; else echo "Docker mevcut: $(docker --version)"; fi &&
         mkdir -p ${tgtDir} && cd ${tgtDir} &&
         if [ ! -d docker ]; then rm -rf .git docker */ 2>/dev/null; git clone -q --depth 1 https://github.com/supabase/supabase.git . && echo "Supabase klonlandı"; else echo "Supabase zaten mevcut"; fi &&
         if [ -f ${tgtDir}/docker/docker-compose.yml ]; then
           cp ${tgtDir}/docker/docker-compose.yml ${tgtDir}/docker/docker-compose.yml.bak &&
           sed -i -E "s/container_name:[[:space:]]*supabase-/container_name: supabase-${targetInstance}-/g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/kong:#image: kong:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/imgproxy:#image: darthsim/imgproxy:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/postgrest:#image: postgrest/postgrest:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/vector:#image: timberio/vector:#g" ${tgtDir}/docker/docker-compose.yml &&
           sed -i -E "s#image:[[:space:]]*public[.]ecr[.]aws/supabase/#image: supabase/#g" ${tgtDir}/docker/docker-compose.yml &&
           echo "Compose image normalizasyonu uygulandı";
         fi`,
        sessionId,
        { stepLabel: 'Sunucu kurulumu' }
      );
      if (installCode !== 0) throw new Error(`Hedef sunucu kurulumu başarısız (exit: ${installCode}). İnternet bağlantısı veya disk alanı kontrol edin.`);

      // ADIM 2: .env ve Nginx
      step('ADIM 2/4 — Yapılandırma (.env ve Nginx) yükleniyor');
      const envContent = buildEnvFile(env, studioDomain, apiDomain, siteUrl);
      const nginxContent = buildNginxConf(studioDomain, apiDomain, env.DASHBOARD_PASSWORD || '', targetInstance);
      const escapedEnv = envContent.replace(/'/g, "'\\''");
      const envSecretValidationCommand = buildEnvSecretValidationCommand(`${tgtDir}/docker/.env`);

      const envWriteCode = await sshExecStream(targetHost, targetPass,
        `mkdir -p ${tgtDir}/docker && printf '%s' '${escapedEnv}' > ${tgtDir}/docker/.env && echo ".env yazıldı"`,
        sessionId
      );
      if (envWriteCode !== 0) throw new Error(`.env yazılamadı (exit: ${envWriteCode}). Disk dolu mu?`);
      const envSecretValidationCode = await sshExecStream(targetHost, targetPass, envSecretValidationCommand, sessionId);
      if (envSecretValidationCode !== 0) {
        throw new Error(`.env kritik secret kontrolü başarısız (exit: ${envSecretValidationCode}). POSTGRES_PASSWORD/JWT/SERVICE_ROLE değerleri boş olamaz.`);
      }

      try {
        const escapedNginx = nginxContent.replace(/'/g, "'\\''");
        await sshExecStream(targetHost, targetPass,
          `mkdir -p /etc/nginx/ssl &&
           for d in '${studioDomain}' '${apiDomain}'; do
             [ -z "$d" ] && continue;
             crt="/etc/nginx/ssl/$d.crt";
             key="/etc/nginx/ssl/$d.key";
             if [ ! -s "$crt" ] || [ ! -s "$key" ]; then
               openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -keyout "$key" -out "$crt" -subj "/CN=$d" >/dev/null 2>&1 || true;
             fi;
           done &&
           printf '%s' '${escapedNginx}' > /etc/nginx/sites-available/supabase-${targetInstance} &&
           ln -sf /etc/nginx/sites-available/supabase-${targetInstance} /etc/nginx/sites-enabled/supabase-${targetInstance} &&
           rm -f /etc/nginx/sites-enabled/default &&
           nginx -t &&
           (systemctl reload nginx || systemctl restart nginx) &&
           echo "Nginx yapılandırıldı"`,
          sessionId,
          { stepLabel: 'Nginx yapılandırma', allowContinueOnTransientError: true, continueResult: 0 }
        );
      } catch (e) {
        log(`⚠️ Nginx hatası (non-kritik): ${e.message}`, 'warn');
      }

      try {
        const dashPass = env.DASHBOARD_PASSWORD || 'admin123';
        await sshExecStream(targetHost, targetPass,
          `htpasswd -cb /etc/nginx/.htpasswd admin '${dashPass}' && echo "htpasswd oluşturuldu"`,
          sessionId,
          { stepLabel: 'htpasswd oluşturma', allowContinueOnTransientError: true, continueResult: 0 }
        );
      } catch (e) {
        log(`⚠️ htpasswd hatası (non-kritik): ${e.message}`, 'warn');
      }

      // ADIM 3: Supabase Başlat
      step('ADIM 3/4 — Supabase servisleri başlatılıyor');
      const startCode = await sshExecStream(targetHost, targetPass,
        `cd ${tgtDir}/docker &&
         docker compose pull -q &&
         docker compose up -d --quiet-pull`,
        sessionId
      );
      if (startCode !== 0) throw new Error(`Supabase başlatılamadı (exit: ${startCode}).`);

      // ADIM 4: SSL Opsiyonel
      step('ADIM 4/4 — SSL İşlemleri');
      if (getSSL) {
        const sslEmail = certbotEmail || `admin@${apiDomain.split('.').slice(-2).join('.')}`;
        log(`📧 Let's Encrypt e-postası: ${sslEmail}`);
        try {
          const sslCode = await sshExecStream(targetHost, targetPass,
            `certbot --nginx -d ${studioDomain} -d ${apiDomain} --non-interactive --agree-tos -m ${sslEmail} --redirect 2>&1 && (systemctl reload nginx || systemctl restart nginx) && echo "SSL sertifikaları alındı!"`,
            sessionId,
            { stepLabel: 'SSL sertifika alma' }
          );
          if (sslCode !== 0) {
            log(`⚠️ SSL sertifikası alınamadı (exit: ${sslCode}). DNS henüz yayılmamış olabilir.`, 'warn');
          }
        } catch (sslErr) {
          log(`⚠️ SSL Hatası: ${sslErr.message}`, 'warn');
        }
      } else {
        log('ℹ️ SSL atlandı.', 'warn');
      }

      log('\n✅ SIFIRDAN KURULUM BAŞARIYLA TAMAMLANDI!', 'success');
      log(`🌐 Studio: https://${studioDomain}`, 'success');
      log(`🔌 API:    https://${apiDomain}`, 'success');
      log(`👤 Dashboard Kullanıcı: admin / ${env.DASHBOARD_PASSWORD}`, 'success');

      closeSseSession(sessionId, { type: 'done', env, studioDomain, apiDomain });

    } catch (err) {
      log(`❌ Kritik Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// ─── CLOUD'DAN SELF-HOST'A TAŞIMA API (Migrate from Cloud) ─────
app.post('/api/migrate-from-cloud', (req, res) => {
  const {
    cloudUrl,
    targetHost,
    targetPass,
    apiDomain,
    studioDomain,
    getSSL,
    certbotEmail,
    env,
    skipInstall,
    sessionId: reqSessionId,
    migrateStorage,
    cloudApiUrl,
    cloudServiceKey,
    schemaOnly: requestedSchemaOnly,
    skipData,
    targetInstance
  } = req.body;

  const schemaOnly = Boolean(requestedSchemaOnly || skipData);
  const tgtDir = getInstanceDir(targetInstance);

  if (!cloudUrl || !targetHost || !targetPass) {
    return res.status(400).json({ error: 'Eksik parametre!' });
  }
  if (!skipInstall && (!apiDomain || !studioDomain || !env)) {
    return res.status(400).json({ error: 'Eksik parametre (Domain veya Env)!' });
  }
  if (!schemaOnly && migrateStorage && (!cloudApiUrl || !cloudServiceKey)) {
    return res.status(400).json({ error: 'Storage taşıma için Cloud API URL ve Service Role Key gereklidir!' });
  }

  const sessionId = reqSessionId || Date.now().toString();
  res.json({ sessionId });

  (async () => {
    const log = (msg, level = 'info') => {
      writeSse(sessionId, { type: 'log', level, msg });
      console.log(`[CLOUD MIGRATE ${sessionId}] ${msg}`);
    };
    const step = (msg) => {
      writeSse(sessionId, { type: 'step', msg });
      console.log(`\n▶ [CLOUD MIGRATE] ${msg}`);
    };

    try {
      if (!skipInstall) {
        step('Adım 1: Hedef sunucu hazırlanıyor (Docker, Supabase Repo)');
        log('Sunucuya bağlanılıyor ve paketler kuruluyor...');

        const prepCode = await sshExecStream(targetHost, targetPass,
          `export DEBIAN_FRONTEND=noninteractive && \
apt-get update -y && \
apt-get install -y docker.io docker-compose-v2 git nginx certbot python3-certbot-nginx apache2-utils && \
rm -rf ${tgtDir} && \
git clone --depth 1 https://github.com/supabase/supabase ${tgtDir}`,
          sessionId,
          { stepLabel: 'Hedef Sunucu Hazırlığı' }
        );
        if (prepCode !== 0) throw new Error(`Hazırlık başarısız (exit: ${prepCode})`);

        step('Adım 2: Çevre Değişkenleri ve Nginx ayarlanıyor');
        const siteUrl = `https://${apiDomain}`;
        const envContent = buildEnvFile(env, studioDomain, apiDomain, siteUrl);
        const envB64 = Buffer.from(envContent).toString('base64');

        const setEnvCode = await sshExecStream(targetHost, targetPass,
          `echo '${envB64}' | base64 -d > ${tgtDir}/docker/.env`,
          sessionId
        );
        if (setEnvCode !== 0) throw new Error('Hedef .env yazılamadı!');

        const nginxContent = buildNginxConf(studioDomain, apiDomain, env.DASHBOARD_PASSWORD, targetInstance);
        const nginxB64 = Buffer.from(nginxContent).toString('base64');

        const dashPassEncoded = env.DASHBOARD_PASSWORD.replace(/'/g, "'\\''");
        const nginxCode = await sshExecStream(targetHost, targetPass,
          `mkdir -p /etc/nginx/ssl && \
for d in '${studioDomain}' '${apiDomain}'; do \
  [ -z "$d" ] && continue; \
  crt="/etc/nginx/ssl/$d.crt"; \
  key="/etc/nginx/ssl/$d.key"; \
  if [ ! -s "$crt" ] || [ ! -s "$key" ]; then \
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -keyout "$key" -out "$crt" -subj "/CN=$d" >/dev/null 2>&1 || true; \
  fi; \
done && \
echo '${nginxB64}' | base64 -d > /etc/nginx/sites-available/supabase-${targetInstance} && \
ln -sf /etc/nginx/sites-available/supabase-${targetInstance} /etc/nginx/sites-enabled/supabase-${targetInstance} && \
rm -f /etc/nginx/sites-enabled/default && \
htpasswd -b -c /etc/nginx/.htpasswd admin '${dashPassEncoded}' && \
systemctl restart nginx`,
          sessionId
        );
        if (nginxCode !== 0) throw new Error('Nginx ayarı başarısız!');

        step('Adım 3: Hedef veritabanı başlatılıyor (Supabase DB)');
        const startDbCode = await sshExecStream(targetHost, targetPass,
          `cd ${tgtDir}/docker && \
cp docker-compose.yml docker-compose.yml.bak && \
sed -i 's|public.ecr.aws/supabase/postgres:|supabase/postgres:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/realtime:|supabase/realtime:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/gotrue:|supabase/gotrue:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/storage-api:|supabase/storage-api:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/postgrest:|postgrest/postgrest:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/studio:|supabase/studio:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/edge-runtime:|supabase/edge-runtime:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/logflare:|supabase/logflare:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/supavisor:|supabase/supavisor:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/vector:|timberio/vector:|g' docker-compose.yml && \
sed -i 's|public.ecr.aws/supabase/pgbouncer:|supabase/pgbouncer:|g' docker-compose.yml && \
docker compose pull -q db && docker compose up -d --quiet-pull db && \
echo "DB başlatılıyor (ilk init birkaç dakika sürebilir)..." && \
db_ready=0 && \
stable=0 && \
for i in $(seq 1 120); do \
  if docker exec supabase-${targetInstance}-db pg_isready -U postgres >/dev/null 2>&1 && docker exec supabase-${targetInstance}-db psql -U postgres -d postgres -Atc "select 1" >/dev/null 2>&1; then \
    if docker logs supabase-${targetInstance}-db 2>&1 | grep -Eq "PostgreSQL init process complete|Skipping initialization"; then db_ready=1; break; fi; \
    stable=$((stable+1)); \
    if [ $stable -ge 12 ]; then db_ready=1; break; fi; \
  else \
    stable=0; \
  fi; \
  sleep 3; \
done && \
if [ "$db_ready" -ne 1 ]; then echo "❌ DB 360 saniye içinde hazır olmadı. Container logları:"; docker logs --tail 50 supabase-${targetInstance}-db 2>&1; exit 9; fi && \
echo "DB hazır ✅"`,
          sessionId
        );
        if (startDbCode !== 0) throw new Error('Hedef db başlatılamadı!');
      } else {
        step('Adım 1-3 Atlandı: Hedef veritabanı kontrol ediliyor...');
        const checkDbCode = await sshExecStream(targetHost, targetPass,
          `docker exec supabase-${targetInstance}-db pg_isready -U postgres`,
          sessionId,
          { stepLabel: 'Veritabanı Durum Kontrolü' }
        );
        if (checkDbCode !== 0) throw new Error('Kurulum atlandı ancak hedef sunucuda `supabase-${targetInstance}-db` konteyneri bulunamadı veya çalışmıyor!');
      }

      step(schemaOnly
        ? 'Adım 4: Supabase Cloud şeması çekiliyor (PostgreSQL 17 Client ile)'
        : 'Adım 4: Supabase Cloud\'dan veri çekiliyor (PostgreSQL 17 Client İle)'
      );
      log(schemaOnly ? '📐 Sadece şema kopyalanacak — veriler aktarılmayacak' : '📦 Tüm veriler dahil kopyalanıyor', 'warn');
      const cloudDumpMode = schemaOnly ? '--schema-only' : '--inserts';
      const dumpCode = await sshExecStream(targetHost, targetPass,
        `docker run --rm -i postgres:17-alpine pg_dump -d "${cloudUrl}" --clean --if-exists ${cloudDumpMode} --no-owner --no-privileges --quote-all-identifiers --exclude-schema=graphql --exclude-schema=graphql_public --exclude-schema=net --exclude-schema=pgsodium --exclude-schema=pgsodium_masks --exclude-schema=pgtle --exclude-schema=repack --exclude-schema=realtime --exclude-schema=supabase_functions --exclude-schema=supabase_migrations --exclude-schema=tiger --exclude-schema=topology --exclude-schema=vault > ${tgtDir}/cloud_dump.sql 2> ${tgtDir}/cloud_dump_error.log || (cat ${tgtDir}/cloud_dump_error.log >&2 && exit 1)`,
        sessionId,
        { stepLabel: 'Cloud Yedekleme' }
      );
      if (dumpCode !== 0) {
        throw new Error(`Cloud'dan veri çekerken hata oluştu (exit: ${dumpCode}). Lütfen üstteki sarı/kırmızı log satırlarını kontrol edin (örn: şifre yanlışlığı veya IP kısıtlaması).`);
      }

      step('Adım 5: Alınan yedek hedef veritabanına yükleniyor (Restore)');
      const restoreCode = await sshExecStream(targetHost, targetPass,
        `docker exec -i supabase-${targetInstance}-db psql -U postgres -d postgres < ${tgtDir}/cloud_dump.sql 2>&1`,
        sessionId,
        { stepLabel: 'Yedek Geri Yükleme' }
      );
      if (restoreCode !== 0) {
        log('⚠️ Restore işleminde bazı hatalar veya uyarılar (exit code) alınmış olabilir, ancak işlem büyük ihtimalle devam etti.', 'warn');
      } else {
        log('✅ Restore başarıyla tamamlandı.');
      }

      step('Adım 6: Şema sahiplikleri ve izinleri düzeltiliyor');
      // SQL script using base64 exactly like normal migration
      const permFixSql = [
        `ALTER SCHEMA auth OWNER TO supabase_auth_admin;`,
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='auth' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `    BEGIN`,
        `      IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      ELSE EXECUTE format('ALTER TABLE auth.%I OWNER TO supabase_auth_admin', r.relname);`,
        `      END IF;`,
        `    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Sahiplik (%): %', r.relkind, r.relname; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='auth' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP`,
        `    BEGIN EXECUTE format('ALTER TYPE auth.%I OWNER TO supabase_auth_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT p.oid::regprocedure::text as funcdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'auth' LOOP`,
        `    BEGIN EXECUTE 'ALTER FUNCTION ' || r.funcdef || ' OWNER TO supabase_auth_admin'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='auth' AND tablename='schema_migrations') THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20221208132122') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='oauth_clients') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='oauth_clients' AND column_name='client_id') THEN`,
        `    BEGIN EXECUTE 'DROP TABLE auth.oauth_clients CASCADE'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='oauth_clients') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='oauth_clients' AND column_name='client_id') THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20250731150234') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname='auth' AND t.relname='oauth_authorizations' AND c.conname='oauth_authorizations_nonce_length') THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20251104100000') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname='auth' AND t.relname='sessions' AND c.conname='sessions_scopes_length') THEN`,
        `    BEGIN INSERT INTO auth.schema_migrations("version") VALUES ('20251111201300') ON CONFLICT DO NOTHING; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END IF;`,
        `END $fix$;`,
        `GRANT ALL ON SCHEMA auth TO supabase_auth_admin;`,
        `GRANT USAGE ON SCHEMA auth TO postgres, supabase_admin;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA auth TO supabase_auth_admin;`,
        `ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;`,
        `ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;`,
        `CREATE SCHEMA IF NOT EXISTS storage_vectors AUTHORIZATION supabase_storage_admin;`,
        `ALTER SCHEMA storage OWNER TO supabase_storage_admin;`,
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='storage' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `    BEGIN`,
        `      IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      ELSE EXECUTE format('ALTER TABLE storage.%I OWNER TO supabase_storage_admin', r.relname);`,
        `      END IF;`,
        `    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Sahiplik (%): %', r.relkind, r.relname; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='storage' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP`,
        `    BEGIN EXECUTE format('ALTER TYPE storage.%I OWNER TO supabase_storage_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `  FOR r IN SELECT p.oid::regprocedure::text as funcdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'storage' LOOP`,
        `    BEGIN EXECUTE 'ALTER FUNCTION ' || r.funcdef || ' OWNER TO supabase_storage_admin'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `  END LOOP;`,
        `END $fix$;`,
        `GRANT ALL ON SCHEMA storage TO supabase_storage_admin;`,
        `GRANT USAGE ON SCHEMA storage TO postgres, supabase_admin;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO supabase_storage_admin;`,
        `GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO anon, authenticated, service_role;`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON ROUTINES TO anon, authenticated, service_role;`,
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='realtime') THEN`,
        `    ALTER SCHEMA realtime OWNER TO supabase_realtime_admin;`,
        `    FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='realtime' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `      BEGIN`,
        `        IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        ELSE EXECUTE format('ALTER TABLE realtime.%I OWNER TO supabase_realtime_admin', r.relname);`,
        `        END IF;`,
        `      EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `    END LOOP;`,
        `    FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='realtime' AND t.typtype IN ('e','d') AND left(t.typname,1) <> '_' LOOP`,
        `      BEGIN EXECUTE format('ALTER TYPE realtime.%I OWNER TO supabase_realtime_admin', r.typname); EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `    END LOOP;`,
        `  END IF;`,
        `END $fix$;`,
        `GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;`,
        `GRANT USAGE ON SCHEMA realtime TO postgres, supabase_admin;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA realtime TO supabase_realtime_admin;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA realtime TO supabase_realtime_admin;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA realtime TO supabase_realtime_admin;`,
        `DO $fix$ BEGIN`,
        `  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='extensions') THEN`,
        `    ALTER SCHEMA extensions OWNER TO supabase_admin;`,
        `    GRANT ALL ON SCHEMA extensions TO supabase_admin, postgres;`,
        `    GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;`,
        `  END IF;`,
        `END $fix$;`,
        `DO $fix$ DECLARE r RECORD; BEGIN`,
        `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_functions_admin') AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_functions') THEN`,
        `    ALTER SCHEMA supabase_functions OWNER TO supabase_functions_admin;`,
        `    FOR r IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='supabase_functions' AND relkind IN ('r','v','m','S','f','p') LOOP`,
        `      BEGIN`,
        `        IF r.relkind = 'S' THEN EXECUTE format('ALTER SEQUENCE supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        ELSIF r.relkind = 'v' THEN EXECUTE format('ALTER VIEW supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        ELSIF r.relkind = 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        ELSE EXECUTE format('ALTER TABLE supabase_functions.%I OWNER TO supabase_functions_admin', r.relname);`,
        `        END IF;`,
        `      EXCEPTION WHEN OTHERS THEN NULL; END;`,
        `    END LOOP;`,
        `    GRANT ALL ON SCHEMA supabase_functions TO supabase_functions_admin;`,
        `  END IF;`,
        `END $fix$;`,
        `GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;`,
        `GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;`,
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;`,
        `GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;`
      ].join('\n');

      const permFixB64 = Buffer.from(permFixSql).toString('base64');
      const permFixCode = await sshExecStream(targetHost, targetPass,
        `echo '${permFixB64}' | base64 -d > /tmp/fix_perms.sql && docker exec -i supabase-${targetInstance}-db psql -U postgres -d postgres < /tmp/fix_perms.sql 2>&1 && echo "Schema sahiplikleri düzeltildi ✅"`,
        sessionId
      );
      if (permFixCode !== 0) {
        log('⚠️ İzin düzeltme tamamlanamadı — servisler sorun yaşayabilir.', 'warn');
      }

      step('Adım 7: İlgili servisler yeniden başlatılıyor');
      if (skipInstall) {
        const restartCode = await sshExecStream(targetHost, targetPass,
          `docker restart supabase-rest supabase-realtime || echo "Bazi servisler yeniden baslatilamadi"`,
          sessionId,
          { stepLabel: 'API Cache Yenileme' }
        );
      } else {
        const startAllCode = await sshExecStream(targetHost, targetPass,
          `cd ${tgtDir}/docker && docker compose pull -q && docker compose up -d --quiet-pull`,
          sessionId,
          { stepLabel: 'Servisleri Başlatma' }
        );
        if (startAllCode !== 0) throw new Error('Servisler başlatılamadı!');
        
        step('Adım 8: Son Ayarlar (Nginx ve SSL)');
        if (getSSL) {
          const sslEmail = certbotEmail || `admin@${apiDomain.split('.').slice(-2).join('.')}`;
          log(`📧 Let's Encrypt e-postası: ${sslEmail}`);
          try {
            const sslCode = await sshExecStream(targetHost, targetPass,
              `certbot --nginx -d ${studioDomain} -d ${apiDomain} --non-interactive --agree-tos -m ${sslEmail} --redirect 2>&1 && (systemctl reload nginx || systemctl restart nginx) && echo "SSL sertifikaları alındı!"`,
              sessionId,
              { stepLabel: 'SSL sertifika alma' }
            );
            if (sslCode !== 0) {
              log(`⚠️ SSL sertifikası alınamadı (exit: ${sslCode}). DNS henüz yayılmamış olabilir.`, 'warn');
            }
          } catch (sslErr) {
            log(`⚠️ SSL Hatası: ${sslErr.message}`, 'warn');
          }
        } else {
          log('ℹ️ SSL atlandı.', 'warn');
        }
      }

      if (schemaOnly && migrateStorage) {
        log('ℹ️ Şema modunda storage dosyaları taşınmıyor.', 'warn');
      }

      if (!schemaOnly && migrateStorage && cloudApiUrl && cloudServiceKey) {
        step('Adım 9: Storage dosyaları (Fiziksel Dosyalar) taşınıyor');
        log('Geçici Storage Taşıma aracı (Node.js) hedef sunucuda çalıştırılıyor...');

        const scriptContent = `
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const cloudUrl = '${cloudApiUrl}';
const cloudKey = '${cloudServiceKey}';
const targetUrl = process.env.TARGET_URL;
const targetKey = process.env.TARGET_KEY;

let versionMap = {};
try {
  if (fs.existsSync('versions.txt')) {
    const raw = fs.readFileSync('versions.txt', 'utf8');
    raw.split('\\n').forEach(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        versionMap[parts[0].trim()] = parts[1].trim();
      }
    });
  }
} catch (e) {
  console.error("Versiyonlar okunamadi: ", e);
}

if (!targetKey) {
  console.error("HATA: Hedef sunucu SERVICE_ROLE_KEY bulunamadi!");
  process.exit(1);
}

const cloudClient = createClient(cloudUrl, cloudKey);
const targetClient = createClient(targetUrl, targetKey, {
  auth: { persistSession: false }
});

async function migrate() {
  console.log("Cloud bucket'lar listeleniyor...");
  const { data: buckets, error: bucketErr } = await cloudClient.storage.listBuckets();
  if (bucketErr) {
    console.error("Bucket listeleme hatasi:", bucketErr);
    process.exit(1);
  }

  for (const bucket of buckets) {
     console.log("Bucket isleniyor: " + bucket.name);
     await migrateDirectory(bucket.name, '');
  }
  console.log("STORAGE TASIMA BASARIYLA TAMAMLANDI!");
}

async function migrateDirectory(bucket, dirPath) {
  const { data: list, error: listErr } = await cloudClient.storage.from(bucket).list(dirPath, { limit: 1000 });
  if (listErr) {
    console.error("Listeleme hatasi (" + dirPath + "):", listErr);
    return;
  }
  for (const item of list) {
    if (!item.id || item.name === '.emptyFolderPlaceholder') {
       if (item.name !== '.emptyFolderPlaceholder') {
         const newPath = dirPath ? dirPath + '/' + item.name : item.name;
         await migrateDirectory(bucket, newPath);
       }
    } else {
      const fullPath = dirPath ? dirPath + '/' + item.name : item.name;
      const { data: fileData, error: dlErr } = await cloudClient.storage.from(bucket).download(fullPath);
      if (dlErr) {
        console.error("Indirme hatasi (" + fullPath + "):", dlErr);
        continue;
      }
      
      const arrayBuffer = await fileData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let fileVersion = null;
      if (typeof versionMap !== 'undefined' && versionMap[bucket + ':' + fullPath]) {
          fileVersion = versionMap[bucket + ':' + fullPath];
      }

      const possiblePrefixes = ['storage-single-tenant', 'tenant1', 'stub', ''];
      for (const prefix of possiblePrefixes) {
         const destPath = path.join('/target-storage', prefix, bucket, fullPath);
         try {
             if (fileVersion && fileVersion !== '') {
                 fs.mkdirSync(destPath, { recursive: true });
                 fs.writeFileSync(path.join(destPath, fileVersion), buffer);
             } else {
                 fs.mkdirSync(path.dirname(destPath), { recursive: true });
                 fs.writeFileSync(destPath, buffer);
             }
         } catch (e) {
             // Ignore errors if trying to write file to a dir or vice versa across different prefixes
         }
      }
    }
  }
}

migrate();
`;

        const b64Script = Buffer.from(scriptContent).toString('base64');
        
        const storageBash = `
mkdir -p /tmp/storage-migrator && cd /tmp/storage-migrator
echo '${b64Script}' | base64 -d > index.js
echo '{"dependencies": {"@supabase/supabase-js": "^2.40.0"}}' > package.json
if [ -f "/root/supabase/docker/.env" ]; then
  TARGET_KEY=$(grep '^SERVICE_ROLE_KEY=' /root/supabase/docker/.env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
else
  TARGET_KEY="${env?.SERVICE_ROLE_KEY || ''}"
fi
if [ -z "$TARGET_KEY" ]; then
  echo "Hedef sunucu SERVICE_ROLE_KEY bulunamadı! Taşıma iptal edildi." >&2
  exit 1
fi
echo "Veritabanından dosya versiyonları çekiliyor (API bypass)..."
docker exec -i supabase-db psql -U postgres -d postgres -t -A -c "SELECT bucket_id || ':' || name || '|' || COALESCE(version, '') FROM storage.objects;" > versions.txt
echo "Docker node:22-alpine imajı kontrol ediliyor..."
docker pull node:22-alpine >/dev/null 2>&1
echo "Bağımlılıklar kuruluyor (npm install @supabase/supabase-js)..."
docker run --rm -v /tmp/storage-migrator:/app -w /app node:22-alpine npm install --no-audit --no-fund
echo "Dosyalar fiziksel diske yazılıyor (bu işlem veri boyutuna göre uzun sürebilir)..."
docker run --rm --network host -e TARGET_URL="http://localhost:${KONG_PORT}" -e TARGET_KEY="$TARGET_KEY" -v /root/supabase/docker/volumes/storage:/target-storage -v /tmp/storage-migrator:/app -w /app node:22-alpine node index.js
rm -rf /tmp/storage-migrator
        `;

        const storageCode = await sshExecStream(targetHost, targetPass, storageBash, sessionId, { stepLabel: 'Storage Dosyaları Transferi' });
        if (storageCode !== 0) {
          log('⚠️ Storage dosyaları taşınırken hatalar oluştu. Logları inceleyin.', 'warn');
        } else {
          log('✅ Storage dosyaları başarıyla aktarıldı!', 'success');
        }
      }

      step('Adım 10: Storage API Bug Yamaları Uygulanıyor');
      log('Hedef sunucudaki Supabase Storage API için gerekli stabilite yamaları uygulanıyor...');
      const patchBash = `
cd /root/supabase/docker
mkdir -p patches
docker cp supabase-storage:/app/dist/storage/backend/secure-path.js patches/secure-path.js 2>/dev/null || true
docker cp supabase-storage:/app/dist/storage/backend/file.js patches/file.js 2>/dev/null || true

if [ -f "patches/secure-path.js" ]; then
  if ! grep -q 'relativePath.startsWith("/")' patches/secure-path.js; then
    docker run --rm -v $(pwd)/patches:/patches node:22-alpine node -e "const fs=require('fs'); let c=fs.readFileSync('/patches/secure-path.js','utf8'); c=c.replace('function resolveSecureFilesystemPath(rootPath, relativePath) {', 'function resolveSecureFilesystemPath(rootPath, relativePath) { relativePath = relativePath.startsWith(\\\\\\"/\\\\\\") ? relativePath.substring(1) : relativePath;'); fs.writeFileSync('/patches/secure-path.js', c);"
  fi
fi

if [ -f "patches/file.js" ]; then
  if ! grep -q 'catch(() => undefined)' patches/file.js; then
    docker run --rm -v $(pwd)/patches:/patches node:22-alpine node -e "const fs=require('fs'); let c=fs.readFileSync('/patches/file.js','utf8'); c=c.replace(/return xattr\\\\.get\\\\(file, attribute\\\\)\\\\.then\\\\(\\\\(value\\\\) => \\\\{[\\\\s\\\\S]*?\\\\}\\\\);/, 'return xattr.get(file, attribute).then((value) => { return value?.toString() ?? void 0; }).catch(() => undefined);'); fs.writeFileSync('/patches/file.js', c);"
  fi
fi

if ! grep -q 'patches/secure-path.js' docker-compose.yml; then
  sed -i 's|- ./volumes/storage:/var/lib/storage:z|- ./volumes/storage:/var/lib/storage:z\\n      - ./patches/secure-path.js:/app/dist/storage/backend/secure-path.js:ro\\n      - ./patches/file.js:/app/dist/storage/backend/file.js:ro|g' docker-compose.yml
  docker compose stop storage
  docker compose rm -f storage
  docker compose up -d storage
fi
echo "Yamalar basariyla uygulandi!"
      `;
      const patchCode = await sshExecStream(targetHost, targetPass, patchBash, sessionId, { stepLabel: 'API Yamaları' });
      if (patchCode !== 0) {
        log('⚠️ Storage API yamaları uygulanırken bir hata oluştu. Storage servisi varsayılan ayarlarla çalışmaya devam ediyor.', 'warn');
      } else {
        log('✅ Storage API yamaları kalıcı olarak başarıyla uygulandı!', 'success');
      }

      log('\\n✅ CLOUD TAŞIMASI BAŞARIYLA TAMAMLANDI!', 'success');
      log(`🌐 Studio: https://${studioDomain}`, 'success');
      log(`🔌 API:    https://${apiDomain}`, 'success');
      log(`👤 Dashboard Kullanıcı: admin / ${env.DASHBOARD_PASSWORD}`, 'success');

      closeSseSession(sessionId, { type: 'done', env, studioDomain, apiDomain });

    } catch (err) {
      log(`❌ Kritik Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// ─── YARDIMCI FONKSİYONLAR ────────────────────────────────────
function buildEnvFile(env, studioDomain, apiDomain, siteUrl, instanceId = '1') {
  env = Object.assign(env || {}, generateSupabaseEnvDefaults(env));
  const ports = getInstancePorts(instanceId);
  return `############
# Project Configuration
############
COMPOSE_PROJECT_NAME=supabase-${instanceId}

############
# Secrets
############

POSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}
JWT_SECRET=${env.JWT_SECRET}
ANON_KEY=${env.ANON_KEY}
SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=${env.DASHBOARD_PASSWORD}
SECRET_KEY_BASE=${env.SECRET_KEY_BASE}
VAULT_ENC_KEY=${env.VAULT_ENC_KEY}
PG_META_CRYPTO_KEY=${env.PG_META_CRYPTO_KEY}

############
# Database
############

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=${ports.POSTGRES_PORT}

############
# Supavisor
############

POOLER_PROXY_PORT_TRANSACTION=${ports.POOLER_PROXY_PORT_TRANSACTION}
POOLER_DEFAULT_POOL_SIZE=${env.POOLER_DEFAULT_POOL_SIZE || 20}
POOLER_MAX_CLIENT_CONN=${env.POOLER_MAX_CLIENT_CONN || 100}
POOLER_TENANT_ID=${env.POOLER_TENANT_ID || 'default-tenant'}
POOLER_DB_POOL_SIZE=${env.POOLER_DB_POOL_SIZE || 5}

############
# API Proxy - Kong
############

KONG_HTTP_PORT=${ports.KONG_HTTP_PORT}
KONG_HTTPS_PORT=${ports.KONG_HTTPS_PORT}

############
# PostgREST
############

PGRST_DB_SCHEMAS=${env.PGRST_DB_SCHEMAS || 'public,storage,graphql_public'}

############
# Auth - GoTrue
############

SITE_URL=${siteUrl}
ADDITIONAL_REDIRECT_URLS=${env.ADDITIONAL_REDIRECT_URLS || ''}
JWT_EXPIRY=${env.JWT_EXPIRY || 3600}
DISABLE_SIGNUP=${env.DISABLE_SIGNUP || false}
API_EXTERNAL_URL=https://${apiDomain}

MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
MAILER_URLPATHS_INVITE=/auth/v1/verify
MAILER_URLPATHS_RECOVERY=/auth/v1/verify
MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify

ENABLE_EMAIL_SIGNUP=${env.ENABLE_EMAIL_SIGNUP || true}
ENABLE_EMAIL_AUTOCONFIRM=${env.ENABLE_EMAIL_AUTOCONFIRM || true}
SMTP_ADMIN_EMAIL=${env.SMTP_ADMIN_EMAIL || ''}
SMTP_HOST=${env.SMTP_HOST || ''}
SMTP_PORT=${ports.SMTP_PORT}
SMTP_USER=${env.SMTP_USER || 'admin'}
SMTP_PASS=${env.SMTP_PASS || ''}
SMTP_SENDER_NAME=${env.SMTP_SENDER_NAME || 'Supabase'}
ENABLE_ANONYMOUS_USERS=${env.ENABLE_ANONYMOUS_USERS || false}

ENABLE_PHONE_SIGNUP=${env.ENABLE_PHONE_SIGNUP || true}
ENABLE_PHONE_AUTOCONFIRM=${env.ENABLE_PHONE_AUTOCONFIRM || true}

############
# Studio
############

STUDIO_DEFAULT_ORGANIZATION=${env.STUDIO_DEFAULT_ORGANIZATION || 'Default Organization'}
STUDIO_DEFAULT_PROJECT=${env.STUDIO_DEFAULT_PROJECT || 'Default Project'}
SUPABASE_PUBLIC_URL=https://${apiDomain}
IMGPROXY_ENABLE_WEBP_DETECTION=${env.IMGPROXY_ENABLE_WEBP_DETECTION || true}
OPENAI_API_KEY=${env.OPENAI_API_KEY || ''}

############
# Region / Storage compatibility (newer Supabase Storage)
############

SERVER_REGION=${env.SERVER_REGION || env.REGION || env.STORAGE_S3_REGION || 'us-east-1'}
REGION=${env.REGION || env.STORAGE_S3_REGION || env.SERVER_REGION || 'us-east-1'}
STORAGE_S3_REGION=${env.STORAGE_S3_REGION || env.REGION || env.SERVER_REGION || 'us-east-1'}
VECTOR_BUCKET_REGION=${env.VECTOR_BUCKET_REGION || env.STORAGE_S3_REGION || env.REGION || ''}


############
# Functions
############

FUNCTIONS_VERIFY_JWT=${env.FUNCTIONS_VERIFY_JWT || false}

############
# Logs
############

LOGFLARE_PUBLIC_ACCESS_TOKEN=${env.LOGFLARE_PUBLIC_ACCESS_TOKEN}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${env.LOGFLARE_PRIVATE_ACCESS_TOKEN}
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
GOOGLE_PROJECT_ID=${env.GOOGLE_PROJECT_ID || 'GOOGLE_PROJECT_ID'}
GOOGLE_PROJECT_NUMBER=${env.GOOGLE_PROJECT_NUMBER || 'GOOGLE_PROJECT_NUMBER'}
`;
}

function buildNginxConf(studioDomain, apiDomain, dashPass, instanceId = '1') {
  const ports = getInstancePorts(instanceId);
  const KONG_PORT = ports.KONG_HTTP_PORT || 8000;
  const STUDIO_PORT = ports.STUDIO_HTTP_PORT || 3000;

  if (studioDomain === apiDomain) {
    return `# Supabase (Studio + API, same domain) - Instance ${instanceId}
server {
    server_name ${studioDomain};
    client_max_body_size 50m;
    listen 80;
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/${studioDomain}.crt;
    ssl_certificate_key /etc/nginx/ssl/${studioDomain}.key;

    # Supabase API routes -> Kong
    location ~* ^/(auth|rest|realtime|storage|functions|pg|graphql|meta)/ {
        proxy_pass http://localhost:${KONG_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Studio -> protected
    location / {
        auth_basic "Yonetici Girisi";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://localhost:${KONG_PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_http_version 1.1;
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,apikey,x-client-info' always;
    }
}
`;
  }

  return `# Supabase Studio
server {
    server_name ${studioDomain};
    client_max_body_size 50m;
    listen 80;
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/${studioDomain}.crt;
    ssl_certificate_key /etc/nginx/ssl/${studioDomain}.key;

    location / {
        auth_basic "Yonetici Girisi";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://localhost:${KONG_PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_http_version 1.1;
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,apikey,x-client-info' always;
    }
}

# Supabase API (Kong)
server {
    server_name ${apiDomain};
    client_max_body_size 50m;
    listen 80;
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/${apiDomain}.crt;
    ssl_certificate_key /etc/nginx/ssl/${apiDomain}.key;

    location / {
        proxy_pass http://localhost:${KONG_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

// ─── AYAR GÜNCELLEME (kurulu instance üzerinde) ────────────────────────
// Migration/kurulum sonrası domain, SITE_URL, SMTP gibi değerleri değiştirir.
// Secret ve port/proje anahtarları korunur: değişmeleri çalışan stack'i bozar
// (JWT'ye bağlı API key'ler geçersiz olur, container/port şeması kayar).
const PROTECTED_ENV_KEYS = new Set([
  'POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY',
  'SECRET_KEY_BASE', 'VAULT_ENC_KEY', 'PG_META_CRYPTO_KEY',
  'COMPOSE_PROJECT_NAME', 'POOLER_TENANT_ID', 'POSTGRES_HOST', 'POSTGRES_DB',
  'POSTGRES_PORT', 'KONG_HTTP_PORT', 'KONG_HTTPS_PORT',
  'POOLER_PROXY_PORT_TRANSACTION', 'DOCKER_SOCKET_LOCATION'
]);

function parseEnvContent(content) {
  const env = {};
  String(content || '').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  });
  return env;
}

// Mevcut .env içeriğinde yalnızca verilen anahtarları değiştirir;
// dosyadaki bilinmeyen anahtarlar, yorumlar ve sıralama korunur.
function applyEnvUpdates(content, updates) {
  const seen = new Set();
  const lines = String(content).split('\n').map(line => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  const missing = Object.keys(updates).filter(k => !seen.has(k));
  if (missing.length) {
    if ((lines[lines.length - 1] || '').trim() !== '') lines.push('');
    lines.push('# Ayar güncelleme aracıyla eklendi');
    missing.forEach(k => lines.push(`${k}=${updates[k]}`));
  }
  return lines.join('\n');
}

function cleanDomainInput(value) {
  return String(value || '').trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-zA-Z0-9.-]/g, '');
}

app.post('/api/fetch-settings', async (req, res) => {
  const { host, password, targetInstance } = req.body;
  const instanceId = targetInstance || '1';
  const tgtDir = getInstanceDir(instanceId);
  try {
    const result = await sshExec(host, password, `
      if [ -f ${tgtDir}/docker/.env ]; then
        echo "=ENV_START="
        cat ${tgtDir}/docker/.env
        echo ""
        echo "=ENV_END="
      else
        echo "ENV_NOT_FOUND"
      fi
      if [ -f /etc/nginx/sites-available/supabase-${instanceId} ]; then
        echo "=NGINX_START="
        grep -E '^[[:space:]]*server_name' /etc/nginx/sites-available/supabase-${instanceId} | sed -E 's/^[[:space:]]*server_name[[:space:]]+//;s/;.*//'
        echo "=NGINX_END="
      fi
      echo "=SSL_START="
      ls /etc/letsencrypt/live 2>/dev/null | grep -v '^README' || true
      echo "=SSL_END="
      echo "=CONTAINERS_START="
      docker ps --format '{{.Names}}' 2>/dev/null | grep supabase | sort || true
      echo "=CONTAINERS_END="
    `);
    const out = result.output || '';
    if (out.includes('ENV_NOT_FOUND')) {
      return res.json({ success: false, error: `.env bulunamadı (${tgtDir}/docker/.env). Bu instance'ta kurulu bir Supabase yok gibi görünüyor.` });
    }
    const section = (name) => {
      const m = out.match(new RegExp(`=${name}_START=\\n([\\s\\S]*?)\\n?=${name}_END=`));
      return m ? m[1] : '';
    };
    const env = parseEnvContent(section('ENV'));
    const nginxNames = section('NGINX').split('\n').map(s => s.trim()).filter(Boolean);
    const sslDomains = section('SSL').split('\n').map(s => s.trim()).filter(Boolean);
    const containers = section('CONTAINERS').split('\n').map(s => s.trim()).filter(Boolean);

    const apiDomain = cleanDomainInput(env.API_EXTERNAL_URL || env.SUPABASE_PUBLIC_URL || '') || nginxNames[1] || nginxNames[0] || '';
    const studioDomain = nginxNames[0] || apiDomain;

    res.json({
      success: true,
      env,
      studioDomain,
      apiDomain,
      siteUrl: env.SITE_URL || '',
      sslDomains,
      containers,
      envPath: `${tgtDir}/docker/.env`
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/update-settings', async (req, res) => {
  const {
    host, password, sessionId, targetInstance,
    studioDomain, apiDomain, siteUrl,
    getSSL, certbotEmail, envUpdates
  } = req.body;

  if (!host || !password) {
    return res.status(400).json({ success: false, error: 'Sunucu bilgileri eksik' });
  }

  const instanceId = targetInstance || '1';
  const tgtDir = getInstanceDir(instanceId);

  res.json({ success: true, message: 'Ayar güncellemesi başlatıldı' });

  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      const ts = Date.now();
      const effStudio = cleanDomainInput(studioDomain);
      const effApi = cleanDomainInput(apiDomain);

      step('ADIM 1/4 — Mevcut yapılandırma okunuyor');
      log('🔍 Sunucu bağlantısı test ediliyor...');
      const test = await sshExec(host, password, `[ -f ${tgtDir}/docker/.env ] && echo HAS_ENV || echo NO_ENV`);
      if (test.output.includes('NO_ENV')) throw new Error(`.env bulunamadı (${tgtDir}/docker/.env) — bu instance'ta kurulum yok.`);
      if (!test.output.includes('HAS_ENV')) throw new Error('SSH yanıt vermedi');
      log('✅ Bağlantı tamam, .env mevcut');

      const envRes = await sshExec(host, password, `base64 -w0 ${tgtDir}/docker/.env 2>/dev/null || base64 ${tgtDir}/docker/.env`);
      const rawEnv = Buffer.from(String(envRes.output || '').replace(/\s+/g, ''), 'base64').toString('utf8');
      if (!rawEnv.trim()) throw new Error('.env okunamadı (boş içerik)');
      const currentEnv = parseEnvContent(rawEnv);
      log(`📄 Mevcut .env okundu (${Object.keys(currentEnv).length} anahtar)`);

      // ── Etkin güncellemeleri hazırla ──
      const requested = { ...(envUpdates || {}) };
      // Domainlerden türetilen anahtarlar (kullanıcı aynı anahtarı elle verdiyse o kazanır)
      if (effApi) {
        if (!('API_EXTERNAL_URL' in requested)) requested.API_EXTERNAL_URL = `https://${effApi}`;
        if (!('SUPABASE_PUBLIC_URL' in requested)) requested.SUPABASE_PUBLIC_URL = `https://${effApi}`;
      }
      if (siteUrl && !('SITE_URL' in requested)) requested.SITE_URL = String(siteUrl).trim();

      const blocked = Object.keys(requested).filter(k => PROTECTED_ENV_KEYS.has(k));
      blocked.forEach(k => { delete requested[k]; });
      if (blocked.length) {
        log(`🚫 Korunan anahtarlar atlandı (değişimleri çalışan sistemi bozar): ${blocked.join(', ')}`, 'warn');
      }
      Object.keys(requested).forEach(k => {
        requested[k] = String(requested[k] ?? '').replace(/[\r\n]+/g, ' ').trim();
      });

      const changedKeys = Object.keys(requested).filter(k => (currentEnv[k] ?? '') !== requested[k]);
      const effective = {};
      changedKeys.forEach(k => { effective[k] = requested[k]; });
      const envChanged = changedKeys.length > 0;

      // ── .env güncelle ──
      step('ADIM 2/4 — .env güncelleniyor');
      if (envChanged) {
        log(`✏️ Değişen anahtarlar: ${changedKeys.join(', ')}`);
        const newEnvContent = applyEnvUpdates(rawEnv, effective);
        const newB64 = Buffer.from(newEnvContent, 'utf8').toString('base64');
        const wCode = await sshExecStream(host, password,
          `cp ${tgtDir}/docker/.env ${tgtDir}/docker/.env.bak-${ts} &&
           echo '${newB64}' | base64 -d > ${tgtDir}/docker/.env &&
           echo ".env güncellendi — yedek: .env.bak-${ts}"`,
          sessionId, { stepLabel: '.env güncelleme adımı' });
        if (wCode !== 0) throw new Error(`.env yazılamadı (exit: ${wCode}). Disk dolu mu?`);
      } else {
        log('ℹ️ .env içinde değişen değer yok, dosyaya dokunulmadı.');
      }

      // ── Nginx + htpasswd + SSL ──
      step('ADIM 3/4 — Nginx & SSL yapılandırılıyor');
      if (effStudio && effApi) {
        const dashPass = effective.DASHBOARD_PASSWORD || currentEnv.DASHBOARD_PASSWORD || '';
        const nginxContent = buildNginxConf(effStudio, effApi, dashPass, instanceId);
        const escapedNginx = nginxContent.replace(/'/g, "'\\''");
        try {
          const nginxCode = await sshExecStream(host, password,
            `mkdir -p /etc/nginx/ssl &&
             for d in '${effStudio}' '${effApi}'; do
               [ -z "$d" ] && continue;
               crt="/etc/nginx/ssl/$d.crt";
               key="/etc/nginx/ssl/$d.key";
               if [ ! -s "$crt" ] || [ ! -s "$key" ]; then
                 openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -keyout "$key" -out "$crt" -subj "/CN=$d" >/dev/null 2>&1 || true;
               fi;
             done &&
             printf '%s' '${escapedNginx}' > /etc/nginx/sites-available/supabase-${instanceId} &&
             ln -sf /etc/nginx/sites-available/supabase-${instanceId} /etc/nginx/sites-enabled/supabase-${instanceId} &&
             nginx -t &&
             (systemctl reload nginx || systemctl restart nginx) &&
             echo "Nginx yapılandırması güncellendi"`,
            sessionId, { stepLabel: 'Nginx yapılandırma adımı' });
          if (nginxCode !== 0) log('⚠️ Nginx yapılandırılamadı — elle kontrol edin: nginx -t', 'warn');
        } catch (e) {
          log(`⚠️ Nginx hatası (non-kritik): ${e.message}`, 'warn');
        }
      } else {
        log('ℹ️ Domain bilgisi verilmediği için Nginx yapılandırmasına dokunulmadı.');
      }

      if (effective.DASHBOARD_PASSWORD) {
        try {
          const escapedDash = String(effective.DASHBOARD_PASSWORD).replace(/'/g, `'\\''`);
          const htCode = await sshExecStream(host, password,
            `htpasswd -cb /etc/nginx/.htpasswd admin '${escapedDash}' && (systemctl reload nginx || true) && echo "Studio giriş şifresi (htpasswd) güncellendi"`,
            sessionId, { stepLabel: 'htpasswd güncelleme adımı' });
          if (htCode !== 0) log('⚠️ htpasswd güncellenemedi — Studio girişi eski şifreyle kalmış olabilir.', 'warn');
        } catch (e) {
          log(`⚠️ htpasswd hatası (non-kritik): ${e.message}`, 'warn');
        }
      }

      if (getSSL && effStudio && effApi) {
        log("🔒 Let's Encrypt sertifikası alınıyor (DNS kayıtları bu sunucuyu göstermelidir)...");
        const sslEmail = String(certbotEmail || `admin@${effApi.split('.').slice(-2).join('.')}`).replace(/[^a-zA-Z0-9@._+-]/g, '');
        log(`📧 Let's Encrypt e-postası: ${sslEmail}`);
        try {
          const domainArgs = effStudio === effApi ? `-d ${effStudio}` : `-d ${effStudio} -d ${effApi}`;
          const sslCode = await sshExecStream(host, password,
            `certbot --nginx ${domainArgs} --non-interactive --agree-tos -m ${sslEmail} --redirect 2>&1 && (systemctl reload nginx || systemctl restart nginx) && echo "SSL sertifikaları alındı!"`,
            sessionId, { stepLabel: 'SSL sertifikası adımı' });
          if (sslCode !== 0) {
            log('⚠️ SSL sertifikası alınamadı — DNS kayıtlarının bu sunucuyu gösterdiğinden emin olun.', 'warn');
            log(`ℹ️ Manuel almak için: certbot --nginx ${domainArgs}`, 'warn');
          }
        } catch (e) {
          log(`⚠️ SSL hatası (non-kritik): ${e.message}`, 'warn');
        }
      }

      // ── Servisleri yeni .env ile yeniden oluştur ──
      step('ADIM 4/4 — Servisler güncelleniyor');
      if (envChanged) {
        log('🔄 docker compose up -d ile etkilenen servisler yeniden oluşturuluyor...');
        const upCode = await sshExecStream(host, password,
          `cd ${tgtDir}/docker &&
           docker compose up -d 2>&1 &&
           sleep 8 &&
           docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep -i supabase || true`,
          sessionId, { stepLabel: 'Servis yeniden başlatma adımı' });
        if (upCode !== 0) {
          throw new Error(`docker compose up -d başarısız (exit: ${upCode}). Geri dönmek için: cp ${tgtDir}/docker/.env.bak-${ts} ${tgtDir}/docker/.env && cd ${tgtDir}/docker && docker compose up -d`);
        }
        log('✅ Etkilenen servisler yeni ayarlarla yeniden oluşturuldu');
      } else {
        log('ℹ️ .env değişmediği için servis yeniden başlatma atlandı.');
      }

      log('\n🎉 Ayar güncellemesi tamamlandı!', 'success');
      if (effStudio) log(`🌐 Studio: https://${effStudio}`, 'success');
      if (effApi) log(`🔌 API:    https://${effApi}`, 'success');
      if (envChanged) log(`💾 Eski .env yedeği: ${tgtDir}/docker/.env.bak-${ts}`, 'warn');

      closeSseSession(sessionId, { type: 'done', studioDomain: effStudio, apiDomain: effApi, changedKeys });
    } catch (err) {
      log(`❌ Ayar Güncelleme Hatası: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// ─── VERİ KARŞILAŞTIRMA (Universal) ─────
async function getStatsFromUrl(dbUrl) {
    const client = new PgClient({ connectionString: dbUrl, ssl: dbUrl.includes('.supabase.co') ? { rejectUnauthorized: false } : false });
    await client.connect();
    
    // Auth schema bypasses standard user schemas, so we query explicitly
    const resTables = await client.query(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_schema IN ('public', 'auth') 
        AND table_type = 'BASE TABLE'
    `);
    
    const counts = {};
    for (const row of resTables.rows) {
        try {
            const countRes = await client.query(`SELECT COUNT(*) FROM "${row.table_schema}"."${row.table_name}"`);
            counts[row.table_schema + '.' + row.table_name] = parseInt(countRes.rows[0].count, 10);
        } catch(e) {
            counts[row.table_schema + '.' + row.table_name] = { error: e.message }; // Return the actual error message
        }
    }
    
    let storage = {};
    try {
        const resStorage = await client.query(`
            SELECT bucket_id, COUNT(*) as count, SUM(COALESCE((metadata->>'size')::bigint, 0)) as total_size 
            FROM storage.objects 
            GROUP BY bucket_id
        `);
        for (const row of resStorage.rows) {
            storage[row.bucket_id || 'null'] = { count: parseInt(row.count, 10), size: parseInt(row.total_size, 10) || 0 };
        }
    } catch(e) {
        // storage schema might not exist
    }
    
    await client.end();
    return { counts, storage };
}

async function getStatsFromSsh(host, pass, instanceId = '1') {
    return new Promise((resolve, reject) => {
        const tgtDir = getInstanceDir(instanceId);
        const ports = getInstancePorts(instanceId);
        
        const script = `
const { Client } = require('pg');
const fs = require('fs');
let localPass = '';
try {
  const envContent = fs.readFileSync('${tgtDir}/docker/.env', 'utf8');
  const match = envContent.match(/^POSTGRES_PASSWORD=(.+)$/m);
  if(match) localPass = match[1].trim();
} catch(e){}
const targetDbUrl = 'postgresql://postgres:' + localPass + '@127.0.0.1:${ports.POSTGRES_PORT}/postgres';

async function getStats(dbUrl) {
    const client = new Client({ connectionString: dbUrl, ssl: false });
    await client.connect();
    const resTables = await client.query(\`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_schema IN ('public', 'auth') 
        AND table_type = 'BASE TABLE'
    \`);
    const counts = {};
    for (const row of resTables.rows) {
        try {
            const countRes = await client.query(\`SELECT COUNT(*) FROM "\${row.table_schema}"."\${row.table_name}"\`);
            counts[row.table_schema + '.' + row.table_name] = parseInt(countRes.rows[0].count, 10);
        } catch(e) {
            counts[row.table_schema + '.' + row.table_name] = { error: e.message };
        }
    }
    let storage = {};
    try {
        const resStorage = await client.query(\`
            SELECT bucket_id, COUNT(*) as count, SUM(COALESCE((metadata->>'size')::bigint, 0)) as total_size 
            FROM storage.objects 
            GROUP BY bucket_id
        \`);
        for (const row of resStorage.rows) {
            storage[row.bucket_id || 'null'] = { count: parseInt(row.count, 10), size: parseInt(row.total_size, 10) || 0 };
        }
    } catch(e) {}
    await client.end();
    return { counts, storage };
}

getStats(targetDbUrl).then(s => console.log(JSON.stringify(s))).catch(e => { console.error(e); process.exit(1); });
        `;

        const b64 = Buffer.from(script).toString('base64');
        const bashCmd = `
mkdir -p /tmp/compare-db
echo '${b64}' | base64 -d > /tmp/compare-db/index.js
echo '{"dependencies": {"pg": "^8.11.3"}}' > /tmp/compare-db/package.json
docker run --rm -v /tmp/compare-db:/app -w /app node:22-alpine npm install pg > /dev/null 2>&1
docker run --rm --network host -v ${tgtDir}/docker/.env:${tgtDir}/docker/.env -v /tmp/compare-db:/app -w /app node:22-alpine node index.js > /tmp/compare-db/result.json 2> /tmp/compare-db/err.log
cat /tmp/compare-db/result.json
rm -rf /tmp/compare-db
        `;

        const conn = new SshClient();
        let resultData = '';
        
        conn.on('ready', () => {
          conn.exec(bashCmd, (err, stream) => {
            if (err) return reject(err);
            stream.on('data', d => resultData += d.toString());
            stream.on('close', () => {
              conn.end();
              try {
                const json = JSON.parse(resultData.trim());
                resolve(json);
              } catch(e) {
                reject(new Error('Invalid JSON from SSH: ' + resultData));
              }
            });
          });
        }).on('error', reject).connect({
          host,
          port: 22,
          username: 'root',
          password: pass,
          readyTimeout: 15000
        });
    });
}

app.post('/api/compare-db', async (req, res) => {
  const { source, target } = req.body;
  if (!source || !target) {
    return res.status(400).json({ error: 'Eksik parametre (source, target)' });
  }

  try {
    const fetchStats = async (config) => {
        if (config.type === 'url') {
            const url = config.url.replace(/#/g, '%23');
            return await getStatsFromUrl(url);
        }
        if (config.type === 'ssh') return await getStatsFromSsh(config.host, config.pass, config.instance || '1');
        throw new Error('Unknown connection type');
    };

    const [sourceStats, targetStats] = await Promise.all([
        fetchStats(source),
        fetchStats(target)
    ]);

    res.json({ cloud: sourceStats, target: targetStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. S3 Otomatik Yedekleme Kurulumu
app.post('/api/setup-backup', async (req, res) => {
  const { targetHost, targetPass, targetInstance, s3AccessKey, s3SecretKey, s3Bucket, s3Region, s3Endpoint, cronSchedule, sessionId } = req.body;
  res.json({ success: true, message: 'Yedekleme kurulumu başlatıldı' });
  
  const tgtDir = getInstanceDir(targetInstance || '1');
  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      step('S3 Yedekleme aracı (awscli) kuruluyor');
      await sshExecStream(targetHost, targetPass, `apt-get update -qq && apt-get install -y -qq awscli`, sessionId, { stepLabel: 'awscli kurulumu' });
      
      step('Yedekleme betiği oluşturuluyor');
      const scriptContent = `#!/bin/bash
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DUMP_FILE="/tmp/supabase_backup_\${TIMESTAMP}.sql"
docker exec supabase-${targetInstance || '1'}-db pg_dump -U supabase_admin postgres > "$DUMP_FILE"
AWS_ACCESS_KEY_ID="${s3AccessKey}" AWS_SECRET_ACCESS_KEY="${s3SecretKey}" aws s3 cp "$DUMP_FILE" "s3://${s3Bucket}/\${TIMESTAMP}.sql" --region "${s3Region}" ${s3Endpoint ? `--endpoint-url "${s3Endpoint}"` : ''}
rm "$DUMP_FILE"
`.replace(/'/g, "'\\''");

      await sshExecStream(targetHost, targetPass, `echo '${scriptContent}' > ${tgtDir}/backup.sh && chmod +x ${tgtDir}/backup.sh`, sessionId, { stepLabel: 'Script oluşturma' });
      
      step('Cron görevi ekleniyor');
      await sshExecStream(targetHost, targetPass, `(crontab -l 2>/dev/null | grep -v "${tgtDir}/backup.sh"; echo "${cronSchedule} ${tgtDir}/backup.sh") | crontab -`, sessionId, { stepLabel: 'Cron oluşturma' });
      
      log('\n✅ Yedekleme başarıyla kuruldu!', 'success');
      closeSseSession(sessionId, { type: 'done' });
    } catch (err) {
      log(`❌ Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 7. Supabase Upgrade
app.post('/api/upgrade-supabase', async (req, res) => {
  const { targetHost, targetPass, targetInstance, targetVersion, sessionId } = req.body;
  res.json({ success: true, message: 'Güncelleme başlatıldı' });
  const tgtDir = getInstanceDir(targetInstance || '1');
  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      step('Mevcut yapılandırma yedekleniyor');
      await sshExecStream(targetHost, targetPass, `cd ${tgtDir}/docker && cp docker-compose.yml docker-compose.yml.bak_$(date +%s) && cp .env .env.bak_$(date +%s) || true`, sessionId, { stepLabel: 'Yedekleme' });
      
      step('Yeni versiyon çekiliyor');
      const versionCmd = targetVersion && targetVersion !== 'latest' ? `git checkout -q -f ${targetVersion}` : `git pull origin master`;
      await sshExecStream(targetHost, targetPass, `cd ${tgtDir} && git fetch --tags && ${versionCmd}`, sessionId, { stepLabel: 'Versiyon Güncelleme' });
      
      step('Containerlar güncelleniyor');
      await sshExecStream(targetHost, targetPass, `cd ${tgtDir}/docker && docker compose pull -q && docker compose up -d --quiet-pull`, sessionId, { stepLabel: 'Docker Update' });
      
      log('\n✅ Supabase güncellendi!', 'success');
      closeSseSession(sessionId, { type: 'done' });
    } catch (err) {
      log(`❌ Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 8. Clone Local (Prod to Local with Anonymization)
app.post('/api/clone-local', async (req, res) => {
  const { sourceHost, sourcePass, targetHost, targetPass, anonymizeData, sessionId } = req.body;
  res.json({ success: true, message: 'Klonlama başlatıldı' });
  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');
  
  (async () => {
    try {
      const ts = Date.now();
      step('Kaynak veritabanından dump alınıyor');
      await sshExecStream(sourceHost, sourcePass, `docker exec supabase-db pg_dump -U supabase_admin postgres > /tmp/clone_${ts}.sql`, sessionId, { stepLabel: 'Dump' });
      
      if (anonymizeData) {
        step('Veriler anonimleştiriliyor');
        await sshExecStream(sourceHost, sourcePass, `sed -i -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/user_masked@example.com/g' /tmp/clone_${ts}.sql`, sessionId, { stepLabel: 'Maskeleme' });
      }
      
      step('Dump hedef sunucuya kopyalanıyor ve yükleniyor');
      const escapedTargetPass = String(targetPass || '').replace(/'/g, "'\\''");
      await sshExecStream(sourceHost, sourcePass, `apt-get install -y -qq sshpass && sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no /tmp/clone_${ts}.sql root@${targetHost}:/tmp/`, sessionId, { stepLabel: 'Kopyalama' });
      await sshExecStream(targetHost, targetPass, `docker exec -i supabase-db psql -U supabase_admin postgres < /tmp/clone_${ts}.sql`, sessionId, { stepLabel: 'Restore' });
      
      log('\n✅ Klonlama başarıyla tamamlandı!', 'success');
      closeSseSession(sessionId, { type: 'done' });
    } catch (err) {
      log(`❌ Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 9. Migrate Edge Functions
app.post('/api/migrate-edge', async (req, res) => {
  const { sourceHost, sourcePass, targetHost, targetPass, migrateSecrets, sessionId } = req.body;
  res.json({ success: true, message: 'Edge Function aktarımı başlatıldı' });
  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      step('Fonksiyonlar kaynak sunucudan arşivleniyor');
      await sshExecStream(sourceHost, sourcePass, `cd /root/supabase/docker/volumes && tar -czf /tmp/functions.tar.gz functions/`, sessionId, { stepLabel: 'Arşivleme' });
      
      step('Fonksiyonlar hedefe kopyalanıyor ve açılıyor');
      const escapedTargetPass = String(targetPass || '').replace(/'/g, "'\\''");
      await sshExecStream(sourceHost, sourcePass, `apt-get install -y -qq sshpass && sshpass -p '${escapedTargetPass}' scp -o StrictHostKeyChecking=no /tmp/functions.tar.gz root@${targetHost}:/tmp/`, sessionId, { stepLabel: 'Kopyalama' });
      await sshExecStream(targetHost, targetPass, `cd /root/supabase/docker/volumes && tar -xzf /tmp/functions.tar.gz -C .`, sessionId, { stepLabel: 'Açma' });
      
      if (migrateSecrets) {
         log('ℹ️ Migrate secrets seçildi. Env taşıma işlemi simüle ediliyor...', 'warn');
      }
      
      log('\n✅ Edge fonksiyonları başarıyla taşındı!', 'success');
      closeSseSession(sessionId, { type: 'done' });
    } catch (err) {
      log(`❌ Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 10. Inspect Infra
app.post('/api/inspect-infra', async (req, res) => {
  const { targetHost, targetPass, targetInstance, sessionId } = req.body;
  res.json({ success: true, message: 'Tarama başlatıldı' });
  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      step('Docker Container durumları taranıyor');
      const result = await sshExec(targetHost, targetPass, `docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.State}}"`);
      log(result.output, 'info');
      
      step('Kaynak (RAM/CPU) tüketimi analiz ediliyor');
      const stats = await sshExec(targetHost, targetPass, `docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}"`);
      log(stats.output, 'info');
      
      log('\n✅ Tarama tamamlandı!', 'success');
      closeSseSession(sessionId, { type: 'done' });
    } catch (err) {
      log(`❌ Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

// 11. AI Seeder
app.post('/api/ai-seed', async (req, res) => {
  const { targetHost, targetPass, targetTable, rowCount, prompt, targetInstance, sessionId } = req.body;
  res.json({ success: true, message: 'AI veri üretimi başlatıldı' });
  const log = (msg, type = 'log') => {
    writeSse(sessionId, { type, msg });
  };
  const step = (msg) => log(`\n━━━ ${msg} ━━━`, 'step');

  (async () => {
    try {
      step('Yapay Zeka (fal.ai) ile veriler üretiliyor');
      const apiKey = process.env.FAL_KEY;
      if (!apiKey) {
         throw new Error("Sunucuda FAL_KEY ortam değişkeni ayarlanmamış.");
      }
      
      const systemPrompt = `Sen bir PostgreSQL veri üreticisisin. Sadece ve sadece geçerli SQL INSERT cümleleri üret. Açıklama yapma. \nHedef Tablo: ${targetTable}\nSatır Sayısı: ${rowCount}\nİstenen Veri: ${prompt}`;
      
      const aiResponse = await fetch('https://fal.run/openrouter/router/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${apiKey}`
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o',
          messages: [{ role: 'system', content: systemPrompt }],
          temperature: 0.7
        })
      });
      
      if (!aiResponse.ok) {
         const errText = await aiResponse.text();
         throw new Error(`fal.ai API Hatası (${aiResponse.status}): ${errText}`);
      }
      
      const aiData = await aiResponse.json();
      let sqlQuery = aiData.choices[0].message.content.trim();
      if (sqlQuery.startsWith('```sql')) {
         sqlQuery = sqlQuery.replace(/^```sql/, '').replace(/```$/, '').trim();
      }
      
      step('Üretilen SQL hedef veritabanına uygulanıyor');
      const b64Sql = Buffer.from(sqlQuery, 'utf8').toString('base64');
      const code = await sshExecStream(targetHost, targetPass, `echo '${b64Sql}' | base64 -d > /tmp/seed.sql && docker exec -i supabase-${targetInstance || '1'}-db psql -U supabase_admin postgres < /tmp/seed.sql`, sessionId, { stepLabel: 'SQL Insert' });
      
      log('\n✅ AI Veri üretimi başarıyla tamamlandı!', 'success');
      closeSseSession(sessionId, { type: 'done' });
    } catch (err) {
      log(`❌ Hata: ${err.message}`, 'error');
      closeSseSession(sessionId, { type: 'error', msg: err.message });
    }
  })();
});

const PORT = process.env.PORT || 4567;
app.listen(PORT, () => {
  console.log(`🚀 Supabase Migration App çalışıyor: http://localhost:${PORT}`);
});
