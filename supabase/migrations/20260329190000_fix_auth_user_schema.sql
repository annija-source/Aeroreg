-- ============================================================
-- Fix Auth User Schema Error
-- Patches the incomplete auth.users record that causes
-- "Database error querying schema" on login
-- ============================================================

DO $$
DECLARE
  admin_email TEXT := 'admin@aeroregins.com';
  admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE email = admin_email LIMIT 1;

  IF admin_id IS NOT NULL THEN
    -- Patch all required fields that were missing from the previous migration
    UPDATE auth.users SET
      confirmation_token        = COALESCE(confirmation_token, ''),
      confirmation_sent_at      = COALESCE(confirmation_sent_at, NULL),
      recovery_token            = COALESCE(recovery_token, ''),
      recovery_sent_at          = COALESCE(recovery_sent_at, NULL),
      email_change_token_new    = COALESCE(email_change_token_new, ''),
      email_change              = COALESCE(email_change, ''),
      email_change_sent_at      = COALESCE(email_change_sent_at, NULL),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
      reauthentication_token    = COALESCE(reauthentication_token, ''),
      reauthentication_sent_at  = COALESCE(reauthentication_sent_at, NULL),
      is_sso_user               = COALESCE(is_sso_user, false),
      is_anonymous              = COALESCE(is_anonymous, false),
      phone                     = COALESCE(phone, NULL),
      phone_confirmed_at        = COALESCE(phone_confirmed_at, NULL),
      phone_change              = COALESCE(phone_change, ''),
      phone_change_token        = COALESCE(phone_change_token, ''),
      phone_change_sent_at      = COALESCE(phone_change_sent_at, NULL),
      email_confirmed_at        = COALESCE(email_confirmed_at, now()),
      raw_app_meta_data         = COALESCE(raw_app_meta_data, jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[])),
      raw_user_meta_data        = COALESCE(raw_user_meta_data, jsonb_build_object('full_name', 'Admin')),
      updated_at                = now()
    WHERE id = admin_id;

    RAISE NOTICE 'Patched auth.users record for admin: %', admin_email;
  ELSE
    -- Admin does not exist yet — create a complete record from scratch
    admin_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_sso_user,
      is_anonymous,
      confirmation_token,
      confirmation_sent_at,
      recovery_token,
      recovery_sent_at,
      email_change_token_new,
      email_change,
      email_change_sent_at,
      email_change_token_current,
      email_change_confirm_status,
      reauthentication_token,
      reauthentication_sent_at,
      phone,
      phone_change,
      phone_change_token,
      phone_change_sent_at
    ) VALUES (
      admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      admin_email,
      crypt('Admin@123456', gen_salt('bf', 10)),
      now(),
      now(),
      now(),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      jsonb_build_object('full_name', 'Admin'),
      false,
      false,
      '',
      NULL,
      '',
      NULL,
      '',
      '',
      NULL,
      '',
      0,
      '',
      NULL,
      NULL,
      '',
      '',
      NULL
    )
    ON CONFLICT (id) DO NOTHING;

    -- Ensure user_profiles row exists with admin role
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (admin_id, admin_email, 'Admin', 'admin'::public.app_role)
    ON CONFLICT (id) DO UPDATE SET role = 'admin'::public.app_role;

    RAISE NOTICE 'Created complete admin auth.users record: %', admin_email;
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Fix migration failed: %', SQLERRM;
END $$;
