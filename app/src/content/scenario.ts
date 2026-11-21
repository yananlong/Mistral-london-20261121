import type { ComponentProps } from 'react';
import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Coordinates } from '../protocol';

/**
 * Content that is stored on the phone: the demo briefing, the six topics,
 * places people have shared, and offline first-aid guides. Mirrors the
 * scenario in design/components.html (a UK-wide blackout).
 *
 * The hub does not broadcast news or places over the mesh yet, so the briefing
 * and places come from here. Questions still go to the hub for real answers.
 */
export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export interface Fact { text: string; source: string }
export type Answer = Fact | null; // null = "Not known yet"
export type NewsKey = 'none' | 'some' | 'all' | 'fixed';
export interface Briefing {
  name: string; icon: IconName; done?: boolean;
  display: string; sub: string; updated: string;
  rows: [Answer, Answer, Answer];
}

const ORG = 'National Grid';
export const BRIEFING_QUESTIONS = ['What happened?', 'Why?', 'When will it be fixed?'] as const;
export const NEWS: Record<NewsKey, Briefing> = {
  none: {
    name: 'Nothing yet', icon: 'signal-cellular-off', display: 'No phone signal.', sub: 'Across the UK, since 2:05pm.', updated: '2:05pm',
    rows: [{ text: 'Calls, texts and internet stopped everywhere in the UK. 999 may not work.', source: 'From your phone, 2:05pm' }, null, null],
  },
  some: {
    name: 'Some known', icon: 'power-off', display: 'Power disruption.', sub: 'Across the UK, since 2:20pm.', updated: '2:20pm',
    rows: [{ text: 'No power, mobile signal or internet anywhere in the UK.', source: `From ${ORG}, 2:20pm` }, null, null],
  },
  all: {
    name: 'More known', icon: 'power-off', display: 'Power disruption.', sub: 'Across the UK, since 2:20pm.', updated: '2:46pm',
    rows: [
      { text: 'No power, mobile signal or internet anywhere in the UK.', source: `From ${ORG}, 2:20pm` },
      { text: 'A fault in the national grid. Engineers are on site.', source: `From ${ORG}, 2:46pm` },
      null,
    ],
  },
  fixed: {
    name: 'Fixed', icon: 'check-circle', done: true, display: 'Power is back.', sub: 'Across the UK, since 7:40pm.', updated: '7:40pm',
    rows: [
      { text: 'Power, mobile signal and internet are back across the UK.', source: `From ${ORG}, 7:40pm` },
      { text: 'A fault in the national grid.', source: `From ${ORG}, 2:46pm` },
      { text: 'Fixed at 7:40pm.', source: `From ${ORG}, 7:40pm` },
    ],
  },
};
export const NEWS_ORDER: NewsKey[] = ['none', 'some', 'all', 'fixed'];

export type TopicKey = 'water' | 'charge' | 'food' | 'family' | 'shelter' | 'firstaid';
export interface Topic { key: TopicKey; icon: IconName; label: string; question: string }
export const TOPICS: Topic[] = [
  { key: 'water', icon: 'local-drink', label: 'Water', question: 'Where can I get drinking water?' },
  { key: 'charge', icon: 'battery-charging-full', label: 'Charge phone', question: 'Where can I charge my phone?' },
  { key: 'food', icon: 'restaurant', label: 'Food', question: 'Where can I get food?' },
  { key: 'family', icon: 'family-restroom', label: 'Family', question: 'How can I reach my family?' },
  { key: 'shelter', icon: 'night-shelter', label: 'Shelter', question: 'Where can I stay warm and sleep?' },
  { key: 'firstaid', icon: 'medical-services', label: 'First aid', question: 'Someone is hurt. What do I do?' },
];
export const topic = (key: TopicKey): Topic => TOPICS.find(item => item.key === key)!;

export interface Place { id: string; name: string; text: string; source: string; position: Coordinates }
const COUNCIL = 'Southwark Council';
/** Places near the demo position (Borough High Street, London). Names and times are fictional. */
export const PLACES: Partial<Record<TopicKey, Place[]>> = {
  water: [
    { id: 'water-1', name: 'Southwark Cathedral', text: 'Free bottled water. Open until 8pm.', source: `From ${COUNCIL}, 2:30pm`, position: { lat: 51.5061, lon: -0.0897 } },
    { id: 'water-2', name: 'Borough Market', text: 'Drinking water tap. Working.', source: `From ${COUNCIL}, 2:30pm`, position: { lat: 51.5055, lon: -0.0910 } },
  ],
  charge: [
    { id: 'charge-1', name: 'Southwark Library', text: 'Generator power. Bring your own cable. Open until 6pm.', source: `From ${COUNCIL}, 2:40pm`, position: { lat: 51.5006, lon: -0.0937 } },
    { id: 'charge-2', name: "Guy's Hospital", text: 'Generator power at the main entrance. Bring your own cable.', source: `From ${COUNCIL}, 2:40pm`, position: { lat: 51.5033, lon: -0.0873 } },
  ],
  food: [],
  shelter: [
    { id: 'shelter-1', name: 'Harper Road rest centre', text: 'Warm room, beds and hot drinks. Generator. Open all night.', source: `From ${COUNCIL}, 2:50pm`, position: { lat: 51.4960, lon: -0.0930 } },
  ],
};

/** What exists depends on how much news has arrived. */
export function placesFor(key: TopicKey, news: NewsKey): Place[] | null {
  if (news === 'none') return null;
  if (key === 'charge' && news === 'some') return null;
  const places = PLACES[key];
  return places && places.length ? places : null;
}

/** Offline first-aid guides: always on the phone, always work. Plain words, one step per line. */
export interface Guide { title: string; steps: string[] }
export const FIRST_AID: Guide[] = [
  { title: 'Bleeding', steps: [
    'Press hard on the wound with a clean cloth.',
    'Keep pressing for at least 10 minutes. Do not lift to check.',
    'If blood soaks through, put more cloth on top and keep pressing.',
    'Raise the injured part if you can.',
    'Keep them lying down and warm. Send SOS.',
  ] },
  { title: 'Not breathing', steps: [
    'Shout for help. Send SOS.',
    'Lay them on their back on a firm surface.',
    'Push hard and fast in the centre of the chest, about 2 pushes a second.',
    'Push down about 5 to 6 cm, and let the chest come back up.',
    'Do not stop until they breathe or someone takes over.',
  ] },
  { title: 'Burns', steps: [
    'Cool the burn under cool running water for 20 minutes.',
    'Take off rings, watches and clothing near it, unless stuck to the skin.',
    'Cover it loosely with cling film or a clean plastic bag.',
    'No ice, butter or creams.',
    'Get help for large burns, or burns to the face, hands or feet.',
  ] },
  { title: 'Broken bone', steps: [
    'Keep the injured part still, in the position you found it.',
    'Do not try to straighten it.',
    'Support it with padding, such as rolled-up clothes.',
    'Cool it with something cold wrapped in cloth.',
    'Send SOS if the bone is through the skin or they look pale and cold.',
  ] },
  { title: 'Very cold', steps: [
    'Move them somewhere warmer, out of the wind.',
    'Swap wet clothes for dry ones.',
    'Wrap them in blankets. Cover the head.',
    'If awake, give warm sweet drinks. No alcohol.',
    'Warm them slowly. Send SOS if they are confused or very sleepy.',
  ] },
];
