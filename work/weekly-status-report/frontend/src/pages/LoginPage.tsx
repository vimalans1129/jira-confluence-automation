import { useState, type FormEvent } from "react";
import { ApiError, login } from "../api/client";

interface Props {
  onSignedIn: () => void;
}

export function LoginPage({ onSignedIn }: Props) {
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (password.length === 0) {
      setFieldError("Enter the password");
      return;
    }
    setFieldError(null);
    setLoading(true);
    try {
      await login(password);
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
        setFormError("The password is incorrect.");
      } else if (err instanceof ApiError && err.code === "TOO_MANY_ATTEMPTS") {
        setFormError("Too many failed attempts. Try again later.");
      } else {
        setFormError("Sign in failed. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={fieldError !== null}
          aria-describedby={fieldError ? "password-error" : undefined}
          disabled={loading}
        />
        {fieldError && (
          <p id="password-error" role="alert">
            {fieldError}
          </p>
        )}
        {formError && <p role="alert">{formError}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
