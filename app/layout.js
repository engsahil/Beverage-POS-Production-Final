import './globals.css';
import { Inter } from 'next/font/google';
import { ToastProvider } from '@/components/Toast';
import SwRegister from '@/components/SwRegister';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'Beverage POS',
  description: 'Simple, reliable beverage point of sale',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Beverage POS',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport = {
  themeColor: '#F5F6F0',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-cream font-sans text-stone-800 antialiased">
        <ToastProvider>{children}</ToastProvider>
        <SwRegister />
      </body>
    </html>
  );
}
