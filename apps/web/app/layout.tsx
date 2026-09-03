import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { ProjectProvider } from '@/components/projects/project-provider';
import { ThemeCustomizerProvider } from '@/components/theme-customizer-provider';
import { ClientLayoutWrapper } from '@/components/client-layout-wrapper';
import { GlobalIndexProgress } from '@/components/index/global-index-progress';
import { GpuActivityIndicator } from '@/components/chat/gpu-activity-indicator';
import { UpdateBanner } from '@/components/update-banner';
import { ThemeProvider } from 'next-themes';

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
    <html lang="en" suppressHydrationWarning className="bg-transparent">
      <body suppressHydrationWarning className="theme-gaia font-sans antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('app-theme');var d=document.body;if(!t)return;d.classList.remove('theme-larkup','theme-gaia','theme-linear');if(t!=='default')d.classList.add(t);}catch(e){}})();`,
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <UpdateBanner />
          <ThemeCustomizerProvider>
            <ProjectProvider>
              <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
              <Toaster position="bottom-right" />
              <GlobalIndexProgress />
              <GpuActivityIndicator />
            </ProjectProvider>
          </ThemeCustomizerProvider>
        </ThemeProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  );
}
