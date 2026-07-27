import { useEffect } from "preact/hooks";

/** Sets `document.title` for as long as the calling page is mounted -
 * shared by every page instead of each rolling its own `useEffect`. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
