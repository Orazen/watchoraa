import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

// A badge's border is often its only visible edge (the neutral badge sits on
// bg-muted, ~1.05:1 against a card), so the border carries the badge boundary
// and must clear SC 1.4.11. At the old opacities it measured 1.71-2.80:1.
// Every tone now sits at /70 so the map has one predictable border strength.
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-0.5 text-sm font-semibold leading-6',
  {
    variants: {
      tone: {
        neutral: 'border-foreground/70 bg-muted text-foreground',
        info: 'border-info/70 bg-info text-info-foreground',
        success: 'border-success/70 bg-success text-success-foreground',
        warning: 'border-warning/70 bg-warning text-warning-foreground',
        danger: 'border-destructive/70 bg-destructive text-destructive-foreground',
        outline: 'border-foreground/70 bg-transparent text-foreground',
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
