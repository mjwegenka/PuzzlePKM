import { dailyNoteDefinition } from './daily-note/definition.mjs';
import { habitDefinition } from './habit/definition.mjs';
import { linkDefinition } from './link/definition.mjs';
import { projectDefinition } from './project/definition.mjs';
import { refMaterialDefinition } from './ref-material/definition.mjs';
import { scriptureChapterDefinition } from './scripture-chapter/definition.mjs';
import { scriptureDefinition } from './scripture/definition.mjs';
import { tagDefinition } from './tag/definition.mjs';
import { topicNoteDefinition } from './topic-note/definition.mjs';

// DEC-05, DEC-48, DEC-77: Keep object-type ownership aligned to canonical product object types.
export const objectTypeDefinitions = [
  topicNoteDefinition,
  dailyNoteDefinition,
  projectDefinition,
  refMaterialDefinition,
  habitDefinition,
  scriptureDefinition,
  scriptureChapterDefinition,
  tagDefinition,
  linkDefinition,
];

export function createObjectTypeAliasMap(definitions = objectTypeDefinitions) {
  return new Map(
    definitions.flatMap((definition) => [
      [definition.type, definition.type],
      ...definition.aliases.map((alias) => [alias, definition.type]),
    ]),
  );
}
