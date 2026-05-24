export function createProjectService(deps) {
  const { createProjectRecord, getIsoNow, getProject, prompt, promptList, randomUUID, updateProjectRecord } = deps;

  async function createProjectInteractive(db, rl) {
    const createdAt = getIsoNow();
    const updatedAt = createdAt;
    const name = await prompt(rl, 'Name', { required: true });
    const syncPath = await prompt(rl, 'Sync path');
    const startDate = await prompt(rl, 'Start date (YYYY-MM-DD)');
    const endDate = await prompt(rl, 'End date (YYYY-MM-DD)');
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createProjectRecord(db, {
      id: randomUUID(),
      name,
      syncPath,
      startDate,
      endDate,
      tags,
      createdAt,
      updatedAt,
    });
  }

  async function updateProjectInteractive(db, reference, rl) {
    const existing = getProject(db, reference);
    if (!existing) return null;
    const name = await prompt(rl, 'Name', { defaultValue: existing.name, showDefault: true });
    const syncPath = await prompt(rl, 'Sync path', { defaultValue: existing.syncPath, showDefault: Boolean(existing.syncPath), allowClear: true });
    const startDate = await prompt(rl, 'Start date (YYYY-MM-DD)', { defaultValue: existing.startDate, showDefault: Boolean(existing.startDate), allowClear: true });
    const endDate = await prompt(rl, 'End date (YYYY-MM-DD)', { defaultValue: existing.endDate, showDefault: Boolean(existing.endDate), allowClear: true });
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateProjectRecord(db, existing.id, {
      name,
      syncPath,
      startDate,
      endDate,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    createProjectInteractive,
    updateProjectInteractive,
  };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
