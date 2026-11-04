/**
 * Test stand-in for next/font/google, wired in vitest.config.ts. The real
 * loaders only work inside the Next compiler; this returns the same shape
 * (className, style, variable) so components that use fonts can render.
 */
interface FontOptions {
  variable?: string;
}

function loader(family: string) {
  const slug = family.toLowerCase();
  return (options: FontOptions = {}) => ({
    className: `test-font-${slug}`,
    style: { fontFamily: `'${family}'` },
    ...(options.variable ? { variable: `test-font-${slug}-variable` } : {}),
  });
}

export const Inter = loader("Inter");
export const Fredoka = loader("Fredoka");
