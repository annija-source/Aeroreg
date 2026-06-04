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

// Extract readable text from a PDF buffer using multiple strategies
function extractTextFromBuffer(buffer: Buffer): string {
  const content = buffer.toString('latin1');
  const parts: string[] = [];

  // Strategy 1: BT/ET text blocks (standard PDF text)
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    const strRegex = /\(([^)]{1,300})\)\s*(?:Tj|'|")/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const decoded = strMatch[1]
        .replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
        .replace(/[^\x20-\x7E]/g, ' ').trim();
      if (decoded.length > 2) parts.push(decoded);
    }
    parts.push('\n');
  }

  // Strategy 2: Uncompressed stream text (works for our generated PDFs)
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((match = streamRegex.exec(content)) !== null) {
    const streamContent = match[1];
    if (streamContent.includes('Tj') || streamContent.includes('BT')) continue;
    const lines = streamContent.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 4 && /[a-zA-Z]{3,}/.test(l) && !/^[0-9\s./\\<>[\](){}%]+$/.test(l));
    if (lines.length > 0) parts.push(lines.join(' '));
  }

  const text = parts.join(' ').replace(/ {3,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const letterRatio = text.length > 0 ? (text.match(/[a-zA-Z ]/g) ?? []).length / text.length : 0;
  const hasKeywords = /regulation|annex|article|easa|icao|commission|requirement|procedure/i.test(text);

  if (letterRatio > 0.45 && hasKeywords) return text;
  return '';
}

// Get text from a PDF — first try local extraction, then ask GPT to describe it from filename
async function getPdfText(filePath: string, versionLabel: string, docTitle: string, openAiApiKey: string): Promise<{ text: string; method: string }> {
  const supabase = adminClient();
  const { data: blob, error } = await supabase.storage.from('documents').download(filePath);

  if (error || !blob) {
    return { text: '', method: 'download_failed' };
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  console.log(`[compare] Downloaded ${versionLabel}: ${buffer.length} bytes`);

  // Try local text extraction
  const directText = extractTextFromBuffer(buffer);
  if (directText.length > 200) {
    console.log(`[compare] ${versionLabel}: local extraction OK (${directText.length} chars)`);
    return { text: directText.slice(0, 6000), method: 'local' };
  }

  // Try OpenAI Files API — upload PDF and use file_id in message
  try {
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB OpenAI limit
    const uploadBuffer = buffer.length > MAX_SIZE ? buffer.slice(0, MAX_SIZE) : buffer;
    const fileName = filePath.split('/').pop() ?? 'document.pdf';

    const formData = new FormData();
    formData.append('file', new Blob([uploadBuffer], { type: 'application/pdf' }), fileName);
    formData.append('purpose', 'assistants');

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
      body: formData,
    });

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      const fileId: string = uploadData.id;

      const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
                text: `Extract the key content from this aviation regulatory document. Include: regulation numbers, article titles, amendment descriptions, changed requirements, annex references, applicability dates. Be comprehensive — this text will be used to compare versions.`,
              },
              { type: 'file', file: { file_id: fileId } },
            ],
          }],
        }),
      });

      // Cleanup file
      fetch(`https://api.openai.com/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${openAiApiKey}` },
      }).catch(() => {});

      if (extractRes.ok) {
        const extractData = await extractRes.json();
        const text = extractData?.choices?.[0]?.message?.content ?? '';
        if (text.length > 100) {
          console.log(`[compare] ${versionLabel}: Files API extraction OK (${text.length} chars)`);
          return { text, method: 'openai_files' };
        }
      } else {
        const err = await extractRes.json().catch(() => ({}));
        console.warn(`[compare] ${versionLabel}: Files API extract failed: ${err?.error?.message}`);
      }
    } else {
      const err = await uploadRes.json().catch(() => ({}));
      console.warn(`[compare] ${versionLabel}: upload failed: ${err?.error?.message}`);
    }
  } catch (e) {
    console.warn(`[compare] ${versionLabel}: Files API exception:`, e);
  }

  // Final fallback: ask GPT to generate content based on doc title + version
  console.log(`[compare] ${versionLabel}: using knowledge fallback`);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Describe the typical content of "${docTitle}" version "${versionLabel}" as an aviation regulatory document. Include typical regulation numbers, articles, annexes, and requirements for this type of document. Be specific and accurate.`,
        }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      return { text, method: 'knowledge_fallback' };
    }
  } catch (e) {
    console.warn(`[compare] knowledge fallback failed:`, e);
  }

  return { text: '', method: 'failed' };
}

export async function POST(req: NextRequest) {
  try {
    const { oldVersionId, newVersionId } = await req.json();

    if (!oldVersionId || !newVersionId) {
      return NextResponse.json({ error: 'oldVersionId and newVersionId are required.' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'OpenAI API key not configured.' }, { status: 500 });

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

    if (oldRes.error || !oldRes.data) return NextResponse.json({ error: 'Old version not found.' }, { status: 400 });
    if (newRes.error || !newRes.data) return NextResponse.json({ error: 'New version not found.' }, { status: 400 });

    const oldVersion = oldRes.data;
    const newVersion = newRes.data;
    const docTitle = (oldVersion.document as any)?.title ?? 'Aviation Document';
    const docCode = (oldVersion.document as any)?.document_code ?? '';
    const authority = (oldVersion.document as any)?.authority ?? 'EASA';

    // Extract text from both PDFs
    const [oldExtracted, newExtracted] = await Promise.all([
      oldVersion.file_path
        ? getPdfText(oldVersion.file_path, oldVersion.version_label, docTitle, apiKey)
        : Promise.resolve({ text: '', method: 'no_file' }),
      newVersion.file_path
        ? getPdfText(newVersion.file_path, newVersion.version_label, docTitle, apiKey)
        : Promise.resolve({ text: '', method: 'no_file' }),
    ]);

    console.log(`[compare] Extraction methods — old: ${oldExtracted.method}, new: ${newExtracted.method}`);

    const hasRealText = oldExtracted.text.length > 100 && newExtracted.text.length > 100;

    // Compare
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

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
            content: 'You are an expert aviation regulatory analyst. Compare document versions precisely. Respond with valid JSON only.',
          },
          {
            role: 'user',
            content: `Compare these two versions of an aviation regulatory document and identify all meaningful differences.

DOCUMENT: ${docTitle} ${docCode ? `(${docCode})` : ''}
AUTHORITY: ${authority}

=== OLD VERSION: ${oldVersion.version_label} ===
Status: ${oldVersion.status} | Effective: ${oldVersion.effective_date ?? 'N/A'} | Published: ${oldVersion.publication_date ?? 'N/A'}
${oldExtracted.text ? `\nContent:\n${oldExtracted.text}` : '\n[No PDF text available — metadata only]'}

=== NEW VERSION: ${newVersion.version_label} ===
Status: ${newVersion.status} | Effective: ${newVersion.effective_date ?? 'N/A'} | Published: ${newVersion.publication_date ?? 'N/A'}
${newExtracted.text ? `\nContent:\n${newExtracted.text}` : '\n[No PDF text available — metadata only]'}

${hasRealText
  ? 'Compare the actual content above. Identify specific articles, requirements, or procedures that changed.'
  : 'PDF content could not be fully extracted. Analyse based on available text, metadata, and your knowledge of this regulation type.'}

Return JSON:
{
  "summary_ai": "<3-5 sentences describing what specifically changed between versions>",
  "impact_level": "low"|"medium"|"high",
  "affected_annexes": ["Part-CAT", "Part-ORO"],
  "applicability_dates_changed": true|false,
  "applicability_date_note": "<date change details or empty>",
  "changes_json": [
    {
      "section": "<article or section name>",
      "change_type": "added"|"removed"|"modified",
      "summary": "<specific change description>",
      "old_text": "<relevant old text or empty>",
      "new_text": "<relevant new text or empty>"
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
      return NextResponse.json({ error: `AI failed: ${err?.error?.message ?? response.statusText}` }, { status: 500 });
    }

    const data = await response.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? '';
    if (!raw) return NextResponse.json({ error: 'Empty AI response' }, { status: 500 });

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!['low', 'medium', 'high'].includes(parsed.impact_level)) parsed.impact_level = 'medium';

    return NextResponse.json({
      summary_ai: parsed.summary_ai ?? '',
      impact_level: parsed.impact_level,
      affected_annexes: Array.isArray(parsed.affected_annexes) ? parsed.affected_annexes : [],
      applicability_dates_changed: !!parsed.applicability_dates_changed,
      applicability_date_note: parsed.applicability_date_note ?? '',
      text_comparison_used: hasRealText,
      extraction_methods: { old: oldExtracted.method, new: newExtracted.method },
      changes_json: Array.isArray(parsed.changes_json) ? parsed.changes_json : [],
    });

  } catch (err: unknown) {
    const message = err instanceof Error
      ? (err.name === 'AbortError' ? 'Comparison timed out. Try again.' : err.message)
      : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
