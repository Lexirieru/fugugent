"use client";

import { useEffect, useState } from "react";
import { Fugu } from "@/components/fugu";

/**
 * Shows the brand asset `/brand/<name>.png` when that file already exists, and falls
 * back to the SVG fugu when it does not. The image is probed first through `Image()`, so
 * a broken <img> element is never briefly visible — the page stays whole while the brand
 * assets are worked on separately.
 */
export function BrandFugu({
  src,
  puff,
  alt,
  className,
}: {
  src: string;
  puff: number;
  alt: string;
  className?: string;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (live && probe.naturalWidth > 0) setReady(true);
    };
    probe.src = src;
    return () => {
      live = false;
    };
  }, [src]);

  if (ready) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
  }

  return <Fugu puff={puff} className={className} title={alt} animated={false} />;
}
