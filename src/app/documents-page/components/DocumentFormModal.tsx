'use client';
import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { supabase, Document, DocumentSource } from '@/lib/supabase';
import { toast } from 'sonner';
import { X } from 'lucide-react';

type FormValues = {
  source_id: string;
  document_code: string;
  title: string;
  category: string;
  authority: string;
  watched: boolean;
  description: string;
};

export default function DocumentFormModal({
  document,
  sources,
  onClose,
  onSaved,
}: {
  document: Document | null;
  sources: DocumentSource[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!document;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      source_id: '',
      document_code: '',
      title: '',
      category: '',
      authority: '',
      watched: false,
      description: '',
    },
  });

  useEffect(() => {
    if (document) {
      reset({
        source_id: document.source_id,
        document_code: document.document_code,
        title: document.title,
        category: document.category ?? '',
        authority: document.authority ?? '',
        watched: document.watched,
        description: document.description ?? '',
      });
    }
  }, [document, reset]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      source_id: values.source_id,
      document_code: values.document_code.trim(),
      title: values.title.trim(),
      category: values.category.trim() || null,
      authority: values.authority.trim() || null,
      watched: values.watched,
      description: values.description.trim() || null,
    };

    if (isEdit && document) {
      // Backend integration: update document row
      const { error } = await supabase
        .from('document')
        .update(payload)
        .eq('id', document.id);
      if (error) { toast.error(`Failed to update: ${error.message}`); return; }
      toast.success('Document updated successfully.');
    } else {
      // Backend integration: insert document row
      const { error } = await supabase.from('document').insert(payload);
      if (error) { toast.error(`Failed to create: ${error.message}`); return; }
      toast.success('Document created successfully.');
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-[hsl(var(--border))] w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto scrollbar-thin animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
            {isEdit ? 'Edit Document' : 'Add New Document'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {/* source_id */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Document Source <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              The regulatory authority that issued this document.
            </p>
            <select
              {...register('source_id', { required: 'Source is required.' })}
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all text-[hsl(var(--foreground))]"
            >
              <option value="">Select a source…</option>
              {sources.map((s) => (
                <option key={`src-opt-${s.id}`} value={s.id}>
                  {s.source_name}
                </option>
              ))}
            </select>
            {errors.source_id && (
              <p className="mt-1 text-xs text-red-600">{errors.source_id.message}</p>
            )}
          </div>

          {/* document_code */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Document Code <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              Official identifier assigned by the issuing authority (e.g. CS-25, FAR-121).
            </p>
            <input
              {...register('document_code', { required: 'Document code is required.' })}
              placeholder="e.g. CS-25"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))] font-mono"
            />
            {errors.document_code && (
              <p className="mt-1 text-xs text-red-600">{errors.document_code.message}</p>
            )}
          </div>

          {/* title */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              {...register('title', { required: 'Title is required.' })}
              placeholder="e.g. Certification Specifications for Large Aeroplanes"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
            />
            {errors.title && (
              <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>
            )}
          </div>

          {/* category + authority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                Category
              </label>
              <input
                {...register('category')}
                placeholder="e.g. Airworthiness"
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                Authority
              </label>
              <input
                {...register('authority')}
                placeholder="e.g. EASA"
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
              />
            </div>
          </div>

          {/* description */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Description
            </label>
            <textarea
              {...register('description')}
              rows={3}
              placeholder="Brief description of this document's regulatory scope…"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))] resize-none"
            />
          </div>

          {/* watched */}
          <div className="flex items-center gap-3 py-2 px-3 bg-amber-50 border border-amber-200 rounded-lg">
            <input
              type="checkbox"
              id="doc_watched"
              {...register('watched')}
              className="h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-300"
            />
            <label htmlFor="doc_watched" className="text-sm font-medium text-amber-800">
              Add to watchlist — receive alerts when new versions are published
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[hsl(var(--primary))] text-white hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 disabled:opacity-60 flex items-center gap-2 min-w-[130px] justify-center"
            >
              {isSubmitting ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Create Document'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}