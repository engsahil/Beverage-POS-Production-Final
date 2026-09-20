// Shared image handling for product create/edit.
// Images are stored IN THE DATABASE (no external storage service).
// The client resizes to ~480px before upload; we enforce a hard
// 512 KB cap on the decoded image here.
const MAX_BYTES = 512 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export function parseImageData(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return { error: 'Invalid image data.' };
  }
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) return { error: 'Invalid image format.' };
  const mime = match[1].toLowerCase();
  if (!ALLOWED.includes(mime)) return { error: 'Image must be a JPG, PNG or WebP file.' };
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return { error: 'Could not read the image.' };
  }
  if (buffer.length === 0) return { error: 'The image is empty.' };
  if (buffer.length > MAX_BYTES) {
    return { error: 'Image is too large (max 512 KB after resize). Choose a smaller image.' };
  }
  return { buffer, mime };
}
