"use client";

import { useEffect } from "react";
import { getCopy } from "@/lib/i18n";
import { getClientLocale } from "@/lib/preference-shared";

// Kök layout'un kendisi çökerse devreye girer; kendi <html>/<body> etiketlerini
// render etmek zorundadır, bu yüzden global stillere güvenmez.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = getClientLocale();
  const copy = getCopy(locale).errors;

  useEffect(() => {
    console.error("Global boundary caught error:", error);
  }, [error]);

  return (
    <html lang={locale}>
      <body style={{ fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0, background: "#f7f7f5", color: "#1a1a1a" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <h2 style={{ marginBottom: 8 }}>{copy.title}</h2>
          <p style={{ marginBottom: 24, color: "#666" }}>{copy.description}</p>
          <button
            onClick={() => reset()}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#1f7a4d", color: "#fff", cursor: "pointer", fontSize: 14 }}
          >
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
