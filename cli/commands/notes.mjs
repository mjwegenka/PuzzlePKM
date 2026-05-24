export async function handleNotesCommand(action, args, ctx) {
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
