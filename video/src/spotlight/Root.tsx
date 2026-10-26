import { Composition } from "remotion";
import { DURATION, FPS, SIZE, Spotlight, type SpotlightProps } from "./Spotlight";

export const SpotlightRoot: React.FC = () => (
  <Composition id="Spotlight" component={Spotlight} durationInFrames={DURATION} fps={FPS} width={SIZE} height={SIZE} defaultProps={{ id: "97:2662" } satisfies SpotlightProps} />
);
