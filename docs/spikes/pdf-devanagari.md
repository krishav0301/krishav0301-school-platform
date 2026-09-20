# Spike: PDF generation with Nepali (Devanagari) text

Date: 2026-09-20. Phase 0. Status: **partial. Engine choice is a working default (D-017); a real PDF viewer check is still owed in Phase 6.**

## Question

Receipts and marks cards need Nepali text, Nepali digits and correct conjuncts. Which route produces that?

## Method

Wrote an HTML page with Devanagari headings, Nepali digits (`१२,५०,०००`), a BS date, and a conjunct and vowel-sign stress line. Printed it two ways with headless **Microsoft Edge (Chromium)**: to PNG and to PDF. Font: Windows' Nirmala UI.

## Findings

1. **On-screen rendering is correct.** All conjuncts (क्ष, त्र, ज्ञ, श्री, द्ध), vowel signs (ि before its consonant), and Nepali digits render properly. Mixed English and Nepali on one line is fine. This was verified visually.
2. **The PDF's hidden text layer is scrambled.** Extracting text from the PDF gives sequences like `स ेक` and `िव ाथ`. This is the usual weakness of PDF text extraction for Indic scripts, not necessarily a rendering fault.
3. **Not verified:** the PDF's drawn glyphs. I could not open the PDF in a viewer from this environment, so the printed output has not been inspected directly. It is expected to match the screen render (same engine), but that is an inference.

## Consequences

- Copy and search inside a generated PDF will be unreliable for Nepali text. The record of truth is the database, never the PDF. Receipts and marks cards are for printing and viewing.
- Every document is generated from stored data on demand, so it can always be regenerated.

## Recommendation (D-017)

Generate documents from HTML templates with a **Chromium-based renderer** (Playwright is already in the test toolchain). The same tokens, fonts and layout that the web app uses then apply to receipts and marks cards, and school branding works automatically. **WeasyPrint** is the fallback (lighter, uses Pango). It needs system libraries that are awkward on Windows.

Host **Noto Sans Devanagari** ourselves and embed it. Never depend on a system font, because the server will not have Nirmala UI.

## Owed before Phase 6

- Open a generated receipt and marks card in an actual PDF viewer (and print one), on Windows and in the Linux container.
- Confirm the Chromium renderer's runtime size and startup time in the deployment image.
- Test with the real embedded font.
