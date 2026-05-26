import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ComplianceGapClient from './components/ComplianceGapClient';

export default async function ComplianceGapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return <ComplianceGapClient />;
}
