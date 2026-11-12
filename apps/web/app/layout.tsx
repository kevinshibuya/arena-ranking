import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from './site-footer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arena Ranking',
  description: 'Stats and a community ladder for League of Legends Arena, Brazil server.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-white text-neutral-900 antialiased">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
