'use client';
import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { supabase, DocumentSource } from '@/lib/supabase';
import { toast } from 'sonner';
import { X } from 'lucide-react';

type FormValues = {
  source_type: string;
  source_name: string;
  document_group: string;
  notes: string;
  is_active: boolean;
};

export default function SourceFormModal({
  source,
  onClose,
  onSaved,
}: {
  source: DocumentSource | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!source;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      source_type: '',
      source_name: '',
      document_group: '',
      notes: '',
      is_active: true,
    },
  });

  useEffect(() => {
    if (source) {
      reset({
        source_type: source.source_type,
        source_name: source.source_name,
        document_group: source.document_group ?? '',
        notes: source.notes ?? '',
        is_active: source.is_active,
      });
    }
  }, [source, reset]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      source_type: values.source_type.trim(),
      source_name: values.source_name.trim(),
      document_group: values.document_group.trim() || null,
      notes: values.notes.trim() || null,
      is_active: values.is_active,
    };

    if (isEdit && source) {
      // Backend integration: update document_source
      const { error } = await supabase
        .from('document_source')
        .update(payload)
        .eq('id', source.id);
      if (error) {
        toast.error(`Failed to update source: ${error.message}`);
        return;
      }
      toast.success('Source updated successfully.');
    } else {
      // Backend integration: insert document_source
      const { error } = await supabase.from('document_source').insert(payload);
      if (error) {
        toast.error(`Failed to create source: ${error.message}`);
        return;
      }
      toast.success('Source created successfully.');
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-[hsl(var(--border))] w-full max-w-lg mx-4 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
            {isEdit ? 'Edit Source' : 'Add New Source'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {/* source_type */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Source Type <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              Category of the issuing authority (e.g. EASA, FAA, ICAO).
            </p>
            <input
              {...register('source_type', { required: 'Source type is required.' })}
              placeholder="e.g. Regulatory Authority"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
            />
            {errors.source_type && (
              <p className="mt-1 text-xs text-red-600">{errors.source_type.message}</p>
            )}
          </div>

          {/* source_name */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Source Name <span className="text-red-500">*</span>
            </label>
            <input
              {...register('source_name', { required: 'Source name is required.' })}
              placeholder="e.g. European Union Aviation Safety Agency"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
            />
            {errors.source_name && (
              <p className="mt-1 text-xs text-red-600">{errors.source_name.message}</p>
            )}
          </div>

          {/* document_group */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Document Group
            </label>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
              Logical grouping for this source (e.g. Airworthiness, Operations).
            </p>
            <input
              {...register('document_group')}
              placeholder="e.g. Airworthiness Directives"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))]"
            />
          </div>

          {/* notes */}
          <div>
            <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
              Notes
            </label>
            <textarea
              {...register('notes')}
              rows={3}
              placeholder="Optional notes about this source…"
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all placeholder:text-[hsl(var(--muted-foreground))] resize-none"
            />
          </div>

          {/* is_active */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_active"
              {...register('is_active')}
              className="h-4 w-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary)/0.3)]"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-[hsl(var(--foreground))]">
              Active source
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-[hsl(var(--border))] mt-2">
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
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[hsl(var(--primary))] text-white hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 disabled:opacity-60 flex items-center gap-2 min-w-[120px] justify-center"
            >
              {isSubmitting ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Create Source'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}