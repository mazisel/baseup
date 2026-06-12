import Link from "next/link";
import { Activity, ArrowRight, LayoutGrid, Lock, RadioTower, ShieldCheck, Zap } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LiveTerminal } from "@/components/live-terminal";
import { PackageGrid } from "@/components/package-grid";
import { PreferenceControls } from "@/components/preference-controls";
import { getCopy } from "@/lib/i18n";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const resolvedParams = await params;
  const locale = resolvedParams.locale as any;
  const copy = getCopy(locale);
  const benefitIcons = [ShieldCheck, Lock, Activity, Zap];

  return (
    <div className="site-shell">
      <header className="public-nav">
        <Link className="brand" href="/">
          <BrandLogo name={copy.brand} priority />
        </Link>
        <div className="nav-actions">
          <PreferenceControls copy={copy.preferences} locale={locale} />
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

      <footer className="public-footer" style={{ borderTop: "1px solid var(--border)", padding: "48px 0 32px", marginTop: 64 }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 32, marginBottom: 48 }}>
            <div style={{ maxWidth: 300 }}>
              <BrandLogo name={copy.brand} priority />
              <p className="muted" style={{ fontSize: 14, marginTop: 16, lineHeight: 1.6 }}>
                {copy.home.lead}
              </p>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
              <strong style={{ color: "var(--foreground)", fontWeight: 500 }}>{copy.footer.contactTitle}</strong>
              <a href={`mailto:${copy.contact.email}`} className="muted hover-primary" style={{ textDecoration: "none" }}>{copy.contact.email}</a>
              <a href={`tel:${copy.contact.phone.replace(/\s+/g, '')}`} className="muted hover-primary" style={{ textDecoration: "none" }}>{copy.contact.phone}</a>
              <span className="muted" style={{ lineHeight: 1.5, maxWidth: 250 }}>{copy.contact.address}</span>
            </div>
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, paddingTop: 32, borderTop: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 14 }}>
              &copy; {new Date().getFullYear()} {copy.brand}. {copy.footer.rights}
            </div>
            <div style={{ display: "flex", gap: 24, fontSize: 14 }}>
              <Link href="/legal/privacy" className="muted hover-primary" style={{ textDecoration: "none" }}>{copy.footer.privacy}</Link>
              <Link href="/legal/terms" className="muted hover-primary" style={{ textDecoration: "none" }}>{copy.footer.terms}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
