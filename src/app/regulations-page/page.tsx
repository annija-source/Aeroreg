import React from 'react';
import AppLayout from '@/components/AppLayout';
import RegulationsClient from './components/RegulationsClient';
import ToastProvider from '@/components/ui/Toast';

export default function RegulationsPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <RegulationsClient />
    </AppLayout>
  );
}
