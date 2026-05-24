export async function handleSettingsCommand(action, args, ctx) {
  if (action !== 'settings') return false;

  const settingsAction = ctx.normalize(args[0]).toLowerCase();
  const target = ctx.normalize(args[1]).toLowerCase();

  if (!settingsAction || settingsAction === 'show') {
    console.log(ctx.formatCompact(ctx.getSettingsState()));
    return true;
  }

  if (settingsAction === 'set' && target === 'root-folder') {
    let folder = ctx.normalize(args[2]);
    if (!folder && ctx.rl) {
      folder = await ctx.prompt(ctx.rl, 'Sync root folder path (e.g. /PuzzlePKM)', { required: true });
    }
    if (!folder) throw new Error('Root folder path is required.');
    ctx.saveSyncRootFolder(folder);
    console.log(ctx.formatCompact(ctx.getSettingsState()));
    return true;
  }

  throw new Error('Unknown settings command');
}
