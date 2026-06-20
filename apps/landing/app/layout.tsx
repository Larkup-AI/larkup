import { Geist, Geist_Mono, Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { Metadata } from "next"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "LarkupRAG — RAG Pipeline Made Simple",
  description:
    "Build, index, and deploy production-ready RAG pipelines in minutes. From data ingestion to deployment — configure, chunk, embed, and serve with zero friction.",
  keywords:
    "RAG, retrieval augmented generation, vector database, AI pipeline, LLM, embeddings, deployment, Pinecone, LanceDB, Qdrant",
  openGraph: {
    title: "LarkupRAG — RAG Pipeline Made Simple",
    description:
      "Build, index, and deploy production-ready RAG pipelines in minutes.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        // fontMono.className,
        // "font-sans",
        inter.className,
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
