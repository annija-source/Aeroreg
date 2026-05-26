'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { BookOpen, RefreshCw, ChevronDown, ExternalLink, FileText, Calendar, TrendingUp, BarChart2, Sparkles, Clock, CheckCircle2,  } from 'lucide-react';
import { useChat } from '@/lib/hooks/useChat';


const supabase = createClient();

type Annex = {
  id: number;
  annex_code: string;
  part_code: string | null;
  annex_title: string | null;
  sort_order: number | null;
};

type RegulationGroup = {
  regulation_number: string;
  regulation_id: number;
  title: string;
  authority: string | null;
  versions: {
    id: number;
    applicability_date: string | null;
    applicability_note: string | null;
    status: string;
    document_version_label: string | null;
  }[];
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  superseded: 'bg-amber-50 text-amber-700 border border-amber-200',
  draft: 'bg-blue-50 text-blue-700 border border-blue-200',
  withdrawn: 'bg-red-50 text-red-700 border border-red-200',
};

function isFutureDate(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) > new Date();
}

export default function AnnexImpactClient() {
  const router = useRouter();
  const [annexes, setAnnexes] = useState<Annex[]>([]);
  const [selectedAnnexId, setSelectedAnnexId] = useState<number | null>(null);
  const [groups, setGroups] = useState<RegulationGroup[]>([]);
  const [loadingAnnexes, setLoadingAnnexes] = useState(true);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);

  const { response: chatResponse, isLoading: chatLoading, error: chatError, sendMessage } = useChat(
    'OPEN_AI',
    'gpt-5',
    false
  );

  useEffect(() => {
    if (chatError) toast.error(chatError.message);
  }, [chatError]);

  // Capture AI response when it arrives
  useEffect(() => {
    if (chatResponse && !chatLoading && loadingInsight) {
      setAiInsight(chatResponse);
      setLoadingInsight(false);
    }
  }, [chatResponse, chatLoading, loadingInsight]);

  const fetchAnnexes = useCallback(async () => {
    setLoadingAnnexes(true);
    const { data, error } = await supabase
      .from('annex')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      toast.error(`Failed to load annexes: ${error.message}`);
    } else {
      setAnnexes(data ?? []);
    }
    setLoadingAnnexes(false);
  }, []);

  useEffect(() => {
    fetchAnnexes();
  }, [fetchAnnexes]);

  const generateAiInsight = useCallback(
    (annex: Annex, regulationGroups: RegulationGroup[]) => {
      setAiInsight(null);
      setLoadingInsight(true);

      const totalRegs = regulationGroups.length;
      const futureRegs = regulationGroups.filter((g) =>
        g.versions.some((v) => isFutureDate(v.applicability_date))
      );
      const activeRegs = regulationGroups.filter((g) =>
        g.versions.some((v) => v.status === 'active')
      );
      const regList = regulationGroups
        .slice(0, 10)
        .map((g) => `${g.regulation_number}: ${g.title}`)
        .join('; ');

      const prompt = `You are an aviation regulatory intelligence analyst. Provide a concise analytical insight (3-4 sentences) for the following annex impact data.

Annex: ${annex.annex_code}${annex.part_code ? ` / ${annex.part_code}` : ''}${annex.annex_title ? ` — ${annex.annex_title}` : ''}
Total regulations: ${totalRegs}
Active regulations: ${activeRegs.length}
Regulations with future applicability dates: ${futureRegs.length}
Sample regulations: ${regList || 'None'}

Provide a brief analytical summary covering: regulatory coverage scope, compliance urgency based on future applicability dates, and any notable patterns. Be specific to aviation standards context. Keep it under 80 words.`;

      sendMessage([
        {
          role: 'system',
          content:
            'You are an aviation regulatory intelligence analyst. Provide concise, analytical insights about ICAO/EASA annex regulatory data.',
        },
        { role: 'user', content: prompt },
      ], { max_completion_tokens: 200 });
    },
    [sendMessage]
  );

  const fetchImpact = useCallback(
    async (annexId: number) => {
      setLoadingImpact(true);
      setGroups([]);
      setAiInsight(null);

      const { data, error } = await supabase
        .from('regulation_annex')
        .select(`
          regulation_version:regulation_version_id(
            id,
            applicability_date,
            applicability_note,
            status,
            regulation:regulation_id(id, regulation_number, title, authority),
            document_version:document_version_id(version_label)
          )
        `)
        .eq('annex_id', annexId);

      if (error) {
        toast.error(`Failed to load impact data: ${error.message}`);
        setLoadingImpact(false);
        return;
      }

      const groupMap = new Map<string, RegulationGroup>();
      (data ?? []).forEach((row: any) => {
        const rv = row.regulation_version;
        if (!rv || !rv.regulation) return;
        const reg = rv.regulation;
        const key = reg.regulation_number;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            regulation_number: reg.regulation_number,
            regulation_id: reg.id,
            title: reg.title,
            authority: reg.authority,
            versions: [],
          });
        }
        groupMap.get(key)!.versions.push({
          id: rv.id,
          applicability_date: rv.applicability_date,
          applicability_note: rv.applicability_note,
          status: rv.status,
          document_version_label: rv.document_version?.version_label ?? null,
        });
      });

      const sorted = Array.from(groupMap.values()).sort((a, b) =>
        a.regulation_number.localeCompare(b.regulation_number)
      );
      setGroups(sorted);
      setExpandedGroups(new Set(sorted.map((g) => g.regulation_number)));
      setLoadingImpact(false);

      // Trigger AI insight after data loads
      const selectedAnnex = annexes.find((a) => a.id === annexId);
      if (selectedAnnex && sorted.length > 0) {
        generateAiInsight(selectedAnnex, sorted);
      }
    },
    [annexes, generateAiInsight]
  );

  const handleAnnexChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value, 10);
    if (isNaN(id)) {
      setSelectedAnnexId(null);
      setGroups([]);
      setAiInsight(null);
      return;
    }
    setSelectedAnnexId(id);
    fetchImpact(id);
  };

  const toggleGroup = (regNumber: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(regNumber)) next.delete(regNumber);
      else next.add(regNumber);
      return next;
    });
  };

  const selectedAnnex = annexes.find((a) => a.id === selectedAnnexId);

  // Derived metrics
  const totalRegulations = groups.length;
  const futureGroups = groups.filter((g) =>
    g.versions.some((v) => isFutureDate(v.applicability_date))
  );
  const activeGroups = groups.filter((g) =>
    g.versions.some((v) => v.status === 'active')
  );

  // Latest change date: most recent applicability_date across all versions
  const allDates = groups
    .flatMap((g) => g.versions.map((v) => v.applicability_date))
    .filter(Boolean) as string[];
  const latestChangeDate =
    allDates.length > 0
      ? allDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : null;

  // Split groups into active and future applicability
  const activeApplicabilityGroups = groups.filter(
    (g) => !g.versions.some((v) => isFutureDate(v.applicability_date))
  );
  const futureApplicabilityGroups = groups.filter((g) =>
    g.versions.some((v) => isFutureDate(v.applicability_date))
  );

  const renderGroupCard = (group: RegulationGroup) => (
    <div
      key={group.regulation_number}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
    >
      <div
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left cursor-pointer"
        onClick={() => toggleGroup(group.regulation_number)}
      >
        <span className="font-mono text-sm font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg shrink-0">
          {group.regulation_number}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">{group.title}</p>
          {group.authority && (
            <p className="text-xs text-slate-500">{group.authority}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">
            {group.versions.length} version{group.versions.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/regulations-page/detail?id=${group.regulation_id}`);
            }}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded-lg transition-colors"
          >
            <ExternalLink size={12} />
            View
          </button>
          {expandedGroups.has(group.regulation_number) ? (
            <ChevronDown size={16} className="text-slate-400" />
          ) : (
            <ChevronDown size={16} className="text-slate-400 -rotate-90" />
          )}
        </div>
      </div>

      {expandedGroups.has(group.regulation_number) && (
        <div className="border-t border-slate-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-5 py-2 text-left text-xs font-semibold text-slate-500">
                  Document Version
                </th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-slate-500">
                  Applicability Date
                </th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-slate-500">
                  Applicability Note
                </th>
                <th className="px-5 py-2 text-left text-xs font-semibold text-slate-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {group.versions.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-2.5 text-slate-700">
                    {v.document_version_label ?? '—'}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">
                    {v.applicability_date ? (
                      <span
                        className={
                          isFutureDate(v.applicability_date)
                            ? 'text-amber-700 font-semibold' :''
                        }
                      >
                        {new Date(v.applicability_date).toLocaleDateString()}
                        {isFutureDate(v.applicability_date) && (
                          <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-semibold">
                            Future
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600 max-w-[220px] truncate">
                    {v.applicability_note ?? '—'}
                  </td>
                  <td className="px-5 py-2.5">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-lg capitalize ${
                        STATUS_COLORS[v.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Annex Impact Analysis</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Select an annex to view all regulations affecting it, their applicability dates, and structured regulatory data.
        </p>
      </div>

      {/* Annex Selector */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Select Annex
        </label>
        {loadingAnnexes ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <RefreshCw size={15} className="animate-spin" />
            Loading annexes...
          </div>
        ) : (
          <div className="relative">
            <select
              value={selectedAnnexId ?? ''}
              onChange={handleAnnexChange}
              className="w-full appearance-none pl-4 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer"
            >
              <option value="">— Choose an annex —</option>
              {annexes.map((annex) => (
                <option key={annex.id} value={annex.id}>
                  {annex.annex_code}
                  {annex.part_code ? ` / ${annex.part_code}` : ''}
                  {annex.annex_title ? ` — ${annex.annex_title}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
          </div>
        )}
      </div>

      {/* Results */}
      {selectedAnnexId && (
        <div>
          {/* Annex info bar */}
          {selectedAnnex && (
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
                <BookOpen size={16} className="text-purple-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800">
                  {selectedAnnex.annex_code}
                  {selectedAnnex.part_code ? ` / ${selectedAnnex.part_code}` : ''}
                </p>
                {selectedAnnex.annex_title && (
                  <p className="text-xs text-slate-500">{selectedAnnex.annex_title}</p>
                )}
              </div>
            </div>
          )}

          {loadingImpact ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 flex items-center justify-center">
              <RefreshCw size={22} className="animate-spin text-blue-500" />
            </div>
          ) : groups.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
              <FileText size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-slate-500 font-medium">No regulations found for this annex</p>
              <p className="text-slate-400 text-xs mt-1">
                No regulation versions have been linked to this annex yet. Run automated extraction on a document version to populate annex impact data.
              </p>
            </div>
          ) : (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-3 gap-4 mb-5">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                    <BarChart2 size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{totalRegulations}</p>
                    <p className="text-xs text-slate-500 font-medium">Total Regulations</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center shrink-0">
                    <TrendingUp size={18} className="text-amber-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{futureGroups.length}</p>
                    <p className="text-xs text-slate-500 font-medium">Future Applicability</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                    <Calendar size={18} className="text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {latestChangeDate
                        ? new Date(latestChangeDate).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </p>
                    <p className="text-xs text-slate-500 font-medium">Latest Change Date</p>
                  </div>
                </div>
              </div>

              {/* AI Insight Panel */}
              <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-2xl p-4 mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={15} className="text-violet-600" />
                  <span className="text-sm font-semibold text-violet-800">AI Regulatory Insight</span>
                  {(loadingInsight || chatLoading) && (
                    <RefreshCw size={13} className="animate-spin text-violet-500 ml-1" />
                  )}
                </div>
                {loadingInsight || chatLoading ? (
                  <div className="flex items-center gap-2 text-violet-500 text-sm">
                    <span>Generating analytical insight for this annex...</span>
                  </div>
                ) : aiInsight ? (
                  <p className="text-sm text-violet-900 leading-relaxed">{aiInsight}</p>
                ) : (
                  <p className="text-sm text-violet-500 italic">
                    AI insight will appear here after data loads.
                  </p>
                )}
              </div>

              {/* Active Regulations Group */}
              {activeApplicabilityGroups.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <h2 className="text-sm font-bold text-slate-700">
                      Active Regulations
                    </h2>
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                      {activeApplicabilityGroups.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {activeApplicabilityGroups.map(renderGroupCard)}
                  </div>
                </div>
              )}

              {/* Future Applicability Regulations Group */}
              {futureApplicabilityGroups.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={16} className="text-amber-600" />
                    <h2 className="text-sm font-bold text-slate-700">
                      Future Applicability Regulations
                    </h2>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                      {futureApplicabilityGroups.length}
                    </span>
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Upcoming compliance required
                    </span>
                  </div>
                  <div className="space-y-3">
                    {futureApplicabilityGroups.map(renderGroupCard)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!selectedAnnexId && !loadingAnnexes && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <BookOpen size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500 font-medium">Select an annex to view its impact analysis</p>
          <p className="text-slate-400 text-xs mt-1">
            Choose an annex from the dropdown above to see all regulations, applicability dates, and structured regulatory data.
          </p>
        </div>
      )}
    </div>
  );
}
