/**
 * First aid that works on the phone with nothing connected. One step at a
 * time. The wording follows the guidance the app already shipped as canned
 * answers (NHS / St John Ambulance basics); it never promises 999 works and
 * points to SOS instead.
 */
export interface FirstAidGuide { id: string; title: string; steps: string[] }

export const FIRST_AID: FirstAidGuide[] = [
  { id: 'bleeding', title: 'Heavy bleeding', steps: [
    'Press firmly on the wound with a clean cloth or dressing.',
    'Keep pressing. Do not lift it to look.',
    'If something is stuck in the wound, leave it in. Press around it.',
    'Keep the person warm and lying down. Send SOS if a life is at risk.',
  ] },
  { id: 'burn', title: 'Burn', steps: [
    'Cool the burn under cool running water for 20 minutes.',
    'Take off rings and loose clothing near it. Leave anything stuck to the skin.',
    'Lay cling film loosely over it. No ice, no creams.',
    'A large, deep, chemical or electrical burn needs urgent help. Send SOS.',
  ] },
  { id: 'carbon', title: 'Carbon monoxide', steps: [
    'Get everyone into fresh air now. Do not go back inside.',
    'Signs: headache, dizziness, feeling sick, weakness, confusion, short of breath.',
    'Never use a generator, barbecue or camping stove indoors.',
    'If someone is unwell, send SOS and say you think it is carbon monoxide.',
  ] },
  { id: 'cold', title: 'Too cold', steps: [
    'Move to a dry room and close the doors.',
    'Take off wet clothes. Put on dry layers and a hat.',
    'Share blankets and stay close together.',
    'Give warm, sweet drinks. No alcohol.',
  ] },
];
