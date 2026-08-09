import * as React from 'react';
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { PROVIDER_META, ProviderIcon } from '@/components/ui/provider-icon';

export function ModelCombobox({
  value,
  onValueChange,
  items,
  groups,
  customModels,
  isOther,
  onOtherChange,
  placeholder = 'Select model...',
}: {
  value: string;
  onValueChange: (val: string) => void;
  items?: { id: string; label: string; provider?: string; dimensions?: number }[];
  groups?: Record<string, { id: string; label: string; dimensions?: number }[]>;
  customModels?: { modelName: string; dimensions?: number }[];
  isOther?: boolean;
  onOtherChange?: (val: boolean) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const flatModels = useMemo(() => {
    if (items) return items;
    if (groups) return Object.values(groups).flat();
    return [];
  }, [items, groups]);

  const allCustom = useMemo(
    () =>
      customModels?.map((c) => ({
        id: `custom:${c.modelName}`,
        label: c.modelName,
        provider: 'custom',
        dimensions: c.dimensions,
      })) || [],
    [customModels],
  );
  const allModels = [...flatModels, ...allCustom];

  const selectedModel = isOther
    ? { id: 'other', label: 'Other...' }
    : allModels.find((m) => m.id === value);
  const displayLabel = isOther ? 'Other...' : selectedModel?.label || value || placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            className="w-full h-10 justify-between font-normal bg-background"
          />
        }
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>

            {groups &&
              Object.entries(groups).map(([provider, models]) => {
                const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
                return (
                  <CommandGroup
                    key={provider}
                    heading={
                      <div className="flex items-center gap-2">
                        {meta && (
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg}
                            size={14}
                          />
                        )}
                        <span>{meta?.label ?? provider}</span>
                      </div>
                    }
                  >
                    {models.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        keywords={[m.label]}
                        onSelect={() => {
                          onValueChange(m.id);
                          onOtherChange?.(false);
                          setOpen(false);
                        }}
                      >
                        <span className="flex-1 truncate">{m.label}</span>
                        {m.dimensions && (
                          <span className="text-[10px] text-muted-foreground font-mono ml-2">
                            {m.dimensions}d
                          </span>
                        )}
                        <Check
                          className={cn(
                            'ml-auto size-4',
                            value === m.id && !isOther ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}

            {items && (
              <CommandGroup>
                {items.map((m) => {
                  const meta = m.provider
                    ? PROVIDER_META[m.provider as keyof typeof PROVIDER_META]
                    : null;
                  return (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      keywords={[m.label]}
                      onSelect={() => {
                        onValueChange(m.id);
                        onOtherChange?.(false);
                        setOpen(false);
                      }}
                    >
                      {meta && (
                        <ProviderIcon
                          src={meta.iconSrc}
                          alt={meta.label}
                          pillBg={meta.pillBg}
                          size={14}
                        />
                      )}
                      <span className="flex-1 truncate">{m.label}</span>
                      {m.dimensions && (
                        <span className="text-[10px] text-muted-foreground font-mono ml-2">
                          {m.dimensions}d
                        </span>
                      )}
                      <Check
                        className={cn(
                          'ml-auto size-4',
                          value === m.id && !isOther ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {allCustom.length > 0 && (
              <CommandGroup
                heading={
                  <div className="flex items-center gap-2">
                    <ProviderIcon
                      src={PROVIDER_META.custom.iconSrc}
                      alt="Custom"
                      pillBg={PROVIDER_META.custom.pillBg}
                      size={14}
                    />
                    <span>Custom</span>
                  </div>
                }
              >
                {allCustom.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.id}
                    keywords={[m.label]}
                    onSelect={() => {
                      onValueChange(m.id);
                      onOtherChange?.(false);
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1 truncate">{m.label}</span>
                    {m.dimensions && (
                      <span className="text-[10px] text-muted-foreground font-mono ml-2">
                        {m.dimensions}d
                      </span>
                    )}
                    <Check
                      className={cn(
                        'ml-auto size-4',
                        value === m.id && !isOther ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {onOtherChange && (
              <CommandGroup>
                <CommandItem
                  value="other"
                  onSelect={() => {
                    onOtherChange(true);
                    setOpen(false);
                  }}
                >
                  Other...
                  <Check className={cn('ml-auto size-4', isOther ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
