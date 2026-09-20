'use client';
// "Install App" button.
// Uses the standard beforeinstallprompt event. Hidden when the app is
// already installed (standalone) or when the browser does not offer an
// install prompt. It never forces the native prompt.
import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { IconInstall } from './icons';

export default function InstallAppButton({ className = '' }) {
  const [deferred, setDeferred] = useState(null);
  const [standalone, setStandalone] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator?.standalone === true;
    setStandalone(isStandalone);

    const onPrompt = (e) => {
      e.preventDefault();
      if (!isStandalone) setDeferred(e);
    };
    const onInstalled = () => {
      setDeferred(null);
      toast('App installed. You can launch it from your home screen.', 'info');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!deferred || standalone) return null;

  return (
    <button
      onClick={async () => {
        deferred.prompt();
        try {
          await deferred.userChoice;
        } finally {
          setDeferred(null);
        }
      }}
      className={`flex items-center justify-center gap-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-cream ${className}`}
    >
      <IconInstall className="w-4 h-4" /> Install App
    </button>
  );
}
