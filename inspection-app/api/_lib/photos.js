// Shared photo helpers for the Telegram intake webhook and its sweep backstop.
// Telegram media: file_id -> getFile -> download from the file endpoint, then
// store in Supabase storage under `${vin6}/${sha256}.${ext}` (content-hash
// dedup so the same image never lands twice).

const TG = 'https://api.telegram.org';

export async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function downloadTelegramPhoto(fileId, attempts = 3) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const metaRes = await fetch(`${TG}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const meta = await metaRes.json();
      if (!meta.ok || !meta.result?.file_path) throw new Error('getFile failed');
      const path = meta.result.file_path;
      const binRes = await fetch(`${TG}/file/bot${token}/${path}`);
      if (!binRes.ok) throw new Error(`file ${binRes.status}`);
      const buf = await binRes.arrayBuffer();
      const ext = (path.split('.').pop() || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
      return { buf, ext, mime: ext === 'png' ? 'image/png' : 'image/jpeg' };
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Download a Telegram file_id and store it under the car's prefix. Returns the
// storage path. Content-hash dedup means re-storing the same image is a no-op.
export async function storePhoto(db, bucket, vin6, fileId) {
  const { buf, ext, mime } = await downloadTelegramPhoto(fileId);
  const hash = await sha256Hex(buf);
  const path = `${vin6}/${hash}.${ext}`;
  const up = await db.storage.from(bucket).upload(path, buf, { contentType: mime, upsert: true });
  if (up.error) throw new Error(`storage: ${up.error.message}`);
  return path;
}

export function bucketForStation(station) {
  return station === 'ready' || station === 'seller' ? 'wa-photos' : 'car-history';
}
