import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail, updateWorkspacePlan } from "@/lib/admin";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { workspaceId?: string; plan?: string } | null;
  const workspaceId = body?.workspaceId;
  const plan = body?.plan;

  if (!workspaceId || !plan || !["trial", "growth", "scale"].includes(plan)) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  try {
    await updateWorkspacePlan(workspaceId, plan);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bilinmeyen hata" }, { status: 500 });
  }
}
