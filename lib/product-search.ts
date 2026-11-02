// Store search. Titles are in English while the store speaks three languages, so each product also
// carries the words a shopper would type for it in French, Spanish or English.
const EXTRA_WORDS: Record<string, string> = {
  e2dXeQi: "disque dur externe stockage drive storage disco duro externo almacenamiento",
  nLZKmNT: "souris ratón",
  cTyUOkU: "liseuse livre numérique ebook ereader lector libro electrónico",
  muLXXMd: "robot pâtissier batteur pétrin batidora amasadora",
  dgVgimm: "montre course reloj watch",
  m7BdhGq: "caméra sport vidéo cámara video",
  CBwmyTM: "écouteurs casque headphones auriculares cascos",
  puD6dGn: "mixeur licuadora",
  "12pv9iN": "enceinte haut-parleur altavoz",
  F5Smbri: "bracelet connecté montre santé pulsera reloj watch",
  dSyfEh6: "autocuiseur cocotte minute olla presión",
  D9iEwzZ: "enceinte haut-parleur altavoz",
};

/** Lower case, no accents, split on anything that is not a letter or a digit. */
function wordsOf(text: string): string[] {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function searchTextOf(product: { product_id: string; title: string }): string {
  return `${product.title} ${EXTRA_WORDS[product.product_id] ?? ""}`;
}

/** Every word typed must start a word of the text, so "era" finds the Sonos Era and not a camera. */
export function matchesSearch(text: string, query: string): boolean {
  const words = wordsOf(text);
  return wordsOf(query).every((q) => words.some((w) => w.startsWith(q)));
}
