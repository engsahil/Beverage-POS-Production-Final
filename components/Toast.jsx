'use client';
// Tiny toast system. No library.
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { IconAlert, IconCheck } from './icons';

const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const push = useCallback((message, type = 'info') => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-[320px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-md px-4 py-3 text-sm text-white shadow-lg ${
              t.type === 'error' ? 'bg-red-700' : 'bg-stone-900'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {t.type === 'error' ? <IconAlert className="w-4 h-4" /> : <IconCheck className="w-4 h-4" />}
            </span>
            <span className="leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
