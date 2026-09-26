import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

// The border is the alert's boundary against the page — for a low-vision user
// it is often the only thing that says "this box is an alert". At /50 and /60 it
// measured 2.06-2.35:1 against its own surface; full tone measures 6.79-7.04:1
// (light) and 7.40-10.38:1 (dark), clearing SC 1.4.11 with room to spare.
const alertVariants = cva('relative w-full rounded-xl border-2 p-4 [&>*+*]:mt-1', {
  variants: {
    tone: {
      info: 'border-info bg-info/10 text-foreground',
      success: 'border-success bg-success/10 text-foreground',
      warning: 'border-warning bg-warning/10 text-foreground',
      danger: 'border-destructive bg-destructive/10 text-foreground',
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
    <h5
      ref={ref}
      className={cn('font-display text-lg font-semibold leading-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';
