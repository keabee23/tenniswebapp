import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Serve Sync',
  description: 'Auto-align tennis serve videos at the contact point',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
