# Overlay Nuking Feature Explanation

The **Overlay Nuking** feature is a powerful tool designed to remove intrusive overlays, modals, paywalls, and blocking elements from web pages to restore scrollability and visibility.

## How It Works

The system uses a two-pronged approach to identify and remove overlays:
1.  **Heuristic Analysis** (Generic Detection)
2.  **Keyword Matching** (Specific Detection)

### 1. Heuristic Analysis
This method identifies potential overlays based on their visual properties and behavior, without relying on specific class names.

-   **Scans the DOM**: Iterates through page elements efficiently.
-   **Position Check**: Looks for elements with `position: fixed`, `absolute`, or `sticky`.
-   **Coverage Calculation**: Calculates how much of the viewport the element covers. Elements covering more than **55%** of the screen are flagged as high-probability candidates.
-   **Z-Index Check**: Elements with a very high z-index (default > 900) are also targeted, as this usually indicates they are "on top" of everything else.
-   **Safety Filters**: Automatically ignores essential elements like `<img>`, `<video>`, `<input>`, or elements with specific ARIA roles to prevent breaking page functionality.

**Action Taken**:
For heuristic matches, the system usually applies a **"Soften"** approach:
-   Sets `pointer-events: none` (allows clicking *through* the overlay).
-   Sets `z-index: 0` (pushes it to the back).
-   Removes `backdrop-filter` (removes blur effects).

### 2. Keyword Matching
This method targets known patterns used by ad-blockers, paywalls, and cookie consent forms.

-   **Targeted Search**: Checks element IDs, Class Names, ARIA labels, and even broad text content.
-   **Keyword List**: Uses a comprehensive list of common terms, including:
    -   *Generic*: `overlay`, `modal`, `popup`, `backdrop`, `wrapper`.
    -   *Paywalls*: `subscribe`, `paywall`, `gateway`, `restricted`.
    -   *Privacy*: `cookie`, `gdpr`, `consent`.
    -   *Annoyances*: `no-copy`, `anti-copy`, `adblock-modal`.
-   **Pattern Matching**: Also looks for common prefixes/suffixes like `*-overlay`, `modal-*`, `*-wrapper`.

**Action Taken**:
For keyword matches, the system can apply a **"Hard Nuke"**:
-   **Hard Mode**: Completely removes the element from the DOM (`element.remove()`).
-   **Soft Mode**: Hides the element visually (`display: none`, `opacity: 0.15`).

## Customization

The system loads keywords from `overlay_keywords.md`. You can extend this list to include site-specific selectors or new patterns without modifying the code.

## Safety & Undo

-   **History Tracking**: Every change made (removal or style modification) is logged in a history stack.
-   **Undo Capability**: The `undoOverlayCleanup()` function can reverse the changes, restoring removed elements and original styles if the "nuke" broke the page layout.

## Code References

-   **Core Logic**: `content.js`
    -   `findOverlayCandidates(opts)`: Implements the heuristic scan.
    -   `nukeByKeywords(keywords, opts)`: Implements the keyword matcher.
    -   `nukeOverlays(opts)`: The main coordinator function.
-   **Keywords**: `overlay_keywords.md` (or internal `DEFAULT_OVERLAY_KEYWORDS` list in `content.js`).
