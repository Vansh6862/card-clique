import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Crown, Eye, Hand, TrendingUp, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CardBacks } from "@/components/game/CardBacks";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/game/$code")({
  head: () => ({
    meta: [
      { title: "Game table — Card Clique 3 Patti" },
      {
        name: "description",
        content:
          "Live 3 Patti game table: players seated around the felt, game points, and host-controlled round winners.",
      },
      { property: "og:title", content: "Game table — Card Clique 3 Patti" },
      {
        property: "og:description",
        content: "Live 3 Patti game table with players, game points and round winners.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GameTable,
});

type Room = {
  id: string;
  code: string;
  name: string;
  host_id: string;
  status: string;
  max_players: number;
  boot_amount: number;
};

type Player = {
  id: string;
  user_id: string;
  seat: number | null;
  chips: number;
  username: string;
};

type Round = {
  id: string;
  round_number: number;
  status: string;
  pot: number;
};

type Winner = { user_id: string; amount: number };

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function GameTable() {
  const { code } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [winner, setWinner] = useState<Winner | null>(null);
  const [loading, setLoading] = useState(true);
  const [myAction, setMyAction] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<Player | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadPlayers = useCallback(async (roomId: string) => {
    const { data } = await supabase
      .from("room_players")
      .select("id, user_id, seat, chips")
      .eq("room_id", roomId)
      .order("seat", { ascending: true });
    const ids = (data ?? []).map((p) => p.user_id);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, username").in("id", ids)
      : { data: [] as { id: string; username: string }[] };
    const names = new Map((profiles ?? []).map((p) => [p.id, p.username]));
    setPlayers((data ?? []).map((p) => ({ ...p, username: names.get(p.user_id) ?? "Player" })));
  }, []);

  const loadRound = useCallback(async (roomId: string) => {
    const { data } = await supabase
      .from("game_rounds")
      .select("id, round_number, status, pot")
      .eq("room_id", roomId)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRound((data as Round | null) ?? null);
    if (data) {
      const { data: w } = await supabase
        .from("game_winners")
        .select("user_id, amount")
        .eq("round_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setWinner((w as Winner | null) ?? null);
    } else {
      setWinner(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code.toUpperCase())
        .maybeSingle();
      if (!active) return;
      setRoom((data as Room | null) ?? null);
      setLoading(false);
      if (!data) return;

      await Promise.all([loadPlayers(data.id), loadRound(data.id)]);

      channel = supabase
        .channel(`game-${data.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${data.id}` },
          () => void loadPlayers(data.id),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "game_rounds", filter: `room_id=eq.${data.id}` },
          () => void loadRound(data.id),
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "game_winners" }, () =>
          loadRound(data.id),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${data.id}` },
          (payload) => setRoom(payload.new as Room),
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [code, loadPlayers, loadRound]);

  const isHost = !!room && room.host_id === user.id;
  const seated = useMemo(() => players.filter((p) => p.user_id !== room?.host_id), [players, room]);
  const winnerName = winner ? players.find((p) => p.user_id === winner.user_id)?.username : null;

  useEffect(() => {
    if (round?.status === "finished") return;
    setMyAction(null);
    setFolded(false);
  }, [round?.id, round?.status]);

  async function act(action: string) {
    if (!round) return;
    setMyAction(action);
    if (action === "fold") setFolded(true);
    await supabase.from("game_actions").insert({
      round_id: round.id,
      user_id: user.id,
      action,
      amount: 0,
    });
    toast.success(`You chose ${action.toUpperCase()}`);
  }

  async function confirmWinner() {
    if (!room || !round || !picked) return;
    const { error } = await supabase
      .from("game_winners")
      .insert({ round_id: round.id, user_id: picked.user_id, amount: round.pot });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("game_rounds")
      .update({ status: "finished", finished_at: new Date().toISOString() })
      .eq("id", round.id);
    setConfirmOpen(false);
    setPickOpen(false);
    setPicked(null);
    toast.success(`${picked.username} wins the round`);
  }

  async function nextRound() {
    if (!room || !round) return;
    const { error } = await supabase.from("game_rounds").insert({
      room_id: room.id,
      round_number: round.round_number + 1,
      status: "in_progress",
      boot_amount: room.boot_amount,
      started_at: new Date().toISOString(),
    });
    if (error) toast.error(error.message);
  }

  if (loading) {
    return <p className="p-10 text-center text-muted-foreground">Loading table…</p>;
  }

  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="text-3xl font-bold">Room Not Found</h1>
        <p className="text-sm text-muted-foreground">
          No table matches the code {code.toUpperCase()}.
        </p>
        <Button asChild>
          <Link to="/">Back to lobby</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-40">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5">
        <div>
          <Link
            to="/room/$code"
            params={{ code: room.code }}
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            ← Lobby
          </Link>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{room.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="surface-card px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Round</p>
            <p className="font-display text-xl text-gold-gradient">{round?.round_number ?? 1}</p>
          </div>
          <div className="surface-card px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Code</p>
            <p className="font-display text-xl tracking-[0.2em] text-gold-gradient">{room.code}</p>
          </div>
        </div>
      </header>

      {isHost ? (
        <div className="mx-auto mb-2 w-full max-w-6xl px-5">
          <Badge className="gap-1 bg-gold text-gold-foreground">
            <Eye className="h-3 w-3" /> HOST / SPECTATOR
          </Badge>
        </div>
      ) : null}

      {/* Table */}
      <div className="mx-auto w-full max-w-5xl px-4">
        <div className="relative mx-auto aspect-[3/4] w-full sm:aspect-[16/10]">
          <div
            className="absolute inset-[14%] rounded-[50%] border-4 border-gold/40"
            style={{
              background:
                "radial-gradient(ellipse at 50% 30%, oklch(0.36 0.08 162) 0%, oklch(0.24 0.05 164) 70%)",
              boxShadow: "var(--shadow-table), inset 0 0 60px oklch(0.12 0.03 165 / 0.8)",
            }}
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="font-display text-2xl text-gold-gradient sm:text-4xl">CARD CLIQUE</p>
              {winnerName ? (
                <div className="animate-in fade-in zoom-in surface-card px-5 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Round winner
                  </p>
                  <p className="font-display text-xl text-gold-gradient">🏆 {winnerName}</p>
                </div>
              ) : (
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  {round?.status === "finished" ? "Round over" : "Round in play"}
                </p>
              )}
            </div>
          </div>

          {seated.map((p, i) => {
            const angle = (i / Math.max(seated.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const left = 50 + Math.cos(angle) * 42;
            const top = 50 + Math.sin(angle) * 42;
            const isWinner = winner?.user_id === p.user_id;
            const isMe = p.user_id === user.id;
            return (
              <div
                key={p.id}
                className="absolute w-24 -translate-x-1/2 -translate-y-1/2 sm:w-28"
                style={{ left: `${left}%`, top: `${top}%` }}
              >
                <div
                  className={`surface-card flex flex-col items-center gap-1 px-2 py-2 transition-all duration-300 ${
                    isWinner ? "ring-2 ring-gold shadow-[var(--shadow-gold)] scale-105" : ""
                  } ${isMe ? "border-gold/70" : ""}`}
                >
                  <Avatar className="h-9 w-9 border border-gold/50">
                    <AvatarFallback className="bg-secondary text-xs">
                      {initials(p.username)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="max-w-full truncate text-xs font-semibold">{p.username}</p>
                  <p className="text-[11px] text-gold">{p.chips} pts</p>
                  <CardBacks className="mt-1" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Host roster */}
      {isHost ? (
        <div className="mx-auto mt-4 w-full max-w-5xl px-5">
          <div className="surface-card divide-y divide-border">
            {seated.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-medium">{p.username}</span>
                <span className="text-gold">{p.chips} pts</span>
              </div>
            ))}
            {seated.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No players seated yet.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Controls */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2 px-4 py-3 sm:gap-3">
          {isHost ? (
            <>
              <Badge variant="outline" className="gap-1">
                <Crown className="h-3 w-3" /> Host / Spectator — no player actions
              </Badge>
              <Button
                onClick={() => setPickOpen(true)}
                disabled={seated.length === 0 || round?.status === "finished"}
                className="gap-2"
              >
                <Trophy className="h-4 w-4" /> Select Winner
              </Button>
              <Button variant="outline" onClick={nextRound} disabled={round?.status !== "finished"}>
                Next round
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                className="flex-1 gap-2 sm:flex-none"
                disabled={folded || round?.status === "finished"}
                onClick={() => act("play")}
              >
                <Hand className="h-4 w-4" /> PLAY HAND
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="flex-1 gap-2 sm:flex-none"
                disabled={folded || round?.status === "finished"}
                onClick={() => act("show")}
              >
                <Eye className="h-4 w-4" /> SHOW
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="flex-1 gap-2 sm:flex-none"
                disabled={folded || round?.status === "finished"}
                onClick={() => act("raise")}
              >
                <TrendingUp className="h-4 w-4" /> RAISE
              </Button>
              <Button
                size="lg"
                variant="destructive"
                className="flex-1 sm:flex-none"
                disabled={folded || round?.status === "finished"}
                onClick={() => act("fold")}
              >
                FOLD
              </Button>
              <span className="w-full text-center text-xs text-muted-foreground sm:w-auto">
                {folded
                  ? "You folded this round"
                  : myAction
                    ? `Last action: ${myAction.toUpperCase()}`
                    : "Game points only — no real money"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Winner picker */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select the round winner</DialogTitle>
            <DialogDescription>Pick the player who won this hand.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {seated.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPicked(p);
                  setConfirmOpen(true);
                }}
                className="surface-card flex items-center justify-between px-4 py-3 text-left transition hover:border-gold"
              >
                <span className="font-medium">{p.username}</span>
                <span className="text-sm text-gold">{p.chips} pts</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm winner</DialogTitle>
            <DialogDescription>
              Record {picked?.username} as the winner of round {round?.round_number ?? 1}? Everyone
              at the table will see the announcement.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmWinner}>Confirm winner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {navigate ? null : null}
    </div>
  );
}
