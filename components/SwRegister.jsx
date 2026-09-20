'use client';
// Registers the service worker in production builds only.
import { useEffect } from 'react';

export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline shell is a convenience, not critical — ignore failures.
      });
    }
  }, []);
  return null;
}
