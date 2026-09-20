'use client';
// Sale detail = printable receipts (browser printing only).
// ONE sale renders TWO slips from the same data:
//   page 1 — customer receipt
//   page 2 — kitchen order ticket (KOT)
// Width: 80mm (default) or 58mm. Print targets: both slips in one
// job, or a single slip (for shops with separate printers).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button, ErrorBox, Loading } from '@/components/ui';
import { IconArrowLeft, IconPrinter } from '@/components/icons';
import { CustomerReceipt, KitchenReceipt } from '@/components/sales/Receipts';

export default function SaleDetailClient({ saleId, user, settings }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState('80'); // '80' | '58'
  const [printTarget, setPrintTarget] = useState('both'); // 'both' | 'customer' | 'kitchen'

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/sales/${saleId}`));
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [saleId]);

  useEffect(() => {
    load();
  }, [load]);

  function doPrint(target) {
    setPrintTarget(target);
    // Let React commit the target class, then open the print dialog.
    setTimeout(() => window.print(), 80);
  }

  if (error)
    return (
      <div className="p-6">
        <ErrorBox message={error} onRetry={load} />
      </div>
    );
  if (!data)
    return (
      <div className="p-6">
        <Loading />
      </div>
    );

  const { sale, items, settings: s } = data;
  const printAreaClass =
    printTarget === 'customer' ? 'hide-kitchen' : printTarget === 'kitchen' ? 'hide-customer' : '';

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
      <Link
        href={user.role === 'admin' ? '/sales' : '/pos'}
        className="inline-flex items-center gap-1.5 mb-3 text-sm font-medium text-stone-500 hover:text-stone-900"
      >
        <IconArrowLeft className="w-4 h-4" />
        {user.role === 'admin' ? 'All Sales' : 'Back to POS'}
      </Link>
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Actions */}
        <div className="w-full md:w-52 shrink-0 space-y-2 order-2 md:order-1">
          <div className="flex gap-1.5" role="group" aria-label="Receipt width">
            {['80', '58'].map((w) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${
                  width === w
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'bg-white text-stone-600 border-stone-300 hover:bg-cream'
                }`}
              >
                {w}mm
              </button>
            ))}
          </div>
          <Button className="w-full" onClick={() => doPrint('both')}>
            <IconPrinter className="w-4 h-4" /> Print Both
          </Button>
          <div className="text-[11px] text-stone-400 leading-snug -mt-1">
            One job, two pages: customer slip, then gate pass.
          </div>
          <Button variant="secondary" className="w-full" onClick={() => doPrint('customer')}>
            <IconPrinter className="w-4 h-4" /> Customer only
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => doPrint('kitchen')}>
            <IconPrinter className="w-4 h-4" /> Gate pass only
          </Button>
          <div className="text-[11px] text-stone-400 leading-snug -mt-1">
            Use the single-slip options when each printer has its own paper.
          </div>
        </div>

        {/* Preview: both slips, same data */}
        <div className="flex-1 w-full">
          <div className="flex flex-wrap gap-6 justify-center">
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                Customer receipt
              </span>
              <div className="shadow-md">
                <CustomerReceipt sale={sale} items={items} settings={s} width={width} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                Gate pass
              </span>
              <div className="shadow-md">
                <KitchenReceipt sale={sale} items={items} settings={s} width={width} />
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Print area: only these slips are printed */}
      <div id="print-area" className={printAreaClass}>
        <CustomerReceipt sale={sale} items={items} settings={s} width={width} />
        <KitchenReceipt sale={sale} items={items} settings={s} width={width} />
      </div>
    </div>
  );
}
