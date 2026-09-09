export async function handleObjectsCommand(action, args, ctx) {
  // Occurrences are logged rather than written: `write habit` owns the practice
  // definition, this owns its history.
  // Usage: puzzlepkm habit log|unlog <id-or-name> [YYYY-MM-DD] [note…]
  if (action === 'habit') {
    const subcommand = String(args[0] ?? '').toLowerCase();

    // Consistency is always relative to a date: opening an old daily note must
    // report what was true then, not what is true now.
    if (subcommand === 'list') {
      const rest = args.slice(1);
      const asOfIndex = rest.indexOf('--as-of');
      const asOfDate = asOfIndex >= 0 ? rest[asOfIndex + 1] : undefined;
      if (asOfDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        throw new Error('--as-of expects a date in YYYY-MM-DD form.');
      }
      const includeRetired = rest.includes('--include-retired');
      const habits = ctx.withDb((db) => ctx.listHabits(db, { asOfDate, includeRetired }));
      console.log(ctx.formatCompact(habits));
      return true;
    }

    const reference = args[1];
    if (!reference || (subcommand !== 'log' && subcommand !== 'unlog')) {
      throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} habit list [--as-of YYYY-MM-DD] [--include-retired] | habit log|unlog <id-or-name> [YYYY-MM-DD] [note]`);
    }
    const maybeDate = String(args[2] ?? '').trim();
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(maybeDate);
    const date = hasDate ? maybeDate : ctx.localDateString();
    const note = args.slice(hasDate ? 3 : 2).join(' ').trim();
    const result = ctx.withDb((db) => (
      subcommand === 'log'
        ? ctx.addHabitEntry(db, reference, date, note)
        : ctx.removeHabitEntry(db, reference, date)
    ));
    if (!result) throw new Error(`habit not found: ${reference}`);
    console.log(ctx.formatCompact(result));
    return true;
  }

  if (action === 'list') {
    const type = ctx.resolveType(args[0] ?? 'topic-note');
    if (!type) throw new Error(`Unknown type: ${args[0]}`);
    ctx.printRecords(type, ctx.listObjects(type));
    return true;
  }

  // Batched metadata payload for UI list views.
  if (action === 'list-meta') {
    console.log(ctx.formatCompact(ctx.listMetaBundle()));
    return true;
  }

  // DEC-18: Non-interactive write command for desktop UI integration.
  // Usage: puzzlepkm write <type> <json-string>
  // Creates or updates the object based on presence of a matching id/date.
  if (action === 'write') {
    const type = ctx.resolveType(args[0]);
    const jsonStr = args.slice(1).join(' ');
    if (!type || !jsonStr) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} write <type> <json>`);
    let input;
    try {
      input = JSON.parse(jsonStr);
    } catch {
      throw new Error('Invalid JSON input for write command');
    }
    const now = ctx.getIsoNow();
    const result = ctx.withDb((db) => {
      switch (type) {
        case 'topic-note': {
          const id = input.id;
          if (id && ctx.getTopicNote(db, id)) {
            return ctx.updateTopicNoteRecord(db, id, {
              title: input.title,
              date: input.date,
              contentMarkdown: input.contentMarkdown,
              blocks: input.blocks,
              linkedObjectIds: input.linkedObjectIds,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return ctx.createTopicNoteRecord(db, {
            id: id ?? ctx.randomUUID(),
            title: input.title ?? 'Untitled',
            date: input.date ?? '',
            content: {},
            contentMarkdown: input.contentMarkdown ?? '',
            blocks: input.blocks,
            linkedObjectIds: input.linkedObjectIds ?? [],
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'daily-note': {
          const date = input.date;
          if (!date) throw new Error('daily-note write requires a date field');
          const existingRow = db.prepare('SELECT id FROM daily_notes WHERE date = ?').get(date);
          const existingById = input.id ? ctx.getDailyNote(db, input.id) : null;
          if (existingById) {
            return ctx.updateDailyNoteRecord(db, input.id, {
              date: input.date,
              contentMarkdown: input.contentMarkdown,
              blocks: input.blocks,
              linkedObjectIds: input.linkedObjectIds,
              tags: input.tags,
              updatedAt: now,
            });
          }
          if (existingRow?.id) {
            throw new Error(`A daily note already exists for ${date}. Open that note instead of creating a new one.`);
          }
          return ctx.createDailyNoteRecord(db, {
            id: input.id ?? ctx.randomUUID(),
            date,
            content: {},
            contentMarkdown: input.contentMarkdown ?? '',
            blocks: input.blocks,
            linkedObjectIds: input.linkedObjectIds ?? [],
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'project': {
          const id = input.id ?? ctx.randomUUID();
          const rootFolder = ctx.getSyncRootFolder();
          const canonicalSyncPath = ctx.canonicalProjectSyncPath(rootFolder, input.name ?? 'Untitled', id);
          const existingProject = input.id ? ctx.getProject(db, input.id) : null;
          if (existingProject) {
            // DEC-80: a linked directory keeps its own path; renaming the record must
            // not point it at the managed root (and never renames the folder on disk).
            const linked = ctx.isLinkedObject(db, 'project', existingProject.id);
            return ctx.updateProjectRecord(db, input.id, {
              name: input.name,
              syncPath: linked ? existingProject.syncPath : canonicalSyncPath,
              startDate: input.startDate,
              endDate: input.endDate,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return ctx.createProjectRecord(db, {
            id,
            name: input.name ?? 'Untitled',
            syncPath: canonicalSyncPath,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'ref-material': {
          const id = input.id ?? ctx.randomUUID();
          const rootFolder = ctx.getSyncRootFolder();
          const canonicalSyncPath = ctx.canonicalRefMaterialSyncPath(rootFolder, input.name ?? 'Untitled', id);
          const existingRefMat = input.id ? ctx.getRefMat(db, input.id) : null;
          if (existingRefMat) {
            // DEC-80: see the project case — linked directories keep their own path.
            const linked = ctx.isLinkedObject(db, 'ref-material', existingRefMat.id);
            return ctx.updateRefMatRecord(db, input.id, {
              name: input.name,
              author: input.author,
              syncPath: linked ? existingRefMat.syncPath : canonicalSyncPath,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return ctx.createRefMatRecord(db, {
            id,
            name: input.name ?? 'Untitled',
            author: input.author ?? '',
            syncPath: canonicalSyncPath,
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'habit': {
          const id = input.id;
          if (id && ctx.getHabit(db, id)) {
            return ctx.updateHabitRecord(db, id, {
              name: input.name,
              cadenceMode: input.cadenceMode,
              targetIntervalDays: input.targetIntervalDays,
              state: input.state,
              retiredOn: input.retiredOn,
              entries: input.entries,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return ctx.createHabitRecord(db, {
            id: id ?? ctx.randomUUID(),
            name: input.name ?? 'Untitled habit',
            cadenceMode: input.cadenceMode,
            targetIntervalDays: input.targetIntervalDays ?? null,
            state: input.state ?? ctx.HABIT_STATE_ACTIVE,
            retiredOn: input.retiredOn,
            entries: input.entries ?? [],
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        default:
          throw new Error(`Unsupported type for write: ${type}`);
      }
    });
    console.log(ctx.formatCompact(result));
    return true;
  }

  if (action === 'get') {
    const type = ctx.resolveType(args[0]);
    const reference = args[1];
    if (!type || !reference) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} get <type> <id-or-date>`);
    const record = ctx.getObject(type, reference);
    if (!record) throw new Error(`${type} not found: ${reference}`);
    console.log(ctx.formatCompact(record));
    return true;
  }

  if (action === 'create') {
    const type = ctx.resolveType(args[0]);
    if (!type) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} create <type>`);
    const promptRl = ctx.rl ?? ctx.createPromptInterface();
    try {
      const created = await ctx.createObjectInteractive(type, promptRl);
      console.log(ctx.formatCompact(created));
    } finally {
      if (!ctx.rl) promptRl.close();
    }
    return true;
  }

  if (action === 'update') {
    const type = ctx.resolveType(args[0]);
    const reference = args[1];
    if (!type || !reference) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} update <type> <id-or-date>`);
    const promptRl = ctx.rl ?? ctx.createPromptInterface();
    try {
      const updated = await ctx.updateObjectInteractive(type, reference, promptRl);
      if (!updated) throw new Error(`${type} not found: ${reference}`);
      console.log(ctx.formatCompact(updated));
    } finally {
      if (!ctx.rl) promptRl.close();
    }
    return true;
  }

  if (action === 'delete' || action === 'remove') {
    const type = action === 'remove' ? 'topic-note' : ctx.resolveType(args[0]);
    const reference = action === 'remove' ? args[0] : args[1];

    if (!type || !reference) {
      const usage = action === 'remove'
        ? `Usage: ${ctx.PRIMARY_CLI_COMMAND} remove <id> or ${ctx.PRIMARY_CLI_COMMAND} delete <type> <id-or-date>`
        : `Usage: ${ctx.PRIMARY_CLI_COMMAND} delete <type> <id-or-date>`;
      throw new Error(usage);
    }

    const remoteDeleteTarget = ctx.withDb((db) => {
      const rootFolder = ctx.getSyncRootFolder();
      switch (type) {
        case 'daily-note': {
          const existing = ctx.getDailyNote(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || ctx.dailyNoteSyncPath(rootFolder, existing.date),
            requiresRemoteDelete: ctx.hasKnownRemoteCopy(db, 'daily-note', existing.id),
          };
        }
        case 'topic-note': {
          const existing = ctx.getTopicNote(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || ctx.topicNoteSyncPath(rootFolder, existing.title, existing.id),
            requiresRemoteDelete: ctx.hasKnownRemoteCopy(db, 'topic-note', existing.id),
          };
        }
        case 'habit': {
          const existing = ctx.getHabit(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || ctx.habitSyncPath(rootFolder, existing.name, existing.id),
            requiresRemoteDelete: ctx.hasKnownRemoteCopy(db, 'habit', existing.id),
          };
        }
        case 'project': {
          const existing = ctx.getProject(db, reference);
          if (!existing) return null;
          // DEC-80: a linked directory lives outside the sync root and is read-only;
          // deleting the record must not delete the user's folder.
          const linked = ctx.isLinkedObject(db, 'project', existing.id);
          return {
            objectId: existing.id,
            linked,
            path: linked ? '' : (existing.syncPath || ''),
            requiresRemoteDelete: ctx.hasKnownRemoteCopy(db, 'project', existing.id),
          };
        }
        case 'ref-material': {
          const existing = ctx.getRefMat(db, reference);
          if (!existing) return null;
          const linked = ctx.isLinkedObject(db, 'ref-material', existing.id);
          return {
            objectId: existing.id,
            linked,
            path: linked ? '' : (existing.syncPath || ''),
            requiresRemoteDelete: ctx.hasKnownRemoteCopy(db, 'ref-material', existing.id),
          };
        }
        default:
          return null;
      }
    });

    if (remoteDeleteTarget?.path) {
      await ctx.deleteSyncPath(remoteDeleteTarget.path);
    }

    const deleted = ctx.withDb((db) => {
      switch (type) {
        case 'topic-note': return ctx.deleteTopicNoteRecord(db, reference);
        case 'daily-note': return ctx.deleteDailyNoteRecord(db, reference);
        case 'project': return ctx.deleteProjectRecord(db, reference);
        case 'ref-material': return ctx.deleteRefMatRecord(db, reference);
        case 'habit': return ctx.deleteHabitRecord(db, reference);
        case 'tag': return ctx.deleteTagRecord(db, reference);
        case 'link': return ctx.deleteLinkRecord(db, reference);
        default: throw new Error(`Unsupported type: ${type}`);
      }
    });

    if (!deleted) throw new Error(`${type} not found: ${reference}`);

    if (remoteDeleteTarget?.linked && remoteDeleteTarget.objectId) {
      ctx.removeLinkedSourceForObject(type, remoteDeleteTarget.objectId);
      // DEC-85: this is an unlink, not a delete — the directory is still on disk.
      console.log(`Unlinked ${type} ${reference} (directory left untouched)`);
      return true;
    }
    console.log(`Deleted ${type} ${reference}`);
    return true;
  }

  if (action === 'convert-to-project') {
    const id = args[0];
    if (!id) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} convert-to-project <id>`);
    const result = ctx.convertTopicNoteToProject(id);
    console.log(ctx.formatCompact(result));
    return true;
  }

  if (action === 'browse') {
    ctx.browseTarget(args[0] ?? 'all', args[1]);
    return true;
  }

  // Author catalog commands (DEC-29)
  if (action === 'list-authors') {
    const rows = ctx.withDb((db) => ctx.listAuthors(db));
    for (const row of rows) {
      console.log(`${row.name}\t${row.usage_count}`);
    }
    return true;
  }

  if (action === 'create-author') {
    const name = args[0];
    if (!name) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} create-author <name>`);
    const result = ctx.withDb((db) => ctx.createAuthor(db, name));
    console.log(ctx.formatCompact(result));
    return true;
  }

  if (action === 'delete-author') {
    const name = args[0];
    if (!name) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} delete-author <name>`);
    const deleted = ctx.withDb((db) => ctx.deleteAuthor(db, name));
    if (!deleted) throw new Error(`Author not found: ${name}`);
    console.log(`Deleted author: ${name}`);
    return true;
  }

  return false;
}
