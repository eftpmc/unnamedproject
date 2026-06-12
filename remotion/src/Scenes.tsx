import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, Img } from 'remotion';

export interface VideoScene {
  text: string;
  durationInSeconds: number;
  imageUrl?: string;
}

export interface ScenesProps {
  title: string;
  scenes: VideoScene[];
}

function Scene({ scene }: { scene: VideoScene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps / 2], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }}>
      {scene.imageUrl && (
        <Img src={scene.imageUrl} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
      )}
      <div style={{ opacity, color: 'white', fontSize: 64, fontFamily: 'sans-serif', textAlign: 'center', padding: '0 80px', zIndex: 1 }}>
        {scene.text}
      </div>
    </AbsoluteFill>
  );
}

export function Scenes({ scenes }: ScenesProps) {
  const { fps } = useVideoConfig();
  let startFrame = 0;
  return (
    <AbsoluteFill>
      {scenes.map((scene, i) => {
        const durationInFrames = Math.round(scene.durationInSeconds * fps);
        const from = startFrame;
        startFrame += durationInFrames;
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <Scene scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export function calculateScenesDuration(scenes: VideoScene[], fps: number): number {
  return scenes.reduce((sum, s) => sum + Math.round(s.durationInSeconds * fps), 0);
}
