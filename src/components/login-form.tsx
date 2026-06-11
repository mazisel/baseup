"use client";

import { useState } from "react";
import { LogIn, MailCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import type { AppCopy } from "@/lib/i18n";
import { authenticateWithPassword } from "@/app/auth/actions";

type AuthCopy = AppCopy["auth"];
type AuthMode = "register" | "login";

export function LoginForm({ copy, brand }: { copy: AuthCopy; brand: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || !password) return;

    if (mode === "register" && password !== passwordConfirm) {
      setError(copy.passwordMismatch);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await authenticateWithPassword(email, password, name, mode);

      if (response?.error) {
        setError(response.error);
        setLoading(false);
        return;
      }

      if (response?.redirectTo) {
        router.push(response.redirectTo);
        router.refresh();
        return;
      }

      setNeedsConfirmation(Boolean(response?.needsConfirmation));
      setSuccess(true);
    } catch {
      setError(copy.error);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="panel auth-panel" style={{ textAlign: "center" }}>
        <MailCheck size={48} style={{ margin: "0 auto", marginBottom: 24, color: "var(--color-primary)" }} />
        <h1 style={{ fontSize: 24 }}>{copy.registerSuccessTitle}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {needsConfirmation ? copy.registerConfirmDescription : copy.registerSuccessDescription} <strong>{email}</strong>
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
        <div className="field">
          <label htmlFor="password">{copy.password}</label>
          <input
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            id="password"
            minLength={8}
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />
        </div>
        {mode === "register" ? (
          <div className="field">
            <label htmlFor="password-confirm">{copy.passwordConfirm}</label>
            <input
              autoComplete="new-password"
              id="password-confirm"
              minLength={8}
              type="password"
              value={passwordConfirm}
              onChange={event => setPasswordConfirm(event.target.value)}
              required
            />
          </div>
        ) : null}
      </div>

      {error ? <p className="notice" role="alert">{error}</p> : null}

      <button className="button primary" disabled={loading} style={{ marginTop: 18, width: "100%" }} type="submit">
        {mode === "register" ? <UserPlus size={17} /> : <LogIn size={17} />}
        {loading ? copy.loading : mode === "register" ? copy.registerSubmit : copy.loginSubmit}
      </button>
    </form>
  );
}
