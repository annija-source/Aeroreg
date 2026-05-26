'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type AppRole = 'admin' | 'editor' | 'viewer';

interface RoleContextValue {
  role: AppRole | null;
  roleLoading: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isViewer: boolean;
  canCreate: boolean;   // admin + editor
  canEdit: boolean;     // admin + editor
  canDelete: boolean;   // admin only
  canManageUsers: boolean; // admin only
  canRunComparisons: boolean; // all roles
  refreshRole: () => Promise<void>;
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  roleLoading: true,
  isAdmin: false,
  isEditor: false,
  isViewer: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canManageUsers: false,
  canRunComparisons: false,
  refreshRole: async () => {},
});

export const useRole = () => useContext(RoleContext);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const supabase = createClient();

  const fetchRole = async () => {
    if (!user) {
      setRole(null);
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!error && data?.role) {
      setRole(data.role as AppRole);
    } else {
      // Default to viewer if no profile found yet
      setRole('viewer');
    }
    setRoleLoading(false);
  };

  useEffect(() => {
    if (!authLoading) {
      fetchRole();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const isAdmin = role === 'admin';
  const isEditor = role === 'editor';
  const isViewer = role === 'viewer';

  const value: RoleContextValue = {
    role,
    roleLoading,
    isAdmin,
    isEditor,
    isViewer,
    canCreate: isAdmin || isEditor,
    canEdit: isAdmin || isEditor,
    canDelete: isAdmin,
    canManageUsers: isAdmin,
    canRunComparisons: true, // all authenticated users
    refreshRole: fetchRole,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
