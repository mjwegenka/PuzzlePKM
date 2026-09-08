export function createHabitService(deps) {
  const {
    createHabitRecord,
    getHabit,
    getIsoNow,
    prompt,
    promptList,
    randomUUID,
    updateHabitRecord,
    HABIT_STATE_ACTIVE,
    HABIT_STATE_RETIRED,
    MAX_HABIT_NAME_LENGTH,
    MAX_HABIT_ENTRY_NOTE_LENGTH,
  } = deps;

  function sanitizeHabitName(name) {
    const text = String(name ?? '').replace(/\r?\n/g, ' ').trim() || 'Untitled habit';
    return text.length > MAX_HABIT_NAME_LENGTH
      ? { text: text.slice(0, MAX_HABIT_NAME_LENGTH), truncated: true }
      : { text, truncated: false };
  }

  function sanitizeHabitEntryNote(note) {
    return String(note ?? '').replace(/\r?\n/g, ' ').trim().slice(0, MAX_HABIT_ENTRY_NOTE_LENGTH);
  }

  /** Blank means "no target" — the observed median gap takes over (see stats.mjs). */
  function parseTargetIntervalInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || Math.round(parsed) <= 0) {
      throw new Error('Target interval must be a positive number of days, or blank for none.');
    }
    return Math.round(parsed);
  }

  async function createHabitInteractive(db, rl) {
    const createdAt = getIsoNow();
    const name = await prompt(rl, 'Habit name', { required: true });
    const targetIntervalDays = parseTargetIntervalInput(
      await prompt(rl, 'Target interval in days (blank for none)'),
    );
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createHabitRecord(db, {
      id: randomUUID(),
      name,
      targetIntervalDays,
      state: HABIT_STATE_ACTIVE,
      tags,
      createdAt,
      updatedAt: createdAt,
    });
  }

  async function updateHabitInteractive(db, reference, rl) {
    const existing = getHabit(db, reference);
    if (!existing) return null;
    const name = await prompt(rl, 'Habit name', { defaultValue: existing.name, showDefault: true });
    const targetIntervalDays = parseTargetIntervalInput(
      await prompt(rl, 'Target interval in days (blank for none)', {
        defaultValue: existing.targetIntervalDays == null ? '' : String(existing.targetIntervalDays),
        showDefault: true,
      }),
    );
    const state = await prompt(rl, `State (${HABIT_STATE_ACTIVE}/${HABIT_STATE_RETIRED})`, {
      defaultValue: existing.state,
      showDefault: true,
    });
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateHabitRecord(db, existing.id, {
      name,
      targetIntervalDays,
      state,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    createHabitInteractive,
    parseTargetIntervalInput,
    sanitizeHabitEntryNote,
    sanitizeHabitName,
    updateHabitInteractive,
  };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
