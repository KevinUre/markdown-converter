import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';

const INPUT_DIR = path.resolve(process.cwd(), 'input');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output');

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

for (const relPath of allFiles) {
  if (path.extname(relPath).toLowerCase() === '.md') {
    continue;
  }

  const src = path.join(INPUT_DIR, relPath);
  const dst = path.join(OUTPUT_DIR, relPath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

for (const relPath of markdownFiles) {
  const inPath = path.join(INPUT_DIR, relPath);
  const outPath = path.join(OUTPUT_DIR, relPath);
  const source = fs.readFileSync(inPath, 'utf8');
  const converted = convertMarkdownToObsidian(source);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, converted, 'utf8');
}

console.log(`Converted ${markdownFiles.length} markdown files to Obsidian format.`);

function convertMarkdownToObsidian(input) {
  // Convert images first so they don't get picked up by the normal-link regex.
  let output = input.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, _alt, rawHref) => {
    const href = stripOptionalTitle(rawHref);
    if (!isLocalHref(href)) {
      return full;
    }

    const target = decodeAndNormalize(href);
    const basename = path.posix.basename(target);
    if (!basename) {
      return full;
    }

    return `![[${basename}]]`;
  });

  output = output.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (full, text, rawHref) => {
    const href = stripOptionalTitle(rawHref);
    if (!isLocalHref(href)) {
      return full;
    }

    const normalized = decodeAndNormalize(href);
    const [targetPath, anchor] = splitOnFirst(normalized, '#');
    const ext = path.posix.extname(targetPath).toLowerCase();
    if (ext !== '.md') {
      return full;
    }

    const noteName = path.posix.basename(targetPath, '.md');
    if (!noteName) {
      return full;
    }

    const targetWithAnchor = anchor ? `${noteName}#${anchor}` : noteName;
    return text === noteName
      ? `[[${targetWithAnchor}]]`
      : `[[${targetWithAnchor}|${text}]]`;
  });

  return output;
}

function stripOptionalTitle(hrefWithOptionalTitle) {
  const trimmed = hrefWithOptionalTitle.trim();
  const titleMatch = trimmed.match(/^(.+?)\s+"[^"]*"$/);
  return titleMatch ? titleMatch[1] : trimmed;
}

function isLocalHref(href) {
  const lower = href.toLowerCase();
  if (!href || href.startsWith('#') || href.startsWith('/')) {
    return false;
  }
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return false;
  }
  return true;
}

function decodeAndNormalize(href) {
  const decoded = decodeURIComponent(href);
  return decoded.replaceAll('\\', '/');
}

function splitOnFirst(input, delimiter) {
  const idx = input.indexOf(delimiter);
  if (idx === -1) {
    return [input, ''];
  }
  return [input.slice(0, idx), input.slice(idx + 1)];
}
