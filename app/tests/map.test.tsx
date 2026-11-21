import { render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import MapCanvas from '../src/map/MapCanvas';

jest.mock('@maplibre/maplibre-react-native', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Map: ({ children }: { children: ReactNode }) => react.createElement(View, null, children),
    Camera: () => null,
    Marker: ({ children, id, lngLat }: { children: ReactNode; id: string; lngLat: [number, number] }) =>
      react.createElement(View, { testID: `pin-${id}`, accessibilityLabel: lngLat.join(',') }, children),
  };
});

test('native map pins show the sharer’s nickname at the shared coordinates', async () => {
  await render(<MapCanvas uri="file:///london.pmtiles" focus={null} points={[
    { id: 'peer-1', label: 'Responder Sam', kind: 'peer', position: { lat: 51.5055, lon: -0.1195 } },
  ]} />);
  const pin = screen.getByTestId('pin-peer-1');
  expect(pin).toHaveProp('accessibilityLabel', '-0.1195,51.5055');
  expect(within(pin).getByText('Responder Sam')).toBeTruthy();
});

test('map is navigable: zoom in/out and recenter controls are present', async () => {
  await render(<MapCanvas uri="file:///london.pmtiles" focus={null} points={[]} />);
  expect(screen.getByLabelText('Zoom in')).toBeTruthy();
  expect(screen.getByLabelText('Zoom out')).toBeTruthy();
  expect(screen.getByLabelText('Center on selected position')).toBeTruthy();
});
