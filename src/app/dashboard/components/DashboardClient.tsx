'use client';
import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { FileText, GitCompare, Plus, ArrowRight, TrendingUp, AlertTriangle, CheckCircle2, Shield, ListChecks, CalendarClock, BarChart3, Sparkles, Brain, Zap } from 'lucide-react';
import StatusBadge from '@/components/ui/StatusBadge';

interface DashboardStats {
  totalDocuments: number;
  totalVersions: number;
  totalComparisons: number;
  totalRegulations: number;
  affectedAnnexes: number;
  recentlyAdded: number;
  newRegulationsThisMonth: number;
  upcomingApplicabilityCount: number;
  nextApplicabilityDays: number | null;
  newDocumentsThisMonth: number;
}

interface RecentRegulation {
  id: number;
  regulation_number: string;
  title: string;
  authority: string;
  regulation_type: string;
  created_at: string;
}

interface UpcomingApplicability {
  id: number;
  applicability_date: string;
  applicability_note: string | null;
  status: string;
  regulation: { regulation_number: string; title: string; authority: string } | null;
  affected_annexes: string[];
}

interface AnnexImpactRow {
  annex_code: string;
  annex_title: string | null;
  regulation_count: number;
}

interface RecentComparison {
  id: number;
  impact_level: 'low' | 'medium' | 'high' | null;
  summary_ai: string | null;
  affected_annexes: string[] | null;
  applicability_dates_changed: boolean | null;
  created_at: string;
  old_version: { version_label: string; document: { title: string } | null } | null;
  new_version: { version_label: string } | null;
}

export default function DashboardClient() {
  const router = useRouter();
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalDocuments: 0,
    totalVersions: 0,
    totalComparisons: 0,
    totalRegulations: 0,
    affectedAnnexes: 0,
    recentlyAdded: 0,
    newRegulationsThisMonth: 0,
    upcomingApplicabilityCount: 0,
    nextApplicabilityDays: null,
    newDocumentsThisMonth: 0,
  });
  const [recentRegulations, setRecentRegulations] = useState<RecentRegulation[]>([]);
  const [upcomingApplicability, setUpcomingApplicability] = useState<UpcomingApplicability[]>([]);
  const [annexImpact, setAnnexImpact] = useState<AnnexImpactRow[]>([]);
  const [recentComparisons, setRecentComparisons] = useState<RecentComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [greetingState, setGreetingState] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);
    const firstOfMonthISO = firstOfMonth.toISOString();

    const [
      { count: docCount },
      { count: verCount },
      { count: compCount },
      { count: regCount },
      { count: newRegsThisMonth },
      { count: newDocsThisMonth },
      { data: recentRegs },
      { data: upcomingData },
      { data: recentComps },
      { data: annexImpactData },
    ] = await Promise.all([
      supabase.from('document').select('*', { count: 'exact', head: true }),
      supabase.from('document_version').select('*', { count: 'exact', head: true }),
      supabase.from('change_analysis').select('*', { count: 'exact', head: true }),
      supabase.from('regulation').select('*', { count: 'exact', head: true }),
      supabase
        .from('regulation')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', firstOfMonthISO),
      supabase
        .from('document')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', firstOfMonthISO),
      supabase
        .from('regulation')
        .select('id, regulation_number, title, authority, regulation_type, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase
        .from('regulation_version')
        .select(`
          id, applicability_date, applicability_note, status,
          regulation:regulation_id(regulation_number, title, authority),
          regulation_annex(annex:annex_id(annex_code))
        `)
        .gte('applicability_date', today)
        .order('applicability_date', { ascending: true })
        .limit(10),
      supabase
        .from('change_analysis')
        .select(`
          id, impact_level, summary_ai, affected_annexes, applicability_dates_changed, created_at,
          old_version:document_version!change_analysis_old_version_id_fkey(version_label, document:document(title)),
          new_version:document_version!change_analysis_new_version_id_fkey(version_label)
        `)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('regulation_annex')
        .select('annex_id, annex:annex_id(annex_code, annex_title)'),
    ]);

    const uniqueAnnexIds = new Set((annexImpactData ?? []).map((r: { annex_id: number }) => r.annex_id));
    const affectedAnnexCount = uniqueAnnexIds.size;

    const annexMap: Record<string, { annex_code: string; annex_title: string | null; regulation_count: number }> = {};
    for (const row of (annexImpactData ?? []) as { annex_id: number; annex: { annex_code: string; annex_title: string | null } | null }[]) {
      if (!row.annex) continue;
      const key = row.annex.annex_code;
      if (!annexMap[key]) {
        annexMap[key] = { annex_code: row.annex.annex_code, annex_title: row.annex.annex_title, regulation_count: 0 };
      }
      annexMap[key].regulation_count += 1;
    }
    const sortedAnnexImpact = Object.values(annexMap)
      .sort((a, b) => b.regulation_count - a.regulation_count)
      .slice(0, 8);

    // Compute upcoming applicability data
    const mappedUpcoming = ((upcomingData ?? []) as unknown as Array<{
      id: number;
      applicability_date: string;
      applicability_note: string | null;
      status: string;
      regulation: { regulation_number: string; title: string; authority: string } | null;
      regulation_annex: Array<{ annex: { annex_code: string } | null }> | null;
    }>).map((rv) => ({
      id: rv.id,
      applicability_date: rv.applicability_date,
      applicability_note: rv.applicability_note,
      status: rv.status,
      regulation: rv.regulation,
      affected_annexes: (rv.regulation_annex ?? [])
        .map((ra) => ra.annex?.annex_code)
        .filter((c): c is string => !!c),
    }));

    const nextApplicabilityDays =
      mappedUpcoming.length > 0
        ? Math.ceil((new Date(mappedUpcoming[0].applicability_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

    setStats({
      totalDocuments: docCount ?? 0,
      totalVersions: verCount ?? 0,
      totalComparisons: compCount ?? 0,
      totalRegulations: regCount ?? 0,
      affectedAnnexes: affectedAnnexCount,
      recentlyAdded: 0,
      newRegulationsThisMonth: newRegsThisMonth ?? 0,
      upcomingApplicabilityCount: mappedUpcoming.length,
      nextApplicabilityDays,
      newDocumentsThisMonth: newDocsThisMonth ?? 0,
    });
    setRecentRegulations((recentRegs as unknown as RecentRegulation[]) ?? []);
    setUpcomingApplicability(mappedUpcoming);
    setRecentComparisons((recentComps as unknown as RecentComparison[]) ?? []);
    setAnnexImpact(sortedAnnexImpact);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  const daysUntil = (dateStr: string) => {
    const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `In ${diff} days`;
  };

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreetingState('Good morning');
    else if (hour < 17) setGreetingState('Good afternoon');
    else setGreetingState('Good evening');
  }, []);

  const userLabel = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';

  const IMPACT_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
    low: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Minor' },
    medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Moderate' },
    high: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Major' },
  };

  const IMPACT_ICON: Record<string, React.ReactNode> = {
    low: <CheckCircle2 size={13} className="text-emerald-600" />,
    medium: <TrendingUp size={13} className="text-amber-600" />,
    high: <AlertTriangle size={13} className="text-red-600" />,
  };

  // Build insight text for each KPI card
  const regInsight = stats.totalRegulations === 0
    ? 'No regulations yet'
    : stats.newRegulationsThisMonth > 0
      ? `+${stats.newRegulationsThisMonth} new regulation${stats.newRegulationsThisMonth > 1 ? 's' : ''} this month`
      : 'No new regulations this month';

  const docInsight = stats.totalDocuments === 0
    ? 'No documents yet'
    : stats.newDocumentsThisMonth > 0
      ? `+${stats.newDocumentsThisMonth} new document${stats.newDocumentsThisMonth > 1 ? 's' : ''} this month`
      : 'No new documents this month';

  const upcomingInsight = stats.upcomingApplicabilityCount === 0
    ? 'No upcoming dates'
    : stats.nextApplicabilityDays !== null
      ? stats.nextApplicabilityDays === 0
        ? 'Next applicability is today'
        : stats.nextApplicabilityDays === 1
          ? 'Next applicability tomorrow'
          : `Next applicability in ${stats.nextApplicabilityDays} days`
      : `${stats.upcomingApplicabilityCount} upcoming dates`;

  const annexInsight = stats.affectedAnnexes === 0
    ? 'No annexes mapped yet'
    : `${stats.affectedAnnexes} annex${stats.affectedAnnexes > 1 ? 'es' : ''} with active regulations`;

  const statCards = [
    {
      label: 'Total Documents',
      value: stats.totalDocuments,
      subValue: docInsight,
      subPositive: stats.newDocumentsThisMonth > 0,
      icon: <FileText size={20} className="text-indigo-600" />,
      iconBg: 'bg-indigo-100',
      gradientBar: 'from-indigo-500 to-blue-500',
      href: '/documents-page',
    },
    {
      label: 'Total Regulations',
      value: stats.totalRegulations,
      subValue: regInsight,
      subPositive: stats.newRegulationsThisMonth > 0,
      icon: <Shield size={20} className="text-blue-600" />,
      iconBg: 'bg-blue-100',
      gradientBar: 'from-blue-500 to-purple-500',
      href: '/regulations-page',
    },
    {
      label: 'Upcoming Applicability',
      value: stats.upcomingApplicabilityCount,
      subValue: upcomingInsight,
      subPositive: stats.upcomingApplicabilityCount > 0,
      icon: <CalendarClock size={20} className="text-amber-600" />,
      iconBg: 'bg-amber-100',
      gradientBar: 'from-amber-400 to-orange-500',
      href: '/regulations-page',
    },
    {
      label: 'Affected Annexes',
      value: stats.affectedAnnexes,
      subValue: annexInsight,
      subPositive: stats.affectedAnnexes > 0,
      icon: <ListChecks size={20} className="text-violet-600" />,
      iconBg: 'bg-violet-100',
      gradientBar: 'from-purple-500 to-pink-500',
      href: '/annex-impact-page',
    },
  ];

  const SkeletonCard = () => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 bg-slate-100 rounded w-28" />
        <div className="h-10 w-10 bg-slate-100 rounded-xl" />
      </div>
      <div className="h-12 bg-slate-100 rounded w-20 mb-2" />
      <div className="h-3 bg-slate-100 rounded w-32" />
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-0.5">
            {greetingState ?? 'Good day'}, {userLabel}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              AI Regulatory Intelligence Dashboard
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white text-[10px] font-bold tracking-wide shadow-sm">
              <Sparkles size={10} />
              AI Powered
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Aviation regulatory intelligence — automated extraction, annex impact analysis, and applicability tracking.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/regulations-page"
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 active:from-blue-800 active:to-blue-900 transition-all duration-150 shadow-sm hover:shadow-md hover:-translate-y-0.5"
          >
            <Shield size={15} />
            View Regulations
          </Link>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)
          : statCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-pointer"
              >
                {/* Gradient top accent bar */}
                <div className={`h-1 w-full bg-gradient-to-r ${card.gradientBar}`} />
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 leading-tight">
                      {card.label}
                    </p>
                    <div className={`p-2.5 rounded-xl ${card.iconBg} shrink-0 shadow-sm`}>{card.icon}</div>
                  </div>
                  <p className="text-5xl font-extrabold text-slate-900 tabular-nums leading-none mb-3">
                    {card.value}
                  </p>
                  <p className={`text-xs font-medium flex items-center gap-1.5 ${card.subPositive ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {card.subPositive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                    {card.subValue}
                  </p>
                  <p className="text-xs text-slate-400 mt-2.5 group-hover:text-blue-600 transition-colors flex items-center gap-1">
                    View all <ArrowRight size={11} />
                  </p>
                </div>
              </Link>
            ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left/center column — 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Regulations */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-blue-50/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-blue-100 rounded-lg">
                  <Sparkles size={14} className="text-blue-600" />
                </div>
                <h2 className="text-sm font-bold text-slate-800">Recent Regulations</h2>
                <span className="text-[10px] font-bold text-blue-500 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full">Automated Extraction</span>
              </div>
              <Link
                href="/regulations-page"
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 hover:underline"
              >
                View all <ArrowRight size={11} />
              </Link>
            </div>
            {loading ? (
              <div className="divide-y divide-slate-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={`rskel-${i}`} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                    <div className="h-4 bg-slate-100 rounded w-20 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-4 bg-slate-100 rounded w-3/4" />
                      <div className="h-3 bg-slate-100 rounded w-1/2" />
                    </div>
                    <div className="h-5 bg-slate-100 rounded w-16 shrink-0" />
                  </div>
                ))}
              </div>
            ) : recentRegulations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
                  <Shield size={26} className="text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-700">No regulations yet</p>
                <p className="text-xs text-slate-400 text-center max-w-xs">
                  Upload a regulatory document to begin automated extraction of structured regulatory data.
                </p>
                <Link href="/documents-page" className="mt-1 text-sm text-blue-600 hover:underline font-semibold">
                  Go to Documents
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentRegulations.map((reg) => (
                  <div
                    key={reg.id}
                    className="pl-0 pr-6 py-4 flex items-center gap-4 hover:bg-blue-50/40 transition-all duration-150 cursor-pointer group"
                    onClick={() => router.push('/regulations-page')}
                  >
                    {/* Left color accent line */}
                    <div className="w-1 self-stretch bg-gradient-to-b from-blue-400 to-purple-400 rounded-r-full shrink-0 ml-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
                    <div className="pl-5 flex items-center gap-4 flex-1 min-w-0">
                      <span className="font-mono text-xs bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 px-2.5 py-1 rounded-lg font-bold shrink-0 border border-blue-200 shadow-sm">
                        {reg.regulation_number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate leading-snug">{reg.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <span className="font-semibold text-blue-600">{reg.authority}</span>
                          <span className="text-slate-300">·</span>
                          <span>{formatDate(reg.created_at)}</span>
                        </p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 shrink-0 uppercase tracking-wide">
                        {reg.regulation_type}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Applicability Dates */}
          <div className="bg-amber-50/60 rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/40">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-amber-100 rounded-lg border border-amber-200">
                  <CalendarClock size={14} className="text-amber-600" />
                </div>
                <h2 className="text-sm font-bold text-amber-900">Upcoming Applicability Dates</h2>
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Applicability Analysis</span>
              </div>
              <Link
                href="/regulations-page"
                className="text-xs text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1 hover:underline"
              >
                View all <ArrowRight size={11} />
              </Link>
            </div>
            {loading ? (
              <div className="divide-y divide-amber-100">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={`uskel-${i}`} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                    <div className="h-10 w-16 bg-amber-100 rounded shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-4 bg-amber-100 rounded w-2/3" />
                      <div className="h-3 bg-amber-100 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : upcomingApplicability.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center">
                  <CalendarClock size={22} className="text-amber-400" />
                </div>
                <p className="text-sm font-semibold text-amber-800">No upcoming dates</p>
                <p className="text-xs text-amber-600">All applicability dates are in the past or not set.</p>
              </div>
            ) : (
              <div className="divide-y divide-amber-100">
                {upcomingApplicability.map((rv, idx) => {
                  const daysNum = Math.ceil((new Date(rv.applicability_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  const countdown = daysUntil(rv.applicability_date);
                  const isUrgent = daysNum <= 7;
                  const isSoonest = idx === 0;
                  return (
                    <div
                      key={rv.id}
                      className={`px-6 py-4 flex items-start gap-4 hover:bg-amber-100/50 transition-colors duration-150 ${isSoonest ? 'bg-amber-100/60 border-l-4 border-l-amber-500' : ''}`}
                    >
                      {/* Countdown badge */}
                      <div className={`shrink-0 text-center min-w-[80px] px-2 py-2.5 rounded-xl border shadow-sm ${isUrgent ? 'bg-red-50 border-red-300' : 'bg-white border-amber-300'}`}>
                        <p className={`text-xs font-extrabold uppercase tracking-wide ${isUrgent ? 'text-red-600' : 'text-amber-700'}`}>
                          {countdown}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(rv.applicability_date)}</p>
                      </div>
                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-mono text-xs bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800 px-2 py-0.5 rounded-lg font-bold border border-amber-200 shrink-0">
                            {rv.regulation?.regulation_number ?? '—'}
                          </span>
                          {isSoonest && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-white bg-amber-500 px-1.5 py-0.5 rounded-full shrink-0">
                              Soonest
                            </span>
                          )}
                          {isUrgent && !isSoonest && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full shrink-0">
                              Urgent
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-bold text-slate-800 truncate leading-snug">
                          {rv.regulation?.title ?? '—'}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {rv.regulation?.authority && (
                            <span className="text-xs font-semibold text-amber-700">{rv.regulation.authority}</span>
                          )}
                          {rv.applicability_note && (
                            <>
                              <span className="text-slate-300 text-xs">·</span>
                              <span className="text-xs text-slate-500 truncate max-w-[200px]">{rv.applicability_note}</span>
                            </>
                          )}
                        </div>
                        {/* Affected annexes */}
                        {rv.affected_annexes.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            <span className="text-[10px] text-slate-400 font-medium mr-0.5">Annexes:</span>
                            {rv.affected_annexes.slice(0, 5).map((code) => (
                              <span key={code} className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-bold">
                                {code}
                              </span>
                            ))}
                            {rv.affected_annexes.length > 5 && (
                              <span className="text-[9px] text-slate-400 font-medium">+{rv.affected_annexes.length - 5} more</span>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Status badge */}
                      <div className="shrink-0 pt-0.5">
                        <StatusBadge label={rv.status} variant={rv.status?.toLowerCase() as 'active' | 'draft' | 'superseded' | 'archived'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Quick Actions + Recent Comparisons */}
        <div className="space-y-5">
          {/* Quick Actions */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={13} className="text-blue-500" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Quick Actions
              </h2>
            </div>
            <div className="space-y-2.5">
              <Link
                href="/regulations-page"
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 group"
              >
                <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors shrink-0">
                  <Shield size={15} className="text-blue-600" />
                </div>
                <span className="flex-1">View Regulations</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
              </Link>
              <Link
                href="/annex-impact-page"
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 group"
              >
                <div className="p-2 bg-violet-100 rounded-lg group-hover:bg-violet-200 transition-colors shrink-0">
                  <BarChart3 size={15} className="text-violet-600" />
                </div>
                <span className="flex-1">View Annex Impact</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-violet-500 transition-colors" />
              </Link>
              <Link
                href="/documents-page"
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 group"
              >
                <div className="p-2 bg-indigo-100 rounded-lg group-hover:bg-indigo-200 transition-colors shrink-0">
                  <FileText size={15} className="text-indigo-600" />
                </div>
                <span className="flex-1">Add Document</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
              </Link>
              <Link
                href="/comparisons-page"
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-cyan-50 hover:border-cyan-300 hover:text-cyan-700 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 group"
              >
                <div className="p-2 bg-cyan-100 rounded-lg group-hover:bg-cyan-200 transition-colors shrink-0">
                  <GitCompare size={15} className="text-cyan-600" />
                </div>
                <span className="flex-1">Compare Versions</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-cyan-500 transition-colors" />
              </Link>
            </div>
          </div>

          {/* Recent Comparisons */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-violet-50/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-violet-100 rounded-lg">
                  <Brain size={14} className="text-violet-600" />
                </div>
                <h2 className="text-sm font-bold text-slate-800">Recent Comparisons</h2>
              </div>
              <Link
                href="/comparisons-page"
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold hover:underline"
              >
                View all
              </Link>
            </div>
            {loading ? (
              <div className="divide-y divide-slate-100">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={`cskel-${i}`} className="px-5 py-3.5 animate-pulse">
                    <div className="h-3.5 bg-slate-100 rounded w-full mb-1.5" />
                    <div className="h-3 bg-slate-100 rounded w-2/3" />
                  </div>
                ))}
              </div>
            ) : recentComparisons.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-5 gap-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                  <GitCompare size={24} className="text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">No comparisons yet</p>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    Run a standards analysis between two document versions to track regulatory changes.
                  </p>
                </div>
                <Link
                  href="/comparisons-page"
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white text-xs font-bold rounded-xl hover:from-blue-700 hover:to-violet-700 transition-all duration-150 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                >
                  <Plus size={13} />
                  Start Standards Analysis
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentComparisons.map((c) => {
                  const impact = c.impact_level ? IMPACT_COLORS[c.impact_level] : null;
                  const annexes = c.affected_annexes ?? [];
                  return (
                    <div key={c.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors duration-150">
                      <div className="flex items-center gap-2 mb-1">
                        {c.impact_level && IMPACT_ICON[c.impact_level]}
                        <p className="text-xs font-bold text-slate-800 truncate flex-1">
                          {c.old_version?.document?.title ?? '—'}
                        </p>
                        {impact && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${impact.bg} ${impact.text} ${impact.border} shrink-0`}>
                            {impact.label}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mb-1.5">
                        {c.old_version?.version_label ?? '—'} → {c.new_version?.version_label ?? '—'} · {formatDate(c.created_at)}
                      </p>
                      {c.summary_ai && (
                        <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2 bg-violet-50/60 rounded px-2 py-1.5 border border-violet-100">
                          {c.summary_ai}
                        </p>
                      )}
                      {annexes.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {annexes.slice(0, 2).map((annex) => (
                            <span key={annex} className="text-[9px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded font-semibold">
                              {annex}
                            </span>
                          ))}
                          {annexes.length > 2 && (
                            <span className="text-[9px] text-slate-400">+{annexes.length - 2} more</span>
                          )}
                          {c.applicability_dates_changed && (
                            <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-semibold ml-auto">
                              Dates changed
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Annex Impact Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-violet-50/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-violet-100 rounded-lg">
              <BarChart3 size={14} className="text-violet-600" />
            </div>
            <h2 className="text-sm font-bold text-slate-800">Annex Impact Summary</h2>
            <span className="text-xs text-slate-400 font-normal hidden sm:inline">— regulations mapped per annex</span>
          </div>
          <Link
            href="/annex-impact-page"
            className="text-xs text-blue-600 hover:text-blue-700 font-semibold hover:underline flex items-center gap-1"
          >
            Full annex analysis <ArrowRight size={11} />
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={`askel-${i}`} className="animate-pulse border border-slate-100 rounded-2xl p-4">
                <div className="h-4 bg-slate-100 rounded w-1/2 mb-2" />
                <div className="h-7 bg-slate-100 rounded w-1/3 mb-1" />
                <div className="h-3 bg-slate-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : annexImpact.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center">
              <BarChart3 size={26} className="text-violet-300" />
            </div>
            <p className="text-sm font-bold text-slate-700">No annex data yet</p>
            <p className="text-xs text-slate-400">Annex impact data will appear once regulations are linked to annexes via automated extraction.</p>
            <Link href="/annex-impact-page" className="text-sm text-blue-600 hover:underline font-semibold">
              View Annex Impact
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-6">
            {annexImpact.map((annex) => {
              const maxCount = annexImpact[0]?.regulation_count ?? 1;
              const pct = Math.round((annex.regulation_count / maxCount) * 100);
              const isTop = annex.regulation_count === maxCount;
              return (
                <div
                  key={annex.annex_code}
                  className={`border rounded-2xl p-4 flex flex-col gap-2 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer ${isTop ? 'border-violet-300 bg-gradient-to-br from-violet-50 to-purple-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  onClick={() => router.push('/annex-impact-page')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg border ${isTop ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                      {annex.annex_code}
                    </span>
                    {isTop && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full border border-violet-200">
                        Top
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-none">
                    {annex.regulation_count}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                    {annex.annex_title ?? annex.annex_code}
                  </p>
                  {/* Mini bar */}
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-auto">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isTop ? 'bg-gradient-to-r from-violet-500 to-purple-500' : 'bg-gradient-to-r from-slate-300 to-slate-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
