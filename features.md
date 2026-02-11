# Features

## Image extraction
- Extracts `<img>` sources, including `srcset` and `<source>` candidates.
- Scans CSS image properties (background, mask, border-image, list-style, content) including `image-set()` variants.
- Supports `data:` and `blob:` URLs alongside normal network images.
- Captures canvas snapshots and inline SVGs.

## Blob capture & hydration
- Captures blob bytes from `URL.createObjectURL`, canvas `toBlob`/`toDataURL`, and image fetch responses.
- Hydrates blob URLs to extension-owned blobs with a 25 MB cap.
- Cross-frame blob listing and hydration support.

## Network capture
- Optional network capture mode with CDP/webRequest fallbacks.
- Batch retrieval of captured image bytes and dedupe by hash.
