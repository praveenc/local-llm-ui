import type { ReactNode } from 'react';

interface FittedContainerProps {
  children: ReactNode;
}

const FittedContainer = ({ children }: FittedContainerProps) => {
  return (
    <div className="relative flex-grow">
      <div className="absolute inset-0">{children}</div>
    </div>
  );
};

export default FittedContainer;
