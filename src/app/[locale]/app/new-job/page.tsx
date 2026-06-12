import { JobLauncher } from "@/components/job-launcher";
import { MODULE_DEFINITIONS } from "@/lib/constants";
import { getCopy } from "@/lib/i18n";
import { getPreferences } from "@/lib/preferences";
import type { MigrationModuleType } from "@/types/domain";

export default async function NewJobPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPreferences();
  const copy = getCopy(locale);
  const params = await searchParams;
  const requested = typeof params.module === "string" ? params.module : undefined;
  const initialType = MODULE_DEFINITIONS.some(module => module.id === requested)
    ? (requested as MigrationModuleType)
    : undefined;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.newJob.title}</h1>
          <p className="muted">{copy.newJob.description}</p>
        </div>
      </div>
      <JobLauncher initialType={initialType} locale={locale} />
    </div>
  );
}
