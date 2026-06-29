import type {
  HTMLAttributes,
  PropsWithChildren,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  className?: string;
  cols?: ReactNode;
}

export function Table({ children, cols, className, ...rest }: PropsWithChildren<TableProps>) {
  return (
    <div className="w-full overflow-hidden rounded-md border border-[var(--border)]">
      <div className="w-full overflow-auto">
        <table className={cn('w-full caption-bottom text-sm', className)} {...rest}>
          {cols ? <colgroup>{cols}</colgroup> : null}
          {children}
        </table>
      </div>
    </div>
  );
}

export function TableHeader({
  children,
  className,
  ...rest
}: PropsWithChildren<HTMLAttributes<HTMLTableSectionElement>>) {
  return (
    <thead className={cn('[&_tr]:border-b [&_tr]:border-[var(--border)]', className)} {...rest}>
      {children}
    </thead>
  );
}

export function TableBody({
  children,
  className,
  ...rest
}: PropsWithChildren<HTMLAttributes<HTMLTableSectionElement>>) {
  return (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...rest}>
      {children}
    </tbody>
  );
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
}

export function TableRow({
  children,
  className,
  selected,
  ...rest
}: PropsWithChildren<TableRowProps>) {
  return (
    <tr
      className={cn(
        'border-b border-[var(--border)] transition-colors hover:bg-[var(--accent)]/70',
        selected ? 'bg-[var(--accent)]' : '',
        className
      )}
      data-state={selected ? 'selected' : undefined}
      {...rest}
    >
      {children}
    </tr>
  );
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  alignRight?: boolean;
}

export function TableHead({
  children,
  className,
  alignRight,
  ...rest
}: PropsWithChildren<TableHeadProps>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium text-[var(--muted-foreground)]',
        alignRight ? 'text-right' : '',
        className
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  alignRight?: boolean;
}

export function TableCell({
  children,
  className,
  alignRight,
  ...rest
}: PropsWithChildren<TableCellProps>) {
  return (
    <td
      className={cn('px-3 py-3 align-middle', alignRight ? 'text-right' : '', className)}
      {...rest}
    >
      {children}
    </td>
  );
}
