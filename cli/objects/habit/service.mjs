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

  /**
   * `observed` learns the rhythm from the log, `target` holds to an interval,
   * and `none` never becomes due — a habit kept purely as a record (DEC-82).
   */
  function parseCadenceModeInput(value) {
    const raw = String(value ?? '').trim().toLowerCase() || 'observed';
    if (raw !== 'observed' && raw !== 'target' && raw !== 'none') {
      throw new Error('Cadence must be "observed", "target", or "none".');
    }
    return raw;
  }

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
    const cadenceMode = parseCadenceModeInput(
      await prompt(rl, 'Cadence (observed/target/none)', { defaultValue: 'observed', showDefault: true }),
    );
    const targetIntervalDays = cadenceMode === 'target'
      ? parseTargetIntervalInput(await prompt(rl, 'Target interval in days', { required: true }))
      : null;
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createHabitRecord(db, {
      id: randomUUID(),
      name,
      cadenceMode,
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
    const cadenceMode = parseCadenceModeInput(
      await prompt(rl, 'Cadence (observed/target/none)', { defaultValue: existing.cadenceMode, showDefault: true }),
    );
    const targetIntervalDays = cadenceMode === 'target'
      ? parseTargetIntervalInput(await prompt(rl, 'Target interval in days', {
          defaultValue: existing.targetIntervalDays == null ? '' : String(existing.targetIntervalDays),
          showDefault: true,
          required: true,
        }))
      : null;
    const state = await prompt(rl, `State (${HABIT_STATE_ACTIVE}/${HABIT_STATE_RETIRED})`, {
      defaultValue: existing.state,
      showDefault: true,
    });
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateHabitRecord(db, existing.id, {
      name,
      cadenceMode,
      targetIntervalDays,
      state,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    createHabitInteractive,
    parseCadenceModeInput,
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
