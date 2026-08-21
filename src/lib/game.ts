import { supabase } from "@/integrations/supabase/client";

export type Room = {
  id: string;
  code: string;
  name: string;
  host_id: string;
  status: string;
  max_players: number;
  boot_amount: number;
};

export type Seat = {
  id: string;
  user_id: string;
  seat: number | null;
  chips: number;
  username: string;
};

export type Round = {
  id: string;
  room_id: string;
  round_number: number;
  status: string;
  current_turn_user_id: string | null;
};

export type Winner = {
  id: string;
  round_id: string;
  user_id: string;
  created_at: string;
};

export async function fetchRoomByCode(code: string) {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Room | null) ?? null;
}

export async function fetchSeats(roomId: string): Promise<Seat[]> {
  const { data: players, error } = await supabase
    .from("room_players")
    .select("id, user_id, seat, chips")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw new Error(error.message);

  const ids = (players ?? []).map((p) => p.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, username").in("id", ids)
    : { data: [] as { id: string; username: string }[] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.username]));

  return (players ?? []).map((p) => ({ ...p, username: names.get(p.user_id) ?? "Player" }));
}

export async function fetchLatestRound(roomId: string): Promise<Round | null> {
  const { data, error } = await supabase
    .from("game_rounds")
    .select("id, room_id, round_number, status, current_turn_user_id")
    .eq("room_id", roomId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Round | null) ?? null;
}

export async function fetchWinners(roomId: string) {
  const { data: rounds } = await supabase
    .from("game_rounds")
    .select("id, round_number")
    .eq("room_id", roomId);
  const ids = (rounds ?? []).map((r) => r.id);
  if (!ids.length) return [] as { round_number: number; user_id: string }[];
  const { data } = await supabase
    .from("game_winners")
    .select("round_id, user_id, created_at")
    .in("round_id", ids)
    .order("created_at", { ascending: false });
  const numbers = new Map((rounds ?? []).map((r) => [r.id, r.round_number]));
  return (data ?? []).map((w) => ({
    round_number: numbers.get(w.round_id) ?? 0,
    user_id: w.user_id,
  }));
}

/** Host: lock in starting points and open round 1. */
export async function startGame(room: Room, seats: Seat[], points: Record<string, number>) {
  for (const seat of seats) {
    const value = points[seat.user_id];
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
      throw new Error("Every player needs a valid starting amount.");
    }
    const { error } = await supabase
      .from("room_players")
      .update({ chips: Math.round(value) })
      .eq("id", seat.id);
    if (error) throw new Error(error.message);
  }

  const { error: roundError } = await supabase.from("game_rounds").insert({
    room_id: room.id,
    round_number: 1,
    status: "active",
    current_turn_user_id: seats[0]?.user_id ?? null,
    started_at: new Date().toISOString(),
  });
  if (roundError) throw new Error(roundError.message);

  const { error } = await supabase.from("rooms").update({ status: "playing" }).eq("id", room.id);
  if (error) throw new Error(error.message);
}

/** Host: pass the turn to the next seat, wrapping to the first. */
export async function advanceTurn(round: Round, seats: Seat[]) {
  if (!seats.length) return;
  const index = seats.findIndex((s) => s.user_id === round.current_turn_user_id);
  const next = seats[(index + 1) % seats.length];
  const { error } = await supabase
    .from("game_rounds")
    .update({ current_turn_user_id: next.user_id })
    .eq("id", round.id);
  if (error) throw new Error(error.message);
}

/** Host: record the round winner and close the round. */
export async function selectWinner(round: Round, userId: string) {
  const { error } = await supabase
    .from("game_winners")
    .insert({ round_id: round.id, user_id: userId, amount: 0 });
  if (error) throw new Error(error.message);

  const { error: roundError } = await supabase
    .from("game_rounds")
    .update({
      status: "finished",
      current_turn_user_id: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", round.id);
  if (roundError) throw new Error(roundError.message);
}

/** Host: open the next round. */
export async function nextRound(room: Room, previous: Round, seats: Seat[]) {
  const { error } = await supabase.from("game_rounds").insert({
    room_id: room.id,
    round_number: previous.round_number + 1,
    status: "active",
    current_turn_user_id: seats[0]?.user_id ?? null,
    started_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Host: adjust a player's points during play. */
export async function adjustPoints(seat: Seat, delta: number) {
  const { error } = await supabase
    .from("room_players")
    .update({ chips: Math.max(0, seat.chips + delta) })
    .eq("id", seat.id);
  if (error) throw new Error(error.message);
}
