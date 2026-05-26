'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/contexts/RoleContext';
import { toast } from 'sonner';
import { Users, RefreshCw, Search, X, ChevronDown } from 'lucide-react';

type AppRole = 'admin' | 'editor' | 'viewer';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  created_at: string;
}

const ROLE_OPTIONS: AppRole[] = ['admin', 'editor', 'viewer'];

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

export default function UsersClient() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const supabase = createClient();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      toast.error(`Failed to load users: ${error.message}`);
    } else {
      setUsers((data ?? []) as UserProfile[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    if (!isAdmin) {
      toast.error('Only admins can change user roles.');
      return;
    }
    setUpdatingId(userId);
    const { error } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('id', userId);

    setUpdatingId(null);
    if (error) {
      toast.error(`Failed to update role: ${error.message}`);
    } else {
      toast.success('Role updated successfully.');
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.full_name || '').toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] tracking-tight">
            User Management
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            View all users and manage their roles.
          </p>
        </div>
        <button
          onClick={fetchUsers}
          className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
          title="Refresh users"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
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
        <div className="overflow-x-auto">
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
                  Joined
                </th>
                {isAdmin && (
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                    Change Role
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: isAdmin ? 5 : 4 }).map((_, j) => (
                      <td key={`skel-${i}-${j}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Users size={36} className="text-[hsl(var(--muted-foreground))] opacity-40" />
                      <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                        {search ? 'No users match your search.' : 'No users found.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((u, idx) => {
                  const isCurrentUser = u.id === user?.id;
                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-[hsl(var(--border))] transition-colors duration-100 ${
                        idx % 2 === 0 ? '' : 'bg-[hsl(var(--muted)/0.15)]'
                      } ${isCurrentUser ? 'bg-[hsl(var(--primary)/0.04)]' : 'hover:bg-[hsl(var(--muted)/0.4)]'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary)/0.1)] flex items-center justify-center shrink-0">
                            <span className="text-xs font-semibold text-[hsl(var(--primary))]">
                              {(u.full_name || u.email).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-[hsl(var(--foreground))] text-sm">
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
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] text-sm">
                        {u.email}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border capitalize ${ROLE_COLORS[u.role]}`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] text-sm whitespace-nowrap">
                        {formatDate(u.created_at)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <div className="relative inline-block">
                            <select
                              value={u.role}
                              disabled={updatingId === u.id}
                              onChange={(e) =>
                                handleRoleChange(u.id, e.target.value as AppRole)
                              }
                              className="appearance-none pl-3 pr-8 py-1.5 text-xs border border-[hsl(var(--border))] rounded-lg bg-white text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] disabled:opacity-50 cursor-pointer transition-all"
                            >
                              {ROLE_OPTIONS.map((r) => (
                                <option key={r} value={r}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={12}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
                            />
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
    </div>
  );
}
