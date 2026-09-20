'use client';
// Minimal login screen: username, password, login. Nothing else.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button, Input } from './ui';
import { IconEye, IconEyeOff, IconGlass } from './icons';

export default function LoginClient({ businessName }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      router.replace(data.role === 'admin' ? '/admin' : '/pos');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-stone-900 text-white flex items-center justify-center">
            <IconGlass className="w-6 h-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-stone-900">{businessName}</h1>
          <p className="text-sm text-stone-500 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="bg-white border border-line rounded-lg p-6 space-y-4">
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            placeholder="Enter username"
          />
          <div className="relative">
            <span className="block text-xs font-medium text-stone-600 mb-1.5">Password</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter password"
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 pr-10 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15 focus:border-stone-500"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-[26px] text-stone-400 hover:text-stone-600"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <IconEyeOff className="w-4 h-4" /> : <IconEye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" loading={busy} className="w-full" size="lg">
            Login
          </Button>
        </form>
      </div>
    </div>
  );
}
