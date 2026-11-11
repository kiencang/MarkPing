# MarkPing
Chuyển HTML, EPUB sang Markdown tiện lợi: https://markping.nguyenducanh.workers.dev/

Tình trạng:
- **HTML** chuyển thẳng lên AI sẽ **rất tốn token** vì HTML ngoài nội dung chính còn có rất nhiều nội dung phụ;
- Định dạng **EPUB** một số AI **không cho tải trực tiếp lên**;

MarkPing ra đời vì thế! Nó làm sạch HTML, chỉ giữ lại nội dung chính. Đối với EPUB, nó giữ nguyên nội dung và chuyển thành định dạng markdown để bạn có thể tiện hỏi AI nội dung của EPUB mà không thể up trực tiếp lên.

Với ai có nhu cầu dịch Anh - Việt trực tiếp từ khung chat bằng tài liệu markdown, có thể tham khảo repo này (chỉ bao gồm một vài chỉ thị để hướng dẫn AI dịch): https://github.com/kiencang/MarkdownBox

## Tuyên bố từ chối trách nhiệm
Công cụ này có thể được sử dụng cho mục đích nghiên cứu và học tập cá nhân.

MarkPing cũng như người phát triển nó không đưa ra bất kỳ bảo đảm rõ ràng hay ngụ ý nào, cũng như không tuyên bố rằng công cụ sẽ vận hành hoàn hảo, chính xác hoặc cập nhật. Người phát triển sẽ không chịu trách nhiệm cho bất kỳ tổn thất hay thiệt hại nào phát sinh trực tiếp hoặc gián tiếp liên quan đến hoặc phát sinh từ việc sử dụng công cụ này.

## Ghi công
Một số thư viện quan trọng mà ứng dụng này dùng:
*   **[Angular](https://angular.dev/)**: Lõi chính của ứng dụng.
*   **[Tailwind CSS](https://tailwindcss.com/)**: Xây dựng giao diện chính cho ứng dụng.
*   **[Mozilla Readability](https://github.com/mozilla/readability)**: Thư viện bóc tách nội dung chính của một bài báo/trang web (loại bỏ quảng cáo, menu, header...).
*   **[Turndown](https://github.com/mixmark-io/turndown)**: Chuyển đổi nđịnh dạng HTML thành cú pháp Markdown.
