'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { supabase, Document, DocumentVersion } from '@/lib/supabase';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  File,
  AlertCircle,
  Layers,
  X,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileSearch,
  BookOpen,
  GitBranch,
  XCircle,
  Info,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusBadge from '@/components/ui/StatusBadge';
import { useRole } from '@/contexts/RoleContext';

const STATUS_OPTIONS = ['draft', 'current', 'archived'];

type ProcessingStatus =
  | 'uploaded' |'text_extracted' |'regulations_extracted' |'revisions_extracted' |'failed';

interface VersionWithDoc extends DocumentVersion {
  document?: Document;
  processing_status?: ProcessingStatus;
  processing_error?: string | null;
  processing_updated_at?: string | null;
}

interface ExtractionDiagnostics {
  extractedCount: number;
  insertedRegulationsCount: number;
  insertedRegulationVersionCount: number;
  linkedAnnexCount: number;
  failedRowsCount: number;
  warnings: string[];
}

// ── Processing Status Badge ────────────────────────────────────────────────────

const PIPELINE_STAGES: { key: ProcessingStatus; label: string }[] = [
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'text_extracted', label: 'Text Extracted' },
  { key: 'regulations_extracted', label: 'Regulations Extracted' },
  { key: 'revisions_extracted', label: 'Revisions Extracted' },
  { key: 'failed', label: 'Failed' },
];

function ProcessingStatusBadge({
  status,
  error,
  onRetry,
  isRetrying,
}: {
  status: ProcessingStatus;
  error?: string | null;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const [showError, setShowError] = useState(false);

  const config: Record<
    ProcessingStatus,
    { icon: React.ReactNode; label: string; classes: string }
  > = {
    uploaded: {
      icon: <Clock size={11} />,
      label: 'Uploaded',
      classes: 'bg-slate-100 text-slate-600 border-slate-200',
    },
    text_extracted: {
      icon: <FileSearch size={11} />,
      label: 'Text Extracted',
      classes: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    regulations_extracted: {
      icon: <BookOpen size={11} />,
      label: 'Regulations Extracted',
      classes: 'bg-violet-50 text-violet-700 border-violet-200',
    },
    revisions_extracted: {
      icon: <GitBranch size={11} />,
      label: 'Revisions Extracted',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    failed: {
      icon: <XCircle size={11} />,
      label: 'Failed',
      classes: 'bg-red-50 text-red-700 border-red-200',
    },
  };

  const cfg = config[status] ?? config['uploaded'];

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.classes}`}
      >
        {cfg.icon}
        {cfg.label}
      </span>

      {status === 'failed' && error && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowError((v) => !v)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-red-600 hover:bg-red-50 border border-red-200 transition-all"
            title="View error details"
          >
            <Info size={11} />
            Details
          </button>
          {showError && (
            <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-white border border-red-200 rounded-xl shadow-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Extraction Error
                </p>
                <button
                  onClick={() => setShowError(false)}
                  className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  <X size={12} />
                </button>
              </div>
              <p className="text-xs text-red-800 leading-relaxed break-words whitespace-pre-wrap">
                {error}
              </p>
              {onRetry && (
                <button
                  onClick={() => { setShowError(false); onRetry(); }}
                  disabled={isRetrying}
                  className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all disabled:opacity-60"
                >
                  <Cpu size={11} className={isRetrying ? 'animate-pulse' : ''} />
                  {isRetrying ? 'Retrying…' : 'Retry Processing'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pipeline Progress Indicator ────────────────────────────────────────────────

function PipelineProgress({ status }: { status: ProcessingStatus }) {
  const stages: ProcessingStatus[] = [
    'uploaded',
    'text_extracted',
    'regulations_extracted',
    'revisions_extracted',
  ];

  if (status === 'failed') {
    return null; // Badge already shows failed state
  }

  const currentIdx = stages.indexOf(status);

  return (
    <div className="flex items-center gap-0.5 mt-1">
      {stages.map((s, i) => (
        <div
          key={s}
          className={`h-1 rounded-full flex-1 transition-all ${
            i <= currentIdx
              ? 'bg-emerald-500' :'bg-[hsl(var(--border))]'
          }`}
          title={PIPELINE_STAGES.find((p) => p.key === s)?.label}
        />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function VersionsClient() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [versions, setVersions] = useState<VersionWithDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const { canCreate, canDelete } = useRole();

  // Form state
  const [selectedDocId, setSelectedDocId] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [status, setStatus] = useState('draft');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<VersionWithDoc | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Reprocess
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [reprocessDiagnostics, setReprocessDiagnostics] = useState<ExtractionDiagnostics | null>(null);

  const fetchDocuments = useCallback(async () => {
    const { data } = await supabase
      .from('document')
      .select('*')
      .order('title', { ascending: true });
    setDocuments(data ?? []);
  }, []);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('document_version')
      .select('*, document(*)')
      .order('uploaded_at', { ascending: false });
    if (error) {
      toast.error(`Failed to load versions: ${error.message}`);
    } else {
      setVersions((data ?? []) as VersionWithDoc[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDocuments();
    fetchVersions();
  }, [fetchDocuments, fetchVersions]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 50 * 1024 * 1024) {
      setFileError('File size must be under 50 MB.');
      return;
    }
    setFile(f);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedDocId) { setFormError('Please select a document.'); return; }
    if (!versionLabel.trim()) { setFormError('Version label is required.'); return; }
    if (!file) { setFormError('Please select a file to upload.'); return; }

    setUploading(true);

    // Use authenticated browser client so the JWT is sent with the storage request
    const authClient = createClient();

    // Use getUser() — validates token with Supabase server, never returns a stale/false null
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      setUploading(false);
      router.push('/login');
      return;
    }

    // Upload file to Supabase Storage
    const ext = file.name.split('.').pop();
    const uniqueName = `${selectedDocId}/${Date.now()}.${ext}`;
    const { data: uploadData, error: uploadError } = await authClient.storage
      .from('documents')
      .upload(uniqueName, file, { upsert: false });

    if (uploadError) {
      const msg = uploadError.message || JSON.stringify(uploadError);
      toast.error(`File upload failed: ${msg}`);
      setFormError(`Upload error: ${msg}`);
      setUploading(false);
      return;
    }

    // Insert document_version row
    const { error: insertError } = await authClient.from('document_version').insert({
      document_id: selectedDocId,
      version_label: versionLabel.trim(),
      status,
      file_path: uploadData.path,
      file_name: file.name,
      processing_status: 'uploaded',
    });

    setUploading(false);

    if (insertError) {
      const msg = insertError.message || JSON.stringify(insertError);
      toast.error(`Failed to save version: ${msg}`);
      setFormError(`Database error: ${msg}`);
      return;
    }

    toast.success('Version uploaded successfully.');
    // Reset form
    setSelectedDocId('');
    setVersionLabel('');
    setStatus('draft');
    setFile(null);
    const input = document.getElementById('version-file-input') as HTMLInputElement;
    if (input) input.value = '';
    fetchVersions();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);

    // Delete file from storage if exists
    if (deleteTarget.file_path) {
      await supabase.storage.from('documents').remove([deleteTarget.file_path]);
    }

    const { error } = await supabase
      .from('document_version')
      .delete()
      .eq('id', deleteTarget.id);

    setDeleteLoading(false);
    setDeleteTarget(null);

    if (error) {
      toast.error(`Failed to delete version: ${error.message}`);
    } else {
      toast.success('Version deleted.');
      fetchVersions();
    }
  };

  const handleReprocess = async (v: VersionWithDoc) => {
    if (!v.document_id) return;
    setReprocessingId(v.id);
    toast.info(`Reprocessing "${v.version_label}"…`);
    try {
      const res = await fetch('/api/ai/reprocess-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentVersionId: v.id,
          documentId: v.document_id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(`Reprocessing failed: ${data.error ?? 'Unknown error'}`);
      } else {
        setReprocessDiagnostics(data.diagnostics);
        toast.success('Reprocessing complete.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reprocessing encountered an error.';
      toast.error(msg);
    } finally {
      setReprocessingId(null);
      // Refresh to pick up updated processing_status
      fetchVersions();
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[hsl(var(--primary)/0.1)]">
          <Layers size={20} className="text-[hsl(var(--primary))]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--foreground))]">Document Versions</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Upload regulatory document files and assign revision labels for automated extraction and standards analysis.
          </p>
        </div>
      </div>

      {/* Upload Form */}
      {canCreate && (
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm">
        <div className="px-6 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Upload size={15} className="text-[hsl(var(--primary))]" />
            Upload New Version
          </h2>
        </div>
        <form onSubmit={handleUpload} className="px-6 py-5 space-y-4">
          {formError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Document */}
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                Document <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                disabled={uploading}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all disabled:opacity-60"
              >
                <option value="">Select a document</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title} ({doc.document_code})
                  </option>
                ))}
              </select>
            </div>

            {/* Version Label */}
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                Version Label <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                placeholder="e.g. Rev 15, Amendment 6"
                disabled={uploading}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))] font-mono disabled:opacity-60"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={uploading}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all disabled:opacity-60"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                Document File <span className="text-red-500">*</span>
              </label>
              <label
                htmlFor="version-file-input"
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm border border-dashed rounded-lg cursor-pointer transition-all ${
                  file
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.04)] text-[hsl(var(--foreground))]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/0.5)] hover:bg-[hsl(var(--primary)/0.04)]'
                } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <File size={14} className="shrink-0" />
                <span className="truncate">{file ? file.name : 'Click to select file (PDF, DOCX, TXT…)'}</span>
                {file && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setFile(null); const inp = document.getElementById('version-file-input') as HTMLInputElement; if (inp) inp.value = ''; }}
                    className="ml-auto shrink-0 text-[hsl(var(--muted-foreground))] hover:text-red-500"
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
              <input
                id="version-file-input"
                type="file"
                accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              {fileError && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle size={11} /> {fileError}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={uploading}
              className="flex items-center gap-2 px-5 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-[0.99] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Uploading…
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Upload Version
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      )}

      {/* Versions List */}
      <div className="bg-white rounded-xl border border-[hsl(var(--border))] shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <FileText size={15} className="text-[hsl(var(--muted-foreground))]" />
            All Versions
            <span className="ml-1 text-xs font-normal text-[hsl(var(--muted-foreground))]">
              ({versions.length})
            </span>
          </h2>
          <button
            onClick={fetchVersions}
            disabled={loading}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[hsl(var(--muted-foreground))]">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading versions…
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[hsl(var(--muted-foreground))]">
            <Layers size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No document versions yet</p>
            <p className="text-xs mt-1">Upload a regulatory document version above to begin automated extraction.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Document</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Version</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Pipeline</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">File</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Uploaded</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {versions.map((v) => {
                  const procStatus: ProcessingStatus = (v.processing_status as ProcessingStatus) ?? 'uploaded';
                  return (
                    <tr key={v.id} className="hover:bg-[hsl(var(--muted)/0.3)] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-[hsl(var(--foreground))] truncate max-w-[200px]">
                          {v.document?.title ?? '—'}
                        </div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">
                          {v.document?.document_code ?? ''}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs bg-[hsl(var(--muted))] px-2 py-0.5 rounded">
                          {v.version_label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="px-5 py-3.5 min-w-[180px]">
                        <ProcessingStatusBadge
                          status={procStatus}
                          error={v.processing_error}
                          onRetry={() => handleReprocess(v)}
                          isRetrying={reprocessingId === v.id}
                        />
                        <PipelineProgress status={procStatus} />
                        {v.processing_updated_at && (
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                            Updated {new Date(v.processing_updated_at).toLocaleDateString('en-GB', {
                              day: '2-digit', month: 'short', year: 'numeric',
                            })}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {v.file_name ? (
                          <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground))]">
                            <File size={12} className="text-[hsl(var(--muted-foreground))]" />
                            <span className="truncate max-w-[140px]">{v.file_name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {new Date(v.uploaded_at).toLocaleDateString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleReprocess(v)}
                            disabled={reprocessingId === v.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                            title="Reprocess: re-run text, regulation, revision extraction and annex linking"
                          >
                            {reprocessingId === v.id ? (
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
                          {canDelete && (
                          <button
                            onClick={() => setDeleteTarget(v)}
                            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 transition-all"
                            title="Delete version"
                          >
                            <Trash2 size={14} />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Version"
        description={`Are you sure you want to delete version "${deleteTarget?.version_label}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Reprocess Diagnostics Modal */}
      {reprocessDiagnostics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[hsl(var(--border))] max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${reprocessDiagnostics.failedRowsCount > 0 ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                  {reprocessDiagnostics.failedRowsCount > 0
                    ? <AlertTriangle size={16} className="text-amber-600" />
                    : <CheckCircle2 size={16} className="text-emerald-600" />
                  }
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">Reprocess Diagnostics</h2>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Results from document reprocessing</p>
                </div>
              </div>
              <button
                onClick={() => setReprocessDiagnostics(null)}
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[hsl(var(--muted)/0.5)] rounded-xl p-4 border border-[hsl(var(--border))]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Extracted Regulations</p>
                  <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{reprocessDiagnostics.extractedCount}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">Inserted Regulations</p>
                  <p className="text-2xl font-bold text-emerald-700">{reprocessDiagnostics.insertedRegulationsCount}</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 mb-1">Regulation Versions</p>
                  <p className="text-2xl font-bold text-blue-700">{reprocessDiagnostics.insertedRegulationVersionCount}</p>
                </div>
                <div className="bg-violet-50 rounded-xl p-4 border border-violet-200">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 mb-1">Linked Annexes</p>
                  <p className="text-2xl font-bold text-violet-700">{reprocessDiagnostics.linkedAnnexCount}</p>
                </div>
              </div>

              <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${reprocessDiagnostics.failedRowsCount > 0 ? 'bg-red-50 border-red-200' : 'bg-[hsl(var(--muted)/0.3)] border-[hsl(var(--border))]'}`}>
                <div className="flex items-center gap-2">
                  {reprocessDiagnostics.failedRowsCount > 0
                    ? <AlertTriangle size={15} className="text-red-600" />
                    : <CheckCircle2 size={15} className="text-emerald-600" />
                  }
                  <span className={`text-sm font-medium ${reprocessDiagnostics.failedRowsCount > 0 ? 'text-red-700' : 'text-[hsl(var(--muted-foreground))]'}`}>
                    Failed Rows
                  </span>
                </div>
                <span className={`text-lg font-bold ${reprocessDiagnostics.failedRowsCount > 0 ? 'text-red-700' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  {reprocessDiagnostics.failedRowsCount}
                </span>
              </div>

              {reprocessDiagnostics.warnings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
                    Warnings &amp; Errors ({reprocessDiagnostics.warnings.length})
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {reprocessDiagnostics.warnings.map((w, i) => (
                      <div key={`warn-${i}`} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                        <AlertTriangle size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-amber-800 leading-relaxed break-words">{w}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reprocessDiagnostics.warnings.length === 0 && reprocessDiagnostics.failedRowsCount === 0 && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 size={15} className="text-emerald-600" />
                  <p className="text-sm text-emerald-700 font-medium">Reprocessing completed successfully with no warnings.</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex justify-end flex-shrink-0">
              <button
                onClick={() => setReprocessDiagnostics(null)}
                className="px-4 py-2 text-sm font-medium bg-[hsl(var(--primary))] text-white rounded-lg hover:bg-[hsl(214,83%,22%)] transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
