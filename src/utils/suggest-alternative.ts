/**
 * T84 — Suggestions d'outils alternatifs
 * Appended aux messages d'erreur isError:true pour guider l'utilisateur vers des alternatives pertinentes.
 */

interface Alternative {
  tool: string;
  context: string;
}

// Map statique : toolName → alternatives avec message contextuel
const ALTERNATIVES: Record<string, Alternative[]> = {
  consulter_securite: [
    { tool: "comparer_communes", context: "pour comparer la securite de plusieurs departements cote a cote" },
  ],
  consulter_acces_soins: [
    { tool: "comparer_communes", context: "pour comparer la densite medicale de plusieurs departements" },
  ],
  consulter_fiscalite_locale: [
    { tool: "comparer_communes", context: "pour comparer la fiscalite de plusieurs communes" },
    { tool: "simuler_taxe_fonciere", context: "pour estimer le montant de taxe fonciere d'un bien precis" },
  ],
  consulter_transactions_immobilieres: [
    { tool: "comparer_communes", context: "pour comparer les prix DVF de plusieurs communes" },
    { tool: "simuler_taxe_fonciere", context: "pour estimer la taxe fonciere basee sur les prix du marche local" },
  ],
  consulter_risques_naturels: [
    { tool: "comparer_communes", context: "pour comparer les risques naturels de plusieurs communes" },
  ],
  rechercher_marche_public: [
    { tool: "rechercher", context: "avec query 'marche public [sujet]' pour une recherche elargie" },
    { tool: "rechercher_annonce_legale", context: "pour trouver des informations sur les entreprises attributaires" },
  ],
  rechercher_annonce_legale: [
    { tool: "rechercher_entreprise", context: "pour consulter directement la fiche entreprise par SIRET/nom" },
  ],
  consulter_insertion_professionnelle: [
    { tool: "consulter_parcoursup", context: "pour les formations du superieur (BTS, BUT, Licence)" },
    { tool: "consulter_resultats_lycee", context: "pour les resultats au bac de ce lycee" },
  ],
  consulter_parcoursup: [
    { tool: "consulter_insertion_professionnelle", context: "pour les donnees d'insertion apres un CAP/Bac Pro/BTS" },
    { tool: "consulter_resultats_lycee", context: "pour les resultats au bac des lycees generaux de cette ville" },
  ],
  consulter_aide_sociale: [
    { tool: "comparer_communes", context: "pour comparer les donnees sociales de plusieurs communes" },
  ],
  rechercher_fiche: [
    { tool: "rechercher", context: "pour une recherche unifiee incluant doctrine fiscale et textes legaux" },
    { tool: "lire_fiche", context: "si vous connaissez l'identifiant exact de la fiche (ex: F14929)" },
  ],
  consulter_evaluations_nationales: [
    { tool: "comparer_communes", context: "pour comparer les scores scolaires de plusieurs departements" },
  ],
  consulter_budget_commune: [
    { tool: "comparer_communes", context: "pour comparer les finances de plusieurs communes cote a cote" },
    { tool: "consulter_fiscalite_locale", context: "pour consulter les taux d'imposition locaux de cette commune" },
  ],
  rechercher_subvention: [
    { tool: "rechercher_entreprise", context: "pour verifier le SIRET d'un beneficiaire via son nom" },
    { tool: "rechercher_annonce_legale", context: "pour trouver les annonces BODACC liees a un organisme attribuant" },
  ],
  consulter_sirene_historique: [
    { tool: "rechercher_entreprise", context: "pour consulter la fiche complete d'une entreprise par SIRET/SIREN" },
    { tool: "comparer_communes", context: "pour comparer la dynamique economique de plusieurs communes" },
  ],
  rechercher_offre_emploi: [
    { tool: "consulter_insertion_professionnelle", context: "pour les statistiques d'emploi apres formation (CAP/Bac Pro/BTS)" },
    { tool: "rechercher_convention_collective", context: "pour connaitre les conditions d'emploi d'un secteur" },
  ],
};

/**
 * Retourne un message de suggestion d'outils alternatifs pour un outil donne.
 * Retourne une chaine vide si aucune alternative n'est definie.
 */
export function suggestAlternative(toolName: string, _errorContext?: string): string {
  const alternatives = ALTERNATIVES[toolName];
  if (!alternatives?.length) return "";

  const suggestions = alternatives.map(
    (alt) => `- Essayez \`${alt.tool}\` ${alt.context}.`,
  );

  return `\n\n**Alternatives disponibles :**\n${suggestions.join("\n")}`;
}
