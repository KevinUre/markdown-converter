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
const markdownFileSet = new Set(markdownFiles.map((p) => toPosix(p)));
const headingMapCache = new Map();

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
  const converted = convertMarkdownToObsidian(source, toPosix(relPath));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, converted, 'utf8');
}

console.log(`Converted ${markdownFiles.length} markdown files to Obsidian format.`);

function convertMarkdownToObsidian(input, currentRelPath) {
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

    const obsidianAnchor = anchor
      ? resolveAnchorHeadingCase(currentRelPath, targetPath, anchor)
      : '';
    const targetWithAnchor = obsidianAnchor ? `${noteName}#${obsidianAnchor}` : noteName;
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

function githubFragmentToObsidianHeading(fragment) {
  return decodeURIComponent(fragment).replace(/-/g, ' ').trim();
}

function resolveAnchorHeadingCase(currentRelPath, linkTargetPath, fragment) {
  const normalizedTarget = resolveTargetNotePath(currentRelPath, linkTargetPath);
  if (!normalizedTarget) {
    return githubFragmentToObsidianHeading(fragment);
  }

  const headingMap = getHeadingMap(normalizedTarget);
  const key = normalizeGithubFragment(fragment);
  return headingMap.get(key) || githubFragmentToObsidianHeading(fragment);
}

function resolveTargetNotePath(currentRelPath, linkTargetPath) {
  const currentDir = path.posix.dirname(currentRelPath);
  const candidate = path.posix.normalize(path.posix.join(currentDir, linkTargetPath));
  if (candidate.startsWith('../')) {
    return null;
  }
  return markdownFileSet.has(candidate) ? candidate : null;
}

function getHeadingMap(relPath) {
  if (headingMapCache.has(relPath)) {
    return headingMapCache.get(relPath);
  }

  const absPath = path.join(INPUT_DIR, fromPosix(relPath));
  const content = fs.readFileSync(absPath, 'utf8');
  const map = new Map();
  let inFence = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trimEnd();
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!headingMatch) {
      continue;
    }

    const headingText = headingMatch[1].trim();
    if (!headingText) {
      continue;
    }

    const key = normalizeGithubFragment(headingToGithubFragment(headingText));
    if (!map.has(key)) {
      map.set(key, headingText);
    }
  }

  headingMapCache.set(relPath, map);
  return map;
}

function headingToGithubFragment(heading) {
  return heading.trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeGithubFragment(fragment) {
  return decodeURIComponent(fragment).trim().toLowerCase().replace(/\s+/g, '-');
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}

function fromPosix(value) {
  return value.replaceAll('/', path.sep);
}
