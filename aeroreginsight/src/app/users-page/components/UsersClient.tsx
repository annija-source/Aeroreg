'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/contexts/RoleContext';
import { toast } from 'sonner';
import {
  Users,
  RefreshCw,
  Shield,
  Search,
  X,
  UserPlus,
  Pencil,
  UserX,
  UserCheck,
  KeyRound,
  Loader2,
} from 'lucide-react';
import AddUserModal from './AddUserModal';
import EditUserModal from './EditUserModal';

type AppRole = 'admin' | 'editor' | 'viewer';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
}

interface ConfirmState {
  type: 'deactivate' | 'activate';
  user: UserProfile;
}

const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  editor: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer: 'bg-slate-100 text-slate-600 border-slate-200',
};

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Full access — manage users, create, edit, delete everything',
  editor: 'Create and edit documents and versions, no user management',
  viewer: 'Read-only access + can run comparisons',
};

const ROLE_OPTIONS: AppRole[] = ['admin', 'editor', 'viewer'];

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function UsersClient() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

  // Per-row action loading
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users/manage');
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to load users: ${data.error ?? 'Unknown error'}`);
        console.error('[UsersClient] fetchUsers error:', data.error);
      } else {
        setUsers(data.users ?? []);
      }
    } catch (err: any) {
      toast.error(`Failed to load users: ${err.message}`);
      console.error('[UsersClient] fetchUsers exception:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Deactivate / Activate
  const handleToggleActive = async (targetUser: UserProfile, newActive: boolean) => {
    const actionKey = `${targetUser.id}-toggle`;
    setActionLoading((prev) => ({ ...prev, [actionKey]: 'loading' }));
    try {
      const res = await fetch('/api/users/manage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetUser.id, is_active: newActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to ${newActive ? 'activate' : 'deactivate'} user: ${data.error ?? 'Unknown error'}`);
      } else {
        toast.success(`User ${newActive ? 'activated' : 'deactivated'} successfully.`);
        setUsers((prev) =>
          prev.map((u) => (u.id === targetUser.id ? { ...u, is_active: newActive } : u))
        );
      }
    } catch (err: any) {
      toast.error(`Unexpected error: ${err.message}`);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
      setConfirmState(null);
    }
  };

  // Reset Password
  const handleResetPassword = async (targetUser: UserProfile) => {
    const actionKey = `${targetUser.id}-reset`;
    setActionLoading((prev) => ({ ...prev, [actionKey]: 'loading' }));
    try {
      const res = await fetch(
        `/api/users/manage?action=reset-password&email=${encodeURIComponent(targetUser.email)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to send reset email: ${data.error ?? 'Unknown error'}`);
      } else {
        toast.success(`Password reset email sent to ${targetUser.email}.`);
      }
    } catch (err: any) {
      toast.error(`Unexpected error: ${err.message}`);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.full_name ?? '').toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const colCount = isAdmin ? 7 : 5;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] tracking-tight">
            User Management
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            {isAdmin
              ? 'Add, edit, deactivate, and manage user access.' :'View all users and their roles.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[hsl(var(--primary))] text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              <UserPlus size={15} />
              Add User
            </button>
          )}
          <button
            onClick={fetchUsers}
            className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
            title="Refresh users"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ROLE_OPTIONS.map((r) => (
          <div
            key={r}
            className="flex items-start gap-3 p-3 rounded-lg border border-[hsl(var(--border))] bg-white"
          >
            <span
              className={`mt-0.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border capitalize shrink-0 ${ROLE_COLORS[r]}`}
            >
              {r}
            </span>
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
              {ROLE_DESCRIPTIONS[r]}
            </p>
          </div>
        ))}
      </div>

      {/* Search + count */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
          />
          <input
            type="text"
            placeholder="Search by name, email, or role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))] tabular-nums shrink-0">
          {filtered.length} of {users.length} user{users.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Joined
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Last Sign In
                </th>
                {isAdmin && (
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: colCount }).map((_, j) => (
                      <td key={`skel-${i}-${j}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Users
                        size={36}
                        className="text-[hsl(var(--muted-foreground))] opacity-40"
                      />
                      <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                        {search ? 'No users match your search.' : 'No users found.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((u, idx) => {
                  const isCurrentUser = u.id === user?.id;
                  const toggleKey = `${u.id}-toggle`;
                  const resetKey = `${u.id}-reset`;
                  const isToggling = !!actionLoading[toggleKey];
                  const isResetting = !!actionLoading[resetKey];

                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-[hsl(var(--border))] transition-colors duration-100 ${
                        idx % 2 === 0 ? '' : 'bg-[hsl(var(--muted)/0.15)]'
                      } ${
                        isCurrentUser
                          ? 'bg-[hsl(var(--primary)/0.04)]'
                          : 'hover:bg-[hsl(var(--muted)/0.4)]'
                      }`}
                    >
                      {/* User */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary)/0.1)] flex items-center justify-center shrink-0">
                            <span className="text-xs font-semibold text-[hsl(var(--primary))]">
                              {(u.full_name || u.email).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-[hsl(var(--foreground))] text-sm leading-tight">
                              {u.full_name || '—'}
                              {isCurrentUser && (
                                <span className="ml-1.5 text-[10px] font-semibold text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] px-1.5 py-0.5 rounded-full">
                                  You
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] text-sm">
                        {u.email}
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${ROLE_COLORS[u.role]}`}
                        >
                          <Shield size={10} />
                          {u.role}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                            u.is_active !== false
                              ? 'bg-green-50 text-green-700 border-green-200' :'bg-red-50 text-red-600 border-red-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.is_active !== false ? 'bg-green-500' : 'bg-red-500'
                            }`}
                          />
                          {u.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {formatDate(u.created_at)}
                      </td>

                      {/* Last Sign In */}
                      <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {formatDateTime(u.last_sign_in_at)}
                      </td>

                      {/* Actions (admin only) */}
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Edit */}
                            <button
                              onClick={() => setEditingUser(u)}
                              title="Edit user"
                              className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                            >
                              <Pencil size={14} />
                            </button>

                            {/* Deactivate / Activate */}
                            <button
                              onClick={() =>
                                setConfirmState({
                                  type: u.is_active !== false ? 'deactivate' : 'activate',
                                  user: u,
                                })
                              }
                              disabled={isToggling || isCurrentUser}
                              title={
                                isCurrentUser
                                  ? 'Cannot deactivate yourself'
                                  : u.is_active !== false
                                  ? 'Deactivate user' :'Activate user'
                              }
                              className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                u.is_active !== false
                                  ? 'text-orange-500 hover:bg-orange-50' :'text-green-600 hover:bg-green-50'
                              }`}
                            >
                              {isToggling ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : u.is_active !== false ? (
                                <UserX size={14} />
                              ) : (
                                <UserCheck size={14} />
                              )}
                            </button>

                            {/* Reset Password */}
                            <button
                              onClick={() => handleResetPassword(u)}
                              disabled={isResetting}
                              title="Send password reset email"
                              className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isResetting ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <KeyRound size={14} />
                              )}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onSuccess={fetchUsers}
        />
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={fetchUsers}
        />
      )}

      {/* Confirm Deactivate / Activate Dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[hsl(var(--border))] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  confirmState.type === 'deactivate' ?'bg-orange-100 text-orange-600' :'bg-green-100 text-green-600'
                }`}
              >
                {confirmState.type === 'deactivate' ? (
                  <UserX size={18} />
                ) : (
                  <UserCheck size={18} />
                )}
              </div>
              <div>
                <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
                  {confirmState.type === 'deactivate' ? 'Deactivate User' : 'Activate User'}
                </h3>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {confirmState.user.email}
                </p>
              </div>
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              {confirmState.type === 'deactivate' ?'This user will no longer be able to log in. Their data and history will be preserved.' :'This user will be able to log in again with their existing credentials.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmState(null)}
                className="flex-1 px-4 py-2 text-sm font-medium border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleToggleActive(
                    confirmState.user,
                    confirmState.type === 'activate'
                  )
                }
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity hover:opacity-90 ${
                  confirmState.type === 'deactivate' ? 'bg-orange-500' : 'bg-green-600'
                }`}
              >
                {confirmState.type === 'deactivate' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
