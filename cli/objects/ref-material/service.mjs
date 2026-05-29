export function createRefMaterialService(deps) {
  const { createRefMatRecord, getIsoNow, getRefMat, prompt, promptList, randomUUID, updateRefMatRecord } = deps;

  async function createRefMaterialInteractive(db, rl) {
    const createdAt = getIsoNow();
    const updatedAt = createdAt;
    const name = await prompt(rl, 'Name', { required: true });
    const author = await prompt(rl, 'Author (optional)', { allowClear: true });
    const syncPath = await prompt(rl, 'Sync path');
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createRefMatRecord(db, {
      id: randomUUID(),
      name,
      author,
      syncPath,
      tags,
      createdAt,
      updatedAt,
    });
  }

  async function updateRefMaterialInteractive(db, reference, rl) {
    const existing = getRefMat(db, reference);
    if (!existing) return null;
    const name = await prompt(rl, 'Name', { defaultValue: existing.name, showDefault: true });
    const author = await prompt(rl, 'Author (optional)', { defaultValue: existing.author ?? '', showDefault: Boolean(existing.author), allowClear: true });
    const syncPath = await prompt(rl, 'Sync path', { defaultValue: existing.syncPath, showDefault: Boolean(existing.syncPath), allowClear: true });
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateRefMatRecord(db, existing.id, {
      name,
      author,
      syncPath,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    createRefMaterialInteractive,
    updateRefMaterialInteractive,
  };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
