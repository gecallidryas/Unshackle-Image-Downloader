# Updates

## 2026-02-11
- Expanded CSS image extraction to include additional CSS image properties and `image-set()` parsing.
- Deep scan includes `data:`/`blob:` CSS image URLs with safer MIME detection.
- Chrome Web Store manifest permissions trimmed for the build output.

## 2026-01-31
- Expanded CSS image extraction to cover `image-set()` and additional properties (mask, border-image, list-style, content).
- Deep scan now includes `data:`/`blob:` background images with safer MIME handling.
- DOM blob discovery checks more CSS properties to catch early-created blob URLs.
- Guarded deep-scan MIME guessing when helper isn't present.
