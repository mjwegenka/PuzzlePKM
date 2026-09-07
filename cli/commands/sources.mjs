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

  if (sourcesAction === 'add' || sourcesAction === 'link') {
    const rest = args.slice(1);
    const { flags, positional } = parseFlags(rest);
    let path = positional[0];
    if (!path && ctx.rl) {
      path = await ctx.prompt(ctx.rl, 'Directory path to link', { required: true });
    }
    if (!path) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} sources add <path> [--type project|ref-material] [--name "Name"] [--tags a,b]`);

    const { source, record } = ctx.attachLinkedDirectory({
      path,
      objectType: flags.type ?? 'project',
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
