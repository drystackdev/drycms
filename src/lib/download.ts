/**
 * Hands a blob to the browser as a file download.
 *
 * A temporary object URL + a synthetic `<a download>` click, revoked
 * immediately after - the same shape every "Download backup"/"Export JSON"
 * button in the admin needs, kept in one place so they can't drift on the
 * revoke (leaking the object URL for the tab's whole life) or on the
 * `document.body` attach that Firefox requires for the click to register.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
