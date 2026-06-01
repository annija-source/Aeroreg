'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase, Document, DocumentVersion, DocumentSource } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Star,
  StarOff,
  Plus,
  Pencil,
  Trash2,
  GitCompare,
  ExternalLink,
  FileText,
  RefreshCw,
  Calendar,
  Building2,
  Tag,
  Hash,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Eye,
  X,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Clock,
  ScrollText,
  BookOpen,
  BookMarked,
  Cpu,
} from 'lucide-react';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import VersionFormModal from './VersionFormModal';
import type { ExtractionSummary } from './VersionFormModal';

type DocumentWithSource = Document & { document_source?: DocumentSource };

interface ChangeItem {
  section: string;
  change_type: 'added' | 'removed' | 'modified';
  summary: string;
  old_text: string;
  new_text: string;
}

interface ComparisonRow {
  id: number;
  old_version_id: number;
  new_version_id: number;
  impact_level: 'low' | 'medium' | 'high' | null;
  summary_ai: string | null;
  changes_json: ChangeItem[] | null;
  created_at: string;
  old_version: { version_label: string } | null;
  new_version: { version_label: string } | null;
}

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

interface ExtractedRegulation {
  id: number;
  regulation_number: string;
  title: string;
  regulation_version: {
    id: number;
    applicability_date: string | null;
    document_version_id: number;
    regulation_annex: {
      annex: { annex_code: string; annex_title: string | null } | null;
    }[];
  }[];
}

interface DocumentRevisionRow {
  id: number;
  revision_label: string;
  publication_date: string | null;
  revision_summary: string | null;
  document_version_id: number | null;
  document_version: { version_label: string } | null;
  created_at: string;
}

export default function DocumentDetailsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const docId = searchParams.get('id');

  const [document, setDocument] = useState<DocumentWithSource | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonRow[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [loadingComparisons, setLoadingComparisons] = useState(true);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [editVersion, setEditVersion] = useState<DocumentVersion | null>(null);
  const [deleteVersion, setDeleteVersion] = useState<DocumentVersion | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewComparison, setViewComparison] = useState<ComparisonRow | null>(null);
  const [deleteComparison, setDeleteComparison] = useState<ComparisonRow | null>(null);
  const [deleteCompLoading, setDeleteCompLoading] = useState(false);
  const [expandedChange, setExpandedChange] = useState<number | null>(null);

  // New state
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [extractedRegulations, setExtractedRegulations] = useState<ExtractedRegulation[]>([]);
  const [loadingRegulations, setLoadingRegulations] = useState(false);
  const [documentRevisions, setDocumentRevisions] = useState<DocumentRevisionRow[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);

  // Extraction summary state
  const [extractionSummary, setExtractionSummary] = useState<ExtractionSummary | null>(null);

  // Reprocessing state
  const [reprocessingVersionId, setReprocessingVersionId] = useState<number | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!docId) return;
    setLoadingVersions(true);
    const { data, error } = await supabase
      .from('document_version')
      .select('*')
      .eq('document_id', docId)
      .order('effective_date', { ascending: sortDir === 'asc' });
    if (error) {
      toast.error(`Failed to load versions: ${error.message}`);
    } else {
      setVersions(data ?? []);
    }
    setLoadingVersions(false);
  }, [docId, sortDir]);

  const fetchDocumentRevisions = useCallback(async () => {
    if (!docId) return;
    setLoadingRevisions(true);
    const { data, error } = await supabase
      .from('document_revision')
      .select('id, revision_label, publication_date, revision_summary, document_version_id, document_version(version_label)')
      .eq('document_id', docId)
      .order('publication_date', { ascending: false });
    if (error) {
      toast.error(`Failed to load revisions: ${error.message}`);
      setDocumentRevisions([]);
    } else {
      setDocumentRevisions((data ?? []) as unknown as DocumentRevisionRow[]);
    }
    setLoadingRevisions(false);
  }, [docId]);

  const handleExtractionComplete = useCallback((summary: ExtractionSummary) => {
    setExtractionSummary(summary);
    fetchVersions();
  }, [fetchVersions]);

  const fetchExtractedRegulations = useCallback(async (versionId: number) => {
    setLoadingRegulations(true);
    const { data, error } = await supabase
      .from('regulation_version')
      .select(`
        id,
        applicability_date,
        document_version_id,
        regulation_annex(
          annex(annex_code, annex_title)
        ),
        regulation:regulation_id(
          id,
          regulation_number,
          title
        )
      `)
      .eq('document_version_id', versionId);

    if (error) {
      toast.error(`Failed to load regulations: ${error.message}`);
      setExtractedRegulations([]);
    } else {
      // Group by regulation
      const map = new Map<number, ExtractedRegulation>();
      (data ?? []).forEach((rv: any) => {
        const reg = rv.regulation;
        if (!reg) return;
        if (!map.has(reg.id)) {
          map.set(reg.id, {
            id: reg.id,
            regulation_number: reg.regulation_number,
            title: reg.title,
            regulation_version: [],
          });
        }
        map.get(reg.id)!.regulation_version.push({
          id: rv.id,
          applicability_date: rv.applicability_date,
          document_version_id: rv.document_version_id,
          regulation_annex: rv.regulation_annex ?? [],
        });
      });
      setExtractedRegulations(Array.from(map.values()));
    }
    setLoadingRegulations(false);
  }, []);

  const handleReprocess = useCallback(async (version: DocumentVersion) => {
    if (!docId) return;
    setReprocessingVersionId(version.id);
    toast.info(`Reprocessing "${version.version_label}"…`);
    try {
      const res = await fetch('/api/ai/reprocess-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentVersionId: version.id,
          documentId: docId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(`Reprocessing failed: ${data.error ?? 'Unknown error'}`);
      } else {
        const d = data.diagnostics;
        setExtractionSummary({
          extractedCount: d.extractedCount,
          insertedRegulationsCount: d.insertedRegulationsCount,
          insertedRegulationVersionCount: d.insertedRegulationVersionCount,
          linkedAnnexCount: d.linkedAnnexCount,
          failedRowsCount: d.failedRowsCount,
          warnings: d.warnings ?? [],
        });
        fetchVersions();
        fetchDocumentRevisions();
        if (selectedVersionId !== null) {
          fetchExtractedRegulations(selectedVersionId);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reprocessing encountered an error.';
      toast.error(msg);
    } finally {
      setReprocessingVersionId(null);
    }
  }, [docId, selectedVersionId, fetchExtractedRegulations, fetchVersions, fetchDocumentRevisions]);

  const fetchDocument = useCallback(async () => {
    if (!docId) return;
    setLoadingDoc(true);
    const { data, error } = await supabase
      .from('document')
      .select('*, document_source(id, source_name, source_type, document_group, notes, is_active, created_at)')
      .eq('id', docId)
      .single();
    if (error) {
      toast.error(`Failed to load document: ${error.message}`);
    } else {
      setDocument(data);
    }
    setLoadingDoc(false);
  }, [docId]);

  const fetchComparisons = useCallback(async () => {
    if (!docId) return;
    setLoadingComparisons(true);
    // Get all version IDs for this document first
    const { data: versionIds } = await supabase
      .from('document_version')
      .select('id')
      .eq('document_id', docId);

    if (!versionIds || versionIds.length === 0) {
      setComparisons([]);
      setLoadingComparisons(false);
      return;
    }

    const ids = versionIds.map((v) => v.id);
    const { data, error } = await supabase
      .from('change_analysis')
      .select(`
        id, old_version_id, new_version_id, impact_level, summary_ai, changes_json, created_at,
        old_version:document_version!change_analysis_old_version_id_fkey(version_label),
        new_version:document_version!change_analysis_new_version_id_fkey(version_label)
      `)
      .or(`old_version_id.in.(${ids.join(',')}),new_version_id.in.(${ids.join(',')})`)
      .order('created_at', { ascending: false });

    if (error) {
      toast.error(`Failed to load comparisons: ${error.message}`);
    } else {
      setComparisons((data as unknown as ComparisonRow[]) ?? []);
    }
    setLoadingComparisons(false);
  }, [docId]);

  // ── Fetch all data on mount / when docId changes ──────────────────────────
  useEffect(() => {
    if (!docId) return;
    fetchDocument();
    fetchVersions();
    fetchComparisons();
    fetchDocumentRevisions();
  }, [docId, fetchDocument, fetchVersions, fetchComparisons, fetchDocumentRevisions]);

  const handleDeleteVersion = async () => {
    if (!deleteVersion) return;
    setDeleteLoading(true);
    const { error } = await supabase
      .from('document_version')
      .delete()
      .eq('id', deleteVersion.id);
    setDeleteLoading(false);
    if (error) {
      toast.error(`Failed to delete version: ${error.message}`);
    } else {
      toast.success(`Version "${deleteVersion.version_label}" deleted.`);
      setDeleteVersion(null);
      fetchVersions();
      fetchComparisons();
    }
  };

  const handleDeleteComparison = async () => {
    if (!deleteComparison) return;
    setDeleteCompLoading(true);
    const { error } = await supabase
      .from('change_analysis')
      .delete()
      .eq('id', deleteComparison.id);
    setDeleteCompLoading(false);
    if (error) {
      toast.error(`Failed to delete comparison: ${error.message}`);
    } else {
      toast.success('Comparison deleted.');
      setDeleteComparison(null);
      fetchComparisons();
    }
  };

  const handleToggleWatched = async () => {
    if (!document) return;
    const { error } = await supabase
      .from('document')
      .update({ watched: !document.watched })
      .eq('id', document.id);
    if (error) {
      toast.error(`Failed to update watch status: ${error.message}`);
    } else {
      toast.success(document.watched ? 'Removed from watchlist.' : 'Added to watchlist.');
      fetchDocument();
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const getFileUrl = (filePath: string | null) => {
    if (!filePath) return null;
    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);
    return data.publicUrl;
  };

  // Determine "current" version = Active status, or latest uploaded
  const currentVersionId = (() => {
    const active = versions.find((v) => v.status.toLowerCase() === 'active');
    if (active) return active.id;
    if (versions.length > 0) return versions[0].id;
    return null;
  })();

  if (!docId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <FileText size={40} className="text-[hsl(var(--muted-foreground))] opacity-40" />
        <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
          No document selected. Please open a document from the Documents page.
        </p>
        <button
          onClick={() => router.push('/documents-page')}
          className="text-sm text-[hsl(var(--primary))] hover:underline font-medium"
        >
          Go to Documents
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <button
        onClick={() => router.push('/documents-page')}
        className="inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
      >
        <ArrowLeft size={15} />
        Back to Documents
      </button>

      {/* Document header card */}
      {loadingDoc ? (
        <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm p-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`hdr-skel-${i + 1}`} className="animate-pulse bg-[hsl(var(--muted))] rounded h-5 w-full max-w-[60%]" />
          ))}
        </div>
      ) : document ? (
        <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
          {/* Top accent bar */}
          <div className="h-1 bg-gradient-to-r from-blue-600 to-blue-400" />
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Badges row */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="font-mono text-sm bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] px-2.5 py-1 rounded-md font-semibold border border-[hsl(var(--primary)/0.2)]">
                    {document.document_code}
                  </span>
                  {document.authority && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {document.authority}
                    </span>
                  )}
                  {document.category && (
                    <StatusBadge label={document.category} variant="default" />
                  )}
                  {document.watched && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      <Star size={11} fill="currentColor" />
                      Watched
                    </span>
                  )}
                </div>

                {/* Title */}
                <h1 className="text-xl font-semibold text-[hsl(var(--foreground))] leading-snug mb-3">
                  {document.title}
                </h1>

                {/* Description */}
                {document.description && (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4 leading-relaxed max-w-2xl">
                    {document.description}
                  </p>
                )}

                {/* Metadata grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-[hsl(var(--border))]">
                  {document.document_source && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Source</p>
                      <p className="text-sm font-medium text-[hsl(var(--foreground))] flex items-center gap-1.5">
                        <Building2 size={13} className="text-[hsl(var(--muted-foreground))]" />
                        {document.document_source.source_name}
                      </p>
                    </div>
                  )}
                  {document.authority && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Authority</p>
                      <p className="text-sm font-medium text-[hsl(var(--foreground))] flex items-center gap-1.5">
                        <Tag size={13} className="text-[hsl(var(--muted-foreground))]" />
                        {document.authority}
                      </p>
                    </div>
                  )}
                  {document.category && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Category</p>
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">{document.category}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Versions</p>
                    <p className="text-sm font-medium text-[hsl(var(--foreground))] flex items-center gap-1.5">
                      <Hash size={13} className="text-[hsl(var(--muted-foreground))]" />
                      {versions.length} version{versions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Created</p>
                    <p className="text-sm font-medium text-[hsl(var(--foreground))] flex items-center gap-1.5">
                      <Calendar size={13} className="text-[hsl(var(--muted-foreground))]" />
                      {formatDate(document.created_at)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  onClick={handleToggleWatched}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-150 ${
                    document.watched
                      ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' :'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                  }`}
                >
                  {document.watched ? <Star size={14} fill="currentColor" /> : <StarOff size={14} />}
                  {document.watched ? 'Watched' : 'Watch'}
                </button>
                <button
                  onClick={() => router.push(`/comparisons-page?document_id=${document.id}`)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                >
                  <GitCompare size={14} />
                  Compare
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm p-6 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Document not found.</p>
        </div>
      )}

      {/* Versions section */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
Document Versions
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              All published and draft versions of this regulatory document.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
              title={`Sort by date ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            <button
              onClick={fetchVersions}
              className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
              title="Refresh versions"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => { setEditVersion(null); setVersionModalOpen(true); }}
              className="flex items-center gap-2 px-3 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150"
            >
              <Plus size={14} />
              Add Version
            </button>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                {['Version', 'Status', 'Effective Date', 'Publication Date', 'Uploaded', 'File / URL', 'Actions'].map((h) => (
                  <th
                    key={`vth-${h}`}
                    className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap ${
                      h === 'Actions' ? 'text-right' : ''
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingVersions ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`vskel-${i + 1}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={`vskel-${i + 1}-${j + 1}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : versions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                        <Paperclip size={22} className="text-[hsl(var(--muted-foreground))] opacity-60" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
No versions yet
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          Add the first version to begin tracking revision history and automated extraction.
                        </p>
                      </div>
                      <button
                        onClick={() => { setEditVersion(null); setVersionModalOpen(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] transition-all duration-150"
                      >
                        <Plus size={14} />
                        Add First Version
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                versions.map((v) => {
                  const fileUrl = getFileUrl(v.file_path);
                  const isCurrent = v.id === currentVersionId;
                  return (
                    <tr
                      key={`ver-${v.id}`}
                      className={`border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100 group ${
                        isCurrent ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold bg-[hsl(var(--muted))] px-2 py-0.5 rounded">
                            {v.version_label}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                              Current
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={v.status}
                          variant={v.status.toLowerCase() as 'active' | 'draft' | 'superseded' | 'archived'}
                        />
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] tabular-nums text-xs">
                        {formatDate(v.effective_date)}
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] tabular-nums text-xs">
                        {formatDate(v.publication_date)}
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] tabular-nums text-xs">
                        <div className="flex items-center gap-1">
                          <Clock size={11} />
                          {formatDate(v.uploaded_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {v.file_name ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground))]">
                              <Paperclip size={11} className="text-[hsl(var(--muted-foreground))]" />
                              <span className="truncate max-w-[120px]" title={v.file_name}>
                                {v.file_name}
                              </span>
                            </span>
                            {fileUrl && (
                              <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--primary))] hover:underline"
                              >
                                <ExternalLink size={10} />
                                Download
                              </a>
                            )}
                          </div>
                        ) : v.document_url ? (
                          <a
                            href={v.document_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
                          >
                            <ExternalLink size={11} />
                            Open URL
                          </a>
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))] text-xs italic opacity-60">
                            No file
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() =>
                              router.push(
                                `/comparisons-page?document_id=${docId}&version_id=${v.id}`
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-all duration-150"
                            title="Compare this version"
                          >
                            <GitCompare size={12} />
                            Compare
                          </button>
                          <button
                            onClick={() => handleReprocess(v)}
                            disabled={reprocessingVersionId === v.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Reprocess this version (re-run text, regulation, revision extraction and annex linking)"
                          >
                            {reprocessingVersionId === v.id ? (
                              <>
                                <Cpu size={12} className="animate-pulse" />
                                Processing…
                              </>
                            ) : (
                              <>
                                <Cpu size={12} />
                                Reprocess
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => { setEditVersion(v); setVersionModalOpen(true); }}
                            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary)/0.1)] hover:text-[hsl(var(--primary))] transition-all duration-150"
                            title="Edit version"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setDeleteVersion(v)}
                            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 transition-all duration-150"
                            title="Delete version"
                          >
                            <Trash2 size={13} />
                          </button>
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

      {/* Comparison History section */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
Comparison History
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
All standards analysis results generated for versions of this document.
            </p>
          </div>
          <button
            onClick={fetchComparisons}
            className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
            title="Refresh comparisons"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                {['Old Version', 'New Version', 'Impact Level', 'Created At', 'Actions'].map((h) => (
                  <th
                    key={`cth-${h}`}
                    className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap ${
                      h === 'Actions' ? 'text-right' : ''
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingComparisons ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`cskel-${i}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={`cskel-${i}-${j}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : comparisons.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                        <GitCompare size={22} className="text-[hsl(var(--muted-foreground))] opacity-60" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
No standards analyses yet
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          Generate a standards analysis between two versions to see regulatory change results here.
                        </p>
                      </div>
                      <button
                        onClick={() => router.push(`/comparisons-page?document_id=${docId}`)}
                        className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] transition-all duration-150"
                      >
                        <GitCompare size={14} />
                        New Comparison
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                comparisons.map((c) => (
                  <tr
                    key={`comp-${c.id}`}
                    className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100 group"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded font-medium">
                        {c.old_version?.version_label ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded font-medium">
                        {c.new_version?.version_label ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.impact_level ? (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${IMPACT_COLORS[c.impact_level]}`}
                        >
                          {IMPACT_ICON[c.impact_level]}
                          {c.impact_level.charAt(0).toUpperCase() + c.impact_level.slice(1)}
                        </span>
                      ) : (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] opacity-50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] tabular-nums text-xs">
                      {formatDate(c.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setViewComparison(c); setExpandedChange(null); }}
                          className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
                          title="View comparison"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => setDeleteComparison(c)}
                          className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 transition-all duration-150"
                          title="Delete comparison"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Extracted Regulations ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
              <ScrollText size={16} className="text-[hsl(var(--primary))]" />
Automated Regulation Extraction
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              Structured regulatory data extracted from the selected document version.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Version selector */}
            {versions.length > 0 && (
              <select
                value={selectedVersionId ?? ''}
                onChange={(e) => setSelectedVersionId(Number(e.target.value))}
                className="text-xs border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 bg-white text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)]"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.version_label}{v.id === currentVersionId ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => selectedVersionId !== null && fetchExtractedRegulations(selectedVersionId)}
              className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
              title="Refresh regulations"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                {['Regulation No.', 'Title', 'Affected Annexes', 'Applicability Date', 'Detail'].map((h) => (
                  <th
                    key={`rth-${h}`}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingRegulations ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`rskel-${i}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={`rskel-${i}-${j}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : extractedRegulations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                        <ScrollText size={22} className="text-[hsl(var(--muted-foreground))] opacity-60" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">No regulations extracted</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          Upload a document version and run automated extraction to populate structured regulatory data.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                extractedRegulations.map((reg) => {
                  const rv = reg.regulation_version[0];
                  const annexes = rv?.regulation_annex ?? [];
                  return (
                    <tr
                      key={`reg-${reg.id}`}
                      className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] px-2 py-0.5 rounded border border-[hsl(var(--primary)/0.2)]">
                          {reg.regulation_number}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[hsl(var(--foreground))] max-w-[260px]">
                        <span className="line-clamp-2" title={reg.title}>{reg.title}</span>
                      </td>
                      <td className="px-4 py-3">
                        {annexes.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {annexes.map((ra, idx) =>
                              ra.annex ? (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                                  title={ra.annex.annex_title ?? undefined}
                                >
                                  {ra.annex.annex_code}
                                </span>
                              ) : null
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))] opacity-50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
                        {rv?.applicability_date ? formatDate(rv.applicability_date) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => router.push(`/regulations-page/detail?id=${reg.id}`)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] hover:bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.2)] transition-all duration-150"
                        >
                          <ExternalLink size={11} />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Publication Revision History ──────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
              <BookOpen size={16} className="text-[hsl(var(--primary))]" />
              Official Publication Revisions
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              Official publication revisions (business versions) for this document. Each revision may be linked to an uploaded file version.
            </p>
          </div>
          <button
            onClick={fetchDocumentRevisions}
            className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
            title="Refresh revision history"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* Legend */}
        <div className="px-6 py-3 bg-indigo-50/60 border-b border-indigo-100 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span><strong>Publication Revision</strong> = official business version (e.g. "Revision 24")</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400" />
            <span><strong>File Version</strong> = uploaded document file (e.g. "v2.1")</span>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                {['Publication Revision', 'Publication Date', 'Linked File Version', 'Summary'].map((h) => (
                  <th
                    key={`drth-${h}`}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingRevisions ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`drskel-${i}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={`drskel-${i}-${j}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : documentRevisions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                        <BookOpen size={22} className="text-[hsl(var(--muted-foreground))] opacity-60" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">No publication revisions</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          Upload a document version and run automated extraction to populate official publication revisions.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                documentRevisions.map((dr, idx) => (
                  <tr
                    key={`dr-${dr.id}`}
                    className={`border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100 ${idx === 0 ? 'bg-indigo-50/30' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <BookMarked size={13} className="text-indigo-500 shrink-0" />
                        <span className="font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md text-xs whitespace-nowrap">
                          {dr.revision_label}
                        </span>
                        {idx === 0 && (
                          <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                            Latest
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
                      {dr.publication_date ? formatDate(dr.publication_date) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {dr.document_version ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))]">
                            {dr.document_version.version_label}
                          </span>
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))] opacity-70">file</span>
                        </div>
                      ) : (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] opacity-50 italic">No file linked</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] max-w-[320px]">
                      {dr.revision_summary ? (
                        <span className="line-clamp-2" title={dr.revision_summary}>{dr.revision_summary}</span>
                      ) : (
                        <span className="opacity-50 italic">No summary</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {versionModalOpen && docId && (
        <VersionFormModal
          version={editVersion}
          documentId={docId}
          existingVersions={versions}
          onClose={() => setVersionModalOpen(false)}
          onSaved={() => { setVersionModalOpen(false); fetchVersions(); }}
          onExtractionComplete={handleExtractionComplete}
        />
      )}

      {/* Extraction Summary Modal */}
      {extractionSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[hsl(var(--border))] max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${extractionSummary.failedRowsCount > 0 ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                  {extractionSummary.failedRowsCount > 0
                    ? <AlertTriangle size={16} className="text-amber-600" />
                    : <CheckCircle2 size={16} className="text-emerald-600" />
                  }
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">Extraction Summary</h2>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Results from regulation extraction</p>
                </div>
              </div>
              <button
                onClick={() => setExtractionSummary(null)}
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* Stats grid */}
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[hsl(var(--muted)/0.5)] rounded-xl p-4 border border-[hsl(var(--border))]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Extracted Regulations</p>
                  <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{extractionSummary.extractedCount}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">Inserted Regulations</p>
                  <p className="text-2xl font-bold text-emerald-700">{extractionSummary.insertedRegulationsCount}</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 mb-1">Regulation Versions</p>
                  <p className="text-2xl font-bold text-blue-700">{extractionSummary.insertedRegulationVersionCount}</p>
                </div>
                <div className="bg-violet-50 rounded-xl p-4 border border-violet-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 mb-1">Linked Annexes</p>
                  <p className="text-2xl font-bold text-violet-700">{extractionSummary.linkedAnnexCount}</p>
                </div>
              </div>

              {/* Failed rows */}
              <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${extractionSummary.failedRowsCount > 0 ? 'bg-red-50 border-red-200' : 'bg-[hsl(var(--muted)/0.3)] border-[hsl(var(--border))]'}`}>
                <div className="flex items-center gap-2">
                  {extractionSummary.failedRowsCount > 0
                    ? <AlertTriangle size={15} className="text-red-600" />
                    : <CheckCircle2 size={15} className="text-emerald-600" />
                  }
                  <span className={`text-sm font-medium ${extractionSummary.failedRowsCount > 0 ? 'text-red-700' : 'text-[hsl(var(--muted-foreground))]'}`}>
                    Failed Rows
                  </span>
                </div>
                <span className={`text-lg font-bold ${extractionSummary.failedRowsCount > 0 ? 'text-red-700' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  {extractionSummary.failedRowsCount}
                </span>
              </div>

              {/* Warnings / Errors list */}
              {extractionSummary.warnings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
                    Warnings &amp; Errors ({extractionSummary.warnings.length})
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                    {extractionSummary.warnings.map((w, i) => (
                      <div
                        key={`warn-${i}`}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200"
                      >
                        <AlertTriangle size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-amber-800 leading-relaxed break-words">{w}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {extractionSummary.warnings.length === 0 && extractionSummary.failedRowsCount === 0 && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 size={15} className="text-emerald-600" />
                  <p className="text-sm text-emerald-700 font-medium">Extraction completed successfully with no warnings.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex justify-end flex-shrink-0">
              <button
                onClick={() => setExtractionSummary(null)}
                className="px-4 py-2 text-sm font-medium bg-[hsl(var(--primary))] text-white rounded-lg hover:bg-[hsl(214,83%,22%)] transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Comparison Modal */}
      {viewComparison && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[hsl(var(--border))] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] flex-shrink-0">
              <div className="flex items-center gap-2">
                <GitCompare size={18} className="text-[hsl(var(--primary))]" />
                <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                  Comparison #{viewComparison.id}
                </h2>
              </div>
              <button
                onClick={() => { setViewComparison(null); setExpandedChange(null); }}
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Old Version</p>
                  <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded">
                    {viewComparison.old_version?.version_label ?? '—'}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">New Version</p>
                  <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded">
                    {viewComparison.new_version?.version_label ?? '—'}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Impact Level</p>
                  {viewComparison.impact_level ? (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${IMPACT_COLORS[viewComparison.impact_level]}`}>
                      {IMPACT_ICON[viewComparison.impact_level]}
                      {viewComparison.impact_level.charAt(0).toUpperCase() + viewComparison.impact_level.slice(1)}
                    </span>
                  ) : (
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">Not specified</span>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Created</p>
                  <p className="text-sm text-[hsl(var(--foreground))]">{formatDate(viewComparison.created_at)}</p>
                </div>
              </div>
              {viewComparison.summary_ai && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">AI Summary</p>
                  <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed bg-[hsl(var(--muted)/0.5)] rounded-lg p-3">
                    {viewComparison.summary_ai}
                  </p>
                </div>
              )}
              {viewComparison.changes_json && viewComparison.changes_json.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
                    Changes ({viewComparison.changes_json.length})
                  </p>
                  <div className="space-y-2">
                    {viewComparison.changes_json.map((change, idx) => (
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
                onClick={() => { setViewComparison(null); setExpandedChange(null); }}
                className="px-4 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] rounded-lg transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteVersion}
        title="Delete Version"
        message={`Are you sure you want to delete version "${deleteVersion?.version_label}"? Any associated comparisons referencing this version may be affected.`}
        confirmLabel="Delete Version"
        onConfirm={handleDeleteVersion}
        onCancel={() => setDeleteVersion(null)}
        loading={deleteLoading}
      />
      <ConfirmDialog
        open={!!deleteComparison}
        title="Delete Comparison"
        message={`Are you sure you want to delete Comparison #${deleteComparison?.id}? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteComparison}
        onCancel={() => setDeleteComparison(null)}
        loading={deleteCompLoading}
      />
    </div>
  );
}