'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PROVIDER_META, ProviderIcon } from '@/components/ui/provider-icon';
import { CustomModelForm } from '@/components/configure/custom-model-modal';
import { useRouter } from 'next/navigation';
import type { CustomModelConfig } from '@larkup/core/types';

// Providers shown in the welcome screen dropdowns
const WELCOME_PROVIDERS = ['vercel_ai_gateway', 'openai', 'google', 'mistral', 'custom'] as const;

export function WelcomeScreen() {
  const { setUsername, createServer, refresh } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState('');

  // Embedding state
  const [embeddingProvider, setEmbeddingProvider] = useState<string>('vercel_ai_gateway');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [embeddingCustomConfig, setEmbeddingCustomConfig] = useState<CustomModelConfig | null>(
    null,
  );

  // Chat state
  const [chatProvider, setChatProvider] = useState<string>('vercel_ai_gateway');
  const [chatApiKey, setChatApiKey] = useState('');
  const [chatCustomConfig, setChatCustomConfig] = useState<CustomModelConfig | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [showSeparateChat, setShowSeparateChat] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState<'embedding' | 'chat' | null>(null);

  const isCustomEmbedding = embeddingProvider === 'custom';
  const isCustomChat = chatProvider === 'custom';

  const sharedKey = !showSeparateChat && !isCustomEmbedding && embeddingProvider === chatProvider;

  const effectiveChatApiKey = sharedKey ? embeddingApiKey : chatApiKey;

  const canContinue = () => {
    // Must have embedding configured
    if (isCustomEmbedding) {
      if (!embeddingCustomConfig) return false; // Must be verified via modal
    } else if (!embeddingApiKey) {
      return false;
    }

    // If separate chat is shown, check chat config
    if (showSeparateChat) {
      if (isCustomChat) {
        if (!chatCustomConfig) return false; // Must be verified via modal
      } else if (!effectiveChatApiKey) {
        return false;
      }
    }

    return true;
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      // Build config payload first (before creating server)
      const configRes = await fetch('/api/config');
      const { config } = await configRes.json();

      const payload: Record<string, any> = { ...config };

      if (isCustomEmbedding && embeddingCustomConfig) {
        payload.embeddingProvider = 'custom';
        payload.embeddingModelId = `custom:${embeddingCustomConfig.modelName}`;
        payload.embeddingApiKey = embeddingCustomConfig.apiKey || undefined;
        payload.customEmbeddings = [embeddingCustomConfig];
      } else {
        payload.embeddingProvider = embeddingProvider;
        payload.embeddingApiKey = embeddingApiKey;
      }

      if (showSeparateChat) {
        if (isCustomChat && chatCustomConfig) {
          payload.chatProvider = 'custom';
          payload.chatModelId = `custom:${chatCustomConfig.modelName}`;
          payload.chatApiKey = chatCustomConfig.apiKey || undefined;
          payload.customChatModels = [chatCustomConfig];
        } else {
          payload.chatProvider = chatProvider;
          payload.chatApiKey = effectiveChatApiKey;
        }
      } else {
        // Mirror embedding provider for chat
        if (isCustomEmbedding && embeddingCustomConfig) {
        } else {
          payload.chatProvider = embeddingProvider;
          payload.chatApiKey = embeddingApiKey;
        }
      }

      const verifyRes = await fetch('/api/config/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeddingProvider: payload.embeddingProvider,
          embeddingApiKey: payload.embeddingApiKey,
          embeddingModelId: payload.embeddingModelId,
          customEmbeddings: payload.customEmbeddings,
          chatProvider: payload.chatProvider,
          chatApiKey: payload.chatApiKey,
          chatModelId: payload.chatModelId,
          customChatModels: payload.customChatModels,
        }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        toast.error(err.error || 'Verification failed — please check your API key.', {
          duration: 8000,
        });
        setSaving(false);
        return;
      }

      if (name.trim()) {
        await setUsername(name.trim());
      }

      await createServer('My Project');

      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      refresh();
      router.push('/chat');
    } catch (error) {
      toast.error('Failed to complete setup');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      if (name.trim()) {
        await setUsername(name.trim());
      }

      // Create a default server so isFirstRun becomes false
      await createServer('My Project');

      refresh();
      router.push('/chat');
    } catch (error) {
      toast.error('Failed to complete setup');
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (value: string, target: 'embedding' | 'chat') => {
    if (value === 'custom') {
      // Open modal for test connection flow
      if (target === 'embedding') {
        setEmbeddingProvider('custom');
      } else {
        setChatProvider('custom');
      }
      setCustomModalOpen(target);
    } else {
      if (target === 'embedding') {
        setEmbeddingProvider(value);
        setEmbeddingCustomConfig(null);
        // Sync chat provider if not separately configured
        if (!showSeparateChat) {
          setChatProvider(value);
        }
      } else {
        setChatProvider(value);
        setChatCustomConfig(null);
      }
    }
  };

  const handleCustomModelSave = (cfg: CustomModelConfig) => {
    if (customModalOpen === 'embedding') {
      setEmbeddingCustomConfig(cfg);
      setEmbeddingProvider('custom');
    } else if (customModalOpen === 'chat') {
      setChatCustomConfig(cfg);
      setChatProvider('custom');
    }
    setCustomModalOpen(null);
  };

  const renderProviderSelect = (value: string, target: 'embedding' | 'chat') => (
    <Select value={value} onValueChange={(val) => handleProviderChange(val ?? '', target)}>
      <SelectTrigger className="w-full bg-white/90 hover:bg-white">
        <span className="flex items-center gap-2">
          {PROVIDER_META[value as keyof typeof PROVIDER_META] ? (
            <>
              <ProviderIcon
                src={PROVIDER_META[value as keyof typeof PROVIDER_META].iconSrc}
                alt={PROVIDER_META[value as keyof typeof PROVIDER_META].label}
                pillBg={PROVIDER_META[value as keyof typeof PROVIDER_META].pillBg}
                size={16}
              />
              {PROVIDER_META[value as keyof typeof PROVIDER_META].label}
            </>
          ) : (
            'Select provider'
          )}
        </span>
      </SelectTrigger>
      <SelectContent>
        {WELCOME_PROVIDERS.map((key) => {
          const meta = PROVIDER_META[key as keyof typeof PROVIDER_META];
          if (!meta) return null;
          return (
            <SelectItem key={key} value={key}>
              <div className="flex items-center gap-2">
                <ProviderIcon src={meta.iconSrc} alt={meta.label} pillBg={meta.pillBg} size={16} />
                <span>
                  {meta.label}
                  {key === 'vercel_ai_gateway' && ' (Recommended)'}
                  {key === 'custom' && ' (OpenAI-compatible)'}
                </span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );

  /** Pill showing a verified custom model with edit button */
  const renderCustomBadge = (config: CustomModelConfig, target: 'embedding' | 'chat') => (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50/50 px-3 py-2">
      <span className="text-green-600 text-xs">✓</span>
      <span className="flex-1 truncate text-xs font-medium text-foreground">
        {config.modelName}
      </span>
      <button
        type="button"
        onClick={() => setCustomModalOpen(target)}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="size-3" />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full bg-stone-200/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-32 h-[600px] w-[600px] rounded-full bg-amber-100/30 blur-3xl animate-pulse [animation-delay:1s]" />
      </div>

      <div className="relative z-10 flex min-h-full w-full flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-lg flex-col items-center gap-8 animate-fade-up">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground ">
              <img src="/logo9.png" className="size-8" alt="Larkup" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Welcome to Larkup
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Let&apos;s set up your AI models. You can change these later in Settings.
              </p>
            </div>
          </div>

          <div className="w-full space-y-5 rounded-2xl p-6 backdrop-blur-xl">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Your Name (Optional)</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="How should we call you?"
                className="bg-background/50"
              />
            </div>

            {/* Embedding Provider */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Embedding Provider</label>
              {renderProviderSelect(embeddingProvider, 'embedding')}
              {isCustomEmbedding &&
                embeddingCustomConfig &&
                renderCustomBadge(embeddingCustomConfig, 'embedding')}
              {isCustomEmbedding && !embeddingCustomConfig && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Please configure and test your custom model to continue.
                </p>
              )}
            </div>

            {/* API Key — shown for all non-custom providers */}
            {!isCustomEmbedding && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  API Key
                  {!showSeparateChat && (
                    <span className="text-muted-foreground font-normal">
                      {' '}
                      (used for both embedding & chat)
                    </span>
                  )}
                </label>
                <Input
                  type="password"
                  value={embeddingApiKey}
                  onChange={(e) => setEmbeddingApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="bg-background/50"
                />
              </div>
            )}

            {/* Toggle for separate chat provider */}
            <button
              type="button"
              onClick={() => setShowSeparateChat(!showSeparateChat)}
              className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showSeparateChat ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              Use a different chat model
            </button>

            {/* Chat Provider (when expanded) */}
            {showSeparateChat && (
              <div className="space-y-3 rounded-xl border border-border/40 bg-muted/20 p-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Chat Provider</label>
                  {renderProviderSelect(chatProvider, 'chat')}
                  {isCustomChat && chatCustomConfig && renderCustomBadge(chatCustomConfig, 'chat')}
                  {isCustomChat && !chatCustomConfig && (
                    <p className="text-[11px] text-amber-600 mt-1">
                      Please configure and test your custom model to continue.
                    </p>
                  )}
                </div>

                {/* Chat API Key — shown for all non-custom providers */}
                {!isCustomChat && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Chat API Key</label>
                    <Input
                      type="password"
                      value={chatApiKey}
                      onChange={(e) => setChatApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="bg-background/50"
                    />
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              More providers and fine-grained model selection available in Settings → AI Models.
            </p>

            {/* Buttons */}
            <div className="pt-2 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleSkip} disabled={saving}>
                Skip for now
              </Button>
              <Button
                className="flex-1"
                onClick={handleComplete}
                disabled={saving || !canContinue()}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Continue <ArrowRight className="ml-1.5 size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Model Dialog — uses the existing CustomModelForm with Test Connection */}
      <Dialog
        open={customModalOpen !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (customModalOpen === 'embedding' && !embeddingCustomConfig) {
              setEmbeddingProvider('vercel_ai_gateway');
            }
            if (customModalOpen === 'chat' && !chatCustomConfig) {
              setChatProvider('vercel_ai_gateway');
            }
            setCustomModalOpen(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Custom {customModalOpen === 'embedding' ? 'Embedding' : 'Chat'} Model
            </DialogTitle>
            <DialogDescription>
              Connect an OpenAI-compatible {customModalOpen === 'embedding' ? 'embedding' : 'chat'}{' '}
              model. Test the connection before adding.
            </DialogDescription>
          </DialogHeader>
          {customModalOpen && (
            <CustomModelForm
              type={customModalOpen}
              onSave={handleCustomModelSave}
              onCancel={() => {
                if (customModalOpen === 'embedding' && !embeddingCustomConfig) {
                  setEmbeddingProvider('vercel_ai_gateway');
                }
                if (customModalOpen === 'chat' && !chatCustomConfig) {
                  setChatProvider('vercel_ai_gateway');
                }
                setCustomModalOpen(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
