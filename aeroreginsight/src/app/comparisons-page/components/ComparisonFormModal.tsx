'use client';
import React, { useEffect, useState } from 'react';
import { supabase, Document, DocumentVersion, ChangeItem } from '@/lib/supabase';
import { X, GitCompare, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface AiResult {
  summary_ai: string;
  impact_level: 'low' | 'medium' | 'high';
  changes_json: ChangeItem[];
  affected_annexes: string[];
  applicability_dates_changed: boolean;
  applicability_date_note: string;
}

const IMPACT_COLORS: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  added: 'bg-emerald-100 text-emerald-700',
  removed: 'bg-red-100 text-red-700',
  modified: 'bg-blue-100 text-blue-700',
};

export default function ComparisonFormModal({ open, onClose, onSaved }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [oldVersionId, setOldVersionId] = useState('');
  const [newVersionId, setNewVersionId] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [expandedChange, setExpandedChange] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedDocId('');
    setOldVersionId('');
    setNewVersionId('');
    setVersions([]);
    setAiResult(null);
    setExpandedChange(null);
    fetchDocuments();
  }, [open]);

  // Reset AI result when versions change
  useEffect(() => {
    setAiResult(null);
    setExpandedChange(null);
  }, [oldVersionId, newVersionId]);

  const fetchDocuments = async () => {
    setLoadingDocs(true);
    const { data, error } = await supabase
      .from('document')
      .select('*')
      .order('title', { ascending: true });
    if (error) {
      toast.error(`Failed to load documents: ${error.message}`);
    } else {
      setDocuments(data ?? []);
    }
    setLoadingDocs(false);
  };

  const fetchVersions = async (docId: string) => {
    setLoadingVersions(true);
    setOldVersionId('');
    setNewVersionId('');
    const { data, error } = await supabase
      .from('document_version')
      .select('*')
      .eq('document_id', docId)
      .order('uploaded_at', { ascending: false });
    if (error) {
      toast.error(`Failed to load versions: ${error.message}`);
    } else {
      setVersions(data ?? []);
    }
    setLoadingVersions(false);
  };

  const handleDocChange = (docId: string) => {
    setSelectedDocId(docId);
    if (docId) fetchVersions(docId);
    else setVersions([]);
  };

  const handleGenerate = async () => {
    if (!oldVersionId || !newVersionId) {
      toast.error('Please select both old and new versions.');
      return;
    }
    if (oldVersionId === newVersionId) {
      toast.error('Old and new versions must be different.');
      return;
    }

    setGenerating(true);
    setAiResult(null);

    try {
      const res = await fetch('/api/ai/compare-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldVersionId, newVersionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? 'Failed to generate comparison.');
        return;
      }

      setAiResult(data as AiResult);
      toast.success('AI analysis complete.');
    } catch {
      toast.error('Network error while generating comparison.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!aiResult) return;

    setSaving(true);
    const { error } = await supabase.from('change_analysis').insert({
      old_version_id: Number(oldVersionId),
      new_version_id: Number(newVersionId),
      impact_level: aiResult.impact_level,
      summary_ai: aiResult.summary_ai,
      changes_json: aiResult.changes_json,
      affected_annexes: aiResult.affected_annexes ?? [],
      applicability_dates_changed: aiResult.applicability_dates_changed ?? false,
      applicability_date_note: aiResult.applicability_date_note ?? '',
    });
    setSaving(false);

    if (error) {
      toast.error(`Failed to save comparison: ${error.message}`);
    } else {
      toast.success('Comparison saved successfully.');
      onSaved();
      onClose();
    }
  };

  const canGenerate = !!oldVersionId && !!newVersionId && oldVersionId !== newVersionId;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-[hsl(var(--border))] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] flex-shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-[hsl(var(--primary))]" />
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">New Comparison</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Document */}
          <div>
            <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
              Document
            </label>
            <select
              value={selectedDocId}
              onChange={(e) => handleDocChange(e.target.value)}
              disabled={loadingDocs || generating}
              className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all disabled:opacity-60"
            >
              <option value="">{loadingDocs ? 'Loading…' : 'Select a document'}</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} ({doc.document_code})
                </option>
              ))}
            </select>
          </div>

          {/* Version selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                Old Version
              </label>
              <select
                value={oldVersionId}
                onChange={(e) => setOldVersionId(e.target.value)}
                disabled={!selectedDocId || loadingVersions || generating}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all disabled:opacity-60"
              >
                <option value="">{loadingVersions ? 'Loading…' : 'Select old version'}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.version_label} — {v.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                New Version
              </label>
              <select
                value={newVersionId}
                onChange={(e) => setNewVersionId(e.target.value)}
                disabled={!selectedDocId || loadingVersions || generating}
                className="w-full px-3 py-2 text-sm border border-[hsl(var(--border))] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)] focus:border-[hsl(var(--primary))] transition-all disabled:opacity-60"
              >
                <option value="">{loadingVersions ? 'Loading…' : 'Select new version'}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.version_label} — {v.status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Generate Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-[0.99] transition-all duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Analyzing with AI…
              </>
            ) : (
              <>
                <Sparkles size={15} />
                Generate Comparison
              </>
            )}
          </button>

          {/* AI Results */}
          {aiResult && (
            <div className="space-y-4 pt-1">
              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[hsl(var(--border))]" />
                <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider flex items-center gap-1">
                  <Sparkles size={11} /> AI Analysis
                </span>
                <div className="flex-1 h-px bg-[hsl(var(--border))]" />
              </div>

              {/* Impact Level */}
              <div>
                <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                  Impact Level
                </p>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
                    IMPACT_COLORS[aiResult.impact_level] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                  }`}
                >
                  {aiResult.impact_level.charAt(0).toUpperCase() + aiResult.impact_level.slice(1)}
                </span>
              </div>

              {/* Summary */}
              <div>
                <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
                  Summary
                </p>
                <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed bg-[hsl(var(--muted)/0.4)] rounded-lg p-3 border border-[hsl(var(--border))]">
                  {aiResult.summary_ai}
                </p>
              </div>

              {/* Changes */}
              {aiResult.changes_json.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                    Changes ({aiResult.changes_json.length})
                  </p>
                  <div className="space-y-2">
                    {aiResult.changes_json.map((change, idx) => (
                      <div
                        key={idx}
                        className="border border-[hsl(var(--border))] rounded-lg overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedChange(expandedChange === idx ? null : idx)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`flex-shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                CHANGE_TYPE_COLORS[change.change_type] ?? 'bg-gray-100 text-gray-600'
                              }`}
                            >
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
                            <p className="text-xs text-[hsl(var(--foreground))] pt-2 leading-relaxed">
                              {change.summary}
                            </p>
                            {(change.old_text || change.new_text) && (
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                {change.old_text && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-red-600 uppercase mb-1">Before</p>
                                    <p className="text-xs text-[hsl(var(--muted-foreground))] bg-red-50 rounded p-2 leading-relaxed">
                                      {change.old_text}
                                    </p>
                                  </div>
                                )}
                                {change.new_text && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">After</p>
                                    <p className="text-xs text-[hsl(var(--muted-foreground))] bg-emerald-50 rounded p-2 leading-relaxed">
                                      {change.new_text}
                                    </p>
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
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[hsl(var(--border))] flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={generating || saving}
            className="px-4 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] rounded-lg transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!aiResult || saving || generating}
            className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white text-sm font-medium rounded-lg hover:bg-[hsl(214,83%,22%)] active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save Comparison'}
          </button>
        </div>
      </div>
    </div>
  );
}
