import Link from "next/link";
import { Activity, ArrowRight, LayoutGrid, Lock, RadioTower, ShieldCheck, Zap } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LiveTerminal } from "@/components/live-terminal";
import { PackageGrid } from "@/components/package-grid";
import { PreferenceControls } from "@/components/preference-controls";
import { getCopy } from "@/lib/i18n";
import { getPreferences } from "@/lib/preferences";

export default async function HomePage() {
  const { locale, theme } = await getPreferences();
  const copy = getCopy(locale);
  const benefitIcons = [ShieldCheck, Lock, Activity, Zap];

  return (
    <div className="site-shell">
      <header className="public-nav">
        <Link className="brand" href="/">
          <BrandLogo name={copy.brand} priority />
        </Link>
        <div className="nav-actions">
          <PreferenceControls copy={copy.preferences} locale={locale} theme={theme} />
          <Link className="button secondary" href="/auth/login">{copy.nav.login}</Link>
          <Link className="button primary" href="/app/new-job">
            {copy.nav.openPanel}
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <main className="page">
        <section className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">{copy.home.eyebrow}</div>
            <h1>{copy.home.headline}</h1>
            <p className="lead">
              {copy.home.lead}
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="/app/new-job">
                <RadioTower size={17} />
                {copy.home.primary}
              </Link>
              <Link className="button secondary" href="#tools">
                <LayoutGrid size={17} />
                {copy.home.secondary}
              </Link>
            </div>
          </div>

          <LiveTerminal copy={copy.home} />
        </section>

        <div className="benefit-strip" aria-label="Capabilities">
          {copy.home.benefits.map((benefit, index) => {
            const Icon = benefitIcons[index];
            return (
              <span className="benefit-item" key={benefit}>
                <Icon size={16} />
                {benefit}
              </span>
            );
          })}
        </div>

        <PackageGrid locale={locale} title={copy.home.packagesTitle} />

        <section className="cta-panel">
          <h2>{copy.home.closing.title}</h2>
          <p>{copy.home.closing.lead}</p>
          <Link className="button primary" href="/app/new-job">
            {copy.home.closing.cta}
            <ArrowRight size={17} />
          </Link>
        </section>
      </main>

      <footer className="public-footer" style={{ borderTop: "1px solid var(--border)", padding: "32px 0", marginTop: 64 }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div className="muted" style={{ fontSize: 14 }}>
            &copy; {new Date().getFullYear()} SupaOps. Tüm hakları saklıdır.
          </div>
          <div style={{ display: "flex", gap: 24, fontSize: 14 }}>
            <Link href="/legal/privacy" className="muted hover-primary" style={{ textDecoration: "none" }}>Gizlilik Politikası</Link>
            <Link href="/legal/terms" className="muted hover-primary" style={{ textDecoration: "none" }}>Kullanıcı Sözleşmesi</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
