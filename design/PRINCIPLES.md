# Design principles (draft)

How the phone app should look, talk and behave. This draws on accepted principles from UI and UX design, crisis communication, accessibility standards and Swiss graphic design. [system.html](system.html) holds the visual system and [components.html](components.html) shows the components working on a phone. Compiled on **21 November 2026**.

The aim is an app that is **calm and good-looking**, that **communicates in seconds**, and that **anyone can use**, including someone who is stressed, injured, colour-blind, in bright sun or using a screen reader. It should feel like a well-made consumer product, not a form.

---

## 1. Communicate like an emergency service

The CDC's [Crisis and Emergency Risk Communication (CERC)][cerc] principles are the standard for talking to people in a crisis. Each one maps directly to a rule for the app:

| CERC principle | What the app does |
|---|---|
| **Be first** | Tells you what's happening as soon as you open it. You don't have to ask. |
| **Be right** | States what is known **and what isn't**. "Not known yet" stops people filling the gap with rumour. |
| **Be credible** | Shows the source and time on every message. Official text is passed on word for word. |
| **Express empathy** | Uses a calm, plain tone. No false reassurance, no alarm, no promises such as "we'll let you know". |
| **Promote action** | Each message gives **one** clear thing to do, such as "Send SOS" or "Turn on Bluetooth". |
| **Show respect** | Uses plain words. Nobody is talked down to, and nothing is hidden. |

People under stress process information differently. CERC says messages must be **simple, credible and consistent**, repeated, and must give an action people can take ([CDC, Psychology of a crisis][cerc-psych]). For the app, that means:

- Put the most urgent fact first, and keep each message to one idea.
- Use short sentences and everyday words. GOV.UK writes for a reading age of about 9.
- Keep the same words for the same thing everywhere. If the button says "Send", the confirmation says "Sent".
- Say what failed and what to do next. "Not getting through right now. The app keeps trying. First aid and the news still work."
- State facts, don't talk like a person. "Why? Not known yet." Not "Nobody knows why yet. We'll tell you as soon as we hear." If something arrives later, just show it.
- Never promise what may not work. With every network down, 999 may not connect, so the app offers SOS instead of "999 still works".

## 2. UI principles

These follow the seven principles in [Figma's UI design guide][figma].

1. **Hierarchy.** Show the most important thing first and largest. The order of importance is: what's happening, what to do, then where the information came from. Use size, weight and position for hierarchy, and **keep colour for meaning**.
2. **Progressive disclosure.** Show one layer at a time: the headline, then the topics, then one topic in a sheet. Never show a dashboard. **Hint, then reveal:** the home screen says what information exists ("Water, 2 places", "Food, Nothing yet") without showing it. One tap opens it. First aid shows one step at a time.
3. **Consistency.** Use a small, fixed card kit. Each card always looks and behaves the same way. The model chooses a card but never invents a layout.
4. **Contrast.** Reserve strong contrast and colour for what needs attention. If everything is bold, nothing stands out.
5. **Accessibility.** Covered in section 4.
6. **Proximity.** Keep a message, its source and its action together. Separate destructive or high-stakes actions, such as "Share my location", from routine ones.
7. **Alignment.** Snap everything to one grid (section 3).

Usability principles from human–machine interaction also apply. These come from Nielsen's heuristics and Norman's design principles:

- **Visibility of system status, through the message.** People can't tell signal, internet and Bluetooth apart, and don't need to. So the app shows no connection status at all. You just ask. Each message shows what happened to it: Sending, Delivered, Answered, or Not sent yet. Only two things ever appear on their own: "Bluetooth is off", with a button that turns it on, and "Not getting through right now", which sits above the question box and goes away by itself.
- **Match the real world.** Talk about the message, not the connection. Never say online, offline, connected, signal, internet, network, hub, server or mesh, and never show how many phones or people are nearby: "connected" makes people think they have internet, and a count gives them nothing to act on. How it works is one tap away, under "How does this work?", in three sentences.
- **User control.** People can cancel a message before it leaves, and location is off until they turn it on.
- **Recognition over recall.** People often don't know what to ask. The home screen shows six topics with pictures (Water, Charge phone, Food, Family, Shelter, First aid) and says for each whether there is anything to find yet. Free text is there for anything else.
- **Feedback.** Every tap gets an immediate visible response, even while an answer is still on its way.
- **Error prevention.** Confirm before anything that can't be undone, such as sending your location.

## 3. Swiss style: the visual language

The International Typographic Style (Swiss style) is built on a **grid, asymmetric layouts, sans-serif type, flush-left ragged-right text and objectivity** ([overview][swiss]). This suits an emergency app well because it is plain, factual and quick to scan.

- **Background:** black. **Text:** white. Dark is the default because it saves battery on most phones (section 6). A light palette stays available for bright sun.
- **Grid:** 4 columns on a phone, with 20 px outer margins and spacing in steps of 4 px. Everything aligns to the left edge. The design file shows the grid as faint red lines, a nod to Swiss posters. The app itself never draws it.
- **Text:** always flush left and ragged right. Never centred, never justified.
- **Flat and friendly.** Black surfaces with 1 px outlines (`#2C2C2E`), close to a clean developer tool such as Vercel's, but with softer corners so it never feels sharp: 4 px for tags and bubble tails, 8 px for items inside cards, 12 px for cards, buttons, tiles and the text field, 16 px for sheets. **No pills**: a state is a coloured icon and a word, with no badge around it. No shadows, gradients, glows or illustrations.
- **Pictures first.** Icons come from Google's Material Symbols (Rounded, filled), mapped to SF Symbols on iPhone. Topic icons follow public signs (a glass for water, a battery for charging, a knife and fork for food) so they work for people who read little English.
- **Large type does the work.** The headline is set big, like a poster, so the one thing that matters reads from arm's length.
- **Type:** one sans-serif family, in eight styles and two weights. [system.html](system.html) is the source of truth for every size, colour, space and radius.
  - **Decided: Atkinson Hyperlegible Next**, from the Braille Institute. It was made for people with low vision, so every letter has its own shape and I, l and 1 never look alike. It is free (SIL Open Font License), has 7 weights, and is bundled in the app so it works offline. [system.html](system.html#type) compares it with B612 (Airbus, made for cockpit screens), Inclusive Sans, Lexend, Andika and Inter under a blur, glare and small-size test.
  - Inter, the first draft, was dropped because it is the default of countless apps and looks generic. Volvo Centum, Volvo's safety typeface, is only for Volvo's own use.
  - Helvetica is the classic Swiss choice, but its I, l and 1 look nearly identical, which is a real problem for people reading under stress.
- **Type scale** (default sizes in points; each maps to an iOS text style, so it grows with the phone's text-size setting):

| Style | Size / line height, weight | Used for |
|---|---|---|
| Display | 44 / 46 semibold, −1% tracking | The one fact on opening |
| Title 1 | 28 / 32 semibold | Second line, sheet titles, first-aid step |
| Title 2 | 22 / 28 semibold | Card titles |
| Body | 17 / 24 regular | Every message |
| Body strong | 17 / 24 semibold | Short emphasis |
| Callout | 15 / 20 semibold | Buttons and state words |
| Caption | 13 / 18 regular, grey | Sources and times |
| Label | 13 / 16 semibold | The line under a topic, the New tag |

## 4. Colour means state, and never colour alone

White on black carries all information. **Three colours each mean exactly one state**, so people learn them in seconds, like traffic lights. Values below are the dark default, with the light alternative in brackets.

| State | Means | Colour | How to use it | Paired with |
|---|---|---|---|---|
| **Information** | Facts, official updates, answers | White `#FFFFFF` on black `#000000` (light: black on white) | Default text, 21:1 | — |
| **Danger** | Act now: a life may be at risk; send SOS; leave | Red `#FF6159` for icons and text (light: `#D7000F`); the SOS button is always `#D7000F` | Red 7.1:1 on black and 5.8:1 on the red tint `#3A0A0C`. White on the red button 5.4:1 | A ▲ warning icon and a word such as "SOS" |
| **Caution** | Waiting, not known yet, not sent yet, old news | Yellow `#FFD100` (light: amber `#9A5B00`) | **Icons on black** (14.4:1), or a fill with black on it. Never text | A clock icon and a word such as "Not known yet" or "Not sent yet" |
| **Safe** | Done, delivered, answered, power back | Green `#30D158` (light: `#007A3D`) | Green icons 10.4:1 on black | A ✓ check icon and a word such as "Delivered" or "Delivered to Mum" |
| Secondary | Sources, times, hints | Grey `#9A9A9F` (light: `#6B6B6B`) | Text, 7.5:1 on black and 6.1:1 on Surface 2 | — |

**Why yellow is never text.** On black, a yellow icon passes easily (14.4:1). But yellow on white reaches only **1.46:1**, far below WCAG's minimum, so the light palette swaps it for amber `#9A5B00` (5.4:1). Words always stay white or grey; only the icon carries the colour. Where yellow is a fill, the text on it is black (14.4:1). White on yellow is 1.46:1 and never allowed.

**Why colour is never alone.** About 1 in 12 men can't easily tell red from green. Every state therefore has its own icon (warning, clock, check) and its own word as well as its colour. This also meets WCAG 1.4.1, Use of colour.

## 5. Accessibility checklist

The target is [WCAG 2.2][wcag22] level AA or better.

- **Text contrast** of at least 4.5:1, or 3:1 for large text. Icons, borders and controls need at least 3:1 ([non-text contrast][wcag-nontext]). All the colours in section 4 pass, except yellow used as text, which is never allowed.
- **Tap targets** of at least **44 × 44 points** (Apple's guidance), well above WCAG's 24 × 24 CSS pixel minimum. Stressed hands miss small targets.
- **Text size.** The layout must survive the largest system text size without cutting off text. Messages never go below 17 px, and only sources and times go down to 13 px.
- **Screen readers.** Every card is read in a sensible order: state, title, message, source, then action. Buttons say exactly what they do ("Send SOS", not "Go").
- **Motion.** Short and plain: things fade in, bars fill, sheets slide. Movement only shows a real change, such as a message sent or news arriving. **Nothing pulses, ripples, glows or loops.** Respect the "reduce motion" setting. [components.html](components.html) shows each motion.
- **Readable in sunlight.** Dark text on white reads better in bright sun, and light text on black can blur slightly for people with astigmatism. The app follows the phone's light or dark setting, with dark as the default.
- **No time limits.** Nothing disappears before the user has read it.

## 6. Battery: why dark is the default

Most phones in use now have OLED screens, including most iPhones since the iPhone X and most mid-range and flagship Android phones. On an OLED screen each pixel makes its own light, and a black pixel is switched off. A mostly black app therefore draws less power.

How much it saves depends on brightness. A [Purdue University study][purdue] (2021) measured OLED phones and found:

- about **3–9%** battery saved at 30–50% brightness, typical indoors;
- about **39–47%** saved at full brightness. Automatic brightness goes to about full outdoors, which is where people will be in many emergencies.

Phones with LCD screens (such as the iPhone SE and iPhone 11, and many cheaper Android phones) keep the backlight on, so dark mode saves almost nothing there.

Other ways the design saves power:

- Use pure black `#000000` for the background, not a dark grey, so those pixels stay off.
- Keep screens sparse, which Swiss style does naturally.
- Avoid animation and polling.

[cerc]: https://stacks.cdc.gov/view/cdc/120677/cdc_120677_DS1.pdf
[cerc-psych]: https://stacks.cdc.gov/view/cdc/60292/cdc_60292_DS1.pdf
[figma]: https://www.figma.com/resource-library/ui-design-principles/
[swiss]: https://opentextbc.ca/graphicdesign/chapter/1-6-its/
[wcag22]: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
[wcag-nontext]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast
[purdue]: https://www.purdue.edu/newsroom/releases/2021/Q3/dark-mode-may-not-save-your-phones-battery-life-as-much-as-you-think,-but-there-are-a-few-silver-linings.html
