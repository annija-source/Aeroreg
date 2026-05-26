-- Add is_active column to user_profiles for deactivation support
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Update RLS: allow admins to read all profiles (needed for user management)
-- First drop existing policies to recreate them properly
DROP POLICY IF EXISTS "users_manage_own_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admin_read_all_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admin_update_all_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;

-- Allow authenticated users to read all profiles (needed to list users)
CREATE POLICY "authenticated_read_all_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (true);

-- Allow users to update their own profile
CREATE POLICY "users_update_own_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Allow insert for new users (trigger-based, but also direct)
CREATE POLICY "users_insert_own_profile"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());
