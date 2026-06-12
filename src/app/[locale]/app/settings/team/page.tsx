import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { getCopy } from "@/lib/i18n";
import { getTeamMembers } from "@/lib/team-actions";
import { TeamList } from "@/components/settings/team-list";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!["owner", "admin"].includes(user.role)) {
    redirect("/app/settings");
  }

  const { locale } = await getPreferences();
  const copy = getCopy(locale);

  let members;
  try {
    members = await getTeamMembers();
  } catch (error) {
    return (
      <div className="content">
        <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} />
          {copy.team.backToSettings}
        </Link>

        <section className="panel">
          <h1 style={{ fontSize: 30, marginTop: 0 }}>{copy.settings.teamTitle}</h1>
          <p className="notice" role="alert">
            {error instanceof Error ? error.message : copy.team.loadError}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="content">
      <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        {copy.team.backToSettings}
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.settings.teamTitle}</h1>
          <p className="muted">{copy.settings.teamDescription}</p>
        </div>
      </div>

      <TeamList initialMembers={members} currentUserRole={user.role} currentUserId={user.id} locale={locale} />
    </div>
  );
}
