import type { Locale } from "@/lib/i18n";

// The checks are written once, in English, and stored that way: they are the record of the decision. This
// shows them in the shopper's language. The AI's own evidence stays out of the translations (the note above
// the checks already says why, in the right language). Anything not recognised is shown as it was stored.

type Rule = [pattern: RegExp, fr: string, es: string];

const HOW = String.raw`(?:Channel3 catalog id|AI comparison \([^)]*\))`;

const RULES: Rule[] = [
  // Claim window ($1 = days ago, or today / yesterday; the last group is the window)
  [/^Paid today; the window is (\d+) days\.$/, "Payé aujourd'hui ; le délai est de $1 jours.", "Pagado hoy; el plazo es de $1 días."],
  [/^Paid yesterday; the window is (\d+) days\.$/, "Payé hier ; le délai est de $1 jours.", "Pagado ayer; el plazo es de $1 días."],
  [/^Paid (\d+) days ago; the window is (\d+) days\.$/, "Payé il y a $1 jours ; le délai est de $2 jours.", "Pagado hace $1 días; el plazo es de $2 días."],
  // Store
  [/^(\S+) is a resale or refurbished marketplace\.$/, "$1 est un site de revente ou de reconditionné.", "$1 es un sitio de reventa o reacondicionados."],
  [/^(\S+) is on this store's list of price-match competitors\.$/, "$1 figure sur la liste des concurrents de ce magasin.", "$1 está en la lista de competidores de esta tienda."],
  [/^(\S+) is not on this store's list of price-match competitors; a person checks that it is a genuine store\.$/, "$1 ne figure pas sur la liste des concurrents de ce magasin ; une personne vérifie que c'est un vrai magasin.", "$1 no está en la lista de competidores de esta tienda; una persona comprueba que es una tienda real."],
  // Offer
  [/^Channel3 returned no offer from (\S+) for this product\.$/, "Channel3 n'a trouvé aucune offre de $1 pour ce produit.", "Channel3 no encontró ninguna oferta de $1 para este producto."],
  [/^Channel3 could not read that page/, "Channel3 n'a pas pu lire cette page.", "Channel3 no pudo leer esa página."],
  [/^Channel3 lookup failed\.$/, "La recherche Channel3 a échoué.", "La búsqueda en Channel3 falló."],
  [/^The offer's condition is new \(confirmed from Channel3's product record; the page lookup gave none\)\.$/, "L'offre est neuve (confirmé par la fiche produit Channel3 ; la page ne l'indiquait pas).", "La oferta es nueva (confirmado por la ficha de Channel3; la página no lo indicaba)."],
  [/^The offer's condition is new\.$/, "L'offre est neuve.", "La oferta es nueva."],
  [/^The offer's condition is used\.$/, "L'offre est d'occasion.", "La oferta es de segunda mano."],
  [/^The offer's condition is refurbished\.$/, "L'offre est reconditionnée.", "La oferta es reacondicionada."],
  [/^Neither the page lookup nor Channel3's product record states a condition, so it is not proven new\.$/, "Ni la page ni la fiche Channel3 n'indiquent l'état : rien ne prouve que c'est neuf.", "Ni la página ni la ficha de Channel3 indican el estado: no está probado que sea nuevo."],
  [/^The offer is in stock\.$/, "L'offre est en stock.", "La oferta está en stock."],
  [/^The offer is out of stock\.$/, "L'offre est en rupture de stock.", "La oferta está agotada."],
  [/^Availability is unknown\.$/, "La disponibilité est inconnue.", "La disponibilidad es desconocida."],
  [/^Offer is in (\S+), the order in (\S+)\.$/, "L'offre est en $1, la commande en $2.", "La oferta está en $1, el pedido en $2."],
  // Price
  [/^(\$[\d.,]+) there vs (\$[\d.,]+) paid \(difference (\$[\d.,]+)\)\.$/, "$1 là-bas, contre $2 payés (écart de $3).", "$1 allí, frente a $2 pagados (diferencia de $3)."],
  [/^Above the (\d+)% plausibility floor\.$/, "Au-dessus du seuil de plausibilité de $1 %.", "Por encima del umbral de plausibilidad del $1 %."],
  [/^Below (\$[\d.,]+) \((\d+)% of the price paid\); a person should look\.$/, "Sous $1 ($2 % du prix payé) : une personne doit regarder.", "Por debajo de $1 ($2 % del precio pagado): una persona debe revisarlo."],
  // The store's limits
  [/^The (\$[\d.,]+) difference is over this store's cap of (\d+)% of the price paid; a person decides\.$/, "L'écart de $1 dépasse le plafond de ce magasin, $2 % du prix payé : une personne décide.", "La diferencia de $1 supera el tope de esta tienda, el $2 % del precio pagado: decide una persona."],
  [/^This store pays up to (\$[\d.,]+) automatically; a person decides on a (\$[\d.,]+) refund\.$/, "Ce magasin paie automatiquement jusqu'à $1 : une personne décide pour un remboursement de $2.", "Esta tienda paga automáticamente hasta $1: una persona decide sobre un reembolso de $2."],
  // Same product
  [new RegExp(`^Channel3 catalog id: same product\\.`), "Même fiche produit dans le catalogue Channel3.", "Misma ficha de producto en el catálogo de Channel3."],
  [new RegExp(`^${HOW}: same product\\.`), "L'IA confirme qu'il s'agit du même produit.", "La IA confirma que es el mismo producto."],
  [new RegExp(`^${HOW}: same model, different colour\\.`), "Même modèle, dans une autre couleur.", "Mismo modelo, en otro color."],
  [new RegExp(`^${HOW}: not enough information\\.`), "Pas assez d'informations pour le confirmer.", "No hay información suficiente para confirmarlo."],
  [new RegExp(`^${HOW}: different model\\.`), "C'est un autre modèle.", "Es otro modelo."],
  [new RegExp(`^${HOW}: bundle or kit\\.`), "C'est un lot ou un kit, pas le produit seul.", "Es un pack o kit, no el producto solo."],
  [new RegExp(`^${HOW}: accessory or part\\.`), "C'est un accessoire ou une pièce, pas le produit.", "Es un accesorio o una pieza, no el producto."],
  [new RegExp(`^${HOW}: used or refurbished listing\\.`), "C'est une annonce d'occasion ou de reconditionné.", "Es un anuncio de segunda mano o reacondicionado."],
  [/^Product identity could not be established automatically\.$/, "Le produit n'a pas pu être identifié automatiquement.", "El producto no se pudo identificar automáticamente."],
  // Screenshots
  [/^AI read: (.*) \(high confidence\)\.$/, "L'IA a lu : $1 (confiance élevée).", "La IA leyó: $1 (confianza alta)."],
  [/^AI read: (.*) \(medium confidence\)\.$/, "L'IA a lu : $1 (confiance moyenne).", "La IA leyó: $1 (confianza media)."],
  [/^AI read: (.*) \(low confidence\)\.$/, "L'IA a lu : $1 (confiance faible).", "La IA leyó: $1 (confianza baja)."],
  [/^The image says "(.*)"\.$/, "L'image indique « $1 ».", "La imagen indica «$1»."],
  [/^The image shows (\$[\d.,]+); the store's live price matches\.$/, "L'image montre $1 ; le prix actuel du magasin correspond.", "La imagen muestra $1; el precio actual de la tienda coincide."],
  [/^The image shows (\$[\d.,]+); the store's live price is (\$[\d.,]+)\. Matchback always uses the live price\.$/, "L'image montre $1 ; le prix actuel du magasin est $2. Matchback utilise toujours le prix actuel.", "La imagen muestra $1; el precio actual de la tienda es $2. Matchback siempre usa el precio actual."],
  [/^The store could not be identified from the image\.$/, "Le magasin n'a pas pu être identifié sur l'image.", "La tienda no se pudo identificar en la imagen."],
  [/^No live listing at (\S+) was found for this product\.$/, "Aucune offre actuelle de $1 n'a été trouvée pour ce produit.", "No se encontró ninguna oferta actual de $1 para este producto."],
  [/^The closest listing found at (\S+) is "(.*)", which is not the product you bought\. A person will confirm the offer in your screenshot\.?/, "L'offre la plus proche chez $1 est « $2 », qui n'est pas le produit acheté. Une personne vérifiera l'offre de votre capture.", "La oferta más cercana en $1 es «$2», que no es el producto comprado. Una persona comprobará la oferta de tu captura."],
  [/^Your image shows "(.*)", which does not look like the (.*) you bought\. A person will check it\.$/, "Votre image montre « $1 », qui ne ressemble pas au produit acheté ($2). Une personne va vérifier.", "Tu imagen muestra «$1», que no se parece al producto comprado ($2). Una persona lo comprobará."],
  [/^The automatic check could not finish, so a person will look at this claim\.$/, "La vérification automatique n'a pas pu se terminer : une personne va regarder cette demande.", "La comprobación automática no pudo terminar: una persona revisará esta solicitud."],
];

/** The check's text in this language, or null when it has no translation yet. English comes back as stored. */
export function translatedDetail(detail: string, locale: Locale): string | null {
  if (locale === "en") return detail;
  for (const [pattern, fr, es] of RULES) {
    const m = pattern.exec(detail);
    if (m) return (locale === "fr" ? fr : es).replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? "");
  }
  return null;
}

export function checkDetail(detail: string, locale: Locale): string {
  return translatedDetail(detail, locale) ?? detail;
}
