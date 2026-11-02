# Quick Start guide

The volunteers' and production staff's guides, shown at `/quick-start` and linked first in the navigation menu.

- `content/*.md` holds the text. The page renders a small subset of markdown (see `GuideMarkdown.tsx`), and images are referenced by key, eg. `![alt](editor)`, mapped in `QuickStartGuide.tsx`.
- `assets/*.png` are the annotated screenshots.
- `assets/ontime-quick-start.pdf` is printed from the page. After changing the text, regenerate it with the dev server running:

```bash
node apps/client/scripts/quick-start-pdf.cjs http://localhost:3000/quick-start
```
