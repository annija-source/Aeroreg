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

async function setStatus(analysisId: number, status: string, extra: Record<string, unknown> = {}) {
  await adminClient()
    .from('compliance_analysis')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('id', analysisId);
}

export async function POST(req: NextRequest) {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured.' }, { status: 500 });
  }

  let body: { analysisId?: number; documentVersionId?: string; clientText?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }

  const { analysisId, documentVersionId, clientText } = body;
  if (!analysisId) return NextResponse.json({ error: 'analysisId required.' }, { status: 400 });

  const supabase = adminClient();

  // Fetch analysis record
  const { data: analysis } = await supabase
    .from('compliance_analysis')
    .select('*')
    .eq('id', analysisId)
    .single();

  if (!analysis) {
    return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  }

  // Wrap everything — always set a final status
  try {
    // Save document_version_id to the analysis record immediately
    if (documentVersionId) {
      await adminClient()
        .from('compliance_analysis')
        .update({ document_version_id: Number(documentVersionId) })
        .eq('id', analysisId);
    }

    await setStatus(analysisId, 'analysing');

    // ── Get regulations ──────────────────────────────────────────────────────
    let regQuery = supabase
      .from('regulation')
      .select('regulation_number, title, authority')
      .order('regulation_number', { ascending: true })
      .limit(25);

    if (documentVersionId) {
      const { data: vr } = await supabase
        .from('regulation_version')
        .select('regulation_id')
        .eq('document_version_id', documentVersionId);
      if (vr && vr.length > 0) {
        const ids = vr.map((r: any) => r.regulation_id).filter(Boolean);
        regQuery = supabase
          .from('regulation')
          .select('regulation_number, title, authority')
          .in('id', ids)
          .order('regulation_number', { ascending: true })
          .limit(25);
      }
    }

    const { data: regulations } = await regQuery;

    if (!regulations || regulations.length === 0) {
      await setStatus(analysisId, 'failed', {
        processing_error: 'No regulations found. Extract regulations from a document version first.',
      });
      return NextResponse.json({ error: 'No regulations found.' }, { status: 400 });
    }

    const regulationList = regulations
      .map((r: any) => `- ${r.regulation_number}: ${r.title}`)
      .join('\n');

    const procedureText = (clientText && clientText.length > 50)
      ? clientText.slice(0, 3000)
      : `Document: ${analysis.file_name ?? 'unknown'}, Client: ${analysis.client_name ?? 'unknown'}`;

    // ── Single OpenAI call ───────────────────────────────────────────────────
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You are an aviation compliance auditor. Respond with valid JSON only, no markdown.',
          },
          {
            role: 'user',
            content: `Check this operator document against the regulations below. Look for SUBSTANCE not exact citation.

REGULATIONS:
${regulationList}

OPERATOR DOCUMENT:
"""
${procedureText}
"""

Return JSON:
{
  "overall_score": <0-100>,
  "ai_summary": "<2-3 sentences>",
  "gaps": [
    {
      "regulation_number": "<from list>",
      "regulation_title": "<title>",
      "authority": "<authority>",
      "status": "compliant"|"gap"|"partial",
      "severity": "low"|"medium"|"high"|"critical",
      "gap_description": "<what is missing, empty if compliant>",
      "recommendation": "<what to do, empty if compliant>",
      "affected_annexes": []
    }
  ]
}

Score 75-90 for comprehensive manuals. Only use "critical" for genuine safety absences.`,
          },
        ],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI error: ${err?.error?.message ?? response.statusText}`);
    }

    const data = await response.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? '';
    if (!raw) throw new Error('Empty AI response');

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    // ── Store gaps ───────────────────────────────────────────────────────────
    const gapRows = (parsed.gaps ?? []).map((g: any) => ({
      analysis_id: analysisId,
      regulation_number: g.regulation_number ?? '',
      regulation_title: g.regulation_title ?? '',
      authority: g.authority ?? null,
      status: g.status ?? 'gap',
      severity: g.severity ?? 'medium',
      gap_description: g.gap_description ?? '',
      recommendation: g.recommendation ?? '',
      affected_annexes: g.affected_annexes ?? [],
    }));

    if (gapRows.length > 0) {
      await supabase.from('compliance_gap').insert(gapRows);
    }

    const compliantCount = gapRows.filter((g: any) => g.status === 'compliant').length;
    const gapCount = gapRows.filter((g: any) => g.status === 'gap').length;
    const partialCount = gapRows.filter((g: any) => g.status === 'partial').length;

    await setStatus(analysisId, 'complete', {
      overall_score: parsed.overall_score ?? 0,
      ai_summary: parsed.ai_summary ?? '',
      total_regulations_checked: gapRows.length,
      compliant_count: compliantCount,
      gap_count: gapCount,
      partial_count: partialCount,
    });

    return NextResponse.json({ success: true, analysisId, overall_score: parsed.overall_score });

  } catch (err) {
    const msg = err instanceof Error
      ? (err.name === 'AbortError' ? 'Timed out — try again or reduce regulations.' : err.message)
      : 'Analysis failed.';
    // Always set failed status so UI doesn't hang
    await setStatus(analysisId, 'failed', { processing_error: msg }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
