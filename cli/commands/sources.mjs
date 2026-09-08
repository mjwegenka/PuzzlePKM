// DEC-70: Manage directories that stay where they are on disk and are linked into
// the knowledge base as a project or ref-material. Linked directories are scanned
// on every sync alongside the managed sync root, and are never written to.
export async function handleSourcesCommand(action, args, ctx) {
  if (action !== 'sources' && action !== 'source') return false;

  const sourcesAction = ctx.normalize(args[0]).toLowerCase() || 'list';

  if (sourcesAction === 'list' || sourcesAction === 'show') {
    const sources = ctx.listLinkedSourcesWithStatus();
    if (sources.length === 0) {
      console.log('No linked directories. Add one with: ' +
        `${ctx.PRIMARY_CLI_COMMAND} sources add <path> [--type project|ref-material]`);
      return true;
    }
    for (const source of sources) {
      const status = source.available ? 'ok' : 'unavailable';
      console.log(`${source.objectType}\t${status}\t${source.name}\t${source.path}`);
    }
    return true;
  }

  if (sourcesAction === 'scan') {
    const { positional } = parseFlags(args.slice(1));
    let parent = positional[0];
    if (!parent && ctx.rl) {
      parent = await ctx.prompt(ctx.rl, 'Parent folder to scan', { required: true });
    }
    if (!parent) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} sources scan <parent-path>`);
    console.log(ctx.formatCompact(ctx.scanLinkedSourceCandidates(parent)));
    return true;
  }

  if (sourcesAction === 'add' || sourcesAction === 'link') {
    const rest = args.slice(1);
    const { flags, positional } = parseFlags(rest);
    const paths = positional.filter(Boolean);
    if (paths.length === 0 && ctx.rl) {
      const prompted = await ctx.prompt(ctx.rl, 'Directory path to link', { required: true });
      if (prompted) paths.push(prompted);
    }
    if (paths.length === 0) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} sources add <path...> [--type project|ref-material] [--name "Name"] [--tags a,b]`);

    const objectType = flags.type ?? 'project';

    // One path keeps the single-record output that callers parse; several report per-path outcomes.
    if (paths.length > 1) {
      const summary = ctx.attachLinkedDirectories(paths, objectType);
      for (const entry of summary.added) console.log(`Linked ${objectType} "${entry.name}" -> ${entry.path}`);
      for (const entry of summary.failed) console.error(`Skipped ${entry.path}: ${entry.error}`);
      console.log(ctx.formatCompact(summary));
      return true;
    }

    const { source, record } = ctx.attachLinkedDirectory({
      path: paths[0],
      objectType,
      name: flags.name,
      tags: parseCsv(flags.tags),
    });
    console.log(`Linked ${source.objectType} "${record.name}" -> ${source.path}`);
    console.log(ctx.formatCompact(record));
    return true;
  }

  if (sourcesAction === 'remove' || sourcesAction === 'unlink') {
    const reference = ctx.normalize(args[1]);
    if (!reference) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} sources remove <path-or-id>`);
    const source = ctx.detachLinkedDirectory(reference);
    console.log(`Unlinked ${source.objectType} at ${source.path} (directory left untouched).`);
    return true;
  }

  throw new Error(`Unknown sources command: ${sourcesAction}`);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    const token = String(args[idx] ?? '');
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const [name, inlineValue] = token.slice(2).split('=');
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }
    const next = args[idx + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      flags[name] = next;
      idx += 1;
    } else {
      flags[name] = 'true';
    }
  }
  return { flags, positional };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
