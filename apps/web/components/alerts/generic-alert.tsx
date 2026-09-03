'use client';

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface GenericAlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  cancelText?: React.ReactNode;
  actionText?: React.ReactNode;
  onAction?: () => void;
  variant?: 'default' | 'destructive';
  icon?: React.ReactNode;
  contentClassName?: string;
}

export function GenericAlert({
  open,
  onOpenChange,
  title,
  description,
  cancelText = 'Cancel',
  actionText = 'Continue',
  onAction,
  variant = 'default',
  icon,
  contentClassName,
}: GenericAlertProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={contentClassName}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {icon}
            {title}
          </AlertDialogTitle>
          {typeof description === 'string' ? (
            <AlertDialogDescription className="whitespace-pre-wrap">
              {description}
            </AlertDialogDescription>
          ) : description ? (
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (onAction) onAction();
              onOpenChange(false);
            }}
            className={cn(
              variant === 'destructive' &&
                'bg-destructive text-white hover:bg-destructive/90 gap-2',
            )}
          >
            {actionText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
