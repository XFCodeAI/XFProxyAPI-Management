import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { useState, type HTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';
import { IconChevronDown } from '../icons';
import { cn } from '@/lib/utils';

interface CollapsibleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'> {
  label: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (event: React.SyntheticEvent<HTMLDetailsElement>) => void;
  flush?: boolean;
}

export function Collapsible({
  label,
  hint,
  defaultOpen = false,
  open,
  onToggle,
  flush,
  children,
  className,
  ...rest
}: PropsWithChildren<CollapsibleProps>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const resolvedOpen = open ?? uncontrolledOpen;

  return (
    <CollapsiblePrimitive.Root
      open={resolvedOpen}
      onOpenChange={(nextOpen) => {
        if (open === undefined) {
          setUncontrolledOpen(nextOpen);
        }
        onToggle?.({ currentTarget: { open: nextOpen } } as React.SyntheticEvent<HTMLDetailsElement>);
      }}
      className={cn(
        'rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]',
        className
      )}
      {...rest}
    >
      <CollapsiblePrimitive.Trigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium outline-none transition-colors hover:bg-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {hint ? <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">{hint}</span> : null}
        </span>
        <IconChevronDown
          size={16}
          className={cn('shrink-0 transition-transform', resolvedOpen ? 'rotate-180' : '')}
          aria-hidden="true"
        />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className={cn(flush ? '' : 'border-t border-[var(--border)] p-4')}>
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
