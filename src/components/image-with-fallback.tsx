"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

export const CARD_IMAGE_FALLBACK_SRC = "/card-image-fallback.jpg";

type ImageWithFallbackProps = Omit<ImageProps, "src"> & {
  fallbackSrc?: string;
  src?: string | null;
};

export function ImageWithFallback({
  alt,
  fallbackSrc = CARD_IMAGE_FALLBACK_SRC,
  src,
  onError,
  ...props
}: ImageWithFallbackProps) {
  const safeSrc = src?.trim() || fallbackSrc;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageSrc = failedSrc === safeSrc ? fallbackSrc : safeSrc;
  const shouldBypassOptimization =
    props.unoptimized ?? imageSrc.startsWith("https://tcgplayer-cdn.tcgplayer.com/product/");

  return (
    <Image
      {...props}
      alt={alt}
      src={imageSrc}
      unoptimized={shouldBypassOptimization}
      onError={(event) => {
        onError?.(event);
        if (imageSrc !== fallbackSrc) setFailedSrc(safeSrc);
      }}
    />
  );
}
