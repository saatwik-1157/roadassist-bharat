# RoadAssist Bharat — SWE4004 presentation

`RoadAssist-Bharat-FINAL.pptx` — the current deck: 32 slides, 16:9, speaker
notes on the slides that need them. `RoadAssist-Bharat-FINAL.pdf` is its
PowerPoint export.

## Rebuilding

```bash
pip install python-pptx pillow
python ppt/make_final.py    # build_deck.py + part_final.py -> RoadAssist-Bharat-FINAL.pptx
```

The deck is generated rather than hand-drawn so that a fact which changes in the
project (route count, table count, provider status) can be corrected in one
place and the slide regenerated. Edit `part_final.py`, never the `.pptx`.

| File | Contents |
|------|----------|
| `build_deck.py` | Palette, background generation, and every slide primitive |
| `part_final.py` | The final deck's 32 slides, in order |
| `make_final.py` | Concatenates the two above into `make_final_generated.py`, runs it and saves the deck |
| `part_a.py` … `part_g.py`, `make.py` | The superseded Review-1 deck (`RoadAssist-Bharat-SWE4004.pptx`, 30 slides, no longer in the tree) |
| `assets/` | Generated background images (deleted → regenerated) |

## Transitions and the PDF

Transitions are **not** written by the build. Hand-authored `AlternateContent`
XML produced a file PowerPoint refused to open, so they are applied afterwards
through PowerPoint's own object model. The same pass exports the PDF, which is
deliberate: PowerPoint is the only renderer on this machine that is guaranteed
to agree with the machine the deck is presented on.

```powershell
$src = "<full path>\RoadAssist-Bharat-FINAL.pptx"
$pdf = "<full path>\RoadAssist-Bharat-FINAL.pdf"
$pp = New-Object -ComObject PowerPoint.Application
$pp.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue   # required; COM refuses a hidden Open
$pres = $pp.Presentations.Open($src, $false, $false, $false)
for ($i = 1; $i -le $pres.Slides.Count; $i++) {
  $t = $pres.Slides($i).SlideShowTransition
  $t.EntryEffect = 1793          # ppEffectFade
  $t.Duration = 0.7; $t.AdvanceOnClick = $true; $t.AdvanceOnTime = 0
}
$pres.Save()
$pres.SaveAs($pdf, 32)           # 32 = ppSaveAsPDF
$pres.Close(); $pp.Quit()
```

Every slide gets the same 0.7 s fade. Morph was tried first and is **not
reachable through this COM surface** — the constant is rejected and the effect
falls back — so the deck does not claim it. Dissolve (`1537`) is reachable but
reads as dated on a projector.

Two failures worth remembering, because both cost an hour:

- **PowerPoint refusing to open a generated deck** is almost always an invalid
  shape, not a corrupt file. A `0 x 0` in image slot produced text boxes of
  negative width — serialised by python-pptx without complaint, rejected by
  PowerPoint. `shot()` now raises on any slot under 0.2 in.
- **Check the exported PDF, not the .pptx.** Two screenshots that looked
  distinct in the deck rendered near-identical on slide 13, because the capture
  script had not scrolled the vehicle card into view.

## Academic accuracy

Every technical slide carries one of four badges, and they are the point of the
deck rather than decoration:

| Badge | Meaning |
|-------|---------|
| `IMPLEMENTED` | Verified present in this repository and demonstrable live |
| `PARTIALLY IMPLEMENTED` | A real but limited form exists — stated precisely on the slide |
| `ARCHITECTURAL CONCEPT` | The textbook mechanism mapped onto the design, not built |
| `PROPOSED / FUTURE SCOPE` | Future work, explicitly not built |

Deliberately **not** claimed anywhere: Kubernetes, AWS, Azure, GCP, automatic
scaling, replication, load balancing, cloud bursting, uptime figures, user
counts, response times beyond the single-user measurements, AI accuracy beyond
the measured validation mAP, cost savings or server counts. A grep for
those terms is part of the build check.

Facts that *are* asserted, all verified against the running system:

- TypeScript · Fastify 5 · Drizzle ORM · Zod · jose
- PostgreSQL 16 + PostGIS 3.4.3, 56 tables, 67 API routes (64 under `/v1`)
- Seven roles: citizen, mechanic, admin, gov_officer, fleet_admin, fleet_driver, support
- PWA with a service worker caching 23 shell assets; manifest with 5 shortcuts
- Rules-based AI diagnosis (ADR-0006), with an optional HTTP model provider
- Razorpay payments: Orders API, HMAC signature verification, and a signed
  webhook — default provider is `mock`, which the live demo runs; live keys need a KYC-verified account
- Docker Compose provides PostGIS, Redis and Redpanda locally — **Redis and
  Redpanda are provisioned but not used by application code**, and the deck says so
- 757 automated assertions across six suites: 225 unit · 191 API e2e · 77 concurrency
  · 74 security · 27 gateway security · 163 browser. A seventh — 22 payment-gateway
  checks — runs against a local stub of Razorpay's API and needs no account, but
  only against an API started with `PAYMENTS_PROVIDER=razorpay`; it is **not**
  counted here and is never described as passing.
- A live demo deployment: one Render web service and Neon Postgres, both in
  Singapore (no India region on the free tiers; an Indian region is the
  production target), with the showcase on GitHub Pages
- 11 ADRs; trained YOLO11 road-damage detectors — best YOLO11s mAP50 0.472, and
  the YOLO11n (mAP50 0.443) whose detections the RAKSHA demo shows at simulated
  positions
- Eight languages (en hi ta te bn mr kn gu) across SMS, OTP, the Android UI and the
  web app's critical paths — **machine-translated and not yet native-reviewed**

## The visuals

*(This section and "Presenting" below were written for the Review-1 deck; the
final deck uses `vis_products.png` on slide 1.)*

`render_visuals.py` generates four images into `assets/`, and the deck embeds
them. Two kinds, and the distinction is deliberate:

**Product visuals** are built from real screenshots of the running application,
set into perspective-warped device frames with contact shadows. In a viva that
is worth more than generated artwork — it is the actual system, and it can be
checked live.

| Image | Slide | Built from |
|-------|-------|-----------|
| `vis_hero.png` | 1 | Customer home + mechanic dashboard, over a network field |
| `vis_datacenter.png` | 10 | Procedural isometric server hall |
| `vis_closing.png` | 26 | Live tracking screen with a glowing route |
| `vis_products.png` | spare | Three surfaces side by side |

**Infrastructure visuals** are rendered procedurally as isometric geometry. No
stock image with unknown licensing enters the deck, and nothing photographic is
claimed.

```bash
python ppt/render_visuals.py    # regenerate (reads screenshots from SHOTS)
python ppt/make.py              # rebuild the deck
```

`render_visuals.py` reads its screenshots from the path in its `SHOTS` constant.
Point that at a fresh capture to refresh the product imagery.

Images are centre-cropped to each slot by `fit_crop()`, never stretched.

## Presenting

Speaker notes on all 30 slides follow the same six-part structure: what the
slide means, what to say, which cloud concept it demonstrates, how it relates to
RoadAssist, what to answer if challenged, and the transition to the next slide.

Slides 28–30 are viva preparation: 24 likely questions with one-to-three
sentence answers tied to this project specifically.
