import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { PaytrCheckout } from "@/components/settings/paytr-checkout";
import { createClient } from "@supabase/supabase-js";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-key"
);

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ packageId?: string, status?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

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
            <p className="muted">Seçilen plan: {selectedPackage.name}</p>
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
          <h1 style={{ fontSize: 38 }}>Faturalandırma ve plan</h1>
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
        <h2>Mevcut planınız: {formatPlanName(user.plan)}</h2>
        <div className="stats-grid" style={{ marginTop: 16 }}>
          <div className="stat">
            <span>Aylık İşlem Limiti</span>
            <strong>{user.monthlyJobLimit}</strong>
          </div>
          <div className="stat">
            <span>Eşzamanlı İşlem (Parallel)</span>
            <strong>{user.parallelJobLimit}</strong>
          </div>
        </div>
      </section>

      <div className="module-grid">
        {(packages || []).map(pkg => (
          <section key={pkg.id} className="module-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1 }}>
              <h3>{pkg.name}</h3>
              <p className="muted" style={{ minHeight: 40 }}>{pkg.description || "Bu plan ile limitlerinizi artırın."}</p>
              
              <div style={{ fontSize: 24, fontWeight: "bold", margin: "16px 0" }}>
                {formatMoney(pkg.price_kurus, pkg.currency || "USD")}
                <span className="muted" style={{ fontSize: 14, fontWeight: "normal" }}> /{pkg.billing_period === "yearly" ? "Yıl" : "Ay"}</span>
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px 0" }}>
                <li style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                  <Check size={16} color="var(--success)" /> Ayda {pkg.monthly_job_limit} işlem
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

function formatPlanName(plan: string) {
  return plan
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Trial";
}
