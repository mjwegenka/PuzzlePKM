/* eslint-env node */

// DEC-79: the single-byte encodings that legacy document formats still use.
// PDF simple fonts, Word 97 text pieces and PowerPoint byte atoms all store
// text as one byte per character in one of these two code pages, and the bytes
// that differ from Latin-1 are exactly the ones a reader notices: curly quotes,
// dashes and ellipses.

/** Windows-1252 replacements for 0x80-0x9F; the rest of the page is Latin-1. */
export const WINDOWS_1252_HIGH = [
  '€', '', '‚', 'ƒ', '„', '…', '†', '‡',
  'ˆ', '‰', 'Š', '‹', 'Œ', '', 'Ž', '',
  '', '‘', '’', '“', '”', '•', '–', '—',
  '˜', '™', 'š', '›', 'œ', '', 'ž', 'Ÿ',
];

/** Mac Roman replacements for 0x80-0xFF, which shares nothing above 0x7F. */
export const MAC_ROMAN_HIGH = [
  'Ä', 'Å', 'Ç', 'É', 'Ñ', 'Ö', 'Ü', 'á',
  'à', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è',
  'ê', 'ë', 'í', 'ì', 'î', 'ï', 'ñ', 'ó',
  'ò', 'ô', 'ö', 'õ', 'ú', 'ù', 'û', 'ü',
  '†', '°', '¢', '£', '§', '•', '¶', 'ß',
  '®', '©', '™', '´', '¨', '≠', 'Æ', 'Ø',
  '∞', '±', '≤', '≥', '¥', 'µ', '∂', '∑',
  '∏', 'π', '∫', 'ª', 'º', 'Ω', 'æ', 'ø',
  '¿', '¡', '¬', '√', 'ƒ', '≈', '∆', '«',
  '»', '…', '\u00a0', 'À', 'Ã', 'Õ', 'Œ', 'œ',
  '–', '—', '“', '”', '‘', '’', '÷', '◊',
  'ÿ', 'Ÿ', '⁄', '€', '‹', '›', 'ﬁ', 'ﬂ',
  '‡', '·', '‚', '„', '‰', 'Â', 'Ê', 'Á',
  'Ë', 'È', 'Í', 'Î', 'Ï', 'Ì', 'Ó', 'Ô',
  '\uf8ff', 'Ò', 'Ú', 'Û', 'Ù', 'ı', 'ˆ', '˜',
  '¯', '˘', '˙', '˚', '¸', '˝', '˛', 'ˇ',
];

/** Decode one byte through Windows-1252 (a superset of Latin-1 in practice). */
export function windows1252Byte(code) {
  if (code >= 0x80 && code <= 0x9f) return WINDOWS_1252_HIGH[code - 0x80];
  return String.fromCharCode(code);
}

/** Decode one byte through Mac Roman. */
export function macRomanByte(code) {
  if (code < 0x80) return String.fromCharCode(code);
  return MAC_ROMAN_HIGH[code - 0x80] ?? '';
}

/** Decode a whole buffer of Windows-1252 text. */
export function decodeWindows1252(bytes) {
  let text = '';
  for (const byte of bytes) text += windows1252Byte(byte);
  return text;
}
