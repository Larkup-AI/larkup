import { cn } from "@/lib/utils";
import { EmbeddingProvider } from "@larkup/core/types";

export type ProviderMeta = {
  label: string;
  iconSrc: string;
  pillBg: string;
};

export const PROVIDER_META: Record<EmbeddingProvider, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    iconSrc: "/icons/openai.svg",
    pillBg: "bg-neutral-100 dark:bg-neutral-800",
  },
  google: {
    label: "Google",
    iconSrc: "/icons/gemini.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  cohere: {
    label: "Cohere",
    iconSrc: "/icons/cohere.svg",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
  },
  voyage: {
    label: "Voyage AI",
    iconSrc: "/icons/voyage-light.png",
    pillBg: "bg-slate-100 dark:bg-slate-800",
  },
  mistral: {
    label: "Mistral",
    iconSrc: "/icons/mistral.svg",
    pillBg: "bg-amber-50 dark:bg-amber-950/40",
  },
  jina: {
    label: "Jina AI",
    iconSrc: "/icons/jina.svg",
    pillBg: "bg-rose-50 dark:bg-rose-950/40",
  },
  nomic: {
    label: "Nomic",
    iconSrc: "/icons/nomic.png",
    pillBg: "bg-teal-50 dark:bg-teal-950/40",
  },
  custom: {
    label: "Custom",
    iconSrc: "/logo.png",
    pillBg: "bg-slate-100 dark:bg-slate-800",
  },
  vercel_ai_gateway: {
    label: "Vercel AI Gateway",
    iconSrc: "/icons/vercel.svg",
    pillBg: "bg-white dark:bg-white text-white dark:text-black",
  },
  deepseek: {
    label: "DeepSeek",
    iconSrc: "/logo.png", // Replace with DeepSeek icon if available
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
};

export function ProviderIcon({
  src,
  alt,
  pillBg,
  size = 20,
}: {
  src: string;
  alt: string;
  pillBg: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded",
        pillBg,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          width={size - 4}
          height={size - 4}
          className="object-contain"
          style={{ maxWidth: size - 4, maxHeight: size - 4 }}
        />
      ) : null}
    </span>
  );
}
