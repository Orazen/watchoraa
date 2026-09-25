import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

/**
 * reUI-style button variants tuned for Watchora's blind/low-vision users:
 * every interactive size keeps a >=44px touch target, focus rings are always
 * visible, and the 2px ink border is part of the brand's high-contrast
 * signature (never purely decorative).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none ' +
    'transition-[background-color,border-color,color,box-shadow] duration-150 ' +
    'border-2 border-foreground/90 rounded-lg ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
    'disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:brightness-110 active:brightness-95 shadow-sm',
        secondary: 'bg-secondary text-secondary-foreground hover:brightness-105 active:brightness-95',
        outline: 'bg-card text-foreground hover:bg-muted active:bg-muted/80',
        ghost: 'bg-transparent border-transparent text-foreground hover:bg-muted active:bg-muted/80',
        destructive: 'bg-destructive text-destructive-foreground hover:brightness-110 active:brightness-95',
        link: 'bg-transparent border-transparent text-primary underline underline-offset-4 hover:brightness-110',
      },
      size: {
        sm: 'h-9 px-3 text-sm min-w-11',
        md: 'h-11 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
        xl: 'h-14 px-8 text-lg font-semibold',
        icon: 'h-11 w-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
