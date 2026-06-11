"use client";

import { useState } from "react";
import Script from "next/script";
import { formatMoney } from "@/lib/money";

type DiscountInfo = {
  originalPrice: number;
  finalPrice: number;
  discountAmount: number;
  currency: string;
};

export function PaytrCheckout({ packageId }: { packageId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [discountInfo, setDiscountInfo] = useState<DiscountInfo | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError("");
    
    try {
      const res = await fetch("/api/billing/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode.trim(), packageId })
      });
      const data = await res.json();
      
      if (res.ok && data.valid) {
        setDiscountInfo(data);
      } else {
        setCouponError(data.error || "Geçersiz kupon");
        setDiscountInfo(null);
      }
    } catch {
      setCouponError("Bağlantı hatası");
    } finally {
      setCouponLoading(false);
    }
  };

  const startPayment = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/billing/paytr/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, couponCode: discountInfo ? couponCode.trim() : null })
      });
      
      const data = await response.json();
      
      if (response.ok && data.token) {
        setToken(data.token);
      } else {
        setError(data.error || "Failed to initialize payment");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="panel">
        <p className="notice" style={{ backgroundColor: "var(--error-bg, #fde8e8)", color: "var(--error-text, #c53030)" }}>Ödeme başlatılamadı: {error}</p>
        <button className="button" onClick={() => setError("")}>Geri Dön</button>
      </div>
    );
  }

  if (token) {
    return (
      <div className="panel" style={{ padding: 0, overflow: "hidden", minHeight: 600 }}>
        <Script src="https://www.paytr.com/js/iframeResizer.min.js" strategy="lazyOnload" />
        <iframe
          src={`https://www.paytr.com/odeme/guvenli/${token}`}
          id="paytriframe"
          style={{ width: "100%", height: "100%", border: 0, minHeight: 600 }}
        />
        <Script id="paytr-resizer" strategy="lazyOnload">
          {`
            if (typeof iFrameResize !== 'undefined') {
              iFrameResize({}, '#paytriframe');
            }
          `}
        </Script>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 500, margin: "0 auto" }}>
      <h2>Sipariş Özeti</h2>
      
      <div style={{ marginTop: 24, marginBottom: 24, padding: 16, background: "var(--bg-subtle)", borderRadius: 8 }}>
        <div className="field">
          <label>İndirim Kodu</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input 
              type="text" 
              placeholder="Varsa kupon kodunuzu girin" 
              value={couponCode} 
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              disabled={couponLoading || discountInfo !== null}
            />
            {discountInfo ? (
              <button className="button ghost" onClick={() => { setDiscountInfo(null); setCouponCode(""); }}>İptal</button>
            ) : (
              <button className="button" onClick={applyCoupon} disabled={couponLoading || !couponCode.trim()}>
                {couponLoading ? "Kontrol ediliyor..." : "Uygula"}
              </button>
            )}
          </div>
          {couponError && <div style={{ color: "var(--error, #c53030)", fontSize: 13, marginTop: 4 }}>{couponError}</div>}
        </div>

        {discountInfo && (
          <div style={{ marginTop: 16, padding: 12, borderTop: "1px dashed var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Orijinal Tutar:</span>
              <span style={{ textDecoration: "line-through" }}>{formatMoney(discountInfo.originalPrice, discountInfo.currency)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, color: "var(--success, #006600)" }}>
              <span>İndirim:</span>
              <span>- {formatMoney(discountInfo.discountAmount, discountInfo.currency)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: 18, marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <span>Ödenecek Tutar:</span>
              <span>{formatMoney(discountInfo.finalPrice, discountInfo.currency)}</span>
            </div>
          </div>
        )}
      </div>

      <button className="button primary" style={{ width: "100%", height: 48, fontSize: 16 }} onClick={startPayment} disabled={loading}>
        {loading ? "Ödeme Sayfası Hazırlanıyor..." : "Güvenli Ödemeye Geç (PayTR)"}
      </button>
    </div>
  );
}
