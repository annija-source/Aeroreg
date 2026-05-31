import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function adminClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Pure Node.js PDF text extractor — no browser APIs needed
function extractTextFromPdfBuffer(buffer: Buffer): string {
  const content = buffer.toString('binary');
  const textParts: string[] = [];

  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    const strRegex = /\(([^)]*)\)\s*(?:Tj|'|")|(\[([^\]]*)\])\s*TJ/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      if (strMatch[1] !== undefined) {
        const decoded = strMatch[1]
          .replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E]/g, ' ');
        if (decoded.trim().length > 0) textParts.push(decoded);
      } else if (strMatch[3] !== undefined) {
        const arrStrRegex = /\(([^)]*)\)/g;
        let arrMatch;
        while ((arrMatch = arrStrRegex.exec(strMatch[3])) !== null) {
          const decoded = arrMatch[1]
            .replace(/\\n/g, ' ').replace(/\\r/g, ' ')
            .replace(/\\\(/g, '(').replace(/\\\)/g, ')')
            .replace(/[^\x20-\x7E]/g, ' ');
          if (decoded.trim().length > 0) textParts.push(decoded);
        }
      }
    }
    textParts.push('\n');
  }

  return textParts.join(' ').replace(/ {3,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function getPdfText(filePath: string | null): Promise<string> {
  if (!filePath) return '';
  try {
    const supabase = adminClient();
    const { data: blob, error } = await supabase.storage.from('documents').download(filePath);
    if (error || !blob) return '';
    const buffer = Buffer.from(await blob.arrayBuffer());
    return extractTextFromPdfBuffer(buffer);
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  try {
    const { oldVersionId, newVersionId } = await req.json();

    if (!oldVersionId || !newVersionId) {
      return NextResponse.json({ error: 'oldVersionId and newVersionId are required.' }, { status: 400 });
    }

    const supabase = adminClient();

    // Fetch both versions with document info
    const [oldRes, newRes] = await Promise.all([
      supabase.from('document_version')
        .select('*, document:document(title, document_code, category, authority, description)')
        .eq('id', oldVersionId).single(),
      supabase.from('document_version')
        .select('*, document:document(title, document_code, category, authority, description)')
        .eq('id', newVersionId).single(),
    ]);

    if (oldRes.error || !oldRes.data) {
      return NextResponse.json({ error: `Failed to fetch old version: ${oldRes.error?.message ?? 'Not found'}` }, { status: 400 });
    }
    if (newRes.error || !newRes.data) {
      return NextResponse.json({ error: `Failed to fetch new version: ${newRes.error?.message ?? 'Not found'}` }, { status: 400 });
    }

    const oldVersion = oldRes.data;
    const newVersion = newRes.data;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is not configured.' }, { status: 400 });
    }

    // Extract actual PDF text from both versions
    const [oldText, newText] = await Promise.all([
      getPdfText(oldVersion.file_path ?? null),
      getPdfText(newVersion.file_path ?? null),
    ]);

    const hasOldText = oldText.length > 100;
    const hasNewText = newText.length > 100;

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

Document: ${oldVersion.document?.title ?? 'Unknown'} (${oldVersion.document?.document_code ?? ''})
Category: ${oldVersion.document?.category ?? 'N/A'}
Authority: ${oldVersion.document?.authority ?? 'N/A'}

OLD VERSION (${oldVersion.version_label}):
- Status: ${oldVersion.status}
- Effective Date: ${oldVersion.effective_date ?? 'N/A'}
- Publication Date: ${oldVersion.publication_date ?? 'N/A'}
${hasOldText ? `- Document text:\n"""\n${oldText.slice(0, 6000)}\n"""` : '- Document text: not available'}

NEW VERSION (${newVersion.version_label}):
- Status: ${newVersion.status}
- Effective Date: ${newVersion.effective_date ?? 'N/A'}
- Publication Date: ${newVersion.publication_date ?? 'N/A'}
${hasNewText ? `- Document text:\n"""\n${newText.slice(0, 6000)}\n"""` : '- Document text: not available'}

${hasOldText && hasNewText
  ? 'Compare the actual document text above to identify specific section-by-section changes, added or removed requirements, and modified procedures.'
  : 'Document text could not be extracted. Base your analysis on the metadata, version labels, dates, status changes, and document category/authority. Infer which annexes are likely affected based on the document category.'}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    const rawContent: string = data?.choices?.[0]?.message?.content ?? '';

    if (!rawContent) {
      return NextResponse.json({ error: 'AI returned an empty response.' }, { status: 500 });
    }

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
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response as JSON.', raw: rawContent }, { status: 500 });
    }

    const validImpact = ['low', 'medium', 'high'];
    if (!validImpact.includes(parsed.impact_level)) parsed.impact_level = 'medium';

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
