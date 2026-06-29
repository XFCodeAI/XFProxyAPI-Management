import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentProps,
  ReactElement,
  ReactNode,
} from 'react';
import { Button } from './Button';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';
import { cn } from '@/lib/utils';
import styles from './TooltipControls.module.scss';

type TooltipSide = ComponentProps<typeof TooltipContent>['side'];

interface TooltipControlProps {
  label: string;
  side?: TooltipSide;
}

export function TooltipButton({
  label,
  side = 'top',
  children,
  ...props
}: ComponentProps<typeof Button> & TooltipControlProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TooltipIconButton({
  label,
  side = 'top',
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & TooltipControlProps & { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(styles.iconButton, className)}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TooltipIconLink({
  label,
  side = 'top',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & TooltipControlProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a aria-label={label} {...props}>
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TooltipElement({
  label,
  side = 'top',
  children,
}: { label?: ReactNode; side?: TooltipSide; children: ReactElement }) {
  if (!label) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
