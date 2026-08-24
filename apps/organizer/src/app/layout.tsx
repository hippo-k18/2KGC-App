import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KGC EMS',
  description: 'Organizer dashboard for the Knowledge Graph Conference. Internal.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
