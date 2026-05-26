import { NextRequest, NextResponse } from 'next/server';
import { extractAndStoreRegulations } from '@/lib/ai/regulationExtractor';
import { extractTextFromPdf } from '@/lib/ai/pdfExtractor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentText, documentVersionId, documentId, filePath } = body;

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

    // ── PDF Extraction ────────────────────────────────────────────────────────
    let resolvedText: string = documentText ?? '';
    let extracted_text_length = resolvedText.length;
    let extraction_method: 'pdf-parse' | 'fallback-provided-text' | 'none' = 'none';
    let extraction_success = false;
    let extraction_error: string | undefined;
    let page_count: number | undefined;

    if (filePath) {
      // Attempt real PDF text extraction from Supabase Storage (private bucket)
      console.log(`[extract-regulations] Attempting PDF extraction — bucket="documents" filePath="${filePath}" method="storage.download()"`);

      const pdfResult = await extractTextFromPdf(filePath);

      extracted_text_length = pdfResult.extracted_text_length;
      extraction_method = pdfResult.extraction_method;
      extraction_success = pdfResult.extraction_success;
      extraction_error = pdfResult.extraction_error;
      page_count = pdfResult.page_count;

      if (pdfResult.extraction_success && pdfResult.text.length > 0) {
        resolvedText = pdfResult.text;
        console.log(
          `[extract-regulations] PDF extraction succeeded — ${pdfResult.extracted_text_length} chars, ${pdfResult.page_count} pages`
        );
      } else {
        // Fall back to provided documentText if available
        if (documentText && documentText.length > 0) {
          resolvedText = documentText;
          extraction_method = 'fallback-provided-text';
          extracted_text_length = documentText.length;
          console.warn(
            `[extract-regulations] PDF extraction failed (${pdfResult.extraction_error}), falling back to provided documentText (${documentText.length} chars)`
          );
        } else {
          console.error(
            `[extract-regulations] PDF extraction failed and no fallback documentText provided: ${pdfResult.extraction_error}`
          );
        }
      }
    } else if (documentText && documentText.length > 0) {
      // No filePath provided — use documentText directly
      resolvedText = documentText;
      extraction_method = 'fallback-provided-text';
      extracted_text_length = documentText.length;
      extraction_success = true;
      console.log(
        `[extract-regulations] No filePath provided, using documentText directly (${documentText.length} chars)`
      );
    }

    if (!resolvedText || resolvedText.trim().length === 0) {
      return NextResponse.json(
        {
          error: 'No document text available for extraction. Provide filePath or documentText.',
          extraction_diagnostics: {
            extracted_text_length,
            extraction_method,
            extraction_success: false,
            extraction_error: extraction_error ?? 'No text source provided',
            page_count,
          },
        },
        { status: 400 }
      );
    }

    // ── Run AI Regulation Extraction ─────────────────────────────────────────
    const result = await extractAndStoreRegulations(
      resolvedText,
      Number(documentVersionId),
      Number(documentId),
      openAiApiKey
    );

    return NextResponse.json({
      ...result,
      extraction_diagnostics: {
        extracted_text_length,
        extraction_method,
        extraction_success,
        ...(extraction_error && { extraction_error }),
        ...(page_count !== undefined && { page_count }),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
