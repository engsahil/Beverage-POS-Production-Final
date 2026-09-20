'use client';
// Last-resort error screen. Never shows raw technical errors.
import { Button } from '@/components/ui';

export default function ErrorPage({ error, reset }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-cream px-4">
      <div className="text-center max-w-sm">
        <h1 className="text-lg font-semibold text-stone-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-stone-500">
          Your data is safe. Please try again, or sign in again if the problem continues.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => reset()}>Try Again</Button>
          <Button variant="secondary" onClick={() => (window.location.href = '/login')}>
            Go to Login
          </Button>
        </div>
      </div>
    </div>
  );
}
