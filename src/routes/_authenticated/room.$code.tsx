import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/room/$code")({
  head: () => ({
    meta: [
      { title: "Table lobby — 3 Patti" },
      { name: "description", content: "Waiting room for your private 3 Patti table." },
      { property: "og:title", content: "Table lobby — 3 Patti" },
      {
        property: "og:description",
        content: "Waiting room for your private 3 Patti table.",
      },
    ],
  }),
  component: RoomLobby,
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

type Seat = { id: string; user_id: string; seat: number | null; chips: number; username: string };

function RoomLobby() {
  const { code } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadSeats(roomId: string) {
      const { data: players } = await supabase
        .from("room_players")
        .select("id, user_id, seat, chips")
        .eq("room_id", roomId)
        .order("seat", { ascending: true });

      const ids = (players ?? []).map((p) => p.user_id);
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, username").in("id", ids)
        : { data: [] as { id: string; username: string }[] };

      const names = new Map((profiles ?? []).map((p) => [p.id, p.username]));
      if (!active) return;
      setSeats(
        (players ?? []).map((p) => ({
          ...p,
          username: names.get(p.user_id) ?? "Player",
        })),
      );
    }

    async function init() {
      const { data } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code.toUpperCase())
        .maybeSingle();
      if (!active) return;
      setRoom(data as Room | null);
      setLoading(false);
      if (!data) return;
      await loadSeats(data.id);

      const channel = supabase
        .channel(`room-${data.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${data.id}` },
          () => void loadSeats(data.id),
        )
        .subscribe();

      return () => supabase.removeChannel(channel);
    }

    const cleanup = init();
    return () => {
      active = false;
      void cleanup.then((fn) => fn?.());
    };
  }, [code]);

  // Everyone in the room follows the host into the game table.
  useEffect(() => {
    if (!room) return;
    if (room.status === "playing") {
      navigate({ to: "/game/$code", params: { code: room.code } });
      return;
    }
    const channel = supabase
      .channel(`room-status-${room.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if ((payload.new as { status: string }).status === "playing") {
            navigate({ to: "/game/$code", params: { code: room.code } });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room, navigate]);

  const isHost = !!room && room.host_id === user.id;

  async function startGame() {
    if (!room) return;
    const { data: existing } = await supabase
      .from("game_rounds")
      .select("id")
      .eq("room_id", room.id)
      .limit(1);
    if (!existing?.length) {
      const { error } = await supabase.from("game_rounds").insert({
        room_id: room.id,
        round_number: 1,
        status: "in_progress",
        boot_amount: room.boot_amount,
        started_at: new Date().toISOString(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    const { error: roomError } = await supabase
      .from("rooms")
      .update({ status: "playing" })
      .eq("id", room.id);
    if (roomError) {
      toast.error(roomError.message);
      return;
    }
    navigate({ to: "/game/$code", params: { code: room.code } });
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

  const empty = Math.max(0, room.max_players - seats.length);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/" className="text-xs uppercase tracking-widest text-muted-foreground">
            ← Lobby
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{room.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Boot {room.boot_amount} · up to {room.max_players} players
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

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {seats.map((s) => (
          <div key={s.id} className="surface-card flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">{s.username}</p>
              <p className="text-xs text-muted-foreground">
                Seat {s.seat ?? "—"} · {s.chips} chips
              </p>
            </div>
            {s.user_id === room.host_id ? <Badge>Host</Badge> : null}
          </div>
        ))}
        {Array.from({ length: empty }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center justify-center rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground"
          >
            Empty seat
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {isHost ? (
          <Button onClick={startGame}>Start game</Button>
        ) : (
          <Button disabled>Waiting for host to start</Button>
        )}

        <Button variant="outline" onClick={leave}>
          Leave table
        </Button>
      </div>
    </div>
  );
}
