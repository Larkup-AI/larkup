'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { CircleCheckIcon, InfoIcon, CircleAlertIcon, CircleXIcon, Loader2Icon } from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      closeButton
      theme={theme as ToasterProps['theme']}
      className="toaster group z-9999999! "
      icons={{
        success: <CircleCheckIcon className="size-5 text-white" fill="#10b981" />,
        info: <InfoIcon className="size-5 text-white" fill="#3b82f6" />,
        warning: <CircleAlertIcon className="size-5 text-white" fill="#f59e0b" />,
        error: <CircleXIcon className="size-5 text-white" fill="#ef4444" />,
        loading: <Loader2Icon className="size-5 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          zIndex: 999999,
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            'group toast items-start group-[.toaster]:!bg-[#F9F9F7] dark:group-[.toaster]:!bg-zinc-900 group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:',
          icon: 'mt-0.5',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          success: 'group-[.toaster]:!bg-[#F9F9F7] dark:group-[.toaster]:!bg-zinc-900',
          error: 'group-[.toaster]:!bg-[#F9F9F7] dark:group-[.toaster]:!bg-zinc-900',
          warning: 'group-[.toaster]:!bg-[#F9F9F7] dark:group-[.toaster]:!bg-zinc-900',
          info: 'group-[.toaster]:!bg-[#F9F9F7] dark:group-[.toaster]:!bg-zinc-900',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
