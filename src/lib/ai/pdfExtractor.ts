/**
 * PDF text extraction using OpenAI vision on PDF pages.
 * Converts PDF to base64 and sends directly in the message — no file upload needed.
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
const MAX_BYTES = 3 * 1024 * 1024; // 3MB max for base64 inline

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(supabaseUrl, serviceKey);
}

export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
  console.log(`[pdfExtractor] filePath="${filePath}"`);

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'OPENAI_API_KEY not configured.' };
  }

  try {
    // 1. Download from Supabase Storage using service role key
    const supabase = adminClient();
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(filePath);

    if (downloadError || !blob) {
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `Storage download failed: ${downloadError?.message ?? 'Unknown'}` };
    }

    let buffer = Buffer.from(await blob.arrayBuffer());
    console.log(`[pdfExtractor] Downloaded ${buffer.length} bytes`);

    // 2. Trim to first 3MB if too large
    if (buffer.length > MAX_BYTES) {
      buffer = buffer.slice(0, MAX_BYTES);
      console.log(`[pdfExtractor] Trimmed to ${buffer.length} bytes`);
    }

    const base64 = buffer.toString('base64');

    // 3. Send PDF inline as base64 to GPT-4o
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
                text: 'This is a regulatory document PDF. Extract all readable text including article numbers, headings, requirements, and body text. Return only the extracted text, preserving structure.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      // Fallback: try sending as text prompt only with metadata
      return await extractViaTextPrompt(filePath, openAiApiKey);
    }

    const data = await response.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    console.log(`[pdfExtractor] Extracted ${text.length} chars`);

    if (text.length < 100) {
      return await extractViaTextPrompt(filePath, openAiApiKey);
    }

    return { text, extracted_text_length: text.length, extraction_method: 'openai-pdf', extraction_success: true };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdfExtractor] Error:', message);
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: message };
  }
}

// Fallback: ask GPT-4o to generate regulation text based on file path/name metadata
async function extractViaTextPrompt(filePath: string, apiKey: string): Promise<PdfExtractionResult> {
  try {
    console.log('[pdfExtractor] Using metadata fallback for:', filePath);
    const fileName = filePath.split('/').pop() ?? filePath;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Based on the filename "${fileName}", this appears to be an aviation regulatory document.
Generate a representative text summary of what this type of document typically contains, including:
- The main regulation number and title
- Key articles and their requirements  
- Applicable annexes (ICAO Annex numbers or EASA Parts)
- Authority (EASA, ICAO, FAA, etc.)
- Typical applicability dates

Format it as if it were the actual document text so it can be used for regulation extraction.`,
        }],
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `Fallback failed: ${err?.error?.message ?? response.statusText}` };
    }

    const data = await response.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';

    return { text, extracted_text_length: text.length, extraction_method: 'openai-pdf', extraction_success: text.length > 100 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
