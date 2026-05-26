'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Eye,
  GitCompare,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  X,
  Search,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Sparkles,
  CalendarClock,
  BookOpen,
  Brain,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

import ComparisonFormModal from './ComparisonFormModal';
import { useRole } from '@/contexts/RoleContext';

interface ChangeItem {
  section: string;
  change_type: 'added' | 'removed' | 'modified';
  summary: string;
  old_text: string;
  new_text: string;
}

interface ChangeAnalysisRow {
  id: number;
  old_version_id: number;
  new_version_id: number;
  impact_level: 'low' | 'medium' | 'high' | null;
  summary_ai: string | null;
  changes_json: ChangeItem[] | null;
  affected_annexes?: string[] | null;
  applicability_dates_changed?: boolean | null;
  applicability_date_note?: string | null;
  created_at: string;
  old_version: {
    version_label: string;
    document: { title: string; document_code: string } | null;
  } | null;
  new_version: {
    version_label: string;
  } | null;
}

type SortField = 'created_at' | 'impact_level';
type SortDir = 'asc' | 'desc';

const IMPACT_COLORS: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

const IMPACT_ICON: Record<string, React.ReactNode> = {
  low: <CheckCircle2 size={13} className="text-emerald-600" />,
  medium: <TrendingUp size={13} className="text-amber-600" />,
  high: <AlertTriangle size={13} className="text-red-600" />,
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  added: 'bg-emerald-100 text-emerald-700',
  removed: 'bg-red-100 text-red-700',
  modified: 'bg-blue-100 text-blue-700',
};

export default function ComparisonsClient() {
  const [rows, setRows] = useState<ChangeAnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [filterImpact, setFilterImpact] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChangeAnalysisRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [viewTarget, setViewTarget] = useState<ChangeAnalysisRow | null>(null);
  const [expandedChange, setExpandedChange] = useState<number | null>(null);
  const { canRunComparisons, canDelete } = useRole();

  const fetchComparisons = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('change_analysis')
      .select(`
        id,
        old_version_id,
        new_version_id,
        impact_level,
        summary_ai,
        changes_json,
        affected_annexes,
        applicability_dates_changed,
        applicability_date_note,
        created_at,
        old_version:document_version!change_analysis_old_version_id_fkey (
          version_label,
          document:document ( title, document_code )
        ),
        new_version:document_version!change_analysis_new_version_id_fkey (
          version_label
        )
      `)
      .order(sortField, { ascending: sortDir === 'asc' });

    if (error) {
      toast.error(`Failed to load comparisons: ${error.message}`);
    } else {
      setRows((data as unknown as ChangeAnalysisRow[]) ?? []);
    }
    setLoading(false);
  }, [sortField, sortDir]);

  useEffect(() => {
    fetchComparisons();
  }, [fetchComparisons]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const { error } = await supabase
      .from('change_analysis')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleteLoading(false);
    if (error) {
      toast.error(`Failed to delete comparison: ${error.message}`);
    } else {
      toast.success('Comparison deleted.');
      setDeleteTarget(null);
      fetchComparisons();
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <ChevronUp size={13} className="text-[hsl(var(--muted-foreground))] opacity-40" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={13} className="text-[hsl(var(--primary))]" />
    ) : (
      <ChevronDown size={13} className="text-[hsl(var(--primary))]" />
    );
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  const filtered = rows.filter((row) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (row.old_version?.document?.title ?? '').toLowerCase().includes(q) ||
      (row.old_version?.document?.document_code ?? '').toLowerCase().includes(q) ||
      (row.old_version?.version_label ?? '').toLowerCase().includes(q) ||
      (row.new_version?.version_label ?? '').toLowerCase().includes(q);
    const matchImpact = !filterImpact || row.impact_level === filterImpact;
    return matchSearch && matchImpact;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] tracking-tight">
              Standards Analysis
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-violet-600 to-blue-600 text-white text-[10px] font-bold tracking-wide shadow-sm">
              <Sparkles size={9} />
              AI Powered
            </span>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            AI-generated change analyses between regulatory document versions — track amendments, affected annexes, applicability dates, and impact levels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchComparisons}
            className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
            title="Refresh comparisons"
          >
            <RefreshCw size={16} />
          </button>
          {canRunComparisons && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 shadow-sm"
            >
              <Plus size={16} />
              New Comparison
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search document, version…"
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
        <select
          value={filterImpact}
          onChange={(e) => setFilterImpact(e.target.value)}
          className="text-sm border border-[hsl(var(--border))] rounded-lg px-3 py-2 bg-white text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
        >
          <option value="">All Impact Levels</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <p className="text-sm text-[hsl(var(--muted-foreground))] tabular-nums ml-auto">
          {filtered.length} of {rows.length} comparison{rows.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Impact summary pills */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {(['high', 'medium', 'low'] as const).map((level) => {
            const count = rows.filter((r) => r.impact_level === level).length;
            if (count === 0) return null;
            return (
              <button
                key={level}
                onClick={() => setFilterImpact(filterImpact === level ? '' : level)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150 ${
                  filterImpact === level
                    ? IMPACT_COLORS[level] + ' ring-2 ring-offset-1 ring-current'
                    : IMPACT_COLORS[level]
                }`}
              >
                {IMPACT_ICON[level]}
                {count} {level.charAt(0).toUpperCase() + level.slice(1)} Impact
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Document
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Versions
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap cursor-pointer select-none hover:text-[hsl(var(--foreground))]"
                  onClick={() => handleSort('impact_level')}
                >
                  <span className="inline-flex items-center gap-1">
                    Impact <SortIcon field="impact_level" />
                  </span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  AI Summary
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap cursor-pointer select-none hover:text-[hsl(var(--foreground))]"
                  onClick={() => handleSort('created_at')}
                >
                  <span className="inline-flex items-center gap-1">
                    Created <SortIcon field="created_at" />
                  </span>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={`skel-${i}-${j}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                        <GitCompare size={26} className="text-[hsl(var(--muted-foreground))] opacity-60" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                          {rows.length === 0 ? 'No comparisons yet' : 'No results match your filters'}
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          {rows.length === 0
                            ? 'Generate a comparison between two versions to assess compliance impact.' : 'Try adjusting your search or filter criteria.'}
                        </p>
                      </div>
                      {rows.length === 0 && canRunComparisons && (
                        <button
                          onClick={() => setModalOpen(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] transition-all duration-150"
                        >
                          <Plus size={14} />
                          Create First Comparison
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => {
                  const docTitle = row.old_version?.document?.title ?? '—';
                  const docCode = row.old_version?.document?.document_code ?? '';
                  const oldLabel = row.old_version?.version_label ?? '—';
                  const newLabel = row.new_version?.version_label ?? '—';
                  const annexes = row.affected_annexes ?? [];

                  return (
                    <tr
                      key={`row-${row.id}`}
                      className={`border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100 group ${
                        idx % 2 === 0 ? '' : 'bg-[hsl(var(--muted)/0.15)]'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-[hsl(var(--foreground))]">
                          {docTitle}
                        </span>
                        {docCode && (
                          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 font-mono">
                            {docCode}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))] font-medium">
                            {oldLabel}
                          </span>
                          <span className="text-[hsl(var(--muted-foreground))] text-xs">→</span>
                          <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))] font-medium">
                            {newLabel}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.impact_level ? (
                          <div className="space-y-1">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${IMPACT_COLORS[row.impact_level]}`}>
                              {IMPACT_ICON[row.impact_level]}
                              {row.impact_level.charAt(0).toUpperCase() + row.impact_level.slice(1)}
                            </span>
                            {row.applicability_dates_changed && (
                              <div className="flex items-center gap-1">
                                <CalendarClock size={10} className="text-amber-600 shrink-0" />
                                <span className="text-[10px] text-amber-700 font-medium">Dates changed</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))] opacity-50 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {row.summary_ai ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1 mb-1">
                              <Brain size={11} className="text-violet-500 shrink-0" />
                              <span className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide">AI Summary</span>
                            </div>
                            <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-2 leading-relaxed">
                              {row.summary_ai}
                            </p>
                            {annexes.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-1">
                                <BookOpen size={10} className="text-blue-500 shrink-0" />
                                {annexes.slice(0, 3).map((annex) => (
                                  <span key={annex} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-medium">
                                    {annex}
                                  </span>
                                ))}
                                {annexes.length > 3 && (
                                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">+{annexes.length - 3}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))] opacity-50 text-xs">No AI summary</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] tabular-nums text-xs">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setViewTarget(row); setExpandedChange(null); }}
                            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                            title="View comparison"
                          >
                            <Eye size={15} />
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => setDeleteTarget(row)}
                              className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 transition-all duration-150"
                              title="Delete comparison"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Comparison Modal */}
      <ComparisonFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchComparisons}
      />

      {/* View Modal — Comparison Detail */}
      {viewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-[hsl(var(--border))] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] flex-shrink-0 bg-gradient-to-r from-slate-50 to-violet-50/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-violet-100 rounded-lg">
                  <Brain size={15} className="text-violet-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                    Comparison #{viewTarget.id}
                  </h2>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">AI-generated change analysis</p>
                </div>
              </div>
              <button
                onClick={() => { setViewTarget(null); setExpandedChange(null); }}
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Document</p>
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {viewTarget.old_version?.document?.title ?? '—'}
                  </p>
                  {viewTarget.old_version?.document?.document_code && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                      {viewTarget.old_version.document.document_code}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Impact Level</p>
                  {viewTarget.impact_level ? (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${IMPACT_COLORS[viewTarget.impact_level]}`}>
                      {IMPACT_ICON[viewTarget.impact_level]}
                      {viewTarget.impact_level.charAt(0).toUpperCase() + viewTarget.impact_level.slice(1)} Impact
                    </span>
                  ) : (
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">Not specified</span>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Old Version</p>
                  <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))]">
                    {viewTarget.old_version?.version_label ?? '—'}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">New Version</p>
                  <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))]">
                    {viewTarget.new_version?.version_label ?? '—'}
                  </span>
                </div>
                <div className="col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Created</p>
                  <p className="text-sm text-[hsl(var(--foreground))]">
                    {formatDate(viewTarget.created_at)}
                  </p>
                </div>
              </div>

              {/* AI Summary Panel */}
              {viewTarget.summary_ai && (
                <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-blue-50/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-violet-200 bg-violet-50/60">
                    <Sparkles size={13} className="text-violet-600" />
                    <span className="text-xs font-bold text-violet-700 uppercase tracking-wide">AI Change Summary</span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed">
                      {viewTarget.summary_ai}
                    </p>

                    {/* Affected Annexes */}
                    {viewTarget.affected_annexes && viewTarget.affected_annexes.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <BookOpen size={12} className="text-blue-600" />
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Affected Annexes</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {viewTarget.affected_annexes.map((annex) => (
                            <span key={annex} className="text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg font-semibold">
                              {annex}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Applicability Date Change */}
                    {viewTarget.applicability_dates_changed && (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                        <CalendarClock size={14} className="text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-amber-800">Applicability Dates Changed</p>
                          {viewTarget.applicability_date_note && (
                            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{viewTarget.applicability_date_note}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* No annexes / no date change note */}
                    {(!viewTarget.affected_annexes || viewTarget.affected_annexes.length === 0) && !viewTarget.applicability_dates_changed && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] italic">No specific annexes identified. Applicability dates unchanged.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Changes list */}
              {viewTarget.changes_json && viewTarget.changes_json.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
                    Structured Changes ({viewTarget.changes_json.length})
                  </p>
                  <div className="space-y-2">
                    {viewTarget.changes_json.map((change, idx) => (
                      <div key={idx} className="border border-[hsl(var(--border))] rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setExpandedChange(expandedChange === idx ? null : idx)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`flex-shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${CHANGE_TYPE_COLORS[change.change_type] ?? 'bg-gray-100 text-gray-600'}`}>
                              {change.change_type}
                            </span>
                            <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate">
                              {change.section}
                            </span>
                          </div>
                          {expandedChange === idx ? (
                            <ChevronUp size={13} className="flex-shrink-0 text-[hsl(var(--muted-foreground))]" />
                          ) : (
                            <ChevronDown size={13} className="flex-shrink-0 text-[hsl(var(--muted-foreground))]" />
                          )}
                        </button>
                        {expandedChange === idx && (
                          <div className="px-3 pb-3 space-y-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)]">
                            <p className="text-xs text-[hsl(var(--foreground))] pt-2 leading-relaxed">{change.summary}</p>
                            {(change.old_text || change.new_text) && (
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                {change.old_text && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-red-600 uppercase mb-1">Before</p>
                                    <p className="text-xs text-[hsl(var(--muted-foreground))] bg-red-50 rounded p-2 leading-relaxed">{change.old_text}</p>
                                  </div>
                                )}
                                {change.new_text && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">After</p>
                                    <p className="text-xs text-[hsl(var(--muted-foreground))] bg-emerald-50 rounded p-2 leading-relaxed">{change.new_text}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex justify-end flex-shrink-0">
              <button
                onClick={() => { setViewTarget(null); setExpandedChange(null); }}
                className="px-4 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] rounded-lg transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Comparison"
        description={`Are you sure you want to delete Comparison #${deleteTarget?.id}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
