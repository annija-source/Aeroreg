import React from 'react';
import AppLayout from '@/components/AppLayout';
import SourcesClient from './components/SourcesClient';
import ToastProvider from '@/components/ui/Toast';

export default function SourcesPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <SourcesClient />
    </AppLayout>
  );
}