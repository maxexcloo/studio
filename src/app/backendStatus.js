/** Follow the connection used by the selected profile, while keeping both visible in settings. */
export function statusForProfile(status, profile) {
  if (!status.backends) return status;
  const key = profile?.kind === 'video' && profile.family !== 'grok' ? 'video' : 'primary';
  const backend = status.backends[key];
  if (!backend) return status;
  return { ...status, ...backend, label: profile?.kind === 'video' ? 'Video' : 'Images', restarting: key === 'primary' && status.restarting };
}
