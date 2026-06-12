import { getPreferences } from "@/lib/preferences";
import { MonitorsClient } from "@/components/monitors-client";

export const dynamic = "force-dynamic";

export default async function MonitorsPage() {
  const { locale } = await getPreferences();
  return <MonitorsClient locale={locale} />;
}
