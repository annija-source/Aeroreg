'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  ShieldX, Upload, Plus, Trash2,
  RefreshCw, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  FileText, BarChart3, Sparkles, X, ArrowLeft, User, Users, ChevronRight,
} from 'lucide-react';

const supabase = createClient();

type AnalysisStatus = 'pending' | 'extracting' | 'analysing' | 'complete' | 'failed';
type GapStatus = 'compliant' | 'gap' | 'partial';
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface ComplianceAnalysis {
  id: number;
  title: string;
  client_name: string | null;
  file_name: string | null;
  status: AnalysisStatus;
  processing_error: string | null;
  overall_score: number | null;
  total_regulations_checked: number | null;
  compliant_count: number | null;
  gap_count: number | null;
  partial_count: number | null;
  ai_summary: string | null;
  created_at: string;
  created_by: string | null;
  creator_name?: string;
}

interface ComplianceGap {
  id: number;
  regulation_number: string;
  regulation_title: string;
  authority: string | null;
  status: GapStatus;
  severity: Severity;
  gap_description: string;
  recommendation: string;
  affected_annexes: string[];
}

interface DocumentOption {
  id: string;
  title: string;
  document_code: string;
}

interface VersionOption {
  id: string;
  version_label: string;
  effective_date: string | null;
  file_path: string | null;
  status: string;
}

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  pending: 'Pending', extracting: 'Extracting...', analysing: 'Analysing...', complete: 'Complete', failed: 'Failed',
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const severityStyle: Record<Severity, string> = {
  critical: 'bg-red-50 text-red-700 border border-red-200',
  high: 'bg-orange-50 text-orange-700 border border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border border-amber-200',
  low: 'bg-slate-50 text-slate-600 border border-slate-200',
};

function scoreColor(score: number) {
  if (score >= 75) return { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: '#10b981' };
  if (score >= 50) return { bg: 'bg-amber-50', text: 'text-amber-700', ring: '#f59e0b' };
  return { bg: 'bg-red-50', text: 'text-red-700', ring: '#ef4444' };
}

function ScoreRing({ score }: { score: number }) {
  const r = 36; const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const { ring } = scoreColor(score);
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
      <circle cx="45" cy="45" r={r} fill="none" stroke={ring} strokeWidth="7"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 45 45)" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      <text x="45" y="42" textAnchor="middle" fontSize="18" fontWeight="700" fill={ring}>{score}</text>
      <text x="45" y="55" textAnchor="middle" fontSize="9" fill="#94a3b8">/ 100</text>
    </svg>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── New Analysis Modal ────────────────────────────────────────────────────────
function NewAnalysisModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Document version selection
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [loadingDocs, setLoadingDocs] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingDocs(true);
      const { data } = await supabase
        .from('document')
        .select('id, title, document_code')
        .order('title', { ascending: true });
      setDocuments(data ?? []);
      setLoadingDocs(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedDocId) { setVersions([]); setSelectedVersionId(''); return; }
    (async () => {
      const { data } = await supabase
        .from('document_version')
        .select('id, version_label, effective_date, file_path, status')
        .eq('document_id', selectedDocId)
        .order('effective_date', { ascending: false });
      setVersions(data ?? []);
      if (data && data.length > 0) setSelectedVersionId(String(data[0].id));
    })();
  }, [selectedDocId]);

  const selectedVersion = versions.find(v => String(v.id) === selectedVersionId);

  async function handleSubmit() {
    if (!title.trim() || !file) { toast.error('Please enter a title and upload a PDF.'); return; }
    if (!selectedVersionId) { toast.error('Please select a regulation version to check against.'); return; }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ext = file.name.split('.').pop();
      const filePath = `compliance/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('documents').upload(filePath, file, { contentType: file.type });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
      const { data: row, error: insertErr } = await supabase
        .from('compliance_analysis')
        .insert({
          title: title.trim(),
          client_name: clientName.trim() || null,
          file_name: file.name,
          file_path: filePath,
          status: 'pending',
          created_by: user?.id ?? null,
        })
        .select('id').single();
      if (insertErr || !row) throw new Error('Failed to create analysis record.');
      fetch('/api/ai/compliance-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: row.id, documentVersionId: selectedVersionId }),
      });
      toast.success('Analysis started!');
      onCreated(); onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally { setUploading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">New Compliance Analysis</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Analysis title *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. AirlineX Ops Manual Q2 2026"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Client name */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Client name</label>
            <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. AirlineX Ltd"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Regulation document */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Check against regulation *</label>
            {loadingDocs ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><RefreshCw size={12} className="animate-spin" /> Loading documents...</div>
            ) : documents.length === 0 ? (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">No documents found. Upload and process regulatory documents first.</p>
            ) : (
              <select value={selectedDocId} onChange={e => setSelectedDocId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">— Select regulation document —</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.title} {d.document_code ? `(${d.document_code})` : ''}</option>
                ))}
              </select>
            )}
          </div>

          {/* Version selection */}
          {selectedDocId && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Regulation version *</label>
              {versions.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">No versions found for this document.</p>
              ) : (
                <select value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {versions.map(v => (
                    <option key={v.id} value={String(v.id)}>
                      {v.version_label} {v.effective_date ? `— effective ${v.effective_date}` : ''} ({v.status})
                    </option>
                  ))}
                </select>
              )}
              {selectedVersion && (
                <p className="text-[11px] text-slate-400 mt-1.5 px-1">
                  {selectedVersion.file_path ? '✓ Has uploaded PDF — regulations will be extracted from it' : '⚠ No PDF uploaded for this version — will use stored regulations'}
                </p>
              )}
            </div>
          )}

          {/* PDF upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Client procedures document (PDF) *</label>
            <div onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-2 px-4 py-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-all">
              {file
                ? <><FileText size={22} className="text-blue-500" /><span className="text-sm font-medium text-slate-700">{file.name}</span></>
                : <><Upload size={22} className="text-slate-300" /><span className="text-sm text-slate-400">Click to upload client PDF</span></>}
            </div>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200">Cancel</button>
          <button onClick={handleSubmit} disabled={uploading || !selectedVersionId}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-60">
            {uploading ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {uploading ? 'Starting...' : 'Run Analysis'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Gap Row ───────────────────────────────────────────────────────────────────
function GapRow({ gap }: { gap: ComplianceGap }) {
  const [open, setOpen] = useState(false);
  const icon = gap.status === 'compliant'
    ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
    : gap.status === 'partial'
      ? <AlertTriangle size={16} className="text-amber-500 shrink-0" />
      : <ShieldX size={16} className="text-red-500 shrink-0" />;

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left">
        {icon}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-slate-800 truncate block">{gap.regulation_number}</span>
          <span className="text-xs text-slate-400 truncate block">{gap.regulation_title}</span>
        </div>
        {gap.status !== 'compliant' && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${severityStyle[gap.severity]}`}>{gap.severity}</span>
        )}
        {open ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
      </button>
      {open && gap.status !== 'compliant' && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3 bg-slate-50/50">
          {gap.gap_description && <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Gap identified</p>
            <p className="text-sm text-slate-700 leading-relaxed">{gap.gap_description}</p>
          </div>}
          {gap.recommendation && <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Recommendation</p>
            <p className="text-sm text-blue-700 leading-relaxed">{gap.recommendation}</p>
          </div>}
          {gap.affected_annexes?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {gap.affected_annexes.map(a => (
                <span key={a} className="text-[10px] font-medium px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100">{a}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Analysis Detail ───────────────────────────────────────────────────────────
function AnalysisDetail({ analysis, onBack, onDelete }: { analysis: ComplianceAnalysis; onBack: () => void; onDelete: () => void }) {
  const [gaps, setGaps] = useState<ComplianceGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<GapStatus | 'all'>('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('compliance_gap').select('*').eq('analysis_id', analysis.id);
      const sorted = (data ?? []).sort((a, b) => (SEVERITY_ORDER[a.severity as Severity] ?? 9) - (SEVERITY_ORDER[b.severity as Severity] ?? 9));
      setGaps(sorted);
      setLoading(false);
    })();
  }, [analysis.id]);

  const filtered = filter === 'all' ? gaps : gaps.filter(g => g.status === filter);

  async function handleDelete() {
    if (!confirm('Delete this analysis?')) return;
    await supabase.from('compliance_analysis').delete().eq('id', analysis.id);
    onDelete(); toast.success('Analysis deleted.');
  }

  const sc = analysis.overall_score && analysis.overall_score > 0 ? scoreColor(analysis.overall_score) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">{analysis.title}</h2>
            <div className="flex items-center gap-3 mt-0.5">
              {analysis.client_name && <span className="text-xs text-slate-400">{analysis.client_name}</span>}
              {analysis.client_name && <span className="text-slate-200">·</span>}
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <User size={11} /> {analysis.creator_name ?? 'Unknown user'}
              </span>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-slate-400">{formatDate(analysis.created_at)}</span>
            </div>
          </div>
        </div>
        <button onClick={handleDelete} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={15} /></button>
      </div>

      {analysis.status !== 'complete' ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center py-20">
          {analysis.status === 'failed'
            ? <><ShieldX size={36} className="text-red-400" /><p className="text-sm font-medium text-red-600">Analysis failed</p><p className="text-xs text-slate-400 max-w-xs">{analysis.processing_error}</p></>
            : <><RefreshCw size={32} className="text-blue-400 animate-spin" /><p className="text-sm font-medium text-slate-700">{STATUS_LABELS[analysis.status]}</p><p className="text-xs text-slate-400">Usually 30–60 seconds</p></>}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Score card */}
          <div className="flex gap-5 items-center bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            {sc && analysis.overall_score && analysis.overall_score > 0 && <ScoreRing score={analysis.overall_score} />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">AI Summary</p>
              <p className="text-sm text-slate-700 leading-relaxed">{analysis.ai_summary}</p>
              <div className="flex gap-4 mt-3 text-xs">
                <span className="flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle2 size={12} /> {analysis.compliant_count ?? 0} compliant</span>
                <span className="flex items-center gap-1 text-amber-600 font-semibold"><AlertTriangle size={12} /> {analysis.partial_count ?? 0} partial</span>
                <span className="flex items-center gap-1 text-red-600 font-semibold"><ShieldX size={12} /> {analysis.gap_count ?? 0} gaps</span>
              </div>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'gap', 'partial', 'compliant'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {f === 'all' ? `All (${gaps.length})` : f === 'gap' ? `Gaps (${gaps.filter(g => g.status === 'gap').length})` : f === 'partial' ? `Partial (${gaps.filter(g => g.status === 'partial').length})` : `Compliant (${gaps.filter(g => g.status === 'compliant').length})`}
              </button>
            ))}
          </div>

          {loading
            ? <div className="flex items-center gap-2 text-sm text-slate-400"><RefreshCw size={14} className="animate-spin" /> Loading...</div>
            : <div className="space-y-2">
                {filtered.map(gap => <GapRow key={gap.id} gap={gap} />)}
                {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No items in this category.</p>}
              </div>}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ComplianceGapClient() {
  const [analyses, setAnalyses] = useState<ComplianceAnalysis[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userProfiles, setUserProfiles] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<ComplianceAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Load current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const fetchAnalyses = useCallback(async () => {
    // Fetch analyses
    const { data } = await supabase
      .from('compliance_analysis')
      .select('*')
      .order('created_at', { ascending: false });

    const rows = data ?? [];

    // Fetch user profiles for all unique created_by values
    const userIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      if (profiles) {
        const map: Record<string, string> = {};
        profiles.forEach(p => { map[p.id] = p.full_name || p.email || 'Unknown'; });
        setUserProfiles(map);

        // Attach creator names to analyses
        const enriched = rows.map(r => ({
          ...r,
          creator_name: r.created_by ? (map[r.created_by] ?? 'Unknown') : 'Unknown',
        }));
        setAnalyses(enriched);
      } else {
        setAnalyses(rows);
      }
    } else {
      setAnalyses(rows);
    }

    setLoading(false);

    if (selected) {
      const updated = rows.find(a => a.id === selected.id);
      if (updated) setSelected({ ...updated, creator_name: userProfiles[updated.created_by ?? ''] ?? 'Unknown' });
    }
  }, [selected]);

  useEffect(() => { fetchAnalyses(); }, []);

  useEffect(() => {
    const running = analyses.some(a => ['pending', 'extracting', 'analysing'].includes(a.status));
    if (!running) return;
    const t = setInterval(fetchAnalyses, 5000);
    return () => clearInterval(t);
  }, [analyses, fetchAnalyses]);

  // Filter by current user unless showAll is true
  const filtered = showAll
    ? analyses
    : analyses.filter(a => a.created_by === currentUserId);

  const myCount = analyses.filter(a => a.created_by === currentUserId).length;
  const allCount = analyses.length;

  if (selected) {
    return (
      <AnalysisDetail
        analysis={selected}
        onBack={() => setSelected(null)}
        onDelete={() => { setSelected(null); fetchAnalyses(); }}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Compliance Gap Analysis</h1>
          <p className="text-sm text-slate-400 mt-1">Upload a client procedures document and AI checks it against all stored regulations</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm">
          <Plus size={16} /> New Analysis
        </button>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => setShowAll(false)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${!showAll ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          <User size={13} /> My analyses ({myCount})
        </button>
        <button
          onClick={() => setShowAll(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${showAll ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          <Users size={13} /> All users ({allCount})
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><RefreshCw size={14} className="animate-spin" /> Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 text-center py-24">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
            <BarChart3 size={28} className="text-blue-400" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-700">
              {showAll ? 'No analyses yet' : 'No analyses from you yet'}
            </p>
            <p className="text-sm text-slate-400 max-w-sm mt-1">
              {!showAll && allCount > 0
                ? <span>There are {allCount} analyses from other users. <button onClick={() => setShowAll(true)} className="text-blue-500 hover:underline">View all</button></span>
                : 'Upload a client operations manual to get started.'}
            </p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm">
            <Plus size={16} /> Start first analysis
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(a => {
            const isRunning = ['pending', 'extracting', 'analysing'].includes(a.status);
            const sc = a.overall_score && a.overall_score > 0 ? scoreColor(a.overall_score) : null;
            return (
              <button key={a.id} onClick={() => setSelected(a)}
                className="text-left bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md hover:border-blue-200 transition-all shadow-sm">

                {/* Title row */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{a.title}</p>
                    {a.client_name && <p className="text-xs text-slate-400 truncate mt-0.5">{a.client_name}</p>}
                  </div>
                  {/* Score badge */}
                  {sc && a.overall_score && a.overall_score > 0 && (
                    <span className={`shrink-0 text-sm font-bold px-2.5 py-1 rounded-xl ${sc.bg} ${sc.text}`}>
                      {a.overall_score}%
                    </span>
                  )}
                  {isRunning && <RefreshCw size={14} className="text-blue-400 animate-spin shrink-0 mt-1" />}
                </div>

                {/* Stats row */}
                {a.status === 'complete' && (
                  <div className="flex gap-3 text-xs mb-3">
                    <span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 size={11} /> {a.compliant_count ?? 0}</span>
                    <span className="flex items-center gap-1 text-amber-600 font-medium"><AlertTriangle size={11} /> {a.partial_count ?? 0}</span>
                    <span className="flex items-center gap-1 text-red-600 font-medium"><ShieldX size={11} /> {a.gap_count ?? 0} gaps</span>
                  </div>
                )}

                {/* Footer row — user + date */}
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-50">
                  <span className="flex items-center gap-1 text-[11px] text-slate-400">
                    <User size={10} /> {a.creator_name ?? 'Unknown'}
                  </span>
                  <span className="text-[11px] text-slate-300">{formatDate(a.created_at)}</span>
                </div>

                {/* Status */}
                <div className="mt-1">
                  <span className={`text-[11px] font-medium ${isRunning ? 'text-blue-500' : a.status === 'complete' ? 'text-emerald-500' : a.status === 'failed' ? 'text-red-500' : 'text-slate-400'}`}>
                    {STATUS_LABELS[a.status]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showModal && <NewAnalysisModal onClose={() => setShowModal(false)} onCreated={fetchAnalyses} />}
    </div>
  );
}
