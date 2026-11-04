/** A badge shown with the recipe title, such as "Vegetarian". The caller
 * supplies only explicit, supported metadata; an empty allergen list never
 * establishes a free-from claim. */
export interface CookingMealAttribute {
  label: string;
  detail?: string;
}
