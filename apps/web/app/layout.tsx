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
      className={`${geistSans.variable} ${geistMono.variable} bg-transparent`}
    >
      <body className="font-sans antialiased">
        <ThemeCustomizerProvider>
          <WorkspaceProvider>
            <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
            <OnboardingDialog />
          </WorkspaceProvider>
        </ThemeCustomizerProvider>
        <Toaster position="bottom-right" />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
