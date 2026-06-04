import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function adminClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Download PDF from Supabase Storage and extract text via OpenAI
async function extractPdfTextViaOpenAI(
  filePath: string,
  openAiApiKey: string,
  label: string
): Promise<string> {
  console.log(`[compare] Extracting text from ${label}: ${filePath}`);

  const supabase = adminClient();
  const { data: blob, error } = await supabase.storage.from('documents').download(filePath);
  if (error || !blob) {
    console.warn(`[compare] Failed to download ${label}: ${error?.message}`);
    return '';
  }

  let buffer = Buffer.from(await blob.arrayBuffer());
  console.log(`[compare] Downloaded ${label}: ${buffer.length} bytes`);

  // Validate text quality first with regex
  const rawText = buffer.toString('latin1');
  const btEtMatches = rawText.match(/BT([\s\S]*?)ET/g) ?? [];
  let directText = '';
  for (const block of btEtMatches) {
    const matches = block.match(/\(([^)]{1,200})\)\s*(?:Tj|'|")/g) ?? [];
    for (const m of matches) {
      const t = m.replace(/\(([^)]*)\)\s*(?:Tj|'|")/, '$1').replace(/[^\x20-\x7E]/g, ' ').trim();
      if (t.length > 1) directText += t + ' ';
    }
  }
  const letterRatio = directText.length > 0
    ? (directText.match(/[a-zA-Z ]/g) ?? []).length / directText.length
    : 0;
  const hasKeywords = /regulation|annex|article|easa|icao|commission/i.test(directText);

  if (directText.length > 500 && letterRatio > 0.5 && hasKeywords) {
    console.log(`[compare] ${label}: direct extraction OK (${directText.length} chars)`);
    return directText.slice(0, 8000);
  }

  // Fall back to OpenAI — trim to 3MB first
  if (buffer.length > 3 * 1024 * 1024) {
    buffer = buffer.slice(0, 3 * 1024 * 1024);
  }
  const base64 = buffer.toString('base64');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract the text content from this aviation regulatory document PDF. 
Focus on: regulation numbers, article titles, amendment summaries, annex names, 
applicability dates, and key procedural requirements. 
Return only the extracted text, preserving structure.`,
            },
            { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } },
          ],
        }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      if (text.length > 100) {
        console.log(`[compare] ${label}: OpenAI extraction OK (${text.length} chars)`);
        return text;
      }
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn(`[compare] ${label}: OpenAI extraction failed: ${err?.error?.message}`);
    }
  } catch (e) {
    console.warn(`[compare] ${label}: OpenAI exception:`, e);
  }

  return '';
}

export async function POST(req: NextRequest) {
  try {
    const { oldVersionId, newVersionId } = await req.json();

    if (!oldVersionId || !newVersionId) {
      return NextResponse.json({ error: 'oldVersionId and newVersionId are required.' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured.' }, { status: 500 });
    }

    const supabase = adminClient();

    // Fetch both versions
    const [oldRes, newRes] = await Promise.all([
      supabase.from('document_version')
        .select('*, document:document(title, document_code, category, authority)')
        .eq('id', oldVersionId).single(),
      supabase.from('document_version')
        .select('*, document:document(title, document_code, category, authority)')
        .eq('id', newVersionId).single(),
    ]);

    if (oldRes.error || !oldRes.data) {
      return NextResponse.json({ error: `Old version not found: ${oldRes.error?.message}` }, { status: 400 });
    }
    if (newRes.error || !newRes.data) {
      return NextResponse.json({ error: `New version not found: ${newRes.error?.message}` }, { status: 400 });
    }

    const oldVersion = oldRes.data;
    const newVersion = newRes.data;
    const docTitle = (oldVersion.document as any)?.title ?? 'Unknown document';
    const docCode = (oldVersion.document as any)?.document_code ?? '';
    const authority = (oldVersion.document as any)?.authority ?? 'EASA';

    // Extract text from both PDFs in parallel
    const [oldText, newText] = await Promise.all([
      oldVersion.file_path ? extractPdfTextViaOpenAI(oldVersion.file_path, apiKey, `v${oldVersion.version_label}`) : Promise.resolve(''),
      newVersion.file_path ? extractPdfTextViaOpenAI(newVersion.file_path, apiKey, `v${newVersion.version_label}`) : Promise.resolve(''),
    ]);

    const hasOldText = oldText.length > 100;
    const hasNewText = newText.length > 100;

    console.log(`[compare] Text extracted — old: ${oldText.length} chars, new: ${newText.length} chars`);

    // Build comparison prompt
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let comparisonPrompt: string;

    if (hasOldText && hasNewText) {
      comparisonPrompt = `You are an expert aviation regulatory analyst. Compare these two versions of "${docTitle}" and identify all meaningful differences.

DOCUMENT: ${docTitle} ${docCode ? `(${docCode})` : ''}
AUTHORITY: ${authority}

=== OLD VERSION: ${oldVersion.version_label} ===
Effective: ${oldVersion.effective_date ?? 'N/A'}
Status: ${oldVersion.status}

${oldText.slice(0, 5000)}

=== NEW VERSION: ${newVersion.version_label} ===
Effective: ${newVersion.effective_date ?? 'N/A'}
Status: ${newVersion.status}

${newText.slice(0, 5000)}

Analyse the actual content differences between these two versions. Look for:
- New or removed regulations/articles
- Changed requirements or procedures
- Updated applicability dates
- Modified annex references
- New definitions or amendments`;
    } else {
      comparisonPrompt = `You are an expert aviation regulatory analyst. Compare these two versions of "${docTitle}".

DOCUMENT: ${docTitle} ${docCode ? `(${docCode})` : ''}
AUTHORITY: ${authority}

OLD VERSION: ${oldVersion.version_label}
- Status: ${oldVersion.status}
- Effective: ${oldVersion.effective_date ?? 'N/A'}
- Publication: ${oldVersion.publication_date ?? 'N/A'}
${!hasOldText ? '- PDF text could not be extracted' : `- Content preview: ${oldText.slice(0, 1000)}`}

NEW VERSION: ${newVersion.version_label}
- Status: ${newVersion.status}
- Effective: ${newVersion.effective_date ?? 'N/A'}
- Publication: ${newVersion.publication_date ?? 'N/A'}
${!hasNewText ? '- PDF text could not be extracted' : `- Content preview: ${newText.slice(0, 1000)}`}

Note: ${!hasOldText && !hasNewText ? 'PDF text could not be extracted for either version. Base analysis on metadata only.' : 'Partial text available. Supplement with knowledge of this regulation type.'}`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You are an expert aviation regulatory analyst. Always respond with valid JSON only, no markdown.',
          },
          {
            role: 'user',
            content: `${comparisonPrompt}

Return a JSON object with exactly this structure:
{
  "summary_ai": "<3-5 sentence summary of key differences between the versions, or what changed operationally>",
  "impact_level": "low" | "medium" | "high",
  "affected_annexes": ["Part-CAT", "Part-ORO"],
  "applicability_dates_changed": true | false,
  "applicability_date_note": "<note about date changes or empty string>",
  "text_comparison_used": ${hasOldText && hasNewText},
  "changes_json": [
    {
      "section": "<section or article name>",
      "change_type": "added" | "removed" | "modified",
      "summary": "<what changed>",
      "old_text": "<relevant old content or empty>",
      "new_text": "<relevant new content or empty>"
    }
  ]
}`,
          },
        ],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json({ error: `AI comparison failed: ${err?.error?.message ?? response.statusText}` }, { status: 500 });
    }

    const data = await response.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? '';
    if (!raw) {
      return NextResponse.json({ error: 'Empty AI response' }, { status: 500 });
    }

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const validImpact = ['low', 'medium', 'high'];
    if (!validImpact.includes(parsed.impact_level)) parsed.impact_level = 'medium';

    return NextResponse.json({
      summary_ai: parsed.summary_ai ?? '',
      impact_level: parsed.impact_level,
      affected_annexes: Array.isArray(parsed.affected_annexes) ? parsed.affected_annexes : [],
      applicability_dates_changed: !!parsed.applicability_dates_changed,
      applicability_date_note: parsed.applicability_date_note ?? '',
      text_comparison_used: !!(hasOldText && hasNewText),
      changes_json: Array.isArray(parsed.changes_json) ? parsed.changes_json : [],
    });

  } catch (err: unknown) {
    const message = err instanceof Error
      ? (err.name === 'AbortError' ? 'Comparison timed out. Try again.' : err.message)
      : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
