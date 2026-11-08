import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'TivaroMarket',
  description: 'Badania rynku przez AI, decyzje, paper trading i ciągły forward test.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 min-w-0 px-4 py-5 md:px-8 md:py-7">{children}</main>
        </div>
      </body>
    </html>
  );
}
