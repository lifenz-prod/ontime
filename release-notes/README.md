# Release notes

Every release needs a notes file here, named after its tag: `v4.0.2-beta.7.md` for tag `v4.0.2-beta.7`.
Betas included. The build fails without one.

The notes become the GitHub Release body, and the in-app updater (About → Updates) shows them
before anyone installs, so write them for the people using Ontime rather than as a commit log.

The updater renders a small subset of markdown: `##` headings, `-` bullets, paragraphs, **bold** and `code`.

```md
## New
- **iPad editor:** an orange AUX tag marks cues shown as the aux timer

## Changed
- Import is now at the top of the settings menu

## Fixed
- macOS builds no longer fail when Apple's servers drop the connection
```
