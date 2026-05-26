import React from 'react';
import AppLayout from '@/components/AppLayout';
import DocumentsClient from './components/DocumentsClient';
import ToastProvider from '@/components/ui/Toast';

export default function DocumentsPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <DocumentsClient />
    </AppLayout>
  );
}