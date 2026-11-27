import { ChevronLeft, ChevronRight } from 'lucide-react';

import * as React from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn('mx-auto flex w-full justify-center', className)}
    {...props}
  />
);
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  )
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn('', className)} {...props} />
);
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = {
  isActive?: boolean;
  size?: ButtonSize;
} & React.ComponentProps<'button'>;

/**
 * A page control. It is a real button, so it is in the tab order and Enter and Space work.
 * `aria-disabled` keeps it in the tab order (a real `disabled` would drop the focus of the
 * button that was just pressed) and makes the click do nothing.
 */
const PaginationLink = ({
  className,
  isActive,
  size = 'icon',
  onClick,
  ...props
}: PaginationLinkProps) => {
  const ariaDisabled = props['aria-disabled'];
  const disabled = ariaDisabled === true || ariaDisabled === 'true';
  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size,
        }),
        // 44 px touch target on a coarse pointer
        'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-inherit',
        className
      )}
      {...props}
    />
  );
};
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious = ({
  className,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  size: _size,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="default"
    className={cn('gap-1 pl-2.5', className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = ({
  className,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  size: _size,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="default"
    className={cn('gap-1 pr-2.5', className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = 'PaginationNext';

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
