import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  advanceTurn,
  adjustPoints,
  fetchLatestRound,
  fetchRoomByCode,
  fetchSeats,
  fetchWinners,
  nextRound,
  selectWinner,
  startGame,
  type Room,
  type Round,
  type Seat,
} from "@/lib/game";

export const Route = createFileRoute("/_authenticated/room/$code")({
  head: () => ({
    meta: [
      { title: "Table lobby — Card Clique" },
      {
        name: "description",
        content: "Track players, turns, points and round winners for your live card table.",
      },
      { property: "og:title", content: "Table lobby — Card Clique" },
      {
        property: "og:description",
        content: "Track players, turns, points and round winners for your live card table.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RoomLobby,
});

function RoomLobby() {
  const { code } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  const [room, setRoom] = useState<Room | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [winners, setWinners] = useState<{ round_number: number; user_id: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState<Record<string, string>>({});

  const isHost = !!room && room.host_id === user.id;

  const refresh = useCallback(async (roomId: string) => {
    const [nextSeats, latestRound, roundWinners] = await Promise.all([
      fetchSeats(roomId),
      fetchLatestRound(roomId),
      fetchWinners(roomId),
    ]);
    setSeats(nextSeats);
    setRound(latestRound);
    setWinners(roundWinners);
  }, []);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const data = await fetchRoomByCode(code).catch(() => null);
      if (!active) return;
      setRoom(data);
      setLoading(false);
      if (!data) return;
      await refresh(data.id);

      channel = supabase
        .channel(`room-${data.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${data.id}` },
          () => void refresh(data.id),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "game_rounds", filter: `room_id=eq.${data.id}` },
          () => void refresh(data.id),
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "game_winners" }, () =>
          refresh(data.id),
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
      if (channel) supabase.removeChannel(channel);
    };
  }, [code, refresh]);

  useEffect(() => {
    setPoints((prev) => {
      const next = { ...prev };
      for (const seat of seats) if (next[seat.user_id] === undefined) next[seat.user_id] = "1000";
      return next;
    });
  }, [seats]);

  const me = seats.find((s) => s.user_id === user.id);
  const started = room?.status === "playing" && !!round;
  const roundActive = started && round?.status === "active";
  const myTurn = roundActive && round?.current_turn_user_id === user.id;
  const turnPlayer = seats.find((s) => s.user_id === round?.current_turn_user_id);
  const lastWinner = useMemo(() => {
    const finished = winners.filter((w) => w.round_number <= (round?.round_number ?? 0));
    const latest = finished.sort((a, b) => b.round_number - a.round_number)[0];
    if (!latest) return null;
    return {
      ...latest,
      username: seats.find((s) => s.user_id === latest.user_id)?.username ?? "Player",
    };
  }, [winners, seats, round]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      if (label) toast.success(label);
      if (room) await refresh(room.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!room) return;
    await supabase.from("room_players").delete().eq("room_id", room.id).eq("user_id", user.id);
    toast.success("You left the table");
    navigate({ to: "/" });
  }

  if (loading) {
    return <p className="p-10 text-center text-muted-foreground">Loading table…</p>;
  }

  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5">
        <h1 className="text-2xl font-bold">Table not found</h1>
        <p className="text-sm text-muted-foreground">The code {code} doesn't match any table.</p>
        <Button asChild>
          <Link to="/">Back home</Link>
        </Button>
      </div>
    );
  }

  const status = !started
    ? "WAITING"
    : roundActive
      ? myTurn
        ? "YOUR TURN"
        : `${turnPlayer?.username ?? "PLAYER"}'S TURN`
      : "ROUND COMPLETE";

  const empty = Math.max(0, room.max_players - seats.length);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/" className="text-xs uppercase tracking-widest text-muted-foreground">
            ← Lobby
          </Link>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{room.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Physical cards at the table · up to {room.max_players} players
          </p>
        </div>
        <div className="surface-card px-5 py-4 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Room code</p>
          <p className="font-display text-3xl tracking-[0.3em] text-gold-gradient">{room.code}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => {
              void navigator.clipboard.writeText(room.code);
              toast.success("Code copied");
            }}
          >
            Copy code
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="surface-card mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Status</p>
          <p className="font-display text-xl">{status}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Round</p>
          <p className="font-display text-xl">{started ? round?.round_number : "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Your points</p>
          <p className="font-display text-xl">{me?.chips ?? 0}</p>
        </div>
      </div>

      {lastWinner ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Round {lastWinner.round_number} winner:{" "}
          <span className="font-semibold text-foreground">{lastWinner.username}</span>
        </p>
      ) : null}

      {/* Players */}
      <h2 className="mt-8 text-sm uppercase tracking-widest text-muted-foreground">
        Players ({seats.length})
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {seats.map((s) => {
          const isTurn = roundActive && round?.current_turn_user_id === s.user_id;
          return (
            <div
              key={s.id}
              className={`surface-card flex items-center justify-between gap-3 p-4 ${
                isTurn ? "ring-2 ring-primary" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="truncate">{s.username}</span>
                  {s.user_id === user.id ? (
                    <span className="text-xs text-muted-foreground">(you)</span>
                  ) : null}
                  {s.user_id === room.host_id ? <Badge>Host</Badge> : null}
                  {isTurn ? (
                    <Badge variant="secondary">
                      {s.user_id === user.id ? "My turn" : "Current turn"}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Seat {s.seat ?? "—"} · {s.chips} points
                </p>
              </div>

              {isHost && !started ? (
                <Input
                  className="w-24"
                  inputMode="numeric"
                  aria-label={`Starting points for ${s.username}`}
                  value={points[s.user_id] ?? ""}
                  onChange={(e) =>
                    setPoints((p) => ({ ...p, [s.user_id]: e.target.value.replace(/\D/g, "") }))
                  }
                />
              ) : null}

              {isHost && started ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => run("", () => adjustPoints(s, -10))}
                  >
                    −10
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => run("", () => adjustPoints(s, 10))}
                  >
                    +10
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
        {Array.from({ length: empty }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center justify-center rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground"
          >
            Empty seat
          </div>
        ))}
      </div>

      {/* Host controls */}
      <div className="mt-8 space-y-4">
        {isHost && !started ? (
          <div className="surface-card p-4">
            <p className="text-sm font-semibold">Set starting points, then start the game</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Each player can start with a different amount. This locks once the game starts.
            </p>
            <Button
              className="mt-3 w-full sm:w-auto"
              disabled={busy || seats.length < 2}
              onClick={() =>
                run("Game started", () =>
                  startGame(
                    room,
                    seats,
                    Object.fromEntries(
                      seats.map((s) => [s.user_id, Number(points[s.user_id] ?? "0")]),
                    ),
                  ),
                )
              }
            >
              {seats.length < 2 ? "Waiting for players…" : "Start game"}
            </Button>
          </div>
        ) : null}

        {isHost && roundActive && round ? (
          <div className="surface-card space-y-3 p-4">
            <Button
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => run("Turn passed", () => advanceTurn(round, seats))}
            >
              Next turn
            </Button>
            <div>
              <p className="text-sm font-semibold">Select winner</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {seats.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => run(`${s.username} wins`, () => selectWinner(round, s.user_id))}
                  >
                    {s.username}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {isHost && started && round && round.status !== "active" ? (
          <Button
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => run("Next round started", () => nextRound(room, round, seats))}
          >
            Next round
          </Button>
        ) : null}

        {!isHost ? (
          <p className="text-sm text-muted-foreground">
            The host controls turns, points and round results.
          </p>
        ) : null}

        <Button variant="outline" onClick={leave}>
          Leave table
        </Button>
      </div>
    </div>
  );
}
