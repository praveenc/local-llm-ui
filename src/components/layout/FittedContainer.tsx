import type { ReactNode } from 'react';

interface FittedContainerProps {
  children: ReactNode;
}

const FittedContainer = ({ children }: FittedContainerProps) => {
  return (
    <div style={{ position: 'relative', flexGrow: 1 }}>
      <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
    </div>
  );
};

export default FittedContainer;