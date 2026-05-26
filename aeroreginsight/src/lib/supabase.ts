import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type DocumentSource = {
  id: string;
  source_type: string;
  source_name: string;
  document_group: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export type Document = {
  id: string;
  source_id: string;
  document_code: string;
  title: string;
  category: string | null;
  authority: string | null;
  watched: boolean;
  description: string | null;
  created_at: string;
  document_source?: DocumentSource;
};

export type DocumentVersion = {
  id: string;
  document_id: string;
  version_label: string;
  effective_date: string | null;
  publication_date: string | null;
  document_url: string | null;
  file_name: string | null;
  file_path: string | null;
  checksum_hash: string | null;
  uploaded_at: string;
  previous_version_id: string | null;
  status: string;
};

export type ChangeAnalysis = {
  id: string;
  old_version_id: string;
  new_version_id: string;
  summary_ai: string | null;
  changes_json: ChangeItem[] | null;
  impact_level: 'low' | 'medium' | 'high' | null;
  created_at: string;
};

export type ChangeItem = {
  section: string;
  change_type: 'added' | 'removed' | 'modified';
  summary: string;
  old_text: string;
  new_text: string;
};