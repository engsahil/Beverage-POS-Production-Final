'use client';
// Expenses: category, amount, date, payment method (which account leaves
// the money), payee, reference, note + optional receipt attachment.
// Add / edit / void — every finance report reads from these rows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import {  formatMoney, formatDate, localDateStr, daysAgoStr , storeDateStr } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Button, Badge, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Select, Card } from '@/components/ui';
import { IconPlus, IconTrash, IconPencil, IconUpload, IconDownload } from '@/components/icons';

const CATEGORIES = ['Rent', 'Utilities', 'Transport', 'Maintenance', 'Salaries', 'Supplies', 'Other'];
const EMPTY = (tz) => ({ category: '', amount: '', date: storeDateStr(tz), method: 'cash', payee: '', reference: '', note: '' });

export default function ExpensesClient({ settings }) {
  const toast = useToast();
  const currency = settings?.currency || 'Rs';
  const tz = settings?.timezone;

  const [expenses, setExpenses] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(() => storeDateStr(tz, -29));
  const [to, setTo] = useState(() => storeDateStr(tz, 0));
  const [catFilter, setCatFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'create' | 'edit', expense? }
  const [form, setForm] = useState(() => EMPTY(tz));
  const [saving, setSaving] = useState(false);
  const [attBusy, setAttBusy] = useState(false);
  const fileRef = useRef(null);
  const [pendingAtt, setPendingAtt] = useState(null); // { data, name } staged for new expense

  const load = useCallback(async () => {
    try {
      const sp = new URLSearchParams({ from, to });
      if (catFilter) sp.set('category', catFilter);
      if (methodFilter) sp.set('method', methodFilter);
      const d = await api(`/api/expenses?${sp.toString()}`);
      setExpenses(d.expenses);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, [from, to, catFilter, methodFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const total = (expenses || []).reduce((s, e) => s + Number(e.amount), 0);

  function openCreate() {
    setForm(EMPTY(tz));
    setPendingAtt(null);
    setModal({ mode: 'create' });
  }
  function openEdit(e) {
    setForm({
      category: e.category,
      amount: String(e.amount),
      date: String(e.expense_date).slice(0, 10),
      method: e.method || 'cash',
      payee: e.payee || '',
      reference: e.reference || '',
      note: e.note || '',
    });
    setModal({ mode: 'edit', expense: e });
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast('File is too large (max 4 MB).', 'error');
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      return toast('Attach a JPG, PNG, WebP or PDF file.', 'error');
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    }).catch(() => null);
    if (dataUrl) setPendingAtt({ data: dataUrl, name: file.name });
    e.target.value = '';
  }

  async function save(e) {
    if (e) e.preventDefault();
    if (saving) return;
    if (!form.category) return toast('Select a category.', 'error');
    if (!Number(form.amount) || Number(form.amount) <= 0) return toast('Enter an amount above zero.', 'error');
    setSaving(true);
    try {
      if (modal.mode === 'create') {
        const res = await api('/api/expenses', {
          method: 'POST',
          body: {
            category: form.category,
            amount: Number(form.amount),
            date: form.date || null,
            method: form.method,
            payee: form.payee.trim(),
            reference: form.reference.trim(),
            note: form.note.trim(),
          },
        });
        if (pendingAtt) {
          try {
            await api(`/api/expenses/${res.id}/attachment`, { method: 'PUT', body: pendingAtt });
          } catch (attErr) {
            toast(attErr.message, 'error');
          }
        }
        toast('Expense recorded.');
      } else {
        await api(`/api/expenses/${modal.expense.id}`, {
          method: 'PUT',
          body: {
            category: form.category,
            amount: Number(form.amount),
            date: form.date || null,
            method: form.method,
            payee: form.payee.trim(),
            reference: form.reference.trim(),
            note: form.note.trim(),
          },
        });
        toast('Expense updated.');
      }
      setModal(null);
      setPendingAtt(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function voidExpense(e) {
    if (!window.confirm(`Void this ${formatMoney(e.amount, currency)} expense? Cash flow, P&L and account balances update immediately.`)) return;
    try {
      await api(`/api/expenses/${e.id}`, { method: 'DELETE' });
      toast('Expense voided.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removeAttachment(e) {
    if (!window.confirm('Remove the attachment?')) return;
    try {
      await api(`/api/expenses/${e.id}/attachment`, { method: 'DELETE' });
      toast('Attachment removed.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const columns = [
    { key: 'expense_date', label: 'Date', render: (r) => <span className="text-stone-600">{String(r.expense_date).slice(0, 10)}</span> },
    { key: 'category', label: 'Category', render: (r) => <span className="font-medium text-stone-800">{r.category}</span> },
    {
      key: 'method',
      label: 'Paid via',
      render: (r) =>
        r.method ? (
          <Badge tone={r.method === 'cash' ? 'ok' : r.method === 'bank' ? 'muted' : 'warn'}>{r.method}</Badge>
        ) : (
          <Badge tone="muted">unspecified</Badge>
        ),
    },
    { key: 'payee', label: 'Payee', render: (r) => <span className="text-stone-600">{r.payee || '—'}</span> },
    { key: 'reference', label: 'Reference', render: (r) => <span className="text-stone-500">{r.reference || '—'}</span> },
    { key: 'note', label: 'Note', render: (r) => <span className="text-stone-500">{r.note || '—'}</span> },
    {
      key: 'attachment',
      label: 'File',
      render: (r) =>
        r.has_attachment ? (
          <div className="flex items-center gap-1">
            <a href={`/api/expenses/${r.id}/attachment`} className="text-stone-500 hover:text-stone-800 inline-flex items-center gap-1 text-xs">
              <IconDownload className="w-3.5 h-3.5" /> {r.attachment_name}
            </a>
            <button onClick={() => removeAttachment(r)} className="p-0.5 rounded text-stone-400 hover:text-red-600" aria-label="Remove attachment">
              <IconTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-stone-300">—</span>
        ),
    },
    { key: 'amount', label: 'Amount', align: 'right', className: 'font-semibold tabular-nums', render: (r) => formatMoney(r.amount, currency) },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex gap-1 justify-end">
          <button onClick={() => openEdit(r)} className="p-1.5 rounded text-stone-500 hover:bg-cream hover:text-stone-800" aria-label="Edit expense">
            <IconPencil className="w-4 h-4" />
          </button>
          <button onClick={() => voidExpense(r)} className="p-1.5 rounded text-stone-500 hover:bg-red-50 hover:text-red-600" aria-label="Void expense">
            <IconTrash className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <PageHeader
        title="Expenses"
        sub="Day-to-day expenses. Each one leaves the account you choose — cash flow, P&L and balances follow automatically."
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Record Expense
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs font-medium text-stone-600 mb-1">From</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
          </div>
          <div>
            <div className="text-xs font-medium text-stone-600 mb-1">To</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
          </div>
          <div>
            <div className="text-xs font-medium text-stone-600 mb-1">Category</div>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15">
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs font-medium text-stone-600 mb-1">Method</div>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15">
              <option value="">All</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="card">Card</option>
              <option value="unspecified">Unspecified</option>
            </select>
          </div>
          <div className="ml-auto text-sm text-stone-600">
            Total: <span className="font-bold tabular-nums text-stone-900">{formatMoney(total, currency)}</span>
          </div>
        </div>
      </Card>

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !expenses ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={expenses} empty="No expenses in this period." />
        )}
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Record Expense' : `Edit: ${modal.expense.category} — ${formatMoney(modal.expense.amount, currency)}`}
          wide
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button loading={saving || attBusy} onClick={save}>
                {modal.mode === 'create' ? 'Save Expense' : 'Save Changes'}
              </Button>
            </>
          }
        >
          <form onSubmit={save} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3.5">
              <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                <option value="">Select…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
              <Input label={`Amount (${currency})`} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              <Select label="Paid via (account)" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </Select>
              <Input label="Payee" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="Who received it" maxLength={120} />
              <Input label="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Invoice / receipt no." maxLength={80} />
            </div>
            <Input label="Description / note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
            <div>
              <span className="block text-xs font-medium text-stone-600 mb-1.5">Attachment (optional)</span>
              {modal.mode === 'edit' && modal.expense.has_attachment && (
                <div className="mb-1.5 flex items-center gap-2 text-xs text-stone-600">
                  <a href={`/api/expenses/${modal.expense.id}/attachment`} className="inline-flex items-center gap-1 text-stone-700 hover:text-stone-900">
                    <IconDownload className="w-3.5 h-3.5" /> {modal.expense.attachment_name}
                  </a>
                  <button type="button" onClick={() => removeAttachment(modal.expense)} className="text-stone-400 hover:text-red-600">remove</button>
                </div>
              )}
              {pendingAtt ? (
                <div className="flex items-center gap-2 text-xs text-stone-600">
                  <span>{pendingAtt.name}</span>
                  <button type="button" onClick={() => setPendingAtt(null)} className="text-stone-400 hover:text-red-600">remove</button>
                </div>
              ) : (
                <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-600 hover:bg-cream cursor-pointer">
                  <IconUpload className="w-3.5 h-3.5" /> Choose file (JPG, PNG, WebP or PDF, max 4 MB)
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onFile} />
                </label>
              )}
            </div>
            <p className="text-[11px] text-stone-400">
              The method decides which account (cash, bank or card) this expense leaves. Changing it later on an old expense moves it between accounts in every report.
            </p>
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}
    </div>
  );
}
