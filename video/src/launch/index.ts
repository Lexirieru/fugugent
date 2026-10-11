import { registerRoot } from "remotion";
import { LaunchRoot } from "./Root";

// Its own entry point, so the launch film renders without the older narrated demo's
// generated audio (`public/audio/`) being present.
registerRoot(LaunchRoot);
