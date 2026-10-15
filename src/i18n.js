// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js checks the
// German). The words follow the Gladys interface (Batterie / Batería, Zone /
// Zona, Online / En línea). Brand names (Weenect, OpenStreetMap) stay as they
// are.
// -----------------------------------------------------------------------------

/** Pick the text of a language, English as the fallback. */
export const pick = (texts, language) => texts[language] ?? texts.en;

/**
 * Feature names: fixed by Gladys when the device is created, in the language
 * of the configuration at that moment (40 characters at most).
 */
export const NAMES = {
  en: {
    position: 'Position',
    accuracy: 'Position accuracy',
    lastPosition: 'Last position',
    battery: 'Battery',
    batteryLow: 'Low battery',
    online: 'Online',
    status: 'Status',
    inZone: 'In a zone',
    zone: 'Current zone',
    zonePrefix: 'Zone',
    ring: 'Ring',
    vibrate: 'Vibrate',
    refresh: 'Ask for a position',
  },
  fr: {
    position: 'Position',
    accuracy: 'Précision de la position',
    lastPosition: 'Dernière position',
    battery: 'Batterie',
    batteryLow: 'Batterie faible',
    online: 'En ligne',
    status: 'État',
    inZone: 'Dans une zone',
    zone: 'Zone actuelle',
    zonePrefix: 'Zone',
    ring: 'Faire sonner',
    vibrate: 'Faire vibrer',
    refresh: 'Demander une position',
  },
  de: {
    position: 'Position',
    accuracy: 'Genauigkeit der Position',
    lastPosition: 'Letzte Position',
    battery: 'Batterie',
    batteryLow: 'Niedriger Batteriestand',
    online: 'Online',
    status: 'Status',
    inZone: 'In einer Zone',
    zone: 'Aktuelle Zone',
    zonePrefix: 'Zone',
    ring: 'Klingeln lassen',
    vibrate: 'Vibrieren lassen',
    refresh: 'Position anfordern',
  },
  es: {
    position: 'Posición',
    accuracy: 'Precisión de la posición',
    lastPosition: 'Última posición',
    battery: 'Batería',
    batteryLow: 'Batería baja',
    online: 'En línea',
    status: 'Estado',
    inZone: 'En una zona',
    zone: 'Zona actual',
    zonePrefix: 'Zona',
    ring: 'Hacer sonar',
    vibrate: 'Hacer vibrar',
    refresh: 'Pedir una posición',
  },
};

/** Short texts: states published as text, widget labels and buttons (24 characters at most). */
export const TEXT = {
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Fuera de línea' },
  superLive: { en: 'Super live', fr: 'Super live', de: 'Super-Live', es: 'Super live' },
  outside: {
    en: 'Outside the zones',
    fr: 'Hors zone',
    de: 'Außerhalb der Zonen',
    es: 'Fuera de las zonas',
  },
  hidden: { en: 'Hidden', fr: 'Masquée', de: 'Ausgeblendet', es: 'Oculta' },
  unknown: { en: 'Unknown', fr: 'Inconnue', de: 'Unbekannt', es: 'Desconocida' },
  zone: { en: 'Zone', fr: 'Zone', de: 'Zone', es: 'Zona' },
  status: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  lastPosition: {
    en: 'Last position',
    fr: 'Dernière position',
    de: 'Letzte Position',
    es: 'Última posición',
  },
  accuracy: { en: 'Accuracy', fr: 'Précision', de: 'Genauigkeit', es: 'Precisión' },
  map: { en: 'Map', fr: 'Carte', de: 'Karte', es: 'Mapa' },
  ring: { en: 'Ring', fr: 'Sonner', de: 'Klingeln', es: 'Sonar' },
  vibrate: { en: 'Vibrate', fr: 'Vibrer', de: 'Vibrieren', es: 'Vibrar' },
  superLiveButton: { en: 'Super live', fr: 'Super live', de: 'Super-Live', es: 'Super live' },
};

/** Sentences: widget empty states, action results, connection status (200 characters at most). */
export const MESSAGES = {
  notConfigured: {
    en: 'Enter the e-mail and password of your Weenect account in the configuration.',
    fr: 'Renseignez l’e-mail et le mot de passe de votre compte Weenect dans la configuration.',
    de: 'Gib die E-Mail und das Passwort deines Weenect-Kontos in der Konfiguration ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta Weenect en la configuración.',
  },
  credentialsRefused: {
    en: 'Weenect refused the e-mail or password. Check them in the configuration.',
    fr: 'Weenect refuse l’e-mail ou le mot de passe. Vérifiez-les dans la configuration.',
    de: 'Weenect lehnt die E-Mail oder das Passwort ab. Prüfe sie in der Konfiguration.',
    es: 'Weenect rechaza el correo o la contraseña. Compruébelos en la configuración.',
  },
  unreachable: {
    en: 'Weenect cannot be reached for now. Gladys tries again at each refresh.',
    fr: 'Weenect est injoignable pour l’instant. Gladys réessaie à chaque rafraîchissement.',
    de: 'Weenect ist gerade nicht erreichbar. Gladys versucht es bei jeder Aktualisierung erneut.',
    es: 'Weenect no está disponible por ahora. Gladys lo vuelve a intentar en cada actualización.',
  },
  rateLimited: {
    en: 'Weenect asks to slow down: the next reads are postponed by a few minutes.',
    fr: 'Weenect demande de ralentir : les prochaines lectures sont repoussées de quelques minutes.',
    de: 'Weenect bittet um eine Pause: Die nächsten Abfragen werden um einige Minuten verschoben.',
    es: 'Weenect pide ir más despacio: las próximas lecturas se aplazan unos minutos.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  noTracker: {
    en: 'No tracker on this Weenect account.',
    fr: 'Aucun traceur sur ce compte Weenect.',
    de: 'Kein Tracker in diesem Weenect-Konto.',
    es: 'Ningún localizador en esta cuenta Weenect.',
  },
  noDevice: {
    en: 'Add your trackers to Gladys first (Discover tab of the integration).',
    fr: 'Ajoutez d’abord vos traceurs à Gladys (onglet Découverte de l’intégration).',
    de: 'Füge deine Tracker zuerst zu Gladys hinzu (Reiter „Entdecken“ der Integration).',
    es: 'Añada primero sus localizadores a Gladys (pestaña Descubrir de la integración).',
  },
  trackerGone: {
    en: 'This tracker is no longer on the Weenect account.',
    fr: 'Ce traceur n’est plus sur le compte Weenect.',
    de: 'Dieser Tracker ist nicht mehr im Weenect-Konto.',
    es: 'Este localizador ya no está en la cuenta Weenect.',
  },
  waiting: {
    en: 'Waiting for the first reading of the Weenect account.',
    fr: 'En attente de la première lecture du compte Weenect.',
    de: 'Warte auf die erste Abfrage des Weenect-Kontos.',
    es: 'A la espera de la primera lectura de la cuenta Weenect.',
  },
  superLiveConfirm: {
    en: 'Super live drains the battery fast. Start it?',
    fr: 'Le super live vide vite la batterie. Le lancer ?',
    de: 'Super-Live leert den Akku schnell. Starten?',
    es: 'El super live agota rápido la batería. ¿Iniciarlo?',
  },
};

/** Messages with a value, as functions (one per language). */
export const REPORTS = {
  connected: {
    en: ({ count, names }) => `Connected to Weenect: ${count} tracker(s) (${names}).`,
    fr: ({ count, names }) => `Connecté à Weenect : ${count} traceur(s) (${names}).`,
    de: ({ count, names }) => `Mit Weenect verbunden: ${count} Tracker (${names}).`,
    es: ({ count, names }) => `Conectado a Weenect: ${count} localizador(es) (${names}).`,
  },
  failed: {
    en: ({ reason }) => `Weenect connection failed: ${reason}`,
    fr: ({ reason }) => `La connexion à Weenect a échoué : ${reason}`,
    de: ({ reason }) => `Verbindung zu Weenect fehlgeschlagen: ${reason}`,
    es: ({ reason }) => `La conexión con Weenect ha fallado: ${reason}`,
  },
  ringSent: {
    en: ({ name }) => `${name} is ringing.`,
    fr: ({ name }) => `${name} sonne.`,
    de: ({ name }) => `${name} klingelt.`,
    es: ({ name }) => `${name} está sonando.`,
  },
  vibrateSent: {
    en: ({ name }) => `${name} is vibrating.`,
    fr: ({ name }) => `${name} vibre.`,
    de: ({ name }) => `${name} vibriert.`,
    es: ({ name }) => `${name} está vibrando.`,
  },
  superLiveStarted: {
    en: ({ name }) => `Super live started on ${name} for about 5 minutes.`,
    fr: ({ name }) => `Super live lancé sur ${name} pour environ 5 minutes.`,
    de: ({ name }) => `Super-Live auf ${name} für etwa 5 Minuten gestartet.`,
    es: ({ name }) => `Super live iniciado en ${name} durante unos 5 minutos.`,
  },
  commandFailed: {
    en: ({ reason }) => `Weenect refused the command: ${reason}`,
    fr: ({ reason }) => `Weenect a refusé la commande : ${reason}`,
    de: ({ reason }) => `Weenect hat den Befehl abgelehnt: ${reason}`,
    es: ({ reason }) => `Weenect ha rechazado la orden: ${reason}`,
  },
  accuracy: {
    en: ({ meters }) => `± ${meters} m`,
    fr: ({ meters }) => `± ${meters} m`,
    de: ({ meters }) => `± ${meters} m`,
    es: ({ meters }) => `± ${meters} m`,
  },
};

/** Render a REPORTS entry in every language: the multi-language object Gladys displays. */
export function report(entry, values) {
  return Object.fromEntries(Object.entries(entry).map(([lang, fn]) => [lang, fn(values)]));
}

/** Format a date in the user's language, in the Gladys time zone (TZ, set by the supervisor). */
export function formatDate(date, language) {
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
