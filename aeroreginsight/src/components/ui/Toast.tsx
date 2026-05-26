'use client';
import { Toaster } from 'sonner';

export default function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '14px',
        },
        duration: 3500,
      }}
    />
  );
}