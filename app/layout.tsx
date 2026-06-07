import type {Metadata, Viewport} from 'next';
import { Inter, Syncopate } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const syncopate = Syncopate({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-syncopate' });

export const metadata: Metadata = {
  title: 'Hundler VPN',
  description: 'Премиум VPN с протоколом VLESS + Reality. Скорость, анонимность и обход блокировок.',
  icons: {
    icon: [
      { url: '/tiger-source.png', type: 'image/png' },
    ],
    apple: '/tiger-source.png',
    shortcut: '/tiger-source.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${syncopate.variable} dark`}>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      </head>
      <body className="bg-black text-white font-sans antialiased selection:bg-white/20" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
