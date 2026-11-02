# Ontime Quick Start for volunteers

## What Ontime is

Ontime is a cue-based timer system. Every timer for a service or event is set up ahead of time in a **cue list**. On the day, each cue's timer runs for its segment of the service, started by you or automatically.

## How it works

- **The cue list** is either typed into Ontime cue by cue, or imported from a Google Sheet that has been filled in beforehand. Loading straight from your Planning Center run sheet is coming.
- **How each cue runs** can be set ahead of time in the Google Sheet (or Planning Center), or changed on any cue in Ontime.
- **Every cue is a countdown**, and comes in one of two kinds:
  - **Countdown timer:** counts down a fixed length. Use it when someone should always get their full time, however long the item before them took. A message is the classic example. These cues show a green stopwatch icon.
  - **Countdown to Time:** counts down to a time of day. This is the normal choice for the first part of a service, which has to stick to the clock. Time to the start of the service is the classic example.
- Switch a cue between the two with its **Countdown to Time** toggle.

## The screen at a glance

You'll run the clock from the **iPad Editor**. Tap the menu button (grid icon, top left) and choose iPad Editor. It may ask for a password. Nothing on the other screens in that menu changes the show, so you can't break anything by looking.

![The iPad Editor with numbered callouts](ipad-editor)

| # | What it is | What it does |
|---|---|---|
| 1 | **Start / Next** | Starts the next cue. Reads **Start** before anything has run, and **Finish** on the last cue |
| 2 | **PREV** | Goes back to the previous cue and starts it. If someone advances too far, press PREV |
| 3 | **Stop** (red square) | Stops the cue list. The cue screens go empty, so only use it at the very end |
| 4 | **Auxiliary Timer** | Runs the orange timer on the cue screen, for a smaller segment inside a longer one |
| 5 | **Adjust Current** | Gives the current cue more or less time. Later cues aren't affected |
| 6 | **Global Offset** | Moves the whole cue list later or earlier. Rarely used |
| 7 | **Stage Message** | Puts your words on the cue screen for the team on stage |
| 8 | **Cue settings** | Appear when you tap a cue. See *Cue settings* below |
| 9 | **PRE / service tabs** | Only change which part of the cue list you see. They don't change the show |
| 10 | **Play** on a cue | Starts the cue list from this cue |
| 11 | **Cue name** | The name of the segment, shown on the cue screen |
| 12 | **Start time and duration** | When the cue starts and how long it runs |
| 13 | **Green stopwatch** | This cue is a countdown timer (fixed length). No stopwatch means Countdown to Time |
| 14 | **Hide timer** (crossed-out eye) | The cue screen shows 00:00 for this cue instead of its time |
| 15 | **AUX** | This cue runs on the orange timer instead of the green one |
| 16 | **End action** | What happens when the cue reaches zero: green double arrow = Play next, orange double arrow = Play next after delay, green square = Stop. No icon = None |
| 17 | **+ Event** | Adds a new cue here |

## How the cue screen reads

The cue screen shows the cue that's running, its time left, and what's next. A cue's time is counting down *to the next cue*. So anything about how the next cue starts, such as starting it automatically, is set on the **cue before it**.

For example, to have the altar call start the moment the message ends, set the **Message** cue's end action to Play next. You don't change anything on the altar call cue itself.

## Adjusting time

- **Adjust Current** (5) changes the length of the current cue only. Set an amount (1:00 by default, typed as minutes:seconds), then press **+** or **−**. It only works while a cue is running. Say you have a run of Countdown to Time cues and lengthen the first. Only that cue gets longer; when you move on, the next cue still ends at its set time. It's handy at a Sunday rehearsal when the band needs a few extra minutes and you don't want to throw out the rest of the service flow.
- **Global Offset** (6) is rarely used. It shifts the whole cue list, for example to delay the start of a Christmas Spectacular by two or five minutes. Use **+1m** / **−1m**, and **Reset** to put it back. While an offset is set, each cue shows an orange warning with its original time and its new time.

## Stage messages

A stage message puts information on the cue screen without renaming a cue, for example how many baptisms are left in each tank.

1. Type the message in the **Stage Message** box.
2. Press the eye button. It lights up, and the message shows on the cue screen.
3. Press it again to hide the message.

The message takes the place of the NEXT line, so while it's showing, the team on stage can't see what's next. As soon as you hide it, the NEXT line comes back.

## Cue settings

Tap a cue and its settings appear on the left.

- **Start time and duration.** Cues are linked: each cue starts when the one before it ends. Type a start time or a duration and Ontime works out the rest, recalculating the start times of every cue after it. Changing a cue's start time stretches or shrinks the cue before it.
- **Countdown to Time.** On: the cue counts down to a time of day. Off: it counts down a fixed length (green stopwatch).
- **Hide Timer.** The cue screen shows 00:00 for this cue. Use it when you only want one timer counting down on screen rather than two or three, such as during the pre-service video.
- **Show as Aux Timer.** The cue runs on the orange timer instead of the green one. Our MCs expect every service timer to be green and the altar call timer to be orange. This setting lets you automate that. Say a speaker has 30 minutes for the message and 5 for the altar call: set the Altar Call cue to Show as Aux Timer, and the Message cue's end action to Play next. The altar call timer then starts in orange as soon as the message timer finishes.
- **End Action.** What happens when this cue reaches zero:
  - **None** (the default): the timer goes into overrun. It turns red and counts up with a minus sign until you move on.
  - **Stop rundown:** the cue list stops. Use it on the last cue of a service.
  - **Play next event:** the next cue starts by itself, so the cue list runs on its own.
  - **Play next after delay:** the cue runs to zero, overruns in red for a set delay (30 seconds unless production changes it), then starts the next cue. Everyone can see the section has finished, and it still moves on without anyone pressing anything. Good for Doors Open, the cue before doors open, and the cue before the service briefing.
  - **Load next event:** gets the next cue ready without starting it.
- **Delete Event** is at the bottom of the settings.

## Adding a cue

1. Tap the cue before or after where you want the new one. **+ Event** appears above and below it.
2. Tap **+ Event**. A new cue appears with a duration of 0.
3. Type the cue's name, and either its duration or its start time. Ontime recalculates the cues around it.

## The 9am and 11am services

- One cue list runs straight through: rehearsal (PRE), then the 9am, then the 11am. When the 9am ends, the clock carries on into the 11am's doors open. You don't need to load anything.
- **Never edit an 11am cue.** The 11am is rebuilt from the 9am, so changes there are wiped. Tell production if an 11am cue is wrong.
- If you're unsure, press nothing and ask production.

## If something looks wrong

| You see | Do this |
|---|---|
| Buttons are greyed out | Press **Start**. If they stay grey, tell production |
| Adjust Current does nothing | Start the cue first |
| You pressed Next too early | Press **PREV** to go back to the previous cue and start it again |
| The cue screen isn't showing what's next | A stage message is showing. Hide it with the eye button |
| The screen says offline or stops updating | Reload the page. If it doesn't come back, tell production |

## Coming soon

- Loading an event straight from Planning Center.
