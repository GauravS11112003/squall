import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Squall: see the outage in the tickets',
  description:
    'Squall reads incoming service-desk tickets with the Clocked API, groups the ones that report the same fault, and declares the major incident while it is still forming.',
};

export const viewport: Viewport = { themeColor: '#142733', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
