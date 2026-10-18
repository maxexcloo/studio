/** Only explicitly local task notes are exempt from release cleanliness checks. */
export function releaseChanges(status) {
  return String(status).split('\n').filter(line => line && line !== '?? todo.md' && line !== '?? questions.md');
}

export function validateReleaseTag(version, ref) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) throw new Error('A numeric Semantic Version is required.');
  if (ref !== `refs/tags/v${version}`) throw new Error('The immutable release tag must match package.json.');
}
