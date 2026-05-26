'use client';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Search,
  FileText,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Sparkles,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  Eye,
  History,
  Link2,
  LayoutGrid,
  X,
  TrendingUp,
  Filter,
  Zap,
  BookOpen,
  BookMarked,
} from 'lucide-react';

const supabase = createClient();

type Regulation = {
  id: number;
  regulation_number: string;
  title: string;
  authority: string | null;
  regulation_type: string | null;
  short_label: string | null;
  official_url: string | null;
  notes: string | null;
  created_at: string;
  related_document_id: number | null;
  document?: { title: string; document_code: string } | null;
};

type RegulationEnriched = Regulation & {
  latestDate: string | null;
  historyCount: number;
  annexes: string[];
  latestRevisionLabel: string | null;
  latestRevisionDate: string | null;
};

type SortField = 'regulation_number' | 'title' | 'authority' | 'applicability_date';
type SortDir = 'asc' | 'desc';

const ANNEX_COLORS: Record<string, string> = {
  'Annex I': 'bg-blue-100 text-blue-700 border-blue-200',
  'Annex II': 'bg-purple-100 text-purple-700 border-purple-200',
  'Annex III': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Annex IV': 'bg-amber-100 text-amber-700 border-amber-200',
  'Annex V': 'bg-rose-100 text-rose-700 border-rose-200',
  'Annex VI': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  'Annex VII': 'bg-indigo-100 text-indigo-700 border-indigo-200',
  'Part-ARO': 'bg-violet-100 text-violet-700 border-violet-200',
  'Part-ORO': 'bg-teal-100 text-teal-700 border-teal-200',
  'Part-CAT': 'bg-orange-100 text-orange-700 border-orange-200',
  'Part-SPA': 'bg-pink-100 text-pink-700 border-pink-200',
  'Part-NCC': 'bg-lime-100 text-lime-700 border-lime-200',
  'Part-NCO': 'bg-sky-100 text-sky-700 border-sky-200',
};

function getAnnexColor(annex: string): string {
  if (ANNEX_COLORS[annex]) return ANNEX_COLORS[annex];
  const hash = annex.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const palettes = [
    'bg-blue-100 text-blue-700 border-blue-200',
    'bg-purple-100 text-purple-700 border-purple-200',
    'bg-emerald-100 text-emerald-700 border-emerald-200',
    'bg-amber-100 text-amber-700 border-amber-200',
    'bg-rose-100 text-rose-700 border-rose-200',
    'bg-cyan-100 text-cyan-700 border-cyan-200',
    'bg-indigo-100 text-indigo-700 border-indigo-200',
    'bg-teal-100 text-teal-700 border-teal-200',
  ];
  return palettes[hash % palettes.length];
}

function getDateStatus(dateStr: string | null): {
  label: string;
  badge: string;
  detail: string;
  isUpcoming: boolean;
} {
  if (!dateStr) {
    return {
      label: '—',
      badge: 'bg-slate-100 text-slate-400 border-slate-200',
      detail: 'No date set',
      isUpcoming: false,
    };
  }
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) {
    return {
      label: diffDays === 1 ? 'Tomorrow' : `In ${diffDays}d`,
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      detail: `Upcoming: ${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      isUpcoming: true,
    };
  } else {
    const activeSince = Math.abs(diffDays);
    return {
      label: 'Active',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      detail: `Since ${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} (${activeSince}d ago)`,
      isUpcoming: false,
    };
  }
}

export default function RegulationsClient() {
  const router = useRouter();
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [enriched, setEnriched] = useState<RegulationEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAuthority, setFilterAuthority] = useState('');
  const [filterAnnex, setFilterAnnex] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState<SortField>('regulation_number');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const fetchRegulations = useCallback(async () => {
    setLoading(true);

    const { data: regData, error: regError } = await supabase
      .from('regulation')
      .select(
        'id, regulation_number, title, authority, regulation_type, short_label, official_url, notes, created_at, related_document_id'
      )
      .order('regulation_number', { ascending: true });

    if (regError) {
      toast.error(`Failed to load regulations: ${regError.message}`);
      setLoading(false);
      return;
    }

    let rows = regData ?? [];

    // Fetch related documents
    const docIds = [...new Set(rows.map((r) => r.related_document_id).filter(Boolean))] as number[];
    let docMap: Record<number, { title: string; document_code: string }> = {};
    if (docIds.length > 0) {
      const { data: docData } = await supabase
        .from('document')
        .select('id, title, document_code')
        .in('id', docIds);
      (docData ?? []).forEach((d) => {
        docMap[d.id] = { title: d.title, document_code: d.document_code };
      });
    }

    const merged: Regulation[] = rows.map((r) => ({
      ...r,
      document: r.related_document_id ? (docMap[r.related_document_id] ?? null) : null,
    }));

    setRegulations(merged);

    // Enrich: fetch applicability dates, history counts, annexes, and revisions for all regulations
    const regIds = merged.map((r) => r.id);

    const versionsRes = await supabase
      .from('regulation_version')
      .select('regulation_id, applicability_date, id, document_revision_id')
      .in('regulation_id', regIds);

    // Build version map
    const versionsByReg: Record<number, { applicability_date: string | null; id: number; document_revision_id: number | null }[]> = {};
    const allVersionIds: number[] = [];
    const allRevisionIds: number[] = [];
    (versionsRes.data ?? []).forEach((v) => {
      if (!versionsByReg[v.regulation_id]) versionsByReg[v.regulation_id] = [];
      versionsByReg[v.regulation_id].push({ applicability_date: v.applicability_date, id: v.id, document_revision_id: v.document_revision_id ?? null });
      allVersionIds.push(v.id);
      if (v.document_revision_id) allRevisionIds.push(v.document_revision_id);
    });

    // Fetch revision labels
    let revisionMap: Record<number, { revision_label: string; publication_date: string | null }> = {};
    if (allRevisionIds.length > 0) {
      const uniqueRevIds = [...new Set(allRevisionIds)];
      const { data: revData } = await supabase
        .from('document_revision')
        .select('id, revision_label, publication_date')
        .in('id', uniqueRevIds);
      (revData ?? []).forEach((rev: { id: number; revision_label: string; publication_date: string | null }) => {
        revisionMap[rev.id] = { revision_label: rev.revision_label, publication_date: rev.publication_date };
      });
    }

    // Fetch annexes for all version ids
    let annexByVersion: Record<number, string[]> = {};
    if (allVersionIds.length > 0) {
      const { data: annexData } = await supabase
        .from('regulation_annex')
        .select('regulation_version_id, annex:annex_id(annex_code, part_code, annex_title)')
        .in('regulation_version_id', allVersionIds);

      (annexData ?? []).forEach((a: any) => {
        const vid = a.regulation_version_id;
        if (!annexByVersion[vid]) annexByVersion[vid] = [];
        const label =
          a.annex?.part_code || a.annex?.annex_code || a.annex?.annex_title || 'Unknown';
        if (!annexByVersion[vid].includes(label)) annexByVersion[vid].push(label);
      });
    }

    const enrichedRows: RegulationEnriched[] = merged.map((reg) => {
      const versions = versionsByReg[reg.id] ?? [];
      const dates = versions
        .map((v) => v.applicability_date)
        .filter(Boolean)
        .sort()
        .reverse();
      const latestDate = dates[0] ?? null;
      const historyCount = versions.length;

      // Collect unique annexes across all versions
      const annexSet = new Set<string>();
      versions.forEach((v) => {
        (annexByVersion[v.id] ?? []).forEach((a) => annexSet.add(a));
      });

      // Find latest revision: prefer version with latest publication_date
      let latestRevisionLabel: string | null = null;
      let latestRevisionDate: string | null = null;
      versions.forEach((v) => {
        if (v.document_revision_id && revisionMap[v.document_revision_id]) {
          const rev = revisionMap[v.document_revision_id];
          if (!latestRevisionDate || (rev.publication_date && rev.publication_date > latestRevisionDate)) {
            latestRevisionLabel = rev.revision_label;
            latestRevisionDate = rev.publication_date;
          }
        }
      });

      return {
        ...reg,
        latestDate,
        historyCount,
        annexes: Array.from(annexSet),
        latestRevisionLabel,
        latestRevisionDate,
      };
    });

    setEnriched(enrichedRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRegulations();
  }, [fetchRegulations]);

  // Derive filter options from data
  const typeOptions = useMemo(
    () => [...new Set(enriched.map((r) => r.regulation_type).filter(Boolean))] as string[],
    [enriched]
  );
  const authorityOptions = useMemo(
    () => [...new Set(enriched.map((r) => r.authority).filter(Boolean))] as string[],
    [enriched]
  );
  const annexOptions = useMemo(() => {
    const all = new Set<string>();
    enriched.forEach((r) => r.annexes.forEach((a) => all.add(a)));
    return Array.from(all).sort();
  }, [enriched]);

  // Filter + sort
  const filtered = useMemo(() => {
    const now = new Date();
    let rows = enriched.filter((r) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        r.regulation_number?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q);
      const matchType = !filterType || r.regulation_type === filterType;
      const matchAuthority = !filterAuthority || r.authority === filterAuthority;
      const matchAnnex = !filterAnnex || r.annexes.includes(filterAnnex);
      const matchStatus =
        !filterStatus ||
        (filterStatus === 'active' && r.latestDate !== null && new Date(r.latestDate) <= now) ||
        (filterStatus === 'upcoming' && r.latestDate !== null && new Date(r.latestDate) > now) ||
        (filterStatus === 'no_date' && r.latestDate === null);
      return matchSearch && matchType && matchAuthority && matchAnnex && matchStatus;
    });

    rows = [...rows].sort((a, b) => {
      let va: string | null = null;
      let vb: string | null = null;
      if (sortField === 'regulation_number') {
        va = a.regulation_number;
        vb = b.regulation_number;
      } else if (sortField === 'title') {
        va = a.title;
        vb = b.title;
      } else if (sortField === 'authority') {
        va = a.authority;
        vb = b.authority;
      } else if (sortField === 'applicability_date') {
        va = a.latestDate;
        vb = b.latestDate;
      }
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    return rows;
  }, [enriched, search, filterType, filterAuthority, filterAnnex, filterStatus, sortField, sortDir]);

  const hasActiveFilters = !!(search || filterType || filterAuthority || filterAnnex || filterStatus);

  const resetFilters = () => {
    setSearch('');
    setFilterType('');
    setFilterAuthority('');
    setFilterAnnex('');
    setFilterStatus('');
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Insights
  const insights = useMemo(() => {
    const now = new Date();
    const futureRegs = enriched.filter((r) => r.latestDate && new Date(r.latestDate) > now);
    const nextReg = [...futureRegs].sort((a, b) =>
      (a.latestDate ?? '').localeCompare(b.latestDate ?? '')
    )[0];

    const annexCount: Record<string, number> = {};
    enriched.forEach((r) => r.annexes.forEach((a) => (annexCount[a] = (annexCount[a] ?? 0) + 1)));
    const topAnnex = Object.entries(annexCount).sort((a, b) => b[1] - a[1])[0];

    return {
      total: enriched.length,
      futureCount: futureRegs.length,
      topAnnex: topAnnex ? `${topAnnex[0]} (${topAnnex[1]})` : '—',
      nextDate: nextReg?.latestDate
        ? new Date(nextReg.latestDate).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '—',
      nextRegNumber: nextReg?.regulation_number ?? null,
    };
  }, [enriched]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronUp size={12} className="text-slate-300" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-blue-600" />
    ) : (
      <ChevronDown size={12} className="text-blue-600" />
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-md shrink-0">
                <Sparkles size={22} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                    Regulations Intelligence
                  </h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm">
                    <Zap size={10} />
                    AI Powered
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Track regulations, affected annexes, applicability dates, and regulatory history.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                onClick={() => router.push('/annex-impact-page')}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl hover:opacity-90 transition-all shadow-sm hover:shadow-md"
              >
                <LayoutGrid size={15} />
                View Annex Impact
              </button>
              <button
                onClick={fetchRegulations}
                className="flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-sm"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* ── Insights Strip ── */}
        {!loading && enriched.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <FileText size={17} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Total Regulations</p>
                <p className="text-2xl font-bold text-slate-900 leading-tight">{insights.total}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <Clock size={17} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Future Regulations</p>
                <p className="text-2xl font-bold text-amber-700 leading-tight">{insights.futureCount}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-purple-200 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                <TrendingUp size={17} className="text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Most Impacted Annex</p>
                <p className="text-sm font-bold text-purple-700 truncate leading-tight mt-0.5">{insights.topAnnex}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm px-4 py-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <Calendar size={17} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Next Applicability</p>
                <p className="text-sm font-bold text-emerald-700 leading-tight mt-0.5">{insights.nextDate}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Filter Bar ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
              <Filter size={13} className="text-slate-500" />
            </div>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Filters &amp; Search
            </span>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-500 bg-slate-100 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-all"
              >
                <X size={11} />
                Reset filters
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Search */}
            <div className="relative lg:col-span-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Regulation number or title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all placeholder:text-slate-400"
              />
            </div>
            {/* Type */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="py-2.5 px-3 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              <option value="">All Types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {/* Annex */}
            <select
              value={filterAnnex}
              onChange={(e) => setFilterAnnex(e.target.value)}
              className="py-2.5 px-3 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              <option value="">All Annexes</option>
              {annexOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {/* Authority */}
            <select
              value={filterAuthority}
              onChange={(e) => setFilterAuthority(e.target.value)}
              className="py-2.5 px-3 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              <option value="">All Authorities</option>
              {authorityOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {/* Status */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="py-2.5 px-3 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="upcoming">Upcoming</option>
              <option value="no_date">No Date</option>
            </select>
          </div>
          {/* Sort row */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs text-slate-400 font-medium">Sort by:</span>
            {(
              [
                { field: 'regulation_number', label: 'Reg. Number' },
                { field: 'title', label: 'Title' },
                { field: 'authority', label: 'Authority' },
                { field: 'applicability_date', label: 'Applicability Date' },
              ] as { field: SortField; label: string }[]
            ).map(({ field, label }) => (
              <button
                key={field}
                onClick={() => toggleSort(field)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  sortField === field
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
                {sortField === field &&
                  (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center mb-4">
                <RefreshCw size={24} className="animate-spin text-blue-500" />
              </div>
              <p className="text-sm font-semibold text-slate-600">Loading regulations...</p>
              <p className="text-xs mt-1 text-slate-400">Fetching regulatory intelligence data</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <FileText size={28} className="text-slate-300" />
              </div>
              <p className="text-slate-700 font-semibold text-base">No regulations found</p>
              <p className="text-slate-400 text-sm mt-1.5 text-center max-w-sm leading-relaxed">
                {hasActiveFilters
                  ? 'No regulations match the current filters. Try adjusting your search or filters.' :'No regulations have been added yet.'}
              </p>
              {hasActiveFilters && (
                <button
                  onClick={resetFilters}
                  className="mt-5 flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors border border-blue-100"
                >
                  <X size={14} />
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-5 py-3.5 text-left">
                        <button
                          onClick={() => toggleSort('regulation_number')}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-800 transition-colors"
                        >
                          Regulation <SortIcon field="regulation_number" />
                        </button>
                      </th>
                      <th className="px-5 py-3.5 text-left">
                        <button
                          onClick={() => toggleSort('title')}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-800 transition-colors"
                        >
                          Title <SortIcon field="title" />
                        </button>
                      </th>
                      <th className="px-5 py-3.5 text-left">
                        <button
                          onClick={() => toggleSort('authority')}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-800 transition-colors"
                        >
                          Authority <SortIcon field="authority" />
                        </button>
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Affected Annexes
                      </th>
                      <th className="px-5 py-3.5 text-left">
                        <button
                          onClick={() => toggleSort('applicability_date')}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-800 transition-colors"
                        >
                          Applicability <SortIcon field="applicability_date" />
                        </button>
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Revision / History
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((reg) => (
                      <EnrichedRegulationRow
                        key={reg.id}
                        regulation={reg}
                        onView={() => router.push(`/regulations-page/detail?id=${reg.id}`)}
                        onViewHistory={() => router.push(`/regulations-page/detail?id=${reg.id}&tab=history`)}
                        onViewAnnexImpact={() => router.push('/annex-impact-page')}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Showing{' '}
                  <span className="font-semibold text-slate-600">{filtered.length}</span> of{' '}
                  <span className="font-semibold text-slate-600">{enriched.length}</span>{' '}
                  regulation{enriched.length !== 1 ? 's' : ''}
                </span>
                {hasActiveFilters && (
                  <button
                    onClick={resetFilters}
                    className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <X size={11} /> Clear filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EnrichedRegulationRow({
  regulation,
  onView,
  onViewHistory,
  onViewAnnexImpact,
}: {
  regulation: RegulationEnriched;
  onView: () => void;
  onViewHistory: () => void;
  onViewAnnexImpact: () => void;
}) {
  const dateStatus = getDateStatus(regulation.latestDate);

  return (
    <tr className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors duration-150 group">
      {/* Regulation Number */}
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg whitespace-nowrap w-fit">
            {regulation.regulation_number}
          </span>
          {regulation.regulation_type && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-500 w-fit">
              {regulation.regulation_type}
            </span>
          )}
        </div>
      </td>

      {/* Title */}
      <td className="px-5 py-4 align-top max-w-xs">
        <p className="font-semibold text-slate-800 group-hover:text-blue-700 transition-colors leading-snug text-sm">
          {regulation.title}
        </p>
        {regulation.short_label && (
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{regulation.short_label}</p>
        )}
        {regulation.document && (
          <div className="flex items-center gap-1 mt-1.5">
            <BookOpen size={11} className="text-slate-300 shrink-0" />
            <span className="text-xs text-slate-400 truncate max-w-[180px]">
              {regulation.document.title}
            </span>
          </div>
        )}
      </td>

      {/* Authority */}
      <td className="px-5 py-4 align-top">
        {regulation.authority ? (
          <span className="text-sm text-slate-700 font-medium">{regulation.authority}</span>
        ) : (
          <span className="text-slate-300 text-sm">—</span>
        )}
      </td>

      {/* Affected Annexes */}
      <td className="px-5 py-4 align-top">
        {regulation.annexes.length > 0 ? (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {regulation.annexes.slice(0, 4).map((annex) => (
              <span
                key={annex}
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${getAnnexColor(annex)}`}
              >
                {annex}
              </span>
            ))}
            {regulation.annexes.length > 4 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
                +{regulation.annexes.length - 4}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-300 text-xs italic">No annexes</span>
        )}
      </td>

      {/* Applicability Date */}
      <td className="px-5 py-4 align-top">
        {regulation.latestDate ? (
          <div className="flex flex-col gap-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold border w-fit ${dateStatus.badge}`}
            >
              {dateStatus.isUpcoming ? (
                <AlertTriangle size={10} />
              ) : (
                <CheckCircle size={10} />
              )}
              {dateStatus.label}
            </span>
            <span className="text-xs text-slate-400 leading-relaxed">{dateStatus.detail}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-300 italic">No date set</span>
        )}
      </td>

      {/* Revision / History */}
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col gap-1.5">
          {regulation.latestRevisionLabel ? (
            <div className="flex items-center gap-1.5">
              <BookMarked size={12} className="text-indigo-500 shrink-0" />
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md whitespace-nowrap">
                {regulation.latestRevisionLabel}
              </span>
            </div>
          ) : null}
          {regulation.latestRevisionDate && (
            <span className="text-xs text-slate-400 pl-5">
              {new Date(regulation.latestRevisionDate).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}
          {regulation.historyCount > 0 ? (
            <div className="flex items-center gap-1.5">
              <History size={12} className="text-slate-400" />
              <span className="text-xs text-slate-500">
                {regulation.historyCount} version{regulation.historyCount !== 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            !regulation.latestRevisionLabel && (
              <span className="text-xs text-slate-300 italic">No history</span>
            )
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={onView}
              title="View Details"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 hover:border-blue-200 transition-all"
            >
              <Eye size={11} />
              Details
            </button>
            <button
              onClick={onViewHistory}
              title="View History"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-100 rounded-lg hover:bg-purple-100 hover:border-purple-200 transition-all"
            >
              <History size={11} />
              History
            </button>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {regulation.official_url ? (
              <a
                href={regulation.official_url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open Related Document"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-all"
              >
                <ExternalLink size={11} />
                Document
              </a>
            ) : (
              <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-50 border border-slate-100 rounded-lg cursor-not-allowed">
                <Link2 size={11} />
                Document
              </span>
            )}
            <button
              onClick={onViewAnnexImpact}
              title="View Annex Impact"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-100 hover:border-emerald-200 transition-all"
            >
              <LayoutGrid size={11} />
              Annex
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
