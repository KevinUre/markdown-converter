import fs from 'node:fs';
import path from 'node:path';
import * as YAML from 'yaml';
import { globSync } from 'glob';

const INPUT_DIR = path.resolve(process.cwd(), 'input');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output');

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

const markdownFiles = globSync('**/*.md', {
  cwd: INPUT_DIR,
  absolute: false,
  nodir: true,
  windowsPathsNoEscape: true,
});

const allFiles = globSync('**/*', {
  cwd: INPUT_DIR,
  absolute: false,
  nodir: true,
  windowsPathsNoEscape: true,
});

const noteByKey = new Map();
const noteByAlias = new Map();
const assetsByBasename = new Map();
const unresolved = [];
const warnings = [];

buildIndexes();
copyAssets();
convertAllMarkdownFiles();
printSummary();

function buildIndexes() {
  for (const relPath of markdownFiles) {
    const relPosix = toPosix(relPath);
    const stem = stripExt(relPosix);
    const baseName = path.posix.basename(stem);

    registerUnique(noteByKey, normalizeKey(stem), relPosix, `note key "${stem}"`);
    registerUnique(noteByKey, normalizeKey(baseName), relPosix, `note key "${baseName}"`);

    const absPath = path.join(INPUT_DIR, relPath);
    const contents = fs.readFileSync(absPath, 'utf8');
    for (const alias of readAliases(contents)) {
      registerUnique(noteByAlias, normalizeKey(alias), relPosix, `alias "${alias}"`);
    }
  }

  for (const relPath of allFiles) {
    const relPosix = toPosix(relPath);
    const ext = path.posix.extname(relPosix).toLowerCase();
    if (ext === '.md') {
      continue;
    }

    const baseName = path.posix.basename(relPosix);
    const key = normalizeKey(baseName);
    const existing = assetsByBasename.get(key) || [];
    existing.push(relPosix);
    assetsByBasename.set(key, existing);
  }
}

function convertAllMarkdownFiles() {
  for (const relPath of markdownFiles) {
    const relPosix = toPosix(relPath);
    const converted = renderNote(relPosix, relPosix, new Set());
    const outPath = path.join(OUTPUT_DIR, relPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, converted, 'utf8');
  }
}

function copyAssets() {
  for (const relPath of allFiles) {
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.md') {
      continue;
    }

    const src = path.join(INPUT_DIR, relPath);
    const dst = path.join(OUTPUT_DIR, relPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function renderNote(sourceNotePath, linkBaseNotePath, stack) {
  if (stack.has(sourceNotePath)) {
    return `> [!warning]\n> Skipped recursive embed of "${path.posix.basename(stripExt(sourceNotePath))}".\n`;
  }

  stack.add(sourceNotePath);
  const absPath = path.join(INPUT_DIR, fromPosix(sourceNotePath));
  const source = fs.readFileSync(absPath, 'utf8');
  const expandedEmbeds = expandNoteEmbeds(source, linkBaseNotePath, stack);
  const converted = expandedEmbeds.replace(/(!?)\[\[([^[\]]+?)\]\]/g, (full, bang, inner) => {
    return convertWikilink({
      currentNote: linkBaseNotePath,
      isEmbed: bang === '!',
      inner,
      full,
    });
  });
  stack.delete(sourceNotePath);
  return converted;
}

function expandNoteEmbeds(input, linkBaseNotePath, stack) {
  return input.replace(/!\[\[([^[\]]+?)\]\]/g, (full, inner) => {
    const [rawTarget] = splitOnFirst(inner, '|');
    const targetWithAnchor = (rawTarget || '').trim();
    if (!targetWithAnchor) {
      return full;
    }

    const [targetNameRaw] = splitOnFirst(targetWithAnchor, '#');
    const targetName = targetNameRaw.trim();
    const notePath = resolveNote(targetName);
    if (!notePath) {
      return full;
    }

    return renderNote(notePath, linkBaseNotePath, stack);
  });
}

function convertWikilink({ currentNote, isEmbed, inner, full }) {
  const [rawTarget, rawDisplay] = splitOnFirst(inner, '|');
  const targetWithAnchor = (rawTarget || '').trim();
  const explicitDisplay = rawDisplay ? rawDisplay.trim() : '';

  if (!targetWithAnchor) {
    return full;
  }

  const [targetNameRaw, anchorRaw] = splitOnFirst(targetWithAnchor, '#');
  const targetName = targetNameRaw.trim();
  const anchor = anchorRaw ? `#${encodeAnchor(anchorRaw.trim())}` : '';

  const notePath = resolveNote(targetName);
  const assetPath = resolveAsset(currentNote, targetName);

  if (assetPath && (isEmbed || isImageExtension(targetName))) {
    const href = relativeHref(currentNote, assetPath);
    const alt = explicitDisplay || stripExt(path.posix.basename(assetPath));
    return `![${escapeSquareBrackets(alt)}](${href})`;
  }

  if (notePath) {
    const display = explicitDisplay || inferDisplayText(targetName, notePath);
    const href = `${relativeHref(currentNote, notePath)}${anchor}`;
    return `[${escapeSquareBrackets(display)}](${href})`;
  }

  if (assetPath) {
    const display = explicitDisplay || stripExt(path.posix.basename(assetPath));
    const href = relativeHref(currentNote, assetPath);
    return `[${escapeSquareBrackets(display)}](${href})`;
  }

  unresolved.push({ from: currentNote, link: full, target: targetName });
  return full;
}

function resolveNote(rawTarget) {
  const cleaned = stripMdExtension(toPosix(rawTarget.trim()));
  const normalized = normalizeKey(cleaned);
  const normalizedBase = normalizeKey(path.posix.basename(cleaned));
  return (
    noteByKey.get(normalized) ||
    noteByKey.get(normalizedBase) ||
    noteByAlias.get(normalized) ||
    null
  );
}

function resolveAsset(currentNote, rawTarget) {
  const cleaned = toPosix(rawTarget.trim());
  const directPath = cleaned.replace(/^\.\//, '');
  const directNormalized = normalizeKey(directPath);

  for (const relPath of allFiles) {
    if (normalizeKey(relPath) === directNormalized) {
      return toPosix(relPath);
    }
  }

  const normalized = normalizeKey(path.posix.basename(cleaned));
  const candidates = assetsByBasename.get(normalized) || [];
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const fromDir = path.posix.dirname(currentNote);
  const ranked = candidates
    .map((candidate) => {
      const rel = path.posix.relative(fromDir, candidate);
      const depth = rel.split('/').length;
      const score = rel.startsWith('..') ? depth + 1000 : depth;
      return { candidate, rel, score };
    })
    .sort((a, b) => a.score - b.score || a.rel.length - b.rel.length);

  warnings.push(
    `Duplicate asset basename "${path.posix.basename(cleaned)}": chose "${ranked[0].candidate}" from [${candidates.join(', ')}].`,
  );
  return ranked[0].candidate;
}

function readAliases(contents) {
  const aliases = [];
  const match = contents.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) {
    return aliases;
  }

  try {
    const parsed = YAML.parse(match[1]);
    const value = parsed?.aliases;
    if (Array.isArray(value)) {
      for (const alias of value) {
        if (typeof alias === 'string' && alias.trim()) {
          aliases.push(alias.trim());
        }
      }
    } else if (typeof value === 'string' && value.trim()) {
      aliases.push(value.trim());
    }
  } catch (error) {
    warnings.push(`Unable to parse YAML frontmatter aliases: ${error.message}`);
  }

  return aliases;
}

function relativeHref(fromMd, toRelPath) {
  const fromDir = path.posix.dirname(fromMd);
  let rel = path.posix.relative(fromDir, toRelPath);
  rel = rel || path.posix.basename(toRelPath);
  return encodeHrefPath(ensureDotSlash(rel));
}

function inferDisplayText(rawTargetName, resolvedNotePath) {
  if (noteByAlias.has(normalizeKey(rawTargetName))) {
    return rawTargetName;
  }
  return path.posix.basename(stripExt(resolvedNotePath));
}

function registerUnique(map, key, value, label) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, value);
    return;
  }
  if (map.get(key) !== value) {
    warnings.push(`Duplicate ${label}: "${map.get(key)}" and "${value}". Using first.`);
  }
}

function splitOnFirst(input, delimiter) {
  const idx = input.indexOf(delimiter);
  if (idx === -1) {
    return [input];
  }
  return [input.slice(0, idx), input.slice(idx + 1)];
}

function normalizeKey(value) {
  return toPosix(value).trim().toLowerCase();
}

function stripExt(filePath) {
  return filePath.slice(0, filePath.length - path.posix.extname(filePath).length);
}

function stripMdExtension(filePath) {
  return filePath.toLowerCase().endsWith('.md') ? filePath.slice(0, -3) : filePath;
}

function ensureDotSlash(href) {
  if (href.startsWith('./') || href.startsWith('../') || href.startsWith('/')) {
    return href;
  }
  return `./${href}`;
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function fromPosix(value) {
  return value.replaceAll('/', path.sep);
}

function isImageExtension(value) {
  return IMAGE_EXTENSIONS.has(path.posix.extname(value).toLowerCase());
}

function escapeSquareBrackets(value) {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function encodeHrefPath(href) {
  return href
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function encodeAnchor(anchor) {
  return encodeURIComponent(anchor);
}

function printSummary() {
  console.log(`Converted ${markdownFiles.length} markdown files.`);
  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
  if (unresolved.length > 0) {
    console.log('\nUnresolved links:');
    for (const item of unresolved) {
      console.log(`- ${item.from}: ${item.link}`);
    }
  }
}
