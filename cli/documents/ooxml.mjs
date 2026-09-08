/* eslint-env node */

// DEC-79: pieces shared by the Office Open XML readers. Word and PowerPoint
// disagree about which elements hold text, so each format keeps its own token
// pattern; what they share is the escaping.

const XML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

export function decodeXmlEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES.get(entity) ?? match;
  });
}

/**
 * Order parts that end in a number the way a reader sees them: slide2 before
 * slide10, which a plain string sort gets backwards.
 */
export function compareNumberedParts(a, b) {
  const numberOf = (name) => Number.parseInt(/(\d+)\.xml$/.exec(name)?.[1] ?? '0', 10);
  const difference = numberOf(a) - numberOf(b);
  return difference !== 0 ? difference : a.localeCompare(b);
}
