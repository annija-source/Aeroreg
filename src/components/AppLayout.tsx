'use client';
import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/contexts/RoleContext';
import { LogOut, ChevronDown, User } from 'lucide-react';

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-blue-100 text-blue-700 border-blue-200',
  editor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  viewer: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { role } = useRole();

  const userLabel = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const userEmail = user?.email ?? '';
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
  const roleBadgeClass = role ? ROLE_BADGE[role] ?? ROLE_BADGE.viewer : ROLE_BADGE.viewer;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((p) => !p)} />
      <div
        className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
          collapsed ? 'ml-16' : 'ml-60'
        }`}
      >
        {/* Top header bar */}
        <header className="h-14 flex items-center justify-end px-6 border-b border-slate-200 bg-white shadow-sm shrink-0 gap-3">
          {/* User info */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen((p) => !p)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-100 transition-all duration-150 border border-transparent hover:border-slate-200"
            >
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-[11px] font-bold text-white uppercase">
                  {userLabel.charAt(0)}
                </span>
              </div>
              <span className="text-sm font-semibold text-slate-700 max-w-[120px] truncate hidden sm:block">
                {userLabel}
              </span>
              {roleLabel && (
                <span
                  className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${roleBadgeClass}`}
                >
                  {roleLabel}
                </span>
              )}
              <ChevronDown size={13} className="text-slate-400" />
            </button>

            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-4 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                        <span className="text-sm font-bold text-white uppercase">
                          {userLabel.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {userLabel}
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {userEmail}
                        </p>
                      </div>
                    </div>
                    {roleLabel && (
                      <span
                        className={`inline-flex items-center mt-3 px-2.5 py-1 rounded-lg text-xs font-bold border ${roleBadgeClass}`}
                      >
                        {roleLabel}
                      </span>
                    )}
                  </div>
                  <div className="py-1.5">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <User size={15} className="text-slate-400" />
                      Profile
                    </button>
                    <div className="mx-3 my-1 border-t border-slate-100" />
                    <button
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await signOut();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={15} />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-full px-6 py-7 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}