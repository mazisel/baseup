"use client";

import { useState } from "react";
import { UserPlus, UserMinus, Shield } from "lucide-react";
import { inviteMember, updateMemberRole, removeMember } from "@/lib/team-actions";
import { useRouter } from "next/navigation";

type Member = {
  id: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
};

export function TeamList({ initialMembers, currentUserRole, currentUserId }: { initialMembers: Member[], currentUserRole: string, currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const canManage = currentUserRole === "owner" || currentUserRole === "admin";

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;
    setLoading(true);
    setError("");

    try {
      await inviteMember(inviteEmail, inviteRole);
      setInviteEmail("");
      router.refresh(); // In a real app we might want to manually fetch or just wait for refresh
    } catch (err: any) {
      setError(err.message || "Failed to invite user");
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    try {
      await updateMemberRole(userId, newRole);
      setMembers(m => m.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err: any) {
      alert(err.message || "Failed to update role");
    }
  }

  async function handleRemove(userId: string) {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      await removeMember(userId);
      setMembers(m => m.filter(u => u.id !== userId));
    } catch (err: any) {
      alert(err.message || "Failed to remove user");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {canManage && (
        <section className="panel">
          <h2>Invite Member</h2>
          {error && <p className="notice" style={{ marginBottom: 16 }}>{error}</p>}
          <form onSubmit={handleInvite} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <input 
              type="email" 
              placeholder="Email address" 
              value={inviteEmail} 
              onChange={e => setInviteEmail(e.target.value)} 
              required
              className="text-input"
              style={{ flex: 1 }}
            />
            <select className="text-input" value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ width: 140 }}>
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="submit" className="button primary" disabled={loading}>
              <UserPlus size={16} />
              Invite
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Workspace Members</h2>
        <div className="table-list" style={{ marginTop: 16 }}>
          {members.map(member => (
            <div className="table-row" key={member.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>{member.name}</strong>
                <div className="muted">{member.email}</div>
              </div>
              
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {canManage && member.id !== currentUserId && member.role !== "owner" ? (
                  <select 
                    className="text-input" 
                    value={member.role} 
                    onChange={e => handleRoleChange(member.id, e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 13, height: "auto" }}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span className="tag" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Shield size={12} /> {member.role}
                  </span>
                )}

                {canManage && member.id !== currentUserId && member.role !== "owner" && (
                  <button 
                    type="button" 
                    onClick={() => handleRemove(member.id)}
                    className="button ghost" 
                    style={{ padding: "4px 8px", color: "var(--danger-text)" }}
                  >
                    <UserMinus size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
