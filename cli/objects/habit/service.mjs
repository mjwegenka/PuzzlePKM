export function createHabitService(deps) {
  const { createHabitRecord, getHabit, getIsoNow, localDateString, prompt, promptList, randomUUID, updateHabitRecord, MAX_HABIT_TEXT_LENGTH } = deps;

  function sanitizeHabitText(text) {
    return text.length > MAX_HABIT_TEXT_LENGTH
      ? { text: text.slice(0, MAX_HABIT_TEXT_LENGTH), truncated: true }
      : { text, truncated: false };
  }

  async function createHabitInteractive(db, rl) {
    const createdAt = getIsoNow();
    const updatedAt = createdAt;
    const text = await prompt(rl, 'Habit text', { required: true });
    const date = await prompt(rl, 'Date', { defaultValue: localDateString(), showDefault: true, required: true });
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createHabitRecord(db, {
      id: randomUUID(),
      text,
      date,
      tags,
      createdAt,
      updatedAt,
    });
  }

  async function updateHabitInteractive(db, reference, rl) {
    const existing = getHabit(db, reference);
    if (!existing) return null;
    const text = await prompt(rl, 'Habit text', { defaultValue: existing.text, showDefault: true });
    const date = await prompt(rl, 'Date', { defaultValue: existing.date, showDefault: true });
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateHabitRecord(db, existing.id, {
      text,
      date,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    createHabitInteractive,
    sanitizeHabitText,
    updateHabitInteractive,
  };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
