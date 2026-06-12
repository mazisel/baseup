import { getAllPosts } from "@/lib/blog";
import { getCopy } from "@/lib/i18n";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { PreferenceControls } from "@/components/preference-controls";

export const metadata = {
  title: "Blog",
  description: "Read the latest news, guides, and tutorials about Supabase migration and Baseup.",
};

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const resolvedParams = await params;
  const locale = resolvedParams.locale;
  const copy = getCopy(locale as "en" | "tr");
  const posts = getAllPosts();

  return (
    <div className="site-shell">
      <nav className="public-nav">
        <Link href={`/${locale}`} className="brand">
          <BrandLogo name={copy.brand} priority />
        </Link>
        <div className="nav-actions">
          <PreferenceControls copy={copy.preferences} locale={locale as "en" | "tr"} />
          <Link href={`/${locale}/auth/login`} className="button secondary">
            {copy.nav.login}
          </Link>
          <Link href={`/${locale}/app/new-job`} className="button primary">
            {copy.nav.openPanel}
          </Link>
        </div>
      </nav>

      <main className="page" style={{ maxWidth: "800px" }}>
        <h1 style={{ marginBottom: 16 }}>Baseup Blog</h1>
        <p className="lead" style={{ marginBottom: 48 }}>
          News, guides, and insights from the Baseup team.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {posts.map((post) => (
            <article key={post.meta.slug} style={{ borderBottom: "1px solid var(--line)", paddingBottom: "32px" }}>
              <div style={{ marginBottom: 8 }}>
                <span className="eyebrow">{post.meta.date}</span>
              </div>
              <h2 style={{ fontSize: "24px", marginBottom: "12px" }}>
                <Link href={`/${locale}/blog/${post.meta.slug}`} style={{ color: "var(--green)" }}>
                  {post.meta.title}
                </Link>
              </h2>
              <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>{post.meta.description}</p>
            </article>
          ))}
          {posts.length === 0 && <p className="muted">No posts found.</p>}
        </div>
      </main>
    </div>
  );
}
