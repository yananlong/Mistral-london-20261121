import { SchematicMap } from './SchematicMap';
import { OfflineMapProps } from './types';

/** Web and Expo Go: no MapLibre, so the places are drawn in the right direction on a plain field. */
export default function OfflineMap({ points, height }: OfflineMapProps) {
  return <SchematicMap points={points} height={height} />;
}
