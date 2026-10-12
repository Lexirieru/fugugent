import { Composition } from "remotion";
import { Agents, DURATION, FPS, HEIGHT, WIDTH } from "./Agents";

export const AgentsRoot: React.FC = () => (
  <Composition id="Agents" component={Agents} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
