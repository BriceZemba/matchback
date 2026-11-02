// Judge mode (MATCHBACK_JUDGE_MODE=1): a guide page and one-click sample links on the order page.
// The links are real product pages from the evaluation set (eval/cases.json). The expected outcome is
// what Matchback decided, re-checked on 2026-11-02; live prices and stock can move it.

export function judgeMode(): boolean {
  return process.env.MATCHBACK_JUDGE_MODE === "1";
}

export type SampleLink = { label: string; expect: "refund" | "refused"; why: string; url: string };

export const SAMPLE_LINKS: Record<string, SampleLink[]> = {
  e2dXeQi: [
    { label: "Same SSD at B&H", expect: "refund", why: "Same model, new, in stock, cheaper", url: "https://www.bhphotovideo.com/c/product/1559836-REG/samsung_mu_pc1t0t_am_1tb_t7_portable_ssd.html" },
    { label: "T7 Shield at B&H", expect: "refused", why: "A different, rugged model", url: "https://www.bhphotovideo.com/c/product/1691588-REG/samsung_mu_pe1t0s_am_1tb_t7_shield_portable.html" },
    { label: "T7 kit at B&H", expect: "refused", why: "A bundle with a holder", url: "https://www.bhphotovideo.com/c/product/1851331-REG/samsung_1tb_t7_portable_ssd.html" },
  ],
  nLZKmNT: [
    { label: "Back Market listing", expect: "refused", why: "Refurbished marketplace", url: "https://www.backmarket.com/en-us/p/logitech-mx-master-3s-mouse-wireless/24c32268-7ef8-477f-819f-864825ed84ad" },
    { label: "MX Master 3S for Business", expect: "refused", why: "A different model (910-006581)", url: "https://www.staples.com/logitech-mx-master-3s-wireless-usb-mouse-graphite-910-006581/product_IM102PP56" },
  ],
  muLXXMd: [
    { label: "Same mixer, Black Matte", expect: "refund", why: "Same model in another colour", url: "https://www.kitchenaid.com/countertop-appliances/stand-mixers/tilt-head-stand-mixers/p.artisan-series-5-quart-tilt-head-stand-mixer.KSM150PSBM.html" },
    { label: "Artisan Mini", expect: "refused", why: "3.5 quart, not 5 quart", url: "https://www.kitchenaid.com/p.KSM3316XWH.html" },
  ],
  cTyUOkU: [
    { label: "Signature Edition", expect: "refused", why: "More storage, wireless charging", url: "https://www.target.com/p/amazon-kindle-paperwhite-signature-edition-2024-metallic-black/-/A-93320263" },
    { label: "A Kindle case", expect: "refused", why: "An accessory, not the Kindle", url: "https://www.bestbuy.com/product/amazon-kindle-paperwhite-colorsoft-case-water-safe-fabric-foldable-lightweight-cover-black/J39HW6S586" },
  ],
};
