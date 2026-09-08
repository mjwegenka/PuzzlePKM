/**
 * Tasks live in the Markdown of daily and topic notes (DEC-83); these commands
 * read the derived index and write edits back into the note that owns them.
 */
export async function handleTasksCommand(action, args, ctx) {
  if (action !== 'tasks') return false;

  const subcommand = String(args[0] ?? 'list').toLowerCase();
  const rest = args.slice(1);

  if (subcommand === 'list') {
    const includeDone = !rest.includes('--no-done');
    const tasks = ctx.withDb((db) => ctx.listTasks(db, { includeDone }));
    if (rest.includes('--json') || rest.includes('--no-done') || rest.length === 0) {
      console.log(ctx.formatCompact(tasks));
      return true;
    }
    console.log(ctx.formatCompact(tasks));
    return true;
  }

  if (subcommand === 'add') {
    const flags = readFlags(rest);
    const text = flags.positional.join(' ').trim();
    if (!text) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} tasks add "<text>" [--due YYYY-MM-DD] [--date YYYY-MM-DD]`);
    const result = ctx.withDb((db) => ctx.addTaskToDailyNote(db, {
      text,
      dueDate: flags.due,
      date: flags.date,
    }));
    console.log(ctx.formatCompact(result));
    return true;
  }

  if (subcommand === 'set') {
    const id = rest[0];
    if (!id) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} tasks set <id> [--text "…"] [--due YYYY-MM-DD | --clear-due] [--done | --undone]`);
    const flags = readFlags(rest.slice(1));
    const patch = {};
    if (flags.text !== undefined) patch.text = flags.text;
    if (flags.clearDue) patch.dueDate = null;
    else if (flags.due !== undefined) patch.dueDate = flags.due;
    if (flags.done) patch.done = true;
    if (flags.undone) patch.done = false;
    if (Object.keys(patch).length === 0) {
      throw new Error('Nothing to change: pass --text, --due, --clear-due, --done, or --undone.');
    }
    const updated = ctx.withDb((db) => ctx.updateTaskRecord(db, id, patch));
    if (!updated) throw new Error(`task not found: ${id}`);
    console.log(ctx.formatCompact(updated));
    return true;
  }

  throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} tasks list|add|set …`);
}

function readFlags(args) {
  const flags = { positional: [], clearDue: false, done: false, undone: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--due': flags.due = args[++i]; break;
      case '--date': flags.date = args[++i]; break;
      case '--text': flags.text = args[++i]; break;
      case '--clear-due': flags.clearDue = true; break;
      case '--done': flags.done = true; break;
      case '--undone': flags.undone = true; break;
      case '--json': break;
      default: flags.positional.push(arg);
    }
  }
  return flags;
}
