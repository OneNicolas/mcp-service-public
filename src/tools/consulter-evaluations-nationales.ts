import type { ToolResult } from "../types.js";
import { resolveNomCommune, resolveCodePostal } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
const DATASET_6EME = "fr-en-evaluations_nationales_6eme_departement";
const DATASET_CE2 = "fr-en-evaluations_nationales_ce2_departement";

interface ConsulterEvaluationsArgs {
  commune?: string;
  code_postal?: string;
  code_departement?: string;
  niveau?: "6eme" | "CE2" | "tous";
  annee?: number;
}

interface Scores6eme {
  annee: string;
  codeDept: string;
  libelleDept: string;
  scoreFrancais: number;
  scoreMaths: number;
  ipsMoyen: number;
  groupesFrancais: GroupeRepartition;
  groupesMaths: GroupeRepartition;
}

interface GroupeRepartition {
  fragile: number;  // groupes 1+2
  moyen: number;    // groupes 3+4
  bon: number;      // groupes 5+6
}

interface ScoreCE2 {
  annee: string;
  codeDept: string;
  libelleDept: string;
  discipline: string;
  competence: string;
  tauxMaitrise: number;
}

export async function consulterEvaluationsNationales(args: ConsulterEvaluationsArgs): Promise<ToolResult> {
  const { niveau = "tous", annee } = args;

  try {
    const codeDept = await resolveCodeDepartement(args);
    if (!codeDept) {
      return {
        content: [{ type: "text", text: "Impossible de determiner le departement. Precisez un code departement (ex: '93'), un code postal ou un nom de commune." }],
        isError: true,
      };
    }

    const lines: string[] = [];
    let libelleDept = "";

    // Fetch 6eme
    if (niveau === "6eme" || niveau === "tous") {
      const dept6eme = await fetch6emeScores(codeDept, annee);
      const national6eme = await fetch6emeScores(null, annee);

      if (dept6eme.length > 0) {
        libelleDept = dept6eme[0].libelleDept;
        lines.push(format6emeReport(dept6eme, national6eme));
      } else {
        lines.push(`Aucune donnee 6eme disponible pour le departement ${codeDept}.`);
      }
    }

    // Fetch CE2
    if (niveau === "CE2" || niveau === "tous") {
      const deptCE2 = await fetchCE2Scores(codeDept, annee);
      const nationalCE2 = await fetchCE2Scores(null, annee);

      if (deptCE2.length > 0) {
        if (!libelleDept) libelleDept = deptCE2[0].libelleDept;
        if (lines.length > 0) lines.push("\n---\n");
        lines.push(formatCE2Report(deptCE2, nationalCE2));
      } else {
        lines.push(`Aucune donnee CE2 disponible pour le departement ${codeDept}.`);
      }
    }

    if (lines.length === 0) {
      return {
        content: [{ type: "text", text: `Aucune donnee d'evaluations nationales trouvee pour le departement ${codeDept}.` }],
      };
    }

    const header = `**Evaluations nationales — ${libelleDept || `Dept. ${codeDept}`}**\n\n`;
    const footer = "\n\n_Source : Evaluations nationales DEPP via data.education.gouv.fr_";
    return { content: [{ type: "text", text: header + lines.join("\n") + footer }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur evaluations nationales : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

/** Resout commune/cp/code_departement en code departement (2-3 chiffres) */
async function resolveCodeDepartement(args: ConsulterEvaluationsArgs): Promise<string | null> {
  if (args.code_departement) {
    return args.code_departement.trim();
  }

  let codeInsee: string | null = null;

  if (args.code_postal) {
    try {
      const communes = await resolveCodePostal(args.code_postal);
      if (communes.length > 0) codeInsee = communes[0].code;
    } catch { /* ignore */ }
  }

  if (!codeInsee && args.commune) {
    const resolved = await resolveNomCommune(args.commune);
    if (resolved) codeInsee = resolved.code;
  }

  if (!codeInsee) return null;

  return extractDeptFromInsee(codeInsee);
}

/** Extrait le code departement depuis un code INSEE */
export function extractDeptFromInsee(codeInsee: string): string {
  // DOM : 971xx, 972xx, 973xx, 974xx, 976xx
  if (codeInsee.startsWith("97")) return codeInsee.substring(0, 3);
  // Corse : 2A/2B
  if (codeInsee.startsWith("2A") || codeInsee.startsWith("2B")) return codeInsee.substring(0, 2);
  // Metropole : 2 premiers chiffres
  return codeInsee.substring(0, 2);
}

/** Fetch scores 6eme pour un departement (null = national) */
export async function fetch6emeScores(codeDept: string | null, annee?: number): Promise<Scores6eme[]> {
  const filters: string[] = ["caracteristique = 'Ensemble'"];

  if (codeDept) {
    filters.push(`code_departement = '${sanitize(codeDept)}'`);
  } else {
    // National = lignes sans code_departement
    filters.push("code_departement IS NULL");
  }

  if (annee) {
    filters.push(`annee >= date'${annee}-01-01' AND annee < date'${annee + 1}-01-01'`);
  }

  const params = new URLSearchParams({
    select: "annee, code_departement, libelle_departement, discipline, score_moyen, ips_moyen, groupe_1, groupe_2, groupe_3, groupe_4, groupe_5, groupe_6",
    where: filters.join(" AND "),
    order_by: "annee DESC",
    limit: "10",
  });

  try {
    const response = await cachedFetch(
      `${EDUCATION_API}/${DATASET_6EME}/records?${params}`,
      { ttl: CACHE_TTL.ANNUAIRE },
    );
    if (!response.ok) return [];

    const data = (await response.json()) as {
      results: Array<{ additional_properties?: Record<string, unknown> }>;
    };

    if (!data.results?.length) return [];

    return data.results
      .map((r) => {
        const p = r.additional_properties ?? r;
        return {
          annee: String(p.annee ?? ""),
          codeDept: String(p.code_departement ?? ""),
          libelleDept: String(p.libelle_departement ?? "NATIONAL"),
          scoreFrancais: 0,
          scoreMaths: 0,
          ipsMoyen: Number(p.ips_moyen ?? 0),
          groupesFrancais: { fragile: 0, moyen: 0, bon: 0 },
          groupesMaths: { fragile: 0, moyen: 0, bon: 0 },
          _discipline: String(p.discipline ?? ""),
          _scoreMoyen: Number(p.score_moyen ?? 0),
          _g1: Number(p.groupe_1 ?? 0),
          _g2: Number(p.groupe_2 ?? 0),
          _g3: Number(p.groupe_3 ?? 0),
          _g4: Number(p.groupe_4 ?? 0),
          _g5: Number(p.groupe_5 ?? 0),
          _g6: Number(p.groupe_6 ?? 0),
        };
      })
      .reduce((acc, row) => {
        // Regrouper francais + maths par annee
        const key = row.annee;
        let entry = acc.find((e) => e.annee === key);
        if (!entry) {
          entry = {
            annee: row.annee,
            codeDept: row.codeDept,
            libelleDept: row.libelleDept,
            scoreFrancais: 0,
            scoreMaths: 0,
            ipsMoyen: row.ipsMoyen,
            groupesFrancais: { fragile: 0, moyen: 0, bon: 0 },
            groupesMaths: { fragile: 0, moyen: 0, bon: 0 },
          };
          acc.push(entry);
        }

        const groupes: GroupeRepartition = {
          fragile: Math.round(((row as any)._g1 + (row as any)._g2) * 10) / 10,
          moyen: Math.round(((row as any)._g3 + (row as any)._g4) * 10) / 10,
          bon: Math.round(((row as any)._g5 + (row as any)._g6) * 10) / 10,
        };

        if ((row as any)._discipline.includes("ran")) {
          entry.scoreFrancais = (row as any)._scoreMoyen;
          entry.groupesFrancais = groupes;
        } else {
          entry.scoreMaths = (row as any)._scoreMoyen;
          entry.groupesMaths = groupes;
        }

        return acc;
      }, [] as Scores6eme[]);
  } catch {
    return [];
  }
}

/** Fetch scores CE2 pour un departement (null = national) */
export async function fetchCE2Scores(codeDept: string | null, annee?: number): Promise<ScoreCE2[]> {
  const filters: string[] = ["caracteristique = 'Ensemble'"];

  if (codeDept) {
    filters.push(`code_dept = '${sanitize(codeDept)}'`);
  } else {
    filters.push("code_dept IS NULL");
  }

  if (annee) {
    filters.push(`annee >= date'${annee}-01-01' AND annee < date'${annee + 1}-01-01'`);
  }

  const params = new URLSearchParams({
    select: "annee, code_dept, libelle_departement, discipline, competence, taux_de_maitrise",
    where: filters.join(" AND "),
    order_by: "annee DESC, discipline ASC, competence ASC",
    limit: "100",
  });

  try {
    const response = await cachedFetch(
      `${EDUCATION_API}/${DATASET_CE2}/records?${params}`,
      { ttl: CACHE_TTL.ANNUAIRE },
    );
    if (!response.ok) return [];

    const data = (await response.json()) as {
      results: Array<{ additional_properties?: Record<string, unknown> }>;
    };

    if (!data.results?.length) return [];

    return data.results.map((r) => {
      const p = r.additional_properties ?? r;
      return {
        annee: String(p.annee ?? ""),
        codeDept: String(p.code_dept ?? ""),
        libelleDept: String(p.libelle_departement ?? "NATIONAL"),
        discipline: String(p.discipline ?? ""),
        competence: String(p.competence ?? ""),
        tauxMaitrise: Number(p.taux_de_maitrise ?? 0),
      };
    });
  } catch {
    return [];
  }
}

function format6emeReport(dept: Scores6eme[], national: Scores6eme[]): string {
  const lines: string[] = [];
  const latest = dept[0];
  const natLatest = national.find((n) => n.annee === latest.annee);

  lines.push(`**6eme — Session ${latest.annee.substring(0, 4)}**`);
  lines.push("");

  // Tableau scores
  const header = ["Discipline", `${latest.libelleDept}`, "National", "Ecart"];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| --- | --- | --- | --- |`);

  const ecartFr = natLatest ? latest.scoreFrancais - natLatest.scoreFrancais : 0;
  const ecartMa = natLatest ? latest.scoreMaths - natLatest.scoreMaths : 0;
  lines.push(`| Francais | **${latest.scoreFrancais}** | ${natLatest?.scoreFrancais ?? "N/A"} | ${formatEcart(ecartFr)} |`);
  lines.push(`| Mathematiques | **${latest.scoreMaths}** | ${natLatest?.scoreMaths ?? "N/A"} | ${formatEcart(ecartMa)} |`);
  lines.push(`| IPS moyen | **${latest.ipsMoyen.toFixed(1)}** | ${natLatest?.ipsMoyen.toFixed(1) ?? "N/A"} | ${natLatest ? formatEcart(Math.round((latest.ipsMoyen - natLatest.ipsMoyen) * 10) / 10) : ""} |`);
  lines.push("");

  // Repartition groupes
  lines.push("**Repartition des eleves (Francais) :**");
  lines.push(`  Fragile (gr. 1-2) : ${latest.groupesFrancais.fragile} % | Moyen (gr. 3-4) : ${latest.groupesFrancais.moyen} % | Bon (gr. 5-6) : ${latest.groupesFrancais.bon} %`);
  lines.push("**Repartition des eleves (Maths) :**");
  lines.push(`  Fragile (gr. 1-2) : ${latest.groupesMaths.fragile} % | Moyen (gr. 3-4) : ${latest.groupesMaths.moyen} % | Bon (gr. 5-6) : ${latest.groupesMaths.bon} %`);

  // Tendance si 2 annees
  if (dept.length >= 2) {
    const prev = dept[1];
    lines.push("");
    lines.push(`**Tendance ${prev.annee.substring(0, 4)} -> ${latest.annee.substring(0, 4)} :**`);
    const diffFr = latest.scoreFrancais - prev.scoreFrancais;
    const diffMa = latest.scoreMaths - prev.scoreMaths;
    lines.push(`  Francais : ${formatTendance(diffFr)} | Mathematiques : ${formatTendance(diffMa)}`);
  }

  return lines.join("\n");
}

function formatCE2Report(dept: ScoreCE2[], national: ScoreCE2[]): string {
  const lines: string[] = [];

  // Trouver la derniere annee
  const latestAnnee = dept[0].annee;
  const latestDept = dept.filter((d) => d.annee === latestAnnee);
  const latestNat = national.filter((n) => n.annee === latestAnnee);
  const libelleDept = latestDept[0]?.libelleDept ?? "";

  lines.push(`**CE2 — Session ${latestAnnee.substring(0, 4)}**`);
  lines.push("");

  // Regrouper par discipline
  const disciplines = [...new Set(latestDept.map((d) => d.discipline))];

  for (const disc of disciplines) {
    const deptDisc = latestDept.filter((d) => d.discipline === disc);
    const natDisc = latestNat.filter((n) => n.discipline === disc);

    lines.push(`**${disc} :**`);
    lines.push(`| Competence | ${libelleDept} | National | Ecart |`);
    lines.push(`| --- | --- | --- | --- |`);

    for (const d of deptDisc) {
      const natMatch = natDisc.find((n) => n.competence === d.competence);
      const ecart = natMatch ? Math.round((d.tauxMaitrise - natMatch.tauxMaitrise) * 10) / 10 : 0;
      lines.push(`| ${d.competence} | **${d.tauxMaitrise.toFixed(1)} %** | ${natMatch?.tauxMaitrise.toFixed(1) ?? "N/A"} % | ${formatEcart(ecart)} |`);
    }
    lines.push("");
  }

  // Tendance si annee precedente disponible
  const annees = [...new Set(dept.map((d) => d.annee))];
  if (annees.length >= 2) {
    const prevAnnee = annees[1];
    const prevDept = dept.filter((d) => d.annee === prevAnnee);

    lines.push(`**Tendance ${prevAnnee.substring(0, 4)} -> ${latestAnnee.substring(0, 4)} :**`);
    for (const disc of disciplines) {
      const latestAvg = average(latestDept.filter((d) => d.discipline === disc).map((d) => d.tauxMaitrise));
      const prevAvg = average(prevDept.filter((d) => d.discipline === disc).map((d) => d.tauxMaitrise));
      if (latestAvg !== null && prevAvg !== null) {
        const diff = Math.round((latestAvg - prevAvg) * 10) / 10;
        lines.push(`  ${disc} : ${formatTendance(diff)}`);
      }
    }
  }

  return lines.join("\n");
}

function formatEcart(ecart: number): string {
  if (ecart > 0) return `+${ecart}`;
  if (ecart < 0) return `${ecart}`;
  return "=";
}

function formatTendance(diff: number): string {
  if (diff > 2) return `\u2B06\uFE0F +${diff} (progression)`;
  if (diff < -2) return `\u2B07\uFE0F ${diff} (regression)`;
  return `\u27A1\uFE0F ${diff >= 0 ? "+" : ""}${diff} (stable)`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sanitize(input: string): string {
  return input.replace(/['"\\]/g, "");
}
