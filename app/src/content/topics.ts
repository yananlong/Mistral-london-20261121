import { TopicId } from '../briefing/types';
import type { IconName } from '../components/ui';

/** Six topics with pictures that follow public signs. The question becomes the sheet title. */
export const TOPICS: Record<TopicId, { name: string; icon: IconName; question: string }> = {
  water: { name: 'Water', icon: 'local-drink', question: 'Where can I get drinking water?' },
  charge: { name: 'Charge phone', icon: 'battery-charging-full', question: 'Where can I charge my phone?' },
  food: { name: 'Food', icon: 'restaurant', question: 'Where can I get food?' },
  family: { name: 'Family', icon: 'family-restroom', question: 'How can I reach my family?' },
  shelter: { name: 'Shelter', icon: 'night-shelter', question: 'Where can I stay warm and safe?' },
  firstAid: { name: 'First aid', icon: 'medical-services', question: 'What do I do?' },
};
