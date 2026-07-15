import { cn } from "@/lib/utils";

export type ProviderMeta = {
  label: string;
  iconSrc: string;
  pillBg: string;
};

/** Maps provider IDs → display metadata. Uses models.dev for providers we don't have local icons for. */
export const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    iconSrc: "/icons/openai.svg",
    pillBg: "bg-neutral-100 dark:bg-neutral-800",
  },
  anthropic: {
    label: "Anthropic",
    iconSrc: "https://models.dev/logos/anthropic.svg",
    pillBg: "bg-amber-50 dark:bg-amber-950/40",
  },
  google: {
    label: "Google",
    iconSrc: "/icons/gemini.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  meta: {
    label: "Meta",
    iconSrc: "https://models.dev/logos/meta.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  mistral: {
    label: "Mistral",
    iconSrc: "/icons/mistral.svg",
    pillBg: "bg-amber-50 dark:bg-amber-950/40",
  },
  cohere: {
    label: "Cohere",
    iconSrc: "/icons/cohere.svg",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
  },
  deepseek: {
    label: "DeepSeek",
    iconSrc: "https://models.dev/logos/deepseek.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  amazon: {
    label: "Amazon",
    iconSrc: "/icons/aws.svg",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
  },
  xai: {
    label: "xAI",
    iconSrc: "https://models.dev/logos/xai.svg",
    pillBg: "bg-neutral-100 dark:bg-neutral-800",
  },
  perplexity: {
    label: "Perplexity",
    iconSrc: "https://models.dev/logos/perplexity.svg",
    pillBg: "bg-teal-50 dark:bg-teal-950/40",
  },
  alibaba: {
    label: "Alibaba",
    iconSrc: "https://models.dev/logos/alibaba.svg",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
  },
  groq: {
    label: "Groq",
    iconSrc: "https://models.dev/logos/groq.svg",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
  },
  "together-ai": {
    label: "Together AI",
    iconSrc: "https://models.dev/logos/together-ai.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  fireworks: {
    label: "Fireworks",
    iconSrc: "https://models.dev/logos/fireworks.svg",
    pillBg: "bg-purple-50 dark:bg-purple-950/40",
  },
  cerebras: {
    label: "Cerebras",
    iconSrc: "https://models.dev/logos/cerebras.svg",
    pillBg: "bg-green-50 dark:bg-green-950/40",
  },
  voyage: {
    label: "Voyage AI",
    iconSrc: "/icons/voyage-light.png",
    pillBg: "bg-slate-100 dark:bg-slate-800",
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
  minimax: {
    label: "MiniMax",
    iconSrc: "https://models.dev/logos/minimax.svg",
    pillBg: "bg-blue-50 dark:bg-blue-950/40",
  },
  elevenlabs: {
    label: "ElevenLabs",
    iconSrc: "https://models.dev/logos/elevenlabs.svg",
    pillBg: "bg-neutral-100 dark:bg-neutral-800",
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
};

/** Look up provider meta, with a sensible fallback for unknown providers. */
export function getProviderMeta(providerId: string): ProviderMeta {
  return (
    PROVIDER_META[providerId] ?? {
      label: providerId.charAt(0).toUpperCase() + providerId.slice(1),
      iconSrc: `https://models.dev/logos/${providerId}.svg`,
      pillBg: "bg-slate-100 dark:bg-slate-800",
    }
  );
}

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
