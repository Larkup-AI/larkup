import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { WorkspaceTopBar } from "@/components/workspace/workspace-top-bar";
import { OnboardingDialog } from "@/components/workspace/onboarding-dialog";
import { ThemeCustomizerProvider } from "@/components/theme-customizer-provider";
import { ClientLayoutWrapper } from "@/components/client-layout-wrapper";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "larkup-rag",
  description:
    "larkup-rag — a dual-mode (Web + CLI) toolkit to build, index, and serve a lightweight, deployable RAG pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} bg-transparent`}
    >
      <body className="font-sans antialiased ">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('app-theme');var b=localStorage.getItem('app-background');var r=localStorage.getItem('app-radius');var d=document.body;if(t&&t!=='default')d.classList.add(t);if(b)d.classList.add(b);if(r&&r!=='radius-default')d.classList.add(r);}catch(e){}})();`,
          }}
        />
        <ThemeCustomizerProvider>
          <WorkspaceProvider>
            <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
            <Toaster position="bottom-right" />
            <OnboardingDialog />
          </WorkspaceProvider>
        </ThemeCustomizerProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
