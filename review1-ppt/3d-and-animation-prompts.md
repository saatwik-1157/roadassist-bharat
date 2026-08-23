# 3D Visual & Animation Prompt Pack

**RoadAssist · SWE4004 Cloud Computing · Review 1**
Professional prompts for generating 3D renders, animated loops and live motion to upgrade the deck.

---

## 0. How to Use This Pack

> **Status:** Tiers 1 and 2 are already built into the delivered deck — 12 code-generated isometric 3D illustrations, 4 looping animations, and transitions on every slide. This pack is now (a) the record of how that art was specified, so you can regenerate or extend it in a consistent style, and (b) the remaining manual steps.

Work in three tiers. **Tier 1 alone already makes the deck look professional** — the rest is upgrade.

| Tier | What it is | Tools | Cost | Time |
|---|---|---|---|---|
| **1 — Motion** | PowerPoint's own Morph and build animations. No AI needed. | PowerPoint | Free | 30 min |
| **2 — 3D stills** | AI-generated 3D hero images placed on key slides | Microsoft Designer / Bing Image Creator, Leonardo.ai, Adobe Firefly, Ideogram | Free tiers | 1–2 hrs |
| **3 — Animated loops** | 4–6 second silent video loops embedded in slides | Runway, Kling, Pika, Luma Dream Machine, Sora | Free tiers (limited) | 2 hrs |

> **Do Tier 1 first.** A deck with perfect Morph transitions and no AI art beats a deck with beautiful AI art and static slides. Motion is what reads as "professional" from the back of a room.

---

## 1. The Style Lock — Append This to Every Image Prompt

The single biggest mistake is generating twelve images in twelve different styles. Paste this block at the end of **every** prompt so everything matches the deck.

```
STYLE: premium 3D render, isometric perspective, soft studio lighting with a
single warm key light from upper left, subtle rim light, matte surfaces with
gentle specular highlights, shallow depth of field, cinematic.

PALETTE (strict): deep midnight navy #0B1B2B background, steel blue #1C4E7A
mid-tones, hazard amber #FFB020 as the only accent colour, off-white #FFFFFF
highlights. No other hues.

RENDER: Octane / Cinema 4D quality, 8k, physically based materials, clean
negative space on the right third for text overlay.

NEGATIVE: no text, no letters, no numbers, no logos, no watermarks, no people's
faces, no clutter, not photorealistic-stock-photo, no rainbow colours, no green
or purple, no lens flare.
```

**Aspect ratios:** `--ar 16:9` for full-slide backgrounds · `--ar 1:1` for icon-style spot art · `--ar 4:5` for the side-panel images.

---

## 2. Slide-by-Slide 3D Image Prompts

### Prompt 1 — Title slide background
> A vast dark aerial view of an Indian national highway at dusk, rendered as a stylised 3D isometric diorama. A single small vehicle glows with a warm amber halo on the empty road. Faint translucent amber signal arcs radiate upward from the vehicle toward a soft cloud-shaped network of glowing nodes floating above. The land around the road is dark, minimal and low-poly. Wide empty sky. Left third completely clear for a title.
> `--ar 16:9` + STYLE LOCK

*Place at:* full-bleed background on slide 1, set image transparency 55–65% so the white title stays readable.

### Prompt 2 — The Problem
> A lone stylised 3D car with its hazard lights glowing amber, stopped on a dark empty highway at night. Around it, concentric rings of faint signal waves fade out and break apart, visualising a total loss of network coverage. Cold blue emptiness beyond. Isometric, dramatic, isolated, a strong sense of distance from help.
> `--ar 4:5` + STYLE LOCK

### Prompt 3 — Our Idea / Solution
> A glowing amber network mesh in the shape of the Indian subcontinent, rendered in 3D, floating above a dark surface. Small illuminated vehicle icons of many different types — car, motorcycle, auto rickshaw, truck, tractor — sit at the nodes, connected by thin luminous amber lines. Clean, symmetrical, hopeful.
> `--ar 16:9` + STYLE LOCK

### Prompt 4 — Cloud architecture / stack
> Three stacked translucent glass platforms floating in dark space, connected by vertical beams of amber light, forming a layered technology stack. The top platform holds small glowing device shapes, the middle holds interconnected cube nodes, the bottom holds cylindrical database and server forms. Isometric, elegant, weightless.
> `--ar 16:9` + STYLE LOCK

### Prompt 5 — Virtualization & containers
> A single large translucent glass server cube containing many smaller glowing amber cubes floating inside it in a neat grid, illustrating containers inside a virtual machine. Some small cubes are lifting out and drifting away. Dark background, isometric.
> `--ar 1:1` + STYLE LOCK

### Prompt 6 — Dynamic scalability / autoscaling
> A row of identical glowing server blocks on a dark reflective surface. From left to right, the row multiplies dramatically — three blocks become fifteen — with the newest blocks materialising as translucent amber wireframes still forming. A sense of instant, effortless growth. Isometric.
> `--ar 16:9` + STYLE LOCK

### Prompt 7 — Load balancing
> A single glowing amber stream of light entering a faceted crystalline distributor node, which splits it into six even beams flowing outward to six identical illuminated server blocks arranged in an arc. Perfect symmetry, dark background, isometric.
> `--ar 16:9` + STYLE LOCK

### Prompt 8 — Redundant storage / replication
> Three identical glowing database cylinders floating at the vertices of a triangle in dark space, each connected to the others by pulsing amber light threads. One cylinder is dimmed and fading while the other two glow brighter — visualising automatic failover. Isometric, calm, reassuring.
> `--ar 1:1` + STYLE LOCK

### Prompt 9 — Cloud security
> A translucent amber hexagonal shield enclosing a cluster of glowing server cubes, rendered in 3D. Thin red threat vectors approach from outside and dissolve into sparks on contact with the shield surface. Dark background, isometric, protective and solid.
> `--ar 4:5` + STYLE LOCK

### Prompt 10 — Offline / on-device intelligence
> A single smartphone lying on a dark surface, its screen glowing amber, with a small luminous neural-network lattice floating just above the screen. All around it, empty dark space with no network lines at all — deliberately disconnected. Intimate, close-up, isometric.
> `--ar 4:5` + STYLE LOCK

### Prompt 11 — Emergency response
> A stylised 3D crash-site scene at night rendered minimally: one vehicle emitting an urgent pulsing amber beacon, and three thin light trails racing inward toward it from the edges of the frame representing responders. High contrast, urgent, dark, isometric. Restrained and dignified — no gore, no debris, no injured people.
> `--ar 16:9` + STYLE LOCK

### Prompt 12 — Multi-tenancy
> Four separate glass compartments inside one large translucent container, each compartment glowing a different intensity of amber, all served by a single beam of light entering from above and splitting cleanly between them. No leakage between compartments. Isometric, precise, architectural.
> `--ar 1:1` + STYLE LOCK

---

## 3. Animated Loop Prompts (Tier 3)

Generate **4–6 second silent loops**, export MP4, insert into PowerPoint, then set them to *Play automatically* and *Loop until stopped*.

| # | Slide | Prompt |
|---|---|---|
| **A1** | Title | *"Slow cinematic aerial push-in over a dark Indian highway at dusk. A single vehicle's amber hazard lights pulse rhythmically. Faint amber signal rings expand upward and dissipate. Camera moves forward very slowly. Seamless loop, no cuts, no text, dark navy and amber palette."* |
| **A2** | Dynamic scalability | *"Isometric server blocks on a dark surface multiplying smoothly from three to fifteen and back down again, new blocks materialising as translucent amber wireframes that solidify. Smooth breathing rhythm. Seamless loop, no text."* |
| **A3** | Load balancing | *"A stream of amber light particles flowing continuously into a crystalline node and splitting into six even beams travelling outward to server blocks. Continuous particle flow. Seamless loop, dark background, no text."* |
| **A4** | Security | *"An amber hexagonal energy shield surrounding glowing server cubes, pulsing gently. Thin red threat lines approach and dissolve on impact with small sparks. Slow, controlled, seamless loop, no text."* |
| **A5** | Emergency | *"A pulsing amber emergency beacon on a dark map surface. Three thin light trails race inward from the frame edges toward the beacon, arrive, then the sequence restarts. Urgent but restrained. Seamless loop, no text."* |
| **A6** | Closing | *"A slowly rotating 3D wireframe globe focused on India, covered in a fine amber network mesh with small light nodes pulsing at intervals across the subcontinent. Very slow rotation, seamless loop, dark navy background, no text."* |

**Video settings that matter:** 1920×1080 · MP4 H.264 · under 10 MB each · **no audio** · loop-safe (first and last frame should match).

---

## 4. Tier 1 — PowerPoint Motion

> **Already done for you.** The delivered deck ships with a transition on **all 31 slides** — Morph on the five slides where consecutive slides share shapes, Fade into each section divider, Zoom on the three animated slides, and directional Push through the content flow. The 12 isometric 3D illustrations and 4 looping animations described below are **already embedded**. What follows is (a) how to change any of it, and (b) the per-object build animations, which still need five minutes in PowerPoint.

### 4.1 Morph — the single highest-impact effect

Morph animates any shape that exists on two consecutive slides, moving and resizing it smoothly. It makes a deck look designed rather than assembled.

**Setup:** Select the second slide → **Transitions** tab → **Morph** → Effect Options → **Objects**. Duration **0.75 s**.

**Where to use it in this deck:**

| From → To | What morphs | Effect |
|---|---|---|
| Section divider → first slide of that section | The large amber numbered circle | The number shrinks and travels into position — feels like a camera move |
| Architecture slide → itself, duplicated | The SaaS / PaaS / IaaS bands | Reveal the stack one layer at a time by duplicating the slide and adding one tier per copy |
| "How it works" → duplicated copies | The six numbered step cards | Steps slide in one at a time instead of appearing all at once |
| Problem stats → Idea slide | The four stat cards → the four pillar cards | The problem visually transforms into the solution. **This is the best moment in the deck — use it.** |

> **The trick that makes Morph work:** duplicate the slide (Ctrl+D), then *move or change* elements on the copy rather than rebuilding them. Morph only animates objects it recognises as the same object.

### 4.2 Build animations for dense slides

For the Module 3, Module 4 and Security slides, reveal cards in sequence so the audience follows you instead of reading ahead.

**Setup:** select the cards → **Animations** → **Fade** → Effect Options → **By Paragraph** → set **Start: After Previous**, **Duration: 0.4 s**, **Delay: 0.15 s**.

### 4.3 The chart build

On the "Why cloud" slide, animate the bar chart so the peak lands as you say it.

**Animations** → **Wipe** (from bottom) → Effect Options → **By Element in Series** → Duration 0.5 s. The bars grow one by one and the audience watches the 18:00 spike appear.

### 4.4 The emergency countdown

On the emergency strip, apply **Appear** to each of the five boxes with **Start: After Previous, Delay 0.3 s**, then add a **Pulse** emphasis on the final "ERSS 112" box. Five beats in about two seconds — it mirrors the ten-second claim you are making.

---

## 5. Live Elements — Highest Credibility Per Minute

Anything genuinely live beats any animation. Ranked by impact against effort:

| # | Element | How | Impact |
|---|---|---|---|
| 1 | **Live prototype on a real phone** | Mirror your Android screen to the projector via `scrcpy` (free) — the phone appears in a window you can present | Very high |
| 2 | **Airplane-mode demo** | Turn on airplane mode on stage, complete a request, turn it off, watch it sync | Very high |
| 3 | **Live cloud console** | Show the actual running Kubernetes pods or database in the provider console for ten seconds | High |
| 4 | **Live autoscaling** | Run a small load script; show pod count rising in real time in a Grafana dashboard | Very high |
| 5 | **QR code on the closing slide** | Links to your deployed demo so the panel can open it on their own phones | Medium |

> **Record all of it in advance with OBS Studio.** Live demos fail — the WiFi drops, the phone will not pair, an API times out. With a recorded backup, a failure costs five seconds instead of your review.

---

## 6. Inserting Visuals Without Wrecking the Deck

| Rule | Why |
|---|---|
| **Compress images before inserting** — target 1600 px wide, under 400 KB | A 20 MB deck stutters on a lab machine |
| Use **File → Compress Pictures → 150 ppi** after inserting everything | Often halves the file size with no visible loss |
| Set background images to **55–70% transparency** | Text must stay readable; that is not negotiable |
| Keep the **right third clear** on hero images | That is where your text sits |
| Embed videos, never link them | A linked video is a blank rectangle on any other computer |
| **Never put a video behind body text** | Moving pixels behind words make them unreadable |
| Test on the **actual projector** | Projectors crush dark tones — your midnight navy may render as flat black |

**Free compression:** Squoosh (web), TinyPNG (web), or PowerPoint's built-in compressor.

---

## 7. What Not To Do

| Avoid | Why |
|---|---|
| Different art styles across slides | The single clearest sign of an assembled deck. Use the style lock. |
| Generic stock photos of people at laptops | Adds nothing and reads as filler |
| Spinning 3D text or WordArt | Instantly dates the deck |
| Sound effects on transitions | Never appropriate in an academic review |
| More than one animation type per slide | Motion should guide attention, not compete for it |
| Animating every element | If everything moves, nothing stands out |
| Text over a busy image without a scrim | Illegible from row three |
| A 100 MB deck | It will not open on the lab machine |

---

## 8. A Realistic Time Budget

| Task | Time |
|---|---|
| Tier 1 — Morph transitions and build animations | 30 min |
| Generate 12 images (Tier 2) with iteration | 90 min |
| Compress and insert images | 30 min |
| Generate and insert 3 animated loops (Tier 3) | 60 min |
| Record backup demo video with OBS | 30 min |
| Rehearse with the timings | 45 min |
| **Total** | **≈ 5 hours** |

**If you only have one hour:** do Tier 1 Morph transitions, generate the title-slide image, and record the backup demo. That is 80% of the perceived polish for 20% of the work.
