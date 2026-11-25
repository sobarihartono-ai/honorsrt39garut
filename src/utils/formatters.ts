export function formatNumber(num: number | string | undefined): string {
  return Math.round(Number(num) || 0).toLocaleString('id-ID');
}

export function formatRupiah(num: number | string | undefined): string {
  return 'Rp ' + formatNumber(num);
}

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  return cleaned.length > 0 ? cleaned : `id-${Date.now()}`;
}

export function clampStr(val: string | undefined, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}
