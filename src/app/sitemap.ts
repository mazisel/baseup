import type { MetadataRoute } from "next";
import { getPostSlugs } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://baseup.dev";
  const locales = ['en', 'tr'];
  const routes = ['', '/auth/login', '/legal/privacy', '/legal/terms', '/blog'];
  
  const sitemapEntries: MetadataRoute.Sitemap = [];

  // Static routes
  locales.forEach((locale) => {
    routes.forEach((route) => {
      sitemapEntries.push({
        url: `${baseUrl}/${locale}${route}`,
        lastModified: new Date(),
        changeFrequency: route === '' ? "weekly" : "monthly",
        priority: route === '' ? 1 : 0.8,
      });
    });
  });

  // Dynamic blog routes
  const blogSlugs = getPostSlugs();
  locales.forEach((locale) => {
    blogSlugs.forEach((file) => {
      const slug = file.replace(/\.md$/, "");
      sitemapEntries.push({
        url: `${baseUrl}/${locale}/blog/${slug}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    });
  });

  return sitemapEntries;
}
