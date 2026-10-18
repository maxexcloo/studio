import fs from 'node:fs';
import { releaseIdentity, requireForkSigningOwnership } from '../server/release-identity.js';
import { validateReleaseTag } from './release-plan.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
validateReleaseTag(pkg.version, process.env.GITHUB_REF);
requireForkSigningOwnership(process.env.GITHUB_REPOSITORY);
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('The lockfile version does not match package.json.');
if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw new Error('A complete source commit is required.');
if (!/^sha256:[a-f0-9]{64}$/.test(process.env.HEISS_IMAGE_DIGEST || '')) throw new Error('A verified immutable container digest is required.');
process.stdout.write(`${JSON.stringify({
  commit: process.env.GITHUB_SHA,
  image: `ghcr.io/${releaseIdentity.repository}@${process.env.HEISS_IMAGE_DIGEST}`,
  repository: releaseIdentity.repository,
  tag: `v${pkg.version}`,
  version: pkg.version,
  upstream: releaseIdentity.upstream,
}, null, 2)}\n`);
