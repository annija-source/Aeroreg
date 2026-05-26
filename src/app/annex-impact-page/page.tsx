import React from 'react';
import AppLayout from '@/components/AppLayout';
import AnnexImpactClient from './components/AnnexImpactClient';
import ToastProvider from '@/components/ui/Toast';

export default function AnnexImpactPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <AnnexImpactClient />
    </AppLayout>
  );
}
