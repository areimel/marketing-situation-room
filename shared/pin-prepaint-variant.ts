/** Pins the build-time variant in the index.html pre-paint script. */
export function pinPrepaintVariant(html: string, variant: string): string {
  return html.replace(
    /if\(v\)document\.documentElement\.dataset\.variant=v;else document\.documentElement\.removeAttribute\('data-variant'\);/,
    `v='${variant}';document.documentElement.dataset.variant=v;`,
  );
}
