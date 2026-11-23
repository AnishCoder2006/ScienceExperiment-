import type { Concept } from "./types";

// The 5 concepts from the assignment. `text` is copied word for word from the brief.
// `keyTerms` powers our own check: a diagram must label the terms a GCSE student needs.
export const CONCEPTS: Concept[] = [
  {
    id: 1,
    name: "Pythagoras' theorem",
    subject: "Maths",
    text: "In a right-angled triangle, the longest side is called the hypotenuse. The square of the hypotenuse is equal to the sum of the squares of the other two sides: a² + b² = c².",
    keyTerms: [
      { name: "hypotenuse", pattern: /hypotenuse/ },
      // Matches "a² + b² = c²", "a^2+b^2=c^2", "a 2 + b 2 = c 2" (tspan superscripts)
      // and the reversed "c² = a² + b²", after ² has been normalised to 2.
      {
        name: "the equation a² + b² = c²",
        pattern: /a ?\^? ?2 ?\+ ?b ?\^? ?2 ?= ?c ?\^? ?2|c ?\^? ?2 ?= ?a ?\^? ?2 ?\+ ?b ?\^? ?2/,
      },
    ],
  },
  {
    id: 2,
    name: "Parts of a circle",
    subject: "Maths",
    text: "A circle has a centre. The radius is the distance from the centre to the edge. The diameter goes across the circle through the centre and is twice the radius. The circumference is the distance around the circle.",
    keyTerms: [
      { name: "centre", pattern: /centre|center/ },
      { name: "radius", pattern: /radius/ },
      { name: "diameter", pattern: /diameter/ },
      { name: "circumference", pattern: /circumference/ },
    ],
  },
  {
    id: 3,
    name: "Series circuit",
    subject: "Physics",
    text: "In a series circuit there is only one loop. The current is the same everywhere in the loop. The voltage of the cell is shared between the components.",
    keyTerms: [
      { name: "cell", pattern: /\bcell\b|battery/ },
      { name: "current", pattern: /current/ },
      { name: "voltage", pattern: /voltage|potential difference/ },
    ],
  },
  {
    id: 4,
    name: "Photosynthesis",
    subject: "Biology",
    text: "Plants take in carbon dioxide and water. They use light energy, absorbed by chlorophyll, to make glucose and oxygen.",
    keyTerms: [
      { name: "carbon dioxide (CO2)", pattern: /carbon dioxide|co2/ },
      { name: "water (H2O)", pattern: /water|h2o/ },
      { name: "light", pattern: /light/ },
      { name: "chlorophyll", pattern: /chlorophyll/ },
      { name: "glucose", pattern: /glucose/ },
      { name: "oxygen (O2)", pattern: /oxygen|\bo2\b/ },
    ],
  },
  {
    id: 5,
    name: "States of matter",
    subject: "Chemistry",
    text: "In a solid the particles are close together and vibrate in place. In a liquid they are close but move past each other. In a gas they are far apart and move fast.",
    keyTerms: [
      { name: "solid", pattern: /solid/ },
      { name: "liquid", pattern: /liquid/ },
      { name: "gas", pattern: /\bgas\b/ },
    ],
  },
];

export function getConcept(id: number): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id);
}
