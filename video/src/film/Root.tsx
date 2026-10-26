import { Composition } from "remotion";
import { DURATION, FPS, HEIGHT, WIDTH, Film } from "./Film";

export const FilmRoot: React.FC = () => <Composition id="Film" component={Film} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />;
