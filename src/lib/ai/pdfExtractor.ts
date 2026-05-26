/**
 * PDF text extraction utility for EASA-style regulatory documents.
 *
 * Strategy:
 * 1. Download the PDF binary from Supabase Storage using the authenticated
 *    storage.download() method — works for private buckets.
 * 2. Run pdf-parse to extract real text — preserves headings and table-like content.
 * 3. Return diagnostics: extracted_text_length, extraction_method, extraction_success.
 * 4. Caller falls back to pre-supplied documentText if extraction fails.
 */

import { createClient } from '@/lib/supabase/server';

export interface PdfExtractionResult {
  text: string;
  extracted_text_length: number;
  extraction_method: 'pdf-parse' | 'fallback-provided-text' | 'none';
  extraction_success: boolean;
  extraction_error?: string;
  page_count?: number;
}

const BUCKET = 'documents';

/**
 * Download a PDF from Supabase Storage (private bucket) using the authenticated
 * server client, then extract text via pdf-parse.
 *
 * @param filePath - The file_path value stored in document_version (e.g. "uploads/abc.pdf")
 */
export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
  console.log(`[pdfExtractor] bucket="${BUCKET}" filePath="${filePath}" method="storage.download()"`);

  try {
    const supabase = await createClient();

    // Use authenticated download() — works for private buckets
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(filePath);

    if (downloadError || !blob) {
      const errMsg = downloadError?.message ?? 'Unknown download error';
      console.error(`[pdfExtractor] storage.download() failed: ${errMsg}`);
      return {
        text: '',
        extracted_text_length: 0,
        extraction_method: 'none',
        extraction_success: false,
        extraction_error: `Failed to download PDF from storage: ${errMsg}`,
      };
    }

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[pdfExtractor] Downloaded PDF — size: ${buffer.length} bytes`);

    // Dynamically import pdf-parse to avoid issues with Next.js edge/server bundling
    const pdfParse = (await import('pdf-parse')).default;

    const parsed = await pdfParse(buffer, {
      // Preserve whitespace structure to keep headings and table-like content
      normalizeWhitespace: false,
    });

    const rawText: string = parsed.text ?? '';
    const pageCount: number = parsed.numpages ?? 0;

    // Post-process: normalise excessive blank lines while preserving structure
    const cleanedText = rawText
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();

    console.log(
      `[pdfExtractor] Extracted ${cleanedText.length} chars from ${pageCount} pages via pdf-parse`
    );

    if (cleanedText.length < 100) {
      return {
        text: cleanedText,
        extracted_text_length: cleanedText.length,
        extraction_method: 'pdf-parse',
        extraction_success: false,
        extraction_error: `Extracted text too short (${cleanedText.length} chars) — document may be image-only or scanned`,
        page_count: pageCount,
      };
    }

    return {
      text: cleanedText,
      extracted_text_length: cleanedText.length,
      extraction_method: 'pdf-parse',
      extraction_success: true,
      page_count: pageCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdfExtractor] pdf-parse extraction failed:', message);
    return {
      text: '',
      extracted_text_length: 0,
      extraction_method: 'none',
      extraction_success: false,
      extraction_error: `pdf-parse error: ${message}`,
    };
  }
}

/**
 * @deprecated Use extractTextFromPdf(filePath) instead.
 * Kept for backwards compatibility — redirects to the authenticated download path.
 */
export async function extractTextFromPdfUrl(pdfUrl: string): Promise<PdfExtractionResult> {
  console.warn(
    '[pdfExtractor] extractTextFromPdfUrl() is deprecated. Use extractTextFromPdf(filePath) for private bucket support.'
  );
  // Attempt a plain fetch as last resort (only works for public buckets)
  try {
    const response = await fetch(pdfUrl, { cache: 'no-store' });
    if (!response.ok) {
      return {
        text: '',
        extracted_text_length: 0,
        extraction_method: 'none',
        extraction_success: false,
        extraction_error: `Failed to download PDF: HTTP ${response.status} ${response.statusText}`,
      };
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer, { normalizeWhitespace: false });
    const rawText: string = parsed.text ?? '';
    const cleanedText = rawText.replace(/\n{3,}/g, '\n\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    return {
      text: cleanedText,
      extracted_text_length: cleanedText.length,
      extraction_method: 'pdf-parse',
      extraction_success: cleanedText.length >= 100,
      page_count: parsed.numpages ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: '',
      extracted_text_length: 0,
      extraction_method: 'none',
      extraction_success: false,
      extraction_error: `pdf-parse error: ${message}`,
    };
  }
}

/**
 * @deprecated Use extractTextFromPdf(filePath) instead.
 */
export function buildSupabaseStorageUrl(filePath: string, bucket: string = 'documents'): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
}
