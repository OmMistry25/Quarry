import type { ReactNode } from 'react';

import './globals.css';

export const metadata = {
  title: 'Quarry',
  description: 'Generate a role-specific, verified take-home from a GitHub repo.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
