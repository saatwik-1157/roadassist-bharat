# Translation review

Seven of the platform's eight languages were machine-translated and have
**not** been reviewed by native speakers. The docs say so wherever they quote
the language count. These sheets let a native speaker review every string
without reading any code.

| Sheet | What it holds | Strings |
|---|---|---|
| `review-sms-server.csv` | SMS replies a feature phone receives (`app/apps/api/src/i18n.ts`) | 21 |
| `review-web-app.csv` | The citizen web app (`app/apps/web/i18n.js`) | 41 |
| `review-android.csv` | The Android app (`mobile/app/src/main/res/values-*/strings.xml`) | 174 (173 keys; the one plural has a row per form) |

## How to review

1. Open a sheet in Excel or Google Sheets. It is UTF-8, so Indic scripts show
   correctly.
2. Read your language's column next to the English one.
3. In your language's **OK? (Y/N)** column, enter `Y` if the string is correct
   and natural. Otherwise enter `N` and write the fix under **Correction / notes**.
4. Keep every `{placeholder}` exactly as written, for example `{ref}` or
   `{minutes}`. The app fills those in.
5. SMS strings must fit one message: 70 characters in any Indic script, because
   one non-Latin SMS segment holds 70. `i18n.test.ts` enforces this, so a longer
   correction fails the build. Say so in the notes if a correct translation
   cannot fit.
6. Send the sheet back. Corrections are applied to the source files, and the
   language is then marked as reviewed in `app/docs/TESTING.md`.

The sheets are exports: the source files are the truth. After any string
changes, and after a review is applied, run the export again so the sheets
match:

```bash
python docs/translations/export.py
```

It keeps any review answers (the OK? and Correction / notes columns) already
filled in, row by row, so a re-export never loses a reviewer's work.
