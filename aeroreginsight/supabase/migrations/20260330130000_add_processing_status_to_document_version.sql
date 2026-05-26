-- Migration: Add processing pipeline status to document_version
-- Adds processing_status, processing_error, and processing_updated_at columns

ALTER TABLE public.document_version
ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'uploaded',
ADD COLUMN IF NOT EXISTS processing_error TEXT,
ADD COLUMN IF NOT EXISTS processing_updated_at TIMESTAMPTZ;

-- Index for filtering by processing status
CREATE INDEX IF NOT EXISTS idx_document_version_processing_status
ON public.document_version(processing_status);

-- Comment on allowed values for documentation
COMMENT ON COLUMN public.document_version.processing_status IS
  'Pipeline stage: uploaded | text_extracted | regulations_extracted | revisions_extracted | failed';
