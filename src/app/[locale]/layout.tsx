import type { Metadata } from "next";
import { getPreferences } from "@/lib/preferences";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://baseup.dev"),
  title: {
    default: "Baseup - Supabase Migration & Control Plane",
    template: "%s | Baseup",
  },
  description: "Supabase migration, install, compare, and settings operations as a SaaS control plane. Zero-retention secure migration platform.",
  keywords: ["Supabase", "migration", "control plane", "database migration", "SaaS", "PostgreSQL", "BaaS"],
  authors: [{ name: "Baseup Team" }],
  creator: "Baseup",
  publisher: "Baseup",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://baseup.dev",
    title: "Baseup - Supabase Migration & Control Plane",
    description: "Supabase migration, install, compare, and settings operations as a SaaS control plane. Zero-retention secure migration platform.",
    siteName: "Baseup",
    images: [
      {
        url: "/baseup-mark.png",
        width: 800,
        height: 600,
        alt: "Baseup Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Baseup - Supabase Migration & Control Plane",
    description: "Supabase migration, install, compare, and settings operations as a SaaS control plane. Zero-retention secure migration platform.",
    images: ["/baseup-mark.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png"
  },
  alternates: {
    canonical: "https://baseup.dev",
  }
};

import NextTopLoader from "nextjs-toploader";

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, theme } = await getPreferences();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Baseup",
    "operatingSystem": "Web",
    "applicationCategory": "DeveloperApplication",
    "description": "Supabase migration, install, compare, and settings operations as a SaaS control plane.",
    "url": "https://baseup.dev",
    "provider": {
      "@type": "Organization",
      "name": "Baseup",
      "url": "https://baseup.dev",
      "contactPoint": {
        "@type": "ContactPoint",
        "email": "support@baseup.dev",
        "telephone": "+90-850-840-1072",
        "contactType": "customer support"
      }
    }
  };

  return (
    <html data-theme={theme} lang={locale}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <NextTopLoader color="var(--green)" showSpinner={false} />
        {children}
      </body>
    </html>
  );
}
