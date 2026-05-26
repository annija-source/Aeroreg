'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Plane } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/sources-page');
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
    } else {
      router.replace('/sources-page');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted)/0.4)] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-8">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <Plane size={24} className="text-blue-600 shrink-0" strokeWidth={1.75} />
          <span className="font-semibold text-[17px] text-[hsl(var(--foreground))] tracking-tight">
            AeroReg{' '}
            <span className="text-[hsl(var(--muted-foreground))] font-normal">Insight</span>
          </span>
        </div>

        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))] mb-1 text-center">
          Sign in
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] text-center mb-6">
          Enter your credentials to continue
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors duration-150"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
