import React from 'react';
import type { Metadata, Viewport } from 'next';
import '../styles/tailwind.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { RoleProvider } from '@/contexts/RoleContext';
import { Toaster } from 'sonner';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'AeroReg Insight — Aviation Regulatory Document Tracker',
  description:
    'Track aviation regulatory documents, manage versions, and generate AI-assisted change comparisons to assess compliance impact.',
  icons: {
    icon: [{ url: 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/plane.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/plane.svg" />
</head>
      <body>
        <AuthProvider>
          <RoleProvider>{children}</RoleProvider>
        </AuthProvider>
        <Toaster richColors position="top-right" />
</body>
    </html>
  );
}