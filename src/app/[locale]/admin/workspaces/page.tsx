import { getAdminWorkspaces } from "@/lib/admin";
import { WorkspaceTable } from "@/components/admin/workspace-table";

export const dynamic = "force-dynamic";

export default async function AdminWorkspacesPage() {
  const workspaces = await getAdminWorkspaces();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 32 }}>Workspace Yönetimi</h1>
          <p className="muted">Tüm workspace&apos;ler ve plan yönetimi ({workspaces.length} adet)</p>
        </div>
      </div>

      <section className="panel">
        <WorkspaceTable workspaces={workspaces} />
      </section>
    </div>
  );
}
