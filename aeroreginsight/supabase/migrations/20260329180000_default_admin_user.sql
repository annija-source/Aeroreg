-- ============================================================
-- Default Admin User Migration
-- Creates a default admin user if no admin exists
-- ============================================================

-- Insert default admin into auth.users if not already present
DO $$
DECLARE
  admin_id UUID;
  admin_email TEXT := 'admin@aeroregins.com';
BEGIN
  -- Check if admin email already exists
  SELECT id INTO admin_id FROM auth.users WHERE email = admin_email LIMIT 1;

  IF admin_id IS NULL THEN
    -- Generate a new UUID for the admin
    admin_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud
    ) VALUES (
      admin_id,
      '00000000-0000-0000-0000-000000000000',
      admin_email,
      crypt('Admin@123456', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Admin"}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated'
    );

    -- Insert into user_profiles with admin role
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (admin_id, admin_email, 'Admin', 'admin'::public.app_role)
    ON CONFLICT (id) DO UPDATE SET role = 'admin'::public.app_role;

    RAISE NOTICE 'Default admin user created: %', admin_email;
  ELSE
    -- Ensure existing user has admin role in user_profiles
    INSERT INTO public.user_profiles (id, email, full_name, role)
    SELECT admin_id, admin_email, COALESCE(raw_user_meta_data->>'full_name', 'Admin'), 'admin'::public.app_role
    FROM auth.users WHERE id = admin_id
    ON CONFLICT (id) DO UPDATE SET role = 'admin'::public.app_role;

    RAISE NOTICE 'Admin user already exists, ensured admin role: %', admin_email;
  END IF;
END $$;

-- Promote first existing user to admin if still no admin exists
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
