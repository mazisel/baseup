"use client";

import { useEffect } from "react";

// Kök layout'un kendisi çökerse devreye girer; kendi <html>/<body> etiketlerini
// render etmek zorundadır, bu yüzden global stillere güvenmez.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global boundary caught error:", error);
  }, [error]);

  return (
    <html lang="tr">
      <body style={{ fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0, background: "#f7f7f5", color: "#1a1a1a" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <h2 style={{ marginBottom: 8 }}>Bir Sorun Oluştu</h2>
          <p style={{ marginBottom: 24, color: "#666" }}>
            Uygulama beklenmedik bir hatayla karşılaştı. Sorun devam ederse sayfayı yenileyin.
          </p>
          <button
            onClick={() => reset()}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#1f7a4d", color: "#fff", cursor: "pointer", fontSize: 14 }}
          >
            Tekrar Dene
          </button>
        </div>
      </body>
    </html>
  );
}
