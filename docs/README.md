# Documentation index

`docs/` holds the repository-wide reference: the directory map, the toolchain
inventory, the RAKSHA design documents and the translation review sheets. The
technical documentation for the platform itself lives in
[`app/docs/`](../app/docs/).

Every document listed here is **living**: kept current, and if it disagrees with
the code, the document is wrong and should be fixed.

---

## Start here

| Document | For |
|---|---|
| [`../README.md`](../README.md) | What the platform is, who built it, what exists today, what is roadmap |
| [`../ENGINEERING-NOTES.md`](../ENGINEERING-NOTES.md) | How to run and change this repo — toolchain traps, migration rules, the honesty rules |
| [`../app/docs/PROJECT_OVERVIEW.md`](../app/docs/PROJECT_OVERVIEW.md) | The system in one read |
| [`../app/docs/adr/`](../app/docs/adr/) | Thirteen ADRs. Every non-obvious decision, with the alternative that was rejected |

## Reference — kept current

| Document | Contents |
|---|---|
| [`../app/docs/TESTING.md`](../app/docs/TESTING.md) | Every suite, what only each can prove, what is deliberately not covered, localisation coverage |
| [`../app/docs/DEPLOYMENT.md`](../app/docs/DEPLOYMENT.md) | Production stack, secrets, HTTPS, backup and restore |
| [`../app/docs/SECURITY.md`](../app/docs/SECURITY.md) · [`security/threat-model.md`](../app/docs/security/threat-model.md) | Threats, and what answers each |
| [`../app/docs/OFFLINE.md`](../app/docs/OFFLINE.md) | Off-Grid Mode end to end (ADR-0009) |
| [`../app/docs/CLAIMS-AUDIT.md`](../app/docs/CLAIMS-AUDIT.md) | **Every claim checked against the code.** Read before writing a slide |
| [`../app/docs/DEMO-SCRIPT.md`](../app/docs/DEMO-SCRIPT.md) | The live demo, beat by beat |
| [`PROJECT-STRUCTURE.md`](PROJECT-STRUCTURE.md) | Directory-by-directory map |
| [`TOOLS-AND-SOFTWARE.md`](TOOLS-AND-SOFTWARE.md) | Every tool, library and service the project uses, and where |

## RAKSHA

| Document | Contents |
|---|---|
| [`raksha/00-requirements.md`](raksha/00-requirements.md) | The road-monitoring extension's requirements |
| [`raksha/05-dataset-license-verification.md`](raksha/05-dataset-license-verification.md) | RDD2022 licensing, and the class mapping the CV tests enforce |
| [`../ai/README.md`](../ai/README.md) | Trained models with measured metrics, and the honest CPU-only caveat |

## Translations

| Document | Contents |
|---|---|
| [`translations/README.md`](translations/README.md) | Native-speaker review sheets for the machine-translated Android, web and SMS strings, and how to use them |

---

## Removed on 2026-10-05

The 18-phase planning set (`00-team-charter.md` to `05-devops-qa-lead-roadmap.md`),
the v1.0.0-RC1 dated evidence (`release/`, `verification/`), the demo and viva
preparation packs (`demo/`, `viva/`, `app/docs/VIVA.md`), `addons.txt`, the
`review-plan/` folder and the exported Tools and Software PDF were taken out of
the working tree so the repository holds only the product, its technical
documentation, the website, the demo videos and the brand. The team table now
lives in the root [`README.md`](../README.md#team).

Nothing was lost: every one of those files is still in git history. Read one
with `git show 95672c2:<path>`, for example
`git show 95672c2:docs/viva/CODE_TO_VIVA_MAP.md`.
