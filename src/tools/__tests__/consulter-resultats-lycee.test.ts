import { describe, it, expect } from "vitest";
import { formatVA } from "../consulter-resultats-lycee.js";

describe("consulter-resultats-lycee", () => {
  describe("formatVA", () => {
    it("formate une VA positive", () => {
      const result = formatVA(5);
      expect(result).toContain("+5");
      expect(result).toContain("📈");
    });

    it("formate une VA negative", () => {
      const result = formatVA(-3);
      expect(result).toContain("-3");
      expect(result).toContain("📉");
    });

    it("formate une VA nulle", () => {
      const result = formatVA(0);
      expect(result).toContain("0");
      expect(result).toContain("➡️");
    });

    it("retourne vide pour null", () => {
      expect(formatVA(null)).toBe("");
      expect(formatVA(undefined)).toBe("");
    });
  });

  describe("URL construction", () => {
    const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
    const DATASET_GT = "fr-en-indicateurs-de-resultat-des-lycees-gt_v2";
    const DATASET_PRO = "fr-en-indicateurs-de-resultat-des-lycees-pro_v2";

    it("construit une URL GT valide avec filtre commune", () => {
      const params = new URLSearchParams({
        select: "annee, uai, libelle_uai, secteur",
        limit: "10",
        order_by: "annee DESC, va_reu_total DESC",
        where: "search(libelle_commune, 'LYON')",
      });

      const url = `${EDUCATION_API}/${DATASET_GT}/records?${params}`;
      expect(url).toContain("lycees-gt_v2");
      expect(url).toContain("LYON");
      expect(url).toContain("annee+DESC");
    });

    it("construit une URL Pro valide", () => {
      const params = new URLSearchParams({
        limit: "5",
        where: "search(libelle_uai, 'Guimard')",
      });

      const url = `${EDUCATION_API}/${DATASET_PRO}/records?${params}`;
      expect(url).toContain("lycees-pro_v2");
      expect(url).toContain("Guimard");
    });
  });

  describe("formatResultat logic", () => {
    // Reproduction de la logique de formatage pour test unitaire
    function formatResultat(r: Record<string, unknown>, voie: string): string {
      const sections: string[] = [];
      const nom = (r.libelle_uai as string) ?? "Lycee";
      const secteur = r.secteur === "public" ? "🟢 Public" : "🔵 Prive";
      sections.push(`## ${nom} (${secteur})`);

      if (r.libelle_commune) sections.push(`**Commune** : ${r.libelle_commune}`);
      sections.push(`**Voie** : ${voie}`);
      if (r.annee) sections.push(`**Session** : ${r.annee}`);
      if (r.presents_total != null) sections.push(`**Candidats** : ${r.presents_total}`);
      if (r.taux_reu_total != null) sections.push(`**Taux de reussite** : ${r.taux_reu_total} %`);
      if (r.taux_acces_2nde != null) sections.push(`**Taux d'acces 2nde→bac** : ${r.taux_acces_2nde} %`);
      if (r.taux_men_total != null) sections.push(`**Taux de mentions** : ${r.taux_men_total} %`);

      return sections.join("\n");
    }

    it("formate un lycee GT public complet", () => {
      const result = formatResultat({
        libelle_uai: "LYCEE LACASSAGNE",
        secteur: "public",
        libelle_commune: "LYON",
        annee: "2024",
        presents_total: 250,
        taux_reu_total: 95,
        taux_acces_2nde: 88,
        taux_men_total: 72,
      }, "General/Technologique");

      expect(result).toContain("## LYCEE LACASSAGNE (🟢 Public)");
      expect(result).toContain("General/Technologique");
      expect(result).toContain("2024");
      expect(result).toContain("95 %");
      expect(result).toContain("88 %");
      expect(result).toContain("72 %");
    });

    it("formate un lycee Pro prive", () => {
      const result = formatResultat({
        libelle_uai: "LP HECTOR GUIMARD",
        secteur: "prive",
        libelle_commune: "LYON 07",
        annee: "2024",
        presents_total: 80,
        taux_reu_total: 81,
      }, "Professionnel");

      expect(result).toContain("🔵 Prive");
      expect(result).toContain("Professionnel");
      expect(result).toContain("81 %");
    });

    it("gere un lycee avec donnees minimales", () => {
      const result = formatResultat({
        secteur: "public",
      }, "General/Technologique");

      expect(result).toContain("## Lycee (🟢 Public)");
    });
  });
});
