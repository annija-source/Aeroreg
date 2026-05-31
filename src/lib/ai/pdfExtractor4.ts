/**
 * PDF text extraction utility for EASA-style regulatory documents.
 * Uses Supabase service role key to download from private storage bucket,
 * then extracts text using pure Node.js regex parsing (no browser APIs needed).
 */

import { createClient } from '@supabase/supabase-js';

export interface PdfExtractionResult {
  text: string;
  extracted_text_length: number;
  extraction_method: 'regex-parse' | 'fallback-provided-text' | 'none';
  extraction_success: boolean;
  extraction_error?: string;
  page_count?: number;
}

const BUCKET = 'documents';

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(supabaseUrl, serviceKey);
}

// Pure Node.js PDF text extractor — no browser APIs, no external libs
function extractTextFromBuffer(buffer: Buffer): string {
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

  return textParts
    .join(' ')
    .replace(/ {3,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Count approximate pages from PDF binary
function countPages(buffer: Buffer): number {
  const content = buffer.toString('binary');
  const matches = content.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
  console.log(`[pdfExtractor] bucket="${BUCKET}" filePath="${filePath}"`);

  try {
    const supabase = adminClient();

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

    const buffer = Buffer.from(await blob.arrayBuffer());
    console.log(`[pdfExtractor] Downloaded PDF — size: ${buffer.length} bytes`);

    const rawText = extractTextFromBuffer(buffer);
    const pageCount = countPages(buffer);

    const cleanedText = rawText
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();

    console.log(`[pdfExtractor] Extracted ${cleanedText.length} chars from ~${pageCount} pages`);

    if (cleanedText.length < 100) {
      return {
        text: cleanedText,
        extracted_text_length: cleanedText.length,
        extraction_method: 'regex-parse',
        extraction_success: false,
        extraction_error: `Extracted text too short (${cleanedText.length} chars) — document may be image-only or scanned`,
        page_count: pageCount,
      };
    }

    return {
      text: cleanedText,
      extracted_text_length: cleanedText.length,
      extraction_method: 'regex-parse',
      extraction_success: true,
      page_count: pageCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdfExtractor] extraction failed:', message);
    return {
      text: '',
      extracted_text_length: 0,
      extraction_method: 'none',
      extraction_success: false,
      extraction_error: `extraction error: ${message}`,
    };
  }
}

// Legacy exports kept for backwards compatibility
export async function extractTextFromPdfUrl(pdfUrl: string): Promise<PdfExtractionResult> {
  try {
    const response = await fetch(pdfUrl, { cache: 'no-store' });
    if (!response.ok) {
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `HTTP ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = extractTextFromBuffer(buffer).replace(/\n{3,}/g, '\n\n').trim();
    return { text, extracted_text_length: text.length, extraction_method: 'regex-parse', extraction_success: text.length >= 100, page_count: countPages(buffer) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: message };
  }
}

export function buildSupabaseStorageUrl(filePath: string, bucket: string = 'documents'): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
}
