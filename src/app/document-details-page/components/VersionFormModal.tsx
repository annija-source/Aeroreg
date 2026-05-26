'use client';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { supabase, DocumentVersion } from '@/lib/supabase';
import { toast } from 'sonner';
import { X, Upload, File, AlertCircle, Cpu } from 'lucide-react';

type FormValues = {
  version_label: string;
  effective_date: string;
  publication_date: string;
  document_url: string;
  status: string;
  previous_version_id: string;
};

export interface ExtractionSummary {
  extractedCount: number;
  insertedRegulationsCount: number;
  insertedRegulationVersionCount: number;
  linkedAnnexCount: number;
  failedRowsCount: number;
  warnings: string[];
}

const STATUS_OPTIONS = ['current', 'archived', 'draft'];

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string ?? '');
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

export default function VersionFormModal({
  version,
  documentId,
  existingVersions,
  onClose,
  onSaved,
  onExtractionComplete,
}: {
  version: DocumentVersion | null;
  documentId: string;
  existingVersions: DocumentVersion[];
  onClose: () => void;
  onSaved: () => void;
  onExtractionComplete?: (summary: ExtractionSummary) => void;
}) {
  const isEdit = !!version;
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [fileError, setFileError] = useState<string>('');
  const [extracting, setExtracting] = useState(false);
  const [extractingRevisions, setExtractingRevisions] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      version_label: '',
      effective_date: '',
      publication_date: '',
      document_url: '',
      status: 'draft',
      previous_version_id: '',
    },
  });

  useEffect(() => {
    if (version) {
      reset({
        version_label: version.version_label,
        effective_date: version.effective_date ?? '',
        publication_date: version.publication_date ?? '',
        document_url: version.document_url ?? '',
        status: version.status,
        previous_version_id: version.previous_version_id ?? '',
      });
    }
  }, [version, reset]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 50 * 1024 * 1024) {
      setFileError('File size must be under 50 MB.');
      return;
    }
    setFile(f);
  };

  const triggerRegulationExtraction = async (
    savedVersionId: string,
    uploadedFile: File
  ) => {
    setExtracting(true);
    try {
      let documentText = '';

      const isPdf = uploadedFile.type === 'application/pdf';
      if (isPdf) {
        // For PDFs, send as base64 to AI for text extraction via multimodal
        const base64DataUri = await readFileAsBase64(uploadedFile);
        const aiRes = await fetch('/api/ai/chat-completion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'OPEN_AI',
            model: 'gpt-4o',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Extract all text content from this document. Return only the raw text, no formatting.',
                  },
                  {
                    type: 'file',
                    file: {
                      file_data: base64DataUri,
                      filename: uploadedFile.name,
                    },
                  },
                ],
              },
            ],
            stream: false,
            parameters: { max_completion_tokens: 8000 },
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          documentText = aiData?.choices?.[0]?.message?.content ?? '';
        }
      } else {
        // For text-based files, read directly
        documentText = await readFileAsText(uploadedFile);
      }

      if (!documentText.trim()) {
        toast.warning('Could not extract text from document. Regulation extraction skipped.');
        return;
      }

      const extractRes = await fetch('/api/ai/extract-regulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          documentVersionId: savedVersionId,
          documentId,
        }),
      });

      const extractData = await extractRes.json();

      if (!extractRes.ok || !extractData.success) {
        toast.warning(
          `Regulation extraction failed: ${extractData.error ?? 'Unknown error'}`
        );
        return;
      }

      const count = extractData.regulations?.length ?? 0;
      if (count > 0) {
        toast.success(
          `Extracted ${count} regulation${count !== 1 ? 's' : ''} and stored in database.`
        );
      } else {
        toast.info('No regulations detected in this document.');
      }
    } catch (err) {
      toast.warning('Regulation extraction encountered an error. Version was saved successfully.');
    } finally {
      setExtracting(false);
    }
  };

  const triggerRevisionExtraction = async (
    savedVersionId: string,
    uploadedFile: File,
    documentText: string
  ) => {
    setExtractingRevisions(true);
    try {
      if (!documentText.trim()) return;

      const extractRes = await fetch('/api/ai/extract-revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText,
          documentVersionId: savedVersionId,
          documentId,
        }),
      });

      const extractData = await extractRes.json();

      if (!extractRes.ok || !extractData.success) {
        toast.warning(
          `Revision history extraction failed: ${extractData.error ?? 'Unknown error'}`
        );
        return;
      }

      const count = extractData.revisions?.length ?? 0;
      if (count > 0) {
        toast.success(
          `Extracted ${count} document revision${count !== 1 ? 's' : ''} and stored in database.`
        );
      } else {
        toast.info('No document revision history detected.');
      }
    } catch (err) {
      toast.warning('Document revision extraction encountered an error.');
    } finally {
      setExtractingRevisions(false);
    }
  };

  const runAllExtractions = async (
    savedVersionId: string,
    uploadedFile: File,
    uploadedFilePath?: string
  ) => {
    let documentText = '';

    const isPdf = uploadedFile.type === 'application/pdf';

    // For non-PDF files, read text directly from the file
    // For PDFs, skip client-side extraction — the server-side pdfExtractor handles it via filePath
    if (!isPdf) {
      documentText = await readFileAsText(uploadedFile);
    }

    if (!isPdf && !documentText.trim()) {
      toast.warning('Could not extract text from document. AI extraction skipped.');
      return;
    }

    // Collect summary data across both extractions
    const summaryWarnings: string[] = [];
    let extractedCount = 0;
    let insertedRegulationsCount = 0;
    let insertedRegulationVersionCount = 0;
    let linkedAnnexCount = 0;
    let failedRowsCount = 0;

    // Run both extractions in parallel
    // For PDFs: pass filePath so the server extracts text via pdf-parse
    // For text files: pass documentText directly
    await Promise.all([
      (async () => {
        setExtracting(true);
        try {
          const extractRes = await fetch('/api/ai/extract-regulations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(documentText ? { documentText } : {}),
              ...(uploadedFilePath ? { filePath: uploadedFilePath } : {}),
              documentVersionId: savedVersionId,
              documentId,
            }),
          });
          const extractData = await extractRes.json();
          if (!extractRes.ok || !extractData.success) {
            const errMsg = extractData.error ?? 'Unknown error';
            toast.warning(`Regulation extraction failed: ${errMsg}`);
            summaryWarnings.push(`Extraction failed: ${errMsg}`);
          } else {
            extractedCount = extractData.diagnostics?.totalExtracted ?? extractData.regulations?.length ?? 0;
            insertedRegulationsCount = extractData.stored?.regulation_ids?.length ?? 0;
            insertedRegulationVersionCount = extractData.stored?.regulation_version_ids?.length ?? 0;
            linkedAnnexCount = extractData.stored?.regulation_annex_ids?.length ?? 0;
            failedRowsCount = extractData.diagnostics?.totalFailed ?? 0;
            if (extractData.diagnostics?.errors?.length) {
              summaryWarnings.push(...extractData.diagnostics.errors);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Regulation extraction encountered an error.';
          toast.warning(msg);
          summaryWarnings.push(msg);
        } finally {
          setExtracting(false);
        }
      })(),
      (async () => {
        setExtractingRevisions(true);
        try {
          const revRes = await fetch('/api/ai/extract-revisions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(documentText ? { documentText } : {}),
              ...(uploadedFilePath ? { filePath: uploadedFilePath } : {}),
              documentVersionId: savedVersionId,
              documentId,
            }),
          });
          const revData = await revRes.json();
          if (!revRes.ok || !revData.success) {
            const errMsg = revData.error ?? 'Unknown error';
            toast.warning(`Revision history extraction failed: ${errMsg}`);
            summaryWarnings.push(`Revision extraction failed: ${errMsg}`);
          } else {
            const count = revData.revisions?.length ?? 0;
            if (count === 0) {
              summaryWarnings.push('No document revision history detected.');
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Document revision extraction encountered an error.';
          toast.warning(msg);
          summaryWarnings.push(msg);
        } finally {
          setExtractingRevisions(false);
        }
      })(),
    ]);

    // Fire extraction summary callback
    if (onExtractionComplete) {
      onExtractionComplete({
        extractedCount,
        insertedRegulationsCount,
        insertedRegulationVersionCount,
        linkedAnnexCount,
        failedRowsCount,
        warnings: summaryWarnings,
      });
    }
  };

  const onSubmit = async (values: FormValues) => {
    let filePath: string | null = version?.file_path ?? null;
    let fileName: string | null = version?.file_name ?? null;

    // Backend integration: upload file to Supabase Storage bucket "documents"
    if (file) {
      setUploadProgress('Uploading file…');
      const ext = file.name.split('.').pop();
      const uniqueName = `${documentId}/${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(uniqueName, file, { upsert: false });
      if (uploadError) {
        toast.error(`File upload failed: ${uploadError.message}`);
        setUploadProgress('');
        return;
      }
      filePath = uploadData.path;
      fileName = file.name;
      setUploadProgress('');
    }

    const payload = {
      document_id: documentId,
      version_label: values.version_label.trim(),
      effective_date: values.effective_date || null,
      publication_date: values.publication_date || null,
      document_url: values.document_url.trim() || null,
      status: values.status.toLowerCase(),
      previous_version_id: values.previous_version_id || null,
      file_path: filePath,
      file_name: fileName,
    };

    if (isEdit && version) {
      // Backend integration: update document_version row
      const { error } = await supabase
        .from('document_version')
        .update(payload)
        .eq('id', version.id);
      if (error) { toast.error(`Failed to update version: ${error.message}`); return; }
      toast.success('Version updated successfully.');

      // Trigger both regulation and revision extraction on reprocess (edit with new file)
      if (file) {
        await runAllExtractions(String(version.id), file, filePath ?? undefined);
      }
    } else {
      // Backend integration: insert document_version row
      const { data: insertedVersion, error } = await supabase
        .from('document_version')
        .insert(payload)
        .select('id')
        .single();
      if (error || !insertedVersion) {
        toast.error(`Failed to create version: ${error?.message ?? 'Unknown error'}`);
        return;
      }
      toast.success('Version created successfully.');

      // Trigger both regulation and revision extraction for new version with file
      if (file) {
        await runAllExtractions(String(insertedVersion.id), file, filePath ?? undefined);
      }
    }
    onSaved();
  };

  const previousVersionOptions = existingVersions.filter(
    (v) => !version || v.id !== version.id
  );

  const isBusy = isSubmitting || extracting || extractingRevisions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-[hsl(var(--border))] w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto scrollbar-thin animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
            {isEdit ? 'Edit Version' : 'Add New Version'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {/* version_label */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Version Label <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              Official version identifier (e.g. Rev 15, Amendment 6, Issue 3).
            </p>
            <input
              {...register('version_label', { required: 'Version label is required.' })}
              placeholder="e.g. Amendment 8"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))] font-mono"
            />
            {errors.version_label && (
              <p className="mt-1 text-xs text-red-600">{errors.version_label.message}</p>
            )}
          </div>

          {/* status */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Status <span className="text-red-500">*</span>
            </label>
            <select
              {...register('status', { required: 'Status is required.' })}
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all text-[hsl(var(--foreground))]"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={`vstatus-${s}`} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                Effective Date
              </label>
              <input
                type="date"
                {...register('effective_date')}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all text-[hsl(var(--foreground))]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                Publication Date
              </label>
              <input
                type="date"
                {...register('publication_date')}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all text-[hsl(var(--foreground))]"
              />
            </div>
          </div>

          {/* document_url */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              External Document URL
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              Direct link to the official publication on the authority's website.
            </p>
            <input
              {...register('document_url')}
              type="url"
              placeholder="https://easa.europa.eu/…"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
            />
          </div>

          {/* previous_version_id */}
          {previousVersionOptions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                Previous Version
              </label>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
                Link this version to its predecessor to enable comparison.
              </p>
              <select
                {...register('previous_version_id')}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all text-[hsl(var(--foreground))]"
              >
                <option value="">None (first version)</option>
                {previousVersionOptions.map((v) => (
                  <option key={`prev-ver-${v.id}`} value={v.id}>
                    {v.version_label} ({v.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Upload Document File
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              PDF, DOCX, or other document formats. Max 50 MB. Stored in Supabase Storage.
            </p>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-[hsl(var(--border))] rounded-lg cursor-pointer hover:border-[hsl(var(--primary)/0.5)] hover:bg-[hsl(var(--primary)/0.02)] transition-all duration-150 group">
              <div className="flex flex-col items-center gap-2 text-center px-4">
                {file ? (
                  <>
                    <File size={20} className="text-[hsl(var(--primary))]" />
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {file.name}
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={20} className="text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors" />
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">
                      Click to upload or drag and drop
                    </span>
                    {isEdit && version?.file_name && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        Current: {version.file_name}
                      </span>
                    )}
                  </>
                )}
              </div>
              <input
                type="file"
                className="hidden"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.xlsx,.xls,.txt"
              />
            </label>
            {fileError && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
                <AlertCircle size={12} />
                {fileError}
              </p>
            )}
            {uploadProgress && (
              <p className="mt-1.5 text-xs text-[hsl(var(--primary))] flex items-center gap-1.5">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {uploadProgress}
              </p>
            )}
            {extracting && (
              <p className="mt-1.5 text-xs text-blue-600 flex items-center gap-1.5">
                <Cpu size={12} className="animate-pulse" />
                Extracting regulations with AI…
              </p>
            )}
            {extractingRevisions && (
              <p className="mt-1.5 text-xs text-indigo-600 flex items-center gap-1.5">
                <Cpu size={12} className="animate-pulse" />
                Extracting document revision history with AI…
              </p>
            )}
            {file && !extracting && !extractingRevisions && !uploadProgress && (
              <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                <Cpu size={12} />
                AI regulation & revision extraction will run automatically after upload.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[hsl(var(--primary))] text-white hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 disabled:opacity-60 flex items-center gap-2 min-w-[130px] justify-center"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Saving…
                </>
              ) : (extracting || extractingRevisions) ? (
                <>
                  <Cpu size={14} className="animate-pulse" />
                  Extracting…
                </>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Create Version'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}