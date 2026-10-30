# Evaluation

Does Matchback pay the claims it should, and refuse the ones it should not? This folder answers that on real retailer pages, against two simpler systems, with every result reproducible from one command.

## What is tested

`cases.json` holds **75 price-match claims** built from real product pages at Best Buy, Target, Walmart, B&H Photo, Back Market, KitchenAid, Bose and others, found by web search on 2026-10-29. Each claim is "I bought product X here; it is cheaper at this link".

- **23 legitimate claims:** the same product, or the same model in another colour, sold new.
- **52 traps:**
  - refurbished listings, including several sold by mainstream retailers that are not resale sites (Target Certified Refurbished, Walmart Restored, Best Buy refurbished, the Bose and KitchenAid refurbished stores);
  - other models (T7 Shield, Kindle Signature Edition, WH-1000XM6, AirPods 4, MX Master 3S for Mac / for Business, Artisan Mini);
  - bundles and accessories.
- **Labels come from what the listing is**, never from Matchback's output. `legit` answers one question: should a price match be paid at all? Price and stock are facts read from Channel3 at run time.
- **Three sets:**
  - development, 49 cases: used while building;
  - held-out 1, 15 cases: run once blind with version 1, then seen;
  - held-out 2, 11 cases: collected before version 2 was written and run once, blind, with the final version.

## The three systems

| System | What it does |
|---|---|
| **Matchback** | Channel3 page lookup and product record, fixed rules (window, resale site, condition, stock, price, plausibility floor), and AI product identity (Groq `openai/gpt-oss-120b`) when Channel3 ids differ |
| **Same rules, Channel3 id only** | Identical, except two listings count as the same product only when Channel3 gives them the same id. This shows what the AI adds |
| **Naive** | Approves whenever that retailer's offer is at least $1 cheaper. The obvious price-match bot |

All three read the same Channel3 answers.

## How results are graded

| Grade | Meaning |
|---|---|
| correct | A trap refused. Or a legitimate claim paid, or refused only because of a fact (out of stock, not cheaper by $1, below the plausibility floor, outside the window) |
| sent to a person | `needs_review`: safe, but costs the merchant a look |
| unsafe | A claim that should not be paid was paid. The money is counted |
| missed | A legitimate claim refused for a non-factual reason |

## Results

See `results.md` for every case.

**First looks** (each held-out set the only time it was run blind; these are the generalisation numbers):

| Set | Version | Cases | Matchback unsafe | Matchback missed | Matchback sent to a person | Naive unsafe | Naive money wrongly refunded |
|---|---|---|---|---|---|---|---|
| Held-out 1 | v1 | 15 | 0 of 10 | 1 | 7 | 4 of 10 | $518.21 |
| Held-out 2 | v2 (final) | 11 | 0 of 8 | 0 | 2 | 4 of 8 | $534.41 |

**Final version on all 75 claims:**

| System | Unsafe payouts | Money wrongly refunded | Missed legit | Legit paid automatically | Sent to a person |
|---|---|---|---|---|---|
| Matchback | 0 of 52 | $0.00 | 0 | 10 of 23 | 19 |
| Same rules, id only | 0 of 52 | $0.00 | 19 | 2 of 23 | 11 |
| Naive | 22 of 52 | $2,592.25 | 0 | 12 of 23 | 11 |

**Version 1 to version 2.** Version 1 paid one trap on the development set: the MX Master 3S *for Business* edition (`mx-08`, $10.00), which the AI took for the same mouse in another colour; the same mistake on held-out 1 (`mx-05`) was stopped only by the missing-condition rule. Version 2 names editions in the AI's instructions and adds a fixed rule that refuses a "same product" verdict when an edition word (for Business, for Mac, Shield, Mini, Signature Edition…) appears in only one title. Version 2 was then run blind on held-out 2.

## Limits

- **Workload:** the final version sends 19 of 75 claims to a person.
  - 11 of those are pages Channel3 could not read (500 "Product extraction failed", 404 or a timeout).
  - The other 8 lack a stated condition or a confident identity.
  - 10 of 23 legitimate claims are paid with no human step. Several of the rest are correctly refused on price: the competitor was not at least $1 cheaper.
- **AI identity errors:**
  - `qc-03` (held-out 1): the same Bose earbuds at Target were classified as a different model; the claim would have been refused anyway, since the price was equal.
  - `qc-07` (held-out 2): a different Bose model was classified as the same product; it was refused only because the price was not lower. Had that listing been cheaper and stated as new, it would have been paid. This is the open weakness: identity still rests on the AI when titles share no edition word.
- **Small sample:** 75 claims on 9 products. This shows behaviour on realistic traps, not a population rate.
- **Data drift:** Channel3 answers change over time, which is why the run is frozen, failed lookups included. Before failures were frozen, one system's retry of a just-failed lookup succeeded, so the systems briefly saw different data; the numbers here are from the frozen runs, where all three read identical answers.

## Reproduce

```bash
EVAL=1 EVAL_SPLIT=dev npm run eval
EVAL=1 EVAL_SPLIT=heldout npm run eval
EVAL=1 EVAL_SPLIT=heldout2 npm run eval
node eval/report.mjs
```

`eval-cache.db` holds the recorded Channel3 answers (failures included) and AI answers. With it, the runs finish in a few seconds and reproduce `results.md` exactly. Set `EVAL_CACHE=off` to run against live Channel3 instead; that needs `CHANNEL3_API_KEY` and `GROQ_API_KEY` in `.env`. The evaluation always uses its own cache database, never a `DATABASE_URL`.
