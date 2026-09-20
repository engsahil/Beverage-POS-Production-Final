'use client';
// Categories: add, rename, enable/disable. No destructive deletes.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Field } from '@/components/ui';
import { IconPencil, IconPlus } from '@/components/icons';

export default function CategoriesClient() {
  const toast = useToast();
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode, category? }
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/categories');
      setCategories(d.categories);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setName('');
    setActive(true);
    setModal({ mode: 'create' });
  }
  function openEdit(c) {
    setName(c.name);
    setActive(c.active);
    setModal({ mode: 'edit', category: c });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (modal.mode === 'create') {
        await api('/api/categories', { method: 'POST', body: { name: name.trim() } });
        toast('Category created.');
      } else {
        await api(`/api/categories/${modal.category.id}`, {
          method: 'PUT',
          body: { name: name.trim(), active },
        });
        toast('Category updated.');
      }
      setModal(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-stone-800">{r.name}</span> },
    { key: 'product_count', label: 'Products', align: 'right' },
    { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Active' : 'Disabled'}</Badge> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <button
          onClick={() => openEdit(r)}
          className="p-1.5 rounded text-stone-500 hover:bg-cream hover:text-stone-800"
          aria-label={`Edit ${r.name}`}
        >
          <IconPencil className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="Categories"
        sub="Group products for quick filtering at the POS"
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Add Category
          </Button>
        }
      />

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !categories ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={categories} empty="No categories yet." />
        )}
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Add Category' : 'Edit Category'}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={save}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
            <Field label="">
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 rounded border-stone-300"
                />
                Active (shown on POS)
              </label>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
