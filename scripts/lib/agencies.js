// Curated by hand from government_apps.csv. The dataset's "purpose" field is
// inconsistent free text, so automatic agency extraction isn't reliable.
// Anything not listed here is tagged "Unclassified" rather than guessed.
export const AGENCY_MAP = Object.freeze({
  MyJPJ: 'Road Transport Department (JPJ)',
  MySejahtera: 'Ministry of Health (MOH)',
  myHealth: 'Ministry of Health (MOH)',
  myCuaca: 'Malaysian Meteorological Department (MetMalaysia)',
  myJakim: 'Department of Islamic Development Malaysia (JAKIM)',
  mySPAD: 'Land Public Transport Agency (APAD)',
  MyFoodSafe: 'Ministry of Health (MOH)',
  'myHRMIS Mobile': 'Public Service Department (JPA)',
  myKPDNKK: 'Ministry of Domestic Trade and Cost of Living (KPDN)',
  'Melaka Response': 'Melaka State Government / NADMA',
  MyRaja: 'National Disaster Management Agency (NADMA)',
  'Harga Getah': 'Malaysian Rubber Board',
  'MyGOV Malaysia': 'Malaysian Administrative Modernisation and Management Planning Unit (MAMPU)',
  'EPF i-Akaun': 'Employees Provident Fund (EPF)',
  'LHDN MyTax': 'Inland Revenue Board (LHDN)',
  PERKESO: 'Social Security Organisation (PERKESO)',
  MyPesara: 'Public Service Department (JPA)',
  'MyDigital ID': 'National Digital ID initiative',
});

export const UNCLASSIFIED = 'Unclassified';

export function tagAgency(appName, agencyMap = AGENCY_MAP) {
  return agencyMap[appName] ?? UNCLASSIFIED;
}

// Apps whose neglect carries real-world risk: health, disaster response, and
// food safety. Intentionally small and hand-picked — not every stale app
// belongs in the Hall of Shame.
export const CRITICAL_APPS = Object.freeze(
  new Set(['MySejahtera', 'myHealth', 'myCuaca', 'MyFoodSafe', 'Melaka Response', 'MyRaja'])
);

export function isCriticalApp(appName, criticalApps = CRITICAL_APPS) {
  return criticalApps.has(appName);
}
