'use client';
// Users (admin): add, edit, enable/disable, reset password.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Badge, Button, DataTable, ErrorBox, Loading, Modal, PageHeader, Input, Select } from '@/components/ui';
import { IconPencil, IconPlus } from '@/components/icons';
import { PERMISSIONS, PERMISSION_LABELS } from '@/lib/permissions';

const EMPTY = { fullName: '', username: '', password: '', role: 'cashier' };
const EMPTY_LIMITS = { retailMin: '', wholesaleMin: '', specialMin: '' };

export default function UsersClient() {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode, user? }
  const [form, setForm] = useState(EMPTY);
  const [active, setActive] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [perms, setPerms] = useState([]);
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState(EMPTY_LIMITS); // cashier min prices (edit)
  const [limitsLoaded, setLimitsLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/users');
      setUsers(d.users);
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
    setForm(EMPTY);
    setActive(true);
    setNewPassword('');
    setPerms([]);
    setLimits(EMPTY_LIMITS);
    setLimitsLoaded(true);
    setModal({ mode: 'create' });
  }
  function openEdit(u) {
    setForm({ fullName: u.full_name || '', username: u.username, role: u.role });
    setActive(u.active);
    setNewPassword('');
    // Defensive: only valid permission strings may round-trip to the server.
    setPerms(
      u.role === 'admin'
        ? []
        : (Array.isArray(u.permissions) ? u.permissions : []).filter(
            (p) => typeof p === 'string' && PERMISSIONS.includes(p)
          )
    );
    setLimits(EMPTY_LIMITS);
    setLimitsLoaded(false);
    setModal({ mode: 'edit', user: u });
    // Minimum prices exist only for cashiers; fetch them on demand.
    if (u.role === 'cashier') {
      api(`/api/users/${u.id}/price-limits`)
        .then((d) => {
          setLimits({
            retailMin: d.retailMin === null || d.retailMin === undefined ? '' : String(d.retailMin),
            wholesaleMin: d.wholesaleMin === null || d.wholesaleMin === undefined ? '' : String(d.wholesaleMin),
            specialMin: d.specialMin === null || d.specialMin === undefined ? '' : String(d.specialMin),
          });
        })
        .catch(() => setLimits(EMPTY_LIMITS))
        .finally(() => setLimitsLoaded(true));
    } else {
      setLimitsLoaded(true);
    }
  }

  function togglePerm(perm) {
    setPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (modal.mode === 'create') {
        await api('/api/users', {
          method: 'POST',
          body: {
            username: form.username.trim(),
            fullName: form.fullName.trim(),
            password: form.password,
            role: form.role,
            permissions: form.role === 'cashier' ? perms : [],
          },
        });
        toast('User created.');
      } else {
        const body = { fullName: form.fullName.trim(), role: form.role, active };
        if (newPassword) body.newPassword = newPassword;
        if (form.role === 'cashier') body.permissions = perms;
        await api(`/api/users/${modal.user.id}`, { method: 'PUT', body });
        if (form.role === 'cashier' && limitsLoaded) {
          try {
            await api(`/api/users/${modal.user.id}/price-limits`, {
              method: 'PUT',
              body: {
                retailMin: limits.retailMin === '' ? null : Number(limits.retailMin),
                wholesaleMin: limits.wholesaleMin === '' ? null : Number(limits.wholesaleMin),
                specialMin: limits.specialMin === '' ? null : Number(limits.specialMin),
              },
            });
          } catch (le) {
            toast(`User saved, but minimum prices were not updated: ${le.message}`, 'error');
            return;
          }
        }
        toast('User updated.');
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
    { key: 'full_name', label: 'Name', render: (r) => <span className="font-medium text-stone-800">{r.full_name || '—'}</span> },
    { key: 'username', label: 'Username', render: (r) => `@${r.username}` },
    {
      key: 'role',
      label: 'Role',
      render: (r) => <Badge tone={r.role === 'admin' ? 'warn' : 'muted'}>{r.role === 'admin' ? 'Admin' : 'Cashier'}</Badge>,
    },
    {
      key: 'permissions',
      label: 'Permissions',
      render: (r) =>
        r.role === 'admin' ? (
          <span className="text-xs text-stone-400">All (admin)</span>
        ) : Array.isArray(r.permissions) && r.permissions.length > 0 ? (
          <div className="flex flex-wrap gap-1 max-w-[220px]">
            {r.permissions.map((p) => (
              <span key={p} className="text-[10px] rounded border border-stone-200 bg-stone-100 px-1.5 py-0.5 text-stone-600">
                {PERMISSION_LABELS[p] || p}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-stone-400">Basic (POS + own sales)</span>
        ),
    },
    { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'bad'}>{r.active ? 'Active' : 'Disabled'}</Badge> },
    { key: 'created_at', label: 'Created', render: (r) => <span className="text-stone-500">{formatDate(r.created_at)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <button onClick={() => openEdit(r)} className="p-1.5 rounded text-stone-500 hover:bg-cream hover:text-stone-800" aria-label={`Edit ${r.username}`}>
          <IconPencil className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Users"
        sub="Cashiers and admins who can sign in. Deactivated users cannot log in."
        actions={
          <Button onClick={openCreate}>
            <IconPlus className="w-4 h-4" /> Add User
          </Button>
        }
      />

      <div className="bg-white border border-line rounded-lg">
        {error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !users ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={users} empty="No users found." />
        )}
      </div>

      {modal && (
        <Modal
          title={modal.mode === 'create' ? 'Add User' : `Edit: @${modal.user.username}`}
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
          <form onSubmit={save} className="space-y-3.5">
            <Input label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} maxLength={80} />
            {modal.mode === 'create' ? (
              <>
                <Input
                  label="Username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                  maxLength={30}
                  hint="3-30 characters: letters, numbers, dot, dash or underscore."
                />
                <Input
                  label="Password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </>
            ) : (
              <Input
                label="Reset password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave empty to keep current password"
                minLength={6}
                autoComplete="new-password"
              />
            )}
            <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="cashier">Cashier</option>
              <option value="admin">Admin</option>
            </Select>
            {modal.mode === 'edit' && (
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 rounded border-stone-300" />
                Active (can log in)
              </label>
            )}
            {form.role === 'cashier' && (
              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">Permissions</span>
                <div className="space-y-1.5 border border-line rounded-md p-3 bg-cream/40">
                  {PERMISSIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm text-stone-700">
                      <input
                        type="checkbox"
                        checked={perms.includes(p)}
                        onChange={() => togglePerm(p)}
                        className="w-4 h-4 rounded border-stone-300"
                      />
                      {PERMISSION_LABELS[p]}
                    </label>
                  ))}
                </div>
                <span className="block text-[11px] text-stone-400 mt-1">
                  Always enforced on the server. Without a permission, the action is blocked even if the UI allowed it.
                </span>
              </div>
            )}
            {modal.mode === 'edit' && form.role === 'cashier' && (
              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">
                  Minimum selling price per mode {limitsLoaded ? '' : '(loading…)'}
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    label="Retail"
                    type="number"
                    min="0"
                    step="0.01"
                    value={limits.retailMin}
                    onChange={(e) => setLimits((l) => ({ ...l, retailMin: e.target.value }))}
                    placeholder="No limit"
                    disabled={!limitsLoaded}
                  />
                  <Input
                    label="Wholesale"
                    type="number"
                    min="0"
                    step="0.01"
                    value={limits.wholesaleMin}
                    onChange={(e) => setLimits((l) => ({ ...l, wholesaleMin: e.target.value }))}
                    placeholder="No limit"
                    disabled={!limitsLoaded}
                  />
                  <Input
                    label="Sale / Special"
                    type="number"
                    min="0"
                    step="0.01"
                    value={limits.specialMin}
                    onChange={(e) => setLimits((l) => ({ ...l, specialMin: e.target.value }))}
                    placeholder="No limit"
                    disabled={!limitsLoaded}
                  />
                </div>
                <span className="block text-[11px] text-stone-400 mt-1">
                  Blank = no limit. In that pricing mode the cashier may only sell at or above the shown price,
                  even with a discount. Enforced on the server; admins are never limited.
                </span>
              </div>
            )}
            <button type="submit" className="hidden" />
          </form>
        </Modal>
      )}
    </div>
  );
}
