/** Display-only list formatting. Never infer equipment, counts or capacity,
 * and leave prose/alternatives intact when an enumeration is not clear. */
function topLevelParts(value: string, separator: string): string[] {
  const parts: string[] = [];
  const brackets: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ("([{".includes(character)) brackets.push(character);
    else if (")]}".includes(character)) {
      if (brackets.pop() !== ({ ")": "(", "]": "[", "}": "{" } as Record<string, string>)[character]) return [value];
    }
    if (!brackets.length && value.slice(index, index + separator.length).toLowerCase() === separator) {
      parts.push(value.slice(start, index).trim());
      start = index + separator.length;
      index += separator.length - 1;
    }
  }
  if (brackets.length) return [value];
  parts.push(value.slice(start).trim());
  return parts;
}

const proseOrQualifier = /\b(?:or|with|without|for|that|which|if|when|until|because|must|should|fit|fits|hold|holds|preferably|optional|instead)\b/i;
const instructionStart = /^(?:do|don't|use|avoid|keep|check|ensure|never|no|only|all|each|both|if|when|unless|otherwise|provided)\b/i;
const adjectiveOnly = /^(?:(?:a|an)\s+)?(?:small|medium|large|wide|deep|shallow|heavy|nonstick|oven-safe)$/i;

function enumeration(value: string): string[] | null {
  const commas = topLevelParts(value.replace(/\.$/, ""), ",");
  if (commas.length < 2) return null;
  const last = commas.pop()!;
  const ending = /^and\s+/i.test(last) ? [last.replace(/^and\s+/i, "")] : topLevelParts(last, " and ");
  if (ending.length === 1 && !/^and\s+/i.test(last)) return null;
  const items = [...commas, ...ending];
  if (items.length < 3 || items.some(item => !item || item.length > 100
    || proseOrQualifier.test(item) || instructionStart.test(item) || adjectiveOnly.test(item)
    || topLevelParts(item, " and ").length > 1)) return null;
  return items;
}

export function equipmentDisplayItems(equipment: readonly string[]): string[] {
  return equipment.flatMap(entry => {
    const clauses = topLevelParts(entry, ";");
    if (clauses.length === 1) return enumeration(entry) ?? [entry];
    // A capacity description followed by an explicit tool list is common.
    // Other semicolons can qualify the whole list, so retain those verbatim.
    if (clauses.length !== 2 || instructionStart.test(clauses[0])) return [entry];
    const tools = enumeration(clauses[1]);
    return tools ? [clauses[0], ...tools] : [entry];
  });
}
