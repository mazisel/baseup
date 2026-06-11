import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("health_monitors")
    .select("*, health_events(status, response_time_ms, created_at)")
    .eq("workspace_id", user.workspace.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ monitors: data });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !['owner', 'admin', 'operator'].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, url } = await req.json();
  if (!name || !url) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = await createClient();
  
  // Check limit (Trial = 1, Growth = 3, Scale = 10)
  const limits: Record<string, number> = { trial: 1, growth: 3, scale: 10 };
  const limit = limits[user.plan] || 1;
  
  const { count } = await supabase
    .from("health_monitors")
    .select("*", { count: 'exact', head: true })
    .eq("workspace_id", user.workspace.id);
    
  if (count !== null && count >= limit) {
    return NextResponse.json({ error: `You have reached your limit of ${limit} monitors for the ${user.plan} plan.` }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("health_monitors")
    .insert({ workspace_id: user.workspace.id, name, url })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ monitor: data });
}
