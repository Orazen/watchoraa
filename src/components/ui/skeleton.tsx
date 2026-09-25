import { cn } from './cn';

/** Loading placeholder with an honest aria-label — screen-reader users hear
 *  that content is loading instead of encountering a silent empty box. */
export function Skeleton({ className, label = 'Loading…' }: { className?: string; label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('animate-pulse rounded-lg bg-muted-foreground/15', className)}
    />
  );
}
