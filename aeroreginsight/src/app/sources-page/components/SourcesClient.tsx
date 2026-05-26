'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { supabase, DocumentSource } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Database,
  RefreshCw,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusBadge from '@/components/ui/StatusBadge';
import SourceFormModal from './SourceFormModal';
import { useRole } from '@/contexts/RoleContext';

type SortField = 'source_name' | 'source_type' | 'document_group' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function SourcesClient() {
  const { canCreate, canEdit, canDelete } = useRole();
  const [sources, setSources] = useState<DocumentSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('source_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DocumentSource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentSource | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Backend integration: fetch all document_source rows
  const fetchSources = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('document_source')
      .select('*')
      .order(sortField, { ascending: sortDir === 'asc' });
    if (error) {
      toast.error(`Failed to load sources: ${error.message}`);
    } else {
      setSources(data ?? []);
    }
    setLoading(false);
  }, [sortField, sortDir]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const filtered = sources.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.source_name.toLowerCase().includes(q) ||
      s.source_type.toLowerCase().includes(q)
    );
  });

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
    // Backend integration: delete document_source row
    const { error } = await supabase
      .from('document_source')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleteLoading(false);
    if (error) {
      toast.error(`Failed to delete source: ${error.message}`);
    } else {
      toast.success(`Source "${deleteTarget.source_name}" deleted.`);
      setDeleteTarget(null);
      fetchSources();
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))] tracking-tight">
            Regulatory Sources
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            Manage aviation regulatory authorities and document source registries for structured data ingestion.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchSources}
            className="p-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all duration-150"
            title="Refresh sources"
          >
            <RefreshCw size={16} />
          </button>
          {canCreate && (
          <button
            onClick={() => { setEditTarget(null); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 shadow-sm"
          >
            <Plus size={16} />
            Add Source
          </button>
          )}
        </div>
      </div>

      {/* Search + stats */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
          />
          <input
            type="text"
            placeholder="Search by name or type…"
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
        <p className="text-sm text-[hsl(var(--muted-foreground))] tabular-nums shrink-0">
          {filtered.length} of {sources.length} source{sources.length !== 1 ? 's' : ''}
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
                    { label: 'Source Type', field: 'source_type' as SortField },
                    { label: 'Source Name', field: 'source_name' as SortField },
                    { label: 'Document Group', field: 'document_group' as SortField },
                    { label: 'Status', field: null },
                    { label: 'Actions', field: null },
                  ] as { label: string; field: SortField | null }[]
                ).map(({ label, field }) => (
                  <th
                    key={`th-${label}`}
                    className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] whitespace-nowrap ${
                      field ? 'cursor-pointer select-none hover:text-[hsl(var(--foreground))]' : ''
                    } ${label === 'Actions' ? 'text-right' : ''}`}
                    onClick={() => field && handleSort(field)}
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
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skel-${i + 1}`} className="border-b border-[hsl(var(--border))]">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={`skel-${i + 1}-${j + 1}`} className="px-4 py-3">
                        <div className="animate-pulse bg-[hsl(var(--muted))] rounded h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Database size={36} className="text-[hsl(var(--muted-foreground))] opacity-40" />
                      <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                        {search ? 'No sources match your search.' : 'No regulatory sources configured yet.'}
                      </p>
                      {!search && (
                        <button
                          onClick={() => { setEditTarget(null); setModalOpen(true); }}
                          className="text-sm text-[hsl(var(--primary))] hover:underline font-medium"
                        >
                          Add your first source
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((source, idx) => (
                  <tr
                    key={`source-${source.id}`}
                    className={`border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors duration-100 group ${
                      idx % 2 === 0 ? '' : 'bg-[hsl(var(--muted)/0.15)]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded text-[hsl(var(--foreground))]">
                        {source.source_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-[hsl(var(--foreground))]">
                        {source.source_name}
                      </span>
                      {source.notes && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 truncate max-w-[240px]">
                          {source.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                      {source.document_group ?? (
                        <span className="text-[hsl(var(--muted-foreground))] opacity-50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={source.is_active ? 'Active' : 'Inactive'}
                        variant={source.is_active ? 'active' : 'inactive'}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {canEdit && (
                        <button
                          onClick={() => { setEditTarget(source); setModalOpen(true); }}
                          className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary)/0.1)] hover:text-[hsl(var(--primary))] transition-all duration-150"
                          title="Edit source"
                        >
                          <Pencil size={14} />
                        </button>
                        )}
                        {canDelete && (
                        <button
                          onClick={() => setDeleteTarget(source)}
                          className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 transition-all duration-150"
                          title="Delete source"
                        >
                          <Trash2 size={14} />
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {modalOpen && (
        <SourceFormModal
          source={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); fetchSources(); }}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Source"
        message={`Are you sure you want to delete "${deleteTarget?.source_name}"? This action cannot be undone and may affect linked documents.`}
        confirmLabel="Delete Source"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      />
    </div>
  );
}