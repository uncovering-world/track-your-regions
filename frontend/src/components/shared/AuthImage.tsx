import { useEffect, useState } from 'react';
import { API_URL, apiFetch } from '../../api/fetchUtils';

/**
 * A picture our API serves behind its auth, read through `apiFetch` with the
 * session's token; a `data:` URL is the picture already, and is only decoded.
 */
function readPicture(src: string): Promise<Blob> {
  if (src.startsWith(API_URL)) return apiFetch<Blob>(src.slice(API_URL.length));
  return fetch(src).then((response) => response.blob());
}

interface AuthImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined;
}

export function AuthImage({ src, ...imgProps }: AuthImageProps) {
  const blobUrl = useAuthBlobUrl(src);
  if (!blobUrl) return null;
  return <img src={blobUrl} {...imgProps} />;
}

export function useAuthBlobUrl(src: string | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let currentUrl: string | null = null;

    readPicture(src)
      .then(blob => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(blob);
        setBlobUrl(currentUrl);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [src]);

  return blobUrl;
}
