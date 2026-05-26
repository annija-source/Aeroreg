'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Document, DocumentSource } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  FileText,
  RefreshCw,
  Eye,
  ChevronUp,
  ChevronDown,
  Star,
  StarOff,
  Filter,
  BookMarked,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusBadge from '@/components/ui/StatusBadge';
import DocumentFormModal from './DocumentFormModal';
import { useRole } from '@/contexts/RoleContext';

type SortField = 'title' | 'document_code' | 'authority' | 'category' | 'created_at';
type SortDir = 'asc' | 'desc';

interface DocumentRevisionSummary {
  latestLabel: string | null;
  latestDate: string | null;
  latestVersionLabel: string | null;
  count: number;
}

export default function DocumentsClient() {
  const router = useRouter();
  const { canCreate, canEdit, canDelete } = useRole();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sources, setSources] = useState<DocumentSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Document | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [watchLoading, setWatchLoading] = useState<string | null>(null);
  const [revisionMap, setRevisionMap] = useState<Record<number, DocumentRevisionSummary>>({});

  // Backend integration: fetch documents joined with document_source
  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('document')
      .select('*, document_source(id, source_name, source_type)')
      .order(sortField, { ascending: sortDir === 'asc' });

    if (filterSource) {
      query = query.eq('source_id', filterSource);
    }

    const { data, error } = await query;
    if (error) {
      toast.error(`Failed to load documents: ${error.message}`);
    } else {
      const docs = data ?? [];
      setDocuments(docs);

      // Fetch document_revision data for all documents
      if (docs.length > 0) {
        const docIds = docs.map((d: Document) => d.id);
        const { data: revData } = await supabase
          .from('document_revision')
          .select('id, document_id, revision_label, publication_date, document_version_id, document_version:document_version_id(version_label)')
          .in('document_id', docIds)
          .order('publication_date', { ascending: false });

        const map: Record<number, DocumentRevisionSummary> = {};
        (revData ?? []).forEach((rev: { id: number; document_id: number; revision_label: string; publication_date: string | null; document_version_id: number | null; document_version: { version_label: string } | null }) => {
          if (!map[rev.document_id]) {
            map[rev.document_id] = {
              latestLabel: rev.revision_label,
              latestDate: rev.publication_date,
              latestVersionLabel: rev.document_version?.version_label ?? null,
              count: 0,
            };
          }
          map[rev.document_id].count += 1;
        });
        setRevisionMap(map);
      }
    }
    setLoading(false);
  }, [sortField, sortDir, filterSource]);

  // Backend integration: fetch all sources for filter dropdown
  const fetchSources = useCallback(async () => {
    const { data } = await supabase
      .from('document_source')
      .select('id, source_name, source_type, document_group, notes, is_active, created_at')
      .eq('is_active', true)
      .order('source_name');
    setSources(data ?? []);
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const filtered = documents.filter((d) => {
    const q = search.toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      d.document_code.toLowerCase().includes(q) ||
      (d.authority ?? '').toLowerCase().includes(q)
    );
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((p) => (p === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    // Backend integration: delete document row
    const { error } = await supabase.from('document').delete().eq('id', deleteTarget.id);
    setDeleteLoading(false);
    if (error) {
      toast.error(`Failed to delete document: ${error.message}`);
    } else {
      toast.success(`Document "${deleteTarget.title}" deleted.`);
      setDeleteTarget(null);
      fetchDocuments();
    }
  };

  const handleToggleWatched = async (doc: Document) => {
    setWatchLoading(doc.id);
    // Backend integration: toggle watched flag on document
    const { error } = await supabase
      .from('document')
      .update({ watched: !doc.watched })
      .eq('id', doc.id);
    setWatchLoading(null);
    if (error) {
      toast.error(`Failed to update watch status: ${error.message}`);
    } else {
      toast.success(doc.watched ? 'Document unwatched.' : 'Document added to watchlist.');
      fetchDocuments();
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <ChevronUp size={13} className="opacity-30 text-[hsl(var(--muted-foreground))]" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={13} className="text-[hsl(var(--primary))]" />
    ) : (
      <ChevronDown size={13} className="text-[hsl(var(--primary))]" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] tracking-tight">
            Regulatory Documents
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            Manage aviation regulatory documents, revision history, and automated extraction pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchDocuments}
            className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
            title="Refresh documents"
          >
            <RefreshCw size={16} />
          </button>
          {canCreate && (
          <button
            onClick={() => { setEditTarget(null); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 shadow-sm"
          >
            <Plus size={16} />
            Add Document
          </button>
          )}
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            placeholder="Search title, code, authority…"
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

        <div className="flex items-center gap-2">
          <Filter size={15} className="text-[hsl(var(--muted-foreground))]" />
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="text-sm border border-[hsl(var(--border))] rounded-lg px-3 py-2 bg-white text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all"
          >
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={`filter-src-${s.id}`} value={s.id}>
                {s.source_name}
              </option>
            ))}
          </select>
        </div>

        <p className="text-sm text-[hsl(var(--muted-foreground))] tabular-nums ml-auto">
          {filtered.length} of {documents.length} document{documents.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.5)] border-b border-[hsl(var(--border))]">
                {(
                  [
                    { label: 'Source', field: null },
                    { label: 'Code', field: 'document_code' as SortField },
                    { label: 'Title', field: 'title' as SortField },
                    { label: 'Category', field: 'category' as SortField },
                    { label: 'Authority', field: 'authority' as SortField },
                    { label: 'Latest Revision', field: null },
                    { label: 'Watched', field: null },
                    { label: 'Actions', field: null },
                  ] as { label: string; field: SortField | null }[]
                ).map(({ label, field }) => (
                  <th
                    key={`dth-${label}`}
                    onClick={() => field && handleSort(field)}
                    className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap ${
                      field ? 'cursor-pointer select-none hover:text-[hsl(var(--foreground))]' : ''
                    } ${label === 'Actions' ? 'text-right' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {field && <SortIcon field={field} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`dskel-${i + 1}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={`dskel-${i + 1}-${j + 1}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                        <FileText size={26} className="text-[hsl(var(--muted-foreground))] opacity-60" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                          {search || filterSource ? 'No documents match your filters' : 'No regulatory documents yet'}
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          {search || filterSource
                            ? 'Try adjusting your search or filter criteria.' :'Add your first document to begin tracking regulatory changes.'}
                        </p>
                      </div>
                      {!search && !filterSource && canCreate && (
                        <button
                          onClick={() => { setEditTarget(null); setModalOpen(true); }}
                          className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] transition-all duration-150"
                        >
                          <Plus size={14} />
                          Add First Document
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((doc, idx) => {
                  const revInfo = revisionMap[doc.id as unknown as number] ?? null;
                  return (
                    <tr
                      key={`doc-${doc.id}`}
                      className={`border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100 group ${
                        idx % 2 === 0 ? '' : 'bg-[hsl(var(--muted)/0.15)]'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {(doc as Document & { document_source?: DocumentSource }).document_source?.source_name ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))]">
                          {doc.document_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[240px]">
                        <span className="font-medium text-[hsl(var(--foreground))] truncate block">
                          {doc.title}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {doc.category ? (
                          <StatusBadge label={doc.category} variant="default" />
                        ) : (
                          <span className="text-[hsl(var(--muted-foreground))] opacity-50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] text-xs">
                        {doc.authority ?? '—'}
                      </td>
                      {/* Latest Revision column */}
                      <td className="px-4 py-3">
                        {revInfo ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <BookMarked size={12} className="text-indigo-500 shrink-0" />
                              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md whitespace-nowrap">
                                {revInfo.latestLabel}
                              </span>
                              <span className="text-[10px] font-medium text-indigo-400 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                                Official
                              </span>
                            </div>
                            {revInfo.latestDate && (
                              <span className="text-xs text-[hsl(var(--muted-foreground))] pl-5">
                                {new Date(revInfo.latestDate).toLocaleDateString('en-GB', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </span>
                            )}
                            {revInfo.latestVersionLabel && (
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] pl-5 flex items-center gap-1">
                                <span className="opacity-60">File:</span>
                                <span className="font-mono bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded text-[hsl(var(--foreground))]">
                                  {revInfo.latestVersionLabel}
                                </span>
                              </span>
                            )}
                            {revInfo.count > 1 && (
                              <span className="text-xs text-[hsl(var(--muted-foreground))] pl-5">
                                {revInfo.count} revision{revInfo.count !== 1 ? 's' : ''} total
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))] opacity-50 italic">No revisions</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleWatched(doc)}
                          disabled={watchLoading === doc.id}
                          className={`p-1.5 rounded-md transition-all duration-150 ${
                            doc.watched
                              ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' :'text-[hsl(var(--muted-foreground))] hover:text-amber-500 hover:bg-amber-50'
                          } disabled:opacity-50`}
                          title={doc.watched ? 'Remove from watchlist' : 'Add to watchlist'}
                        >
                          {watchLoading === doc.id ? (
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          ) : doc.watched ? (
                            <Star size={15} fill="currentColor" />
                          ) : (
                            <StarOff size={15} />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() =>
                              router.push(`/document-details-page?id=${doc.id}`)
                            }
                            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-blue-50 hover:text-blue-600 transition-all duration-150"
                            title="Open document details"
                          >
                            <Eye size={14} />
                          </button>
                          {canEdit && (
                          <button
                            onClick={() => { setEditTarget(doc); setModalOpen(true); }}
                            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary)/0.1)] hover:text-[hsl(var(--primary))] transition-all duration-150"
                            title="Edit document"
                          >
                            <Pencil size={14} />
                          </button>
                          )}
                          {canDelete && (
                          <button
                            onClick={() => setDeleteTarget(doc)}
                            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 transition-all duration-150"
                            title="Delete document"
                          >
                            <Trash2 size={14} />
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

      {/* Modals */}
      {modalOpen && (
        <DocumentFormModal
          document={editTarget}
          sources={sources}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); fetchDocuments(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Document"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? All associated versions will also be affected.`}
        confirmLabel="Delete Document"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}