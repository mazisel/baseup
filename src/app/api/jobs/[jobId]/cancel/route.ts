import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const { locale } = await getPreferences();

  const job = await getJob(jobId, user);
  if (!job) {
    return NextResponse.json({
      error: locale === "tr" ? "İş bulunamadı" : "Job not found"
    }, { status: 404 });
  }

  if (job.status !== "running" && job.status !== "queued") {
    return NextResponse.json({
      error: locale === "tr" ? "Bu işlem zaten tamamlanmış veya durdurulmuş" : "This job is already completed or stopped"
    }, { status: 400 });
  }

  // İşlemi veritabanında iptal edildi olarak işaretle.
  // Not: BullMQ'da halen çalışıyorsa, worker status kontrolü yapmadığı için
  // devam edebilir ancak kullanıcı UI'da "cancelled" görür ve
  // yeni iş başlatabilir (job quota blokesi kalkar).
  try {
    const adminClient = getSupabaseAdminClient();
    await adminClient
      .from("job_runs")
      .update({
        status: "cancelled",
        error_message: locale === "tr" ? "Kullanıcı tarafından iptal edildi" : "Cancelled by user",
        finished_at: new Date().toISOString()
      })
      .eq("id", jobId);

    await adminClient.from("job_events").insert({
      job_id: jobId,
      level: "warn",
      message: locale === "tr" ? "İşlem kullanıcı tarafından durduruldu." : "Job was stopped by the user."
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[cancelJob] Hata:`, error);
    return NextResponse.json({
      error: locale === "tr" ? "İşlem iptal edilemedi" : "Could not cancel job"
    }, { status: 500 });
  }
}
