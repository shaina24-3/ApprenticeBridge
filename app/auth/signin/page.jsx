"use client";

/**
 * /auth/signin — redirects to the home page where the auth modal lives.
 * Sign-in is now handled via the inline modal on the landing page.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SigninPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home with a flag so the modal auto-opens
    router.replace("/?modal=signin");
  }, [router]);

  return (
    <main className="min-h-screen bg-[#f4f7f5] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </main>
  );
}
