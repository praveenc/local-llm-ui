import { forwardRef } from 'react';
import type { ReactNode } from 'react';

interface ScrollableContainerProps {
  children: ReactNode;
}

const ScrollableContainer = forwardRef<HTMLDivElement, ScrollableContainerProps>(
  function ScrollableContainer({ children }, ref) {
    return (
      <div className="relative h-full">
        <div className="absolute inset-0 overflow-y-auto" ref={ref}>
          {children}
        </div>
      </div>
    );
  }
);

export default ScrollableContainer;
