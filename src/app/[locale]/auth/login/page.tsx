import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { getCopy } from "@/lib/i18n";
import { getPreferences } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Giriş Yap",
};

export default async function LoginPage() {
  const { locale } = await getPreferences();
  const copy = getCopy(locale);

  return (
    <main className="auth-wrap">
      <LoginForm brand={copy.brand} copy={copy.auth} />
    </main>
  );
}
