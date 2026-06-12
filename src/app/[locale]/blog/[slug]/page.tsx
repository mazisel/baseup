import { getPostBySlug, getPostSlugs } from "@/lib/blog";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getCopy } from "@/lib/i18n";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { PreferenceControls } from "@/components/preference-controls";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const post = getPostBySlug(resolvedParams.slug);
  if (!post) {
    return { title: "Post Not Found" };
  }
  return {
    title: post.meta.title,
    description: post.meta.description,
  };
}

export async function generateStaticParams() {
  const slugs = getPostSlugs();
  return slugs.map((slug) => ({ slug: slug.replace(/\.md$/, "") }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const resolvedParams = await params;
  const locale = resolvedParams.locale as "en" | "tr";
  const slug = resolvedParams.slug;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const copy = getCopy(locale);

  return (
    <div className="site-shell">
      <nav className="public-nav">
        <Link href={`/${locale}`} className="brand">
          <BrandLogo name={copy.brand} priority />
        </Link>
        <div className="nav-actions">
          <PreferenceControls copy={copy.preferences} locale={locale} />
          <Link href={`/${locale}/auth/login`} className="button secondary">
            {copy.nav.login}
          </Link>
          <Link href={`/${locale}/app/new-job`} className="button primary">
            {copy.nav.openPanel}
          </Link>
        </div>
      </nav>

      <article className="page" style={{ maxWidth: "720px" }}>
        <div style={{ marginBottom: "40px", textAlign: "center" }}>
          <div style={{ marginBottom: "16px" }}>
            <Link href={`/${locale}/blog`} className="eyebrow" style={{ color: "var(--muted)" }}>
              &larr; Back to Blog
            </Link>
          </div>
          <h1 style={{ fontSize: "36px", marginBottom: "16px" }}>{post.meta.title}</h1>
          <div style={{ color: "var(--muted)", fontSize: "14px", display: "flex", justifyContent: "center", gap: "12px" }}>
            <span>{post.meta.date}</span>
            {post.meta.author && (
              <>
                <span>&bull;</span>
                <span>{post.meta.author}</span>
              </>
            )}
          </div>
        </div>
        
        <div className="legal-doc" style={{ lineHeight: 1.7, fontSize: "17px" }}>
          <ReactMarkdown>{post.content}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
