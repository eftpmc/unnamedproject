import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Scenes, calculateScenesDuration, type ScenesProps } from './Scenes';

const defaultProps: ScenesProps = {
  title: 'Untitled',
  scenes: [{ text: 'Hello world', durationInSeconds: 3 }],
};

const fps = 30;

function RemotionRoot() {
  return (
    <Composition
      id="Scenes"
      component={Scenes}
      durationInFrames={calculateScenesDuration(defaultProps.scenes, fps)}
      fps={fps}
      width={1280}
      height={720}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: calculateScenesDuration(props.scenes, fps),
      })}
    />
  );
}

registerRoot(RemotionRoot);
