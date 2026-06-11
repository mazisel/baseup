"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Play, ShieldCheck } from "lucide-react";
import { getModules } from "@/lib/constants";
import { getCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";
import type { JobRequestInput, MigrationModuleType } from "@/types/domain";

const DEFAULT_TYPE: MigrationModuleType = "self_hosted_migration";
const STEP_ORDER = ["package", "details", "options"] as const;

type LauncherStep = typeof STEP_ORDER[number];

export function JobLauncher({ initialType, locale }: { initialType?: MigrationModuleType; locale: Locale }) {
  const router = useRouter();
  const [type, setType] = useState<MigrationModuleType>(initialType ?? DEFAULT_TYPE);
  const [step, setStep] = useState<LauncherStep>("package");
  const [instanceCount, setInstanceCount] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const copy = getCopy(locale);
  const modules = useMemo(() => getModules(locale), [locale]);
  const selectedModule = useMemo(() => modules.find(module => module.id === type) ?? modules[0], [modules, type]);
  const SelectedIcon = selectedModule.icon;
  const currentStepIndex = STEP_ORDER.indexOf(step);
  const steps: Array<{ id: LauncherStep; label: string }> = [
    { id: "package", label: copy.launcher.stepPackage },
    { id: "details", label: copy.launcher.stepDetails },
    { id: "options", label: copy.launcher.stepOptions }
  ];

  function goToStep(nextStep: LauncherStep) {
    setError("");
    setStep(nextStep);
  }

  function goNext() {
    const nextIndex = Math.min(currentStepIndex + 1, STEP_ORDER.length - 1);
    goToStep(STEP_ORDER[nextIndex]);
  }

  function goBack() {
    const previousIndex = Math.max(currentStepIndex - 1, 0);
    goToStep(STEP_ORDER[previousIndex]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (step !== "options") {
      goNext();
      return;
    }

    setLoading(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const settingsUpdates = parseSettingsUpdates(String(form.get("settingsUpdates") || ""));
    const payload: JobRequestInput = {
      type,
      sourceHost: String(form.get("sourceHost") || ""),
      sourcePass: String(form.get("sourcePass") || ""),
      targetHost: String(form.get("targetHost") || ""),
      targetPass: String(form.get("targetPass") || ""),
      targetInstance: String(form.get("targetInstance") || "1"),
      studioDomain: String(form.get("studioDomain") || ""),
      apiDomain: String(form.get("apiDomain") || ""),
      studioDomain2: String(form.get("studioDomain2") || ""),
      apiDomain2: String(form.get("apiDomain2") || ""),
      studioDomain3: String(form.get("studioDomain3") || ""),
      apiDomain3: String(form.get("apiDomain3") || ""),
      siteUrl: String(form.get("siteUrl") || ""),
      cloudDbUrl: String(form.get("cloudDbUrl") || ""),
      cloudApiUrl: String(form.get("cloudApiUrl") || ""),
      cloudServiceKey: String(form.get("cloudServiceKey") || ""),
      schemaFilter: String(form.get("schemaFilter") || "public"),
      certbotEmail: String(form.get("certbotEmail") || ""),
      getSSL: form.get("getSSL") === "on",
      setupBackup: form.get("setupBackup") === "on",
      migrateStorage: form.get("migrateStorage") === "on",
      continueOnMinorErrors: form.get("continueOnMinorErrors") === "on",
      skipInstall: form.get("skipInstall") === "on",
      settingsUpdates,
      s3AccessKey: String(form.get("s3AccessKey") || ""),
      s3SecretKey: String(form.get("s3SecretKey") || ""),
      s3Bucket: String(form.get("s3Bucket") || ""),
      s3Region: String(form.get("s3Region") || ""),
      s3Endpoint: String(form.get("s3Endpoint") || ""),
      cronSchedule: String(form.get("cronSchedule") || "0 3 * * *"),
      anonymizeData: form.get("anonymizeData") === "on",
      targetVersion: String(form.get("targetVersion") || ""),
      targetTable: String(form.get("targetTable") || ""),
      rowCount: parseInt(String(form.get("rowCount") || "10")),
      prompt: String(form.get("prompt") || ""),
      migrateSecrets: form.get("migrateSecrets") === "on"
    };

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job) {
        setError(data.error || copy.launcher.createError);
        setLoading(false);
        return;
      }

      router.push(`/app/jobs/${data.job.id}`);
    } catch {
      setError(copy.launcher.createError);
      setLoading(false);
    }
  }

  return (
    <form className="job-form job-wizard" onSubmit={submit}>
      <div className="wizard-stepper" aria-label={copy.launcher.stepperLabel}>
        {steps.map((item, index) => {
          const isComplete = index < currentStepIndex;
          const isActive = item.id === step;
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              className={`wizard-step ${isActive ? "active" : ""} ${isComplete ? "complete" : ""}`}
              disabled={index > currentStepIndex}
              key={item.id}
              onClick={() => goToStep(item.id)}
              type="button"
            >
              <span className="wizard-step-index">
                {isComplete ? <CheckCircle2 size={15} /> : index + 1}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <section className="panel job-step-panel" hidden={step !== "package"}>
        <div className="job-step-head">
          <div>
            <h2>{copy.launcher.moduleTitle}</h2>
            <p className="muted">{copy.launcher.moduleDescription}</p>
          </div>
        </div>

        <div className="launcher-package-grid">
          {modules.map(module => {
            const Icon = module.icon;
            return (
              <button
                aria-pressed={module.id === type}
                className={`launcher-package-option ${module.id === type ? "active" : ""}`}
                key={module.id}
                onClick={() => setType(module.id)}
                type="button"
              >
                <span className="package-card-icon">
                  <Icon size={22} />
                </span>
                <span className="launcher-package-body">
                  <strong>{module.title}</strong>
                  <span className="muted">{module.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="wizard-actions">
          <button className="button primary" onClick={goNext} type="button">
            {copy.launcher.next}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section className="panel job-step-panel" hidden={step !== "details"}>
        <div className="selected-package-summary">
          <div>
            <span className="muted">{copy.launcher.selectedPackage}</span>
            <h2>{selectedModule.title}</h2>
            <p className="muted">{selectedModule.description}</p>
          </div>
          <div className="selected-package-meta">
            <SelectedIcon size={22} />
          </div>
        </div>

        <div className="notice job-secret-notice">
          <ShieldCheck size={16} /> {copy.launcher.secretNotice}
        </div>

        <div className="form-grid">
          {needsSource(type) ? (
            <>
              <div className="field">
                <label htmlFor="sourceHost">{copy.launcher.sourceHost}</label>
                <input id="sourceHost" name="sourceHost" placeholder="1.2.3.4" />
              </div>
              <div className="field">
                <label htmlFor="sourcePass">{copy.launcher.sourcePass}</label>
                <input id="sourcePass" name="sourcePass" type="password" autoComplete="off" />
              </div>
            </>
          ) : null}

          {needsCloud(type) ? (
            <>
              <div className="field full">
                <label htmlFor="cloudDbUrl">{copy.launcher.cloudDbUrl}</label>
                <input id="cloudDbUrl" name="cloudDbUrl" type="password" placeholder="postgresql://postgres:..." autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="cloudApiUrl">{copy.launcher.cloudApiUrl}</label>
                <input id="cloudApiUrl" name="cloudApiUrl" placeholder="https://project.supabase.co" />
              </div>
              <div className="field">
                <label htmlFor="cloudServiceKey">{copy.launcher.cloudServiceKey}</label>
                <input id="cloudServiceKey" name="cloudServiceKey" type="password" autoComplete="off" />
              </div>
            </>
          ) : null}

          {needsTarget(type) ? (
            <>
              <div className="field">
                <label htmlFor="targetHost">{copy.launcher.targetHost}</label>
                <input id="targetHost" name="targetHost" placeholder="5.6.7.8" />
              </div>
              <div className="field">
                <label htmlFor="targetPass">{copy.launcher.targetPass}</label>
                <input id="targetPass" name="targetPass" type="password" autoComplete="off" />
              </div>
            </>
          ) : null}

          <div className="field">
            <label htmlFor="targetInstance">{copy.launcher.targetInstance}</label>
            <select id="targetInstance" name="targetInstance" value={instanceCount} onChange={(e) => setInstanceCount(e.target.value)}>
              <option value="1">Instance 1</option>
              <option value="2">Instance 2</option>
              <option value="3">Instance 3</option>
            </select>
          </div>

          {needsDomains(type) ? (
            <>
              <div className="field full form-section">
                <h4>Instance 1 Domains</h4>
                <div className="form-subgrid">
                  <div className="field">
                    <label htmlFor="studioDomain">{copy.launcher.studioDomain}</label>
                    <input id="studioDomain" name="studioDomain" placeholder="studio.example.com" />
                  </div>
                  <div className="field">
                    <label htmlFor="apiDomain">{copy.launcher.apiDomain}</label>
                    <input id="apiDomain" name="apiDomain" placeholder="api.example.com" />
                  </div>
                </div>
              </div>

              {(instanceCount === "2" || instanceCount === "3") && (
                <div className="field full form-section">
                  <h4>Instance 2 Domains</h4>
                  <div className="form-subgrid">
                    <div className="field">
                      <label htmlFor="studioDomain2">{copy.launcher.studioDomain}</label>
                      <input id="studioDomain2" name="studioDomain2" placeholder="studio2.example.com" />
                    </div>
                    <div className="field">
                      <label htmlFor="apiDomain2">{copy.launcher.apiDomain}</label>
                      <input id="apiDomain2" name="apiDomain2" placeholder="api2.example.com" />
                    </div>
                  </div>
                </div>
              )}

              {instanceCount === "3" && (
                <div className="field full form-section">
                  <h4>Instance 3 Domains</h4>
                  <div className="form-subgrid">
                    <div className="field">
                      <label htmlFor="studioDomain3">{copy.launcher.studioDomain}</label>
                      <input id="studioDomain3" name="studioDomain3" placeholder="studio3.example.com" />
                    </div>
                    <div className="field">
                      <label htmlFor="apiDomain3">{copy.launcher.apiDomain}</label>
                      <input id="apiDomain3" name="apiDomain3" placeholder="api3.example.com" />
                    </div>
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor="siteUrl">{copy.launcher.siteUrl}</label>
                <input id="siteUrl" name="siteUrl" placeholder="https://app.example.com" />
              </div>
              <div className="field">
                <label htmlFor="certbotEmail">{copy.launcher.certbotEmail}</label>
                <input id="certbotEmail" name="certbotEmail" type="email" placeholder="admin@example.com" />
              </div>
            </>
          ) : null}

          {needsSchemas(type) ? (
            <div className="field full">
              <label htmlFor="schemaFilter">{copy.launcher.schemaFilter}</label>
              <input id="schemaFilter" name="schemaFilter" defaultValue="public" placeholder="public, auth, storage" />
            </div>
          ) : null}

          {type === "settings_update" ? (
            <div className="field full">
              <label htmlFor="settingsUpdates">{copy.launcher.settingsUpdates}</label>
              <textarea id="settingsUpdates" name="settingsUpdates" placeholder={copy.launcher.settingsPlaceholder} />
            </div>
          ) : null}

          {type === "setup_automated_backup" ? (
            <div className="field full form-section">
              <h4>S3 / R2 Backup Credentials</h4>
              <div className="form-subgrid">
                <div className="field">
                  <label htmlFor="s3AccessKey">Access Key</label>
                  <input id="s3AccessKey" name="s3AccessKey" type="password" placeholder="AKIA..." autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="s3SecretKey">Secret Key</label>
                  <input id="s3SecretKey" name="s3SecretKey" type="password" placeholder="..." autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="s3Bucket">Bucket Name</label>
                  <input id="s3Bucket" name="s3Bucket" placeholder="my-supabase-backups" />
                </div>
                <div className="field">
                  <label htmlFor="s3Region">Region</label>
                  <input id="s3Region" name="s3Region" placeholder="eu-central-1" />
                </div>
                <div className="field full">
                  <label htmlFor="s3Endpoint">Custom Endpoint (Optional)</label>
                  <input id="s3Endpoint" name="s3Endpoint" placeholder="https://<account_id>.r2.cloudflarestorage.com" />
                </div>
                <div className="field full">
                  <label htmlFor="cronSchedule">Cron Schedule</label>
                  <input id="cronSchedule" name="cronSchedule" defaultValue="0 3 * * *" placeholder="0 3 * * *" />
                  <p className="muted" style={{ marginTop: 4, fontSize: 11 }}>Varsayılan: Her gece saat 03:00</p>
                </div>
              </div>
            </div>
          ) : null}

          {type === "supabase_upgrade" ? (
            <div className="field full form-section">
              <h4>Upgrade Options</h4>
              <div className="field">
                <label htmlFor="targetVersion">Hedef Versiyon (İsteğe Bağlı)</label>
                <input id="targetVersion" name="targetVersion" placeholder="latest (veya v1.140.0)" defaultValue="latest" />
                <p className="muted" style={{ marginTop: 4, fontSize: 11 }}>
                  {"Boş bırakırsanız veya 'latest' yazarsanız en güncel kararlı sürüme güncellenir."}
                </p>
              </div>
            </div>
          ) : null}

          {type === "ai_seeder" ? (
            <div className="field full form-section">
              <h4>AI Seeder Seçenekleri</h4>
              <div className="form-subgrid">
                <div className="field">
                  <label htmlFor="targetTable">Hedef Tablo Adı</label>
                  <input id="targetTable" name="targetTable" placeholder="users" />
                </div>
                <div className="field">
                  <label htmlFor="rowCount">Satır Sayısı</label>
                  <input id="rowCount" name="rowCount" type="number" defaultValue="10" />
                </div>
              </div>
              <div className="field full" style={{ marginTop: 12 }}>
                <label htmlFor="prompt">Veri Formatı / İstek (Prompt)</label>
                <textarea id="prompt" name="prompt" placeholder="İstanbul'da yaşayan rastgele bakiyeli kullanıcılar" />
              </div>
            </div>
          ) : null}

          {type === "infra_inspector" ? (
            <div className="field full form-section">
              <h4>Docker Sağlık Taraması</h4>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {"Sunucunuza güvenli bir şekilde bağlanılacak ve tüm Supabase container'larının RAM/CPU kullanımı, çöken servisler ve logları saniye saniye analiz edilecektir. İşlem sonunda detaylı bir teşhis raporu sunulacaktır."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="wizard-actions">
          <button className="button secondary" onClick={goBack} type="button">
            <ArrowLeft size={16} />
            {copy.launcher.back}
          </button>
          <button className="button primary" onClick={goNext} type="button">
            {copy.launcher.next}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section className="panel job-step-panel" hidden={step !== "options"}>
        <div className="selected-package-summary">
          <div>
            <span className="muted">{copy.launcher.reviewTitle}</span>
            <h2>{selectedModule.title}</h2>
            <p className="muted">{copy.launcher.reviewDescription}</p>
          </div>
          <span className="tag">{selectedModule.usageUnits} {copy.launcher.credits}</span>
        </div>

        <div className="option-grid">
          <label className="toggle-row option-card">
            <input name="getSSL" type="checkbox" />
            <span>{copy.launcher.getSSL}</span>
          </label>
          <label className="toggle-row option-card">
            <input name="setupBackup" type="checkbox" />
            <span>{copy.launcher.setupBackup}</span>
          </label>
          <label className="toggle-row option-card">
            <input name="migrateStorage" type="checkbox" />
            <span>{copy.launcher.migrateStorage}</span>
          </label>
          <label className="toggle-row option-card">
            <input name="continueOnMinorErrors" type="checkbox" />
            <span>{copy.launcher.continueOnMinorErrors}</span>
          </label>
          <label className="toggle-row option-card">
            <input name="skipInstall" type="checkbox" />
            <span>{copy.launcher.skipInstall}</span>
          </label>
          {["self_hosted_migration", "cloud_to_self_hosted"].includes(type) && (
            <label className="toggle-row option-card">
              <input name="anonymizeData" type="checkbox" />
              <span>Kişisel Verileri Maskele (Anonimleştir)</span>
            </label>
          )}
          {type === "prod_to_local" && (
            <label className="toggle-row option-card">
              <input name="anonymizeData" type="checkbox" defaultChecked disabled />
              <span>Kişisel Verileri Maskele (Zorunlu Güvenlik)</span>
            </label>
          )}
          {type === "edge_functions_migrator" && (
            <label className="toggle-row option-card">
              <input name="migrateSecrets" type="checkbox" />
              <span>Gizli Ortam Değişkenlerini (Secrets) Taşı</span>
            </label>
          )}
        </div>

        {error ? <p className="notice" role="alert">{error}</p> : null}

        <div className="wizard-actions">
          <button className="button secondary" onClick={goBack} type="button">
            <ArrowLeft size={16} />
            {copy.launcher.back}
          </button>
          <button className="button primary" disabled={loading} type="submit">
            <Play size={17} />
            {loading ? copy.launcher.loading : copy.launcher.submit}
          </button>
        </div>
      </section>
    </form>
  );
}

function needsSource(type: MigrationModuleType) {
  return ["self_hosted_migration", "schema_compare", "db_compare", "structure_export", "prod_to_local", "edge_functions_migrator"].includes(type);
}

function needsTarget(type: MigrationModuleType) {
  return !["structure_export", "db_compare", "schema_compare"].includes(type);
}

function needsCloud(type: MigrationModuleType) {
  return ["cloud_to_self_hosted"].includes(type);
}

function needsDomains(type: MigrationModuleType) {
  return ["self_hosted_migration", "cloud_to_self_hosted", "clean_install", "settings_update"].includes(type);
}

function needsSchemas(type: MigrationModuleType) {
  return ["schema_compare", "structure_export"].includes(type);
}

function parseSettingsUpdates(text: string) {
  return Object.fromEntries(
    text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
      .map(line => {
        const index = line.indexOf("=");
        if (index === -1) return [line, ""];
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}
