'use client';
// Shared UI primitives: Button, Input, Select, Modal, Badge, Card,
// Loading, ErrorBox, EmptyState, DataTable, PageHeader.
import { useEffect } from 'react';
import Link from 'next/link';
import { IconAlert, IconArrowLeft, IconRefresh, IconX } from './icons';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}) {
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand-deep disabled:bg-stone-300',
    secondary: 'bg-white text-stone-700 border border-stone-300 hover:bg-cream disabled:text-stone-400',
    danger: 'bg-danger text-white hover:bg-[#d43a3f] disabled:bg-red-300',
    ghost: 'text-stone-600 hover:bg-cream-deep disabled:text-stone-300',
  };
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
    lg: 'px-4 py-2.5 text-[15px]',
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && (
        <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-stone-600 mb-1.5">{label}</span>}
      {children}
      {hint && <span className="block text-[11px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15 focus:border-stone-500 disabled:bg-cream-deep disabled:text-stone-400';

export function Input({ label, hint, className = '', ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <input {...rest} className={`${inputCls} ${className}`} />
    </Field>
  );
}

export function Select({ label, hint, className = '', children, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <select {...rest} className={`${inputCls} ${className}`}>
        {children}
      </select>
    </Field>
  );
}

export function Badge({ tone = 'muted', children }) {
  const tones = {
    ok: 'bg-brand/10 text-brand-deep border-brand/30',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    bad: 'bg-danger/10 text-[#c93036] border-danger/30',
    muted: 'bg-stone-100 text-stone-600 border-stone-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`bg-white border border-line rounded-lg shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, actions, back }) {
  return (
    <div>
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 mb-2.5 text-sm font-medium text-stone-500 hover:text-stone-900"
        >
          <IconArrowLeft className="w-4 h-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {sub && <p className="text-sm text-stone-500 mt-0.5">{sub}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-stone-500">
      <span className="w-4 h-4 rounded-full border-2 border-stone-300 border-t-stone-600 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBox({ message = 'Something went wrong.', onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <IconAlert className="w-6 h-6 text-amber-600" />
      <p className="text-sm text-stone-600 max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <IconRefresh className="w-3.5 h-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ message = 'No records found.' }) {
  return <div className="py-10 text-center text-sm text-stone-400">{message}</div>;
}

export function DataTable({ columns, rows, empty = 'No records found.', onRowClick }) {
  if (!rows || rows.length === 0) return <EmptyState message={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-stone-500 whitespace-nowrap ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.__key ?? i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-line/70 last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-cream' : 'hover:bg-cream/60'
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-2.5 px-3 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${
                    c.className || ''
                  }`}
                >
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 pt-[7vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} bg-white rounded-lg border border-line shadow-lg`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="font-semibold text-stone-900 text-[15px]">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700" aria-label="Close">
            <IconX className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-line flex justify-end gap-2 bg-cream/50 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
