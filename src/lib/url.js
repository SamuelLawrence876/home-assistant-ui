export function readURLParam(name, dflt) {
  const v = new URLSearchParams(window.location.search).get(name);
  return v || dflt;
}
