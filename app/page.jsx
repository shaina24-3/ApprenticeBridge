"use client";

import { useAuth } from "@/lib/AuthContext";
import ApprenticeBridgeApp from "@/components/ApprenticeBridgeApp";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function AppWithParams() {
  const { user, loading, logout } = useAuth();
  const searchParams = useSearchParams();
  const initialModal = searchParams.get("modal");

  const [backendUp, setBackendUp] = useState(true);
  const [backendChecked, setBackendChecked] = useState(false);

  // Quick health-check so we can show a clear error if the backend is down
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((r) => setBackendUp(r.ok))
      .catch(() => setBackendUp(false))
      .finally(() => setBackendChecked(true));
    return () => controller.abort();
  }, []);

  // Still waiting for auth + backend check
  if (loading || !backendChecked) {
    return (
      <main className="min-h-screen bg-[#f4f7f5] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500 font-medium">Loading ApprenticeBridge…</p>
        </div>
      </main>
    );
  }

  // Backend is unreachable
  if (!backendUp) {
    return (
      <main className="min-h-screen bg-[#f4f7f5] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-rose-200 shadow-lg p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 flex items-center justify-center mx-auto">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-xl font-black text-slate-900">Backend not reachable</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Cannot connect to the API at <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">{API_URL}</code>.
          </p>
          <p className="text-sm text-slate-500">Start the backend with:</p>
          <pre className="bg-slate-900 text-emerald-400 text-xs rounded-xl p-4 text-left overflow-x-auto">
{`cd "ApprenticeBridge-Backend-PRD 2\\ApprenticeBridge-Backend-PRD 2"
& "..\\venv311\\Scripts\\uvicorn.exe" app.main:app --host 127.0.0.1 --port 8000`}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <ApprenticeBridgeApp
      realUser={user}
      authLoading={false}
      onLogout={logout}
      initialModal={initialModal}
    />
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#f4f7f5] flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </main>
      }
    >
      <AppWithParams />
    </Suspense>
  );
}
