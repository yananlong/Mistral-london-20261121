import { Card, Txt } from '../components/ui';
import { OfflineMapProps } from './types';

export default function OfflineMap(_props: OfflineMapProps) {
  return <Card tone="quiet"><Txt>The map needs the full app. The place details are listed below.</Txt></Card>;
}
