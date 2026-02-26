/** Résolution code postal → communes via geo.api.gouv.fr */

const GEO_API_BASE = "https://geo.api.gouv.fr";

export interface CommuneGeo {
  nom: string;
  code: string; // code INSEE
  codesPostaux: string[];
  population?: number;
}

/** Résout un code postal en liste de communes (un CP peut couvrir plusieurs communes) */
export async function resolveCodePostal(codePostal: string): Promise<CommuneGeo[]> {
  const cp = codePostal.trim().replace(/\s/g, "");
  if (!/^\d{5}$/.test(cp)) {
    throw new Error(`Code postal invalide : "${codePostal}". Format attendu : 5 chiffres.`);
  }

  const url = `${GEO_API_BASE}/communes?codePostal=${cp}&fields=nom,code,codesPostaux,population&format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Erreur API geo.api.gouv.fr : ${response.status}`);
  }

  const communes = (await response.json()) as CommuneGeo[];

  if (!communes.length) {
    throw new Error(`Aucune commune trouvée pour le code postal ${cp}.`);
  }

  // Trier par population décroissante pour prioriser les communes principales
  return communes.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
}
