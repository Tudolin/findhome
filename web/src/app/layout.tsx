import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FindHome',
  description: 'Self-hosted real estate search aggregator with collaborative Party Mode.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the neumorphic surface so mobile browser chrome blends with the page.
  themeColor: '#eef3e8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
