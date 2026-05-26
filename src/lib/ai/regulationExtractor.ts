'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface ExtractedRegulation {
  regulation_number: string;
  regulation_type: string;
  title: string;
  affected_annexes: string[];
  applicability_date: string | null;
  applicability_note: string | null;
  related_document_revision: string | null;
  raw_extracted_text: string;
}

export interface ExtractionResult {
  success: boolean;
  regulations: ExtractedRegulation[];
  error?: string;
  stored: {
    regulation_ids: number[];
    regulation_version_ids: number[];
    regulation_annex_ids: number[];
  };
  diagnostics: {
    totalExtracted: number;
    totalInserted: number;
    totalFailed: number;
    errors: string[];
  };
  debug: {
    raw_response_length: number;
    parsed_json_success: boolean;
    extracted_count: number;
  };
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert in EASA Air Operations regulatory documents.
Your task is to extract ONLY regulation-level instruments from document text.

Extract ONLY these entity types:
- Commission Regulation (e.g. "Commission Regulation (EU) No 965/2012", "Commission Regulation (EU) 2019/1384")
- Implementing Regulation (e.g. "Commission Implementing Regulation (EU) 2015/640")
- Delegated Regulation (e.g. "Commission Delegated Regulation (EU) 2019/945")
- Corrigendum (e.g. "Corrigendum to Regulation (EU) No 965/2012")
- ED Decision (e.g. "ED Decision 2012/018/R", "ED Decision 2019/019/R") — include only if clearly identified

DO NOT extract:
- Individual rule codes like CAT.OP.MPA.100, ORO.GEN.110, SPA.HOFO.100, NCC.OP.230, NCO.OP.190, SPO.OP.230, ARO.GEN.120
- AMC paragraphs (e.g. AMC1 CAT.OP.MPA.100, AMC2 ORO.GEN.110)
- GM paragraphs (e.g. GM1 CAT.OP.MPA.100)
- CS (Certification Specifications) entries
- Individual annex section headings without a regulation number

For each regulation-level instrument found, extract:
- regulation_number: The official regulation number (e.g. "EU 965/2012", "EU 2019/1384", "ED Decision 2012/018/R")
- regulation_type: One of "Commission Regulation", "Implementing Regulation", "Delegated Regulation", "Corrigendum", "ED Decision"
- title: The full official title of the regulation
- affected_annexes: Array of annex codes affected (e.g. ["Annex I", "Annex II", "Part-CAT", "Part-ORO", "Part-SPA", "Part-NCC", "Part-NCO", "Part-SPO", "Part-ARO"])
- applicability_date: ISO date string (YYYY-MM-DD) if found, null otherwise
- applicability_note: Any note about applicability scope or conditions, null if none
- related_document_revision: The document revision/amendment reference if mentioned (e.g. "Amendment 9", "Rev 3"), null if not found
- raw_extracted_text: The original text row/paragraph from which this was extracted

Return a JSON array of regulation objects. If no regulation-level instruments are found, return an empty array [].
Only return valid JSON, no markdown, no explanation.`;

/**
 * Priority section keywords — chunks containing these are processed first.
 */
const PRIORITY_KEYWORDS = [
  'incorporated amendment',
  'commission regulation',
  'implementing regulation',
  'delegated regulation',
  'corrigendum',
  'ed decision',
  'affected annex',
  'applicability date',
  'rule amendment',
  'summary of change',
  'amendment',
  'annex i',
  'annex ii',
  'annex iii',
  'annex iv',
  'annex v',
  'annex vi',
  'annex vii',
  'part-cat',
  'part-oro',
  'part-spa',
  'part-ncc',
  'part-nco',
  'part-spo',
  'part-aro',
  'applicability',
  'regulation (eu)',
  'eu 965',
];

const CHUNK_SIZE = 12000;
const CHUNK_OVERLAP = 500;
const MAX_CHUNKS = 20; // safety cap — prevents runaway API calls on huge docs

/**
 * Split text into overlapping chunks of ~CHUNK_SIZE characters.
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Score a chunk by how many priority keywords it contains (case-insensitive).
 */
function scoreChunk(chunk: string): number {
  const lower = chunk.toLowerCase();
  return PRIORITY_KEYWORDS.reduce((score, kw) => score + (lower.includes(kw) ? 1 : 0), 0);
}

/**
 * Call OpenAI on a single text chunk and return parsed regulations.
 */
async function extractFromChunk(
  chunk: string,
  openAiApiKey: string,
  chunkIndex: number
): Promise<{ regulations: ExtractedRegulation[]; rawLength: number; parseSuccess: boolean; error?: string }> {
  const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Extract all regulations from the following EASA Air Operations document text:\n\n${chunk}`,
        },
      ],
      max_tokens: 4096,
    }),
  });

  if (!aiRes.ok) {
    const errData = await aiRes.json().catch(() => ({}));
    return {
      regulations: [],
      rawLength: 0,
      parseSuccess: false,
      error: `OpenAI API error on chunk ${chunkIndex}: ${errData?.error?.message ?? aiRes.statusText}`,
    };
  }

  const aiData = await aiRes.json();
  const rawContent: string = aiData?.choices?.[0]?.message?.content ?? '[]';

  console.log(`[regulationExtractor] Chunk ${chunkIndex} — raw response length: ${rawContent.length}`);
  console.log(`[regulationExtractor] Chunk ${chunkIndex} — preview: ${rawContent.slice(0, 300)}`);

  try {
    const cleaned = rawContent.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    let parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) parsed = [];
    return { regulations: parsed, rawLength: rawContent.length, parseSuccess: true };
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[regulationExtractor] Chunk ${chunkIndex} — JSON parse failed: ${msg}`);
    console.error(`[regulationExtractor] Chunk ${chunkIndex} — raw preview: ${rawContent.slice(0, 300)}`);
    return { regulations: [], rawLength: rawContent.length, parseSuccess: false, error: `Chunk ${chunkIndex} parse error: ${msg}` };
  }
}

/**
 * Deduplicate regulations by regulation_number, keeping the first occurrence.
 */
function deduplicateRegulations(regs: ExtractedRegulation[]): ExtractedRegulation[] {
  const seen = new Set<string>();
  return regs.filter((r) => {
    if (!r.regulation_number || seen.has(r.regulation_number)) return false;
    seen.add(r.regulation_number);
    return true;
  });
}

/**
 * Allowed regulation types for regulation-level extraction.
 */
const ALLOWED_REGULATION_TYPES = new Set([
  'commission regulation',
  'implementing regulation',
  'delegated regulation',
  'corrigendum',
  'ed decision',
]);

/**
 * Patterns that identify rule-level entries to be excluded.
 * Matches: CAT.OP.MPA.100, ORO.GEN.110, AMC1 CAT..., GM1 ORO..., etc.
 */
const RULE_LEVEL_PATTERN =
  /^(AMC|GM|CS|IR|CAT\.|ORO\.|SPA\.|NCC\.|NCO\.|SPO\.|ARO\.|FCL\.|MED\.|CC\.|ATCO\.)/i;

/**
 * Filter out rule-level entries, keeping only regulation-level instruments.
 */
function filterRegulationLevelOnly(regs: ExtractedRegulation[]): ExtractedRegulation[] {
  return regs.filter((r) => {
    const num = (r.regulation_number ?? '').trim();
    const type = (r.regulation_type ?? '').toLowerCase().trim();

    // Exclude if regulation_number matches a rule-level pattern
    if (RULE_LEVEL_PATTERN.test(num)) {
      console.log(`[regulationExtractor] Excluded rule-level entry: "${num}"`);
      return false;
    }

    // Exclude if regulation_type is not in the allowed set
    if (type && !ALLOWED_REGULATION_TYPES.has(type)) {
      // Allow entries whose type contains an allowed keyword (e.g. "EU Regulation" → not allowed, but "Commission Regulation" → allowed)
      const typeMatchesAllowed = [...ALLOWED_REGULATION_TYPES].some((allowed) => type.includes(allowed));
      if (!typeMatchesAllowed) {
        console.log(`[regulationExtractor] Excluded non-regulation-level type: "${r.regulation_type}" (number: "${num}")`);
        return false;
      }
    }

    return true;
  });
}

export async function extractAndStoreRegulations(
  documentText: string,
  documentVersionId: number,
  documentId: number,
  openAiApiKey: string
): Promise<ExtractionResult> {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const stored = {
    regulation_ids: [] as number[],
    regulation_version_ids: [] as number[],
    regulation_annex_ids: [] as number[],
  };

  const diagnostics = {
    totalExtracted: 0,
    totalInserted: 0,
    totalFailed: 0,
    errors: [] as string[],
  };

  const debug = {
    raw_response_length: 0,
    parsed_json_success: false,
    extracted_count: 0,
  };

  try {
    // ── Step 1: Chunk the full document and prioritise relevant sections ──────
    const allChunks = chunkText(documentText);
    console.log(`[regulationExtractor] Total chunks: ${allChunks.length} (doc length: ${documentText.length})`);

    // Sort chunks: highest priority score first, then original order
    const scoredChunks = allChunks
      .map((chunk, idx) => ({ chunk, idx, score: scoreChunk(chunk) }))
      .sort((a, b) => b.score - a.score || a.idx - b.idx);

    // Cap total chunks processed to avoid runaway API usage
    const chunksToProcess = scoredChunks.slice(0, MAX_CHUNKS);
    console.log(`[regulationExtractor] Processing ${chunksToProcess.length} chunks (capped at ${MAX_CHUNKS})`);

    // ── Step 2: Extract regulations from each chunk ───────────────────────────
    const allExtracted: ExtractedRegulation[] = [];
    let totalRawLength = 0;
    let allParseSuccess = true;

    for (const { chunk, idx } of chunksToProcess) {
      const result = await extractFromChunk(chunk, openAiApiKey, idx);
      totalRawLength += result.rawLength;
      if (!result.parseSuccess) {
        allParseSuccess = false;
        if (result.error) diagnostics.errors.push(result.error);
      }
      allExtracted.push(...result.regulations);
    }

    debug.raw_response_length = totalRawLength;
    debug.parsed_json_success = allParseSuccess;

    // ── Step 3: Deduplicate across chunks ─────────────────────────────────────
    const deduped = deduplicateRegulations(allExtracted);

    // ── Step 4: Filter to regulation-level entities only ──────────────────────
    const regulations = filterRegulationLevelOnly(deduped);
    console.log(
      `[regulationExtractor] After filter — regulation-level only: ${regulations.length} (from ${deduped.length} deduped, ${allExtracted.length} raw)`
    );

    debug.extracted_count = regulations.length;
    diagnostics.totalExtracted = regulations.length;

    console.log(`[regulationExtractor] Total extracted (pre-dedup): ${allExtracted.length}, post-dedup: ${deduped.length}, post-filter: ${regulations.length}`);

    if (regulations.length === 0) {
      return { success: true, regulations: [], stored, diagnostics, debug };
    }

    // Step 2: Fetch all annexes for matching
    const { data: allAnnexes } = await supabase
      .from('annex')
      .select('id, annex_code, part_code, annex_title');

    const annexMap = new Map<string, number>();
    for (const a of allAnnexes ?? []) {
      if (a.annex_code) annexMap.set(a.annex_code.toLowerCase().trim(), a.id);
      if (a.part_code) annexMap.set(a.part_code.toLowerCase().trim(), a.id);
    }

    /**
     * Resolve an annex value (possibly combined like "Annex II (Part-ARO)") to
     * one or more annex IDs. Returns an array of matched IDs (may be empty).
     */
    function resolveAnnexIds(rawValue: string): number[] {
      const normalized = rawValue.trim().replace(/\s+/g, ' ');
      const matched = new Set<number>();

      // Try direct match first (handles plain "Annex II" or "Part-ARO")
      const directId = annexMap.get(normalized.toLowerCase());
      if (directId) {
        matched.add(directId);
        return [...matched];
      }

      // Split combined value — e.g. "Annex II (Part-ARO)" → ["Annex II", "Part-ARO"]
      // Pattern: capture text before parentheses and text inside parentheses
      const combinedMatch = normalized.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
      if (combinedMatch) {
        const beforeParen = combinedMatch[1].trim();
        const insideParen = combinedMatch[2].trim();

        const id1 = annexMap.get(beforeParen.toLowerCase());
        if (id1) matched.add(id1);

        const id2 = annexMap.get(insideParen.toLowerCase());
        if (id2) matched.add(id2);

        if (matched.size > 0) return [...matched];
      }

      // Fallback: try splitting on common delimiters (comma, slash, semicolon)
      const parts = normalized.split(/[,/;]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        for (const part of parts) {
          const id = annexMap.get(part.toLowerCase());
          if (id) matched.add(id);
        }
        if (matched.size > 0) return [...matched];
      }

      // No match found — log for diagnostics
      console.warn(`[regulationExtractor] Unmatched annex value: "${rawValue}" (normalized: "${normalized}")`);
      return [];
    }

    // Step 3: Process each extracted regulation
    for (const reg of regulations) {
      if (!reg.regulation_number) {
        diagnostics.totalFailed++;
        diagnostics.errors.push(`Skipped regulation with missing regulation_number`);
        continue;
      }

      // Upsert regulation row (reuse if regulation_number already exists)
      const { data: existingReg } = await supabase
        .from('regulation')
        .select('id')
        .eq('regulation_number', reg.regulation_number)
        .maybeSingle();

      let regulationId: number;

      if (existingReg) {
        regulationId = existingReg.id;
      } else {
        const { data: newReg, error: regError } = await supabase
          .from('regulation')
          .insert({
            regulation_number: reg.regulation_number,
            regulation_type: reg.regulation_type ?? 'Unknown',
            title: reg.title ?? reg.regulation_number,
            short_label: reg.regulation_number,
            authority: 'EASA',
            related_document_id: documentId,
            source_document_version_id: documentVersionId,
          })
          .select('id')
          .single();

        if (regError || !newReg) {
          const msg = `Failed to insert regulation "${reg.regulation_number}": ${regError?.message ?? 'no data returned'}`;
          console.error('[regulationExtractor]', msg, regError);
          diagnostics.totalFailed++;
          diagnostics.errors.push(msg);
          continue;
        }
        regulationId = newReg.id;
      }

      stored.regulation_ids.push(regulationId);

      // Find or create document_revision if related_document_revision is present
      let documentRevisionId: number | null = null;
      if (reg.related_document_revision) {
        const { data: existingRevision } = await supabase
          .from('document_revision')
          .select('id')
          .eq('document_id', documentId)
          .eq('revision_label', reg.related_document_revision)
          .maybeSingle();

        if (existingRevision) {
          documentRevisionId = existingRevision.id;
        } else {
          const { data: newRevision, error: revisionError } = await supabase
            .from('document_revision')
            .insert({
              document_id: documentId,
              revision_label: reg.related_document_revision,
              document_version_id: documentVersionId,
            })
            .select('id')
            .single();

          if (revisionError || !newRevision) {
            const msg = `Failed to insert document_revision "${reg.related_document_revision}" for regulation "${reg.regulation_number}": ${revisionError?.message ?? 'no data returned'}`;
            console.error('[regulationExtractor]', msg, revisionError);
            diagnostics.errors.push(msg);
            // Non-critical: continue without documentRevisionId
          } else {
            documentRevisionId = newRevision.id;
          }
        }
      }

      // Create a new regulation_version for this document_version
      const { data: existingRegVersion } = await supabase
        .from('regulation_version')
        .select('id')
        .eq('regulation_id', regulationId)
        .eq('document_version_id', documentVersionId)
        .maybeSingle();

      let regulationVersionId: number;

      if (existingRegVersion) {
        // Update existing row instead of inserting a duplicate
        const { data: updatedRegVersion, error: rvUpdateError } = await supabase
          .from('regulation_version')
          .update({
            document_revision_id: documentRevisionId,
            applicability_date: reg.applicability_date ?? null,
            applicability_note: reg.applicability_note ?? null,
            status: 'active',
            raw_extracted_text: reg.raw_extracted_text ?? null,
          })
          .eq('id', existingRegVersion.id)
          .select('id')
          .single();

        if (rvUpdateError || !updatedRegVersion) {
          const msg = `Failed to update regulation_version for regulation "${reg.regulation_number}" (regulation_id=${regulationId}): ${rvUpdateError?.message ?? 'no data returned'}`;
          console.error('[regulationExtractor]', msg, rvUpdateError);
          diagnostics.totalFailed++;
          diagnostics.errors.push(msg);
          continue;
        }

        regulationVersionId = updatedRegVersion.id;
        console.log(`[regulationExtractor] Updated existing regulation_version id=${regulationVersionId} for regulation "${reg.regulation_number}"`);
      } else {
        const { data: newRegVersion, error: rvError } = await supabase
          .from('regulation_version')
          .insert({
            regulation_id: regulationId,
            document_version_id: documentVersionId,
            document_revision_id: documentRevisionId,
            applicability_date: reg.applicability_date ?? null,
            applicability_note: reg.applicability_note ?? null,
            status: 'active',
            raw_extracted_text: reg.raw_extracted_text ?? null,
          })
          .select('id')
          .single();

        if (rvError || !newRegVersion) {
          const msg = `Failed to insert regulation_version for regulation "${reg.regulation_number}" (regulation_id=${regulationId}): ${rvError?.message ?? 'no data returned'}`;
          console.error('[regulationExtractor]', msg, rvError);
          diagnostics.totalFailed++;
          diagnostics.errors.push(msg);
          continue;
        }

        regulationVersionId = newRegVersion.id;
      }

      stored.regulation_version_ids.push(regulationVersionId);

      // Link all affected annexes through regulation_annex
      const annexCodes = reg.affected_annexes ?? [];
      for (const code of annexCodes) {
        const resolvedIds = resolveAnnexIds(code);

        if (resolvedIds.length === 0) {
          const msg = `Annex value "${code}" could not be matched to any annex in the annex table for regulation "${reg.regulation_number}" — skipping link`;
          console.warn('[regulationExtractor]', msg);
          diagnostics.errors.push(msg);
          continue;
        }

        for (const annexId of resolvedIds) {
          // Check for existing regulation_annex link before inserting
          const { data: existingRA } = await supabase
            .from('regulation_annex')
            .select('id')
            .eq('regulation_version_id', regulationVersionId)
            .eq('annex_id', annexId)
            .maybeSingle();

          if (existingRA) {
            stored.regulation_annex_ids.push(existingRA.id);
            continue;
          }

          const { data: newRA, error: raError } = await supabase
            .from('regulation_annex')
            .insert({
              regulation_version_id: regulationVersionId,
              annex_id: annexId,
            })
            .select('id')
            .single();

          if (raError || !newRA) {
            const msg = `Failed to link annex "${code}" (annex_id=${annexId}) to regulation_version_id=${regulationVersionId} for regulation "${reg.regulation_number}": ${raError?.message ?? 'no data returned'}`;
            console.error('[regulationExtractor]', msg, raError);
            diagnostics.errors.push(msg);
          } else {
            stored.regulation_annex_ids.push(newRA.id);
          }
        }
      }

      diagnostics.totalInserted++;
    }

    const hasFailures = diagnostics.totalFailed > 0;

    return {
      success: !hasFailures,
      regulations,
      stored,
      diagnostics,
      debug,
      ...(hasFailures && {
        error: `${diagnostics.totalFailed} of ${diagnostics.totalExtracted} regulation(s) failed to store. See diagnostics.errors for details.`,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown extraction error';
    console.error('[regulationExtractor] Unexpected error:', err);
    return {
      success: false,
      regulations: [],
      error: message,
      stored,
      diagnostics,
      debug,
    };
  }
}
