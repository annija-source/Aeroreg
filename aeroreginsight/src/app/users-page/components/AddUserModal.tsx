'use client';
import React, { useState } from 'react';
import { X, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

type AppRole = 'admin' | 'editor' | 'viewer';

interface AddUserModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddUserModal({ onClose, onSuccess }: AddUserModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AppRole>('viewer');
  const [isActive, setIsActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error('Email and password are required.');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/users/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          role,
          is_active: isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to create user: ${data.error ?? 'Unknown error'}`);
        return;
      }
      toast.success(`User ${email} created successfully.`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(`Unexpected error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[hsl(var(--border))]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Add New User</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
                className="w-full px-3 py-2 pr-10 text-sm border border-[hsl(var(--border))] rounded-lg bg-white placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="John Doe"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
            >
              <option value="viewer">Viewer — Read-only access</option>
              <option value="editor">Editor — Create &amp; edit documents</option>
              <option value="admin">Admin — Full access</option>
            </select>
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)]">
            <div>
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">Active</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Inactive users cannot log in
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] ${
                isActive ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground)/0.4)]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  isActive ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium bg-[hsl(var(--primary))] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
