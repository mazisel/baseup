import type { Metadata } from "next";
import { getPreferences } from "@/lib/preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "Baseup",
  description: "Supabase migration, install, compare, and settings operations as a SaaS control plane.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png"
  }
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, theme } = await getPreferences();

  return (
    <html data-theme={theme} lang={locale}>
      <body>{children}</body>
    </html>
  );
}
