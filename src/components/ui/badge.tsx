import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-0.5 text-sm font-semibold leading-6',
  {
    variants: {
      tone: {
        neutral: 'border-foreground/25 bg-muted text-foreground',
        info: 'border-info/40 bg-info text-info-foreground',
        success: 'border-success/40 bg-success text-success-foreground',
        warning: 'border-warning/50 bg-warning text-warning-foreground',
        danger: 'border-destructive/50 bg-destructive text-destructive-foreground',
        outline: 'border-foreground/60 bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(({ className, tone, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />
));
Badge.displayName = 'Badge';
