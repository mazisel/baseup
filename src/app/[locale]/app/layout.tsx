import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { getCopy } from "@/lib/i18n";
import { getPreferences } from "@/lib/preferences";

export default async function ProtectedLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const { locale, theme } = await getPreferences();
  const copy = getCopy(locale);

  if (!user) {
    redirect("/auth/login");
  }

  return <AppShell copy={copy} locale={locale} theme={theme} user={user}>{children}</AppShell>;
}
