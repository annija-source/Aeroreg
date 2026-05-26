import { NextRequest, NextResponse } from 'next/server';
import { extractAndStoreRegulations } from '@/lib/ai/regulationExtractor';
import { extractAndStoreRevisions } from '@/lib/ai/revisionExtractor';
import { extractTextFromPdf } from '@/lib/ai/pdfExtractor';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  /** Helper: update processing_status (and optionally error) on document_version */
  async function setStatus(
    versionId: number,
    processingStatus: string,
    processingError?: string | null
  ) {
    await adminClient
      .from('document_version')
      .update({
        processing_status: processingStatus,
        processing_error: processingError ?? null,
        processing_updated_at: new Date().toISOString(),
      })
      .eq('id', versionId);
  }

  try {
    const body = await request.json();
    const { documentVersionId, documentId } = body;

    if (!documentVersionId || !documentId) {
      return NextResponse.json(
        { error: 'Missing required fields: documentVersionId, documentId' },
        { status: 400 }
      );
    }

    const openAiApiKey = process.env.OPENAI_API_KEY;
    if (!openAiApiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    // Fetch the document_version to get file_path
    const { data: versionRow, error: versionError } = await adminClient
      .from('document_version')
      .select('id, file_path, file_name')
      .eq('id', documentVersionId)
      .single();

    if (versionError || !versionRow) {
      return NextResponse.json(
        { error: `Version not found: ${versionError?.message ?? 'Unknown error'}` },
        { status: 404 }
      );
    }

    const filePath: string | null = versionRow.file_path ?? null;

    // ── Text Extraction ───────────────────────────────────────────────────────
    let resolvedText = '';
    let extractionDiagnostics: Record<string, unknown> = {
      extracted_text_length: 0,
      extraction_method: 'none',
      extraction_success: false,
    };

    if (filePath) {
      const pdfResult = await extractTextFromPdf(filePath);
      extractionDiagnostics = {
        extracted_text_length: pdfResult.extracted_text_length,
        extraction_method: pdfResult.extraction_method,
        extraction_success: pdfResult.extraction_success,
        ...(pdfResult.extraction_error && { extraction_error: pdfResult.extraction_error }),
        ...(pdfResult.page_count !== undefined && { page_count: pdfResult.page_count }),
      };
      if (pdfResult.extraction_success && pdfResult.text.length > 0) {
        resolvedText = pdfResult.text;
      }
    }

    if (!resolvedText.trim()) {
      await setStatus(
        Number(documentVersionId),
        'failed',
        'No text could be extracted from the document file. Ensure the version has an uploaded file.'
      );
      return NextResponse.json(
        {
          error: 'No text could be extracted from the document file. Ensure the version has an uploaded file.',
          extraction_diagnostics: extractionDiagnostics,
        },
        { status: 400 }
      );
    }

    // Mark text extraction done
    await setStatus(Number(documentVersionId), 'text_extracted');

    const warnings: string[] = [];

    // ── Regulation Extraction ─────────────────────────────────────────────────
    let extractedCount = 0;
    let insertedRegulationsCount = 0;
    let insertedRegulationVersionCount = 0;
    let linkedAnnexCount = 0;
    let failedRowsCount = 0;

    const [regulationResult, revisionResult] = await Promise.allSettled([
      extractAndStoreRegulations(
        resolvedText,
        Number(documentVersionId),
        Number(documentId),
        openAiApiKey
      ),
      extractAndStoreRevisions(
        resolvedText,
        Number(documentVersionId),
        Number(documentId),
        openAiApiKey
      ),
    ]);

    let regulationFailed = false;
    let revisionFailed = false;

    if (regulationResult.status === 'fulfilled') {
      const r = regulationResult.value;
      extractedCount = r.diagnostics?.totalExtracted ?? r.regulations?.length ?? 0;
      insertedRegulationsCount = r.stored?.regulation_ids?.length ?? 0;
      insertedRegulationVersionCount = r.stored?.regulation_version_ids?.length ?? 0;
      linkedAnnexCount = r.stored?.regulation_annex_ids?.length ?? 0;
      failedRowsCount = r.diagnostics?.totalFailed ?? 0;
      if (r.diagnostics?.errors?.length) {
        warnings.push(...r.diagnostics.errors);
      }
      // Mark regulations extracted
      await setStatus(Number(documentVersionId), 'regulations_extracted');
    } else {
      regulationFailed = true;
      const msg = regulationResult.reason instanceof Error
        ? regulationResult.reason.message
        : 'Regulation extraction failed';
      warnings.push(`Regulation extraction error: ${msg}`);
    }

    if (revisionResult.status === 'fulfilled') {
      const r = revisionResult.value;
      const count = r.revisions?.length ?? 0;
      if (count === 0) {
        warnings.push('No document revision history detected.');
      }
      // Mark revisions extracted (final success stage)
      await setStatus(Number(documentVersionId), 'revisions_extracted');
    } else {
      revisionFailed = true;
      const msg = revisionResult.reason instanceof Error
        ? revisionResult.reason.message
        : 'Revision extraction failed';
      warnings.push(`Revision extraction error: ${msg}`);
    }

    // If both extractions failed, mark as failed
    if (regulationFailed && revisionFailed) {
      await setStatus(
        Number(documentVersionId),
        'failed',
        warnings.join(' | ')
      );
    } else if (regulationFailed) {
      // Partial: revisions ok but regulations failed — keep revisions_extracted but note error
      warnings.push('Note: Regulation extraction failed; revision extraction succeeded.');
    } else if (revisionFailed) {
      // Partial: regulations ok but revisions failed — keep regulations_extracted status
      await setStatus(Number(documentVersionId), 'regulations_extracted');
    }

    return NextResponse.json({
      success: true,
      diagnostics: {
        extractedCount,
        insertedRegulationsCount,
        insertedRegulationVersionCount,
        linkedAnnexCount,
        failedRowsCount,
        warnings,
      },
      extraction_diagnostics: extractionDiagnostics,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reprocessing failed';
    // Best-effort status update — we may not have the ID if body parsing failed
    try {
      const body = await request.json().catch(() => ({}));
      if (body?.documentVersionId) {
        await setStatus(Number(body.documentVersionId), 'failed', message);
      }
    } catch {
      // ignore
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
