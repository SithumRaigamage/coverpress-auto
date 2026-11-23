/* Acceptable use, as data.

   The frontend renders this; keeping it out of the server means the rules are
   one source of truth for web, CLI output and any future app. Wording is plain
   language, not a substitute for counsel-reviewed terms. */

export const LEGAL = {
  title: "Acceptable use",
  summary: "Making a case insert for a game you own, for your own shelf. That is the whole intended use.",
  sections: [
    {
      heading: "What you may not do",
      bullets: [
        "Sell, license or distribute covers made here, or use them as part of a paid product or service.",
        "Upload artwork you do not have the right to use, or ask this service to reproduce another party's logo lockup.",
        "Present the output as official, licensed or endorsed by Sony, Microsoft, a publisher or a rating board.",
      ],
    },
    {
      heading: "What this service does not do",
      paragraphs: [
        "It does not draw, fetch or embed the PlayStation logo or wordmark, ESRB or PEGI marks, Blu-ray, Dolby or DTS marks, or publisher logos. Platform names appear only as plain lettering to say which case the wrap fits. Every wrap carries a personal-use, not-official, not-for-sale line.",
      ],
    },
    {
      heading: "Artwork you upload",
      paragraphs: [
        "You keep whatever rights you have in it. You confirm you have permission to use it. Uploaded art and the resulting renders are served only from this deployment. Removing a cover removes its files from disk.",
      ],
    },
    {
      heading: "Third-party data",
      paragraphs: [
        "Game metadata comes from RAWG when you supply a key; RAWG's terms govern that use and its attribution is printed on the back panel. No third-party image library is bundled with this deployment. SteamGridDB is not connected: its terms are personal, non-commercial use only.",
      ],
    },
    {
      heading: "Takedown",
      paragraphs: [
        "Rights holders can ask the operator of this deployment to remove content. Accounts or covers that ignore the rules above are removed.",
      ],
    },
  ],
};
