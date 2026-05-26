import React from 'react';
import AppLayout from '@/components/AppLayout';
import VersionsClient from './components/VersionsClient';

export const metadata = { title: 'Versions – AeroReg Insight' };

export default function VersionsPage() {
  return (
    <AppLayout>
      <VersionsClient />
    </AppLayout>
  );
}
