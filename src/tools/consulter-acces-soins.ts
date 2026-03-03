import type { ToolResult } from "../types.js";
import { resolveNomCommune, resolveCodePostal } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const AMELI_API = "https://data.ameli.fr/api/explore/v2.1/catalog/datasets";

// Datasets utilises
const DS_PATIENTELE_MT = "patientele-medecintraitant-generalistes-annuelle";
const DS_PRIMO_INSTALL = "primo-installes-medgen-annuelle";
const DS_ZONES_SOUS_DOTEES = "medgen-zones-sous-dotees-annuelle";
const DS_DEMOGRAPHIE = "demographie-secteurs-conventionnels";
const DS_FILE_ACTIVE = "file-active-medgen-annuelle";

// Specialites cles a afficher (noms exacts data.ameli.fr)
const SPECIALITES_CLES = [
  "Ophtalmologues",
  "Dermatologues et vénérologues",
  "Pédiatres",
  "Gynécologues médicaux et obstétriciens",
  "Psychiatres et neuropsychiatres",
  "Cardiologues",
];

interface ConsulterAccesSoinsArgs {
  commune?: string;
  code_postal?: string;
  code_departement?: string;
}

interface PatienteleMT {
  annee: string;
  libelleDept: string;
  nbPatients: number;
  evolution: number | null;
}

interface PrimoInstallation {
  annee: string;
  effectif: number;
  evolution: number | null;
}

interface ZoneSousDotee {
  annee: string;
  effectifInstallZSD: number;
  evolution: number | null;
}

interface EffectifSpecialite {
  profession: string;
  effectifTotal: number;
  secteur1: number;
  secteur2: number;
}

interface FileActive {
  profession: string;
  nbPatientsUniques: number;
  evolution: number | null;
}

export async function consulterAccesSoins(args: ConsulterAccesSoinsArgs): Promise<ToolResult> {
  try {
    const codeDept = await resolveCodeDepartement(args);
    if (!codeDept) {
      return {
        content: [{ type: "text", text: "Impossible de determiner le departement. Precisez un code departement (ex: '93'), un code postal ou un nom de commune." }],
        isError: true,
      };
    }

    // Fetch toutes les donnees en parallele (dept + national)
    const [
      patienteleDept, patienteleNat,
      primoDept, primoNat,
      zsdDept,,
      demoDept, demoNat,
      fileActiveDept, fileActiveNat,
    ] = await Promise.all([
      fetchPatienteleMT(codeDept),
      fetchPatienteleMT(null),
      fetchPrimoInstallations(codeDept),
      fetchPrimoInstallations(null),
      fetchZonesSousDotees(codeDept),
      fetchZonesSousDotees(null),
      fetchDemographieSpecialites(codeDept),
      fetchDemographieSpecialites(null),
      fetchFileActive(codeDept),
      fetchFileActive(null),
    ]);

    // Determiner le libelle departement
    const libelleDept = findLibelleDept(patienteleDept, codeDept);

    const lines: string[] = [];
    lines.push(`**Acces aux soins — ${libelleDept}**\n`);

    // Section 1 : Effectifs medecins generalistes
    const mgDept = demoDept.find(d => d.profession.includes("neraliste"));
    const mgNat = demoNat.find(d => d.profession.includes("neraliste"));
    if (mgDept) {
      lines.push("**Medecins generalistes**");
      lines.push(`  Effectif total : **${mgDept.effectifTotal}** (secteur 1 : ${mgDept.secteur1} | secteur 2+ : ${mgDept.secteur2})`);
      if (mgNat) {
        lines.push(`  National : ${mgNat.effectifTotal.toLocaleString("fr-FR")}`);
      }
      lines.push("");
    }

    // Section 2 : Patientele MT
    if (patienteleDept.length > 0) {
      const latest = patienteleDept[0];
      const natLatest = patienteleNat.find(p => p.annee === latest.annee);
      lines.push("**Patientele medecin traitant (moyenne par generaliste)**");
      lines.push(`  ${latest.annee} : **${latest.nbPatients} patients/medecin**${formatEvolution(latest.evolution)}`);
      if (natLatest) {
        const ecart = latest.nbPatients - natLatest.nbPatients;
        lines.push(`  National : ${natLatest.nbPatients} patients/medecin | Ecart : ${ecart >= 0 ? "+" : ""}${ecart}`);
      }
      // Tendance sur les 3 dernieres annees
      if (patienteleDept.length >= 3) {
        const oldest = patienteleDept[Math.min(2, patienteleDept.length - 1)];
        const diff = latest.nbPatients - oldest.nbPatients;
        lines.push(`  Tendance ${oldest.annee}-${latest.annee} : ${formatTendance(diff, "patients")}`);
      }
      lines.push("");
    }

    // Section 3 : File active (nb patients uniques par medecin)
    const faDeptMG = fileActiveDept.find(f => f.profession.includes("neraliste"));
    const faNatMG = fileActiveNat.find(f => f.profession.includes("neraliste"));
    if (faDeptMG && faDeptMG.nbPatientsUniques > 0) {
      lines.push("**File active moyenne (patients uniques/medecin generaliste/an)**");
      lines.push(`  **${faDeptMG.nbPatientsUniques}**${formatEvolution(faDeptMG.evolution)}`);
      if (faNatMG && faNatMG.nbPatientsUniques > 0) {
        lines.push(`  National : ${faNatMG.nbPatientsUniques}`);
      }
      lines.push("");
    }

    // Section 4 : Primo-installations
    if (primoDept.length > 0) {
      const latest = primoDept[0];
      const natLatest = primoNat.find(p => p.annee === latest.annee);
      lines.push("**Primo-installations medecins generalistes**");
      lines.push(`  ${latest.annee} : **${latest.effectif} nouvelles installations**${formatEvolution(latest.evolution)}`);
      if (natLatest) {
        lines.push(`  National : ${natLatest.effectif.toLocaleString("fr-FR")}`);
      }
      // Tendance
      if (primoDept.length >= 3) {
        const oldest = primoDept[Math.min(2, primoDept.length - 1)];
        const diff = latest.effectif - oldest.effectif;
        lines.push(`  Tendance ${oldest.annee}-${latest.annee} : ${formatTendance(diff, "installations")}`);
      }
      lines.push("");
    }

    // Section 5 : Zones sous-dotees
    if (zsdDept.length > 0) {
      const latest = zsdDept[0];
      lines.push("**Installations en zones sous-dotees**");
      lines.push(`  ${latest.annee} : **${latest.effectifInstallZSD}** medecins installes en ZSD${formatEvolution(latest.evolution)}`);
      lines.push("");
    }

    // Section 6 : Specialistes cles
    const specDept = demoDept.filter(d => !d.profession.includes("neraliste") && !d.profession.includes("Ensemble") && !d.profession.includes("Autres"));
    if (specDept.length > 0) {
      lines.push("**Specialistes (effectifs liberaux)**");
      lines.push("| Specialite | Effectif | Secteur 1 | Secteur 2+ |");
      lines.push("| --- | --- | --- | --- |");
      for (const s of specDept) {
        lines.push(`| ${s.profession} | **${s.effectifTotal}** | ${s.secteur1} | ${s.secteur2} |`);
      }
      lines.push("");
    }

    // Section 7 : File active specialistes
    const faSpec = fileActiveDept.filter(f =>
      !f.profession.includes("neraliste") &&
      !f.profession.includes("Ensemble") &&
      !f.profession.includes("Autres") &&
      f.nbPatientsUniques > 0,
    );
    if (faSpec.length > 0) {
      lines.push("**File active specialistes (patients uniques/medecin/an)**");
      lines.push("| Specialite | Patients/medecin |");
      lines.push("| --- | --- |");
      for (const f of faSpec) {
        lines.push(`| ${f.profession} | **${f.nbPatientsUniques}** |`);
      }
      lines.push("");
    }

    if (lines.length <= 2) {
      return {
        content: [{ type: "text", text: `Aucune donnee d'acces aux soins trouvee pour le departement ${codeDept}.` }],
      };
    }

    lines.push("_Source : Assurance Maladie (CNAM) via data.ameli.fr — Donnees professionnels de sante liberaux_");
    lines.push("_Les effectifs concernent les praticiens liberaux conventionnes. Les medecins hospitaliers ne sont pas inclus._");

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur acces aux soins : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

// --- Fetchers ---

/** Patientele MT par departement (null = national) */
export async function fetchPatienteleMT(codeDept: string | null): Promise<PatienteleMT[]> {
  const filters: string[] = [];
  if (codeDept) {
    filters.push(`departement='${sanitize(codeDept)}'`);
  } else {
    filters.push("departement='999'");
    filters.push("region='99'"); // FRANCE entiere
  }

  const params = new URLSearchParams({
    select: "annee, departement, libelle_departement, nombre_patients_medecin_traitant, taux_evolution_annuel_integer",
    where: filters.join(" AND "),
    order_by: "annee DESC",
    limit: "10",
  });

  try {
    const response = await cachedFetch(`${AMELI_API}/${DS_PATIENTELE_MT}/records?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return [];
    const data = await response.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
    if (!data.results?.length) return [];

    return data.results.map(r => {
      const p = (r.additional_properties ?? r) as Record<string, unknown>;
      return {
        annee: String(p.annee ?? ""),
        libelleDept: String(p.libelle_departement ?? ""),
        nbPatients: Number(p.nombre_patients_medecin_traitant ?? 0),
        evolution: p.taux_evolution_annuel_integer != null ? Number(p.taux_evolution_annuel_integer) : null,
      };
    });
  } catch { return []; }
}

/** Primo-installations MG par departement (null = national) */
export async function fetchPrimoInstallations(codeDept: string | null): Promise<PrimoInstallation[]> {
  const filters: string[] = [];
  if (codeDept) {
    filters.push(`departement='${sanitize(codeDept)}'`);
  } else {
    filters.push("departement='999'");
    filters.push("region='99'");
  }

  const params = new URLSearchParams({
    select: "annee, departement, libelle_departement, effectif_primo_installe, taux_evolution_annuel_integer",
    where: filters.join(" AND "),
    order_by: "annee DESC",
    limit: "10",
  });

  try {
    const response = await cachedFetch(`${AMELI_API}/${DS_PRIMO_INSTALL}/records?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return [];
    const data = await response.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
    if (!data.results?.length) return [];

    return data.results.map(r => {
      const p = (r.additional_properties ?? r) as Record<string, unknown>;
      return {
        annee: String(p.annee ?? ""),
        effectif: Number(p.effectif_primo_installe ?? 0),
        evolution: p.taux_evolution_annuel_integer != null ? Number(p.taux_evolution_annuel_integer) : null,
      };
    });
  } catch { return []; }
}

/** Installations en zones sous-dotees (null = national) */
export async function fetchZonesSousDotees(codeDept: string | null): Promise<ZoneSousDotee[]> {
  const filters: string[] = [];
  if (codeDept) {
    filters.push(`departement='${sanitize(codeDept)}'`);
  } else {
    filters.push("departement='999'");
    filters.push("region='99'");
  }

  const params = new URLSearchParams({
    select: "annee, departement, libelle_departement, effectif_medecin_install_zsd, taux_evolution_annuel_integer",
    where: filters.join(" AND "),
    order_by: "annee DESC",
    limit: "10",
  });

  try {
    const response = await cachedFetch(`${AMELI_API}/${DS_ZONES_SOUS_DOTEES}/records?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return [];
    const data = await response.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
    if (!data.results?.length) return [];

    return data.results.map(r => {
      const p = (r.additional_properties ?? r) as Record<string, unknown>;
      return {
        annee: String(p.annee ?? ""),
        effectifInstallZSD: Number(p.effectif_medecin_install_zsd ?? 0),
        evolution: p.taux_evolution_annuel_integer != null ? Number(p.taux_evolution_annuel_integer) : null,
      };
    });
  } catch { return []; }
}

/** Effectifs par specialite et secteur conventionnel — derniere annee disponible */
export async function fetchDemographieSpecialites(codeDept: string | null): Promise<EffectifSpecialite[]> {
  // Ce dataset a 'annee' en type date — on prend la derniere annee disponible
  const deptFilter = codeDept
    ? `departement='${sanitize(codeDept)}'`
    : "departement='999' AND region='99'";

  // Specialites ciblées : generalistes + cles
  const professionFilter = SPECIALITES_CLES.map(s => `'${s}'`).join(", ");
  const where = `${deptFilter} AND (profession_sante IN (${professionFilter}) OR profession_sante='Médecins généralistes')`;

  const params = new URLSearchParams({
    select: "annee, profession_sante, secteur_conventionnel, effectif",
    where,
    order_by: "annee DESC",
    limit: "100",
  });

  try {
    const response = await cachedFetch(`${AMELI_API}/${DS_DEMOGRAPHIE}/records?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return [];
    const data = await response.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
    if (!data.results?.length) return [];

    // Prendre uniquement la derniere annee
    const rows = data.results.map(r => (r.additional_properties ?? r) as Record<string, unknown>);
    const latestAnnee = String(rows[0].annee ?? "");
    const latestRows = rows.filter(r => String(r.annee) === latestAnnee);

    // Regrouper par profession
    const map = new Map<string, EffectifSpecialite>();
    for (const row of latestRows) {
      const profession = String(row.profession_sante ?? "");
      const secteur = String(row.secteur_conventionnel ?? "");
      const effectif = Number(row.effectif ?? 0);

      let entry = map.get(profession);
      if (!entry) {
        entry = { profession, effectifTotal: 0, secteur1: 0, secteur2: 0 };
        map.set(profession, entry);
      }
      entry.effectifTotal += effectif;
      if (secteur === "1") {
        entry.secteur1 += effectif;
      } else {
        entry.secteur2 += effectif;
      }
    }

    return Array.from(map.values());
  } catch { return []; }
}

/** File active par specialite — derniere annee disponible */
export async function fetchFileActive(codeDept: string | null): Promise<FileActive[]> {
  const filters: string[] = [];
  if (codeDept) {
    filters.push(`departement='${sanitize(codeDept)}'`);
  } else {
    filters.push("departement='999'");
    filters.push("region='99'");
  }

  const params = new URLSearchParams({
    select: "annee, profession_sante, nombre_patients_uniques_integer, taux_evolution_annuel_integer",
    where: filters.join(" AND "),
    order_by: "annee DESC",
    limit: "100",
  });

  try {
    const response = await cachedFetch(`${AMELI_API}/${DS_FILE_ACTIVE}/records?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return [];
    const data = await response.json() as { results: Array<{ additional_properties?: Record<string, unknown> }> };
    if (!data.results?.length) return [];

    // Prendre uniquement la derniere annee
    const rows = data.results.map(r => (r.additional_properties ?? r) as Record<string, unknown>);
    const latestAnnee = String(rows[0].annee ?? "");
    const latestRows = rows.filter(r => String(r.annee) === latestAnnee);

    return latestRows.map(row => ({
      profession: String(row.profession_sante ?? ""),
      nbPatientsUniques: Number(row.nombre_patients_uniques_integer ?? 0),
      evolution: row.taux_evolution_annuel_integer != null ? Number(row.taux_evolution_annuel_integer) : null,
    }));
  } catch { return []; }
}

// --- Utilitaires ---

/** Resout commune/cp/code_departement en code departement */
async function resolveCodeDepartement(args: ConsulterAccesSoinsArgs): Promise<string | null> {
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
  if (codeInsee.startsWith("97")) return codeInsee.substring(0, 3);
  if (codeInsee.startsWith("2A") || codeInsee.startsWith("2B")) return codeInsee.substring(0, 2);
  return codeInsee.substring(0, 2);
}

function findLibelleDept(patientele: PatienteleMT[], codeDept: string): string {
  const found = patientele.find(p => p.libelleDept && p.libelleDept !== "Tout département");
  return found?.libelleDept || `Departement ${codeDept}`;
}

function formatEvolution(pct: number | null): string {
  if (pct == null) return "";
  const sign = pct >= 0 ? "+" : "";
  return ` (${sign}${pct.toFixed(1)} %)`;
}

function formatTendance(diff: number, unite: string): string {
  if (diff > 0) return `\u2B06\uFE0F +${diff} ${unite}`;
  if (diff < 0) return `\u2B07\uFE0F ${diff} ${unite}`;
  return `\u27A1\uFE0F stable`;
}

function sanitize(input: string): string {
  return input.replace(/['"\\]/g, "");
}
