import clsx from "clsx";
import { getCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";
import type { JobStatus } from "@/types/domain";

export function StatusBadge({ locale = "tr", status }: { locale?: Locale; status: JobStatus }) {
  return <span className={clsx("status", status)}>{getCopy(locale).status[status]}</span>;
}
