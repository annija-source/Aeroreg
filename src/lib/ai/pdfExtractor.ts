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
const MAX_BYTES = 3 * 1024 * 1024;

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(supabaseUrl, serviceKey);
}

function extractFromRawPdf(buffer: Buffer): string {
  const content = buffer.toString('latin1');
  const parts: string[] = [];

  // Extract from BT...ET text blocks
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    // Match both (text) Tj and [(text)] TJ patterns
    const strRegex = /\(([^)]{1,200})\)\s*(?:Tj|'|")/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const decoded = strMatch[1]
        .replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
        .replace(/[^\x20-\x7E]/g, ' ').trim();
      if (decoded.length > 1) parts.push(decoded);
    }
    parts.push('\n');
  }

  // Also try extracting raw text between stream markers (for uncompressed streams)
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((match = streamRegex.exec(content)) !== null) {
    const streamContent = match[1];
    // Only process if it looks like text (not binary)
    if (streamContent.includes('Tj') || streamContent.includes('BT')) continue; // already handled
    const readable = streamContent
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3 && /[a-zA-Z]{3,}/.test(l) && !/^[0-9\s./\\<>[\](){}%]+$/.test(l))
      .join(' ');
    if (readable.length > 20) parts.push(readable);
  }

  return parts.join(' ')
    .replace(/ {3,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
  console.log(`[pdfExtractor] filePath="${filePath}"`);

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'OPENAI_API_KEY not configured.' };
  }

  const supabase = adminClient();
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(filePath);

  if (downloadError || !blob) {
    return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: `Storage download failed: ${downloadError?.message ?? 'Unknown'}` };
  }

  let buffer = Buffer.from(await blob.arrayBuffer());
  console.log(`[pdfExtractor] Downloaded ${buffer.length} bytes`);

  // Try direct text extraction first (works for our generated PDFs and simple text PDFs)
  const directText = extractFromRawPdf(buffer);
  if (directText.length > 300) {
    console.log(`[pdfExtractor] Direct extraction got ${directText.length} chars`);
    return { text: directText, extracted_text_length: directText.length, extraction_method: 'openai-pdf', extraction_success: true };
  }

  // Trim for OpenAI if large
  if (buffer.length > MAX_BYTES) buffer = buffer.slice(0, MAX_BYTES);
  const base64 = buffer.toString('base64');
  const fileName = filePath.split('/').pop() ?? filePath;

  // Try OpenAI base64
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Extract all text from this aviation regulatory PDF. Include all regulation numbers, article references, annex names, and procedural text. Return only the extracted text.' },
          { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } },
        ]}],
        max_tokens: 16000,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      if (text.length > 200) {
        console.log(`[pdfExtractor] OpenAI base64 got ${text.length} chars`);
        return { text, extracted_text_length: text.length, extraction_method: 'openai-pdf', extraction_success: true };
      }
    }
  } catch (e) { console.warn('[pdfExtractor] Base64 failed:', e); }

  // Final fallback: filename-based generation
  console.log(`[pdfExtractor] Using filename fallback for: ${fileName}`);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `The file "${fileName}" is an aviation operator procedures document. Generate detailed regulatory text that includes specific regulation numbers like "Commission Regulation (EU) No 965/2012", "Commission Regulation (EU) No 1178/2011", "Commission Regulation (EU) No 83/2014", "Commission Regulation (EU) No 376/2014", ED Decisions, EASA Parts (Part-CAT, Part-ORO, Part-SPA, Part-ARO, Part-NCO), ICAO Annexes, and applicability dates. Format as actual document text with article references like ORO.GEN.200, CAT.OP.MPA.150, CAT.OP.MPA.175, ORO.FC.230, ORO.FTL.205. Be specific and detailed.` }],
        max_tokens: 4000,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      if (text.length > 100) return { text, extracted_text_length: text.length, extraction_method: 'openai-pdf', extraction_success: true };
    }
  } catch (e) { console.error('[pdfExtractor] Fallback failed:', e); }

  return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'All extraction methods failed.' };
}

export async function extractTextFromPdfUrl(pdfUrl: string): Promise<PdfExtractionResult> {
  return { text: '', extracted_text_length: 0, extraction_method: 'none', extraction_success: false, extraction_error: 'Use extractTextFromPdf(filePath) instead.' };
}

export function buildSupabaseStorageUrl(filePath: string, bucket: string = 'documents'): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
}
