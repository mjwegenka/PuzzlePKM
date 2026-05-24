export async function handleSyncCommand(action, args, ctx) {
  if (action !== 'sync') return false;

  const watch = args.includes('--watch') || args.includes('--daemon');
  const intervalIdx = args.findIndex((a) => a === '--interval');
  const intervalMinutes = intervalIdx >= 0
    ? (parseInt(args[intervalIdx + 1], 10) || ctx.SYNC_INTERVAL_MINUTES_DEFAULT)
    : ctx.SYNC_INTERVAL_MINUTES_DEFAULT;

  if (watch) {
    await ctx.runSyncWatch(intervalMinutes);
    return true;
  }

  console.log('Syncing with local folder...');
  const result = await ctx.runSync();
  console.log(`Sync complete — imported: ${result.imported}, updated: ${result.updated}, uploaded: ${result.uploaded}, deleted: ${result.deleted}, warnings: ${result.warnings.length}, errors: ${result.errors.length}`);
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`  [warning] ${warning}`);
    }
  }
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`  [error] ${error}`);
    }
  }
  return true;
}
