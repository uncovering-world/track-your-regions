import { useEffect, useState } from 'react';
import { authFetchBlob } from '../../api/fetchUtils';

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

    authFetchBlob(src)
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
