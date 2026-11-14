import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Video Benchmark Dashboard',
  description:
    'Local, mock-first dashboard for the Video Intelligence benchmark controller (API v1).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
