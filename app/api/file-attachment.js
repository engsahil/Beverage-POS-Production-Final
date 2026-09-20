// Shared file-attachment handling (purchase invoices, expense receipts).
// Files are stored IN THE DATABASE (no external storage service).
// The client sends a base64 data URL + original file name; we enforce a
// hard 4 MB cap and a small allow-list of types.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function parseAttachment(dataUrl, filename) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return { error: 'Invalid file data.' };
  }
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!match) return { error: 'Invalid file format.' };
  const mime = match[1].toLowerCase();
  if (!ALLOWED.includes(mime)) {
    return { error: 'Attach a JPG, PNG, WebP or PDF file.' };
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return { error: 'Could not read the file.' };
  }
  if (buffer.length === 0) return { error: 'The file is empty.' };
  if (buffer.length > MAX_BYTES) {
    return { error: 'File is too large (max 4 MB). Choose a smaller file.' };
  }
  const name =
    typeof filename === 'string' && filename.trim()
      ? filename.trim().slice(0, 120)
      : mime === 'application/pdf'
        ? 'attachment.pdf'
        : 'attachment.jpg';
  return { buffer, mime, name };
}
