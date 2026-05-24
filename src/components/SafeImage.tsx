"use client";

import { useState } from "react";

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}

export function SafeImage({ src, alt, className, fallback }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <>{fallback || null}</>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
