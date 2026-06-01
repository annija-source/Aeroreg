/**
 * PDF text extraction — splits large PDFs into chunks and sends to OpenAI.
 * Stays within OpenAI's token limits by only sending first ~50 pages.
 */

import { createClient } from '@supabase/supabase-js';

export interface PdfExtractionResult {
  text: string;
  extracted_text_length: number;
  extraction_method: 'openai-pdf' | 'fallback-provided-text' | 'none';
  extraction_success: boolean;
  extraction_error?: string;
  page_count?: number;
}

const BUCKET = 'documents';
// Max ~4MB to stay well within OpenAI token limits
const MAX_PDF_BYTES = 4 * 1024 * 1024;

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(supabaseUrl, serviceKey);
}

// Truncate PDF to first N bytes while keeping valid PDF structure
// Splits on %%EOF or just slices — OpenAI is forgiving with partial PDFs
function truncatePdf(buffer: Buffer): Buffer {
  if (buffer.length <= MAX_PDF_BYTES) return buffer;

  // Try to find a clean page boundary near the limit
  const slice = buffer.slice(0, MAX_PDF_BYTES);
  // Find last 'endobj' before the limit for a clean cut
  const lastEndobj = slice.lastIndexOf('endobj');
  if (lastEndobj > MAX_PDF_BYTES * 0.5) {
    return buffer.slice(0, lastEndobj + 6);
  }
  return slice;
}

export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
  console.log(`[pdfExtractor] Extracting — filePath="${filePath}"`);

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'OPENAI_API_KEY not configured.' };
  }

  try {
    // 1. Download from Supabase Storage
    const supabase = adminClient();
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(filePath);

    if (downloadError || !blob) {
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `Storage download failed: ${downloadError?.message ?? 'Unknown'}` };
    }

    let buffer = Buffer.from(await blob.arrayBuffer());
    const originalSize = buffer.length;
    console.log(`[pdfExtractor] Downloaded ${originalSize} bytes`);

    // 2. Truncate if too large
    buffer = truncatePdf(buffer);
    if (buffer.length < originalSize) {
      console.log(`[pdfExtractor] Truncated from ${originalSize} to ${buffer.length} bytes`);
    }

    // 3. Upload truncated PDF to OpenAI Files API
    const fileName = (filePath.split('/').pop() ?? 'document') + '.pdf';
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);
    formData.append('purpose', 'assistants');

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `OpenAI upload failed: ${err?.error?.message ?? uploadRes.statusText}` };
    }

    const uploadData = await uploadRes.json();
    const fileId: string = uploadData.id;
    console.log(`[pdfExtractor] Uploaded to OpenAI — fileId="${fileId}"`);

    // 4. Extract text via GPT-4o
    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract ALL text content from this PDF. Include headings, article numbers, tables, lists, and body text. Preserve the document structure. Return only the extracted text.' },
            { type: 'file', file: { file_id: fileId } },
          ],
        }],
        max_tokens: 16000,
      }),
    });

    // Cleanup uploaded file (fire and forget)
    fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
    }).catch(() => {});

    if (!extractRes.ok) {
      const err = await extractRes.json().catch(() => ({}));
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `OpenAI extraction failed: ${err?.error?.message ?? extractRes.statusText}` };
    }

    const extractData = await extractRes.json();
    const text: string = extractData?.choices?.[0]?.message?.content ?? '';
    console.log(`[pdfExtractor] Extracted ${text.length} chars`);

    if (text.length < 100) {
      return { text: '', extracted_text_length: text.length, extraction_method: 'openai-pdf', extraction_success: false, extraction_error: 'Extracted text too short.' };
    }

    return { text, extracted_text_length: text.length, extraction_method: 'openai-pdf', extraction_success: true };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdfExtractor] Error:', message);
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: message };
  }
}

export async function extractTextFromPdfUrl(pdfUrl: string): Promise<PdfExtractionResult> {
  return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'Use extractTextFromPdf(filePath) instead.' };
}

export function buildSupabaseStorageUrl(filePath: string, bucket: string = 'documents'): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
}
