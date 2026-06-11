import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getTeamMembers } from "@/lib/team-actions";
import { TeamList } from "@/components/settings/team-list";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const members = await getTeamMembers();

  return (
    <div className="content">
      <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        Back to Settings
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>Team Management</h1>
          <p className="muted">Manage workspace members and their roles.</p>
        </div>
      </div>

      <TeamList initialMembers={members} currentUserRole={user.role} currentUserId={user.id} />
    </div>
  );
}
