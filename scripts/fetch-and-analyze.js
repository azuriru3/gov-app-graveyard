import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchGovAppsCsv, parseGovAppsCsv, dedupeApps } from './lib/csv.js';
import { classifyApp, STATUS } from './lib/classify.js';
import { tagAgency, isCriticalApp } from './lib/agencies.js';
import { buildHallOfShame } from './lib/hallOfShame.js';
import { crossCheckIosApps } from './lib/itunes.js';
import { validateDataset } from './lib/validate.js';

export async function generateDataset({ fetchImpl = fetch, today = new Date() } = {}) {
  const csvText = await fetchGovAppsCsv(fetchImpl);
  const rows = parseGovAppsCsv(csvText);
  const apps = dedupeApps(rows);

  const iosApps = apps.filter((app) => app.platforms.includes('iOS'));
  const itunesResults = await crossCheckIosApps(iosApps, { fetchImpl });

  const analyzedApps = apps.map((app) => {
    const itunes = itunesResults.get(app.appId) ?? null;
    const effectiveLastUpdated = itunes?.currentVersionReleaseDate
      ? itunes.currentVersionReleaseDate.slice(0, 10)
      : app.lastUpdated;
    const status = classifyApp({ shutdown: app.shutdown, lastUpdated: effectiveLastUpdated }, today);

    return {
      ...app,
      lastUpdated: effectiveLastUpdated,
      status,
      agency: tagAgency(app.appName),
      isCritical: isCriticalApp(app.appName),
      itunes,
    };
  });

  const summary = {
    totalApps: analyzedApps.length,
    shutdownCount: analyzedApps.filter((a) => a.status === STATUS.SHUTDOWN).length,
    freshCount: analyzedApps.filter((a) => a.status === STATUS.FRESH).length,
    staleCount: analyzedApps.filter((a) => a.status === STATUS.STALE).length,
    abandonedCount: analyzedApps.filter((a) => a.status === STATUS.ABANDONED).length,
  };

  return {
    generatedAt: today.toISOString(),
    summary,
    apps: analyzedApps,
    hallOfShame: buildHallOfShame(analyzedApps),
  };
}

async function main() {
  const dataset = await generateDataset();
  const { valid, errors } = validateDataset(dataset);
  if (!valid) {
    console.error('Generated dataset failed validation:', errors.join('; '));
    process.exit(1);
  }
  const outPath = new URL('../data.json', import.meta.url);
  await writeFile(outPath, JSON.stringify(dataset, null, 2));
  console.log(`Wrote data.json with ${dataset.apps.length} apps.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
