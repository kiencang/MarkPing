import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {strToU8, zipSync} from 'fflate';
import {
  convertHtmlToCleanMarkdown,
  DEFAULT_CONVERSION_OPTIONS,
  slugifyTitle,
  buildYamlFrontmatter,
  isLikelyInlineLatex,
} from './markdown-converter';
import {convertEpubBufferToMarkdown, resolveEpubPath} from './epub-converter';

const TEST_SAMPLE_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Kiến trúc Ứng dụng Tĩnh Hiệu suất Cao trên Cloudflare Pages</title>
  <meta name="author" content="Nguyễn Minh Quân — Kỹ sư Hệ thống Phân tán">
  <meta property="og:site_name" content="Tạp chí Kỹ thuật Web Việt Nam">
  <meta name="description" content="Hướng dẫn chuyên sâu về cách tối ưu hóa ứng dụng Angular thuần Client-side và triển khai trên mạng biên toàn cầu của Cloudflare Pages.">
</head>
<body>
  <header class="site-header">
    <nav>
      <ul>
        <li><a href="/">Trang chủ</a></li>
        <li><a href="/tin-tuc">Tin tức</a></li>
      </ul>
    </nav>
    <div class="cookie-banner">Website này sử dụng cookie để theo dõi quảng cáo.</div>
  </header>
  <aside class="advertisement">
    <p>QUẢNG CÁO: Giảm giá 70% khóa học làm giàu không khó chỉ trong 3 ngày!</p>
  </aside>
  <main>
    <article class="post-content">
      <header>
        <h1>Kiến trúc Ứng dụng Tĩnh Hiệu suất Cao trên Cloudflare Pages</h1>
        <p class="byline">Tác giả: Nguyễn Minh Quân · Ngày đăng: 10/11/2026</p>
      </header>
      <p>Khi xây dựng các công cụ xử lý văn bản như trình trích xuất nội dung <strong>Mozilla Readability</strong> kết hợp cùng <strong>Turndown</strong>, việc chuyển toàn bộ quá trình tính toán về phía trình duyệt (Client-side) mang lại lợi thế vượt trội về tốc độ, quyền riêng tư và chi phí vận hành bằng không.</p>
      <h2>1. Tại sao nên xử lý hoàn toàn ở phía Client?</h2>
      <p>Thay vì gửi toàn bộ tệp HTML lên máy chủ để phân tích cú pháp, trình duyệt hiện đại đã tích hợp sẵn bộ phân tích <code>DOMParser</code> cực nhanh bằng C++.</p>
      <table>
        <thead>
          <tr>
            <th>Tiêu chí kỹ thuật</th>
            <th>Client-side (Cloudflare Pages)</th>
            <th>Server-side API truyền thống</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Thời gian phản hồi (TTFB)</td>
            <td>12ms (Tại Edge gần nhất)</td>
            <td>340ms - 850ms</td>
          </tr>
        </tbody>
      </table>
      <pre><code class="language-typescript">import { Readability } from '@mozilla/readability';</code></pre>
      <ul>
        <li><input type="checkbox" checked disabled> Cấu hình bộ lọc <code>@mozilla/readability</code> để loại bỏ sidebar và footer nhiễu.</li>
        <li><input type="checkbox" disabled> Tùy chọn bật YAML Frontmatter nếu lưu trữ vào kho Obsidian hoặc Hugo/Astro.</li>
      </ul>
    </article>
  </main>
  <aside class="sidebar-widgets">
    <p>Bất ngờ với bí quyết giảm cân bằng nước lọc!</p>
  </aside>
  <script>console.log("Tracking script should never appear in Markdown!");</script>
</body>
</html>`;

const jsdomParser = (html: string): Document => {
  const dom = new JSDOM(html);
  return dom.window.document;
};

test('slugifyTitle limits to at most 5 words and appends a 5-digit random suffix', () => {
  assert.equal(
    slugifyTitle('Why is Nvidia so powerful in AI computing today?', '53643'),
    'why-is-nvidia-so-powerful-53643'
  );
  assert.match(
    slugifyTitle('Kiến trúc Ứng dụng Tĩnh Hiệu suất Cao trên Cloudflare Pages!'),
    /^kien-truc-ung-dung-tinh-\d{5}$/
  );
  assert.match(
    slugifyTitle('Định dạng Đường dẫn & Bảng biểu'),
    /^dinh-dang-duong-dan-bang-\d{5}$/
  );
  assert.match(slugifyTitle('   '), /^cleaned-article-\d{5}$/);
});

test('convertHtmlToCleanMarkdown strips noisy header/aside/footer/script and preserves main article + GFM table', () => {
  const result = convertHtmlToCleanMarkdown(
    TEST_SAMPLE_HTML,
    {
      ...DEFAULT_CONVERSION_OPTIONS,
      includeFrontmatter: false,
      enableGfm: true,
    },
    jsdomParser
  );

  assert.equal(result.isEmpty, false);
  assert.equal(result.error, null);
  assert.equal(result.usedFallback, false);
  assert.equal(
    result.metadata.title,
    'Kiến trúc Ứng dụng Tĩnh Hiệu suất Cao trên Cloudflare Pages'
  );
  assert.match(result.suggestedFilename, /^kien-truc-ung-dung-tinh-\d{5}\.md$/);

  // Should NOT contain noisy ad or tracking script or cookie banner
  assert.equal(result.markdown.includes('Giảm giá 70% khóa học'), false);
  assert.equal(result.markdown.includes('Tracking script should never appear'), false);
  assert.equal(result.markdown.includes('Bất ngờ với bí quyết giảm cân'), false);

  // Should contain GFM table headers, main headings, GFM task list items, and fenced code language
  assert.equal(result.markdown.includes('| Tiêu chí kỹ thuật |'), true);
  assert.equal(result.markdown.includes('## 1. Tại sao nên xử lý hoàn toàn ở phía Client?'), true);
  assert.equal(result.markdown.includes('[x] Cấu hình bộ lọc'), true);
  assert.equal(result.markdown.includes('[ ] Tùy chọn bật YAML Frontmatter'), true);
  assert.equal(result.markdown.includes('```typescript'), true);
  // Frontmatter is off when explicitly set to false
  assert.equal(result.markdown.startsWith('---'), false);
});

test('convertHtmlToCleanMarkdown prepends valid YAML Frontmatter by default (includeFrontmatter is true)', () => {
  assert.equal(DEFAULT_CONVERSION_OPTIONS.includeFrontmatter, true);
  const result = convertHtmlToCleanMarkdown(
    TEST_SAMPLE_HTML,
    DEFAULT_CONVERSION_OPTIONS,
    jsdomParser
  );

  assert.equal(
    result.markdown.startsWith(
      '---\ntitle: "Kiến trúc Ứng dụng Tĩnh Hiệu suất Cao trên Cloudflare Pages"'
    ),
    true
  );
  assert.equal(
    result.markdown.includes('author: "Nguyễn Minh Quân — Kỹ sư Hệ thống Phân tán"'),
    true
  );
  assert.equal(result.markdown.includes('siteName: "Tạp chí Kỹ thuật Web Việt Nam"'), true);
});

test('buildYamlFrontmatter safely escapes quotes and newlines', () => {
  const yaml = buildYamlFrontmatter({
    title: 'Bài viết "Đặc biệt"\nDòng 2',
    byline: 'Tác giả A',
    excerpt: null,
    siteName: 'Site B',
    lang: 'vi',
    publishedTime: null,
  });

  assert.equal(yaml.includes('title: "Bài viết \\"Đặc biệt\\" Dòng 2"'), true);
  assert.equal(yaml.includes('author: "Tác giả A"'), true);
});

test('resolveEpubPath resolves relative paths inside EPUB OEBPS directory', () => {
  assert.equal(resolveEpubPath('OEBPS', 'Text/chapter1.xhtml#sec1'), 'OEBPS/Text/chapter1.xhtml');
  assert.equal(resolveEpubPath('OEBPS/Text', '../Images/cover.jpg'), 'OEBPS/Images/cover.jpg');
});

test('convertEpubBufferToMarkdown extracts full EPUB chapters in spine order separated by --- and keeps ![alt](images/...)', () => {
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Nghệ Thuật Viết Mã Sạch Trong Kỹ Thuật Phần Mềm</dc:title>
    <dc:creator>Trần Hoàng</dc:creator>
    <dc:publisher>NXB Tri Thức Số</dc:publisher>
    <dc:language>vi</dc:language>
    <dc:description>Cuốn sách hướng dẫn thiết kế phần mềm bền vững.</dc:description>
  </metadata>
  <manifest>
    <item id="ch1" href="chapters/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapters/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  const ch1Xhtml = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Lời nói đầu</title></head>
<body>
  <aside class="epigraph">Lời đề từ ngắn vẫn được giữ nguyên 100% không bị Readability cắt bỏ.</aside>
  <h2>Chương 1: Khởi đầu</h2>
  <p>Minh họa bìa sách: <img src="images/cover.jpg" alt="Bìa sách Nghệ Thuật Viết Mã"/></p>
</body>
</html>`;

  const ch2Xhtml = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chương 2</title></head>
<body>
  <h2>Chương 2: Kiến trúc Tối giản</h2>
  <p>Nội dung chương 2 đầy đủ.</p>
</body>
</html>`;

  const zipped = zipSync({
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(contentOpf),
    'OEBPS/chapters/ch1.xhtml': strToU8(ch1Xhtml),
    'OEBPS/chapters/ch2.xhtml': strToU8(ch2Xhtml),
  });

  const result = convertEpubBufferToMarkdown(
    zipped,
    {
      ...DEFAULT_CONVERSION_OPTIONS,
      includeFrontmatter: false,
      keepImages: true,
    },
    jsdomParser
  );

  assert.equal(result.isEmpty, false);
  assert.equal(result.error, null);
  assert.equal(result.chapterCount, 2);
  assert.equal(result.metadata.title, 'Nghệ Thuật Viết Mã Sạch Trong Kỹ Thuật Phần Mềm');
  assert.equal(result.metadata.byline, 'Trần Hoàng');
  assert.equal(result.metadata.siteName, 'NXB Tri Thức Số');
  assert.match(result.suggestedFilename, /^nghe-thuat-viet-ma-sach-\d{5}\.md$/);

  // Verify short aside/epigraph was NOT stripped (Readability was bypassed)
  assert.equal(
    result.markdown.includes('Lời đề từ ngắn vẫn được giữ nguyên 100% không bị Readability cắt bỏ.'),
    true
  );

  // Verify image link is kept as ![alt](images/...) by default
  assert.equal(
    result.markdown.includes('![Bìa sách Nghệ Thuật Viết Mã](images/cover.jpg)'),
    true
  );

  // Verify chapters are separated by horizontal rule ---
  assert.equal(result.markdown.includes('\n\n---\n\n## Chương 2: Kiến trúc Tối giản'), true);
});

test('convertHtmlToCleanMarkdown replaces Base64 images with concise note and converts YouTube iframes to watch links', () => {
  const htmlWithBase64AndYoutube = `<!DOCTYPE html>
<html lang="vi">
<head><title>Bài viết Đa phương tiện</title></head>
<body>
  <article>
    <h1>Bài viết Đa phương tiện</h1>
    <p>Đoạn văn giới thiệu bài viết chi tiết để Readability nhận diện bài viết chính đầy đủ.</p>
    <p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="Biểu đồ minh họa" /></p>
    <p><img src="https://example.com/normal-photo.jpg" alt="Ảnh thường" /></p>
    <div class="video-wrapper">
      <iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=12345" title="YouTube video player" allowfullscreen></iframe>
    </div>
  </article>
</body>
</html>`;

  const result = convertHtmlToCleanMarkdown(
    htmlWithBase64AndYoutube,
    DEFAULT_CONVERSION_OPTIONS,
    jsdomParser
  );

  // Base64 image should be replaced with ![Biểu đồ minh họa]([Ảnh Base64 đã lược bỏ])
  assert.equal(
    result.markdown.includes('![Biểu đồ minh họa]([Ảnh Base64 đã lược bỏ])'),
    true
  );
  assert.equal(result.markdown.includes('iVBORw0KGgoAAAANSUhEUg'), false);

  // Normal URL image should remain intact
  assert.equal(
    result.markdown.includes('![Ảnh thường](https://example.com/normal-photo.jpg)'),
    true
  );

  // YouTube iframe should be converted to [🎬 Xem video YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
  assert.equal(
    result.markdown.includes('[🎬 Xem video YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)'),
    true
  );
});

test('convertHtmlToCleanMarkdown converts MathML <math> tags to clean LaTeX and shields LaTeX expressions with zero leaked tokens', () => {
  const htmlWithMath = `<!DOCTYPE html>
<html lang="vi">
<head><title>Toán học & Công thức</title></head>
<body>
  <article>
    <h1>Toán học & Công thức $E = mc^2$</h1>
    <p>Công thức mở đầu đoạn 1 (nằm trong excerpt): <math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup></mrow></math> và inline $x_1 + x_2 = y^*_n$ cần giữ nguyên.</p>
    <p>Công thức LaTeX block: $$\\int_0^\\infty e^{-x_1^2} dx_1 = \\frac{\\sqrt{\\pi}}{2}$$</p>
    <p>Công thức Wikipedia cồng kềnh:</p>
    <math xmlns="http://www.w3.org/1998/Math/MathML" class="mwe-math-element mwe-math-element-block" display="block" typeof="mw:Extension/math" about="#mwt4" id="mwCQ" data-mw="{&quot;name&quot;:&quot;math&quot;,&quot;attrs&quot;:{&quot;display&quot;:&quot;block&quot;},&quot;body&quot;:{&quot;extsrc&quot;:&quot;ax^2 + bx + c = 0\\\\,,&quot;}}"><mrow data-mjx-texclass="ORD"><mstyle displaystyle="true" scriptlevel="0"><mi>a</mi><msup><mi>x</mi><mrow data-mjx-texclass="ORD"><mn>2</mn></mrow></msup><mo stretchy="false">+</mo><mi>b</mi><mi>x</mi><mo stretchy="false">+</mo><mi>c</mi><mo stretchy="false">=</mo><mn>0</mn><mspace width="0.167em"></mspace><mo>,</mo></mstyle></mrow></math>
    <p>Khối KaTeX trên web: <span class="katex"><span class="katex-mathml"><math><semantics><mrow><msub><mi>E</mi><mn>0</mn></msub></mrow><annotation encoding="application/x-tex">E_0 = m_0 c^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>E0 = m0 c2</span></span></span></p>
    <p>Bất đẳng thức chứa dấu nhỏ hơn sát chữ: $a<b$ và $x_1 < y_2$.</p>
    <p>Môi trường LaTeX độc lập: \\begin{equation} f(x_1) = a_1 x_1^2 + b_1 \\end{equation}</p>
  </article>
</body>
</html>`;

  const result = convertHtmlToCleanMarkdown(
    htmlWithMath,
    DEFAULT_CONVERSION_OPTIONS,
    jsdomParser
  );

  // 0. Zero leaked placeholder tokens anywhere in markdown or metadata
  assert.equal(result.markdown.includes('MPMATHTOKEN'), false);
  assert.equal((result.metadata.excerpt || '').includes('MPMATHTOKEN'), false);
  assert.equal((result.metadata.title || '').includes('MPMATHTOKEN'), false);

  // 1. Raw inline LaTeX is untouched (underscores and asterisks are NOT escaped)
  assert.equal(result.markdown.includes('$x_1 + x_2 = y^*_n$'), true);

  // 2. Raw block LaTeX is untouched
  assert.equal(
    result.markdown.includes('$$\\int_0^\\infty e^{-x_1^2} dx_1 = \\frac{\\sqrt{\\pi}}{2}$$'),
    true
  );

  // 3. Pure MathML <math>...</math> is converted into clean LaTeX via mathml-to-latex
  assert.equal(result.markdown.includes('$a^{2} + b^{2} = c^{2}$'), true);
  assert.equal(result.markdown.includes('<math'), false);

  // 4. Bloated Wikipedia <math data-mw="..."> block is converted into clean block LaTeX
  assert.equal(result.markdown.includes('$$\nax^2 + bx + c = 0\\,,\n$$'), true);

  // 5. KaTeX block extracts clean annotation LaTeX without duplicating .katex-html spans
  assert.equal(result.markdown.includes('$E_0 = m_0 c^2$'), true);
  assert.equal(result.markdown.includes('E0 = m0 c2'), false);

  // 6. Angle brackets inside $a<b$ are protected from DOMParser <b> tag misinterpretation
  assert.equal(result.markdown.includes('$a<b$'), true);
  assert.equal(result.markdown.includes('$x_1 < y_2$'), true);

  // 7. Standalone \begin{equation}...\end{equation} environment is preserved intact without underscore escaping
  assert.equal(
    result.markdown.includes('\\begin{equation} f(x_1) = a_1 x_1^2 + b_1 \\end{equation}'),
    true
  );
});

test('inline $...$ anti-false-positive rules reject shell paths, currency pairs, and prose currency spans while keeping real math', () => {
  // Direct unit checks on isLikelyInlineLatex
  assert.equal(isLikelyInlineLatex('x_1 + y_2 = z^2'), true);
  assert.equal(isLikelyInlineLatex('a<b'), true);
  assert.equal(isLikelyInlineLatex('2\\pi r'), true);
  assert.equal(isLikelyInlineLatex('50, còn gói nâng cao có giá 100'), false);
  assert.equal(isLikelyInlineLatex('19.99 cho tháng đầu và 49.99'), false);

  const htmlWithFalsePositiveCandidates = `<!DOCTYPE html>
<html lang="vi">
<head><title>Kiểm tra Chống Dương tính Giả</title></head>
<body>
  <article>
    <h1>Kiểm tra Chống Dương tính Giả</h1>
    <p>Đường dẫn biến môi trường: $HOME/$USER/config_file và cặp tiền tệ $USD/$VND hoặc $10-$20.</p>
    <p>Câu văn có 2 ký hiệu tiền tệ: Gói cơ bản có giá $50, còn gói_nâng_cao có giá 100$.</p>
    <p>Trong khi đó công thức thật $x_1 + y_1 = z_1^2$ và $\\alpha_0 < \\beta_1$ vẫn được bảo vệ tuyệt đối.</p>
  </article>
</body>
</html>`;

  const result = convertHtmlToCleanMarkdown(
    htmlWithFalsePositiveCandidates,
    DEFAULT_CONVERSION_OPTIONS,
    jsdomParser
  );

  // 1. No leaked tokens
  assert.equal(result.markdown.includes('MPMATHTOKEN'), false);

  // 2. $HOME/$USER/config_file is NOT treated as math, so Turndown escapes underscores in config_file normally
  assert.equal(result.markdown.includes('$HOME/$USER/config\\_file'), true);

  // 3. Currency span "$50, còn gói_nâng_cao có giá 100$" is NOT treated as math, so underscores in gói_nâng_cao are escaped by Turndown
  assert.equal(
    result.markdown.includes('Gói cơ bản có giá $50, còn gói\\_nâng\\_cao có giá 100$.'),
    true
  );

  // 4. Genuine inline math in the same document has its underscores and < preserved unescaped
  assert.equal(result.markdown.includes('$x_1 + y_1 = z_1^2$'), true);
  assert.equal(result.markdown.includes('$\\alpha_0 < \\beta_1$'), true);
});



