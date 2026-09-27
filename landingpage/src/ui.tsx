import type { CSSProperties, ReactNode } from "react";

/** A stagger delay for the entrance animations, read by CSS as `--d`. */
export const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** Every link to the app opens a new tab: it is a separate product, and a reader
 *  who opens it has not finished with this page. */
export function Ext({
  href,
  className,
  children,
  label,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {children}
    </a>
  );
}
