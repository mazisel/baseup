import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SavedServersManager } from "@/components/settings/saved-servers-manager";
import { getCurrentUser } from "@/lib/auth";
import { getCopy } from "@/lib/i18n";
import { getPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function SavedServersSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!["owner", "admin", "operator"].includes(user.role)) {
    redirect("/app/settings");
  }

  const { locale } = await getPreferences();
  const copy = getCopy(locale);

  return (
    <div className="content">
      <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        {copy.savedServers.backToSettings}
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.savedServers.title}</h1>
          <p className="muted">{copy.savedServers.description}</p>
        </div>
      </div>

      <SavedServersManager locale={locale} />
    </div>
  );
}
