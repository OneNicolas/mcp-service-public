import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
const DS_LYCEE_PRO = "fr-en-inserjeunes-lycee_pro";
const DS_FORMATION_FINE = "fr-en-inserjeunes-lycee_pro-formation-fine";

interface ConsulterInsertionArgs {
  recherche?: string;
  uai?: string;
  ville?: string;
  code_departement?: string;
  type_diplome?: string;
  limit?: number;
}

interface EtablissementInsertion {
  uai: string;
  libelle: string;
  region: string;
  annee: string;
  tauxPoursuiteEtudes: number | null;
  tauxEmploi6Mois: number | null;
  tauxEmploi6MoisAttendu: number | null;
  vaEmploi6Mois: number | null;
  partPoursuite: number | null;
  partEmploi: number | null;
  partAutres: number | null;
}

interface FormationInsertion {
  typeDiplome: string;
  libelleFormation: string;
  tauxPoursuiteEtudes: number | null;
  tauxEmploi6Mois: number | null;
  tauxEmploi12Mois: number | null;
  tauxEmploi24Mois: number | null;
}

export async function consulterInsertionProfessionnelle(args: ConsulterInsertionArgs): Promise<ToolResult> {
  try {
    const maxResults = Math.min(args.limit ?? 5, 10);

    // Recherche par UAI : fiche detaillee avec formations
    if (args.uai) {
      return await fetchFicheEtablissement(args.uai.trim().toUpperCase(), args.type_diplome);
    }

    // Recherche multi-etablissements
    const filters = buildSearchFilters(args);
    if (!filters) {
      return {
        content: [{ type: "text", text: "Precisez un nom d'etablissement, une ville, un code departement ou un UAI." }],
        isError: true,
      };
    }

    return await fetchListeEtablissements(filters, maxResults);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur insertion professionnelle : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

/** Construit les filtres ODSQL pour la recherche multi-etablissements */
function buildSearchFilters(args: ConsulterInsertionArgs): string | null {
  const parts: string[] = [];

  // Derniere annee disponible, filtre "ensemble" (pas sous-population)
  parts.push("dont_apprentis_eple='ensemble'");

  if (args.recherche) {
    parts.push(`search(libelle, '${sanitize(args.recherche)}')`);
  }

  if (args.ville) {
    parts.push(`search(libelle, '${sanitize(args.ville)}')`);
  }

  if (args.code_departement) {
    // UAI commence par 0 + code dept (ex: 069xxxx pour dept 69)
    const dept = sanitize(args.code_departement).padStart(2, "0");
    parts.push(`startswith(uai, '0${dept}')`);
  }

  // Au moins un critere de localisation/recherche
  if (!args.recherche && !args.ville && !args.code_departement) {
    return null;
  }

  return parts.join(" AND ");
}

/** Liste d'etablissements avec indicateurs globaux */
async function fetchListeEtablissements(where: string, limit: number): Promise<ToolResult> {
  const params = new URLSearchParams({
    select: "uai, libelle, region, annee, taux_poursuite_etudes, taux_emploi_6_mois, taux_emploi_6_mois_attendu, va_emploi_6_mois, part_en_poursuite_d_etudes, part_en_emploi_6_mois_apres_la_sortie, part_des_autres_situations",
    where,
    order_by: "annee DESC, va_emploi_6_mois DESC",
    limit: String(limit),
  });

  const response = await cachedFetch(`${EDUCATION_API}/${DS_LYCEE_PRO}/records?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
  if (!response.ok) {
    return { content: [{ type: "text", text: "Erreur lors de la requete InserJeunes." }], isError: true };
  }

  const data = await response.json() as { total_count: number; results: Array<{ additional_properties?: Record<string, unknown> }> };
  if (!data.results?.length) {
    return { content: [{ type: "text", text: "Aucun etablissement trouve avec ces criteres. Essayez un terme plus large ou un UAI direct." }] };
  }

  const etabs = data.results.map(parseEtablissement).filter((e): e is EtablissementInsertion => e !== null);
  if (etabs.length === 0) {
    return { content: [{ type: "text", text: "Aucun resultat exploitable (effectifs trop faibles pour publication)." }] };
  }

  const lines: string[] = [];
  lines.push(`**Insertion professionnelle — ${data.total_count} etablissement(s) trouve(s)**`);
  lines.push("");

  for (const etab of etabs) {
    lines.push(`**${etab.libelle}** (UAI: ${etab.uai})`);
    lines.push(`  Region : ${etab.region} | Donnees : ${etab.annee}`);

    if (etab.partPoursuite !== null || etab.partEmploi !== null) {
      lines.push(`  Devenir : ${formatPct(etab.partPoursuite)} poursuite etudes | ${formatPct(etab.partEmploi)} emploi | ${formatPct(etab.partAutres)} autres`);
    }

    if (etab.tauxEmploi6Mois !== null) {
      const va = etab.vaEmploi6Mois !== null ? ` (VA: ${etab.vaEmploi6Mois >= 0 ? "+" : ""}${etab.vaEmploi6Mois})` : "";
      lines.push(`  Taux emploi 6 mois : **${etab.tauxEmploi6Mois} %**${va}`);
      if (etab.tauxEmploi6MoisAttendu !== null) {
        lines.push(`  Taux attendu : ${etab.tauxEmploi6MoisAttendu} %`);
      }
    }

    if (etab.tauxPoursuiteEtudes !== null) {
      lines.push(`  Taux poursuite etudes : **${etab.tauxPoursuiteEtudes} %**`);
    }

    lines.push("");
  }

  if (data.total_count > etabs.length) {
    lines.push(`_${data.total_count - etabs.length} etablissement(s) supplementaire(s) non affiches. Precisez votre recherche ou augmentez le limit._`);
    lines.push("");
  }

  lines.push("_Utilisez `consulter_insertion_professionnelle` avec le parametre `uai` pour voir le detail par formation._");
  lines.push("");
  lines.push("_Source : InserJeunes (DEPP/DARES) via data.education.gouv.fr — Lycees professionnels et CFA sous tutelle Education nationale_");
  lines.push("_VA = Valeur Ajoutee : ecart entre taux observe et taux attendu (positif = meilleur que prevu)_");

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/** Fiche detaillee d'un etablissement par UAI avec formations */
async function fetchFicheEtablissement(uai: string, typeDiplome?: string): Promise<ToolResult> {
  // 1. Indicateurs globaux
  const globalParams = new URLSearchParams({
    select: "uai, libelle, region, annee, taux_poursuite_etudes, taux_emploi_6_mois, taux_emploi_6_mois_attendu, va_emploi_6_mois, part_en_poursuite_d_etudes, part_en_emploi_6_mois_apres_la_sortie, part_des_autres_situations",
    where: `uai='${sanitize(uai)}' AND dont_apprentis_eple='ensemble'`,
    order_by: "annee DESC",
    limit: "3",
  });

  // 2. Formations fines (derniere annee)
  const formationFilters = [`uai='${sanitize(uai)}'`];
  if (typeDiplome) {
    formationFilters.push(`type_diplome='${sanitize(typeDiplome)}'`);
  }

  const formationParams = new URLSearchParams({
    select: "annee, type_diplome, libelle_formation, taux_poursuite_etudes, taux_emploi_6_mois, taux_emploi_12_mois, taux_emploi_24_mois",
    where: formationFilters.join(" AND "),
    order_by: "annee DESC, type_diplome ASC, libelle_formation ASC",
    limit: "50",
  });

  const [globalResp, formationResp] = await Promise.all([
    cachedFetch(`${EDUCATION_API}/${DS_LYCEE_PRO}/records?${globalParams}`, { ttl: CACHE_TTL.ANNUAIRE }),
    cachedFetch(`${EDUCATION_API}/${DS_FORMATION_FINE}/records?${formationParams}`, { ttl: CACHE_TTL.ANNUAIRE }),
  ]);

  if (!globalResp.ok) {
    return { content: [{ type: "text", text: `Erreur lors de la requete pour l'UAI ${uai}.` }], isError: true };
  }

  const globalData = await globalResp.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
  if (!globalData.results?.length) {
    return { content: [{ type: "text", text: `Aucune donnee InserJeunes pour l'UAI ${uai}. Verifiez le code UAI ou l'etablissement ne propose peut-etre pas de voie professionnelle.` }] };
  }

  const etabs = globalData.results.map(parseEtablissement).filter((e): e is EtablissementInsertion => e !== null);
  if (etabs.length === 0) {
    return { content: [{ type: "text", text: `Donnees InserJeunes insuffisantes pour l'UAI ${uai} (effectifs trop faibles).` }] };
  }

  const latest = etabs[0];

  const lines: string[] = [];
  lines.push(`**${latest.libelle}** (UAI: ${latest.uai})`);
  lines.push(`Region : ${latest.region}`);
  lines.push("");

  // Indicateurs globaux avec historique
  lines.push("**Indicateurs globaux**");
  lines.push("| Annee | Poursuite etudes | Emploi 6 mois | Taux attendu | VA |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const etab of etabs) {
    const va = etab.vaEmploi6Mois !== null ? `${etab.vaEmploi6Mois >= 0 ? "+" : ""}${etab.vaEmploi6Mois}` : "-";
    lines.push(`| ${etab.annee} | ${formatPct(etab.tauxPoursuiteEtudes)} | ${formatPct(etab.tauxEmploi6Mois)} | ${formatPct(etab.tauxEmploi6MoisAttendu)} | ${va} |`);
  }
  lines.push("");

  // Devenir derniere annee
  if (latest.partPoursuite !== null || latest.partEmploi !== null) {
    lines.push(`**Devenir (${latest.annee})**`);
    lines.push(`  Poursuite d'etudes : ${formatPct(latest.partPoursuite)}`);
    lines.push(`  Emploi a 6 mois : ${formatPct(latest.partEmploi)}`);
    lines.push(`  Autres situations : ${formatPct(latest.partAutres)}`);
    lines.push("");
  }

  // Formations fines
  if (formationResp.ok) {
    const formationData = await formationResp.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
    const formations = parseFormations(formationData.results ?? []);

    if (formations.length > 0) {
      // Prendre uniquement la derniere annee
      const latestAnneeFormation = getLatestAnnee(formationData.results ?? []);
      const latestFormations = formations.filter((_, i) => {
        const raw = formationData.results[i]?.additional_properties;
        return String(raw?.annee ?? "") === latestAnneeFormation;
      });

      // Filtrer les doublons et regrouper
      const uniqueFormations = deduplicateFormations(latestFormations.length > 0 ? latestFormations : formations);

      if (uniqueFormations.length > 0) {
        lines.push("**Detail par formation**");
        lines.push("| Diplome | Formation | Poursuite | Emploi 6m | Emploi 12m | Emploi 24m |");
        lines.push("| --- | --- | --- | --- | --- | --- |");
        for (const f of uniqueFormations) {
          lines.push(`| ${f.typeDiplome} | ${f.libelleFormation} | ${formatPct(f.tauxPoursuiteEtudes)} | ${formatPct(f.tauxEmploi6Mois)} | ${formatPct(f.tauxEmploi12Mois)} | ${formatPct(f.tauxEmploi24Mois)} |`);
        }
        lines.push("");
      }
    }
  }

  lines.push("_Source : InserJeunes (DEPP/DARES) via data.education.gouv.fr_");
  lines.push("_VA = Valeur Ajoutee : ecart entre taux d'emploi observe et taux attendu (positif = meilleur que prevu). Les taux ne sont publies que si les effectifs >= 20._");

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// --- Parsers ---

function parseEtablissement(row: { additional_properties?: Record<string, unknown> }): EtablissementInsertion | null {
  const p = (row.additional_properties ?? row) as Record<string, unknown>;
  const uai = String(p.uai ?? "");
  const libelle = String(p.libelle ?? "");
  if (!uai || !libelle) return null;

  return {
    uai,
    libelle,
    region: String(p.region ?? ""),
    annee: String(p.annee ?? "").replace("cumul ", ""),
    tauxPoursuiteEtudes: toNum(p.taux_poursuite_etudes),
    tauxEmploi6Mois: toNum(p.taux_emploi_6_mois),
    tauxEmploi6MoisAttendu: toNum(p.taux_emploi_6_mois_attendu),
    vaEmploi6Mois: toNum(p.va_emploi_6_mois),
    partPoursuite: toNum(p.part_en_poursuite_d_etudes),
    partEmploi: toNum(p.part_en_emploi_6_mois_apres_la_sortie),
    partAutres: toNum(p.part_des_autres_situations),
  };
}

function parseFormations(results: Array<{ additional_properties?: Record<string, unknown> }>): FormationInsertion[] {
  return results.map((r) => {
    const p = (r.additional_properties ?? r) as Record<string, unknown>;
    return {
      typeDiplome: String(p.type_diplome ?? ""),
      libelleFormation: String(p.libelle_formation ?? ""),
      tauxPoursuiteEtudes: toNum(p.taux_poursuite_etudes),
      tauxEmploi6Mois: toNum(p.taux_emploi_6_mois),
      tauxEmploi12Mois: toNum(p.taux_emploi_12_mois),
      tauxEmploi24Mois: toNum(p.taux_emploi_24_mois),
    };
  }).filter((f) => f.typeDiplome && f.libelleFormation);
}

function getLatestAnnee(results: Array<{ additional_properties?: Record<string, unknown> }>): string {
  const annees = results.map((r) => String(r.additional_properties?.annee ?? "")).filter(Boolean);
  annees.sort().reverse();
  return annees[0] ?? "";
}

/** Deduplique les formations par diplome+libelle, garde la plus riche en donnees */
function deduplicateFormations(formations: FormationInsertion[]): FormationInsertion[] {
  const map = new Map<string, FormationInsertion>();
  for (const f of formations) {
    const key = `${f.typeDiplome}|${f.libelleFormation}`;
    const existing = map.get(key);
    if (!existing || countNonNull(f) > countNonNull(existing)) {
      map.set(key, f);
    }
  }
  return Array.from(map.values());
}

// --- Utilitaires ---

function toNum(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function countNonNull(f: FormationInsertion): number {
  return [f.tauxPoursuiteEtudes, f.tauxEmploi6Mois, f.tauxEmploi12Mois, f.tauxEmploi24Mois].filter((v) => v !== null).length;
}

function formatPct(val: number | null): string {
  if (val === null) return "-";
  return `${val} %`;
}

function sanitize(input: string): string {
  return input.replace(/['"\\]/g, "");
}
