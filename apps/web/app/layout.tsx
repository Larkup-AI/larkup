import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { WorkspaceProvider } from '@/components/workspace/workspace-provider';
import { ThemeCustomizerProvider } from '@/components/theme-customizer-provider';
import { ClientLayoutWrapper } from '@/components/client-layout-wrapper';
import { GlobalIndexProgress } from '@/components/index/global-index-progress';
import { UpdateBanner } from '@/components/update-banner';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'larkup',
  description:
    'larkup — a toolkit to build, index, and serve your own AI model and knowledge base.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} bg-transparent`}
    >
      <body suppressHydrationWarning className="font-sans antialiased ">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('app-theme');var b=localStorage.getItem('app-background');var r=localStorage.getItem('app-radius');var d=document.body;if(t&&t!=='default')d.classList.add(t);if(b)d.classList.add(b);if(r&&r!=='radius-default')d.classList.add(r);}catch(e){}})();`,
          }}
        />
        <UpdateBanner />
        <ThemeCustomizerProvider>
          <WorkspaceProvider>
            <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
            <Toaster position="bottom-left" />
            <GlobalIndexProgress />
          </WorkspaceProvider>
        </ThemeCustomizerProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  );
}
