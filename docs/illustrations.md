# Illustrations (D-126)

Every page shows a soft box labelled with a code (for example **P5**). That code is a row in the tables below: it tells
you which picture goes there and the prompt to make it from. The same pictures serve every school, so none of them
may show a school's name, logo, uniform crest or real people (CLAUDE.md section 7: never generate a school's identity
with AI).

## The style, at the start of every prompt

> Flat vector illustration, soft modern editorial style, clean shapes with subtle gradients and gentle shadows, a
> limited palette of soft blue, lilac, peach, mint green and warm neutrals with dark navy linework. South Asian
> (Nepali) young people and teachers in modest everyday clothing, friendly natural expressions. **Transparent
> background.** **Cropped at the bottom edge**: people are cut at the waist or hips, as if standing behind the frame;
> no ground shadow. The subject faces slightly left, toward the page's words. No text, no letters, no numbers, no
> logos, no badges, no school names, no real people. Plenty of empty space around the subject. The same character
> proportions across the whole series.

## How to add a picture

1. Export it as a transparent WebP at the size in its row (twice the size shown, for sharp screens). Keep each file
   small: about 60 KB for a W picture (public pages have a page-weight budget), about 80 KB for the others.
2. Save it as `apps/web/public/illustrations/<code>.webp`, for example `P5.webp`.
3. Add the code to `ART_READY` in `apps/web/src/ui/art.ts`. The box is then replaced by the picture everywhere it
   appears. Nothing else changes.

## Portal page heroes (P)

The picture stands at the right of the page's top band, cut by its bottom edge. Size: 720 × 600.

| Code | Where it shows | Prompt (after the style) |
|---|---|---|
| **P1** | Overview, Principal (Admin) | A principal at a desk looking at charts on a laptop, calm and confident |
| **P2** | Overview, Student | A student with a backpack waving, books under one arm |
| **P3** | Overview, Teacher | A teacher holding a coffee mug and a stack of notebooks |
| **P4** | Overview, Accountant | An accountant with a calculator and neat paper receipts |
| **P5** | Teaching (People › Teaching, Setup › Teaching) | A female teacher in glasses holding a book and pointing upward with a pointer |
| **P6** | Classes | A row of classroom desks in front of a whiteboard |
| **P7** | Attendance (all its pages) | A teacher ticking a list on a clipboard, a row of students' heads beside her |
| **P8** | Classwork (notes, homework) | An open notebook, a pencil and a homework sheet with a tick |
| **P9** | Results (all its pages) | A student holding up a marks sheet, small stars around it |
| **P10** | Fees (all its pages) | A wallet, coins and a receipt with a tick mark |
| **P11** | Admissions (all its pages) | A new student shaking hands with a co-ordinator |
| **P12** | Approvals | A hand stamping a document with a tick |
| **P13** | People | Four staff members of different ages standing together |
| **P14** | Academic Structure and Setup (courses, subjects, classes, exams, promotion) | Stacked building blocks forming steps |
| **P15** | Academic terms | A large desk calendar with its pages turning |
| **P16** | Reports (activity, sign-ins) | A clipboard with a bar chart and a magnifying glass |
| **P17** | Settings | Gears and toggle switches, a person adjusting one |
| **P18** | Website (content list and editor) | A browser window, a person placing a picture card into it |
| **P19** | Mailbox | An open envelope with letters flying out |
| **P20** | Overview, Co-ordinator | A co-ordinator holding a timetable on a tablet |

## Public website heroes (W)

| Code | Where it shows | Size | Prompt (after the style) |
|---|---|---|---|
| **W1** | Home | 1600 × 1200 | Three college students walking together, one carrying books, one with a backpack, a teacher beside them smiling, a light outline of a campus building behind |
| **W2** | Programmes | 1200 × 900 | Students at a table with a science flask, a calculator and a laptop |
| **W3** | Admission | 1200 × 900 | A student handing a form to a smiling staff member across a desk, a parent beside the student |
| **W4** | Scholarships | 1200 × 900 | A student holding a certificate proudly, a small trophy and books beside them |
| **W5** | Facilities | 1200 × 900 | A computer lab corner and a library shelf, two students using them |
| **W6** | Contact | 1200 × 900 | A friendly receptionist answering a phone, an envelope and a map pin floating nearby |
| **W7** | Notices and updates | 1200 × 900 | A student reading a notice board with pinned papers and a calendar |
| **W8** | Apply online | 1200 × 900 | A student filling in a form on a phone, seated comfortably |
| **W9** | Sign in | 1200 × 900 | A student and a teacher waving hello beside an open door |
| **W10** | Reset password | 800 × 600 | A key and an opening padlock, a relieved student |
| **W11** | Privacy | 800 × 600 | A shield in front of a neat document, a calm person beside it |

## Other places

| Code | Where it shows | Size | Prompt (after the style) |
|---|---|---|---|
| **S1** | The card at the foot of the sidebar (wide screens) | 480 × 540 | A friendly teacher holding a book, upper body, pointing upward |
| **E1** | A list with nothing in it yet | 360 × 300 | An empty open box with a small sparkle (no person) |
| **X2** | A page that could not load | 360 × 300 | An unplugged cable, a patient character holding its end |
