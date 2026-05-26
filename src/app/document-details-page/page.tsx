import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import DocumentDetailsClient from './components/DocumentDetailsClient';
import ToastProvider from '@/components/ui/Toast';

export default function DocumentDetailsPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <Suspense fallback={<div className="flex items-center justify-center py-24 text-sm text-[hsl(var(--muted-foreground))]">Loading...</div>}>
        <DocumentDetailsClient />
      </Suspense>
    </AppLayout>
  );
}