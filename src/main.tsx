// First: browser storage under its old HEISS UI names moves to Studio's before anything reads it.
import "./app/storageMigration";
import "./app/domGuard";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./styles.css";

import { useStudio } from './app/useStudio';
import { StudioView } from './app/StudioView';
import { DeviceGate } from './app/DeviceGate';
import { CrashBoundary } from './app/CrashScreen';
import { TooltipProvider } from './components/ui/tooltip';

function App() {
  const { view, confirmationDialog } = useStudio();
  return (
    <>
      <StudioView view={view} />
      {confirmationDialog}
    </>
  );
}

// Other devices sign in before the studio loads (DeviceGate.tsx).
// A render error anywhere shows the crash screen (with Reload and Report) instead of a blank page.
// One tooltip provider for the whole app holds the shared hover delay and lets neighbours open at once.
// Framer Motion follows the system reduced-motion setting, as the CSS animations do.
createRoot(document.getElementById("root")!).render(<MotionConfig reducedMotion="user"><TooltipProvider><CrashBoundary><DeviceGate><App /></DeviceGate></CrashBoundary></TooltipProvider></MotionConfig>);
