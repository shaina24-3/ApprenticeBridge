"use client";

/**
 * /auth/signup — redirects to the home page where the auth modal lives.
 * Sign-up is now handled via the inline modal on the landing page.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/?modal=signup");
  }, [router]);

  return (
    <main className="min-h-screen bg-[#f4f7f5] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </main>
  );
}
