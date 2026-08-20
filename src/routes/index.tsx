import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { createRoom, joinRoom } from "@/lib/rooms";
import heroTable from "@/assets/hero-table.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "3 Patti — Create or Join a Private Teen Patti Table" },
      {
        name: "description",
        content:
          "Start a private 3 Patti table in seconds or join friends with a 6-character room code. Live multiplayer, no downloads.",
      },
      { property: "og:title", content: "3 Patti — Create or Join a Private Teen Patti Table" },
      {
        property: "og:description",
        content:
          "Start a private 3 Patti table in seconds or join friends with a 6-character room code.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  function requireAuth(open: () => void) {
    if (!user) {
      navigate({ to: "/auth", search: { redirect: "/" } });
      return;
    }
    open();
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6">
        <Link to="/" className="font-display text-xl font-bold tracking-wide">
          <span className="text-gold-gradient">3 Patti</span>
        </Link>
        <div className="flex items-center gap-2">
          {loading ? null : user ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {user.email}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await supabase.auth.signOut();
                  toast.success("Signed out");
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth" search={{ redirect: "/" }}>
                Sign in
              </Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-24">
        <section className="grid items-center gap-10 py-10 lg:grid-cols-2 lg:py-16">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Live multiplayer tables
            </p>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              Deal your friends into a round of{" "}
              <span className="text-gold-gradient">3 Patti</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
              Spin up a private table, share the six-character code, and everyone joins
              instantly from any device. No app installs, no chips to count.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={() => requireAuth(() => setCreateOpen(true))}>
                Create Room
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => requireAuth(() => setJoinOpen(true))}
              >
                Join Room
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Play money only — the table game itself is coming soon.
            </p>
          </div>

          <div className="surface-card overflow-hidden">
            <img
              src={heroTable}
              width={1600}
              height={1008}
              alt="Three ornate 3 Patti cards face down on a green felt table with gold and red chips"
              className="h-full w-full object-cover"
            />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Private tables",
              body: "Every room gets a unique code. Only people you share it with can sit down.",
            },
            {
              title: "Realtime seats",
              body: "Players appear the moment they join, with live seat and chip updates.",
            },
            {
              title: "Play anywhere",
              body: "Built mobile-first, so the table works on a phone as well as a laptop.",
            },
          ].map((f) => (
            <div key={f.title} className="surface-card p-5">
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinRoomDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </div>
  );
}

function CreateRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("6");
  const [bootAmount, setBootAmount] = useState("10");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const room = await createRoom({
        name: name.trim() || "My 3 Patti table",
        maxPlayers: Number(maxPlayers),
        bootAmount: Number(bootAmount) || 10,
        isPrivate,
      });
      toast.success(`Table created — code ${room.code}`);
      onOpenChange(false);
      navigate({ to: "/room/$code", params: { code: room.code } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the table.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a table</DialogTitle>
          <DialogDescription>
            You'll be seated as the host and get a code to share.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="room-name">Table name</Label>
            <Input
              id="room-name"
              value={name}
              placeholder="Friday night 3 Patti"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-players">Max players</Label>
              <Select value={maxPlayers} onValueChange={setMaxPlayers}>
                <SelectTrigger id="max-players">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} players
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="boot">Boot amount</Label>
              <Input
                id="boot"
                type="number"
                min={1}
                value={bootAmount}
                onChange={(e) => setBootAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="private">Private table</Label>
              <p className="text-xs text-muted-foreground">Joinable only with the code.</p>
            </div>
            <Switch id="private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? "Creating…" : "Create table"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleJoin() {
    setBusy(true);
    try {
      const room = await joinRoom(code);
      onOpenChange(false);
      navigate({ to: "/room/$code", params: { code: room.code } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not join that table.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a table</DialogTitle>
          <DialogDescription>Enter the six-character code you were sent.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="code">Room code</Label>
          <Input
            id="code"
            value={code}
            maxLength={6}
            placeholder="A7K2QP"
            className="text-center font-display text-2xl tracking-[0.4em] uppercase"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleJoin} disabled={busy || code.trim().length < 4}>
            {busy ? "Joining…" : "Join table"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
