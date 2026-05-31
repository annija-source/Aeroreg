import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { completion } from '@rocketnew/llm-sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { oldVersionId, newVersionId } = await req.json();

    if (!oldVersionId || !newVersionId) {
      return NextResponse.json(
        { error: 'oldVersionId and newVersionId are required.' },
        { status: 400 }
      );
    }

    // Fetch both versions with document info
    const [oldRes, newRes] = await Promise.all([
      supabase
        .from('document_version')
        .select('*, document:document(title, document_code, category, authority, description)')
        .eq('id', oldVersionId)
        .single(),
      supabase
        .from('document_version')
        .select('*, document:document(title, document_code, category, authority, description)')
        .eq('id', newVersionId)
        .single(),
    ]);

    if (oldRes.error || !oldRes.data) {
      return NextResponse.json(
        { error: `Failed to fetch old version: ${oldRes.error?.message ?? 'Not found'}` },
        { status: 400 }
      );
    }
    if (newRes.error || !newRes.data) {
      return NextResponse.json(
        { error: `Failed to fetch new version: ${newRes.error?.message ?? 'Not found'}` },
        { status: 400 }
      );
    }

    const oldVersion = oldRes.data;
    const newVersion = newRes.data;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is not configured.' },
        { status: 400 }
      );
    }

    const systemPrompt = `You are an aviation regulatory document analysis expert specializing in ICAO/EASA standards, annexes, and compliance requirements.
Your task is to analyze differences between two versions of a regulatory document and produce a structured comparison report.
Always respond with valid JSON only — no markdown, no code fences, no extra text.`;

    const userPrompt = `Compare these two versions of a regulatory document and return a JSON object with exactly these fields:

{
  "summary_ai": "A concise 2-4 sentence summary of the key changes between the versions, mentioning what changed operationally or legally",
  "impact_level": "low" | "medium" | "high",
  "affected_annexes": ["Annex I", "Annex II"],
  "applicability_dates_changed": true | false,
  "applicability_date_note": "Brief note about date changes if applicable, or empty string",
  "changes_json": [
    {
      "section": "Section name or identifier",
      "change_type": "added" | "removed" | "modified",
      "summary": "Brief description of the change",
      "old_text": "Relevant old content (empty string if added)",
      "new_text": "Relevant new content (empty string if removed)"
    }
  ]
}

Impact level guidance:
- "low": Minor editorial, formatting, or clarification changes with no operational impact
- "medium": Procedural updates, revised requirements, or changes affecting specific operations
- "high": Major regulatory changes, new mandatory requirements, or safety-critical updates

Affected annexes guidance:
- List ICAO Annexes (e.g. "Annex 1", "Annex 6", "Annex 8") or EASA Parts (e.g. "Part-FCL", "Part-M") that are impacted
- If no specific annexes can be determined from the metadata, return an empty array []

Applicability dates guidance:
- Set applicability_dates_changed to true if effective_date or publication_date changed between versions
- Provide a brief human-readable note about the date change in applicability_date_note

Document: ${oldVersion.document?.title ?? 'Unknown'} (${oldVersion.document?.document_code ?? ''})
Category: ${oldVersion.document?.category ?? 'N/A'}
Authority: ${oldVersion.document?.authority ?? 'N/A'}
Description: ${oldVersion.document?.description ?? 'N/A'}

OLD VERSION (${oldVersion.version_label}):
- Status: ${oldVersion.status}
- Effective Date: ${oldVersion.effective_date ?? 'N/A'}
- Publication Date: ${oldVersion.publication_date ?? 'N/A'}
- File: ${oldVersion.file_name ?? 'N/A'}

NEW VERSION (${newVersion.version_label}):
- Status: ${newVersion.status}
- Effective Date: ${newVersion.effective_date ?? 'N/A'}
- Publication Date: ${newVersion.publication_date ?? 'N/A'}
- File: ${newVersion.file_name ?? 'N/A'}

Based on the version metadata, labels, dates, status changes, and document category/authority, generate a realistic and meaningful comparison analysis. If the versions differ only in metadata, focus on what those metadata changes imply for compliance and operations. For aviation documents, infer which annexes are likely affected based on the document category and authority.`;

    // Call the LLM SDK directly (same as chat-completion/route.ts)
    const aiResponse = await completion({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      api_key: apiKey,
      max_completion_tokens: 2000,
      temperature: 1,
    });

    const rawContent: string = (aiResponse as any)?.choices?.[0]?.message?.content ?? '';

    if (!rawContent) {
      return NextResponse.json(
        { error: 'AI returned an empty response.' },
        { status: 500 }
      );
    }

    // Parse the JSON from AI response
    let parsed: {
      summary_ai: string;
      impact_level: 'low' | 'medium' | 'high';
      affected_annexes: string[];
      applicability_dates_changed: boolean;
      applicability_date_note: string;
      changes_json: Array<{
        section: string;
        change_type: 'added' | 'removed' | 'modified';
        summary: string;
        old_text: string;
        new_text: string;
      }>;
    };

    try {
      // Strip any accidental markdown fences
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse AI response as JSON.', raw: rawContent },
        { status: 500 }
      );
    }

    // Validate impact_level
    const validImpact = ['low', 'medium', 'high'];
    if (!validImpact.includes(parsed.impact_level)) {
      parsed.impact_level = 'medium';
    }

    return NextResponse.json({
      summary_ai: parsed.summary_ai ?? '',
      impact_level: parsed.impact_level,
      affected_annexes: Array.isArray(parsed.affected_annexes) ? parsed.affected_annexes : [],
      applicability_dates_changed: !!parsed.applicability_dates_changed,
      applicability_date_note: parsed.applicability_date_note ?? '',
      changes_json: Array.isArray(parsed.changes_json) ? parsed.changes_json : [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
