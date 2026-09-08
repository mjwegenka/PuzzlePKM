// DEC-79: The document text index makes the contents of PDFs, Word files and
// Markdown inside project and reference-material folders searchable. These
// commands expose the index to the desktop app, the MCP server, and the shell.
export async function handleDocumentsCommand(action, args, ctx) {
  if (action !== 'documents' && action !== 'document' && action !== 'docs') return false;

  const documentsAction = ctx.normalize(args[0]).toLowerCase() || 'status';
  const { flags, positional } = parseFlags(args.slice(1));
  const asJson = flags.json === 'true';

  if (documentsAction === 'index' || documentsAction === 'reindex') {
    const force = flags.force === 'true' || documentsAction === 'reindex';
    const result = ctx.runDocumentIndex({ force });
    if (asJson) {
      console.log(ctx.formatCompact(result));
      return true;
    }
    console.log(`Document index updated — new: ${result.indexed}, refreshed: ${result.updated}, unchanged: ${result.unchanged}, removed: ${result.removed}, unreadable: ${result.unreadable}`);
    for (const warning of result.warnings) console.warn(`  [warning] ${warning}`);
    for (const error of result.errors) console.error(`  [error] ${error}`);
    return true;
  }

  if (documentsAction === 'search' || documentsAction === 'find') {
    const query = positional.join(' ').trim();
    if (!query) throw new Error(`Usage: ${ctx.PRIMARY_CLI_COMMAND} documents search <query> [--limit N] [--type project|ref-material] [--object <id>] [--json]`);

    const results = ctx.searchDocuments(query, {
      limit: flags.limit ? Number.parseInt(flags.limit, 10) : undefined,
      objectType: flags.type ? ctx.resolveType(flags.type) : undefined,
      objectId: flags.object,
    });

    if (asJson) {
      console.log(ctx.formatCompact(results));
      return true;
    }
    if (results.length === 0) {
      console.log(`No documents match "${query}".`);
      return true;
    }
    for (const match of results) {
      console.log(`${match.objectType}\t${match.objectName}\t${match.relativePath}\t${match.snippet}`);
    }
    return true;
  }

  if (documentsAction === 'list') {
    const documents = ctx.listIndexedDocuments({
      objectId: flags.object,
      limit: flags.limit ? Number.parseInt(flags.limit, 10) : undefined,
    });
    if (asJson) {
      console.log(ctx.formatCompact(documents));
      return true;
    }
    if (documents.length === 0) {
      console.log('No indexed documents yet. Run: ' + `${ctx.PRIMARY_CLI_COMMAND} documents index`);
      return true;
    }
    for (const document of documents) {
      console.log(`${document.objectType}\t${document.status}\t${document.objectName}\t${document.relativePath}\t${document.characterCount} chars`);
    }
    return true;
  }

  if (documentsAction === 'status' || documentsAction === 'show') {
    const status = ctx.documentIndexStatus();
    if (asJson) {
      console.log(ctx.formatCompact(status));
      return true;
    }
    console.log(`Indexed documents: ${status.documents} across ${status.folders} folders (${status.characters.toLocaleString('en-US')} characters, ${status.searchIndex})`);
    console.log(`Readable formats: ${status.supportedExtensions.join(', ')}`);
    for (const [statusName, count] of Object.entries(status.byStatus)) {
      console.log(`  ${statusName}\t${count}`);
    }
    return true;
  }

  throw new Error(`Unknown documents action: ${documentsAction}. Use index, search, list, or status.`);
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
