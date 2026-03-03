import type { ToolResult } from "../types.js";
import { resolveCodePostal } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
const DATASET_PARCOURSUP = "fr-esr-parcoursup@mesr";

interface ConsulterParcoursupArgs {
  recherche?: string;
  ville?: string;
  code_postal?: string;
  departement?: string;
  filiere?: string;
  limit?: number;
}

interface FormationRecord {
  session?: string;
  contrat_etab?: string;
  g_ea_lib_vx?: string;
  dep?: string;
  dep_lib?: string;
  region_etab_aff?: string;
  acad_mies?: string;
  ville_etab?: string;
  lib_for_voe_ins?: string;
  select_form?: string;
  fili?: string;
  fil_lib_voe_acc?: string;
  capa_fin?: number;
  voe_tot?: number;
  acc_tot?: number;
  acc_tot_f?: number;
  pct_f?: number;
  pct_bours?: number;
  pct_neobac?: number;
  pct_sansmention?: number;
  pct_ab?: number;
  pct_b?: number;
  pct_tb?: number;
  pct_tbf?: number;
  pct_bg?: number;
  pct_bt?: number;
  pct_bp?: number;
  taux_acces_ens?: string;
  lien_form_psup?: string;
}

interface ExploreResponse {
  total_count: number;
  results: Array<{ additional_properties: FormationRecord }>;
}

/** Champs selectionnes pour limiter la taille de la reponse */
const SELECT_FIELDS = [
  "session", "contrat_etab", "g_ea_lib_vx", "dep", "dep_lib",
  "region_etab_aff", "acad_mies", "ville_etab",
  "lib_for_voe_ins", "select_form", "fili", "fil_lib_voe_acc",
  "capa_fin", "voe_tot", "acc_tot", "acc_tot_f",
  "pct_f", "pct_bours", "pct_neobac",
  "pct_sansmention", "pct_ab", "pct_b", "pct_tb", "pct_tbf",
  "pct_bg", "pct_bt", "pct_bp",
  "taux_acces_ens", "lien_form_psup",
].join(", ");

/** Map des filieres utilisateur vers les valeurs exactes du dataset Parcoursup */
const FILIERE_MAP: Record<string, string> = {
  "but": "BUT",
  "bts": "BTS",
  "licence": "Licence",
  "cpge": "CPGE",
  "prepa": "CPGE",
  "classe preparatoire": "CPGE",
  "pass": "PASS",
  "las": "LAS",
  "ifsi": "IFSI",
  "infirmier": "IFSI",
  "ingenieur": "Formation d'ing\u00e9nieur",
  "ecole d'ingenieur": "Formation d'ing\u00e9nieur",
  "dn made": "DN MADE",
  "dnmade": "DN MADE",
  "dcg": "DCG",
};

/** Normalise une filiere utilisateur vers la valeur exacte du dataset.
 *  Retourne null si la filiere n'est pas reconnue. */
export function normalizeFiliere(input: string): string | null {
  if (!input || !input.trim()) return null;
  const key = input.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return FILIERE_MAP[key] ?? null;
}

export async function consulterParcoursup(
  args: ConsulterParcoursupArgs,
): Promise<ToolResult> {
  const { recherche, ville, code_postal, departement, filiere, limit = 10 } = args;
  const maxLimit = Math.min(Math.max(limit, 1), 20);

  if (!recherche && !ville && !code_postal && !departement && !filiere) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : recherche (mot-cle), ville, code_postal, departement ou filiere." }],
      isError: true,
    };
  }

  try {
    const whereClauses: string[] = [];

    if (recherche) {
      const sanitized = sanitize(recherche);
      whereClauses.push(`(search(lib_for_voe_ins, '${sanitized}') OR search(g_ea_lib_vx, '${sanitized}') OR search(fil_lib_voe_acc, '${sanitized}'))`);
    }

    // Resolution ville via code postal
    let resolvedVille = ville;
    if (!resolvedVille && code_postal) {
      try {
        const communes = await resolveCodePostal(code_postal);
        if (communes.length > 0) resolvedVille = communes[0].nom;
      } catch { /* fallback sans ville */ }
    }

    if (resolvedVille) {
      whereClauses.push(`search(ville_etab, '${sanitize(resolvedVille)}')`);
    }

    if (departement) {
      const codeDept = normalizeDepartement(departement);
      if (codeDept) {
        whereClauses.push(`dep = '${codeDept}'`);
      } else {
        whereClauses.push(`search(dep_lib, '${sanitize(departement)}')`);
      }
    }

    if (filiere) {
      const normalized = normalizeFiliere(filiere);
      if (normalized) {
        whereClauses.push(`fili = '${sanitize(normalized)}'`);
      } else {
        // Filiere non reconnue : recherche textuelle
        whereClauses.push(`search(fili, '${sanitize(filiere)}')`);
      }
    }

    const whereStr = whereClauses.join(" AND ");

    const params = new URLSearchParams({
      select: SELECT_FIELDS,
      where: whereStr,
      order_by: "voe_tot DESC",
      limit: String(maxLimit),
    });

    const url = `${EDUCATION_API}/${DATASET_PARCOURSUP}/records?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE, source: "education-gouv-parcoursup" });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API Parcoursup : HTTP ${response.status}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as ExploreResponse;

    if (!data.results?.length) {
      const criteres = buildCriteresLabel(args);
      return {
        content: [{ type: "text", text: `Aucune formation Parcoursup trouvee pour : ${criteres}. Essayez des termes plus larges ou verifiez l'orthographe.` }],
      };
    }

    const formations = data.results.map((r) => r.additional_properties);
    const formatted = formations.map(formatFormation);

    const criteres = buildCriteresLabel(args);
    const header = `**${data.total_count} formation(s) Parcoursup** trouvee(s) pour : ${criteres} (${formatted.length} affichee(s))\n`;
    const footer = "\n\n_Source : Parcoursup (session la plus recente) via data.education.gouv.fr — Donnees indicatives, consulter parcoursup.fr pour les informations officielles._";

    return {
      content: [{ type: "text", text: header + "\n---\n" + formatted.join("\n---\n") + footer }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur Parcoursup : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

/** Formate une formation pour l'affichage */
function formatFormation(f: FormationRecord): string {
  const sections: string[] = [];

  const nom = f.lib_for_voe_ins ?? "Formation";
  const selectivite = f.select_form === "formation selective" ? "Selective" : "Non selective";
  sections.push(`## ${nom}`);

  if (f.g_ea_lib_vx) sections.push(`**Etablissement** : ${f.g_ea_lib_vx}`);
  const locParts = [f.ville_etab, f.dep_lib, f.region_etab_aff].filter(Boolean);
  if (locParts.length) sections.push(`**Localisation** : ${locParts.join(", ")}`);
  if (f.contrat_etab) sections.push(`**Statut** : ${f.contrat_etab}`);
  sections.push(`**Type** : ${selectivite}`);
  if (f.fili) sections.push(`**Filiere** : ${f.fili}`);
  if (f.fil_lib_voe_acc) sections.push(`**Specialite** : ${f.fil_lib_voe_acc}`);
  if (f.session) sections.push(`**Session** : ${f.session}`);

  // Chiffres cles
  const chiffres: string[] = [];
  if (f.capa_fin != null) chiffres.push(`Capacite : ${f.capa_fin}`);
  if (f.voe_tot != null) chiffres.push(`Voeux : ${f.voe_tot.toLocaleString("fr-FR")}`);
  if (f.acc_tot != null) chiffres.push(`Admis : ${f.acc_tot}`);
  if (chiffres.length) sections.push(`**Chiffres** : ${chiffres.join(" | ")}`);

  // Taux d'acces
  if (f.taux_acces_ens) {
    const taux = parseInt(f.taux_acces_ens, 10);
    const emoji = taux <= 20 ? " \u2757" : taux <= 50 ? " \u26A0\uFE0F" : "";
    sections.push(`**Taux d'acces** : ${taux} %${emoji}`);
  }

  // Profil des admis
  const profil: string[] = [];
  if (f.pct_bg != null) profil.push(`Bac general : ${f.pct_bg} %`);
  if (f.pct_bt != null) profil.push(`Bac techno : ${f.pct_bt} %`);
  if (f.pct_bp != null && f.pct_bp > 0) profil.push(`Bac pro : ${f.pct_bp} %`);
  if (profil.length) sections.push(`**Profil admis** : ${profil.join(" | ")}`);

  // Mentions
  const mentions: string[] = [];
  if (f.pct_tb != null && f.pct_tb > 0) mentions.push(`TB : ${f.pct_tb} %`);
  if (f.pct_tbf != null && f.pct_tbf > 0) mentions.push(`TB felicitations : ${f.pct_tbf} %`);
  if (f.pct_b != null && f.pct_b > 0) mentions.push(`B : ${f.pct_b} %`);
  if (f.pct_ab != null && f.pct_ab > 0) mentions.push(`AB : ${f.pct_ab} %`);
  if (mentions.length) sections.push(`**Mentions admis** : ${mentions.join(" | ")}`);

  // Indicateurs sociaux
  const social: string[] = [];
  if (f.pct_bours != null) social.push(`Boursiers : ${f.pct_bours} %`);
  if (f.pct_f != null) social.push(`Femmes : ${f.pct_f} %`);
  if (f.pct_neobac != null) social.push(`Neo-bacheliers : ${f.pct_neobac} %`);
  if (social.length) sections.push(`**Indicateurs** : ${social.join(" | ")}`);

  // Lien Parcoursup
  if (f.lien_form_psup) sections.push(`**Fiche Parcoursup** : ${f.lien_form_psup}`);

  return sections.join("\n");
}

/** Normalise un code departement (accepte "93", "2A", "971") */
export function normalizeDepartement(input: string): string | null {
  const trimmed = input.trim().toUpperCase();
  if (/^2[AB]$/.test(trimmed)) return trimmed;
  const num = parseInt(trimmed, 10);
  if (num >= 1 && num <= 9) return `0${num}`;
  if (num >= 10 && num <= 95) return String(num);
  if (num >= 971 && num <= 976) return String(num);
  return null;
}

/** Construit un label des criteres pour l'affichage */
function buildCriteresLabel(args: ConsulterParcoursupArgs): string {
  const parts: string[] = [];
  if (args.recherche) parts.push(`"${args.recherche}"`);
  if (args.ville) parts.push(`ville "${args.ville}"`);
  if (args.code_postal) parts.push(`CP "${args.code_postal}"`);
  if (args.departement) parts.push(`departement "${args.departement}"`);
  if (args.filiere) parts.push(`filiere "${args.filiere}"`);
  return parts.join(", ") || "tous";
}

function sanitize(input: string): string {
  return input.replace(/['"\\\n\r]/g, "");
}
