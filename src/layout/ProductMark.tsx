/**
 * Product mark: a terminal prompt in a rounded frame, for a chat that runs on your own
 * machine. Drawn in currentColor so it follows every color theme. public/favicon.svg is the
 * same drawing on a solid tile.
 */
export function ProductMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="5" width="26" height="22" rx="6" />
      <path d="M10 13l4 3-4 3" />
      <path d="M17 20h5" />
    </svg>
  );
}
