import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

/**
 * Card primitives matching the reUI/shadcn surface conventions with the
 * Watchora ink border. The border is structural (region separation for
 * low-vision users), so it stays on every variant.
 */
const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border-2 border-foreground/90 bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 pb-3', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/** Heading levels a card title can render as. The default stays `h3` (the
 *  shadcn/reUI convention) so every existing call site is unchanged; screens
 *  whose card title is the FIRST heading under the shell's single `<h1>` pass
 *  `as="h2"` so a "navigate by heading" rotor never skips level 2. A card
 *  genuinely nested inside another card's section keeps `h3`. */
export type CardTitleLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement> & { as?: CardTitleLevel }
>(
  ({ className, as: Heading = 'h3', ...props }, ref) => (
    <Heading
      ref={ref}
      className={cn('font-display text-xl leading-tight font-semibold tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-3', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 p-5 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
