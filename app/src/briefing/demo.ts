import { Briefing, Place } from './types';

/**
 * The four briefings from design/components.html ("What's going on?"), used by
 * the simulated link and as the starting point on a real phone. On a real
 * phone only the first one applies: the phone itself knows calls and texts
 * stopped; everything else must arrive over the mesh.
 */
export type BriefingStage = 'nothing' | 'some' | 'all' | 'fixed';
export const BRIEFING_STAGES: { stage: BriefingStage; title: string }[] = [
  { stage: 'nothing', title: 'Nothing yet' }, { stage: 'some', title: 'Some known' },
  { stage: 'all', title: 'All known' }, { stage: 'fixed', title: 'Fixed' },
];

const today = (h: number, m: number): number => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
const UKPN = 'UK Power Networks';
const COUNCIL = 'Southwark Council';

const water: Place[] = [
  { id: 'cathedral', name: 'Southwark Cathedral', distance: '300 m, 4 min walk', detail: 'Free bottled water. Open until 8pm.', source: COUNCIL, at: today(14, 30), position: { lat: 51.5061, lon: -0.0899 } },
  { id: 'borough-market', name: 'Borough Market', distance: '600 m, 8 min walk', detail: 'Drinking water tap. Working.', source: COUNCIL, at: today(14, 30), position: { lat: 51.5055, lon: -0.091 } },
];
const shelter: Place[] = [
  { id: 'rest-centre', name: 'Rest centre, St George the Martyr', distance: '700 m, 9 min walk', detail: 'Warm, with blankets and hot drinks. Open all night.', source: COUNCIL, at: today(14, 30), position: { lat: 51.5016, lon: -0.093 } },
];
const charge: Place[] = [
  { id: 'library', name: 'Southwark Library', distance: '450 m, 6 min walk', detail: 'It has power. Bring your own cable. Open until 6pm.', source: COUNCIL, at: today(14, 40), position: { lat: 51.5004, lon: -0.0934 } },
];

export function demoBriefing(stage: BriefingStage): Briefing {
  const area = 'Southwark';
  const powerOff = { text: 'No power in Southwark and north Lambeth.', source: UKPN, at: today(14, 20) };
  const why = { text: 'Broken power equipment in Bankside.', source: UKPN, at: today(14, 46) };
  switch (stage) {
    case 'nothing': return {
      area, updatedAt: today(14, 5), kind: 'no-signal', headline: 'No phone signal.', subline: 'Since 2:05pm.',
      happened: { text: 'Calls, texts and internet stopped. 999 may not work.', source: 'your phone', at: today(14, 5) },
      why: null, fixed: null, places: {},
    };
    case 'some': return {
      area, updatedAt: today(14, 20), kind: 'power-off', headline: 'Power is off.', subline: 'Since 2:20pm.',
      happened: powerOff, why: null, fixed: null, places: { water, shelter },
    };
    case 'all': return {
      area, updatedAt: today(14, 46), kind: 'power-off', headline: 'Power is off.', subline: 'Back by about 8pm.',
      happened: powerOff, why, fixed: { text: 'About 8pm. Not certain.', source: UKPN, at: today(14, 46) }, places: { water, shelter, charge },
    };
    case 'fixed': return {
      area, updatedAt: today(19, 40), kind: 'fixed', headline: 'Power is back.', subline: 'Since 7:40pm.',
      happened: { text: 'Power is back on everywhere.', source: UKPN, at: today(19, 40) }, why,
      fixed: { text: 'Fixed at 7:40pm.', source: UKPN, at: today(19, 40) }, places: { water, shelter, charge },
    };
  }
}
