import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getTeamMembers } from "@/lib/team-actions";
import { TeamList } from "@/components/settings/team-list";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!["owner", "admin"].includes(user.role)) {
    redirect("/app/settings");
  }

  let members;
  try {
    members = await getTeamMembers();
  } catch (error) {
    return (
      <div className="content">
        <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} />
          Ayarlara dön
        </Link>

        <section className="panel">
          <h1 style={{ fontSize: 30, marginTop: 0 }}>Ekip yönetimi</h1>
          <p className="notice" role="alert">
            {error instanceof Error ? error.message : "Ekip üyeleri yüklenemedi."}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="content">
      <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        Ayarlara dön
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>Ekip yönetimi</h1>
          <p className="muted">Üyeleri ve rollerini yönetin.</p>
        </div>
      </div>

      <TeamList initialMembers={members} currentUserRole={user.role} currentUserId={user.id} />
    </div>
  );
}
