import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {
  ArticleMetadata,
  ConversionContext,
  ConversionOptions,
  ConversionResult,
  convertHtmlToCleanMarkdown,
  DEFAULT_CONVERSION_OPTIONS,
  generateRandomFiveDigitSuffix,
  slugifyTitle,
} from './utils/markdown-converter';
import {extractEpubArchive} from './utils/epub-converter';

const OPTIONS_STORAGE_KEY = 'markping_conversion_options';

function loadSavedOptions(): ConversionOptions {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {...DEFAULT_CONVERSION_OPTIONS};
    }
    const raw = window.localStorage.getItem(OPTIONS_STORAGE_KEY);
    if (!raw) {
      return {...DEFAULT_CONVERSION_OPTIONS};
    }
    const parsed = JSON.parse(raw) as Partial<ConversionOptions>;
    return {
      ...DEFAULT_CONVERSION_OPTIONS,
      includeFrontmatter:
        typeof parsed.includeFrontmatter === 'boolean'
          ? parsed.includeFrontmatter
          : DEFAULT_CONVERSION_OPTIONS.includeFrontmatter,
      enableGfm:
        typeof parsed.enableGfm === 'boolean'
          ? parsed.enableGfm
          : DEFAULT_CONVERSION_OPTIONS.enableGfm,
      keepImages:
        typeof parsed.keepImages === 'boolean'
          ? parsed.keepImages
          : DEFAULT_CONVERSION_OPTIONS.keepImages,
      headingStyle:
        parsed.headingStyle === 'atx' || parsed.headingStyle === 'setext'
          ? parsed.headingStyle
          : DEFAULT_CONVERSION_OPTIONS.headingStyle,
    };
  } catch {
    return {...DEFAULT_CONVERSION_OPTIONS};
  }
}

function saveOptionsToStorage(options: ConversionOptions): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options));
    }
  } catch {
    // Ignore storage quota or private mode errors
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '(document:keydown.escape)': 'closeSettings()',
  },
})
export class App {
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  // Core reactive state
  readonly rawHtml = signal<string>('');
  readonly uploadedFilename = signal<string | null>(null);
  readonly uploadedFileSize = signal<number | null>(null);
  readonly customFilename = signal<string>('');
  readonly fileRandomSuffix = signal<string>(generateRandomFiveDigitSuffix());
  readonly options = signal<ConversionOptions>(loadSavedOptions());

  // Source mode state ('html' uses Readability; 'epub' skips Readability to preserve full book content)
  readonly sourceMode = signal<'html' | 'epub'>('html');
  readonly epubMetadata = signal<ArticleMetadata | null>(null);
  readonly epubChapterCount = signal<number | undefined>(undefined);
  readonly parseError = signal<string | null>(null);

  // UI state
  readonly outputTab = signal<'markdown' | 'preview'>('markdown');
  readonly mobilePane = signal<'input' | 'output'>('input');
  readonly isDraggingOver = signal<boolean>(false);
  readonly copyFeedback = signal<boolean>(false);
  readonly isSettingsOpen = signal<boolean>(false);

  // Input line count for IDE bottom status bar
  readonly inputLineCount = computed<number>(() => {
    const text = this.rawHtml();
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  });

  // Derived conversion result (100% synchronous client-side)
  readonly conversion = computed<ConversionResult>(() => {
    const err = this.parseError();
    const suffix = this.fileRandomSuffix();
    if (err) {
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
        stats: {
          wordCount: 0,
          charCount: 0,
          lineCount: 0,
          readingTimeMinutes: 0,
          inputCharCount: 0,
          reductionPercentage: 0,
        },
        suggestedFilename: `cleaned-article-${suffix}.md`,
        usedFallback: false,
        isEmpty: true,
        error: err,
      };
    }

    const isEpub = this.sourceMode() === 'epub';
    const context: ConversionContext = isEpub
      ? {
          skipReadability: true,
          presetMetadata: this.epubMetadata() ?? undefined,
          chapterCount: this.epubChapterCount(),
          randomSuffix: suffix,
        }
      : {
          randomSuffix: suffix,
        };

    return convertHtmlToCleanMarkdown(this.rawHtml(), this.options(), undefined, context);
  });

  // Effective filename for local download
  readonly effectiveFilename = computed<string>(() => {
    const custom = this.customFilename().trim();
    if (custom) {
      return custom.endsWith('.md') ? custom : `${custom}.md`;
    }
    const suffix = this.fileRandomSuffix();
    const result = this.conversion();
    if (!result.isEmpty && result.suggestedFilename) {
      return result.suggestedFilename;
    }
    const uploaded = this.uploadedFilename();
    if (uploaded) {
      const base = uploaded.replace(/\.(epub|html?|htm|xhtml)$/i, '');
      return `${slugifyTitle(base, suffix)}.md`;
    }
    return `cleaned-article-${suffix}.md`;
  });

  // Safe HTML for Clean Reader Preview tab
  readonly safePreviewHtml = computed<SafeHtml>(() => {
    const html = this.conversion().cleanHtml;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  openSettings(): void {
    this.isSettingsOpen.set(true);
  }

  closeSettings(): void {
    this.isSettingsOpen.set(false);
  }

  resetDefaultOptions(): void {
    const defaults = {...DEFAULT_CONVERSION_OPTIONS};
    this.options.set(defaults);
    saveOptionsToStorage(defaults);
  }

  updateHtmlInput(value: string): void {
    const wasEmpty = !this.rawHtml().trim();
    this.parseError.set(null);
    if (!value.trim()) {
      this.sourceMode.set('html');
      this.epubMetadata.set(null);
      this.epubChapterCount.set(undefined);
      this.uploadedFilename.set(null);
      this.uploadedFileSize.set(null);
      this.fileRandomSuffix.set(generateRandomFiveDigitSuffix());
    } else if (wasEmpty) {
      this.fileRandomSuffix.set(generateRandomFiveDigitSuffix());
    }
    this.rawHtml.set(value);
  }

  toggleFrontmatter(): void {
    this.options.update((prev) => {
      const next = {
        ...prev,
        includeFrontmatter: !prev.includeFrontmatter,
      };
      saveOptionsToStorage(next);
      return next;
    });
  }

  toggleGfm(): void {
    this.options.update((prev) => {
      const next = {
        ...prev,
        enableGfm: !prev.enableGfm,
      };
      saveOptionsToStorage(next);
      return next;
    });
  }

  toggleKeepImages(): void {
    this.options.update((prev) => {
      const next = {
        ...prev,
        keepImages: !prev.keepImages,
      };
      saveOptionsToStorage(next);
      return next;
    });
  }

  setHeadingStyle(style: 'atx' | 'setext'): void {
    this.options.update((prev) => {
      const next = {
        ...prev,
        headingStyle: style,
      };
      saveOptionsToStorage(next);
      return next;
    });
  }

  clearAll(): void {
    this.rawHtml.set('');
    this.uploadedFilename.set(null);
    this.uploadedFileSize.set(null);
    this.customFilename.set('');
    this.fileRandomSuffix.set(generateRandomFiveDigitSuffix());
    this.sourceMode.set('html');
    this.epubMetadata.set(null);
    this.epubChapterCount.set(undefined);
    this.parseError.set(null);
    this.mobilePane.set('input');
    if (this.fileInputRef?.nativeElement) {
      this.fileInputRef.nativeElement.value = '';
    }
  }

  triggerFileSelect(): void {
    this.fileInputRef?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.processSelectedFile(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver.set(false);

    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.processSelectedFile(file);
    }
  }

  private processSelectedFile(file: File): void {
    this.parseError.set(null);
    this.fileRandomSuffix.set(generateRandomFiveDigitSuffix());
    const isEpubFile =
      file.name.toLowerCase().endsWith('.epub') ||
      file.type === 'application/epub+zip';

    if (isEpubFile) {
      this.readEpubFile(file);
    } else {
      this.readHtmlFile(file);
    }
  }

  private readEpubFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const book = extractEpubArchive(buffer);
        this.sourceMode.set('epub');
        this.epubMetadata.set(book.metadata);
        this.epubChapterCount.set(book.chapters.length);
        this.uploadedFilename.set(file.name);
        this.uploadedFileSize.set(file.size);
        this.customFilename.set('');
        this.rawHtml.set(book.combinedHtml);
        this.mobilePane.set('output');
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Không thể giải nén tệp EPUB. Vui lòng kiểm tra lại định dạng tệp.';
        this.parseError.set(msg);
      }
    };
    reader.onerror = () => {
      this.parseError.set('Không thể đọc tệp EPUB đã chọn.');
    };
    reader.readAsArrayBuffer(file);
  }

  private readHtmlFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      this.sourceMode.set('html');
      this.epubMetadata.set(null);
      this.epubChapterCount.set(undefined);
      this.rawHtml.set(content);
      this.uploadedFilename.set(file.name);
      this.uploadedFileSize.set(file.size);
      this.customFilename.set('');
      this.mobilePane.set('output');
    };
    reader.onerror = () => {
      this.parseError.set('Không thể đọc tệp đã chọn. Vui lòng thử lại.');
    };
    reader.readAsText(file, 'utf-8');
  }

  async copyMarkdown(): Promise<void> {
    const md = this.conversion().markdown;
    if (!md) return;

    try {
      await navigator.clipboard.writeText(md);
      this.copyFeedback.set(true);
      setTimeout(() => this.copyFeedback.set(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = md;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.copyFeedback.set(true);
      setTimeout(() => this.copyFeedback.set(false), 2000);
    }
  }

  downloadMarkdownFile(): void {
    const md = this.conversion().markdown;
    if (!md) return;

    const filename = this.effectiveFilename();
    const blob = new Blob([md], {type: 'text/markdown;charset=utf-8'});
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  updateCustomFilename(value: string): void {
    this.customFilename.set(value);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }
}
