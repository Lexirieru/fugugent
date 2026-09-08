"use client";

import { useEffect, useState } from "react";
import { Fugu } from "@/components/fugu";

/**
 * Menampilkan aset merek `/brand/<nama>.png` bila berkasnya sudah ada, dan
 * jatuh ke fugu SVG bila belum. Gambar diprobe lebih dulu lewat `Image()`,
 * jadi tidak pernah ada elemen <img> rusak yang sempat terlihat — halaman
 * tetap utuh sementara aset merek dikerjakan terpisah.
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
