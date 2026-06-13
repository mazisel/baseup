import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { getCopy } from "@/lib/i18n";
import { PaytrCheckout } from "@/components/settings/paytr-checkout";
import { createClient } from "@supabase/supabase-js";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-key"
);

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ packageId?: string, status?: string }> }) {
  const [user, { locale }] = await Promise.all([
    getCurrentUser(),
    getPreferences()
  ]);

  if (!user) return null;

  const copy = getCopy(locale).billing;

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
          {copy.back}
        </Link>

        <div className="page-head">
          <div>
            <h1 style={{ fontSize: 38 }}>{copy.securePayment}</h1>
            <p className="muted">{copy.selectedPlan}: {selectedPackage.name}</p>
          </div>
        </div>

        <PaytrCheckout
          packageId={targetPackageId}
          locale={locale}
          plan={{
            name: selectedPackage.name,
            description: selectedPackage.description,
            priceKurus: selectedPackage.price_kurus,
            currency: selectedPackage.currency || "USD",
            billingPeriod: selectedPackage.billing_period,
            monthlyJobLimit: selectedPackage.monthly_job_limit,
            parallelJobLimit: selectedPackage.parallel_job_limit,
            features: selectedPackage.features || [],
          }}
        />
      </div>
    );
  }

  return (
    <div className="content">
      <Link className="button ghost" href="/app/settings" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        {copy.backToSettings}
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.title}</h1>
          <p className="muted">{copy.description}</p>
        </div>
      </div>

      {status === "success" && (
        <div className="notice" style={{ backgroundColor: "var(--success-bg, #e6f6e6)", color: "var(--success-text, #006600)", marginBottom: 24 }}>
          {copy.paymentSuccess}
        </div>
      )}

      {status === "fail" && (
        <div className="notice" style={{ marginBottom: 24, backgroundColor: "var(--error-bg, #fde8e8)", color: "var(--error-text, #c53030)" }}>
          {copy.paymentFail}
        </div>
      )}

      <section className="panel" style={{ marginBottom: 24 }}>
        <h2>{copy.currentPlan}: {formatPlanName(user.plan)}</h2>
        <div className="stats-grid" style={{ marginTop: 16 }}>
          <div className="stat">
            <span>{copy.monthlyLimit}</span>
            <strong>{user.monthlyJobLimit}</strong>
          </div>
          <div className="stat">
            <span>{copy.parallelLimit}</span>
            <strong>{user.parallelJobLimit}</strong>
          </div>
        </div>
      </section>

      <div className="module-grid">
        {(packages || []).map(pkg => {
          const displayPrice = pkg.price_kurus;
          const displayCurrency = pkg.currency || "USD";

          return (
          <section key={pkg.id} className="module-card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1 }}>
              <h3>{pkg.name}</h3>
              <p className="muted" style={{ minHeight: 40 }}>{pkg.description || copy.defaultPackageDescription}</p>

              <div style={{ fontSize: 24, fontWeight: "bold", margin: "16px 0" }}>
                {formatMoney(displayPrice, displayCurrency)}
                <span className="muted" style={{ fontSize: 14, fontWeight: "normal" }}> /{pkg.billing_period === "yearly" ? copy.perYear : copy.perMonth}</span>
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px 0" }}>
                <li style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                  <Check size={16} color="var(--success)" /> {copy.jobsPerMonth.replace("{count}", String(pkg.monthly_job_limit))}
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                  <Check size={16} color="var(--success)" /> {copy.parallelJobs.replace("{count}", String(pkg.parallel_job_limit))}
                </li>
                {(pkg.features || []).map((feature: string, idx: number) => (
                  <li key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14 }}>
                    <Check size={16} color="var(--success)" /> {feature}
                  </li>
                ))}
              </ul>
            </div>

            {user.plan === pkg.plan_id ? (
              <button className="button ghost" disabled style={{ width: "100%" }}>{copy.currentPlanButton}</button>
            ) : (
              <Link className="button primary" href={`/app/settings/billing?packageId=${pkg.id}`} style={{ width: "100%", justifyContent: "center" }}>
                {copy.buyNow}
              </Link>
            )}
          </section>
        )})}
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
