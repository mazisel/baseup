import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retryJob } from "@/lib/jobs";
import { getPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const { locale } = await getPreferences();
  const job = await retryJob(jobId, user, locale);

  if (!job) {
    return NextResponse.json({ error: "Job bulunamadı" }, { status: 404 });
  }

  return NextResponse.json({ job }, { status: 201 });
}
