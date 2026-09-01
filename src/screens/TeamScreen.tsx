import { Dashboard } from "@/components/dashboard";

export function TeamScreen({
  go,
}: {
  go: { matters: () => void; tasks: () => void; diary: () => void; clients: () => void };
}) {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Dashboard go={go} />
    </div>
  );
}
