import { useEffect } from 'react';

const SUFFIX = 'unnamed';

export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;
    return () => { document.title = SUFFIX; };
  }, [title]);
}
