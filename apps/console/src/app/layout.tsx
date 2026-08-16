import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KGC organizer console',
  description: 'Organizer console for Knowledge Graph Conference. Internal.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
