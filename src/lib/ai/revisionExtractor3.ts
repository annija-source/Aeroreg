'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface ExtractedRevision {
  revision_label: string;
  publication_date: string | null;
  revision_summary: string | null;
}

export interface RevisionExtractionResult {
  success: boolean;
  revisions: ExtractedRevision[];
  error?: string;
  stored: {
    document_revision_ids: number[];
  };
  debug: {
    raw_response_length: number;
    parsed_json_success: boolean;
    extracted_count: number;
  };
}

const REVISION_EXTRACTION_SYSTEM_PROMPT = `You are an expert in EASA aviation regulatory documents such as "Easy Access Rules".
Your task is to extract the document's own publication revision history — NOT Commission Regulation history.

Look for a revision table or list that tracks the document's own publication history, typically found near the beginning of the document under headings like:
- "Revision History", "Document Revision History", "List of Revisions", "Amendment History", "Publication History"

Each entry typically looks like:
- "Revision 23", "Rev 23", "Revision 22", "Amendment 9", "Issue 3"

For each revision entry found, extract:
- revision_label: The revision identifier exactly as written (e.g. "Revision 23", "Rev 22", "Amendment 9")
- publication_date: ISO date string (YYYY-MM-DD) if a date is associated with this revision, null otherwise
- revision_summary: A brief description of what changed in this revision if available (e.g. "Initial Issue", "Incorporated ED Decision 2022/011/R"), null if not available

IMPORTANT RULES:
- Only extract document publication revisions (e.g. Revision 23, Revision 22, Rev 21)
- Do NOT extract Commission Regulation numbers (e.g. EU 965/2012, Commission Regulation (EU) No 379/2014)
- Do NOT extract AMC/GM amendment references as revisions
- If no revision history table is found, return an empty array []

Return a JSON array of revision objects. Only return valid JSON, no markdown, no explanation.`;

export async function extractAndStoreRevisions(
  documentText: string,
  documentVersionId: number,
  documentId: number,
  openAiApiKey: string
): Promise<RevisionExtractionResult> {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const stored = {
    document_revision_ids: [] as number[],
  };

  const debug = {
    raw_response_length: 0,
    parsed_json_success: false,
    extracted_count: 0,
  };

  try {
    // Call OpenAI to extract revision history
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: REVISION_EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Extract the document publication revision history from the following EASA document text. Focus on the revision/amendment table near the beginning of the document:\n\n${documentText.slice(0, 10000)}`,
          },
        ],
        max_tokens: 2048,
      }),
    });

    if (!aiRes.ok) {
      const errData = await aiRes.json().catch(() => ({}));
      return {
        success: false,
        revisions: [],
        error: `OpenAI API error: ${errData?.error?.message ?? aiRes.statusText}`,
        stored,
        debug,
      };
    }

    const aiData = await aiRes.json();
    const rawContent: string = aiData?.choices?.[0]?.message?.content ?? '[]';

    // Log raw AI response before parsing
    console.log('[revisionExtractor] Raw AI response length:', rawContent.length);
    console.log('[revisionExtractor] Raw AI response preview:', rawContent.slice(0, 500));

    debug.raw_response_length = rawContent.length;

    let revisions: ExtractedRevision[] = [];
    try {
      const cleaned = rawContent.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      revisions = JSON.parse(cleaned);
      if (!Array.isArray(revisions)) revisions = [];
      debug.parsed_json_success = true;
    } catch (parseErr) {
      const parseErrMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error('[revisionExtractor] JSON parse failed:', parseErrMsg);
      console.error('[revisionExtractor] Raw response preview:', rawContent.slice(0, 300));
      return {
        success: false,
        revisions: [],
        error: `AI returned invalid JSON for revision extraction — parse error: ${parseErrMsg}`,
        stored,
        debug: { ...debug, parsed_json_success: false },
      };
    }

    debug.extracted_count = revisions.length;

    if (revisions.length === 0) {
      return { success: true, revisions: [], stored, debug };
    }

    // Store each revision in document_revision table
    for (const rev of revisions) {
      if (!rev.revision_label?.trim()) continue;

      // Check if this revision already exists for this document
      const { data: existing } = await supabase
        .from('document_revision')
        .select('id')
        .eq('document_id', documentId)
        .eq('revision_label', rev.revision_label.trim())
        .maybeSingle();

      if (existing) {
        // Already stored — skip to avoid duplicates
        stored.document_revision_ids.push(existing.id);
        continue;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('document_revision')
        .insert({
          document_id: documentId,
          revision_label: rev.revision_label.trim(),
          publication_date: rev.publication_date ?? null,
          revision_summary: rev.revision_summary ?? null,
          document_version_id: documentVersionId,
        })
        .select('id')
        .single();

      if (insertError || !inserted) continue;
      stored.document_revision_ids.push(inserted.id);
    }

    return { success: true, revisions, stored, debug };
  } catch (err) {
    return {
      success: false,
      revisions: [],
      error: err instanceof Error ? err.message : 'Unknown revision extraction error',
      stored,
      debug,
    };
  }
}
