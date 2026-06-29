import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  rounded?: number | string;
}

export function Skeleton({ width, height, rounded, className, style, ...rest }: SkeletonProps) {
  const merged: CSSProperties = {
    ...style,
    width: width ?? style?.width,
    height: height ?? style?.height,
    borderRadius: rounded ?? style?.borderRadius,
  };
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--muted)]', className)}
      style={merged}
      aria-hidden="true"
      {...rest}
    />
  );
}
