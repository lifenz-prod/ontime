# Ontime Quick Start for production staff

## What Ontime is

Ontime is a cue-based timer system. Every timer for a service or event is set up ahead of time in a **cue list**. On the day, each cue's timer runs for its segment, started by the operator or automatically. One Ontime computer holds the cue list; every editor and cue screen on the network shows the same thing, live.

## How it works

- **The cue list** is typed into Ontime cue by cue, or imported from a Google Sheet or Excel spreadsheet filled in beforehand (see *Importing a cue list*). Loading straight from Planning Center is coming.
- **How each cue runs** can be set ahead of time in the sheet, or changed on any cue in Ontime.
- **Every cue is a countdown**, of one of two kinds:
  - **Countdown timer:** counts down a fixed length, so someone always gets their full time however long the item before them took. A message is the classic example. These cues show a green stopwatch icon.
  - **Countdown to Time:** counts down to a time of day. The normal choice for the first part of a service, which has to stick to the clock, such as time to the start of the service.
- Switch a cue between the two with its **Countdown to Time** toggle.

## Getting in

- Open a browser and go to the Ontime address, for example `http://<ontime computer>:4001`. Ask the Production Manager of your campus for the exact address.
- Tap the menu button (grid icon, top left) to pick a screen. Editing screens may ask for a password.
- Nothing you do on a display screen changes the show. Only the editors change times or press play.

## Which screen to use

Production staff should use the **Editor** by default; it works on a desktop as well as a phone or iPad. Open the **Advanced Editor** only when you need more detail. Volunteers use the **iPad Editor** and have their own guide.

| Screen | Who it's for | What it does |
|---|---|---|
| iPad Editor | Volunteers running the clock | Simple touch controls: Next, PREV, Stop, adjust time, stage message |
| Editor | Production staff | Playback, the cue list and editing. The default for production |
| Advanced Editor | Production staff needing more detail | Everything: playback, the full cue list, editing every field |
| Cuescreen, Cuescreen NOW/NEXT | Stage cue screens | What the platform sees: current cue, time left, what's next |
| Timer, Backstage and others | Any display | Standard Ontime displays |

## The Editor at a glance

The left column (timer, Next / PREV / Stop, Auxiliary Timer, Adjust Current, Global Offset, Stage Message and cue settings) works just like the iPad Editor; the volunteers' guide has a numbered picture of it. The Editor adds the controls numbered below.

![The Editor with numbered callouts](editor)

| # | What it is | What it does |
|---|---|---|
| 1 | **Run / Edit** | Edit shows the editing controls and + Event. Switch back to Run during the service so nothing gets changed by accident |
| 2 | **Absolute / Relative** | Shows cue times as times of day, or relative to the start of the cue list |
| 3 | **Clear rundown** | Deletes the whole cue list. Only use it before importing a new one |
| 4 | **Skip, Load, Start** (row buttons) | Skip leaves the cue out of playback. Load gets the cue ready without starting it. Start plays from this cue |
| 5 | **Link** (chain on the start time) | The cue starts when the one before it ends. Tap to unlink and give it a fixed start time |
| 6 | **End time** | When the cue finishes |
| 7 | **Lock duration** (padlock) | Keeps the duration fixed when you change the start or end |
| 8 | **Time until start** | How long until this cue is expected to start |
| 9 | **Play / Pause** | Starts or resumes the loaded cue, or pauses it. Pausing doesn't stop the clock on the schedule, so it makes you run late |
| 10 | **Timer details** | When the cue started and when it's expected to end |
| 11 | **PRE / service tabs** | Only change which part of the cue list you see |
| 12 | **Settings** | Import, the service setup, and Ontime's own settings |

The row icons are the same on every editor: green stopwatch = countdown timer, crossed-out eye = Hide Timer, **AUX** = Show as Aux Timer, and the end action (green double arrow = Play next, orange double arrow = Play next after delay, green square = Stop).

## Running the show

| Button | What it does |
|---|---|
| **Start / Next** (big button) | Starts the next cue. Reads **Start** before anything has run, and **Finish** on the last cue |
| **PREV** | Goes back to the previous cue and starts it. Use it if someone advances too far |
| **Stop** (red square) | Stops the cue list. The cue screens go empty |
| **Play** on a cue | Starts the cue list from that cue |
| **Auxiliary Timer** | Runs the orange timer on the cue screen, for a smaller segment inside a longer one |

### How the cue screen reads

The cue screen shows the cue that's running, its time left, and what's next. A cue's time counts down *to the next cue*, so anything about how the next cue starts is set on the **cue before it**. To have the altar call start the moment the message ends, set the **Message** cue's end action to Play next.

Time left turns red when a cue runs over. A red **NOT CONNECTED TO ONTIME** or **TIMER MAY BE WRONG** banner means that screen has lost touch with Ontime; don't trust its timer until the banner clears, which usually happens by itself within seconds.

## Adjusting time

- **Adjust Current** changes the length of the current cue only. Set an amount (1:00 by default, as minutes:seconds), then press **+** or **−**. It only works while a cue is playing or paused. In a run of Countdown to Time cues, lengthening one only lengthens that cue; the next still ends at its set time. Handy at a Sunday rehearsal when the band needs a few extra minutes.
- **Global Offset** is rarely used. It shifts the whole cue list, for example to delay the start of a Christmas Spectacular by two or five minutes. Use **+1m** / **−1m**, and **Reset** to put it back. Each cue then shows an orange warning with its original and new times.
- The bar along the top shows the total delay, the time now, and when the service is now expected to end. Check it after any adjustment.

## Stage messages

A stage message puts information on the cue screen without renaming a cue, for example how many baptisms are left in each tank.

1. Type the message in the **Stage Message** box.
2. Press the eye button. It lights up, and the message shows on the cue screen.
3. Press it again to hide it.

The message replaces the NEXT line, so while it's up the team on stage can't see what's next. Hide it and the NEXT line comes back.

## Cue settings

Select a cue and its settings appear on the left.

- **Start time, end time and duration.** Cues are linked: each starts when the one before it ends. Type any one and Ontime recalculates the cues after it. Changing a cue's start time stretches or shrinks the cue **before** it, so there's never a gap.
- **Countdown to Time.** On: counts down to a time of day. Off: counts down a fixed length (green stopwatch).
- **Hide Timer.** The cue screen shows 00:00 for this cue, so only one timer counts down on screen, for example during the pre-service video.
- **Show as Aux Timer.** The cue runs on the orange timer instead of the green one. Our MCs expect every service timer to be green and the altar call orange. With a 30-minute message and a 5-minute altar call, set Altar Call to Show as Aux Timer and the Message's end action to Play next, and the orange altar call timer starts as soon as the message ends.
- **End Action.** What happens when the cue reaches zero:
  - **None** (default): the timer overruns, red and counting up with a minus sign, until you move on.
  - **Stop rundown:** the cue list stops. Use it on the last cue of a service.
  - **Play next event:** the next cue starts by itself.
  - **Play next after delay:** the cue runs to zero, overruns in red for the delay, then starts the next cue. Everyone sees the section has finished, and it still moves on. Good for Doors Open, the cue before doors open, and the cue before the service briefing. The delay is 30 seconds by default; change it in Settings.
  - **Load next event:** gets the next cue ready without starting it.

## Adding and editing cues

- Big changes belong in the sheet, then re-import. Small on-the-day fixes can be made in Ontime.
- Switch to **Edit**, then tap the cue before or after where you want a new one. **+ Event** appears above and below it. Tap it, then type the name and either a duration or a start time; Ontime recalculates the cues around it.

## Importing a cue list

### From a Google Sheet

Ontime only ever reads the sheet, so no Google sign-in is needed. Share the sheet as **Anyone with the link can view**.

1. Open **Settings** (gear icon) → **Import** → **Import from Google Sheet**.
2. Paste the sheet's full link and press **Import**. The first time, choose the tab and check the column mapping; after that, Ontime reuses the mapping.
3. The **Currently loaded sheet** box shows the sheet. Pick another tab from its dropdown to load that tab straight away, no re-pasting needed. **Reload** pulls in the latest edits to the sheet, and **Edit column mapping** changes how columns are read.

Each campus can keep one default sheet with a tab for each service type. The **Recent sheets** buttons (up to five) take you back to your usual campus sheet after using a different one for an event.

### From an Excel spreadsheet

In **Settings** → **Import**, use **Import from spreadsheet**: choose the .xlsx file, pick the tab, and check the column mapping.

## The 9am and 11am services

The 11am service is a copy of the 9am, so make every change to the 9am and Ontime rebuilds the 11am to match.

- One cue list runs straight through: rehearsal (PRE), then the 9am, then the 11am. When the 9am ends, the clock carries on into the 11am's doors open.
- **Never edit an 11am cue.** The 11am is deleted and rebuilt whenever the 9am changes, so your edit would be wiped without warning.
- Rehearsal cues run once and are never copied into the 11am.

## Cue screens in ProPresenter: the Ontime Cue Renderer

When Ontime runs on another computer, ProPresenter can struggle to draw the cue screen web page, and you may see flickering or dropouts as it refreshes. The fix is the **Ontime Cue Renderer**, a Mac app that draws the Ontime screens itself and hands them to ProPresenter as a Syphon video feed. Syphon is like NDI but stays inside that one Mac, so it uses no network.

1. Download **Ontime Cue Renderer** from the Ontime releases page on GitHub and install it on the ProPresenter Mac.
2. Enter your Ontime server's IP address, choose which screens (layouts) to send to ProPresenter, and name each video source.
3. In ProPresenter, open **Settings** → **Inputs**, add a new video input, and choose your Syphon source.
4. In the stage display or cue screen editor, make a new layout with a 1920 × 1080 shape filling the background, set its fill to **Video Input**, and pick the input from step 3.
5. Layer anything else on top if needed, such as ProPresenter's own timer, or the current and next slide text for lyrics and scriptures.

Reach out to Alan Aiken for help setting this up.

## When something looks wrong

| You see | Try this |
|---|---|
| Buttons are greyed out | Nothing is loaded. Press **Start** |
| Adjust Current does nothing | A cue must be playing or paused first |
| You pressed Next too early | Press **PREV** to go back and start the previous cue again |
| The timer is behind the real service | **Adjust Current** for one cue, or **Global Offset** for the whole service |
| An 11am cue is wrong | Fix it on the 9am. The 11am rebuilds from it |
| The cue screen isn't showing what's next | A stage message is up. Hide it with the eye button |
| A screen says it's offline, or won't update | Reload the page. If every screen is affected, tell the tech lead |
| The cue screen in ProPresenter flickers | Use the Ontime Cue Renderer (above) |

## Coming soon

- Loading an event from Planning Center.
- A separate guide for the Companion module, bundled with the module.
