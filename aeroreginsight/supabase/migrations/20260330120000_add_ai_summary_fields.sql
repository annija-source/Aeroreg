-- Migration: Add AI summary fields to change_analysis table
-- Adds affected_annexes, applicability_dates_changed, applicability_date_note

ALTER TABLE public.change_analysis
ADD COLUMN IF NOT EXISTS affected_annexes TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS applicability_dates_changed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS applicability_date_note TEXT DEFAULT '';
