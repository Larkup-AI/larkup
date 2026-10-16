import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { buttonVariants } from '@larkup/workspace-ui';
import { type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
