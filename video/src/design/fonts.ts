import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Loaded once at import; Remotion waits for both before it renders a frame.
loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
loadMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });
