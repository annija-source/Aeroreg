import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractTextFromPdf } from '@/lib/ai/pdfExtractor';

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

// ── POST /api/ai/compliance-gap ───────────────────────────────────────────────
// Body: { analysisId: number }
// Runs the full gap analysis for an already-created compliance_analysis row.
export async function POST(req: NextRequest) {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY is not configured.' }, { status: 500 });
  }

  const { analysisId } = await req.json();
  if (!analysisId) {
    return NextResponse.json({ error: 'analysisId is required.' }, { status: 400 });
  }

  const supabase = adminClient();

  // ── 1. Fetch the analysis row ────────────────────────────────────────────
  const { data: analysis, error: fetchErr } = await supabase
    .from('compliance_analysis')
    .select('*')
    .eq('id', analysisId)
    .single();

  if (fetchErr || !analysis) {
    return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  }

  // ── 2. Extract text from uploaded PDF ───────────────────────────────────
  await setStatus(analysisId, 'extracting');

  let procedureText = '';

  if (analysis.file_path) {
    const pdfResult = await extractTextFromPdf(analysis.file_path);
    if (pdfResult.extraction_success && pdfResult.text.length > 50) {
      procedureText = pdfResult.text;
    } else {
      await setStatus(analysisId, 'failed', {
        processing_error: pdfResult.extraction_error ?? 'Could not extract text from PDF.',
      });
      return NextResponse.json({ error: 'PDF extraction failed.' }, { status: 400 });
    }
  } else {
    await setStatus(analysisId, 'failed', {
      processing_error: 'No file path stored on this analysis.',
    });
    return NextResponse.json({ error: 'No file attached to this analysis.' }, { status: 400 });
  }

  // ── 3. Fetch stored regulations to check against ─────────────────────────
  await setStatus(analysisId, 'analysing');

  const { data: regulations } = await supabase
    .from('regulation')
    .select('id, regulation_number, title, authority, regulation_type')
    .order('regulation_number', { ascending: true })
    .limit(80); // stay within token limits

  if (!regulations || regulations.length === 0) {
    await setStatus(analysisId, 'failed', {
      processing_error:
        'No regulations found in the database. Upload and process regulatory documents first.',
    });
    return NextResponse.json({ error: 'No regulations in database.' }, { status: 400 });
  }

  const regulationList = regulations
    .map(
      (r) =>
        `- ${r.regulation_number}: ${r.title} (${r.authority ?? 'Unknown authority'})`
    )
    .join('\n');

  // ── 4. Call GPT-4o for gap analysis ──────────────────────────────────────
  const systemPrompt = `You are a senior aviation compliance auditor specialising in EASA and ICAO regulations.
You analyse aviation operators' procedures documents and identify compliance gaps against known regulatory requirements.
Always respond with valid JSON only — no markdown, no code fences, no extra text.`;

  const userPrompt = `You are auditing an aviation operator's procedures document against a set of known regulatory instruments.

KNOWN REGULATIONS IN THE DATABASE:
${regulationList}

OPERATOR PROCEDURES DOCUMENT (extracted text):
"""
${procedureText.slice(0, 12000)}
"""

For each regulation listed above, assess whether the operator's procedures document addresses it.

Return a JSON object with exactly this structure:
{
  "overall_score": <integer 0-100, overall compliance percentage>,
  "ai_summary": "<2-4 sentence executive summary of the compliance status, key risks, and top recommendation>",
  "gaps": [
    {
      "regulation_number": "<exact regulation number from the list>",
      "regulation_title": "<title>",
      "authority": "<authority>",
      "status": "compliant" | "gap" | "partial",
      "severity": "low" | "medium" | "high" | "critical",
      "gap_description": "<what is missing or insufficient — be specific, max 2 sentences. Empty string if compliant.>",
      "recommendation": "<what the operator should do to become compliant — max 2 sentences. Empty string if compliant.>",
      "affected_annexes": ["Annex I", "Part-CAT"]
    }
  ]
}

Status guidance:
- "compliant": The procedures document clearly addresses this regulation's requirements.
- "partial": Some requirements are addressed but gaps remain.
- "gap": The regulation is not addressed or is clearly insufficient.

Severity guidance (for gap/partial only):
- "critical": Safety-critical requirement, immediate action needed.
- "high": Significant compliance risk, action needed before next audit.
- "medium": Notable gap, should be addressed in near term.
- "low": Minor or administrative gap.

Be specific and practical. An auditor should be able to hand this report to a client.`;

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

    if (!raw) throw new Error('Empty AI response');

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI analysis failed';
    await setStatus(analysisId, 'failed', { processing_error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── 5. Store gap rows ─────────────────────────────────────────────────────
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

  // ── 6. Mark complete ──────────────────────────────────────────────────────
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
