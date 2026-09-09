import { Composition } from "remotion";
import { Demo, demoDurationInFrames, FPS, HEIGHT, WIDTH } from "./Demo";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    /*
     * The length is computed from the measured audio, not typed in. Every scene lasts as
     * long as its own voice clip plus a beat, so a sentence can never be cut off by a
     * number somebody forgot to update after rewriting the script.
     */
    durationInFrames={demoDurationInFrames()}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
