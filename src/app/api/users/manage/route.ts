import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// Admin client uses service role key for auth admin operations
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || serviceKey === 'your-supabase-service-role-key-here') {
    return null;
  }
  return createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify caller is admin
async function verifyAdmin() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') return null;
  return user;
}

// GET /api/users/manage — list all users with auth metadata
export async function GET() {
  try {
    const caller = await verifyAdmin();
    if (!caller) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    // Fetch all profiles (always available via anon client)
    const supabase = await createClient();
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, is_active, created_at, updated_at')
      .order('created_at', { ascending: true });

    if (profilesError) {
      console.error('[users/manage GET] user_profiles error:', profilesError);
      return NextResponse.json({ error: profilesError.message }, { status: 500 });
    }

    const adminClient = getAdminClient();

    // If service role key is available, enrich with last_sign_in_at
    if (adminClient) {
      const { data: authData, error: authListError } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (!authListError && authData) {
        const authMap = new Map(authData.users.map((u) => [u.id, u]));
        const merged = (profiles ?? []).map((p) => {
          const authUser = authMap.get(p.id);
          return {
            ...p,
            last_sign_in_at: authUser?.last_sign_in_at ?? null,
          };
        });
        return NextResponse.json({ users: merged });
      }
    }

    // Fallback: return profiles without last_sign_in_at
    const users = (profiles ?? []).map((p) => ({ ...p, last_sign_in_at: null }));
    return NextResponse.json({ users });
  } catch (err: any) {
    console.error('[users/manage GET] unexpected error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

// POST /api/users/manage — create new user
export async function POST(req: NextRequest) {
  try {
    const caller = await verifyAdmin();
    if (!caller) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await req.json();
    const { email, password, role, full_name, is_active } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
    }

    const adminClient = getAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured. Cannot create users without it.' },
        { status: 500 }
      );
    }

    // Create auth user
    const { data: newAuthUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '', role: role ?? 'viewer' },
    });

    if (createError) {
      console.error('[users/manage POST] createUser error:', createError);
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    const userId = newAuthUser.user.id;

    // Upsert user_profiles row (trigger may have already created it)
    const supabase = await createClient();
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert(
        {
          id: userId,
          email,
          full_name: full_name ?? '',
          role: role ?? 'viewer',
          is_active: is_active !== false,
        },
        { onConflict: 'id' }
      );

    if (profileError) {
      console.error('[users/manage POST] upsert profile error:', profileError);
      // Don't fail — auth user was created; profile may be created by trigger
    }

    return NextResponse.json({ success: true, user_id: userId });
  } catch (err: any) {
    console.error('[users/manage POST] unexpected error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/users/manage — update user profile (role, full_name, is_active)
export async function PATCH(req: NextRequest) {
  try {
    const caller = await verifyAdmin();
    if (!caller) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await req.json();
    const { user_id, role, full_name, is_active } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (role !== undefined) updates.role = role;
    if (full_name !== undefined) updates.full_name = full_name;
    if (is_active !== undefined) updates.is_active = is_active;

    const supabase = await createClient();
    const { error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', user_id);

    if (error) {
      console.error('[users/manage PATCH] update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[users/manage PATCH] unexpected error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/users/manage — send password reset email
export async function DELETE(req: NextRequest) {
  // Reusing DELETE for reset-password action (action param)
  try {
    const caller = await verifyAdmin();
    if (!caller) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const email = searchParams.get('email');

    if (action === 'reset-password' && email) {
      const supabase = await createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/dashboard`,
      });
      if (error) {
        console.error('[users/manage reset-password] error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('[users/manage DELETE] unexpected error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
