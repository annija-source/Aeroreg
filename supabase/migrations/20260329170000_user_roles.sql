-- ============================================================
-- User Roles Migration
-- Creates user_profiles table with role column and RLS policies
-- ============================================================

-- 1. Create role enum type
DROP TYPE IF EXISTS public.app_role CASCADE;
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');

-- 2. Create user_profiles table (stores role per user)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role public.app_role NOT NULL DEFAULT 'viewer'::public.app_role,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);

-- 4. Helper functions (MUST be before RLS policies)

-- Function: get current user's role (safe, no recursion)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role::TEXT FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Function: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'::public.app_role
  );
$$;

-- Function: check if current user is admin or editor
CREATE OR REPLACE FUNCTION public.is_admin_or_editor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin'::public.app_role, 'editor'::public.app_role)
  );
$$;

-- 5. Trigger function: auto-create user_profiles row on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::public.app_role,
      'viewer'::public.app_role
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 6. Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies

-- Users can read their own profile
DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
CREATE POLICY "users_read_own_profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Admins can read all profiles
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.user_profiles;
CREATE POLICY "admins_read_all_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Users can update their own profile (non-role fields)
DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;
CREATE POLICY "users_update_own_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Admins can update any profile (including role)
DROP POLICY IF EXISTS "admins_update_any_profile" ON public.user_profiles;
CREATE POLICY "admins_update_any_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Allow insert from trigger (service role)
DROP POLICY IF EXISTS "service_insert_profiles" ON public.user_profiles;
CREATE POLICY "service_insert_profiles"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- 8. Trigger: fires after new auth user is created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 9. Backfill existing auth users who don't have a profile yet
DO $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  SELECT
    au.id,
    au.email,
    COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
    COALESCE(
      (au.raw_user_meta_data->>'role')::public.app_role,
      'viewer'::public.app_role
    )
  FROM auth.users au
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = au.id
  )
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Backfill failed: %', SQLERRM;
END $$;

-- 10. Promote the first user to admin if no admin exists
DO $$
DECLARE
  first_user_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE role = 'admin'::public.app_role) THEN
    SELECT id INTO first_user_id FROM public.user_profiles ORDER BY created_at ASC LIMIT 1;
    IF first_user_id IS NOT NULL THEN
      UPDATE public.user_profiles SET role = 'admin'::public.app_role WHERE id = first_user_id;
      RAISE NOTICE 'Promoted first user % to admin', first_user_id;
    END IF;
  END IF;
END $$;
