import React from 'react';
import AppLayout from '@/components/AppLayout';
import ComplianceGapClient from './components/ComplianceGapClient';
import ToastProvider from '@/components/ui/Toast';

export default function ComplianceGapPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <ComplianceGapClient />
    </AppLayout>
  );
}
