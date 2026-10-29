# Channel3 spike findings (2026-10-28)

First run on the keyless MCP free tier (`https://mcp.trychannel3.com/`), sections 1-2. Re-run on the REST API with a key the same day, section 3. Raw responses are in `out/`.

Scripts:
- `spike.mjs`: search 20 branded products, fetch full detail and 90-day price history, summarise offer fields. Output `out/summary-{mcp,rest}.json`, `out/raw-{mcp,rest}.json`.
- `url-lookup.mjs`: resolve 12 real retailer product URLs (the input a shopper would paste into a claim), including variant, bundle and refurbished traps. Output `out/url-lookup-{mcp,rest}.json`. The raw file of the first MCP run was overwritten by a second MCP run (`out/url-lookup-mcp-run2.json`); the section 2 table comes from the first run's console output.
- `raw-url-test.mjs`: tried to get retailer URLs from Channel3 buy links. Not possible: buy links return a 200 page that redirects with JavaScript (0/20). Kept for the record.

## 1. Catalog search (20 products)

- 20/20 queries returned a product. 45 offers in total, mean 2.25 per product. 9 products had a single offer.
- Every offer had price, availability and domain (45/45). Condition was present on 42/45.
- **The 3 offers with no condition were all on resale sites**: backmarket.com (2) and fromrebel.com (1). On fromrebel.com a Dyson V15 Detect was listed at $399.99, against $849.99 new at two other retailers.
- 8 offers were out of stock, including a $64.99 Instant Pot on home.woot.com against $148.78 in stock at walmart.com.
- 12 offers carried `compare_at_price`.
- 9 products had 2 or more new, in-stock offers. On those, the spread between cheapest and dearest was 10% to 53%.
- The top search hit was not always the product asked for:
  - HERO12 returned HERO13.
  - "Theragun Prime" returned a generic "Percussion Massager".
  - "AirPods Pro 2" returned a bundle.
  - The same product appears under several canonical IDs: Kindle Paperwhite 3 times, Dyson V15 twice. So offers for one real product are spread across IDs.

## 2. Claim URL lookup (12 real retailer URLs)

| Group | Retailer | Result |
|---|---|---|
| Sony XM5 black | bestbuy.com | failed: 500 "Product extraction failed" |
| Sony XM5 silver | bestbuy.com | resolved, $228 |
| Sony XM5 + stand bundle | bestbuy.com | resolved to a different ID (correctly not the plain headphones) |
| Kindle Paperwhite | target.com | resolved to the same ID as the catalog search (cTyUOkU) |
| Kindle Paperwhite Signature | target.com | different ID (correct: different model) |
| Instant Pot Duo 6 qt | walmart.com | failed: 500 |
| Instant Pot Duo Nova refurbished | walmart.com | failed: 404 |
| Samsung T7 1TB | bhphotovideo.com | same ID as catalog search (e2dXeQi) |
| Samsung T7 Shield 1TB | bhphotovideo.com | different ID (correct: different model) |
| MX Master 3S | backmarket.com (refurbished marketplace) | **resolved to the same ID as the new product (nLZKmNT), $123, condition null** |
| KitchenAid Artisan, red | kitchenaid.com | resolved |
| KitchenAid Artisan, black matte | kitchenaid.com | resolved to a **different** ID from the red one, same $499.99 |

- Resolution rate was 9/12. Both walmart.com URLs failed.
- No two different products shared an ID.
- **Condition was null on every URL lookup**, including the Back Market refurbished listing.
- A lookup returns only the offer from the URL's own retailer.
- **Latency on the keyless tier ranged from 4.6 s to 99.7 s per lookup**, so lookups can't run inside a synchronous request.

## What this changes in the design

1. **Channel3 alone would approve a refurbished claim.** The Back Market URL maps to the canonical new product, with no condition. The verifier therefore needs three things:
   - a resale-marketplace domain policy, seeded from the domains seen here (backmarket.com, fromrebel.com), plus woot and similar to be confirmed;
   - treating a missing condition as "not proven new";
   - the AI reading the listing title and description.
   This is the clearest demo moment, and it rests on observed data, not invented data.
2. **Matching on ID alone is not enough.**
   - Colour variants get different IDs (the two KitchenAid colours).
   - The same product gets several IDs (Kindle, Dyson).
   - Bundles and sibling models (T7 vs T7 Shield, Paperwhite vs Signature) get their own IDs, which is correct.
   So identity needs a judgement call: the same model in a different colour usually qualifies, while a bundle or a sibling model does not. This is where the AI earns its place, using title, brand, structured attributes and model numbers. The ablation compares ID-only matching with AI matching.
3. **Lookups fail on some retailers** (both walmart.com URLs). When that happens the claim goes to human review with the reason shown, never auto-approval. An optional fallback is to search by the claimed title restricted to that retailer.
4. **Claims are processed asynchronously.** The status goes "Verifying" → decision, with results cached by URL. The video must not imply instant decisions unless the API-key tier proves faster.
5. **Price on the lookup is live** (the Sony silver showed $228 against a cached $298 snapshot from the web search). The decision should store the Channel3 `as_of` timestamp as evidence.

## 3. REST API re-run (same day, with key)

Catalog search (`out/summary-rest.json`):
- 20/20 resolved, 48 offers. Price, availability and domain on 48/48; condition on 44/48.
- The 4 offers without condition: backmarket.com (3) and newegg.com (1). 12 offers out of stock.
- 7 products had 2+ new in-stock offers, spread 19% to 43%.
- **Search is not stable between runs.** The same queries returned different top products than on MCP: "AirPods Pro 2 USB-C" gave AirPods Max 2 on the second REST run, and "LEGO Millennium Falcon 75257" gave a Pokémon toy. On the other hand, "GoPro HERO12" now returned the HERO12.
- **Price history works.** 18/20 products returned history: 4 to 90 days, with `statistics` {mean, std_dev, min_price, max_price, current_price, current_status}. Status: 16 typical, 1 low (air fryer), 1 high (Samsung T7, $274.99 now vs a $229.99 low). The response field is `history`, not `price_history` as the guide shows.

URL lookup (`out/url-lookup-rest.json`):
- 9/12 resolved. Failures: both Sony XM5 Best Buy reviews URLs (500 "Product extraction failed"; one of them resolved on MCP earlier, so failures are not stable either) and the refurbished Walmart Instant Pot (404). The Walmart Duo 6 qt resolved this time, in 27.2 s.
- Latency: 8 of 9 successful lookups took 0.27 to 1.65 s; the uncached Walmart one 27.2 s; failures took 4 to 38 s.
- **REST lookups return every retailer offer** (3 to 5 per product, against 1 on the MCP lookups in section 2), and condition is filled for new items.
- **The Back Market trap reproduces on REST**: the refurbished MX Master 3S URL maps to the new product's ID nLZKmNT, $123, condition null.
- The two KitchenAid colours still get different IDs (muLXXMd, nHjGjHW), now both $379.99.

What this adds to the design:
6. **Pin the merchant's catalog to fixed Channel3 product IDs**, chosen once when the merchant sets up the catalog, and never search at claim time. Search results changed between runs.
7. **Use price history as context, not as a gate.** The `current_status` (low/typical/high) and the 90-day minimum show the merchant whether the competitor price is a short promotion. The rule ("price-match covers temporary sales or not") is a merchant setting.
8. **Use REST in the app**, with the MCP tier only as a development fallback. It is faster on cached products and returns every offer.

Not tested yet: search filters (`conditions: ["new"]`, `availability`).
