import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import RegulationDetailClient from './components/RegulationDetailClient';
import ToastProvider from '@/components/ui/Toast';

export default function RegulationDetailPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <Suspense fallback={<div className="p-6 text-slate-400">Loading...</div>}>
        <RegulationDetailClient />
      </Suspense>
    </AppLayout>
  );
}
