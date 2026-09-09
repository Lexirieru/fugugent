import { motion, useInView, useReducedMotion, type Variants } from "framer-motion";
import { useRef, type ReactNode } from "react";

/**
 * Motion pattern A — blur in on first sight, then stagger the row behind it.
 *
 * Two pieces that are always used together: `BlurIn` for a heading or a block of
 * prose, and `staggerParent` / `staggerChild` for the row of cards underneath.
 * Both fire once and never again, so scrolling back up does not replay them.
 *
 * Every entry animation here is switched off under `prefers-reduced-motion`, and
 * switched off by rendering the finished state directly rather than by running a
 * zero-length animation — a reader with motion turned off should never see a frame
 * of blur.
 */

export function BlurIn({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ filter: "blur(20px)", opacity: 0 }}
      animate={inView ? { filter: "blur(0px)", opacity: 1 } : undefined}
      transition={{ duration: 1.2, delay }}
    >
      {children}
    </motion.div>
  );
}

export const staggerParent: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.2 } },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

/**
 * The row wrapper. Pulled out because the `initial` / `whileInView` /
 * `viewport` triple has to match on every row, and because the reduced-motion
 * branch is easy to forget on the fifth copy.
 */
export function StaggerRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={staggerChild}>
      {children}
    </motion.div>
  );
}
