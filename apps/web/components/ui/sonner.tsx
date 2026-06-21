"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group z-9999999!"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          zIndex: 999999,
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:bg-[#0070f3] group-[.toaster]:text-white group-[.toaster]:border-[#0070f3] [&>div>svg]:text-white",
          error:
            "group-[.toaster]:bg-[#ee0000] group-[.toaster]:text-white group-[.toaster]:border-[#ee0000] [&>div>svg]:text-white",
          warning:
            "group-[.toaster]:bg-[#f5a623] group-[.toaster]:text-black group-[.toaster]:border-[#f5a623] [&>div>svg]:text-black",
          info: "group-[.toaster]:bg-[#0070f3] group-[.toaster]:text-white group-[.toaster]:border-[#0070f3] [&>div>svg]:text-white",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
