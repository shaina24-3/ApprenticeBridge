"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authApi } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Check existing session on mount.
  // 5-second timeout so a downed backend never freezes the UI permanently.
  useEffect(() => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setUser(null);
        setLoading(false);
      }
    }, 5000);

    authApi.me()
      .then((data) => {
        if (!settled) {
          settled = true;
          if (data && !data.error) setUser(data);
          else setUser(null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          setUser(null);
          setLoading(false);
        }
      })
      .finally(() => clearTimeout(timer));
  }, []);

  // ── Email / password login ───────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    if (data.error) return { error: data.error };
    setUser(data.user);
    return { user: data.user };
  }, []);

  // ── Register then auto-login ─────────────────────────────────────────────
  const register = useCallback(async (name, email, password, role) => {
    const data = await authApi.register(name, email, password, role);
    if (data.error) return { error: data.error };
    return login(email, password);
  }, [login]);

  // ── Google OAuth ─────────────────────────────────────────────────────────
  const loginWithGoogle = useCallback(async (role = "candidate") => {
    // Check Firebase is configured before attempting the popup
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return {
        error:
          "Google sign-in is not configured. " +
          "Fill in NEXT_PUBLIC_FIREBASE_API_KEY (and the other Firebase keys) " +
          "in .env.local — see the setup guide for details.",
      };
    }

    try {
      const { auth, googleProvider } = await import("./firebase");
      const { signInWithPopup }      = await import("firebase/auth");

      const result  = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();

      const data = await authApi.googleLogin(idToken, role);
      if (data.error) return { error: data.error };
      setUser(data.user);
      return { user: data.user };
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user" ||
          err.code === "auth/cancelled-popup-request") {
        return { error: "cancelled" };
      }
      if (err.code === "auth/invalid-api-key") {
        return {
          error:
            "Invalid Firebase API key. " +
            "Check that NEXT_PUBLIC_FIREBASE_API_KEY in .env.local matches " +
            "your Firebase project's Web API key.",
        };
      }
      if (err.code === "auth/operation-not-allowed") {
        return {
          error:
            "Google sign-in is not enabled in your Firebase project. " +
            "Go to Firebase Console → Authentication → Sign-in method and enable Google.",
        };
      }
      return { error: err.message || "Google sign-in failed." };
    }
  }, []);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, loginWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
