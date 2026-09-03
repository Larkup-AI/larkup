'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { calculateToolIndexingEstimate } from '@/lib/media/tool-indexing-estimate';

export type ToolIndexingField = {
  key: string;
  type: 'textarea' | 'select' | 'checkbox';
  label: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string | boolean;
  options?: Array<{
    label: string;
    value: string;
    description?: string;
    setValues?: Record<string, string | boolean>;
  }>;
  requiredWhen?: { field: string; equals: string | boolean };
};

export type ToolIndexingSurface = {
  id: string;
  slot: 'data-indexing';
  title: string;
  description?: string;
  appliesTo: Array<'image' | 'video' | 'audio'>;
  form: { submitLabel?: string; fields: ToolIndexingField[] };
  estimate?: {
    modeField: string;
    variants: Array<{
      value: string;
      analyzedFramesPerSourceMinute: number;
      ocrFramesPerSourceMinute: number;
      processingSecondsPerSourceMinute: number;
      maxProcessingSecondsPerSourceMinute?: number;
      fixedOverheadSeconds?: number;
      maxFixedOverheadSeconds?: number;
      creditsPerSourceMinute: number;
    }>;
  };
};

export function defaultToolIndexingValues(surface: ToolIndexingSurface) {
  return Object.fromEntries(
    surface.form.fields.map((field) => [
      field.key,
      field.defaultValue ?? (field.type === 'checkbox' ? false : ''),
    ]),
  ) as Record<string, string | boolean>;
}

export function ToolIndexingDialog({
  surface,
  open,
  values,
  submitting,
  sourceDurationSecs,
  onOpenChange,
  onChange,
  onConfirm,
}: {
  surface: ToolIndexingSurface | null;
  open: boolean;
  values: Record<string, string | boolean>;
  submitting: boolean;
  sourceDurationSecs?: number;
  onOpenChange: (open: boolean) => void;
  onChange: (key: string, value: string | boolean) => void;
  onConfirm: () => void;
}) {
  if (!surface) return null;
  const estimate = surface.estimate?.variants.find(
    (variant) => values[surface.estimate?.modeField ?? ''] === variant.value,
  );
  const calculatedEstimate = calculateToolIndexingEstimate(estimate, sourceDurationSecs);
  const incompleteRequiredField = surface.form.fields.some((field) => {
    if (!field.requiredWhen) return false;
    return (
      values[field.requiredWhen.field] === field.requiredWhen.equals && values[field.key] !== true
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{surface.title}</DialogTitle>
        </DialogHeader>
        {surface.description && (
          <p className="text-sm text-muted-foreground">{surface.description}</p>
        )}
        {estimate && (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-xs">
            <EstimateMetric
              label="Typical range"
              value={`~${calculatedEstimate?.minimumMinutes}${
                calculatedEstimate?.maximumMinutes !== calculatedEstimate?.minimumMinutes
                  ? `–${calculatedEstimate?.maximumMinutes}`
                  : ''
              } min`}
            />
            <EstimateMetric label="Estimated credits" value={`~${calculatedEstimate?.credits}`} />
          </div>
        )}
        {estimate?.fixedOverheadSeconds && (
          <p className="text-xs text-muted-foreground">
            Includes typical cloud startup. Worker progress replaces this range after the job
            starts; queued capacity or provider retries can take longer.
          </p>
        )}
        <div className="space-y-4 py-1">
          {surface.form.fields.map((field) => {
            const value = values[field.key];
            const selectedOption = field.options?.find((option) => option.value === value);
            if (field.type === 'checkbox') {
              return (
                <div
                  key={field.key}
                  className="flex items-start justify-between gap-4 rounded-lg border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{field.label}</p>
                    {field.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={value === true}
                    onCheckedChange={(checked) => onChange(field.key, checked)}
                    aria-label={field.label}
                  />
                </div>
              );
            }
            return (
              <div key={field.key} className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor={`${surface.id}-${field.key}`}>
                  {field.label}
                </label>
                {field.description && (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
                {field.type === 'select' ? (
                  <>
                    <select
                      id={`${surface.id}-${field.key}`}
                      value={String(value ?? '')}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        const option = field.options?.find((item) => item.value === nextValue);
                        onChange(field.key, nextValue);
                        for (const [key, companionValue] of Object.entries(
                          option?.setValues ?? {},
                        )) {
                          onChange(key, companionValue);
                        }
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {selectedOption?.description && (
                      <p className="text-xs text-muted-foreground">{selectedOption.description}</p>
                    )}
                  </>
                ) : (
                  <Textarea
                    id={`${surface.id}-${field.key}`}
                    value={String(value ?? '')}
                    onChange={(event) => onChange(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    rows={5}
                    className="min-h-28 resize-y bg-white dark:bg-background"
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting || incompleteRequiredField}>
            {surface.form.submitLabel ?? 'Index media'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EstimateMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}
