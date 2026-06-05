import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { WorkspaceTopBar } from "@/components/workspace/workspace-top-bar";
import { OnboardingDialog } from "@/components/workspace/onboarding-dialog";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "buddy-rag",
  description:
    "buddy-rag — a dual-mode (Web + CLI) toolkit to build, index, and serve a lightweight, deployable RAG pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <WorkspaceProvider>
          <div className="flex min-h-screen bg-background">
            <AppSidebar />
            <main className="min-w-0 flex-1 p-3 pl-3 md:pl-0">
              <div className="min-h-[calc(100vh-1.5rem)] rounded-2xl border border-border bg-panel text-panel-foreground shadow-sm">
                <WorkspaceTopBar />
                {children}
              </div>
            </main>
          </div>
          <OnboardingDialog />
        </WorkspaceProvider>
        <Toaster position="bottom-right" />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
