'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
//import { supabase } from '@/lib/supabase';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, FileText, RefreshCw, ExternalLink, Building2, Hash, Tag, BookOpen, Calendar, ChevronUp, ChevronDown, Download, BookMarked } from 'lucide-react';
const supabase = createClient();

type Regulation = {
  id: number;
  regulation_type: string | null;
  regulation_number: string;
  title: string;
  short_label: string | null;
  authority: string | null;
  official_url: string | null;
  notes: string | null;
  created_at: string;
  related_document_id: number | null;
  document?: { id: number; title: string; document_code: string } | null;
};

type AffectedAnnex = {
  id: number;
  annex_code: string;
  part_code: string | null;
  annex_title: string | null;
  sort_order: number | null;
};

type RegulationVersion = {
  id: number;
  applicability_date: string | null;
  applicability_note: string | null;
  status: string;
  raw_extracted_text: string | null;
  created_at: string;
  document_version?: {
    id: number;
    version_label: string;
    effective_date: string | null;
    publication_date: string | null;
    file_name: string | null;
    file_path: string | null;
    document_url: string | null;
  } | null;
  document_revision?: {
    id: number;
    revision_label: string;
    publication_date: string | null;
    source_url: string | null;
  } | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  superseded: 'bg-amber-50 text-amber-700 border border-amber-200',
  draft: 'bg-blue-50 text-blue-700 border border-blue-200',
  withdrawn: 'bg-red-50 text-red-700 border border-red-200',
};

function resolveSourceFileUrl(v: RegulationVersion): string | null {
  // Prefer document_revision source_url, then document_version document_url, then storage path
  if (v.document_revision?.source_url) return v.document_revision.source_url;
  if (v.document_version?.document_url) return v.document_version.document_url;
  if (v.document_version?.file_path) {
    const { data } = supabase.storage.from('documents').getPublicUrl(v.document_version.file_path);
    return data?.publicUrl ?? null;
  }
  return null;
}

export default function RegulationDetailClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const regId = searchParams.get('id');

  const [regulation, setRegulation] = useState<Regulation | null>(null);
  const [annexes, setAnnexes] = useState<AffectedAnnex[]>([]);
  const [versions, setVersions] = useState<RegulationVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    if (!regId) return;
    setLoading(true);

    // Fetch regulation with related document
    //const { data: regData, error: regError } = await supabase
    //  .from('regulation')
    //  .select('*, document:related_document_id(id, title, document_code)')
    //  .eq('id', regId)
    //  .single();
  const { data: regData, error: regError } = await supabase
  .from('regulation')
  .select('*')
  .eq('id', regId)
  .single();

if (regError) {
  toast.error(`Failed to load regulation: ${regError.message}`);
  setLoading(false);
  return;
}

let relatedDocument = null;

if (regData?.related_document_id) {
  const { data: docData, error: docError } = await supabase
    .from('document')
    .select('id, title, document_code')
    .eq('id', regData.related_document_id)
    .single();

  if (!docError && docData) {
    relatedDocument = docData;
  }
}

setRegulation({
  ...regData,
  document: relatedDocument,
});

    if (regError) {
      toast.error(`Failed to load regulation: ${regError.message}`);
      setLoading(false);
      return;
    }
    setRegulation(regData);

    // Fetch affected annexes via regulation_version -> regulation_annex -> annex
    const { data: annexData } = await supabase
      .from('regulation_annex')
      .select('annex:annex_id(id, annex_code, part_code, annex_title, sort_order), regulation_version!inner(regulation_id)')
      .eq('regulation_version.regulation_id', regId);

    if (annexData) {
      const uniqueAnnexes = new Map<number, AffectedAnnex>();
      annexData.forEach((row: any) => {
        if (row.annex && !uniqueAnnexes.has(row.annex.id)) {
          uniqueAnnexes.set(row.annex.id, row.annex);
        }
      });
      setAnnexes(Array.from(uniqueAnnexes.values()).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999)));
    }

    // Fetch version history with source file fields
    const { data: versionData } = await supabase
      .from('regulation_version')
      .select(`
        *,
        document_version:document_version_id(id, version_label, effective_date, publication_date, file_name, file_path, document_url),
        document_revision:document_revision_id(id, revision_label, publication_date, source_url)
      `)
      .eq('regulation_id', regId);

    if (versionData) {
      // Sort by document_revision.publication_date desc, then applicability_date desc
      const sorted = [...versionData].sort((a, b) => {
        const dateA = a.document_revision?.publication_date ?? a.applicability_date ?? a.created_at;
        const dateB = b.document_revision?.publication_date ?? b.applicability_date ?? b.created_at;
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      setVersions(sorted);
    } else {
      setVersions([]);
    }

    setLoading(false);
  }, [regId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!regId) {
    return (
      <div className="p-6 text-center text-slate-500">
        No regulation ID provided.{' '}
        <button onClick={() => router.push('/regulations-page')} className="text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <RefreshCw size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!regulation) {
    return (
      <div className="p-6 text-center text-slate-500">
        Regulation not found.{' '}
        <button onClick={() => router.push('/regulations-page')} className="text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => router.push('/regulations-page')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-5 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Regulations
      </button>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-sm font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg">
                {regulation.regulation_number}
              </span>
              {regulation.regulation_type && (
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">
                  {regulation.regulation_type}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-1">{regulation.title}</h1>
            {regulation.short_label && (
              <p className="text-sm text-slate-500">{regulation.short_label}</p>
            )}
          </div>
          {regulation.official_url && (
            <a
              href={regulation.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-xl transition-colors shrink-0"
            >
              <ExternalLink size={14} />
              Official Source
            </a>
          )}
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-5 pt-5 border-t border-slate-100">
          <MetaItem icon={<Building2 size={15} />} label="Authority" value={regulation.authority} />
          <MetaItem icon={<Tag size={15} />} label="Type" value={regulation.regulation_type} />
          <MetaItem
            icon={<Calendar size={15} />}
            label="Created"
            value={new Date(regulation.created_at).toLocaleDateString()}
          />
        </div>

        {regulation.notes && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-slate-700">{regulation.notes}</p>
          </div>
        )}
      </div>

      {/* Related Document */}
      {regulation.document && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <FileText size={15} className="text-blue-500" />
            Related Document
          </h2>
          <div
            className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:bg-blue-50 cursor-pointer transition-colors"
            onClick={() => router.push(`/document-details-page?id=${regulation.document!.id}`)}
          >
            <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
              <FileText size={16} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-800 text-sm">{regulation.document.title}</p>
              <p className="text-xs text-slate-500">{regulation.document.document_code}</p>
            </div>
            <ExternalLink size={14} className="ml-auto text-slate-400" />
          </div>
        </div>
      )}

      {/* Affected Annexes */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
          <BookOpen size={15} className="text-purple-500" />
          Affected Annexes
          <span className="ml-auto text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {annexes.length}
          </span>
        </h2>
        {annexes.length === 0 ? (
          <p className="text-sm text-slate-400 py-3 text-center">No annexes linked to this regulation.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {annexes.map((annex) => (
              <div
                key={annex.id}
                className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-xl text-sm"
              >
                <span className="font-bold text-purple-700">{annex.annex_code}</span>
                {annex.part_code && (
                  <span className="text-purple-500 text-xs">/ {annex.part_code}</span>
                )}
                {annex.annex_title && (
                  <span className="text-slate-600 text-xs">{annex.annex_title}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full History */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-1 flex items-center gap-2">
          <Hash size={15} className="text-emerald-500" />
          Regulation History by Publication Revision
          <span className="ml-auto text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {versions.length}
          </span>
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Each row shows which official publication revision introduced or contains this regulation, and the linked uploaded file version.
        </p>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 mb-4">
          <div className="flex items-center gap-1.5">
            <BookMarked size={12} className="text-indigo-500" />
            <span><strong>Publication Revision</strong> = official business version (e.g. "Revision 24")</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText size={12} className="text-slate-400" />
            <span><strong>File Version</strong> = uploaded document file (e.g. "v2.1")</span>
          </div>
        </div>

        {versions.length === 0 ? (
          <p className="text-sm text-slate-400 py-3 text-center">No history available for this regulation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">Publication Revision</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">Linked File Version</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">Applicability Date</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">Applicability Note</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap">Source File</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600 text-xs whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v, idx) => {
                  const sourceUrl = resolveSourceFileUrl(v);
                  const fileName = v.document_version?.file_name ?? null;
                  const isLatest = idx === 0;
                  return (
                    <React.Fragment key={v.id}>
                      <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isLatest ? 'bg-indigo-50/30' : ''}`}>
                        {/* Publication Revision (official business version) */}
                        <td className="px-4 py-3">
                          {v.document_revision ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <BookMarked size={13} className="text-indigo-500 shrink-0" />
                                <span className="font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md text-xs whitespace-nowrap">
                                  {v.document_revision.revision_label}
                                </span>
                                {isLatest && (
                                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                                    Latest
                                  </span>
                                )}
                              </div>
                              {v.document_revision.publication_date && (
                                <p className="text-xs text-slate-400 pl-5">
                                  Published: {new Date(v.document_revision.publication_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs italic">No revision linked</span>
                          )}
                        </td>

                        {/* Linked File Version (uploaded storage version) */}
                        <td className="px-4 py-3">
                          {v.document_version ? (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-medium text-slate-700 text-xs bg-slate-100 px-2 py-0.5 rounded">
                                  {v.document_version.version_label}
                                </span>
                                <span className="text-[10px] text-slate-400">file</span>
                              </div>
                              {(v.document_version.effective_date || v.document_version.publication_date) && (
                                <p className="text-xs text-slate-400 mt-0.5 pl-0.5">
                                  {new Date(
                                    v.document_version.effective_date ?? v.document_version.publication_date!
                                  ).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Applicability Date */}
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">
                          {v.applicability_date
                            ? new Date(v.applicability_date).toLocaleDateString()
                            : '—'}
                        </td>

                        {/* Applicability Note */}
                        <td className="px-4 py-3 text-slate-600 max-w-[180px]">
                          {v.applicability_note ? (
                            <span className="block truncate text-xs" title={v.applicability_note}>
                              {v.applicability_note}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-lg capitalize ${
                              STATUS_COLORS[v.status] ?? 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {v.status}
                          </span>
                        </td>

                        {/* Source File */}
                        <td className="px-4 py-3">
                          {sourceUrl ? (
                            <a
                              href={sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                              title={fileName ?? sourceUrl}
                            >
                              <Download size={13} className="shrink-0" />
                              <span className="max-w-[120px] truncate">
                                {fileName ?? 'Open file'}
                              </span>
                            </a>
                          ) : fileName ? (
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <FileText size={13} />
                              <span className="max-w-[120px] truncate">{fileName}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Expand raw text */}
                        <td className="px-4 py-3">
                          {v.raw_extracted_text && (
                            <button
                              onClick={() =>
                                setExpandedVersion(expandedVersion === v.id ? null : v.id)
                              }
                              className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
                            >
                              {expandedVersion === v.id ? (
                                <>
                                  <ChevronUp size={13} /> Hide
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={13} /> Text
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Expanded raw text row */}
                      {expandedVersion === v.id && v.raw_extracted_text && (
                        <tr className="bg-slate-50">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText size={13} className="text-slate-400" />
                              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                Raw Extracted Text
                              </span>
                              {v.document_version?.version_label && (
                                <span className="text-xs text-slate-400">
                                  — {v.document_version.version_label}
                                </span>
                              )}
                            </div>
                            <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono bg-white border border-slate-200 rounded-xl p-3 max-h-48 overflow-y-auto">
                              {v.raw_extracted_text}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1.5">
        <span className="text-slate-400">{icon}</span>
        {label}
      </p>
      <p className="text-sm font-medium text-slate-800">{value ?? '—'}</p>
    </div>
  );
}
