import { Loader2 } from "lucide-react";

export default function AppLoading() {
  return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh", flexDirection: "column", gap: 16 }}>
      <Loader2 className="spinner" size={32} style={{ color: "var(--primary)" }} />
      <p className="muted">Yükleniyor...</p>
    </div>
  );
}
