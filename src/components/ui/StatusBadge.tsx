import React from 'react';

type Variant = 'active' | 'inactive' | 'draft' | 'superseded' | 'archived' | 'low' | 'medium' | 'high' | 'default';

const variantStyles: Record<Variant, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-gray-100 text-gray-500 border-gray-200',
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  superseded: 'bg-orange-50 text-orange-700 border-orange-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
  default: 'bg-blue-50 text-blue-700 border-blue-200',
};

export default function StatusBadge({
  label,
  variant,
}: {
  label?: string;
  variant?: Variant;
}) {
  const safeLabel = label ?? '';
  const resolved: Variant =
    variant ??
    ((safeLabel.toLowerCase() as Variant) in variantStyles
      ? (safeLabel.toLowerCase() as Variant)
      : 'default');
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${variantStyles[resolved]}`}
    >
      {safeLabel}
    </span>
  );
}