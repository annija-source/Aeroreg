import React from 'react';
import AppLayout from '@/components/AppLayout';
import ToastProvider from '@/components/ui/Toast';
import DashboardClient from './components/DashboardClient';

export default function DashboardPage() {
  return (
    <AppLayout>
      <ToastProvider />
      <DashboardClient />
    </AppLayout>
  );
}
