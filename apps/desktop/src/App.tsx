import { BelugaMark } from '@workspace/ui/components/beluga-mark';

const recoveryMessages = new Map([
  ['listener', 'Beluga could not open its local network listener.'],
  ['resources', 'Beluga could not load the local Host files or data.'],
  ['process', 'The local Host stopped unexpectedly.'],
  ['timeout', 'The local Host took too long to start.'],
  ['window', 'Beluga could not open its app window.'],
]);

export default function App() {
  const reason = new URLSearchParams(window.location.search).get('reason') ?? '';
  const message = recoveryMessages.get(reason);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-2 px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <BelugaMark />
        Beluga could not start
      </h1>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <p className="text-sm text-muted-foreground">Exit Beluga from the tray and open it again.</p>
    </main>
  );
}
