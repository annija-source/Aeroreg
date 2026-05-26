'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, GitCompare, ChevronLeft, ChevronRight, Plane, Users, Database, ScrollText, BookOpen, ShieldCheck } from 'lucide-react';
import { useRole } from '@/contexts/RoleContext';


type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
};

const baseNavItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: <LayoutDashboard size={20} />,
  },
  {
    label: 'Regulations',
    href: '/regulations-page',
    icon: <ScrollText size={20} />,
  },
  {
    label: 'Annex Impact',
    href: '/annex-impact-page',
    icon: <BookOpen size={20} />,
  },
  {
    label: 'Documents',
    href: '/documents-page',
    icon: <FileText size={20} />,
  },
  {
    label: 'Standards Analysis',
    href: '/comparisons-page',
    icon: <GitCompare size={20} />,
  },
  {
    label: 'Sources',
    href: '/sources-page',
    icon: <Database size={20} />,
  },
  {
  label: 'Compliance Gaps',
  href: '/compliance-gap-page',
  icon: <ShieldCheck size={20} />,
},
];

const adminNavItem: NavItem = {
  label: 'Users',
  href: '/users',
  icon: <Users size={20} />,
};

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const { isAdmin } = useRole();

  const navItems = isAdmin
    ? [...baseNavItems, adminNavItem]
    : baseNavItems;

  return (
    <aside
      className={`fixed top-0 left-0 h-full z-40 flex flex-col bg-white border-r border-slate-200 shadow-md transition-all duration-300 ease-in-out ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center gap-2.5 px-4 py-4 border-b border-slate-200 ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <div className="flex items-center justify-center w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shrink-0 shadow-md">
          <Plane size={17} className="text-white" strokeWidth={2} />
        </div>
        {!collapsed && (
          <span className="font-bold text-[15px] text-slate-900 tracking-tight whitespace-nowrap">
            AeroReg{' '}
            <span className="text-slate-400 font-normal">
              Insight
            </span>
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
        {!collapsed && (
          <p className="px-3 mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Navigation
          </p>
        )}
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={`nav-${item.href}`}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative ${
                isActive
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 hover:shadow-sm'
              }`}
            >
              {/* Active left indicator */}
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white/40 rounded-r-full" />
              )}
              <span
                className={`shrink-0 transition-all duration-200 ${
                  isActive
                    ? 'text-white' : 'text-slate-400 group-hover:text-slate-700 group-hover:scale-110'
                }`}
              >
                {item.icon}
              </span>
              {!collapsed && (
                <span className={`truncate font-semibold ${isActive ? 'text-white' : ''}`}>
                  {item.label}
                </span>
              )}
              {!collapsed && item.badge !== undefined && item.badge > 0 && (
                <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${isActive ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}`}>
                  {item.badge}
                </span>
              )}
              {collapsed && (
                <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Toggle */}
      <div className="px-2.5 py-3 border-t border-slate-200">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all duration-200"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs font-semibold">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}