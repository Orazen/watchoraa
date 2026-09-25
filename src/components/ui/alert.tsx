import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const alertVariants = cva('relative w-full rounded-xl border-2 p-4 [&>*+*]:mt-1', {
  variants: {
    tone: {
      info: 'border-info/50 bg-info/10 text-foreground',
      success: 'border-success/50 bg-success/10 text-foreground',
      warning: 'border-warning/60 bg-warning/10 text-foreground',
      danger: 'border-destructive/60 bg-destructive/10 text-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** 'assertive' only for genuine danger/emergency interruptions. */
  politeness?: 'polite' | 'assertive';
}

/** Live-region alert. role="alert" (assertive) interrupts screen readers;
 *  role="status" (polite) waits for a pause — pick honestly. */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, tone, politeness = 'polite', ...props }, ref) => (
    <div
      ref={ref}
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className="font-display text-lg font-semibold leading-tight" {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className="text-sm [&_p]:leading-relaxed" {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';
