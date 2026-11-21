// Reference template for scene-writer agents. Each generated scene file must
// export a named `Scene` component like this one. Delete-safe: the pipeline
// only imports files listed in scenes/manifest.json.
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing} from 'remotion';

export const Scene = () => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#101418',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
        opacity,
      }}
    >
      <div style={{color: '#e8eaed', fontSize: 72}}>Scene</div>
    </AbsoluteFill>
  );
};
