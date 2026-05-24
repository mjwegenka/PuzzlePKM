export function createTagService(deps) {
  const { createTagRecord, getTag, prompt, updateTagRecord } = deps;

  async function createTagInteractive(db, rl) {
    const displayName = await prompt(rl, 'Tag name', { required: true });
    return createTagRecord(db, displayName);
  }

  async function updateTagInteractive(db, reference, rl) {
    const existing = getTag(db, reference);
    if (!existing) return null;
    const displayName = await prompt(rl, 'Tag name', { defaultValue: existing.displayName, showDefault: true });
    return updateTagRecord(db, existing.id, { displayName });
  }

  return {
    createTagInteractive,
    updateTagInteractive,
  };
}
