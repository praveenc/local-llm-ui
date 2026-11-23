/**
 * StreamStatusAnnouncer
 *
 * A polite live region that tells screen readers when a reply starts and ends.
 * It announces the two state changes only, never each streamed token.
 */
import { useState } from 'react';

interface StreamStatusAnnouncerProps {
  isLoading: boolean;
  /** True when the reply ended in an error; the error alert speaks for itself */
  hasError?: boolean;
}

export function StreamStatusAnnouncer({ isLoading, hasError }: StreamStatusAnnouncerProps) {
  const [wasLoading, setWasLoading] = useState(isLoading);
  const [message, setMessage] = useState('');

  if (isLoading !== wasLoading) {
    setWasLoading(isLoading);
    setMessage(isLoading ? 'Generating response' : hasError ? '' : 'Response complete');
  }

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
