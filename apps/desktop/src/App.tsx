import { BelugaMark } from '@workspace/ui/components/beluga-mark';

export default function App() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-2 px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <BelugaMark />
        Beluga could not start
      </h1>
      <p className="text-sm text-muted-foreground">Exit Beluga from the tray and open it again.</p>
    </main>
  );
}
