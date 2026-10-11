import { Composition } from "remotion";
import { DURATION, FPS, HEIGHT, Launch, WIDTH } from "./Launch";

export const LaunchRoot: React.FC = () => (
  <Composition id="Launch" component={Launch} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
