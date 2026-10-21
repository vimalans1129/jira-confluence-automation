import { useCallback, useEffect, useState } from "react";
import { getSession, logout, setUnauthorizedHandler } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { ReportsArea } from "./pages/ReportsArea";

type AuthState = "checking" | "signedOut" | "signedIn";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth("signedOut"));
    getSession().then(
      () => setAuth("signedIn"),
      () => setAuth("signedOut"),
    );
    return () => setUnauthorizedHandler(() => {});
  }, []);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => {});
    setAuth("signedOut");
  }, []);

  if (auth === "checking") {
    return (
      <main>
        <p role="status">Loading…</p>
      </main>
    );
  }
  if (auth === "signedOut") {
    return <LoginPage onSignedIn={() => setAuth("signedIn")} />;
  }
  return (
    <main>
      <h1>Weekly Status Report</h1>
      <button type="button" onClick={() => void handleLogout()}>
        Sign out
      </button>
      <ReportsArea />
    </main>
  );
}
