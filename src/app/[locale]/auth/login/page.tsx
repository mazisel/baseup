import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { getCopy } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Giriş Yap",
};

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const resolvedParams = await params;
  const locale = resolvedParams.locale as any;
  const copy = getCopy(locale);

  return (
    <main className="auth-wrap">
      <LoginForm brand={copy.brand} copy={copy.auth} />
    </main>
  );
}
