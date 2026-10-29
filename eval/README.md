# Evaluation

Does Matchback pay the claims it should, and refuse the ones it should not? This folder answers that on real retailer pages, against two simpler systems, with every result reproducible from one command.

## What is tested

`cases.json` holds **49 price-match claims** built from real product pages at Best Buy, Target, Walmart, B&H Photo, Back Market, KitchenAid, Bose and others, found by web search on 2026-10-29. Each claim is "I bought product X here; it is cheaper at this link".

- **16 legitimate claims:** the same product, or the same model in another colour, sold new.
- **33 traps:**
  - refurbished listings, including several sold by mainstream retailers that are not resale sites (Target Certified Refurbished, Walmart Restored, Best Buy refurbished, the Bose and KitchenAid refurbished stores);
  - other models (T7 Shield, Kindle Signature Edition, WH-1000XM6, AirPods 4, MX Master 3S for Mac / for Business, Artisan Mini);
  - bundles and accessories.
- **Labels come from what the listing is**, never from Matchback's output. `legit` answers one question: should a price match be paid at all? Price and stock are facts read from Channel3 at run time.
- **15 cases (30%) are held out.** They were run once, after the development set, with no change to Matchback in between.

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

See `results.md` for every case. Totals over all 49 claims:

| System | Unsafe payouts | Money wrongly refunded | Missed legit | Legit paid automatically | Sent to a person |
|---|---|---|---|---|---|
| Matchback | 0 of 33 | $0.00 | 1 | 6 of 16 | 14 |
| Same rules, id only | 0 of 33 | $0.00 | 12 | 2 of 16 | 7 |
| Naive | 15 of 33 | $1,751.86 | 0 | 9 of 16 | 7 |

## Limits

- **Workload:** Matchback sends 14 of 49 claims to a person.
  - 8 of those are pages Channel3 could not read (500 "Product extraction failed" or 404).
  - The other 6 lack a stated condition or a confident identity.
  - Only 6 of 16 legitimate claims are paid with no human step. Several of the rest are correctly refused on price: the competitor was not at least $1 cheaper.
- **AI identity errors, held-out set:**
  - `mx-05`: the MX Master 3S *for Business* edition was classified as the same mouse in another colour. Only the missing-condition rule kept it from being paid; it went to a person.
  - `qc-03`: the same Bose earbuds at Target were classified as a different model. The claim was refused, and would have been anyway, since the price was equal.

  Both are recorded unchanged. Any fix will be tested on new development cases, not on these.
- **Small sample:** 49 claims on 9 products. This shows behaviour on realistic traps, not a population rate.
- **Data drift:** Channel3 answers change over time, which is why the run is frozen, failed lookups included. Before failures were frozen, one system's retry of a just-failed lookup succeeded, so the systems briefly saw different data; the numbers here are from the frozen runs, where all three read identical answers.

## Reproduce

```bash
EVAL=1 EVAL_SPLIT=dev npm run eval
EVAL=1 EVAL_SPLIT=heldout npm run eval
node eval/report.mjs
```

`eval-cache.db` holds the recorded Channel3 answers (failures included) and AI answers. With it, both runs finish in about 2 seconds and reproduce `results.md` exactly. Set `EVAL_CACHE=off` to run against live Channel3 instead; that needs `CHANNEL3_API_KEY` and `GROQ_API_KEY` in `.env`.
