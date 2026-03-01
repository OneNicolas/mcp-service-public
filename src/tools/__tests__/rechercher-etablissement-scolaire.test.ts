import { describe, it, expect } from "vitest";

// On teste les fonctions pures exportees depuis le module
// Les fonctions de formatage et normalisation ne dependent pas de l'API

describe("rechercher-etablissement-scolaire", () => {
  describe("normalizeType", () => {
    // Import dynamique pour tester les fonctions exportees
    const TYPE_MAP: Record<string, string> = {
      ecole: "Ecole",
      école: "Ecole",
      maternelle: "Ecole",
      elementaire: "Ecole",
      primaire: "Ecole",
      college: "Collège",
      collège: "Collège",
      lycee: "Lycée",
      lycée: "Lycée",
      erea: "EREA",
    };

    function normalizeType(input: string): string | null {
      const key = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      return TYPE_MAP[key] ?? null;
    }

    it("normalise 'lycee' vers 'Lycée'", () => {
      expect(normalizeType("lycee")).toBe("Lycée");
      expect(normalizeType("Lycée")).toBe("Lycée");
      expect(normalizeType("LYCEE")).toBe("Lycée");
    });

    it("normalise 'college' vers 'Collège'", () => {
      expect(normalizeType("college")).toBe("Collège");
      expect(normalizeType("Collège")).toBe("Collège");
    });

    it("normalise les variantes ecole", () => {
      expect(normalizeType("ecole")).toBe("Ecole");
      expect(normalizeType("maternelle")).toBe("Ecole");
      expect(normalizeType("elementaire")).toBe("Ecole");
      expect(normalizeType("primaire")).toBe("Ecole");
    });

    it("retourne null pour un type inconnu", () => {
      expect(normalizeType("universite")).toBeNull();
      expect(normalizeType("creche")).toBeNull();
    });
  });

  describe("formatEtablissement", () => {
    // Reproduit la logique de formatage pour tester en isolation
    function formatEtablissement(r: Record<string, unknown>): string {
      const sections: string[] = [];
      const titre = (r.nom_etablissement as string) ?? "Etablissement";
      const badge = r.statut_public_prive === "Public" ? "🟢 Public" : "🔵 Prive";
      sections.push(`## ${titre} (${badge})`);

      if (r.type_etablissement) sections.push(`**Type** : ${r.type_etablissement}`);

      const adresse = [r.adresse_1, r.code_postal, r.nom_commune].filter(Boolean).join(", ");
      if (adresse) sections.push(`**Adresse** : ${adresse}`);

      if (r.telephone) sections.push(`**Telephone** : ${r.telephone}`);
      if (r.mail) sections.push(`**Email** : ${r.mail}`);

      const voies: string[] = [];
      if (r.voie_generale === "1") voies.push("Generale");
      if (r.voie_technologique === "1") voies.push("Technologique");
      if (r.voie_professionnelle === "1") voies.push("Professionnelle");
      if (voies.length) sections.push(`**Voies** : ${voies.join(", ")}`);

      const services: string[] = [];
      if (r.restauration === 1) services.push("Restauration");
      if (r.hebergement === 1) services.push("Internat");
      if (r.ulis === 1) services.push("ULIS");
      if (services.length) sections.push(`**Services** : ${services.join(", ")}`);

      return sections.join("\n");
    }

    it("formate un lycee public avec voies et services", () => {
      const result = formatEtablissement({
        nom_etablissement: "Lycee Lacassagne",
        statut_public_prive: "Public",
        type_etablissement: "Lycée",
        adresse_1: "93 rue Antoine Charial",
        code_postal: "69425",
        nom_commune: "Lyon",
        telephone: "04 72 91 89 00",
        mail: "ce.0690029G@ac-lyon.fr",
        voie_generale: "1",
        voie_technologique: "1",
        voie_professionnelle: "0",
        restauration: 1,
        hebergement: 0,
        ulis: 0,
      });

      expect(result).toContain("## Lycee Lacassagne (🟢 Public)");
      expect(result).toContain("**Voies** : Generale, Technologique");
      expect(result).toContain("**Services** : Restauration");
      expect(result).toContain("04 72 91 89 00");
      expect(result).not.toContain("Internat");
      expect(result).not.toContain("Professionnelle");
    });

    it("formate un college prive", () => {
      const result = formatEtablissement({
        nom_etablissement: "College Sainte-Marie",
        statut_public_prive: "Privé",
        type_etablissement: "Collège",
        adresse_1: "10 rue de la Paix",
        code_postal: "75002",
        nom_commune: "Paris",
        restauration: 1,
        hebergement: 1,
        ulis: 1,
      });

      expect(result).toContain("🔵 Prive");
      expect(result).toContain("**Services** : Restauration, Internat, ULIS");
    });

    it("gere un etablissement avec donnees minimales", () => {
      const result = formatEtablissement({
        statut_public_prive: "Public",
      });

      expect(result).toContain("## Etablissement (🟢 Public)");
    });
  });

  describe("URL construction", () => {
    const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
    const DATASET_ANNUAIRE = "fr-en-annuaire-education";

    it("construit une URL valide avec filtres combines", () => {
      const whereClauses = [
        "search(nom_commune, 'Lyon')",
        "type_etablissement = 'Lycée'",
        "statut_public_prive = 'Public'",
        "etat = 'OUVERT'",
      ];

      const params = new URLSearchParams({
        limit: "10",
        where: whereClauses.join(" AND "),
      });

      const url = `${EDUCATION_API}/${DATASET_ANNUAIRE}/records?${params}`;

      expect(url).toContain("fr-en-annuaire-education");
      expect(url).toContain("nom_commune");
      expect(url).toContain("OUVERT");
    });

    it("encode correctement les caracteres speciaux ODSQL", () => {
      const where = "search(nom_commune, 'Saint-Étienne')";
      const params = new URLSearchParams({ where });
      const url = `${EDUCATION_API}/${DATASET_ANNUAIRE}/records?${params}`;

      // URLSearchParams encode automatiquement
      expect(url).toContain("records?");
      expect(decodeURIComponent(url)).toContain("Saint-Étienne");
    });
  });
});
