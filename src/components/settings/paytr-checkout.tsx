"use client";

import { useState, type CSSProperties } from "react";
import Script from "next/script";
import { Check, Tag, ShieldCheck, X } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { getCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";

type DiscountInfo = {
  originalPrice: number;
  finalPrice: number;
  discountAmount: number;
  currency: string;
};

type PlanSummary = {
  name: string;
  description: string;
  priceKurus: number;
  currency: string;
  billingPeriod: string;
  monthlyJobLimit: number;
  parallelJobLimit: number;
  features: string[];
};

const liStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 14 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };

export function PaytrCheckout({ packageId, locale, plan }: { packageId: string; locale: Locale; plan: PlanSummary }) {
  const t = getCopy(locale);
  const copy = t.checkout;
  const bcopy = t.billing;

  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [discountInfo, setDiscountInfo] = useState<DiscountInfo | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);

  const currency = plan.currency || "USD";
  const total = discountInfo ? discountInfo.finalPrice : plan.priceKurus;
  const periodSuffix =
    plan.billingPeriod === "yearly" ? bcopy.perYear :
    plan.billingPeriod === "monthly" ? bcopy.perMonth : null;
  const billedLabel =
    plan.billingPeriod === "yearly" ? copy.billedYearly :
    plan.billingPeriod === "monthly" ? copy.billedMonthly : copy.billedOnce;

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
        setCouponError(data.error || copy.invalidCoupon);
        setDiscountInfo(null);
      }
    } catch {
      setCouponError(copy.connectionError);
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setDiscountInfo(null);
    setCouponCode("");
    setCouponError("");
    setShowCoupon(false);
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
        setError(data.error || copy.startFailed);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : copy.connectionError);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="panel" style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
        <p className="notice" style={{ backgroundColor: "var(--error-bg, #fde8e8)", color: "var(--error-text, #c53030)" }}>{copy.startFailed}: {error}</p>
        <button className="button" onClick={() => setError("")}>{copy.goBack}</button>
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
    <div className="panel" style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>{copy.orderSummary}</h2>

      {/* Plan header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{plan.name}</div>
          {plan.description && <p className="muted" style={{ margin: "4px 0 0" }}>{plan.description}</p>}
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatMoney(plan.priceKurus, currency)}</div>
          {periodSuffix && <div className="muted" style={{ fontSize: 13 }}>/{periodSuffix}</div>}
        </div>
      </div>

      {/* What's included */}
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--muted)", marginBottom: 12 }}>{copy.included}</div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          <li style={liStyle}><Check size={16} color="var(--success)" /> {bcopy.jobsPerMonth.replace("{count}", String(plan.monthlyJobLimit))}</li>
          <li style={liStyle}><Check size={16} color="var(--success)" /> {bcopy.parallelJobs.replace("{count}", String(plan.parallelJobLimit))}</li>
          {plan.features.map((feature, idx) => (
            <li key={idx} style={liStyle}><Check size={16} color="var(--success)" /> {feature}</li>
          ))}
        </ul>
      </div>

      {/* Coupon */}
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
        {discountInfo ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--success-bg)", color: "var(--success-text)", padding: "10px 12px", borderRadius: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <Tag size={16} /> {couponCode} · {copy.couponApplied}
            </span>
            <button className="button ghost" style={{ minHeight: "auto", padding: "4px 8px", color: "inherit" }} onClick={removeCoupon}>
              <X size={14} /> {copy.remove}
            </button>
          </div>
        ) : showCoupon ? (
          <div className="field">
            <label>{copy.couponLabel}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder={copy.couponPlaceholder}
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") applyCoupon(); }}
                disabled={couponLoading}
                autoFocus
              />
              <button className="button" onClick={applyCoupon} disabled={couponLoading || !couponCode.trim()}>
                {couponLoading ? copy.checking : copy.apply}
              </button>
            </div>
            {couponError && <div style={{ color: "var(--error, #c53030)", fontSize: 13, marginTop: 4 }}>{couponError}</div>}
          </div>
        ) : (
          <button
            className="button ghost"
            style={{ padding: 0, minHeight: "auto", color: "var(--primary)" }}
            onClick={() => setShowCoupon(true)}
          >
            <Tag size={15} /> {copy.haveCoupon}
          </button>
        )}
      </div>

      {/* Totals */}
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border)", display: "grid", gap: 8 }}>
        {discountInfo && (
          <>
            <div style={rowStyle}>
              <span className="muted">{copy.subtotal}</span>
              <span>{formatMoney(discountInfo.originalPrice, currency)}</span>
            </div>
            <div style={{ ...rowStyle, color: "var(--success-text)" }}>
              <span>{copy.discount}</span>
              <span>- {formatMoney(discountInfo.discountAmount, currency)}</span>
            </div>
          </>
        )}
        <div style={{ ...rowStyle, fontSize: 20, fontWeight: 800 }}>
          <span>{copy.total}</span>
          <span>{formatMoney(total, currency)}</span>
        </div>
        <div className="muted" style={{ fontSize: 13, textAlign: "right" }}>{billedLabel}</div>
      </div>

      <button className="button primary" style={{ width: "100%", height: 48, fontSize: 16, marginTop: 20 }} onClick={startPayment} disabled={loading}>
        {loading ? copy.preparing : copy.proceed}
      </button>

      <p className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginTop: 14, marginBottom: 0, lineHeight: 1.5 }}>
        <ShieldCheck size={15} style={{ flexShrink: 0 }} /> {copy.secureNote}
      </p>
    </div>
  );
}
