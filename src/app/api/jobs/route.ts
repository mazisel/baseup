import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createJob, listJobs } from "@/lib/jobs";
import { MODULE_DEFINITIONS } from "@/lib/constants";
import { getPreferences } from "@/lib/preferences";
import { rateLimit } from "@/lib/rate-limit";
import type { JobRequestInput } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ jobs: await listJobs(user) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting: dakikada max 20 istek
  const { ok, remaining } = rateLimit(`jobs:${user.id}`);
  if (!ok) {
    return NextResponse.json(
      { error: "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin." },
      { status: 429, headers: { "Retry-After": "60", "X-RateLimit-Remaining": String(remaining) } }
    );
  }

  const input = await request.json().catch(() => null) as JobRequestInput | null;
  const { locale } = await getPreferences();
  if (!input || !MODULE_DEFINITIONS.some(module => module.id === input.type)) {
    return NextResponse.json({
      error: locale === "tr" ? "Geçersiz hizmet tipi" : "Invalid service type"
    }, { status: 400 });
  }

  // Aylık iş limiti kontrolü (Entitlement Enforcement)
  const jobs = await listJobs(user);
  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);
  const monthlyJobs = jobs.filter(j => new Date(j.createdAt) >= thisMonth).length;

  if (monthlyJobs >= user.monthlyJobLimit) {
    return NextResponse.json({
      error: locale === "tr"
        ? `Aylık iş limitinize (${user.monthlyJobLimit}) ulaştınız. Planınızı yükseltin.`
        : `You've reached your monthly job limit (${user.monthlyJobLimit}). Please upgrade your plan.`
    }, { status: 403 });
  }

  // Paralel iş limiti kontrolü
  const runningJobs = jobs.filter(j => j.status === "running" || j.status === "queued").length;
  if (runningJobs >= user.parallelJobLimit) {
    return NextResponse.json({
      error: locale === "tr"
        ? `Aynı anda en fazla ${user.parallelJobLimit} iş çalıştırabilirsiniz. Mevcut işlerinizin tamamlanmasını bekleyin.`
        : `You can run up to ${user.parallelJobLimit} jobs simultaneously. Wait for current jobs to finish.`
    }, { status: 429 });
  }

  const job = await createJob(input, user, locale);
  return NextResponse.json({ job }, { status: 201 });
}
