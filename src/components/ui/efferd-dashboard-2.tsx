import { Dashboard } from "@/components/dashboard";

/**
 * Aletheia's adapted installation of the Efferd dashboard-2 block.
 *
 * The registry layout has been connected to the app's real local dataset,
 * indexing, export, and system-health queries through the existing dashboard
 * components instead of retaining the registry's sample revenue data.
 */
export function EfferdDashboard2() {
  return <Dashboard />;
}
