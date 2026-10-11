import { Composition } from "remotion";
import { DURATION, FPS, HEIGHT, Quest, WIDTH } from "./Quest";

export const QuestRoot: React.FC = () => (
  <Composition id="Quest" component={Quest} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
