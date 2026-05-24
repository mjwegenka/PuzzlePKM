export function createTopicNoteService(deps) {
  const { createTopicNoteRecord, getIsoNow, getTopicNote, prompt, promptList, promptMultiline, randomUUID, updateTopicNoteRecord } = deps;

  async function createTopicNoteInteractive(db, rl) {
    const createdAt = getIsoNow();
    const updatedAt = createdAt;
    const title = await prompt(rl, 'Title', { required: true });
    const date = await prompt(rl, 'Date (optional, YYYY-MM-DD)', { allowClear: true });
    const contentMarkdown = await promptMultiline(rl, 'Content');
    const linkedObjectIds = parseCsv(await prompt(rl, 'Linked object IDs (comma separated)'));
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createTopicNoteRecord(db, {
      id: randomUUID(),
      title,
      date,
      content: {},
      contentMarkdown,
      linkedObjectIds,
      tags,
      createdAt,
      updatedAt,
    });
  }

  async function updateTopicNoteInteractive(db, reference, rl) {
    const existing = getTopicNote(db, reference);
    if (!existing) return null;
    const title = await prompt(rl, 'Title', { defaultValue: existing.title, showDefault: true });
    const date = await prompt(rl, 'Date (optional, YYYY-MM-DD)', { defaultValue: existing.date ?? '', showDefault: true, allowClear: true });
    const contentMarkdown = await promptMultiline(rl, 'Content', existing.contentMarkdown);
    const linkedObjectIds = await promptList(rl, 'Linked object IDs (comma separated)', existing.linkedObjectIds);
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateTopicNoteRecord(db, existing.id, {
      title,
      date,
      content: existing.content,
      contentMarkdown,
      linkedObjectIds,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    createTopicNoteInteractive,
    updateTopicNoteInteractive,
  };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
