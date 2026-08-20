import { supabase } from "@/integrations/supabase/client";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6) {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export type CreateRoomInput = {
  name: string;
  maxPlayers: number;
  bootAmount: number;
  isPrivate: boolean;
};

export async function createRoom(input: CreateRoomInput) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) throw new Error("You need to be signed in.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        code,
        name: input.name,
        host_id: user.id,
        max_players: input.maxPlayers,
        boot_amount: input.bootAmount,
        is_private: input.isPrivate,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") continue; // code collision, retry
      throw new Error(error.message);
    }

    const { error: seatError } = await supabase
      .from("room_players")
      .insert({ room_id: data.id, user_id: user.id, seat: 1 });
    if (seatError) throw new Error(seatError.message);

    return data;
  }

  throw new Error("Could not generate a free room code. Try again.");
}

export async function joinRoom(rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) throw new Error("You need to be signed in.");

  const { data: room, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!room) throw new Error("No table found with that code.");
  if (room.status === "finished") throw new Error("That table has already closed.");

  const { data: players, error: playersError } = await supabase
    .from("room_players")
    .select("id, user_id, seat")
    .eq("room_id", room.id);
  if (playersError) throw new Error(playersError.message);

  const already = players?.some((p) => p.user_id === user.id);
  if (!already) {
    if ((players?.length ?? 0) >= room.max_players) throw new Error("That table is full.");
    const taken = new Set((players ?? []).map((p) => p.seat));
    let seat = 1;
    while (taken.has(seat)) seat++;
    const { error: joinError } = await supabase
      .from("room_players")
      .insert({ room_id: room.id, user_id: user.id, seat });
    if (joinError) throw new Error(joinError.message);
  }

  return room;
}
