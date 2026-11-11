import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';

export interface ConversionOptions {
  includeFrontmatter: boolean;
  enableGfm: boolean;
  headingStyle: 'atx' | 'setext';
  codeBlockStyle: 'fenced' | 'indented';
  bulletListMarker: '-' | '*' | '+';
  keepImages: boolean;
}

export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  includeFrontmatter: true,  // Default ON as requested
  enableGfm: true,           // Default ON as requested
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  keepImages: true,          // Default ON: keeps ![alt](images/...)
};

export interface ArticleMetadata {
  title: string;
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  lang: string | null;
  publishedTime: string | null;
}

export interface ConversionStats {
  wordCount: number;
  charCount: number;
  lineCount: number;
  readingTimeMinutes: number;
  inputCharCount: number;
  reductionPercentage: number;
}

export interface ConversionContext {
  skipReadability?: boolean;
  presetMetadata?: Partial<ArticleMetadata>;
  chapterCount?: number;
  randomSuffix?: string;
}

export interface ConversionResult {
  markdown: string;
  cleanHtml: string;
  metadata: ArticleMetadata;
  stats: ConversionStats;
  suggestedFilename: string;
  usedFallback: boolean;
  isEmpty: boolean;
  error: string | null;
  chapterCount?: number;
}

/**
 * Generates a random 5-digit numeric string (10000 - 99999).
 */
export function generateRandomFiveDigitSuffix(): string {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

/**
 * Extracts YouTube VIDEO_ID from common YouTube embed/watch/short URLs.
 */
export function extractYouTubeVideoId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  const url = rawUrl.trim();

  // Match youtube.com/embed/VIDEO_ID, youtube-nocookie.com/embed/VIDEO_ID, youtube.com/v/VIDEO_ID, youtube.com/shorts/VIDEO_ID, youtu.be/VIDEO_ID
  const pathMatch = url.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:embed|v|shorts)\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i
  );
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  // Match youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/youtube(?:-nocookie)?\.com\/watch\?(?:[^#]*&)?v=([a-zA-Z0-9_-]{6,})/i);
  if (watchMatch?.[1]) {
    return watchMatch[1];
  }

  return null;
}

/**
 * Normalizes a string (including Vietnamese diacritics) into a clean filename slug:
 * - Maximum 5 single words (whitespace-separated), cutting off from the 6th word onward.
 * - Appends a 5-digit random number at the end (e.g. "why-is-nvidia-so-powerful-53643").
 */
export function slugifyTitle(title: string | null | undefined, customSuffix?: string): string {
  const suffix =
    customSuffix && /^\d{5}$/.test(customSuffix)
      ? customSuffix
      : generateRandomFiveDigitSuffix();

  if (!title || !title.trim()) {
    return `cleaned-article-${suffix}`;
  }

  const words = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  if (words.length === 0) {
    return `cleaned-article-${suffix}`;
  }

  return `${words.join('-')}-${suffix}`;
}

/**
 * Escapes a string value for safe single-line YAML frontmatter output.
 */
export function escapeYamlValue(value: string): string {
  const cleaned = value.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
  const escaped = cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Builds a YAML Frontmatter block from extracted metadata.
 */
export function buildYamlFrontmatter(metadata: ArticleMetadata): string {
  const lines: string[] = ['---'];
  if (metadata.title) {
    lines.push(`title: ${escapeYamlValue(metadata.title)}`);
  }
  if (metadata.byline) {
    lines.push(`author: ${escapeYamlValue(metadata.byline)}`);
  }
  if (metadata.siteName) {
    lines.push(`siteName: ${escapeYamlValue(metadata.siteName)}`);
  }
  if (metadata.publishedTime) {
    lines.push(`publishedTime: ${escapeYamlValue(metadata.publishedTime)}`);
  }
  if (metadata.excerpt) {
    lines.push(`excerpt: ${escapeYamlValue(metadata.excerpt)}`);
  }
  if (metadata.lang) {
    lines.push(`lang: ${escapeYamlValue(metadata.lang)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Computes word, character, line, and reduction statistics.
 */
export function computeStats(markdown: string, inputHtml: string): ConversionStats {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return {
      wordCount: 0,
      charCount: 0,
      lineCount: 0,
      readingTimeMinutes: 0,
      inputCharCount: inputHtml.length,
      reductionPercentage: 0,
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = trimmed.length;
  const lineCount = trimmed.split(/\r?\n/).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
  const inputCharCount = inputHtml.length;
  const reductionPercentage =
    inputCharCount > 0
      ? Math.max(0, Math.min(99, Math.round(((inputCharCount - charCount) / inputCharCount) * 100)))
      : 0;

  return {
    wordCount,
    charCount,
    lineCount,
    readingTimeMinutes,
    inputCharCount,
    reductionPercentage,
  };
}

/**
 * Strips noisy non-content elements from a fallback DOM element when Readability returns null.
 */
function sanitizeFallbackContainer(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  const noisySelectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'nav',
    'footer',
    'header.site-header',
    'aside',
    '.ads',
    '.advertisement',
    '.cookie-banner',
  ];
  noisySelectors.forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });
  return clone.body ? clone.body.innerHTML.trim() : '';
}

/**
 * Strips only non-visible technical tags (<script>, <style>, <noscript>) for full-content EPUB mode.
 */
function sanitizeDirectBookContainer(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
  return clone.body ? clone.body.innerHTML.trim() : '';
}

/**
 * Converts raw HTML string to clean Markdown using Mozilla Readability (for HTML web pages)
 * or direct full-content preservation (when context.skipReadability is true, e.g. EPUB books)
 * and Turndown + turndown-plugin-gfm.
 */
export function convertHtmlToCleanMarkdown(
  rawHtml: string,
  options: ConversionOptions = DEFAULT_CONVERSION_OPTIONS,
  customParser?: (html: string) => Document,
  context?: ConversionContext
): ConversionResult {
  const trimmedInput = rawHtml.trim();
  if (!trimmedInput) {
    return {
      markdown: '',
      cleanHtml: '',
      metadata: {
        title: '',
        byline: null,
        excerpt: null,
        siteName: null,
        lang: null,
        publishedTime: null,
      },
      stats: computeStats('', ''),
      suggestedFilename: 'cleaned-article.md',
      usedFallback: false,
      isEmpty: true,
      error: null,
    };
  }

  try {
    const parseHtml =
      customParser ??
      ((html: string): Document => {
        const parser = new DOMParser();
        return parser.parseFromString(html, 'text/html');
      });

    const doc = parseHtml(trimmedInput);

    // 1. Preserve GFM task list checkboxes
    doc.querySelectorAll('li input[type="checkbox"]').forEach((checkbox) => {
      const isChecked =
        checkbox.hasAttribute('checked') || (checkbox as HTMLInputElement).checked;
      const marker = doc.createTextNode(
        isChecked ? 'MPTASKCHECKEDTOKEN ' : 'MPTASKUNCHECKEDTOKEN '
      );
      checkbox.replaceWith(marker);
    });

    // 2. Preserve YouTube <iframe> embeds via indexed alphanumeric tokens so neither Readability nor Turndown drops/escapes them
    const youtubeVideoIds: string[] = [];
    doc.querySelectorAll('iframe').forEach((iframe) => {
      const src =
        iframe.getAttribute('src') ||
        iframe.getAttribute('data-src') ||
        iframe.getAttribute('data-lazy-src') ||
        '';
      const videoId = extractYouTubeVideoId(src);
      if (videoId) {
        const idx = youtubeVideoIds.length;
        youtubeVideoIds.push(videoId);
        const tokenP = doc.createElement('p');
        tokenP.textContent = `MPYOUTUBETOKEN${idx}END`;
        iframe.replaceWith(tokenP);
      }
    });

    // 3. Shorten huge base64 image payloads before Readability clones the DOM, while keeping the data:image/ prefix
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (/^data:image\/|^data:[^;]+;base64,/i.test(src.trim())) {
        img.setAttribute('src', 'data:image/png;base64,omitted');
      }
    });

    // 4. Preserve code language classes
    const codeLangClasses = new Set<string>();
    doc.querySelectorAll('pre code[class], pre[class], code[class]').forEach((el) => {
      el.classList.forEach((cls) => {
        if (cls.startsWith('language-') || cls.startsWith('lang-')) {
          codeLangClasses.add(cls);
        }
      });
    });

    const originalDocTitle =
      context?.presetMetadata?.title?.trim() ||
      doc.title?.trim() ||
      doc.querySelector('h1')?.textContent?.trim() ||
      '';

    let cleanHtml = '';
    let usedFallback = false;
    let metadata: ArticleMetadata;

    if (context?.skipReadability) {
      // EPUB Book Mode: Preserve 100% of book content without Readability trimming
      cleanHtml = sanitizeDirectBookContainer(doc);
      metadata = {
        title: originalDocTitle || 'Sách EPUB',
        byline: context.presetMetadata?.byline ?? null,
        excerpt: context.presetMetadata?.excerpt ?? null,
        siteName: context.presetMetadata?.siteName ?? null,
        lang:
          context.presetMetadata?.lang ??
          doc.documentElement?.getAttribute('lang') ??
          null,
        publishedTime: context.presetMetadata?.publishedTime ?? null,
      };
    } else {
      // HTML Webpage Mode: Extract main article via Mozilla Readability
      const fallbackHtml = sanitizeFallbackContainer(doc);
      const reader = new Readability(doc, {
        keepClasses: false,
        classesToPreserve: Array.from(codeLangClasses),
      });
      const parsed = reader.parse();

      if (parsed && parsed.content && parsed.content.trim().length > 0) {
        cleanHtml = parsed.content.trim();
        metadata = {
          title: parsed.title?.trim() || originalDocTitle || 'Bài viết đã trích xuất',
          byline: parsed.byline?.trim() || null,
          excerpt: parsed.excerpt?.trim() || null,
          siteName: parsed.siteName?.trim() || null,
          lang: parsed.lang?.trim() || null,
          publishedTime: parsed.publishedTime?.trim() || null,
        };
      } else {
        usedFallback = true;
        cleanHtml = fallbackHtml;
        metadata = {
          title: originalDocTitle || 'Đoạn nội dung HTML',
          byline: null,
          excerpt: null,
          siteName: null,
          lang: doc.documentElement?.getAttribute('lang') || null,
          publishedTime: null,
        };
      }
    }

    const turndownService = new TurndownService({
      headingStyle: options.headingStyle,
      hr: '---',
      bulletListMarker: options.bulletListMarker,
      codeBlockStyle: options.codeBlockStyle,
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });

    if (options.enableGfm) {
      turndownService.use(gfm);
    }

    if (!options.keepImages) {
      turndownService.remove('img');
      turndownService.remove('picture');
    } else {
      // Replace base64 images with concise placeholder note: ![alt text]([Ảnh Base64 đã lược bỏ])
      turndownService.addRule('base64Image', {
        filter: (node) => {
          if (node.nodeName !== 'IMG') return false;
          const src = (node as HTMLElement).getAttribute('src') || '';
          return /^data:image\/|^data:[^;]+;base64,/i.test(src.trim());
        },
        replacement: (_content, node) => {
          const alt = ((node as HTMLElement).getAttribute('alt') || '')
            .replace(/\r?\n|\r/g, ' ')
            .trim();
          return `![${alt}]([Ảnh Base64 đã lược bỏ])`;
        },
      });
    }

    // Remove stray script/style tags if any remain
    turndownService.remove(['script', 'style', 'noscript']);

    // Convert DOM or HTML string to Markdown
    const bodyDoc = parseHtml(`<!doctype html><html><body>${cleanHtml}</body></html>`);
    let bodyMarkdown = turndownService.turndown(bodyDoc.body).trim();

    // Restore GFM task list tokens
    if (options.enableGfm) {
      bodyMarkdown = bodyMarkdown
        .replace(/MPTASKCHECKEDTOKEN\s*/g, '[x] ')
        .replace(/MPTASKUNCHECKEDTOKEN\s*/g, '[ ] ');
    } else {
      bodyMarkdown = bodyMarkdown
        .replace(/MPTASKCHECKEDTOKEN\s*/g, '')
        .replace(/MPTASKUNCHECKEDTOKEN\s*/g, '');
    }

    // Restore YouTube iframe tokens as [🎬 Xem video YouTube](https://www.youtube.com/watch?v=VIDEO_ID)
    bodyMarkdown = bodyMarkdown.replace(/MPYOUTUBETOKEN(\d+)END/g, (_match, indexStr) => {
      const videoId = youtubeVideoIds[Number(indexStr)];
      return videoId
        ? `[🎬 Xem video YouTube](https://www.youtube.com/watch?v=${videoId})`
        : '';
    });

    // Restore tokens in cleanHtml for Reader Preview
    cleanHtml = cleanHtml
      .replace(/MPTASKCHECKEDTOKEN\s*/g, '<input type="checkbox" checked disabled> ')
      .replace(/MPTASKUNCHECKEDTOKEN\s*/g, '<input type="checkbox" disabled> ')
      .replace(/MPYOUTUBETOKEN(\d+)END/g, (_match, indexStr) => {
        const videoId = youtubeVideoIds[Number(indexStr)];
        return videoId
          ? `<a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer">🎬 Xem video YouTube</a>`
          : '';
      });

    // Clean unnecessary backslash before period in numbered ATX headings (e.g. "## 1\. Title" -> "## 1. Title")
    bodyMarkdown = bodyMarkdown.replace(/^(#{1,6}\s+\d+)\\\.\s+/gm, '$1. ');

    // Normalize 3+ consecutive blank lines into at most 2 newlines
    bodyMarkdown = bodyMarkdown.replace(/\n{3,}/g, '\n\n');

    // Prepend H1 title if not already present at top and frontmatter is off
    const hasTopH1 = /^#\s+.+/m.test(bodyMarkdown.split('\n')[0] || '');
    let finalMarkdown = bodyMarkdown;

    if (options.includeFrontmatter) {
      const yamlBlock = buildYamlFrontmatter(metadata);
      finalMarkdown = `${yamlBlock}\n\n${bodyMarkdown}`.trim();
    } else if (metadata.title && !hasTopH1 && !usedFallback) {
      finalMarkdown = `# ${metadata.title}\n\n${bodyMarkdown}`.trim();
    }

    const stats = computeStats(finalMarkdown, rawHtml);
    const suggestedFilename = `${slugifyTitle(metadata.title, context?.randomSuffix)}.md`;

    return {
      markdown: finalMarkdown,
      cleanHtml,
      metadata,
      stats,
      suggestedFilename,
      usedFallback,
      isEmpty: finalMarkdown.length === 0,
      error: null,
      chapterCount: context?.chapterCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không thể phân tích cú pháp nội dung.';
    return {
      markdown: '',
      cleanHtml: '',
      metadata: {
        title: '',
        byline: null,
        excerpt: null,
        siteName: null,
        lang: null,
        publishedTime: null,
      },
      stats: computeStats('', rawHtml),
      suggestedFilename: 'cleaned-article.md',
      usedFallback: false,
      isEmpty: true,
      error: message,
    };
  }
}
