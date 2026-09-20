'use client';
// First-time user guide: a lightweight, dependency-free step walkthrough.
// Shows once for admins (localStorage flag) and can be restarted from
// Settings via the 'bevpos:open-guide' window event.
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bevpos_guide_done_v1';

const STEPS = [
  {
    title: 'Welcome to your POS',
    body: 'This short guide shows you the first steps to start selling. You can skip it at any time and watch it again later from Settings.',
  },
  {
    title: 'Add your products',
    body: 'Go to Products and create each drink or item with its selling price and opening stock. You can also add a barcode and a product photo here.',
  },
  {
    title: 'Organize with categories',
    body: 'In Categories, create practical groups like Beverages, Fridge Items, Snacks or Other. Categories are just names that help you filter the POS screen.',
  },
  {
    title: 'Protect your margins and stock',
    body: 'On each product you can set a minimum selling price (the cashier cannot sell below it) and an expiry date (expired products are blocked at the register).',
  },
  {
    title: 'Create your cashier',
    body: 'In Users, create a cashier account for the register. You can give them specific permissions, like discounts or stock adjustments.',
  },
  {
    title: 'Open a shift at the register',
    body: 'In POS, tap "Open shift" and enter the opening cash. Every sale you make belongs to that shift.',
  },
  {
    title: 'Make a sale and print a receipt',
    body: 'Scan a barcode or tap a product, take the payment, and complete the sale. The receipt fits standard 80mm and 58mm thermal printers. That is everything you need to start.',
  },
];

export default function Onboarding({ autoOpen = false }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const close = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage unavailable (private mode) — guide simply won't auto-open
    }
    setOpen(false);
    setStep(0);
  }, []);

  useEffect(() => {
    if (!autoOpen) return;
    let done = true;
    try {
      done = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      done = true;
    }
    if (!done) {
      const t = setTimeout(() => setOpen(true), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  useEffect(() => {
    const h = () => {
      setOpen(true);
      setStep(0);
    };
    window.addEventListener('bevpos:open-guide', h);
    return () => window.removeEventListener('bevpos:open-guide', h);
  }, []);

  if (!open) return null;

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="w-full max-w-md bg-white rounded-lg border border-line shadow-lg">
        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
          <h3 className="font-semibold text-stone-900 text-[15px]">Getting started</h3>
          <button onClick={close} className="text-xs text-stone-400 hover:text-stone-700">
            Skip
          </button>
        </div>
        <div className="px-5 py-5">
          <div className="flex gap-1 mb-4" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-stone-900' : 'bg-stone-200'}`}
              />
            ))}
          </div>
          <div className="text-[11px] font-medium text-stone-400 mb-1">
            Step {step + 1} of {STEPS.length}
          </div>
          <h4 className="text-base font-semibold text-stone-900 mb-2">{s.title}</h4>
          <p className="text-sm text-stone-600 leading-relaxed">{s.body}</p>
        </div>
        <div className="px-5 py-3.5 border-t border-line flex items-center justify-between bg-cream/50 rounded-b-lg">
          <button
            onClick={() => setStep((v) => Math.max(0, v - 1))}
            disabled={step === 0}
            className="text-sm font-medium text-stone-600 disabled:opacity-40 hover:text-stone-900"
          >
            Back
          </button>
          {last ? (
            <button
              onClick={close}
              className="rounded-md bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700"
            >
              Finish
            </button>
          ) : (
            <button
              onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}
              className="rounded-md bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
