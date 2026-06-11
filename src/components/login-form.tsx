"use client";

import { useState } from "react";
import { LogIn, MailCheck, UserPlus } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import type { AppCopy } from "@/lib/i18n";
import { signInWithEmail } from "@/app/auth/actions";

type AuthCopy = AppCopy["auth"];
type AuthMode = "register" | "login";

export function LoginForm({ copy, brand }: { copy: AuthCopy; brand: string }) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;

    setLoading(true);
    setError("");

    const response = await signInWithEmail(email, name, mode);

    if (response?.error) {
      setError(response.error);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="panel auth-panel" style={{ textAlign: "center" }}>
        <MailCheck size={48} style={{ margin: "0 auto", marginBottom: 24, color: "var(--color-primary)" }} />
        <h1 style={{ fontSize: 24 }}>{mode === "register" ? copy.registerSuccessTitle : copy.loginSuccessTitle}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {mode === "register" ? copy.registerSuccessDescription : copy.loginSuccessDescription} <strong>{email}</strong>
        </p>
      </div>
    );
  }

  return (
    <form className="panel auth-panel" onSubmit={onSubmit}>
      <div className="brand" style={{ marginBottom: 20 }}>
        <BrandLogo name={brand} priority />
      </div>
      <div className="segmented" aria-label={copy.modeLabel} style={{ marginBottom: 18, width: "100%" }}>
        <button
          aria-pressed={mode === "register"}
          className={mode === "register" ? "active" : ""}
          onClick={() => {
            setMode("register");
            setError("");
          }}
          style={{ flex: 1 }}
          type="button"
        >
          {copy.registerTab}
        </button>
        <button
          aria-pressed={mode === "login"}
          className={mode === "login" ? "active" : ""}
          onClick={() => {
            setMode("login");
            setError("");
          }}
          style={{ flex: 1 }}
          type="button"
        >
          {copy.loginTab}
        </button>
      </div>
      <h1 style={{ fontSize: 34 }}>{mode === "register" ? copy.registerTitle : copy.loginTitle}</h1>
      <p className="muted">{mode === "register" ? copy.registerDescription : copy.loginDescription}</p>

      <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 18 }}>
        {mode === "register" ? (
          <div className="field">
            <label htmlFor="name">{copy.name}</label>
            <input id="name" value={name} onChange={event => setName(event.target.value)} required />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="email">{copy.email}</label>
          <input id="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required />
        </div>
      </div>

      {error ? <p className="notice" role="alert">{error}</p> : null}

      <button className="button primary" disabled={loading} style={{ marginTop: 18, width: "100%" }} type="submit">
        {mode === "register" ? <UserPlus size={17} /> : <LogIn size={17} />}
        {loading ? copy.loading : mode === "register" ? copy.registerSubmit : copy.loginSubmit}
      </button>
    </form>
  );
}
