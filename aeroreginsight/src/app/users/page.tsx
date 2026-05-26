import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import UsersClient from '../users-page/components/UsersClient';

export default async function UsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase?.auth?.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase?.from('user_profiles')?.select('role')?.eq('id', user?.id)?.maybeSingle();

  if (!profile || profile?.role !== 'admin') {
    redirect('/sources-page');
  }

  return (
    <AppLayout>
      <UsersClient />
    </AppLayout>
  );
}
