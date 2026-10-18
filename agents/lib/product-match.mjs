// Does an Amazon listing title describe the product we wrote about?
// Used by the Amazon lookup (to pick a listing) and by the QA agent (to catch
// a wrong photo/link). Stricter than word overlap: every distinctive word of the
// product name (brand, model, model number) must appear in the title, and
// accessory listings ("stand for", "battery compatible with") are rejected
// unless the product itself is that accessory.
const GENERIC = new Set(`a an and the for with of in to by gen generation 1st 2nd 3rd 4th 5th 6th newest model
  pack kit set mini plus pro edition version new compatible works
  safe safes box vault security steel home digital electronic portable compact large small heavy duty`.split(/\s+/));
const ACCESSORY = /\b(battery for|stand for|mount for|bracket for|case for|cover for|skin for|sleeve for|replacement|battery compatible|compatible battery|holder for|protector for|charger for|decal|sticker)\b/i;

const norm = (s) => String(s).toLowerCase().replace(/wi-fi/g, 'wifi').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

export function productMatches(name, title, brand = '') {
  const t = ` ${norm(title)} `;
  const titleTokens = tokens(title);
  const nameTokens = tokens(name);
  // A listing may omit the brand ("Breez Max ...") if it opens with the product's own name.
  const brandTokens = new Set(tokens(brand));
  const brandOptional = brandTokens.size > 0 && nameTokens.includes(titleTokens[0]) && !brandTokens.has(titleTokens[0]);
  const distinctive = nameTokens.filter((w) => !GENERIC.has(w) && w.length > 1 && !(brandOptional && brandTokens.has(w)));
  // "kp125m" also matches "kp125mp2"; "bot" matches "switchbot".
  const found = (w) => titleTokens.includes(w) || (/\d/.test(w) && /[a-z]/.test(w) && t.includes(w)) || (w.length >= 3 && titleTokens.some((x) => x.length > w.length && (x.endsWith(w) || x.startsWith(w)) && /\d|bot/.test(x + w)));
  const missing = distinctive.filter((w) => !found(w));
  const accessoryWord = title.match(ACCESSORY)?.[0];
  const accessory = Boolean(accessoryWord) && !new RegExp(`\\b${accessoryWord.split(' ')[0]}`, 'i').test(name);
  // Model words in the listing's name part (before the first comma/dash/bracket)
  // that our product doesn't have mean a different model ("Lock Vision Pro" vs "Lock Pro").
  const head = tokens(title.split(/,|\s[-–|]\s|\(|\sfor\s/i)[0]);
  const VARIANT = new Set(['vision', 'ultra', 'max', 'lite', 'plus', 'pro', 'mini', 'xl', 'se', 'studio', 'show', 'kids']);
  const variant = (/\b2k\+/i.test(title) && !/2k/i.test(name)) || head.some((w) => VARIANT.has(w) && !nameTokens.includes(w));
  return { ok: missing.length === 0 && !accessory && !variant, missing, accessory: accessory ? accessoryWord : variant ? 'newer variant' : null };
}
