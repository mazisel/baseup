import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell" style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <header className="public-nav" style={{ borderBottom: "1px solid var(--border)" }}>
        <Link className="brand" href="/" style={{ fontSize: 18, fontWeight: 600 }}>
          SupaOps
        </Link>
        <div className="nav-actions">
          <Link className="button secondary" href="/">
            <ArrowLeft size={16} />
            Ana Sayfaya Dön
          </Link>
        </div>
      </header>
      <main className="page" style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
        {children}
      </main>
    </div>
  );
}
