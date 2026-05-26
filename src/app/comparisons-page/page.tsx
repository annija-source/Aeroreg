import React from 'react';
import AppLayout from '@/components/AppLayout';
import ComparisonsClient from './components/ComparisonsClient';
import ToastProvider from '@/components/ui/Toast';

export default function ComparisonsPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <ComparisonsClient />
    </AppLayout>
  );
}
