export const MAX_IMPORT_BYTES = 64 * 1024 * 1024,
  MAX_IMPORT_SECONDS = 600;
/** @param {number} size */
export function checkImportSize(size) {
  if (size > MAX_IMPORT_BYTES)
    throw new Error("Audio files must be 64 MiB or smaller.");
}
/** @param {number} duration */
export function isImportDuration(duration) {
  return (
    Number.isFinite(duration) && duration >= 1 && duration <= MAX_IMPORT_SECONDS
  );
}
/** @param {number} duration */
export function checkImportDuration(duration) {
  if (!isImportDuration(duration))
    throw new Error("Audio must be between 1 second and 10 minutes.");
}
/** @param {Response} response */
export async function importBytes(response) {
  if (!response.ok) throw new Error(`Audius stream ${response.status}`);
  if (!response.body) throw new Error("Audius returned no audio");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    checkImportSize(Number(response.headers.get("content-length")));
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      checkImportSize(size);
      chunks.push(value);
    }
    return await new Blob(chunks).arrayBuffer();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
/** @param {ArrayBuffer} bytes @returns {Promise<void>} */
export function importDuration(bytes) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio"),
      url = URL.createObjectURL(new Blob([bytes]));
    /** @param {Error} [err] */
    const finish = (err) => {
      clearTimeout(timer);
      audio.onloadedmetadata = audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Could not read audio duration.")),
      15000,
    );
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      try {
        checkImportDuration(audio.duration);
        finish();
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };
    audio.onerror = () => finish(new Error("Could not read audio duration."));
    audio.src = url;
  });
}
