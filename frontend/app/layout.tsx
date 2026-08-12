import type { Metadata } from 'next';
import { Hanken_Grotesk, Inter } from 'next/font/google';
import { QueryProvider } from '@/lib/query-client';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'University Club Management',
  description: 'Multi-tenant club & event management platform',
};

// Runs before hydration so the correct theme paints on first frame.
const themeInitScript = `
try {
  var t = localStorage.getItem('ucm-theme');
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <QueryProvider>{children}</QueryProvider>
        {/* Mounted once at the root — confirmations for actions whose result
            isn't otherwise visible on screen (registering, cancelling,
            submitting feedback). */}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
