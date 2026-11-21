# Golden cases for the phone vision tests

`cases.json` holds the 10 reference cases used by `phone/TEST_PLAN.md`. They match the product use: orienting yourself on the offline London map by reading signs and recognising places. Nothing here is downloaded; take the photos by hand on the day. No photo leaves the phone, and none belongs in the repo (`*.jpg` here should stay untracked).

## Taking the photos

1. One photo per case, saved as the case's `file` (for example `street-sign.jpg`), straight from the phone camera. Do not edit, crop, rotate or re-save. Keep EXIF.
2. Case 8 (`rotated`) needs a photo whose EXIF orientation is not 1: hold the phone in landscape or upside down. Write the EXIF value into `ground_truth.exif_orientation` (any EXIF viewer shows it).
3. Fill every `ground_truth` field from what is physically in front of the camera, before any model sees the photo. Do not copy it from a model's answer. Leave "(optional)" fields empty if you cannot measure them.
4. Use the same 10 JPEG files on every device. Check byte equality with `shasum -a 256`.
5. Private people and car number plates must not appear. Photograph signs and buildings.

## Where the files go

- iOS: the app's `Documents/golden/` (Finder file sharing), with `cases.json` and the 10 JPEGs together. `EngineBenchmark` reads `cases.json` and each case's `file`, `id` and `prompt`; the other fields are for the human scorers.
- Spark and Pixel Termux: pass the prompt and a pre-oriented 640 px copy to `llama-mtmd-cli` (commands in `phone/TEST_PLAN.md`).

## Fields

| Field | Meaning |
|---|---|
| `id`, `file` | Case id (goes into the CSV `case_id`) and the JPEG name |
| `description` | What to photograph |
| `prompt` | Exact prompt, identical on every device |
| `ground_truth` | Filled by hand from the scene |
| `expected_key_facts` | What a good answer contains |
| `rubric.must_mention` | Every item must appear (placeholders in braces refer to `ground_truth`) |
| `rubric.must_not` | Any one of these makes the answer unusable |
| `rubric.usable_if` | The decision rule |

## Scoring

Two people read each answer. An answer is usable (1) only when all `must_mention` items hold and no `must_not` item applies; otherwise unusable (0). Spelling slips of one character are accepted, except digits, which must match. Judge the answer against the photo and `ground_truth`, not against another model. Disagreements go to a third person. Record in `scores.csv` (`device,case_id,usable,scorer,notes`). The compare script needs at least 8 of 10 cases usable for a PASS.

Honest uncertainty counts: for `low-light` and `no-info` an explicit "cannot tell" without a guess is the correct answer. A confident wrong place name is never usable.

## Output format

Free text. The benchmark passes `grammar: nil`, so no JSON grammar or schema exists for these cases. The model is told to keep answers to one or two sentences.
