import type { Locale } from "@/lib/i18n";

// Text of the "How to use" and "How it works" pages, in the three interface languages.

export type Step = { title: string; body: string; points?: string[] };
export type Qa = { q: string; a: string };

export type HowToUse = {
  meta: string; eyebrow: string; title: string; lede: string;
  shopperTitle: string; shopper: Step[];
  outcomesTitle: string; outcomes: { tone: "ok" | "no" | "wait"; label: string; body: string }[];
  rulesTitle: string; rules: string[];
  storeTitle: string; store: Step[];
  faqTitle: string; faq: Qa[];
  cta: string; ctaWorks: string;
};

export type HowItWorks = {
  meta: string; eyebrow: string; title: string; lede: string;
  flowTitle: string; flow: { tag: string; title: string; body: string }[];
  checksTitle: string; checksLede: string; checks: { name: string; rule: string }[];
  aiTitle: string; aiDoes: string; aiDoesList: string[]; aiDoesNot: string; aiDoesNotList: string[];
  moneyTitle: string; money: string[];
  proofTitle: string; proof: { figure: string; label: string }[]; proofNote: string;
  stackTitle: string; stack: { name: string; role: string }[];
  cta: string; ctaUse: string;
};

const useEn: HowToUse = {
  meta: "How to use Matchback",
  eyebrow: "How to use",
  title: "Found it cheaper? Here is what to do.",
  lede: "Buy with PayPal. If the same product is cheaper at another store within {days} days, tell Matchback, or let it find the drop for you. When the offer checks out, PayPal refunds the difference. You keep the product.",
  shopperTitle: "For shoppers",
  shopper: [
    { title: "Buy with PayPal", body: "Pick a product in the shop and pay with PayPal. This demo runs on the PayPal sandbox: use a sandbox buyer account, no real money moves. PayPal brings you back to your order page." },
    { title: "Send the cheaper offer, three ways", body: "On your order page, under “Found it cheaper?”:", points: [
      "Paste a link to the same product at another store.",
      "Or upload a screenshot or a photo of the price tag. AI reads the store, the product and the price.",
      "Or do nothing: the price watch checks the other stores for you. Press “Check prices now”, or wait for the daily check. When it finds a verified drop, the claim is one click.",
    ] },
    { title: "Read your receipt", body: "Matchback checks the offer in seconds. The receipt lists every check, the evidence, and a short note written by the AI in your language." },
    { title: "Find your orders again", body: "“My orders” in the menu lists the orders placed from this browser, with their claims." },
  ],
  outcomesTitle: "What the receipt can say",
  outcomes: [
    { tone: "ok", label: "Matched", body: "Every check passed. PayPal refunds the difference to your PayPal account, usually within seconds." },
    { tone: "no", label: "Refused", body: "The offer does not qualify: another model, refurbished, out of stock, not cheaper… The receipt says which check failed and why." },
    { tone: "wait", label: "For review", body: "Something could not be proven automatically (the page could not be read, no condition stated, an unknown store). A person at the store looks at it; nothing is charged or refunded until then." },
  ],
  rulesTitle: "What qualifies",
  rules: [
    "The same model as the one you bought. Another colour is fine; another edition, size, generation, a bundle or an accessory is not.",
    "Sold new and in stock.",
    "At a store on the shop's list of competitors, or the brand's own store. Resale and refurbished marketplaces are excluded.",
    "At least {minDiff} cheaper than what you paid, in the same currency.",
    "Within {days} days of your payment.",
    "One price-match refund per order, up to half the price paid. The refund always uses the store's live price, never the price in a screenshot.",
  ],
  storeTitle: "For the store",
  store: [
    { title: "Open the store desk", body: "“Store desk” in the menu, signed in with the merchant key. Judges: the key is in the Devpost testing instructions." },
    { title: "Decide the claims sent to a person", body: "Each one shows why it came to you, the offer, the screenshot and the note the shopper saw. Approve with a refund amount (suggested: the gap to the offer) or refuse with a note. The shopper's receipt updates in their language." },
    { title: "Watch the numbers", body: "Claims, the share decided automatically, money refunded, sales kept, the most-claimed stores and every decision. The same data is available as JSON for the merchant console." },
  ],
  faqTitle: "Questions",
  faq: [
    { q: "Is this real money?", a: "No. Payments and refunds run on the PayPal sandbox, PayPal's test environment." },
    { q: "Why was my claim refused?", a: "The receipt names the check that failed, with the evidence: for example “Same product: different model” or “In stock: the offer is out of stock”." },
    { q: "Can I claim twice?", a: "You can send up to 10 claims per order, but only one is refunded. Buy again to try another approved claim." },
    { q: "Does the AI decide the refund?", a: "No. The AI reads screenshots, judges whether two listings are the same product and writes the note. Fixed rules decide, and any doubt goes to a person." },
    { q: "What happens to my screenshot?", a: "It is stored with the claim so the store can review it, and shown only on that claim's pages and to the store. It is deleted after 60 days." },
  ],
  cta: "Go to the shop",
  ctaWorks: "How it works",
};

const useFr: HowToUse = {
  meta: "Utiliser Matchback",
  eyebrow: "Mode d'emploi",
  title: "Vu moins cher ? Voici comment faire.",
  lede: "Payez avec PayPal. Si le même produit est moins cher dans un autre magasin dans les {days} jours, dites-le à Matchback, ou laissez-le trouver la baisse pour vous. Si l'offre est vérifiée, PayPal vous rembourse la différence. Vous gardez le produit.",
  shopperTitle: "Pour les clients",
  shopper: [
    { title: "Payez avec PayPal", body: "Choisissez un produit et payez avec PayPal. Cette démo tourne sur le sandbox PayPal : utilisez un compte acheteur sandbox, aucun argent réel ne circule. PayPal vous ramène à la page de votre commande." },
    { title: "Envoyez l'offre moins chère, de trois façons", body: "Sur la page de votre commande, sous « Vu moins cher ? » :", points: [
      "Collez le lien du même produit dans un autre magasin.",
      "Ou envoyez une capture d'écran ou une photo de l'étiquette. L'IA lit le magasin, le produit et le prix.",
      "Ou ne faites rien : la veille des prix surveille les autres magasins pour vous. Appuyez sur « Vérifier les prix », ou attendez la vérification quotidienne. Quand elle trouve une baisse vérifiée, la demande se fait en un clic.",
    ] },
    { title: "Lisez votre reçu", body: "Matchback vérifie l'offre en quelques secondes. Le reçu liste chaque contrôle, les preuves et une courte note écrite par l'IA dans votre langue." },
    { title: "Retrouvez vos commandes", body: "« Mes commandes » dans le menu liste les commandes passées depuis ce navigateur, avec leurs demandes." },
  ],
  outcomesTitle: "Ce que peut dire le reçu",
  outcomes: [
    { tone: "ok", label: "Aligné", body: "Tous les contrôles sont passés. PayPal rembourse la différence sur votre compte PayPal, en général en quelques secondes." },
    { tone: "no", label: "Refusé", body: "L'offre ne remplit pas les conditions : autre modèle, reconditionné, en rupture, pas moins cher… Le reçu indique quel contrôle a échoué et pourquoi." },
    { tone: "wait", label: "À vérifier", body: "Quelque chose n'a pas pu être prouvé automatiquement (page illisible, état non indiqué, magasin inconnu). Une personne du magasin regarde ; rien n'est débité ni remboursé d'ici là." },
  ],
  rulesTitle: "Ce qui est accepté",
  rules: [
    "Le même modèle que celui acheté. Une autre couleur est acceptée ; une autre édition, taille, génération, un lot ou un accessoire ne l'est pas.",
    "Vendu neuf et en stock.",
    "Dans un magasin de la liste des concurrents de la boutique, ou le magasin officiel de la marque. Les places de marché d'occasion et de reconditionné sont exclues.",
    "Au moins {minDiff} moins cher que le prix payé, dans la même devise.",
    "Dans les {days} jours suivant le paiement.",
    "Un seul remboursement par commande, jusqu'à la moitié du prix payé. Le remboursement utilise toujours le prix en ligne du magasin, jamais celui d'une capture.",
  ],
  storeTitle: "Pour le magasin",
  store: [
    { title: "Ouvrez l'espace magasin", body: "« Espace magasin » dans le menu, avec la clé marchand. Jury : la clé est dans les instructions de test Devpost." },
    { title: "Décidez des demandes confiées à une personne", body: "Chacune montre pourquoi elle vous revient, l'offre, la capture et la note vue par le client. Acceptez avec un montant (proposé : l'écart avec l'offre) ou refusez avec une note. Le reçu du client se met à jour dans sa langue." },
    { title: "Suivez les chiffres", body: "Demandes, part décidée automatiquement, montants remboursés, ventes conservées, magasins les plus cités et toutes les décisions. Les mêmes données existent en JSON pour la console marchand." },
  ],
  faqTitle: "Questions",
  faq: [
    { q: "Est-ce de l'argent réel ?", a: "Non. Paiements et remboursements passent par le sandbox PayPal, l'environnement de test de PayPal." },
    { q: "Pourquoi ma demande a-t-elle été refusée ?", a: "Le reçu nomme le contrôle qui a échoué, avec la preuve : par exemple « Même produit : modèle différent » ou « En stock : l'offre est en rupture »." },
    { q: "Puis-je faire plusieurs demandes ?", a: "Jusqu'à 10 par commande, mais une seule est remboursée. Recommandez pour essayer une autre demande acceptée." },
    { q: "Est-ce l'IA qui décide du remboursement ?", a: "Non. L'IA lit les captures, juge si deux annonces sont le même produit et écrit la note. Des règles fixes décident, et tout doute part chez une personne." },
    { q: "Que devient ma capture d'écran ?", a: "Elle est gardée avec la demande pour que le magasin puisse la vérifier, et n'est affichée que sur les pages de cette demande et au magasin. Elle est supprimée après 60 jours." },
  ],
  cta: "Aller à la boutique",
  ctaWorks: "Comment ça marche",
};

const useEs: HowToUse = {
  meta: "Cómo usar Matchback",
  eyebrow: "Cómo usarlo",
  title: "¿Lo viste más barato? Esto es lo que hay que hacer.",
  lede: "Paga con PayPal. Si el mismo producto está más barato en otra tienda en los {days} días siguientes, díselo a Matchback, o deja que encuentre la bajada por ti. Si la oferta se verifica, PayPal te reembolsa la diferencia. Te quedas con el producto.",
  shopperTitle: "Para clientes",
  shopper: [
    { title: "Compra con PayPal", body: "Elige un producto y paga con PayPal. Esta demo funciona en el sandbox de PayPal: usa una cuenta de comprador sandbox, no se mueve dinero real. PayPal te devuelve a la página de tu pedido." },
    { title: "Envía la oferta más barata, de tres maneras", body: "En la página de tu pedido, en «¿Lo viste más barato?»:", points: [
      "Pega el enlace del mismo producto en otra tienda.",
      "O sube una captura de pantalla o una foto de la etiqueta. La IA lee la tienda, el producto y el precio.",
      "O no hagas nada: la vigilancia de precios revisa las otras tiendas por ti. Pulsa «Comprobar precios» o espera la revisión diaria. Cuando encuentra una bajada verificada, la solicitud es un clic.",
    ] },
    { title: "Lee tu recibo", body: "Matchback comprueba la oferta en segundos. El recibo muestra cada comprobación, las pruebas y una nota breve escrita por la IA en tu idioma." },
    { title: "Vuelve a tus pedidos", body: "«Mis pedidos» en el menú muestra los pedidos hechos desde este navegador, con sus solicitudes." },
  ],
  outcomesTitle: "Lo que puede decir el recibo",
  outcomes: [
    { tone: "ok", label: "Igualado", body: "Todas las comprobaciones pasaron. PayPal reembolsa la diferencia en tu cuenta PayPal, normalmente en segundos." },
    { tone: "no", label: "Rechazado", body: "La oferta no cumple: otro modelo, reacondicionado, agotado, no más barato… El recibo dice qué comprobación falló y por qué." },
    { tone: "wait", label: "En revisión", body: "Algo no se pudo probar automáticamente (página ilegible, estado no indicado, tienda desconocida). Una persona de la tienda lo revisa; mientras tanto no se cobra ni se reembolsa nada." },
  ],
  rulesTitle: "Qué cumple",
  rules: [
    "El mismo modelo que compraste. Otro color vale; otra edición, tamaño, generación, un pack o un accesorio no.",
    "Vendido nuevo y en stock.",
    "En una tienda de la lista de competidores de la tienda, o en la tienda oficial de la marca. Se excluyen los mercados de segunda mano y reacondicionados.",
    "Al menos {minDiff} más barato que lo que pagaste, en la misma moneda.",
    "En los {days} días siguientes a tu pago.",
    "Un reembolso por pedido, hasta la mitad del precio pagado. El reembolso usa siempre el precio en línea de la tienda, nunca el de una captura.",
  ],
  storeTitle: "Para la tienda",
  store: [
    { title: "Abre el panel de la tienda", body: "«Panel de la tienda» en el menú, con la clave de comerciante. Jurado: la clave está en las instrucciones de prueba de Devpost." },
    { title: "Decide las solicitudes que pasan a una persona", body: "Cada una muestra por qué te llega, la oferta, la captura y la nota que vio el cliente. Aprueba con un importe (sugerido: la diferencia con la oferta) o rechaza con una nota. El recibo del cliente se actualiza en su idioma." },
    { title: "Sigue las cifras", body: "Solicitudes, parte decidida automáticamente, dinero reembolsado, ventas conservadas, tiendas más citadas y todas las decisiones. Los mismos datos están en JSON para la consola del comerciante." },
  ],
  faqTitle: "Preguntas",
  faq: [
    { q: "¿Es dinero real?", a: "No. Pagos y reembolsos van por el sandbox de PayPal, el entorno de pruebas de PayPal." },
    { q: "¿Por qué se rechazó mi solicitud?", a: "El recibo indica la comprobación que falló, con la prueba: por ejemplo «Mismo producto: modelo diferente» o «En stock: la oferta está agotada»." },
    { q: "¿Puedo reclamar dos veces?", a: "Puedes enviar hasta 10 solicitudes por pedido, pero solo se reembolsa una. Compra de nuevo para probar otra solicitud aprobada." },
    { q: "¿La IA decide el reembolso?", a: "No. La IA lee las capturas, juzga si dos anuncios son el mismo producto y escribe la nota. Deciden reglas fijas, y cualquier duda pasa a una persona." },
    { q: "¿Qué pasa con mi captura?", a: "Se guarda con la solicitud para que la tienda pueda revisarla, y solo se muestra en las páginas de esa solicitud y a la tienda. Se borra a los 60 días." },
  ],
  cta: "Ir a la tienda",
  ctaWorks: "Cómo funciona",
};

const worksEn: HowItWorks = {
  meta: "How Matchback works",
  eyebrow: "How it works",
  title: "An agent that pays the true claims and refuses the fake ones",
  lede: "A price match is cheaper for a store than a return: it keeps the sale for the cost of the difference. The hard part is paying only the claims that are true. Matchback reads the offer, checks it against fixed rules, and pays through PayPal. When it cannot prove something, a person decides.",
  flowTitle: "From claim to refund",
  flow: [
    { tag: "1 · Read", title: "Read the offer", body: "A pasted link is looked up with Channel3: price, stock, condition, seller and 90-day price history. A screenshot is read by AI vision, then Channel3 finds that store's live listing. The price watch reads every store's offer for the product." },
    { tag: "2 · Compare", title: "Same product?", body: "When the listing is not the exact catalog product, AI compares the two: same model, another colour, another edition, a bundle, an accessory or a refurbished unit. Fixed rules overrule it when an edition word, a generation or a model year disagrees." },
    { tag: "3 · Check", title: "Seven fixed checks", body: "Claim window, known store, sold new, in stock, lower price, plausible price, same product. Each check passes, fails or needs a person." },
    { tag: "4 · Pay", title: "PayPal refunds the difference", body: "On the original payment, through the PayPal Payments API. Then Matchback reads the refund back from PayPal with separate calls." },
    { tag: "5 · Explain", title: "A receipt for every claim", body: "Every check, the evidence and a note written by AI in the shopper's language. Claims with any doubt go to the store desk for a person to decide." },
  ],
  checksTitle: "The seven checks",
  checksLede: "Fail = refused. Doubt = sent to a person. Only a claim that passes all seven is paid.",
  checks: [
    { name: "Claim window", rule: "Within {days} days of payment." },
    { name: "Known store", rule: "On the list of competitors, or the brand's own store. Resale marketplaces fail; unknown shops go to a person." },
    { name: "Sold new", rule: "Condition stated as new; a missing condition is checked against a second Channel3 source first." },
    { name: "In stock", rule: "The offer is available now." },
    { name: "Lower price", rule: "At least {minDiff} cheaper, same currency." },
    { name: "Plausible price", rule: "Under {floor}% of the price paid goes to a person: likely an error or a trap." },
    { name: "Same product", rule: "AI verdict, overruled by fixed rules on editions, generations and model years." },
  ],
  aiTitle: "Where the AI is, and where it is not",
  aiDoes: "The AI does",
  aiDoesList: [
    "Read screenshots and photos of price tags: store, product, price, condition words.",
    "Judge whether two listings are the same product.",
    "Write each receipt's note in English, French or Spanish.",
  ],
  aiDoesNot: "The AI never",
  aiDoesNotList: [
    "Decides an amount or sends money: fixed rules and the PayPal guards do.",
    "Takes the price from a screenshot: the refund uses the store's live price.",
    "Decides alone when unsure: no AI answer, or a doubtful one, sends the claim to a person.",
  ],
  moneyTitle: "How money is kept safe",
  money: [
    "Every PayPal write is recorded before it is sent; its key is also the PayPal-Request-Id, so a retry can never pay twice.",
    "One price-match refund per payment, up to half the price paid, never more than what is left on the payment.",
    "An unknown outcome is settled by reading the order back from PayPal; claims left unfinished by a crash are retried under a lock.",
    "Every refund is read back from PayPal with separate calls and linked to its claim.",
  ],
  proofTitle: "Tested on real listings",
  proof: [
    { figure: "75", label: "real claims built from live product pages, 52 of them traps" },
    { figure: "$0.00", label: "wrongly refunded by Matchback" },
    { figure: "$2,592.25", label: "wrongly refunded by a naive “approve if cheaper” bot on the same claims" },
    { figure: "0 of 18", label: "traps paid on held-out sets run once, blind" },
  ],
  proofNote: "Refunds also verified end to end on this hosted demo: $54.00 from the price watch and $44.98 from a pasted link, each a few seconds after the claim.",
  stackTitle: "Built with",
  stack: [
    { name: "PayPal", role: "Orders v2 (create, capture) and Payments (refund, read-back), through the TypeScript SDK generated by APIMatic" },
    { name: "Channel3", role: "Product lookup from any store link, every store's offer, condition, stock, price history, text and image search" },
    { name: "AI", role: "Groq (gpt-oss-120b for identity and notes, a Qwen vision model for screenshots), Google Gemini as fallback" },
    { name: "App", role: "Next.js, React and TypeScript on Vercel, with Supabase Postgres" },
  ],
  cta: "Try it in the shop",
  ctaUse: "How to use",
};

const worksFr: HowItWorks = {
  meta: "Comment marche Matchback",
  eyebrow: "Comment ça marche",
  title: "Un agent qui paie les vraies demandes et refuse les fausses",
  lede: "Pour un magasin, aligner son prix coûte moins cher qu'un retour : il garde la vente pour le prix de la différence. Le plus dur est de ne payer que les demandes vraies. Matchback lit l'offre, la vérifie avec des règles fixes et paie via PayPal. Quand il ne peut pas prouver quelque chose, une personne décide.",
  flowTitle: "De la demande au remboursement",
  flow: [
    { tag: "1 · Lire", title: "Lire l'offre", body: "Un lien collé est lu avec Channel3 : prix, stock, état, vendeur et historique de prix sur 90 jours. Une capture est lue par l'IA (vision), puis Channel3 trouve l'annonce en ligne de ce magasin. La veille des prix lit l'offre de chaque magasin pour le produit." },
    { tag: "2 · Comparer", title: "Même produit ?", body: "Quand l'annonce n'est pas exactement le produit du catalogue, l'IA compare les deux : même modèle, autre couleur, autre édition, lot, accessoire ou reconditionné. Des règles fixes la contredisent quand un mot d'édition, une génération ou une année de modèle ne concorde pas." },
    { tag: "3 · Vérifier", title: "Sept contrôles fixes", body: "Délai, magasin connu, vendu neuf, en stock, prix plus bas, prix plausible, même produit. Chaque contrôle passe, échoue ou demande une personne." },
    { tag: "4 · Payer", title: "PayPal rembourse la différence", body: "Sur le paiement d'origine, via l'API Payments de PayPal. Puis Matchback relit le remboursement chez PayPal avec d'autres appels." },
    { tag: "5 · Expliquer", title: "Un reçu pour chaque demande", body: "Chaque contrôle, les preuves et une note écrite par l'IA dans la langue du client. Les demandes avec le moindre doute vont à l'espace magasin, où une personne décide." },
  ],
  checksTitle: "Les sept contrôles",
  checksLede: "Échec = refusé. Doute = envoyé à une personne. Seule une demande qui passe les sept est payée.",
  checks: [
    { name: "Délai", rule: "Dans les {days} jours suivant le paiement." },
    { name: "Magasin connu", rule: "Dans la liste des concurrents, ou le magasin officiel de la marque. Les places de marché d'occasion échouent ; les boutiques inconnues vont à une personne." },
    { name: "Vendu neuf", rule: "État indiqué neuf ; un état manquant est d'abord vérifié dans une seconde source Channel3." },
    { name: "En stock", rule: "L'offre est disponible maintenant." },
    { name: "Prix plus bas", rule: "Au moins {minDiff} moins cher, même devise." },
    { name: "Prix plausible", rule: "Moins de {floor} % du prix payé part chez une personne : sans doute une erreur ou un piège." },
    { name: "Même produit", rule: "Verdict de l'IA, contredit par des règles fixes sur les éditions, générations et années de modèle." },
  ],
  aiTitle: "Où est l'IA, et où elle n'est pas",
  aiDoes: "L'IA",
  aiDoesList: [
    "Lit les captures et photos d'étiquettes : magasin, produit, prix, mots sur l'état.",
    "Juge si deux annonces sont le même produit.",
    "Écrit la note de chaque reçu en anglais, français ou espagnol.",
  ],
  aiDoesNot: "L'IA ne fait jamais",
  aiDoesNotList: [
    "Décider d'un montant ni envoyer d'argent : ce sont les règles fixes et les garde-fous PayPal.",
    "Prendre le prix d'une capture : le remboursement utilise le prix en ligne du magasin.",
    "Décider seule en cas de doute : pas de réponse de l'IA, ou une réponse douteuse, et la demande part chez une personne.",
  ],
  moneyTitle: "Comment l'argent est protégé",
  money: [
    "Chaque écriture PayPal est enregistrée avant d'être envoyée ; sa clé sert aussi de PayPal-Request-Id, donc une nouvelle tentative ne peut jamais payer deux fois.",
    "Un seul remboursement par paiement, jusqu'à la moitié du prix payé, jamais plus que ce qui reste sur le paiement.",
    "Un résultat inconnu est tranché en relisant la commande chez PayPal ; les demandes laissées en plan par un crash sont relancées sous verrou.",
    "Chaque remboursement est relu chez PayPal avec d'autres appels et relié à sa demande.",
  ],
  proofTitle: "Testé sur de vraies annonces",
  proof: [
    { figure: "75", label: "vraies demandes construites à partir de pages produit en ligne, dont 52 pièges" },
    { figure: "0,00 $", label: "remboursés à tort par Matchback" },
    { figure: "2 592,25 $", label: "remboursés à tort par un bot naïf « accepter si moins cher » sur les mêmes demandes" },
    { figure: "0 sur 18", label: "pièges payés sur des jeux réservés, lancés une seule fois à l'aveugle" },
  ],
  proofNote: "Remboursements vérifiés de bout en bout sur cette démo en ligne : 54,00 $ via la veille des prix et 44,98 $ via un lien collé, chacun quelques secondes après la demande.",
  stackTitle: "Construit avec",
  stack: [
    { name: "PayPal", role: "Orders v2 (création, capture) et Payments (remboursement, relecture), via le SDK TypeScript généré par APIMatic" },
    { name: "Channel3", role: "Lecture d'un produit depuis n'importe quel lien, offres de chaque magasin, état, stock, historique de prix, recherche texte et image" },
    { name: "IA", role: "Groq (gpt-oss-120b pour l'identité et les notes, un modèle de vision Qwen pour les captures), Google Gemini en secours" },
    { name: "Appli", role: "Next.js, React et TypeScript sur Vercel, avec Supabase Postgres" },
  ],
  cta: "Essayer dans la boutique",
  ctaUse: "Mode d'emploi",
};

const worksEs: HowItWorks = {
  meta: "Cómo funciona Matchback",
  eyebrow: "Cómo funciona",
  title: "Un agente que paga las solicitudes reales y rechaza las falsas",
  lede: "Para una tienda, igualar un precio cuesta menos que una devolución: conserva la venta por el coste de la diferencia. Lo difícil es pagar solo las solicitudes reales. Matchback lee la oferta, la comprueba con reglas fijas y paga con PayPal. Cuando no puede probar algo, decide una persona.",
  flowTitle: "De la solicitud al reembolso",
  flow: [
    { tag: "1 · Leer", title: "Leer la oferta", body: "Un enlace pegado se consulta con Channel3: precio, stock, estado, vendedor e historial de precios de 90 días. Una captura la lee la IA (visión) y luego Channel3 encuentra el anuncio en línea de esa tienda. La vigilancia de precios lee la oferta de cada tienda para el producto." },
    { tag: "2 · Comparar", title: "¿El mismo producto?", body: "Cuando el anuncio no es exactamente el producto del catálogo, la IA compara ambos: mismo modelo, otro color, otra edición, un pack, un accesorio o un reacondicionado. Reglas fijas la corrigen cuando no coinciden una palabra de edición, una generación o un año de modelo." },
    { tag: "3 · Comprobar", title: "Siete comprobaciones fijas", body: "Plazo, tienda conocida, vendido nuevo, en stock, precio más bajo, precio plausible, mismo producto. Cada una pasa, falla o necesita a una persona." },
    { tag: "4 · Pagar", title: "PayPal reembolsa la diferencia", body: "Sobre el pago original, con la API Payments de PayPal. Después Matchback vuelve a leer el reembolso en PayPal con otras llamadas." },
    { tag: "5 · Explicar", title: "Un recibo para cada solicitud", body: "Cada comprobación, las pruebas y una nota escrita por la IA en el idioma del cliente. Las solicitudes con cualquier duda van al panel de la tienda, donde decide una persona." },
  ],
  checksTitle: "Las siete comprobaciones",
  checksLede: "Falla = rechazada. Duda = pasa a una persona. Solo se paga una solicitud que supera las siete.",
  checks: [
    { name: "Plazo", rule: "En los {days} días siguientes al pago." },
    { name: "Tienda conocida", rule: "En la lista de competidores, o la tienda oficial de la marca. Los mercados de segunda mano fallan; las tiendas desconocidas pasan a una persona." },
    { name: "Vendido nuevo", rule: "Estado indicado como nuevo; un estado ausente se comprueba antes en una segunda fuente de Channel3." },
    { name: "En stock", rule: "La oferta está disponible ahora." },
    { name: "Precio más bajo", rule: "Al menos {minDiff} más barato, misma moneda." },
    { name: "Precio plausible", rule: "Por debajo del {floor} % del precio pagado pasa a una persona: probablemente un error o una trampa." },
    { name: "Mismo producto", rule: "Veredicto de la IA, corregido por reglas fijas sobre ediciones, generaciones y años de modelo." },
  ],
  aiTitle: "Dónde está la IA, y dónde no",
  aiDoes: "La IA",
  aiDoesList: [
    "Lee capturas y fotos de etiquetas: tienda, producto, precio, palabras sobre el estado.",
    "Juzga si dos anuncios son el mismo producto.",
    "Escribe la nota de cada recibo en inglés, francés o español.",
  ],
  aiDoesNot: "La IA nunca",
  aiDoesNotList: [
    "Decide un importe ni envía dinero: lo hacen las reglas fijas y las protecciones de PayPal.",
    "Toma el precio de una captura: el reembolso usa el precio en línea de la tienda.",
    "Decide sola si hay duda: sin respuesta de la IA, o con una dudosa, la solicitud pasa a una persona.",
  ],
  moneyTitle: "Cómo se protege el dinero",
  money: [
    "Cada escritura en PayPal se registra antes de enviarse; su clave es también el PayPal-Request-Id, así que un reintento nunca puede pagar dos veces.",
    "Un reembolso por pago, hasta la mitad del precio pagado, nunca más de lo que queda en el pago.",
    "Un resultado desconocido se resuelve volviendo a leer el pedido en PayPal; las solicitudes que un fallo dejó a medias se reintentan con un bloqueo.",
    "Cada reembolso se vuelve a leer en PayPal con otras llamadas y se vincula a su solicitud.",
  ],
  proofTitle: "Probado con anuncios reales",
  proof: [
    { figure: "75", label: "solicitudes reales creadas con páginas de producto en línea, 52 de ellas trampas" },
    { figure: "0,00 $", label: "reembolsados por error por Matchback" },
    { figure: "2.592,25 $", label: "reembolsados por error por un bot ingenuo «aprobar si es más barato» con las mismas solicitudes" },
    { figure: "0 de 18", label: "trampas pagadas en conjuntos reservados, ejecutados una sola vez a ciegas" },
  ],
  proofNote: "Reembolsos verificados de principio a fin en esta demo en línea: 54,00 $ con la vigilancia de precios y 44,98 $ con un enlace pegado, cada uno pocos segundos después de la solicitud.",
  stackTitle: "Hecho con",
  stack: [
    { name: "PayPal", role: "Orders v2 (crear, capturar) y Payments (reembolso, relectura), con el SDK de TypeScript generado por APIMatic" },
    { name: "Channel3", role: "Lectura de un producto desde cualquier enlace, ofertas de cada tienda, estado, stock, historial de precios, búsqueda por texto e imagen" },
    { name: "IA", role: "Groq (gpt-oss-120b para la identidad y las notas, un modelo de visión Qwen para las capturas), Google Gemini como respaldo" },
    { name: "App", role: "Next.js, React y TypeScript en Vercel, con Supabase Postgres" },
  ],
  cta: "Probar en la tienda",
  ctaUse: "Cómo usarlo",
};

/** The guides state the store's own rules: fills {days}, {floor} and {minDiff} from its settings. */
export function withStoreRules<T>(guide: T, locale: Locale, rules: { windowDays: number; floorShare: number; minDiffCents: number }): T {
  const amount = (rules.minDiffCents / 100).toFixed(2);
  const values: Record<string, string> = {
    "{days}": String(rules.windowDays),
    "{floor}": String(Math.round(rules.floorShare * 100)),
    "{minDiff}": locale === "en" ? `$${amount}` : `${amount.replace(".", ",")} $`,
  };
  return JSON.parse(JSON.stringify(guide).replace(/\{(days|floor|minDiff)\}/g, (m) => values[m]!)) as T;
}

export function howToUse(locale: Locale): HowToUse {
  return locale === "fr" ? useFr : locale === "es" ? useEs : useEn;
}

export function howItWorks(locale: Locale): HowItWorks {
  return locale === "fr" ? worksFr : locale === "es" ? worksEs : worksEn;
}
