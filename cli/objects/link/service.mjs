export function createLinkService(deps) {
  const { createLinkRecord, getIsoNow, prompt, randomUUID, resolveType } = deps;

  async function createLinkInteractive(db, rl) {
    const sourceType = resolveType(await prompt(rl, 'Source type', { required: true }));
    const sourceId = await prompt(rl, 'Source id', { required: true });
    const targetType = resolveType(await prompt(rl, 'Target type', { required: true }));
    const targetId = await prompt(rl, 'Target id', { required: true });
    if (!sourceType || !targetType || sourceType === 'link' || targetType === 'link') {
      throw new Error('Links require valid non-link object types');
    }
    return createLinkRecord(db, {
      id: randomUUID(),
      sourceId,
      targetId,
      sourceType,
      targetType,
      createdAt: getIsoNow(),
    });
  }

  return {
    createLinkInteractive,
  };
}
