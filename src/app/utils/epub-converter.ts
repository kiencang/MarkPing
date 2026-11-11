import {strFromU8, unzipSync} from 'fflate';
import {
  ArticleMetadata,
  ConversionOptions,
  ConversionResult,
  convertHtmlToCleanMarkdown,
  DEFAULT_CONVERSION_OPTIONS,
} from './markdown-converter';

export interface EpubChapter {
  id: string;
  href: string;
  html: string;
}

export interface ParsedEpubBook {
  metadata: ArticleMetadata;
  chapters: EpubChapter[];
  combinedHtml: string;
}

/**
 * Resolves a relative path inside an EPUB archive against a base directory.
 */
export function resolveEpubPath(baseDir: string, relativeHref: string): string {
  const cleanHref = decodeURIComponent(relativeHref.split('#')[0].split('?')[0]);
  const combined = baseDir ? `${baseDir.replace(/\/+$/, '')}/${cleanHref}` : cleanHref;
  const parts = combined.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

/**
 * Finds a file in the unzipped archive map (case-insensitive fallback).
 */
function findArchiveFile(
  files: Record<string, Uint8Array>,
  targetPath: string
): Uint8Array | null {
  const normalizedTarget = targetPath.replace(/^\/+/, '');
  if (files[normalizedTarget]) {
    return files[normalizedTarget];
  }
  const lowerTarget = normalizedTarget.toLowerCase();
  for (const [key, value] of Object.entries(files)) {
    if (key.replace(/^\/+/, '').toLowerCase() === lowerTarget) {
      return value;
    }
  }
  return null;
}

/**
 * Helper to read text content of the first matching XML tag (ignoring XML namespace prefixes like dc:title).
 */
function getMetadataTagText(doc: Document, localName: string): string | null {
  const candidates = [
    ...Array.from(doc.getElementsByTagName(`dc:${localName}`)),
    ...Array.from(doc.getElementsByTagName(localName)),
  ];
  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (text) return text;
  }
  return null;
}

/**
 * Cleans chapter HTML while preserving 100% of book content and converting SVG <image> wrappers to <img>.
 */
function extractChapterBodyHtml(
  rawChapterXml: string,
  parseHtml: (html: string) => Document
): string {
  const doc = parseHtml(rawChapterXml);

  // Remove only technical non-content elements
  doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());

  // Convert SVG <image href="..."> or <image xlink:href="..."> (common in EPUB covers/illustrations) into <img>
  doc.querySelectorAll('svg image, image').forEach((svgImg) => {
    const src =
      svgImg.getAttribute('xlink:href') ||
      svgImg.getAttribute('href') ||
      svgImg.getAttribute('src');
    if (src) {
      const img = doc.createElement('img');
      img.setAttribute('src', src);
      const alt = svgImg.getAttribute('alt') || svgImg.getAttribute('title') || 'Image';
      img.setAttribute('alt', alt);
      const parentSvg = svgImg.closest('svg');
      if (parentSvg) {
        parentSvg.replaceWith(img);
      } else {
        svgImg.replaceWith(img);
      }
    }
  });

  const bodyContent = doc.body ? doc.body.innerHTML.trim() : doc.documentElement?.innerHTML?.trim() || '';
  return bodyContent;
}

/**
 * Extracts metadata, spine chapter order, and full chapter HTML from an EPUB binary buffer.
 * Operates 100% client-side in memory without any server or Readability stripping.
 */
export function extractEpubArchive(
  buffer: ArrayBuffer | Uint8Array,
  customParser?: (html: string) => Document
): ParsedEpubBook {
  const parseHtml =
    customParser ??
    ((html: string): Document => {
      const parser = new DOMParser();
      return parser.parseFromString(html, 'text/html');
    });

  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = unzipSync(uint8);

  // 1. Locate META-INF/container.xml to find the OPF rootfile path
  const containerBytes = findArchiveFile(files, 'META-INF/container.xml');
  let opfPath = '';

  if (containerBytes) {
    const containerXml = strFromU8(containerBytes);
    const containerDoc = parseHtml(containerXml);
    const rootfileEl = containerDoc.querySelector('rootfile[full-path]');
    opfPath = rootfileEl?.getAttribute('full-path')?.trim() || '';
  }

  // Fallback: search for any .opf file in the archive if container.xml is missing
  if (!opfPath) {
    const opfKey = Object.keys(files).find((k) => k.toLowerCase().endsWith('.opf'));
    if (!opfKey) {
      throw new Error('Tệp EPUB không hợp lệ: Không tìm thấy cấu trúc sách (.opf).');
    }
    opfPath = opfKey;
  }

  const opfBytes = findArchiveFile(files, opfPath);
  if (!opfBytes) {
    throw new Error(`Không tìm thấy tệp cấu hình OPF tại đường dẫn: ${opfPath}`);
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfXml = strFromU8(opfBytes);
  const opfDoc = parseHtml(opfXml);

  // 2. Extract Dublin Core metadata from OPF
  const rawDescription = getMetadataTagText(opfDoc, 'description');
  let cleanExcerpt: string | null = null;
  if (rawDescription) {
    const descDoc = parseHtml(`<!doctype html><html><body>${rawDescription}</body></html>`);
    cleanExcerpt = descDoc.body?.textContent?.trim() || rawDescription;
  }

  const metadata: ArticleMetadata = {
    title: getMetadataTagText(opfDoc, 'title') || 'Sách EPUB',
    byline: getMetadataTagText(opfDoc, 'creator'),
    siteName: getMetadataTagText(opfDoc, 'publisher'),
    excerpt: cleanExcerpt,
    lang: getMetadataTagText(opfDoc, 'language'),
    publishedTime: getMetadataTagText(opfDoc, 'date'),
  };

  // 3. Build Manifest lookup map (id -> href)
  const manifestMap = new Map<string, {href: string; mediaType: string}>();
  opfDoc.querySelectorAll('manifest item[id][href]').forEach((item) => {
    const id = item.getAttribute('id')!;
    const href = item.getAttribute('href')!;
    const mediaType = item.getAttribute('media-type') || '';
    manifestMap.set(id, {href, mediaType});
  });

  // 4. Read Spine order (<spine><itemref idref="..."/></spine>)
  const spineHrefs: {id: string; href: string}[] = [];
  const seenPaths = new Set<string>();

  opfDoc.querySelectorAll('spine itemref[idref]').forEach((itemref) => {
    const idref = itemref.getAttribute('idref')!;
    const linear = itemref.getAttribute('linear');
    if (linear && linear.toLowerCase() === 'no') {
      return;
    }
    const manifestEntry = manifestMap.get(idref);
    if (manifestEntry) {
      const resolvedPath = resolveEpubPath(opfDir, manifestEntry.href);
      if (!seenPaths.has(resolvedPath)) {
        seenPaths.add(resolvedPath);
        spineHrefs.push({id: idref, href: resolvedPath});
      }
    }
  });

  // Fallback if spine was empty: take all HTML/XHTML items in manifest
  if (spineHrefs.length === 0) {
    manifestMap.forEach((entry, id) => {
      if (
        entry.mediaType.includes('html') ||
        /\.(xhtml|html|htm)$/i.test(entry.href)
      ) {
        const resolvedPath = resolveEpubPath(opfDir, entry.href);
        if (!seenPaths.has(resolvedPath)) {
          seenPaths.add(resolvedPath);
          spineHrefs.push({id, href: resolvedPath});
        }
      }
    });
  }

  // 5. Extract full HTML content of each chapter in spine order
  const chapters: EpubChapter[] = [];
  for (const item of spineHrefs) {
    const chapterBytes = findArchiveFile(files, item.href);
    if (!chapterBytes) continue;

    const rawChapter = strFromU8(chapterBytes);
    const bodyHtml = extractChapterBodyHtml(rawChapter, parseHtml);

    // Keep non-empty chapters (containing text or images)
    if (bodyHtml.trim().length > 0) {
      chapters.push({
        id: item.id,
        href: item.href,
        html: bodyHtml,
      });
    }
  }

  if (chapters.length === 0) {
    throw new Error('Không tìm thấy nội dung chương nào bên trong tệp EPUB.');
  }

  // Join chapters with <hr /> so Turndown renders `---` between chapters as requested
  const combinedHtml = chapters.map((ch) => ch.html).join('\n\n<hr />\n\n');

  return {
    metadata,
    chapters,
    combinedHtml,
  };
}

/**
 * High-level helper to convert an EPUB binary buffer directly to clean Markdown.
 */
export function convertEpubBufferToMarkdown(
  buffer: ArrayBuffer | Uint8Array,
  options: ConversionOptions = DEFAULT_CONVERSION_OPTIONS,
  customParser?: (html: string) => Document
): ConversionResult {
  const book = extractEpubArchive(buffer, customParser);
  return convertHtmlToCleanMarkdown(book.combinedHtml, options, customParser, {
    skipReadability: true,
    presetMetadata: book.metadata,
    chapterCount: book.chapters.length,
  });
}
