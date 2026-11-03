# Project map

A graphify knowledge graph of this codebase (code, README/DEPLOY docs, brand assets) is available. Use it to find the right files before reading source. Do not load the whole map.

**Locations**
- Overview: `graphify-out/GRAPH_REPORT.md` (in this repo). Read the "Community Hubs" section first; the god nodes, surprising connections and suggested questions are further down.
- Map (Obsidian vault): `C:\Users\Ariss\Pagelyt\Pagelyt\` (about 1,200 notes, outside the repo). Also `graph.canvas` there; ignore it unless asked.
- Raw graph: `graphify-out/graph.json`, `graphify-out/graph.html`.

**How to use it**
1. Read `graphify-out/GRAPH_REPORT.md` (the overview) first, or just its Community Hubs section, to pick the community that matches the task.
2. Open that community's hub note, `C:\Users\Ariss\Pagelyt\Pagelyt\_COMMUNITY_<name>.md`. It lists the members and their source files.
3. Open only the individual notes you need. Each one has a `source_file` in its frontmatter and `[[wikilinks]]` to connected nodes.
4. Then read the actual source files those notes point to. The source is the truth; the map only locates it.
5. Prefer Grep or Glob on the vault (for example, a symbol name) over reading many notes. Never read every note or every community hub.

**Caveats**
- Notes are named after the symbol or file. Duplicates get suffixes (`Page()_3`, `pdf-lib_1`), so check `source_file` in the frontmatter.
- Blind spots: the scanner worker link (`lib/scanner/client.ts` to `public/scanner/worker.js` to `public/scanner/vision.js`) is missing, and calls through `import * as ops` in `lib/server/processors.ts` to `lib/pdf/ops.ts` are missing. Check the source for those areas.
- The map is a snapshot of the working tree on 2026-11-03. If files have changed a lot, verify against the source, or rebuild with `/graphify . --update`.
