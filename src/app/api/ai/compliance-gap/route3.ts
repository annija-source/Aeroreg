import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function adminClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function setStatus(
  analysisId: number,
  status: string,
  extra: Record<string, unknown> = {}
) {
  await adminClient()
    .from('compliance_analysis')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('id', analysisId);
}

// Pure Node.js PDF text extractor — no browser APIs needed
// Parses raw PDF binary and extracts text from stream objects
function extractTextFromPdfBuffer(buffer: Buffer): string {
  const content = buffer.toString('binary');
  const textParts: string[] = [];

  // Extract text from BT...ET blocks (PDF text objects)
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    // Extract strings from Tj, TJ, ' and " operators
    const strRegex = /\(([^)]*)\)\s*(?:Tj|'|")|(\[([^\]]*)\])\s*TJ/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      if (strMatch[1] !== undefined) {
        // Simple string from Tj
        const decoded = strMatch[1]
          .replace(/\\n/g, ' ')
          .replace(/\\r/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E]/g, ' ');
        if (decoded.trim().length > 0) textParts.push(decoded);
      } else if (strMatch[3] !== undefined) {
        // Array string from TJ
        const arrayContent = strMatch[3];
        const arrStrRegex = /\(([^)]*)\)/g;
        let arrMatch;
        while ((arrMatch = arrStrRegex.exec(arrayContent)) !== null) {
          const decoded = arrMatch[1]
            .replace(/\\n/g, ' ')
            .replace(/\\r/g, ' ')
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/[^\x20-\x7E]/g, ' ');
          if (decoded.trim().length > 0) textParts.push(decoded);
        }
      }
    }
    textParts.push('\n');
  }

  return textParts
    .join(' ')
    .replace(/ {3,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfText(filePath: string): Promise<{ text: string; error?: string }> {
  const supabase = adminClient();

  const { data: blob, error } = await supabase.storage
    .from('documents')
    .download(filePath);

  if (error || !blob) {
    return { text: '', error: error?.message ?? 'Failed to download file from storage.' };
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = extractTextFromPdfBuffer(buffer);

    if (text.length < 50) {
      return { text: '', error: 'Could not extract enough text from PDF. The file may be scanned/image-based.' };
    }
    return { text };
  } catch (err) {
    return { text: '', error: err instanceof Error ? err.message : 'PDF extraction failed.' };
  }
}

export async function POST(req: NextRequest) {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY is not configured.' }, { status: 500 });
  }

  let body: { analysisId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { analysisId } = body;
  if (!analysisId) {
    return NextResponse.json({ error: 'analysisId is required.' }, { status: 400 });
  }

  const supabase = adminClient();

  const { data: analysis, error: fetchErr } = await supabase
    .from('compliance_analysis')
    .select('*')
    .eq('id', analysisId)
    .single();

  if (fetchErr || !analysis) {
    return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  }

  await setStatus(analysisId, 'extracting');

  if (!analysis.file_path) {
    await setStatus(analysisId, 'failed', { processing_error: 'No file path on this analysis record.' });
    return NextResponse.json({ error: 'No file attached.' }, { status: 400 });
  }

  const { text: procedureText, error: pdfError } = await extractPdfText(analysis.file_path);

  if (!procedureText) {
    await setStatus(analysisId, 'failed', { processing_error: pdfError ?? 'PDF extraction failed.' });
    return NextResponse.json({ error: pdfError ?? 'PDF extraction failed.' }, { status: 400 });
  }

  await setStatus(analysisId, 'analysing');

  const { data: regulations } = await supabase
    .from('regulation')
    .select('id, regulation_number, title, authority, regulation_type')
    .order('regulation_number', { ascending: true })
    .limit(80);

  if (!regulations || regulations.length === 0) {
    await setStatus(analysisId, 'failed', {
      processing_error: 'No regulations in database. Upload and process regulatory documents first.',
    });
    return NextResponse.json({ error: 'No regulations in database.' }, { status: 400 });
  }

  const regulationList = regulations
    .map((r) => `- ${r.regulation_number}: ${r.title} (${r.authority ?? 'Unknown authority'})`)
    .join('\n');

  const systemPrompt = `You are a senior aviation compliance auditor specialising in EASA and ICAO regulations.
You analyse aviation operators' procedures documents and identify compliance gaps against known regulatory requirements.
Always respond with valid JSON only — no markdown, no code fences, no extra text.`;

  const userPrompt = `You are auditing an aviation operator's procedures document against EASA regulations.

IMPORTANT ASSESSMENT GUIDANCE:
- A regulation is "compliant" if the operator's document addresses the SUBJECT MATTER of that regulation, even if the exact regulation number is not cited. For example, if the document describes fuel planning procedures, it is compliant with CAT.OP.MPA.150 (Fuel Policy) even without citing that number.
- A regulation is "partial" if some but not all key requirements are addressed.
- A regulation is "gap" only if the subject matter is genuinely absent or clearly insufficient.
- Most well-written operations manuals will be largely compliant. Do NOT mark everything as a gap.
- Severity should be "critical" only for genuine safety-critical absences (no emergency procedures, no airworthiness). Use "high", "medium", or "low" for most gaps.
- An operator that has documented: organisation, crew licensing, FTL, SMS, fuel, ground ops, cabin crew, dangerous goods, security, emergency response, and maintenance is HIGHLY COMPLIANT and should score 75-90%.

KNOWN REGULATIONS IN THE DATABASE:
${regulationList}

OPERATOR PROCEDURES DOCUMENT (extracted text):
"""
${procedureText.slice(0, 12000)}
"""

Assess each regulation above. Look for the SUBSTANCE of the requirement being addressed, not just the regulation number being cited.

Return a JSON object with exactly this structure:
{
  "overall_score": <integer 0-100, reflecting genuine compliance level>,
  "ai_summary": "<2-4 sentence executive summary of compliance status>",
  "gaps": [
    {
      "regulation_number": "<exact number from the list above>",
      "regulation_title": "<title>",
      "authority": "<authority>",
      "status": "compliant" | "gap" | "partial",
      "severity": "low" | "medium" | "high" | "critical",
      "gap_description": "<specific gap — empty string if compliant>",
      "recommendation": "<action to take — empty string if compliant>",
      "affected_annexes": ["Annex I", "Part-CAT"]
    }
  ]
}`;

  let parsed: {
    overall_score: number;
    ai_summary: string;
    gaps: Array<{
      regulation_number: string;
      regulation_title: string;
      authority: string;
      status: 'compliant' | 'gap' | 'partial';
      severity: string;
      gap_description: string;
      recommendation: string;
      affected_annexes: string[];
    }>;
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4000,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? '';

    if (!raw) throw new Error('Empty AI response — check OPENAI_API_KEY and quota.');

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI analysis failed.';
    await setStatus(analysisId, 'failed', { processing_error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const regulationMap = new Map(regulations.map((r) => [r.regulation_number, r.id]));

  const gapRows = parsed.gaps.map((g) => ({
    analysis_id: analysisId,
    regulation_id: regulationMap.get(g.regulation_number) ?? null,
    regulation_number: g.regulation_number,
    regulation_title: g.regulation_title,
    authority: g.authority ?? null,
    status: g.status,
    severity: g.severity ?? 'medium',
    gap_description: g.gap_description ?? '',
    recommendation: g.recommendation ?? '',
    affected_annexes: g.affected_annexes ?? [],
  }));

  if (gapRows.length > 0) {
    await supabase.from('compliance_gap').insert(gapRows);
  }

  const compliantCount = parsed.gaps.filter((g) => g.status === 'compliant').length;
  const gapCount = parsed.gaps.filter((g) => g.status === 'gap').length;
  const partialCount = parsed.gaps.filter((g) => g.status === 'partial').length;

  await setStatus(analysisId, 'complete', {
    overall_score: parsed.overall_score ?? 0,
    ai_summary: parsed.ai_summary ?? '',
    total_regulations_checked: parsed.gaps.length,
    compliant_count: compliantCount,
    gap_count: gapCount,
    partial_count: partialCount,
  });

  return NextResponse.json({
    success: true,
    analysisId,
    overall_score: parsed.overall_score,
    total: parsed.gaps.length,
    compliant: compliantCount,
    gaps: gapCount,
    partial: partialCount,
  });
}
