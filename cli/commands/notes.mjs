export async function handleNotesCommand(action, args, ctx) {
  if (action === 'migrate-links') {
    const allowedFlags = new Set(['--dry-run', '--apply']);
    const unknownFlag = args.find((arg) => arg.startsWith('-') && !allowedFlags.has(arg));
    if (unknownFlag) {
      throw new Error(`Unknown flag: ${unknownFlag}`);
    }
    const dryRun = args.includes('--dry-run');
    const apply = args.includes('--apply');
    if (dryRun && apply) {
      throw new Error(`Use either --dry-run or --apply (not both): ${ctx.PRIMARY_CLI_COMMAND} migrate-links [--dry-run|--apply]`);
    }
    const result = ctx.runLegacyLinkMigration({ apply });
    console.log(ctx.formatCompact(result));
    return true;
  }

  if (action === 'add') {
    const text = args.join(' ').trim();
    if (!text) throw new Error(`Please provide note text: ${ctx.PRIMARY_CLI_COMMAND} add <text>`);
    const created = ctx.withDb((db) => ctx.createTopicNoteRecord(db, {
      id: ctx.randomUUID(),
      title: ctx.titleFromText(text),
      content: {},
      contentMarkdown: text,
      linkedObjectIds: [],
      tags: [],
      createdAt: ctx.getIsoNow(),
      updatedAt: ctx.getIsoNow(),
    }));
    console.log(`Added topic note ${created.id}`);
    return true;
  }

  if (action === 'import') {
    const type = ctx.resolveType(args[0]);
    const directory = args[1];
    if ((type !== 'daily-note' && type !== 'topic-note') || !directory) {
      throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} import <daily-note|topic-note> <directory>`);
    }
    console.log(ctx.formatCompact(ctx.importNotesFromDirectory(type, directory)));
    return true;
  }

  return false;
}
