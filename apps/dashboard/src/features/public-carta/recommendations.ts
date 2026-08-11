import type { MenuItem } from "@42day/types";

const MAX_RECOMMENDATIONS = 3;

export function resolveCartaRecommendationIds(input: {
  apiItemIds?: string[];
  answer: string;
  menuItems: MenuItem[];
  question: string;
}): string[] {
  const visibleIds = new Set(input.menuItems.map((item) => item.id));
  const safeApiIds = unique(input.apiItemIds ?? [])
    .filter((itemId) => visibleIds.has(itemId))
    .slice(0, MAX_RECOMMENDATIONS);
  if (safeApiIds.length > 0) return safeApiIds;

  const normalizedQuestion = normalize(input.question);
  const normalizedAnswer = normalize(input.answer);
  const recommendationIntent = /(recom|suger|cual|cu[aá]l|opcion|opci[oó]n|que hay|qu[eé] hay|que tienen|qu[eé] tienen)/i.test(
    `${input.question} ${input.answer}`,
  );
  if (!recommendationIntent) return [];

  return input.menuItems
    .map((item, index) => {
      const name = normalize(item.displayName ?? item.product?.name ?? "");
      const category = normalize(item.product?.category ?? "");
      let score = 0;

      if (name.length >= 3 && normalizedAnswer.includes(name)) score += 140;
      if (name.length >= 3 && normalizedQuestion.includes(name)) score += 120;
      if (category.length >= 3 && normalizedQuestion.includes(category)) score += 90;
      if (category.length >= 3 && normalizedAnswer.includes(category)) score += 30;

      return { id: item.id, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_RECOMMENDATIONS)
    .map((entry) => entry.id);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
