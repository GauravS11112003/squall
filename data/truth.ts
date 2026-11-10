/**
 * Ground truth for the synthetic storm. Used only by the evaluation script, the
 * tests and the offline simulator. The engine never imports this file.
 *
 * incident: which real fault the ticket reports (null = an unrelated one-off).
 * hostile:  the ticket carries an instruction aimed at an AI assistant.
 */
export type Truth = { incident: 'vpn' | 'sso' | 'printer' | null; hostile?: boolean };

export const TRUTH: Record<string, Truth> = {
  'T-1001': { incident: 'vpn' },
  'T-1002': { incident: null },
  'T-1003': { incident: 'vpn' },
  'T-1004': { incident: 'vpn' },
  'T-1005': { incident: null }, // VPN how-to: same product, not the outage
  'T-1006': { incident: 'vpn' },
  'T-1007': { incident: 'printer' },
  'T-1008': { incident: 'vpn' }, // Spanish
  'T-1009': { incident: 'vpn' },
  'T-1010': { incident: null },
  'T-1011': { incident: 'vpn' }, // disagrees on when it started
  'T-1012': { incident: 'sso' },
  'T-1013': { incident: 'vpn' },
  'T-1014': { incident: 'vpn' },
  'T-1015': { incident: null },
  'T-1016': { incident: 'vpn' },
  'T-1017': { incident: 'vpn', hostile: true },
  'T-1018': { incident: 'sso' },
  'T-1019': { incident: 'vpn' },
  'T-1020': { incident: null }, // VPN slow abroad: a different case
  'T-1021': { incident: 'vpn' },
  'T-1022': { incident: 'sso' },
  'T-1023': { incident: 'vpn' },
  'T-1024': { incident: null },
  'T-1025': { incident: 'sso' },
  'T-1026': { incident: 'vpn' },
  'T-1027': { incident: 'printer' },
  'T-1028': { incident: null }, // Keyring how-to: same product, not the outage
  'T-1029': { incident: 'sso' },
  'T-1030': { incident: 'vpn' },
  'T-1031': { incident: null },
  'T-1032': { incident: 'sso' },
  'T-1033': { incident: null },
  'T-1034': { incident: 'vpn' }, // follow-up in a thread
  'T-1035': { incident: 'sso' },
  'T-1036': { incident: 'printer' },
  'T-1037': { incident: 'vpn' }, // follow-up in a thread
  'T-1038': { incident: null },
};

/** Which true faults an incident manager would call a major incident. */
export const MAJOR: Record<string, boolean> = { vpn: true, sso: true, printer: false };
