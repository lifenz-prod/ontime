# Ontime Cue Renderer

A menu bar app for the ProPresenter machine. It renders up to two Ontime views off-screen and publishes each
as a Syphon source. ProPresenter takes them as video inputs, so the cue screen no longer depends on
ProPresenter's embedded web view, which blanks under load and sometimes reloads into an empty page.

## Using it

1. Open the app. It lives in the menu bar (no Dock icon); the first launch opens Settings.
2. Set the Ontime server (eg `http://192.168.1.10:4001`) and, for each output, the view, any view options
   (everything after the `?` in the view's URL in Ontime), the size and the Syphon source name.
3. In ProPresenter, add a video input of type Syphon, pick the source by name, and put that input on the cue
   screen look in place of the web element. Two outputs means two looks you can switch between.
4. Tick **Open at login** in the menu bar menu.

Each output shows up in Ontime's client list under its Syphon source name.

## What it does when things go wrong

Syphon clients keep showing the last frame they received, so a frozen timer could look alive. The renderer
makes sure that never happens silently:

| Situation                       | On the cue screen                                          | What the renderer does                                                        |
| ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Page loading, or failed to load | Status card: "Connecting to Ontime" / "Can't reach Ontime" | Retries after 1, 2, 5, then every 10 seconds                                  |
| No message from Ontime for 4s   | The view, dimmed, with a red "timer may be wrong" banner   | Pings every 2s; after 10s of silence closes the socket so the page reconnects |
| Page lost its socket            | The view with a red "not connected" banner                 | Reloads the page after 30s                                                    |
| Page loaded but drew nothing    | Status card                                                | Reloads after 8s                                                              |
| Page hung or crashed            | Status card: "Restarting the view"                         | Restarts the page                                                             |
| The renderer itself quits       | The Syphon source disappears                               | Nothing: ProPresenter shows its own no-input state                            |

The thresholds live in `src/health.js`.

Ontime is usually served over plain http on the LAN, where browsers refuse to run service workers. The renderer
treats the configured server as a secure origin, so Ontime's page cache works here and a reload during a network
blip comes up from cache. That is set at launch, which is why changing the server restarts the app.

## Development

```bash
pnpm --filter ontime-cue-renderer start      # run against the server in Settings
pnpm --filter ontime-cue-renderer test       # config and health logic
pnpm --filter ontime-cue-renderer pack:mac   # unsigned arm64 and x64 DMGs in dist/
```

Config is stored in `~/Library/Application Support/Ontime Cue Renderer/config.json`.

Syphon comes from [node-syphon](https://github.com/benoitlahoz/node-syphon). It is an optional dependency, so
installs on Windows and Linux carry on without it. Its install step downloads `Syphon.framework` from the
package's GitHub releases. Frames go from Electron's off-screen renderer to Syphon as shared GPU textures, with no
copy through memory.

The DMG is not signed or notarised, so the first launch on a new Mac needs right-click → Open.
