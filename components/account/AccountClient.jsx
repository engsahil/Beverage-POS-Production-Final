'use client';
// Account: view profile, change username/name/password (current password required).
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/Toast';
import { Button, Card, Input, PageHeader } from '@/components/ui';

export default function AccountClient({ user }) {
  const toast = useToast();
  const [fullName, setFullName] = useState(user.full_name || '');
  const [newUsername, setNewUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const body = { currentPassword };
      if (fullName !== (user.full_name || '')) body.fullName = fullName;
      if (newUsername.trim()) body.newUsername = newUsername.trim();
      if (newPassword) body.newPassword = newPassword;
      await api('/api/account', { method: 'POST', body });
      toast('Account updated.');
      setCurrentPassword('');
      setNewPassword('');
      setNewUsername('');
      window.location.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    window.location.href = '/login';
  }

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Account" sub="Your profile and credentials" />

      <Card title="Profile" className="mb-4">
        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-stone-500 mb-0.5">Name</div>
            <div className="font-medium text-stone-800">{user.full_name || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-stone-500 mb-0.5">Username</div>
            <div className="font-medium text-stone-800">{user.username}</div>
          </div>
          <div>
            <div className="text-xs text-stone-500 mb-0.5">Role</div>
            <div className="font-medium text-stone-800 capitalize">{user.role}</div>
          </div>
        </div>
      </Card>

      <Card title="Update Account" className="mb-4">
        <form onSubmit={save} className="p-4 space-y-3.5">
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
          <Input
            label="New username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder={user.username}
            hint="Leave empty to keep the current username. 3-30 characters."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave empty to keep current"
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Session">
        <div className="p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-stone-500">
            Sign out of this device. Sessions expire after 7 days.
          </p>
          <Button variant="secondary" onClick={logout}>
            Logout
          </Button>
        </div>
      </Card>
    </div>
  );
}
