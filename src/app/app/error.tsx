"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App boundary caught error:", error);
  }, [error]);

  return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
      <div className="panel" style={{ textAlign: "center", maxWidth: 400 }}>
        <AlertCircle size={48} style={{ color: "var(--error, #e53e3e)", margin: "0 auto 16px" }} />
        <h2 style={{ marginBottom: 8 }}>Bir Sorun Oluştu</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          Sayfa yüklenirken beklenmedik bir hata meydana geldi. {error.message}
        </p>
        <button className="button primary" onClick={() => reset()}>
          <RefreshCw size={16} />
          Tekrar Dene
        </button>
      </div>
    </div>
  );
}
