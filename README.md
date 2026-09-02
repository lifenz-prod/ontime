# Ontime (LifeNZ build)

This is LifeNZ's build of [Ontime](https://github.com/cpvalente/ontime) — a browser-based application for managing event rundowns, scheduling, and cueing. It runs a small server that holds the live rundown and pushes it to any device on the network through a browser.

This fork carries custom features tailored to our Sunday service workflow, including a touch-first **iPad editor** (`/ipad-editor`) and **dual service mode** for running exact-replica 9am/11am services back to back.

## Views

Once the app is running, any device on the network can open a view in its browser. Reach the server at `http://<server-ip>:4001` (default port `4001`). For example, on the machine running Ontime that's `http://localhost:4001`, and from another device something like `http://192.168.1.3:4001`.

```
Backstage / on-stage
-------------------------------------------------------------
/timer        > Presenter / stage timer
/minimal      > Simple timer
/clock        > Simple clock
/backstage    > Stage manager / backstage
/countdown    > Countdown to anything
/studio       > Studio clock
/timeline     > Timeline
/cuescreen    > Cue screen, shows just the NEXT event title (used for ProPresenter, see below)
/cuescreennow > Cue screen (showing both NOW and NEXT event titles)

Public
-------------------------------------------------------------
/public       > Public / foyer
/lower        > Lower thirds

Production / editing
-------------------------------------------------------------
/editor       > Full control interface (same as the desktop app)
/cuesheet     > Realtime cuesheet for collaboration
/operator     > Operator view
/ipad-editor  > Simplified touch editor for volunteers
```

## Hosting the cue screen in ProPresenter

The cue screen can be displayed inside ProPresenter as a web layer, so operators see the live Ontime cue screen alongside everything else on the stage display.

1. In ProPresenter, create (or open) a **Stage Display screen** at **1920 × 1080**.
2. Add a **full-screen rectangle shape** covering the whole layout.
3. Set the shape's **Fill** to **Web**.
4. Set the web URL to the Ontime cue screen:

   ```
   http://localhost:4001/cuescreen
   ```

   Use `localhost` if ProPresenter runs on the same machine as the Ontime server. If Ontime runs on a different machine, use that machine's IP instead, e.g. `http://192.168.1.3:4001/cuescreen`.
5. This shows timers very similiar to the default ProPresenter config, with main timer and aux timer at the top. Current and Next slide content etc can be shown in the lower two thirds of the display.

The cue screen updates live as the rundown plays, with no extra configuration needed in ProPresenter.

## Starting Ontime automatically when the machine turns on (Windows)

On the machine that runs Ontime, you usually want it to come up on its own after a power cut or a scheduled reboot — with nobody there to click anything. Ontime already **launches itself as soon as a user is signed in** (this is on by default). The missing piece is getting Windows to sign that user in automatically at boot, so no keyboard or mouse is needed.

This is a one-time setup per machine. It does **not** change how you install or update Ontime — keep downloading and running the installer exactly as before.

**1. Confirm Ontime's auto-launch is on.** Open Ontime, go to Settings, and check that "start Ontime automatically on login" (auto-launch) is enabled. It's on by default, so normally there's nothing to do here.

**2. Turn on Windows automatic sign-in.** Use a dedicated, low-privilege account for the Ontime machine (not a personal admin login):

   - Press `Windows + R`, type `netplwiz`, press Enter.
   - Select the account Ontime should run under.
   - Untick **"Users must enter a user name and password to use this computer"** and click **Apply**.
   - Enter that account's password when prompted and confirm.

   > If the tick-box isn't showing, it's usually because Windows Hello / PIN sign-in is enabled. Turn off *Settings → Accounts → Sign-in options → "Require Windows Hello sign-in for Microsoft accounts"* and try again. On locked-down/domain machines you may need IT to do this, or use Microsoft's [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon) tool instead.

**3. Reboot to test.** Restart the machine and leave it alone. Windows should sign in on its own, Ontime should start, and the views should be reachable from other devices at `http://<server-ip>:4001` as usual.

> **Security note:** the machine now sits signed in after boot, so treat it like any always-on appliance — keep it physically secured and use a limited account, not an admin one.

## Found a bug?

If something isn't working right, please **[open a bug report](https://github.com/lifenz-prod/ontime/issues/new)**. Include what you were doing, what you expected, and what happened — a screenshot helps a lot. Bug reports are the fastest way to get things fixed.

## Got an idea?

I'd love to hear feature requests — this build grows from how people actually use it, so if there's something that would make your workflow smoother, **[open a feature request](https://github.com/lifenz-prod/ontime/issues/new)**. No idea is too small; tell me what you're trying to do and how you'd picture it working. Please do send them through!

## Development

Setup and contribution notes for developers are in [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

This project is licensed under the terms of the GNU GPL v3, inheriting the license of the upstream [Ontime](https://github.com/cpvalente/ontime) project.
