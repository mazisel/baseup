import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/constants";
import { PaytrCheckout } from "@/components/settings/paytr-checkout";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ packageId?: string, status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const currentPlan = PLAN_LIMITS[user.plan] || PLAN_LIMITS.trial;
  const { packageId: targetPackageId, status } = await searchParams;

  // Fetch active packages from database
  const { data: packages } = await supabase
    .from("packages")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const selectedPackage = (packages || []).find(p => p.id === targetPackageId);

  if (targetPackageId && selectedPackage) {
    return (
      <div className="content">
        <Link className="button ghost" href="/app/settings/billing" style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} />
          Geri Dön
        </Link>

        <div className="page-head">
          <div>
            <h1 style={{ fontSize: 38 }}>Güvenli Ödeme</h1>
            <p className="muted">Seçilen Paket: {selectedPackage.name}</p>
          </div>
        </div>

        <PaytrCheckout packageId={targetPackageId} />
      </div>
    );
  }

  return (
    <div className="content">
      <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        Ayarlara Dön
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>Faturalandırma & Plan</h1>
          <p className="muted">Mevcut planınızı ve limitlerinizi yönetin.</p>
        </div>
      </div>

      {status === "success" && (
        <div className="notice" style={{ backgroundColor: "var(--success-bg, #e6f6e6)", color: "var(--success-text, #006600)", marginBottom: 24 }}>
          Ödemeniz başarıyla alındı ve planınız güncellendi!
        </div>
      )}
      
      {status === "fail" && (
        <div className="notice" style={{ marginBottom: 24, backgroundColor: "var(--error-bg, #fde8e8)", color: "var(--error-text, #c53030)" }}>
          Ödeme işlemi başarısız oldu. Lütfen tekrar deneyin.
        </div>
      )}

      <section className="panel" style={{ marginBottom: 24 }}>
        <h2>Mevcut Planınız: {currentPlan.label}</h2>
        <div className="stats-grid" style={{ marginTop: 16 }}>
          <div className="stat">
            <span>Aylık İşlem Limiti</span>
            <strong>{currentPlan.monthlyJobs}</strong>
          </div>
          <div className="stat">
            <span>Eşzamanlı İşlem (Parallel)</span>
            <strong>{currentPlan.parallelJobs}</strong>
          </div>
        </div>
      </section>

      <div className="module-grid">
        {(packages || []).map(pkg => (
          <section key={pkg.id} className="module-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1 }}>
              <h3>{pkg.name}</h3>
              <p className="muted" style={{ minHeight: 40 }}>{pkg.description || "Bu paket ile limitlerinizi artırın."}</p>
              
              <div style={{ fontSize: 24, fontWeight: "bold", margin: "16px 0" }}>
                {(pkg.price_kurus / 100).toLocaleString("tr-TR")} {pkg.currency}
                <span className="muted" style={{ fontSize: 14, fontWeight: "normal" }}> /{pkg.billing_period === "yearly" ? "Yıl" : "Ay"}</span>
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px 0" }}>
                <li style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                  <Check size={16} color="var(--success)" /> Ayda {pkg.monthly_job_limit} taşıma
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                  <Check size={16} color="var(--success)" /> {pkg.parallel_job_limit} eşzamanlı işlem
                </li>
                {(pkg.features || []).map((feature: string, idx: number) => (
                  <li key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                    <Check size={16} color="var(--success)" /> {feature}
                  </li>
                ))}
              </ul>
            </div>

            {user.plan === pkg.plan_id ? (
              <button className="button ghost" disabled style={{ width: "100%" }}>Mevcut Plan</button>
            ) : (
              <Link className="button primary" href={`/app/settings/billing?packageId=${pkg.id}`} style={{ width: "100%", justifyContent: "center" }}>
                Hemen Satın Al
              </Link>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
