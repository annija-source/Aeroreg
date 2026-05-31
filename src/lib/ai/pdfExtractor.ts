/**
 * PDF text extraction using OpenAI's native PDF reading capability.
 * Uploads the PDF to OpenAI Files API, then asks GPT-4o to extract all text.
 * This bypasses all Node.js PDF library issues entirely.
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

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(supabaseUrl, serviceKey);
}

export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
  console.log(`[pdfExtractor] Extracting text via OpenAI — filePath="${filePath}"`);

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return {
      text: '',
      extracted_text_length: 0,
      extraction_method: 'none',
      extraction_success: false,
      extraction_error: 'OPENAI_API_KEY is not configured.',
    };
  }

  try {
    // 1. Download PDF from Supabase Storage using service role key
    const supabase = adminClient();
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(filePath);

    if (downloadError || !blob) {
      return {
        text: '',
        extracted_text_length: 0,
        extraction_method: 'none',
        extraction_success: false,
        extraction_error: `Failed to download from storage: ${downloadError?.message ?? 'Unknown error'}`,
      };
    }

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`[pdfExtractor] Downloaded PDF — ${buffer.length} bytes`);

    // 2. Upload PDF to OpenAI Files API
    const fileName = filePath.split('/').pop() ?? 'document.pdf';
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([buffer], { type: 'application/pdf' }),
      fileName
    );
    formData.append('purpose', 'assistants');

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      return {
        text: '',
        extracted_text_length: 0,
        extraction_method: 'none',
        extraction_success: false,
        extraction_error: `OpenAI file upload failed: ${err?.error?.message ?? uploadRes.statusText}`,
      };
    }

    const uploadData = await uploadRes.json();
    const fileId: string = uploadData.id;
    console.log(`[pdfExtractor] Uploaded to OpenAI — fileId="${fileId}"`);

    // 3. Ask GPT-4o to extract all text from the PDF
    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract ALL text content from this PDF document. Include headings, tables, lists, and body text. Preserve the document structure. Return only the raw extracted text, nothing else.',
              },
              {
                type: 'file',
                file: { file_id: fileId },
              },
            ],
          },
        ],
        max_tokens: 16000,
      }),
    });

    // 4. Clean up the uploaded file (fire and forget)
    fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
    }).catch(() => {});

    if (!extractRes.ok) {
      const err = await extractRes.json().catch(() => ({}));
      return {
        text: '',
        extracted_text_length: 0,
        extraction_method: 'none',
        extraction_success: false,
        extraction_error: `OpenAI extraction failed: ${err?.error?.message ?? extractRes.statusText}`,
      };
    }

    const extractData = await extractRes.json();
    const text: string = extractData?.choices?.[0]?.message?.content ?? '';

    console.log(`[pdfExtractor] Extracted ${text.length} chars via OpenAI`);

    if (text.length < 100) {
      return {
        text: '',
        extracted_text_length: text.length,
        extraction_method: 'openai-pdf',
        extraction_success: false,
        extraction_error: 'Extracted text too short — PDF may be image-only or empty.',
      };
    }

    return {
      text,
      extracted_text_length: text.length,
      extraction_method: 'openai-pdf',
      extraction_success: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdfExtractor] Unexpected error:', message);
    return {
      text: '',
      extracted_text_length: 0,
      extraction_method: 'none',
      extraction_success: false,
      extraction_error: message,
    };
  }
}

// Legacy exports for backwards compatibility
export async function extractTextFromPdfUrl(pdfUrl: string): Promise<PdfExtractionResult> {
  try {
    const response = await fetch(pdfUrl, { cache: 'no-store' });
    if (!response.ok) {
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `HTTP ${response.status}` };
    }
    // Re-use the main path by saving to a temp path — just return failure, caller has fallback
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'Use extractTextFromPdf(filePath) instead.' };
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
